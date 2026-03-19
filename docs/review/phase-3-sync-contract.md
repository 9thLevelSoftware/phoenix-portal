# Phase 3: Sync Contract Review

## Realtime Broadcast Verification

**Reviewed:** 2026-03-18
**Reviewer:** Frontend Developer Agent (Task 3.5)
**Branch:** beta-readiness-review

---

### 1. Complete Flow Trace: Mobile Write to UI Re-render

```
Mobile App (Kotlin)
  |
  | POST /functions/v1/mobile-sync-push  (JWT in Authorization header)
  v
Edge Function: mobile-sync-push/index.ts
  |
  |-- 1. JWT verification via supabaseAuth.auth.getUser()
  |-- 2. Rate limit: 10 req/min/user via checkRateLimit()
  |-- 3. Subscription gate: EMBER+ via requireSubscription()
  |-- 4. Upsert workout_sessions, exercises, sets, rep_summaries (FK order)
  |-- 5. Compute exercise_progress (Brzycki 1RM) + dedup insert
  |-- 6. Extract personal_records from is_pr sets + dedup insert
  |-- 7. Upsert routines + delete/reinsert routine_exercises
  |-- 7b. Upsert training_cycles + delete/reinsert cycle_days
  |-- 8. Upsert rpg_attributes
  |-- 9. Upsert earned_badges
  |-- 10. Upsert gamification_stats
  |-- 11. Broadcast via channel.httpSend('sync_complete', {...})
  |
  v
Supabase Realtime (server-side Broadcast)
  |
  | Channel: sync:{userId}
  | Event: sync_complete
  | Payload: { syncTime, deviceId, platform, sessionsInserted, routinesUpserted, cyclesUpserted, badgesUpserted }
  |
  v
Portal Frontend: useRealtimeSync() hook
  |
  | supabase.channel(`sync:${user.id}`).on('broadcast', { event: 'sync_complete' }, callback)
  |
  |-- callback calls: queryClient.invalidateQueries()  (no filter -- invalidates ALL queries)
  |
  v
TanStack Query: marks all queries as stale, triggers refetch for active/mounted queries
  |
  v
UI components re-render with fresh data
```

---

### 2. Hook Analysis: useRealtimeSync.ts

**Location:** `src/hooks/useRealtimeSync.ts` (50 lines)

| Aspect | Detail |
|---|---|
| **Channel name** | `sync:{userId}` (e.g., `sync:00000000-0000-4000-8000-000000000001`) |
| **Event type** | `sync_complete` (Broadcast, not postgres_changes) |
| **Queries invalidated** | ALL queries -- `queryClient.invalidateQueries()` called with no filter argument |
| **Subscription gating** | Yes -- FREE users skip entirely (`if (tier === "FREE") return`) |
| **Loading guard** | Yes -- waits for `useSubscription().isLoading` to resolve before deciding |
| **Cleanup on unmount** | Yes -- `supabase.removeChannel(channel)` in the useEffect return |

**Effect dependencies:** `[user, tier, isLoading, queryClient]`

**Where mounted:** `AppLayout.tsx` line 39 -- mounted once in the authenticated shell layout, persists across route changes. Correct placement.

---

### 3. Edge Function Analysis: mobile-sync-push/index.ts

**Broadcast mechanism:** Uses `supabase.channel(...).httpSend()` (server-side HTTP Broadcast, not WebSocket `.send()`). This is the correct approach for Edge Functions which are stateless and cannot hold open WebSocket connections.

**Broadcast call (lines 728-746):**
```ts
const broadcastResult = await supabase
  .channel(`sync:${userId}`)
  .httpSend('sync_complete', {
    syncTime,
    deviceId: payload.deviceId,
    platform: payload.platform,
    sessionsInserted,
    routinesUpserted,
    cyclesUpserted,
    badgesUpserted,
  });
```

**Failure handling:**
- Broadcast failure is caught and logged as a warning (`console.warn`)
- The HTTP response to the mobile app still returns 200 with sync counts
- This is correct -- the DB writes succeeded; the broadcast is best-effort notification

**Subscription gate on server side:**
- `requireSubscription(supabase, userId, 'EMBER', cors)` returns 402 if user is below EMBER tier
- Uses service-role client, queries `subscriptions` table for `active` or `trialing` status
- Tier hierarchy: FREE(0) < EMBER(1) < FLAME(2) < INFERNO(3)

---

### 4. Query Provider Configuration

**File:** `src/providers/QueryProvider.tsx`

| Setting | Value | Impact on Sync |
|---|---|---|
| **staleTime** | 5 minutes (300,000ms) | After invalidation, queries are marked stale immediately (invalidateQueries overrides staleTime). Refetch happens on next observer access. |
| **gcTime** | Default (5 minutes) | Not explicitly set; TanStack Query default is 5 minutes. Inactive queries are garbage-collected after this window. |
| **retry** | 1 | Failed refetches get one retry attempt |
| **refetchOnWindowFocus** | false | Switching browser tabs does NOT trigger refetch. Only explicit invalidation or manual refetch triggers updates. |
| **refetchOnReconnect** | Default (true) | Not overridden, so reconnecting after network loss will trigger refetch for stale queries. |

---

### 5. Query Key Structure (keys.ts)

The `queryClient.invalidateQueries()` call in useRealtimeSync uses **no filter**, meaning it invalidates every query key in the cache. This covers all 17 query domains:

- `workouts` (list, detail, comparison)
- `records` (byUser)
- `analytics` (summary)
- `routines` (byUser, detail)
- `subscription` (byUser)
- `cycles` (byUser, detail)
- `telemetry` (bySet, repSummaries)
- `biomechanics` (asymmetry, rom)
- `progress` (exercises, byExercise, summary)
- `replay` (session, telemetry)
- `integrations` (byUser, external, syncQueue)
- `comments` (byItem)
- `community` (feed, creators, blocks, reports, saves, votes, follows)
- `challenges` (list, detail)
- `onboarding` (byUser)
- `goals` (byUser, progress)
- `recovery` (score, wearable)
- `profile` (byUser, stats, topExercises, badges, rpg, gamification)
- `insights` (byUser)
- `benchmarks` (distribution)

---

### 6. Timing Analysis: Sync Event to UI Update

```
Mobile POST completes
  |-- DB writes: ~200-500ms (10 tables, FK-ordered upserts)
  |-- httpSend broadcast: ~50-100ms (HTTP call to Supabase Realtime)
  |
  v
Portal receives broadcast via WebSocket: ~50-150ms (existing connection)
  |
  |-- invalidateQueries() called: ~1ms (marks queries stale in memory)
  |-- Active/mounted queries refetch: ~100-300ms (Supabase REST round-trip)
  |
  v
UI re-renders with fresh data

TOTAL ESTIMATED LATENCY: 400ms - 1050ms from DB write to UI update
```

This is well within acceptable limits for a "real-time" sync experience.

---

### 7. Issues and Gaps Identified

#### ISSUE 1: Broadcast-Only Invalidation (No Fallback) -- Severity: MEDIUM

**Problem:** If the portal WebSocket is disconnected at the moment the broadcast fires, the `sync_complete` event is lost. Supabase Broadcast is fire-and-forget with no delivery guarantee. The portal has no polling fallback.

**Impact:** The UI stays stale until the user manually refreshes the page or navigates to trigger a new query.

**Current mitigation:** `refetchOnReconnect` is default `true`, so when the WebSocket reconnects, stale queries (those past their 5-min staleTime) will refetch. But any queries fetched within the last 5 minutes will still show stale data.

**Recommendation:** Add a lightweight polling fallback, or implement a "last sync timestamp" comparison. Options:
1. Store `last_sync_at` in the database. On WebSocket reconnect, compare server's `last_sync_at` against the client's last-known value. If newer, invalidate all queries.
2. Reduce `staleTime` for workout-related queries to 60 seconds (only these queries, not all) so `refetchOnReconnect` catches up faster.
3. Add a visible "Last synced: X ago" indicator in the UI so the user knows if data is stale.

#### ISSUE 2: Full Cache Invalidation Is Overly Broad -- Severity: LOW

**Problem:** `queryClient.invalidateQueries()` with no filter invalidates ALL queries, including community feed, comments, challenges, benchmarks, and other data completely unrelated to a workout sync.

**Impact:** After a sync, the portal fires refetch requests for every active query on the page, even those that cannot possibly be affected by a workout sync. This wastes bandwidth and increases server load.

**Recommendation:** Invalidate only the query keys that a sync can affect:
```ts
const syncAffectedKeys = [
  queryKeys.workouts.all,
  queryKeys.records.all,
  queryKeys.analytics.all,
  queryKeys.routines.all,
  queryKeys.cycles.all,
  queryKeys.telemetry.all,
  queryKeys.biomechanics.all,
  queryKeys.progress.all,
  queryKeys.profile.all,      // stats, badges, rpg, gamification
  queryKeys.goals.all,         // progress toward goals
  queryKeys.recovery.all,      // recovery score may update
];

for (const key of syncAffectedKeys) {
  queryClient.invalidateQueries({ queryKey: key });
}
```

This would skip `community`, `comments`, `challenges`, `benchmarks`, `integrations`, `onboarding`, `subscription`, `replay`, and `insights` queries.

#### ISSUE 3: CHANNEL_ERROR Has No Recovery -- Severity: MEDIUM

**Problem:** When the channel status is `CHANNEL_ERROR` (line 41-43), the hook only logs to console. There is no:
- User-visible notification that realtime sync is broken
- Retry logic or exponential backoff
- Fallback to polling

**Supabase SDK behavior:** The `@supabase/supabase-js` client does have internal reconnection logic with exponential backoff for WebSocket disconnects. However, `CHANNEL_ERROR` can indicate an authorization or server-side issue that the SDK will not auto-recover from.

**Recommendation:**
1. On `CHANNEL_ERROR`, surface a toast or banner: "Live sync temporarily unavailable. Data will refresh on page load."
2. Implement a retry counter. After 3 consecutive `CHANNEL_ERROR` events, fall back to polling with `refetchInterval`.

#### ISSUE 4: Broadcast Failure on Edge Function Is Silent to Portal -- Severity: LOW

**Problem:** If `httpSend` fails on the Edge Function side (lines 744-746), the mobile app still gets a 200 response with sync counts. The portal never learns that a sync happened.

**Impact:** Same as Issue 1 -- stale UI until manual refresh.

**Mitigation:** This is actually acceptable design. The DB writes succeeded, and the mobile app should not be penalized for a broadcast failure. The portal should have its own resilience (addressed in Issue 1).

#### ISSUE 5: useSubscription Has Race With useRealtimeSync -- Severity: LOW

**Problem:** Both hooks run in the same AppLayout render. `useRealtimeSync` depends on `useSubscription` returning `tier` and `isLoading`. The subscription data comes from a TanStack Query that fetches from the database. On initial page load:
1. `isLoading` is `true` -- useRealtimeSync returns early (correct guard)
2. Subscription query resolves -- `tier` is now set
3. Effect re-runs, subscribes to channel

**Timing:** There is a delay of 100-500ms between AppLayout mount and Broadcast channel subscription. During this window, any broadcast events would be missed.

**Impact:** Very low. This only matters if the user completes a workout on mobile within 500ms of loading the portal. Extremely unlikely in practice.

#### ISSUE 6: No Deduplication of Broadcast Events -- Severity: LOW

**Problem:** If the mobile app retries the sync POST (e.g., network timeout, then retry), the Edge Function will process the upserts (idempotent due to `onConflict: 'id'`) and send a second `sync_complete` broadcast. The portal will call `invalidateQueries()` twice.

**Impact:** Minimal. Double-invalidation causes one extra refetch cycle. TanStack Query deduplicates in-flight requests, so this is effectively a no-op.

---

### 8. Test Coverage

**Existing test:** `src/hooks/__tests__/useRealtimeSync.test.tsx`

| Test Case | Status |
|---|---|
| Subscribes to correct channel name | COVERED |
| Calls invalidateQueries on sync_complete | COVERED |
| Cleans up channel on unmount | COVERED |
| Skips subscription for FREE users | NOT COVERED |
| Handles CHANNEL_ERROR status | NOT COVERED |
| Waits for subscription loading | NOT COVERED |
| Does nothing when user is null | NOT COVERED |

**Recommendation:** Add tests for the FREE-user skip path, the loading guard, and the null-user guard.

