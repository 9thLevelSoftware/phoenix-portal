# Sync reliability wire contract

This additive contract keeps older mobile builds compatible. Missing arrays are
treated as empty. UUID fields use canonical UUID strings and timestamps use
ISO-8601.

## Push request additions

```ts
type WorkoutDeletionDto = {
  mutationId: string;
  scope: "COMPONENT" | "WORKOUT";
  portalSessionId: string;
  componentSessionId?: string | null;
  deletedAt: string;
};

type OwnershipTransferDto = {
  mutationId: string;
  sourceProfileId: string | null;
  targetProfileId: string;
  workoutSessionIds: string[];
  routineIds: string[];
  cycleIds: string[];
  personalRecordIds: string[];
};

type PushAdditions = {
  workoutDeletions?: WorkoutDeletionDto[];
  ownershipTransfers?: OwnershipTransferDto[];
  deletedCycles?: Array<{ id: string; updatedAt: string }>;
};
```

Legacy `deletedCycleIds` remain accepted so older mobile builds keep parsing.
They never hard-delete and they never write a cycle tombstone. Existing
server rows become structured cycle rejections so the sender keeps the
server copy. Ids with no server row are silent no-ops: they are neither
acknowledged nor rejected. Newer clients must send clocked `deletedCycles`
to prevent a later stale upload from recreating a locally deleted cycle.

`sourceProfileId: null` means a legacy unscoped server row. The target must be
a registered `local_profiles` id (`"default"` or UUID). The target is created
or refreshed only through the existing `profileId`/`profileName`/`allProfiles`
registration contract. A transfer must name at least one exact entity id.
Derived `exercise_progress` rows follow transferred workout session ids.
Exact ids that are still local-only are accepted and recorded as durable
account/profile ownership claims. Existing ids owned by another account, or
same-account ids that do not match the declared source, are rejected. A later
insert of a claimed id must use the claimed target profile; ordinary writes
cannot move the claim. This lets recovery include every stable local id without
guessing whether the row has reached the server.

`workoutSessionIds` contains portal parent `workout_sessions.id` values. The
mobile adapter derives each parent id as `routineSessionId ?: localSessionId`
and groups every component in that routine session into the same parent. It
does not contain component/local-session ids when those are children of a
grouped parent.

The push handler applies ownership transfers first, workout deletions second,
and active entity writes last. It does not clean stale profile registrations
until transfer source validation has completed. Mutation ids are idempotency
keys: replaying the same account and canonical body returns the same ack;
reusing an id with a different account or body is rejected.
An exact replay is acknowledged from the immutable operation ledger even if a
later device-registration cleanup removed the request/target profile row; only
a new operation requires current registration.

Profile preference documents are not ownership-transfer entities. Destination
settings remain unchanged and source settings are never merged. Because legacy
`allProfiles` omission cannot distinguish an explicit local profile deletion
from an orphan registration during recovery, stale registration cleanup keeps
any omitted profile that still owns `local_profile_preferences`, including on
later ordinary syncs. This prevents an omission from cascading preference
loss; deleting that retained cloud registration requires a future explicit
authenticated profile-delete contract.

Workout deletion is the exception to the last sentence: its request profile is
immutable routing metadata rather than authorization or identity. A device may
send a new deletion under its original `null | "default" | UUID` route after
that local profile registration was removed. The server retains that route in
the mutation hash and tombstone, validates the authenticated account and exact
target/component-parent relationship, and never rebinds it to the active
profile. Mobile groups all-owner deletion delivery by this original route.

## Push response additions

```ts
type PushResponseAdditions = {
  acknowledgedWorkoutSessionIds: string[];
  acknowledgedCycleIds: string[];
  acknowledgedWorkoutDeletionIds: string[];
  acknowledgedOwnershipTransferIds: string[];
  acknowledgedDeletedCycleIds: string[];
  clamped: Array<{
    entity: 'session';
    id: string;
    field: 'totalVolume' | 'durationSeconds' | 'startedAt';
    original: number | string;
    clamped: number | string;
  }>;
};
```

The workout-session and cycle arrays contain exact active parent ids accepted
and committed by their transactional LWW gates. The operation arrays contain
exact mutation ids, except `acknowledgedDeletedCycleIds`, which contains exact
cycle ids accepted by the clocked deletion gate. None are sync watermarks.

## Pull response additions

```ts
type PulledWorkoutDeletionDto = WorkoutDeletionDto & {
  profileId: string | null;
};

type OwnershipEventDto = OwnershipTransferDto & {
  targetProfileName: string;
  targetProfileColorIndex: number;
  transferredAt: string;
};

type PullResponseAdditions = {
  workoutDeletions: PulledWorkoutDeletionDto[];
  ownershipEvents: OwnershipEventDto[];
};
```

