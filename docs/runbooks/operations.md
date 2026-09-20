# Phoenix Portal Operational Runbook

> Last updated: 2026-09-20
> Audience: On-call operators, backend engineers

This document covers day-to-day operational troubleshooting for Phoenix Portal.
For billing-specific incidents (refunds, reconciliation, escalation), see
[billing-incident-response.md](billing-incident-response.md). For Paddle sandbox
testing, see [paddle-simulation-testing.md](paddle-simulation-testing.md).

---

## 1. Failed Webhook Debugging

### Signs of trouble

- User reports paying but having FREE tier access.
- `subscriptions` table shows stale `updated_at` for active users.
- Paddle dashboard shows delivered notifications but portal state is wrong.
- Sentry reports errors from subscription-gated components for paying users.

### Check Edge Function logs

**Supabase Dashboard:**

1. Navigate to **Edge Functions > paddle-webhooks**.
2. Open the **Invocations** tab. Look for non-200 status codes.
3. Click an invocation to view `console.log` / `console.error` output.

**Supabase CLI:**

```bash
# Tail live logs
supabase functions logs paddle-webhooks --project-ref $SUPABASE_PROJECT_REF

# View recent entries
supabase functions logs paddle-webhooks --project-ref $SUPABASE_PROJECT_REF --limit 100
```

**Key log messages:**

| Log message                                              | Meaning                                           | Severity                                 |
| -------------------------------------------------------- | ------------------------------------------------- | ---------------------------------------- |
| `Missing custom_data.user_id in Paddle event`            | Checkout created without `user_id` in custom_data | HIGH -- user pays but gets no access     |
| `[BILLING_ALERT] Unknown price ID`                       | Price ID not in `PADDLE_*_PRICE_IDS` env vars     | HIGH -- silent tier mismatch             |
| `[BILLING_ALERT] Error applying subscription event for`  | Database write failed                             | MEDIUM -- Paddle retries on 5xx          |
| `[BILLING_ALERT] Webhook signature too old:`             | Signature age > 5 minutes                         | LOW -- replay protection, retry will fix |
| `Unhandled event type: <type>`                           | Non-subscription event (normal)                   | NONE                                     |

Every `[BILLING_ALERT]` string, what it means and what to do about it, is
catalogued in
**Section 7: Checking Edge Function Logs** of
[billing-incident-response.md](billing-incident-response.md).

### Identify missed events in Paddle

1. Open **Paddle Dashboard > Developer Tools > Notifications**.
2. Filter by destination (your `paddle-webhooks` Edge Function URL).
3. Look for notifications with status **failed** or **pending retry**.
4. Note the `event_id`, `event_type`, and timestamp.

### Re-trigger webhooks from Paddle

**Retry a specific failed notification:**

1. In the Notifications list, find the failed notification.
2. Click **Retry** to re-send it.

**Via API:**

```bash
curl -X POST "https://api.paddle.com/notifications/{notification_id}/replay" \
  -H "Authorization: Bearer ${PADDLE_API_KEY}"
```

**If idempotency blocks the replay** (handler returns 200 with `duplicate: true` but state is still wrong):

```sql
-- Clear BOTH idempotency markers to allow reprocessing
UPDATE subscriptions
SET last_event_id = NULL,
    last_event_occurred_at = NULL
WHERE user_id = '<uuid>';
```

Clearing `last_event_id` alone is not enough: `apply_subscription_event` also
refuses any event whose `occurred_at` is not strictly newer than the stored
`last_event_occurred_at`, so the replay would be accepted with a 200 and write
nothing. Clear both, then retry the notification.

### Financial reconciliation

For reconciling portal state against Paddle billing records, follow
**Section 3: Reconciling with Paddle** in
[billing-incident-response.md](billing-incident-response.md).

---

## 2. Stuck Sync Queue Investigation

### Signs of trouble

- User reports integration data not updating.
- `sync_queue` has tasks stuck in `processing` for more than 10 minutes.
- `process-sync-queue` Edge Function logs show repeated errors for one provider.
- Provider-specific error rates climbing in Edge Function invocations.

### Find stuck tasks

```sql
-- Tasks stuck in 'processing' for more than 10 minutes
SELECT id, user_id, provider, status, retry_count,
       error_message, started_at, created_at,
       NOW() - started_at AS stuck_duration
FROM sync_queue
WHERE status = 'processing'
  AND started_at < NOW() - INTERVAL '10 minutes'
ORDER BY started_at ASC;
```

### Identify which provider is failing

```sql
-- Failure count by provider in the last 24 hours
SELECT provider,
       COUNT(*) FILTER (WHERE status = 'failed') AS failed,
       COUNT(*) FILTER (WHERE status = 'permanently_failed') AS permanently_failed,
       COUNT(*) FILTER (WHERE status = 'processing') AS stuck,
       COUNT(*) FILTER (WHERE status = 'pending') AS pending
FROM sync_queue
WHERE created_at > NOW() - INTERVAL '24 hours'
GROUP BY provider
ORDER BY failed DESC;
```

### Check rate limit tracking

```sql
-- Current rate limit state per provider
SELECT provider, requests_this_window, window_started_at,
       last_request_at, last_reset_at
FROM rate_limit_tracking
ORDER BY provider;
```

**Rate limit thresholds** (from `process-sync-queue`):

| Provider | Max requests | Window     |
| -------- | ------------ | ---------- |
| Strava   | 80           | 15 minutes |
| Fitbit   | 120          | 1 hour     |
| Garmin   | 40           | 1 hour     |
| Hevy     | 40           | 1 hour     |

If `requests_this_window` is at or above the limit and the window has not expired, the provider is rate-limited and tasks will not be picked up until the window resets.

### Reset stuck tasks

```sql
-- Reset stuck 'processing' tasks back to 'pending' so they get re-picked
UPDATE sync_queue
SET status = 'pending',
    started_at = NULL,
    error_message = 'Manually reset from stuck processing state'
WHERE status = 'processing'
  AND started_at < NOW() - INTERVAL '10 minutes';
```