---

### 9. Realtime Channel Inventory

The portal maintains the following Supabase Realtime channels for an authenticated EMBER+ user:

| Channel | Type | Hook | Purpose |
|---|---|---|---|
| `sync:{userId}` | Broadcast | useRealtimeSync | Workout sync from mobile |
| `subscription:{userId}` | postgres_changes | useSubscription | Subscription tier changes |
| `comments:{itemId}` | postgres_changes | useCommentRealtime | Live comment updates |
| `community-votes-realtime` | postgres_changes | useCommunityRealtime | Community vote updates |

Total: 3-4 concurrent WebSocket channels per authenticated session (comments channel is per-page).

---

### 10. Verdict

**Status: PASS with noted improvements**

The realtime sync flow is correctly implemented end-to-end:
- The Edge Function writes data in FK order, computes derived data (1RM, PRs), and broadcasts on the correct channel
- The portal hook subscribes to the correct channel, gates on subscription tier, and properly cleans up
- The invalidation triggers a full refetch of active queries
- The test suite covers the happy path

**Priority fixes before beta:**
1. **MEDIUM** -- Add user-visible feedback for `CHANNEL_ERROR` (Issue 3)
2. **MEDIUM** -- Add a reconnection-aware sync check (Issue 1) -- at minimum, a "Last synced" indicator

**Improvements for post-beta:**
3. **LOW** -- Scope invalidation to sync-affected query keys only (Issue 2)
4. **LOW** -- Expand test coverage for edge cases (Issue 8)

---

## Mobile App Sync Client Review

**Reviewed:** 2026-03-18
**Reviewer:** API Tester Agent (Task 3.2)
**Mobile repo:** `https://github.com/9thLevelSoftware/Project-Phoenix-MP` (branch: MVP)
**Files analyzed:**
- `shared/src/commonMain/kotlin/com/devil/phoenixproject/data/sync/PortalSyncDtos.kt`
- `shared/src/commonMain/kotlin/com/devil/phoenixproject/data/sync/PortalApiClient.kt`
- `shared/src/commonMain/kotlin/com/devil/phoenixproject/data/sync/PortalSyncAdapter.kt`
- `shared/src/commonMain/kotlin/com/devil/phoenixproject/data/sync/PortalPullAdapter.kt`
- `shared/src/commonMain/kotlin/com/devil/phoenixproject/data/sync/PortalMappings.kt`
- `shared/src/commonMain/kotlin/com/devil/phoenixproject/data/sync/SyncManager.kt`
- `shared/src/commonMain/kotlin/com/devil/phoenixproject/data/sync/SyncTriggerManager.kt`
- `shared/src/commonMain/kotlin/com/devil/phoenixproject/data/sync/SyncModels.kt`

---

### 11. Mobile Sync Architecture

The mobile app (Kotlin Multiplatform) uses a layered sync architecture:

| Layer | File | Purpose |
|-------|------|---------|
| DTOs | `PortalSyncDtos.kt` | Wire-format data classes with `@Serializable` (camelCase JSON) |
| API Client | `PortalApiClient.kt` | HTTP calls via Ktor; auth token management with auto-refresh |
| Adapter | `PortalSyncAdapter.kt` | Transforms mobile domain models into portal DTOs |
| Pull Adapter | `PortalPullAdapter.kt` | Converts pull response DTOs back to legacy merge DTOs |
| Mappings | `PortalMappings.kt` | Unit conversions (mm/s to m/s, kg to N) and enum mappings |
| Sync Manager | `SyncManager.kt` | Orchestrates push-then-pull sequence; gathers data from repos |
| Trigger Manager | `SyncTriggerManager.kt` | Controls when sync fires (workout complete, app foreground) |

The Ktor HTTP client is configured with `ignoreUnknownKeys = true`, `isLenient = true`, and `encodeDefaults = true`, meaning default values always appear in the wire payload and unknown response fields are silently ignored.

---

### 12. Sync Triggers

| Trigger | Throttled | Condition |
|---------|-----------|-----------|
| **Workout completed** | No (bypasses throttle) | `SyncTriggerManager.onWorkoutCompleted()` -- fires immediately |
| **App foreground** | Yes (5-minute cooldown) | `SyncTriggerManager.onAppForeground()` -- skips if <5 min since last |
| **Manual** (implicit) | No | `SyncManager.sync()` can be called directly |

**Pre-conditions checked before every sync attempt:**
- User is authenticated (`syncManager.isAuthenticated`)
- Device is online (`connectivityChecker.isOnline()`)

**Failure handling:**
- Tracks consecutive failures; exposes `hasPersistentError` StateFlow after 3 failures
- Resets on successful sync
- 401 from push triggers `SyncState.NotAuthenticated`

---

### 13. Push Payload Shape (What Mobile Sends)

**Source:** `PortalSyncPayload` in `PortalSyncDtos.kt`, assembled in `SyncManager.pushLocalChanges()`

```kotlin
@Serializable
data class PortalSyncPayload(
    val deviceId: String,         // Device identifier from PortalTokenStorage
    val platform: String,         // "android" or "ios"
    val lastSync: Long,           // Epoch milliseconds (NOT ISO 8601)
    val sessions: List<PortalWorkoutSessionDto>,
    val routines: List<PortalRoutineSyncDto>,
    val cycles: List<PortalTrainingCycleSyncDto>,
    val rpgAttributes: PortalRpgAttributesSyncDto?,
    val badges: List<PortalEarnedBadgeSyncDto>,
    val gamificationStats: PortalGamificationStatsSyncDto?
)
```

**Serialization config:** kotlinx.serialization with `encodeDefaults = true`, so default values are always present in the wire payload.

---

### 14. Field-by-Field Contract Comparison (Push)

#### 14.1 Top-Level PushPayload

| Field | Edge Function (TS) | Mobile (Kotlin) | Match? | Notes |
|-------|-------------------|-----------------|--------|-------|
| `deviceId` | `string` | `String` | YES | |
| `platform` | `string` | `String` (default "android") | YES | |
| `lastSync` | `string \| null` | `Long` | **MISMATCH** | Edge Function declares ISO 8601 string; mobile sends epoch millis number |
| `sessions` | `SessionDto[]` | `List<PortalWorkoutSessionDto>` | YES | |
| `routines` | `RoutineDto[]` | `List<PortalRoutineSyncDto>` | YES | |
| `cycles` | `CycleDto[]` | `List<PortalTrainingCycleSyncDto>` | YES | |
| `rpgAttributes` | `RpgAttributesDto \| null` | `PortalRpgAttributesSyncDto?` | YES | |
| `badges` | `BadgeDto[]` | `List<PortalEarnedBadgeSyncDto>` | YES | |
| `gamificationStats` | `GamificationStatsDto \| null` | `PortalGamificationStatsSyncDto?` | YES | |

#### 14.2 SessionDto / PortalWorkoutSessionDto

| Field | Edge Function Type | Mobile Type | Match? | Notes |
|-------|-------------------|-------------|--------|-------|
| `id` | `string` | `String` | YES | |
| `userId` | `string` | `String` | YES | Edge Function overrides with JWT userId |
| `name` | `string \| null` | `String? = null` | YES | |
| `startedAt` | `string` | `String` (ISO 8601) | YES | Converted via `epochToIso8601()` |
| `durationSeconds` | `number` | `Int = 0` | YES | ms to seconds conversion |
| `totalVolume` | `number` | `Float = 0f` | YES | Per-cable kg |
| `setCount` | `number` | `Int = 0` | YES | |
| `exerciseCount` | `number` | `Int = 0` | YES | |
| `prCount` | `number` | `Int = 0` | YES | Always 0; PR detection is server-side |
| `routineName` | `string \| null` | `String? = null` | YES | |
| `workoutMode` | `string \| null` | `String? = null` | YES | SCREAMING_SNAKE format |
| `routineSessionId` | `string \| null` | `String? = null` | YES | |
| `notes` | `string \| null` | **MISSING** | **MISMATCH** | Mobile DTO lacks this field entirely |
| `exercises` | `ExerciseDto[]` | `List<PortalExerciseDto>` | YES | |

#### 14.3 ExerciseDto / PortalExerciseDto

All 6 fields match. No issues.

#### 14.4 SetDto / PortalSetDto

All 11 fields match. `notes` exists in mobile DTO but adapter never sets it (defaults to null). No issues.

#### 14.5 RepSummaryDto / PortalRepSummaryDto

All 15 fields match. Unit conversions applied correctly:
- Velocity: mm/s to m/s (divide by 1000)
- Force: kg to Newtons (multiply by 9.80665)
- Cable A to "left", Cable B to "right"

#### 14.6 RoutineDto / PortalRoutineSyncDto

All 9 top-level fields match. No issues.

**Note:** `estimatedDuration` is sent in seconds. Edge Function converts to minutes: `Math.round(r.estimatedDuration / 60)`.

#### 14.7 RoutineExerciseDto / PortalRoutineExerciseSyncDto

All 23 fields match exactly. The advanced fields (superset, per-set config, AMRAP, echo/eccentric) are all aligned.

#### 14.8 CycleDto / PortalTrainingCycleSyncDto

All 14 top-level fields match. No issues.

#### 14.9 CycleDayDto / PortalCycleDaySyncDto

All 10 fields match. No issues.

#### 14.10 RpgAttributesDto / PortalRpgAttributesSyncDto

All 9 fields match. No issues.

#### 14.11 BadgeDto / PortalEarnedBadgeSyncDto

All 6 fields match. `earnedAt` is ISO 8601 on both sides. No issues.

#### 14.12 GamificationStatsDto / PortalGamificationStatsSyncDto

All 7 fields match. Note: `totalTimeSeconds` is always `0` from mobile.

---

### 15. Pull Contract Comparison

#### 15.1 Pull Request

| Field | Edge Function expects | Mobile sends | Match? |
|-------|----------------------|-------------|--------|
| `deviceId` | `string` | `String` | YES |
| `lastSync` | `number` (Unix ms, 0 for first) | `Long` (epoch ms) | YES |

The pull request matches correctly. Edge Function converts `lastSync` to ISO 8601 for DB queries.

#### 15.2 Pull Response

| Field | Edge Function returns | Mobile expects | Match? | Notes |
|-------|----------------------|---------------|--------|-------|
| `syncTime` | `number` (epoch ms) | `Long` | YES | |
| `sessions` | camelCase hierarchy | `List<PullWorkoutSessionDto>` | YES | Deserialized but SKIPPED during merge |
| `routines` | camelCase hierarchy | `List<PullRoutineDto>` | YES | |
| `cycles` | camelCase hierarchy | `List<PullTrainingCycleDto>` | YES | |
| `rpgAttributes` | camelCase object or null | `PullRpgAttributesDto?` | YES | |
| `badges` | camelCase array | `List<PullBadgeDto>` | YES | |
| `gamificationStats` | camelCase object or null | `PullGamificationStatsDto?` | YES | |

**Pull response includes extra fields the mobile silently ignores** (via `ignoreUnknownKeys = true`):
- RPG attributes response has `id` and `updatedAt` -- no corresponding DTO fields
- Badge response has `id` -- no corresponding DTO field
- Gamification stats response has `id` and `updatedAt` -- no corresponding DTO fields

This is safe behavior.

---

### 16. Pull Merge Strategy

| Data Type | Merge Strategy | Notes |
|-----------|---------------|-------|
| **Sessions** | SKIPPED (push-only) | Sessions are immutable; mobile is source of truth |
| **Routines** | Local preference | Mobile keeps its version if locally modified since lastSync |
| **Cycles** | Server wins | Portal is authoritative for training cycles |
| **Badges** | Union merge | Insert if not exists; never delete |
| **Gamification stats** | Server wins | Overwrite local stats |
| **RPG attributes** | Server wins | Overwrite local RPG profile |

---

### 17. Naming Convention Analysis

All wire-format fields use **camelCase** consistently. Both the mobile DTOs (Kotlin property names serialize as camelCase by default with kotlinx.serialization) and the Edge Function TypeScript interfaces use camelCase. The Edge Function handles camelCase-to-snake_case mapping when inserting into PostgreSQL.

No snake_case/camelCase mismatch exists in the wire format.

---

### 18. Data Type Summary

