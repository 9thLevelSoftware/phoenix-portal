/**
 * Build a personal_records row from mobile set-level PR derivation hints.
 *
 * The mobile DTO sends `prType`, `prPhase`, `prVolume` as SEND-ONLY fields
 * on each PortalSetDto. They are not persisted on the `sets` table — the
 * push handler reads them to construct `personal_records` rows. This helper
 * isolates the mapping so it can be unit-tested against the DB's NOT-NULL
 * DEFAULT guarantees and so future refactors can't silently drop a default.
 *
 * NOT-NULL-DEFAULT columns on personal_records (see
 * information_schema.columns, confirmed 2026-04-20):
 *   - record_type (DEFAULT '1RM')
 *   - muscle_group (DEFAULT 'General')
 *   - unit (DEFAULT 'kg')
 *   - achieved_at (DEFAULT now())
 *   - updated_at (DEFAULT now() — omitted from row, DB default applies)
 *
 * workout_phase is NULLABLE with DEFAULT 'COMBINED'; we still fill it so
 * the dedup key built in the caller is stable regardless of NULL handling.
 */

export interface PrSetInput {
	isPr?: boolean | null;
	prType?: string | null;
	prPhase?: string | null;
	prVolume?: number | null;
	weightKg: number;
	actualReps: number;
}

export interface PrExerciseInput {
	name: string;
	exerciseId?: string | null;
	muscleGroup?: string | null;
	sets: PrSetInput[];
}

export interface PrSessionInput {
	startedAt: string;
	exercises: PrExerciseInput[];
}

export interface PersonalRecordRow {
	id?: string;
	user_id: string;
	local_profile_id: string | null;
	exercise_name: string;
	exercise_id: string | null;
	muscle_group: string;
	record_type: string;
	value: number;
	weight_kg?: number | null;
	reps?: number | null;
	unit: string;
	session_id?: string | null;
	achieved_at: string;
	updated_at?: string;
	deleted_at?: string | null;
	workout_phase: string;
}

export interface DedicatedPersonalRecordInput {
	id?: string | null;
	userId?: string | null;
	exerciseName: string;
	exerciseId?: string | null;
	muscleGroup?: string | null;
	recordType?: string | null;
	value?: number | null;
	volume?: number | null;
	weightKg?: number | null;
	reps?: number | null;
	workoutPhase?: string | null;
	sessionId?: string | null;
	achievedAt?: string | null;
	updatedAt?: string | null;
	deletedAt?: string | null;
	localProfileId?: string | null;
	workoutMode?: string | null;
}

export interface LocalProfileRepairRow {
	user_id: string;
	id: string;
	name: string;
	color_index: number;
	device_id: string;
	updated_at: string;
}

interface PostgresErrorLike {
	code?: string | null;
}

interface PersonalRecordProfileReference {
	localProfileId?: string | null;
}

export function isPostgresForeignKeyViolation(
	error: PostgresErrorLike | null | undefined,
): boolean {
	return error?.code === "23503";
}

export function collectDedicatedRecordLocalProfileIds(
	records: readonly PersonalRecordProfileReference[],
): string[] {
	const ids: string[] = [];
	const seen = new Set<string>();
	for (const record of records) {
		const id = record.localProfileId;
		if (typeof id !== "string" || id.length === 0 || seen.has(id)) continue;
		seen.add(id);
		ids.push(id);
	}
	return ids;
}

export function shouldValidatePersonalRecordProfileIdsForPush(input: {
	allProfiles?: readonly unknown[] | null;
	localProfileId?: string | null;
	personalRecords?: readonly PersonalRecordProfileReference[] | null;
}): boolean {
	if (input.allProfiles && input.allProfiles.length > 0) return true;
	if (input.localProfileId != null) {
		return true;
	}
	return collectDedicatedRecordLocalProfileIds(input.personalRecords ?? [])
		.length > 0;
}

export function shouldRepairDedicatedRecordLocalProfilesForPush(input: {
	allProfiles?: readonly unknown[] | null;
	localProfileId?: string | null;
	validLocalProfileIds: ReadonlySet<string>;
	missingLocalProfileIds: readonly string[];
}): boolean {
	if (input.missingLocalProfileIds.length === 0) return false;
	if (input.allProfiles && input.allProfiles.length > 0) return false;
	if (input.localProfileId == null) return true;
	return !input.validLocalProfileIds.has(input.localProfileId);
}

