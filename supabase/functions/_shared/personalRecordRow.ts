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

export interface PersonalRecordIdentityInput {
	local_profile_id?: string | null;
	exercise_name?: string | null;
	exercise_id?: string | null;
	achieved_at?: string | null;
	value?: number | string | null;
	record_type?: string | null;
	workout_phase?: string | null;
}

export function personalRecordIdentityKey(
	row: PersonalRecordIdentityInput,
): string {
	const profileKey = row.local_profile_id ?? "default";
	const exerciseKey = row.exercise_id
		? `id:${row.exercise_id}`
		: `name:${row.exercise_name ?? ""}`;
	return JSON.stringify([
		profileKey,
		exerciseKey,
		row.achieved_at ?? "",
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
