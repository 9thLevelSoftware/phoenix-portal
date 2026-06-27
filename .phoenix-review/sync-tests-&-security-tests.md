# Sync Tests & Security Tests Review

Scope reviewed: 23 assigned files under tests/security and tests/sync.

Test command run for sanity:

```bash
npm run test:sync -- tests/sync/error-classes.test.ts tests/sync/pull-pagination.test.ts tests/sync/phases.test.ts
```

Result: passed. Because the script always includes tests/sync/, this ran the sync suite: 17 test files passed, 265 tests passed, 16 skipped.

## Summary

Findings count: 32

Severity breakdown:
- Critical: 0
- High: 8
- Medium: 18
- Low: 6

Primary theme: the mock Edge Function harness is much looser than the real push/pull functions. Many tests pass by asserting only success, shape, or local fixture objects while comments acknowledge the mock does not implement the behavior being claimed.

---

## tests/security/edge-function-security.test.ts

No findings. The file exercises actual security helper functions directly and includes meaningful negative cases for Paddle custom data trust and Garmin identity binding.

---

## tests/sync/setup.ts

### Finding 1
- Category: stub
- Severity: Low
- Line numbers: 175-185
- Description: `setupTestIsolation()` is effectively empty: it declares `testUser` but never creates or cleans one up, and both hooks contain comments only. Any future test that calls this helper expecting per-test isolation will receive no isolation at all.
- Suggested fix direction: Either implement the helper around `createTrackedTestUser()` / `cleanupTrackedTestUser()` or remove it so tests cannot opt into a no-op isolation API.

---

## tests/sync/batch/batch-failure.test.ts

### Finding 2
- Category: failure-point
- Severity: High
- Line numbers: 157-189, 192-224, 228-270
- Description: The file header says the batch behavior should defer `lastSync` until all batches succeed, but the failure tests only verify partial mock-store persistence (`50` or `100` sessions remain). They never assert that a mobile `lastSync` value stays unchanged, and they normalize partial server persistence as expected behavior.
- Suggested fix direction: Add a test seam that models the mobile batch controller state and asserts `lastSync` is not advanced until every batch succeeds. If server writes are expected to be partial, name that explicitly and separately test idempotent full retry reconciliation.

---

## tests/sync/broadcast.test.ts

### Finding 3
- Category: failure-point
- Severity: Medium
- Line numbers: 49-66
- Description: The main successful-broadcast test pushes an empty sessions payload and then accepts any channel matching `/^sync:/`. The mock falls back to `sync:mock-user` when it cannot derive a user from a session, so this test would still pass if successful empty pushes broadcast to the wrong user channel.
- Suggested fix direction: Assert the channel is exactly `sync:${testUser.id}` for all successful pushes, including empty payloads. The mock should derive channel identity from the authenticated user context, not from the first session row.

---

## tests/sync/conflicts/conflict-resolution.test.ts

### Finding 4
- Category: failure-point
- Severity: Medium
- Line numbers: 230-279
- Description: The delta-sync scenario records a `syncTime`, pushes a second routine, and comments that only the second routine should be returned, but it never performs a delta assertion. It only checks that a full pull contains at least two routines and that the mock pattern exists.
- Suggested fix direction: Assert the delta pull excludes the first routine and includes the second routine when running against a fidelity mock or live function. If the mock cannot do this, mark the test live-only and add a mock unit test for the cursor/filter builder.

### Finding 5
- Category: failure-point
- Severity: Medium
- Line numbers: 289-349
- Description: The badge union-merge test describes an expected 3-badge union but only asserts `pullResult.success === true`. It never checks uniqueness, count, or the presence of `FIRST_WORKOUT`, `WEEK_WARRIOR`, and `PR_KING`.
- Suggested fix direction: Pull badges and assert exactly one `FIRST_WORKOUT` plus the two non-overlapping badge IDs. Use a unique key assertion on `(userId, badgeId)` semantics.

### Finding 6
- Category: bug
- Severity: High
- Line numbers: 420-477
- Description: The active-cycle conflict test computes `activeCycles` but never asserts it. The test name says only one cycle should be active, while the actual assertions only require a successful pull and at least one cycle.
- Suggested fix direction: Assert `activeCycles` has length 1 and that the last-activated cycle is the active one, or rename/document the test if the product intentionally allows multiple active cycles.