| Data type | Mobile (Kotlin) | Wire format (JSON) | Edge Function (TypeScript) | Notes |
|-----------|----------------|-------------------|---------------------------|-------|
| Timestamps | `Long` (epoch ms) or `String` (ISO 8601) | number or string | `string` or `number` | See Mismatch 1 |
| UUIDs | `String` (client-generated via `generateUUID()`) | string | `string` | Client-generated; no server ID mapping needed |
| Integers | `Int` | number | `number` | |
| Decimals | `Float` | number | `number` | JS float64 is safe for Kotlin Float |
| Booleans | `Boolean` | boolean | `boolean` | |
| Nullable | `Type?` with `= null` default | null or value | `Type \| null` | |
| JSON blobs | `String?` (pre-serialized JSON) | string | `string` (parsed via `safeJsonParse`) | perSetWeights, perSetRest, progressionSettings |

---

### 19. Identified Mismatches

#### MISMATCH M1 (LOW): `lastSync` type in Push payload

- **Edge Function declares:** `lastSync: string | null` (TypeScript interface `PushPayload`)
- **Mobile sends:** `lastSync: Long` (Kotlin `PortalSyncPayload.lastSync`) -- serialized as a JSON number
- **Runtime impact:** NONE. The Edge Function **never reads `payload.lastSync`** in its processing logic. The field is a dead wire artifact on the push path. The Edge Function uses JWT-authenticated userId and server-side timestamps exclusively.
- **Risk:** LOW. If future code reads `lastSync` from the push payload (e.g., for conflict resolution), it will receive a number instead of an ISO string. The TypeScript interface is misleading.
- **Recommendation:** Align the TypeScript interface to match reality: `lastSync: number | string | null` or `lastSync: number`.

#### MISMATCH M2 (LOW): Missing `notes` field on SessionDto

- **Edge Function interface has:** `notes: string | null` on `SessionDto`
- **Mobile DTO sends:** `PortalWorkoutSessionDto` has **no `notes` field**
- **Runtime impact:** NONE. JavaScript `s.notes` evaluates to `undefined`, which Supabase upsert treats as "don't set this column" (column gets NULL or retains its existing value).
- **Risk:** LOW. Only fails if `workout_sessions.notes` column has NOT NULL constraint with no default. Currently appears nullable.
- **Recommendation:** Add `val notes: String? = null` to `PortalWorkoutSessionDto` for interface completeness.

#### MISMATCH M3 (MEDIUM): `estimatedDuration` units asymmetry on round-trip

- **Mobile sends:** `estimatedDuration` in **seconds** (e.g., 3600 for a 1-hour routine)
- **Edge Function stores:** `Math.round(r.estimatedDuration / 60)` -- converts to **minutes** before DB insert
- **Pull response returns:** The raw DB value (in **minutes**)
- **Mobile receives on pull:** `estimatedDuration: Int` -- interprets as-is (no unit conversion)
- **Impact:** If a routine is created on the **portal** and pulled to mobile, the mobile app will interpret `estimatedDuration: 60` (minutes from DB) as 60 **seconds** instead of 60 minutes. Displays "1 minute" instead of "1 hour".
- **Risk:** MEDIUM for portal-created routines. Does not affect mobile-created routines (round-trip: seconds -> minutes -> pulled as minutes, mobile would display wrong value if it were to re-display the pulled value, but it uses its own local calculation).
- **Recommendation:** Either (a) store seconds in DB and convert only in portal UI, or (b) have `PortalPullAdapter` multiply by 60 when receiving `estimatedDuration`.

#### MISMATCH M4 (LOW): `totalTimeSeconds` always zero

- **Mobile sends:** `totalTimeSeconds: 0` always (hardcoded in `SyncManager.pushLocalChanges()`)
- **Impact:** Portal's `gamification_stats.total_time_seconds` column is always 0 for mobile-synced users. Any portal UI displaying total training time shows 0.
- **Risk:** LOW. Data completeness issue, not a contract mismatch.
- **Recommendation:** Mobile app should compute `totalTimeSeconds` from cumulative session durations.

#### MISMATCH M5 (LOW): `syncTime` format inconsistency between push and pull responses

- **Push response:** `syncTime: String` (ISO 8601, e.g., `"2026-03-18T12:00:00.000Z"`)
- **Pull response:** `syncTime: Long` (epoch millis, e.g., `1710763200000`)
- **Mobile handling:** Push: parses ISO 8601 via `kotlin.time.Instant.parse()`. Pull: uses Long directly. Both work correctly.
- **Risk:** LOW. Maintenance hazard -- inconsistent API surface.
- **Recommendation:** Standardize both endpoints to return the same `syncTime` format.

---

### 20. Mobile Sync Security Assessment

| Aspect | Status | Notes |
|--------|--------|-------|
| Auth token management | SOLID | Mutex-protected refresh with double-check pattern and 401 retry |
| Sensitive data in payload | SAFE | No passwords; userId comes from JWT; Edge Function overrides userId |
| Token storage | OK | `PortalTokenStorage` manages access/refresh tokens, expiry tracking |
| Auto-refresh on 401 | YES | `authenticatedRequest()` retries once with a forced token refresh |
| Retry on failure | LIMITED | `SyncTriggerManager` tracks failures but no exponential backoff on sync itself |
| Pull endpoint security | CONCERN | No rate limiting or subscription gate on pull (see Phase 3.5 Issue 6 above) |

---

### 21. Mobile Sync Data Flow Diagram

```
Mobile App                          Portal Edge Functions              Supabase DB
    |                                       |                              |
    |-- POST mobile-sync-push ------------->|                              |
    |   Headers: Bearer JWT, apikey         |                              |
    |   Body: PortalSyncPayload (camelCase) |                              |
    |                                       |-- JWT verify --------------->|
    |                                       |-- Rate limit check (10/min)->|
    |                                       |-- Subscription gate (EMBER+) |
    |                                       |-- camelCase -> snake_case -> |
    |                                       |   Upsert all tables -------->|
    |                                       |-- Compute 1RM, extract PRs ->|
    |                                       |-- Broadcast sync_complete -->|
    |<-- PortalSyncPushResponse ------------|                              |
    |   syncTime: ISO 8601 string           |                              |
    |   Parse ISO -> epoch ms for storage   |                              |
    |                                       |                              |
    |-- POST mobile-sync-pull ------------->|                              |
    |   Headers: Bearer JWT, apikey         |                              |
    |   Body: {deviceId, lastSync: epochMs} |                              |
    |                                       |-- JWT verify --------------->|
    |                                       |-- Query since lastSync ----->|
    |                                       |-- snake_case -> camelCase -->|
    |<-- PortalSyncPullResponse ------------|                              |
    |   syncTime: epoch ms (number)         |                              |
    |                                       |                              |
    |-- Merge: routines (local pref) -------|                              |
    |-- Merge: cycles (server wins) --------|                              |
    |-- Merge: badges (union) --------------|                              |
    |-- Merge: gamification (server) --------|                              |
    |-- Merge: RPG attrs (server) ----------|                              |
    |-- SKIP: sessions (push-only) ---------|                              |
    |                                       |                              |
    |-- Store finalSyncTime locally --------|                              |
```

---

### 22. Summary: Mobile Client Contract Health

| Category | Finding Count | Severity Breakdown |
|----------|--------------|-------------------|
| Field name mismatches (camelCase) | 0 | -- |
| Missing fields | 1 | M2: `notes` on session (LOW) |
| Type mismatches | 1 | M1: `lastSync` number vs string (LOW) |
| Unit/format mismatches | 2 | M3: estimatedDuration (MEDIUM), M5: syncTime format (LOW) |
| Data completeness gaps | 1 | M4: totalTimeSeconds always 0 (LOW) |
| **Total mismatches** | **5** | **1 MEDIUM, 4 LOW** |

**Overall contract health: GOOD.** The mobile DTOs were clearly designed alongside the Edge Function interfaces. All field names, data types, and nested structures align correctly. The 5 identified mismatches are minor:

- Only **M3 (estimatedDuration units)** has user-visible impact, and only for the portal-created-routine-pulled-to-mobile flow.
- **M1 (lastSync type)** is a dead field with no runtime impact.
- **M2, M4, M5** are cosmetic or completeness issues with no functional failure risk.

**Pre-beta action items:**
1. **MEDIUM** -- Fix M3: Add seconds-to-minutes conversion awareness in `PortalPullAdapter` for `estimatedDuration`, or store seconds in DB.
2. **LOW** -- Fix M1: Update TypeScript `PushPayload.lastSync` type to `number | string | null`.
3. **LOW** -- Fix M2: Add `val notes: String? = null` to `PortalWorkoutSessionDto`.

**Post-beta improvements:**
4. **LOW** -- Fix M4: Compute `totalTimeSeconds` from session durations on mobile.
5. **LOW** -- Fix M5: Standardize `syncTime` format across push and pull responses.

---

## Schema Contract Analysis: Push / DB / Portal Zod Full Matrix

**Reviewed:** 2026-03-18
**Reviewer:** Backend Architect Agent (Task 3.1)
**Method:** Static analysis of all four layers: Mobile DTO interfaces (Edge Function TypeScript), Edge Function camelCase-to-snake_case mapping, SQL migrations (cumulative through 20260318), and portal Zod schemas (`src/schemas/transforms.ts`)

---

### 23. Architecture Context

The portal frontend queries Supabase **directly** via PostgREST (not via `mobile-sync-pull`). The Zod schemas in `transforms.ts` parse **snake_case** column names from direct PostgREST responses. The pull function exists for the mobile app to pull portal-created data, not for the portal itself.

This means the schema contract that matters for portal stability is:

```
mobile-sync-push (writes snake_case to DB)
    |
    v
PostgreSQL (snake_case columns, types from migrations)
    |
    v
Portal Zod schemas (parse snake_case from SELECT * responses)
```

Any mismatch between what push writes and what Zod expects to parse will surface as a runtime error in the portal frontend.

---

### 24. Contract Matrix: workout_sessions

| # | Field (Mobile DTO) | Push Mapping | DB Column | DB Type | Nullable | Zod Schema Field | Zod Type | Match? |
|---|---|---|---|---|---|---|---|---|
| 1 | `id` (string) | `id` | `id` | UUID PK | NOT NULL | `id` | `z.string().uuid()` | OK |
| 2 | `userId` (string) | hardcoded from JWT | `user_id` | UUID FK NOT NULL | NOT NULL | `user_id` | `z.string().uuid()` | OK |
| 3 | `name` (string \| null) | `s.name` | `name` | TEXT | NULL | `name` | `z.string().nullable().transform(...)` | OK |
| 4 | `startedAt` (string) | `s.startedAt` | `started_at` | TIMESTAMPTZ | NOT NULL (default now()) | `started_at` | `z.string().transform(s => new Date(s))` | OK |
| 5 | `durationSeconds` (number) | `s.durationSeconds` | `duration_seconds` | INT | NOT NULL (default 0) | `duration_seconds` | `z.number().transform(s => Math.round(s/60))` | OK -- Zod converts to minutes for display |
| 6 | `totalVolume` (number) | `s.totalVolume` | `total_volume` | NUMERIC | NOT NULL (default 0) | `total_volume` | `weightTransform` (x2 multiplier) | OK -- Zod doubles for dual-cable display |
| 7 | `setCount` (number) | `s.setCount` | `set_count` | INT | NOT NULL (default 0) | `set_count` | `z.number()` | OK |
| 8 | `exerciseCount` (number) | `s.exerciseCount` | `exercise_count` | INT | NOT NULL (default 0) | `exercise_count` | `z.number()` | OK |
| 9 | `prCount` (number) | `s.prCount` | `pr_count` | INT | NOT NULL (default 0) | `pr_count` | `z.number()` | OK |
| 10 | `routineName` (string \| null) | `s.routineName` | `routine_name` | TEXT | NULL | `routine_name` | `z.string().nullable()` | OK |
| 11 | `workoutMode` (string \| null) | `s.workoutMode` | `workout_mode` | TEXT | NULL | `workout_mode` | `workoutModeSchema` (nullable + display map) | OK |
| 12 | `routineSessionId` (string \| null) | `s.routineSessionId` | `routine_session_id` | TEXT | NULL | -- | NOT PARSED | **SCHEMA-1** |
| 13 | `notes` (string \| null) | `s.notes` | `notes` | TEXT | NULL | `notes` | `z.string().nullable().optional()` | OK |

