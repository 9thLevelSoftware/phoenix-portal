---
gsd_state_version: 1.0
milestone: v1.2
milestone_name: Launch Readiness
status: in-progress
last_updated: "2026-02-28T03:08:11Z"
progress:
  total_phases: 4
  completed_phases: 3
  total_plans: 12
  completed_plans: 11
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-27)

**Core value:** Premium subscribers see data and insights about their training that they cannot get anywhere else -- force curves, velocity trends, muscle balance analysis, and community-driven workout programming -- making the subscription feel indispensable.
**Current focus:** Phase 17: GDPR & Privacy (v1.2 Launch Readiness)

## Current Position

Phase: 17 — fourth of 7 phases in v1.2 (GDPR & Privacy)
Plan: 2 of 3 complete
Status: In Progress
Last activity: 2026-02-28 — Completed 17-02-PLAN.md (GDPR data export with JSZip)

Progress: [▓▓▓▓▓▓▓▓░░] 37% (v1.2)

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
- Total plans completed: 11
- Average duration: 3.3 min
- Total execution time: ~36 min

| Phase | Plan | Duration | Tasks | Files |
|-------|------|----------|-------|-------|
| 14 | 01 | 2m 26s | 2 | 2 |
| 14 | 02 | 5m 14s | 2 | 10 |
| 14 | 03 | 3m 58s | 2 | 4 |
| 14 | 04 | 6m 41s | 3 | 13 |
| 15 | 01 | 1m 25s | 2 | 2 |
| 15 | 02 | 2m 52s | 2 | 2 |
| 16 | 01 | 2m 30s | 2 | 4 |
| 16 | 02 | 2m 20s | 2 | 3 |
| 16 | 03 | 4m 31s | 2 | 4 |
| 17 | 01 | 2m 07s | 2 | 4 |
| 17 | 02 | 2m 59s | 2 | 3 |

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
- [16-02] ToS effective date set to February 27, 2026 (plan creation date)
- [16-02] Limitation of Liability uses highlighted callout box for community project "as is" warning
- [16-02] Contact section mirrors Privacy Policy (GitHub issues + ko-fi link) for consistency
- [16-03] SubscriptionGate gets featureName passthrough prop for contextual upgrade messages
- [16-03] TIER_BENEFITS derived from TIER_PRICING.features filtering out "Everything in X" entries, taking top 3
- [16-03] Calendar days beyond 30-day cutoff dimmed with lock icon; locked months show banner
- [16-03] List view shows max 3 locked preview entries then upgrade CTA banner
- [17-01] Equal-weight outline buttons for Accept/Reject (GDPR requirement, no dark patterns)
- [17-01] localStorage key 'phoenix-cookie-consent' for consent persistence
- [17-01] Banner rendered inside BrowserRouter but outside AuthProvider/QueryProvider (needs Link, not auth)
- [17-02] Excluded stripe_customer_id from profiles export (sensitive field not in plan but present in schema)
- [17-02] Used --legacy-peer-deps for JSZip install due to pre-existing @visx/axis React 19 peer conflict
- [17-02] Profiles queried by id (primary key = auth UID) rather than user_id (nullable FK)

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
Stopped at: Completed 17-02-PLAN.md (GDPR data export with JSZip)
Resume file: 17-03-PLAN.md
