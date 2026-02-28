---
gsd_state_version: 1.0
milestone: v1.3
milestone_name: RevenueCat Billing Migration
status: executing
last_updated: "2026-02-28T21:20:37.000Z"
progress:
  total_phases: 3
  completed_phases: 1
  total_plans: 8
  completed_plans: 5
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-28)

**Core value:** Premium subscribers see data and insights about their training that they cannot get anywhere else -- force curves, velocity trends, muscle balance analysis, and community-driven workout programming -- making the subscription feel indispensable.
**Current focus:** v1.3 Phase 22 -- UI Migration & Stripe Removal

## Current Position

Phase: 22 of 23 (UI Migration & Stripe Removal)
Plan: 2 of 3 in current phase (22-01, 22-02 complete, 22-03 remaining)
Status: Executing Phase 22
Last activity: 2026-02-28 -- Completed 22-02 (Stripe infrastructure removal: lib, Edge Functions, deps, CSP)

Progress: [████████████░░░░░░░░] 63% (v1.3: 5/8 plans)

## Performance Metrics

**Velocity (v1.0):**
- Total plans completed: 41
- Average duration: 3 min
- Total execution time: ~2 hours

**Velocity (v1.1):**
- Total plans completed: 22
- Average duration: 6.0 min
- Total execution time: ~131 min

**Velocity (v1.2):**
- Total plans completed: 22
- Average duration: 3.1 min
- Total execution time: ~66 min

**Velocity (v1.3):**
- Plans completed: 5
- Average duration: ~2.3 min
- Total execution time: ~11 min

## Accumulated Context

### Decisions

All v1.0/v1.1/v1.2 decisions archived in PROJECT.md Key Decisions table.

v1.3 decisions:
- [milestone] Billing moves entirely to mobile app via RevenueCat; web portal reads subscription status only
- [milestone] Remove all Stripe code completely (not deprecate gradually)
- [milestone] Pricing page becomes "subscribe in app" -- no web checkout
- [milestone] Tier structure unchanged: FREE / PHOENIX / ELITE with same feature gating
- [research] Evolve-in-place strategy (Option A): evolve `subscriptions` table, zero changes to RLS/Realtime/useSubscription interface/15+ consumer components
- [research] Entitlement-based tier mapping (not product-based) -- cross-platform stable
- [research] Zero new npm packages; net reduction (remove @stripe/stripe-js)
- [research] Webhook + manual refresh button to mitigate RevenueCat delivery delays (up to 6h)
- [execution] Used `20260303` date prefix for migration file (after existing `20260302_community_safety.sql`)
- [execution] Extracted pure functions to `src/lib/revenuecat.ts` for testability; Edge Function maintains synced copy (Deno can't import from src/)
- [execution] UI components migrated from Stripe checkout/portal to "subscribe in mobile app" CTAs (22-01)
- [execution] All Stripe infrastructure removed: lib, 3 Edge Functions, @stripe/stripe-js dep, CSP directive, delete-account cleaned (22-02)

### Pending Todos

None.

### Blockers/Concerns

- **app_user_id mapping:** Must confirm mobile app uses Supabase auth.uid as RevenueCat appUserId. If not, need mapping table. (Assumed for Phase 21, should verify before production.)
- **Entitlement IDs:** Used `phoenix` / `elite` as placeholders. Actual names from RevenueCat dashboard needed before production webhook handler.
- **Existing Stripe subscribers:** Need count and migration timeline before decommissioning Stripe.
- **RevenueCat Pro plan:** Webhooks require Pro plan. Confirm plan is active.

### Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 1 | Resolve v1.2 audit tech debt: CookieConsentBanner MotionConfig, CSP enforcement note | 2026-02-28 | 36eb315 | [1-resolve-v1-2-audit-tech-debt-cookieconse](./quick/1-resolve-v1-2-audit-tech-debt-cookieconse/) |
| 2 | Fix pre-existing bugs/lint errors: 0 biome errors (was 102), 48/48 tests green (was 38) | 2026-02-28 | 46d7e6a | [2-fix-pre-existing-bugs-lint-errors-and-co](./quick/2-fix-pre-existing-bugs-lint-errors-and-co/) |
| 3 | Add Playwright E2E tests: 18 CI-friendly tests for public pages, auth redirects, navigation | 2026-02-28 | 748db95 | [3-add-playwright-e2e-tests-for-key-user-fl](./quick/3-add-playwright-e2e-tests-for-key-user-fl/) |
| 4 | Bundle optimization: vendor-recharts/visx chunks, Sentry deferred, chart.tsx dead code removed | 2026-02-28 | 170b775 | [4-performance-optimization-bundle-size-ana](./quick/4-performance-optimization-bundle-size-ana/) |
| 5 | Unit tests: 145 new tests for biomechanics, VBT, fatigue, rep-quality, comparison, schemas, stores | 2026-02-28 | 717ebb1 | [5-add-missing-unit-tests-for-untested-hook](./quick/5-add-missing-unit-tests-for-untested-hook/) |

## Session Continuity

Last session: 2026-02-28
Stopped at: Completed 22-02-PLAN.md (Stripe Infrastructure Removal). Next: execute 22-03.
Resume file: None. Next step: Execute 22-03 (Legal Pages & Verification).