**SCHEMA-1: `routine_session_id` not parsed by portal Zod.** Push writes it, DB stores it, but `workoutSessionSchema` omits it. Severity: LOW (informational field, not used in any current portal feature).

---

### 25. Contract Matrix: exercises

| # | Field (Mobile DTO) | Push Mapping | DB Column | DB Type | Nullable | Zod Schema Field | Zod Type | Match? |
|---|---|---|---|---|---|---|---|---|
| 1 | `id` (string) | `e.id` | `id` | UUID PK | NOT NULL | `id` | `z.string().uuid()` | OK |
| 2 | `sessionId` (string) | `e.sessionId` | `session_id` | UUID FK NOT NULL | NOT NULL | `session_id` | `z.string().uuid()` | OK |
| 3 | -- | hardcoded from JWT | `user_id` | UUID NOT NULL | NOT NULL | -- | NOT PARSED | OK (denorm) |
| 4 | `name` (string) | `e.name` | `name` | TEXT | NOT NULL | `name` | `z.string()` | OK |
| 5 | `muscleGroup` (string) | `e.muscleGroup` | `muscle_group` | TEXT | NOT NULL (default 'General') | `muscle_group` | `z.string()` | OK |
| 6 | `orderIndex` (number) | `e.orderIndex` | `order_index` | INT | NOT NULL (default 0) | `order_index` | `z.number()` | OK |

Clean match. No issues.

---

### 26. Contract Matrix: sets

| # | Field (Mobile DTO) | Push Mapping | DB Column | DB Type | Nullable | Zod Schema Field | Zod Type | Match? |
|---|---|---|---|---|---|---|---|---|
| 1 | `id` (string) | `st.id` | `id` | UUID PK | NOT NULL | `id` | `z.string().uuid()` | OK |
| 2 | `exerciseId` (string) | `st.exerciseId` | `exercise_id` | UUID FK NOT NULL | NOT NULL | `exercise_id` | `z.string().uuid()` | OK |
| 3 | -- | hardcoded from JWT | `user_id` | UUID NOT NULL | NOT NULL | -- | NOT PARSED | OK (denorm) |
| 4 | `setNumber` (number) | `st.setNumber` | `set_number` | INT | NOT NULL | `set_number` | `z.number()` | OK |
| 5 | `targetReps` (number \| null) | `st.targetReps` | `target_reps` | INT | NULL | `target_reps` | `z.number().nullable()` | OK |
| 6 | `actualReps` (number) | `st.actualReps` | `actual_reps` | INT | NOT NULL (default 0) | `actual_reps` | `z.number()` | OK |
| 7 | `weightKg` (number) | `st.weightKg` | `weight_kg` | NUMERIC | NOT NULL (default 0) | `weight_kg` | `weightTransform` (x2 multiplier) | OK |
| 8 | `rpe` (number \| null) | `st.rpe` | `rpe` | NUMERIC | NULL | `rpe` | `z.number().nullable()` | OK |
| 9 | `isPr` (boolean) | `st.isPr` | `is_pr` | BOOLEAN | NOT NULL (default false) | `is_pr` | `z.boolean()` | OK |
| 10 | `notes` (string \| null) | `st.notes` | `notes` | TEXT | NULL | `notes` | `z.string().nullable()` | OK |
| 11 | `workoutMode` (string \| null) | `st.workoutMode` | `workout_mode` | TEXT | NULL | -- | NOT PARSED | **SCHEMA-2** |

**SCHEMA-2: Per-set `workout_mode` written to DB but not parsed by portal Zod.** Added in migration `20260302130000`. Push writes it, DB stores it, but `setSchema` omits it. Severity: MEDIUM -- biomechanics analysis may need per-set mode context to interpret VBT training zones.

---

### 27. Contract Matrix: rep_summaries

| # | Field (Mobile DTO) | Push Mapping | DB Column | DB Type | Nullable | Zod Schema | Match? |
|---|---|---|---|---|---|---|---|
| 1 | `id` (string) | `r.id` | `id` | UUID PK | NOT NULL | -- | **SCHEMA-3** |
| 2 | `setId` (string) | `r.setId` | `set_id` | UUID FK NOT NULL | NOT NULL | -- | **SCHEMA-3** |
| 3 | -- | hardcoded from JWT | `user_id` | UUID NOT NULL | NOT NULL | -- | OK (denorm) |
| 4 | `repNumber` (number) | `r.repNumber` | `rep_number` | INT | NOT NULL | -- | **SCHEMA-3** |
| 5 | `meanVelocityMps` (number \| null) | `r.meanVelocityMps` | `mean_velocity_mps` | NUMERIC | NULL | -- | **SCHEMA-3** |
| 6 | `peakVelocityMps` (number \| null) | `r.peakVelocityMps` | `peak_velocity_mps` | NUMERIC | NULL | -- | **SCHEMA-3** |
| 7 | `meanForceN` (number \| null) | `r.meanForceN` | `mean_force_n` | NUMERIC | NULL | -- | **SCHEMA-3** |
| 8 | `peakForceN` (number \| null) | `r.peakForceN` | `peak_force_n` | NUMERIC | NULL | -- | **SCHEMA-3** |
| 9 | `powerWatts` (number \| null) | `r.powerWatts` | `power_watts` | NUMERIC | NULL | -- | **SCHEMA-3** |
| 10 | `romMm` (number \| null) | `r.romMm` | `rom_mm` | NUMERIC | NULL | -- | **SCHEMA-3** |
| 11 | `tutMs` (number \| null) | `r.tutMs` | `tut_ms` | INT | NULL | -- | **SCHEMA-3** |
| 12 | `leftForceAvg` (number \| null) | `r.leftForceAvg` | `left_force_avg` | NUMERIC | NULL | -- | **SCHEMA-3** |
| 13 | `rightForceAvg` (number \| null) | `r.rightForceAvg` | `right_force_avg` | NUMERIC | NULL | -- | **SCHEMA-3** |
| 14 | `asymmetryPct` (number \| null) | `r.asymmetryPct` | `asymmetry_pct` | NUMERIC | NULL | -- | **SCHEMA-3** |
| 15 | `vbtZone` (string \| null) | `r.vbtZone` | `vbt_zone` | TEXT | NULL | -- | **SCHEMA-3** |

**SCHEMA-3: `rep_summaries` has NO Zod validation schema in `transforms.ts`.** All 15 columns of VBT/biomechanics data are consumed by the portal without type-safe parsing. Null values in numeric fields will cause runtime errors in components expecting numbers. Severity: **HIGH** -- this is the richest data table in the sync pipeline and has zero type-safe parsing on the portal side.

---

### 28. Contract Matrix: routines

| # | Field (Mobile DTO) | Push Mapping | DB Column | DB Type | Nullable | Zod Schema Field | Zod Type | Match? |
|---|---|---|---|---|---|---|---|---|
| 1 | `id` (string) | `r.id` | `id` | UUID PK | NOT NULL | `id` | `z.string().uuid()` | OK |
| 2 | `userId` (string) | hardcoded from JWT | `user_id` | UUID FK NOT NULL | NOT NULL | `user_id` | `z.string().uuid()` | OK |
| 3 | `name` (string) | `r.name` | `name` | TEXT | NOT NULL | `name` | `z.string()` | OK |
| 4 | `description` (string) | `r.description` | `description` | TEXT | NOT NULL (default '') | `description` | `z.string()` | OK |
| 5 | `exerciseCount` (number) | `r.exerciseCount` | `exercise_count` | INT | NOT NULL (default 0) | `exercise_count` | `z.number()` | OK |
| 6 | `estimatedDuration` (number) | `Math.round(r.estimatedDuration / 60)` | `estimated_duration` | INT | NOT NULL (default 0) | `estimated_duration` | `z.number()` | **SCHEMA-4** |
| 7 | `timesCompleted` (number) | `r.timesCompleted` | `times_completed` | INT | NOT NULL (default 0) | `times_completed` | `z.number()` | OK |
| 8 | `isFavorite` (boolean) | `r.isFavorite` | `is_favorite` | BOOLEAN | NOT NULL (default false) | `is_favorite` | `z.boolean()` | OK |
| 9 | -- | NOT PUSHED | `last_used_at` | TIMESTAMPTZ | NULL | `last_used_at` | `z.string().nullable().transform(...)` | **SCHEMA-5** |
| 10 | -- | NOT PUSHED | `tags` | TEXT[] | NULL | `tags` | `z.array(z.string()).nullable()` | **SCHEMA-6** |

**SCHEMA-4: `estimated_duration` unit conversion is one-directional.** Push divides by 60 (seconds to minutes). Pull returns raw DB value (minutes). Portal Zod parses minutes directly -- correct for portal display. Mobile round-trip receives minutes where it expects seconds. Severity: MEDIUM for pull path; portal is unaffected.

**SCHEMA-5: `last_used_at` not pushed by mobile.** Mobile-created routines will have `last_used_at = NULL`. Portal handles null correctly. Severity: LOW.

**SCHEMA-6: `tags` not pushed by mobile.** Same pattern. Severity: LOW.

---

### 29. Contract Matrix: routine_exercises

| # | Field (Mobile DTO) | Push Mapping | DB Column | DB Type | Nullable | Zod Schema Field | Zod Type | Match? |
|---|---|---|---|---|---|---|---|---|
| 1 | `id` (string) | `e.id` | `id` | UUID PK | NOT NULL | `id` | `z.string().uuid()` | OK |
| 2 | `routineId` (string) | `e.routineId` | `routine_id` | UUID FK NOT NULL | NOT NULL | `routine_id` | `z.string().uuid()` | OK |
| 3 | `name` (string) | `e.name` | `name` | TEXT | NOT NULL | `name` | `z.string()` | OK |
| 4 | `muscleGroup` (string) | `e.muscleGroup` | `muscle_group` | TEXT | NOT NULL (default 'General') | `muscle_group` | `z.string()` | OK |
| 5 | `sets` (number) | `e.sets` | `sets` | INT | NOT NULL (default 3) | `sets` | `z.number()` | OK |
| 6 | `reps` (number) | `e.reps` | `reps` | INT | NOT NULL (default 10) | `reps` | `z.number()` | OK |
| 7 | `weight` (number) | `e.weight` | `weight` | NUMERIC | NOT NULL (default 0) | `weight` | `z.number()` | OK |
| 8 | `restSeconds` (number) | `e.restSeconds` | `rest_seconds` | INT | NOT NULL (default 90) | `rest_seconds` | `z.number()` | OK |
| 9 | `mode` (string) | `e.mode` | `mode` | TEXT | NOT NULL (default 'OLD_SCHOOL') | `mode` | `z.string()` | OK |
| 10 | `orderIndex` (number) | `e.orderIndex` | `order_index` | INT | NOT NULL (default 0) | `order_index` | `z.number()` | OK |
| 11 | `supersetId` (string \| null) | `e.supersetId` | `superset_id` | TEXT | NULL | `superset_id` | `z.string().nullable().optional()` | OK |
| 12 | `supersetColor` (string \| null) | `e.supersetColor` | `superset_color` | TEXT | NULL | `superset_color` | `z.string().nullable().optional()` | OK |
| 13 | `supersetOrder` (number \| null) | `e.supersetOrder` | `superset_order` | INT | NULL | `superset_order` | `z.number().nullable().optional()` | OK |
| 14 | `perSetWeights` (string \| null) | `safeJsonParse(e.perSetWeights)` | `per_set_weights` | JSONB | NULL | `per_set_weights` | `z.any().nullable().optional()` | **SCHEMA-7** |
| 15 | `perSetRest` (string \| null) | `safeJsonParse(e.perSetRest)` | `per_set_rest` | JSONB | NULL | `per_set_rest` | `z.any().nullable().optional()` | **SCHEMA-7** |
| 16 | `isAmrap` (boolean) | `e.isAmrap` | `is_amrap` | BOOLEAN | NULL (default false) | `is_amrap` | `z.boolean().optional().default(false)` | OK |
| 17 | `prPercentage` (number \| null) | `e.prPercentage` | `pr_percentage` | NUMERIC | NULL | `pr_percentage` | `z.number().nullable().optional()` | OK |
| 18 | `repCountTiming` (string \| null) | `e.repCountTiming` | `rep_count_timing` | TEXT | NULL | `rep_count_timing` | `z.string().nullable().optional()` | OK |
| 19 | `stopAtPosition` (string \| null) | `e.stopAtPosition` | `stop_at_position` | TEXT | NULL | `stop_at_position` | `z.string().nullable().optional()` | OK |
| 20 | `stallDetection` (boolean) | `e.stallDetection` | `stall_detection` | BOOLEAN | NULL (default true) | `stall_detection` | `z.boolean().optional().default(false)` | **SCHEMA-8** |
| 21 | `eccentricLoad` (string \| null) | `e.eccentricLoad` | `eccentric_load` | TEXT | NULL | `eccentric_load` | `z.string().nullable().optional()` | OK |
| 22 | `echoLevel` (string \| null) | `e.echoLevel` | `echo_level` | TEXT | NULL | `echo_level` | `z.string().nullable().optional()` | OK |
| 23 | -- | NOT PUSHED | `created_at` | TIMESTAMPTZ | NOT NULL (default now()) | `created_at` | `z.string().transform(...)` | OK (DB default) |
| 24 | -- | NOT PUSHED | `is_bodyweight` | BOOLEAN | NOT NULL (default false) | `is_bodyweight` | `z.boolean().optional().default(false)` | **SCHEMA-9** |
| 25 | -- | NOT PUSHED | `duration_seconds` | INT | NULL | `duration_seconds` | `z.number().nullable().optional()` | **SCHEMA-9** |

