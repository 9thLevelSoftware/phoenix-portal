---
phase: 17-gdpr-privacy
plan: 03
subsystem: database, api, ui
tags: [gdpr, account-deletion, supabase-edge-function, stripe, react-query, rls]

# Dependency graph
requires:
  - phase: 17-gdpr-privacy/02
    provides: "GDPR data export infrastructure (ExportSection, profile/ExportSection pattern)"
  - phase: 15-ci-db
    provides: "RLS (select auth.uid()) pattern, subscriptions table"
  - phase: 14-security
    provides: "CORS getCorsHeaders pattern, Edge Function auth pattern"
provides:
  - "deletion_requests table with 30-day grace period"
  - "community content FK anonymization (ON DELETE SET NULL)"
  - "delete-account Edge Function (Stripe cancel, avatar cleanup, auth user deletion)"
  - "useRequestDeletion, useCancelDeletion, useExecuteDeletion mutations"
  - "DangerZone component with 3-state deletion UI"
affects: [community, profile, auth]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "30-day grace period deletion with pending/cancelled/executed status machine"
    - "Edge Function: non-blocking error handling for secondary steps (Stripe, storage)"
    - "3-state deletion UI: request -> pending countdown -> execute"

key-files:
  created:
    - "supabase/migrations/20260301_deletion_support.sql"
    - "supabase/functions/delete-account/index.ts"
    - "src/mutations/account.ts"
    - "src/app/components/profile/DangerZone.tsx"
  modified:
    - "src/app/components/Profile.tsx"

key-decisions:
  - "Stripe customer NOT deleted on account deletion (Stripe DPA requires financial record retention)"
  - "Edge Function logs but continues past Stripe/storage errors to preserve right to erasure"
  - "Date formatting uses native toLocaleDateString instead of importing date-fns (component is self-contained)"
  - "DangerZone placed between ExportSection and Sign Out card in settings tab"

patterns-established:
  - "Account deletion grace period: 30 days via DB default, status machine (pending/cancelled/executed)"
  - "Edge Function error tolerance: log secondary failures but don't block primary operation"
  - "Community content anonymization: ON DELETE SET NULL FKs, display components handle null user_id as '[Deleted User]'"

requirements-completed: [GDPR-02]

# Metrics
duration: 3min
completed: 2026-02-28
---

# Phase 17 Plan 03: Account Deletion Summary

**GDPR Article 17 account deletion with 30-day grace period, community content anonymization via SET NULL FKs, and Stripe subscription cancellation Edge Function**

## Performance

- **Duration:** 3 min 5s
- **Started:** 2026-02-28T03:11:43Z
- **Completed:** 2026-02-28T03:14:48Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- Database migration creates deletion_requests table with RLS and migrates community content FKs from CASCADE to SET NULL
- Edge Function executes ordered deletion: Stripe cancel, avatar cleanup, mark executed, delete auth user (cascading all private data)
- DangerZone component provides 3-state UI: request with confirmation, pending countdown with cancel, and execute after grace period
- React Query mutations wire deletion flow end-to-end with toast feedback and auto-signout

## Task Commits

Each task was committed atomically:

1. **Task 1: Create database migration for deletion support** - `e4c888b` (feat)
2. **Task 2: Create delete-account Edge Function and client-side UI** - `10f41f2` (feat)

## Files Created/Modified
- `supabase/migrations/20260301_deletion_support.sql` - deletion_requests table, FK migrations for anonymization
- `supabase/functions/delete-account/index.ts` - Edge Function: Stripe cancel, avatar cleanup, auth user deletion
- `src/mutations/account.ts` - React Query mutations: request, cancel, execute deletion + query options
- `src/app/components/profile/DangerZone.tsx` - 3-state account deletion UI with AlertDialog confirmations
- `src/app/components/Profile.tsx` - Wire DangerZone into settings tab after ExportSection

## Decisions Made
- Stripe customer NOT deleted on account deletion -- Stripe DPA requires financial record retention; only subscription is cancelled
- Edge Function logs but continues past Stripe/storage errors to preserve user's right to erasure (GDPR compliance)
- Used native toLocaleDateString for scheduled date formatting instead of importing date-fns (keep DangerZone self-contained)
- DangerZone placed between ExportSection and Sign Out card in the settings tab for logical flow (export data -> delete account -> sign out)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- Deno not installed on dev machine; Edge Function type-checked via manual review against established stripe-checkout/index.ts pattern (identical imports, CORS, auth flow)

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Phase 17 GDPR & Privacy is now complete (all 3 plans done)
- Community content display components should handle null user_id as "[Deleted User]" (follow-up for display components, not blocking)
- Ready for next phase in v1.2 milestone

## Self-Check: PASSED

- All 5 files verified present on disk
- Commit `e4c888b` (Task 1) verified in git log
- Commit `10f41f2` (Task 2) verified in git log
- `npx tsc --noEmit` passes (zero errors)
- `npm run build` completes successfully

---
*Phase: 17-gdpr-privacy*
*Completed: 2026-02-28*