export function chunkLocalProfileIdsForRepair(
	profileIds: readonly string[],
	chunkSize = 100,
): string[][] {
	if (chunkSize <= 0) {
		throw new Error("chunkSize must be greater than 0");
	}

	const chunks: string[][] = [];
	for (let i = 0; i < profileIds.length; i += chunkSize) {
		chunks.push(profileIds.slice(i, i + chunkSize));
	}
	return chunks;
}

export function buildLocalProfileRepairRowsForDedicatedRecords(
	profileIds: readonly string[],
	userId: string,
	deviceId: string,
	updatedAt: string,
): LocalProfileRepairRow[] {
	const rows: LocalProfileRepairRow[] = [];
	const seen = new Set<string>();
	for (const id of profileIds) {
		if (!id || seen.has(id)) continue;
		seen.add(id);
		rows.push({
			user_id: userId,
			id,
			name: id === "default" ? "Default" : "Profile",
			color_index: 0,
			device_id: deviceId,
			updated_at: updatedAt,
		});
	}
	return rows;
}

export function partitionPersonalRecordRowsByLocalProfileValidity(
	rows: readonly PersonalRecordRow[],
	validLocalProfileIds: ReadonlySet<string>,
): {
	validRows: PersonalRecordRow[];
	invalidProfileRows: PersonalRecordRow[];
	rowsWithInvalidProfilesNulled: PersonalRecordRow[];
} {
	const validRows: PersonalRecordRow[] = [];
	const invalidProfileRows: PersonalRecordRow[] = [];
	const rowsWithInvalidProfilesNulled: PersonalRecordRow[] = [];

	for (const row of rows) {
		const localProfileId = row.local_profile_id;
		if (localProfileId !== null && !validLocalProfileIds.has(localProfileId)) {
			invalidProfileRows.push(row);
			rowsWithInvalidProfilesNulled.push({ ...row, local_profile_id: null });
		} else {
			validRows.push(row);
			rowsWithInvalidProfilesNulled.push(row);
		}
	}

	return { validRows, invalidProfileRows, rowsWithInvalidProfilesNulled };
}

/**
 * Partition personal_records rows by whether their `session_id` references a
 * row that is valid/owned for the current push.
 *
 * Background (Issue #532): `personal_records.session_id` is a foreign key
 * to `workout_sessions.id`. A mobile push can carry personal_records that
 * reference a `workout_session` owned by a different user, or that simply
 * does not exist on the server (e.g. the parent sync was rejected, the row
 * was deleted, or the device is replaying an old payload). The existing
 * local_profile_id FK retry partition was not paralleled for `session_id`,
 * so an FK violation on `session_id` was raised to the caller and the whole
 * push failed.
 *
 * Rules (mirroring partitionPersonalRecordRowsByLocalProfileValidity):
 *  - `session_id === null` → preserved (the FK is satisfied when the column
 *    is nullable; the row is treated as valid).
 *  - `session_id` in `validSessionIds` → preserved.
 *  - `session_id` absent from `validSessionIds` → placed in
 *    `invalidSessionRows` and returned in
 *    `rowsWithInvalidSessionsNulled` with `session_id: null`. This is the
 *    FK-safe retry payload.
 */
export function partitionPersonalRecordRowsBySessionValidity(
	rows: readonly PersonalRecordRow[],
	validSessionIds: ReadonlySet<string>,
): {
	validRows: PersonalRecordRow[];
	invalidSessionRows: PersonalRecordRow[];
	rowsWithInvalidSessionsNulled: PersonalRecordRow[];
} {
	const validRows: PersonalRecordRow[] = [];
	const invalidSessionRows: PersonalRecordRow[] = [];
	const rowsWithInvalidSessionsNulled: PersonalRecordRow[] = [];

	for (const row of rows) {
		const sessionId = row.session_id;
		if (sessionId !== null && sessionId !== undefined && !validSessionIds.has(sessionId)) {
			invalidSessionRows.push(row);
			rowsWithInvalidSessionsNulled.push({ ...row, session_id: null });
		} else {
			validRows.push(row);
			rowsWithInvalidSessionsNulled.push(row);
		}
	}

	return { validRows, invalidSessionRows, rowsWithInvalidSessionsNulled };
}

