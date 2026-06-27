# Edge Functions - Integrations Review

Scope reviewed:
- `supabase/functions/initiate-oauth/index.ts`
- `supabase/functions/strava-oauth/index.ts`
- `supabase/functions/strava-sync/index.ts`
- `supabase/functions/garmin-oauth/index.ts`
- `supabase/functions/garmin-webhook/index.ts`
- `supabase/functions/fitbit-oauth/index.ts`
- `supabase/functions/fitbit-sync/index.ts`
- `supabase/functions/hevy-sync/index.ts`
- `supabase/functions/liftosaur-sync/index.ts`
- `supabase/functions/disconnect-integration/index.ts`
- `supabase/functions/_shared/garminIdentity.ts`

Verification performed:
- Read all 11 assigned files.
- Searched assigned Edge Function area for TODO/FIXME/HACK/stub/placeholder/untested markers.
- Ran `deno check --node-modules-dir=auto` against the assigned files. It failed with type errors in `fitbit-sync`, `hevy-sync`, and `liftosaur-sync`; details are captured below.

Summary:
- Findings: 33
- Severity breakdown: critical 3, high 10, medium 16, low 4

---

## `supabase/functions/initiate-oauth/index.ts`

### Finding 1
- Category: failure-point
- Severity: medium
- Line numbers: 82-87
- Description: The `oauth_states` insert result is not checked. If the insert fails because of RLS, schema drift, database outage, or a uniqueness issue, the function still returns a provider authorization URL containing a state token that was never persisted. The callback will later fail as `invalid_state`, which makes the real cause difficult to diagnose and forces the user through a broken OAuth flow.
- Suggested fix direction: Capture `{ error }` from the insert and return a 500/structured error before building or returning the provider authorization URL when state persistence fails.

### Finding 2
- Category: failure-point
- Severity: medium
- Line numbers: 92-117
- Description: Provider client IDs and the public Supabase URL are assumed to exist. If `STRAVA_CLIENT_ID`, `FITBIT_CLIENT_ID`, `SUPABASE_PUBLIC_URL`, or `SUPABASE_URL` are missing/misconfigured, the function can return malformed authorization URLs such as `client_id=undefined` or a callback rooted at an invalid URL. The state row has already been inserted, so users receive a broken redirect rather than a clear configuration error.
- Suggested fix direction: Validate all provider-specific environment variables before inserting state or returning the URL. Return a clear 503/configuration error if required OAuth configuration is missing.

---

## `supabase/functions/strava-oauth/index.ts`

### Finding 3
- Category: failure-point
- Severity: medium
- Line numbers: 106-112
- Description: The Strava token response shape is trusted without validation. `tokens.athlete.id`, `tokens.access_token`, `tokens.refresh_token`, and `tokens.expires_at` are dereferenced directly. A malformed or partial response can throw after the OAuth state has been consumed, or can attempt to encrypt/store undefined token fields.
- Suggested fix direction: Validate the token response schema before using it. If required fields are absent or have unexpected types, log the upstream response status/body safely and redirect with a specific token payload error.

---

## `supabase/functions/strava-sync/index.ts`

### Finding 4
- Category: bug
- Severity: high
- Line numbers: 213-233
- Description: Strava refresh token rotation is persisted without checking the update result. Strava can rotate refresh tokens on every refresh; if the database update at lines 224-233 fails, the invocation continues with the new in-memory access token but the old refresh token remains stored. The next sync may then be unable to refresh and the integration can become permanently token-expired.
- Suggested fix direction: Capture and handle the token update error. If persistence fails after a successful refresh, mark the integration error/token_expired and fail the sync instead of continuing with an unpersisted rotated token.

### Finding 5
- Category: bug
- Severity: high
- Line numbers: 296-345
- Description: Per-activity upsert failures are collected in `errors`, but `last_sync_at` is still advanced and the sync queue entry is marked `completed_with_errors`/`completed`. On the next incremental sync, the function uses `last_sync_at` as the `after` cutoff, so activities that failed to persist in this run can be skipped permanently.
- Suggested fix direction: Do not advance `last_sync_at` past failed records. Either fail/retry the sync when any upsert fails, or track a safe high-water mark based only on successfully persisted activity timestamps.

---

## `supabase/functions/garmin-oauth/index.ts`

