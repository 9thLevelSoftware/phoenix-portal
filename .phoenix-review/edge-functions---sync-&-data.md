# Edge Functions - Sync & Data Review

Scope: Review sync Edge Functions: mobile sync push/pull, process sync queue, exercise progress, RPG schema.

Files reviewed:
- `supabase/functions/_shared/syncPayloadShape.ts`
- `supabase/functions/_shared/syncPlatform.ts`
- `supabase/functions/_shared/exerciseProgressRows.ts`
- `supabase/functions/_shared/personalRecordRow.ts`
- `supabase/functions/_shared/rpgSchema.ts`
- `supabase/functions/_shared/pushPayloadSchema.ts`
- `supabase/functions/mobile-sync-push/index.ts`
- `supabase/functions/mobile-sync-pull/index.ts`
- `supabase/functions/mobile-integration-sync/index.ts`
- `supabase/functions/process-sync-queue/index.ts`

Summary: 30 findings (critical: 1, high: 7, medium: 19, low: 3).

---

## `supabase/functions/_shared/syncPayloadShape.ts`

### Finding 1
- Category: bug
- Severity: medium
- Line numbers: 33-68
- Description: `toArr()` only verifies that the container is an array, then casts every element to `UnknownRecord`. If an array contains `null` or `undefined` elements, `normalizeSession`, `normalizeExercise`, `normalizeSet`, etc. dereference properties such as `raw.exercises` and can throw before the normalizer produces a safe shape. This undermines the stated defensive-ingress contract for malformed third-party or truncated payloads.
- Suggested fix direction: Filter array items to non-null objects before passing them to normalizers, or coerce non-object elements to `{}` / reject them consistently at schema validation.

### Finding 2
- Category: failure-point
- Severity: low
- Line numbers: 76-91
- Description: `normalizePushPayloadShape()` is no longer used by the production `mobile-sync-push` handler; repository search found only tests importing it. Keeping a second, stale ingress normalizer beside `pushPayloadSchema` creates drift risk: future fixes may land in one path while the live path uses the other.
- Suggested fix direction: Either remove this helper and its tests after confirming the Zod schema fully replaces it, or wire it into the handler explicitly and keep a single source of truth for ingress shape normalization.

---

## `supabase/functions/_shared/syncPlatform.ts`

### Finding 3
- Category: failure-point
- Severity: low
- Line numbers: 1-9
- Description: `normalizeSyncPlatform()` returns arbitrary trimmed/lowercased strings for non-Android/iOS inputs, while the live `platformSchema` in `pushPayloadSchema.ts` canonicalizes those same inputs to `unknown`. The two platform normalization contracts now disagree, so any future caller of this shared helper can persist values the current push schema would not emit.
- Suggested fix direction: Align `normalizeSyncPlatform()` with `platformSchema` (`android`/`ios`/`unknown` only), or delete the unused helper and keep `describeSyncPlatformInput()` as the only export.

---

## `supabase/functions/_shared/exerciseProgressRows.ts`

### Finding 4
- Category: failure-point
- Severity: medium
- Line numbers: 70-109
- Description: The row builder stores negative or otherwise nonsensical set metrics if they pass through validation. `max_weight_kg`, `total_volume_kg`, and `max_reps` are calculated directly from `weightKg` and `actualReps`; the shared push schema currently accepts negative numbers, so a malformed client can write negative volume/progress snapshots.
- Suggested fix direction: Enforce non-negative finite bounds in `pushPayloadSchema` for weights, reps, durations, volumes, and set counts before calling this builder; optionally defensively clamp/reject in the builder for testability.

---

## `supabase/functions/_shared/personalRecordRow.ts`

### Finding 5
- Category: bug
- Severity: medium
- Line numbers: 401-414
- Description: `personalRecordIdentityKey()` excludes `id`, `value`, `weight_kg`, and `reps`. The push handler later dedupes by this identity, so two distinct records for the same profile/exercise/timestamp/type/phase but different value or ID collapse into one. This can drop legitimate PR rows from a dense workout or from dedicated mobile records.
- Suggested fix direction: Deduplicate dedicated PRs by stable `id` first when present, and only use the derived identity as a fallback for legacy set-derived rows. Include enough fields to distinguish legitimate same-timestamp records if fallback dedupe is retained.