**Reset a rate limit window** (use only if the provider is not actually rate-limited upstream):

```sql
UPDATE rate_limit_tracking
SET requests_this_window = 0,
    window_started_at = NOW(),
    last_reset_at = NOW()
WHERE provider = '<provider_name>';
```

### Check Edge Function logs for sync errors

```bash
# Logs for the queue processor
supabase functions logs process-sync-queue --project-ref $SUPABASE_PROJECT_REF --limit 50

# Logs for a specific provider sync function
supabase functions logs strava-sync --project-ref $SUPABASE_PROJECT_REF --limit 50
supabase functions logs fitbit-sync --project-ref $SUPABASE_PROJECT_REF --limit 50
supabase functions logs hevy-sync --project-ref $SUPABASE_PROJECT_REF --limit 50
```

**Key log messages:**

| Log message                                                   | Meaning                                                     |
| ------------------------------------------------------------- | ----------------------------------------------------------- |
| `Task <id> permanently failed after 10 retries`               | Max retry cap hit (MAX_RETRIES = 10)                        |
| `Subscription required: <tier> does not meet FLAME minimum`   | User's subscription lapsed; sync gated behind FLAME tier    |
| `Token refresh failed: <status>`                              | OAuth token expired and refresh failed (Strava/Fitbit)      |
| `Garmin sync is webhook-driven and cannot be queued manually` | Garmin task incorrectly queued (Garmin uses push, not pull) |

---

## 3. Subscription State Force-Refresh

### Signs of trouble

- User reports seeing the wrong tier in the portal UI.
- User's subscription status in portal does not match Paddle dashboard.
- Webhook was missed and automatic retry window has expired.

### Check subscription state in the database

```sql
SELECT user_id, tier, status, paddle_subscription_id, paddle_customer_id,
       price_id, current_period_start, current_period_end,
       cancel_at_period_end, last_event_id, updated_at
FROM subscriptions
WHERE user_id = '<uuid>';
```

### Compare against Paddle dashboard

1. Open **Paddle Dashboard > Subscriptions**.
2. Search by `paddle_subscription_id` or customer email.
3. Compare:
   - Paddle subscription status vs portal `status` (note: Paddle `paused` maps to portal `canceled`).
   - Paddle price/product vs portal `tier`.
   - Paddle next billing date vs portal `current_period_end`.

### Manually update tier/status

Only do this after confirming the correct state in Paddle dashboard.

```sql
-- Fix a user's subscription to match Paddle reality
UPDATE subscriptions
SET tier = '<EMBER|FLAME|INFERNO>',
    status = '<active|canceled|past_due|trialing>',
    cancel_at_period_end = <TRUE|FALSE>,
    current_period_end = '<yyyy-mm-ddThh:mm:ssZ>',
    updated_at = NOW()
WHERE user_id = '<uuid>';
```

For more SQL templates (full reset, insert missing row, bulk reconciliation),
see **Section 2: Manually Fixing Subscription State** in
[billing-incident-response.md](billing-incident-response.md).

### Invalidate TanStack Query cache on the client

The portal's `useSubscription` hook subscribes to Postgres Realtime changes on
the `subscriptions` table. When you UPDATE the row above, the Realtime channel
fires and the client automatically refetches. No manual cache invalidation is
needed in most cases.

**If Realtime is not working or the user's browser is stale:**

- Tell the user to hard-refresh (`Ctrl+Shift+R` / `Cmd+Shift+R`).
- The subscription query has a `staleTime` of 5 minutes, so at worst the user
  sees the old state for 5 minutes after the DB update.

**If you need to verify the Realtime channel is active**, check the browser
console for `[Phoenix] Realtime sync channel active`. If absent, the user may
be on the FREE tier (sync channel only activates for EMBER+) or there is a
WebSocket connectivity issue.

---

## 4. Deployment Rollback

### Cloudflare Pages: roll back to a previous deployment

1. Open **Cloudflare Dashboard > Pages > phoenix-portal**.
2. Go to the **Deployments** tab.
3. Find the last known-good deployment.
4. Click the three-dot menu and select **Rollback to this deployment**.
5. Confirm. The rollback takes effect within ~60 seconds.

**Alternative via Wrangler CLI:**

```bash
# List recent deployments
npx wrangler pages deployments list --project-name phoenix-portal

# Roll back to a specific deployment
npx wrangler pages deployments rollback --project-name phoenix-portal --deployment-id <id>
```

### Edge Functions: redeploy a previous version

Supabase Edge Functions do not have built-in rollback. To revert:

1. Check out the previous good commit in git:
   ```bash
   git log --oneline supabase/functions/ -10
   git checkout <good_commit> -- supabase/functions/<function_name>/
   ```
2. Redeploy:
   ```bash
   supabase functions deploy <function_name> --project-ref $SUPABASE_PROJECT_REF
   ```
3. After verifying, revert the local checkout if needed:
   ```bash
   git checkout HEAD -- supabase/functions/<function_name>/
   ```

**To redeploy ALL Edge Functions at once:**

```bash
supabase functions deploy --project-ref $SUPABASE_PROJECT_REF
```

### Database migrations: reversal

Supabase does not support automatic migration rollback. If a migration needs
reversal:

1. **Write a reverse migration** as a new migration file (never delete or edit
   existing migration files):
   ```bash
   # Create a new timestamped migration
   supabase migration new rollback_<description>
   ```
2. Write SQL that undoes the forward migration (DROP columns, revert ALTERs, etc.).
3. Apply it:
   ```bash
   supabase db push --project-ref $SUPABASE_PROJECT_REF
   ```
4. **If the migration added NOT NULL constraints or dropped columns with data**,
   the reverse migration may require data backfill. Test on a branch first:
   ```bash
   supabase branches create rollback-test --project-ref $SUPABASE_PROJECT_REF
   ```

### Verify rollback

After any rollback, check these surfaces:

