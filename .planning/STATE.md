# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-16)

**Core value:** Premium subscribers see data and insights about their training that they cannot get anywhere else -- force curves, velocity trends, muscle balance analysis, and community-driven workout programming -- making the subscription feel indispensable.
**Current focus:** Phase 12 — Schedule-Dependent Features & Delivery

## Current Position

Phase: 12 of 13 (Schedule-Dependent Features & Delivery)
Plan: 3 of 4 in current phase
Status: Executing phase 12
Last activity: 2026-02-17 — Plan 12-03 complete (PWA & delivery)

Progress: [██████░░░░] 59% (11 of 13 phases complete, 60/63 total plans)

## Performance Metrics

**Velocity (v1.0):**
- Total plans completed: 41
- Average duration: 3 min
- Total execution time: ~2 hours

**By Phase (v1.1):**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 09-foundation-toolchain | 5/5 | 33 min | 6.6 min |
| 10-wire-up-mock-purge | 5/5 | 39 min | 7.8 min |
| 11-new-features | 5/5 | 32 min | 6.4 min |
| 12-schedule-dependent-features-delivery | 3/4 | 10 min | 3.3 min |

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
- [Phase 9, Plan 5]: Non-Phoenix palette colors (#6366F1, #FC4C02, #8B5CF6, etc.) retained as arbitrary values -- no semantic tokens for third-party/accent colors.
- [Phase 9, Plan 5]: mutedForeground (#9CA3AF) added to PHOENIX constants for chart axis SVG stroke values where CSS vars cannot be used.
- [Phase 9, Plan 5]: Color usage rule: Tailwind classes = semantic tokens; SVG/Recharts = PHOENIX.* constants; inline styles = var(--token).
- [Phase 10, Plan 1]: Confirmed mutation pattern (not optimistic) for RoutineBuilder/CycleBuilder saves. Toast confirms success; no speculative UI.
- [Phase 10, Plan 1]: Save stays on page (no navigate away) with toast confirmation as the success signal.
- [Phase 10, Plan 1]: UnsavedChangesDialog uses shadcn AlertDialog primitives with Phoenix theme (Save/Discard/Cancel buttons).
- [Phase 10, Plan 1]: CycleBuilder ProgressionRules uses fully typed props; PreviewModal uses shadcn Dialog for consistency.
- [Phase 10, Plan 2]: Profile badges tab shows empty state -- no badge table exists yet. Link to challenges instead.
- [Phase 10, Plan 2]: Profile integrations tab queries real user_integrations data instead of hardcoded app list.
- [Phase 10, Plan 2]: useStreak hook extracted for reuse: Dashboard, DashboardMobile, Profile, WorkoutHistory all share it.
- [Phase 10, Plan 2]: Settings persistence uses confirmed mutation pattern (not optimistic) with local useState synced from query data.
- [Phase 10, Plan 3]: useVote refactored from optimistic to confirmed pattern -- removed onMutate/onError/voteMutedRef entire system.
- [Phase 10, Plan 3]: Challenges use confirmed mutation pattern for join/leave/complete. Challenge progress computed from workout_sessions.
- [Phase 10, Plan 3]: Client-side date filtering in WorkoutHistory (all data already fetched). No query param changes needed.
- [Phase 10, Plan 3]: Biomechanics/ExerciseProgress auto-selection moved from render-time setState to useEffect with derived effective* values.
- [Phase 10, Plan 4]: Auth modal replaced with Radix Dialog for automatic focus trap, ARIA, and keyboard nav.
- [Phase 10, Plan 4]: Password reset: inline toggle within auth dialog, reset page outside ProtectedRoute (magic link arrives without session).
- [Phase 10, Plan 4]: ExercisePicker merges Supabase exercises with 30-exercise static fallback, deduped case-insensitive.
- [Phase 10, Plan 4]: EmptyState pattern: shared component from @/app/components/ui/empty-state deployed across 6+ feature pages.
- [Phase 10, Plan 4]: Dashboard zero-session welcome view gates on hasNoWorkouts (loading complete + empty array).
- [Phase 10, Plan 5]: No decisions required -- plan executed exactly as written (dead code deletion + toast.error fix).
- [Phase 11, Plan 2]: Onboarding detection uses 4-scenario tree: new user (no row + no workouts), v1.0 mobile user (no row + has workouts), v1.0 web user (row + old version), v1.1 user (row + current version).
- [Phase 11, Plan 2]: WhatsNewBanner auto-creates onboarding row on dismiss (v1.0 mobile users never had one). Both complete and dismiss use upsert with version_seen='1.1'.
- [Phase 11, Plan 2]: FeatureHint is passive reusable component -- no hints placed in onboarding plan; feature plans add them to their UI elements.
- [Phase 11, Plan 4]: Flat-list comments (no nesting) per locked research decision. Soft-delete via deleted_at column.
- [Phase 11, Plan 4]: 1-second debounce on comment realtime (faster than 2.5s votes debounce for chat-like UX).
- [Phase 11, Plan 4]: comment_count as denormalized column with trigger auto-update (avoids COUNT query on every feed render).
- [Phase 11, Plan 4]: Client+server edit window enforcement: UI hides edit button AND RLS blocks update after 5 minutes.
- [Phase 11, Plan 5]: Velocity data sourced from rep_summaries mean_velocity_mps, averaged per exercise per session.
- [Phase 11, Plan 5]: Compare mode in WorkoutHistory forces list view for selection UX clarity.
- [Phase 11, Plan 5]: SessionDetail FREE users see disabled Compare button (discovery/upsell pattern) rather than hiding it.
- [Phase 11, Plan 1]: Goal progress computation uses Zod-transformed data (already doubled) to avoid double-doubling weight values.
- [Phase 11, Plan 1]: Goal achievement detection uses ref-based Set to prevent re-triggering celebrations on re-render.
- [Phase 11, Plan 1]: FREE tier sees EmptyState upgrade prompt for goals; PHOENIX/ELITE get 3 active goals.
- [Phase 11, Plan 3]: Recovery ACWR uses raw per-cable volume (no Zod doubling) since algorithm cares about relative ratios only.
- [Phase 11, Plan 3]: Weighted composite scoring: ACWR 50%, rest days 30%, cycle position 20%.
- [Phase 11, Plan 3]: Cycle position deload detection uses currentWeek % 4 === 0 heuristic.
- [Phase 11, Plan 3]: Recovery disclaimer persisted via localStorage (not Supabase) to avoid extra DB roundtrip.
- [Phase 12, Plan 2]: Print button uses fallback={null} so FREE users see nothing (no upgrade prompt for print feature).
- [Phase 12, Plan 2]: Print-only branding footer uses PNG fallback logo for maximum print compatibility.
- [Phase 12, Plan 3]: updateViaCache set to 'none' explicitly (workbox default is 'imports', not 'none') per DLVR-03.
- [Phase 12, Plan 3]: DLVR-04 (web vitals) satisfied by existing Sentry browserTracingIntegration with tracesSampleRate 0.1 -- no code changes needed.
- [Phase 12, Plan 3]: Module-level beforeinstallprompt listener captures event before React mounts, surviving component remounts.
- [Phase 12, Plan 3]: PNG icons generated from WebP sources via sharp, not copied from fallback.

### Pending Todos

None.

### Blockers/Concerns

- visx React 19 peer dep compatibility requires empirical verification after React 19 upgrade (Phase 9). Fallback: fix affected charts separately; do not block migration.
- Recovery ACWR thresholds (sweet spot 0.8-1.3, spike >1.5, detraining <0.6) implemented with conservative values. Sport-science validation for cable resistance training still recommended post-launch.
- shadcn component customizations inventory must be created before running npx shadcn@latest add on any component (Phase 9 pre-work).

**Non-blocking items for human verification (carried from v1.0):**
- Stripe checkout/portal/webhooks (needs Stripe test environment)
- OAuth flows with real credentials (Strava, Fitbit, Garmin)
- Session replay animations and mobile layout (needs live testing)
- 11 Supabase Edge Functions (needs deployment)

## Session Continuity

Last session: 2026-02-17
Stopped at: Completed 12-03-PLAN.md (PWA & delivery)
Resume file: .planning/phases/12-schedule-dependent-features-delivery/12-04-PLAN.md
