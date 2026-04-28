---
phase: quick-3
plan: 1
subsystem: testing
tags: [playwright, e2e, public-pages, auth-redirect, navigation]

# Dependency graph
requires:
  - phase: 20-04
    provides: "CLAUDE.md documenting route structure and E2E test setup"
provides:
  - "E2E tests for all 4 public pages (landing, privacy, terms, FAQ)"
  - "Auth-gated redirect verification for 6 protected routes"
  - "Footer navigation tests between public pages"
affects: [e2e, ci]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "domcontentloaded wait strategy for pages without backend (avoids networkidle hang)"
    - "waitForTimeout(2000) for framer-motion entrance animation settlement"
    - "Parameterized for-loop test pattern for protected route redirect checks"

key-files:
  created:
    - "e2e/public-pages.spec.ts"
    - "e2e/auth-redirect.spec.ts"
    - "e2e/navigation.spec.ts"
  modified: []

key-decisions:
  - "Used body text length > 200 chars as substantive content check (avoids coupling to specific copy)"
  - "Used exact:true for tier heading assertions to avoid 'Phoenix' matching 'Project Phoenix' h1"
  - "Used .first() on Get Started button to handle hero + pricing CTA duplication"

patterns-established:
  - "Public E2E pattern: gotoPublic helper + domcontentloaded + animation wait"
  - "Auth redirect pattern: parameterized route list + waitForURL('/') + landing content assertion"

requirements-completed: [E2E-PUBLIC, E2E-AUTH-REDIRECT, E2E-NAVIGATION]

# Metrics
duration: 3m 44s
completed: 2026-02-28
---

# Quick Task 3: Add Playwright E2E Tests for Key User Flows Summary

**18 new CI-friendly E2E tests covering public page rendering, auth-gated redirects, and footer navigation -- all pass without Supabase credentials**

## Performance

- **Duration:** 3m 44s
- **Started:** 2026-02-28T17:17:30Z
- **Completed:** 2026-02-28T17:21:14Z
- **Tasks:** 2
- **Files created:** 3

## Accomplishments
- 6 public page tests: landing hero, pricing section, auth dialog, privacy, terms, FAQ rendering
- 7 auth redirect tests: 6 protected routes + unknown route catch-all verified to redirect to /
- 5 navigation tests: footer links (Privacy, Terms, FAQ), back-navigation, cross-page legal page navigation
- All 18 tests pass without Supabase credentials (CI-friendly)
- Console error detection on public pages (pageerror listener)

## Task Commits

Each task was committed atomically:

1. **Task 1: Create public page render and content tests** - `bbe534b` (test)
2. **Task 2: Create auth redirect and navigation tests** - `748db95` (test)

## Files Created/Modified
- `e2e/public-pages.spec.ts` - Landing page hero/pricing/auth dialog + Privacy/Terms/FAQ render tests (177 lines)
- `e2e/auth-redirect.spec.ts` - Protected route redirect verification for 6 routes + unknown route (40 lines)
- `e2e/navigation.spec.ts` - Footer link navigation + back-nav + cross-page legal page tests (107 lines)

## Decisions Made
- Used `page.waitForLoadState('domcontentloaded')` instead of `networkidle` to avoid Supabase connection hangs
- Used `page.waitForTimeout(2000)` for framer-motion entrance animations (delays up to 0.8s + transition)
- Used `exact: true` on heading role assertions where tier names overlap with page title ("Phoenix" vs "Project Phoenix")
- Used `page.locator('body').textContent()` for substantive content checks instead of specific CSS selectors
- Used `page.locator('footer a[href="/privacy"]')` for footer links (more reliable than getByRole for links within list items)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed strict mode violations for duplicate element matches**
- **Found during:** Task 1 (public-pages tests)
- **Issue:** "Get Started" button resolves to 2 elements (hero CTA + pricing Free tier); "Phoenix" heading matches both h1 "Project Phoenix" and h3 "Phoenix"
- **Fix:** Added `.first()` for Get Started button, `exact: true` for tier heading assertions
- **Files modified:** e2e/public-pages.spec.ts
- **Verification:** All 6 tests pass
- **Committed in:** bbe534b (Task 1 commit)

**2. [Rule 1 - Bug] Fixed content length check using wrong selector**
- **Found during:** Task 1 (privacy/terms tests)
- **Issue:** `main, [class*='max-w']` selector matched a small element (19 chars) instead of page content
- **Fix:** Changed to `page.locator('body').textContent()` for reliable full-page content check
- **Files modified:** e2e/public-pages.spec.ts
- **Verification:** Privacy and Terms tests pass with content > 200 chars
- **Committed in:** bbe534b (Task 1 commit)

---

**Total deviations:** 2 auto-fixed (2 bugs in initial test selectors)
**Impact on plan:** Both fixes were necessary for test correctness. No scope creep.

## Issues Encountered

Pre-existing failures in existing E2E tests (NOT caused by this task):
- `a11y.spec.ts` Landing Page: `link-in-text-block` a11y violation (pre-existing)
- `a11y.spec.ts` Community: color contrast violation on Retry button (pre-existing)
- `smoke.spec.ts` compare page: text match failure (pre-existing)

These are out of scope per deviation rules.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- All 18 new E2E tests are CI-friendly (no credentials required)
- Existing smoke.spec.ts and a11y.spec.ts continue to work (pre-existing failures unchanged)
- E2E coverage now includes: public pages, auth redirects, navigation flows

---
*Quick Task: 3*
*Completed: 2026-02-28*

## Self-Check: PASSED

- [x] e2e/public-pages.spec.ts exists (177 lines, min 80)
- [x] e2e/auth-redirect.spec.ts exists (40 lines, min 30)
- [x] e2e/navigation.spec.ts exists (113 lines, min 50)
- [x] 3-SUMMARY.md exists
- [x] Commit bbe534b found
- [x] Commit 748db95 found
