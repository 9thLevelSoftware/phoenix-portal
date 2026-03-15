# Roadmap: Phoenix Portal

## Milestones

- ✅ **v1.0 MVP** — Phases 0-8 (shipped 2026-02-16)
- ✅ **v1.1 Full UX Overhaul** — Phases 9-13 (shipped 2026-02-17)
- ✅ **v1.2 Premium Visual Overhaul** — Phases 14-20 (shipped 2026-03-13, archived)
- 🚀 **v1.3 MVP Launch** — Phases 21-24 (started 2026-03-15)

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

<details>
<summary>✅ v1.2 Premium Visual Overhaul (Phases 14-20) — SHIPPED 2026-03-13</summary>


**Milestone Goal:** Transform the UI from developer-quality to premium fitness brand quality — matching the visual polish of Whoop, Strava, and Peloton dashboards.

- [x] **Phase 14: CSS Foundation & Typography** - Establish Inter Variable, design tokens, ambient gradients, and surface-level visual primitives that all later phases depend on (completed 2026-02-21)
- [x] **Phase 15: Navigation & Layout Shell** - Replace horizontal nav with collapsible sidebar, introduce shared PageShell, consolidate mobile variants into CSS-responsive components (completed 2026-02-21)
- [x] **Phase 16: Visual Depth & Surfaces** - Apply card surface hierarchy, glassmorphism on priority cards, landing page gradient borders, and icon container treatments (completed 2026-02-21)
- [x] **Phase 17: Motion Design System** - Centralized animation presets, page transitions, spring hover, stagger entrance, animated counters, and reduced-motion compliance (completed 2026-03-13)
- [x] **Phase 18: Data Visualization Styling** - Custom branded chart tooltips, styled axes/gridlines, chart entrance animations, donut conversion, and muscle heatmap fix (completed 2026-03-13)
- [x] **Phase 19: Polish & Bug Fixes** - Pricing sync, dead logic removal, raw emoji replacements, hardcoded color purge, and unused animation activation (completed 2026-03-13)
- [x] **Phase 20: Gap Closure & Tech Debt** - Fix ambient glow occlusion, remove inline system-ui fallback, delete dead Navigation.tsx, apply eyebrow utility, add SUMMARY frontmatter (completed 2026-02-21)

## Phase Details

### Phase 14: CSS Foundation & Typography
**Goal**: The entire app renders in Inter Variable with correct font-weight hierarchy; ambient ember/flame radial gradients create visual depth on the background; CSS surface tokens are defined and verified in DevTools so all subsequent phases can reference them without namespace collision.
**Depends on**: Phase 13
**Requirements**: TYPE-01, TYPE-02, TYPE-03, TYPE-04, TYPE-05, TYPE-06, VIS-01, VIS-02, VIS-04, VIS-05, BUG-08
**Success Criteria** (what must be TRUE):
  1. Every visible text element renders in Inter — no system-ui, Georgia, or browser-default serif visible anywhere
  2. Page titles, section headers, and card titles use visually distinct font-weights (heavier to lighter hierarchy is perceivable without reading the CSS)
  3. Uppercase stat labels have visible letter-spacing and are smaller than body text — distinguishable as an "eyebrow" treatment
  4. The background behind any dashboard page has visible ember/flame ambient glow orbs at low opacity — distinct from solid #0D0D0D
  5. All CSS variable tokens (`--surface-1`, `--surface-2`, shadow tokens) are resolvable in Chrome DevTools `:root` panel — zero undefined vars
**Plans**: 2 plans
Plans:
- [ ] 14-01-PLAN.md — Inter Variable font loading, typography hierarchy, dead CSS cleanup, system-ui fixes, BUG-08
- [ ] 14-02-PLAN.md — Ambient glows, grain texture, shadow token wiring, border-secondary override, surface-3 token

### Phase 15: Navigation & Layout Shell
**Goal**: The 13-item horizontal top nav is gone; a collapsible left sidebar with grouped nav items is the primary navigation surface on desktop; all pages render through a shared PageShell that owns max-width and padding; the useIsMobile flash is eliminated; mobile component variants are merged into their CSS-responsive parents.
**Depends on**: Phase 14
**Requirements**: NAV-01, NAV-02, NAV-03, NAV-04, NAV-05, NAV-06, NAV-07, NAV-08, NAV-09
**Success Criteria** (what must be TRUE):
  1. On desktop, a left sidebar with Training/Social/Account groups replaces the horizontal top nav — active item shows full-row highlight in ember color
  2. Collapsing the sidebar to icon-rail mode works via toggle — all nav items remain accessible as icon-only with tooltips
  3. The user avatar in the right cluster opens a dropdown showing profile name, tier badge, streak count, and logout — no separate profile nav item needed
  4. On mobile, the sidebar is hidden and MobileBottomNav with labeled "More" drawer sections remains the navigation surface — no layout flash on first render
  5. All 26 routes smoke-test without white-screen or layout breakage; chart widths remain correct at 768px breakpoint
