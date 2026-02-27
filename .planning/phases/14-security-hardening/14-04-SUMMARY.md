---
phase: 14-security-hardening
plan: 04
subsystem: api
tags: [oauth, csrf, security, edge-functions, deno, tokens, rls]

# Dependency graph
requires:
  - phase: 14-security-hardening
    provides: "Dynamic CORS via getCorsHeaders(req) and JWT dual-auth pattern"
  - phase: 11-external-integrations
    provides: "OAuth Edge Functions and client-side integration libraries"
provides:
  - "Server-only oauth_tokens table (RLS, no browser access)"
  - "CSRF oauth_states table with 10-minute expiry and single-use tokens"
  - "initiate-oauth Edge Function for JWT-authenticated state token generation"
  - "All OAuth flows use cryptographic state tokens instead of raw user IDs"
  - "All sync functions read tokens from oauth_tokens, not user_integrations"
affects: [14-security-hardening, deployment, edge-functions]

# Tech tracking
tech-stack:
  added: []
  patterns: ["Server-only token isolation via RLS with no browser policies", "CSRF state tokens with 10-min expiry and single-use deletion", "initiate-oauth pattern: JWT auth -> state token -> provider URL"]

key-files:
  created:
    - supabase/migrations/20260227_oauth_security.sql
    - supabase/functions/initiate-oauth/index.ts
  modified:
    - supabase/functions/strava-oauth/index.ts
    - supabase/functions/fitbit-oauth/index.ts
    - supabase/functions/garmin-oauth/index.ts
    - supabase/functions/strava-sync/index.ts
    - supabase/functions/fitbit-sync/index.ts
    - supabase/functions/hevy-sync/index.ts
    - src/lib/integrations/strava.ts
    - src/lib/integrations/fitbit.ts
    - src/lib/integrations/garmin.ts
    - src/app/components/Integrations.tsx
    - src/app/components/integrations/StravaConnect.tsx

key-decisions:
  - "oauth_tokens table has RLS enabled with zero policies -- only service_role (Edge Functions) can access"
  - "State tokens generated via crypto.randomUUID() with 10-minute expiry, deleted after single use"
  - "Client-side OAuth functions changed from sync (userId: string): void to async (accessToken: string): Promise<void>"
  - "Token columns (access_token, refresh_token, token_expires_at, api_key) dropped from user_integrations after migration to oauth_tokens"
  - "Garmin OAuth 1.0a temporary request tokens stored in oauth_tokens instead of user_integrations"

patterns-established:
  - "Token isolation: all OAuth credentials in oauth_tokens, only non-sensitive metadata in user_integrations"
  - "CSRF state flow: client calls initiate-oauth -> server generates state token -> client redirects to provider -> callback validates state"
  - "Sync functions split queries: oauth_tokens for credentials, user_integrations for metadata (last_sync_at, status)"

requirements-completed: [SEC-02, SEC-03]

# Metrics
duration: 7min
completed: 2026-02-27
---

# Phase 14 Plan 04: OAuth Token Isolation and CSRF State Tokens Summary

**Server-only oauth_tokens table with RLS isolation, cryptographic CSRF state tokens for all OAuth flows, and initiate-oauth Edge Function for JWT-authenticated token generation**

## Performance

- **Duration:** 7 min
- **Started:** 2026-02-27T21:13:41Z
- **Completed:** 2026-02-27T21:20:22Z
- **Tasks:** 3
- **Files modified:** 13

## Accomplishments
- Created oauth_tokens table (server-only via RLS with zero browser policies) and oauth_states table for CSRF protection
- Built initiate-oauth Edge Function that authenticates via JWT, generates cryptographic state tokens, and returns provider-specific auth URLs
- Updated all 3 OAuth callback functions (strava-oauth, fitbit-oauth, garmin-oauth) to validate state tokens and store credentials in oauth_tokens
- Updated all 3 sync functions (strava-sync, fitbit-sync, hevy-sync) to read tokens from oauth_tokens instead of user_integrations
- Updated all client-side OAuth initiation functions to async pattern using initiate-oauth Edge Function
- Updated all call sites (Integrations.tsx, StravaConnect.tsx) to pass Supabase access token instead of userId
- Dropped token columns from user_integrations -- browser clients can no longer see OAuth credentials

