# Phase 2.2 -- Edge Function Authentication Audit

**Date:** 2026-03-18
**Auditor:** Security Engineer (automated)
**Scope:** All 18 Supabase Edge Functions in `supabase/functions/`
**Branch:** `beta-readiness-review`

---

## Executive Summary

18 Edge Functions audited against five authentication criteria. **2 findings rated HIGH, 3 rated MEDIUM, 2 rated LOW.** The overall authentication architecture is sound -- JWT verification is properly implemented via `supabase.auth.getUser()` for user-facing functions, HMAC signature verification with timing-safe comparison and replay protection is used for Paddle webhooks, and CSRF state tokens protect the OAuth callback flow. The critical gaps are in the dual-path auth fallback used by sync functions and the conditional webhook secret check in `garmin-webhook`.

---

## supabase/config.toml Review

```toml
[functions.paddle-webhooks]
verify_jwt = false
```

**Verdict: PASS.** Only `paddle-webhooks` disables Supabase's built-in JWT verification, which is correct because it authenticates via HMAC signature instead. All other 17 functions inherit the default `verify_jwt = true`, meaning Supabase rejects requests without a valid JWT header before the function code even runs.

**Note:** `garmin-webhook` does NOT have `verify_jwt = false` in config.toml, but it is a webhook endpoint that receives unsigned POST requests from Garmin. This means Garmin's requests will be rejected at the Supabase gateway unless the caller passes a valid JWT or the service role key. **This is a configuration bug -- see Finding F-02.**

---

## Audit Matrix

| #   | Function                     | Auth Method                                                  | User ID Source                                   | Service Role                                    | Error Code                 | Auth Bypass         | Verdict          |
| --- | ---------------------------- | ------------------------------------------------------------ | ------------------------------------------------ | ----------------------------------------------- | -------------------------- | ------------------- | ---------------- |
| 1   | `paddle-webhooks`            | HMAC-SHA256 signature                                        | `custom_data.user_id` (webhook payload)          | Yes -- upsert subscriptions                     | 401                        | None                | PASS             |
| 2   | `paddle-cancel-subscription` | JWT via `getUser()`                                          | `user.id` (JWT)                                  | Yes -- read subscription by user_id             | 401                        | None                | PASS             |
| 3   | `paddle-update-subscription` | JWT via `getUser()`                                          | `user.id` (JWT)                                  | Yes -- read subscription by user_id             | 401                        | None                | PASS             |
| 4   | `initiate-oauth`             | JWT via `getUser()`                                          | `user.id` (JWT)                                  | Yes -- insert oauth_states                      | 401                        | None                | PASS             |
| 5   | `strava-oauth`               | CSRF state token                                             | `stateRow.user_id` (DB lookup)                   | Yes -- write oauth_tokens, user_integrations    | Redirect w/ error param    | None                | PASS             |
| 6   | `fitbit-oauth`               | CSRF state token                                             | `stateRow.user_id` (DB lookup)                   | Yes -- write oauth_tokens, user_integrations    | Redirect w/ error param    | None                | PASS             |
| 7   | `garmin-oauth`               | CSRF state token (step 1) / OAuth 1.0a token lookup (step 2) | `stateRow.user_id` / `pendingToken.user_id` (DB) | Yes -- write oauth_tokens, user_integrations    | Redirect w/ error param    | None                | PASS             |
| 8   | `strava-sync`                | Dual-path: JWT or body.user_id                               | JWT preferred; body.user_id fallback             | Yes -- read/write tokens, activities            | 401                        | **YES -- see F-01** | FAIL             |
| 9   | `fitbit-sync`                | Dual-path: JWT or body.user_id                               | JWT preferred; body.user_id fallback             | Yes -- read/write tokens, activities            | 401                        | **YES -- see F-01** | FAIL             |
| 10  | `hevy-sync`                  | Dual-path: JWT or body.user_id                               | JWT preferred; body.user_id fallback             | Yes -- read/write tokens, activities            | 401                        | **YES -- see F-01** | FAIL             |
| 11  | `liftosaur-sync`             | Dual-path: JWT or body.user_id                               | JWT preferred; body.user_id fallback             | Yes -- read/write tokens, activities            | 401                        | **YES -- see F-01** | FAIL             |
| 12  | `garmin-webhook`             | Conditional shared secret                                    | `integration.user_id` (DB lookup)                | Yes -- write activities                         | 401 (if secret configured) | **YES -- see F-02** | FAIL             |
| 13  | `process-sync-queue`         | Supabase gateway JWT (service role)                          | N/A (reads from sync_queue)                      | Yes -- full DB access                           | N/A                        | None                | PASS (with note) |
| 14  | `mobile-sync-push`           | JWT via `getUser()`                                          | `user.id` (JWT)                                  | Yes -- bulk upsert all user data                | 401                        | None                | PASS             |
| 15  | `mobile-sync-pull`           | JWT via `getUser()`                                          | `user.id` (JWT)                                  | Yes -- read all user data                       | 401                        | None                | PASS             |
| 16  | `delete-account`             | JWT via `getUser()`                                          | `user.id` (JWT)                                  | Yes -- delete auth user + cascade               | 401                        | None                | PASS             |
| 17  | `disconnect-integration`     | JWT via `getUser()`                                          | `user.id` (JWT)                                  | Yes -- delete oauth_tokens, update integrations | 401                        | None                | PASS             |
| 18  | `generate-insights`          | JWT via `getUser()`                                          | `user.id` (JWT, enforced by guard)               | Yes -- read sessions, exercises, PRs, progress  | 401/403                    | None                | PASS             |

