# Hooks & Providers Review

Scope: custom React hooks and context-provider-facing hook exports listed in kanban task `t_559e7e6f`.

Reviewed files: 20
Findings: 14

Severity breakdown:
- Critical: 0
- High: 1
- Medium: 10
- Low: 3

Verification performed:
- `npm run typecheck` — passed
- `npm test -- src/hooks/__tests__/useBlockedUsers.test.tsx src/hooks/__tests__/useCommentRealtime.test.tsx src/hooks/__tests__/useRealtimeSync.test.tsx src/hooks/__tests__/useRealtimeSync.invalidation.test.tsx src/hooks/__tests__/useSubscription.test.tsx` — passed, with an existing React act() warning in `useBlockedUsers.test.tsx`
- `npm run lint -- <reviewed files>` — passed (script expands to `biome check . ...` and checked 448 files)

## src/app/hooks/useAuth.ts

No findings.

## src/app/hooks/useButtonSuccess.ts

### Finding 1
- Category: bug
- Severity: medium
- Line numbers: 18-23, 26-28
- Description: `trigger()` schedules a timeout that calls `setIsSuccess(false)`, but the hook never clears that timeout on unmount. The comment says the timer is cleaned up and `cleanupRef` is assigned, but no `useEffect` cleanup uses it. If a component unmounts while the success state is active, the timer can fire after unmount and cause a stale state update. Changing `durationMs` while a timer is active also leaves the old timer running until `trigger()` is called again.
- Suggested fix direction: Add a `useEffect` cleanup that clears `timerRef.current` and sets it to `undefined`/`null` on unmount. Remove the unused `cleanupRef` placeholder. Optionally validate/clamp `durationMs` to non-negative values.

## src/app/hooks/useCalendarState.ts

No findings.

## src/app/hooks/useIsMobile.ts

No findings.

## src/app/hooks/usePreferredWeightUnit.ts

No findings.

## src/app/hooks/usePWAInstall.ts

### Finding 2
- Category: failure-point
- Severity: low
- Line numbers: 107-120
- Description: `promptInstall` awaits `deferredPrompt.prompt()` and `deferredPrompt.userChoice` without `try/finally` or error handling. If the browser rejects either promise, the module-level `deferredPrompt` remains set and `promptAvailable` remains true, so the banner can continue to render while the install flow is no longer usable.
- Suggested fix direction: Wrap the prompt flow in `try/catch/finally`; log or surface a non-blocking failure state, and clear `deferredPrompt`/`promptAvailable` in `finally` after a prompt attempt.

## src/app/hooks/useReducedMotion.ts

### Finding 3
- Category: failure-point
- Severity: low
- Line numbers: 13, 17-20
- Description: The hook assumes `window.matchMedia` exists and that the returned `MediaQueryList` supports `addEventListener`. Older Safari/WebViews only expose `addListener`/`removeListener`, and non-browser/test environments can omit `matchMedia`, causing the hook to throw during initialization or mount.
- Suggested fix direction: Guard for `typeof window.matchMedia === "function"`, and use an `addEventListener`/`removeEventListener` path with an `addListener`/`removeListener` fallback.

## src/hooks/useBlockedUsers.ts

### Finding 4
- Category: bug
- Severity: medium
- Line numbers: 7, 31-44, 46-63
- Description: Blocked user IDs are hydrated from and persisted to a single global `phoenix-blocked-users` localStorage key. The hook does not scope the cache by authenticated user and does not clear the Zustand store when `user` is null or changes. On shared browsers or account switches, one user's blocked list can be applied to another user until the server query completes; if the new user is logged out or the query fails, stale IDs can remain indefinitely.
- Suggested fix direction: Include `user.id` in the storage key, clear the community store when there is no authenticated user, and consider ignoring cached data until it matches the current user. Handle query errors explicitly so stale local state is not mistaken for authoritative server state.

## src/hooks/useCommentRealtime.ts

No findings.

## src/hooks/useCommunityRealtime.ts

### Finding 5
- Category: bug
- Severity: medium
- Line numbers: 16-18, 41-49
- Description: The hook uses the fixed Supabase realtime channel topic `community-votes-realtime`. Other realtime hooks in this review use a random suffix to avoid remount races while `removeChannel` cleanup is still in progress. If this hook remounts quickly, is mounted in React StrictMode, or two components accidentally mount it, Supabase can reuse/collide with an existing subscribed channel and fail to register callbacks correctly.
- Suggested fix direction: Generate a unique channel topic per mount, e.g. `community-votes-realtime:${crypto.randomUUID()}`, and keep the existing cleanup. Add a remount-before-cleanup test similar to `useCommentRealtime`.

## src/hooks/useDebounce.ts

No findings.

## src/hooks/useExerciseCatalog.ts

No findings.

## src/hooks/useNotificationSync.ts

### Finding 6
- Category: error
- Severity: medium
- Line numbers: 47-57, 59-76, 82-87
- Description: The community notification query ignores `error` from the `shared_routines` and `shared_cycles` lookups. If either query fails, its `data` is treated as an empty array, which can silently undercount notifications and then write `community: 0` or a partial count to the UI store. Because only the final comments query throws, upstream failures are hidden from React Query.
- Suggested fix direction: Destructure and check `error` for both shared-content lookups before building `itemIds`. Throw the first error so React Query can retry/report it, and avoid updating the UI store from partial data.

