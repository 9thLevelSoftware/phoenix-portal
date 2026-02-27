# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-27)

**Core value:** Premium subscribers see data and insights about their training that they cannot get anywhere else -- force curves, velocity trends, muscle balance analysis, and community-driven workout programming -- making the subscription feel indispensable.
**Current focus:** Phase 14: Security Hardening (v1.2 Launch Readiness)

## Current Position

Phase: 14 — first of 7 phases in v1.2 (Security Hardening)
Plan: 4 of 4 complete
Status: Phase Complete
Last activity: 2026-02-27 — Completed 14-04-PLAN.md (OAuth token isolation and CSRF state tokens)

Progress: [▓▓▓▓░░░░░░] 14% (v1.2)

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
- Total plans completed: 4
- Average duration: 5 min
- Total execution time: ~18 min

| Phase | Plan | Duration | Tasks | Files |
|-------|------|----------|-------|-------|
| 14 | 01 | 2m 26s | 2 | 2 |
| 14 | 02 | 5m 14s | 2 | 10 |
| 14 | 03 | 3m 58s | 2 | 4 |
| 14 | 04 | 6m 41s | 3 | 13 |

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

v1.2 decisions pending:
- Hosting platform not confirmed (CSP meta tag chosen as interim -- switch to HTTP header when hosting confirmed)
- Pricing final values ($9.99 vs $14.99) must be resolved before Phase 16

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

Last session: 2026-02-27
Stopped at: Completed 14-04-PLAN.md (OAuth token isolation and CSRF state tokens) - Phase 14 complete
Resume file: .planning/phases/15-cicd-database/15-01-PLAN.md
