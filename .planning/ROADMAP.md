# Roadmap: Phoenix Portal

## Milestones

- ✅ **v1.0 MVP** — Phases 0-8 (shipped 2026-02-16)
- 🚧 **v1.1 Full UX Overhaul** — Phases 9-12 (in progress)

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

---

### 🚧 v1.1 Full UX Overhaul (In Progress)

**Milestone Goal:** Fix all broken interactions, complete the design system, modernize the toolchain, and add high-value engagement features — making Phoenix Portal production-ready.

## Phase Details

### Phase 9: Foundation & Toolchain

**Goal**: The codebase runs on React 19 + Vite 7 with a clean design system, Biome enforcement, Sentry monitoring, and accurate generated types — eliminating every pre-existing defect before any feature work begins.

**Depends on**: Phase 8 (v1.0 complete)

**Requirements**: TOOL-01, TOOL-02, TOOL-03, TOOL-04, TOOL-05, TOOL-06, TOOL-07, TOOL-08, TOOL-09, TOOL-10, TOOL-11, DSGN-01, DSGN-02, DSGN-03, DSGN-04, DSGN-05, DSGN-06

**Success Criteria** (what must be TRUE):
  1. `npm run build` completes with zero TypeScript errors, zero Biome lint violations, and output chunk sizes within 10% of v1.0 baseline (71KB main entry)
  2. The Phoenix color palette is visible in browser DevTools as `--phoenix-ember: #FF6B35` (not overwritten by generic oklch grays)
  3. All chart components (Analytics, Biomechanics, DashboardMobile) render correctly after the React 19 upgrade — no blank containers on mobile
  4. Sentry captures a test error and the event appears in the Sentry project dashboard
  5. `database.types.ts` is generated from the live Supabase schema and all manual type stubs are removed

**Plans**: 5 plans

Plans:
- [ ] 09-01: Dependency upgrades in strict sequence (react-day-picker v9, Tailwind 4.1.18, Vite 7, Recharts 3, dnd-kit, React 19)
- [ ] 09-02: Biome 2.4 setup + TypeScript strictness + bundle visualizer
- [ ] 09-03: Design system foundation (.dark block deletion, token definitions, colors.ts, dark: variant cleanup)
- [ ] 09-04: Sentry v10 integration + generated database.types.ts
- [ ] 09-05: Hex color migration (Tailwind arbitrary values, SVG stroke/fill, motion animate targets)

---

### Phase 10: Wire-Up & Mock Purge

**Goal**: Every existing UI element does what it says — all 14+ dead buttons respond, all form saves persist to Supabase, all data comes from real queries, and every component shows real user data or a meaningful empty state.

**Depends on**: Phase 9

**Requirements**: DATA-01, DATA-02, DATA-03, DATA-04, DATA-05, DATA-06, DATA-07, DATA-08, DATA-09, DATA-10, DATA-11, DATA-12, DATA-13, DATA-14, DATA-15, DATA-16, DATA-17, DATA-18, DATA-19, DATA-20, DATA-21, DATA-22

**Success Criteria** (what must be TRUE):
  1. A user can create a routine in RoutineBuilder and see it persist in Supabase after a full page reload
  2. A user can build a training cycle with progression rules in CycleBuilder and see the cycle_days rows saved in the database
  3. The Dashboard shows the correct workout streak computed from real workout_sessions (not a hardcoded number)
  4. On a mobile device, DashboardMobile renders instead of the desktop layout
  5. The auth modal can be navigated entirely by keyboard, and a user can complete a password reset flow via email

**Plans**: 5 plans

Plans:
- [x] 10-01: DB migrations (cycle_days, challenges, routine_exercises) + RoutineBuilder/CycleBuilder save mutations + unsaved changes dialog + routine editing + ProgressionRules/PreviewModal
- [x] 10-02: Dashboard streak computation + DashboardMobile rendering + Profile real data/settings persistence + mock data removal
- [x] 10-03: Challenges wiring to Supabase + Community vote persistence + dead button triage + WorkoutHistory date filter + Analytics time period fix + Biomechanics setState fix + AnalyticsMobile tabs
- [x] 10-04: Auth modal accessibility (Radix Dialog) + password reset flow + ExercisePicker from Supabase + empty states across all features
- [ ] 10-05: Gap closure — Delete dead WorkoutDetail.tsx (mock data) + fix useShareContent error toast

---

### Phase 11: New Features

**Goal**: Users can set and track training goals, new users are guided through an onboarding flow, the community supports comments on shared content, sessions can be compared side-by-side, and a recovery readiness score is available for PHOENIX/ELITE subscribers.

**Depends on**: Phase 10

