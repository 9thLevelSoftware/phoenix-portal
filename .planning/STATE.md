# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-16)

**Core value:** Premium subscribers see data and insights about their training that they cannot get anywhere else -- force curves, velocity trends, muscle balance analysis, and community-driven workout programming -- making the subscription feel indispensable.
**Current focus:** Phase 9 — Foundation & Toolchain

## Current Position

Phase: 9 of 12 (Foundation & Toolchain)
Plan: 4 of 5 in current phase
Status: Executing
Last activity: 2026-02-17 — Plan 09-04 complete (Sentry v10 + Supabase CLI tooling)

Progress: [██░░░░░░░░] 20% (9 of 13 phases complete, 45/58 total plans)

## Performance Metrics

**Velocity (v1.0):**
- Total plans completed: 41
- Average duration: 3 min
- Total execution time: ~2 hours

**By Phase (v1.1):**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 09-foundation-toolchain | 4/5 | 25 min | 6.3 min |

*Updated after each plan completion*

## Accumulated Context

### Decisions

All v1.0 decisions archived in PROJECT.md Key Decisions table.

**v1.1 key constraints:**
- [Phase 9, Plan 1]: Used @dnd-kit/react@0.3.0 (new API) instead of aligning old @dnd-kit/core@6+sortable@6. DragDropProvider+useSortable replaces DndContext+SortableContext.
- [Phase 9, Plan 1]: React 19 requires --legacy-peer-deps due to visx packages. visx works at runtime but has outdated peer deps.
- [Phase 9, Plan 1]: react-is must be an explicit dependency for Recharts 3 + React 19 compatibility.
- [Phase 9, Plan 1]: react-dom/client must be in vendor-react manualChunks to prevent main chunk bloat under React 19.
- [Phase 9]: Upgrade sequence is strict and non-negotiable: react-day-picker v9 → @tailwindcss/vite 4.1.18 → Vite 7 → Recharts 3 → dnd-kit v7 → React 19. Any deviation causes cascading failures.
- [Phase 9]: Delete .dark CSS block FIRST before any color tokenization — block silently overwrites Phoenix palette with oklch grays.
- [Phase 11]: Recovery dashboard MUST gate behind 14-day minimum data requirement. Score clamped to 25-75% until 30 days. Descriptive language only — no imperative commands. Medical liability risk if shipped without these guardrails.
- [Phase 11]: community_comments RLS must be in the migration file, not added post-launch (CVE-2025-48757).
- [Phase 9, Plan 2]: Downgraded 12 pre-existing lint rules to warn level in biome.json instead of 148 biome-ignore comments. Rules can be promoted to error as code is cleaned up.
- [Phase 9, Plan 2]: Biome formatting standard: tabs, double quotes, semicolons, 80-char width. All future code must match.
- [Phase 9, Plan 2]: cross-env required for analyze script due to Windows ANALYZE=true env var syntax.
- [Phase 9, Plan 3]: dark: variant values promoted to base styles (not deleted) since app is dark-only. bg-input/30 is the unified dark input background.
- [Phase 9, Plan 3]: Chart THEMES dark selector set to empty string to preserve API contract for theme consumers.
- [Phase 9, Plan 3]: Dual-token pattern established: CSS variables for Tailwind/inline, hex constants (colors.ts) for SVG/motion.
- [Phase 9, Plan 4]: Hardcoded SUPABASE_PROJECT_REF (ilzlswmatadlnsuxatcv) in gen:types script; no env var needed per run.
- [Phase 9, Plan 4]: TOOL-09 (database.types.ts generation) deferred: supabase CLI needs interactive TTY for login. User must run `npx supabase login` + `npm run gen:types` from a regular terminal.
- [Phase 9, Plan 4]: Sentry enabled only in production (import.meta.env.PROD). React 19 error hooks (onUncaughtError, onCaughtError, onRecoverableError) all wired to single sentryErrorHandler.

### Pending Todos

None.

### Blockers/Concerns

- visx React 19 peer dep compatibility requires empirical verification after React 19 upgrade (Phase 9). Fallback: fix affected charts separately; do not block migration.
- Recovery algorithm ACWR thresholds need sport-science validation for cable resistance training before implementing src/lib/recovery.ts (Phase 11 sub-task).
- shadcn component customizations inventory must be created before running npx shadcn@latest add on any component (Phase 9 pre-work).

**Non-blocking items for human verification (carried from v1.0):**
- Stripe checkout/portal/webhooks (needs Stripe test environment)
- OAuth flows with real credentials (Strava, Fitbit, Garmin)
- Session replay animations and mobile layout (needs live testing)
- 11 Supabase Edge Functions (needs deployment)

## Session Continuity

Last session: 2026-02-17
Stopped at: Completed 09-04-PLAN.md (Sentry v10 + Supabase CLI tooling; TOOL-09 deferred)
Resume file: .planning/phases/09-foundation-toolchain/09-05-PLAN.md
