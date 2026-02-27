# Roadmap: Phoenix Portal

## Milestones

- ✅ **v1.0 MVP** — Phases 0-8 (shipped 2026-02-16)
- ✅ **v1.1 Full UX Overhaul** — Phases 9-13 (shipped 2026-02-17)
- 🚧 **v1.2 Launch Readiness** — Phases 14-20 (in progress)

## Phases

<details>
<summary>✅ v1.0 MVP (Phases 0-8) — SHIPPED 2026-02-16</summary>

- [x] Phase 0: Stabilization (3/3 plans) — completed 2026-02-15
- [x] Phase 1: Authentication & Data Layer (7/7 plans) — completed 2026-02-15
- [x] Phase 2: Navigation & State Management (3/3 plans) — completed 2026-02-15
- [x] Phase 3: Subscriptions & Payments (4/4 plans) — completed 2026-02-16
- [x] Phase 4: Premium Analytics (6/6 plans) — completed 2026-02-16
- [x] Phase 5: Community Hub (5/5 plans) — completed 2026-02-16
- [x] Phase 6: Session Replay & Advanced VBT (4/4 plans) — completed 2026-02-16
- [x] Phase 7: Integrations & Data Export (7/7 plans) — completed 2026-02-16
- [x] Phase 8: Tech Debt Cleanup (2/2 plans) — completed 2026-02-16

</details>

<details>
<summary>✅ v1.1 Full UX Overhaul (Phases 9-13) — SHIPPED 2026-02-17</summary>

- [x] Phase 9: Foundation & Toolchain (5/5 plans) — completed 2026-02-17
- [x] Phase 10: Wire-Up & Mock Purge (5/5 plans) — completed 2026-02-17
- [x] Phase 11: New Features (5/5 plans) — completed 2026-02-17
- [x] Phase 12: Schedule-Dependent Features & Delivery (4/4 plans) — completed 2026-02-17
- [x] Phase 13: Hardening & Polish (3/3 plans) — completed 2026-02-17

</details>

### 🚧 v1.2 Launch Readiness (In Progress)

**Milestone Goal:** Address all board-identified blockers (legal, security, operational, UX) to make Phoenix Portal launch-ready for public release with paid tiers.

- [x] **Phase 14: Security Hardening** - Fix live vulnerabilities: CORS, OAuth tokens, CSRF, source maps, webhook auth, Stripe origin validation
- [x] **Phase 15: CI/CD & Database Foundation** - Automated quality gates and database optimization for safe deployment of irreversible operations (completed 2026-02-27)
- [ ] **Phase 16: Legal & Pricing** - Privacy Policy, Terms of Service, pricing consistency, and free-tier gating enforcement
- [ ] **Phase 17: GDPR & Privacy** - User data export, account deletion with cascade, and cookie consent
- [ ] **Phase 18: Community Safety** - Content reporting and user blocking for community features
- [ ] **Phase 19: Accessibility & Navigation** - Reduced-motion support, skip-to-content, chart accessibility, desktop nav restructure
- [ ] **Phase 20: Operations & Validation** - Stripe billing tests, support infrastructure, sync validation, documentation update

## Phase Details

### Phase 14: Security Hardening
**Goal**: All browser-facing endpoints enforce origin restrictions, OAuth tokens are inaccessible to browser clients, and authentication gaps are closed
**Depends on**: Nothing (first phase in v1.2 — architectural prerequisite)
**Requirements**: SEC-01, SEC-02, SEC-03, SEC-04, SEC-05, SEC-06, SEC-07, SEC-08
**Success Criteria** (what must be TRUE):
  1. Browser requests to Edge Functions from unauthorized origins are rejected with 403; requests from the production domain succeed
  2. OAuth access/refresh tokens are not returned in any client-side query result — only provider name, status, and last sync timestamp are visible to the browser
  3. OAuth flows use server-generated state tokens that expire after 10 minutes; initiating OAuth without a valid state token fails
  4. Production source maps are not publicly accessible via CDN URL, but Sentry error reports still show original source locations
  5. Stripe checkout and portal redirects use a server-configured APP_URL, not the request origin header
