# Roadmap: Phoenix Portal

## Milestones

- ✅ **v1.0 MVP** -- Phases 0-8 (shipped 2026-02-16)
- ✅ **v1.1 Full UX Overhaul** -- Phases 9-13 (shipped 2026-02-17)
- ✅ **v1.2 Launch Readiness** -- Phases 14-20 (shipped 2026-02-28)
- [ ] **v1.3 RevenueCat Billing Migration** -- Phases 21-23 (in progress)

## Phases

<details>
<summary>v1.0 MVP (Phases 0-8) -- SHIPPED 2026-02-16</summary>

- [x] Phase 0: Stabilization (3/3 plans) -- completed 2026-02-15
- [x] Phase 1: Authentication & Data Layer (7/7 plans) -- completed 2026-02-15
- [x] Phase 2: Navigation & State Management (3/3 plans) -- completed 2026-02-15
- [x] Phase 3: Subscriptions & Payments (4/4 plans) -- completed 2026-02-16
- [x] Phase 4: Premium Analytics (6/6 plans) -- completed 2026-02-16
- [x] Phase 5: Community Hub (5/5 plans) -- completed 2026-02-16
- [x] Phase 6: Session Replay & Advanced VBT (4/4 plans) -- completed 2026-02-16
- [x] Phase 7: Integrations & Data Export (7/7 plans) -- completed 2026-02-16
- [x] Phase 8: Tech Debt Cleanup (2/2 plans) -- completed 2026-02-16

</details>

<details>
<summary>v1.1 Full UX Overhaul (Phases 9-13) -- SHIPPED 2026-02-17</summary>

- [x] Phase 9: Foundation & Toolchain (5/5 plans) -- completed 2026-02-17
- [x] Phase 10: Wire-Up & Mock Purge (5/5 plans) -- completed 2026-02-17
- [x] Phase 11: New Features (5/5 plans) -- completed 2026-02-17
- [x] Phase 12: Schedule-Dependent Features & Delivery (4/4 plans) -- completed 2026-02-17
- [x] Phase 13: Hardening & Polish (3/3 plans) -- completed 2026-02-17

</details>

<details>
<summary>v1.2 Launch Readiness (Phases 14-20) -- SHIPPED 2026-02-28</summary>

- [x] Phase 14: Security Hardening (4/4 plans) -- completed 2026-02-27
- [x] Phase 15: CI/CD & Database Foundation (2/2 plans) -- completed 2026-02-27
- [x] Phase 16: Legal & Pricing (3/3 plans) -- completed 2026-02-28
- [x] Phase 17: GDPR & Privacy (3/3 plans) -- completed 2026-02-28
- [x] Phase 18: Community Safety (3/3 plans) -- completed 2026-02-28
- [x] Phase 19: Accessibility & Navigation (3/3 plans) -- completed 2026-02-28
- [x] Phase 20: Operations & Validation (4/4 plans) -- completed 2026-02-28

</details>

### v1.3 RevenueCat Billing Migration (In Progress)

**Milestone Goal:** Replace Stripe with RevenueCat as the subscription billing provider, making the portal a consumer of subscription status managed by the mobile app. Net reduction in code and infrastructure.

- [x] **Phase 21: Database Schema & Webhook Handler** - Evolve subscriptions table, build RevenueCat webhook Edge Function, define tier mapping, and test the data pipeline (3/3 complete)
- [ ] **Phase 22: UI Migration & Stripe Removal** - Update all user-facing subscription touchpoints and completely remove Stripe infrastructure
- [ ] **Phase 23: Verification & Polish** - Add reliability features, verify end-to-end subscription flow, and confirm zero regressions

## Phase Details

### Phase 21: Database Schema & Webhook Handler
**Goal**: RevenueCat subscription events flow into the portal database and resolve to correct tier values
**Depends on**: Phase 20 (v1.2 complete)
**Requirements**: HOOK-01, HOOK-02, HOOK-03, HOOK-04, HOOK-05, DB-01, DB-02, DB-03, DB-04, TIER-01, TIER-02, TEST-01, TEST-02
**Success Criteria** (what must be TRUE):
  1. A RevenueCat webhook POST with valid Bearer token writes subscription data to the database and returns 200; an invalid token returns 401
  2. After a webhook delivers an INITIAL_PURCHASE event with the "elite" entitlement, `user_subscription_tier()` returns ELITE for that user -- same for "phoenix" returning PHOENIX and no entitlement returning FREE
  3. Existing RLS policies (community_comments INSERT, user_goals limit trigger) continue to enforce tier gating correctly against the evolved subscriptions table
  4. Supabase Realtime fires a change event when the webhook upserts a subscription row
  5. Unit tests cover all 8 RevenueCat lifecycle event types and reject unauthorized requests
