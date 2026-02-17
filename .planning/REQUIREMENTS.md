# Requirements: Phoenix Portal v1.1

**Defined:** 2026-02-16
**Core Value:** Premium subscribers see data and insights about their training that they cannot get anywhere else -- force curves, velocity trends, muscle balance analysis, and community-driven workout programming -- making the subscription feel indispensable.

## v1.1 Requirements

Requirements for v1.1 Full UX Overhaul. Each maps to roadmap phases (continuing from v1.0 phases 0-8).

### Tooling & Migrations

- [ ] **TOOL-01**: Biome 2.4 configured as linter/formatter with isolated formatting commit added to `.git-blame-ignore-revs`
- [ ] **TOOL-02**: react-day-picker upgraded from v8 to v9 (React 19 ref compatibility prerequisite)
- [ ] **TOOL-03**: @tailwindcss/vite and tailwindcss upgraded to 4.1.18+ (Vite 7 peer dep prerequisite)
- [ ] **TOOL-04**: Vite upgraded from 6 to 7 with @vitejs/plugin-react compatible version, Node.js engine field and .nvmrc added
- [ ] **TOOL-05**: Recharts upgraded from 2.x to 3.x (React 19 ResponsiveContainer regression fix)
- [ ] **TOOL-06**: @dnd-kit/core upgraded to v7 with matching @dnd-kit/sortable version (pre-existing mismatch resolved)
- [ ] **TOOL-07**: React and react-dom upgraded from 18 to 19 with @types/react and @types/react-dom updated
- [ ] **TOOL-08**: Sentry v10 initialized with React 19 error boundary integration
- [ ] **TOOL-09**: Real database.types.ts generated from Supabase schema replacing manual stubs
- [ ] **TOOL-10**: TypeScript noUnusedLocals and noUnusedParameters enabled and all violations fixed
- [ ] **TOOL-11**: rollup-plugin-visualizer wired for bundle analysis via ANALYZE=true flag

### Design System

- [ ] **DSGN-01**: shadcn .dark CSS block deleted from theme.css (app is dark-only; block overwrites Phoenix palette with generic oklch grays)
- [ ] **DSGN-02**: All hardcoded hex colors converted to CSS variable tokens with dual-token pattern (CSS var for Tailwind/inline styles, hex constant for SVG stroke/fill and motion animate targets)
- [ ] **DSGN-03**: Elevation system defined (surface-0 through surface-overlay) and applied across all page components
- [ ] **DSGN-04**: Typography scale standardized with CSS variable tokens for font sizes, weights, and line heights
- [ ] **DSGN-05**: Border radius tokens defined and applied consistently across components
- [ ] **DSGN-06**: Icon color tokens defined replacing hardcoded icon colors

### Data Wire-Up & Mock Purge

- [ ] **DATA-01**: All 14+ non-functional buttons wired to real actions, disabled with tooltip, or removed
- [ ] **DATA-02**: RoutineBuilder save mutations wired to Supabase (replacing console.log)
- [ ] **DATA-03**: CycleBuilder save mutations wired to Supabase with cycle_days table persisted
- [ ] **DATA-04**: started_at column added to training_cycles table for cycle day position tracking
- [ ] **DATA-05**: Challenges page wired to Supabase (replacing 100% mock data) with real progress tracking
- [ ] **DATA-06**: Community vote persistence wired to Supabase (replacing optimistic-only votes that reset on refresh)
- [ ] **DATA-07**: Dashboard streak computed from real workout_sessions data (replacing hardcoded value)
- [ ] **DATA-08**: Profile stats (total workouts, total volume, member since) wired to real Supabase queries
- [ ] **DATA-09**: Profile avatar and display name loaded from profiles table (replacing hardcoded placeholders)
- [ ] **DATA-10**: Profile settings changes persisted to Supabase (replacing non-functional save)
- [ ] **DATA-11**: DashboardMobile rendered on mobile devices (currently never shown)
- [ ] **DATA-12**: WorkoutHistory date range filter functional with real date-based queries
- [ ] **DATA-13**: Analytics "1Y" and "ALL" time period mappings return correct data ranges
- [ ] **DATA-14**: Biomechanics render-time state updates fixed (no setState during render)
- [ ] **DATA-15**: Auth modal has focus trap, ARIA attributes, and keyboard navigation
- [ ] **DATA-16**: User can reset password via email link
- [ ] **DATA-17**: ExercisePicker exercise library loaded from Supabase (replacing limited hardcoded list)
- [ ] **DATA-18**: User can edit existing routines in RoutineBuilder (not just create new)
- [ ] **DATA-19**: CycleBuilder ProgressionRules and PreviewModal functional
- [ ] **DATA-20**: AnalyticsMobile Trends and Body tabs render real data
- [ ] **DATA-21**: All demo/placeholder data removed -- every component shows real user data or appropriate empty states
- [ ] **DATA-22**: Empty states show contextual guidance (e.g., "Complete your first workout to see analytics here") instead of blank screens