**Plans**: 4 plans

Plans:
- [x] 14-01-PLAN.md — Source map concealment and CSP report-only meta tag
- [x] 14-02-PLAN.md — CORS origin validation and Stripe redirect hardening
- [x] 14-03-PLAN.md — Garmin webhook auth and sync function JWT auth
- [x] 14-04-PLAN.md — OAuth token isolation and CSRF state tokens

### Phase 15: CI/CD & Database Foundation
**Goal**: Every push to main is validated by automated quality gates, and database tables are optimized for RLS performance
**Depends on**: Phase 14 (security fixes establish the CORS and auth patterns that CI must validate)
**Requirements**: OPS-01, DB-01, DB-02
**Success Criteria** (what must be TRUE):
  1. A push to main that fails biome, TypeScript, or Vitest checks is blocked from deploying
  2. Playwright E2E tests run automatically on every push with browser caching and environment-aware test skipping
  3. The dual subscription table situation is resolved — queries use a single authoritative source for subscription status
  4. Sets and rep_summaries queries no longer require joins to workouts/sessions tables for RLS checks
**Plans**: 2 plans

Plans:
- [ ] 15-01-PLAN.md — GitHub Actions CI pipeline with Biome, TypeScript, Vitest, Playwright, and build jobs
- [ ] 15-02-PLAN.md — RLS denormalization (sets, rep_summaries, rep_telemetry) and subscription table deprecation

### Phase 16: Legal & Pricing
**Goal**: Users encounter accurate legal documents and consistent pricing before any payment flow
**Depends on**: Phase 15 (CI gates must be in place before enforcing tier limits that could lock out users)
**Requirements**: LEGAL-01, LEGAL-02, LEGAL-03, LEGAL-05
**Success Criteria** (what must be TRUE):
  1. The Privacy Policy page accurately describes all data collected (Supabase, Stripe, Sentry, OAuth providers, biometric data), storage locations, and user rights
  2. A Terms of Service page exists at /terms covering subscriptions, acceptable use, limitation of liability, and community content licensing
  3. The landing page price and the pricing page price match — no discrepancy anywhere in the app
  4. Free-tier users who exceed usage limits see an upgrade prompt with a preview of locked features, not a hard error or unrestricted access
**Plans**: TBD

Plans:
- [ ] 16-01: TBD
- [ ] 16-02: TBD

### Phase 17: GDPR & Privacy
**Goal**: Users can exercise their data rights (export and deletion) and control cookie consent
**Depends on**: Phase 15 (CI pipeline required before deploying irreversible deletion), Phase 16 (Privacy Policy must exist before cookie consent references it)
**Requirements**: GDPR-01, GDPR-02, LEGAL-04
**Success Criteria** (what must be TRUE):
  1. User can trigger a data export from their profile settings and receive a downloadable ZIP containing all their personal data (profile, workouts, records, routines, goals, comments, integrations)
  2. User can request account deletion from their profile settings; deletion executes after a 30-day grace period with community content anonymized (not destroyed) and Stripe subscription cancelled
  3. A cookie consent banner appears on first visit; rejecting cookies prevents Sentry initialization; accepting cookies allows full functionality; the preference persists across sessions
**Plans**: TBD

Plans:
- [ ] 17-01: TBD
- [ ] 17-02: TBD

### Phase 18: Community Safety
**Goal**: Users can report inappropriate content and block other users in community features
**Depends on**: Phase 16 (ToS must define acceptable use before reports can reference policy violations)
**Requirements**: MOD-01, MOD-02
**Success Criteria** (what must be TRUE):
  1. User can report a community post or comment via a menu option, selecting a report category; reported content is stored in a review queue accessible via Supabase Studio
  2. User can block another user from their profile or content; blocked user's posts and comments are hidden from the blocking user's view without affecting other users
**Plans**: TBD

Plans:
- [ ] 18-01: TBD