---

## Detailed Findings

### F-01: Dual-Path Auth Fallback Trusts `body.user_id` Without Verifying Caller Identity

**Severity: HIGH (CVSS 7.5)**
**Affected functions:** `strava-sync`, `fitbit-sync`, `hevy-sync`, `liftosaur-sync`
**Location:** Lines ~150-163 in each file (the `else` branch after `if (jwtUser)`)

**Description:**

All four sync functions implement a "dual-path" authentication pattern:

1. First, attempt JWT authentication via `supabase.auth.getUser()`
2. If that fails, fall back to trusting `body.user_id` from the request body

The intent is to allow `process-sync-queue` (which calls these functions with the service role key) to specify which user to sync. However, the fallback path does not verify that the caller is actually the service role. It only checks that `body.user_id` is present.

**Attack scenario:**

An attacker with a valid JWT for User A can craft a request that causes JWT verification to fail (e.g., by sending a malformed but present Authorization header like `Bearer invalid-token`), causing the code to fall through to the `else` branch. Then `body.user_id` set to User B's ID would be accepted. The Supabase gateway checks the JWT at the infrastructure level (`verify_jwt = true`), which mitigates this to some extent -- but a service role key in the Authorization header would pass the gateway check and also fail `getUser()`, landing in the fallback path.

**Mitigating factor:** The Supabase gateway's `verify_jwt = true` default means that only requests with a valid JWT OR the service role key reach the function. An attacker without a valid JWT or the service role key is blocked at the gateway. The real risk is: if a user somehow obtains the service role key (e.g., from a leaked `.env` file), they can impersonate any user. Additionally, if `verify_jwt` is ever toggled off for these functions by mistake, the vulnerability becomes directly exploitable.

**The design flaw is that the fallback path does not distinguish between "JWT was invalid" and "caller is the service role."** When the service role key is passed in the Authorization header, `getUser()` returns null (it is not a user JWT), so the code falls through and trusts body.user_id. This is the intended path for process-sync-queue, but it is indistinguishable from a spoofed request.

**Remediation:**

```typescript
// CURRENT (vulnerable fallback)
if (jwtUser) {
  userId = jwtUser.id;
} else {
  if (!body.user_id) {
    return new Response(..., { status: 401 });
  }
  userId = body.user_id; // Trusts body blindly
}

// RECOMMENDED: Explicitly verify service role key
if (jwtUser) {
  userId = jwtUser.id;
} else {
  // Verify the caller is using the service role key
  const isServiceRole = authHeader === `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`;
  if (!isServiceRole || !body.user_id) {
    return new Response(
      JSON.stringify({ error: 'Unauthorized' }),
      { status: 401, headers: { ...cors, 'Content-Type': 'application/json' } }
    );
  }
  userId = body.user_id;
}
```

**Priority:** Fix before beta launch. This is an authorization boundary weakness.

---

### F-02: `garmin-webhook` Auth Is Conditional and Missing `verify_jwt = false`

**Severity: HIGH (CVSS 7.2)**
**Affected function:** `garmin-webhook`
**Location:** Lines 126-137

**Description:** Two separate issues:

**Issue A: Missing `verify_jwt = false` in config.toml**

