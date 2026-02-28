---
gsd_state_version: 1.0
milestone: v1.2
milestone_name: Launch Readiness
status: unknown
last_updated: "2026-02-28T16:33:21.532Z"
progress:
  total_phases: 7
  completed_phases: 7
  total_plans: 22
  completed_plans: 22
---

---
gsd_state_version: 1.0
milestone: v1.2
milestone_name: Launch Readiness
status: complete
last_updated: "2026-02-28T16:27:38Z"
progress:
  total_phases: 7
  completed_phases: 7
  total_plans: 22
  completed_plans: 22
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-27)

**Core value:** Premium subscribers see data and insights about their training that they cannot get anywhere else -- force curves, velocity trends, muscle balance analysis, and community-driven workout programming -- making the subscription feel indispensable.
**Current focus:** v1.2 Launch Readiness milestone COMPLETE -- all 22 plans across 7 phases executed

## Current Position

Phase: 20 — seventh of 7 phases in v1.2 (Operations & Validation)
Plan: 4 of 4 complete (20-01, 20-02, 20-03, 20-04 done)
Status: Complete
Last activity: 2026-02-28 — Completed quick task 3: Add Playwright E2E tests for key user flows

Progress: [▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓] 100% (v1.2)

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
| 17 | 03 | 3m 05s | 2 | 5 |
| 18 | 01 | 3m 25s | 2 | 7 |
| 18 | 02 | 7m 31s | 3 | 11 |
| 18 | 03 | 0m 56s | 1 | 2 |
| 19 | 01 | 2m 17s | 2 | 4 |
| 19 | 02 | 5m 01s | 2 | 10 |
| 19 | 03 | 1m 38s | 1 | 1 |
| 20 | 01 | 1m 41s | 2 | 3 |
| 20 | 02 | 2m 14s | 1 | 1 |
| 20 | 03 | 2m 33s | 2 | 3 |
| 20 | 04 | 2m 14s | 1 | 1 |

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
- [17-03] Stripe customer NOT deleted on account deletion (Stripe DPA requires financial record retention)
- [17-03] Edge Function logs but continues past Stripe/storage errors to preserve right to erasure
- [17-03] DangerZone placed between ExportSection and Sign Out card in settings tab
- [17-03] Native toLocaleDateString for date formatting (keep DangerZone self-contained, no date-fns import)
- [18-01] 'as never' type assertions for content_reports and user_blocks (not yet in generated Supabase types)
- [18-01] localStorage key 'phoenix-blocked-users' for instant blocked user hydration on page load
- [18-01] useAuth imported from @/providers/AuthProvider (corrected from plan's @/queries/auth)
- [18-02] ContentActionMenu accepts authorId as string|null for deleted user safety
- [18-02] CommunityFeedCard props extended with optional currentUserId/contentType for backward compatibility
- [18-02] Block filtering applied to both desktop and mobile community components independently
- [18-02] Comments query also converted from !inner to left join (consistency with feed query fix)

- [19-01] animate-spin exempted from reduced-motion suppression (functional loading indicator, not decorative)
- [19-01] SkipToContent placed before OfflineBanner as first focusable element in DOM
- [19-01] main element wraps ErrorBoundary+Suspense+Outlet, not the full page
- [19-03] Profile excluded from dropdown groups, kept accessible via avatar link in right-side controls
- [19-03] 12 nav items in 4 groups (Training 4, Programs 4, Body 2, Social 2) with Profile via avatar
- [19-02] visx charts get aria-hidden on SVG + sr-only data tables; Recharts charts get role='img' wrapper only (data visible in surrounding UI)
- [19-02] AsymmetryGauge summary mode also wrapped with accessibility (not just per-rep chart mode)
- [19-03] Removed motion/framer layoutId active indicator in favor of className-based active states

- [20-01] Stub Supabase env vars (not real secrets) sufficient for CI build validation
- [20-01] TOTAL_STEPS unchanged at 23 despite query refactor (same number of progress steps per path)
- [20-02] Reimplemented handler business logic as testable functions (Deno imports incompatible with Vitest)
- [20-02] Chainable Supabase mock tracks call sequences for assertion on table, method, and field values
- [20-02] getTierFromPriceId accepts priceMapping parameter for testability (avoids Deno.env dependency)
- [20-03] GitHub issues as sole support channel (solo dev, no email support SLA)
- [20-03] FAQ answers use React.ReactNode for inline Link components to /pricing and /privacy
- [20-04] Corrected query file count to 18 (17 hooks + keys.ts) vs plan's 17
- [20-04] E2E test directory documented as e2e/ (actual) not tests/ (plan assumed)
- [20-04] Documented 13 hooks in src/hooks/ with named examples for completeness

v1.2 decisions pending:
- Hosting platform not confirmed (CSP meta tag chosen as interim -- switch to HTTP header when hosting confirmed)
- ~~Pricing final values ($9.99 vs $14.99) must be resolved before Phase 16~~ RESOLVED: $14.99/$24.99 confirmed in 16-01

### Pending Todos

None.

### Blockers/Concerns

**Carried from v1.1 (human verification):**
- Stripe checkout/portal/webhooks (needs Stripe test environment)
- OAuth flows with real credentials (Strava, Fitbit, Garmin)
- 12 Supabase Edge Functions (needs deployment)
- 17 authenticated E2E tests skip without SUPABASE_TEST_EMAIL/PASSWORD env vars

**v1.2 research flags:**
- ~~GDPR account deletion: Stripe customer deletion vs financial record retention~~ RESOLVED in 17-03: Stripe customer retained, only subscription cancelled
- ~~Celebration animation fallback design: opacity-only fade vs static banner under reduced-motion~~ RESOLVED in 19-01: MotionConfig reducedMotion="user" preserves opacity, CSS suppresses decorative keyframes
- ~~Navigation restructure pattern: dropdown menus vs sidebar~~ RESOLVED in 19-03: Radix NavigationMenu dropdowns with 4 category groups

### Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 1 | Resolve v1.2 audit tech debt: CookieConsentBanner MotionConfig, CSP enforcement note | 2026-02-28 | 36eb315 | [1-resolve-v1-2-audit-tech-debt-cookieconse](./quick/1-resolve-v1-2-audit-tech-debt-cookieconse/) |
| 2 | Fix pre-existing bugs/lint errors: 0 biome errors (was 102), 48/48 tests green (was 38) | 2026-02-28 | 46d7e6a | [2-fix-pre-existing-bugs-lint-errors-and-co](./quick/2-fix-pre-existing-bugs-lint-errors-and-co/) |
| 3 | Add Playwright E2E tests: 18 CI-friendly tests for public pages, auth redirects, navigation | 2026-02-28 | 748db95 | [3-add-playwright-e2e-tests-for-key-user-fl](./quick/3-add-playwright-e2e-tests-for-key-user-fl/) |

## Session Continuity

Last session: 2026-02-28
Stopped at: Completed quick task 3 (18 E2E tests for public pages, auth redirects, navigation)
Resume file: All v1.2 plans complete (22/22). Quick tasks 1-3 done.