**Plans**: 3 plans
Plans:
- [ ] 15-01-PLAN.md — AppLayout restructure with SidebarProvider, AppSidebar component, useIsMobile sync fix
- [ ] 15-02-PLAN.md — PageShell creation and threading through all authenticated page components
- [ ] 15-03-PLAN.md — MobileBottomNav grouped drawer sections, mobile component variant merges

### Phase 16: Visual Depth & Surfaces
**Goal**: Cards have three perceptible elevation levels (hero, primary, secondary); glassmorphism is applied only to 2-3 priority cards per page within the blur budget; landing page feature cards have gradient borders and hover glow; icon containers are differentiated by role rather than uniform rounded squares.
**Depends on**: Phase 15
**Requirements**: VIS-03, VIS-06, VIS-07, VIS-08, VIS-09, BUG-07
**Success Criteria** (what must be TRUE):
  1. Hero cards (streak, active goal, recovery score) are visually distinct from secondary informational cards — elevation and border treatment create a clear visual hierarchy without reading card titles
  2. Glassmorphic cards (max 3 per viewport) show a subtle frosted-glass effect over the ambient gradient — scroll jank absent on mobile (tested at mid-range emulation)
  3. The auth dialog has a dark glass treatment — blurred background, branded border, inner glow — distinguishable from a plain modal
  4. Landing page feature cards show gradient borders and lift on hover — the page feels interactive before any click
  5. Gradient text is used only on hero headlines — section headers and card titles use solid white or ember color
**Plans**: 2 plans
Plans:
- [ ] 16-01-PLAN.md — Card tier CSS utilities, card hierarchy on Dashboard, glassmorphism, auth dialog glass, landing gradient borders, icon differentiation
- [ ] 16-02-PLAN.md — Gradient text sweep (BUG-07) across 23 files, reserving gradient for hero h1 only

### Phase 17: Motion Design System
**Goal**: All animations reference a single `src/lib/animations.ts` preset library; page transitions fire on every route change; stat cards spring on hover; card grids stagger on mount; key dashboard numbers count up from zero; all animations respect prefers-reduced-motion.
**Depends on**: Phase 16
**Requirements**: MOT-01, MOT-02, MOT-03, MOT-04, MOT-05, MOT-06, MOT-07, MOT-08, MOT-09, MOT-10
**Success Criteria** (what must be TRUE):
  1. Navigating between any two pages produces a visible fade + slight-Y page transition — no abrupt cuts; no page-overlap during transition
  2. Hovering a stat card produces a spring-physics lift (not a CSS linear ease) — the card feels physically weighted
  3. Dashboard stat numbers (total volume, sessions, streak) visibly count up from zero on first mount — not a static render
  4. Card grids animate in with a stagger (each card slightly after the previous) rather than all appearing simultaneously
  5. Enabling "Reduce Motion" in OS accessibility settings eliminates all entrance animations and stat counting — content is still fully accessible
**Plans**: 4 plans
Plans:
- [x] 17-01-PLAN.md — Animation foundation: create src/lib/animations.ts presets, install @number-flow/react, add reduced-motion to EmberParticles (completed 2026-03-13)
- [x] 17-02-PLAN.md — Page transitions: AnimatePresence + useOutlet() in AppLayout, branded PageLoading flame pulse (completed 2026-03-13)
- [x] 17-03-PLAN.md — Landing page motion: hero scroll parallax, breathing scroll indicator, CTA whileTap press feedback (completed 2026-03-13)
- [x] 17-04-PLAN.md — Dashboard animations: stat number counting, spring hover cards, staggered card grid entrance (completed 2026-03-13)

