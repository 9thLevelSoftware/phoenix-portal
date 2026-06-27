# Review: Edge Functions - Misc

Scope reviewed:
- `supabase/functions/generate-insights/index.ts`
- `supabase/functions/compute-rankings/index.ts`
- `supabase/functions/delete-account/index.ts`

Summary:
- Findings: 14
- Severity breakdown: 0 critical, 3 high, 10 medium, 1 low
- Category breakdown: 3 bug, 0 stub, 3 error, 8 failure-point

Verification:
- `deno check --node-modules-dir=auto supabase/functions/generate-insights/index.ts supabase/functions/compute-rankings/index.ts supabase/functions/delete-account/index.ts` completed successfully. Deno emitted existing React/VisX peer-dependency warnings only.

## `supabase/functions/generate-insights/index.ts`

### Finding 1
- Category: failure-point
- Severity: medium
- Line numbers: 326-363, 613-644
- Description: The handler accepts every non-OPTIONS method and defaults an unparsable or absent body to `{}`. Because this function deletes and reinserts cached `user_insights`, an authenticated GET/HEAD or malformed request can trigger a state-changing insight regeneration instead of being rejected as an invalid method/body.
- Suggested fix direction: Require `POST` before authentication or parsing, return 405 for other methods, and reject malformed JSON with 400 instead of silently replacing it with an empty object.

### Finding 2
- Category: error
- Severity: medium
- Line numbers: 334-343
- Description: `req.headers.get('Authorization')!` uses a non-null assertion without a runtime guard. If the header is missing, `null` is passed into the Supabase client headers and the request can fall into an internal/auth-client error path rather than returning the intended 401 response.
- Suggested fix direction: Check `if (!authHeader)` before creating the client and return a 401 `Missing Authorization header` response consistently with the other Edge Functions.

### Finding 3
- Category: error
- Severity: medium
- Line numbers: 443-468, 487-543
- Description: Several data queries ignore their `error` fields. Failures while fetching exercise rows, personal records, exercise progress, or streak sessions are treated as empty datasets, so the function can persist an apparently successful insight set that silently omits imbalance, PR, plateau, or streak insights.
- Suggested fix direction: Capture `{ data, error }` for every Supabase query. Log and return a 500/503 when required insight inputs cannot be fetched, or explicitly mark optional sections degraded without deleting and replacing the previous cached insights.

### Finding 4
- Category: bug
- Severity: medium
- Line numbers: 613-644
- Description: Refreshing cached insights is implemented as `delete()` followed by `insert()` outside a transaction. Concurrent requests for the same user/period can interleave so one request deletes rows inserted by another, and an insert failure after delete leaves the cache empty.
- Suggested fix direction: Move the refresh into a database RPC/transaction, or upsert rows under a stable unique key and remove stale rows only after the replacement set has been written successfully.

### Finding 5
- Category: failure-point
- Severity: low
- Line numbers: 548-565
- Description: Current streak calculation compares `started_at.slice(0, 10)` and `now.toISOString().slice(0, 10)`, which are UTC calendar days. Users training near local midnight can have sessions counted on the wrong local day, breaking current streak milestones and achievement insights.
- Suggested fix direction: Store or derive the user's timezone and compute workout-day keys in that timezone, or define explicitly that streaks are UTC-based and align the client UI to the same rule.

## `supabase/functions/compute-rankings/index.ts`

### Finding 6
- Category: failure-point
- Severity: medium
- Line numbers: 222-239, 263-370, 386-499, 517-663
- Description: Ranking endpoints have no rate limit even though they run service-role queries across all leaderboard participants and call aggregate RPCs. A subscribed client can repeatedly request global, weekly, or arbitrary user rankings and force expensive scans/aggregations.
- Suggested fix direction: Apply `checkRateLimit` per user and request type, cache global/weekly results for short intervals, and consider precomputing leaderboard snapshots instead of recomputing full rankings on every request.

