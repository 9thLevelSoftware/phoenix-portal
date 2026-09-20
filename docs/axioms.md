# First-principles axioms (FP-1…FP-8)

These are the eight properties Phoenix Portal is judged against. They are
statements about the **product**, not about any particular implementation: a
change is wrong if it breaks one of them, whatever the tests say.

Some of these are known to be only partially true of the code today. That is
the point of having them written down — do not read an axiom as a claim that
the current code satisfies it, and do not weaken an axiom to match the code.
Where a change cannot satisfy one, say so explicitly in the PR rather than
letting the gap go unrecorded.

| | Axiom | Where it is decided |
|---|---|---|
| **FP-1** | A user can never read or write another user's private data: RLS on every table, Edge Functions derive the user id from the verified JWT, and service-role paths scope every query by user. | RLS policies in `supabase/migrations/`, Edge auth code, SECURITY DEFINER function bodies and grants |
| **FP-2** | Paid capability is enforced server-side by the tier actually paid for, and billing state converges on Paddle's truth: webhook signature verified, idempotent, safe out of order, fail-closed during an outage. | `supabase/functions/paddle-*`, `_shared/requireSubscription.ts`, tier checks in RLS/RPC, `src/lib/pricing.ts` |
| **FP-3** | Data synced from mobile is never silently lost, duplicated or corrupted across a push/pull round trip — loads, modes, hierarchy, timestamps, deletes and multi-device conflict resolution included. | `supabase/functions/mobile-sync-push`, `mobile-sync-pull`, the LWW/merge RPCs, `src/schemas/transforms.ts`, `tests/sync/` |
| **FP-4** | Numbers the portal displays match the mobile app's definitions — per-cable load conventions, the hybrid 1RM formula, and PR record types. | `src/lib/units/`, `src/lib/biomechanics.ts`, `_shared/exerciseProgressRows.ts`, `src/lib/export/csv.ts`, `RecordsTab.tsx` |
| **FP-5** | Secrets never reach the browser bundle, the logs or an error response; third-party OAuth tokens are stored and refreshed safely and removed on disconnect or account deletion. | Edge Functions, `_shared/oauthTokenCrypto.ts`, `vite.config.ts`, `scripts/assert-no-sourcemaps.mjs`, `src/lib/integrations/` |
| **FP-6** | Account deletion and GDPR export are complete and atomic. | `supabase/functions/delete-account`, `export-user-data`, `_shared/userDataManifest.ts`, `src/lib/export/` |
| **FP-7** | Schema changes live only in idempotent migrations that apply cleanly from zero, and the generated types match that schema. | `supabase/migrations/`, `migrations.yml`, `prod-migration-drift.yml`, `src/lib/database.types.ts` |
| **FP-8** | Realtime and cache invalidation show fresh data after a sync without the user doing anything, and failures are visible rather than silent. | `src/hooks/useRealtimeSync.ts`, `src/queries/keys.ts`, the `sync_complete` broadcast in `mobile-sync-push` |

## How to use them

- Changing auth, billing, sync, deletion/export or migrations? Name the axiom
  your change touches in the PR description and say how it still holds.
- A test that passes while an axiom is violated is a bad test. Prefer a test
  that would fail if the axiom broke.
- `docs/review/go-no-go-checklist.md` is a historical 2026-03-18 snapshot, not
  a current pass. Re-derive readiness from these axioms and from CI.