export function partitionPersonalRecordRowsByExerciseCatalogValidity(
	rows: readonly PersonalRecordRow[],
	validExerciseIds: ReadonlySet<string>,
): {
	validRows: PersonalRecordRow[];
	invalidExerciseRows: PersonalRecordRow[];
	rowsWithInvalidExercisesNulled: PersonalRecordRow[];
} {
	const validRows: PersonalRecordRow[] = [];
	const invalidExerciseRows: PersonalRecordRow[] = [];
	const rowsWithInvalidExercisesNulled: PersonalRecordRow[] = [];

	for (const row of rows) {
		const exerciseId = row.exercise_id;
		if (exerciseId !== null && !validExerciseIds.has(exerciseId)) {
			invalidExerciseRows.push(row);
			rowsWithInvalidExercisesNulled.push({ ...row, exercise_id: null });
		} else {
			validRows.push(row);
			rowsWithInvalidExercisesNulled.push(row);
		}
	}

	return {
		validRows,
		invalidExerciseRows,
		rowsWithInvalidExercisesNulled,
	};
}

export interface ExerciseCatalogDisplayRow {
	id: string;
	name?: string | null;
	display_name?: string | null;
}

function catalogExerciseLabel(
	catalog: ExerciseCatalogDisplayRow,
): string | null {
	const displayName = catalog.display_name?.trim();
	if (displayName) return displayName;
	const name = catalog.name?.trim();
	return name || null;
}

export function hydratePersonalRecordExerciseNamesFromCatalog(
	rows: readonly PersonalRecordRow[],
	catalogRows: readonly ExerciseCatalogDisplayRow[],
): PersonalRecordRow[] {
	const catalogById = new Map<string, ExerciseCatalogDisplayRow>();
	for (const catalog of catalogRows) {
		if (catalog.id) {
			catalogById.set(catalog.id, catalog);
		}
	}

	return rows.map((row) => {
		const rawName = row.exercise_name.trim();
		const explicitExerciseId = row.exercise_id?.trim() || null;
		const catalog =
			(explicitExerciseId ? catalogById.get(explicitExerciseId) : undefined) ??
			catalogById.get(rawName);
		if (!catalog) return row;

		const label = catalogExerciseLabel(catalog);
		if (!label) return row;

		const nameIsCatalogId =
			rawName.length === 0 ||
			rawName === catalog.id ||
			(explicitExerciseId !== null && rawName === explicitExerciseId);
		if (!nameIsCatalogId) return row;

		return {
			...row,
			exercise_name: label,
			exercise_id: explicitExerciseId ?? catalog.id,
		};
	});
}

export interface PersonalRecordSessionExerciseDisplayRow {
	id: string;
	session_id: string;
	name?: string | null;
	exercise_id?: string | null;
}

function isIdentifierShaped(value: string): boolean {
	return (
		/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
			value,
		) ||
		(/^[A-Za-z0-9_-]{12,}$/.test(value) && /\d/.test(value))
	);
}

export function hydratePersonalRecordExerciseNamesFromSessionExercises(
	rows: readonly PersonalRecordRow[],
	exerciseRows: readonly PersonalRecordSessionExerciseDisplayRow[],
): PersonalRecordRow[] {
	const exerciseBySessionAndId = new Map<
		string,
		PersonalRecordSessionExerciseDisplayRow
	>();

	for (const exercise of exerciseRows) {
		if (!exercise.session_id || !exercise.id) continue;
		exerciseBySessionAndId.set(
			`${exercise.session_id}:${exercise.id}`,
			exercise,
		);
		if (exercise.exercise_id) {
			exerciseBySessionAndId.set(
				`${exercise.session_id}:${exercise.exercise_id}`,
				exercise,
			);
		}
	}

	return rows.map((row) => {
		const rawName = row.exercise_name.trim();
		const sessionId = row.session_id ?? null;
		if (!sessionId || !isIdentifierShaped(rawName)) return row;

		const exercise = exerciseBySessionAndId.get(`${sessionId}:${rawName}`);
		const exerciseName = exercise?.name?.trim();
		if (!exercise || !exerciseName) return row;

		return {
			...row,
			exercise_name: exerciseName,
			exercise_id: row.exercise_id ?? exercise.exercise_id ?? null,
		};
	});
}

export interface PersonalRecordIdentityInput {
	id?: string | null;
	local_profile_id?: string | null;
	exercise_name?: string | null;
	exercise_id?: string | null;
	achieved_at?: string | null;
	value?: number | string | null;
	record_type?: string | null;
	workout_phase?: string | null;
}

