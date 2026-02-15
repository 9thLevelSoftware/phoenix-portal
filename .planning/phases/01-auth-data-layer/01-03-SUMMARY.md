---
phase: 01-auth-data-layer
plan: 03
subsystem: database
tags: [tanstack-query, zod, react-query, data-transforms]

# Dependency graph
requires:
  - phase: 01-auth-data-layer/01
    provides: Supabase client and stub database types for 7 core tables
provides:
  - QueryClientProvider wrapping App with configured defaults and devtools
  - Hierarchical query key factory for 5 data domains (workouts, records, analytics, routines, cycles)
  - Zod schemas with transforms for all 7 Supabase table types
  - TypeScript types inferred from Zod schemas for component consumption
  - Weight conversion (x2 per-cable to total) centralized in WEIGHT_MULTIPLIER
  - Workout mode enum mapping (DB values to friendly display names)
affects: [01-04-workout-sync, 01-05-routine-sync, 01-06-analytics-sync]

# Tech tracking
tech-stack:
  added: [@tanstack/react-query, @tanstack/react-query-devtools, zod]
  patterns:
    - QueryProvider with staleTime 5min, retry 1, refetchOnWindowFocus false
    - Hierarchical query key factory (queryKeys.domain.method(params))
    - Zod schemas as single source of truth for data transforms
    - WEIGHT_MULTIPLIER constant for per-cable to total weight conversion
    - Inferred TypeScript types from Zod schemas (z.infer<typeof schema>)

key-files:
  created:
    - src/providers/QueryProvider.tsx
    - src/queries/keys.ts
    - src/schemas/transforms.ts
  modified:
    - src/main.tsx
    - package.json

key-decisions:
  - "staleTime 5min with retry 1 balances freshness and API load for development phase"
  - "refetchOnWindowFocus disabled during development, can enable when real data flows"
  - "WEIGHT_MULTIPLIER=2 centralizes per-cable to total conversion in one constant"
  - "Zod inferred types will replace inline interfaces in components"

patterns-established:
  - "Query keys follow queryKeys.domain.method(params) hierarchy for selective invalidation"
  - "All weight fields go through weightTransform for consistent per-cable to total conversion"
  - "Date strings transformed to Date objects at schema boundary"
  - "Duration stored as seconds in DB, transformed to minutes at schema boundary"

# Metrics
duration: 2min
completed: 2026-02-15
---

# Phase 01 Plan 03: TanStack Query & Zod Transforms Summary

**TanStack Query provider with 5-min stale defaults and Zod validation/transform layer converting Supabase per-cable weights (x2), DB enums, and date strings into display-ready models**

## Performance

- **Duration:** 2 min
- **Started:** 2026-02-15T22:48:50Z
- **Completed:** 2026-02-15T22:50:31Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- TanStack Query provider wraps App with sensible defaults (5-min staleTime, retry 1) and devtools
- Query key factory provides hierarchical keys for all 5 data domains
- Zod schemas validate and transform all 7 Supabase table types with weight conversion, mode mapping, date parsing, and duration conversion
- TypeScript types inferred from schemas ready to replace inline component interfaces

## Task Commits

Each task was committed atomically:

1. **Task 1: Install TanStack Query and Zod, create QueryProvider** - `2a02c6a` (feat)
2. **Task 2: Create query key factory and Zod transform schemas** - `6f0f7b3` (feat)

## Files Created/Modified
- `src/providers/QueryProvider.tsx` - QueryClientProvider with configured defaults and ReactQueryDevtools
- `src/queries/keys.ts` - Hierarchical query key factory for workouts, records, analytics, routines, cycles
- `src/schemas/transforms.ts` - Zod schemas with weight (x2), mode mapping, date, and duration transforms
- `src/main.tsx` - Added QueryProvider wrapping App
- `package.json` - Added @tanstack/react-query, zod, @tanstack/react-query-devtools

## Decisions Made

**staleTime 5 minutes with retry 1**
- Rationale: Prevents unnecessary refetching during development. Plan 01-06 realtime sync will handle cache invalidation when live data flows.

**refetchOnWindowFocus disabled**
- Rationale: Avoids aggressive refetching during development. Can be enabled when real Supabase data is connected.

**WEIGHT_MULTIPLIER = 2 centralized in transforms.ts**
- Rationale: Single source of truth for per-cable to total weight conversion. Change to 1 if DB convention changes to store total weight.

**Zod inferred types exported for component use**
- Rationale: Components will use `WorkoutSession`, `PersonalRecord`, etc. from schemas instead of defining inline interfaces, ensuring consistency with transforms.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

**Ready for 01-04, 01-05, 01-06 (data migration plans):**
- QueryProvider installed and wrapping App
- Query key factory covers all 5 data domains for cache management
- Zod schemas ready to validate and transform Supabase query results
- TypeScript types available for component consumption

**Blockers:**
- None

## Self-Check: PASSED

All files and commits verified:
- FOUND: src/providers/QueryProvider.tsx
- FOUND: src/queries/keys.ts
- FOUND: src/schemas/transforms.ts
- FOUND: Commit 2a02c6a (Task 1)
- FOUND: Commit 6f0f7b3 (Task 2)

---
*Phase: 01-auth-data-layer*
*Completed: 2026-02-15*