### Finding 7
- Category: failure-point
- Severity: medium
- Line numbers: 82-87
- Description: The effect writes zero counts to the UI store whenever a query's `data` is `undefined`, including during the initial loading period or after a query error. This can briefly clear badges on every mount/focus refetch and can hide failures as empty notification counts.
- Suggested fix direction: Include query loading/error state in the hook. Only write a count once its query has successfully resolved, or preserve the previous UI-store count while a query is pending/erroring.

## src/hooks/useOnboarding.ts

### Finding 8
- Category: bug
- Severity: medium
- Line numbers: 8, 41-55
- Description: Onboarding version comparisons use raw string comparison (`onboarding.version_seen < CURRENT_VERSION`) and `showHints` requires exact equality with `CURRENT_VERSION`. This is brittle for semantic versions: values such as `1.10` and `1.2` do not sort correctly lexicographically, and a future version greater than `CURRENT_VERSION` would suppress feature hints because it is not exactly equal.
- Suggested fix direction: Parse versions into numeric semver components or store a monotonically increasing schema/version number. Use `>= CURRENT_VERSION` semantics for already-seen/current-or-newer rows when deciding whether to show hints.

### Finding 9
- Category: race-condition
- Severity: medium
- Line numbers: 113-121
- Description: `dismissHint` merges `hintId` into `onboarding.dismissed_hints` on the client and sends the whole JSON object with `update`. Two dismissals fired close together from separate `FeatureHint` instances can both read the same stale `dismissed_hints` object and overwrite each other, losing one dismissal.
- Suggested fix direction: Move the merge into an atomic database RPC/update expression, or perform an optimistic React Query update that serializes mutations and merges against the latest cached state before writing.

## src/hooks/usePlayback.ts

### Finding 10
- Category: bug
- Severity: high
- Line numbers: 7-18
- Description: `useAnimationFrame` from `motion/react` passes `delta` in milliseconds, but the hook comments that it is seconds and multiplies it by `1000`. With `currentTimeMs` also stored in milliseconds, playback advances roughly 1000x too fast and will immediately seek to `maxTimeMs`/pause for normal frame deltas.
- Suggested fix direction: Treat `delta` as milliseconds: `const deltaMs = delta * speed`. Add a unit test with a mocked animation-frame delta (e.g. 16 ms at speed 1 should advance about 16 ms, not 16,000 ms).

## src/hooks/useRealtimeSync.ts

### Finding 11
- Category: race-condition
- Severity: medium
- Line numbers: 89-94, 102-114
- Description: The Supabase broadcast channel topic is fixed as `sync:${user.id}`. `removeChannel` is called during cleanup but not awaited, so a quick user-shell remount or React StrictMode remount can create a new channel with the same topic before the old one is fully removed. This is the same class of remount race avoided in `useCommentRealtime` and `useSubscription` by adding a unique suffix.
- Suggested fix direction: Add a per-mount unique suffix to the channel topic, e.g. `sync:${user.id}:${crypto.randomUUID()}`, while retaining the user-specific broadcast filter/validation semantics. Add a remount-before-cleanup regression test.

## src/hooks/useRecoveryScore.ts

### Finding 12
- Category: failure-point
- Severity: medium
- Line numbers: 23-28, 44-65
- Description: The returned `isLoading` only reflects `sessionsLoading`. The computed recovery score also depends on `activeCycle`, and the returned `wearable` value has its own query, but neither query contributes to `isLoading`. The UI can render a recovery score before active-cycle adjustments or wearable data have resolved, then change after the fact without indicating that the initial score was incomplete.
- Suggested fix direction: Track pending/error state for all queries used by the result, or split the return value into separate loading flags (`isScoreLoading`, `isWearableLoading`, `isCycleLoading`). Avoid presenting the final score until all inputs that affect it have either resolved or intentionally failed/been skipped.

## src/hooks/useStreak.ts

### Finding 13
- Category: bug
- Severity: low
- Line numbers: 20-31
- Description: The streak computation stops after 365 iterations, so a user with a streak longer than one year will always be capped at 365 even when `workouts` contains consecutive days beyond that range.
- Suggested fix direction: Iterate until the first missing day instead of using a hard-coded 365-day cap, or make the cap explicit in the UI/product requirements and return a distinct capped value.

## src/hooks/useStreakSync.ts

No findings.

## src/hooks/useSubscription.ts

### Finding 14
- Category: failure-point
- Severity: medium
- Line numbers: 89-94, 128-151
- Description: When the subscription query errors, `data` is `undefined` and the hook falls back to `FREE`/`none` with `isEntitled: false` while exposing no `isError` or `error` field. A transient Supabase/network failure can therefore silently downgrade premium users in the UI instead of showing an unknown/error state or preserving the last known entitlement.
- Suggested fix direction: Return React Query error state from the hook and distinguish `unknown` from confirmed `FREE`. Consider using `placeholderData`/previous cached data for transient refetch errors, and let access-control consumers decide whether to fail closed or show a retry/error state.