### Finding 6
- Category: stub
- Severity: low
- Line numbers: 23-24
- Description: The file explicitly states the Garmin Edge Function is "ready but untested until credentials are available." This is an unresolved integration risk for a production OAuth path.
- Suggested fix direction: Track this as an integration validation task and remove the note only after real Garmin OAuth credentials have exercised both request-token and access-token exchanges.

### Finding 7
- Category: failure-point
- Severity: medium
- Line numbers: 141-176
- Description: The CSRF state token is deleted before the Garmin request-token call succeeds. A transient Garmin/API/network failure after line 142 invalidates the user's OAuth start state, and the callback cannot be retried without beginning the whole flow again.
- Suggested fix direction: Consume the state only after successfully storing the request token, or mark it as in-progress with a short TTL so transient provider failures do not strand the flow.

### Finding 8
- Category: error
- Severity: high
- Line numbers: 184-190
- Description: The temporary Garmin OAuth request token and request token secret are stored directly in `oauth_tokens.access_token` and `oauth_tokens.refresh_token` without encryption. This bypasses the encrypted-token pattern used for permanent OAuth secrets and exposes sensitive OAuth material if the server-only table is logged, dumped, or queried by an over-privileged path.
- Suggested fix direction: Encrypt temporary request tokens/secrets before storage, or use a dedicated short-lived encrypted pending OAuth table with TTL cleanup.

### Finding 9
- Category: failure-point
- Severity: high
- Line numbers: 185-206, 278-301
- Description: All Garmin token/integration upserts ignore their returned errors. The function can redirect the user to Garmin without a stored pending token, or later redirect `connected=garmin` even if permanent tokens or `user_integrations` failed to persist.
- Suggested fix direction: Check every Supabase write. Abort with a provider-specific error redirect if any pending-token, permanent-token, or integration-state write fails.

---

## `supabase/functions/garmin-webhook/index.ts`

### Finding 10
- Category: stub
- Severity: low
- Line numbers: 20-21
- Description: The webhook handler states it is "ready but untested until webhook registration is complete." This is an unresolved production risk for the only Garmin sync path, since Garmin sync is webhook-driven.
- Suggested fix direction: Add a validation task with Garmin webhook registration and fixture replay. Remove the note after the registered webhook is proven end-to-end.

### Finding 11
- Category: bug
- Severity: high
- Line numbers: 85-88
- Description: `started_at` is calculated as `(startTimeInSeconds + startTimeOffsetInSeconds) * 1000`. Garmin's `startTimeInSeconds` is already an epoch timestamp; the offset describes local timezone offset. Adding it stores local wall-clock time as UTC and shifts activities by hours for non-UTC users.
- Suggested fix direction: Store `new Date(activity.startTimeInSeconds * 1000).toISOString()` for the absolute event time. Preserve `startTimeOffsetInSeconds` in `raw_data` or a separate timezone field if local display is needed.

### Finding 12
- Category: bug
- Severity: medium
- Line numbers: 171-172
- Description: The handler uses `payload.activities ?? payload.activityDetails ?? []`. If Garmin sends both arrays, `activityDetails` is ignored entirely whenever `activities` exists, potentially dropping detailed records configured for delivery.
- Suggested fix direction: Merge and de-duplicate both arrays by `activityId`, or explicitly prefer details while falling back to summaries for IDs without details.

### Finding 13
- Category: failure-point
- Severity: low
- Line numbers: 289-294
- Description: The per-user `last_sync_at` update is awaited but its error is ignored. A failed timestamp update leaves the persisted integration stale while the webhook response still reports success.
- Suggested fix direction: Capture the update error. Treat it as a persistence failure and return a retryable 5xx, or at least include it in the error count and logs.

---

## `supabase/functions/fitbit-oauth/index.ts`

### Finding 14
- Category: failure-point
- Severity: medium
- Line numbers: 70-93
- Description: The OAuth state token is deleted before the Fitbit token exchange succeeds. A transient Fitbit failure consumes the state and forces the user to restart the OAuth flow, even though the callback request could otherwise be retried.
- Suggested fix direction: Consume the state only after token exchange and token persistence succeed, or mark it as used in a transaction-like flow with a retry-safe intermediate status.

### Finding 15
- Category: failure-point
- Severity: medium
- Line numbers: 96-100
- Description: The Fitbit token response is trusted without validating `access_token`, `refresh_token`, `user_id`, and `expires_in`. Missing or malformed fields can produce invalid expiry timestamps or attempt to encrypt undefined secrets.
- Suggested fix direction: Validate the response schema and reject/redirect with a specific token payload error when required fields are absent or invalid.