### Finding 7
- Category: failure-point
- Severity: Low
- Line numbers: 404-411
- Description: The routine deletion scenario does not actually send any deletion/tombstone signal. It simply pulls again after the initial push, so it cannot validate preserving session routine snapshots across routine deletion.
- Suggested fix direction: Push the real deletion representation used by the sync API, then assert the routine is deleted/hidden while historical sessions retain `routineName` and routine references as intended.

---

## tests/sync/cycle-deletion.test.ts

No findings. The file directly exercises `pushPayloadSchema` for valid, defaulted, and invalid `deletedCycleIds` cases.

---

## tests/sync/error-classes.test.ts

### Finding 8
- Category: stub
- Severity: Medium
- Line numbers: 45-60, 123-137
- Description: The TRANSIENT live 5xx and NETWORK fetch-abort scenarios are permanently `it.skip`, not gated by `liveIt`. They will not run even under `npm run test:sync:live`.
- Suggested fix direction: Convert executable live scenarios to `liveIt` and leave only truly manual destructive cases as skipped. For network abort, inject a failing fetch into the harness instead of requiring firewall manipulation.

### Finding 9
- Category: failure-point
- Severity: Medium
- Line numbers: 62-85, 139-147
- Description: `setMockErrorMode('server')` and `setMockErrorMode('network')` are acknowledged as unwired. One test expects a successful 200 after setting server-error mode, which cements the mock defect as a passing regression marker.
- Suggested fix direction: Wire `checkMockError()` into both mock push and mock pull, then flip assertions to require status 500 / code `SERVER_ERROR` and status 0 / code `NETWORK_ERROR`.

---

## tests/sync/exercise-catalog.test.ts

No findings. The tests use production schemas/maps and assert concrete parsed fields and display behavior.

---

## tests/sync/hierarchy.test.ts

### Finding 10
- Category: failure-point
- Severity: High
- Line numbers: 741-792
- Description: The profile-isolation pull test pushes data for profile A and profile B, then only asserts both pulls succeeded and returned defined data. It does not assert profile A excludes profile B data or vice versa.
- Suggested fix direction: Assert returned session IDs for each profile exactly match the requested profile plus any intended null-profile legacy rows. The mock pull path must implement profile filtering or this test should be live-only.

### Finding 11
- Category: failure-point
- Severity: Medium
- Line numbers: 794-814
- Description: The `local_profiles` test pushes `allProfiles` but only asserts `localProfiles` is an array. The current mock returns an empty array unconditionally, so the test passes without proving profile rows round-trip.
- Suggested fix direction: Assert both profile IDs, names, and color indexes are returned, and update the mock to store/pull local profile payloads.

### Finding 12
- Category: failure-point
- Severity: Medium
- Line numbers: 991-1028
- Description: The delta-sync test named “should return only records modified since lastSync” does not assert which records are returned. It only checks `syncTime` is greater than `lastSyncTime`.
- Suggested fix direction: Assert the first session is absent and the second session is present for delta pulls, or move the behavioral assertion to a live-only test until the mock supports per-row timestamps.

### Finding 13
- Category: failure-point
- Severity: Medium
- Line numbers: 1031-1057
- Description: The empty-delta test performs a future-timestamp pull but never asserts returned entity arrays are empty. It only asserts success.
- Suggested fix direction: Assert `sessions`, `routines`, `cycles`, `badges`, and other delta-controlled buckets are empty/null as appropriate.

### Finding 14
- Category: stub
- Severity: Medium
- Line numbers: 1074-1220
- Description: Several tests in the delta/entity sections are documentation-only checks. They assert success or that response fields are defined, while comments state important behavior such as push-only entities, `updated_at` support, badge `earned_at` filtering, and pagination metadata.
- Suggested fix direction: Replace documentation assertions with executable checks against schema/query behavior. For behavior the mock cannot emulate, use `liveIt` and a dedicated lower-level unit test for filter construction.

---

## tests/sync/multi-device.test.ts

### Finding 15
- Category: failure-point
- Severity: High
- Line numbers: 613-689
- Description: The profile no-cross-contamination test only asserts both profile pulls succeeded. It does not check that profile 1 excludes profile 2's session, or that profile 2 excludes profile 1's session.
- Suggested fix direction: Assert the exact session IDs returned for each profile. Add mock profile filtering or mark this scenario live-only.

