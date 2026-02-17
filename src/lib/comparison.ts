/**
 * Pure comparison computation for workout sessions.
 * No side effects, no API calls — just data in, result out.
 */

export interface SessionSummary {
	id: string;
	name: string;
	startedAt: Date;
	totalVolume: number;
	duration: number;
	exerciseCount: number;
	setCount: number;
	prCount: number;
	exercises: {
		name: string;
		volume: number;
		maxWeight: number;
		sets: number;
		avgVelocity: number;
	}[];
}

export interface ExerciseDelta {
	name: string;
	volumeA: number;
	volumeB: number;
	deltaPct: number;
	velocityA: number;
	velocityB: number;
	velocityDeltaPct: number;
	onlyInA: boolean;
	onlyInB: boolean;
}

export interface ComparisonResult {
	volumeDelta: number;
	durationDelta: number;
	exerciseDeltas: ExerciseDelta[];
	sharedExerciseCount: number;
	warning: string | null;
}

function pctChange(a: number, b: number): number {
	if (a === 0) return b === 0 ? 0 : 100;
	return ((b - a) / Math.abs(a)) * 100;
}

/**
 * Compare two workout sessions and produce deltas for volume, duration,
 * and per-exercise breakdowns including velocity.
 */
export function compareSessions(
	a: SessionSummary,
	b: SessionSummary,
): ComparisonResult {
	const volumeDelta = pctChange(a.totalVolume, b.totalVolume);
	const durationDelta = pctChange(a.duration, b.duration);

	// Build exercise maps keyed by lowercase name
	const exerciseMapA = new Map(
		a.exercises.map((e) => [e.name.toLowerCase(), e]),
	);
	const exerciseMapB = new Map(
		b.exercises.map((e) => [e.name.toLowerCase(), e]),
	);

	// Collect all unique exercise names (preserving original casing from A then B)
	const allNames = new Map<string, string>();
	for (const e of a.exercises) allNames.set(e.name.toLowerCase(), e.name);
	for (const e of b.exercises) {
		if (!allNames.has(e.name.toLowerCase())) {
			allNames.set(e.name.toLowerCase(), e.name);
		}
	}

	const exerciseDeltas: ExerciseDelta[] = [];
	let sharedExerciseCount = 0;

	for (const [key, displayName] of allNames) {
		const exA = exerciseMapA.get(key);
		const exB = exerciseMapB.get(key);

		const onlyInA = !!exA && !exB;
		const onlyInB = !exA && !!exB;

		if (exA && exB) sharedExerciseCount++;

		const volumeA = exA?.volume ?? 0;
		const volumeB = exB?.volume ?? 0;
		const velocityA = exA?.avgVelocity ?? 0;
		const velocityB = exB?.avgVelocity ?? 0;

		exerciseDeltas.push({
			name: displayName,
			volumeA,
			volumeB,
			deltaPct: onlyInA || onlyInB ? 0 : pctChange(volumeA, volumeB),
			velocityA,
			velocityB,
			velocityDeltaPct:
				onlyInA || onlyInB ? 0 : pctChange(velocityA, velocityB),
			onlyInA,
			onlyInB,
		});
	}

	const warning =
		sharedExerciseCount < 2
			? "These sessions share fewer than 2 exercises — comparison may not be meaningful"
			: null;

	return {
		volumeDelta,
		durationDelta,
		exerciseDeltas,
		sharedExerciseCount,
		warning,
	};
}