### Phase 18: Data Visualization Styling
**Goal**: Every Recharts chart uses a shared branded tooltip component; axes and gridlines are styled consistently across all chart files; charts animate in on mount; the analytics pie chart is a donut with a center label; the muscle heatmap back regions display correctly.
**Depends on**: Phase 15
**Requirements**: VIZ-01, VIZ-02, VIZ-03, VIZ-04, VIZ-05, VIZ-06, VIZ-07, VIZ-08, VIZ-09
**Success Criteria** (what must be TRUE):
  1. Hovering any chart data point shows a Phoenix-branded tooltip (dark background, ember accent, correct font) — no default browser-chrome or unstyled white tooltips remain
  2. Chart axes have no axis border lines and no tick marks — only the data lines/bars and subtle gridlines at 30% opacity
  3. The analytics muscle-group chart is a donut shape with a center label naming the dominant category — not a solid pie
  4. All charts animate their data in over ~800ms on page load — static instantaneous renders are gone
  5. The muscle heatmap shows both front and back body regions with correct SVG paths — no broken or missing back-region paths
**Plans**: 3 plans
Plans:
- [x] 18-01-PLAN.md — Branded RechartsTooltip component, axis standardization (tickLine/axisLine/font), CartesianGrid opacity (completed 2026-03-13)
- [x] 18-02-PLAN.md — Chart animation timing (800ms ease-out), desktop pie→donut with center label, hardcoded fill removal (completed 2026-03-13)
- [x] 18-03-PLAN.md — Muscle heatmap front/back toggle with back body SVG paths, ExerciseProgress stat sizing + delta pill (completed 2026-03-13)

### Phase 19: Polish & Bug Fixes
**Goal**: Pricing figures match between landing page and pricing modal; dead notification logic is removed from mobile nav; all raw emoji in UI are replaced with styled icon components; every hardcoded hex color in Recharts configs is replaced with a palette constant or CSS variable; unused Phoenix animations are wired to relevant elements.
**Depends on**: Phase 18
**Requirements**: BUG-01, BUG-02, BUG-03, BUG-04, BUG-05, BUG-06, BUG-09, BUG-10
**Success Criteria** (what must be TRUE):
  1. The landing page pricing table and the subscription checkout page show identical prices — no discrepancy a user could screenshot
  2. The streak card displays a styled Lucide Flame icon with phoenix-glow animation — no raw fire emoji visible in any browser
  3. Dashboard stats show only real data metrics — the "Badges Earned" placeholder stat is replaced with a meaningful live metric
  4. Footer nav links are wrapped in proper anchor/Link tags — right-clicking any footer item shows browser link context menu options
  5. The `animate-flame-flicker` and `animate-phoenix-glow` CSS animations are applied to at least one visible UI element each — they are no longer dead declarations
**Plans**: 1 plan
Plans:
- [x] 19-01-PLAN.md — Footer nav link wrapping (BUG-09), wire animate-flame-flicker and animate-phoenix-glow (BUG-10); 6 other bugs pre-resolved (completed 2026-03-13)

### Phase 20: Gap Closure & Tech Debt
**Goal**: Body-level ambient ember/flame glows are visible through the authenticated AppLayout shell; the last inline system-ui fallback is removed; dead code and documentation inconsistencies from Phases 14-16 are cleaned up.
**Depends on**: Phase 16
**Requirements**: TYPE-03, VIS-01
**Gap Closure**: Closes gaps from v1.2 milestone audit
**Success Criteria** (what must be TRUE):
  1. Ambient ember/flame glows are visually perceptible behind authenticated page content — not fully occluded by opaque AppLayout background
  2. `LandingPage.tsx` hero h1 has no inline `style` prop — font-family inherits from global CSS
  3. Glassmorphism cards blur against the ambient glow layer, not just adjacent page content
  4. `Navigation.tsx` is deleted — zero dead nav files in the repo
  5. MobileBottomNav drawer section labels use `.eyebrow` utility class instead of manual Tailwind
**Plans**: 2 plans
Plans:
- [x] 20-01-PLAN.md — Strip bg-background from AppLayout + SidebarInset + 16 page root wrappers to reveal ambient glows (completed 2026-02-21)
- [x] 20-02-PLAN.md — Remove inline system-ui fontFamily, delete Navigation.tsx, apply .eyebrow utility (completed 2026-02-21)

</details>

### 🚀 v1.3 MVP Launch (STARTED 2026-03-15)

**Milestone Goal:** Take Phoenix Portal from code-complete to publicly deployed on Cloudflare Pages at https://phoenix-portal.com — fix blockers, deploy infrastructure, verify end-to-end flows, and roll out integrations as provider approvals arrive.

