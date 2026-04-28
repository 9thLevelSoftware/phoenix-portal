# Requirements: Phoenix Portal v1.3 MVP Launch

**Defined:** 2026-03-15
**Core Value:** Take the code-complete portal to production — real users can sign up, sync workouts, and access premium analytics at https://phoenix-portal.com.

## v1.3 Requirements

### Deployment & Config

- [ ] **DEPLOY-01**: `supabase/config.toml` declares `[functions.revenuecat-webhooks]` with `verify_jwt = false` — no reference to deleted `stripe-webhooks`
- [ ] **DEPLOY-02**: Fitbit and Garmin cards on Integrations page show "Coming Soon" badge with Connect button disabled — Strava and Hevy remain active
- [ ] **DEPLOY-03**: LandingPage footer contains only items with working link destinations — all placeholder spans removed
- [ ] **DEPLOY-04**: `vercel.json` deleted; `wrangler.toml` exists with Cloudflare Pages project config
- [ ] **DEPLOY-05**: `public/_redirects` contains SPA fallback rule (`/* /index.html 200`)
- [ ] **DEPLOY-06**: `public/_headers` contains security headers (X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy, CSP whitelisting Supabase + Sentry + OAuth providers)

### Infrastructure & Ops

- [ ] **OPS-01**: Supabase secrets configured: APP_URL (`https://phoenix-portal.com`), ENVIRONMENT (`production`), REVENUECAT_WEBHOOK_SECRET
- [ ] **OPS-02**: All 14 Edge Functions deployed and listed via `supabase functions list`
- [ ] **OPS-03**: Cloudflare Pages connected to repo with auto-deploy on push to main
- [ ] **OPS-04**: Custom domain `phoenix-portal.com` resolves to Cloudflare Pages with valid SSL
- [ ] **OPS-05**: RevenueCat webhook configured pointing to `revenuecat-webhooks` Edge Function, TEST event returns 200
- [ ] **OPS-06**: Strava API application created, `STRAVA_CLIENT_ID` and `STRAVA_CLIENT_SECRET` set in Supabase secrets
- [ ] **OPS-07**: Fitbit developer application submitted (confirmation email received)
- [ ] **OPS-08**: Garmin developer program application submitted (confirmation email received)

### Verification

- [ ] **VERIFY-01**: Full test suite passes locally (typecheck, unit tests, e2e, production build)
- [ ] **VERIFY-02**: Auth flow works on production domain: signup, signin, password reset, sign out, protected route redirect
- [ ] **VERIFY-03**: End-to-end sync verified: mobile workout push appears on portal Dashboard via Supabase Broadcast
- [ ] **VERIFY-04**: Subscription gating works: free tier paywall blocks Analytics, Biomechanics, Session Replay, Integrations
- [ ] **VERIFY-05**: Strava OAuth flow completes: connect → activity sync → disconnect
- [ ] **VERIFY-06**: Edge Function calls from https://phoenix-portal.com not blocked by CORS
- [ ] **VERIFY-07**: Fitbit and Garmin cards display Coming Soon badges with disabled Connect buttons

### Integration Rollout

- [ ] **INTEG-01**: Fitbit integration activated: secrets set, OAuth verified, Coming Soon badge removed, deployed
- [ ] **INTEG-02**: Garmin integration activated: secrets set, webhook configured, OAuth 1.0a verified, Coming Soon badge removed, deployed

## Out of Scope

| Feature | Reason |
|---------|--------|
| CI-gated deployment | Cloudflare auto-deploy on push to main; CI is solid (5 jobs) |
| New portal features | v1.3 is deployment-only — no new functionality |
| Light mode / theme toggle | App is dark-only by design |
| Sentry setup | Optional — app works without it |
| Footer link additions | Removed for clean launch; add back in future milestone when destinations exist |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| DEPLOY-01 | Phase 21 | Pending |
| DEPLOY-02 | Phase 21 | Pending |
| DEPLOY-03 | Phase 21 | Pending |
| DEPLOY-04 | Phase 21 | Pending |
| DEPLOY-05 | Phase 21 | Pending |
| DEPLOY-06 | Phase 21 | Pending |
| OPS-01 | Phase 22 | Pending |
| OPS-02 | Phase 22 | Pending |
| OPS-03 | Phase 22 | Pending |
| OPS-04 | Phase 22 | Pending |
| OPS-05 | Phase 22 | Pending |
| OPS-06 | Phase 22 | Pending |
| OPS-07 | Phase 22 | Pending |
| OPS-08 | Phase 22 | Pending |
| VERIFY-01 | Phase 23 | Pending |
| VERIFY-02 | Phase 23 | Pending |
| VERIFY-03 | Phase 23 | Pending |
| VERIFY-04 | Phase 23 | Pending |
| VERIFY-05 | Phase 23 | Pending |
| VERIFY-06 | Phase 23 | Pending |
| VERIFY-07 | Phase 23 | Pending |
| INTEG-01 | Phase 24 | Pending |
| INTEG-02 | Phase 24 | Pending |

**Coverage:**
- v1.3 requirements: 23 total
- Completed: 0 (0%)
- Unmapped: 0

---
*Requirements defined: 2026-03-15*
