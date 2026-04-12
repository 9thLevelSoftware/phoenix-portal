# Weight Field Audit Matrix

**Audit Date**: 2026-04-12  
**Plan**: 04-01 Weight Transform Validation  
**Status**: COMPLETE  

## Overview

The Vitruvian Trainer has dual cables. All weight values are stored in the database as **per-cable values** (0-220kg range). The portal applies a **x2 multiplier** for display to show total weight lifted.

- **WEIGHT_MULTIPLIER**: 2 (defined in `src/schemas/transforms.ts` line 6)
- **MAX_PER_CABLE_KG**: 110 (220kg machine max / 2 cables = 110kg per cable in actual usage)
- **Database storage**: Per-cable values (0-220kg range per the spec, though 110kg is practical max)

## Weight-Bearing Fields Matrix

### Primary Sync Entities (Plan Target)

| Entity | Field (DB/snake_case) | Field (DTO/camelCase) | Transform Applied | Location |
|--------|----------------------|----------------------|------------------|----------|
| workout_sessions | `total_volume` | `totalVolume` | x2 (weightTransform) | transforms.ts:38 |
| workout_sessions | `heaviest_lift_kg` | `heaviestLiftKg` | x2 (custom inline) | transforms.ts:57-61 |
| sets | `weight_kg` | `weightKg` | x2 (weightTransform) | transforms.ts:93 |
| personal_records | `value` | `value` | x2 (weightTransform) | transforms.ts:116 |
| personal_records | `previous_value` | `previousValue` | x2 (custom inline) | transforms.ts:119-122 |
| analytics_summary | `total_volume` | `totalVolume` | x2 (weightTransform) | transforms.ts:193 |
| routine_exercises | `weight` | `weight` | **NO TRANSFORM** | transforms.ts:211 |
| routine_exercises | `per_set_weights` | `perSetWeights` | **NO TRANSFORM** | transforms.ts:219 |

### Telemetry Entities (telemetry.ts)

| Entity | Field (DB) | Transform Applied | Location |
|--------|-----------|------------------|----------|
| exercise_progress | `max_weight_kg` | x2 (weightTransform) | telemetry.ts:50 |
| exercise_progress | `total_volume_kg` | x2 (weightTransform) | telemetry.ts:51 |
| exercise_progress | `estimated_1rm_kg` | x2 (weightTransform) | telemetry.ts:52 |

### Phase Statistics (session_phase_statistics)

| Field | Description | Transform Status |
|-------|-------------|-----------------|
| `concentric_kg_avg` | Average concentric load | **NOT in portal display schema** |
| `concentric_kg_max` | Max concentric load | **NOT in portal display schema** |
| `eccentric_kg_avg` | Average eccentric load | **NOT in portal display schema** |
| `eccentric_kg_max` | Max eccentric load | **NOT in portal display schema** |

### VBT Assessments (vbt_assessments)

| Field | Description | Transform Status |
|-------|-------------|-----------------|
| `estimated_1rm_kg` | VBT-derived 1RM | **NOT in portal display schema** |
| `user_override_kg` | Manual 1RM override | **NOT in portal display schema** |

### Gamification Stats

| Entity | Field | Transform Status |
|--------|-------|-----------------|
| gamification_stats | `total_volume_kg` | **NO TRANSFORM** (gamificationStatsSchema:283) |

### Training Cycles

| Entity | Field | Transform Status |
|--------|-------|-----------------|
| cycle_days | `weight_adjustment` | **NO TRANSFORM** (cycleDaySchema:304) |

## Fields WITHOUT Transform (Design Decision)

These fields intentionally do NOT apply the x2 multiplier:

1. **routine_exercises.weight**: Routines store target per-cable values; the mobile app uses these directly during workout execution
2. **routine_exercises.per_set_weights**: JSON array of per-cable values for pyramid schemes
3. **gamification_stats.total_volume_kg**: Aggregate stat displayed as-is (may need review)
4. **cycle_days.weight_adjustment**: Percentage modifier, not absolute weight

## Kotlin DTO Fields (Mobile)

### Push DTOs (mobile -> portal)

| DTO Class | Field | Comment | Line |
|-----------|-------|---------|------|
| PortalWorkoutSessionDto | `totalVolume` | per-cable kg | PortalSyncDtos.kt:33 |
| PortalWorkoutSessionDto | `heaviestLiftKg` | per-cable kg | PortalSyncDtos.kt:56 |
| PortalSetDto | `weightKg` | per-cable | PortalSyncDtos.kt:94 |
| PortalSetDto | `prVolume` | weight x reps volume | PortalSyncDtos.kt:99 |
| PortalRoutineExerciseSyncDto | `weight` | per-cable kg | PortalSyncDtos.kt:173 |
| PortalRoutineExerciseSyncDto | `perSetWeights` | JSON array | PortalSyncDtos.kt:182 |
| PortalCycleDaySyncDto | `weightAdjustment` | modifier | PortalSyncDtos.kt:232 |
| PortalGamificationStatsSyncDto | `totalVolumeKg` | aggregate | PortalSyncDtos.kt:269 |
| PortalPhaseStatisticsDto | `concentricKgAvg/Max` | per-cable | PortalSyncDtos.kt:285-286 |
| PortalPhaseStatisticsDto | `eccentricKgAvg/Max` | per-cable | PortalSyncDtos.kt:291-292 |
| PortalAssessmentResultDto | `estimatedOneRepMaxKg` | per-cable | PortalSyncDtos.kt:329 |
| PortalAssessmentResultDto | `userOverrideKg` | per-cable | PortalSyncDtos.kt:332 |

### Pull DTOs (portal -> mobile)

