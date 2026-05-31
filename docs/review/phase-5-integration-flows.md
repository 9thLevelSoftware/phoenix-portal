# Phase 5: Integration Flows Review

**Auditor:** Phase 5 Code Reviewer
**Date:** 2026-03-18
**Branch:** beta-readiness-review
**Scope:** All 5 integration flows (Strava, Fitbit, Garmin, Hevy, Liftosaur) across 14 edge functions, shared utilities, and integration UI.

---

## Summary Table

| ID   | Finding                                                                              | Severity      | Status |
| ---- | ------------------------------------------------------------------------------------ | ------------- | ------ |
| F-01 | Strava rate limit 80/15min vs actual 100/15min non-upload limit                      | NON-BLOCKER   | Open   |
| F-02 | Fitbit rate limit 120/hr vs actual 150/hr                                            | NON-BLOCKER   | Open   |
| F-03 | Strava and Fitbit concurrent sync race condition on token refresh                    | NON-BLOCKER   | Open   |
| F-04 | Garmin never-expiring tokens — no out-of-band revocation detection                   | NON-BLOCKER   | Open   |
| F-05 | Garmin implementation untested — developer program approval pending                  | BLOCKER       | Open   |
| F-06 | Strava sync normalizer duplicated between Edge Function and client library           | NON-BLOCKER   | Open   |
| F-07 | Fitbit 429 handler uses rolling window instead of top-of-hour reset                  | NON-BLOCKER   | Open   |
| F-08 | disconnect-integration does not call provider revoke endpoints                       | ACCEPTED-RISK | Open   |
| F-09 | Garmin webhook: raw shared-secret scheme unconfirmed vs Garmin spec                  | NON-BLOCKER   | Open   |
| F-10 | useConnectIntegration mutation writes api_key to user_integrations (client-readable) | BLOCKER       | Open   |
| F-11 | Liftosaur missing timestamp silently falls back to current time                      | NON-BLOCKER   | Open   |
| F-12 | Fitbit comingSoon flag blocks UI — acceptable while app review pending               | ACCEPTED-RISK | Open   |
| F-13 | Liftosaur absent from RATE_LIMITS in process-sync-queue                              | NON-BLOCKER   | Open   |
| F-14 | ProviderCard does not distinguish token_expired from generic disconnected state      | NON-BLOCKER   | Open   |
| F-15 | liftosaur missing from ALLOWED_PROVIDERS in disconnect-integration                   | NON-BLOCKER   | Open   |

---

## BLOCKERS

### F-05: Garmin Integration Untested

Both `garmin-oauth/index.ts` and `garmin-webhook/index.ts` carry explicit "untested until credentials available" notes. Garmin Connect Developer Program approval is required before live credentials exist. The logic is correctly implemented per OAuth 1.0a RFC 5849 review, but has never been executed against the actual Garmin API.

**Recommendation:** The UI correctly marks Garmin `comingSoon`. This flag must remain until:
1. Garmin GCPP approval is confirmed
2. End-to-end smoke test of the three-legged flow completes
3. Webhook registration and test delivery verified
4. Garmin webhook authentication scheme confirmed (see F-09)

### F-10: useConnectIntegration Writes api_key to Client-Readable Table

`src/mutations/integrations.ts:134` contains a `api_key: apiKey` field in the `user_integrations` upsert. This table is accessible to authenticated clients via RLS. The mutation is not currently invoked for key-bearing providers (Hevy/Liftosaur use direct Edge Function calls), but the hook is exported and could be called accidentally.

**Recommendation:** Remove the `api_key` field from this mutation entirely. API keys must only flow through provider sync Edge Functions which store them in oauth_tokens (server-only table).

---

## NON-BLOCKERS

### F-01/F-02: Rate Limits Conservative (Intentional)
Strava configured at 80/15min (actual 100), Fitbit at 120/hr (actual 150). Both have 20% safety margin — intentional and documented.

### F-03: Concurrent Sync Race Condition on Token Refresh
Two invocations for the same user/provider could race on token refresh. Mitigated by sync_queue `processing` status preventing re-dispatch. Low probability edge case.

### F-04: Garmin Token Revocation Not Detectable
OAuth 1.0a tokens never expire. No mechanism to detect user-initiated revocation on Garmin side. Document in runbook.

