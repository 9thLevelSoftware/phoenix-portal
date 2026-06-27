# Data Layer - Mutations & Schemas Review

Reviewed files:
- `src/mutations/account.ts`
- `src/mutations/challenges.ts`
- `src/mutations/comments.ts`
- `src/mutations/community.ts`
- `src/mutations/cycles.ts`
- `src/mutations/goals.ts`
- `src/mutations/integrations.ts`
- `src/mutations/profile.ts`
- `src/mutations/routines.ts`
- `src/mutations/workouts.ts`
- `src/schemas/comments.ts`
- `src/schemas/community.ts`
- `src/schemas/goals.ts`
- `src/schemas/onboarding.ts`
- `src/schemas/recovery.ts`
- `src/schemas/telemetry.ts`
- `src/schemas/transforms.ts`

Verification: `npm exec -- tsc --noEmit --pretty false` completed with exit code 0.

Summary: 40 findings: 8 high, 28 medium, 4 low.

## `src/mutations/account.ts`

### Finding 1
- Category: failure-point
- Severity: medium
- Line numbers: 62-70, 72-76
- Description: `useCancelDeletion` treats a zero-row update as success. If there is no pending deletion request, the request belongs to a different user, or RLS blocks it, Supabase can return `error: null` with no rows affected, and the UI still toasts that account deletion was cancelled.
- Suggested fix direction: Return the updated row with `.select("id").maybeSingle()` or request an exact count and throw a specific error when no pending request was updated.

### Finding 2
- Category: failure-point
- Severity: low
- Line numbers: 99-101
- Description: `useExecuteDeletion` ignores the result of `supabase.auth.signOut()`. If the Edge Function succeeds but sign-out fails, the client can remain in an authenticated/stale session state after showing "Account deleted. Signing out...".
- Suggested fix direction: Capture `{ error }` from `signOut()`, clear local auth/query state deliberately, and surface/retry sign-out failures.

## `src/mutations/challenges.ts`

### Finding 3
- Category: failure-point
- Severity: medium
- Line numbers: 43-48, 50-54, 72-77, 79-83
- Description: `useLeaveChallenge` and `useCompleteChallenge` do not verify that any participant row was actually deleted/updated. Invalid challenge IDs, not-yet-joined challenges, or RLS misses can still flow to `onSuccess`, producing "Challenge left" or "Challenge completed!" despite no persisted change.
- Suggested fix direction: Select/count the affected participant row and throw a not-found/not-participant error when the mutation affects zero rows.

### Finding 4
- Category: failure-point
- Severity: medium
- Line numbers: 16-19, 21-30
- Description: `useJoinChallenge` does not handle duplicate participation explicitly. A rapid double-click or pre-existing participant row will surface as a generic failure rather than an idempotent "already joined" success or a clear duplicate message.
- Suggested fix direction: Use an upsert with the challenge/user unique key or map unique-constraint errors to an idempotent result/user-friendly toast.

## `src/mutations/comments.ts`

### Finding 5
- Category: failure-point
- Severity: medium
- Line numbers: 23-30
- Description: `useCreateComment` accepts and inserts the raw `body` argument without applying the `createCommentSchema` constraints. Callers outside the current UI path, tampered clients, or future forms can submit whitespace-only or over-500-character bodies and rely on the database to reject them.
- Suggested fix direction: Parse `{ body }` with the shared schema in the mutation, trim before insert, and surface validation errors distinctly from transport errors.

### Finding 6
- Category: bug
- Severity: high
- Line numbers: 95-107
- Description: The expired-edit guard relies on `count === 0`, but the Supabase update does not request a count or select a row. In real Supabase responses, `count` is commonly `null` unless requested, so a zero-row update caused by the `.gte("created_at", fiveMinutesAgo)` filter can be treated as success and silently fail to update the comment.
- Suggested fix direction: Use `.select("id").maybeSingle()` after the update or request `{ count: "exact" }`; throw the edit-window error when no row is returned/affected.

### Finding 7
- Category: failure-point
- Severity: medium
- Line numbers: 146-152, 155-162
- Description: `useDeleteComment` soft-deletes without verifying that a row matched the comment ID and current user. Unauthorized, already-deleted, or stale comment IDs can produce a success toast and cache invalidation with no persisted deletion.
- Suggested fix direction: Return/count the updated row and throw a specific not-found/not-owner error when no row is affected.

## `src/mutations/community.ts`

### Finding 8
- Category: bug
- Severity: medium
- Line numbers: 24-50
- Description: `useVote` implements toggle via check-then-insert/delete. Concurrent clicks, multiple tabs, or another device can change the row between the existence check and the write, causing unique-constraint failures or deleting the wrong toggle state.
- Suggested fix direction: Move vote toggling into an RPC/transaction or use idempotent upsert/delete semantics keyed by `(user_id, item_id, item_type)`.

