# Phoenix Portal Operational Runbook

> Last updated: 2026-03-18
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

| Log message                                     | Meaning                                           | Severity                                 |
| ----------------------------------------------- | ------------------------------------------------- | ---------------------------------------- |
| `Missing custom_data.user_id in Paddle event`   | Checkout created without `user_id` in custom_data | HIGH -- user pays but gets no access     |
| `Unknown price ID mapped to FREE tier`          | Price ID not in `PADDLE_*_PRICE_IDS` env vars     | HIGH -- silent tier mismatch             |
| `Error upserting subscription for <event_type>` | Database write failed                             | MEDIUM -- Paddle retries on 5xx          |
| `Webhook signature too old`                     | Signature age > 5 minutes                         | LOW -- replay protection, retry will fix |
| `Unhandled event type: <type>`                  | Non-subscription event (normal)                   | NONE                                     |

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
-- Clear the idempotency marker to allow reprocessing
UPDATE subscriptions
SET last_event_id = NULL
WHERE user_id = '<uuid>';
```

Then retry the notification.

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

### When to use

Use this procedure only if the `delete-account` Edge Function fails **and**
cannot be fixed quickly. The Edge Function is the preferred path because it
handles storage cleanup and uses `auth.admin.deleteUser()` which CASCADE-deletes
most user data automatically.

**Before proceeding:** Check Edge Function logs to understand why it failed.

```bash
supabase functions logs delete-account --project-ref $SUPABASE_PROJECT_REF --limit 20
```

Common failure reasons:
- Rate limit hit (1 request/hour/user) -- wait and retry.
- No pending deletion request -- check `deletion_requests` table.
- Grace period not expired -- check `scheduled_for` timestamp.
- Auth admin API failure -- proceed with manual deletion below.

### Step-by-step manual deletion

Execute these in order. The cascade from `auth.admin.deleteUser()` handles most
tables, but if that call is what failed, you need to delete data manually first.

**Step 1: Record the user's data footprint (for verification later)**

```sql
-- Save this output before deleting anything
SELECT 'profiles' AS tbl, COUNT(*) FROM profiles WHERE id = '<uuid>'
UNION ALL SELECT 'workout_sessions', COUNT(*) FROM workout_sessions WHERE user_id = '<uuid>'
UNION ALL SELECT 'exercises', COUNT(*) FROM exercises WHERE workout_id IN (SELECT id FROM workout_sessions WHERE user_id = '<uuid>')
UNION ALL SELECT 'sets', COUNT(*) FROM sets WHERE user_id = '<uuid>'
UNION ALL SELECT 'rep_summaries', COUNT(*) FROM rep_summaries WHERE user_id = '<uuid>'
UNION ALL SELECT 'rep_telemetry', COUNT(*) FROM rep_telemetry WHERE user_id = '<uuid>'
UNION ALL SELECT 'personal_records', COUNT(*) FROM personal_records WHERE user_id = '<uuid>'
UNION ALL SELECT 'exercise_progress', COUNT(*) FROM exercise_progress WHERE user_id = '<uuid>'
UNION ALL SELECT 'routines', COUNT(*) FROM routines WHERE user_id = '<uuid>'
UNION ALL SELECT 'routine_exercises', COUNT(*) FROM routine_exercises WHERE routine_id IN (SELECT id FROM routines WHERE user_id = '<uuid>')
UNION ALL SELECT 'training_cycles', COUNT(*) FROM training_cycles WHERE user_id = '<uuid>'
UNION ALL SELECT 'cycle_days', COUNT(*) FROM cycle_days WHERE training_cycle_id IN (SELECT id FROM training_cycles WHERE user_id = '<uuid>')
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
UNION ALL SELECT 'deletion_requests', COUNT(*) FROM deletion_requests WHERE user_id = '<uuid>';
```

**Step 2: Delete storage objects**

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

**Step 3: Delete dependent data (leaf tables first)**

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

-- Deletion tracking
UPDATE deletion_requests
SET status = 'executed', executed_at = NOW()
WHERE user_id = '<uuid>';
```

**Step 4: Delete the Supabase Auth user**

```bash
# Via Supabase Dashboard: Authentication > Users > find user > delete
# Or via the Admin API:
curl -X DELETE "https://<project-ref>.supabase.co/auth/v1/admin/users/<uuid>" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}"
```

**Step 5: Verify nothing was missed**

Re-run the footprint query from Step 1. All counts should be 0 (except
`deletion_requests` which should show 1 with `status = 'executed'`).

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
SUPABASE_PROJECT_REF=ilzlswmatadlnsuxatcv

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

---

## Related Runbooks

- [Billing Incident Response](billing-incident-response.md) -- manual fixes,
  reconciliation, refunds, and escalation paths
- [Paddle Simulation Testing](paddle-simulation-testing.md) -- webhook
  simulation setup and regression test scenarios