### Phase 19: Accessibility & Navigation
**Goal**: The app respects OS accessibility preferences, supports keyboard navigation patterns, and organizes desktop navigation into logical groups
**Depends on**: Phase 15 (axe-core CI regression gate must be running before accessibility changes ship)
**Requirements**: A11Y-01, A11Y-02, A11Y-03, NAV-01
**Success Criteria** (what must be TRUE):
  1. With prefers-reduced-motion enabled at the OS level, all Framer Motion animations and CSS keyframe animations (flame-flicker, ember-rise, phoenix-glow) are suppressed or reduced to opacity-only transitions
  2. A keyboard user pressing Tab on page load can activate a visible skip-to-content link that jumps focus to the main content area
  3. Screen reader users encounter descriptive labels on all chart containers; Canvas-based visx charts have a text-based alternative accessible to assistive technology
  4. Desktop navigation groups 13+ items into logical categories via dropdown menus; all 26 existing route paths continue to work without changes
**Plans**: TBD

Plans:
- [ ] 19-01: TBD
- [ ] 19-02: TBD

### Phase 20: Operations & Validation
**Goal**: Revenue-critical paths have test coverage, users have a support channel, and the mobile-to-portal sync pipeline is validated end-to-end
**Depends on**: Phase 14 (Stripe origin fix must be in place before billing tests validate it), Phase 15 (CI pipeline runs the tests)
**Requirements**: OPS-02, OPS-03, OPS-04, OPS-05
**Success Criteria** (what must be TRUE):
  1. Automated tests cover all 5 Stripe webhook event types (checkout.session.completed, subscription.created, subscription.updated, subscription.deleted, invoice.payment_failed) with mock payloads
  2. Users can find answers to common questions on a FAQ page and contact the team via email or Discord link
  3. A workout performed on the mobile app appears in the portal's workout history within the expected sync window, verified end-to-end
  4. CLAUDE.md accurately reflects the current architecture, commands, and project state
**Plans**: TBD

Plans:
- [ ] 20-01: TBD
- [ ] 20-02: TBD

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 0. Stabilization | v1.0 | 3/3 | Complete | 2026-02-15 |
| 1. Authentication & Data Layer | v1.0 | 7/7 | Complete | 2026-02-15 |
| 2. Navigation & State Management | v1.0 | 3/3 | Complete | 2026-02-15 |
| 3. Subscriptions & Payments | v1.0 | 4/4 | Complete | 2026-02-16 |
| 4. Premium Analytics | v1.0 | 6/6 | Complete | 2026-02-16 |
| 5. Community Hub | v1.0 | 5/5 | Complete | 2026-02-16 |
| 6. Session Replay & Advanced VBT | v1.0 | 4/4 | Complete | 2026-02-16 |
| 7. Integrations & Data Export | v1.0 | 7/7 | Complete | 2026-02-16 |
| 8. Tech Debt Cleanup | v1.0 | 2/2 | Complete | 2026-02-16 |
| 9. Foundation & Toolchain | v1.1 | 5/5 | Complete | 2026-02-17 |
| 10. Wire-Up & Mock Purge | v1.1 | 5/5 | Complete | 2026-02-17 |
| 11. New Features | v1.1 | 5/5 | Complete | 2026-02-17 |
| 12. Schedule-Dependent Features & Delivery | v1.1 | 4/4 | Complete | 2026-02-17 |
| 13. Hardening & Polish | v1.1 | 3/3 | Complete | 2026-02-17 |
| 14. Security Hardening | v1.2 | Complete    | 2026-02-27 | 2026-02-27 |
| 15. CI/CD & Database Foundation | 2/2 | Complete   | 2026-02-27 | - |
| 16. Legal & Pricing | v1.2 | 0/? | Not started | - |
| 17. GDPR & Privacy | v1.2 | 0/? | Not started | - |
| 18. Community Safety | v1.2 | 0/? | Not started | - |
| 19. Accessibility & Navigation | v1.2 | 0/? | Not started | - |
| 20. Operations & Validation | v1.2 | 0/? | Not started | - |

---
*Full v1.0 details: `.planning/milestones/v1.0-ROADMAP.md`*
*Full v1.1 details: `.planning/milestones/v1.1-ROADMAP.md`*
