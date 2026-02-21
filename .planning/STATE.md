# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-20)

**Core value:** Premium subscribers see data and insights about their training that they cannot get anywhere else -- force curves, velocity trends, muscle balance analysis, and community-driven workout programming -- making the subscription feel indispensable.
**Current focus:** v1.2 Premium Visual Overhaul — Phase 14: CSS Foundation & Typography

## Current Position

Phase: 14 of 19 (CSS Foundation & Typography)
Plan: 0 of TBD in current phase
Status: Ready to plan
Last activity: 2026-02-20 — v1.2 roadmap created (6 phases, 53 requirements mapped)

Progress: [░░░░░░░░░░] 0% (v1.2)

## Performance Metrics

**Velocity (v1.0):**
- Total plans completed: 41
- Average duration: 3 min
- Total execution time: ~2 hours

**Velocity (v1.1):**
- Total plans completed: 22
- Average duration: 6.0 min
- Total execution time: ~131 min

## Accumulated Context

### Decisions

All v1.0 and v1.1 decisions archived in PROJECT.md Key Decisions table.

Key v1.2 constraints from research:
- Max 3 backdrop-blur layers per viewport simultaneously — GPU overload on mobile otherwise
- AnimatePresence requires useOutlet() not <Outlet> for React Router v7 — exit animations never fire with <Outlet>
- visx ChartTheme.ts hex constants are permanent — SVG cannot resolve CSS vars in presentation attributes; do NOT replace with var(--primary)
- Bundle gate: main chunk must stay under 100KB after every phase; run npm run build + rollup-plugin-visualizer as pre-merge check
- Phase 18 depends on Phase 15 (sidebar must be stable before chart widths are touched) — do not run chart and sidebar PRs in parallel
- SidebarProvider must live inside AppLayout (inside ProtectedRoute), not at router root

### Pending Todos

None.

### Blockers/Concerns

**Non-blocking items for human verification (carried forward from v1.1):**
- Stripe checkout/portal/webhooks (needs Stripe test environment)
- OAuth flows with real credentials (Strava, Fitbit, Garmin)
- Session replay animations and mobile layout (needs live testing)
- 11 Supabase Edge Functions (needs deployment)
- TOOL-09: database.types.ts — Supabase schema only has user_subscriptions deployed; run migrations then `npm run gen:types`
- 17 authenticated E2E tests skip without SUPABASE_TEST_EMAIL/PASSWORD env vars
- Recovery ACWR thresholds may need sport-science validation for cable resistance training

**v1.2 pre-planning items (resolve before Phase 15 planning):**
- Sidebar state deduplication: decide whether useUIStore (Zustand) or SidebarProvider cookie is the single source of truth for sidebar collapsed state — running both causes desync bugs
- AnimatePresence + React 19 concurrent mode: validate useOutlet(context) prototype in isolation before applying to all 26 routes

## Session Continuity

Last session: 2026-02-20
Stopped at: v1.2 roadmap created — ready to plan Phase 14
Resume file: N/A