### Goal Setting

- [ ] **GOAL-01**: User can create a frequency goal (target training days per week)
- [ ] **GOAL-02**: User can create a volume goal (target total weight per week/month)
- [ ] **GOAL-03**: User can create a personal record goal (target weight for specific exercise by date)
- [ ] **GOAL-04**: User can view progress toward each active goal with visual indicator (ring/bar)
- [ ] **GOAL-05**: Goal achievement triggers celebration animation (integrates with existing celebrations system)
- [ ] **GOAL-06**: FREE tier limited to 1 active goal; PHOENIX/ELITE get 3 active goals
- [ ] **GOAL-07**: User can edit or delete existing goals without losing historical progress data
- [ ] **GOAL-08**: Dashboard displays goal progress summary widget

### Onboarding

- [ ] **ONBD-01**: New user sees 3-step onboarding Dialog overlay on first authenticated visit (welcome, goal setup, feature hints)
- [ ] **ONBD-02**: All onboarding steps are individually skippable
- [ ] **ONBD-03**: Onboarding detects existing workout sessions and skips for users who already have data from mobile app
- [ ] **ONBD-04**: Existing v1.0 users see a dismissible "What's new in v1.1" banner instead of full onboarding
- [ ] **ONBD-05**: Onboarding completion state persisted (user_onboarding table) so it never re-shows
- [ ] **ONBD-06**: Feature discovery hints appear as dismissible tooltips after first real session data loads

### Recovery & Readiness

- [ ] **RCVR-01**: Recovery dashboard page displays Training Load Readiness score (0-100) with green/amber/red indicator
- [ ] **RCVR-02**: Readiness score computed from volume load (7-day vs 42-day rolling average), training frequency, and cycle position
- [ ] **RCVR-03**: Score gated behind 14-day minimum data requirement; shows "Keep training -- activates after 2 weeks" until threshold met
- [ ] **RCVR-04**: Score output clamped to 25-75% range until 30 days of data; uses descriptive language only ("your training load suggests moderate recovery")
- [ ] **RCVR-05**: Contributing factors (volume load, rest taken, frequency vs target) displayed alongside the score
- [ ] **RCVR-06**: Data source transparency shown above score with disclaimer on first use
- [ ] **RCVR-07**: If Garmin/Fitbit integration connected, surfaces wearable recovery data alongside training load score
- [ ] **RCVR-08**: FREE tier sees basic rest day count; PHOENIX/ELITE see full readiness score
- [ ] **RCVR-09**: Recovery dashboard widget on Dashboard page next to scheduled workout widget

### Community Comments

- [ ] **CMNT-01**: User can view flat-list comments on any shared routine or cycle in CommunityDetailDrawer
- [ ] **CMNT-02**: PHOENIX/ELITE users can post comments (max 500 characters) on shared routines/cycles
- [ ] **CMNT-03**: User can edit own comments within 5-minute grace period
- [ ] **CMNT-04**: User can soft-delete own comments
- [ ] **CMNT-05**: Comment count displayed on CommunityFeedCard alongside vote count
- [ ] **CMNT-06**: Rate limit of 5 comments per user per hour enforced at database level
- [ ] **CMNT-07**: community_comments table has RLS enabled in migration (read all non-deleted; insert/soft-delete own only)
- [ ] **CMNT-08**: Realtime subscription for new comments scoped per item_id, unsubscribes when drawer closes
- [ ] **CMNT-09**: FREE users see comments but see locked comment input with subscription upgrade prompt

### Workout Comparison