**SCHEMA-7: `per_set_weights` / `per_set_rest` use `z.any()`.** No structural validation. Mobile sends JSON string, push parses to JSONB, portal accepts anything. Silent data loss if malformed. Severity: LOW-MEDIUM.

**SCHEMA-8: `stall_detection` default contradiction.** DB default is `true` (migration `20260302130000`), Zod default is `false`. For NULL rows, portal shows `false` while DB intent was `true`. Severity: LOW.

**SCHEMA-9: `is_bodyweight` / `duration_seconds` not pushed by mobile.** Portal-only routine builder fields. Mobile ignores unknown fields on pull. Severity: LOW.

---

### 30. Contract Matrix: training_cycles

| # | Field (Mobile DTO) | Push Mapping | DB Column | DB Type | Nullable | Zod Schema Field | Zod Type | Match? |
|---|---|---|---|---|---|---|---|---|
| 1 | `id` (string) | `c.id` | `id` | UUID PK | NOT NULL | `id` | `z.string().uuid()` | OK |
| 2 | `userId` (string) | hardcoded from JWT | `user_id` | UUID FK NOT NULL | NOT NULL | `user_id` | `z.string().uuid()` | OK |
| 3 | `name` (string) | `c.name` | `name` | TEXT | NOT NULL | `name` | `z.string()` | OK |
| 4 | `description` (string \| null) | `c.description ?? ''` | `description` | TEXT | NULL | `description` | `z.string().nullable().optional()` | **SCHEMA-10** |
| 5 | `durationWeeks` (number) | `c.durationWeeks` | `duration_weeks` | INT | NOT NULL (default 4) | `duration_weeks` | `z.number()` | OK |
| 6 | `workoutDays` (number) | `c.workoutDays` | `workout_days` | INT | NOT NULL (default 0) | `workout_days` | `z.number()` | OK |
| 7 | `restDays` (number) | `c.restDays` | `rest_days` | INT | NOT NULL (default 0) | `rest_days` | `z.number()` | OK |
| 8 | `currentWeek` (number) | `c.currentWeek` | `current_week` | INT | NOT NULL (default 1) | `current_week` | `z.number()` | OK |
| 9 | `status` (string) | `c.status` | `status` | TEXT | NOT NULL (default 'draft') | `status` | `z.enum(["active", "completed", "draft"])` | **SCHEMA-11** |
| 10 | `startedAt` (string \| null) | `c.startedAt` | `started_at` | TIMESTAMPTZ | NULL | `started_at` | `z.string().nullable().optional().transform(...)` | OK |
| 11 | `lastUsedAt` (string \| null) | `c.lastUsedAt` | `last_used_at` | TIMESTAMPTZ | NULL | `last_used_at` | `z.string().nullable().transform(...)` | OK |
| 12 | `progressionSettings` (string \| null) | `safeJsonParse(c.progressionSettings)` | `progression_settings` | JSONB | NULL | (in cycleDetailSchema) | `z.any().nullable().optional()` | OK |
| 13 | `deloadSettings` (string \| null) | `safeJsonParse(c.deloadSettings)` | `deload_settings` | JSONB | NULL | (in cycleDetailSchema) | `z.any().nullable().optional()` | OK |

**SCHEMA-10: Push coerces null description to empty string.** `c.description ?? ''` writes `''` to a nullable column instead of `NULL`. Severity: TRIVIAL.

**SCHEMA-11: `status` enum is too restrictive in Zod.** DB has `TEXT NOT NULL DEFAULT 'draft'` with NO CHECK constraint. Mobile can send any string. Zod uses `z.enum(["active", "completed", "draft"])`. A new mobile status value (e.g., `"paused"`) **will crash Zod parsing and break the portal's cycle views**. Severity: **HIGH** -- no DB migration or portal deployment is needed for mobile to trigger this failure.

---

### 31. Contract Matrix: cycle_days

All 10 fields match exactly between push, DB, and Zod. Clean contract. No issues.

---

### 32. Contract Matrix: rpg_attributes

All 11 fields (including `id`, `user_id`, `updated_at`) match correctly between push, DB, and Zod. Clean contract. No issues.

---

### 33. Contract Matrix: earned_badges

| # | Field | DB Column | DB Type | Nullable | Zod Type | Match? |
|---|---|---|---|---|---|---|
| 1-5 | (standard fields) | -- | -- | -- | -- | OK |
| 6 | `badgeTier` | `badge_tier` | TEXT | NULL (default 'bronze') | `z.string()` | **SCHEMA-12** |
| 7 | `earnedAt` | `earned_at` | TIMESTAMPTZ | NOT NULL | `z.string().transform(...)` | OK |

**SCHEMA-12: `badge_tier` nullable in DB but required in Zod.** `TEXT DEFAULT 'bronze'` has no NOT NULL constraint. If `badge_tier = NULL`, Zod throws. Severity: LOW -- DB default protects in practice.

---

### 34. Contract Matrix: gamification_stats

All 9 fields match correctly. Clean contract. No issues.

---

### 35. Contract Matrix: personal_records (extracted server-side from is_pr sets)

| # | Source | DB Column | DB Type | Nullable | Zod Schema Field | Zod Type | Match? |
|---|---|---|---|---|---|---|---|
| 1-8 | (standard fields) | -- | -- | -- | -- | OK |
| 9 | NOT SET by push | `previous_value` | NUMERIC | NULL | `previous_value` | `z.number().nullable().transform(v => v !== null ? v*2 : null)` | **SCHEMA-13** |

**SCHEMA-13: `previous_value` is never populated by push.** The push function extracts PRs but never queries the previous max to set `previous_value`. It is always NULL for mobile-synced PRs. The portal Zod defines a x2 transform on it, suggesting the UI expects to display "Previous: Xkg". Severity: MEDIUM -- incomplete PR history.

---

### 36. Consolidated Findings

#### Critical -- Potential Runtime Crashes

| ID | Finding | Severity |
|---|---|---|
| **SCHEMA-3** | `rep_summaries` has NO Zod schema. All 15 VBT/biomechanics columns consumed without type-safe parsing. Null numerics will crash components. | **HIGH** |
| **SCHEMA-11** | `training_cycles.status` Zod enum is `["active", "completed", "draft"]` but DB has no CHECK constraint. Any new mobile status value crashes portal. | **HIGH** |

#### Moderate -- Data Loss or Incorrect Display

| ID | Finding | Severity |
|---|---|---|
| **SCHEMA-2** | Per-set `workout_mode` in DB but not in `setSchema`. Biomechanics cannot determine per-set mode. | MEDIUM |
| **SCHEMA-4** | `estimated_duration` seconds-to-minutes conversion not reversed on pull. Mobile round-trip corruption. | MEDIUM |
| **SCHEMA-13** | `previous_value` on personal_records never populated by push. PR history always shows NULL. | MEDIUM |

#### Low -- Cosmetic or Defensive Gaps

| ID | Finding | Severity |
|---|---|---|
| SCHEMA-1 | `routine_session_id` not in portal Zod. | LOW |
| SCHEMA-5 | `last_used_at` not pushed by mobile. | LOW |
| SCHEMA-6 | `tags` not pushed by mobile. | LOW |
| SCHEMA-7 | `per_set_weights`/`per_set_rest` use `z.any()`. | LOW |
| SCHEMA-8 | `stall_detection` DB default `true`, Zod default `false`. | LOW |
| SCHEMA-9 | `is_bodyweight`/`duration_seconds` portal-only. | LOW |
| SCHEMA-10 | Push coerces null description to `''`. | TRIVIAL |
| SCHEMA-12 | `badge_tier` nullable in DB but required in Zod. | LOW |

---

### 37. Remediation Priorities

#### Before Beta Launch

1. **Add `repSummarySchema` to `transforms.ts`.** Define Zod schema for all 15 rep_summaries columns with proper `z.number().nullable()` on every NUMERIC/INT metric field. Apply wherever biomechanics data is consumed.

2. **Change `trainingCycleSchema.status` to accept unknown values.** Replace `z.enum([...])` with `z.string()` or use `z.enum([...]).catch("draft")` to fall back gracefully. Map unknown statuses to a default display string in the UI.

#### Before GA

3. **Add `workout_mode` to `setSchema`** as `z.string().nullable().optional()`. Biomechanics analysis needs per-set mode context.

4. **Populate `previous_value` in push PR extraction.** Before inserting a new PR, query the existing max `value` for that user/exercise/record_type and set it as `previous_value`.

5. **Document `estimated_duration` unit convention.** Choose one: (a) store seconds everywhere, or (b) document that DB stores minutes and update pull to multiply by 60.

#### Post-GA Hardening

6. Replace `z.any()` on `per_set_weights`/`per_set_rest` with structured validation.
7. Align `stall_detection` Zod default with DB default.
8. Make `badge_tier` Zod nullable to match DB definition.
9. Add `workout_sessions.updated_at` column for proper pull delta sync.

---

## Data Integrity

**Reviewed:** 2026-03-18
**Reviewer:** Backend Architect Agent (Task 3.7)
**Branch:** beta-readiness-review

---

### FK Hierarchy: workout_sessions -> exercises -> sets -> rep_summaries

The complete foreign key chain is defined in `supabase/migrations/00002_base_schema.sql` (lines 94-217).

| Parent Table       | Child Table      | FK Column    | ON DELETE | Defined In                  |
|--------------------|------------------|--------------|-----------|-----------------------------|
| `auth.users`       | `workout_sessions` | `user_id`  | CASCADE   | 00002_base_schema.sql:96    |
| `workout_sessions` | `exercises`      | `session_id` | CASCADE   | 00002_base_schema.sql:123   |
| `exercises`        | `sets`           | `exercise_id`| CASCADE   | 00002_base_schema.sql:142   |
| `sets`             | `rep_summaries`  | `set_id`     | CASCADE   | 00002_base_schema.sql:191   |
| `sets`             | `rep_telemetry`  | `set_id`     | CASCADE   | 00002_base_schema.sql:224   |

**Verdict: PASS** -- All FKs use `ON DELETE CASCADE`. Deleting a workout_session cascades through exercises, sets, rep_summaries, and rep_telemetry. Deleting a user cascades through workout_sessions and then the full tree. No orphan accumulation risk from deletes.

### Denormalized user_id Columns (RLS Performance)

Migration `20260228_rls_denormalization.sql` added `user_id` directly to child tables to eliminate multi-hop RLS JOIN penalties:

| Table            | user_id Added     | Has FK to auth.users? | ON DELETE |
|------------------|-------------------|-----------------------|-----------|
| `exercises`      | 20260304 migration | No (bare UUID)        | N/A       |
| `sets`           | 20260228 migration | Yes                   | CASCADE   |
| `rep_summaries`  | 20260228 migration | Yes                   | CASCADE   |
| `rep_telemetry`  | 20260228 migration | Yes                   | CASCADE   |

