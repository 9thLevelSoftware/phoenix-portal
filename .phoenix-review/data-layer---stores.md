# Data Layer - Stores Review

Scope reviewed:
- `src/stores/useCommunityStore.ts`
- `src/stores/useProfileFilterStore.ts`
- `src/stores/useReplayStore.ts`
- `src/stores/useUIStore.ts`

Summary: 9 findings (2 high, 4 medium, 3 low). No TODO/FIXME/HACK stubs were found in the assigned store files.

## `src/stores/useCommunityStore.ts`

### Finding 1
- Category: failure-point
- Severity: medium
- Line numbers: 14, 30, 40-41
- Description: `blockedUserIds` is kept as a mutable `Set` and `setBlockedUserIds` stores the caller-provided `Set` by reference. Any code that later mutates that `Set` instance, or mutates the `Set` returned from the store, can change store contents without going through Zustand `set`, so subscribers will not be notified. `resetAll` also restores the module-level `initialState` object, including the same reusable empty `Set` instance.
- Suggested fix direction: Keep store state immutable/serializable. Prefer `string[]` or `ReadonlySet<string>` plus dedicated `addBlockedUser`, `removeBlockedUser`, and `replaceBlockedUsers` actions that always create a fresh `Set`. Have `resetAll` build a fresh initial object instead of reusing the module-level `initialState` reference.

### Finding 2
- Category: failure-point
- Severity: low
- Line numbers: 33-41
- Description: The community UI store is an in-memory Zustand store only. Active tab, sort, search, filters, selected item, and the blocked-user set are not persisted or synchronized by the store. In practice, community filters reset on reload, and multiple tabs can diverge until hooks refetch/re-hydrate their local state. This is especially visible for blocked users because the backing hook writes localStorage, but the store itself does not listen for `storage` events or any BroadcastChannel signal.
- Suggested fix direction: Decide which fields are intended to survive reload/tab boundaries, then add `persist` with `partialize` for those fields only (likely tab/sort/filters/search, not transient selected item), and add a storage-event/BroadcastChannel bridge or query invalidation strategy for blocked-user changes across tabs.

## `src/stores/useProfileFilterStore.ts`

### Finding 3
- Category: bug
- Severity: high
- Line numbers: 19-20
- Description: The persisted key `phoenix-profile-filter` is global and not scoped to the authenticated user. If a user signs out and another user signs in in the same browser tab/session, the previous user's `activeProfileId` can be rehydrated and then used by query filters and mutations that read `useProfileFilterStore.getState().activeProfileId` when creating routines, cycles, or importing community items. That can cause failed RLS/database writes at best, and incorrect local-profile attribution if IDs ever overlap or permissions change.
- Suggested fix direction: Scope the persisted value by user id, clear it on sign-out/user change, and validate the rehydrated profile id against `localProfilesOptions(userId)` before exposing it to mutations. Another safe option is to keep this store unpersisted and initialize it from an auth-scoped profile preference.

### Finding 4
- Category: failure-point
- Severity: medium
- Line numbers: 20
- Description: The store persists to `sessionStorage`, which is per-tab and does not emit useful cross-tab synchronization for other tabs. A user changing the active local profile in one tab leaves other open tabs on the previous profile, so reads and new routine/cycle mutations can be attributed to different profiles depending on which tab the user acts in.
- Suggested fix direction: If profile selection is intended to be a global user preference, use user-scoped `localStorage` plus a `storage` event/BroadcastChannel listener, or persist the preference server-side. If per-tab behavior is intentional, document it and avoid using the per-tab filter implicitly for create/import mutations without an explicit profile choice.

## `src/stores/useReplayStore.ts`

### Finding 5
- Category: bug
- Severity: high
- Line numbers: 28-35, 54
- Description: `reset()` only clears `isPlaying`, `currentTimeMs`, and `currentRepIndex`; it preserves `currentSetIndex`, `viewMode`, `speed`, and `activeChart`. `SessionReplay` calls `reset()` on mount as a playback reset, so navigating from a session where `currentSetIndex` is 3 to a session with fewer sets leaves `currentSet` undefined, disables the telemetry query, and can render no replay content rather than starting at set 1.
- Suggested fix direction: Split the action into explicit `resetPlaybackPosition()` and `resetSession()` semantics, or make `reset()` restore the full `initialState` including `currentSetIndex: 0` for page/session mounts. Add a regression test that changes to a high set index, mounts/initializes a new shorter session, and verifies the replay starts at set 0.

### Finding 6
- Category: failure-point
- Severity: medium
- Line numbers: 44, 46-53
- Description: Navigation and seek actions accept unbounded values. `seek` can store negative, `NaN`, or beyond-duration times; `nextSet` increments forever with no knowledge of `totalSets`; and `setCurrentRepIndex` accepts negative/out-of-range indexes. The current UI disables some buttons, but the store API itself can still enter invalid states through tests, keyboard/imperative callers, race conditions when set counts change, or future components.
- Suggested fix direction: Clamp at the store boundary. Consider `seek(timeMs, durationMs)` or a dedicated `setDuration` in store, `nextSet(totalSets)`, and `setCurrentRepIndex(index, repCount)`, with `Number.isFinite` checks and non-negative integer normalization.

### Finding 7
- Category: failure-point
- Severity: low
- Line numbers: 14, 24, 53-54
- Description: `currentRepIndex` is part of global replay state and has a setter, but the main replay component derives the current rep index from `currentTimeMs` locally and never writes it back to the store. Any future component that subscribes to `useReplayStore((s) => s.currentRepIndex)` will observe stale state, and the reset path updates a field that is not the source of truth.
- Suggested fix direction: Remove `currentRepIndex` from the store if it is derived-only state, or centralize the derivation/synchronization in the store so there is one authoritative value.

## `src/stores/useUIStore.ts`

### Finding 8
- Category: failure-point
- Severity: medium
- Line numbers: 13-23
- Description: The UI store is global and has no reset action or user scoping. Streak and notification badges are user-specific, but they remain in memory until `useStreakSync`/`useNotificationSync` overwrite them. During sign-out, account switches, offline query failures, or before the sync hooks run, navigation can briefly show stale counts from a previous user/session.
- Suggested fix direction: Add a `reset()` action and invoke it on sign-out/auth-user changes before new queries resolve. Alternatively store counts under a `userId` key and have selectors return zero when the current authenticated user does not match the stored owner.

### Finding 9
- Category: failure-point
- Severity: low
- Line numbers: 19-22
- Description: `setStreak` and `setNotifications` accept arbitrary numbers and write them directly. A negative, fractional, `NaN`, or infinite value from a buggy caller or future API response would flow into badge rendering and animation logic without normalization.
- Suggested fix direction: Sanitize at the store boundary: coerce to finite non-negative integers, optionally cap very large badge values for display, and add tests for invalid numeric inputs.
