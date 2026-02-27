---
phase: 14-security-hardening
plan: 02
subsystem: api
tags: [cors, security, edge-functions, deno, stripe]

# Dependency graph
requires:
  - phase: 11-external-integrations
    provides: "Edge Functions with wildcard CORS headers"
provides:
  - "Dynamic CORS origin validation via getCorsHeaders(req)"
  - "Hardened Stripe redirect URLs using APP_URL env var"
  - "Static corsHeaders fallback for server-to-server endpoints"
affects: [14-security-hardening, deployment, edge-functions]

# Tech tracking
tech-stack:
  added: []
  patterns: ["Dynamic CORS origin validation with whitelist", "APP_URL env var for redirect URLs"]

key-files:
  created: []
  modified:
    - supabase/functions/_shared/cors.ts
    - supabase/functions/stripe-checkout/index.ts
    - supabase/functions/stripe-portal/index.ts
    - supabase/functions/strava-sync/index.ts
    - supabase/functions/fitbit-oauth/index.ts
    - supabase/functions/fitbit-sync/index.ts
    - supabase/functions/garmin-oauth/index.ts
    - supabase/functions/garmin-webhook/index.ts
    - supabase/functions/hevy-sync/index.ts
    - supabase/functions/process-sync-queue/index.ts

key-decisions:
  - "Strict equality origin matching instead of regex to prevent subdomain bypass attacks"
  - "Empty string for disallowed origins instead of omitting header, so browser blocks the request"
  - "Vary: Origin header to prevent CDN/proxy caching a response for the wrong origin"
  - "Static corsHeaders export retained for non-browser endpoints (webhooks, cron)"
  - "strava-oauth excluded from CORS migration since it only uses 302 redirects, no JSON responses"

patterns-established:
  - "Dynamic CORS: all browser-facing Edge Functions use getCorsHeaders(req) at handler top"
  - "Redirect URLs: Stripe checkout/portal use APP_URL env var, never request origin header"

requirements-completed: [SEC-01, SEC-08]

# Metrics
duration: 5min
completed: 2026-02-27
---

# Phase 14 Plan 02: CORS Hardening Summary

**Dynamic CORS origin validation replacing wildcard '*' across all Edge Functions, with Stripe redirect URL hardening via APP_URL env var**

## Performance

- **Duration:** 5 min
- **Started:** 2026-02-27T20:58:15Z
- **Completed:** 2026-02-27T21:03:29Z
- **Tasks:** 2
- **Files modified:** 10

## Accomplishments
- Eliminated wildcard CORS (`Access-Control-Allow-Origin: *`) across all Edge Functions
- Implemented dynamic origin validation with whitelist derived from APP_URL env var
- Fixed Stripe redirect URL origin-injection vulnerability in checkout and portal functions
- Preserved backwards compatibility with static corsHeaders export for non-browser endpoints

## Task Commits

Each task was committed atomically:

1. **Task 1: Replace wildcard CORS module with dynamic origin validation** - `a42d64d` (feat)
2. **Task 2: Migrate all 9 browser-facing Edge Functions to dynamic CORS and fix Stripe redirects** - `660fad5` (feat)

## Files Created/Modified
- `supabase/functions/_shared/cors.ts` - Dynamic getCorsHeaders(req) with origin whitelist + static corsHeaders fallback
- `supabase/functions/stripe-checkout/index.ts` - Dynamic CORS + APP_URL for success/cancel redirect URLs
- `supabase/functions/stripe-portal/index.ts` - Dynamic CORS + APP_URL for return URL
- `supabase/functions/strava-sync/index.ts` - Dynamic CORS migration
- `supabase/functions/fitbit-oauth/index.ts` - Dynamic CORS for OPTIONS handler
- `supabase/functions/fitbit-sync/index.ts` - Dynamic CORS migration
- `supabase/functions/garmin-oauth/index.ts` - Dynamic CORS for OPTIONS and error responses
- `supabase/functions/garmin-webhook/index.ts` - Dynamic CORS migration
- `supabase/functions/hevy-sync/index.ts` - Dynamic CORS migration
- `supabase/functions/process-sync-queue/index.ts` - Dynamic CORS migration

## Decisions Made
- Used strict equality matching for origin validation (not regex) to prevent subdomain bypass attacks
- Empty string for disallowed origins causes browser to block the request automatically
- Added `Vary: Origin` header to prevent CDN/proxy from caching responses for the wrong origin
- Retained static `corsHeaders` export as fallback for server-to-server endpoints (webhook, cron)
- Excluded strava-oauth from CORS migration (redirect-only function, no CORS headers needed)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
**APP_URL environment variable must be set in Supabase Edge Function secrets** for production deployment. This variable determines:
- Which origins are allowed for CORS (the production domain)
- Where Stripe redirects users after checkout/portal sessions

Set via: `supabase secrets set APP_URL=https://your-production-domain.com`

## Next Phase Readiness
- CORS hardening complete across all browser-facing Edge Functions
- Ready for Phase 14-03 (input validation/sanitization) and 14-04 (OAuth state validation)
- APP_URL env var required in deployment environment before going live

## Self-Check: PASSED

All 11 files verified present. Both commits (a42d64d, 660fad5) verified in git log.

---
*Phase: 14-security-hardening*
*Completed: 2026-02-27*
