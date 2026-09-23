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
| `[Paddle] Ignoring event with missing custom_data.user_id:` | Event has no `user_id` in custom_data; answered 200 and ignored | HIGH -- user pays but gets no access     |
| `[BILLING_ALERT] Malformed custom_data.user_id in Paddle event:` | `user_id` in custom_data is not a UUID; answered 400 | HIGH -- event is never applied           |
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

`rate_limit_tracking` is keyed by `(key, user_id)`. For provider quotas `key`
is the provider name (plus `strava:daily` for Strava's daily bucket);
application-wide quotas use `user_id IS NULL`, per-user quotas one row per
user. The same table also holds per-endpoint request limits (`key` is the
function name, e.g. `mobile-sync-push`), always per user. The legacy
`provider` column is still written but is not the lookup key.

```sql
-- Application-wide provider buckets (Strava, Garmin)
SELECT key, requests_this_window, window_started_at,
       last_request_at, last_reset_at
FROM rate_limit_tracking
WHERE user_id IS NULL
ORDER BY key;

-- One user's buckets (per-user providers and endpoint limits)
SELECT key, requests_this_window, window_started_at, last_request_at
FROM rate_limit_tracking
WHERE user_id = '<uuid>'
ORDER BY key;
```

**Provider rate limit thresholds** (`RATE_LIMITS`, `DAILY_RATE_LIMITS` and
`RATE_LIMIT_SCOPE` in `process-sync-queue/index.ts`):

| Provider  | Max requests | Window     | Scope                       |
| --------- | ------------ | ---------- | --------------------------- |
| Strava    | 80           | 15 minutes | application (`user_id` NULL) |
| Strava    | 800          | 24 hours   | application, key `strava:daily` |
| Fitbit    | 120          | 1 hour     | per user                    |
| Garmin    | 40           | 1 hour     | application (`user_id` NULL) |
| Hevy      | 40           | 1 hour     | per user (API key)          |
| Liftosaur | 40           | 1 hour     | per user (API key)          |

If `requests_this_window` is at or above the limit and the window has not
expired, that bucket is rate-limited. An exhausted application bucket stops the
whole provider for everyone; an exhausted per-user bucket only skips that
user's tasks.

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
-- Application-wide bucket (Strava / Garmin; use 'strava:daily' for the daily one)
UPDATE rate_limit_tracking
SET requests_this_window = 0,
    window_started_at = NOW(),
    last_reset_at = NOW()
WHERE key = '<provider_name>' AND user_id IS NULL;

-- One user's bucket (Fitbit / Hevy / Liftosaur, or an endpoint key)
UPDATE rate_limit_tracking
SET requests_this_window = 0,
    window_started_at = NOW(),
    last_reset_at = NOW()
WHERE key = '<provider_or_endpoint>' AND user_id = '<uuid>';
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

**If you need to verify the Realtime channel is active**, note that the portal
logs nothing when it connects. Two signals exist instead:

- The mobile-sync channel (`useRealtimeSync`, private topic `sync:{userId}`)
  shows the toast "Live sync interrupted. Retrying; data refreshes every
  minute." when it reaches `CHANNEL_ERROR`, `TIMED_OUT` or `CLOSED`, and
  dismisses it on the next successful subscribe. While that toast is up the
  portal polls every 60 seconds instead. Confirmed FREE users never open this
  channel.
- In the browser dev tools Network tab (WS filter), an open Realtime WebSocket
  to the project with join frames for `sync:{userId}` and
  `subscription:{userId}:…` means both channels are live.

---

## 4. Deployment Rollback

### Cloudflare Worker: roll back to a previous deployment

The portal is a Cloudflare Worker named `phoenix-portal` that serves `dist/` as
static assets (`wrangler.toml`: `[assets]` with single-page-application
fallback). Workers Builds deploys it with `npx wrangler deploy` on every push
to `main`. It is not a Cloudflare Pages project, so the `wrangler pages`
commands do not apply.

1. Open **Cloudflare Dashboard > Workers & Pages > phoenix-portal**.
2. Go to the **Deployments** tab.
3. Find the last known-good version.
4. Choose **Rollback** for that version and confirm. The previous version serves
   traffic within about a minute.

**Alternative via Wrangler CLI** (the pinned binary from `package.json`):

```bash
# List recent deployments and their version ids
npx wrangler deployments list

# Roll back to the previous version, or to a specific one
npx wrangler rollback
npx wrangler rollback <version-id>
```

A rollback only swaps the served version. The next push to `main` deploys
again, so revert or fix the bad commit on `main` too.

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
UNION ALL SELECT 'deletion_requests', COUNT(*) FROM deletion_requests WHERE user_id = '<uuid>'
UNION ALL SELECT 'local_profiles', COUNT(*) FROM local_profiles WHERE user_id = '<uuid>'
UNION ALL SELECT 'local_profile_preferences', COUNT(*) FROM local_profile_preferences WHERE user_id = '<uuid>'
UNION ALL SELECT 'exercise_catalog (custom)', COUNT(*) FROM exercise_catalog WHERE user_id = '<uuid>'
UNION ALL SELECT 'vbt_assessments', COUNT(*) FROM vbt_assessments WHERE user_id = '<uuid>'
UNION ALL SELECT 'exercise_signatures', COUNT(*) FROM exercise_signatures WHERE user_id = '<uuid>'
UNION ALL SELECT 'session_phase_statistics', COUNT(*) FROM session_phase_statistics WHERE user_id = '<uuid>'
UNION ALL SELECT 'user_insights', COUNT(*) FROM user_insights WHERE user_id = '<uuid>'
UNION ALL SELECT 'leaderboard_snapshots', COUNT(*) FROM leaderboard_snapshots WHERE user_id = '<uuid>'
UNION ALL SELECT 'oauth_states', COUNT(*) FROM oauth_states WHERE user_id = '<uuid>'
UNION ALL SELECT 'workout_deletion_tombstones', COUNT(*) FROM workout_deletion_tombstones WHERE user_id = '<uuid>'
UNION ALL SELECT 'training_cycle_deletion_tombstones', COUNT(*) FROM training_cycle_deletion_tombstones WHERE user_id = '<uuid>'
UNION ALL SELECT 'profile_ownership_transfers', COUNT(*) FROM profile_ownership_transfers WHERE user_id = '<uuid>'
UNION ALL SELECT 'profile_ownership_events', COUNT(*) FROM profile_ownership_events WHERE user_id = '<uuid>'
UNION ALL SELECT 'profile_ownership_claims', COUNT(*) FROM profile_ownership_claims WHERE user_id = '<uuid>';
```

Every `public` table with a `user_id` column should appear above. To check for
drift before trusting the list, compare it with:

```sql
SELECT c.table_name
FROM information_schema.columns c
JOIN information_schema.tables t USING (table_schema, table_name)
WHERE c.table_schema = 'public' AND c.column_name = 'user_id'
  AND t.table_type = 'BASE TABLE'
ORDER BY 1;
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
DELETE FROM exercises WHERE session_id IN (
  SELECT id FROM workout_sessions WHERE user_id = '<uuid>'
);

-- Routine children
DELETE FROM routine_exercises WHERE routine_id IN (
  SELECT id FROM routines WHERE user_id = '<uuid>'
);

-- Cycle children
DELETE FROM cycle_days WHERE cycle_id IN (
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

## 9. Pre-Apply Check: 20260920007600 (Prod Schema Drift Reconciliation)

`supabase/migrations/20260920007600_reconcile_prod_schema_drift.sql` is the one
migration in this set whose behaviour depends on production's current catalog,
and the two pieces of evidence available in the repo disagree about it. **Run
the read-only check below before `supabase db push` and record the result in
`prod-evidence.md`.** It is a plain `SELECT` against `information_schema`: it
takes no locks and changes nothing.

### Required read-only pre-apply query

```sql
SELECT table_name, column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND (table_name, column_name) IN (
    ('routines',          'created_at'),
    ('routines',          'updated_at'),
    ('training_cycles',   'updated_at'),
    ('routine_exercises', 'per_set_echo_levels'),
    ('profiles',          'digest_frequency'),
    ('profiles',          'digest_last_sent_at'),
    ('profiles',          'feature_flags'),
    ('user_goals',        'last_snapshot_at')
  )
ORDER BY table_name, column_name;
```

### What each outcome means

| Result | What the migration does | Action |
| --- | --- | --- |
| `routines.created_at` / `routines.updated_at` / `training_cycles.updated_at` all `is_nullable = NO` | Section 2 is skipped entirely. No lock, no `UPDATE`. | Push normally. |
| Any of those three is `is_nullable = YES` | Section 2 **runs on production**: it backfills the NULL rows, then takes `ACCESS EXCLUSIVE` plus a full verification scan on that table for `SET NOT NULL`, under `lock_timeout = '5s'`. | Push in a maintenance window. A lock timeout aborts the whole push cleanly (single transaction, nothing partially applied) -- retry when the table is quiet. The backfill runs with the row triggers suppressed, so `updated_at` does not move and devices do **not** re-pull those routines. |
| `routine_exercises.per_set_echo_levels` `data_type = jsonb` | Section 1 is skipped. | Push normally. |
| `data_type = json` or `text` | Section 1 **runs on production**: `ALTER COLUMN ... TYPE jsonb USING to_jsonb(...)`, i.e. `ACCESS EXCLUSIVE` plus a table rewrite. Semantically correct in both cases (mobile stores a JSON *string*; `to_jsonb` preserves it, `::jsonb` would not). | Push in a maintenance window. The generated types cannot tell `json` from `jsonb`, which is why this check exists. |
| The four `profiles` / `user_goals` columns all present | Section 3 is skipped. | Push normally, **and** paste the `data_type` / `column_default` values into `prod-evidence.md`: the repo's values for them are transcribed from the 2026-04-20 audit DDL (`ad2eb6b`) and have never been catalog-verified. If they differ from what the migration ships, open a follow-up -- the `ADD COLUMN IF NOT EXISTS` branches can never correct an existing column. |
| Any of them missing | Section 3 adds it with the reconstructed type/default. | Push normally. |

### What changes on production regardless of the answer

- **Section 4** revokes `TRUNCATE`, `REFERENCES` and `TRIGGER` from `anon` and
  `authenticated` on every table in `public`, and in the default privileges of
  every grantor role the migration role can alter.
- **Section 6** replaces `profiles`' table-wide `INSERT`/`UPDATE` grant for
  `authenticated` with a column list, so `feature_flags`, `digest_frequency`,
  `digest_last_sent_at` and `stripe_customer_id` stop being client-writable.
- **Section 7** revokes all client privileges on `oauth_tokens` and
  `oauth_states` (service-role only; RLS was previously the only barrier).
- **Section 5** re-asserts the SECURITY DEFINER function grants. This is a
  converging rewrite, not a no-op: it re-grants `request_account_deletion()`,
  which `20260920000100`'s allow-list does not contain.

### Ordering constraint

`20260920007600` must be applied **with or before** any replay of
`20260920000100`. Only 007600's allow-list contains
`public.request_account_deletion()`; a 000100 replay on its own revokes
`authenticated`'s `EXECUTE` on it.

### Post-apply verification (read-only)

```sql
-- Expect zero rows: no client TRUNCATE/REFERENCES/TRIGGER anywhere in public.
SELECT c.oid::regclass::text, r.rolname, pr.priv
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
CROSS JOIN (VALUES ('anon'), ('authenticated')) AS r(rolname)
CROSS JOIN (VALUES ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) AS pr(priv)
WHERE n.nspname = 'public'
  AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
  AND has_table_privilege(r.rolname, c.oid, pr.priv);

-- Expect all false: the OAuth tables and the server-owned profile columns.
SELECT has_table_privilege('authenticated', 'public.oauth_tokens', 'SELECT')  AS oauth_tokens_select,
       has_table_privilege('authenticated', 'public.oauth_states', 'SELECT')  AS oauth_states_select,
       has_table_privilege('authenticated', 'public.profiles', 'UPDATE')      AS profiles_table_update,
       has_column_privilege('authenticated', 'public.profiles', 'feature_flags', 'UPDATE') AS feature_flags_update;
```

### Known residual (not fixable from a `db push`)

`supabase_admin`'s default privileges in schema `public` still grant
`TRUNCATE`, `REFERENCES` and `TRIGGER` to `anon` and `authenticated`, so a
table created by Supabase platform tooling running as `supabase_admin` gets
them. `postgres` is not a member of `supabase_admin`, so
`ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin` fails with `42501` -- the
migration attempts it, catches the error and reports it as a `residual:`
NOTICE. Every table in `public` today is `postgres`-owned. The same default
grants also remain in the `storage` and `supabase_functions` schemas, which is
out of scope: those tables are owned by `supabase_storage_admin` /
`supabase_functions_admin` and storage-api re-grants them on every upgrade.
Keep the project's API "Exposed schemas" setting at `public, graphql_public`.
## 10. Scheduled Jobs
Everything that runs on a schedule runs from **pg_cron inside the production
database**. There is no external scheduler, no GitHub Actions cron and no
third-party job runner in this stack. (`.github/workflows/prod-migration-drift.yml`
is a CI drift detector, not an application job.)
Two kinds of job exist:
- **Pure SQL** -- the cron command is the statement itself. It needs no secret.
- **Edge invocation** -- the cron command calls
  `private.invoke_edge_function(fn, body)` (created by
  `supabase/migrations/20260920003100_scheduler_and_sync_queue_cron.sql`).
  That function reads the Vault secrets `edge_cron_secret` and `project_url`,
  then `net.http_post`s to `<project_url>/functions/v1/<fn>` with the header
  `x-cron-secret`.
### One shared cron secret, not one per job
All Edge-invoking jobs use the **same** credential -- one secret under two
names, plus the project URL. There is no per-job secret:
| Name                  | Where it lives                            | Set by                                   |
| --------------------- | ----------------------------------------- | ---------------------------------------- |
| `edge_cron_secret`    | Supabase Vault (`vault.secrets`)          | Operator Action 7, once, before PR 31    |
| `project_url`         | Supabase Vault (`vault.secrets`)          | Operator Action 7, once, before PR 31    |
| `CRON_SECRET`         | Edge Function secrets (all functions)     | Operator Action 7, from the Vault value  |
`CRON_SECRET` must equal `edge_cron_secret` exactly. Never paste either value
into the SQL editor or a shell command line -- see
[§13 Rotating the shared cron secret](#13-rotating-the-shared-cron-secret) for
the only supported way to move the value.
Receivers compare it in constant time via
`supabase/functions/_shared/cronSecret.ts`. That helper reads `CRON_SECRET`
first and only falls back to a legacy name (`PROCESS_SYNC_QUEUE_SECRET`,
`CRON_SYNC_QUEUE_SECRET`) when `CRON_SECRET` is unset; once `CRON_SECRET` is
set, a caller holding only a legacy value gets 401.
**Until the Vault secrets exist, `private.invoke_edge_function` raises a NOTICE
and returns.** The cron run is still recorded as `succeeded` -- see
[§10.1](#101-verify-a-jobs-last-run) for why `succeeded` alone proves nothing.
### Re-apply semantics
The four migrations that schedule jobs in this series -- `20260920003100`,
`20260920003500`, `20260920005600` and `20260920006400` -- each look their job
up by `jobname`, call `cron.schedule` when it is absent, and
`cron.alter_job(schedule := …, command := …)` when the stored schedule or
command has drifted. They keep the same `jobid`.

`process-sync-queue` and `delete-due-accounts` are created inactive so their
compatible Edge handlers can deploy first. After creation, re-applying any of
these migrations preserves the stored `active` flag: it repairs a drifted
schedule or command without undoing an operator pause or activation. For
`generate-insights` a re-apply also preserves the batch cursor in
`private.insights_batch_state`.

`20260920005210` also pauses an existing `process-sync-queue` job once when the
owned-row provider handlers are first deployed. Its private release-gate marker
means re-applying that migration after activation leaves the job active.

**None of them ever changes `active`, in either direction.** A re-apply repairs
a drifted schedule or command; it never activates a job you paused, and never
pauses a job that is running. For `generate-insights` a re-apply also preserves
the batch cursor in `private.insights_batch_state`.
`20260920000200` is different: it only schedules a job when no job of that name
exists, and never alters an existing one.
### The jobs
| Job name (`cron.job.jobname`)    | Cadence                            | What it runs                                                                                              | Migration                                             | Cron secret | Created active?                        |
| -------------------------------- | ---------------------------------- | --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | ----------- | -------------------------------------- |
| `process-sync-queue`             | `*/5 * * * *` (every 5 min)        | Edge `process-sync-queue` via `private.invoke_edge_function('process-sync-queue', '{}')`                   | `20260920003100_scheduler_and_sync_queue_cron.sql`; existing jobs paused once by `20260920005210_pause_sync_queue_for_owned_handlers.sql` | shared      | **No -- activate after the provider handlers deploy** |
| `cron-job-run-details-retention` | `41 3 * * *` (daily 03:41)         | SQL: `DELETE FROM cron.job_run_details WHERE end_time < now() - interval '7 days'`                        | `20260920003100_scheduler_and_sync_queue_cron.sql`    | --          | Yes                                    |
| `delete-due-accounts`            | `17 * * * *` (hourly at :17)       | Edge `delete-account` with body `{"mode":"process_due"}`                                                   | `20260920003500_due_deletion_cron.sql`                | shared      | **No -- INACTIVE by design ([§10.2](#102-activating-delete-due-accounts-irreversible))** |
| `refresh-leaderboard-snapshots`  | `*/15 * * * *` (every 15 min)      | SQL: `SELECT public.refresh_leaderboard_snapshots()`                                                       | `20260920005600_leaderboard_snapshots.sql`            | --          | Yes                                    |
| `generate-insights`              | `*/15 * * * *` (every 15 min)      | Edge `generate-insights` with `{"mode":"batch","cursor":…}` read from `private.insights_batch_state`       | `20260920006400_schedule_generate_insights.sql`       | shared      | Yes (cache refresh, nothing to activate) |
| `refresh-hot-scores`             | `*/15 * * * *` (every 15 min)      | SQL: `SELECT public.refresh_hot_scores()`                                                                  | `20260920000200_capture_dashboard_functions_and_cron.sql` (captured from prod) | --          | As already scheduled in prod           |
| `refresh-community-benchmarks`   | `0 */6 * * *` (every 6 h, on the hour) | SQL: `SELECT public.refresh_community_benchmarks()`                                                    | `20260920000200_capture_dashboard_functions_and_cron.sql` (captured from prod) | --          | As already scheduled in prod           |
Routine and training-cycle tombstones are durable deletion evidence so an
offline device cannot recreate deleted data when it eventually reconnects.
`20260920003100` removes the legacy `sync-tombstones-retention` job if it
exists. Tombstones are deleted with their account through the
`sync_tombstones.user_id` cascade.
Cadences are pg_cron expressions, evaluated in the **database** timezone.
Confirm it with `SHOW timezone;` before converting any of these to local time.
The last two jobs were created from the dashboard and existed in no migration
until `20260920000200` captured them, so their live schedule is whatever prod
holds -- the values above are what was captured on 2026-09-18.
**Prerequisites and deploy order**
| Job                   | Must be true before it can work                                                                                                                          |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `process-sync-queue`  | Deploy `process-sync-queue`, Strava, Fitbit, Hevy and Liftosaur handlers from this release, set the shared secret, then activate the initially paused job with `SELECT cron.alter_job((SELECT jobid FROM cron.job WHERE jobname = 'process-sync-queue'), active := true);`. `verify_jwt = false` is already set for the queue handler. |
| `delete-due-accounts` | Apply `20260920003500` **then** deploy the `delete-account` Edge Function -- the new handler writes `status='executing'` and `claimed_at`, which the old CHECK rejects. PR 35 also sets `verify_jwt = false` for `delete-account`; without it the gateway 401s pg_net. |
| `generate-insights`   | `20260920000800_entitlement_grace_window.sql` (defines `subscription_tier_for`) must be in prod **before** `20260920006400`, which calls it. PR 64 sets `verify_jwt = false` for `generate-insights`. Migration-first and Edge-first are both safe: migration-first logs gateway 401s in `net._http_response` until the Edge lands; Edge-first means no job exists yet and the user path still works. |
### 10.1 Verify a job's last run
Job history (substitute the job name):
SELECT d.jobid, j.jobname, d.status, d.return_message, d.start_time, d.end_time
FROM cron.job_run_details d
JOIN cron.job j USING (jobid)
WHERE j.jobname = 'process-sync-queue'
ORDER BY d.start_time DESC
LIMIT 5;
`cron.job_run_details` only holds the last 7 days -- `cron-job-run-details-retention`
prunes it. Anything older is gone.
Schedule, owner and pause state of every job:
SELECT jobid, jobname, schedule, active, username, command
FROM cron.job
ORDER BY jobname;
`username` is the role each job runs as -- normally the role that applied the
migration. Read it; do not assume it. If a pure-SQL job starts failing with a
permission error after a grant change, this column is the first thing to check.
**For the three Edge-invoking jobs, `status = 'succeeded'` is not proof the Edge
Function ran.** A missing Vault secret, a missing `project_url` or an absent
`pg_net` makes `private.invoke_edge_function` emit a NOTICE and return, which
pg_cron records as a successful run. Check the HTTP side too:
SELECT id, status_code, timed_out, error_msg, created
FROM net._http_response
ORDER BY created DESC
LIMIT 20;
| Observation                                                  | Meaning                                                                                                   |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| `status_code = 200`                                          | The pass ran. The body carries counts -- `processed`/`failed`/`skipped` for the sync queue, `processed`/`failed`/`nextCursor` for insights, the purge counters for deletions. |
| `status_code = 401`                                          | Vault `edge_cron_secret` and the Edge `CRON_SECRET` differ, **or** `verify_jwt` is still `true` for that function. |
| `timed_out = true`                                           | The pass ran past the pg_net timeout. `private.invoke_edge_function` sets `timeout_milliseconds := 400000` for every Edge job, so this is 400 s in all three cases. Claimed rows wait out their lease. |
| No new rows, while `cron.job_run_details` says `succeeded`   | Vault secret, `project_url` or `pg_net` is missing. The NOTICE is in the Postgres log.                       |
`net._http_response` is pruned by pg_net itself. **Unverified from this repo:**
the exact retention window is not stated in any migration header here, so treat
it as a short window covering the most recent passes only and do not use it as
an audit trail.
Per-job follow-up queries:
-- process-sync-queue
SELECT status, count(*) FROM public.sync_queue GROUP BY 1;
-- generate-insights
SELECT count(*) FROM public.user_insights WHERE expires_at > now();
SELECT * FROM private.insights_batch_state;  -- next_cursor wraps to NULL each full pass
-- delete-due-accounts
SELECT user_id, status, scheduled_for, claimed_at
FROM public.deletion_requests
WHERE status IN ('pending', 'executing')
  AND scheduled_for < now() - interval '2 days';
Note for the first `generate-insights` pass: rows written before
`20260920006400` have `expires_at IS NULL`, and PostgREST `gt` excludes NULLs,
so they count as expired. Those users see the on-device fallback until their
turn comes round. That is intended.
### 10.2 Activating `delete-due-accounts` (irreversible)
`20260920003500` creates this job **inactive** and raises
`NOTICE: delete-due-accounts scheduled INACTIVE; activate with cron.alter_job(<id>, active := true)`.
The shared cron secret is already set by the time this migration lands (it is
PR 31's secret), so the secret is not the gate -- the `active` flag is.
1. Apply `20260920003500_due_deletion_cron.sql`.
2. Deploy the `delete-account` Edge Function.
3. Review **every row** this read-only preview returns (the same query is in the
   migration header). Each one is purged and has its subscription cancelled once
   the job reaches it:
   ```sql
   SELECT id, user_id, status, requested_at, scheduled_for, claimed_at,
          needs_support_reason, last_attempt_at
   FROM public.deletion_requests
   WHERE status IN ('pending', 'executing', 'executed')
     AND scheduled_for <= now()
   ORDER BY scheduled_for;
   ```
   Contact any account that still looks active before continuing, if support
   policy requires it.
4. **This step starts irreversible deletions.** Once active, the next :17 run
   purges up to `PROCESS_DUE_BATCH_SIZE` (10) due accounts, oldest first, and
   repeats hourly until the backlog is clear. There is no undo and no
   soft-delete.
   ```sql
   SELECT cron.alter_job(
     (SELECT jobid FROM cron.job WHERE jobname = 'delete-due-accounts'),
     active := true
   );
   ```
5. After the next :17, check both the job run and the HTTP response using the
   queries in [§10.1](#101-verify-a-jobs-last-run).
To pause it again, run the same statement with `active := false`. Re-applying
the migration will not undo either change.
### 10.3 Pausing or resuming any job
-- Pause
SELECT cron.alter_job((SELECT jobid FROM cron.job WHERE jobname = '<jobname>'), active := false);
-- Resume
SELECT cron.alter_job((SELECT jobid FROM cron.job WHERE jobname = '<jobname>'), active := true);
A later re-apply of the owning migration preserves whichever state you set, and
for `generate-insights` also preserves the batch cursor in
`private.insights_batch_state`.
### 10.4 Manual periodic checks (nothing schedules these)
| Check                                 | Cadence   | Query                                                                                  | Act when                                                                     |
| ------------------------------------- | --------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Per-set telemetry storage growth      | Monthly   | `SELECT pg_size_pretty(pg_total_relation_size('public.rep_telemetry')), count(*) FROM public.rep_telemetry;` | Size exceeds 2 GB or the table exceeds 10M rows -- that is the trigger to revisit the telemetry storage redesign, which is deliberately not done now. |
| `personal_records` bloat              | After any dedupe/backfill | `SELECT pg_size_pretty(pg_total_relation_size('public.personal_records')), count(*) FROM public.personal_records;` | The size is out of proportion to the live row count (it was ~5.9k rows in 104 MB after the July 2026 duplicate cleanup) -- schedule `VACUUM FULL` or `pg_repack` in a low-traffic window. |
---
## 11. Backups and Point-in-Time Recovery
### Current state -- NOT YET RECORDED
Nothing in this repository establishes the production backup configuration.
The table below is the record to fill in -- an unrecorded row means *unknown*,
not *enabled*.
| Item                               | Value                                     |
| ---------------------------------- | ----------------------------------------- |
| Supabase plan tier                 | _Operator Action 6: not yet recorded_     |
| PITR enabled?                      | _Operator Action 6: not yet recorded_     |
| PITR retention window              | _Operator Action 6: not yet recorded_     |
| Daily physical backups enabled?    | _Operator Action 6: not yet recorded_     |
| Daily backup retention             | _Operator Action 6: not yet recorded_     |
| Date of last **tested** restore    | _Operator Action 6: not yet recorded_     |
| Scratch project used for the test  | _Operator Action 6: not yet recorded_     |
PITR is a paid add-on and is not available on every plan, so "is PITR on?" and
"which plan are we on?" are one question. Confirm both in the Supabase
Dashboard under **Project Settings > Database > Backups** and write the answers
into the table above in the same change.
**Do this before the first data backfill or dedupe migration** (Operator
Action 6). The migrations that rewrite rows in place -- the gamification
backfill `20260920002501_backfill_server_derived_gamification.sql`, the
goal-target halving `20260920003000_user_goals_per_cable_targets.sql`, the
personal-records dedupe in `20260920005700_personal_records_source_identity.sql`
-- have no automatic rollback.
### Restore procedure
Restores are performed from the Supabase Dashboard, not from this repo, and
which path applies depends on what is enabled.
**If PITR is enabled**
1. Dashboard > **Database > Backups > Point in Time**.
2. Pick the target timestamp. Everything written after it is lost.
3. **Restore into a new (scratch) project first** whenever the goal is to
   recover specific rows. Restoring over production is destructive and takes the
   project offline.
4. Copy the rows you need out of the scratch project, then delete it.
**If only daily physical backups are enabled**
1. Dashboard > **Database > Backups > Scheduled backups**.
2. The recovery point is the backup timestamp -- up to 24 hours of writes are
   lost. There is no finer granularity.
3. The same "restore into a scratch project first" rule applies.
**After any restore of production itself**
- Re-check the cron jobs: `SELECT jobname, schedule, active FROM cron.job;`.
  A restore brings back whatever `active` flags existed at the restore point,
  including a `delete-due-accounts` that was active.
- Re-check the Vault secrets exist (`edge_cron_secret`, `project_url`). Edge
  Function secrets are **not** part of a database restore.
- Re-run the daily health-check queries in [§7](#7-monitoring-quick-reference).
- Re-verify sync end to end with one real device. A restore rewinds
  `updated_at`, and `mobile-sync-pull` is a delta on `lastSync`, so a device
  whose watermark is ahead of the restore point will not be served the rows it
  is missing until it forces a full `lastSync=0` pull.
### Test restore (Operator Action 6)
1. Restore the most recent backup or PITR point into a **new scratch project**.
2. Confirm the restore actually contains data:
   `SELECT count(*) FROM public.workout_sessions;` and
   `SELECT count(*) FROM auth.users;` against the scratch project.
3. Record the date, the plan tier and the recovery point in the table above.
4. Delete the scratch project.
---
## 12. Paddle Environment Cutover
Paddle configuration is split across **four** groups that switch
**independently**. Getting them out of step is the failure this checklist
exists to prevent: checkout then succeeds against one environment while the
webhook and price mapping expect the other, and a paying customer lands on no
tier at all.
**The trap, stated plainly:**
- The client treats only the exact string `sandbox` as sandbox
  (`src/lib/paddle-client.ts:148-153`). Empty or unset means **production**.
- Server functions default `PADDLE_ENVIRONMENT` to `"production"` when unset
  (for example `paddle-cancel-subscription/index.ts:90`,
  `delete-account/index.ts:16`).
So "I didn't set it" means production on both sides, and nothing warns you.
### The four groups
Names only. Never record a value in this repo or in a ticket; a value that must
be shown in an example is written `[REDACTED]`.
| Group                     | Where it is set                        | Variables                                                                                                                                                                       | Notes                                                                                             |
| ------------------------- | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| 1. Client (build-time)    | Cloudflare dashboard (build env vars)  | `VITE_PADDLE_CLIENT_TOKEN`, `VITE_PADDLE_ENVIRONMENT`                                                                                                                              | Baked into the bundle. A change needs a **rebuild and redeploy**, not just an env edit.             |
| 2. Client price IDs (6)   | Cloudflare dashboard (build env vars)  | `VITE_PADDLE_{EMBER,FLAME,INFERNO}_{MONTHLY,ANNUAL}_PRICE_ID`                                                                                                                      | Read by `src/lib/pricing.ts` -- the single source of truth for what checkout opens.                 |
| 3. Server env             | Supabase Edge Function secrets         | `PADDLE_ENVIRONMENT`, `PADDLE_API_KEY`, `PADDLE_WEBHOOK_SECRET`, `PADDLE_CUSTOM_DATA_SECRET`                                                                                       | The first three are environment-specific -- a sandbox API key cannot read production subscriptions. `PADDLE_CUSTOM_DATA_SECRET` is **not** a Paddle credential (see below). |
| 4. Server price IDs       | Supabase Edge Function secrets         | 3 comma-separated lists `PADDLE_{EMBER,FLAME,INFERNO}_PRICE_IDS`, **plus** the 6 singles `PADDLE_{EMBER,FLAME,INFERNO}_{MONTHLY,ANNUAL}_PRICE_ID`                                   | `_shared/paddlePriceIds.ts` unions the list and the two singles per tier. See the note below.        |
**On the 6 server singles.** `getPaddlePriceIdSets` merges
`PADDLE_<TIER>_PRICE_IDS` with `PADDLE_<TIER>_MONTHLY_PRICE_ID` and
`PADDLE_<TIER>_ANNUAL_PRICE_ID`, so tier mapping works with either shape. The
singles are separately required by
`getConfiguredPriceIdForTierInterval`, whose only caller is
`paddle-update-subscription/index.ts:116` -- **a plan change to a
tier/interval whose single is unset fails there even though webhooks map that
price correctly.** Set both shapes.
**On `PADDLE_CUSTOM_DATA_SECRET`.** This one is **self-issued**, not obtained
from Paddle: `paddle-checkout-custom-data` HMACs the user id with it
(`hmacSha256Hex(secret, user.id)`) and `paddle-webhooks` and
`paddle-refresh-subscription` verify that signature. Do not go looking for it
in the Paddle dashboard, and do not change it during a cutover -- signer and
verifiers must share one value, and rotating it invalidates checkouts that are
already open.
**Where groups 1 and 2 actually live.** `wrangler.toml` states that the
production build runs in Cloudflare Workers Builds (`npx wrangler deploy`,
auto-triggered on push to `main` by the Cloudflare GitHub integration) and that
the `VITE_*` variables are set in the Cloudflare dashboard, not in
`wrangler.toml`. There is **no SPA deploy workflow in `.github/workflows/`** --
`ci.yml` only runs `npm run build` as a check. If that ever changes, the
variables move with the build and this row must be updated.
Never use a `VITE_*` variable server-side (`_shared/paddlePriceIds.ts:4`).
### Cutover checklist
Perform in this order. Steps 1-4 can be done ahead of time; step 5 is the
switch.
1. In the Paddle dashboard for the **target** environment, collect the 6 price
   IDs (3 tiers x monthly/annual), the client-side token, the API key and the
   webhook signing secret.
2. Point the Paddle webhook destination for the target environment at
   `https://<project-ref>.supabase.co/functions/v1/paddle-webhooks` and
   subscribe it to the same events as the environment you are leaving.
3. Set group 3 and group 4 on Supabase (`supabase secrets set …`). Confirm the
   names are present with `supabase secrets list` -- it lists names, not values.
4. Set groups 1 and 2 in the Cloudflare dashboard's build environment
   variables.
5. **Rebuild and redeploy the SPA.** `VITE_*` values are embedded at build time,
   so until a new build ships the client is still on the old environment
   regardless of what the dashboard shows.
6. Run the smoke test below before announcing the cutover.
### `PADDLE_API_KEY` is a hard dependency of `paddle-webhooks` (PR 44)
Before PR 44, `paddle-webhooks` never called the Paddle API, so `PADDLE_API_KEY`
was only needed by the update/cancel/refresh functions. It now lists the
customer's subscriptions when the tracked one is cancelled, and a listing
failure **deliberately fails closed** -- it logs
`[BILLING_ALERT] untracked_subscription_lookup_failed` and returns 500 so Paddle
redelivers, rather than downgrading a customer who may still be paying.
**Consequence: with `PADDLE_API_KEY` missing or wrong for `paddle-webhooks`,
every cancellation delivery 500s and Paddle retries it, and no cancellation is
recorded.** Before deploying `paddle-webhooks`, confirm the key is set and that
it belongs to the same Paddle environment as `PADDLE_ENVIRONMENT`.
### Smoke test
You cannot read Edge secret values back, so the comparison is structural,
log-based and functional -- in that order.
**(a) Structural.** For each of the 6 client price IDs, confirm it appears in
exactly one server tier, and that the tier matches:
- Take each `VITE_PADDLE_<TIER>_<INTERVAL>_PRICE_ID` value from the Cloudflare
  environment.
- Confirm the same value is in `PADDLE_<TIER>_PRICE_IDS` (or is the matching
  `PADDLE_<TIER>_<INTERVAL>_PRICE_ID`) for the **same** tier.
- Confirm no price ID appears under two tiers. `mapPriceIdToTier` resolves such
  a collision by fixed precedence (INFERNO > FLAME > EMBER), which silently maps
  customers to the wrong tier.
**(b) Log-based.** Trigger one call to `paddle-webhooks`,
`paddle-update-subscription` or `paddle-refresh-subscription` -- the three that
validate the price-ID configuration on entry -- and read that function's logs.
Both of these are fatal configuration errors and each returns 500:
| Log line                                                                                                  | Cause                                             |
| ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `[FATAL] PADDLE_EMBER_PRICE_IDS, PADDLE_FLAME_PRICE_IDS, and PADDLE_INFERNO_PRICE_IDS must all be set`      | No paid price ID is configured at all.              |
| `[FATAL] Paddle price ID configured under multiple tiers (would map to wrong tier by precedence): [...]`    | A price ID was copied into more than one tier list. |
**(c) Functional.** In sandbox, or with a real card in production if policy
allows, run one checkout per tier and confirm the tier lands:
SELECT user_id, tier, status, paddle_subscription_id, current_period_end
FROM public.subscriptions
WHERE user_id = '<test user id>';
A checkout that completes while `subscriptions.tier` stays `FREE` is exactly the
client/server mismatch this section exists to catch: the webhook arrived but
`mapPriceIdToTier` did not recognise the price ID.
See also [paddle-simulation-testing.md](paddle-simulation-testing.md) for
webhook simulation, and [billing-incident-response.md](billing-incident-response.md)
for what to do when a paying customer has the wrong tier.
---
## 13. Rotating the Shared Cron Secret
Rotate on the usual triggers: a suspected leak, an operator offboarding, or a
scheduled rotation. The value is generated **inside the database** and moved to
the Edge secret store without ever appearing in the SQL editor, a shell history
entry, or a file on disk.
1. Generate and store the new value in Vault. This prints nothing:
   ```sql
   SELECT vault.update_secret(
     (SELECT id FROM vault.secrets WHERE name = 'edge_cron_secret'),
     encode(extensions.gen_random_bytes(32), 'hex')
   );
   ```
2. Read it once and pipe it straight into the Edge secret store. The Supabase
   CLI has no stdin mode for this -- `supabase secrets set` takes either
   `NAME=VALUE` arguments (which land in shell history) or `--env-file <path>`
   (verified against CLI 2.117.0 `secrets set --help`). Use process
   substitution so the path is a pipe and the value never touches disk:
   ```bash
   supabase secrets set --env-file \
     <(printf 'CRON_SECRET=%s\n' \
       "$(psql "$PROD_DB_URL" -Atc \
          "select decrypted_secret from vault.decrypted_secrets where name='edge_cron_secret'")")
   ```
   This needs a POSIX shell with process substitution (bash or zsh). If you only
   have a shell without it, write the env file to a RAM-backed path, run
   `supabase secrets set --env-file <path>`, and delete it immediately -- and if
   it ever lands in a backed-up or cloud-synced folder, treat the secret as
   compromised and rotate again.
   Never render the value in the dashboard at all. The SQL editor saves the
   query text and displays the result on screen, so a `SELECT decrypted_secret`
   there puts the secret somewhere you cannot reliably clear.
3. Confirm the next scheduled pass is not 401:
   ```sql
   SELECT id, status_code, timed_out, error_msg, created
   FROM net._http_response
   ORDER BY created DESC
   LIMIT 20;
   ```
   Non-401 on the next `process-sync-queue` pass (within 5 minutes) is the
   check. `generate-insights` confirms within 15 minutes;
   `delete-due-accounts` only if it is active.
**The gap between steps 1 and 2 is a 401 window, and it is self-healing.** Jobs
firing in that window are rejected by the receiver's own `x-cron-secret`
comparison (`_shared/cronSecret.ts`) -- not by the gateway, which is not
checking JWTs for these functions -- and simply run again on their next tick:
`process-sync-queue` rows stay `pending`, `delete-due-accounts` rows
stay `pending` (nothing is deleted), and `generate-insights` leaves the batch
cursor where it was. Keep the window short anyway.
Once `CRON_SECRET` is set, the legacy names `PROCESS_SYNC_QUEUE_SECRET` and
`CRON_SYNC_QUEUE_SECRET` are dead -- they are only consulted when `CRON_SECRET`
is unset. Rotating `CRON_SECRET` does not require touching them; leaving stale
copies in the secret store is untidy but not a bypass.
---
## 14. Migration Pre-Apply Checks and Audits
Some migrations in this series require a **read-only** check first, or ship an
audit to run afterwards. Running these before opening a push window is the point
-- discovering them mid-push is the failure mode.
| Migration / PR                                             | What to run, and when                                                                                                                                                                                   |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `20260920007600_reconcile_prod_schema_drift.sql` (PR 76)   | **Required read-only pre-apply check.** Full procedure and outcome table in §9 of this runbook (added by PR 76). It decides whether the push takes an ACCESS EXCLUSIVE lock, and therefore whether it needs a maintenance window. It must be applied with or before any replay of `20260920000100_lockdown_definer_function_grants.sql` -- only 007600's allow-list contains `public.request_account_deletion()`. |
| `20260920002500_server_derived_gamification.sql` + `20260920002501_backfill_server_derived_gamification.sql` (PR 25) | **Required read-only preview** (query in the header of `20260920002501…`; it needs `002500` applied and changes nothing). Read out `rows_changing` as the blast radius and `best_streak_dropping` as the only number a user can read as a loss. Apply **both** migrations before deploying `mobile-sync-push` and `mobile-sync-pull` -- Edge-first is a total sync outage, not a degraded window. |
| `20260920004400_apply_subscription_event_subscription_guard.sql` (PR 44) | **This migration aborts by design** if production already binds one Paddle subscription to more than one portal user; its pre-check RAISEs and names every offender. That is intended -- silently picking a winner would assign someone's paid subscription to the wrong account. Run the "OPERATOR PREVIEW" query from the migration header read-only first (zero rows means it applies cleanly), decide the true owner of each named subscription, and clear `paddle_subscription_id` on the losing row(s) before pushing. |
| `20260920003000_user_goals_per_cable_targets.sql` (PR 30)  | Apply **before** the PR 30 SPA deploy, then run the post-deploy audit in the migration header -- and read the three divergences below before acting on its output.                                        |
| `20260920003500_due_deletion_cron.sql` (PR 35)             | Apply, deploy `delete-account`, then review the overdue preview before activating the job -- [§10.2](#102-activating-delete-due-accounts-irreversible).                                                    |
| `20260925200000_set_telemetry_storage.sql` (F-015 / F-037) | DDL only: `rep_telemetry` is renamed `rep_telemetry_legacy` and a per-sample view takes its name, so readers see the same rows immediately. **After** applying, fold the legacy rows as the owner, one chunk at a time: `SELECT * FROM private.backfill_set_telemetry(NULL, 500);` then repeat with the returned `last_set_id` until `folded_sets = 0` and `last_set_id` is NULL. Each call is short and idempotent; stop and resume at any time. Verify with `SELECT count(*) FROM public.rep_telemetry_legacy l WHERE NOT EXISTS (SELECT 1 FROM public.set_telemetry t WHERE t.set_id = l.set_id);` (expect 0). Legacy rows are never deleted by this migration or the backfill; dropping `rep_telemetry_legacy` is a later, separate migration once that count is 0 and spot checks of `rep_telemetry` match. Sample ids stay globally unique through `set_telemetry_sample_ids`, a trigger-maintained index that every writer (the backfill included) fills automatically; a duplicate id is a 23505, never two copies. |
### The PR 30 goals audit has three known divergences from the app
After deploying PR 30, the audit query in the migration header finds PR goals
marked completed against an inflated target. It mirrors the app's
`computePrGoalProgress` on record types (uppercase `MAX_WEIGHT` / `1RM`, never
`MAX_VOLUME`), on `deleted_at IS NULL` and on units -- but it is **close, not
exact**. Treat its output as a candidate list to review, never a list to reopen
blindly:
| # | Divergence                                                                                                                                             | Effect         |
| - | -------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| 1 | The goal has an `exercise_id` and the matching record has `exercise_id IS NULL`. The app falls back to a name match per record; the SQL does not.        | False positive |
| 2 | The app compares the **catalog-resolved** display name (`resolvePersonalRecordDisplayNames`); the SQL compares the raw `pr.exercise_name`, so a record stored under an opaque id is flagged. | False positive |
| 3 | The app narrows records by `local_profile_id` when a profile filter is active; the SQL does not, so a completion justified only by another profile's record is missed. | False negative |
Both false-positive classes self-heal -- the Goals page re-completes anything
back at 100%. Reopening a goal is the operator's call; the app deliberately has
no reopen path, because auto-reopening would let a records edit un-achieve a
goal.
---

## Related Runbooks

- [Billing Incident Response](billing-incident-response.md) -- manual fixes,
  reconciliation, refunds, and escalation paths
- [Paddle Simulation Testing](paddle-simulation-testing.md) -- webhook
  simulation setup and regression test scenarios