Deletion tombstones and ownership events are permanent, immutable,
account-level records. `profileId` routes a deletion into a device queue but
does not participate in tombstone identity. The server sources the target
profile name and color from the registered profile for devices missing that
metadata.

Both arrays use the existing opaque cursor and shared page size (75 default,
300 maximum). Entity order is sessions, routines, cycles, workout deletions,
ownership events, badges, stats, personal records, custom exercises. Deletions
order and incremental-filter by `(recorded_at, mutation_id)` — the server
commit time — and events by `(transferred_at, mutation_id)`. A late upload of
an older offline deletion still reaches devices whose `lastSync` is after the
client-supplied `deletedAt`. The wire `deletedAt` value remains that original
deletion timestamp.

## Server operations

- `transfer_profile_ownership(p_user_id uuid, p_transfers jsonb)`
- `verify_profile_recovery_source(p_source_profile_id text, p_workout_session_ids uuid[], p_routine_ids uuid[], p_cycle_ids uuid[], p_personal_record_ids uuid[], p_proof_workout_session_ids uuid[], p_proof_routine_ids uuid[], p_proof_cycle_ids uuid[], p_proof_personal_record_ids uuid[])`
- `apply_workout_deletions(p_user_id uuid, p_request_profile_id text, p_deletions jsonb)`
- `replace_session_components(p_user_id uuid, p_component_ids uuid[], p_exercises jsonb, p_sets jsonb, p_rep_summaries jsonb, p_rep_telemetry jsonb)`
- `upsert_workout_sessions_with_components(p_user_id uuid, p_enforce_lww boolean, p_rows jsonb, p_component_ids uuid[], p_exercises jsonb, p_sets jsonb, p_rep_summaries jsonb, p_rep_telemetry jsonb)`
- `delete_workout_with_tombstone(p_mutation_id uuid, p_portal_session_id uuid, p_component_session_id uuid, p_scope text, p_profile_id text, p_deleted_at timestamptz)`
- `delete_training_cycles_lww(p_user_id uuid, p_rows jsonb)`
- `upsert_training_cycles_with_days_lww(p_user_id uuid, p_rows jsonb, p_days jsonb)`

Workout identity is account plus `portalSessionId` and, for component scope,
`componentSessionId`; profile is never part of resurrection protection. The
portal session id is the actual grouped `workout_sessions.id` value
(`routineSessionId ?: local session id`). The component session id is the
stable local session id stored as the child `exercises.id`; its
`exercises.session_id` points to the portal parent. Component deletion removes
that exercise and its cascaded sets/reps, then recomputes the parent aggregate.
If a present component deletion removes the final server-side child, the same
transaction retains the immutable client COMPONENT tombstone, adds a separate
server-generated WORKOUT tombstone under a new mutation id using the original
route and deletion time, and removes the empty parent. The push acknowledges
only the client's original mutation id. Replaying that original body creates no
additional derived event. This covers concurrent devices that each deleted a
different member while both still observed a surviving sibling.
Incoming components replace only their exact `exercises.id` values; omitted
siblings under the same parent remain. Internal refresh/discard paths do not
call the tombstone RPC.

`verify_profile_recovery_source` is a direct authenticated, non-mutating proof
before an ownerless cloud-origin recovery group is bound to the current auth
account. Proof arrays must be nonempty subsets of the corresponding complete
group arrays, and every proof id must exist remotely as a matching entity row
or durable ownership claim. Other complete-group ids may be absent because
they are locally created and not uploaded yet; any remotely existing id with a
different account or source makes the aggregate verification false. Success
returns the authenticated owner id and proof count. Failure returns no owner
and no per-id foreign-versus-missing detail. Workout ids are portal parent ids.

Ownership events use a per-account transaction lock and strictly increasing
millisecond timestamps. Chained A→B→C transfers therefore pull and apply in
causal order even when mutation UUID lexical order is reversed.

Cycles continue to use the existing timestamp LWW contract. There is no CAS
revision protocol. A usable incoming `updatedAt` may create or replace only
when it is at least the stored timestamp. A missing/unusable timestamp may
create a new cycle but cannot overwrite an existing cycle. Rejected parents
gate all day writes, orphan cleanup, and deletion.

Cycle structure is complete and atomic under that parent gate. The additive
wire fields are:

```ts
type CycleProgressStateDto = {
  currentDayNumber: number;
  lastCompletedDate?: number | null; // epoch milliseconds
  cycleStartDate: number;            // epoch milliseconds
  lastAdvancedAt?: number | null;    // epoch milliseconds
  completedDays: number[];
  missedDays: number[];
  rotationCount: number;
};

type CycleAdditions = {
  progressionSettingsPresent?: boolean;
  progressionSettings?: string | null; // JSON document
  progressStatePresent?: boolean;
  progressState?: CycleProgressStateDto | null;
};

type CycleDayAdditions = {
  echoLevelPresent?: boolean;
  echoLevel?: string | null;
  eccentricLoadPercentPresent?: boolean;
  eccentricLoadPercent?: number | null;
};
```