`garmin-webhook` is designed to receive push notifications from Garmin Connect. Garmin does not send JWTs. However, `config.toml` does not disable JWT verification for this function. This means Garmin's POST requests will be rejected at the Supabase gateway with 401 before the function code even runs. This effectively makes the Garmin webhook non-functional in production.

**Issue B: Conditional secret check**

```typescript
const WEBHOOK_SECRET = Deno.env.get('GARMIN_WEBHOOK_SECRET');
if (WEBHOOK_SECRET) {
  // ... validate secret
}
// If GARMIN_WEBHOOK_SECRET is not set, ALL requests are accepted
```

If `GARMIN_WEBHOOK_SECRET` is not configured (which is likely during development), the function accepts any POST request with no authentication whatsoever. An attacker could inject fabricated activity data for any user whose Garmin `provider_user_id` they know.

**Issue C: Weak secret comparison**

Even when the secret IS configured, the comparison uses simple string equality (`===`) on header values, not timing-safe comparison. This could leak information about the secret via timing side-channel attacks.

**Remediation:**

1. Add to `config.toml`:
```toml
[functions.garmin-webhook]
verify_jwt = false
```

1. Make the secret check mandatory (not conditional):
```typescript
const WEBHOOK_SECRET = Deno.env.get('GARMIN_WEBHOOK_SECRET');
if (!WEBHOOK_SECRET) {
  console.error('GARMIN_WEBHOOK_SECRET is not configured');
  return new Response(
    JSON.stringify({ error: 'Webhook not configured' }),
    { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } }
  );
}

const providedSecret = req.headers.get('x-webhook-secret')
  ?? req.headers.get('authorization')?.replace('Bearer ', '');

if (!providedSecret) {
  return new Response(
    JSON.stringify({ error: 'Unauthorized' }),
    { status: 401, headers: { ...cors, 'Content-Type': 'application/json' } }
  );
}

// Timing-safe comparison
const encoder = new TextEncoder();
const a = encoder.encode(providedSecret);
const b = encoder.encode(WEBHOOK_SECRET);
if (a.length !== b.length) {
  return new Response(..., { status: 401 });
}
let mismatch = 0;
for (let i = 0; i < a.length; i++) {
  mismatch |= a[i] ^ b[i];
}
if (mismatch !== 0) {
  return new Response(..., { status: 401 });
}
```

**Priority:** Fix config.toml before Garmin developer program approval. Make secret mandatory before beta.

---

### F-03: `process-sync-queue` Has No Function-Level Auth Check

**Severity: MEDIUM (CVSS 5.3)**
**Affected function:** `process-sync-queue`
**Location:** Lines 19-29

**Description:**

`process-sync-queue` is a scheduled function intended to be invoked by Supabase cron or an external scheduler. It has no function-level authentication. It relies entirely on the Supabase gateway's `verify_jwt = true` default to prevent unauthorized access.

This is acceptable IF:
- The function is only invoked by cron (which uses the service role key)
- No user-facing route exposes this function

However, any client that knows the function URL and has a valid user JWT can invoke it. The function would then process sync queue items for OTHER users (not just the calling user), effectively performing actions on behalf of arbitrary users.

**Mitigating factor:** The function only processes items already in the `sync_queue` table. It does not accept external user_ids. The damage is limited to triggering syncs that are already queued -- it does not create new data access.

**Remediation:** Add a service-role-only check:

```typescript
const authHeader = req.headers.get('Authorization');
const isServiceRole = authHeader === `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`;
if (!isServiceRole) {
  return new Response(
    JSON.stringify({ error: 'Forbidden: service role required' }),
    { status: 403, headers: { ...cors, 'Content-Type': 'application/json' } }
  );
}
```

**Priority:** Address before beta launch.

---

### F-04: `paddle-webhooks` User ID Comes From Untrusted Payload Field

**Severity: MEDIUM (CVSS 4.7)**
**Affected function:** `paddle-webhooks`
**Location:** Line 192

**Description:**

```typescript
const userId = event.data.custom_data?.user_id;
```

The `user_id` is extracted from `event.data.custom_data`, which is a field that was originally set during checkout session creation. While the HMAC signature verification confirms the event came from Paddle (not a forgery), the `custom_data` was set by the CLIENT when they initiated checkout.

If the checkout flow allows the client to specify `custom_data.user_id`, a malicious user could set a different user's ID during checkout creation, and Paddle would faithfully include that in webhook events.

