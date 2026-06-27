# Data Layer - Queries Review

Scope: TanStack Query options in `src/queries/*` for caching, stale-while-revalidate behavior, error handling, and query key management.

Reviewed files: 25
Findings: 25 total — 1 high, 10 medium, 14 low.
Verification: `npm test -- --run src/queries/__tests__` passed (15 files, 101 tests).

## src/queries/analytics.ts

### Finding 1
- Category: bug
- Severity: high
- Line numbers: 377-394
- Description: `vbtAssessmentsOptions(userId, exerciseId)` filters by `user_id` in the query function but the query key only contains `exerciseId`. If a user signs out/in or a shared component asks for the same exercise under a different user, TanStack Query can serve the previous user's cached VBT assessments. The query is also enabled with only `!!exerciseId`, so it can run with an empty `userId`.
- Suggested fix direction: Include `userId` in the query key and gate with `enabled: !!userId && !!exerciseId`; preferably add a dedicated `queryKeys.analytics.vbtAssessments(userId, exerciseId)` factory.

### Finding 2
- Category: bug
- Severity: medium
- Line numbers: 148-152, 189-194, 210-212, 246-248, 288-290, 320-322
- Description: `periodToDays("all")` returns `3650`, so several analytics options labeled as `all` actually fetch only the last ten years. `volumeTrendOptions` treats `period === "all"` as truly unbounded, making the semantics inconsistent across analytics widgets and silently dropping older history.
- Suggested fix direction: Treat `all` as a sentinel that skips the date filter for every period-aware analytics query, or rename/limit the UI period so it is explicit that it means ten years.

## src/queries/benchmarks.ts

### Finding 3
- Category: bug
- Severity: medium
- Line numbers: 20-30
- Description: `benchmarkOptions(metricType, metricKey?)` accepts an optional `metricKey`, but when it is omitted the Supabase query only filters by `metric_type` and still calls `.single()`. The schema has a unique key on `(metric_type, metric_key)`, not on `metric_type` alone, so metric types with multiple keys will return multiple rows and `.single()` will fail.
- Suggested fix direction: Either require `metricKey` for this detail query, use `.maybeSingle()` only when the full unique key is supplied, or return a list when `metricKey` is omitted.

## src/queries/biomechanics.ts

### Finding 4
- Category: failure-point
- Severity: low
- Line numbers: 12-55
- Description: `sessionAsymmetryOptions` has no `enabled: !!sessionId` guard even though an empty session id produces a distinct cache key and a query against `session_id = ""`. Other session-scoped options in the codebase guard against this.
- Suggested fix direction: Add `enabled: !!sessionId` to the returned options or require all callers to override it consistently.

## src/queries/body-intelligence.ts

### Finding 5
- Category: failure-point
- Severity: low
- Line numbers: 9-19, 47-62
- Description: Both query options accept caller-controlled identifiers/ranges but do not guard invalid input. `bodyIntelligenceOptions` will run with an empty `userId` or a negative/invalid `days` value, and `sessionSetWeightsOptions` will run with an empty `sessionId`.
- Suggested fix direction: Gate on valid identifiers (`!!userId`, `!!sessionId`) and clamp/validate `days` to a positive finite range before building the query.

## src/queries/challenges.ts

### Finding 6
- Category: bug
- Severity: medium
- Line numbers: 39-52
- Description: The progress query key only includes `challengeId` and `userId`, but the result also depends on `challengeType`, `targetValue`, `startDate`, and `endDate`. If challenge metadata changes while the id remains stable, React Query can serve stale progress computed with old dates/type/target.
- Suggested fix direction: Include every parameter that affects the query function in the query key, or key by a version/updated timestamp from the challenge row.

### Finding 7
- Category: failure-point
- Severity: medium
- Line numbers: 56-113
- Description: `challengeType` is a plain string and the switch has no default/error path. Unknown or newly added challenge types silently return `current = 0` and a valid-looking 0% progress result.
- Suggested fix direction: Narrow `challengeType` to a union/schema enum and throw or return an explicit unsupported-state result in the default case.

## src/queries/comments.ts

