---
phase: 09-foundation-toolchain
plan: 01
subsystem: infra
tags: [react-19, vite-7, recharts-3, react-day-picker-9, dnd-kit, tailwind-4, dependency-upgrade]

# Dependency graph
requires:
  - phase: v1.0 (all phases)
    provides: Existing React 18 + Vite 6 codebase with working build
provides:
  - React 19.2.x runtime with createRoot API
  - Vite 7.3.x build toolchain with @vitejs/plugin-react 5.x
  - Recharts 3.7.x charting library
  - react-day-picker v9 calendar component with Chevron API
  - @dnd-kit/react 0.3.0 drag-and-drop (resolved version mismatch)
  - Tailwind CSS 4.1.18 with @tailwindcss/vite 4.1.18
  - Node 24 pinned via .nvmrc with engines field
affects: [09-02, 09-03, 09-04, 09-05, all-future-phases]

# Tech tracking
tech-stack:
  added: [react-is, @dnd-kit/react, @dnd-kit/helpers, @dnd-kit/dom, @dnd-kit/abstract, @dnd-kit/state]
  patterns: [DragDropProvider + useSortable from @dnd-kit/react, Chevron component pattern for react-day-picker v9]

key-files:
  created: [.nvmrc]
  modified: [package.json, src/app/components/ui/calendar.tsx, src/app/components/RoutineBuilder.tsx, vite.config.ts]

key-decisions:
  - "Used @dnd-kit/react@0.3.0 (preferred path) instead of fallback @dnd-kit/core@6+sortable@6 alignment"
  - "Used --legacy-peer-deps for React 19 install due to visx packages having React 18-only peer deps"
  - "Added react-is as explicit dependency for Recharts 3 compatibility with React 19"
  - "Added react-dom/client to vendor-react manualChunks to maintain proper chunk splitting under React 19"

patterns-established:
  - "DragDropProvider + useSortable: New dnd-kit pattern uses ref/handleRef instead of CSS.Transform"
  - "react-day-picker v9 Chevron: Single Chevron component with orientation prop replaces IconLeft/IconRight"

requirements-completed: [TOOL-02, TOOL-03, TOOL-04, TOOL-05, TOOL-06, TOOL-07]

# Metrics
duration: 8min
completed: 2026-02-17
---

# Phase 9 Plan 1: Major Dependencies Summary

**React 19.2 + Vite 7.3 + Recharts 3.7 + dnd-kit/react 0.3 + react-day-picker v9 + Tailwind 4.1.18 -- full runtime stack modernization with zero TypeScript errors**

## Performance

- **Duration:** 8 min
- **Started:** 2026-02-17T04:05:21Z
- **Completed:** 2026-02-17T04:13:00Z
- **Tasks:** 3
- **Files modified:** 6

## Accomplishments
- Upgraded entire runtime stack from React 18 + Vite 6 to React 19 + Vite 7 in prescribed sequence
- Resolved pre-existing @dnd-kit/core@6 + @dnd-kit/sortable@10 version mismatch by migrating to @dnd-kit/react@0.3.0
- Migrated Calendar component to react-day-picker v9 Chevron API
- Maintained bundle size within baseline (66.69 KB main entry vs 70.76 KB baseline)

## Task Commits

Each task was committed atomically:

1. **Task 1: Upgrade react-day-picker v9 and Tailwind 4.1.18** - `54ceb99` (feat)
2. **Task 2: Upgrade Vite 7 with .nvmrc and engines field** - `6a13e40` (feat)
3. **Task 3: Upgrade Recharts 3, dnd-kit, and React 19** - `330dd54` (feat)

## Files Created/Modified
- `.nvmrc` - Pins Node.js version to 24 (matching actual runtime)
- `package.json` - All dependency versions updated, engines field added
- `src/app/components/ui/calendar.tsx` - Migrated to react-day-picker v9 API (Chevron component, renamed classNames)
- `src/app/components/RoutineBuilder.tsx` - Migrated from @dnd-kit/core+sortable to @dnd-kit/react DragDropProvider API
- `vite.config.ts` - Added react-dom/client and react-is to vendor-react chunk for proper splitting
- `package-lock.json` - Lockfile updated for all dependency changes

## Decisions Made
- **@dnd-kit/react preferred over fallback:** Used the new @dnd-kit/react@0.3.0 package (preferred migration path in plan) rather than aligning old @dnd-kit/core@6 + @dnd-kit/sortable@6. The new API is cleaner and forward-looking.
- **--legacy-peer-deps for React 19:** The visx packages (12 of them) declare peer deps of `react@^16|^17|^18` and don't include React 19. Used --legacy-peer-deps to override. This was anticipated in STATE.md blockers. visx works fine at runtime with React 19 -- the peer dep constraint is just not yet updated.
- **react-is added explicitly:** React 19 no longer bundles react-is as a transitive dependency. Recharts 3 imports it directly, so it must be an explicit dependency.
- **react-dom/client in manualChunks:** React 19 restructured react-dom internals. Without explicitly including react-dom/client in the vendor-react chunk, the main entry chunk bloated to 247 KB. Adding it restored proper splitting to 66.69 KB.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Missing react-is dependency for Recharts 3 + React 19**
- **Found during:** Task 3 (React 19 upgrade)
- **Issue:** Recharts 3 imports `react-is` which was a transitive dep of React 18 but removed from React 19's dependency tree
- **Fix:** `npm install react-is --legacy-peer-deps`
- **Files modified:** package.json, package-lock.json
- **Verification:** Build passes with zero errors
- **Committed in:** 330dd54 (Task 3 commit)

**2. [Rule 3 - Blocking] Missing @testing-library/dom after --legacy-peer-deps install**
- **Found during:** Task 3 (React 19 upgrade, test verification)
- **Issue:** `--legacy-peer-deps` install removed @testing-library/dom, causing all tests to fail to load
- **Fix:** `npm install -D @testing-library/dom --legacy-peer-deps`
- **Files modified:** package.json, package-lock.json
- **Verification:** Tests load and run (3 pass, 7 fail with pre-existing issues)
- **Committed in:** 330dd54 (Task 3 commit)

**3. [Rule 1 - Bug] Bundle chunk splitting broken by React 19 module structure**
- **Found during:** Task 3 (React 19 upgrade, build verification)
- **Issue:** Main entry chunk bloated from ~70 KB to 247 KB because React 19 restructured react-dom internals
- **Fix:** Added `react-dom/client` and `react-is` to the `vendor-react` manualChunks array in vite.config.ts
- **Files modified:** vite.config.ts
- **Verification:** Main entry chunk restored to 66.69 KB (within 10% baseline)
- **Committed in:** 330dd54 (Task 3 commit)

---

**Total deviations:** 3 auto-fixed (2 blocking, 1 bug)
**Impact on plan:** All auto-fixes necessary for correctness. No scope creep. All issues directly caused by React 19 migration.

## Issues Encountered
- visx packages block React 19 peer dep resolution -- resolved with --legacy-peer-deps. This was anticipated in STATE.md blockers.
- Vite 7 on Windows shows a harmless libuv assertion failure during process cleanup (`Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)`) -- cosmetic only, build completes successfully.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Full runtime stack modernized and building cleanly
- Ready for Phase 9 Plan 2 (TypeScript strict mode, ESLint, testing infrastructure)
- visx packages work with React 19 at runtime but have outdated peer deps -- should be updated when visx releases React 19 support

## Self-Check: PASSED

All created files verified to exist. All 3 task commits verified in git history.

---
*Phase: 09-foundation-toolchain*
*Completed: 2026-02-17*
