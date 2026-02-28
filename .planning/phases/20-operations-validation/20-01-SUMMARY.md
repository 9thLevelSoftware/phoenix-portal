---
phase: 20-operations-validation
plan: 01
subsystem: infra
tags: [ci, npm, peer-deps, supabase, data-export, gdpr]

# Dependency graph
requires:
  - phase: 15-database
    provides: "Denormalized user_id columns on sets, rep_summaries, rep_telemetry tables"
  - phase: 17-data-privacy
    provides: "data-export.ts with cascading join-path queries"
provides:
  - "Working CI pipeline with legacy peer deps and build env stubs"
  - "Optimized data export using direct user_id queries instead of cascading joins"
affects: [ci, data-export, operations]

# Tech tracking
tech-stack:
  added: []
  patterns: ["npmrc legacy-peer-deps for visx React 19 conflict", "stub env vars for CI build validation"]

key-files:
  created: [".npmrc"]
  modified: [".github/workflows/ci.yml", "src/lib/export/data-export.ts"]

key-decisions:
  - "Stub Supabase env vars (not real secrets) sufficient for CI build validation"
  - "TOTAL_STEPS unchanged at 23 despite query refactor (same number of progress steps per path)"

patterns-established:
  - "CI build uses stub env vars for validation-only builds (not deployment)"
  - "Denormalized user_id queries preferred over cascading join-paths when column exists"

requirements-completed: []

# Metrics
duration: 1m 41s
completed: 2026-02-28
---

# Phase 20 Plan 01: CI Pipeline Fix and Data Export Query Optimization Summary

**Fixed CI npm ci peer dep failures via .npmrc, added build env stubs, and optimized data-export.ts to use denormalized user_id queries**

## Performance

- **Duration:** 1m 41s
- **Started:** 2026-02-28T16:15:12Z
- **Completed:** 2026-02-28T16:16:53Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- Created `.npmrc` with `legacy-peer-deps=true` to fix all CI jobs failing on `npm ci` due to visx React 19 peer dependency conflict
- Added stub `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` env vars to CI build step so Vite can inline Supabase config
- Refactored data-export.ts to query sets, rep_summaries, and rep_telemetry directly via `.eq("user_id", userId)` instead of cascading through exerciseIds/setIds
- Eliminated `exerciseIds` and `setIds` intermediary variables entirely while preserving exercises join-path via workoutIds

## Task Commits

Each task was committed atomically:

1. **Task 1: Fix CI pipeline -- .npmrc and build env vars** - `bcf2da7` (fix)
2. **Task 2: Optimize data-export.ts to use denormalized user_id columns** - `7662e96` (refactor)

## Files Created/Modified
- `.npmrc` - Legacy peer deps flag for CI compatibility with visx React 19 conflict
- `.github/workflows/ci.yml` - Added VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY stub env vars to build step
- `src/lib/export/data-export.ts` - Replaced cascading join-path queries with direct user_id queries for sets, rep_summaries, rep_telemetry

## Decisions Made
- Stub Supabase env vars (not real secrets) are sufficient for CI build validation -- the build step confirms the codebase compiles, deployment is a separate concern
- TOTAL_STEPS count (23) remains unchanged despite the refactor -- each conditional/unconditional path still produces exactly one progress step

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- CI pipeline should now pass all `npm ci` steps (verifiable on next push)
- Data export queries are optimized for the denormalized schema from Phase 15
- Ready for remaining 20-02, 20-03, 20-04 plans

## Self-Check: PASSED

All files verified present. All commit hashes verified in git log.

---
*Phase: 20-operations-validation*
*Completed: 2026-02-28*