No findings.

## src/queries/community.ts

### Finding 8
- Category: bug
- Severity: medium
- Line numbers: 23-24, 101-108
- Description: `FeedSort` supports `"hot"`, but the implementation only special-cases `"new"`; both `"hot"` and `"top"` are ordered by `vote_count` then `shared_at`. The `hot_score` column is selected but never used, so the hot feed is not actually hot-ranked.
- Suggested fix direction: Sort `"hot"` by `hot_score` (with a deterministic tie-breaker), keep `"top"` on `vote_count`, and keep `"new"` on `shared_at`.

### Finding 9
- Category: error
- Severity: low
- Line numbers: 53-69
- Description: `hydrateProfiles` ignores the Supabase error from the `public_profiles` lookup. A failed profile hydration query is indistinguishable from all creators having no public profile, which hides backend/RLS regressions and renders incomplete feed data without surfacing an error state.
- Suggested fix direction: Capture `{ data, error }`, throw or return a recoverable partial-result marker when `error` is present, and add a test for profile hydration failures.

### Finding 10
- Category: failure-point
- Severity: low
- Line numbers: 256-267
- Description: `userVotesOptions` returns a mutable `Set` from the query function. Storing mutable/non-serializable data in the query cache makes accidental in-place mutation easy and can defeat structural-sharing expectations.
- Suggested fix direction: Return a stable array of voted ids from the query and construct a `Set` in the component with `useMemo`, or freeze/wrap the result behind a read-only helper.

## src/queries/cycles.ts

### Finding 11
- Category: failure-point
- Severity: low
- Line numbers: 32-48
- Description: `cycleDetailOptions` does not include `enabled: !!cycleId`. Reusing the options directly with a missing id will issue `.single()` for `id = ""` and surface a Supabase error instead of remaining idle.
- Suggested fix direction: Add the same enabled guard used by other detail queries, or document that every caller must supply its own enabled predicate.

## src/queries/exercises.ts

### Finding 12
- Category: failure-point
- Severity: medium
- Line numbers: 36-40
- Description: Search text is interpolated directly into a PostgREST `.or()` expression. `%`, `_`, and backslash are escaped, but `.or()` syntax is also sensitive to delimiters such as commas and parentheses. User search strings containing those characters can produce malformed filters or unintended conditions.
- Suggested fix direction: Use a Postgres RPC/full-text search helper, encode/sanitize all PostgREST operator delimiters, or split into safer individual filters where possible.

## src/queries/freshness.ts

### Finding 13
- Category: bug
- Severity: medium
- Line numbers: 27-36
- Description: The query orders by `updated_at` and then reports that row's `started_at` as `lastWorkoutStartedAt`. Editing or resyncing an older workout makes the freshness strip report that older workout as the last started workout, even if newer sessions exist.
- Suggested fix direction: Fetch latest `updated_at` and latest `started_at` separately, or order by `started_at` when deriving `lastWorkoutStartedAt`.

## src/queries/goals.ts

No findings.

## src/queries/insights.ts

### Finding 14
- Category: failure-point
- Severity: low
- Line numbers: 5-19
- Description: `insightsOptions` lacks an `enabled: !!userId` guard. Direct reuse with an empty user id still creates and executes a query for `user_id = ""`.
- Suggested fix direction: Add `enabled: !!userId` to match the guarded query options in neighboring files.

## src/queries/integrations.ts

### Finding 15
- Category: failure-point
- Severity: low
- Line numbers: 10-24, 31-55
- Description: Both integration query options require `userId` but do not gate empty ids. Components that forget to override `enabled` can create cached empty-user queries and unnecessary Supabase requests.
- Suggested fix direction: Add `enabled: !!userId` to both options; for provider-specific activity queries also keep the provider in the key as already done.

## src/queries/keys.ts

No findings.

## src/queries/localProfiles.ts

### Finding 16
- Category: failure-point
- Severity: low
- Line numbers: 14-28
- Description: `localProfilesOptions` requires a user id but has no enabled guard, so an unauthenticated/loading auth state can issue `local_profiles` queries for `user_id = ""` if a caller does not add its own guard.
- Suggested fix direction: Add `enabled: !!userId` to the query options.

