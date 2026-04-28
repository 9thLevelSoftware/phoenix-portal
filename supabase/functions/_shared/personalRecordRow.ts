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
	muscleGroup?: string | null;
	sets: PrSetInput[];
}

export interface PrSessionInput {
	startedAt: string;
	exercises: PrExerciseInput[];
}

export interface PersonalRecordRow {
	user_id: string;
	local_profile_id: string | null;
	exercise_name: string;
	muscle_group: string;
	record_type: string;
	value: number;
	unit: string;
	achieved_at: string;
	workout_phase: string;
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
				const value =
					recordType === "MAX_VOLUME"
						? (set.prVolume ?? set.weightKg * set.actualReps)
						: set.weightKg;

				rows.push({
					user_id: userId,
					local_profile_id: localProfileId,
					exercise_name: exercise.name,
					muscle_group: exercise.muscleGroup ?? "General",
					record_type: recordType,
					value,
					unit: recordType === "MAX_VOLUME" ? "kg×reps" : "kg",
					achieved_at: session.startedAt,
					workout_phase: set.prPhase ?? "COMBINED",
				});
			}
		}
	}

	return rows;
}