**Plans**: 3 (all planned)

Plans:
- [x] 21-01: Database Schema Migration (wave 1) — Evolve subscriptions table: drop Stripe columns, add RevenueCat columns, preserve tier/status/period, update database.types.ts
- [x] 21-02: RevenueCat Webhook Edge Function (wave 2) — Auth validation, 8 event types, entitlement-to-tier mapping, idempotency, CANCELLATION handling
- [x] 21-03: Webhook Handler Tests (wave 3) — Extract pure functions to src/lib/revenuecat.ts, 48 unit tests for mapping/upsert/auth behavior

### Phase 22: UI Migration & Stripe Removal
**Goal**: Users see "subscribe in the app" guidance everywhere subscriptions are referenced, and zero Stripe code remains in the codebase
**Depends on**: Phase 21
**Requirements**: UI-01, UI-02, UI-03, UI-04, UI-05, DEL-01, DEL-02, DEL-03, DEL-04, DEL-05, DEL-06, DEL-07
**Success Criteria** (what must be TRUE):
  1. PricingPlans page displays tier comparison cards with "Subscribe in the Phoenix App" CTAs instead of Stripe checkout buttons
  2. Profile page shows current subscription tier, expiry date, and cancellation state with "Manage in App" guidance instead of a Stripe portal button
  3. UpgradePrompt component (shown inside gated features) directs users to subscribe in the mobile app
  4. No Stripe imports, Edge Functions, environment variables, or CSP directives remain anywhere in the codebase -- `grep -r "stripe" --include="*.ts" --include="*.tsx" --include="*.env*"` returns zero results (case-insensitive, excluding changelogs/migration comments)
  5. Terms of Service and Privacy Policy reference RevenueCat / App Store / Google Play billing instead of Stripe
**Plans**: 3 (all planned)

Plans:
- [ ] 22-01: UI Component Migration (wave 1) — Remove Stripe checkout/portal from PricingPlans, Profile, UpgradePrompt; add "Subscribe in App" CTAs
- [x] 22-02: Stripe Infrastructure Removal (wave 2) — Delete stripe.ts, 3 Edge Functions, @stripe/stripe-js dep, CSP directive, test file; modify delete-account
- [ ] 22-03: Legal Pages & Verification (wave 3) — Update TermsOfService and PrivacyPolicy; run comprehensive Stripe audit

### Phase 23: Verification & Polish
**Goal**: Subscription flow is reliable end-to-end with graceful handling of edge cases and zero regressions
**Depends on**: Phase 22
**Requirements**: TEST-03, POL-01, POL-02, POL-03, POL-04, POL-05
**Success Criteria** (what must be TRUE):
  1. A billing issue status triggers a visible banner warning the user to update payment in the mobile app, while keeping feature access active during the grace period
  2. "Subscribe in App" CTAs detect the user's platform (iOS / Android / desktop) and link to the correct app store listing
  3. User can click a "Refresh Subscription" button to re-read their subscription status from the database (mitigating webhook delivery delays)
  4. All existing unit tests and E2E tests pass with zero regressions after the complete migration
  5. The full pipeline works end-to-end: webhook delivery -> database upsert -> Realtime event -> useSubscription update -> SubscriptionGate -> correct feature gating
**Plans**: TBD

Plans:
- [ ] 23-01: TBD
- [ ] 23-02: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 21 -> 22 -> 23

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 0-8 | v1.0 | 41/41 | Complete | 2026-02-16 |
| 9-13 | v1.1 | 22/22 | Complete | 2026-02-17 |
| 14-20 | v1.2 | 22/22 | Complete | 2026-02-28 |
| 21. Database Schema & Webhook Handler | v1.3 | 3/3 | Complete | 2026-02-28 |
| 22. UI Migration & Stripe Removal | v1.3 | 2/3 | In progress | - |
| 23. Verification & Polish | v1.3 | 0/2 | Not started | - |

---
*Full v1.0 details: `.planning/milestones/v1.0-ROADMAP.md`*
*Full v1.1 details: `.planning/milestones/v1.1-ROADMAP.md`*
*Full v1.2 details: `.planning/milestones/v1.2-ROADMAP.md`*
