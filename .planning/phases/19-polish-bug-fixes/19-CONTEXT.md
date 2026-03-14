---
phase: 19-polish-bug-fixes
milestone: v1.2
depends_on: [18-data-visualization-styling]
total_plans: 1
total_waves: 1
requirements: [BUG-01, BUG-02, BUG-03, BUG-04, BUG-05, BUG-06, BUG-09, BUG-10]
---

# Phase 19: Polish & Bug Fixes — Context

## Phase Goal

Fix remaining UI bugs: footer nav links wrapped in proper anchors, unused CSS animations wired to relevant elements.

## Requirements Status

6 of 8 bugs were resolved in prior phases:
- **BUG-01** ✅ Already resolved — LandingPage imports TIER_PRICING from pricing.ts (no hardcoded prices)
- **BUG-02** ✅ Already resolved — No dead notification logic found in MobileBottomNav
- **BUG-03** ✅ Already resolved — "Badges Earned" stat wired to real earnedBadges query data
- **BUG-04** ✅ Already resolved — Streak card uses Lucide Flame icon with PHOENIX.ember, not raw emoji
- **BUG-05** ✅ Resolved in Phase 18 — All #374151 replaced by RechartsTooltip component
- **BUG-06** ✅ Resolved in Phase 18 — #60A5FA replaced with PHOENIX.ember on Analytics bar

2 bugs require code changes:
- **BUG-09**: Footer nav `<li>` elements in LandingPage.tsx (lines 924-927, 985) lack Link/anchor wrapping
- **BUG-10**: CSS animations `animate-flame-flicker` and `animate-phoenix-glow` defined in theme.css but unused

## Plan Structure

| Plan | Wave | Name | Requirements | Agent |
|------|------|------|-------------|-------|
| 19-01 | 1 | Footer Links & Animation Wiring | BUG-09, BUG-10 | autonomous |

---
*Generated: 2026-03-13*
