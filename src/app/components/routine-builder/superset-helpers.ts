// Superset grouping helpers for the routine builder.

export interface SupersetGroup {
	id: string;
	exerciseIds: string[];
	color: string;
	transitionTime: number; // seconds between exercises in superset
	restAfter: number; // rest after completing all exercises in superset
}

export const SUPERSET_COLORS = [
	{ id: "A", color: "#6366F1", name: "Indigo" },
	{ id: "B", color: "#EC4899", name: "Pink" },
	{ id: "C", color: "#10B981", name: "Green" },
	{ id: "D", color: "#F59E0B", name: "Amber" },
];

// Superset Helper Functions
export function getNextSupersetColor(
	existingSupersets: SupersetGroup[],
): string {
	const usedColors = existingSupersets.map((s) => s.color);
	const availableColor = SUPERSET_COLORS.find(
		(c) => !usedColors.includes(c.color),
	);
	return availableColor?.color || SUPERSET_COLORS[0].color;
}

export function isExerciseInSuperset(
	exerciseId: string,
	supersets: SupersetGroup[],
): SupersetGroup | null {
	return supersets.find((s) => s.exerciseIds.includes(exerciseId)) || null;
}

export function createSuperset(
	exerciseIds: string[],
	existingSupersets: SupersetGroup[],
): SupersetGroup {
	return {
		// Use a UUID so two supersets created in the same millisecond don't collide.
		id: `superset-${crypto.randomUUID()}`,
		exerciseIds,
		color: getNextSupersetColor(existingSupersets),
		transitionTime: 10,
		restAfter: 90,
	};
}

export function ungroupSuperset(
	supersetId: string,
	supersets: SupersetGroup[],
): SupersetGroup[] {
	return supersets.filter((s) => s.id !== supersetId);
}

export function addExerciseToSuperset(
	supersetId: string,
	exerciseId: string,
	supersets: SupersetGroup[],
): SupersetGroup[] {
	return supersets.map((s) => {
		if (s.id === supersetId) {
			// Idempotent: don't add a duplicate membership.
			if (s.exerciseIds.includes(exerciseId)) return s;
			return { ...s, exerciseIds: [...s.exerciseIds, exerciseId] };
		}
		// Remove the exercise from any other group so it can't be a member of two
		// supersets at once.
		if (s.exerciseIds.includes(exerciseId)) {
			return {
				...s,
				exerciseIds: s.exerciseIds.filter((id) => id !== exerciseId),
			};
		}
		return s;
	});
}