- [x] **Phase 21: Code Fixes & Cloudflare Config** — Fix config.toml blocker, add Coming Soon badges, clean up footer, replace Vercel config with Cloudflare Pages infrastructure-as-code (completed 2026-03-15)
- [ ] **Phase 22: Paddle Billing Integration** — Replace RevenueCat with Paddle webhook handler, add Paddle.js checkout overlay, update config.toml and subscription flow for web-based billing
- [ ] **Phase 23: Feature Fixes** — Add vote_count database trigger for community voting, wire favorites toggle to Supabase persistence
- [ ] **Phase 24: Infrastructure & Ops** — Paddle dashboard setup, Supabase secrets, deploy Edge Functions, Cloudflare Pages, DNS, Strava app, submit Fitbit/Garmin applications
- [ ] **Phase 25: Verification & Launch** — Build verification, auth flow, E2E sync, Paddle checkout, Strava OAuth, CORS validation, go-live
- [ ] **Phase 26: Integration Rollout** — Activate Fitbit and Garmin integrations as developer program approvals arrive

## Phase Details

### Phase 21: Code Fixes & Cloudflare Config
**Goal**: Fix the config.toml hard blocker, add Coming Soon badges for unapproved integrations, clean up placeholder footer items, and replace Vercel deployment config with Cloudflare Pages infrastructure-as-code (wrangler.toml, _redirects, _headers with security headers and CSP).
**Depends on**: Phase 20
**Requirements**: DEPLOY-01, DEPLOY-02, DEPLOY-03, DEPLOY-04, DEPLOY-05, DEPLOY-06
**Success Criteria** (what must be TRUE):
  1. `supabase/config.toml` declares `[functions.revenuecat-webhooks]` with `verify_jwt = false` — no reference to `stripe-webhooks`
  2. Fitbit and Garmin cards on Integrations page show a "Coming Soon" badge with Connect button disabled — Strava and Hevy remain active
  3. LandingPage footer contains only items with working link destinations — no placeholder spans
  4. `vercel.json` is deleted from the repository
  5. `wrangler.toml` exists with Cloudflare Pages project config; `public/_redirects` has SPA fallback; `public/_headers` has security headers including CSP whitelisting Supabase, Sentry, and OAuth provider domains
  6. `npm run build` succeeds with no errors
**Plans**: 2 plans
Plans:
- [ ] 21-01-PLAN.md — config.toml fix, Coming Soon badge system for Integrations.tsx, footer placeholder removal
- [ ] 21-02-PLAN.md — Delete vercel.json, create wrangler.toml + public/_redirects + public/_headers with CSP

### Phase 22: Paddle Billing Integration
**Goal**: RevenueCat webhook handler replaced with Paddle webhook handler. Paddle.js checkout overlay integrated into PricingPlans page for web-based subscription purchases. config.toml updated. Frontend subscription flow supports direct web checkout instead of "subscribe via mobile app" redirection.
**Depends on**: Phase 21
**Requirements**: PADDLE-01, PADDLE-02, PADDLE-03, PADDLE-04, PADDLE-05
**Success Criteria** (what must be TRUE):
  1. `supabase/functions/paddle-webhooks/index.ts` exists with Paddle signature verification and subscription event handling
  2. `supabase/config.toml` declares `[functions.paddle-webhooks]` with `verify_jwt = false`
  3. `src/lib/paddle.ts` exports Paddle product/price mapping and checkout initialization
  4. PricingPlans page has a working "Subscribe" button that opens Paddle.js checkout overlay
  5. `revenuecat-webhooks` Edge Function directory and `src/lib/revenuecat.ts` are deleted
  6. `npm run typecheck` and `npm test` pass
**Plans**: 3 plans (estimated)

### Phase 23: Feature Fixes
**Goal**: Community voting correctly updates vote_count via database trigger. Favorites toggle persists to Supabase instead of local React state.
**Depends on**: Phase 21
**Requirements**: FIX-01, FIX-02
**Success Criteria** (what must be TRUE):
  1. Voting on a shared routine/cycle increments `vote_count` on the item — removing a vote decrements it. Verified via Supabase Dashboard query after voting.
  2. Favoriting a routine persists across navigation — leaving and returning to the Routines page shows the same favorites state
  3. `npm run typecheck` and `npm test` pass
**Plans**: 2 plans (estimated)

