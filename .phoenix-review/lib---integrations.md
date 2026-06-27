# Lib - Integrations Review

Reviewed files:
- `src/lib/integrations/types.ts`
- `src/lib/integrations/normalize.ts`
- `src/lib/integrations/oauthRedirect.ts`
- `src/lib/integrations/rate-limits.ts`
- `src/lib/integrations/strava.ts`
- `src/lib/integrations/garmin.ts`
- `src/lib/integrations/fitbit.ts`
- `src/lib/integrations/hevy.ts`
- `src/lib/integrations/strong.ts`
- `src/lib/integrations/export-csv.ts`

Validation performed:
- `npm run typecheck -- --pretty false` passed.
- `npm test -- src/lib/integrations` passed: 2 test files, 9 tests.
- An initial `npm test -- src/lib/integrations --runInBand` attempt failed because Vitest does not support `--runInBand`; reran without that flag.

## `src/lib/integrations/types.ts`

No findings.

## `src/lib/integrations/normalize.ts`

### Finding 1
- Category: bug
- Severity: high
- Line numbers: 18-37
- Description: `IntegrationProvider` includes `strong` and `liftosaur`, but `normalizeActivity()` has no cases for either provider. Passing either valid provider falls through to the default branch and throws `Unknown integration provider`, so shared code cannot safely dispatch all declared integration providers.
- Suggested fix direction: Add provider-specific handling for `strong` and `liftosaur`, or narrow this dispatcher's accepted type to only providers that actually support web normalization. Consider an exhaustive `never` check so future provider additions fail at compile time until dispatch support is added.

## `src/lib/integrations/oauthRedirect.ts`

No findings.

## `src/lib/integrations/rate-limits.ts`

### Finding 2
- Category: failure-point
- Severity: medium
- Line numbers: 5-13
- Description: The shared client-side `RATE_LIMITS` map omits `liftosaur` even though `liftosaur` is a declared provider and the sync queue processes Liftosaur tasks. Any caller using this shared map for provider throttling will run Liftosaur sync without a provider-specific cap.
- Suggested fix direction: Add a Liftosaur entry consistent with the server-side queue limit, or derive both client and Edge Function limits from one source so provider additions cannot diverge.

### Finding 3
- Category: failure-point
- Severity: low
- Line numbers: 19-32
- Description: `isRateLimited()` assumes `window_started_at` is always a valid date string and `requests_this_window` is always a number. The database types for rate-limit tracking allow those fields to be nullable, and malformed timestamps produce unreliable comparisons, which can fail open or fail closed depending on the stored values.
- Suggested fix direction: Accept nullable tracking fields, validate `window_started_at` with `Number.isFinite()`, coerce missing request counts to 0, and treat corrupt tracking rows as an expired/reset window rather than relying on JavaScript date coercion.

## `src/lib/integrations/strava.ts`

### Finding 4
- Category: bug
- Severity: low
- Line numbers: 16, 20, 62, 68
- Description: Optional Strava metrics are defaulted to `0` in the Zod schema, then written as real zero values. Missing `distance` or `total_elevation_gain` becomes indistinguishable from an actual zero-distance or zero-elevation activity, which can skew analytics and UI summaries.
- Suggested fix direction: Keep optional provider fields nullable through normalization: remove the schema defaults and emit `null` when Strava omits the field.

### Finding 5
- Category: bug
- Severity: low
- Line numbers: 63-65
- Description: Calorie conversion uses a truthiness check on `activity.kilojoules`. A valid value of `0` kilojoules is normalized to `null` instead of `0`, which incorrectly marks known zero-energy data as missing.
- Suggested fix direction: Use `activity.kilojoules != null` before converting so zero remains zero while only null/undefined becomes missing.

## `src/lib/integrations/garmin.ts`

### Finding 6
- Category: bug
- Severity: high
- Line numbers: 14-15, 66-69
- Description: The code comments `startTimeInSeconds` as Unix epoch seconds, but then adds `startTimeOffsetInSeconds` before converting to ISO. If `startTimeInSeconds` is already an absolute epoch timestamp, applying the timezone offset shifts every Garmin activity by the local offset and stores the wrong `started_at` time.
- Suggested fix direction: Store `new Date(activity.startTimeInSeconds * 1000).toISOString()` as the canonical UTC timestamp. Keep `startTimeOffsetInSeconds` only for optional local-time display if needed.

