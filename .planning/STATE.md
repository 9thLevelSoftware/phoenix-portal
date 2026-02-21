# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-20)

**Core value:** Premium subscribers see data and insights about their training that they cannot get anywhere else -- force curves, velocity trends, muscle balance analysis, and community-driven workout programming -- making the subscription feel indispensable.
**Current focus:** v1.2 Premium Visual Overhaul — Phase 14: CSS Foundation & Typography

## Current Position

Phase: 14 of 19 (CSS Foundation & Typography)
Plan: 2 of 2 in current phase — PHASE COMPLETE
Status: In progress
Last activity: 2026-02-21 — 14-02 complete (ambient glows, grain texture, shadow tokens, surface-3)

Progress: [█░░░░░░░░░] 5% (v1.2)

## Performance Metrics

**Velocity (v1.0):**
- Total plans completed: 41
- Average duration: 3 min
- Total execution time: ~2 hours

**Velocity (v1.1):**
- Total plans completed: 22
- Average duration: 6.0 min
- Total execution time: ~131 min

**Velocity (v1.2):**
- Total plans completed: 2
- Average duration: 2 min
- Total execution time: ~4 min

## Accumulated Context

### Decisions

All v1.0 and v1.1 decisions archived in PROJECT.md Key Decisions table.

**v1.2 Phase 14 decisions (from 14-01):**
- Inter Variable loaded with full wght axis (0,100..900;1,100..900) to unlock non-standard weights 450 and 625
- Bebas Neue removed entirely — not used anywhere in the app
- fonts.css uses @theme block (not @layer base) so Tailwind v4 generates html/:host font-family rule automatically
- SVG fontFamily must use literal string "Inter, system-ui, sans-serif" — CSS vars don't resolve in SVG presentation attributes
- h2 weight 625 (non-standard variable font weight) provides perceptible distinction from h1(700) and h3(500)
- AppLayout gets relative z-[10] for Plan 02 compatibility with ambient glow body layers

**v1.2 Phase 14 decisions (from 14-02):**
- Tailwind shadow utilities require standalone @theme block (not @theme inline) — @theme inline only bridges existing vars, does not generate utility values
- Circular var() self-references in @theme inline removed — they were no-ops; standalone @theme defines actual shadow values
- SVG feTurbulence grain texture embedded as inline data URI — zero external file dependency, survives production build
- body::before/::after use position: fixed to cover full viewport on scroll; AppLayout z-10 keeps content above z-0/z-1 glow layers
- .border-secondary override uses !important in @layer base to override Tailwind utilities layer specificity

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

Last session: 2026-02-21
Stopped at: Completed 14-02-PLAN.md — Phase 14 CSS Foundation & Typography complete; ambient glows, shadow tokens, grain texture, surface-3, card elevation, border-secondary override done
Resume file: N/A
