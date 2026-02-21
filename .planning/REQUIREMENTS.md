# Requirements: Phoenix Portal v1.2 Premium Visual Overhaul

**Defined:** 2026-02-20
**Core Value:** Premium subscribers see data and insights about their training that they cannot get anywhere else — making the subscription feel indispensable.

## v1.2 Requirements

### Typography

- [x] **TYPE-01**: Inter font-family declared on body/html — entire app renders in Inter, not browser default
- [x] **TYPE-02**: Dead CSS variables (`--font-size-xs` through `--font-size-3xl`) removed or wired to actual heading styles
- [ ] **TYPE-03**: Hardcoded `fontFamily: "system-ui"` removed from LandingPage hero h1
- [x] **TYPE-04**: Headings use differentiated font-weights (page titles heavier than section headers than card titles)
- [x] **TYPE-05**: Uppercase labels use `letter-spacing: 0.05-0.1em` and small font size for eyebrow treatment
- [x] **TYPE-06**: Inter Variable loaded with non-standard weights (450/625) for premium type contrast

### Navigation & Layout

- [x] **NAV-01**: 13-item horizontal top nav replaced with collapsible left sidebar using shadcn/ui Sidebar component
- [x] **NAV-02**: Sidebar collapses to icon-only rail at narrower desktop widths
- [x] **NAV-03**: Sidebar items grouped into sections (Training, Social, Account)
- [x] **NAV-04**: Active sidebar item uses `bg-primary/10 text-primary` full-row highlight
- [x] **NAV-05**: Right-side nav cluster consolidated — avatar opens dropdown with profile/tier/streak/logout
- [x] **NAV-06**: Shared PageShell component replaces 30+ duplicated `max-w-7xl mx-auto px-4` patterns
- [x] **NAV-07**: `useIsMobile` initializes synchronously from `window.innerWidth` — no layout flash on mobile
- [x] **NAV-08**: DashboardMobile, AnalyticsMobile, CommunityMobile, ChallengesMobile merged into CSS-responsive parent components
- [x] **NAV-09**: MobileBottomNav "More" drawer items grouped into labeled sections

### Visual Depth & Surfaces