### Finding 7
- Category: stub
- Severity: medium
- Line numbers: 93-95
- Description: The Garmin OAuth path is marked "ready but untested until credentials are available." This is a known unverified integration path in production-facing code, so failures may only surface when credentials are finally provisioned.
- Suggested fix direction: Add a mocked Edge Function/OAuth initiation test now and a credential-backed smoke test or feature flag before exposing the Garmin connect button as active.

## `src/lib/integrations/fitbit.ts`

### Finding 8
- Category: bug
- Severity: medium
- Line numbers: 16-17, 63-65
- Description: The schema captures `distanceUnit`, but normalization always treats `distance` as kilometers and multiplies by 1000. Fitbit responses can carry unit information, so mile-based or other-unit distances would be imported as the wrong number of meters.
- Suggested fix direction: Convert based on `distanceUnit` (`Kilometer`/`km`, `Mile`/`mi`, meters if applicable) and return `null` or fail validation for unsupported units rather than assuming kilometers.

## `src/lib/integrations/hevy.ts`

### Finding 9
- Category: failure-point
- Severity: medium
- Line numbers: 89-115, 246-260
- Description: CSV and API normalization build `Date` objects and call `toISOString()` without validating that `start_time`/`end_time` parsed successfully. A malformed date in one row or workout throws `RangeError: Invalid time value` and can abort the entire import instead of skipping/reporting the bad item.
- Suggested fix direction: Validate parsed dates with `Number.isFinite(date.getTime())` before generating IDs or ISO strings. Skip invalid workouts with a user-visible parse error summary, or return structured per-row errors from the parser.

### Finding 10
- Category: stub
- Severity: medium
- Line numbers: 214-240
- Description: The Hevy API normalizer is explicitly documented as `API structure is TBD`, but it still validates against a concrete guessed schema. If the real API response differs, valid workouts will be rejected by Zod or normalized incorrectly.
- Suggested fix direction: Replace the placeholder schema with the documented/current Hevy API contract and add fixture tests from real or captured API responses. If the API contract is not stable, gate the API path and rely on CSV import until it is verified.

## `src/lib/integrations/strong.ts`

### Finding 11
- Category: failure-point
- Severity: medium
- Line numbers: 112-136
- Description: `parseStrongCSV()` constructs a `Date` from each workout's `Date` field and immediately calls `toISOString()` without checking validity. A single malformed or locale-specific date in a Strong export can throw and cancel the whole CSV import.
- Suggested fix direction: Validate `startTime.getTime()` before using it. Report invalid rows/workouts in a parse summary and continue importing valid workouts where possible.

### Finding 12
- Category: bug
- Severity: low
- Line numbers: 125-138
- Description: Strong `Distance` values are summed and stored directly as `distance_meters`, but the parser has no distance-unit handling. If Strong exports distance in the user's configured unit rather than meters, imported cardio distances will be incorrect.
- Suggested fix direction: Add an import distance-unit option or parse the unit from the export format, then convert to meters before populating `distance_meters`.

## `src/lib/integrations/export-csv.ts`

### Finding 13
- Category: failure-point
- Severity: medium
- Line numbers: 117-124
- Description: Export batches set lookup by exercise IDs, but it does not batch the earlier `.in("session_id", sessionIds)` exercise query. Large accounts with many sessions can exceed PostgREST URL/query-size limits or practical `.in()` limits before reaching the batched set query.
- Suggested fix direction: Batch the exercise lookup by `sessionIds` as well, using the same chunking pattern as the set lookup, then merge the results before building maps.

### Finding 14
- Category: bug
- Severity: low
- Line numbers: 74-78, 183
- Description: `formatDate()` converts the stored ISO timestamp using the browser's local timezone. The same exported workout can shift date/time depending on where the browser runs, which is especially risky when `started_at` is already stored as a canonical UTC timestamp.
- Suggested fix direction: Decide whether Strong export should use UTC or the user's workout timezone, and format explicitly for that timezone instead of relying on the runtime's local timezone.
