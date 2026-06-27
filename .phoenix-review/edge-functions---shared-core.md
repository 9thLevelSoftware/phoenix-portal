# Review: Edge Functions - Shared Core

Scope reviewed:
- `supabase/functions/_shared/cors.ts`
- `supabase/functions/_shared/flags.ts`
- `supabase/functions/_shared/hmac.ts`
- `supabase/functions/_shared/oauthTokenCrypto.ts`
- `supabase/functions/_shared/rateLimit.ts`
- `supabase/functions/_shared/rateLimitRpc.ts`
- `supabase/functions/_shared/requireSubscription.ts`
- `supabase/functions/_shared/subscriptionEntitlement.ts`
- `supabase/functions/_shared/localProfileId.ts`

Summary:
- Findings: 9
- Severity breakdown: 0 critical, 1 high, 6 medium, 2 low
- Category breakdown: 2 bug, 0 stub, 1 error, 6 failure-point

## `supabase/functions/_shared/cors.ts`

No findings identified in this file. The dynamic origin path correctly omits `Access-Control-Allow-Origin` for untrusted browser origins and includes `Vary: Origin` for cache correctness.

## `supabase/functions/_shared/flags.ts`

### Finding 1
- Category: failure-point
- Severity: low
- Line numbers: 30-31
- Description: `SYNC_LWW_ENABLED` lowercases the environment value but does not trim it. A value copied into Supabase secrets as `true `, ` TRUE`, or with a trailing newline will silently evaluate to `false`, leaving the LWW path disabled even though the operator intended to enable it.
- Suggested fix direction: Normalize with `.trim().toLowerCase()` and consider logging the parsed flag state at cold start for rollout verification.

## `supabase/functions/_shared/hmac.ts`

No findings identified in this file. The helper generates a standard HMAC-SHA256 hex digest and current usage validates that the signing secret is present before calling it.

## `supabase/functions/_shared/oauthTokenCrypto.ts`

### Finding 2
- Category: failure-point
- Severity: high
- Line numbers: 119-124
- Description: `decryptOAuthSecret` returns any stored value without the `enc:v1:` prefix as plaintext, even in deployed production with `OAUTH_TOKEN_ENCRYPTION_KEY` configured. Legacy or accidentally written plaintext OAuth tokens therefore continue to be accepted indefinitely, so the encryption layer does not detect or remediate sensitive columns that are still unencrypted at rest.
- Suggested fix direction: In production, reject non-prefixed values for sensitive token columns or add an explicit migration/rehydration path that reads legacy plaintext once, rewrites it encrypted, and records telemetry until no plaintext rows remain.

### Finding 3
- Category: failure-point
- Severity: medium
- Line numbers: 13, 53-99, 110-116, 131-139
- Description: The ciphertext prefix contains only an algorithm version (`enc:v1:`) and `getAesKey` loads exactly one key from `OAUTH_TOKEN_ENCRYPTION_KEY`. Any key rotation immediately makes existing encrypted tokens undecryptable for isolates that only know the new key, while long-lived isolates may keep using the old cached key until cold restart. There is no key id, previous-key fallback, or planned re-encryption path.
- Suggested fix direction: Use a keyring format such as `enc:v1:<key_id>:...`, allow decrypt with current and previous keys during rotation, and re-encrypt on successful decrypt with the active key before retiring old keys.

## `supabase/functions/_shared/rateLimit.ts`

### Finding 4
- Category: bug
- Severity: medium
- Line numbers: 61-77, 147-167, 227-270
- Description: `checkRateLimit` does not validate `key`, `userId`, `maxRequests`, or `windowSeconds` before invoking the RPC/fallback logic. The SQL RPC rejects invalid limits, but if the RPC is missing and the TypeScript fallback runs, `maxRequests <= 0` can still allow the first inserted request with a negative `remaining` value, and `windowSeconds <= 0` causes every request to appear expired/resettable.
- Suggested fix direction: Validate the config in TypeScript before the RPC call. Fail closed with a 500/503 for invalid internal configuration, and reject blank keys, invalid user IDs, `maxRequests < 1`, and `windowSeconds < 1` consistently across both RPC and fallback paths.