| Surface        | What to check                                                                                                            |
| -------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Portal UI      | Load the app, sign in, navigate key pages (Dashboard, Analytics, Routines)                                               |
| Edge Functions | Check invocation logs for the redeployed function(s)                                                                     |
| Webhooks       | Fire a Paddle simulation to verify webhook processing (see [paddle-simulation-testing.md](paddle-simulation-testing.md)) |
| Sync           | Trigger a manual sync for a test user and verify `sync_queue` completes                                                  |
| Auth           | Sign out and sign back in to verify auth flow                                                                            |

---

## 5. Manual GDPR Deletion

> Last verified against `8f7d3b8` (PR 35 `delete-account` / `_shared/accountPurge.ts`,
> migration `20260920003500`).

### When to use

Hand-deleting an account is the **last** resort. Work down this list:

1. **Let the scheduled pass run it.** The hourly `delete-due-accounts` pg_cron
   job calls `delete-account` with `{"mode":"process_due"}`. It claims up to
   `PROCESS_DUE_BATCH_SIZE` = 10 due requests per run, reclaims any claim older
   than `STUCK_CLAIM_MINUTES` = 15, and retries a failed purge on the next pass
   — every step of `purgeUser` is idempotent. A request that just failed once
   needs nothing from you.
2. **Check the job is actually running.** The migration creates the job
   **inactive** on first apply, so a request can sit due for ever with no alert
   other than `[DELETION_ALERT] overdue`:
   ```sql
   SELECT jobid, jobname, schedule, active FROM cron.job
   WHERE jobname = 'delete-due-accounts';

   SELECT status, return_message, start_time FROM cron.job_run_details
   WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'delete-due-accounts')
   ORDER BY start_time DESC LIMIT 5;

   -- Gateway/transport result of each invocation (200 = the pass ran).
   SELECT id, status_code, timed_out, error_msg, created
   FROM net._http_response ORDER BY created DESC LIMIT 20;
   ```
   A `401` means the Vault `edge_cron_secret` and the Edge `CRON_SECRET` differ,
   or `verify_jwt` is still on for `delete-account`. Fix that rather than
   deleting by hand.