**Finding [DI-01, LOW]: `exercises.user_id` has no FK constraint.** The `20260304_exercises_denorm_insert_rls.sql` migration (line 42) adds `user_id UUID` without `REFERENCES auth.users(id)`. Comment on lines 38-39 says this was intentional ("No FK to auth.users -- consistent with sets, rep_summaries, and rep_telemetry which also use denormalized user_id without FK"). However, this comment is factually incorrect: `sets.user_id`, `rep_summaries.user_id`, and `rep_telemetry.user_id` all DO have FK constraints to `auth.users(id) ON DELETE CASCADE` (see `20260228_rls_denormalization.sql` lines 44, 74, 107). Only `exercises.user_id` is missing the FK. This is a documentation/consistency bug, not a data integrity risk (the structural FK via `exercises.session_id -> workout_sessions` still cascades correctly on user deletion), but it should be fixed for consistency.

### Unique Constraints (Idempotent Upsert Safety)

| Table              | PK / Unique Constraint                          | Upsert Safe? |
|--------------------|------------------------------------------------|-------------|
| `workout_sessions` | `id UUID PRIMARY KEY`                          | Yes -- `onConflict: 'id'` |
| `exercises`        | `id UUID PRIMARY KEY`                          | Yes -- `onConflict: 'id'` |
| `sets`             | `id UUID PRIMARY KEY`                          | Yes -- `onConflict: 'id'` |
| `rep_summaries`    | `id UUID PRIMARY KEY`                          | Yes -- `onConflict: 'id'` |
| `routines`         | `id UUID PRIMARY KEY`                          | Yes -- `onConflict: 'id'` |
| `training_cycles`  | `id UUID PRIMARY KEY`                          | Yes -- `onConflict: 'id'` |
| `rpg_attributes`   | `UNIQUE(user_id)` + UUID PK                   | Yes -- `onConflict: 'user_id'` |
| `earned_badges`    | `UNIQUE(user_id, badge_id)` + UUID PK          | Yes -- `onConflict: 'user_id,badge_id'` |
| `gamification_stats`| `UNIQUE(user_id)` + UUID PK                  | Yes -- `onConflict: 'user_id'` |

**Verdict: PASS** -- All tables have UUID primary keys. The mobile-sync-push function uses `upsert(..., { onConflict: 'id' })` for the workout hierarchy, meaning duplicate session pushes (retries) safely update rather than fail with a constraint violation.

### mobile-sync-push Insert Order Analysis

Source: `supabase/functions/mobile-sync-push/index.ts`, lines 308-410.

**Insert sequence (Section 4 of the function):**

1. **Step 4a (line 326):** Upsert `workout_sessions` -- parents first
2. **Step 4b (line 345):** Upsert `exercises` -- references session_id FK
3. **Step 4c (line 371):** Upsert `sets` -- references exercise_id FK
4. **Step 4d (line 404):** Upsert `rep_summaries` -- references set_id FK

**Verdict: PASS** -- Inserts are strictly ordered parent-first. Each `await` completes before the next level begins. No parallel insertions that could cause FK violations. If step 4a fails (exception thrown), steps 4b-4d are never reached (catch block at line 763 returns error response).

### Orphan Prevention Analysis

**Can orphaned records be created?**

| Scenario | Risk | Assessment |
|----------|------|------------|
| Child inserted before parent | None | Sequential awaits enforce parent-first order |
| Parent upsert succeeds, child upsert fails | **Partial data** | Sessions exist but exercises/sets/rep_summaries may be missing. See DI-02. |
| Concurrent pushes for same session | None | `upsert` with `onConflict: 'id'` is idempotent -- last write wins |
| Mobile sends child ID referencing nonexistent parent ID | FK violation (400 error) | Supabase returns error, caught by catch block |

**Finding [DI-02, MEDIUM]: No transaction wrapping for the workout hierarchy upserts.** Steps 4a through 4d are four separate Supabase client calls (lines 326-409). If step 4b (`exercises`) succeeds but step 4c (`sets`) fails, the function throws and returns a 400/500 error. The already-inserted sessions and exercises remain in the database. On retry, the mobile app would re-send the full payload and the upserts would succeed (idempotent), so this is self-healing. However, if the mobile app does NOT retry (e.g., user kills the app), stale partial data persists. This is not an orphan in the FK sense (exercises still reference valid sessions), but it is incomplete data. A Supabase RPC wrapping all four inserts in a single `BEGIN...COMMIT` would make this atomic.

**Finding [DI-03, LOW]: No transaction wrapping for routine delete-then-reinsert.** Section 7 (lines 557-596) deletes existing `routine_exercises`, then reinserts. If the delete succeeds but the insert fails, the routine has zero exercises until the next sync. Same self-healing pattern applies on retry.

---

## Sync Queue Analysis

**Reviewed:** 2026-03-18
**Reviewer:** Backend Architect Agent (Task 3.8)
**Branch:** beta-readiness-review

Source: `supabase/functions/process-sync-queue/index.ts` (204 lines)

---

### Rate Limits per Provider

Defined on lines 12-17:

| Provider | Configured Limit | Window    | Official API Limit       | Reserve | Assessment |
|----------|-----------------|-----------|--------------------------|---------|------------|
| Strava   | 80 req          | 15 min    | 100 req / 15 min (read)  | 20%     | **PASS** -- 20% headroom is appropriate |
| Fitbit   | 120 req         | 60 min    | 150 req / hour           | 20%     | **PASS** -- 20% headroom |
| Garmin   | 40 req          | 60 min    | Push-based (webhook)     | N/A     | See SQ-01 |
| Hevy     | 40 req          | 60 min    | 100 req / min (per docs) | N/A     | **PASS** -- very conservative |

**Finding [SQ-01, INFO]: Garmin rate limit is defined but Garmin sync is webhook-only.** Line 124-129 of `callSyncFunction()` explicitly throws a 400 error for `provider === 'garmin'` with message "Garmin sync is webhook-driven and cannot be queued manually." The rate limit entry for Garmin on line 16 is dead code. Not harmful, but misleading.

**Finding [SQ-02, INFO]: Strava also has a daily limit of 1,000 requests/day.** The 15-minute window check alone does not account for the daily cap. At 80 requests per 15-minute window, processing continuously could hit 7,680 requests/day, which far exceeds the 1,000/day limit. In practice the cron runs every 5 minutes and processes max 10 tasks per invocation, so theoretical max is ~2,880/day. This only matters at scale, but a daily counter should be considered.

### Exponential Backoff

Defined on lines 78-86 using the `exponential-backoff` npm package (v3.1.1):

```
numOfAttempts: 3
startingDelay: 1000ms (1 second)
timeMultiple: 2
retry condition: only on HTTP 429 (rate limit)
```

**Retry delays:** 1s, 2s, 4s (geometric progression, 3 attempts total, ~7s wall time worst case)

**Verdict: PASS with caveat** -- Backoff only triggers on 429 status. Other transient failures (502, 503, 504) are NOT retried and immediately mark the task as `failed`. This is overly aggressive for gateway timeouts which are typically transient.

**Finding [SQ-03, MEDIUM]: Non-429 transient errors should be retried.** The `retry` predicate on line 84 only matches `e.status === 429`. A 502/503/504 from the upstream sync function (Strava/Fitbit API returning gateway errors) will immediately fail the task permanently. Recommended fix:
```ts
retry: (e: Error & { status?: number }) =>
  e.status === 429 || e.status === 502 || e.status === 503 || e.status === 504
```

### Max Retry Limit

**Finding [SQ-04, HIGH]: No maximum retry limit. Failed 429 tasks re-queue indefinitely.**

When all 3 `backOff` attempts fail with 429, the catch block (lines 100-109) executes:
- If the final error is still a 429, the task status is set back to `'pending'` (line 105)
- `retry_count` is incremented (line 107)
- The task will be picked up again on the next cron invocation

There is **no check against `retry_count`** before re-queuing. A perpetually rate-limited provider will have its tasks bounce between `pending` and `processing` forever. The `retry_count` column (defined in `20260216_integrations.sql` line 58) is incremented but never compared to a threshold.

**Recommendation:** Add a max retry check before re-queuing:
```ts
const MAX_RETRIES = 10;
const newRetryCount = (task.retry_count ?? 0) + 1;

await supabase
  .from('sync_queue')
  .update({
    status: err.status === 429 && newRetryCount < MAX_RETRIES ? 'pending' : 'failed',
    error_message: newRetryCount >= MAX_RETRIES
      ? `Max retries (${MAX_RETRIES}) exceeded: ${err.message}`
      : err.message,
    retry_count: newRetryCount,
  })
  .eq('id', task.id);
```

### Queue Starvation

**Finding [SQ-05, HIGH]: Single-provider failures CAN block other providers.**

The queue processor (lines 31-37) fetches tasks with:
```ts
.eq('status', 'pending')
.order('created_at', { ascending: true })
.limit(10)
```

This is a single FIFO queue across ALL providers. If 10 Strava tasks are pending (all failing with rate limits), the processor fetches those 10 tasks, processes them sequentially, and each one is either:
- Skipped (if `isRateLimited()` returns true) -- increments `results.skipped`
- Re-queued as `pending` (if 429 after backoff exhaustion)

Because skipped tasks remain `pending` and keep their original `created_at`, they will be picked up again on the next invocation before any newer Fitbit tasks. This creates a starvation pattern:

1. 10 Strava tasks sit at the head of the queue (oldest `created_at`)
2. Each invocation fetches the same 10 Strava tasks
3. All 10 are skipped (rate limited) or fail-and-requeue
4. Fitbit/Hevy tasks with later `created_at` never get processed

**Recommendation:** Query per-provider or exclude rate-limited providers:
```ts
// Option A: Fetch per provider (no starvation)
const providers = ['strava', 'fitbit', 'hevy'];
for (const provider of providers) {
  const limit = RATE_LIMITS[provider];
  if (limit && isRateLimited(rateTracking[provider], limit)) continue;

  const { data: tasks } = await supabase
    .from('sync_queue')
    .select('*')
    .eq('status', 'pending')
    .eq('provider', provider)
    .order('created_at', { ascending: true })
    .limit(3); // 3 per provider, 9 total
  // process tasks...
}

// Option B: Pre-filter rate-limited providers from the query
const rateLimitedProviders = [...]; // pre-check which are limited
const { data: tasks } = await supabase
  .from('sync_queue')
  .select('*')
  .eq('status', 'pending')
  .not('provider', 'in', `(${rateLimitedProviders.join(',')})`)
  .order('created_at', { ascending: true })
  .limit(10);
```

### Scheduled Invocation

The function header comment (line 8) states: "Called by Supabase cron or external scheduler every 5 minutes."

**Finding [SQ-06, MEDIUM]: No cron configuration found in the codebase.** There is no `pg_cron` setup in any migration file, no schedule configuration in `supabase/config.toml`, and no external scheduler configuration (e.g., GitHub Actions cron, CloudWatch Events). The function is callable via HTTP POST, but nothing in the repository actually triggers it on a schedule.

This likely means the cron is configured directly in the Supabase dashboard (pg_cron extension), which is not tracked in version control. This is a deployment risk: restoring from migrations alone would not restore the cron schedule.

**Recommendation:** Add the cron schedule as a migration:
```sql
-- Requires pg_cron and pg_net extensions (enabled in Supabase by default)
SELECT cron.schedule(
  'process-sync-queue',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url := current_setting('app.settings.supabase_url') || '/functions/v1/process-sync-queue',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')
    )
  );
  $$
);
```

### Additional Observations

**Rate limit tracking is global, not per-user.** The `rate_limit_tracking` table (from `20260216_integrations.sql`) stores one row per provider for API-level limits. This is correct -- Strava/Fitbit rate limits are per-application, not per-user. However, heavy usage from one user consumes the shared budget and can delay syncs for all users. At current scale this is acceptable; at scale, per-user queuing priority may be needed.

**Garmin queue entries would fail immediately.** If a Garmin sync task somehow enters the queue (e.g., manual DB insert, bug in queue insertion logic), `callSyncFunction` throws a 400 error on line 127-129. Since 400 is not 429, the task is marked `failed` immediately (line 105 condition is false). This is correct but should be prevented at insertion time with a CHECK constraint:
```sql
ALTER TABLE sync_queue ADD CONSTRAINT sync_queue_provider_check
  CHECK (provider IN ('strava', 'fitbit', 'hevy'));
```