### Finding 5
- Category: failure-point
- Severity: medium
- Line numbers: 147-181, 253-275
- Description: The fallback path is described as atomic, but it is a multi-query read/update loop outside a database transaction. Under contention, repeated optimistic-lock misses return `rate_limit_unavailable` after three attempts, so if the RPC is not deployed or temporarily unavailable, legitimate high-traffic endpoints can start returning 503s instead of enforcing the limit reliably.
- Suggested fix direction: Treat the SQL RPC as a required migration for production and remove or demote the fallback, or move the fallback behavior into a transactional database function/advisory lock. If the fallback remains, add backoff/jitter and monitor fallback usage so contention does not become an outage mode.

## `supabase/functions/_shared/rateLimitRpc.ts`

### Finding 6
- Category: failure-point
- Severity: low
- Line numbers: 23-38
- Description: `normalizeRateLimitRpcResult` checks only JavaScript types. It accepts negative, fractional, or non-finite `remaining`/`retry_after_seconds` values if a malformed RPC implementation or test double returns them, and `rateLimit.ts` will propagate those into API responses and `Retry-After` headers.
- Suggested fix direction: Validate semantic bounds as well as types: require safe integer `remaining >= 0`, require `retry_after_seconds === null` or a safe integer `>= 1`, and reject malformed rows so callers fail closed.

## `supabase/functions/_shared/requireSubscription.ts`

### Finding 7
- Category: error
- Severity: medium
- Line numbers: 39-48
- Description: The subscription query ignores the `error` field from `.maybeSingle()`. A database outage, RLS/service-role misconfiguration, schema drift, or duplicate-row error is treated the same as “no subscription”: the user is downgraded to `FREE` and receives a 402 `subscription_required` response. Paying users can be locked out while operators see a billing denial instead of the real infrastructure failure.
- Suggested fix direction: Capture `{ data, error }`, log unexpected errors, and fail closed with a 503/configuration response rather than converting query failures to `FREE`. Keep the 402 path only for a successful query that returns no entitled subscription.

### Finding 8
- Category: bug
- Severity: medium
- Line numbers: 45-50, 68
- Description: `subscription?.tier` and `subscription?.status` are cast directly to `SubscriptionTier`/`SubscriptionStatus` without runtime validation. If production has old tier values such as `PHOENIX`/`ELITE`, a new Paddle status, or any schema drift, the helper silently maps unknown tiers to level 0 or can return an invalid `tier` value from the `allowed: true` branch when the required tier is `FREE`.
- Suggested fix direction: Validate database values against explicit tier/status sets before computing entitlement. For known legacy tier names, migrate or map them deliberately; for unknown values, log and return a 503/configuration error instead of silently downgrading or returning invalid typed data.

## `supabase/functions/_shared/subscriptionEntitlement.ts`

### Finding 9
- Category: failure-point
- Severity: medium
- Line numbers: 9, 16-21
- Description: Only `active` and `trialing` statuses are entitlement-bearing. A `past_due` subscription with a future `current_period_end` immediately loses paid Edge Function access, even though payment processors commonly use `past_due` during a retry/grace period while the billing period is still current. This can create a server/client policy mismatch if the product intends grace-period access.
- Suggested fix direction: Confirm the billing policy for `past_due`. If users should retain access until `current_period_end`, include `past_due` in the entitlement check while the period end is future and surface separate UI/telemetry for billing-risk state.

## `supabase/functions/_shared/localProfileId.ts`

No findings identified in this file. The PostgREST filter builder validates the only currently accepted values (`default` and UUID-shaped IDs) before interpolating them into the `.or()` filter string, and the current mobile-sync-pull caller also validates `profileId` before building the filter.
