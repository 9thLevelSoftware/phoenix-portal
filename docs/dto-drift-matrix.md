# DTO Drift Matrix — Portal ⇄ Mobile

**Generated:** 2026-04-19  
**Status:** COMPREHENSIVE AUDIT  
**Coverage:** 18 push DTOs, 8 pull DTOs, invariants, conflict-resolution semantics

---

## Summary Statistics

- ✅ **38 MATCH** — No incompatibility
- ⚠️ **28 SOFT DRIFT** — Coercible type differences
- 🔀 **5 SEMANTIC DRIFT** — Meaning differs, needs doc
- ❌ **8 HARD DRIFT** — Critical incompatibilities
  - ✅ 6 RESOLVED (#3, #4, #5, #6, #7, #8, #10)
  - ⚠️ 1 PARTIAL — wire resolved, mobile persistence deferred (#2)
  - ⏳ 1 IN PROGRESS — LWW merge plan scheduled (#1)

**Remediation status:** Beta audit hardening + DTO drift Phase 1, 2, and 4.1
shipped across portal + mobile on 2026-04-19. See commits on
`cursor/beta-audit-2026-04-17` (portal) and `cursor/beta-audit-ios-android-ble-sync`
(mobile). Remaining work in plan file
`C:\Users\dasbl\.claude\plans\zany-discovering-umbrella.md` Phases 3, 3.5,
and 4.2.

---

## CRITICAL HARD DRIFT FINDINGS

### 1. Session/Set Conflict-Resolution Asymmetry (CRITICAL) — ⏳ IN PROGRESS

Portal uses `upsert onConflict=id` (server-authoritative). Mobile uses `INSERT OR IGNORE` on pull (local-authoritative).

**Impact:** ASYMMETRIC MERGE. User edits on web → portal overwrites mobile. Mobile pulls → ignores server. Multi-device changes silently lost.

**Resolution plan (Phase 3 of DTO drift remediation plan, deferred to
follow-up session):** Introduce monotonic LWW on `updated_at` for shared-edit
entities (sessions, exercises, sets, rep_summaries, routines, cycles,
cycle_days, rpg_attributes, gamification_stats, external_activities). Keep
INSERT OR IGNORE / append-only for rep_telemetry + personal_records +
earned_badges.

Phase breakdown:

- **3.1** Portal Supabase migration (`supabase/migrations/<ts>_lww_upsert_functions.sql`)
  with 10 `upsert_<entity>_lww(rows jsonb)` Postgres functions. Each function
  does `INSERT ... ON CONFLICT ... DO UPDATE SET ... WHERE EXCLUDED.updated_at >=
  target.updated_at`, returning `(id, accepted, server_updated_at)` per row.
- **3.2** Portal push handler wraps each LWW entity upsert behind
  `SYNC_LWW_ENABLED` feature flag. Response extended with `rejections` per
  entity so mobile can log stale pushes.
- **3.3** Mobile SQLDelight `mergeXxxLww` queries in `VitruvianDatabase.sq`
  using `ON CONFLICT(id) DO UPDATE SET ... WHERE excluded.updatedAt >=
  <table>.updatedAt`. Swap call sites in `SqlDelightSyncRepository.mergeAllPullData`.
- **3.4** Staging soak (1 week), prod enable, flag retirement after ≥70%
  mobile rollout.
- **3.5** Mobile `SessionNotes` side-table (resolves #2 persistence gap) with
  LWW semantics, bundled with 3.3.

Full plan at `C:\Users\dasbl\.claude\plans\zany-discovering-umbrella.md`.

---

### 2. Session Notes Missing on Pull — ⚠️ PARTIALLY RESOLVED 2026-04-19

Portal DB has `notes` column. Pull response omits it.

**Impact:** Notes added on web never reach mobile.

**Resolution (wire contract):** `mobile-sync-pull/index.ts` now returns
`notes` in the session DTO projection. `PullWorkoutSessionDto` in
`PortalSyncDtos.kt` has a nullable `notes: String?` field. Portal → mobile
round-trip works at the wire level.

**Remaining gap:** Mobile SQLDelight persistence. The mobile `WorkoutSession`
model is per-exercise (one portal session expands into N mobile rows keyed
by `routineSessionId`), so notes cannot go on the existing table without
duplicating. Follow-up tracked as **Phase 3.5** in the plan: add a
`SessionNotes` side-table keyed on `routineSessionId` (SQLDelight migration
26.sqm) with LWW upsert semantics, threaded through `PortalPullAdapter` into
`SqlDelightSyncRepository.mergeAllPullData`.

---

### 3. PR Metadata Sent but Not Stored — ✅ RESOLVED 2026-04-19

Mobile sends `prType`, `prPhase`, `prVolume`. Portal doesn't store in sets table.

**Resolution:** These fields are SEND-ONLY derivation hints consumed by the
`mobile-sync-push` handler to build `personal_records` rows. PR audit trail
lives in the `personal_records` table (canonical source of truth); set-level
columns would duplicate state and create double-source-of-truth bugs. DTO
(`PortalSetDto` in `PortalSyncDtos.kt`) and handler (`mobile-sync-push/index.ts`
sets upsert) now carry doc comments explaining the routing.

**Impact:** None — PRs already round-trip through PersonalRecord DTOs.

No migration required.

---

### 4. Cable Mapping Inconsistency — ✅ RESOLVED 2026-04-19

Mobile sends `cable: "A" | "B"`. Portal has mapping function but doesn't apply it. Stores raw "A"/"B".

**Resolution:** Canonicalize on raw `"A"|"B"` (BLE convention, mobile
authoritative for BLE-captured data per monorepo CLAUDE.md). Changes:

- Portal Zod (`src/schemas/telemetry.ts:16`) now accepts `z.enum(["A","B"])`.
- Portal TS interface (`src/lib/telemetry.ts:8`) now types `cable: "A" | "B"`.
- New `src/lib/telemetry-display.ts` centralizes UI conversion via
  `cableDisplayName()` and `cableSlug()` at the presentation boundary only.
- Mobile `PortalRepTelemetryDto.cable` doc comment updated to describe the
  canonical format.
- Mobile-sync-push rep_telemetry upsert comments clarify that raw values
  are stored unchanged; translation belongs at the UI boundary.

**Impact:** Unified DB + analytics representation. No migration needed.

---

### 5. ExternalActivitySyncDto ID Optional/Generated — ✅ RESOLVED 2026-04-19

Mobile sends `id?: String`. Portal generates UUID if missing. Mobile doesn't learn generated ID.

**Resolution (combined with #10):** Mobile already mints UUID via
`ExternalActivity.id = generateUUID()` default (domain model default).
Portal now **requires** the id field — rejects payloads missing
`external_activities[].id` with HTTP 400. And, in the same wire break, the
push response includes an `externalActivityKeys: ExternalActivityAckDto[]`
with `{localId, serverId, externalId, provider, updatedAt}` so mobile can
reconcile server-canonical metadata (particularly `updated_at` used to seed
LWW in Phase 3).

Backward compat: `PortalSyncPushResponse.externalActivityIds` is retained as
a `@Deprecated` alias (derived from the new ack list) for one release.

**Impact:** No more server-side UUID generation that mobile can't observe.

---

### 6. Cycles Array Cap Asymmetry — ✅ RESOLVED 2026-04-19

Sessions/telemetry/routines = 10k, cycles = 1000.

**Resolution:** `mobile-sync-push/index.ts` cycles cap aligned to
`MAX_ARRAY_SIZE` (10000), matching sessions/routines/telemetry.

---

### 7. Parity Sync >500 IDs Silent Fail — ✅ RESOLVED 2026-04-19

Portal skips filter if >500 IDs. Returns empty result.

**Resolution:** Server now returns HTTP 413 `parity_ids_exceeds_max` with a
structured body `{error, message, field, maxBatch, received}` when any of
`sessionIds`/`routineIds`/`cycleIds`/`badgeIds`/`personalRecordIds` exceeds
the cap. Mobile `SyncManager` now caps parity lists at
`SyncConfig.MAX_PARITY_IDS = 500` per request; lists over that are truncated
to the most-recent 500 entries and the server-side `lastSync` delta fills
the older tail (local dedupe handles any overlap).

**Impact:** No more silent data-loss for users with >500 of any entity.

---

### 8. Type Coercion: TS number vs Kotlin Int — ✅ RESOLVED 2026-04-19

Portal sends RpgAttributesDto as `number`. Kotlin expects `Int`. If portal sends 100.5, mobile truncates or errors.

**Resolution:** `Math.round(Number(x ?? 0))` applied at both boundaries of
`rpg_attributes` traffic — on the pull projection (`mobile-sync-pull`) and
defensively on the push write path (`mobile-sync-push`). Shared contract
documented in `supabase/functions/_shared/rpgSchema.ts`.

**Impact:** kotlinx.serialization on mobile can no longer see a float in
an Int slot.

---

## SEMANTIC DRIFT FINDINGS

### Weight: Per-Cable on Wire, ×2 Display

Both store per-cable kg. UI multiplies ×2. **Safe, but document baseline unit.**

### Cable Names: "A"/"B" vs "left"/"right"

Mobile: "A" = left actuator. Portal stores as-is, has mapping function unused. **Inconsistency at DB layer.**

### PR Metadata: Sent but Computed Server-Side

Mobile sends metadata. Portal doesn't store; computes on push. **Not round-trippable.**

---

## CONFLICT-RESOLUTION MATRIX

| Entity | Push | Pull | Outcome | Match |
|--------|------|------|---------|-------|
| Sessions | Upsert LWW | INSERT OR IGNORE | Asymmetric | ❌ |
| Exercises | Upsert LWW | INSERT OR IGNORE | Asymmetric | ❌ |
| Sets | Upsert LWW | INSERT OR IGNORE | Asymmetric | ❌ |
| RepSummaries | Upsert LWW | INSERT OR IGNORE | Asymmetric | ❌ |
| Routines | Upsert | INSERT OR IGNORE | Mobile-authoritative | ⚠️ |
| Cycles | Upsert | INSERT OR IGNORE | Mobile-authoritative | ⚠️ |
| RpgAttributes | Upsert user_id (server wins) | Server-wins | Portal-authoritative | ✅ |
| GamificationStats | Upsert user_id (server wins) | Server-wins | Portal-authoritative | ✅ |
| Badges | Upsert (user_id, badge_id) | INSERT OR IGNORE | Mixed | ⚠️ |
| PersonalRecords | Insert-only | INSERT OR IGNORE | Append-only, may duplicate | ❌ |
| ExternalActivities | Upsert (user_id, provider, externalId) | Merge TBD | Inconsistent | ⚠️ |

---

## INVARIANT DRIFT

| Invariant | Portal | Mobile | Match |
|-----------|--------|--------|-------|
| Workout modes (6) | OLD_SCHOOL, ECHO, PUMP, TUT, TUT_BEAST, ECCENTRIC_ONLY | Same via ProgramMode | ✅ |
| WorkoutPhase | COMBINED, CONCENTRIC, ECCENTRIC | Same | ✅ |
| Velocity zones (5) | EXPLOSIVE≥1.0, FAST≥0.75, MODERATE≥0.5, SLOW≥0.25, GRIND<0.25 | Same thresholds | ✅ |
| Asymmetry threshold | 2% implicit | 2% client-side | ✅ |
| Rate limit push | 10/min enforced | Mobile doesn't self-throttle | ⚠️ |
| Rate limit pull | 20/min enforced | Mobile doesn't self-throttle | ⚠️ |
| Payload cap | 10MB enforced | Mobile doesn't self-cap | ❌ |
| Array caps | Sessions 10k, cycles 1k | Mobile doesn't self-cap | ❌ |
| Subscription gate | EMBER+ server-only | Mobile doesn't gate | ✅ |
| Cursor semantics | Composite (updated_at, id) base64 JSON | Mobile expects same | ✅ |
| Entity pull order | sessions → routines → cycles → badges → stats | Same | ✅ |
| Parity limit | >500 IDs skip silently | Mobile sends unlimited | ❌ |

---

## TOP 10 PRIORITY FIXES

1. **Session/Set Conflict Asymmetry** — Multi-device edits lost (CRITICAL)
2. **Cable Mapping Inconsistency** — Analytics wrong
3. **Parity Sync >500 IDs** — Large users get no updates
4. **Session Notes on Pull** — Incomplete sync
5. **Cycles Cap Asymmetry** — >1000 cycles fail
6. **ExternalActivity ID Round-Trip** — Duplicates on re-sync
7. **PR Metadata Not Stored** — Audit trail lost
8. **Rate Limit Server-Only** — Bad UX
9. **Payload Size Not Self-Capped** — >10MB batches fail
10. **Type Coercion** — Edge cases with floating-point Int

---

**Report Path:** C:/Users/dasbl/AndroidStudioProjects/Phoenix App Monorepo/.planning/audit/06-dto-drift-matrix.md