For the newly added progress state and day modifiers, presence absent or false
preserves the stored value for legacy clients. Presence true with a value
replaces it; presence true with the value omitted or null clears it.
`progressionSettings` predates its presence bit, so a legacy non-null usable JSON
document remains an authoritative update even when the bit is absent or false;
legacy absent/null preserves the stored document. This representation supports
Kotlin serialization with `explicitNulls=false`. New complete-snapshot clients
send the presence flags as true. Pull always emits them as true, including
nullable values.

Clocked cycle deletions return exact accepted ids in
`acknowledgedDeletedCycleIds`. An account/cycle timestamp tombstone prevents an
older active upload from recreating a deleted cycle. A strictly newer active
edit may win and clears that tombstone. Legacy `deletedCycleIds` values have no
usable clock: absent ids are harmless no-ops, while existing ids are returned
as structured cycle rejections and are never hard-deleted.

The clocked delete is one database call, `delete_cycles_clocked`, which
compares the delete's clock with the stored LWW key (`client_updated_at`) and
deletes under the same per-cycle advisory lock every cycle write takes, so no
write can land between the comparison and the delete. A delete whose clock is
at least the stored key wins; a strictly newer stored key rejects it with that
key in `rejections.cycles[].serverUpdatedAt`. An id with no server row is
tombstoned and acknowledged.

### Tombstone clocks

`sync_tombstones` carries two clocks, mirroring the entities (two clocks,
never interchangeable):

- `client_deleted_at` is the delete's own clock: the device's `updatedAt` for
  a clocked cycle delete, `now()` for a portal delete or a legacy routine
  delete. It is what a later push is compared against.
- `deleted_at` is server-owned and stays the pull cursor for
  `deletedRoutineIds` / `deletedCycleIds`.

On push, `apply_sync_tombstone_gate` compares each pushed routine and cycle
with its tombstone, if any. The row is skipped (listed in `skippedDeleted`)
when its DTO `updatedAt` is missing or not strictly later than
`client_deleted_at`; a strictly later edit wins, is written normally and the
tombstone is removed in the same call. Receipt time never stands in for a
missing `updatedAt` here, so an undated push keeps losing to a delete. The
comparison is by instant, not by string.

The gate removes the tombstone in its own call, before the row is written. If
that push then fails (a retryable 503) before the write commits, the id is
neither tombstoned nor stored until the device retries. In that window a
stale push from another device is not stopped by the gate. The retry of the
newer edit still converges under LWW. Clearing the tombstone from an insert
trigger instead would close the window, but it would also erase the tombstone
of a delete that races the push, which is the one the R-4 re-delete check
looks for.

### Local profile ownership

A push that names a session or routine another local profile holds (stored
`local_profile_id` differs, with `NULL` meaning `"default"`) and carries no
`ownershipTransfers` entry for it gets a structured rejection in
`rejections.sessions` / `rejections.routines` with the stored LWW key, and
nothing of that row (children included) is written. Cycles get the same
rejection from `merge_training_cycles_from_push`. The push answers 200; the
transfer contract above is how a row moves between profiles.

### Outlier limits

A pushed session field past one of these limits is stored at the limit and
reported under `clamped`; the push still answers 200 (a 400 would be permanent
for mobile and strand the batch).

| Field | Limit |
| --- | --- |
| `totalVolume` | 1,000,000 kg (per cable, KD-8) |
| `durationSeconds` | 604,800 (7 days) |
| `startedAt` | at most 24 hours after the request is received; later values become the receipt time |

Values under those limits are stored as sent. The leaderboard refresh
(`refresh_leaderboard_snapshots`) then winsorizes at rank time: it ignores
sessions and PRs dated more than a day in the future, caps each session's
volume contribution at 100,000 kg, and recomputes streaks and workout counts
from non-future sessions only. Stored workout history is never rewritten by
ranking.

### Single-transaction push (SYNC_PUSH_TRANSACTION)

When the operator enables `SYNC_PUSH_TRANSACTION`, `mobile-sync-push` runs the
same writes, in the same order and with the same per-entity outcomes, inside one
Postgres transaction. Nothing in the request or response changes shape. What
changes is what a failure leaves behind:

- A push that answers `503 partial_write_retry` has committed **nothing**. With
  the flag off, earlier writes of that push may already be committed; the retry
  converges either way, so clients need no change.
- A `400` that depends on server state (ownership, parent existence) after the
  transaction opened also commits nothing.
- `sync_complete` is broadcast only after COMMIT.
- A write that the handler tolerates today (an optional table, a reported
  `failed` list) is still rolled back on its own and reported the same way; it
  never aborts the rest of the push.