- [ ] **COMP-01**: User can select two sessions from WorkoutHistory and navigate to comparison view
- [ ] **COMP-02**: SessionDetail page has "Compare with..." button that opens session picker
- [ ] **COMP-03**: Comparison view shows side-by-side session summary (date, duration, total volume, set count, PR count) with delta indicators
- [ ] **COMP-04**: Per-exercise breakdown shows sets, weight, volume, and velocity with percentage deltas (green = improvement, red = regression)
- [ ] **COMP-05**: Session picker warns if selected sessions share fewer than 2 exercises
- [ ] **COMP-06**: Comparison validates against selecting the same session twice
- [ ] **COMP-07**: Mobile layout stacks panels vertically with A/B tab switching
- [ ] **COMP-08**: Comparison view gated to PHOENIX/ELITE tiers

### Session Reports

- [ ] **REPT-01**: User can print a session summary report from SessionDetail page via window.print() with @media print CSS
- [ ] **REPT-02**: Print report includes header (date, routine, duration, volume), exercise table with sets/reps/weight and PR flags, and Phoenix branding footer
- [ ] **REPT-03**: Charts render correctly in print (SVG-based Recharts); Canvas-based elements replaced with static summary
- [ ] **REPT-04**: Session reports gated to PHOENIX/ELITE tiers
- [ ] **REPT-05**: Print layout hides navigation, sidebar, and interactive elements

### Delivery & Polish

- [ ] **DLVR-01**: PWA manifest and service worker configured with autoUpdate strategy and offline banner
- [ ] **DLVR-02**: PWA install prompt shown after 3+ sessions (not on first visit)
- [ ] **DLVR-03**: Service worker sets Cache-Control: no-cache on sw.js with updateViaCache: 'none'
- [ ] **DLVR-04**: web-vitals metrics piped to Sentry for performance monitoring
- [ ] **DLVR-05**: Playwright E2E test suite covering all v1.1 features with @axe-core/playwright WCAG audit
- [ ] **DLVR-06**: Accessibility audit completed and critical issues fixed (focus management, ARIA, keyboard navigation, color contrast)
- [ ] **DLVR-07**: Bundle analysis run and any regressions from v1.0 baseline (71KB main chunk) addressed

## v1.2 Requirements (Deferred)

Acknowledged scope tracked for next milestone.

### Enhanced Comparison
- **COMP-09**: Force curve overlay in workout comparison view (Canvas rendering in split-view)

### Shareable Reports
- **REPT-06**: ELITE users can generate shareable report link (share_token in DB, public auth-bypass route, 30-day expiry)

### Community Enhancements
- **CMNT-10**: Nested comment threads (replies to comments) with recursive queries
- **CMNT-11**: Moderation admin UI for reported comments

### Engagement
- **ENGM-01**: Weekly email digest with training summary (requires email infrastructure)

### Goals
- **GOAL-09**: Body weight / composition goals (requires body metrics table and separate tracking flow)

## Out of Scope