## Task Commits

Each task was committed atomically:

1. **Task 1: Create database migration for oauth_tokens and oauth_states tables** - `cef5833` (feat)
2. **Task 2: Create initiate-oauth Edge Function, update client-side OAuth initiation, and update OAuth callback functions** - `4abfad3` (feat)
3. **Task 3: Update sync functions to read tokens from oauth_tokens table** - `ec50f09` (feat)

## Files Created/Modified
- `supabase/migrations/20260227_oauth_security.sql` - Creates oauth_tokens and oauth_states tables, migrates data, drops token columns from user_integrations
- `supabase/functions/initiate-oauth/index.ts` - New Edge Function: JWT auth, CSRF state token generation, provider URL builder
- `supabase/functions/strava-oauth/index.ts` - State token validation on callback, token storage in oauth_tokens
- `supabase/functions/fitbit-oauth/index.ts` - State token validation on callback, token storage in oauth_tokens
- `supabase/functions/garmin-oauth/index.ts` - State token validation (OAuth 1.0a), temporary and permanent tokens in oauth_tokens
- `supabase/functions/strava-sync/index.ts` - Token fetch and refresh via oauth_tokens
- `supabase/functions/fitbit-sync/index.ts` - Token fetch and refresh via oauth_tokens
- `supabase/functions/hevy-sync/index.ts` - API key storage and retrieval via oauth_tokens
- `src/lib/integrations/strava.ts` - Async initiateStravaConnect using initiate-oauth Edge Function
- `src/lib/integrations/fitbit.ts` - Async initiateFitbitConnect using initiate-oauth Edge Function
- `src/lib/integrations/garmin.ts` - Async initiateGarminConnect using initiate-oauth Edge Function
- `src/app/components/Integrations.tsx` - Updated call sites to pass accessToken from session
- `src/app/components/integrations/StravaConnect.tsx` - Updated to use useAuth() session for access token

## Decisions Made
- oauth_tokens table uses RLS with zero policies: only service_role key (used by Edge Functions) bypasses RLS. Browser clients with anon or authenticated roles get zero results.
- State tokens use crypto.randomUUID() which provides sufficient entropy for CSRF protection. Combined with 10-minute expiry and single-use deletion, this provides defense against both CSRF and replay attacks.
- Client-side function signatures changed from synchronous `(userId: string): void` to asynchronous `(accessToken: string): Promise<void>`. This is a breaking change but all call sites were updated in the same commit.
- Token columns are dropped from user_integrations via ALTER TABLE DROP COLUMN IF EXISTS, ensuring browser SELECT queries cannot return token data even if RLS policies were misconfigured.
- Garmin OAuth 1.0a stores temporary request tokens in oauth_tokens during the multi-step flow, maintaining consistency with the token isolation pattern.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
No additional setup required beyond what was specified in 14-02 (APP_URL env var) and 14-03 (GARMIN_WEBHOOK_SECRET env var).

The oauth_tokens and oauth_states tables will be created automatically when the migration is applied to Supabase.

## Next Phase Readiness
- Phase 14 (Security Hardening) is now complete -- all 4 plans executed
- All browser-facing endpoints enforce origin restrictions (14-02)
- All sync endpoints require authentication (14-03)
- OAuth tokens are isolated from browser clients (14-04)
- OAuth flows use cryptographic CSRF state tokens (14-04)
- Ready for Phase 15 (CI/CD & Database Foundation)

## Self-Check: PASSED

All 13 files verified present. All 3 commits (cef5833, 4abfad3, ec50f09) verified in git log.

---
*Phase: 14-security-hardening*
*Completed: 2026-02-27*
