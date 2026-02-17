# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-16)

**Core value:** Premium subscribers see data and insights about their training that they cannot get anywhere else -- force curves, velocity trends, muscle balance analysis, and community-driven workout programming -- making the subscription feel indispensable.
**Current focus:** Phase 9 — Foundation & Toolchain

## Current Position

Phase: 9 of 12 (Foundation & Toolchain)
Plan: 1 of 5 in current phase
Status: Executing
Last activity: 2026-02-17 — Plan 09-01 complete (React 19 + Vite 7 + Recharts 3 + dnd-kit migration)

Progress: [██░░░░░░░░] 20% (9 of 13 phases complete, 42/58 total plans)

## Performance Metrics

**Velocity (v1.0):**
- Total plans completed: 41
- Average duration: 3 min
- Total execution time: ~2 hours

**By Phase (v1.1):**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 09-foundation-toolchain | 1/5 | 8 min | 8 min |

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
Stopped at: Completed 09-01-PLAN.md (major dependency upgrades)
Resume file: .planning/phases/09-foundation-toolchain/09-02-PLAN.md
