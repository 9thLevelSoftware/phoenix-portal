/**
 * Defensive ingress normalization for mobile-sync-push.
 *
 * WHY THIS EXISTS
 * ---------------
 * The push handler does many unguarded nested accesses like
 * `payload.sessions.flatMap(s => s.exercises.flatMap(e => e.sets.flatMap(...)))`.
 * When any nested array is missing (undefined/null) the handler throws
 * "Cannot read properties of undefined (reading 'map')" and returns 500.
 *
 * The mobile DTOs default every list to emptyList() and the client serializer
 * uses encodeDefaults=true, so in steady state every array IS present on the
 * wire. But:
 *   - Older mobile builds, truncated payloads, partial JSON parse, or
 *     third-party clients (tests, future integrations) can legally produce
 *     payloads missing a nested list.
 *   - Adding one guard per .map site is the whack-a-mole pattern that
 *     generated three prior regressions in this file. One ingress normalizer
 *     prevents the entire class.
 *
 * CONTRACT
 * --------
 * Output is shape-safe for every `.map` / `.flatMap` the handler performs.
 * Missing arrays become `[]`. Non-array values in array positions also become
 * `[]` (belt-and-suspenders against a client that sends null or a scalar).
 * Item content is otherwise untouched — validation of per-field values
 * (UUIDs, enums, ISO 8601, etc.) stays in the handler where the 400 error
 * messages already exist.
 */

type UnknownRecord = Record<string, unknown>;

function toArr(value: unknown): UnknownRecord[] {
	return Array.isArray(value) ? (value as UnknownRecord[]) : [];
}

function normalizeSet(raw: UnknownRecord): UnknownRecord {
	return {
		...raw,
		repSummaries: toArr(raw.repSummaries),
	};
}

function normalizeExercise(raw: UnknownRecord): UnknownRecord {
	return {
		...raw,
		sets: toArr(raw.sets).map(normalizeSet),
	};
}

function normalizeSession(raw: UnknownRecord): UnknownRecord {
	return {
		...raw,
		exercises: toArr(raw.exercises).map(normalizeExercise),
	};
}

function normalizeRoutine(raw: UnknownRecord): UnknownRecord {
	return {
		...raw,
		exercises: toArr(raw.exercises),
	};
}

function normalizeCycle(raw: UnknownRecord): UnknownRecord {
	return {
		...raw,
		days: toArr(raw.days),
	};
}

/**
 * Coerce every list field (top-level + nested) that the push handler
 * dereferences to an array. Returns a new object; does not mutate input.
 */
export function normalizePushPayloadShape<T extends UnknownRecord>(
	payload: T,
): T {
	return {
		...payload,
		sessions: toArr(payload.sessions).map(normalizeSession),
		telemetry: toArr(payload.telemetry),
		routines: toArr(payload.routines).map(normalizeRoutine),
		cycles: toArr(payload.cycles).map(normalizeCycle),
		badges: toArr(payload.badges),
		phaseStatistics: toArr(payload.phaseStatistics),
		exerciseSignatures: toArr(payload.exerciseSignatures),
		assessments: toArr(payload.assessments),
		externalActivities: toArr(payload.externalActivities),
		// allProfiles stays nullable (the handler branches on null vs array
		// and has separate fallback logic for legacy clients — don't force
		// it to [] or the fallback path will never fire).
	} as T;
}
