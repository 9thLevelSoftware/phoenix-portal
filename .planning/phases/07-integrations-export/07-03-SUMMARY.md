---
phase: 07-integrations-export
plan: 03
subsystem: integrations, ui
tags: [hevy, csv-import, api-key, react-papaparse, zod, edge-functions, strength-training]

# Dependency graph
requires:
  - phase: 07-integrations-export/01
    provides: Integration database schema, NormalizedActivity type, query/mutation hooks
provides:
  - Hevy sync Edge Function with API key authentication
  - Hevy CSV parser (parseHevyCSV) with lbs-to-kg conversion
  - Hevy API normalizer (normalizeHevyActivity) with Zod validation
  - HevyConnect UI component with dual path (API + CSV import)
affects: [07-06, 07-07]

# Tech tracking
tech-stack:
  added: [react-papaparse]
  patterns: [CSV file upload with preview, dual-path integration (API + CSV fallback), API key auth Edge Function]

key-files:
  created:
    - supabase/functions/hevy-sync/index.ts
    - src/lib/integrations/hevy.ts
    - src/app/components/integrations/HevyConnect.tsx
  modified:
    - src/lib/integrations/normalize.ts

key-decisions:
  - "CSV import is default tab (accessible to all users); API key tab secondary (Hevy PRO only)"
  - "Weight conversion from lbs to kg applied during CSV parsing (Hevy exports in lbs)"
  - "File upload uses native FileReader + parseHevyCSV instead of CSVReader component for simpler integration"
  - "Import preview shows count, date range, and total duration before confirming"

patterns-established:
  - "Dual-path integration: API sync for premium users + CSV fallback for all users"
  - "CSV preview-then-confirm pattern: parse -> show stats -> user confirms -> upsert"
  - "API key Edge Function pattern: store key, then use for sync requests"

# Metrics
duration: 5min
completed: 2026-02-16
---

# Phase 07 Plan 03: Hevy Integration Summary

**Hevy dual-path integration with CSV parser (lbs-to-kg, row grouping by workout), API key sync Edge Function, and tabbed UI component defaulting to CSV import**

## Performance

- **Duration:** 5 min
- **Started:** 2026-02-16T17:42:22Z
- **Completed:** 2026-02-16T17:47:12Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Created Hevy sync Edge Function with API key storage, graceful 401/403 handling, and sync queue integration
- Built CSV parser that groups Hevy export rows by workout (title + start_time), converts lbs to kg and miles to meters
- Implemented normalizeHevyActivity with Zod schema validation for API response path, replacing stub in normalize.ts
- Built HevyConnect UI with tabbed interface: CSV import (default) with file upload, preview, and confirm flow; API key tab with PRO subscription notice

## Task Commits

Each task was committed atomically:

1. **Task 1: Create Hevy sync Edge Function and normalization** - `199b25a` (feat) -- committed alongside 07-04 Fitbit work as files were created in same session
2. **Task 2: Create Hevy connection UI with CSV import** - `e00eb72` (feat)

## Files Created/Modified
- `supabase/functions/hevy-sync/index.ts` - Edge Function: API key auth, Hevy API fetch, activity normalization and upsert
- `src/lib/integrations/hevy.ts` - parseHevyCSV (row grouping, unit conversion), normalizeHevyActivity (Zod), HevyExerciseDetail type
- `src/app/components/integrations/HevyConnect.tsx` - Tabbed UI with CSV upload/preview and API key connection
- `src/lib/integrations/normalize.ts` - Replaced Hevy stub with re-export from hevy.ts

## Decisions Made
- CSV import is the default tab since most users will not have Hevy PRO; API key tab is secondary
- Used native FileReader + parseHevyCSV rather than react-papaparse's CSVReader component for simpler control flow
- Weight values converted from lbs to kg during parsing (Hevy exports in imperial units)
- Import preview shows workout count, date range, and total duration to help users verify before committing
- CSV rows grouped by title + start_time to deduplicate sets into a single workout activity

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Task 1 files already committed in prior session**
- **Found during:** Task 1 commit attempt
- **Issue:** hevy.ts, hevy-sync/index.ts, and normalize.ts changes were already committed at 199b25a as part of 07-04 execution
- **Fix:** Verified file contents match plan requirements, proceeded to Task 2
- **Files modified:** None (already committed)
- **Verification:** Build passes, all must_have patterns present

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** No scope change. Task 1 artifacts were already present and correct from a prior execution.

## Issues Encountered

None.

## User Setup Required

None for CSV import path. For API key path:
- Requires Hevy PRO subscription
- API key generated in Hevy Settings -> API
- ENV var `HEVY_API_KEY` only needed if using server-side sync

## Next Phase Readiness
- Hevy integration complete with both API and CSV paths
- HevyConnect component ready for integration management page (07-06)
- parseHevyCSV available for any import workflows
- normalizeHevyActivity ready for API sync path when Hevy PRO access is confirmed

## Self-Check: PASSED

All 4 files verified present. Both task commits (199b25a, e00eb72) verified in git log.

---
*Phase: 07-integrations-export*
*Completed: 2026-02-16*