### F-06: Strava Normalization Duplicated
Normalization logic exists in both `strava-sync/index.ts` and `src/lib/integrations/normalize.ts`. Add cross-reference comments.

### F-07: Fitbit 429 Over-Blocks by Up to 58 Minutes
Uses rolling window from 429 time instead of Fitbit's top-of-hour reset. Safe (never under-blocks) but wastes a queue cycle.

### F-09: Garmin Webhook Auth Scheme Unconfirmed
Current implementation uses raw shared secret in header. Garmin's actual mechanism may be HMAC-SHA256. Confirm before enabling.

### F-11: Liftosaur Missing Timestamp Falls Back to now()
Records without parseable timestamp get `started_at = now()`, corrupting historical data silently. Should skip records instead.

### F-13: Liftosaur Absent from RATE_LIMITS
`process-sync-queue/index.ts` RATE_LIMITS map doesn't include liftosaur. Sync tasks dispatched without rate limiting.

### F-14: ProviderCard Doesn't Distinguish token_expired from disconnected
When status is `token_expired` or `error`, card shows generic Connect button with no explanation of why connection was lost.

### F-15: liftosaur Missing from ALLOWED_PROVIDERS in disconnect-integration
`disconnect-integration/index.ts` ALLOWED_PROVIDERS Set doesn't include 'liftosaur'. Disconnect request returns 400 silently.

---

## ACCEPTED-RISK

### F-08: Provider Revoke Endpoints Not Called on Disconnect
Tokens deleted from oauth_tokens immediately. Provider-side tokens remain valid until natural expiry (Strava ~6h, Fitbit ~8h). Residual risk bounded.

### F-12: Fitbit comingSoon Flag
Backend ready, flag intentional pending Fitbit developer portal review.

---

## Per-Provider Status

| Provider  | Auth                 | Sync           | Rate Limit      | Token Refresh     | Beta Status        |
| --------- | -------------------- | -------------- | --------------- | ----------------- | ------------------ |
| Strava    | OAuth 2.0            | Pull           | 80/15min        | Handled, rotation | READY              |
| Fitbit    | OAuth 2.0 + Basic    | Pull           | 120/hr          | Handled, rotation | READY (comingSoon) |
| Garmin    | OAuth 1.0a HMAC-SHA1 | Push (webhook) | 40/hr est.      | N/A (no expiry)   | BLOCKED (untested) |
| Hevy      | API key              | Pull / CSV     | 40/hr est.      | N/A               | READY              |
| Liftosaur | Bearer token         | Pull (cursor)  | None configured | N/A               | READY (with F-11)  |

---

## Verification Summaries

### OAuth Flows (5.1-5.3)
All OAuth flows verified: CSRF state generated with crypto.randomUUID(), single-use enforcement, correct grant types, minimal scopes, tokens stored exclusively in server-only oauth_tokens table. Strava and Fitbit flows are production-ready. Garmin flow is correctly coded but untested.

### Non-OAuth Auth (5.4)
Hevy API key and Liftosaur Bearer token flows verified. Keys stored securely in oauth_tokens. Both have FLAME subscription gates.

### Token Refresh (5.5)
Strava (60s pre-expiry buffer) and Fitbit (10min pre-expiry buffer) handle refresh token rotation correctly. Both persist new refresh tokens. Race condition on concurrent refresh is low-probability (F-03).

### Data Normalization (5.6)
All 5 providers normalize to consistent external_activities schema. Unit conversions verified correct. Timezone handling has known limitations (floating times from Fitbit/Garmin) — acceptable given raw_data preservation.

### Rate Limits (5.7)
All limits are conservative (20% safety margin). Liftosaur missing from rate limit config (F-13).

### Disconnect Cleanup (5.8)
Tokens deleted, sync tasks canceled, user_integrations reset. Provider revoke endpoints not called (F-08 accepted risk). Liftosaur missing from ALLOWED_PROVIDERS (F-15).

### Garmin Webhook (5.9)
Handler is correctly structured with timing-safe secret comparison, per-activity error isolation, idempotent upserts, and always-200 responses. Auth scheme unconfirmed (F-09).

### Integration UI (5.10)
SubscriptionGate correctly blocks entire page at FLAME. ProviderCard handles connect/disconnect/sync flows. SyncStatus polls only when work is pending. token_expired status not distinguished in UI (F-14).