## src/queries/onboarding.ts

### Finding 17
- Category: failure-point
- Severity: low
- Line numbers: 10-26, 33-45
- Description: `onboardingOptions` and `hasWorkoutsOptions` both require `userId` but do not gate empty ids. During auth initialization this can cache null/zero results under the empty-user key if a caller forgets to override `enabled`.
- Suggested fix direction: Add `enabled: !!userId` to both options.

## src/queries/personal-record-normalization.ts

No findings.

## src/queries/profile.ts

### Finding 18
- Category: failure-point
- Severity: medium
- Line numbers: 43-66, 98-132
- Description: `profileStatsOptions` and `topExercisesOptions` fetch all workout sessions/exercises and aggregate client-side with no limit or server-side aggregation. Long-lived users can pull very large histories into the browser just to compute counts, streaks, and top five exercises.
- Suggested fix direction: Move counts/sums/top-exercise aggregation into SQL/RPC/views with profile filtering, and keep query results bounded.

## src/queries/progress.ts

### Finding 19
- Category: failure-point
- Severity: low
- Line numbers: 35-59
- Description: `exerciseProgressOptions` will execute with an empty `userId` or empty `exerciseName`; both are required for a meaningful result and both are part of the query key.
- Suggested fix direction: Add `enabled: !!userId && !!exerciseName` or validate inputs before constructing options.

## src/queries/records.ts

### Finding 20
- Category: failure-point
- Severity: low
- Line numbers: 10-34
- Description: `personalRecordsOptions` has no `enabled: !!userId` guard. Direct reuse during auth loading can query and cache an empty-user record list.
- Suggested fix direction: Add `enabled: !!userId` to the options.

## src/queries/recovery.ts

### Finding 21
- Category: bug
- Severity: medium
- Line numbers: 62-76
- Description: `activeCyclePositionOptions` is user-scoped only and has no `profileId` parameter, while adjacent cycle/routine/workout queries are local-profile aware. In multi-profile accounts, recovery can show an active cycle position from another local profile.
- Suggested fix direction: Accept optional `profileId`, include it in the query key, and filter `training_cycles.local_profile_id` when provided.

## src/queries/replay.ts

### Finding 22
- Category: failure-point
- Severity: low
- Line numbers: 9-34, 40-66
- Description: Replay session and telemetry options do not include `enabled` guards for their required ids. Current callers add their own guards, but the options are easy to misuse and will otherwise run `.single()`/telemetry requests with empty ids.
- Suggested fix direction: Add `enabled: !!sessionId` and `enabled: !!setId` directly to the option factories.

## src/queries/routines.ts

### Finding 23
- Category: failure-point
- Severity: low
- Line numbers: 26-42
- Description: `routineDetailOptions` does not include `enabled: !!routineId`. A missing id produces an active `.single()` query for `id = ""` rather than an idle query.
- Suggested fix direction: Add `enabled: !!routineId` or enforce non-empty ids before calling this factory.

## src/queries/telemetry.ts

### Finding 24
- Category: failure-point
- Severity: low
- Line numbers: 8-20, 24-36
- Description: `repTelemetryOptions` and `repSummariesOptions` lack `enabled: !!setId` guards. Empty set ids create active queries and cache entries even though the result cannot be meaningful.
- Suggested fix direction: Add `enabled: !!setId` to both options.

## src/queries/workouts.ts

### Finding 25
- Category: bug
- Severity: medium
- Line numbers: 176-183
- Description: `sessionDetailOptions` passes `exerciseIds` directly to `.in("exercise_id", exerciseIds)`. Unlike `comparisonDetailOptions`, it does not handle the empty-exercise case. A valid session with zero exercises can produce an invalid/fragile PostgREST `in ()` filter instead of returning the session with an empty exercise list.
- Suggested fix direction: Mirror the comparison query's guard (`exerciseIds.length > 0 ? exerciseIds : ["_none_"]`) or skip the sets query and use `[]` when there are no exercises.
