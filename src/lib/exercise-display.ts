/**
 * Display-name helpers for exercises.
 *
 * Mobile "Just Lift" (freestyle) sessions are captured without a selected
 * catalog exercise. If the user never tags the session afterward, it syncs with
 * the placeholder name "Unknown Exercise" (and a null/blank name in some paths).
 * These are real lifts — just unlabeled — so we surface them honestly rather
 * than as a scary "Unknown Exercise".
 *
 * See: PortalSyncAdapter.kt (`name = session.exerciseName ?: "Unknown Exercise"`)
 * and the removal of Just Lift auto-detection in mobile PR #435.
 */

/** The raw placeholder mobile writes for an untagged Just Lift exercise. */
export const UNTAGGED_EXERCISE_RAW = "Unknown Exercise";
const UNTAGGED_EXERCISE_RAW_NORMALIZED = UNTAGGED_EXERCISE_RAW.toLowerCase();

/** User-facing label for an untagged Just Lift lift. */
export const UNTAGGED_EXERCISE_LABEL = "Just Lift (untagged)";

/**
 * Returns the user-facing exercise name, mapping the untagged Just Lift
 * placeholder (and null/blank names) to a friendly label. Any real exercise
 * name passes through unchanged.
 */
export function displayExerciseName(name?: string | null): string {
	const trimmed = name?.trim();
	if (!trimmed || trimmed.toLowerCase() === UNTAGGED_EXERCISE_RAW_NORMALIZED) {
		return UNTAGGED_EXERCISE_LABEL;
	}
	return trimmed;
}

/** True when the name represents an untagged Just Lift placeholder. */
export function isUntaggedExercise(name?: string | null): boolean {
	const trimmed = name?.trim();
	return !trimmed || trimmed.toLowerCase() === UNTAGGED_EXERCISE_RAW_NORMALIZED;
}