**Subscription gate is checked per-task.** Line 62 calls `requireSubscription(supabase, task.user_id, 'FLAME', cors)` for each task. If a user's subscription lapses between queue insertion and processing, the task fails with a subscription error. This is correct behavior -- tasks should not execute for users who no longer have the required tier.

---

## Consolidated Findings (Tasks 3.7 + 3.8)

| ID | Severity | Component | Finding |
|----|----------|-----------|---------|
| DI-01 | LOW | exercises.user_id | Missing FK constraint to auth.users -- inconsistent with sets/rep_summaries/rep_telemetry denorm pattern |
| DI-02 | MEDIUM | mobile-sync-push | No transaction wrapping for workout hierarchy upserts (4a-4d). Partial inserts self-heal on retry but persist if retry never happens |
| DI-03 | LOW | mobile-sync-push | No transaction wrapping for routine_exercises delete-then-reinsert |
| SQ-01 | INFO | process-sync-queue | Garmin rate limit definition is dead code (Garmin is webhook-driven) |
| SQ-02 | INFO | process-sync-queue | Strava daily limit (1,000 req/day) not tracked; only 15-min window is enforced |
| SQ-03 | MEDIUM | process-sync-queue | Non-429 transient errors (502/503/504) are not retried -- they permanently fail the task |
| SQ-04 | HIGH | process-sync-queue | No max retry limit -- 429-failed tasks re-queue as pending indefinitely |
| SQ-05 | HIGH | process-sync-queue | Queue starvation -- one provider's rate-limited tasks block all other providers |
| SQ-06 | MEDIUM | process-sync-queue | Cron schedule not tracked in version control (dashboard-only configuration) |

### Recommended Priority for Beta

1. **SQ-04** (max retry limit) and **SQ-05** (queue starvation) -- HIGH severity, fix before beta launch to prevent operational issues under real-world load
2. **SQ-03** (transient error retry) and **DI-02** (transaction wrapping) -- MEDIUM severity, fix before GA to improve reliability
3. **SQ-06** (cron in VCS) -- MEDIUM severity, operational/DR risk; should be codified before production
4. **DI-01**, **DI-03**, **SQ-01**, **SQ-02** -- LOW/INFO severity, address during hardening phase

---
---

## Push/Pull Logic Analysis

**Auditor:** Backend Architect Agent (Tasks 3.3 + 3.4)
**Date:** 2026-03-18
**Branch:** beta-readiness-review

---

### Task 3.3: mobile-sync-push Stress Analysis

**File:** `supabase/functions/mobile-sync-push/index.ts` (775 lines)

#### 3.3.1 Payload Size Handling

**Rating: FAIL -- Large first-sync will exceed Edge Function timeout**

The 5MB payload limit (enforced at the gateway/proxy layer) caps the wire size, but does not address the execution-time cost of processing hundreds of sessions. The function performs a large number of sequential, non-transactional database operations that scale linearly with payload depth.

**DB operations per session (worst case):**

For a single session with E exercises, each having S sets with R reps per set:

| Step | Operation | Row count | Supabase API call |
|------|-----------|-----------|-------------------|
| 4a | Upsert `workout_sessions` | 1 per session | 1 call (batched across all sessions) |
| 4b | Upsert `exercises` | E | 1 call (batched across all sessions) |
| 4c | Upsert `sets` | E x S | 1 call (batched across all sessions) |
| 4d | Upsert `rep_summaries` | E x S x R | 1 call (batched across all sessions) |
| 5 | SELECT existing `exercise_progress` | -- | 1 call |
| 5 | INSERT `exercise_progress` | E per session | 1 call |
| 6 | SELECT existing `personal_records` | -- | 1 call |
| 6 | INSERT `personal_records` | variable | 1 call |
| 7 | Upsert `routines` | per routine | 1 call |
| 7 | DELETE `routine_exercises` | per routine | 1 call |
| 7 | INSERT `routine_exercises` | per routine | 1 call |
| 7b | Upsert `training_cycles` | per cycle | 1 call |
| 7b | DELETE `cycle_days` | per cycle | 1 call |
| 7b | INSERT `cycle_days` | per cycle | 1 call |
| 8 | Upsert `rpg_attributes` | 1 | 1 call |
| 9 | Upsert `earned_badges` | N badges | 1 call |
| 10 | Upsert `gamification_stats` | 1 | 1 call |
| 11 | Broadcast `sync_complete` | -- | 1 call |

**Minimum sequential API calls for sessions-only push:** 8 (steps 4a through 6, two SELECTs + two INSERTs)
**Full push with routines, cycles, gamification:** 18+ sequential Supabase REST API calls

**Concrete first-sync scenario:**

A user with 200 sessions, averaging 5 exercises per session, 3 sets per exercise, 8 reps per set:

| Table | Row count |
|-------|-----------|
| `workout_sessions` | 200 |
| `exercises` | 1,000 |
| `sets` | 3,000 |
| `rep_summaries` | 24,000 |
| `exercise_progress` | 1,000 |
| `personal_records` | variable (~100-500) |

That is approximately 29,000+ rows upserted/inserted across 8+ sequential PostgREST API calls. Each call incurs:
- HTTP overhead to the Supabase REST API (~10-50ms per call)
- PostgreSQL execution time scaling with row count
- The `rep_summaries` upsert alone (24,000 rows in one PostgREST call) may hit PostgREST's internal body size limit or cause significant execution time

**Estimated execution time for this scenario:** 5-15 seconds depending on Supabase instance tier, likely **exceeding the 10-second Supabase Edge Function timeout** for users with heavy training history.

**Positive design note:** The code batches all sessions' children into single API calls (e.g., all 1,000 exercises go in one `.upsert()` call rather than one call per session). This is good -- it would be far worse without batching. The problem is purely the aggregate volume in a first-sync scenario.

#### 3.3.2 Transaction Wrapping

**Rating: FAIL -- No transaction wrapping; partial writes guaranteed on timeout**

The function uses the Supabase JS client `.upsert()` and `.insert()` methods, each executing as an individual PostgREST API call. There is **no transaction wrapping** around the full operation sequence. Each step is an independent database operation.

**Consequence of timeout mid-write:**

If the Edge Function times out after step 4b (exercises) but before step 4c (sets):
- Sessions: **committed** (present)
- Exercises: **committed** (present)
- Sets: **missing**
- Rep summaries: **missing**
- Exercise progress: **missing**
- Personal records: **missing**

This leaves the database in an inconsistent state where sessions and exercises exist but their child data does not.

Each `.upsert()` call is its own transaction at the PostgreSQL level, but there is no cross-call transaction envelope. Supabase Edge Functions do not support long-lived database transactions via the JS client -- this is an inherent architectural limitation.

**Mitigating factor:** Because all core tables use `upsert` with `onConflict: 'id'`, a retry of the full push fills in the missing data. The inconsistency is temporary as long as the client retries. But if the client treats the timeout as a permanent failure and never retries, the data remains incomplete.

#### 3.3.3 Pagination / Batching Strategy

**Rating: FAIL -- No pagination; all-or-nothing design**

The current implementation expects the mobile client to send ALL dirty data in a single push request. There is no:
- Maximum session count per push
- Cursor-based pagination
- Batch ID for multi-part pushes
- Continuation token for interrupted pushes

**Recommended strategy:**

```
Option A: Client-side chunking (preferred -- no backend changes needed)
---
Mobile client batches pushes:
  - Max 50 sessions per push request
  - Client tracks which sessions have been synced via the syncTime response
  - Each push is independent and idempotent (upsert semantics)
  - First sync of 200 sessions = 4 sequential push calls
  - Routines, cycles, badges, rpg, gamification sent with the LAST batch

Option B: Server-side pagination (requires API contract change)
---
  POST /mobile-sync-push
  Body: { ...payload, batchId: "uuid", batchIndex: 0, totalBatches: 4 }
  Server tracks batch completion in a sync_batches table.
```

**Recommendation: Option A.** It requires no server API changes and leverages existing upsert idempotency. The rate limit of 10 requests/minute supports this (200-session first-sync = 4 calls, well within limit).

#### 3.3.4 Partial Write Recovery / Retry Safety

**Rating: PASS (with caveats) -- Core data retry-safe; derived tables not fully idempotent**

**Retry-safe tables (upsert with `onConflict`):**

| Table | Conflict target | Retry safe? |
|-------|----------------|-------------|
| `workout_sessions` | `onConflict: 'id'` | YES -- same UUID re-upserts cleanly |
| `exercises` | `onConflict: 'id'` | YES |
| `sets` | `onConflict: 'id'` | YES |
| `rep_summaries` | `onConflict: 'id'` | YES |
| `routines` | `onConflict: 'id'` | YES |
| `training_cycles` | `onConflict: 'id'` | YES |
| `earned_badges` | `onConflict: 'user_id,badge_id'` | YES |
| `rpg_attributes` | `onConflict: 'user_id'` | YES |
| `gamification_stats` | `onConflict: 'user_id'` | YES |

**NOT fully retry-safe operations:**

| Table / Operation | Issue |
|-------------------|-------|
| `exercise_progress` INSERT (lines 452-478) | Uses `INSERT` not upsert. Dedup queries existing rows by `session_id + exercise_name` -- safe for retries of the same payload. But the SELECT-then-INSERT is NOT atomic: concurrent pushes with the same sessions could produce duplicates. The table has **no unique constraint** on `(session_id, exercise_name)`. |
| `personal_records` INSERT (lines 504-531) | Same SELECT-then-INSERT dedup pattern. Dedup key `exercise_name:achieved_at:value:record_type` could miss duplicates with slightly different timestamp formatting. **No unique constraint** at DB level. |
| `routine_exercises` DELETE-then-INSERT (lines 557-596) | Retry-safe (delete runs first). But if function times out BETWEEN the delete and insert, routine exists with **zero exercises**. |
| `cycle_days` DELETE-then-INSERT (lines 628-653) | Same pattern and risk as routine_exercises. |

**Critical finding -- routine_exercises and cycle_days data loss window:**

```
Line 558: DELETE FROM routine_exercises WHERE routine_id IN (...)  -- committed
Line 591: INSERT INTO routine_exercises (...)                       -- separate call
```

If the INSERT fails or function times out between these calls, the routine exists but has zero exercises until the next successful sync. This is silent data corruption visible as empty routines on the portal.

**Severity:** MEDIUM. The time window is small but real under load.

**Recommended fixes:**

1. **routine_exercises / cycle_days:** Create PostgreSQL functions wrapping delete + insert in a single transaction. Call via `supabase.rpc()`.

2. **exercise_progress:** Add `UNIQUE(session_id, exercise_name)` constraint; convert to upsert.

3. **personal_records:** Add `UNIQUE(user_id, exercise_name, record_type, achieved_at)` constraint; convert to upsert.

#### 3.3.5 Push Findings Summary

| Finding | Severity | Status |
|---------|----------|--------|
| Large first-sync (200+ sessions) exceeds 10s Edge Function timeout | HIGH | FAIL |
| No transaction wrapping -- partial writes on timeout | HIGH | FAIL |
| No pagination/chunking -- all-or-nothing payload | MEDIUM | FAIL |
| Core workout data retry-safe (upsert on UUID PK) | -- | PASS |
| `exercise_progress` SELECT-then-INSERT race condition | LOW | ADVISORY |
| `personal_records` SELECT-then-INSERT race condition | LOW | ADVISORY |
| `routine_exercises` delete-then-insert non-atomic data loss window | MEDIUM | FAIL |
| `cycle_days` delete-then-insert non-atomic data loss window | MEDIUM | FAIL |

---

### Task 3.4: mobile-sync-pull Delta Logic

**File:** `supabase/functions/mobile-sync-pull/index.ts` (457 lines)

#### 3.4.1 `since` Timestamp Handling

**Rating: PASS (with advisory)**

**Delta boundary mechanism:**

1. Client sends `lastSync` as Unix milliseconds in POST body
2. Server converts: `new Date(body.lastSync ?? 0).toISOString()` (line 81)
3. Server queries sessions: `.gt('started_at', lastSyncISO)` (line 91)
4. Server returns `syncTime` as `Date.now()` (Unix ms, line 82)

**First pull (lastSync = 0):**
- `new Date(0).toISOString()` = `"1970-01-01T00:00:00.000Z"`
- `.gt('started_at', '1970-01-01...')` returns ALL sessions
- Correct first-sync behavior. **PASS.**

