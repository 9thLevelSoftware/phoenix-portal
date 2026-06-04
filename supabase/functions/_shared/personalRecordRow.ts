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
	const profileKey = row.local_profile_id ?? "__no_profile__";
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

export function buildDedicatedPersonalRecordRows(
	records: DedicatedPersonalRecordInput[],
	userId: string,
	localProfileId: string | null,
): PersonalRecordRow[] {
	return records.map((record) => {
		const recordType = record.recordType ?? "1RM";
		const row: PersonalRecordRow = {
			user_id: userId,
			local_profile_id:
				record.localProfileId === undefined
					? localProfileId
					: record.localProfileId,
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
): PersonalRecordRow[] {
	if (personalRecords.length > 0) {
		return buildDedicatedPersonalRecordRows(
			personalRecords,
			userId,
			localProfileId,
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