| DTO Class | Field | Line |
|-----------|-------|------|
| PullSetDto | `weightKg` | PortalSyncDtos.kt:519 |
| PullRoutineExerciseDto | `weight` | PortalSyncDtos.kt:569 |
| PullRoutineExerciseDto | `perSetWeights` | PortalSyncDtos.kt:576 |
| PullCycleDayDto | `weightAdjustment` | PortalSyncDtos.kt:617 |
| PullGamificationStatsDto | `totalVolumeKg` | PortalSyncDtos.kt:652 |
| PullPersonalRecordDto | `weightKg` | PortalSyncDtos.kt:670 |

## Edge Function Handling (mobile-sync-push)

| Operation | Field | Line |
|-----------|-------|------|
| Session insert | `heaviest_lift_kg` | mobile-sync-push/index.ts:543 |
| Set insert | `weight_kg` | mobile-sync-push/index.ts:586 |
| Telemetry compute | `maxWeight = Math.max(sets.weightKg)` | mobile-sync-push/index.ts:669 |
| Volume compute | `weight * reps` | mobile-sync-push/index.ts:671 |
| 1RM compute (Brzycki) | `weight * (36 / (37 - reps))` | mobile-sync-push/index.ts:677-681 |
| Exercise progress | `max_weight_kg`, `total_volume_kg`, `estimated_1rm_kg` | mobile-sync-push/index.ts:692-694 |
| PR value extract | `recordType === 'MAX_VOLUME' ? prVolume : weightKg` | mobile-sync-push/index.ts:742-743 |
| Routine exercise | `weight`, `per_set_weights` | mobile-sync-push/index.ts:827, 834 |
| Cycle day | `weight_adjustment` | mobile-sync-push/index.ts:920 |
| Gamification stats | `total_volume_kg` | mobile-sync-push/index.ts:1006 |
| Phase stats | `concentric_kg_avg/max`, `eccentric_kg_avg/max` | mobile-sync-push/index.ts:1024-1031 |
| VBT assessment | `estimated_1rm_kg`, `user_override_kg` | mobile-sync-push/index.ts:1076, 1079 |

## Issues Found

### Issue 1: gamification_stats.total_volume_kg - Potential Missing Transform

**Severity**: Medium  
**Description**: The `gamificationStatsSchema` does not apply the weight transform to `total_volume_kg` (line 283). This is inconsistent with how `total_volume` is handled in workout sessions.

**Evidence**:
- `transforms.ts:283` - `total_volume_kg: z.number()` (no transform)
- `transforms.ts:38` - `total_volume: weightTransform` (has transform)

**Root Cause Analysis**:
This may be intentional since gamification stats are aggregate values that might have been pre-doubled, or it could be an oversight. Need to verify with the mobile app's computation logic.

**Recommendation**: Investigate whether mobile computes `totalVolumeKg` using per-cable values. If so, the portal should apply the transform.

### Issue 2: Phase Statistics Fields Not in Portal Display Schema

**Severity**: Low  
**Description**: Phase statistics (`concentric_kg_avg`, `concentric_kg_max`, `eccentric_kg_avg`, `eccentric_kg_max`) are synced but no display schema exists in `transforms.ts`.

**Status**: Acceptable - these fields are stored for future analytics features.

### Issue 3: VBT Assessment Fields Not in Portal Display Schema

**Severity**: Low  
**Description**: VBT assessment `estimated_1rm_kg` and `user_override_kg` are synced but not displayed in portal.

**Status**: Acceptable - VBT features are in development.

## Test Coverage Summary

### Existing Tests (src/schemas/__tests__/transforms.test.ts)

| Entity | Field | Test Status |
|--------|-------|-------------|
| workout_sessions | `total_volume` | COVERED (line 34-37) |
| sets | `weight_kg` | COVERED (line 119-122) |
| personal_records | `value` | COVERED (line 155-158) |
| personal_records | `previous_value` | COVERED (line 161-172) |
| workout_sessions | `heaviest_lift_kg` | **NOT COVERED** |

### Existing Tests (tests/sync/transforms/weight-transform.test.ts)

| Test Category | Count | Status |
|--------------|-------|--------|
| Per-Cable Storage | 2 | Requires network |
| Display Multiplier | 3 | Pure logic tests |
| Edge Cases (0, 1, 110) | 3 | Requires network |
| Sessions | 2 | Requires network |
| Sets | 1 | Requires network |
| Routines | 2 | Requires network |
| Consistency | 2 | Pure logic tests |

### Gaps Identified

1. **heaviest_lift_kg** transform test in unit tests
2. **Null handling** for optional weight fields
3. **Decimal precision** edge cases (55.5kg -> 111.0kg)
4. **Negative weight** validation
5. **Weight > 220** boundary enforcement

## Verification Commands

```bash
# Run unit tests (no network)
cd phoenix-portal && npm test -- src/schemas/__tests__/transforms.test.ts

# Count weight field coverage
grep -c "weightKg\|heaviestLiftKg\|perSetWeights\|weight_kg\|total_volume" tests/sync/transforms/weight-transform.test.ts

# Check for skipped tests
grep -E "(TODO|skip|xit|xdescribe)" tests/sync/transforms/weight-transform.test.ts
```

## Conclusion

The weight transform is correctly implemented for the core sync entities:
- Sessions (total_volume, heaviest_lift_kg)
- Sets (weight_kg)
- Personal Records (value, previous_value)
- Analytics (total_volume)
- Telemetry (max_weight_kg, total_volume_kg, estimated_1rm_kg)

Fields intentionally NOT transformed:
- routine_exercises.weight/per_set_weights (routines store raw per-cable for mobile execution)
- cycle_days.weight_adjustment (percentage modifier)

**Potential issue**: `gamification_stats.total_volume_kg` may need transform review.
