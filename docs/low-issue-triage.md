# LOW Issue Triage - Sync Layer Audit

**Date**: 2026-04-12
**Purpose**: Triage all 11 LOW severity issues from sync-layer-audit.md for beta readiness

## Triage Summary

| ID  | Issue                          | Decision          | Rationale                                                                               |
| --- | ------------------------------ | ----------------- | --------------------------------------------------------------------------------------- |
| 1.3 | 401 retry doesn't re-serialize | **Document**      | Protected by syncMutex at higher level; architectural fragility has no practical impact |
| 1.5 | No server-side logout          | **Fix**           | Simple 1-line fix, improves security hygiene                                            |
| 3.2 | Duration split imprecise       | **Document**      | Cosmetic precision loss, integer division rounding                                      |
| 3.3 | Pull weight uses max not avg   | **Document**      | Intentional data simplification for mobile's flatter model                              |
| 3.5 | Superset color lossy           | **Fix**           | Create reverse mapping to restore round-trip; cosmetic but annoying                     |
| 4.4 | 30s timeout may be tight       | **Fix**           | Increase to 60s; trivial change, helps slow connections                                 |
| 5.1 | Non-suspend lock               | **Document**      | Locked sections are non-suspending and very fast                                        |
| 5.2 | Login + sync race              | **Document**      | UI prevents simultaneous login and sync actions                                         |
| 6.3 | No 429/503 handling            | **ALREADY FIXED** | classifyByStatusCode() handles 429 and 500-599                                          |
| 8.3 | Device ID not hardware-bound   | **Document**      | Privacy by design - UUID is intentional                                                 |
| 9.1 | HttpClient never closed        | **Document**      | Singleton lifetime matches app lifetime; acceptable                                     |

## Final Categories

### Fix (3 issues)
- **1.5**: Server-side logout - call `apiClient.signOut()` before clearing auth
- **3.5**: Superset color round-trip - add reverse mapping from name to index
- **4.4**: HTTP timeout - increase from 30s to 60s

### Already Fixed (1 issue)
- **6.3**: 429/503 handling - `classifyByStatusCode()` in PortalApiClient.kt already handles these:
  - Line 140-146: 429 -> TRANSIENT, retryable
  - Line 149-155: 500-599 -> TRANSIENT, retryable

### Document (7 issues)
- **1.3**: 401 retry race condition (protected by syncMutex)
- **3.2**: Duration split precision (cosmetic, integer division)
- **3.3**: Pull weight uses max (intentional simplification)
- **5.1**: Non-suspend lock (fast sections, acceptable)
- **5.2**: Login + sync race (UI prevents)
- **8.3**: Device ID UUID (privacy by design)
- **9.1**: HttpClient lifetime (singleton pattern)

---

## Detailed Analysis

### 1.3 [Document] 401 Retry on Authenticated Requests

**File**: `PortalApiClient.kt` lines 183-198
**Impact**: Architecturally fragile but practically safe

**Analysis**:
The audit correctly identifies that on 401 retry, the `block` lambda is called outside the refresh mutex, meaning another coroutine could also be retrying. However, the `SyncManager.sync()` method is behind `syncMutex`, which serializes all sync operations.

**Why Document (not Fix)**:
- Higher-level `syncMutex` provides protection
- Retry occurs after successful token refresh
- All sync operations go through SyncManager
- Fix would require significant restructuring for marginal benefit

---

### 1.5 [Fix] No Server-Side Logout

**File**: `SyncManager.kt` line 161-165
**Impact**: Refresh token remains valid server-side until expiry

**Current Code**:
```kotlin
fun logout() {
    tokenStorage.clearAuth()
    tokenStorage.emitLogoutEvent()
    _syncState.value = SyncState.NotAuthenticated
}
```

**Fix**: Add `apiClient.signOut()` call before clearing auth. Note that `signOut()` is designed to swallow exceptions (line 264-280 in PortalApiClient.kt), so this is safe to call.

---

### 3.2 [Document] Duration Split Imprecise

**File**: `PortalPullAdapter.kt` line 59
**Impact**: Minor cosmetic precision loss

**Analysis**:
`duration = (portalSession.durationSeconds * 1000L) / exerciseCount`

For 601 seconds across 3 exercises: each gets 200333ms instead of 200333.33ms. The remainder (1ms) is lost.

**Why Document (not Fix)**:
- Sub-millisecond precision is cosmetic
- Duration is displayed, not used for calculations
- Would require Float math for negligible benefit

---

