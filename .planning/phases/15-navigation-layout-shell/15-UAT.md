---
status: complete
phase: 15-navigation-layout-shell
source: 15-01-SUMMARY.md, 15-02-SUMMARY.md, 15-03-SUMMARY.md
started: 2026-02-20T23:30:00Z
updated: 2026-02-21T00:10:00Z
---

## Current Test

[testing complete]

## Tests

### 1. Sidebar Navigation Visible
expected: On desktop (>768px), a collapsible left sidebar is visible with 3 nav groups — Training (Dashboard, Workouts, Analytics, Routines, Cycles), Social (Community, Challenges, Leaderboard), Account (Profile, Settings, Subscription). All 11 items listed with icons.
result: pass

### 2. Sidebar Nav Routing and Active State
expected: Clicking a nav item navigates to that page. The active item shows ember-colored highlight background and a 2px left accent bar.
result: pass

### 3. Sidebar Collapse/Expand Toggle
expected: A collapse trigger button at the sidebar footer toggles between full sidebar and icon-rail mode. In icon-rail mode, only icons are visible (no text labels).
result: pass

### 4. Sidebar Auto-Collapse on Narrow Viewport
expected: Resizing the browser window below 1280px auto-collapses the sidebar to icon-rail. Expanding back above 1280px restores the previous open/closed preference.
result: pass

### 5. Sidebar Collapse Preference Persists
expected: Manually collapse the sidebar, reload the page — sidebar stays collapsed. Expand it, reload — sidebar stays expanded. Preference survives page refresh.
result: pass

### 6. Sidebar Tooltips in Collapsed Mode
expected: When sidebar is collapsed to icon-rail, hovering over a nav icon shows a tooltip with the item name.
result: pass

### 7. Avatar Dropdown with User Info
expected: Bottom of sidebar shows user avatar. Clicking it opens a dropdown with display name (or email prefix), tier badge, streak count, and a Logout action.
result: pass

### 8. PageShell Consistent Layout
expected: All authenticated pages (Dashboard, Analytics, Challenges, Community, Profile, PersonalRecords, WorkoutHistory, Routines, Cycles, Biomechanics) have consistent horizontal padding and max-width. Content is centered with responsive padding (tighter on mobile, wider on desktop).
result: pass

### 9. MobileBottomNav Bar
expected: At <768px viewport, a bottom navigation bar appears with 5 items: Dashboard, Workouts, Analytics, Community, More. The desktop sidebar is not visible on mobile.
result: pass

### 10. Mobile More Drawer
expected: Tapping the "More" item in the bottom nav opens a drawer/sheet with nav items grouped under Training, Social, and Account section headers. Tapping an item navigates to that page and closes the drawer.
result: pass

### 11. Mobile Dashboard Layout
expected: At <768px, Dashboard shows a mobile-specific layout with compact header, flame streak indicator, horizontal quick-stat cards, and CSS bar chart — different from the desktop grid layout.
result: pass

### 12. Mobile Analytics Layout
expected: At <768px, Analytics shows stacked stat cards with a mobile-specific tab navigation and simplified week bucketing (W1/W2) — different from desktop's wider chart layout.
result: pass

### 13. Mobile Community Layout
expected: At <768px, Community shows a single-column feed layout instead of the desktop grid. Posts stack vertically for mobile readability.
result: pass

### 14. Mobile Challenges Layout
expected: At <768px, Challenges shows swipeable cards (drag to dismiss) with a Discover tab and AlertDialog for leave confirmation — distinct from desktop's expand/collapse card pattern.
result: pass

## Summary

total: 14
passed: 14
issues: 0
pending: 0
skipped: 0

## Gaps

[none yet]