### Finding 6
- Category: failure-point
- Severity: medium
- Line numbers: 421-432, 490-520
- Description: Dedicated personal records with missing `value` are silently converted to `weightKg ?? 0` (or computed volume only for `MAX_VOLUME`). A malformed dedicated record can therefore insert a zero-value PR instead of failing validation, and non-volume record types ignore `reps` even when the intended value is not raw weight.
- Suggested fix direction: Require `value` for dedicated records, or validate record-type-specific inputs in `pushPayloadSchema` before row construction. Reject records that cannot produce a meaningful positive PR value.

---

## `supabase/functions/_shared/rpgSchema.ts`

### Finding 7
- Category: failure-point
- Severity: medium
- Line numbers: 8-10, 32-40
- Description: The file documents `roundRpgFloats()` as the boundary guard for both push and pull, but repository search found no production import. Push duplicates rounding inline after schema parsing, while pull duplicates `Math.round(...)` inline. Worse, push schema currently rejects non-integer RPG numbers before the inline rounding can run.
- Suggested fix direction: Use `roundRpgFloats()` directly in both push and pull projections, and adjust schema validation to accept finite numbers before rounding if float repair is the intended contract.

---

## `supabase/functions/_shared/pushPayloadSchema.ts`

### Finding 8
- Category: bug
- Severity: high
- Line numbers: 71-77, 396-418
- Description: `arrayOf()` converts any non-array value to `[]`. If a buggy client sends `sessions`, `routines`, `personalRecords`, or other sync sections as an object/string instead of an array, the handler accepts the payload, silently drops that section, and can return a successful sync response. That is dangerous for a sync endpoint because clients may advance their local sync timestamp after the server discarded data.
- Suggested fix direction: Coerce only `undefined`/`null` to `[]` for backward compatibility, but reject non-array non-null values with a 400 and a field path.

### Finding 9
- Category: bug
- Severity: medium
- Line numbers: 273-282
- Description: RPG attributes use `z.number().int()`, so payloads containing finite floats are rejected before `mobile-sync-push` can run its documented RPG rounding logic. This contradicts `_shared/rpgSchema.ts`, which says float rounding at push write is the defensive boundary.
- Suggested fix direction: Accept finite numbers in the schema and transform with `Math.round`, or remove the rounding contract and make strict integer rejection explicit everywhere.

### Finding 10
- Category: failure-point
- Severity: medium
- Line numbers: 141-178, 229-271, 291-294, 337-345, 353-368, 370-392
- Description: Timestamp fields are validated as plain strings rather than datetime strings. Invalid dates can pass schema parsing and fail later as Postgres timestamp errors or produce inconsistent sync/cursor behavior.
- Suggested fix direction: Use a shared ISO-8601/datetime validator or transform for all wire timestamps (`startedAt`, `updatedAt`, `earnedAt`, `createdAt`, `syncedAt`, etc.) and return a 400 with the field path before any writes begin.

### Finding 11
- Category: failure-point
- Severity: medium
- Line numbers: 104-178, 190-218, 242-271, 273-345, 353-368
- Description: Many numeric fields accept any number with no non-negative/domain bounds: reps, weights, durations, counts, RPG level/XP, sample counts, confidence, heart rates, etc. Negative or out-of-range values can be persisted and then propagated back to mobile.
- Suggested fix direction: Add schema-level `.nonnegative()`, `.positive()`, `.min()`, `.max()`, and finite-value checks matching the mobile DTO/domain constraints.

---

## `supabase/functions/mobile-sync-push/index.ts`

### Finding 12
- Category: failure-point
- Severity: medium
- Line numbers: 830-880, 1075-1271
- Description: Custom exercises are upserted before the later cross-user ownership and parent-reference validation block. If a later validation rejects the payload, the function can still leave custom catalog rows committed from an otherwise failed push.
- Suggested fix direction: Move all pure validation/ownership checks before any writes, or wrap the entire push in a database RPC transaction so partial writes roll back on later rejection.

### Finding 13
- Category: bug
- Severity: high
- Line numbers: 1385-1400, 1403-1614
- Description: Existing exercises for accepted sessions are deleted before replacement child rows and progress rows are inserted, but the sequence is not transactional. Any later failure in exercise/set/rep summary/telemetry/progress writes returns an error after prior workout details have already been deleted.
- Suggested fix direction: Replace the hierarchy inside a single SQL transaction/RPC, or use a safe upsert-then-cleanup pattern where stale child rows are removed only after all replacement rows have been written successfully.