- [ ] **VIS-01**: Body background has ambient radial gradient glows (ember at top-left, flame-red at bottom-right, 6-10% opacity)
- [x] **VIS-02**: Subtle PNG noise/grain texture overlay on body via `::after` pseudo-element
- [x] **VIS-03**: Card surface hierarchy: hero cards (brand shadow + border glow), primary cards (elevated + blur), secondary cards (subtle surface)
- [x] **VIS-04**: `--shadow-sm/md/lg` tokens actually applied to cards (currently defined but unused)
- [x] **VIS-05**: Default card borders changed from `border-secondary` (#374151) to `rgba(255,255,255,0.06)` subtle separator
- [x] **VIS-06**: Glassmorphism (`backdrop-blur + semi-transparent bg`) applied to 2-3 key cards per page only (max 3 blur layers per viewport)
- [x] **VIS-07**: Auth dialog uses dark glass treatment (blur + branded border + inner shadow)
- [x] **VIS-08**: Landing page feature cards have gradient borders and hover lift with glow bloom
- [x] **VIS-09**: Icon containers upgraded from uniform `w-12 h-12 rounded-lg` to differentiated treatments (primary: rounded-full + glow, secondary: no container)

### Motion & Animation

- [ ] **MOT-01**: Page transitions via AnimatePresence wrapping router outlet (using `useOutlet()` pattern for React Router v7 compatibility)
- [ ] **MOT-02**: Card hover states use Framer Motion spring physics (`whileHover={{ scale: 1.015, y: -2 }}` with elevated shadow)
- [ ] **MOT-03**: Entrance animations use `staggerChildren` variants instead of manual delay offsets
- [ ] **MOT-04**: Shared animation presets centralized in `src/lib/animations.ts` (fadeUp, staggerContainer, pageTransition)
- [ ] **MOT-05**: Stat numbers animate from 0 to value on mount using `@number-flow/react`
- [ ] **MOT-06**: Landing hero has scroll parallax (`useScroll` + `useTransform` on content container)
- [ ] **MOT-07**: Scroll indicator replaced with Framer Motion breathing animation (not Tailwind `animate-bounce`)
- [ ] **MOT-08**: Loading state uses branded Phoenix flame pulse instead of generic spinner
- [ ] **MOT-09**: `prefers-reduced-motion` check on EmberParticles and all entrance animations
- [ ] **MOT-10**: Key CTAs have `whileTap={{ scale: 0.97 }}` press feedback

### Data Visualization

- [ ] **VIZ-01**: Custom branded `<ChartTooltip>` component replaces all inline `contentStyle` tooltip configs
- [ ] **VIZ-02**: Chart axes styled: `tickLine={false}`, `axisLine={false}`, consistent font size/color across all charts
- [ ] **VIZ-03**: CartesianGrid standardized to `strokeOpacity={0.3}` across all chart files
- [ ] **VIZ-04**: All Recharts charts have explicit `animationDuration={800}` and `animationEasing="ease-out"`
- [ ] **VIZ-05**: Pie chart converted to donut (`innerRadius={60}`) with center label showing dominant category
- [ ] **VIZ-06**: Default `fill="#8884d8"` removed from Analytics pie chart
- [ ] **VIZ-07**: Muscle heatmap back regions fixed — proper SVG paths or front/back toggle added
- [ ] **VIZ-08**: ExerciseProgress stat values increased to `text-4xl font-bold` with color-coded delta pill
- [ ] **VIZ-09**: Chart axis labels specify `fontFamily` and `fontSize` explicitly (not browser default)

### Bug Fixes

- [ ] **BUG-01**: LandingPage pricing ($9.99/$19.99) synced with PricingPlans ($14.99/$24.99) — single source of truth
- [ ] **BUG-02**: MobileBottomNav dead notification logic removed from primaryItems loop
- [ ] **BUG-03**: Dashboard "Badges Earned" stat removed or replaced with real data metric
- [ ] **BUG-04**: Streak card raw emoji replaced with styled Lucide Flame icon + phoenix-glow animation
- [ ] **BUG-05**: Hardcoded `#374151` hex in Recharts tooltip styles replaced with CSS variable references
- [ ] **BUG-06**: Hardcoded `#60A5FA` on Analytics external activity bar replaced with palette constant
- [x] **BUG-07**: Gradient text reserved for hero headlines only — section headers use solid `text-white` or `text-primary`
- [x] **BUG-08**: AppLayout `bg-[#0D0D0D]` changed to `bg-background` for design system consistency
- [ ] **BUG-09**: Footer nav `<li>` elements wrapped in proper `<Link>` or `<a>` tags
- [ ] **BUG-10**: Custom CSS animations (`animate-flame-flicker`, `animate-phoenix-glow`) applied to relevant UI elements instead of sitting unused

## Future Requirements

### Deferred Visual Polish

- **VIS-F01**: Animated gradient orbs (conic-gradient rotation) on landing hero background
- **VIS-F02**: GoalCelebration particle burst with randomized ease/rotation per particle
- **VIS-F03**: Onboarding overlay step transitions upgraded to spring physics with feature list stagger
- **VIS-F04**: Comparison view bar chart visualization (A vs B per exercise)

## Out of Scope

| Feature | Reason |
|---------|--------|
| Light mode / theme toggle | App is dark-only by design (v1.1 decision) |
| React Compiler | Stable but opt-in; defer evaluation after visual overhaul |
| New features (nested comments, admin) | v1.2 is visual-only — no new functionality |
| Chart library replacement | Recharts + visx stay; style them, don't replace them |
| Custom illustration system | Empty state illustrations deferred — use icon+text pattern |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| TYPE-01 | Phase 14 | Complete |
| TYPE-02 | Phase 14 | Complete |
| TYPE-03 | Phase 20 | Pending |
| TYPE-04 | Phase 14 | Complete |
| TYPE-05 | Phase 14 | Complete |
| TYPE-06 | Phase 14 | Complete |
| NAV-01 | Phase 15 | Complete |
| NAV-02 | Phase 15 | Complete |
| NAV-03 | Phase 15 | Complete |
| NAV-04 | Phase 15 | Complete |
| NAV-05 | Phase 15 | Complete |
| NAV-06 | Phase 15 | Complete |
| NAV-07 | Phase 15 | Complete |
| NAV-08 | Phase 15 | Complete |
| NAV-09 | Phase 15 | Complete |
| VIS-01 | Phase 20 | Pending |
| VIS-02 | Phase 14 | Complete |
| VIS-03 | Phase 16 | Complete |
| VIS-04 | Phase 14 | Complete |
| VIS-05 | Phase 14 | Complete |
| VIS-06 | Phase 16 | Complete |
| VIS-07 | Phase 16 | Complete |
| VIS-08 | Phase 16 | Complete |
| VIS-09 | Phase 16 | Complete |
| MOT-01 | Phase 17 | Pending |
| MOT-02 | Phase 17 | Pending |
| MOT-03 | Phase 17 | Pending |
| MOT-04 | Phase 17 | Pending |
| MOT-05 | Phase 17 | Pending |
| MOT-06 | Phase 17 | Pending |
| MOT-07 | Phase 17 | Pending |
| MOT-08 | Phase 17 | Pending |
| MOT-09 | Phase 17 | Pending |
| MOT-10 | Phase 17 | Pending |
| VIZ-01 | Phase 18 | Pending |
| VIZ-02 | Phase 18 | Pending |
| VIZ-03 | Phase 18 | Pending |
| VIZ-04 | Phase 18 | Pending |
| VIZ-05 | Phase 18 | Pending |
| VIZ-06 | Phase 18 | Pending |
| VIZ-07 | Phase 18 | Pending |
| VIZ-08 | Phase 18 | Pending |
| VIZ-09 | Phase 18 | Pending |
| BUG-01 | Phase 19 | Pending |
| BUG-02 | Phase 19 | Pending |
| BUG-03 | Phase 19 | Pending |
| BUG-04 | Phase 19 | Pending |
| BUG-05 | Phase 19 | Pending |
| BUG-06 | Phase 19 | Pending |
| BUG-07 | Phase 16 | Complete |
| BUG-08 | Phase 14 | Complete |
| BUG-09 | Phase 19 | Pending |
| BUG-10 | Phase 19 | Pending |

**Coverage:**
- v1.2 requirements: 53 total
- Mapped to phases: 53
- Unmapped: 0

---
*Requirements defined: 2026-02-20*
*Last updated: 2026-02-20 after roadmap creation — all 53 requirements mapped to Phases 14-19*