### Finding 9
- Category: failure-point
- Severity: medium
- Line numbers: 53-64
- Description: `useVote` has no `onError` handler. Auth failures, RLS failures, duplicate-key races, or network errors leave the user with no toast and no local recovery path.
- Suggested fix direction: Add `onError` logging/toast behavior consistent with the other mutations and consider disabling repeated clicks while pending.

### Finding 10
- Category: bug
- Severity: medium
- Line numbers: 315-337
- Description: `useFollowCreator` uses the same check-then-insert/delete toggle pattern as votes. Concurrent follow/unfollow actions can race into duplicate inserts or stale deletes.
- Suggested fix direction: Replace with an atomic RPC or database upsert/delete operation that returns the final follow state.

### Finding 11
- Category: failure-point
- Severity: medium
- Line numbers: 424-429, 432-449
- Description: `useBlockUser` does not distinguish duplicate blocks from real failures and does not make blocking idempotent. A previously blocked user can trigger a duplicate-key error and show "Failed to block user" even though the intended blocked state already exists.
- Suggested fix direction: Use upsert/on-conflict-do-nothing semantics or map unique-constraint errors to a successful/idempotent blocked state.

### Finding 12
- Category: failure-point
- Severity: medium
- Line numbers: 515-527, 531-539
- Description: `useDeleteSharedContent` does not verify that a shared routine/cycle row was actually deleted. Stale IDs, ownership mismatches, or RLS denials can still be reported as "Content removed from community" if the delete affects zero rows without an error.
- Suggested fix direction: Delete with `.select("id").maybeSingle()` or count affected rows and throw a clear not-found/not-owner error when nothing was deleted.

## `src/mutations/cycles.ts`

### Finding 13
- Category: error
- Severity: high
- Line numbers: 62-99
- Description: `useSaveCycle` creates the `training_cycles` parent row and then inserts `cycle_days` in a separate request. If the day insert fails, the database is left with a draft cycle missing its intended schedule.
- Suggested fix direction: Use a Supabase RPC/database transaction that inserts the cycle and all days atomically, or clean up the parent row on child-insert failure.

### Finding 14
- Category: bug
- Severity: high
- Line numbers: 129-167
- Description: `useUpdateCycle` updates the parent with an ownership filter, but then deletes and reinserts `cycle_days` by `cycle_id` only. It does not confirm the parent update matched the current user before deleting children, so stale/unauthorized cycle IDs can still trigger destructive child-table writes if RLS is incomplete or misconfigured.
- Suggested fix direction: Return the updated cycle ID before touching `cycle_days`, abort when no parent row matched, and perform the parent/day replacement in a server-side transaction with ownership checks.

### Finding 15
- Category: error
- Severity: high
- Line numbers: 146-167
- Description: Cycle day replacement is not atomic. After deleting existing `cycle_days`, an insert failure leaves the cycle with no schedule or a partial replacement failure state.
- Suggested fix direction: Replace the delete+insert sequence with a transaction/RPC or restore the prior days on failure.

## `src/mutations/goals.ts`

### Finding 16
- Category: failure-point
- Severity: medium
- Line numbers: 27-47
- Description: `useCreateGoal` inserts caller-supplied values directly and does not parse the shared create-goal schema. Negative targets, missing PR exercise information, invalid deadlines, or unsupported periods can be sent to Supabase and only fail at database time if constraints happen to exist.
- Suggested fix direction: Reuse `createGoalSchema` (after adding all required fields) inside the mutation and show validation-specific errors before making the network call.

### Finding 17
- Category: failure-point
- Severity: medium
- Line numbers: 134-142, 145-149
- Description: `useArchiveGoal` does not verify that a goal row was actually archived. A stale goal ID or ownership mismatch can produce "Goal archived" even when zero rows were updated.
- Suggested fix direction: Select/count the updated row and throw a not-found/not-owner error when no row is affected.

## `src/mutations/integrations.ts`

### Finding 18
- Category: error
- Severity: medium
- Line numbers: 92-101
- Description: When provider Edge Function invocation fails, `useManualSync` attempts to mark the queued sync as failed but ignores any error from that update. If the failure-status update also fails, the queue can remain stuck as `pending` while the UI only sees the original invoke error.
- Suggested fix direction: Capture and log/throw the status-update error, or use a server-side function that queues and invokes/marks failure atomically.

### Finding 19
- Category: error
- Severity: medium
- Line numbers: 153-159
- Description: `useConnectIntegration` ignores errors from the initial `sync_queue` insert. A provider can be marked `connected` while no initial sync was queued, leaving the integration looking connected but with no data import starting.
- Suggested fix direction: Check the queue insert error and either roll back/disconnect the integration row or surface a partial-connect state that prompts a retry.