**Requirements**: GOAL-01, GOAL-02, GOAL-03, GOAL-04, GOAL-05, GOAL-06, GOAL-07, GOAL-08, ONBD-01, ONBD-02, ONBD-03, ONBD-04, ONBD-05, ONBD-06, RCVR-01, RCVR-02, RCVR-03, RCVR-04, RCVR-05, RCVR-06, RCVR-07, RCVR-08, RCVR-09, CMNT-01, CMNT-02, CMNT-03, CMNT-04, CMNT-05, CMNT-06, CMNT-07, CMNT-08, CMNT-09, COMP-01, COMP-02, COMP-03, COMP-04, COMP-05, COMP-06, COMP-07, COMP-08

**Success Criteria** (what must be TRUE):
  1. A user can create a frequency goal, see a progress ring on the Goals page, and receive a celebration animation when the goal is achieved
  2. A brand-new user sees the 3-step onboarding overlay on first authenticated visit; an existing mobile-app user (who already has sessions) skips it entirely
  3. A PHOENIX user can post a comment on a shared routine in the Community feed, see it appear in real time without refreshing, and edit it within 5 minutes
  4. A PHOENIX user can select any two sessions from WorkoutHistory, view side-by-side volume and exercise deltas with percentage indicators, and see a mobile layout that stacks the panels vertically with A/B tabs
  5. A PHOENIX user with 14+ days of workout data sees a Training Load Readiness score (0-100) with contributing factors; a user with fewer than 14 days sees an activation threshold message instead of a score

**Plans**: 5 plans

Plans:
- [ ] 11-01: Goal setting — user_goals migration + schema/queries/mutations + Goals page with progress rings + celebration animation + Dashboard widget + navigation (Wave 1)
- [ ] 11-02: Onboarding — user_onboarding migration + detection hook + 3-step Dialog overlay + What's New banner + feature hints + AppLayout integration (Wave 2)
- [ ] 11-03: Recovery dashboard — TDD ACWR algorithm + /recovery page + score visualization + contributing factors + 14-day gate + Dashboard widget + navigation (Wave 2)
- [ ] 11-04: Community comments — community_comments migration with RLS + rate limit + flat-list thread in CommunityDetailDrawer + realtime subscription + tier gating (Wave 1)
- [ ] 11-05: Workout comparison — comparison logic + ComparisonView page + session picker + WorkoutHistory multi-select + SessionDetail button wire + mobile A/B tabs (Wave 1)

---

### Phase 12: Schedule-Dependent Features & Delivery

**Goal**: The smart workout widget reads real user cycle data, sessions are printable as formatted reports, the app is installable as a PWA, and the full v1.1 feature set is covered by Playwright E2E tests with an accessibility audit.

**Depends on**: Phase 11 (features stable); Phase 10 (cycle_days table and CycleBuilder mutations exist)

**Requirements**: REPT-01, REPT-02, REPT-03, REPT-04, REPT-05, DLVR-01, DLVR-02, DLVR-03, DLVR-04, DLVR-05, DLVR-06, DLVR-07

**Success Criteria** (what must be TRUE):
  1. A user with an active training cycle sees a "Next Workout" card on the Dashboard showing the correct day's routine based on the cycle start date
  2. A PHOENIX user on the SessionDetail page can trigger a print dialog that produces a formatted report with exercise table, PR flags, and Phoenix branding — navigation and interactive elements are hidden in the print output
  3. The app can be installed from Chrome/Safari to a device home screen; a second visit after install shows an update banner when a new version is deployed
  4. All v1.1 features pass @axe-core/playwright WCAG audit with zero critical violations

**Plans**: 4 plans

Plans:
- [ ] 12-01-PLAN.md — Smart Workout Widget (TDD): computeNextWorkout() pure function, NextWorkoutWidget component, Dashboard/DashboardMobile integration
- [ ] 12-02-PLAN.md — Session Reports: @media print CSS, SubscriptionGate-wrapped print button in SessionDetail, Phoenix branding footer, print-hide markers
- [ ] 12-03-PLAN.md — PWA: vite-plugin-pwa manifest + service worker (autoUpdate), PNG icons, offline banner, install prompt after 3 workouts, Sentry web vitals verification
- [ ] 12-04-PLAN.md — Testing & A11y: Playwright E2E smoke tests, @axe-core/playwright WCAG audit, bundle analysis vs 71KB baseline

---

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
| 10. Wire-Up & Mock Purge | v1.1 | Complete    | 2026-02-17 | - |
| 11. New Features | v1.1 | Complete    | 2026-02-17 | - |
| 12. Schedule-Dependent Features & Delivery | v1.1 | Complete    | 2026-02-17 | - |

---
*Full v1.0 details: `.planning/milestones/v1.0-ROADMAP.md`*
*v1.1 roadmap created: 2026-02-16*
