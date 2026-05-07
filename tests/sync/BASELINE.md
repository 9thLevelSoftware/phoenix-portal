# Sync Baseline - 2026-04-12

This document establishes the baseline sync behavior based on round-trip test results.
Tests run with `MOCK_EDGE_FUNCTIONS=true` against the mock Edge Function implementations.

## Test Summary

| Test Suite           | Tests   | Pass    | Fail  | Coverage                                            |
| -------------------- | ------- | ------- | ----- | --------------------------------------------------- |
| Round-Trip: Workout  | 19      | 19      | 0     | Sessions, exercises, sets, rep summaries            |
| Round-Trip: Entity   | 25      | 25      | 0     | Routines, cycles, gamification, external activities |
| Transforms: Weight   | 16      | 16      | 0     | Per-cable storage, x2 multiplier, edge cases        |
| Transforms: Mode     | 25      | 25      | 0     | All 6 modes + CLASSIC alias                         |
| Transforms: Velocity | 28      | 28      | 0     | Zone boundaries, asymmetry threshold                |
| Fixtures             | 25      | 25      | 0     | Fixture factory validation                          |
| **Total**            | **138** | **138** | **0** |                                                     |

## Working

These entities and transforms pass round-trip validation with mocks:

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
- [x] Weight stored as per-cable (WEIGHT_MULTIPLIER = 2)
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

No sync functionality is broken based on mock tests.

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
*Test infrastructure: Plan 01-01, 01-02*
*Round-trip tests: Plan 01-03*