| Feature | Reason |
|---------|--------|
| HRV-based recovery score | Requires wearable sensor data not available from Vitruvian machine; would be deceptive |
| AI-generated workout suggestions | Portal is view-only companion; workout prescription violates positioning |
| Real-time chat / DMs | Requires moderation infrastructure; high ongoing cost for low differentiation |
| Custom exercise creation | Breaks muscle mapping, volume tracking, and force curve analysis |
| React Compiler (opt-in) | Stable but opt-in only; defer evaluation to v1.2 after React 19 stabilizes |
| Light mode / theme toggle | App is dark-only by design; .dark block deletion assumes single theme |
| Offline mode / full PWA | Portal requires real-time data; PWA is for installability and caching only |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| TOOL-01 | Phase 13 | Pending |
| TOOL-02 | Phase 9 | Pending |
| TOOL-03 | Phase 9 | Pending |
| TOOL-04 | Phase 9 | Pending |
| TOOL-05 | Phase 9 | Pending |
| TOOL-06 | Phase 9 | Pending |
| TOOL-07 | Phase 9 | Pending |
| TOOL-08 | Phase 9 | Pending |
| TOOL-09 | Phase 13 | Pending |
| TOOL-10 | Phase 9 | Pending |
| TOOL-11 | Phase 9 | Pending |
| DSGN-01 | Phase 9 | Pending |
| DSGN-02 | Phase 9 | Pending |
| DSGN-03 | Phase 9 | Pending |
| DSGN-04 | Phase 9 | Pending |
| DSGN-05 | Phase 9 | Pending |
| DSGN-06 | Phase 9 | Pending |
| DATA-01 | Phase 10 | Pending |
| DATA-02 | Phase 10 | Pending |
| DATA-03 | Phase 10 | Pending |
| DATA-04 | Phase 10 | Pending |
| DATA-05 | Phase 10 | Pending |
| DATA-06 | Phase 10 | Pending |
| DATA-07 | Phase 10 | Pending |
| DATA-08 | Phase 10 | Pending |
| DATA-09 | Phase 10 | Pending |
| DATA-10 | Phase 10 | Pending |
| DATA-11 | Phase 10 | Pending |
| DATA-12 | Phase 10 | Pending |
| DATA-13 | Phase 10 | Pending |
| DATA-14 | Phase 10 | Pending |
| DATA-15 | Phase 10 | Pending |
| DATA-16 | Phase 10 | Pending |
| DATA-17 | Phase 10 | Pending |
| DATA-18 | Phase 10 | Pending |
| DATA-19 | Phase 10 | Pending |
| DATA-20 | Phase 10 | Pending |
| DATA-21 | Phase 10 | Pending |
| DATA-22 | Phase 10 | Pending |
| GOAL-01 | Phase 11 | Pending |
| GOAL-02 | Phase 11 | Pending |
| GOAL-03 | Phase 11 | Pending |
| GOAL-04 | Phase 11 | Pending |
| GOAL-05 | Phase 11 | Pending |
| GOAL-06 | Phase 11 | Pending |
| GOAL-07 | Phase 11 | Pending |
| GOAL-08 | Phase 11 | Pending |
| ONBD-01 | Phase 11 | Pending |
| ONBD-02 | Phase 11 | Pending |
| ONBD-03 | Phase 11 | Pending |
| ONBD-04 | Phase 11 | Pending |
| ONBD-05 | Phase 11 | Pending |
| ONBD-06 | Phase 13 | Pending |
| RCVR-01 | Phase 11 | Pending |
| RCVR-02 | Phase 11 | Pending |
| RCVR-03 | Phase 11 | Pending |
| RCVR-04 | Phase 11 | Pending |
| RCVR-05 | Phase 11 | Pending |
| RCVR-06 | Phase 11 | Pending |
| RCVR-07 | Phase 11 | Pending |
| RCVR-08 | Phase 11 | Pending |
| RCVR-09 | Phase 11 | Pending |
| CMNT-01 | Phase 11 | Pending |
| CMNT-02 | Phase 11 | Pending |
| CMNT-03 | Phase 11 | Pending |
| CMNT-04 | Phase 11 | Pending |
| CMNT-05 | Phase 11 | Pending |
| CMNT-06 | Phase 11 | Pending |
| CMNT-07 | Phase 11 | Pending |
| CMNT-08 | Phase 11 | Pending |
| CMNT-09 | Phase 11 | Pending |
| COMP-01 | Phase 11 | Pending |
| COMP-02 | Phase 11 | Pending |
| COMP-03 | Phase 11 | Pending |
| COMP-04 | Phase 11 | Pending |
| COMP-05 | Phase 11 | Pending |
| COMP-06 | Phase 11 | Pending |
| COMP-07 | Phase 11 | Pending |
| COMP-08 | Phase 11 | Pending |
| REPT-01 | Phase 12 | Pending |
| REPT-02 | Phase 12 | Pending |
| REPT-03 | Phase 12 | Pending |
| REPT-04 | Phase 12 | Pending |
| REPT-05 | Phase 12 | Pending |
| DLVR-01 | Phase 12 | Pending |
| DLVR-02 | Phase 12 | Pending |
| DLVR-03 | Phase 12 | Pending |
| DLVR-04 | Phase 12 | Pending |
| DLVR-05 | Phase 13 | Pending |
| DLVR-06 | Phase 13 | Pending |
| DLVR-07 | Phase 12 | Pending |

**Coverage:**
- v1.1 requirements: 91 total
- Mapped to phases: 91
- Unmapped: 0

---
*Requirements defined: 2026-02-16*
*Last updated: 2026-02-16 after roadmap creation — 91/91 requirements mapped*
