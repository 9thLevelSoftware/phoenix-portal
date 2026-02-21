# Roadmap: Phoenix Portal

## Milestones

- ✅ **v1.0 MVP** — Phases 0-8 (shipped 2026-02-16)
- ✅ **v1.1 Full UX Overhaul** — Phases 9-13 (shipped 2026-02-17)
- 🚧 **v1.2 Premium Visual Overhaul** — Phases 14-19 (in progress)

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

### 🚧 v1.2 Premium Visual Overhaul (In Progress)

**Milestone Goal:** Transform the UI from developer-quality to premium fitness brand quality — matching the visual polish of Whoop, Strava, and Peloton dashboards.

- [ ] **Phase 14: CSS Foundation & Typography** - Establish Inter Variable, design tokens, ambient gradients, and surface-level visual primitives that all later phases depend on
- [ ] **Phase 15: Navigation & Layout Shell** - Replace horizontal nav with collapsible sidebar, introduce shared PageShell, consolidate mobile variants into CSS-responsive components
- [ ] **Phase 16: Visual Depth & Surfaces** - Apply card surface hierarchy, glassmorphism on priority cards, landing page gradient borders, and icon container treatments
- [ ] **Phase 17: Motion Design System** - Centralized animation presets, page transitions, spring hover, stagger entrance, animated counters, and reduced-motion compliance
- [ ] **Phase 18: Data Visualization Styling** - Custom branded chart tooltips, styled axes/gridlines, chart entrance animations, donut conversion, and muscle heatmap fix
- [ ] **Phase 19: Polish & Bug Fixes** - Pricing sync, dead logic removal, raw emoji replacements, hardcoded color purge, and unused animation activation

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
**Plans**: TBD

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
**Plans**: TBD

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
**Plans**: TBD

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
**Plans**: TBD

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
**Plans**: TBD

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
| 14. CSS Foundation & Typography | v1.2 | 0/2 | Not started | - |
| 15. Navigation & Layout Shell | v1.2 | 0/TBD | Not started | - |
| 16. Visual Depth & Surfaces | v1.2 | 0/TBD | Not started | - |
| 17. Motion Design System | v1.2 | 0/TBD | Not started | - |
| 18. Data Visualization Styling | v1.2 | 0/TBD | Not started | - |
| 19. Polish & Bug Fixes | v1.2 | 0/TBD | Not started | - |

---
*Full v1.0 details: `.planning/milestones/v1.0-ROADMAP.md`*
*Full v1.1 details: `.planning/milestones/v1.1-ROADMAP.md`*
*Last updated: 2026-02-20 after v1.2 roadmap creation*