### Finding 16
- Category: failure-point
- Severity: Medium
- Line numbers: 700-814
- Description: The personal-record preservation test creates two PR-producing sessions and pulls, but only asserts that at least two sessions exist. It never inspects `personalRecords`, even though the scenario is about `INSERT OR IGNORE` PR behavior.
- Suggested fix direction: Assert the expected PR records are present and not overwritten. If the mock cannot derive PRs, run the test live or extend the mock to derive/store personal records from `isPr` sets.

### Finding 17
- Category: failure-point
- Severity: Medium
- Line numbers: 821-894
- Description: The delta-sync accuracy test records a post-first-push sync time and comments that only session 2 should be returned, but only asserts delta pull success.
- Suggested fix direction: Assert `deltaPull` contains session 2 and excludes session 1.

---

## tests/sync/phases.test.ts

### Finding 18
- Category: stub
- Severity: Medium
- Line numbers: 130-149
- Description: The only test that verifies server-derived `personalRecords[].workoutPhase` is gated behind `liveIt`, so it is skipped in the default mock CI path. The mock always returns an empty `personalRecords` array, leaving PR phase derivation untested in normal sync tests.
- Suggested fix direction: Add mock support for deriving PR records from `isPr` sets, or add a direct unit test of the production PR-derivation function.

### Finding 19
- Category: bug
- Severity: Low
- Line numbers: 152-171
- Description: The test title says the default phase is `COMBINED` when `prPhase` is omitted, but the assertion expects `pulledSet.prPhase` to be `undefined`. This verifies absence preservation, not COMBINED defaulting.
- Suggested fix direction: Rename the test to reflect absence preservation, or assert the actual consumer/server defaulting path produces `COMBINED`.

---

## tests/sync/pull-pagination.test.ts

### Finding 20
- Category: stub
- Severity: Medium
- Line numbers: 143-159
- Description: The composite cursor stability regression is `it.skip`, so it never runs in either mock or live mode. This leaves the timestamp-collision pagination case unprotected.
- Suggested fix direction: Convert it to `liveIt` with real seed data or add a unit test around cursor predicate construction and ordering.

### Finding 21
- Category: failure-point
- Severity: Low
- Line numbers: 209-242
- Description: The entity-order test uses `Object.keys(result.data!)` to infer pagination/order semantics. JavaScript object key order only proves response serialization order, not that the Edge Function pages entity buckets in the documented order.
- Suggested fix direction: Test the actual paging sequence by seeding multiple entity types and walking cursors, or unit test the production bucket-order planner.

---

## tests/sync/round-trip/entity-roundtrip.test.ts

### Finding 22
- Category: failure-point
- Severity: Medium
- Line numbers: 649-699
- Description: The personal-record round-trip tests only build local `expectedRecord` / `record` objects and assert their own fields. They do not push or pull personal records, so they cannot catch sync regressions.
- Suggested fix direction: Push data that should create/preserve PRs and assert `pullResult.data.personalRecords` contains the expected phases and record types.

### Finding 23
- Category: failure-point
- Severity: Medium
- Line numbers: 703-732
- Description: The RPG attributes “round-trip” test only checks push success and then reasserts the local object values. The mock does not store RPG attributes, so no round-trip is validated.
- Suggested fix direction: Assert pulled `rpgAttributes` matches the pushed object, and update the mock to store it or run this test live.

### Finding 24
- Category: failure-point
- Severity: Medium
- Line numbers: 753-793
- Description: The badge round-trip test pushes badges but never pulls and asserts returned badge rows. It only verifies the input badge array structure.
- Suggested fix direction: Pull after push and assert badge IDs, names, tiers, and deduplication behavior.

### Finding 25
- Category: failure-point
- Severity: Low
- Line numbers: 932-1043
- Description: The full sync payload test includes RPG attributes, badges, and gamification stats, but after pulling it only checks sessions/routines/cycles counts. Several entity types in the combined payload can be dropped without failing the test.
- Suggested fix direction: Assert every entity type included in the payload is returned or intentionally push-only, with explicit expectations for stats and gamification fields.

---

## tests/sync/round-trip/workout-roundtrip.test.ts

### Finding 26
- Category: failure-point
- Severity: Low
- Line numbers: 610-629
- Description: The test named “should isolate failures - one bad session should not block others” only pushes a single valid session. It contains no bad session and therefore does not exercise isolation or transactional behavior.
- Suggested fix direction: Include one valid and one deliberately invalid session in the same payload, then assert the expected all-or-nothing or partial-acceptance contract.