### Finding 14
- Category: bug
- Severity: high
- Line numbers: 1294-1296, 1541-1564, 2211-2233
- Description: LWW rejection filtering is applied to exercises/sets/rep summaries, but not to top-level telemetry or phase statistics. When a session is rejected by the LWW gate, telemetry whose `setId` belongs to the rejected payload is still upserted and can hit FK errors; phase statistics for rejected sessions are also still written because `sessionIdSet` treats payload sessions as valid even when the LWW RPC declined the parent update.
- Suggested fix direction: Build accepted set/session ID sets after LWW filtering and skip telemetry/phase statistics whose parents were rejected. Return those skips in the LWW rejection metadata so mobile can repair on pull.

### Finding 15
- Category: failure-point
- Severity: medium
- Line numbers: 2229-2233, 2253-2257, 2288-2293
- Description: `session_phase_statistics`, `exercise_signatures`, and `vbt_assessments` write errors are logged as warnings while the overall push still succeeds. A client can believe these entities synced and move on even though the server dropped them.
- Suggested fix direction: Treat these writes like the core sync writes: fail the request with a retryable response or return explicit per-entity rejection/error details that the client uses to retry.

### Finding 16
- Category: bug
- Severity: medium
- Line numbers: 2343-2383
- Description: In the LWW external activity path, returned rows are mapped back to request metadata by `r.id`. The RPC returns `existing_id` for updates to an existing `(user_id, provider, external_id)` row. If the existing server ID differs from the client-supplied local ID, `byIdx.get(r.id)` misses and the acknowledgement returns empty `externalId`/`provider`, with `localId` set to the server ID rather than the client local ID.
- Suggested fix direction: Have the RPC return provider/external_id and client-submitted ID, or map acknowledgements by `(provider, external_id)` instead of returned physical ID.

### Finding 17
- Category: error
- Severity: medium
- Line numbers: 2492-2506
- Description: The catch block returns raw internal error messages to clients and maps any message containing `upsert failed` or `insert failed` to HTTP 400. Transient DB/service failures can therefore be misclassified as client errors, and internal table/function details are exposed in the response body.
- Suggested fix direction: Return sanitized error codes/messages, distinguish validation/FK conflict errors from transient server failures, and keep detailed DB messages only in server logs.

---

## `supabase/functions/mobile-sync-pull/index.ts`

### Finding 18
- Category: error
- Severity: medium
- Line numbers: 312, 337, 1163-1168
- Description: Request JSON parsing and `lastSync` date conversion are not validated locally. Invalid JSON or a malformed/non-numeric `lastSync` falls into the broad catch and returns a 500 instead of a precise 400.
- Suggested fix direction: Wrap `req.json()` separately and validate `lastSync` as a finite epoch milliseconds number before calling `toISOString()`.

### Finding 19
- Category: failure-point
- Severity: medium
- Line numbers: 354-365
- Description: `pageSize` is capped only with `Math.min`; zero or negative values are accepted. That can produce an empty successful response with `hasMore: false`, allowing a client to update sync state while receiving no data.
- Suggested fix direction: Clamp `pageSize` to `[1, MAX_PAGE_SIZE]` or reject values outside the supported range with a 400.

### Finding 20
- Category: error
- Severity: high
- Line numbers: 482-507, 646-675, 780-809, 892-913, 997-1021, 1040-1072
- Description: Multiple database read errors are only logged or ignored while the function continues and returns success. Child session reads (`exercises`, `sets`, `rep_summaries`), routines, cycles, badges, personal records, local profiles, external activities, RPG stats, and gamification stats can be omitted from the response without failing the pull. In sync code this is a data-loss risk because clients may treat the pull as authoritative.
- Suggested fix direction: Check every Supabase query's `error` and fail the pull with a retryable 5xx or explicit partial-failure response. Do not return successful sync data when required child/entity reads failed.

### Finding 21
- Category: bug
- Severity: high
- Line numbers: 1024-1037
- Description: `personalRecordDtos` omits `exerciseId` and `localProfileId` even though the RPC/query returns `exercise_id` and `local_profile_id` and push accepts those fields. Pulling a personal record can therefore lose its catalog exercise linkage and profile scope on the mobile side.
- Suggested fix direction: Include `exerciseId: pr.exercise_id ?? null` and `localProfileId: pr.local_profile_id ?? null` in the DTO, with corresponding mobile DTO handling/tests.

