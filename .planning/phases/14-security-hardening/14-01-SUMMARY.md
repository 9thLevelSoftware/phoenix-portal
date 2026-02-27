---
phase: 14-security-hardening
plan: 01
subsystem: infra
tags: [vite, source-maps, sentry, csp, security-headers]

# Dependency graph
requires: []
provides:
  - Hidden source maps preventing source code exposure in production
  - CSP report-only baseline covering all known resource origins
affects: [14-02, 15-ci-cd, 20-operations]

# Tech tracking
tech-stack:
  added: []
  patterns: [hidden-source-maps, csp-report-only-meta-tag]

key-files:
  created: []
  modified: [vite.config.ts, index.html]

key-decisions:
  - "Used meta tag for CSP (not HTTP header) because hosting platform not yet confirmed"
  - "CSP in report-only mode to establish baseline without breaking the app"
  - "unsafe-inline required in style-src for shadcn/ui Radix inline styles"

patterns-established:
  - "CSP report-only before enforcement: add new origins to the meta tag before switching to enforce"
  - "Hidden source maps with post-upload deletion: all future Sentry-integrated builds follow this pattern"

requirements-completed: [SEC-04, SEC-05]

# Metrics
duration: 2min
completed: 2026-02-27
---

# Phase 14 Plan 01: Source Map Concealment & CSP Report-Only Summary

**Hidden source maps via Vite "hidden" mode with Sentry post-upload deletion, plus CSP report-only meta tag covering Supabase, Sentry, Stripe, and Google Fonts origins**

## Performance

- **Duration:** 2 min 26s
- **Started:** 2026-02-27T20:58:18Z
- **Completed:** 2026-02-27T21:00:44Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Production JS bundles no longer contain `//# sourceMappingURL` comments, preventing browsers from discovering .map files
- Sentry plugin configured to delete .map files from dist after upload, so they never reach the CDN
- CSP report-only meta tag covers all 7 directive categories (script-src, style-src, connect-src, font-src, img-src, frame-src, worker-src) with all known external origins

## Task Commits

Each task was committed atomically:

1. **Task 1: Hide source maps from production CDN and configure Sentry upload deletion** - `b31989d` (feat)
2. **Task 2: Add Content Security Policy report-only meta tag** - `0fa1f81` (feat)

## Files Created/Modified
- `vite.config.ts` - Changed `sourcemap: true` to `sourcemap: "hidden"`, added `filesToDeleteAfterUpload` to Sentry plugin
- `index.html` - Added CSP `Content-Security-Policy-Report-Only` meta tag in `<head>`

## Decisions Made
- Used `Content-Security-Policy-Report-Only` meta tag (not HTTP header) because hosting platform is not yet confirmed -- meta tag works regardless of hosting provider
- Included `'unsafe-inline'` in `style-src` because shadcn/ui (Radix UI) uses inline styles for dynamic positioning of popovers, tooltips, and dropdowns
- Report-only mode chosen to establish a violation baseline before enforcing, avoiding any risk of breaking the app

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Source maps are secured for production deployment
- CSP baseline established; violations (if any) will appear in browser console during QA
- Ready for plan 14-02 (CORS origin validation and Stripe redirect hardening)

## Self-Check: PASSED

- All files exist (vite.config.ts, index.html, 14-01-SUMMARY.md)
- All commits verified (b31989d, 0fa1f81)
- All artifact content checks pass (sourcemap hidden, filesToDeleteAfterUpload, CSP meta tag)

---
*Phase: 14-security-hardening*
*Completed: 2026-02-27*
