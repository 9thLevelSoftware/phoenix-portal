/**
 * exercise_progress row builder.
 *
 * Source of truth for estimated 1RM is the MOBILE app, which ships
 * `estimatedOneRepMaxKg` per exercise. This builder stores that value
 * verbatim. It only recomputes (via the canonical hybrid) when the field is
 * absent — i.e. legacy payloads from pre-parity mobile builds.
 *
 * PARITY-CRITICAL: estimateOneRepMaxKg must match mobile
 * OneRepMaxCalculator.estimate (Brzycki for reps <= 10, Epley for reps > 10).
 */

export interface ProgressSetInput {
	weightKg: number;
	actualReps: number;
}

export interface ProgressExerciseInput {
	name: string;
	exerciseId?: string | null;
	estimatedOneRepMaxKg?: number | null;
	/**
	 * Velocity-based (VBT) estimated 1RM (per-cable kg), computed on-device by the
	 * mobile app from BLE mean concentric velocity. SEPARATE from the rep-based
	 * estimatedOneRepMaxKg; stored verbatim (no recompute, no fallback) and null
	 * when absent. Issue #517 Phase 6.
	 */
	velocityEstimatedOneRepMaxKg?: number | null;
	sets: ProgressSetInput[];
}

export interface ProgressSessionInput {
	id: string;
	startedAt: string;
	exercises: ProgressExerciseInput[];
}

export interface ExerciseProgressRow {
	user_id: string;
	local_profile_id: string | null;
	exercise_name: string;
	exercise_id: string | null;
	session_id: string;
	recorded_at: string;
	max_weight_kg: number;
	total_volume_kg: number;
	estimated_1rm_kg: number;
	velocity_estimated_1rm_kg: number | null;
	max_reps: number;
	set_count: number;
}

/** Canonical hybrid 1RM estimate (per-cable kg). Continuous at reps == 10. */
export function estimateOneRepMaxKg(weightKg: number, reps: number): number {
	if (weightKg <= 0 || reps <= 0) return 0;
	if (reps === 1) return weightKg;
	if (reps <= 10) return weightKg * (36 / (37 - reps));
	return weightKg * (1 + reps / 30);
}

/** 2dp only for the sets fallback — never applied to a mobile verbatim value. */
function roundTo2dp(value: number): number {
	return Math.round(value * 100) / 100;
}

function bestEstimateFromSets(sets: ProgressSetInput[]): number {
	let best = 0;
	for (const s of sets) {
		const e1rm = estimateOneRepMaxKg(s.weightKg, s.actualReps);
		if (e1rm > best) best = e1rm;
	}
	return roundTo2dp(best);
}

export function buildExerciseProgressRows(
	sessions: ProgressSessionInput[],
	userId: string,
	localProfileId: string | null,
): ExerciseProgressRow[] {
	const rows: ExerciseProgressRow[] = [];
	for (const session of sessions) {
		for (const exercise of session.exercises) {
			if (exercise.sets.length === 0) continue;

			// pushPayloadSchema enforces non-negative weights/reps at ingress, but
			// clamp defensively here too so a direct (non-HTTP) caller cannot write
			// negative progress snapshots that then propagate back to mobile on
			// pull (Finding F334).
			const maxWeight = Math.max(
				0,
				...exercise.sets.map((s) => Math.max(0, s.weightKg)),
			);
			const totalVolume = exercise.sets.reduce(
				(sum, s) => sum + Math.max(0, s.weightKg) * Math.max(0, s.actualReps),
				0,
			);
			const maxReps = Math.max(
				0,
				...exercise.sets.map((s) => Math.max(0, s.actualReps)),
			);
			const setCount = exercise.sets.length;

			// Mobile estimate is stored verbatim, including 0. Only recompute
			// (and round to 2dp) when the field is absent from the payload.
			const estimated1rm =
				exercise.estimatedOneRepMaxKg != null
					? exercise.estimatedOneRepMaxKg
					: bestEstimateFromSets(exercise.sets);

			rows.push({
				user_id: userId,
				local_profile_id: localProfileId,
				exercise_name: exercise.name,
				exercise_id: exercise.exerciseId ?? null,
				session_id: session.id,
				recorded_at: session.startedAt,
				max_weight_kg: maxWeight,
				total_volume_kg: totalVolume,
				estimated_1rm_kg: estimated1rm,
				// Velocity-based estimate stored verbatim — never recomputed, no
				// fallback. Null when the mobile payload omits it (legacy / no
				// passing VBT estimate). Distinct from estimated_1rm_kg above.
				velocity_estimated_1rm_kg: exercise.velocityEstimatedOneRepMaxKg ?? null,
				max_reps: maxReps,
				set_count: setCount,
			});
		}
	}
	return rows;
}
