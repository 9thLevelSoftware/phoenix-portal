---
phase: 11-new-features
plan: 02
subsystem: ui
tags: [onboarding, dialog, radix, motion, zod, supabase, tanstack-query]

requires:
  - phase: 09-foundation-toolchain
    provides: "Radix Dialog, motion animations, Zod schemas, TanStack Query patterns"
  - phase: 10-wire-up-mock-purge
    provides: "Confirmed mutation pattern (not optimistic), AuthProvider, query key factory"
provides:
  - "user_onboarding table with RLS for persistence"
  - "useOnboarding hook with 4-scenario detection tree"
  - "OnboardingOverlay 3-step Dialog for new users"
  - "WhatsNewBanner for returning v1.0 users"
  - "FeatureHint reusable tooltip wrapper for feature discovery"
  - "AppLayout integration conditionally rendering onboarding/banner"
affects: [11-new-features, future-feature-plans]

tech-stack:
  added: []
  patterns: ["onboarding state detection via user_onboarding + workout_sessions count", "JSONB dismissed_hints for granular hint tracking", "upsert with onConflict for idempotent onboarding writes"]

key-files:
  created:
    - supabase/migrations/20260217_phase11_onboarding.sql
    - src/schemas/onboarding.ts
    - src/queries/onboarding.ts
    - src/hooks/useOnboarding.ts
    - src/app/components/OnboardingOverlay.tsx
    - src/app/components/WhatsNewBanner.tsx
    - src/app/components/FeatureHint.tsx
  modified:
    - src/lib/database.types.ts
    - src/queries/keys.ts
    - src/app/routes/AppLayout.tsx

key-decisions:
  - "Onboarding detection uses 4-scenario tree: new user, v1.0 mobile user, v1.0 web user, v1.1 user"
  - "WhatsNewBanner auto-creates onboarding row on dismiss (v1.0 mobile users never had one)"
  - "FeatureHint is a passive reusable component -- no hints are placed in this plan; feature plans add them"
  - "completeOnboarding and dismissWhatsNew both upsert with version_seen=1.1 for idempotent state"

patterns-established:
  - "Onboarding detection pattern: query onboarding row -> conditionally query workout count -> derive state"
  - "JSONB field pattern for granular dismissal tracking (dismissed_hints)"

requirements-completed: [ONBD-01, ONBD-02, ONBD-03, ONBD-04, ONBD-05, ONBD-06]

duration: 5min
completed: 2026-02-17
---

# Phase 11 Plan 02: Onboarding Flow Summary

**3-step onboarding Dialog for new users, What's New banner for returning v1.0 users, reusable FeatureHint tooltips, and user_onboarding persistence layer with 4-scenario detection hook**

## Performance

- **Duration:** 5 min
- **Started:** 2026-02-17T19:31:55Z
- **Completed:** 2026-02-17T19:37:12Z
- **Tasks:** 2
- **Files modified:** 10

## Accomplishments
- Built complete onboarding state detection layer (migration, schema, queries, hook) with 4-scenario decision tree
- Created 3-step OnboardingOverlay Dialog with AnimatePresence transitions, progress dots, skip/next buttons
- Created WhatsNewBanner with Phoenix gradient styling and slide animation for v1.0 users
- Created reusable FeatureHint tooltip component for feature-specific discovery hints
- Integrated all onboarding components into AppLayout with conditional rendering

## Task Commits

Each task was committed atomically:

1. **Task 1: Database migration + onboarding state detection hook + query layer** - `2a8addc` (feat)
2. **Task 2: OnboardingOverlay, WhatsNewBanner, FeatureHints, AppLayout integration** - `fc3f3d5` (feat)

## Files Created/Modified
- `supabase/migrations/20260217_phase11_onboarding.sql` - user_onboarding table with RLS policies
- `src/lib/database.types.ts` - Added user_onboarding type stub
- `src/schemas/onboarding.ts` - Zod schema with date transforms for onboarding rows
- `src/queries/keys.ts` - Added onboarding query key factory
- `src/queries/onboarding.ts` - onboardingOptions and hasWorkoutsOptions query functions
- `src/hooks/useOnboarding.ts` - 4-scenario detection hook with complete/dismiss/hint mutations
- `src/app/components/OnboardingOverlay.tsx` - 3-step Dialog overlay with motion step transitions
- `src/app/components/WhatsNewBanner.tsx` - Dismissible v1.1 feature announcement banner
- `src/app/components/FeatureHint.tsx` - Reusable Tooltip wrapper for feature discovery
- `src/app/routes/AppLayout.tsx` - Conditional rendering of onboarding overlay and banner

## Decisions Made
- Onboarding detection uses a 4-scenario tree: (1) no row + no workouts = new user, (2) no row + has workouts = v1.0 mobile user, (3) row + old version = v1.0 web user, (4) row + v1.1 = nothing needed
- WhatsNewBanner auto-creates an onboarding row on dismiss since v1.0 mobile users never had one
- FeatureHint is passive -- no hints are placed in this plan; individual feature plans (goals, recovery, etc.) will wrap their UI elements with FeatureHint
- Both completeOnboarding and dismissWhatsNew use upsert with version_seen='1.1' for idempotent state transitions
- hasWorkoutsOptions only fires when onboarding row is null (minimizes unnecessary queries)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- Pre-existing test failures (10 "renders without crashing" tests fail due to missing React Router context in test wrappers). Not caused by onboarding changes -- out of scope.

## User Setup Required

None - no external service configuration required. The migration file must be applied to the Supabase project before onboarding state persists (requires `supabase db push` or manual SQL execution in Supabase dashboard).

## Next Phase Readiness
- Onboarding infrastructure complete; future feature plans can wrap elements with `<FeatureHint>` for discovery
- The `useOnboarding` hook is globally available for any component needing onboarding state
- Migration needs to be applied to Supabase before onboarding persists (existing non-blocking item)

## Self-Check: PASSED

- All 10 created/modified files verified on disk
- Commit `2a8addc` (Task 1) verified in git log
- Commit `fc3f3d5` (Task 2) verified in git log

---
*Phase: 11-new-features*
*Completed: 2026-02-17*
