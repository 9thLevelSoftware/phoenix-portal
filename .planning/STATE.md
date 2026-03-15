# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-15)

**Core value:** Premium subscribers see data and insights about their training that they cannot get anywhere else -- force curves, velocity trends, muscle balance analysis, and community-driven workout programming -- making the subscription feel indispensable.
**Current focus:** v1.3 MVP Launch — deploy to production on Cloudflare Pages

## Current Position

Phase: 21 of 24 (Code Fixes & Cloudflare Config) — Complete
Plan: 2 of 2 in current phase — all plans executed
Status: Phase 21 complete — all plans executed successfully
Last activity: 2026-03-15 — Phase 21 execution: config.toml fixed, Coming Soon badges added, footer cleaned, Cloudflare config created

Progress: [████████████████████] 100% (v1.2) | [███.......] 33% (v1.3) — 2/6 plans complete

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
- Production domain: https://phoenix-portal.com
- APP_URL = https://phoenix-portal.com (no trailing slash) — critical for CORS + OAuth redirects
- Coming Soon badges for Fitbit/Garmin — ship with Strava + Hevy active at launch
- RevenueCat replaces Stripe for billing — mobile-first via App Store/Play Store

Key v1.3 constraints:
- APP_URL must exactly match production domain — mismatch breaks all Edge Function CORS + OAuth redirects
- CSP headers must whitelist Supabase, Sentry, and OAuth provider domains
- Mobile app must target production Supabase for sync pipeline verification
- RevenueCat entitlement IDs must be named `elite` and `phoenix` (case-insensitive)
- OAuth callbacks use Supabase domain (ilzlswmatadlnsuxatcv.supabase.co), not portal domain

### Pending Todos

None.

### Blockers/Concerns

**Non-blocking items for human verification (carried forward):**
- RevenueCat entitlement IDs must match `elite`/`phoenix` in webhook handler mapping
- Mobile app production readiness (must point at production Supabase for sync verification)
- CSP header values need iterative testing to avoid blocking legitimate requests
- Fitbit developer approval timeline: 1-3 weeks (estimate)
- Garmin developer approval timeline: 2-6 weeks (estimate)
- 17 authenticated E2E tests skip without SUPABASE_TEST_EMAIL/PASSWORD env vars
- Recovery ACWR thresholds may need sport-science validation

## Session Continuity

Last session: 2026-03-15
Stopped at: Phase 21 complete. Run `/legion:plan 22` to plan Phase 22: Infrastructure & Ops.
Resume file: .planning/phases/21-code-fixes-cloudflare-config/21-CONTEXT.md
