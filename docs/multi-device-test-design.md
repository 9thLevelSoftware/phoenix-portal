# Multi-Device Sync Test Design

## Overview

This document specifies the test scenarios for validating sync behavior across multiple devices. The goal is to ensure data integrity when Device A and Device B both push and pull data, especially in conflict scenarios.

## Critical Finding: Conflict Resolution Discrepancy

**WARNING**: The plan document claims certain conflict resolution strategies that do NOT match the actual implementation:

| Entity | Plan Claims | Actual Implementation | Gap |
|--------|-------------|----------------------|-----|
| Sessions | LOCAL WINS (INSERT OR IGNORE) | `upsert({ onConflict: 'id' })` - SERVER WINS | CRITICAL |
| Personal Records | LOCAL WINS (INSERT OR IGNORE) | `insert()` after dedup check - LOCAL WINS | OK |
| Routines | Timestamp-based LWW | `upsert({ onConflict: 'id' })` - SERVER WINS | Minor |
| Cycles | Server wins | `upsert({ onConflict: 'id' })` - SERVER WINS | OK |
| Badges | Union merge (INSERT OR IGNORE) | `upsert({ onConflict: 'user_id,badge_id' })` - Last push wins | Minor |

The tests in this suite will verify the ACTUAL behavior, not the claimed behavior.

## Actual Conflict Resolution Strategy (from code analysis)

Based on analysis of `supabase/functions/mobile-sync-push/index.ts`:

### Sessions (`workout_sessions`)
- **Strategy**: UPSERT (Last Push Wins)
- **Code**: `upsert(sessionRows, { onConflict: 'id' })`
- **Behavior**: If Device A and B both push a session with the same ID, the second push overwrites the first.

### Personal Records (`personal_records`)
- **Strategy**: INSERT OR IGNORE (Local Wins)
- **Code**: Lookup existing, filter duplicates, then `insert(dedupedPrRows)`
- **Behavior**: Only inserts PRs that don't already exist for the same (exercise_name, achieved_at, value, record_type, workout_phase).

### Routines (`routines`)
- **Strategy**: UPSERT (Last Push Wins)
- **Code**: `upsert(routineRows, { onConflict: 'id' })`
- **Behavior**: Second push of same routine ID overwrites the first.

### Training Cycles (`training_cycles`)
- **Strategy**: UPSERT (Last Push Wins)
- **Code**: `upsert(cycleRows, { onConflict: 'id' })`
- **Behavior**: Second push of same cycle ID overwrites the first.

### Badges (`earned_badges`)
- **Strategy**: UPSERT on (user_id, badge_id)
- **Code**: `upsert(badgeRows, { onConflict: 'user_id,badge_id' })`
- **Behavior**: Union-like (different badge_ids accumulate, same badge_id gets overwritten).

### RPG Attributes (`rpg_attributes`)
- **Strategy**: UPSERT on user_id
- **Code**: `upsert(..., { onConflict: 'user_id' })`
- **Behavior**: Single row per user, last push wins.

### Gamification Stats (`gamification_stats`)
- **Strategy**: UPSERT on user_id
- **Code**: `upsert(..., { onConflict: 'user_id' })`
- **Behavior**: Single row per user, last push wins.

## Test Scenarios

### Scenario 1: Clean Sync (Baseline)

**Description**: Device A pushes data, Device B (fresh sync) pulls all data.

**Setup**:
1. Device A creates a session, routine, and cycle
2. Device A pushes to server

**Test Steps**:
1. Device A pushes payload with:
   - 1 session with 2 exercises, 3 sets each
   - 1 routine with 3 exercises
   - 1 training cycle with 4 days
2. Device B pulls with lastSync=0

**Expected Results**:
- Device B receives all sessions, exercises, sets
- Device B receives all routines with exercises
- Device B receives all cycles with days
- No data loss or corruption

**Verification**:
- Session count matches
- Exercise/set/rep hierarchy intact
- Routine exercise order preserved
- Cycle day assignments correct

### Scenario 2: Overlapping Sessions (Same ID Conflict)

**Description**: Both devices create sessions with the same ID (unlikely in practice due to UUIDs, but tests edge case).

**Setup**:
1. Device A pushes session with ID `session-123`, name "Morning Workout"
2. Device B pushes session with ID `session-123`, name "Evening Workout"

**Expected Results (per actual implementation)**:
- Device B's version wins (last push)
- Final session has name "Evening Workout"

**NOT expected (despite plan claim)**:
- Device A's version preserved (this would be LOCAL WINS behavior)

### Scenario 3: Routine Conflict (Same ID, Different Content)

**Description**: Device A and B both modify the same routine while offline.

