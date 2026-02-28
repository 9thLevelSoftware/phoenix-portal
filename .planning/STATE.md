---
gsd_state_version: 1.0
milestone: v1.2
milestone_name: Launch Readiness
status: in-progress
last_updated: "2026-02-28T02:19:00.000Z"
progress:
  total_phases: 3
  completed_phases: 2
  total_plans: 9
  completed_plans: 7
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-27)

**Core value:** Premium subscribers see data and insights about their training that they cannot get anywhere else -- force curves, velocity trends, muscle balance analysis, and community-driven workout programming -- making the subscription feel indispensable.
**Current focus:** Phase 16: Legal & Pricing (v1.2 Launch Readiness)

## Current Position

Phase: 16 — third of 7 phases in v1.2 (Legal & Pricing)
Plan: 1 of 3 complete
Status: In Progress
Last activity: 2026-02-28 — Completed 16-01-PLAN.md (Pricing constants and Privacy Policy disclosures)

Progress: [▓▓▓▓▓▓▓░░░] 24% (v1.2)

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
- Total plans completed: 7
- Average duration: 4 min
- Total execution time: ~25 min

| Phase | Plan | Duration | Tasks | Files |
|-------|------|----------|-------|-------|
| 14 | 01 | 2m 26s | 2 | 2 |
| 14 | 02 | 5m 14s | 2 | 10 |
| 14 | 03 | 3m 58s | 2 | 4 |
| 14 | 04 | 6m 41s | 3 | 13 |
| 15 | 01 | 1m 25s | 2 | 2 |
| 15 | 02 | 2m 52s | 2 | 2 |
| 16 | 01 | 2m 30s | 2 | 4 |

## Accumulated Context

### Decisions

All v1.0/v1.1 decisions archived in PROJECT.md Key Decisions table.

v1.2 decisions:
- [14-01] Used CSP meta tag (not HTTP header) because hosting platform not yet confirmed
- [14-01] CSP in report-only mode to establish violation baseline before enforcement
- [14-01] unsafe-inline required in style-src for shadcn/ui Radix inline styles
- [14-02] Strict equality origin matching (not regex) to prevent subdomain bypass attacks
- [14-02] Vary: Origin header to prevent CDN/proxy caching responses for wrong origin
- [14-02] Static corsHeaders retained for non-browser endpoints (webhooks, cron)
- [14-02] strava-oauth excluded from CORS migration (redirect-only, no CORS headers)
- [14-03] Conditional GARMIN_WEBHOOK_SECRET -- graceful degradation if env var not set
- [14-03] Dual-auth pattern: JWT via auth.getUser() for browser, body.user_id for service-role queue calls
- [14-03] Auth client uses SUPABASE_ANON_KEY for JWT verification, service-role client for DB only
- [14-04] oauth_tokens table: RLS enabled with zero policies (only service_role can access)
- [14-04] CSRF state tokens via crypto.randomUUID() with 10-min expiry, single-use deletion
- [14-04] Client OAuth functions changed from sync(userId) to async(accessToken) via initiate-oauth Edge Function
- [14-04] Token columns dropped from user_integrations after migration to oauth_tokens
- [15-01] Biome installed via biomejs/setup-biome (standalone binary, no node_modules needed for lint job)
- [15-01] All 5 CI jobs run in parallel with no dependencies between them
- [15-01] Playwright installs only chromium to save CI time
- [15-02] Deprecated user_subscriptions via SQL COMMENT rather than DROP (mobile app safety)
- [15-02] Included rep_telemetry denormalization despite not being explicitly in DB-02 (identical anti-pattern)
- [15-02] All RLS policies use (select auth.uid()) wrapper for initPlan caching (~20x perf gain)
- [15-02] New RLS policy created before old dropped to avoid security gap window

- [16-01] TIER_PRICING array in src/lib/pricing.ts as single source of truth for all tier prices
- [16-01] PricingPlans uses TIER_DISPLAY record merged with TIER_PRICING to separate display config from prices
- [16-01] LandingPage derives pricingTiers via TIER_PRICING.map() — no hardcoded dollar amounts
- [16-01] Privacy Policy biometric-adjacent data notice distinguishes from actual biometric data

v1.2 decisions pending:
- Hosting platform not confirmed (CSP meta tag chosen as interim -- switch to HTTP header when hosting confirmed)
- ~~Pricing final values ($9.99 vs $14.99) must be resolved before Phase 16~~ RESOLVED: $14.99/$24.99 confirmed in 16-01

### Pending Todos

None.

### Blockers/Concerns

**Carried from v1.1 (human verification):**
- Stripe checkout/portal/webhooks (needs Stripe test environment)
- OAuth flows with real credentials (Strava, Fitbit, Garmin)
- 11 Supabase Edge Functions (needs deployment)
- 17 authenticated E2E tests skip without SUPABASE_TEST_EMAIL/PASSWORD env vars

**v1.2 research flags:**
- GDPR account deletion: Stripe customer deletion vs financial record retention (verify against Stripe DPA before Phase 17)
- Celebration animation fallback design: opacity-only fade vs static banner under reduced-motion (decide before Phase 19)
- Navigation restructure pattern: dropdown menus vs sidebar (decide before Phase 19)

## Session Continuity

Last session: 2026-02-28
Stopped at: Completed 16-01-PLAN.md (Pricing constants and Privacy Policy disclosures)
Resume file: 16-02-PLAN.md