### 3.3 [Document] Pull Weight Uses Max Not Avg

**File**: `PortalPullAdapter.kt` line 57
**Impact**: Progressive overload info lost on pull

**Analysis**:
When pulling from server, sessions with progressive weights (40kg, 45kg, 50kg) record only 50kg.

**Why Document (not Fix)**:
- This is intentional data simplification
- Mobile's WorkoutSession has single `weightPerCableKg` field
- Portal's richer model cannot be fully represented
- Workaround: per-set weight info exists in routine exercises

---

### 3.5 [Fix] Superset Color Mapping Lossy

**File**: `SqlDelightSyncRepository.kt` line 545
**Impact**: Cosmetic - superset colors wrong after pull

**Current Code**:
```kotlin
val colorStr = ssExercises.firstOrNull()?.supersetColor
val colorIndex = colorStr?.toLongOrNull() ?: supersetOrderIdx.toLong()
```

The portal sends color as name ("pink", "indigo") from push adapter (PortalSyncAdapter line 428-433), but pull adapter tries `toLongOrNull()` which returns null for "pink".

**Fix**: Create reverse mapping from color name back to index.

---

### 4.4 [Fix] HTTP Timeout May Be Tight

**File**: `PortalApiClient.kt` lines 182-185
**Impact**: Large payloads may time out on slow connections

**Current Code**:
```kotlin
install(HttpTimeout) {
    requestTimeoutMillis = 30_000
    connectTimeoutMillis = 10_000
}
```

**Fix**: Increase `requestTimeoutMillis` to 60_000 (60 seconds).

---

### 5.1 [Document] SyncTriggerManager Non-Suspend Lock

**File**: `SyncTriggerManager.kt` lines 59, 115-123
**Impact**: Theoretical thread starvation, not practical concern

**Analysis**:
Uses `withPlatformLock(stateLock)` which wraps `synchronized` on JVM. The locked sections are:
- Timestamp comparison (fast)
- Counter increment (fast)
- Boolean flag read/write (fast)

**Why Document (not Fix)**:
- All locked sections are non-suspending
- Execution time is microseconds
- Refactoring to Mutex would be over-engineering

---

### 5.2 [Document] Login + Sync Race

**File**: `SyncManager.kt`
**Impact**: State interleaving possible in theory

**Analysis**:
`login()` and `sync()` both modify `_syncState`. Login resets to Idle, sync changes to Syncing. The `syncMutex` only protects `sync()`.

**Why Document (not Fix)**:
- UI prevents simultaneous operations
- Login completes before sync is offered
- State transitions are idempotent (Idle -> Syncing is safe)

---

### 6.3 [Already Fixed] Missing 429/503 Handling

**File**: `PortalApiClient.kt` lines 140-155
**Status**: ALREADY IMPLEMENTED

**Evidence** (from current code):
```kotlin
// Rate limited - transient, retry with backoff
429 -> ClassifiedSyncError(
    category = SyncErrorCategory.TRANSIENT,
    message = message,
    statusCode = statusCode,
    isRetryable = true,
    cause = cause,
)

// Server errors (500, 502, 503, 504) - transient
in 500..599 -> ClassifiedSyncError(
    category = SyncErrorCategory.TRANSIENT,
    ...
)
```

This was likely fixed after the audit was conducted.

---

### 8.3 [Document] Device ID Not Hardware-Bound

**File**: `PortalTokenStorage.kt` lines 162-167, 230-233
**Impact**: Server cannot deduplicate devices

**Analysis**:
Device ID is `generateUUID()` - a random UUID persisted to settings.

**Why Document (not Fix)**:
- Privacy by design: no hardware fingerprinting
- Clearing app data = new device (acceptable)
- Server doesn't need device deduplication for sync

---

### 9.1 [Document] HttpClient Never Closed

**File**: `PortalApiClient.kt` line 178
**Impact**: None for singleton pattern

**Analysis**:
Ktor `HttpClient` is a field, never explicitly closed. However, `PortalApiClient` is a Koin singleton that lives for app lifetime.

**Why Document (not Fix)**:
- Singleton pattern: client lives as long as app
- No connection pool staleness issue (HTTP/2 keeps connections alive)
- Adding close() would require lifecycle management for no benefit

---

## Verification Commands

```bash
# After fixes are implemented:
cd Project-Phoenix-MP
./gradlew :shared:compileKotlinAndroid

# Count documented issues in KNOWN-ISSUES.md
grep -c "## Issue:" .planning/KNOWN-ISSUES.md
```