## `src/mutations/profile.ts`

### Finding 20
- Category: failure-point
- Severity: medium
- Line numbers: 29-33, 35-41
- Description: `useUpdateProfile` does not verify that a profile row exists for `userId`. If the row is missing, the ID is stale, or RLS blocks the update without an error, the hook still toasts "Settings saved" and invalidates the cache.
- Suggested fix direction: Return/count the updated row and throw a specific not-found/not-authenticated error when no profile was updated.

## `src/mutations/routines.ts`

### Finding 21
- Category: error
- Severity: high
- Line numbers: 116-143
- Description: `useSaveRoutine` inserts the routine row and routine exercises in separate requests. If exercise insertion fails, the user is left with a saved routine shell whose `exercise_count` no longer matches its missing children.
- Suggested fix direction: Use an RPC/database transaction for routine + exercises creation, or delete the parent routine on child-insert failure.

### Finding 22
- Category: bug
- Severity: high
- Line numbers: 199-207
- Description: `useUpdateRoutine` updates `routines` by `id` only and does not include `.eq("user_id", user.id)`, unlike delete and favorite mutations. This weakens ownership enforcement and can update another user's routine if RLS is absent, incomplete, or bypassed in tests/admin contexts.
- Suggested fix direction: Add the same user ownership filter used elsewhere, return the updated row, and abort child replacement when no row matched.

### Finding 23
- Category: error
- Severity: high
- Line numbers: 211-227
- Description: Updating a routine deletes all existing exercises and reinserts the replacement set in separate requests. If the insert fails after deletion, the routine is left with no exercises even though the parent row was already updated.
- Suggested fix direction: Replace the delete+insert sequence with a transaction/RPC or restore the old exercises on failure.

### Finding 24
- Category: failure-point
- Severity: medium
- Line numbers: 10-17, 64-94
- Description: Routine inputs are not validated in the mutation before duration and storage transforms run. Invalid values such as zero/negative `sets`, negative `rest_seconds`, or non-finite weights can produce negative durations or invalid stored per-cable weights before the database rejects them.
- Suggested fix direction: Add and reuse a Zod input schema for routine mutations, including non-negative/int constraints and finite-number checks.

## `src/mutations/workouts.ts`

### Finding 25
- Category: failure-point
- Severity: high
- Line numbers: 20-24
- Description: `useSaveSessionNotes` updates `workout_sessions` by `sessionId` only, with no current-user filter and no affected-row check. If RLS is incomplete or an admin/test client is used, any known session ID could have its notes modified; even with RLS, zero-row updates can be reported as success.
- Suggested fix direction: Require the current user, add `.eq("user_id", user.id)`, and select/count the updated row before showing success.

## `src/schemas/comments.ts`

### Finding 26
- Category: failure-point
- Severity: low
- Line numbers: 11-16
- Description: Date fields are transformed with `new Date(s)` but never validated. Invalid date strings still parse successfully as `Invalid Date`, which can later break sorting, formatting, or edit-window calculations.
- Suggested fix direction: Use `z.coerce.date()` or refine transformed dates with `Number.isFinite(date.getTime())`.

### Finding 27
- Category: bug
- Severity: medium
- Line numbers: 30-34
- Description: `createCommentSchema` accepts whitespace-only comments because `.min(1)` is applied before trimming. The current component trims before calling the mutation, but the shared schema itself does not enforce the intended non-empty-after-trim rule.
- Suggested fix direction: Add `.trim().min(1)` or a refine that rejects `body.trim().length === 0`.

## `src/schemas/community.ts`

### Finding 28
- Category: failure-point
- Severity: medium
- Line numbers: 16-43, 67-86
- Description: Community routine/cycle snapshot schemas accept arbitrary numeric values for counts, reps, weights, durations, day numbers, and adjustments. Negative/decimal counts or nonsensical schedule values can pass validation and later be imported into user routines/cycles.
- Suggested fix direction: Add domain constraints such as `.int().nonnegative()` for counts/order/day numbers, positive duration/week bounds, and finite numeric checks.

### Finding 29
- Category: failure-point
- Severity: medium
- Line numbers: 90-99, 124-154
- Description: Malformed `exercises_snapshot` or `cycle_snapshot` values are swallowed with `.catch(null)`. Corrupt shared content will silently lose its preview/detail data instead of surfacing a validation error or quarantine state.
- Suggested fix direction: Log/report parse failures and expose an explicit invalid-snapshot state, or only catch known legacy-null cases rather than every validation error.

## `src/schemas/goals.ts`

