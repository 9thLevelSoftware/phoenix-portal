---
phase: 15-navigation-layout-shell
plan: "01"
subsystem: navigation
tags: [sidebar, layout, navigation, mobile-detection]
dependency_graph:
  requires: [14-02]
  provides: [sidebar-shell, sidebar-provider, app-layout-v2]
  affects: [all-pages, AppLayout, mobile-detection]
tech_stack:
  added: []
  patterns: [shadcn-sidebar, localStorage-preference, media-query-auto-collapse, lazy-state-initializer]
key_files:
  created:
    - src/app/components/AppSidebar.tsx
  modified:
    - src/app/hooks/useIsMobile.ts
    - src/app/components/ui/use-mobile.ts
    - src/app/routes/AppLayout.tsx
    - src/app/components/Navigation.tsx
decisions:
  - "Auto-collapse uses isAutoCollapsing ref flag to distinguish viewport-driven collapse from user toggle — prevents localStorage overwrite during auto-collapse"
  - "SidebarProvider placed inside AppLayout (ProtectedRoute boundary), not at router root — as per STATE.md constraint"
  - "Navigation.tsx kept with deprecation comment rather than deleted — safe to remove after Phase 15 verification"
  - "useAutoCollapse defined inside AppSidebar.tsx (not a separate file) — keeps collapse logic co-located with sidebar"
  - "NavLink className relative + absolute accent bar span renders inside SidebarMenuButton asChild via NavLink"
metrics:
  duration: "3 min"
  completed: "2026-02-21"
  tasks_completed: 3
  files_modified: 5
---

# Phase 15 Plan 01: Navigation Layout Shell Summary

Replaced the horizontal 13-item top nav with a collapsible shadcn/ui left sidebar, restructured AppLayout with SidebarProvider, and fixed both useIsMobile hooks for synchronous initialization.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Fix both useIsMobile hooks for synchronous initialization | fbbe441 | useIsMobile.ts, use-mobile.ts |
| 2 | Create AppSidebar component | c679b8c | AppSidebar.tsx (new) |
| 3 | Restructure AppLayout with SidebarProvider | a835364 | AppLayout.tsx, Navigation.tsx |

## What Was Built

**useIsMobile fixes (both hooks):** Changed `useState(false)` and `useState<boolean | undefined>(undefined)` to lazy initializers reading `window.innerWidth` synchronously. The `typeof window !== "undefined"` guard is defensive for any future SSR addition. The `!!isMobile` coercion in `use-mobile.ts` was removed — no longer needed since state is now a proper boolean from init.

**AppSidebar component:** Full collapsible sidebar using shadcn/ui Sidebar primitives with:
- 3 nav groups: Training (Dashboard, Workouts, Analytics, Routines, Cycles), Social (Community, Challenges, Leaderboard), Account (Profile, Settings, Subscription)
- Active state via `useLocation()` with `data-[active=true]` triggering `bg-sidebar-accent/text-sidebar-accent-foreground` (wired to ember colors in theme.css)
- 2px left accent bar: `<span className="absolute left-0 top-1 bottom-1 w-0.5 bg-primary rounded-full" />` inside NavLink with `relative` class
- Tooltip support in icon-rail mode via `SidebarMenuButton tooltip` prop
- Avatar dropdown with display name (from `user.user_metadata.full_name` or email prefix), TierBadge, streak count, and logout action
- `useAutoCollapse` hook: auto-collapses below 1280px, restores user preference when crossing back above 1280px
- localStorage persistence via `phoenix-sidebar-preferred-open` key; `isAutoCollapsingRef` prevents writing during viewport-driven collapses
- `SidebarTrigger` collapse toggle at footer bottom

**AppLayout restructure:** Wrapped entire layout in `SidebarProvider defaultOpen={true}`, placed inside AppLayout (inside ProtectedRoute boundary). AppSidebar wrapped in `data-print-hide` div. All existing hooks (realtimeSync, notificationSync, streakSync, celebrationTriggers, onboarding) unchanged. Navigation.tsx preserved with deprecation comment.

## Decisions Made

1. **Auto-collapse ref flag pattern:** `isAutoCollapsingRef.current = true` before `setOpen()`, reset after — distinguishes viewport auto-collapse from user toggle without adding Zustand state
2. **SidebarProvider inside AppLayout:** Per STATE.md constraint — must not be at router root to avoid sidebar appearing on LandingPage
3. **Navigation.tsx deprecation comment rather than deletion:** Prevents broken imports during development; safe delete after Phase 15 full verification
4. **useAutoCollapse co-located in AppSidebar.tsx:** Keeps collapse logic adjacent to the component that owns it; no separate file needed
5. **NavLink asChild via SidebarMenuButton:** Uses `useLocation()` for `isActive` instead of NavLink render prop — avoids anti-pattern noted in RESEARCH.md

## Deviations from Plan

None — plan executed exactly as written.

## Self-Check

- [x] `src/app/components/AppSidebar.tsx` — created and exports `AppSidebar`
- [x] `src/app/routes/AppLayout.tsx` — imports SidebarProvider, SidebarInset, AppSidebar
- [x] `src/app/hooks/useIsMobile.ts` — lazy initializer present
- [x] `src/app/components/ui/use-mobile.ts` — lazy initializer present, no `!!isMobile`
- [x] Commits: fbbe441, c679b8c, a835364 — all exist
- [x] `npm run build` passes with zero errors (4109 modules transformed)
- [x] All 11 nav items confirmed in AppSidebar (Training: 5, Social: 3, Account: 3)
- [x] SidebarProvider present in AppLayout.tsx

## Self-Check: PASSED
