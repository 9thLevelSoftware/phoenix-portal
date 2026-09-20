# Sync Baseline — mock-only structural checks

> **BANNER — read before quoting anything below.**
>
> Everything in this file comes from `npm run test:sync`, which runs with
> `MOCK_EDGE_FUNCTIONS=true` against the in-memory mock in
> `helpers/mock-edge-functions.ts`. That mock has one global store keyed by
> entity id, with no user scoping, no profile scoping, no LWW, no per-row
> delta, no cursor/pageSize handling, no tombstones, no tier gate, no rate
> limit, no size caps and no RLS.
>
> So a checked box below means **"a payload of this shape survives the test
> harness's push → pull with its fields and nesting intact"**. It does **not**
> mean the behaviour works against the deployed Edge Functions or the real
> database, and "Broken: none" below means only "no mock round-trip fails".
>
> The invariants that actually matter are listed under
> [Not proven here](#not-proven-here). Server behaviour is proven by the Deno
> handler suites (`npm run test:edge`) and the `integration: `-prefixed
> real-SQL cases (`npm run test:edge:integration`), not by this file.
>
> Per-suite pass counts were removed on 2026-09-20: they were stale (the mode
> suite was recorded as 25 cases when it had 32) and they rot on every change.
> Run `npm run test:sync` for the current numbers.

## Not proven here

None of the following has a passing mock test, and none of them would turn
this suite red if the server lost it. Each line names where it is (or is not)
actually covered.

| Invariant | Real coverage on this branch |
| --------- | ---------------------------- |
| LWW direction for sessions (a stale push must be rejected) | `mobile-sync-push/index.test.ts` — "PR 24: with LWW on, a rejected session is in neither p_session_ids nor p_progress, so its stored progress is kept" |
| LWW direction for **routines and cycles** | **No executed test.** The comparison lives in `upsert_routine_lww` / `upsert_training_cycle_lww`; `tests/sync/training-cycle-template-id.test.ts` only regex-matches the SQL text. PR 21 (`lww_clock.test.sql`) is the real-SQL test and is not on this branch |
| Delta filtering and the commit-time overlap | `mobile-sync-pull/index.test.ts` — "parity RPCs get lastSync minus the commit-time overlap when lastSync > 0", "every lastSync-based table filter uses lastSync minus the overlap", "lastSync 0 keeps the epoch stale bound (no negative overlap)" |
| Profile scoping on pull (`p_profile_id`) | `mobile-sync-pull/index.test.ts` — the two tests above assert `p_profile_id` on every parity RPC; "real lastSync with empty known ids uses every id RPC and no timestamp-only table read" covers the no-known-ids arm. Cross-profile isolation against real SQL: the Docker-gated "integration: real mutation canonicals equal isolated first-page pull and absence never creates" |
| Composite `(updated_at, id)` cursor stability | `mobile-sync-pull/index.test.ts` — "identical-timestamp sessions are each returned exactly once when paged one at a time" and "identical-microsecond personal records produce a distinct nextCursor" |
| Personal-record precedence and tombstones | `mobile-sync-push/index.test.ts` — "a newer active personal record cannot resurrect a stored tombstone", "deletedAt is the LWW timestamp when a tombstone omits updatedAt" |
| Routine/cycle **delete** propagation | **No executed test.** PR 16 (`sync_tombstones`) is not on this branch |
| Tier gate, rate limit, payload size caps, RLS | Deno handler suites only; the mock accepts any non-empty bearer token |
| Badge union merge against the real server | **No executed test.** The mock's union keying is smoke-tested in `multi-device.test.ts` ("should accumulate unique badges from both devices"), which proves the harness, not the server |

## Working (mock round-trip only)

These entities and transforms survive the mock harness's push → pull with
their fields and nesting intact. Re-read the banner before treating any of
them as evidence about production:

### Workout Entities
- [x] Session core fields (id, name, timestamps, counts)
- [x] Session enrichment fields (velocity, asymmetry, form score, etc.)
- [x] Session nullable fields preserved as null
- [x] Exercise hierarchy (session -> exercises)
- [x] Set hierarchy (exercises -> sets)
- [x] Rep summary hierarchy (sets -> rep summaries)
- [x] 4-level nested hierarchy intact
- [x] Multiple sessions in batch

### Routine Entities
- [x] Routine core fields
- [x] Routine exercises
- [x] Superset configuration (id, color, order)
- [x] Per-set weights (JSON string)
- [x] Per-set rest (JSON string)
- [x] AMRAP flag
- [x] PR percentage scaling

### Training Cycle Entities
- [x] Cycle core fields
- [x] Cycle days with workout/rest types
- [x] Deload day configuration
- [x] All cycle statuses (draft, active, completed)

### Gamification Entities
- [x] RPG attributes structure
- [x] Badge structure with tiers
- [x] Gamification stats structure
- [x] Personal record structure (all 3 phases validated)

### External Activities
- [x] Strava activity structure
- [x] Fitbit activity structure
- [x] Garmin activity structure
- [x] Multi-provider batch

### Transforms
- [x] Weight stored and displayed per cable (total only with a known cable count)
- [x] Weight edge cases: 0, 1, 110 (max per-cable)
- [x] Workout modes: OLD_SCHOOL, ECHO, PUMP, TUT, TUT_BEAST, ECCENTRIC_ONLY
- [x] CLASSIC legacy alias maps to Old School
- [x] Velocity zones: EXPLOSIVE >= 1.0, FAST >= 0.75, MODERATE >= 0.5, SLOW >= 0.25, GRIND < 0.25
- [x] Asymmetry threshold: 2% = BALANCED

## Known Limitations (Mock-Specific)

These behaviors differ between mock and production:

### Delta Sync (L1)
- **Mock behavior**: Returns all sessions when `lastPushTime > lastSync`
- **Production behavior**: Should return only sessions where `updated_at > lastSync`
- **Impact**: Mock returns extra data on delta pulls
- **Status**: Known limitation of mock, not a sync bug

### Personal Records (L2)
- **Mock behavior**: PR push data not stored (PRs computed by mobile)
- **Production behavior**: PRs stored and returned on pull
- **Impact**: PR round-trip not testable with mocks
- **Status**: Expected - mobile is authoritative for PR computation

### RPG/Badge/Stats Sync (L3)
- **Mock behavior**: RPG, badges, and stats push data partially stored
- **Production behavior**: Full storage and retrieval
- **Impact**: Gamification round-trip tests validate structure, not full sync
- **Status**: Expected - mobile is authoritative for gamification computation

## Broken

No **mock round-trip** fails. This says nothing about whether sync works: the
mock cannot fail on any of the invariants in
[Not proven here](#not-proven-here), because it does not implement them.

**Note**: This baseline only covers mock behavior. Live Supabase testing is required to identify:
- Database constraint violations
- RLS policy issues
- Edge Function runtime errors
- Network timeout edge cases

## Partial

These features sync but may have edge cases:

### Telemetry Data (P1)
- **Status**: Structure validated but high-volume telemetry not tested
- **Risk**: Large telemetry payloads may hit timeout or size limits
- **Recommendation**: Test with live Supabase and realistic telemetry volumes

### Unicode Handling (P2)
- **Status**: Unicode fixtures exist but not round-trip tested
- **Risk**: Special characters in names/notes may have encoding issues
- **Recommendation**: Include Unicode test cases in live testing

## Reference

### Audit Issues (from PROJECT.md)
| Issue | Description                | Complexity | Tested          |
| ----- | -------------------------- | ---------- | --------------- |
| R1    | Session hierarchy sync     | Medium     | Yes             |
| R2    | Routine superset sync      | Medium     | Yes             |
| R3    | Cycle day sync             | Medium     | Yes             |
| R4    | Weight transform parity    | Low        | Yes             |
| R5    | Mode mapping parity        | Low        | Yes             |
| R6    | Velocity zone parity       | Low        | Yes             |
| R7    | Asymmetry threshold parity | Low        | Yes             |
| R8    | PR phase handling          | Medium     | Structure only  |
| R9    | Delta sync timestamps      | High       | Mock limitation |
| R10   | Gamification sync          | High       | Structure only  |

### Fix Complexity Estimates
| Entity Type      | Mock Tests   | Live Test Estimate | Fix Complexity |
| ---------------- | ------------ | ------------------ | -------------- |
| Sessions         | Complete     | 2h                 | N/A - working  |
| Routines         | Complete     | 1h                 | N/A - working  |
| Cycles           | Complete     | 1h                 | N/A - working  |
| Personal Records | Structure    | 3h                 | Medium         |
| Gamification     | Structure    | 3h                 | Medium         |
| Telemetry        | Minimal      | 4h                 | High (volume)  |
| Delta Sync       | Mock-limited | 2h                 | Medium         |

## Next Steps

1. **Phase 2**: Run tests against live Supabase to identify production-specific issues
2. **Phase 3**: Fix any issues found in live testing
3. **Phase 4**: Performance testing with realistic data volumes
4. **Ongoing**: Add regression tests for any bugs discovered

---

*Baseline established: 2026-04-12*
*Relabelled 2026-09-20 as mock-only structural checks; per-suite counts dropped
and the "Not proven here" gap list added.*
*Test infrastructure: Plan 01-01, 01-02*
*Round-trip tests: Plan 01-03*
