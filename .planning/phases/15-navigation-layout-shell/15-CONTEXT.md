# Phase 15: Navigation & Layout Shell - Context

**Gathered:** 2026-02-20
**Status:** Ready for planning

<domain>
## Phase Boundary

Replace the 13-item horizontal top nav with a collapsible left sidebar on desktop; introduce a shared PageShell that owns max-width and padding for all pages; eliminate the useIsMobile layout flash; merge DashboardMobile, AnalyticsMobile, CommunityMobile, and ChallengesMobile into CSS-responsive parent components. Mobile bottom nav remains but gets labeled "More" drawer sections.

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion

User granted full creative discretion with the directive: **"make the site look amazing."** All decisions below are Claude's opinionated choices — optimized for a premium dark-theme fitness dashboard aesthetic.

### Sidebar content & grouping
- **Logo/brand header** at the top of the sidebar: Phoenix flame icon + "Phoenix Portal" wordmark; wordmark collapses to just the flame icon in rail mode
- **Section groups** with uppercase eyebrow labels (matching Phase 14 typography):
  - **Training**: Dashboard, Workouts, Analytics, Routines, Training Cycles
  - **Social**: Community, Challenges, Leaderboard
  - **Account**: Profile, Settings, Subscription
- **Section dividers**: subtle `border-secondary` separator lines between groups, not heavy borders — the eyebrow labels do the grouping work
- **Icons**: Lucide icon per nav item — consistent stroke weight, no filled variants
- **Active state**: full-row highlight with `bg-primary/10 text-primary` and a 2px left ember accent bar (not just background color alone)

### Collapse & expand behavior
- **Manual toggle**: chevron button at the bottom of the sidebar to collapse/expand
- **Auto-collapse**: sidebar automatically collapses to icon-rail when viewport width drops below 1280px (but stays visible — doesn't hide until mobile breakpoint at 768px)
- **Rail mode**: 64px wide, icons centered, section labels hidden, tooltip on hover for each item
- **Expanded mode**: 240px wide
- **Animation**: smooth width transition (~200ms ease-out), content crossfades between label-visible and icon-only states
- **Persistence**: collapse/expand preference saved in localStorage, auto-collapse overrides if viewport is too narrow
- **Desktop sidebar hides entirely below 768px** — mobile bottom nav takes over

### Avatar dropdown & account cluster
- **Avatar placement**: bottom of sidebar, just above the collapse toggle — not in a top-right header
- **Shows**: user avatar (or initials fallback), display name, tier badge (color-coded: Free/Pro/Elite), current streak with flame icon
- **Dropdown on click**: Profile, Settings, Subscription divider, then Logout — clean and minimal
- **In rail mode**: just the avatar circle, dropdown still opens on click with the same content

### Mobile bottom nav & More drawer
- **Bottom bar items** (5 max, always visible): Dashboard, Workouts, Analytics, Community, More
- **More drawer** opens as a bottom sheet (not full page), grouped with section labels:
  - **Training**: Routines, Training Cycles
  - **Social**: Challenges, Leaderboard
  - **Account**: Profile, Settings, Subscription
- **Drawer sections** use the same eyebrow label style as the desktop sidebar groups
- **Active item** in bottom bar gets ember color icon + label; inactive items are muted

### PageShell layout
- **SharedPageShell component** wraps all page content with: `max-w-7xl mx-auto px-6` on desktop, `px-4` on mobile
- **Replaces** the 30+ duplicated padding/max-width patterns across page components
- **Sidebar-aware**: PageShell's left margin adjusts for sidebar width (240px expanded, 64px collapsed, 0px on mobile)
- **Transition**: margin animates in sync with sidebar collapse for a smooth feel

### Mobile variant merge strategy
- **DashboardMobile → Dashboard**: single component, CSS-responsive breakpoints for layout changes (grid columns, card sizes)
- **AnalyticsMobile → Analytics**: same — conditional rendering only for truly different structures, not separate component files
- **CommunityMobile → Community**: merge, use responsive classes
- **ChallengesMobile → Challenges**: merge, use responsive classes
- **useIsMobile hook** refactored to initialize synchronously from `window.innerWidth` — no hydration flash, no layout shift on first render

</decisions>

<specifics>
## Specific Ideas

- User directive: "make the site look amazing" — prioritize visual polish and smooth transitions over minimal implementation
- The sidebar should feel like a premium SaaS tool (Linear, Raycast, Arc Browser) — not a generic Bootstrap sidebar
- The collapse animation should feel physically weighted, not instant — ember brand should be visible in the active state accent
- Rail mode should feel complete, not like a broken sidebar — icons should be well-chosen and tooltips should appear quickly

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 15-navigation-layout-shell*
*Context gathered: 2026-02-20*