**Mitigating factor:** The `paddle-checkout` Edge Function (not present in this audit -- the checkout is likely handled client-side via Paddle.js) is where `custom_data` is set. If the checkout creation sets `user_id` from the JWT (server-side), this is mitigated. However, if the client passes user_id to the checkout creation endpoint, this is exploitable.

**Remediation:** Verify that wherever `custom_data.user_id` is set during Paddle checkout initialization, it comes from the server-verified JWT identity, not from a client-provided field. Document this as a critical assumption.

**Priority:** Verify before beta launch.

---

### F-05: `generate-insights` Accepts `body.userId` Before Enforcing Identity Guard

**Severity: MEDIUM (CVSS 4.3)**
**Affected function:** `generate-insights`
**Location:** Lines 253-263

**Description:**

```typescript
const body = await req.json().catch(() => ({}));
const userId: string = body.userId ?? user.id;

// Guard: requesting user can only fetch their own insights
if (userId !== user.id) {
  return new Response(
    JSON.stringify({ error: 'Forbidden' }),
    { status: 403, ... }
  );
}
```

The function correctly guards against cross-user access by comparing `body.userId` to `user.id`. This is properly implemented and returns 403. However, the pattern of accepting a client-supplied userId at all is an anti-pattern. It creates unnecessary attack surface and could be bypassed if someone later refactors the guard.

**Positive note:** The guard IS implemented correctly (returns 403), making this a code-quality issue rather than an active vulnerability.

**Remediation:** Remove `body.userId` entirely and always use `user.id`:

```typescript
const userId = user.id; // Never accept user ID from request body
```

**Priority:** Low -- the guard works, but simplify for defense in depth.

---

### F-06: `delete-account` Does Not Validate Authorization Header Presence

**Severity: LOW (CVSS 2.0)**
**Affected function:** `delete-account`
**Location:** Line 20

**Description:**

```typescript
const authHeader = req.headers.get('Authorization')!;
```

The `!` non-null assertion is used without first checking if the header exists. If `Authorization` is null, `createClient` is called with `{ Authorization: null }`, and `getUser()` returns null. The function then correctly returns 401. The vulnerability is purely theoretical -- TypeScript's non-null assertion masks a null value, but the runtime behavior is correct because `getUser()` handles the null gracefully.

**Mitigating factor:** The Supabase gateway (`verify_jwt = true`) would reject the request before it reaches this code. The runtime behavior is correct even without the gateway.

**Remediation:** Add an explicit null check for consistency and defense in depth:

```typescript
const authHeader = req.headers.get('Authorization');
if (!authHeader) {
  return new Response(
    JSON.stringify({ error: 'Missing authorization' }),
    { status: 401, ... }
  );
}
```

The same pattern affects `paddle-cancel-subscription` (line 27), `paddle-update-subscription` (line 27), and `generate-insights` (line 236). All four use `!` assertion on the auth header without a null guard. All are protected by the gateway and by `getUser()` returning null, so this is cosmetic.

**Priority:** Low -- fix for code quality.

---

### F-07: OAuth Callback Functions Return Redirect Without Error Body on Auth Failures

**Severity: LOW (CVSS 1.5)**
**Affected functions:** `strava-oauth`, `fitbit-oauth`, `garmin-oauth`

**Description:**

OAuth callback functions redirect to the portal with query parameters on failure:
```
/integrations?error=invalid_state
/integrations?error=state_expired
```

This is standard practice for OAuth flows and not a security vulnerability. However, the error parameter values could leak information about the authentication mechanism to an attacker probing the endpoint. An attacker could enumerate valid state tokens by observing the difference between `invalid_state` and `state_expired` responses.

**Mitigating factor:** State tokens are cryptographic UUIDs with 10-minute expiry, making enumeration impractical. The information leakage is minimal.

**Remediation:** Consider using a single generic error parameter for all auth failures in the redirect:
```
/integrations?error=auth_failed
```
Log the specific failure reason server-side only.

**Priority:** Low -- informational.

---

## Positive Findings

### P-01: HMAC Signature Verification in `paddle-webhooks` Is Excellent

The implementation includes:
- Timing-safe comparison (bitwise XOR loop) -- prevents timing side-channel attacks
- 5-minute replay window -- prevents replay attacks with captured signatures
- Proper HMAC-SHA256 with the raw body -- prevents body tampering
- Signature verification BEFORE JSON parsing -- prevents JSON injection

### P-02: OAuth State Token Implementation Is Solid