### Finding 22
- Category: failure-point
- Severity: medium
- Line numbers: 937-1073
- Description: `personalRecords`, `localProfiles`, and `externalActivities` are fetched wholesale on the final `stats` page and do not consume `remainingPageSize`. Large accounts can receive responses far beyond the configured page size, reintroducing timeout/body-size risk and making pagination semantics misleading.
- Suggested fix direction: Add these entity types to `ENTITY_ORDER` with cursors/limits, or enforce separate caps and cursors for the final-page collections.

---

## `supabase/functions/mobile-integration-sync/index.ts`

### Finding 23
- Category: failure-point
- Severity: medium
- Line numbers: 374-436
- Description: The `connect` path stores the encrypted API key and marks the integration connected before validating the key against the provider. If provider validation then fails, the invalid secret remains in `oauth_tokens` and the integration status is set to `error`.
- Suggested fix direction: Fetch/validate provider activities first, then persist the API key and connected status only after validation succeeds. If persistence-before-validation is required, delete the token on validation failure.

### Finding 24
- Category: error
- Severity: high
- Line numbers: 438-451, 515-528, 554-587
- Description: `persistActivities()` logs per-row upsert failures but does not propagate them. Both `connect` and `sync` then update `last_sync_at` and return success even if activities failed to persist, causing imported workout data to be skipped on future syncs.
- Suggested fix direction: Make `persistActivities()` return failure details or throw when any row fails, and only advance `last_sync_at` after persistence succeeds.

### Finding 25
- Category: error
- Severity: medium
- Line numbers: 467-483
- Description: The stored-token lookup ignores the Supabase `error` field. A database error is indistinguishable from a missing API key and returns a 400 "Connect first" response, which is misleading and non-retryable.
- Suggested fix direction: Capture `{ data, error }`, return a 5xx/retryable response for DB errors, and reserve the 400 missing-key response for a successful lookup with no token.

### Finding 26
- Category: failure-point
- Severity: medium
- Line numbers: 537-542
- Description: The top-level catch returns `(err as Error).message` directly to the mobile client. Internal crypto, database, provider, or parsing errors can leak implementation details and produce inconsistent client-facing errors.
- Suggested fix direction: Log detailed errors server-side and return sanitized error codes/messages by class (`invalid_api_key`, `provider_unavailable`, `internal_error`, etc.).

---

## `supabase/functions/process-sync-queue/index.ts`

### Finding 27
- Category: bug
- Severity: critical
- Line numbers: 98-127
- Description: Pending tasks are selected and then updated to `processing` in separate non-conditional statements. Two cron invocations can read the same pending rows, both mark them processing, and both call the provider sync function, duplicating external API calls and writes.
- Suggested fix direction: Claim tasks atomically with a database RPC using `FOR UPDATE SKIP LOCKED`, or update with `WHERE id = ... AND status = 'pending'` and proceed only if one row was changed.

### Finding 28
- Category: failure-point
- Severity: high
- Line numbers: 123-127, 144-200
- Description: A task marked `processing` has no lease/timeout recovery. If the function crashes, times out, or the process is killed after line 126 and before the catch updates the row, that task remains `processing` forever and will not be picked up by later runs that only query `status = 'pending'`.
- Suggested fix direction: Add a stale-processing reclaim query based on `started_at`, or use leased claims with `locked_until` and retry expired leases.

### Finding 29
- Category: bug
- Severity: medium
- Line numbers: 83-96, 164-165, 246-277
- Description: Provider-level rate limiting is non-atomic. The processor reads the current counter, processes tasks, then increments with a separate read/update path. Concurrent processors can all pass `isRateLimited()` and then overrun provider limits. New inserts also omit the `key` column introduced by the per-user rate-limit migration, increasing schema drift risk.
- Suggested fix direction: Replace the read/update sequence with a single SQL RPC that checks and increments the provider counter under row lock, and populate `key = provider` for provider-level rows.

### Finding 30
- Category: failure-point
- Severity: low
- Line numbers: 78, 93-95
- Description: `results.skipped` is initialized but not incremented when a provider is skipped due to rate limiting. The response underreports skipped providers/tasks, reducing observability for scheduler health.
- Suggested fix direction: Increment `skipped` by the number of tasks deferred, or at least by one per rate-limited provider, and include provider names in the response for diagnostics.