### Finding 16
- Category: failure-point
- Severity: low
- Line numbers: 138-144
- Description: The initial `sync_queue` insert result is ignored. If queueing fails, the function still redirects as successfully connected, but no initial sync will run.
- Suggested fix direction: Capture the queue insert error and either surface a non-fatal warning in integration state or redirect with a partial-success status that prompts manual sync.

---

## `supabase/functions/fitbit-sync/index.ts`

### Finding 17
- Category: error
- Severity: critical
- Line numbers: 20-24, 139-159, 261, 294, 354, 373-377
- Description: `deno check --node-modules-dir=auto` fails for this file. The helper signatures using `ReturnType<typeof createClient>` collapse table types to `never`, producing errors on `.update()`, `.insert()`, and calls that pass the real Supabase client into those helpers. The catch block also accesses `err.message` while `err` is `unknown`. A type-checking deployment gate would reject this function.
- Suggested fix direction: Use the concrete Supabase client type expected by the project, a local structural type for the subset of methods used, or loosen helper parameters to the actual inferred client type. Narrow catch values with `err instanceof Error ? err.message : String(err)`.

### Finding 18
- Category: bug
- Severity: high
- Line numbers: 62-75
- Description: Fitbit refresh token persistence is not checked. Fitbit refresh responses can rotate refresh tokens; if the database update fails, the function continues and returns the new tokens in memory while the old stored refresh token remains. Future syncs may then fail refresh and mark the integration expired.
- Suggested fix direction: Capture the token update error and fail the sync if the rotated tokens cannot be persisted. Mark integration state accordingly.

### Finding 19
- Category: bug
- Severity: high
- Line numbers: 239-246
- Description: The function fetches `user_integrations.last_sync_at` and `status` but never checks that the integration status is `connected`. If a token row still exists after an error/disconnect state, the sync can continue importing data for an integration that the application considers inactive.
- Suggested fix direction: Require `integration?.status === 'connected'` before syncing, matching the Strava path. Return 404/409 when the integration is absent or not connected.

---

## `supabase/functions/hevy-sync/index.ts`

### Finding 20
- Category: error
- Severity: critical
- Line numbers: 200-218, 284-288
- Description: `deno check --node-modules-dir=auto` fails because `fetchError.message` and `err.message` are accessed while catch variables are `unknown`. A type-checking deployment gate would reject this function.
- Suggested fix direction: Narrow catch values before reading `.message`, for example `const message = fetchError instanceof Error ? fetchError.message : String(fetchError)`.

### Finding 21
- Category: failure-point
- Severity: medium
- Line numbers: 124-135
- Description: After successfully storing a Hevy API key, the `user_integrations` upsert result is ignored. A database failure can leave the encrypted API key stored while the integration row remains absent/stale, causing confusing UI state and later sync behavior.
- Suggested fix direction: Capture and handle the integration upsert error. If the state update fails, return an error or roll back/delete the newly stored key.

### Finding 22
- Category: bug
- Severity: medium
- Line numbers: 161-199
- Description: The Hevy sync fetches only `${HEVY_API_BASE}/workouts` once and does not implement pagination or date-window traversal. If the API returns a default page, older workouts are silently omitted while the function reports success.
- Suggested fix direction: Follow the Hevy API pagination contract, requesting all pages until exhaustion or a safe cursor/date cutoff. Report truncation if the API cannot provide all workouts.

### Finding 23
- Category: bug
- Severity: high
- Line numbers: 221-259, 261-272
- Description: Per-workout upsert errors are silently swallowed. `importedCount` is incremented only on success, but failures are not logged, returned, or used to fail the sync. The function then updates `last_sync_at` and marks pending queue entries completed, creating silent data loss.
- Suggested fix direction: Collect and log upsert errors. Fail or complete-with-errors without advancing `last_sync_at` past failed records, and keep/retry the sync queue entry when persistence fails.

---

## `supabase/functions/liftosaur-sync/index.ts`

### Finding 24
- Category: error
- Severity: critical
- Line numbers: 259-279, 354-359
- Description: `deno check --node-modules-dir=auto` fails because `fetchError.message` and `err.message` are accessed while catch variables are `unknown`. A type-checking deployment gate would reject this function.
- Suggested fix direction: Narrow catch values before reading `.message`, using an `instanceof Error` guard or a shared error-to-message helper.

