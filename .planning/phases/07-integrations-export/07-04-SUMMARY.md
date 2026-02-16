---
phase: 07-integrations-export
plan: 04
subsystem: api, integrations
tags: [fitbit, garmin, oauth, oauth-1.0a, edge-functions, zod, normalization, webhook]

# Dependency graph
requires:
  - phase: 07-integrations-export/01
    provides: Integration schema, types, NormalizedActivity, normalizer dispatcher, mutation hooks
provides:
  - Fitbit OAuth 2.0 callback Edge Function with Basic auth token exchange
  - Fitbit activity sync Edge Function with pagination and token refresh
  - Fitbit normalization with Zod validation (ms->s, km->m conversions)
  - Garmin OAuth 1.0a Edge Function with HMAC-SHA1 signature generation
  - Garmin webhook handler for activity push notifications
  - Garmin normalization with Zod validation (epoch->ISO, metric units)
  - Client-side connect functions for both providers
affects: [07-06, 07-07]

# Tech tracking
tech-stack:
  added: []
  patterns: [OAuth 1.0a HMAC-SHA1 signature in Edge Functions, webhook push notification handler, Basic auth token exchange]

key-files:
  created:
    - supabase/functions/fitbit-oauth/index.ts
    - supabase/functions/fitbit-sync/index.ts
    - supabase/functions/garmin-oauth/index.ts
    - supabase/functions/garmin-webhook/index.ts
    - src/lib/integrations/fitbit.ts
    - src/lib/integrations/garmin.ts
  modified:
    - src/lib/integrations/normalize.ts

key-decisions:
  - "Fitbit uses Basic auth header (base64 client_id:client_secret) for token exchange, not JSON body"
  - "Garmin OAuth 1.0a implemented with full HMAC-SHA1 signature generation using Web Crypto API"
  - "Garmin webhook always returns 200 OK to prevent retry storms, logs errors internally"
  - "Garmin OAuth stores request token temporarily in user_integrations during 3-step flow"
  - "Garmin relies on webhook push rather than initial sync queue (unlike Fitbit/Strava)"

patterns-established:
  - "OAuth 1.0a signature generation: HMAC-SHA1 via crypto.subtle in Deno Edge Functions"
  - "Webhook handler pattern: always acknowledge (200), process individually, track errors per activity"
  - "Token proactive refresh: check 10 min before expiry, refresh before API calls"

# Metrics
duration: 4min
completed: 2026-02-16
---

# Phase 07 Plan 04: Fitbit & Garmin Integrations Summary

**Fitbit OAuth 2.0 with sync pagination and Garmin OAuth 1.0a with HMAC-SHA1 signatures plus webhook push handler, both with Zod-validated normalization to NormalizedActivity format**

## Performance

- **Duration:** 4 min
- **Started:** 2026-02-16T17:42:45Z
- **Completed:** 2026-02-16T17:47:15Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments
- Built Fitbit OAuth callback Edge Function with Basic auth token exchange and proper redirect flow
- Built Fitbit sync Edge Function with offset-based pagination, proactive token refresh, and rate limit tracking
- Implemented full Garmin OAuth 1.0a flow with HMAC-SHA1 signature generation using Web Crypto API
- Built Garmin webhook handler that receives activity push notifications and normalizes to external_activities
- Created Zod-validated normalizer for both Fitbit (ms->s, km->m) and Garmin (epoch->ISO, metric)
- Replaced both stubs in normalize.ts with real implementations from dedicated modules

## Task Commits

Each task was committed atomically:

1. **Task 1: Create Fitbit OAuth and sync Edge Functions** - `199b25a` (feat)
2. **Task 2: Create Garmin OAuth and webhook Edge Functions** - `7be9e67` (feat)

## Files Created/Modified
- `supabase/functions/fitbit-oauth/index.ts` - Fitbit OAuth 2.0 callback handler with Basic auth
- `supabase/functions/fitbit-sync/index.ts` - Fitbit activity sync with pagination and token refresh
- `supabase/functions/garmin-oauth/index.ts` - Garmin OAuth 1.0a with HMAC-SHA1 signatures
- `supabase/functions/garmin-webhook/index.ts` - Garmin activity push notification webhook handler
- `src/lib/integrations/fitbit.ts` - Fitbit Zod schema, normalizer, and initiateFitbitConnect
- `src/lib/integrations/garmin.ts` - Garmin Zod schema, normalizer, and initiateGarminConnect
- `src/lib/integrations/normalize.ts` - Replaced Fitbit and Garmin stubs with re-exports from modules

## Decisions Made
- Fitbit uses Basic auth header (base64 of client_id:client_secret) for token exchange per Fitbit API docs, not JSON body like Strava
- Garmin OAuth 1.0a fully implemented with HMAC-SHA1 signature generation using the Web Crypto API (crypto.subtle) available in Deno Edge Functions
- Garmin webhook always returns 200 OK even on errors to prevent Garmin from retrying endlessly; errors are logged server-side
- During Garmin OAuth 1.0a 3-step flow, request token is temporarily stored in user_integrations with 'disconnected' status until the callback completes
- Garmin integration relies on webhook push notifications rather than an initial sync queue (unlike Fitbit and Strava) since Garmin's architecture is push-first
- Token refresh proactively triggers when less than 10 minutes remain before expiry

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

External services require manual configuration before these integrations work:

**Fitbit:**
- Register app at https://dev.fitbit.com/apps/new
- Set OAuth 2.0 Application Type to "Server"
- Set Callback URL to `https://your-project.supabase.co/functions/v1/fitbit-oauth`
- Set env vars: `FITBIT_CLIENT_ID`, `FITBIT_CLIENT_SECRET`

**Garmin:**
- Apply to Garmin Connect Developer Program at https://developer.garmin.com/gc-developer-program/
- Configure webhook URL for activity push
- Set env vars: `GARMIN_CONSUMER_KEY`, `GARMIN_CONSUMER_SECRET`

## Next Phase Readiness
- All four provider normalizers now implemented (Strava, Fitbit, Garmin, Hevy) -- normalize.ts has no remaining stubs
- Edge Functions ready for deployment with `supabase functions deploy`
- Integration management UI (07-06) can use initiateFitbitConnect and initiateGarminConnect
- Export functionality (07-07) can access external_activities from all providers

## Self-Check: PASSED

All 7 files verified present. Both task commits (199b25a, 7be9e67) verified in git log.

---
*Phase: 07-integrations-export*
*Completed: 2026-02-16*