- Cryptographic `crypto.randomUUID()` for state tokens
- 10-minute expiry with cleanup of expired tokens
- Single-use: tokens are deleted after validation
- Provider mismatch check prevents cross-provider token reuse
- User ID derived from DB (server-side), never from the redirect URL

### P-03: Mobile Sync Functions Enforce JWT-Only Auth

`mobile-sync-push` and `mobile-sync-pull` correctly:
- Require Authorization header (401 on missing)
- Validate JWT via `getUser()` (401 on invalid)
- Extract user ID exclusively from the verified JWT
- Never accept user_id from the request body
- Use service role client only for DB operations AFTER authentication

### P-04: `generate-insights` Has Explicit Cross-User Guard

Returns 403 when `body.userId !== user.id`. This is the correct pattern for preventing horizontal privilege escalation, even though the body.userId acceptance is an anti-pattern (F-05).

### P-05: Service Role Key Usage Is Appropriate Throughout

All functions that use `SUPABASE_SERVICE_ROLE_KEY` do so for legitimate purposes:
- Writing to `oauth_tokens` (server-only table, no RLS for user JWT)
- Writing to `subscriptions` (webhook handler needs admin access)
- Deleting auth users (admin-only API)
- Reading across user boundaries in process-sync-queue (scheduled task)

No function exposes the service role key to clients or leaks it in responses.

### P-06: Dynamic CORS Origin Validation

The shared `getCorsHeaders()` function validates the request `Origin` header against a whitelist, preventing CORS-based attacks from unauthorized domains. Non-production environments add localhost origins. The `Vary: Origin` header is correctly set.

---

## Findings Summary Table

| ID   | Severity | Function(s)                                                     | Title                                                             | Status |
| ---- | -------- | --------------------------------------------------------------- | ----------------------------------------------------------------- | ------ |
| F-01 | HIGH     | strava-sync, fitbit-sync, hevy-sync, liftosaur-sync             | Dual-path auth trusts body.user_id without verifying service role | OPEN   |
| F-02 | HIGH     | garmin-webhook                                                  | Missing verify_jwt=false AND conditional secret check             | OPEN   |
| F-03 | MEDIUM   | process-sync-queue                                              | No function-level auth; any JWT holder can trigger syncs          | OPEN   |
| F-04 | MEDIUM   | paddle-webhooks                                                 | user_id from custom_data -- verify checkout sets it server-side   | OPEN   |
| F-05 | MEDIUM   | generate-insights                                               | Accepts body.userId (guard works, but anti-pattern)               | OPEN   |
| F-06 | LOW      | delete-account, paddle-cancel, paddle-update, generate-insights | Non-null assertion on auth header without null check              | OPEN   |
| F-07 | LOW      | strava-oauth, fitbit-oauth, garmin-oauth                        | Error params in redirect leak auth mechanism details              | OPEN   |

---

## Remediation Priority

### Before Beta Launch (blockers)
1. **F-01:** Add explicit service role key verification in the dual-path auth fallback for all 4 sync functions
2. **F-02:** Add `verify_jwt = false` to config.toml for garmin-webhook AND make webhook secret mandatory
3. **F-03:** Add service-role-only guard to process-sync-queue

### Before Beta Launch (verify)
1. **F-04:** Audit the Paddle checkout flow to confirm custom_data.user_id is set from server-verified JWT

### Post-Beta (cleanup)
1. **F-05:** Remove body.userId acceptance from generate-insights
2. **F-06:** Add explicit null checks on Authorization header across 4 functions
3. **F-07:** Normalize error redirect parameters to generic values

---

## Auth Pattern Inventory

### Pattern 1: JWT via getUser() (10 functions)
Used by: `paddle-cancel-subscription`, `paddle-update-subscription`, `initiate-oauth`, `disconnect-integration`, `delete-account`, `generate-insights`, `mobile-sync-push`, `mobile-sync-pull`, `strava-sync`*, `fitbit-sync`*, `hevy-sync`*, `liftosaur-sync`*

(*) These also have the dual-path fallback -- see F-01.

### Pattern 2: HMAC Signature Verification (1 function)
Used by: `paddle-webhooks`

### Pattern 3: CSRF State Token (3 functions)
Used by: `strava-oauth`, `fitbit-oauth`, `garmin-oauth`

### Pattern 4: Shared Secret (1 function)
Used by: `garmin-webhook` (conditional -- see F-02)

### Pattern 5: Gateway-Only (1 function)
Used by: `process-sync-queue` (no function-level auth -- see F-03)