/**
 * Stable dedup/identity key for a personal_records row.
 *
 * Dedicated mobile PRs carry a stable `id`; two distinct dedicated records for
 * the same profile/exercise/timestamp/type/phase but different `id` (and
 * possibly different `value`) are legitimately distinct rows and MUST NOT
 * collapse into one (Finding F335). So when an `id` is present we key on it.
 *
 * Legacy set-derived rows have no `id` — for those we fall back to the derived
 * (profile, exercise, achieved_at, record_type, workout_phase) identity, which
 * is what both the payload-side dedup and the existing-row lookup rely on. The
 * existing-row lookup selects `id`, so DB rows and dedicated payload rows match
 * on `id` consistently.
 */
export function personalRecordIdentityKey(
	row: PersonalRecordIdentityInput,
): string {
	if (typeof row.id === "string" && row.id.length > 0) {
		return JSON.stringify(["id", row.id]);
	}
	return personalRecordDerivedIdentityKey(row);
}

/**
 * Normalize an achieved_at timestamp for identity comparison.
 *
 * Root cause of the 2026-07-07 rate_limit_exceeded incident: mobile sends
 * achieved_at as kotlin `Instant.toString()` ("2026-06-10T00:32:58.187Z")
 * while PostgREST returns the stored timestamptz with an explicit offset
 * ("2026-06-10T00:32:58.187+00:00"). Comparing the raw strings meant an
 * id-less re-pushed PR never matched its existing DB row, so every sync
 * inserted a fresh duplicate (observed: 361k personal_records rows for
 * ~4k logical PRs, which then blew up pull pagination past the rate limit).
 *
 * Parse both representations to epoch milliseconds so any two strings
 * denoting the same instant produce the same key. Unparseable values fall
 * back to the raw string so malformed data still gets a stable identity.
 */
function normalizeAchievedAtForIdentity(
	value: string | null | undefined,
): string {
	if (!value) return "";
	const epochMs = Date.parse(value);
	return Number.isNaN(epochMs) ? value : `ts:${epochMs}`;
}

/**
 * Identity key derived purely from (profile, exercise, achieved_at, record_type,
 * workout_phase), ignoring `id`. Legacy set-derived PR payload rows have no
 * `id`, so to dedupe them against existing DB rows (which always have an `id`)
 * the existing rows must ALSO be indexed under this derived key — otherwise a
 * legacy row never matches and the non-dedicated insert path duplicates it on
 * every re-sync.
 */
export function personalRecordDerivedIdentityKey(
	row: PersonalRecordIdentityInput,
): string {
	const profileKey = row.local_profile_id ?? "default";
	const exerciseKey = row.exercise_id
		? `id:${row.exercise_id}`
		: `name:${row.exercise_name ?? ""}`;
	return JSON.stringify([
		profileKey,
		exerciseKey,
		normalizeAchievedAtForIdentity(row.achieved_at),
		row.record_type ?? "",
		row.workout_phase ?? "COMBINED",
	]);
}

function unitForRecordType(recordType: string): string {
	return recordType === "MAX_VOLUME" ? "kg×reps" : "kg";
}

function valueForDedicatedRecord(
	record: DedicatedPersonalRecordInput,
	recordType: string,
): number {
	if (record.value != null) return record.value;
	if (recordType === "MAX_VOLUME") {
		if (record.volume != null) return record.volume;
		if (record.weightKg != null && record.reps != null) {
			return record.weightKg * record.reps;
		}
	}
	return record.weightKg ?? 0;
}

/**
 * Resolve a per-record `localProfileId` against a caller-supplied set of
 * valid local profile IDs for the current push.
 *
 * Background (Issue #507): mobile-sync-push sanitizes the top-level
 * `localProfileId` when a local profile upsert fails, but dedicated
 * `personalRecords` can carry their own `record.localProfileId`. A stale
 * or invalid per-record ID bypasses the sanitized handler fallback and
 * trips the `fk_personal_records_profile` foreign key on upsert.
 *
 * Rules:
 *  - `undefined` → fall back to the handler-sanitized `localProfileId`.
 *  - Explicit `null` → preserved as `null` (caller intentionally has no
 *    profile; the FK is satisfied when `local_profile_id` is nullable).
 *  - String ID present in `validLocalProfileIds` → preserved.
 *  - String ID absent from `validLocalProfileIds` → fall back to the
 *    handler-sanitized `localProfileId` when that fallback is also valid,
 *    otherwise null it out. This is the FK-safe behavior.
 *
 * When `validLocalProfileIds` is `null` the helper preserves the
 * historical behavior: any defined string ID is trusted. This keeps
 * call sites that don't yet know about the current push's profile set
 * working unchanged.
 */