3. **Check the request is not parked for support.** `process_due` skips any row
   with a non-null `needs_support_reason`. See
   [Deletion alerts and the needs-support path](#deletion-alerts-and-the-needs-support-path)
   below — clearing the reason usually re-arms the automatic purge.
4. Only if all of the above are exhausted, follow the manual procedure.

**Before proceeding:** Check Edge Function logs to understand why it failed.

```bash
supabase functions logs delete-account --project-ref $SUPABASE_PROJECT_REF --limit 20
```

Common failure reasons:
- Rate limit hit (1 request/hour/user) -- wait and retry.
- No pending deletion request -- check `deletion_requests` table.
- Grace period not expired -- check `scheduled_for` timestamp.
- `[DELETION_ALERT] needs_support billing_subscription_not_found` -- Paddle has
  no record of a subscription the local row still calls live. Resolve the
  billing question first; see Step 2 below.
- Auth admin API failure -- proceed with manual deletion below.

### Step-by-step manual deletion

Execute these in order. The cascade from `auth.admin.deleteUser()` handles most
tables, but if that call is what failed, you need to delete data manually first.

**Step 1: Record the user's data footprint (for verification later)**

```sql
-- Save this output before deleting anything
SELECT 'profiles' AS tbl, COUNT(*) FROM profiles WHERE id = '<uuid>'
UNION ALL SELECT 'workout_sessions', COUNT(*) FROM workout_sessions WHERE user_id = '<uuid>'
UNION ALL SELECT 'exercises', COUNT(*) FROM exercises WHERE user_id = '<uuid>'
UNION ALL SELECT 'sets', COUNT(*) FROM sets WHERE user_id = '<uuid>'
UNION ALL SELECT 'rep_summaries', COUNT(*) FROM rep_summaries WHERE user_id = '<uuid>'
UNION ALL SELECT 'rep_telemetry', COUNT(*) FROM rep_telemetry WHERE user_id = '<uuid>'
UNION ALL SELECT 'personal_records', COUNT(*) FROM personal_records WHERE user_id = '<uuid>'
UNION ALL SELECT 'exercise_progress', COUNT(*) FROM exercise_progress WHERE user_id = '<uuid>'
UNION ALL SELECT 'routines', COUNT(*) FROM routines WHERE user_id = '<uuid>'
UNION ALL SELECT 'routine_exercises', COUNT(*) FROM routine_exercises WHERE routine_id IN (SELECT id FROM routines WHERE user_id = '<uuid>')
UNION ALL SELECT 'training_cycles', COUNT(*) FROM training_cycles WHERE user_id = '<uuid>'
UNION ALL SELECT 'cycle_days', COUNT(*) FROM cycle_days WHERE cycle_id IN (SELECT id FROM training_cycles WHERE user_id = '<uuid>')
UNION ALL SELECT 'user_goals', COUNT(*) FROM user_goals WHERE user_id = '<uuid>'
UNION ALL SELECT 'external_activities', COUNT(*) FROM external_activities WHERE user_id = '<uuid>'
UNION ALL SELECT 'user_integrations', COUNT(*) FROM user_integrations WHERE user_id = '<uuid>'
UNION ALL SELECT 'oauth_tokens', COUNT(*) FROM oauth_tokens WHERE user_id = '<uuid>'
UNION ALL SELECT 'subscriptions', COUNT(*) FROM subscriptions WHERE user_id = '<uuid>'
UNION ALL SELECT 'community_comments', COUNT(*) FROM community_comments WHERE user_id = '<uuid>'
UNION ALL SELECT 'community_votes', COUNT(*) FROM community_votes WHERE user_id = '<uuid>'
UNION ALL SELECT 'saved_community_items', COUNT(*) FROM saved_community_items WHERE user_id = '<uuid>'
UNION ALL SELECT 'challenge_participants', COUNT(*) FROM challenge_participants WHERE user_id = '<uuid>'
UNION ALL SELECT 'user_onboarding', COUNT(*) FROM user_onboarding WHERE user_id = '<uuid>'
UNION ALL SELECT 'shared_routines', COUNT(*) FROM shared_routines WHERE user_id = '<uuid>'
UNION ALL SELECT 'shared_cycles', COUNT(*) FROM shared_cycles WHERE user_id = '<uuid>'
UNION ALL SELECT 'earned_badges', COUNT(*) FROM earned_badges WHERE user_id = '<uuid>'
UNION ALL SELECT 'gamification_stats', COUNT(*) FROM gamification_stats WHERE user_id = '<uuid>'
UNION ALL SELECT 'rpg_attributes', COUNT(*) FROM rpg_attributes WHERE user_id = '<uuid>'
UNION ALL SELECT 'content_reports', COUNT(*) FROM content_reports WHERE user_id = '<uuid>'
UNION ALL SELECT 'creator_follows', COUNT(*) FROM creator_follows WHERE user_id = '<uuid>'
UNION ALL SELECT 'user_blocks', COUNT(*) FROM user_blocks WHERE user_id = '<uuid>'
UNION ALL SELECT 'sync_queue', COUNT(*) FROM sync_queue WHERE user_id = '<uuid>'
UNION ALL SELECT 'sync_tombstones', COUNT(*) FROM sync_tombstones WHERE user_id = '<uuid>'
UNION ALL SELECT 'rate_limit_tracking', COUNT(*) FROM rate_limit_tracking WHERE user_id = '<uuid>'
UNION ALL SELECT 'deletion_requests', COUNT(*) FROM deletion_requests WHERE user_id = '<uuid>';
```

**FK-less tables the CASCADE does not reach.** `purgeUser` deletes these
explicitly (`EXPLICIT_PURGE_TARGETS` in
`supabase/functions/_shared/accountPurge.ts`); a manual deletion has to do the
same or the rows outlive the account. Some are prod-only (they have no
migration in this repo yet), so a query against them errors on a local stack —
that is expected, skip the ones that do not exist here:

```sql
-- Always present
SELECT 'oauth_tokens' AS tbl, COUNT(*) FROM oauth_tokens WHERE user_id = '<uuid>'
UNION ALL SELECT 'rate_limit_tracking', COUNT(*) FROM rate_limit_tracking WHERE user_id = '<uuid>'
UNION ALL SELECT 'sync_tombstones', COUNT(*) FROM sync_tombstones WHERE user_id = '<uuid>';

-- Prod-only (marked mayBeAbsent in EXPLICIT_PURGE_TARGETS): run one at a time
-- and ignore "relation does not exist" on a database that lacks them.
SELECT COUNT(*) FROM paddle_webhook_events WHERE user_id = '<uuid>';
SELECT COUNT(*) FROM paddle_webhook_events
 WHERE payload->'data'->'custom_data'->>'user_id' = '<uuid>';  -- rows whose user_id was never filled in
SELECT COUNT(*) FROM subscription_events WHERE user_id = '<uuid>';
SELECT COUNT(*) FROM goal_snapshots WHERE user_id = '<uuid>';
SELECT COUNT(*) FROM overload_suggestions WHERE user_id = '<uuid>';
SELECT COUNT(*) FROM telemetry_analysis WHERE user_id = '<uuid>';
SELECT COUNT(*) FROM wearable_daily_summaries WHERE user_id = '<uuid>';
```

This list is transcribed from `EXPLICIT_PURGE_TARGETS` on the branch this
section was verified against. It is **not** machine-generated: if that array
gains a table, this block goes stale silently. Re-read the array before
trusting it.

**Step 2: Settle billing in Paddle before you delete anything**

`purgeUser` cancels the user's Paddle subscription **first**, from Paddle's
live status (never from `subscriptions.status`, which can be stale), and aborts
the whole purge if it cannot. Do the same by hand: Step 4 deletes the
`subscriptions` row, which is the only local record of the Paddle ids — once it
is gone you cannot find the subscription to cancel, and the user keeps being
billed.

```sql
SELECT user_id, tier, status, paddle_customer_id, paddle_subscription_id
FROM subscriptions WHERE user_id = '<uuid>';
```

- `paddle_subscription_id IS NULL` -- nothing to cancel, continue.
- Otherwise open **Paddle Dashboard > Subscriptions**, find that id, and read
  its **live** status there.
  - Already `canceled` -- continue.
  - Anything else (including `paused`) -- cancel it in Paddle now, immediately,
    not at period end. **This is irreversible**; a cancelled Paddle
    subscription cannot be un-cancelled, only replaced by a new checkout.
  - Paddle returns 404 for the id -- this is the
    `[DELETION_ALERT] needs_support billing_subscription_not_found` case. Do
    **not** continue unless the local row is already `canceled` or `expired`.
    A 404 on a non-terminal local row means the portal and Paddle disagree
    about a live subscription, and deleting the account would destroy the only
    link to it. Resolve that first (see
    [billing-incident-response.md](billing-incident-response.md) §3).

Record the ids you saw here before continuing — they are gone after Step 4.

**Step 3: Delete storage objects**

```bash
# List and remove avatar files for the user
# Via Supabase Dashboard: Storage > avatars > navigate to user's folder > delete
# Or via the admin API / SQL:
```

```sql
-- Check for storage objects (avatars bucket)
SELECT name FROM storage.objects
WHERE bucket_id = 'avatars'
  AND name LIKE '<uuid>/%';

-- Delete them
DELETE FROM storage.objects
WHERE bucket_id = 'avatars'
  AND name LIKE '<uuid>/%';
```

**Step 4: Delete dependent data (leaf tables first)**

```sql
-- Telemetry and rep data (deepest nesting)
DELETE FROM rep_telemetry WHERE user_id = '<uuid>';
DELETE FROM rep_summaries WHERE user_id = '<uuid>';
DELETE FROM sets WHERE user_id = '<uuid>';

-- Exercise data (joined through workout_sessions)
DELETE FROM exercises WHERE workout_id IN (
  SELECT id FROM workout_sessions WHERE user_id = '<uuid>'
);

-- Routine children
DELETE FROM routine_exercises WHERE routine_id IN (
  SELECT id FROM routines WHERE user_id = '<uuid>'
);

-- Cycle children
DELETE FROM cycle_days WHERE training_cycle_id IN (
  SELECT id FROM training_cycles WHERE user_id = '<uuid>'
);

-- Community content (SET NULL on shared items, DELETE owned votes/saves/reports)
UPDATE community_comments SET user_id = NULL WHERE user_id = '<uuid>';
DELETE FROM community_votes WHERE user_id = '<uuid>';
DELETE FROM saved_community_items WHERE user_id = '<uuid>';
DELETE FROM content_reports WHERE user_id = '<uuid>';
DELETE FROM creator_follows WHERE user_id = '<uuid>';
DELETE FROM user_blocks WHERE user_id = '<uuid>';

-- SET NULL on shared routines/cycles (preserving community content)
UPDATE shared_routines SET user_id = NULL WHERE user_id = '<uuid>';
UPDATE shared_cycles SET user_id = NULL WHERE user_id = '<uuid>';

-- Integration and sync data
DELETE FROM oauth_tokens WHERE user_id = '<uuid>';
DELETE FROM sync_queue WHERE user_id = '<uuid>';
DELETE FROM user_integrations WHERE user_id = '<uuid>';
DELETE FROM external_activities WHERE user_id = '<uuid>';

-- Gamification and profile data
DELETE FROM earned_badges WHERE user_id = '<uuid>';
DELETE FROM gamification_stats WHERE user_id = '<uuid>';
DELETE FROM rpg_attributes WHERE user_id = '<uuid>';
DELETE FROM challenge_participants WHERE user_id = '<uuid>';
DELETE FROM user_onboarding WHERE user_id = '<uuid>';

-- Core user data
DELETE FROM personal_records WHERE user_id = '<uuid>';
DELETE FROM exercise_progress WHERE user_id = '<uuid>';
DELETE FROM workout_sessions WHERE user_id = '<uuid>';
DELETE FROM routines WHERE user_id = '<uuid>';
DELETE FROM training_cycles WHERE user_id = '<uuid>';
DELETE FROM user_goals WHERE user_id = '<uuid>';
DELETE FROM subscriptions WHERE user_id = '<uuid>';
DELETE FROM profiles WHERE id = '<uuid>';
```

Then the FK-less tables from Step 1 that the CASCADE never reaches. Skip any
that do not exist on this database:

```sql
DELETE FROM oauth_tokens WHERE user_id = '<uuid>';
DELETE FROM sync_tombstones WHERE user_id = '<uuid>';
DELETE FROM rate_limit_tracking WHERE user_id = '<uuid>';
DELETE FROM subscription_events WHERE user_id = '<uuid>';          -- prod-only
DELETE FROM paddle_webhook_events WHERE user_id = '<uuid>';        -- prod-only
DELETE FROM paddle_webhook_events                                  -- prod-only
 WHERE payload->'data'->'custom_data'->>'user_id' = '<uuid>';
DELETE FROM goal_snapshots WHERE user_id = '<uuid>';               -- prod-only
DELETE FROM overload_suggestions WHERE user_id = '<uuid>';         -- prod-only
DELETE FROM telemetry_analysis WHERE user_id = '<uuid>';           -- prod-only
DELETE FROM wearable_daily_summaries WHERE user_id = '<uuid>';     -- prod-only
```

**Do NOT touch `deletion_requests` here.** Its `user_id` is
`ON DELETE CASCADE`, so the row disappears by itself when Step 5 deletes the
auth user — that is the signal the erasure actually completed. Writing
`status = 'executed'` by hand builds the exact dead end this design removed:
nothing in the code writes `'executed'` any more (migration `20260920003500`
even flips legacy `'executed'` rows back to `'pending'`), and a request marked
`'executed'` while the account still exists can no longer be retried by
`process_due`, cancelled by the user, or re-requested. Leave the row alone.

**Step 5: Delete the Supabase Auth user**

```bash
# Via Supabase Dashboard: Authentication > Users > find user > delete
# Or via the Admin API:
curl -X DELETE "https://<project-ref>.supabase.co/auth/v1/admin/users/<uuid>" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}"
```

**Step 6: Verify nothing was missed**

Re-run the footprint query from Step 1. **Every count should be 0, including
`deletion_requests`.**

A surviving `deletion_requests` row is not a receipt — it is a failure signal.
`deletion_requests.user_id` is `ON DELETE CASCADE` (`20260301_deletion_support.sql`),
so the row can only still be there if the `auth.users` row is still there.
Go back to Step 5 and confirm the auth user is actually gone.

Once it is, the row is gone with it and there is nothing to update. If the
account genuinely cannot be deleted through the admin API, leave the request
`status = 'pending'` and mark it for support instead of closing it:

```sql
-- Park it: process_due skips rows with a reason, the user still sees and can
-- cancel the request, and the hourly pass alerts on it under
-- [DELETION_ALERT] needs_support_overdue rather than the generic overdue tag.
UPDATE public.deletion_requests
SET needs_support_reason = 'request_survived_purge'
WHERE user_id = '<uuid>' AND status = 'pending';
```

This is also the state `delete-account` itself leaves behind when a purge
reports success but the request row is still present — see the alert catalogue
below.

```sql
-- Quick verification: any remaining references to this user?
SELECT 'profiles' AS tbl, COUNT(*) FROM profiles WHERE id = '<uuid>'
UNION ALL SELECT 'workout_sessions', COUNT(*) FROM workout_sessions WHERE user_id = '<uuid>'
UNION ALL SELECT 'subscriptions', COUNT(*) FROM subscriptions WHERE user_id = '<uuid>'
UNION ALL SELECT 'oauth_tokens', COUNT(*) FROM oauth_tokens WHERE user_id = '<uuid>'
UNION ALL SELECT 'sync_queue', COUNT(*) FROM sync_queue WHERE user_id = '<uuid>';
```

Also verify the auth user is gone:

```sql
SELECT id, email FROM auth.users WHERE id = '<uuid>';
-- Should return 0 rows
```

### Deletion alerts and the needs-support path

Every string below is logged verbatim by `delete-account` or
`_shared/accountPurge.ts`, so it can be grepped in the Edge Function logs:

```bash
supabase functions logs delete-account --project-ref $SUPABASE_PROJECT_REF --limit 200 \
  | grep DELETION_ALERT
```

`process_due`'s HTTP response body (persisted by pg_net in
`net._http_response`) deliberately carries **counts only** — no user ids — so
the ids for every alert below live in the Edge logs and nowhere else.