**UTC consistency:**

| Component | Handling | UTC? |
|-----------|---------|------|
| Client sends | `Date.now()` epoch ms | YES |
| Server converts | `new Date(n).toISOString()` | YES |
| PostgreSQL | `TIMESTAMPTZ` (internal UTC) | YES |
| PostgREST `.gt()` | ISO string vs TIMESTAMPTZ | YES |
| Server returns | `Date.now()` epoch ms | YES |

No timezone mismatch risk. **PASS.**

**Edge-case gap -- `started_at` vs `updated_at`:**

Sessions are filtered by `started_at > lastSync` (immutable workout start time). Sessions updated after the last sync but started before it will NOT be returned. The `workout_sessions` table lacks an `updated_at` column (verified in `00002_base_schema.sql`).

**Severity:** LOW for beta -- sessions are read-only on the portal, so no updates occur. Must be addressed if session editing is added.

#### 3.4.2 Deleted Record Handling

**Rating: FAIL -- No deletion propagation to mobile**

No mechanism exists to communicate deletions:
- No soft-delete column (`deleted_at`) on any sync table
- No tombstone/deletion log table
- No `deletedIds` in pull response

**Deletion ping-pong scenario:**

```
1. User deletes routine on portal (hard CASCADE delete)
2. Mobile pulls: routine absent from routines[]
3. Mobile has no signal that deletion was intentional
4. Mobile pushes: re-syncs the routine back to server
5. Portal shows "deleted" routine again
6. Repeat indefinitely
```

**Affected entities:**

| Entity | Portal-deletable? | Ping-pong risk? |
|--------|-------------------|----------------|
| Routines | YES | HIGH |
| Training cycles | YES | HIGH |
| Workout sessions | NO (read-only) | None |
| Badges/RPG/Stats | NO | None |

**Severity:** MEDIUM. Users will see deleted routines/cycles reappear.

**Recommended fix:** Add soft-delete columns or a `sync_deletions` log table. Include `deletedRoutineIds[]` and `deletedCycleIds[]` in pull response.

#### 3.4.3 Concurrent Edit Conflicts

**Rating: FAIL -- Last-write-wins, no detection**

No conflict detection or resolution exists. The push's delete-then-insert pattern for routine_exercises means the last push completely overwrites all exercises.

**Conflict scenario:**

```
T0: Routine "Push Day" has exercises [A, B, C, D, E] on both platforms
T1: Mobile reorders to [B, D, A, C, E, F]
T2: Portal removes E, updates C weights -> [A, B, C', D]
T3: Mobile push -> server: [B, D, A, C, E, F] (delete-all, insert mobile version)
T4: Portal writes committed -> server: [A, B, C', D]
T5: Mobile pull -> receives [A, B, C', D]
T6: Mobile push again -> server: [B, D, A, C, E, F] (overwrites portal)
T7: Infinite overwrite loop
```

**Risk by entity type:**

| Entity | Risk | Why |
|--------|------|-----|
| Sessions/exercises/sets/reps | NONE | Append-only, mobile is sole author |
| Routines | HIGH | Both platforms create/edit/delete |
| Training cycles | HIGH | Both platforms create/edit/delete |
| RPG/badges/stats | LOW | Single-row, server-wins acceptable |

**Severity:** MEDIUM for beta (small user base). Must fix before GA.

**Recommended fix:** Add `version INT NOT NULL DEFAULT 1` column to routines and training_cycles. Push includes client's version. Server rejects if `server.version > client.version` (409 Conflict).

#### 3.4.4 Data Completeness

**Rating: PASS -- Full nested hierarchy returned**

**Sessions (delta via `started_at > lastSync`):**
```
session -> exercises[] -> sets[] -> repSummaries[]
```
Verified waterfall queries at lines 104-138. Assembly at lines 144-235 groups correctly by parent ID.

**Routines (full sync every pull per line 238 comment):**
```
routine -> exercises[]
```
All routines returned regardless of `lastSync`. Verified lines 240-302.

**Training cycles (full sync every pull per line 305 comment):**
```
cycle -> days[]
```
Verified lines 307-362.

**Singleton entities (delta-synced):**
- `rpg_attributes`: `.gt('updated_at', lastSyncISO)` -- correct
- `earned_badges`: `.gt('earned_at', lastSyncISO)` -- correct
- `gamification_stats`: `.gt('updated_at', lastSyncISO)` -- correct

No fields silently dropped. All `SELECT *` columns mapped to camelCase DTOs.

#### 3.4.5 Pull Scalability and Security Concerns

**1. PostgREST `.in()` URL length limit -- Severity: MEDIUM**

Waterfall queries send parent IDs as URL query parameters. UUID = 36 chars; URL-encoded ~38 chars/ID.

| Query level | IDs (200-session scenario) | URL size |
|-------------|---------------------------|----------|
| Exercises by session_id | 200 | ~7.6KB (borderline) |
| Sets by exercise_id | ~1,000 | ~38KB (**EXCEEDS** 8KB limit) |
| Rep summaries by set_id | ~3,000 | ~114KB (**far exceeds**) |

For 200+ sessions, the sets and rep_summaries queries **will fail**. This is a blocking bug for large training histories.

**Fix:** Use `supabase.rpc()` with a PostgreSQL function accepting UUID array parameters, or chunk `.in()` into batches of 100 IDs.

**2. Sequential queries (7 parallelizable) -- Severity: LOW**

11 sequential round-trips; steps 5, 7, 9, 10, 11 are independent of the session waterfall. Wrapping in `Promise.all` would cut ~40-50% latency.

**3. No rate limiting -- Severity: LOW**

Push has `checkRateLimit(10/min)`. Pull has none. Misbehaving clients can overload the database.

**4. No subscription gate -- Severity: LOW**

Push requires EMBER tier. Pull has no subscription check. Should be documented as intentional or aligned.

#### 3.4.6 Pull Findings Summary

| Finding | Severity | Status |
|---------|----------|--------|
| Delta boundary uses immutable `started_at` | LOW | ADVISORY |
| First pull (lastSync=0) returns all data correctly | -- | PASS |
| UTC timestamps consistent end-to-end | -- | PASS |
| No deleted record propagation | MEDIUM | FAIL |
| No concurrent edit conflict detection | MEDIUM | FAIL |
| Full nested hierarchy returned correctly | -- | PASS |
| Routines/cycles full-sync every pull (wasteful) | LOW | ADVISORY |
| `.in()` WILL exceed URL length for 200+ sessions | MEDIUM | FAIL |
| 7 of 11 queries parallelizable but sequential | LOW | ADVISORY |
| No rate limiting on pull | LOW | ADVISORY |
| No subscription gate on pull | LOW | ADVISORY |

---

### Consolidated Risk Matrix (Tasks 3.3 + 3.4)

#### HIGH -- Must fix before beta

| ID | Issue | Endpoint | Fix |
|----|-------|----------|-----|
| SYNC-P01 | First-sync (200+ sessions) exceeds 10s timeout | push | Client-side chunking: max 50 sessions/push. No server changes. |
| SYNC-P02 | No transaction wrapping; partial writes on timeout | push | Mitigate via SYNC-P01 (smaller payloads). Ensure mobile retries on 5xx. |

#### MEDIUM -- Should fix for beta, must fix for GA

| ID | Issue | Endpoint | Fix |
|----|-------|----------|-----|
| SYNC-P03 | `routine_exercises` non-atomic delete-then-insert | push | PostgreSQL function wrapping both in one transaction, called via `rpc()`. |
| SYNC-P04 | `cycle_days` non-atomic delete-then-insert | push | Same approach; `cycle_days` already has `UNIQUE(cycle_id, day_number)`. |
| SYNC-P05 | Deleted routines/cycles reappear via push (no tombstones) | pull | Soft-delete columns or `sync_deletions` log. Return `deletedIds` in pull. |
| SYNC-P06 | No conflict detection for routines/cycles | both | Optimistic locking: add `version INT` column; reject stale pushes (409). |
| SYNC-P07 | `.in()` URL length exceeded at 200+ sessions | pull | Chunk IDs into batches of 100 or use `supabase.rpc()` with UUID arrays. |

#### LOW -- Post-beta backlog

| ID | Issue | Endpoint | Fix |
|----|-------|----------|-----|
| SYNC-P08 | `exercise_progress` race condition (no unique constraint) | push | Add `UNIQUE(session_id, exercise_name)`; convert to upsert. |
| SYNC-P09 | `personal_records` race condition (no unique constraint) | push | Add `UNIQUE(user_id, exercise_name, record_type, achieved_at)`; upsert. |
| SYNC-P10 | Routines/cycles full-sync every pull | pull | Add `updated_at` with triggers; use delta queries. |
| SYNC-P11 | 7 parallelizable pull queries run sequentially | pull | `Promise.all` for independent queries (~40% latency cut). |
| SYNC-P12 | No rate limiting on pull | pull | Add `checkRateLimit` (10 req/min). |
| SYNC-P13 | No subscription gate on pull | pull | Document as design choice or add `requireSubscription('EMBER')`. |

---

### Appendix A: Push Data Flow

```
Mobile Client
  |
  | POST /mobile-sync-push  (all dirty data, single payload)
  v
Edge Function (10s timeout, 5MB limit)
  |-- 1. JWT auth
  |-- 2. Rate limit (10/min)
  |-- 3. Subscription gate (EMBER+)
  |-- 4. Parse + validate
  |-- 5a. UPSERT workout_sessions (onConflict:'id')       [IDEMPOTENT]
  |-- 5b. UPSERT exercises (onConflict:'id')               [IDEMPOTENT]
  |-- 5c. UPSERT sets (onConflict:'id')                    [IDEMPOTENT]
  |-- 5d. UPSERT rep_summaries (onConflict:'id')           [IDEMPOTENT]
  |-- 5e. SELECT+INSERT exercise_progress                   [RACE RISK]
  |-- 5f. SELECT+INSERT personal_records                    [RACE RISK]
  |-- 6a. UPSERT routines (onConflict:'id')                [IDEMPOTENT]
  |-- 6b. DELETE routine_exercises                          [NON-ATOMIC]
  |-- 6c. INSERT routine_exercises                          [NON-ATOMIC]
  |-- 7a. UPSERT training_cycles (onConflict:'id')         [IDEMPOTENT]
  |-- 7b. DELETE cycle_days                                 [NON-ATOMIC]
  |-- 7c. INSERT cycle_days                                 [NON-ATOMIC]
  |-- 8.  UPSERT rpg_attributes (onConflict:'user_id')     [IDEMPOTENT]
  |-- 9.  UPSERT earned_badges (onConflict:'user_id,badge_id') [IDEMPOTENT]
  |-- 10. UPSERT gamification_stats (onConflict:'user_id') [IDEMPOTENT]
  |-- 11. BROADCAST sync_complete                           [BEST-EFFORT]
  v
Response: { syncTime (ISO), counts... }
```

### Appendix B: Pull Data Flow

```
Mobile Client
  |
  | POST /mobile-sync-pull  { deviceId, lastSync: epochMs }
  v
Edge Function (NO rate limit, NO subscription gate)
  |-- 1. JWT auth
  |-- 2. lastSyncISO = new Date(lastSync ?? 0).toISOString()
  |
  |-- WATERFALL (sequential, dependent):
  |   3. workout_sessions WHERE started_at > lastSync     [DELTA]
  |   4. exercises WHERE session_id IN (...)
  |   5. sets WHERE exercise_id IN (...)                   [URL LIMIT RISK]
  |   6. rep_summaries WHERE set_id IN (...)               [URL LIMIT RISK]
  |   7. In-memory assembly
  |
  |-- INDEPENDENT (sequential today, parallelizable):
  |   8.  ALL routines                                     [FULL SYNC]
  |   9.  routine_exercises for those routines             [FULL SYNC]
  |   10. ALL training_cycles                              [FULL SYNC]
  |   11. cycle_days for those cycles                      [FULL SYNC]
  |   12. rpg_attributes WHERE updated_at > lastSync       [DELTA]
  |   13. earned_badges WHERE earned_at > lastSync         [DELTA]
  |   14. gamification_stats WHERE updated_at > lastSync   [DELTA]
  v
Response: { syncTime (epochMs), sessions[], routines[], cycles[], rpg, badges, stats }
```
