# 1RM Feature — Parity & Full Functionality (Portal, phoenix-portal)

- **Date:** 2026-05-30
- **Repo:** phoenix-portal (React/TS + Supabase edge functions)
- **Counterpart spec:** `Project-Phoenix-MP/docs/superpowers/specs/2026-05-30-1rm-parity-mobile-design.md` (must land together — shared sync contract)
- **Definition of done:** the 1RM number agrees everywhere (portal stops computing its own)
- **Sequencing:** Phase 1 correctness/parity (this spec is almost entirely Phase 1; mobile owns Phase 2)

---

## Problem statement

"1RM" currently resolves to **three incompatible numbers**. The portal recomputes its own estimate two different ways and conflates a raw max-weight PR with "1RM". The fix: **the portal stops computing 1RM** and displays the mobile-provided canonical estimate.

### Verified findings (portal-relevant, confirmed by direct inspection)
- Portal trend charts use server-side **Brzycki** `w·(36/(37−reps))` for reps 1–12 in `mobile-sync-push/index.ts:1338-1356`, stored in `exercise_progress.estimated_1rm_kg`.
- Portal client fallback uses **Epley** rounded in `biomechanics.ts:22-26`.
- `personal_records` holds **correctly-labeled max-weight/max-volume PRs** (`value = weightKg`, `record_type = prType`) — `personalRecordRow.ts:95-98`. The `?? "1RM"` default essentially never fires; mobile sends uppercase `MAX_WEIGHT`/`MAX_VOLUME`.
- **CSV bug is broad:** `formatRecordType` (`csv.ts:62-72`) maps **lowercase** keys (`max_weight`, `max_volume`, `max_e1rm`…) but mobile sends **uppercase** `record_type`. The map never matches; exports show raw uppercase strings. No `"1RM"` key exists.

### What works (must not regress)
`exercise_progress` read/display in `ExerciseDeepDive`/`ExerciseProgress`; `personal_records` timeline in `RecordsTab`; the 2× per-cable→display weight multiplier across queries/schemas; existing 1RM tests (`records.test.ts`, `ExerciseDeepDive.test.tsx`).

---

## Architecture: portal displays the mobile estimate, never recomputes

### Canonical formula (defined on mobile; reproduced here only for the legacy fallback)
```
estimate1RM(weight, reps):
  if weight <= 0 || reps <= 0  -> 0
  if reps == 1                 -> weight
  if reps <= 10                -> weight * (36 / (37 - reps))   // Brzycki
  else                         -> weight * (1 + reps / 30)      // Epley
```
Continuous at reps = 10. Mobile is the source of truth; the portal uses this **only** as a server-side fallback when a payload lacks the synced field. Document as a parity-critical constant in CLAUDE.md.

### Two distinct metrics (do not conflate)
- **Max Weight PR** (`personal_records`) — label "Max Weight", not "1RM".
- **Estimated 1RM** (`exercise_progress.estimated_1rm_kg`) — populated from the mobile-provided value.

### Shared sync contract (must match the mobile spec exactly)
- New optional field `estimatedOneRepMaxKg` (per-cable kg) on the exercise/set push DTO.
- Add it to the zod schema in `supabase/functions/_shared/pushPayloadSchema.ts`.
- Per-cable value; the existing 2× display multiplier still applies on read.

---

## Phase 1 — Correctness / Parity (portal tasks)
1. `mobile-sync-push/index.ts:1338-1356`: **stop computing Brzycki**; store the mobile-provided `estimatedOneRepMaxKg` into `exercise_progress.estimated_1rm_kg`. Server-side **same-hybrid** fallback only when the field is absent (legacy payloads).
2. `pushPayloadSchema.ts`: add the optional `estimatedOneRepMaxKg` field.
3. `biomechanics.ts`: align the client `estimateOneRepMax` to the hybrid (or remove the recompute path) and document parity. No surface should show a number computed by a different formula than the synced one.
4. `csv.ts:62-72`: fix `formatRecordType` to match the actual uppercase `record_type` values; add an estimated-1RM label sourced correctly.
5. Display consistency: surfaces showing "1RM" read `exercise_progress.estimated_1rm_kg`; `personal_records` rows labeled "Max Weight".

### Tests
- Edge-function test: mobile-provided `estimatedOneRepMaxKg` stored verbatim; legacy payload uses the hybrid fallback.
- CSV mapping test: uppercase `record_type` values render correct labels.
- Records/progress query tests still pass.
- Verify: `npm test`, `npm run typecheck`, sync/edge tests, `npx biome check`. No DB column change needed (`estimated_1rm_kg` exists), so no type regen required.

---

## Risks / open items
- Wire-contract change must land together with the mobile spec (CLAUDE.md parity rule). Backward compatible via the absent-field server fallback.
- Portal repo currently has unrelated WIP on `main`; commit only the spec/feature files for this effort.

## Out of scope (not selected)
- "Tested vs. estimated" 1RM as a user-facing distinction feature (data still separates them).
- Phase 2 input-path persistence (mobile-owned).
- User-selectable formula choice.
