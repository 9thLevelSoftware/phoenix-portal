---
phase: 14-security-hardening
plan: 03
subsystem: api
tags: [auth, security, edge-functions, deno, jwt, webhook]

# Dependency graph
requires:
  - phase: 14-security-hardening
    provides: "Dynamic CORS origin validation via getCorsHeaders(req)"
provides:
  - "Garmin webhook shared secret validation (GARMIN_WEBHOOK_SECRET)"
  - "JWT auth with service-role fallback for hevy-sync, strava-sync, fitbit-sync"
  - "Dual-auth pattern: browser JWT + queue service-role key"
affects: [14-security-hardening, deployment, edge-functions]

# Tech tracking
tech-stack:
  added: []
  patterns: ["Dual-auth: JWT for browser calls, service-role fallback for queue calls", "Conditional webhook secret validation for graceful degradation"]

key-files:
  created: []
  modified:
    - supabase/functions/garmin-webhook/index.ts
    - supabase/functions/hevy-sync/index.ts
    - supabase/functions/strava-sync/index.ts
    - supabase/functions/fitbit-sync/index.ts

key-decisions:
  - "Conditional GARMIN_WEBHOOK_SECRET check -- if env var not set, webhook processes normally (graceful degradation for pre-credential deployment)"
  - "Dual-auth pattern: JWT via auth.getUser() for browser calls, body.user_id fallback for service-role calls from process-sync-queue"
  - "Parse request body before auth to avoid double req.json() call (Request body can only be consumed once)"
  - "Auth client uses SUPABASE_ANON_KEY (not service role) for JWT verification -- service role client kept for DB operations only"

patterns-established:
  - "Dual-auth pattern: all sync functions verify JWT first, fall back to service-role body.user_id"
  - "Webhook secret: conditional env var check at top of POST handler, GET verification remains unauthenticated"

requirements-completed: [SEC-06, SEC-07]

# Metrics
duration: 4min
completed: 2026-02-27
---

# Phase 14 Plan 03: Endpoint Auth Hardening Summary

**Garmin webhook shared secret validation and JWT dual-auth (browser + service-role) for all sync Edge Functions**

## Performance

- **Duration:** 4 min
- **Started:** 2026-02-27T21:06:42Z
- **Completed:** 2026-02-27T21:10:40Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Added GARMIN_WEBHOOK_SECRET validation to Garmin webhook POST handler with graceful degradation
- Implemented dual-auth pattern across hevy-sync, strava-sync, and fitbit-sync Edge Functions
- Browser-initiated calls now extract user_id from JWT (auth.getUser), preventing user_id spoofing
- Queue-initiated calls from process-sync-queue continue to work via service-role key + body.user_id fallback
- Unauthenticated requests to any sync function now return 401

## Task Commits

Each task was committed atomically:

1. **Task 1: Add shared secret validation to Garmin webhook** - `4143994` (feat)
2. **Task 2: Add JWT auth with service-role fallback to hevy-sync, strava-sync, and fitbit-sync** - `1bb4a5e` (feat)

## Files Created/Modified
- `supabase/functions/garmin-webhook/index.ts` - Webhook shared secret validation at top of POST handler
- `supabase/functions/hevy-sync/index.ts` - JWT auth extraction with service-role fallback, userId replaces body.user_id
- `supabase/functions/strava-sync/index.ts` - JWT auth extraction with service-role fallback, userId replaces body.user_id
- `supabase/functions/fitbit-sync/index.ts` - JWT auth extraction with service-role fallback, userId replaces body.user_id

## Decisions Made
- Garmin webhook secret is conditional: if GARMIN_WEBHOOK_SECRET env var is not set, the webhook processes requests normally. This allows deployment before Garmin developer credentials are available.
- Checks both `x-webhook-secret` and `authorization` headers for Garmin secret because the exact header depends on Garmin developer program configuration.
- Request body is parsed once at the top (`await req.json()`) before auth logic, to avoid the Deno Request body double-consumption issue.
- Auth verification uses a separate Supabase client with ANON_KEY (not service role) so that JWT validation works correctly. The service-role client is only used for database operations.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
**GARMIN_WEBHOOK_SECRET environment variable** must be set in Supabase Edge Function secrets for Garmin webhook authentication to activate. Without it, the webhook operates in open mode (graceful degradation).

Set via: `supabase secrets set GARMIN_WEBHOOK_SECRET=your-shared-secret`

**SUPABASE_ANON_KEY** must be available to sync Edge Functions for JWT verification. This is typically auto-injected by Supabase runtime.

## Next Phase Readiness
- All endpoints now require authentication (webhook secret or JWT)
- Ready for Phase 14-04 (OAuth state validation / remaining security hardening)
- process-sync-queue compatibility verified -- its callSyncFunction pattern (service role key + body.user_id) is fully compatible with the dual-auth pattern

## Self-Check: PASSED

All 4 modified files verified present. Both commits (4143994, 1bb4a5e) verified in git log.

---
*Phase: 14-security-hardening*
*Completed: 2026-02-27*
