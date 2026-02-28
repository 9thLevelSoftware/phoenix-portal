---
gsd_state_version: 1.0
milestone: v1.3
milestone_name: RevenueCat Billing Migration
status: defining-requirements
last_updated: "2026-02-28T21:00:00.000Z"
progress:
  total_phases: 0
  completed_phases: 0
  total_plans: 0
  completed_plans: 0
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-28)

**Core value:** Premium subscribers see data and insights about their training that they cannot get anywhere else -- force curves, velocity trends, muscle balance analysis, and community-driven workout programming -- making the subscription feel indispensable.
**Current focus:** v1.3 RevenueCat Billing Migration — replacing Stripe with RevenueCat, portal becomes subscription status consumer

## Current Position

Phase: Not started (defining requirements)
Plan: —
Status: Defining requirements
Last activity: 2026-02-28 — Milestone v1.3 started

Progress: [░░░░░░░░░░░░░░░░░░░░] 0% (v1.3)

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

## Accumulated Context

### Decisions

All v1.0/v1.1/v1.2 decisions archived in PROJECT.md Key Decisions table.

v1.3 decisions:
- [milestone] Billing moves entirely to mobile app via RevenueCat; web portal reads subscription status only
- [milestone] Remove all Stripe code completely (not deprecate gradually)
- [milestone] Pricing page becomes "subscribe in app" — no web checkout
- [milestone] Tier structure unchanged: FREE / PHOENIX / ELITE with same feature gating
- [milestone] Portal-side prep first; mobile RevenueCat integration happens separately/later
- [milestone] Research needed: optimal sync mechanism (webhooks vs API vs SDK)

v1.3 decisions pending:
- RevenueCat sync mechanism not yet determined (research phase)

### Pending Todos

None.

### Blockers/Concerns

**Carried from v1.2 (human verification):**
- Stripe checkout/portal/webhooks (needs Stripe test environment) — WILL BE REMOVED in v1.3
- OAuth flows with real credentials (Strava, Fitbit, Garmin)
- 12 Supabase Edge Functions (needs deployment) — 3 Stripe functions to be removed
- 17 authenticated E2E tests skip without SUPABASE_TEST_EMAIL/PASSWORD env vars

**v1.3 concerns:**
- RevenueCat SDK/API availability for web (not just mobile) needs research
- Database migration: subscriptions table schema may change
- Existing RLS policies reference stripe_customer_id — must be updated

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
Stopped at: Milestone v1.3 initialized, defining requirements
Resume file: v1.2 complete (22/22 plans + 5 quick tasks). Starting v1.3 RevenueCat Billing Migration.
