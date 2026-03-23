# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-15)

**Core value:** Premium subscribers see data and insights about their training that they cannot get anywhere else -- force curves, velocity trends, muscle balance analysis, and community-driven workout programming -- making the subscription feel indispensable.
**Current focus:** v1.3 MVP Launch — deploy to production on Cloudflare Pages

## Current Position

Phase: 24 of 26 (Infrastructure & Ops) — Wave 1 Complete, Wave 2 Pending
Plan: 3 of 4 in current phase — Wave 1 code fixes done + reviewed, Wave 2 manual ops pending
Status: Phase 24 Wave 1 complete — review passed (1 cycle, 1 blocker fixed). Wave 2 (manual ops) awaiting user execution.
Last activity: 2026-03-22 — Phase 24 Wave 1 review passed

Progress: [████████████████████] 100% (v1.2) | [█████████.] 80% (v1.3) — 10/11 code plans complete, 1 manual ops plan pending

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
- Total plans completed: 17
- Average duration: ~2.8 min
- Total execution time: ~47 min

## Accumulated Context

### Decisions

All v1.0, v1.1, and v1.2 decisions archived in PROJECT.md Key Decisions table.

**v1.3 decisions (from exploration-mvp-launch.md):**
- Full deployment milestone scope — all 11 plan sections in one milestone with 4 phases
- Code-first, then ops phase structure — Legion agents handle code changes, user handles manual ops
- Remove placeholder footer items — cleaner launch, add back when destinations exist
- Cloudflare Pages over Vercel — full infra-as-code config in repo (wrangler.toml + _redirects + _headers)
- Cloudflare auto-deploy on push to main — no CI gating; CI is solid enough
- Paddle as Merchant of Record — replaces RevenueCat; handles EU VAT + AU GST automatically
- Pricing: Ember $15/mo ($149/yr), Inferno $25/mo ($249/yr, Coming Soon)
- Production domain: https://phoenix-portal.com
- APP_URL = https://phoenix-portal.com (no trailing slash) — critical for CORS + OAuth redirects
- Coming Soon badges for Fitbit/Garmin — ship with Strava + Hevy active at launch
- Paddle price IDs via env vars (VITE_PADDLE_*) for sandbox/production separation
- Legacy column names (stripe_customer_id/stripe_subscription_id) reused for Paddle — rename deferred

Key v1.3 constraints:
- APP_URL must exactly match production domain — mismatch breaks all Edge Function CORS + OAuth redirects
- CSP headers must whitelist Supabase, Sentry, Paddle, and OAuth provider domains
- Mobile app must target production Supabase for sync pipeline verification
- Paddle webhook secret must be set in Supabase Edge Function secrets
- OAuth callbacks use Supabase domain (ilzlswmatadlnsuxatcv.supabase.co), not portal domain

### Pending Todos

- Board Tier 2 conditions (first 2 weeks of beta): CWV instrumentation, performance budget CI gate, Biome a11y rules, chart aria-labels, Sentry alert rules
- Board Tier 3 conditions (within 30 days): content moderation policy, data retention periods in privacy policy

### Blockers/Concerns

**Non-blocking items for human verification (carried forward):**
- Paddle webhook secret and price IDs must be configured in Supabase secrets and Paddle Dashboard
- Mobile app production readiness (must point at production Supabase for sync verification)
- CSP header values need iterative testing to avoid blocking legitimate requests
- Fitbit developer approval timeline: 1-3 weeks (estimate)
- Garmin developer approval timeline: 2-6 weeks (estimate)
- 17 authenticated E2E tests skip without SUPABASE_TEST_EMAIL/PASSWORD env vars
- Recovery ACWR thresholds may need sport-science validation

## Session Continuity

Last session: 2026-03-22
Stopped at: Phase 24 planned (4 plans, 2 waves). Run `/legion:build` to execute Phase 24: Infrastructure & Ops.
Resume file: .planning/phases/24-infrastructure-ops/24-CONTEXT.md
Board decision: .planning/board/2026-03-22-beta-readiness.md