### Phase 24: Infrastructure & Ops
**Goal**: All Supabase secrets configured (including Paddle), Edge Functions deployed, Cloudflare Pages connected, custom domain live, Paddle products created and webhook verified, Strava credentials set, Fitbit/Garmin applications submitted.
**Depends on**: Phase 22, Phase 23
**Requirements**: OPS-01, OPS-02, OPS-03, OPS-04, OPS-05, OPS-06, OPS-07, OPS-08
**Type**: Manual — requires user's hands (console configuration, secret entry, DNS)
**Success Criteria** (what must be TRUE):
  1. `supabase secrets list` shows APP_URL, ENVIRONMENT, PADDLE_WEBHOOK_SECRET, PADDLE_API_KEY, STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET
  2. `supabase functions list` shows all Edge Functions as deployed (paddle-webhooks replacing revenuecat-webhooks)
  3. https://phoenix-portal.com loads the landing page with valid SSL
  4. Paddle products (Ember $15/mo, Inferno $25/mo) created in Paddle Dashboard
  5. Paddle TEST webhook returns 200 in Edge Function logs
  6. Fitbit and Garmin developer applications are submitted
**Plans**: 1 plan (ops checklist)

### Phase 25: Verification & Launch
**Goal**: All critical user flows verified on the production domain — auth, mobile-to-portal sync, Paddle checkout, subscription gating, Strava OAuth, voting, favorites, and CORS. Portal is confirmed live and functional.
**Depends on**: Phase 24
**Requirements**: VERIFY-01, VERIFY-02, VERIFY-03, VERIFY-04, VERIFY-05, VERIFY-06, VERIFY-07, VERIFY-08
**Type**: Manual — requires user's hands (end-to-end testing on production)
**Success Criteria** (what must be TRUE):
  1. Full test suite passes locally (typecheck, unit tests, e2e, production build)
  2. Email signup, signin, password reset, and sign out work on https://phoenix-portal.com
  3. Mobile app workout push appears on portal Dashboard via Supabase Broadcast
  4. Paddle checkout completes for Ember tier — subscription activates in portal
  5. Subscription gating blocks Inferno-only features for Ember users
  6. Strava OAuth connect → activity sync → disconnect flow completes
  7. Edge Function calls from https://phoenix-portal.com are not blocked by CORS
  8. Voting updates vote_count; favorites persist across navigation
**Plans**: 1 plan (verification checklist)

### Phase 26: Integration Rollout
**Goal**: Fitbit and Garmin integrations activated as developer program approvals arrive. Coming Soon badges removed, OAuth flows verified, and changes deployed.
**Depends on**: Phase 25 (launch must be complete)
**Requirements**: INTEG-01, INTEG-02
**Type**: Ongoing — triggered by external approvals (1-6 weeks)
**Success Criteria** (what must be TRUE):
  1. Each approved provider: secrets set, OAuth flow verified end-to-end, Coming Soon badge removed, deployed
  2. Fitbit: activity sync returns data, disconnect clears tokens
  3. Garmin: OAuth 1.0a connection succeeds, webhook receives activity pushes, disconnect works
**Plans**: 2 plans

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
| 14. CSS Foundation & Typography | 2/2 | Complete    | 2026-02-21 | - |
| 15. Navigation & Layout Shell | 3/3 | Complete    | 2026-02-21 | - |
| 16. Visual Depth & Surfaces | 2/2 | Complete    | 2026-02-21 | - |
| 17. Motion Design System | v1.2 | 4/4 | Complete | 2026-03-13 |
| 18. Data Visualization Styling | v1.2 | 3/3 | Complete | 2026-03-13 |
| 19. Polish & Bug Fixes | v1.2 | 1/1 | Complete | 2026-03-13 |
| 20. Gap Closure & Tech Debt | 2/2 | Complete   | 2026-02-21 | - |
| 21. Code Fixes & Cloudflare Config | v1.3 | 2/2 | Complete | 2026-03-15 |
| 22. Paddle Billing Integration | v1.3 | 3/3 | Complete | 2026-03-15 |
| 23. Feature Fixes | v1.3 | 0/2 | Pending | - |
| 24. Infrastructure & Ops | v1.3 | 0/1 | Pending | - |
| 25. Verification & Launch | v1.3 | 0/1 | Pending | - |
| 26. Integration Rollout | v1.3 | 0/2 | Pending | - |

---
*Full v1.0 details: `.planning/milestones/v1.0-ROADMAP.md`*
*Full v1.1 details: `.planning/milestones/v1.1-ROADMAP.md`*
*Full v1.2 details: `.planning/milestones/v1.2-MILESTONE.md`*
*Last updated: 2026-03-15 — v1.3 re-planned: Paddle billing, feature fixes, phases 22-26*