### Finding 30
- Category: bug
- Severity: medium
- Line numbers: 33-41
- Description: `createGoalSchema` omits `target_unit`, but `useCreateGoal` requires and inserts `target_unit`. Form data validated by this schema can still be incomplete for the mutation/database contract.
- Suggested fix direction: Add `target_unit` with an enum or constrained string to the create schema and keep the mutation argument type derived from the schema.

### Finding 31
- Category: failure-point
- Severity: medium
- Line numbers: 37-52
- Description: PR goal validation only checks truthiness of `exercise_name` and `deadline` is any string. Whitespace-only exercise names and invalid date strings pass schema validation.
- Suggested fix direction: Trim `exercise_name` before validating and validate/coerce deadlines as dates, optionally rejecting past deadlines if the product expects future targets.

## `src/schemas/onboarding.ts`

### Finding 32
- Category: failure-point
- Severity: low
- Line numbers: 10-17
- Description: `completed_at` and `created_at` use raw `new Date` transforms without checking validity, so invalid persisted date strings parse as `Invalid Date` instead of failing schema validation.
- Suggested fix direction: Use `z.coerce.date()` or add a finite-time refine after transformation.

## `src/schemas/recovery.ts`

### Finding 33
- Category: failure-point
- Severity: medium
- Line numbers: 8-11
- Description: Recovery session data accepts any numeric `total_volume`, including negative or non-finite values. Bad rows can skew ACWR/recovery calculations instead of being rejected at parse time.
- Suggested fix direction: Use `.finite().nonnegative()` for volume and validate `started_at` as a real date.

### Finding 34
- Category: failure-point
- Severity: medium
- Line numbers: 32-36
- Description: `wearableRecoverySchema` leaves `raw_data` as unrestricted `z.any()`. Downstream extraction must defensively handle every possible shape, and malformed provider payloads can move past the schema boundary undetected.
- Suggested fix direction: Define provider-specific raw-data schemas or a minimal normalized recovery payload schema; use `z.unknown()` plus safe narrowing instead of `z.any()`.

## `src/schemas/telemetry.ts`

### Finding 35
- Category: failure-point
- Severity: medium
- Line numbers: 26-32, 38-53
- Description: Telemetry and rep summary schemas do not enforce non-negative/finite constraints for timestamp, force, velocity, position, power, ROM, or time-under-tension values. Physically impossible or `Infinity`/`NaN` values can pass `z.number()` and poison charts/calculations.
- Suggested fix direction: Add `.finite()` and domain-specific bounds/non-negative constraints to telemetry metrics.

### Finding 36
- Category: failure-point
- Severity: low
- Line numbers: 64-70
- Description: `exerciseProgressSchema.recorded_at` uses `new Date(s)` without validity checks, so invalid timestamps parse successfully and later affect time-range filtering/sorting.
- Suggested fix direction: Use `z.coerce.date()` or a finite timestamp refine.

## `src/schemas/transforms.ts`

### Finding 37
- Category: bug
- Severity: medium
- Line numbers: 254-255
- Description: `routineExerciseSchema.is_amrap` is `z.boolean().optional().default(false)`, but the generated database type shows `routine_exercises.is_amrap` is `boolean | null`. Rows containing `null` will fail parsing even though this schema already handles `stall_detection` nulls correctly.
- Suggested fix direction: Change to `.boolean().nullish().transform((v) => v ?? false)` to match the database contract.

### Finding 38
- Category: bug
- Severity: medium
- Line numbers: 225-266
- Description: `routineExerciseSchema` omits `per_set_echo_levels` and `warmup_sets` even though those columns exist and are included in community snapshots/imports. Zod object parsing strips unknown keys by default, so routine detail parsing drops these fields before the UI can use them.
- Suggested fix direction: Add both fields to the schema with appropriate nullable JSON/string handling, or intentionally `.passthrough()` if unknown exercise metadata should survive parsing.

### Finding 39
- Category: failure-point
- Severity: medium
- Line numbers: 54-56, 75-80, 112-142, 164-169, 191-199, 218-219, 265, 287, 305-309, 323-327, 373-380, 397-401
- Description: Many date transforms use `new Date(s)` without validating the result. Invalid or malformed timestamps pass schema parsing as `Invalid Date`, causing later UI formatting, comparisons, and sorting to behave unpredictably.
- Suggested fix direction: Centralize an ISO date schema using `z.coerce.date()` or a transform+refine helper and reuse it across this file.

### Finding 40
- Category: failure-point
- Severity: medium
- Line numbers: 243-253, 358-359
- Description: Several JSON fields use `z.any()` and are accepted without shape validation (`per_set_weights`, `per_set_rest`, `per_set_reps`, `progression_settings`, `deload_settings`). Invalid shapes can pass the data layer and fail later in UI rendering or import/export paths.
- Suggested fix direction: Replace `z.any()` with `z.unknown()` plus explicit array/object schemas for each expected shape, and reject or quarantine malformed values.