**Setup**:
1. Both devices start with routine ID `routine-abc`, name "Push Day", 3 exercises
2. Device A modifies: changes name to "Push Day v2", adds 4th exercise
3. Device B modifies: changes name to "Push Day Modified", removes 1st exercise
4. Device A syncs first
5. Device B syncs second

**Expected Results (per actual implementation)**:
- Device B's version wins (last push)
- Final routine has name "Push Day Modified"
- Final routine has 2 exercises (Device B's state)

**Verification**:
- Pull returns routine with Device B's name
- Exercise list matches Device B's modifications

### Scenario 4: Cycle Conflict (Both Active)

**Description**: Both devices create and activate different training cycles.

**Setup**:
1. Device A creates cycle "PPL Cycle" with status='active'
2. Device B creates cycle "Upper/Lower" with status='active'
3. Both push

**Expected Results**:
- Both cycles exist in database
- Both may show status='active' (no server-side enforcement of single active cycle)
- Client-side logic would need to handle this

**Verification**:
- Pull returns both cycles
- Application logic determines which is "current"

### Scenario 5: Badge Accumulation (Union Merge)

**Description**: Device A earns badges X and Y, Device B earns badges Y and Z, sync should result in all three unique badges.

**Setup**:
1. Device A pushes badges: FIRST_WORKOUT, WEEK_WARRIOR
2. Device B pushes badges: FIRST_WORKOUT, PR_KING

**Expected Results**:
- All unique badge_ids present: FIRST_WORKOUT, WEEK_WARRIOR, PR_KING
- FIRST_WORKOUT not duplicated (upsert on user_id,badge_id)

**Verification**:
- Pull returns exactly 3 badges
- No duplicate badge_ids for user

### Scenario 6: Profile Isolation

**Description**: Device A pushes to profile 1, Device B pulls profile 2 - no cross-contamination.

**Setup**:
1. Device A pushes session with local_profile_id='profile-1'
2. Device B pulls with profileId='profile-2'

**Expected Results**:
- Device B does NOT receive Device A's session
- Profile data is isolated

**Verification**:
- Pull with profileId filter returns only matching profile's data
- No sessions from other profiles leak through

### Scenario 7: Personal Record Preservation (LOCAL WINS)

**Description**: Verify that existing PRs are not overwritten by subsequent pushes.

**Setup**:
1. Device A pushes session with PR set (Bench Press, 100kg, MAX_WEIGHT)
2. Device B pushes session with different PR set (Bench Press, 95kg, MAX_WEIGHT)

**Expected Results**:
- Both PRs exist in database (different achieved_at timestamps)
- Original PR preserved

**Verification**:
- personal_records table has both entries
- Neither overwrites the other

### Scenario 8: Delta Sync Accuracy

**Description**: Verify that pulling with a non-zero lastSync only returns modified data.

**Setup**:
1. Device A pushes session S1 at time T1
2. Wait, record time T2
3. Device A pushes session S2 at time T3
4. Device B pulls with lastSync=T2

**Expected Results**:
- Device B receives S2 but NOT S1

**Verification**:
- Response contains only session S2
- S1 not included in response

## Test Infrastructure Requirements

### Device Simulation
Tests simulate multi-device behavior by:
1. Using different deviceId values in payloads
2. Manipulating lastSync timestamps
3. Making sequential push/pull calls

### Test Data Isolation
Each test creates its own:
- Test user (via `createTestUser()`)
- Unique entity IDs (via `generateTestId()`)
- Clean mock store state (via `resetMockStore()`)

### Mock vs Real Edge Functions
Tests can run in two modes:
- **Mock mode** (`MOCK_EDGE_FUNCTIONS=true`): Fast, deterministic, no Supabase required
- **Real mode**: Tests against actual Supabase instance, validates end-to-end

## Implementation Notes

### File Location
`phoenix-portal/tests/sync/multi-device.test.ts`

### Test Utilities Used
- `createTestUser()` - Creates authenticated test user
- `callPushEndpoint()` - Calls mobile-sync-push
- `callPullEndpoint()` - Calls mobile-sync-pull
- `generateTestId()` - Creates unique entity IDs
- `createMinimalPushPayload()` - Builds valid push payload
- `resetMockStore()` - Clears mock state between tests

### Run Command
```bash
cd phoenix-portal && npm test -- multi-device
```

## Open Questions for Clarification

1. **Session conflict behavior**: The plan claims LOCAL WINS, implementation is SERVER WINS. Which is correct?
2. **Single active cycle enforcement**: Should the server enforce only one active cycle, or is this client-side?
3. **Timestamp-based LWW for routines**: Should routines use `updated_at` comparison instead of simple upsert?

## Document History

- 2026-04-12: Initial design based on code analysis