### Finding 7
- Category: failure-point
- Severity: medium
- Line numbers: 89-98, 230-231
- Description: `weekStart` is accepted directly from the request and converted with `new Date(weekStart)` before calling `toISOString()`. Invalid strings throw a `RangeError` and return a generic 500, while arbitrary valid dates can request unbounded historical/future weekly windows.
- Suggested fix direction: Validate `weekStart` as an ISO `YYYY-MM-DD` date, reject invalid dates with 400, normalize to that week’s Monday, and clamp requests to an allowed historical/future range.

### Finding 8
- Category: error
- Severity: medium
- Line numbers: 414-499, 521-646
- Description: Many weekly and user-ranking queries drop the `error` field from Supabase responses. Profile, session, PR, gamification stats, user PR rank, and exercise mastery failures can all be converted into empty maps or zero values, returning misleading rankings with HTTP 200.
- Suggested fix direction: Capture and handle errors for every query/RPC. Return a 5xx response for infrastructure/schema failures instead of producing partial leaderboards that look authoritative.

### Finding 9
- Category: bug
- Severity: medium
- Line numbers: 410-499
- Description: Special event metrics from `leaderboard_events.metric` are not validated against the metrics implemented by the TypeScript switch. If an active event is configured with an unsupported metric, the function still returns the event metadata but leaves `entries` empty, making the competition appear to have no participants.
- Suggested fix direction: Validate event metrics against an allowlist before accepting them, or add an explicit default branch that logs and returns a configuration error instead of silently returning an empty leaderboard.

## `supabase/functions/delete-account/index.ts`

### Finding 10
- Category: failure-point
- Severity: high
- Line numbers: 46-56, 149-209
- Description: The destructive account-deletion handler has no method guard. Any authenticated non-OPTIONS request can execute the deletion flow once the grace period has expired, which is inconsistent with `compute-rankings` and increases the blast radius of accidental invocation or unexpected client/proxy behavior.
- Suggested fix direction: Require a deliberate method such as `POST` or `DELETE`, return 405 for all other methods, and consider requiring a confirmation token/body value tied to the pending deletion request.

### Finding 11
- Category: failure-point
- Severity: high
- Line numbers: 112-125
- Description: Avatar storage cleanup is treated as non-critical and both list/remove errors are allowed to continue. The `remove()` result is also not checked. A failed storage delete can therefore leave user-owned avatar objects behind after the auth user and database rows are deleted, undermining account-erasure expectations.
- Suggested fix direction: Check both `.list()` and `.remove()` errors. Either fail and retry before deleting the auth user, or enqueue durable storage-cleanup work with enough metadata to remove the objects after the database row is gone.

### Finding 12
- Category: failure-point
- Severity: high
- Line numbers: 130-139, 173-204
- Description: Paddle cancellation happens only after `auth.admin.deleteUser(userId)` succeeds, and failures are only logged plus returned as `billingCancellationPending`. Because the subscription row is cascade-deleted with the user and no retry job is persisted, a transient Paddle/API failure can leave a paid subscription active with no durable in-app record to retry from.
- Suggested fix direction: Cancel or schedule cancellation before deleting the auth user, or persist a service-owned billing-cancellation job/audit row outside the user cascade path before the auth delete. Retry failures asynchronously until Paddle confirms cancellation.

### Finding 13
- Category: failure-point
- Severity: medium
- Line numbers: 22-33, 188-204
- Description: The Paddle cancellation fetch has no explicit timeout or abort signal. If Paddle stalls, the Edge Function can sit until the platform timeout after the auth user is already deleted, increasing the chance of an ambiguous deletion response and uncancelled billing.
- Suggested fix direction: Wrap the Paddle request in an `AbortController` timeout and treat timeout as a durable retry condition before or alongside the billing follow-up record.

### Finding 14
- Category: bug
- Severity: medium
- Line numbers: 74-107, 141-163
- Description: The one-per-hour rate limit is consumed before validating that a pending deletion request exists, that the grace period has expired, that Paddle is configured, or that the deletion request can be marked executed. A user or client that calls too early or hits a transient configuration/database error can be blocked from retrying the real deletion for an hour.
- Suggested fix direction: Move rate limiting after cheap eligibility/configuration checks, or use separate rate-limit keys for validation failures versus the actual destructive execution path so legitimate retries are not throttled by precondition failures.