| Alert string                                      | What happened                                                                                                                              | What the operator does                                                                                                                       |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `[DELETION_ALERT] reclaimed_stuck_claim`          | A request sat in `executing` for more than `STUCK_CLAIM_MINUTES` (15) — a previous run died mid-purge. This pass took the claim over.        | Nothing, once. The purge is idempotent and re-runs immediately. Repeated reclaims of the same user mean the purge is crashing: read the logs.   |
| `[DELETION_ALERT] overdue`                        | A `pending`/`executing` request is more than `OVERDUE_ALERT_DAYS` (2) past its `scheduled_for`, with no support reason.                     | The scheduler is not draining. Check the cron job's `active` flag and `net._http_response` (see "When to use" above) before anything manual.     |
| `[DELETION_ALERT] needs_support <reason>`         | A purge stopped for a reason only a human can resolve; the row is back to `pending` with `needs_support_reason` set, and `process_due` now skips it. | Resolve the named reason, then clear the column (below).                                                                            |
| `[DELETION_ALERT] needs_support_overdue <reason>` | The same row is now 2+ days overdue and still parked. Separate tag so a parked row does not drown the generic `overdue` alert every hour.    | It has been waiting for a human for two days. Work it.                                                                                         |
| `[DELETION_ALERT] request_survived_purge`         | The purge reported success but the request row is still there — so the auth user was NOT deleted. Parked `pending` + this reason.            | Treat as a live account. Finish the erasure (this section), then clear the reason or let the row cascade away.                                  |
| `[DELETION_ALERT] claim_revert_failed`            | Releasing a claim back to `pending` failed. The row may be stuck in `executing`.                                                            | It self-heals: the next pass reclaims anything `executing` older than 15 minutes. Investigate if it repeats.                                    |
| `[DELETION_ALERT] account deleted with residual rows` | The auth user is gone, but the post-delete pass could not clear some FK-less tables. `residual_tables` names them.                      | Nothing immediately — the hourly residue sweep retries. Check those tables are empty for that user a few hours later.                           |
| `[DELETION_ALERT] post_delete_purge_failed`       | Same class, logged from `purgeUser` itself.                                                                                                 | As above.                                                                                                                                      |
| `[DELETION_ALERT] residue_sweep_skipped_tables`   | `sweep_deleted_account_residue` could not touch a table (missing table or missing `user_id` column — schema drift). `skipped` names each.    | Residue is silently surviving in those tables. Fix the drift, or clear them by hand with the Step 4 queries.                                    |
| `[DELETION_ALERT] residue_sweep_failed`           | The sweep RPC itself errored, or an avatar folder could not be removed.                                                                    | Check the error; the sweep runs again next hour.                                                                                               |
| `[DELETION_ALERT] overdue_check_failed`           | The overdue query errored, so **this pass produced no overdue alerts at all**.                                                             | Absence of `overdue` alerts after this one proves nothing. Run the overdue query below by hand.                                                 |
| `[DELETION_ALERT] avatar_cleanup_failed`          | Avatar objects for a deleted user could not be removed. The `avatars` bucket is public, so those images stay publicly fetchable.            | **Act on this one.** Delete the objects by hand (Step 3's `storage.objects` query) — the residue sweep retries the folder, but do not wait.     |
| `[DELETION_ALERT] process_due_failed`             | The whole hourly pass threw.                                                                                                               | Nothing was processed this hour. Read the error; the next pass retries everything.                                                             |

There is no `claim_finish_failed` string in the code — that outcome is folded
into `claim_revert_failed`. Do not grep for it.

**Read-only overdue / parked query.** This is the same predicate
`process_due`'s alert step uses:

```sql
SELECT user_id, status, scheduled_for, claimed_at, needs_support_reason, last_attempt_at
FROM public.deletion_requests
WHERE status IN ('pending', 'executing')
  AND (scheduled_for < now() - interval '2 days'
       OR needs_support_reason IS NOT NULL);
```

**Clearing `needs_support_reason`.** Two reasons are written today:

- `billing_subscription_not_found` — Paddle returned 404 for a subscription the
  local row does not consider terminal. Settle it in Paddle first (Step 2).
- `request_survived_purge` — see above.

Once resolved, hand the request back to the scheduler:

```sql
UPDATE public.deletion_requests
SET needs_support_reason = NULL
WHERE user_id = '<uuid>';
```

That single statement re-arms an irreversible deletion: the row becomes
eligible again and the next hourly pass (within the hour, oldest
`last_attempt_at` first) will purge the account permanently. Only run it once
the reason genuinely no longer applies.

---

## 6. Integration Troubleshooting

### Signs of trouble

- User reports "Integration disconnected" or data not syncing.
- `user_integrations.status` is `token_expired` or `error`.
- Sync queue tasks for a provider are all failing.
- User cannot re-authorize after disconnecting.

### Strava / Fitbit: OAuth token refresh failures

Both providers use OAuth 2.0 with refresh tokens stored in `oauth_tokens`.

**Check token state:**

```sql
SELECT provider, token_expires_at, updated_at,
       CASE WHEN token_expires_at < NOW() THEN 'EXPIRED' ELSE 'VALID' END AS token_status
FROM oauth_tokens
WHERE user_id = '<uuid>'
  AND provider IN ('strava', 'fitbit');
```

**Check integration status:**

```sql
SELECT provider, status, last_sync_at, error_message, connected_at
FROM user_integrations
WHERE user_id = '<uuid>';
```

**Common failure modes:**

| Symptom                       | Cause                                                   | Resolution                                                                                       |
| ----------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `token_expired` status        | Refresh token revoked by user in provider's settings    | User must re-authorize via the integration settings page                                         |
| `Token refresh failed: 401`   | Provider revoked app access or credentials rotated      | Check `STRAVA_CLIENT_ID`/`STRAVA_CLIENT_SECRET` (or Fitbit equivalents) in Edge Function secrets |
| `Token refresh failed: 400`   | Refresh token used twice (Strava rotates on refresh)    | User must re-authorize                                                                           |
| Sync succeeds but no new data | `last_sync_at` is recent, no new activities in provider | Normal -- incremental sync only fetches new data                                                 |

**Force re-authorization:**

If token refresh is permanently broken, the user needs to disconnect and
reconnect. This can be done via the portal UI (Settings > Integrations), or
manually:

```sql
-- Clear the broken tokens
DELETE FROM oauth_tokens
WHERE user_id = '<uuid>' AND provider = '<strava|fitbit>';

-- Reset integration status so the UI shows "Connect"
UPDATE user_integrations
SET status = 'disconnected',
    connected_at = NULL,
    provider_user_id = NULL,
    error_message = NULL
WHERE user_id = '<uuid>' AND provider = '<strava|fitbit>';

-- Cancel any pending sync tasks
UPDATE sync_queue
SET status = 'failed',
    error_message = 'Integration reset by operator',
    completed_at = NOW()
WHERE user_id = '<uuid>'
  AND provider = '<strava|fitbit>'
  AND status IN ('pending', 'processing');
```

### Hevy / Liftosaur: API key validation

These providers use API keys instead of OAuth. The key is stored in
`oauth_tokens.api_key`.

**Check API key state:**

```sql
SELECT provider, api_key IS NOT NULL AS has_key, updated_at
FROM oauth_tokens
WHERE user_id = '<uuid>'
  AND provider IN ('hevy', 'liftosaur');
```

**Common error codes:**

| HTTP status | Provider  | Meaning                                         |
| ----------- | --------- | ----------------------------------------------- |
| 401         | Hevy      | API key invalid or Hevy PRO subscription lapsed |
| 403         | Hevy      | API key valid but insufficient permissions      |
| 401         | Liftosaur | API key invalid                                 |
| 429         | Both      | Rate limited by provider                        |

**Resolution:** User needs to generate a new API key from the provider's
settings and re-enter it in the portal.

### Garmin: webhook-driven (not queue-based)

Garmin uses push webhooks via the `garmin-webhook` Edge Function. It cannot
be manually synced through the sync queue. The `process-sync-queue` function
explicitly rejects Garmin tasks with HTTP 400.

**Current status:** Garmin integration has a `comingSoon` flag. If a Garmin
task appears in `sync_queue`, it was incorrectly created. Mark it as failed:

```sql
UPDATE sync_queue
SET status = 'failed',
    error_message = 'Garmin is webhook-driven, not queue-based',
    completed_at = NOW()
WHERE provider = 'garmin'
  AND status IN ('pending', 'processing');
```

### Reset a user's integration connection

This is equivalent to what the `disconnect-integration` Edge Function does.
Use this if the Edge Function itself is failing.

```sql
-- 1. Delete OAuth tokens
DELETE FROM oauth_tokens
WHERE user_id = '<uuid>' AND provider = '<provider>';

-- 2. Reset integration status
UPDATE user_integrations
SET status = 'disconnected',
    connected_at = NULL,
    provider_user_id = NULL,
    error_message = NULL
WHERE user_id = '<uuid>' AND provider = '<provider>';

-- 3. Cancel pending sync tasks
UPDATE sync_queue
SET status = 'failed',
    error_message = 'Integration disconnected by operator',
    completed_at = NOW()
WHERE user_id = '<uuid>'
  AND provider = '<provider>'
  AND status IN ('pending', 'processing');
```

---

## 7. Monitoring Quick Reference

### Sentry

**URL:** Project-specific Sentry dashboard (DSN configured via `VITE_SENTRY_DSN`).

**Where to look:**

- **Issues** tab: grouped errors sorted by frequency and impact.
- **Performance** tab: frontend trace data (sampled at 10% in production).
- Filter by `environment: production` to exclude dev noise.

**What to watch:**

- New issues in the last 24 hours.
- Regression markers on previously resolved issues.
- Error spikes correlated with deployments.

**Note:** Sentry is only initialized if `VITE_SENTRY_DSN` is set and the app is
running in production mode (`import.meta.env.PROD`). It is not initialized in
development.

### Supabase Dashboard

**Edge Function logs:**

1. Navigate to **Edge Functions** in the sidebar.
2. Select a function to view invocations, status codes, and execution time.
3. Functions to monitor regularly:
   - `paddle-webhooks` -- billing events
   - `process-sync-queue` -- integration sync processing
   - `delete-account` -- GDPR deletion
   - Provider sync functions (`strava-sync`, `fitbit-sync`, `hevy-sync`)

**Database metrics:**

1. Navigate to **Database > Health** for connection pool usage and query
   performance.
2. Navigate to **Table Editor** to inspect data directly.

**Auth metrics:**

1. Navigate to **Authentication > Users** for user counts and sign-in activity.

### Paddle Dashboard

**Event logs:**

1. Navigate to **Developer Tools > Notifications**.
2. Filter by destination and status (delivered, failed, pending).
3. Check for failed deliveries that may need manual replay.

**Subscription status:**

1. Navigate to **Subscriptions** in the sidebar.
2. Search by customer email or subscription ID.
3. Compare against portal `subscriptions` table state.

### Key metrics to watch

| Metric                   | Where to check                                                                                                            | Alert threshold              |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| Webhook error rate       | Supabase Edge Functions > paddle-webhooks                                                                                 | Any 5xx responses            |
| Webhook processing time  | Paddle Dashboard > Notifications                                                                                          | Approaching 5-second timeout |
| Sync queue depth         | SQL: `SELECT COUNT(*) FROM sync_queue WHERE status = 'pending'`                                                           | > 50 pending tasks           |
| Stuck sync tasks         | SQL: `SELECT COUNT(*) FROM sync_queue WHERE status = 'processing' AND started_at < NOW() - INTERVAL '10 minutes'`         | > 0                          |
| Permanently failed syncs | SQL: `SELECT COUNT(*) FROM sync_queue WHERE status = 'permanently_failed' AND completed_at > NOW() - INTERVAL '24 hours'` | > 5 in 24 hours              |
| Subscription mismatches  | SQL: `SELECT COUNT(*) FROM subscriptions WHERE status = 'active' AND current_period_end < NOW()`                          | > 0                          |
| Token expiry backlog     | SQL: `SELECT COUNT(*) FROM user_integrations WHERE status = 'token_expired'`                                              | Rising trend                 |
| Sentry error rate        | Sentry Issues dashboard                                                                                                   | New unresolved issues        |
| Auth failures            | Supabase Auth logs                                                                                                        | Spike in failed sign-ins     |

### Daily health check queries

Run these as a quick daily operational check:

```sql
-- 1. Subscription health: active subs with expired billing periods
SELECT COUNT(*) AS expired_active
FROM subscriptions
WHERE status = 'active'
  AND current_period_end < NOW();

-- 2. Sync queue health: anything stuck or backlogged
SELECT status, COUNT(*) AS count
FROM sync_queue
WHERE created_at > NOW() - INTERVAL '24 hours'
GROUP BY status
ORDER BY count DESC;

-- 3. Integration health: providers with token issues
SELECT provider, status, COUNT(*) AS count
FROM user_integrations
WHERE status IN ('token_expired', 'error')
GROUP BY provider, status
ORDER BY count DESC;

-- 4. Rate limit status: any providers currently throttled
SELECT provider, requests_this_window,
       window_started_at,
       NOW() - window_started_at AS window_age
FROM rate_limit_tracking
WHERE requests_this_window > 0;
```

---

## 8. Social Auth Setup And Verification

### When to use

Use this when:

- Google or Apple sign-in buttons are missing on the landing page.
- `/auth/v1/settings` reports `google: false` or `apple: false`.
- `GET /auth/v1/authorize?provider=<google|apple>` returns `400` with
  `Unsupported provider: provider is not enabled`.

### Required local environment variables

Add these to your local `.env` before pushing auth config:

```bash
SUPABASE_AUTH_SITE_URL=https://your-portal-domain.com
SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID=...
SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET=...
SUPABASE_AUTH_EXTERNAL_APPLE_CLIENT_ID=...
SUPABASE_AUTH_EXTERNAL_APPLE_SECRET=...
```

Optional:

```bash
# Override project ref if it cannot be inferred from VITE_SUPABASE_URL
SUPABASE_PROJECT_REF=abcdefghijklmnopqrst

# Additional exact redirect URLs, comma-separated
SUPABASE_AUTH_ADDITIONAL_REDIRECT_URLS=https://preview.example.com/auth/callback
```

### Push hosted Supabase auth config

The repo now provides an env-driven command that:

1. Generates the Google/Apple auth block in a temporary `supabase/config.toml`
2. Runs `supabase config push` against the linked hosted project
3. Verifies the public auth settings endpoint afterward

```bash
supabase login
npm run auth:social:push
```

To verify current provider state without pushing:

```bash
npm run auth:social:check
```

### Provider console values

The helper command prints the exact values again, but the critical ones are:

- Supabase OAuth callback URL: `https://<project-ref>.supabase.co/auth/v1/callback`
- Portal redirect URL allow-list entries: `http://localhost:5173/auth/callback`
  and your production `/auth/callback`
- Google web app:
  - Authorized JavaScript origins: `http://localhost:5173` and your portal
    origin
  - Authorized redirect URI: the Supabase callback URL above
- Apple Services ID:
  - Domain / Website URL: `https://<project-ref>.supabase.co`
  - Return URL: the Supabase callback URL above

### Apple rotation requirement

Apple web OAuth requires a generated client secret that expires every 6 months.
If Apple sign-in suddenly starts failing after previously working, rotate the
Apple client secret first and rerun:

```bash
npm run auth:social:push
```

### Stale Supabase project ref guard (issue #68)

The build refuses to ship a known-dead Supabase project ref (currently
`ilzlswmatadlnsuxatcv`) in executable scripts, `public/_headers`, or
`dist/`. The check is wired into `npm run verify` as
`assert:supabase-config` and can also be run standalone:

```bash
npm run assert:supabase-config
```

If the guard fails on a ref you believe is live, override the denylist via
`STALE_SUPABASE_REFS` (comma-separated) and re-run, or replace the
hardcoded ref with the env-neutral `https://*.supabase.co` CSP pattern
(see `public/_headers`).

The committed `src/lib/database.types.ts` is generated from the migrated
local schema (`npm run gen:types:local`) and CI (`gen:types:check` in
`.github/workflows/migrations.yml`) rejects anything else. To inspect the
types of a live project instead (diagnostics only, do not commit the result
while prod differs from the migrations), set `SUPABASE_PROJECT_REF` in `.env`
and run:

```bash
npm run gen:types
```

The script will refuse to run with a hardcoded fallback, so the build
never accidentally targets a deleted project.

---

## Related Runbooks

- [Billing Incident Response](billing-incident-response.md) -- manual fixes,
  reconciliation, refunds, and escalation paths
- [Paddle Simulation Testing](paddle-simulation-testing.md) -- webhook
  simulation setup and regression test scenarios