export function resolveDedicatedRecordLocalProfileId(
	recordLocalProfileId: string | null | undefined,
	handlerLocalProfileId: string | null,
	validLocalProfileIds: ReadonlySet<string> | null,
): string | null {
	if (recordLocalProfileId === undefined) {
		if (validLocalProfileIds === null || handlerLocalProfileId === null) {
			return handlerLocalProfileId;
		}
		return validLocalProfileIds.has(handlerLocalProfileId)
			? handlerLocalProfileId
			: null;
	}
	if (recordLocalProfileId === null) {
		return null;
	}
	if (validLocalProfileIds === null) {
		return recordLocalProfileId;
	}
	if (validLocalProfileIds.has(recordLocalProfileId)) {
		return recordLocalProfileId;
	}
	if (
		handlerLocalProfileId !== null &&
		validLocalProfileIds.has(handlerLocalProfileId)
	) {
		return handlerLocalProfileId;
	}
	return null;
}

export function buildDedicatedPersonalRecordRows(
	records: DedicatedPersonalRecordInput[],
	userId: string,
	localProfileId: string | null,
	validLocalProfileIds: ReadonlySet<string> | null = null,
): PersonalRecordRow[] {
	return records.map((record) => {
		const recordType = record.recordType ?? "1RM";
		const row: PersonalRecordRow = {
			user_id: userId,
			local_profile_id: resolveDedicatedRecordLocalProfileId(
				record.localProfileId,
				localProfileId,
				validLocalProfileIds,
			),
			exercise_name: record.exerciseName,
			exercise_id: record.exerciseId ?? null,
			muscle_group: record.muscleGroup ?? "General",
			record_type: recordType,
			value: valueForDedicatedRecord(record, recordType),
			weight_kg: record.weightKg ?? null,
			reps: record.reps ?? null,
			unit: unitForRecordType(recordType),
			session_id: record.sessionId ?? null,
			achieved_at: record.achievedAt ?? new Date().toISOString(),
			workout_phase: record.workoutPhase ?? "COMBINED",
		};

		if (record.id) row.id = record.id;
		if (record.updatedAt) row.updated_at = record.updatedAt;
		if (record.deletedAt !== undefined) row.deleted_at = record.deletedAt;
		return row;
	});
}

export function buildPersonalRecordRowsForPush(
	sessions: PrSessionInput[],
	personalRecords: DedicatedPersonalRecordInput[],
	userId: string,
	localProfileId: string | null,
	validLocalProfileIds: ReadonlySet<string> | null = null,
): PersonalRecordRow[] {
	if (personalRecords.length > 0) {
		return buildDedicatedPersonalRecordRows(
			personalRecords,
			userId,
			localProfileId,
			validLocalProfileIds,
		);
	}

	return buildPersonalRecordRows(sessions, userId, localProfileId);
}

export function buildPersonalRecordRows(
	sessions: PrSessionInput[],
	userId: string,
	localProfileId: string | null,
): PersonalRecordRow[] {
	const rows: PersonalRecordRow[] = [];

	for (const session of sessions) {
		for (const exercise of session.exercises) {
			for (const set of exercise.sets) {
				if (!set.isPr) continue;

				const recordType = set.prType ?? "1RM";
				const value = recordType === "MAX_VOLUME"
					? (set.prVolume ?? set.weightKg * set.actualReps)
					: set.weightKg;

				rows.push({
					user_id: userId,
					local_profile_id: localProfileId,
					exercise_name: exercise.name,
					exercise_id: exercise.exerciseId ?? null,
					muscle_group: exercise.muscleGroup ?? "General",
					record_type: recordType,
					value,
					weight_kg: set.weightKg,
					reps: set.actualReps,
					unit: unitForRecordType(recordType),
					achieved_at: session.startedAt,
					workout_phase: set.prPhase ?? "COMBINED",
				});
			}
		}
	}

	return rows;
}
