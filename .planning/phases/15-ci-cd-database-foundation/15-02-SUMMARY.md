---
phase: 15-ci-cd-database-foundation
plan: 02
subsystem: database
tags: [postgres, rls, supabase, denormalization, typescript, migration]

# Dependency graph
requires:
  - phase: 14-security-hardening
    provides: "Base schema with RLS policies on sets, rep_summaries, rep_telemetry"
provides:
  - "Denormalized user_id columns on sets, rep_summaries, rep_telemetry for direct RLS checks"
  - "Deprecation marker on user_subscriptions table (DB-01)"
  - "Updated database.types.ts with new user_id columns"
affects: [portal-queries, api-endpoints, edge-functions]

# Tech tracking
tech-stack:
  added: []
  patterns: ["RLS denormalization with (select auth.uid()) initPlan caching", "3-step migration: ADD COLUMN -> backfill -> SET NOT NULL"]

key-files:
  created:
    - "supabase/migrations/20260228_rls_denormalization.sql"
  modified:
    - "src/lib/database.types.ts"

key-decisions:
  - "Deprecated user_subscriptions via SQL COMMENT rather than DROP (mobile app safety)"
  - "Included rep_telemetry denormalization despite not being explicitly in DB-02 (identical anti-pattern, minimal cost)"
  - "Used (select auth.uid()) wrapper for PostgreSQL initPlan caching per Supabase performance guide"
  - "Create new RLS policy before dropping old to avoid security gap window"

patterns-established:
  - "RLS denormalization: add user_id directly to tables that need per-user access checks, avoid multi-hop JOINs"
  - "3-step nullable migration: ADD COLUMN nullable -> backfill -> ALTER SET NOT NULL"
  - "initPlan caching: always wrap auth.uid() in (select ...) for RLS policies"

requirements-completed: [DB-01, DB-02]

# Metrics
duration: 3min
completed: 2026-02-27
---

# Phase 15 Plan 02: RLS Denormalization Summary

**Denormalized user_id onto sets/rep_summaries/rep_telemetry for direct RLS equality checks, deprecated user_subscriptions table, and updated TypeScript types**

## Performance

- **Duration:** 2m 52s
- **Started:** 2026-02-27T21:58:58Z
- **Completed:** 2026-02-27T22:01:50Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Created migration that adds user_id columns to sets, rep_summaries, and rep_telemetry with backfill from existing join paths
- Replaced multi-hop JOIN RLS policies (2-3 hops) with direct user_id equality checks using initPlan caching
- Deprecated user_subscriptions table with SQL COMMENT (safe for mobile app, clear signal to portal devs)
- Updated database.types.ts to reflect new user_id columns on all three tables

## Task Commits

Each task was committed atomically:

1. **Task 1: Create RLS denormalization and subscription deprecation migration** - `867e126` (feat)
2. **Task 2: Regenerate database TypeScript types** - `2bcc104` (feat)

## Files Created/Modified
- `supabase/migrations/20260228_rls_denormalization.sql` - RLS denormalization migration with 4 sections: deprecation + 3 table denormalizations
- `src/lib/database.types.ts` - Added user_id to sets, rep_summaries, rep_telemetry Row/Insert/Update types

## Decisions Made
- **Deprecated vs dropped user_subscriptions:** The mobile app may still use user_subscriptions (RevenueCat). Deprecation via SQL COMMENT is the safe choice -- marks it clearly for portal devs without breaking mobile.
- **Included rep_telemetry:** Although DB-02 only explicitly mentions sets and rep_summaries, rep_telemetry has the identical 3-hop JOIN anti-pattern. Including it now avoids a future single-table migration for minimal extra cost.
- **initPlan caching pattern:** All RLS policies use `(select auth.uid())` wrapper instead of bare `auth.uid()` for ~20x performance improvement per Supabase docs.
- **Policy ordering:** New policies are created before old ones are dropped to avoid any security gap window.
- **Manual type update:** gen:types pulled from remote DB (pre-migration schema), so user_id columns were added manually to database.types.ts.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- `npm run gen:types` succeeded but pulled the current remote schema (without the migration applied), so the regenerated types did not include user_id columns. Fell back to the plan's manual update path, which was already specified as the expected fallback.

## User Setup Required

None - no external service configuration required. The migration must be applied to the Supabase project via `supabase db push` or through the Supabase dashboard before the new RLS policies take effect.

## Next Phase Readiness
- Database schema is ready for direct user_id RLS checks in portal queries
- TypeScript types are in sync with the planned schema
- Migration must be applied to remote DB before queries relying on user_id columns

## Self-Check: PASSED

All files verified present, all commits verified in git log.

---
*Phase: 15-ci-cd-database-foundation*
*Completed: 2026-02-27*
