---
phase: 07-integrations-export
plan: 02
subsystem: api, ui
tags: [strava, oauth, edge-functions, deno, activity-sync, token-refresh, zod]

# Dependency graph
requires:
  - phase: 07-01
    provides: Integration database schema, NormalizedActivity types, Strava normalizer, query/mutation hooks
provides:
  - Strava OAuth callback Edge Function (token exchange + storage)
  - Strava activity sync Edge Function (fetch, normalize, upsert)
  - Client-side Strava OAuth initiation with redirect flow
  - StravaConnect React component for integration UI
affects: [07-06, 07-07]

# Tech tracking
tech-stack:
  added: []
  patterns: [OAuth callback via Edge Function redirect, token refresh before API call, activity normalization in Edge Function]

key-files:
  created:
    - supabase/functions/strava-oauth/index.ts
    - supabase/functions/strava-sync/index.ts
    - src/lib/integrations/strava.ts
    - src/app/components/integrations/StravaConnect.tsx
  modified:
    - .env.example

key-decisions:
  - "OAuth callback uses service role client (not anon key) since no user JWT is present during redirect"
  - "Sync function duplicates normalizer logic for Deno runtime independence from Vite app"
  - "Token refresh has 60-second buffer before expiry to prevent mid-request expiration"
  - "Initial sync queued as non-fatal in OAuth callback - tokens saved even if queue fails"
  - "StravaConnect uses Strava brand color (#FC4C02) for visual identity"

patterns-established:
  - "OAuth Edge Function pattern: receive code+state, exchange tokens, upsert, queue sync, redirect"
  - "Sync Edge Function pattern: fetch tokens, refresh if expired, fetch API, normalize, upsert activities"
  - "Client OAuth initiation: build URL with client_id, redirect_uri, scope, state=userId, then redirect"

# Metrics
duration: 3min
completed: 2026-02-16
---

# Phase 07 Plan 02: Strava OAuth Integration Summary

**Strava OAuth callback and activity sync Edge Functions with client-side connection flow, token refresh handling, and StravaConnect React component**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-16T17:42:28Z
- **Completed:** 2026-02-16T17:45:23Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- Created Strava OAuth callback Edge Function that exchanges authorization codes for tokens, stores them via service role client, and queues initial sync
- Built Strava activity sync Edge Function with token refresh, paginated activity fetch, normalization, and deduplication upsert to external_activities
- Implemented client-side initiateStravaConnect function with proper OAuth URL construction (client_id, redirect_uri, scope, state)
- Created StravaConnect React component with connect/disconnect states, loading indicator, and Strava brand styling

## Task Commits

Each task was committed atomically:

1. **Task 1: Create Strava OAuth Edge Function** - `6ac3c90` (feat)
2. **Task 2: Create Strava sync function and client-side connection** - `bc1751f` (feat)

## Files Created/Modified
- `supabase/functions/strava-oauth/index.ts` - OAuth callback handler with token exchange, storage, and sync queueing
- `supabase/functions/strava-sync/index.ts` - Activity sync with token refresh, API fetch, normalization, and upsert
- `src/lib/integrations/strava.ts` - Client-side Strava library with OAuth initiation, Zod schema, and re-exported normalizer
- `src/app/components/integrations/StravaConnect.tsx` - Connect button component with connected/disconnected/loading states
- `.env.example` - Added VITE_STRAVA_CLIENT_ID placeholder

## Decisions Made
- OAuth callback Edge Function uses service role client since the redirect flow has no user JWT available; user_id is passed via OAuth state parameter
- Strava sync Edge Function duplicates the normalizer logic from src/lib/integrations/normalize.ts because Edge Functions run in Deno, not the Vite app -- keeping them independent avoids cross-runtime import issues
- Token refresh includes a 60-second buffer before expiry to prevent mid-request token expiration during activity fetch
- Initial sync queue insertion in OAuth callback is non-fatal: if queueing fails, tokens are still saved and the user can trigger manual sync later
- StravaConnect component uses Strava's official brand color (#FC4C02) for the connect button

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

Strava OAuth integration requires external configuration:
- Create Strava API Application at https://www.strava.com/settings/api
- Set Authorization Callback Domain to your Supabase project domain
- Add STRAVA_CLIENT_ID and STRAVA_CLIENT_SECRET to Edge Function environment variables
- Add VITE_STRAVA_CLIENT_ID to .env.local for client-side OAuth URL construction
- Add APP_URL to Edge Function environment variables for post-OAuth redirect

## Next Phase Readiness
- Strava OAuth flow is complete end-to-end (client redirect -> token exchange -> storage -> sync)
- StravaConnect component ready for integration management page (07-06)
- Sync function pattern established for Fitbit (07-03) and Garmin (07-04) implementations
- Token refresh pattern reusable for all OAuth providers

## Self-Check: PASSED

All 5 files verified present. Both task commits (6ac3c90, bc1751f) verified in git log.

---
*Phase: 07-integrations-export*
*Completed: 2026-02-16*