### Finding 25
- Category: failure-point
- Severity: medium
- Line numbers: 164-173
- Description: After successfully storing a Liftosaur API key, the `user_integrations` upsert result is ignored. A failed integration-state write can leave credentials stored with no corresponding connected row.
- Suggested fix direction: Capture and handle the upsert error. Return a storage error or roll back the stored API key if the visible integration state cannot be persisted.

### Finding 26
- Category: bug
- Severity: medium
- Line numbers: 199-258
- Description: Pagination has a hard `MAX_PAGES = 10` safety cap, but if `hasMore` is still true at page 10 the function silently stops and reports success. Users with more than 2,000 records can have history truncated without any error or retry path.
- Suggested fix direction: If the page cap is reached while `hasMore` remains true, return a partial/truncated status and avoid advancing sync state as if complete. Prefer a cursor checkpoint so the next sync continues from `nextCursor`.

### Finding 27
- Category: bug
- Severity: medium
- Line numbers: 294-296
- Description: When Liftoscript timestamp parsing fails, `started_at` falls back to `new Date().toISOString()`. Because upserts use the same external ID, each later sync can overwrite the activity with the current sync time, corrupting historical ordering.
- Suggested fix direction: Treat missing/unparseable timestamps as a record-level validation error, or store a stable fallback derived from provider metadata rather than the current time.

### Finding 28
- Category: bug
- Severity: high
- Line numbers: 282-329, 331-342
- Description: Per-record upsert errors are ignored. The function only increments `importedCount` on success, but still updates `last_sync_at`, sets status `connected`, and marks pending queue entries completed even when some or all records failed to persist.
- Suggested fix direction: Collect upsert errors and fail or complete-with-errors without advancing sync state past failed records. Return the error count and keep retryable queue entries pending/failed as appropriate.

---

## `supabase/functions/disconnect-integration/index.ts`

### Finding 29
- Category: failure-point
- Severity: medium
- Line numbers: 81-112
- Description: Token deletion, integration-state update, and sync-queue update run concurrently outside a transaction. If one write succeeds and another fails, the function throws a 500 after partially disconnecting the integration. For example, tokens can be deleted while `user_integrations.status` remains connected.
- Suggested fix direction: Move disconnect into a database RPC/transaction, or sequence writes with compensating error handling so the persisted state cannot be left half-disconnected.

### Finding 30
- Category: failure-point
- Severity: high
- Line numbers: 81-107
- Description: Disconnect only deletes local tokens and marks local queue rows failed. It does not revoke provider-side OAuth tokens for providers such as Strava or Fitbit. A user may reasonably expect disconnect/account deletion to revoke third-party access, but the provider grant can remain active until manually revoked at the provider.
- Suggested fix direction: For providers with revocation endpoints, decrypt the stored token and call the provider revocation API before deleting local credentials. If revocation fails, surface a warning and retry path.

---

## `supabase/functions/_shared/garminIdentity.ts`

### Finding 31
- Category: failure-point
- Severity: low
- Line numbers: 23-32
- Description: `timingSafeEqual` only loops to `Math.min(a.length, b.length)`. It does return false on length mismatch, but runtime still depends on the shorter input length, which leaks candidate token length information.
- Suggested fix direction: Iterate to a fixed maximum or to `Math.max(a.length, b.length)` while substituting zero for out-of-range bytes, so mismatched lengths take comparable work.

### Finding 32
- Category: failure-point
- Severity: medium
- Line numbers: 57-63
- Description: If decrypting any candidate token throws, `resolveGarminWebhookIdentity` rejects the entire identity resolution. A single corrupt/stale token row can cause otherwise valid webhook activities for other users to fail and be retried as transient webhook errors.
- Suggested fix direction: Catch decrypt errors per candidate, log the affected candidate user ID, skip that candidate, and continue checking the remaining candidates.

### Finding 33
- Category: bug
- Severity: medium
- Line numbers: 65-70
- Description: Identity resolution rejects `matches.length > 1` as ambiguous, but there is no repair path. If duplicate encrypted access tokens exist because of a previous partial OAuth write or failed disconnect, every webhook for that token will be rejected indefinitely.
- Suggested fix direction: Add operational handling for ambiguity: log enough metadata to repair the duplicate rows, prefer an exact `provider_user_id` match when available, or quarantine duplicate token rows during OAuth/disconnect cleanup.