---

## tests/sync/transforms/mode-transform.test.ts

No findings. The file includes both mock round-trip checks and production `workoutSessionSchema` transform tests for the key mode mappings.

---

## tests/sync/transforms/velocity-zones.test.ts

No findings. The file asserts concrete velocity/asymmetry boundaries and validates round-trip preservation of biomechanics fields.

---

## tests/sync/transforms/weight-transform.test.ts

No findings. The file has concrete assertions around per-cable storage, display multiplication, boundaries, and round-trip persistence.

---

## tests/sync/validation.test.ts

### Finding 27
- Category: failure-point
- Severity: High
- Line numbers: 134-216, 318-380, 399-419
- Description: Most high-value server invariants are `liveIt` and therefore skipped in the default `npm run test:sync` path: payload size, array caps, rate limits, subscription gating, and expired JWT behavior. The default CI mock run exercises only positive controls and missing-auth checks.
- Suggested fix direction: Add unit-level tests for the production validation helpers where possible, and add mock enforcement for array caps / known error responses so default CI catches regressions. Keep live tests as integration confirmation, not the only coverage.

### Finding 28
- Category: failure-point
- Severity: Medium
- Line numbers: 399-418
- Description: The expired-JWT live test uses a placeholder-looking token string and only expects status 401. That verifies invalid-token rejection at best, not specifically expired-token classification.
- Suggested fix direction: Generate a signed JWT with an expired `exp` using the configured local JWT secret, then assert the expected AUTH-class response shape.

---

## tests/sync/fixtures/index.ts

No findings in this index file. The aggregate fixture helpers are deterministic enough for fixture generation, and deeper fixture-specific validation would belong in the individual fixture modules.

---

## tests/sync/helpers/edge-function-harness.ts

### Finding 29
- Category: failure-point
- Severity: High
- Line numbers: 733-738, 768-831, 837-852
- Description: `generateTestId()` returns strings like `test-${Date.now()}-...`, and the builder helpers use it for session/exercise/set/routine IDs. The production `pushPayloadSchema` uses a strict UUID regex for these entity IDs, so many mock-mode tests pass with IDs that real Edge Functions would reject.
- Suggested fix direction: Change `generateTestId()` to return `crypto.randomUUID()` for entity IDs, or introduce separate helpers for human-readable labels versus UUID primary keys.

---

## tests/sync/helpers/mock-broadcast.ts

No direct findings. Its behavior is simple, but its fallback-user behavior is affected by `mock-edge-functions.ts` deriving broadcast identity from sessions rather than auth context.

---

## tests/sync/helpers/mock-edge-functions.ts

### Finding 30
- Category: failure-point
- Severity: High
- Line numbers: 80-150, 395-427
- Description: `mockPushEndpoint()` does not call `checkMockError()` and does not validate via the full production `pushPayloadSchema`; it only checks auth presence, `deviceId`, `platform`, duplicate keys, and incomplete routines. This hides invalid UUIDs, array caps, many schema errors, and injected error modes.
- Suggested fix direction: Call `checkMockError()` at the top of push and pull mocks, then parse/coerce the payload with the production schema before mutating mock state.

### Finding 31
- Category: failure-point
- Severity: High
- Line numbers: 233-294
- Description: `mockPullEndpoint()` accepts `deviceId`, `profileId`, `cursor`, `pageSize`, and `knownEntityIds`, but ignores all of them. It returns all stored entities based only on a global `lastPushTime`, which makes profile isolation, pagination, parity, and per-row delta tests pass without exercising real behavior.
- Suggested fix direction: Store per-entity timestamps/profile IDs and implement filtering, cursor/page-size semantics, and `knownEntityIds` limits in the mock, or force these tests into live mode.

### Finding 32
- Category: failure-point
- Severity: Medium
- Line numbers: 184-195, 201-215
- Description: Badge and broadcast identity are derived from payload data or hardcoded `mock-user` instead of authenticated user context. Badge keys use `mock-user:${badge.badgeId}` and broadcasts use `payload.sessions?.[0]?.userId ?? 'mock-user'`, so tests cannot detect cross-user badge/channel leakage.
- Suggested fix direction: Represent auth context in the mock token/test user and key all user-scoped state and broadcasts from that authenticated user ID.

---

## tests/sync/helpers/supabase-test-client.ts

No findings. The helper fails closed when required live Supabase config is missing and uses local Supabase defaults for local development.
