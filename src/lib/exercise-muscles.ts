export interface MuscleActivation {
	group: string;
	displayName?: string;
	activation: number;
}

export interface ExerciseProfile {
	primary: MuscleActivation;
	secondary: MuscleActivation[];
}

// Equipment/modality prefixes — always strip (they add no semantic meaning).
const STRIP_EQUIPMENT = /^(db|bb|cable|machine)\s+/i;
// Positional prefixes — only strip when something else follows them (i.e., there
// is still more than one word remaining after stripping, OR another equipment
// prefix follows immediately so the inner loop will handle it).
const STRIP_POSITIONAL = /^(seated|standing|incline|decline)\s+/i;
const STRIP_PARENS = /\s*\(.*\)\s*$/;

export function normalizeExerciseName(name: string): string {
	let result = name.trim().toLowerCase().replace(STRIP_PARENS, "").trim();

	// Iteratively strip prefixes:
	// - Always strip equipment prefixes (db/bb/cable/machine), even if result is
	//   a single word.
	// - Only strip positional prefixes (seated/standing/incline/decline) when the
	//   result would still contain at least one more word, preserving meaningful
	//   combos like "incline press" while collapsing "incline db bench press".
	let prev = "";
	while (prev !== result) {
		prev = result;

		// Try equipment prefix first (always safe to strip)
		const afterEquipment = result.replace(STRIP_EQUIPMENT, "").trim();
		if (afterEquipment !== result) {
			result = afterEquipment;
			continue;
		}

		// Try positional prefix only if result would remain multi-word
		const afterPositional = result.replace(STRIP_POSITIONAL, "").trim();
		if (afterPositional !== result && afterPositional.includes(" ")) {
			result = afterPositional;
		}
	}

	return result;
}

// All group values must be one of: Chest, Back, Shoulders, Arms, Legs, Core
const CANONICAL_MUSCLE_GROUPS: Record<string, string> = {
	chest: "Chest",
	back: "Back",
	shoulders: "Shoulders",
	arms: "Arms",
	legs: "Legs",
	core: "Core",
	general: "General",
};

export function canonicalizeMuscleGroup(group: string | null | undefined): string | undefined {
	if (!group) return undefined;
	const trimmed = group.trim();
	if (!trimmed) return undefined;
	return CANONICAL_MUSCLE_GROUPS[trimmed.toLowerCase()] ?? trimmed;
}

export const EXERCISE_MAP: Record<string, ExerciseProfile> = {
	// ── Chest ──────────────────────────────────────────────────────────────────
	"bench press": {
		primary: { group: "Chest", activation: 1.0 },
		secondary: [
			{ group: "Shoulders", displayName: "Anterior Deltoid", activation: 0.5 },
			{ group: "Arms", displayName: "Triceps", activation: 0.4 },
		],
	},
	press: {
		primary: { group: "Chest", activation: 1.0 },
		secondary: [
			{ group: "Shoulders", displayName: "Anterior Deltoid", activation: 0.45 },
			{ group: "Arms", displayName: "Triceps", activation: 0.35 },
		],
	},
	"chest press": {
		primary: { group: "Chest", activation: 1.0 },
		secondary: [
			{ group: "Shoulders", displayName: "Anterior Deltoid", activation: 0.45 },
			{ group: "Arms", displayName: "Triceps", activation: 0.35 },
		],
	},
	fly: {
		primary: { group: "Chest", activation: 1.0 },
		secondary: [
			{ group: "Shoulders", displayName: "Anterior Deltoid", activation: 0.3 },
		],
	},
	"chest fly": {
		primary: { group: "Chest", activation: 1.0 },
		secondary: [
			{ group: "Shoulders", displayName: "Anterior Deltoid", activation: 0.3 },
		],
	},
	"push up": {
		primary: { group: "Chest", activation: 1.0 },
		secondary: [
			{ group: "Shoulders", displayName: "Anterior Deltoid", activation: 0.45 },
			{ group: "Arms", displayName: "Triceps", activation: 0.4 },
			{ group: "Core", activation: 0.25 },
		],
	},
	pushup: {
		primary: { group: "Chest", activation: 1.0 },
		secondary: [
			{ group: "Shoulders", displayName: "Anterior Deltoid", activation: 0.45 },
			{ group: "Arms", displayName: "Triceps", activation: 0.4 },
			{ group: "Core", activation: 0.25 },
		],
	},
	crossover: {
		primary: { group: "Chest", activation: 1.0 },
		secondary: [
			{ group: "Shoulders", displayName: "Anterior Deltoid", activation: 0.3 },
		],
	},
	"cable crossover": {
		primary: { group: "Chest", activation: 1.0 },
		secondary: [
			{ group: "Shoulders", displayName: "Anterior Deltoid", activation: 0.3 },
		],
	},
	dip: {
		primary: { group: "Chest", activation: 1.0 },
		secondary: [
			{ group: "Arms", displayName: "Triceps", activation: 0.55 },
			{ group: "Shoulders", displayName: "Anterior Deltoid", activation: 0.35 },
		],
	},
	"chest dip": {
		primary: { group: "Chest", activation: 1.0 },
		secondary: [
			{ group: "Arms", displayName: "Triceps", activation: 0.5 },
			{ group: "Shoulders", displayName: "Anterior Deltoid", activation: 0.3 },
		],
	},
	pullover: {
		primary: { group: "Chest", activation: 1.0 },
		secondary: [
			{ group: "Back", displayName: "Lats", activation: 0.6 },
			{ group: "Arms", displayName: "Triceps", activation: 0.2 },
		],
	},
	"pec deck": {
		primary: { group: "Chest", activation: 1.0 },
		secondary: [
			{ group: "Shoulders", displayName: "Anterior Deltoid", activation: 0.25 },
		],
	},

	// ── Back ───────────────────────────────────────────────────────────────────
	row: {
		primary: { group: "Back", activation: 1.0 },
		secondary: [
			{ group: "Arms", displayName: "Biceps", activation: 0.5 },
			{ group: "Shoulders", displayName: "Rear Deltoid", activation: 0.35 },
		],
	},
	"bent over row": {
		primary: { group: "Back", activation: 1.0 },
		secondary: [
			{ group: "Arms", displayName: "Biceps", activation: 0.5 },
			{ group: "Shoulders", displayName: "Rear Deltoid", activation: 0.35 },
		],
	},
	"barbell row": {
		primary: { group: "Back", activation: 1.0 },
		secondary: [
			{ group: "Arms", displayName: "Biceps", activation: 0.5 },
			{ group: "Shoulders", displayName: "Rear Deltoid", activation: 0.35 },
		],
	},
	"cable row": {
		primary: { group: "Back", activation: 1.0 },
		secondary: [
			{ group: "Arms", displayName: "Biceps", activation: 0.5 },
			{ group: "Shoulders", displayName: "Rear Deltoid", activation: 0.3 },
		],
	},
	"seated row": {
		primary: { group: "Back", activation: 1.0 },
		secondary: [
			{ group: "Arms", displayName: "Biceps", activation: 0.5 },
			{ group: "Shoulders", displayName: "Rear Deltoid", activation: 0.3 },
		],
	},
	"pull up": {
		primary: { group: "Back", displayName: "Lats", activation: 1.0 },
		secondary: [
			{ group: "Arms", displayName: "Biceps", activation: 0.6 },
			{ group: "Shoulders", displayName: "Rear Deltoid", activation: 0.3 },
			{ group: "Core", activation: 0.2 },
		],
	},
	pullup: {
		primary: { group: "Back", displayName: "Lats", activation: 1.0 },
		secondary: [
			{ group: "Arms", displayName: "Biceps", activation: 0.6 },
			{ group: "Shoulders", displayName: "Rear Deltoid", activation: 0.3 },
		],
	},
	"chin up": {
		primary: { group: "Back", displayName: "Lats", activation: 1.0 },
		secondary: [
			{ group: "Arms", displayName: "Biceps", activation: 0.7 },
			{ group: "Shoulders", displayName: "Rear Deltoid", activation: 0.25 },
		],
	},
	pulldown: {
		primary: { group: "Back", displayName: "Lats", activation: 1.0 },
		secondary: [
			{ group: "Arms", displayName: "Biceps", activation: 0.55 },
			{ group: "Shoulders", displayName: "Rear Deltoid", activation: 0.25 },
		],
	},
	"lat pulldown": {
		primary: { group: "Back", displayName: "Lats", activation: 1.0 },
		secondary: [
			{ group: "Arms", displayName: "Biceps", activation: 0.55 },
			{ group: "Shoulders", displayName: "Rear Deltoid", activation: 0.25 },
		],
	},
	deadlift: {
		primary: { group: "Back", activation: 1.0 },
		secondary: [
			{ group: "Legs", displayName: "Hamstrings", activation: 0.7 },
			{ group: "Legs", displayName: "Glutes", activation: 0.65 },
			{ group: "Core", activation: 0.4 },
		],
	},
	"face pull": {
		primary: {
			group: "Shoulders",
			displayName: "Rear Deltoid",
			activation: 1.0,
		},
		secondary: [
			{ group: "Back", displayName: "Rhomboids", activation: 0.6 },
			{ group: "Arms", displayName: "Biceps", activation: 0.3 },
		],
	},
	shrug: {
		primary: { group: "Back", displayName: "Traps", activation: 1.0 },
		secondary: [{ group: "Shoulders", activation: 0.2 }],
	},
	"reverse fly": {
		primary: {
			group: "Shoulders",
			displayName: "Rear Deltoid",
			activation: 1.0,
		},
		secondary: [{ group: "Back", displayName: "Rhomboids", activation: 0.5 }],
	},
	hyperextension: {
		primary: { group: "Back", displayName: "Lower Back", activation: 1.0 },
		secondary: [
			{ group: "Legs", displayName: "Hamstrings", activation: 0.5 },
			{ group: "Legs", displayName: "Glutes", activation: 0.45 },
		],
	},
	"good morning": {
		primary: { group: "Back", displayName: "Lower Back", activation: 1.0 },
		secondary: [{ group: "Legs", displayName: "Hamstrings", activation: 0.6 }],
	},
	"t-bar row": {
		primary: { group: "Back", activation: 1.0 },
		secondary: [
			{ group: "Arms", displayName: "Biceps", activation: 0.5 },
			{ group: "Shoulders", displayName: "Rear Deltoid", activation: 0.3 },
		],
	},

	// ── Shoulders ──────────────────────────────────────────────────────────────
	"overhead press": {
		primary: { group: "Shoulders", activation: 1.0 },
		secondary: [
			{ group: "Arms", displayName: "Triceps", activation: 0.5 },
			{ group: "Core", activation: 0.2 },
		],
	},
	"shoulder press": {
		primary: { group: "Shoulders", activation: 1.0 },
		secondary: [{ group: "Arms", displayName: "Triceps", activation: 0.5 }],
	},
	"military press": {
		primary: { group: "Shoulders", activation: 1.0 },
		secondary: [
			{ group: "Arms", displayName: "Triceps", activation: 0.5 },
			{ group: "Core", activation: 0.25 },
		],
	},
	"lateral raise": {
		primary: {
			group: "Shoulders",
			displayName: "Lateral Deltoid",
			activation: 1.0,
		},
		secondary: [
			{ group: "Shoulders", displayName: "Anterior Deltoid", activation: 0.2 },
		],
	},
	"side raise": {
		primary: {
			group: "Shoulders",
			displayName: "Lateral Deltoid",
			activation: 1.0,
		},
		secondary: [],
	},
	"front raise": {
		primary: {
			group: "Shoulders",
			displayName: "Anterior Deltoid",
			activation: 1.0,
		},
		secondary: [],
	},
	"rear delt fly": {
		primary: {
			group: "Shoulders",
			displayName: "Rear Deltoid",
			activation: 1.0,
		},
		secondary: [{ group: "Back", displayName: "Rhomboids", activation: 0.4 }],
	},
	"upright row": {
		primary: { group: "Shoulders", activation: 1.0 },
		secondary: [
			{ group: "Arms", displayName: "Biceps", activation: 0.4 },
			{ group: "Back", displayName: "Traps", activation: 0.35 },
		],
	},
	"arnold press": {
		primary: { group: "Shoulders", activation: 1.0 },
		secondary: [{ group: "Arms", displayName: "Triceps", activation: 0.45 }],
	},
	"rear delt raise": {
		primary: {
			group: "Shoulders",
			displayName: "Rear Deltoid",
			activation: 1.0,
		},
		secondary: [{ group: "Back", displayName: "Rhomboids", activation: 0.35 }],
	},

	// ── Arms ───────────────────────────────────────────────────────────────────
	curl: {
		primary: { group: "Arms", displayName: "Biceps", activation: 1.0 },
		secondary: [{ group: "Arms", displayName: "Forearms", activation: 0.3 }],
	},
	"bicep curl": {
		primary: { group: "Arms", displayName: "Biceps", activation: 1.0 },
		secondary: [{ group: "Arms", displayName: "Forearms", activation: 0.3 }],
	},
	"biceps curl": {
		primary: { group: "Arms", displayName: "Biceps", activation: 1.0 },
		secondary: [{ group: "Arms", displayName: "Forearms", activation: 0.3 }],
	},
	"hammer curl": {
		primary: { group: "Arms", displayName: "Brachialis", activation: 1.0 },
		secondary: [
			{ group: "Arms", displayName: "Biceps", activation: 0.7 },
			{ group: "Arms", displayName: "Forearms", activation: 0.4 },
		],
	},
	"preacher curl": {
		primary: { group: "Arms", displayName: "Biceps", activation: 1.0 },
		secondary: [{ group: "Arms", displayName: "Brachialis", activation: 0.4 }],
	},
	"concentration curl": {
		primary: { group: "Arms", displayName: "Biceps", activation: 1.0 },
		secondary: [],
	},
	"zottman curl": {
		primary: { group: "Arms", displayName: "Biceps", activation: 1.0 },
		secondary: [{ group: "Arms", displayName: "Forearms", activation: 0.6 }],
	},
	"tricep extension": {
		primary: { group: "Arms", displayName: "Triceps", activation: 1.0 },
		secondary: [],
	},
	"tricep pushdown": {
		primary: { group: "Arms", displayName: "Triceps", activation: 1.0 },
		secondary: [],
	},
	"triceps pushdown": {
		primary: { group: "Arms", displayName: "Triceps", activation: 1.0 },
		secondary: [],
	},
	"tricep dip": {
		primary: { group: "Arms", displayName: "Triceps", activation: 1.0 },
		secondary: [
			{ group: "Chest", activation: 0.3 },
			{ group: "Shoulders", displayName: "Anterior Deltoid", activation: 0.25 },
		],
	},
	"skull crusher": {
		primary: { group: "Arms", displayName: "Triceps", activation: 1.0 },
		secondary: [],
	},
	skullcrusher: {
		primary: { group: "Arms", displayName: "Triceps", activation: 1.0 },
		secondary: [],
	},
	kickback: {
		primary: { group: "Arms", displayName: "Triceps", activation: 1.0 },
		secondary: [],
	},
	"tricep kickback": {
		primary: { group: "Arms", displayName: "Triceps", activation: 1.0 },
		secondary: [],
	},
	"overhead tricep extension": {
		primary: { group: "Arms", displayName: "Triceps", activation: 1.0 },
		secondary: [],
	},
	"close grip bench press": {
		primary: { group: "Arms", displayName: "Triceps", activation: 1.0 },
		secondary: [
			{ group: "Chest", activation: 0.5 },
			{ group: "Shoulders", displayName: "Anterior Deltoid", activation: 0.3 },
		],
	},
	"wrist curl": {
		primary: { group: "Arms", displayName: "Forearms", activation: 1.0 },
		secondary: [],
	},

	// ── Legs ───────────────────────────────────────────────────────────────────
	squat: {
		primary: { group: "Legs", displayName: "Quads", activation: 1.0 },
		secondary: [
			{ group: "Legs", displayName: "Glutes", activation: 0.7 },
			{ group: "Legs", displayName: "Hamstrings", activation: 0.4 },
			{ group: "Core", activation: 0.3 },
		],
	},
	"back squat": {
		primary: { group: "Legs", displayName: "Quads", activation: 1.0 },
		secondary: [
			{ group: "Legs", displayName: "Glutes", activation: 0.7 },
			{ group: "Legs", displayName: "Hamstrings", activation: 0.4 },
			{ group: "Core", activation: 0.3 },
		],
	},
	"front squat": {
		primary: { group: "Legs", displayName: "Quads", activation: 1.0 },
		secondary: [
			{ group: "Legs", displayName: "Glutes", activation: 0.6 },
			{ group: "Core", activation: 0.4 },
		],
	},
	"goblet squat": {
		primary: { group: "Legs", displayName: "Quads", activation: 1.0 },
		secondary: [
			{ group: "Legs", displayName: "Glutes", activation: 0.65 },
			{ group: "Core", activation: 0.35 },
		],
	},
	lunge: {
		primary: { group: "Legs", displayName: "Quads", activation: 1.0 },
		secondary: [
			{ group: "Legs", displayName: "Glutes", activation: 0.65 },
			{ group: "Legs", displayName: "Hamstrings", activation: 0.35 },
			{ group: "Core", activation: 0.2 },
		],
	},
	"reverse lunge": {
		primary: { group: "Legs", displayName: "Quads", activation: 1.0 },
		secondary: [
			{ group: "Legs", displayName: "Glutes", activation: 0.7 },
			{ group: "Legs", displayName: "Hamstrings", activation: 0.4 },
		],
	},
	"walking lunge": {
		primary: { group: "Legs", displayName: "Quads", activation: 1.0 },
		secondary: [
			{ group: "Legs", displayName: "Glutes", activation: 0.65 },
			{ group: "Core", activation: 0.2 },
		],
	},
	"leg press": {
		primary: { group: "Legs", displayName: "Quads", activation: 1.0 },
		secondary: [
			{ group: "Legs", displayName: "Glutes", activation: 0.5 },
			{ group: "Legs", displayName: "Hamstrings", activation: 0.3 },
		],
	},
	"leg extension": {
		primary: { group: "Legs", displayName: "Quads", activation: 1.0 },
		secondary: [],
	},
	"leg curl": {
		primary: { group: "Legs", displayName: "Hamstrings", activation: 1.0 },
		secondary: [],
	},
	"hamstring curl": {
		primary: { group: "Legs", displayName: "Hamstrings", activation: 1.0 },
		secondary: [],
	},
	"lying leg curl": {
		primary: { group: "Legs", displayName: "Hamstrings", activation: 1.0 },
		secondary: [],
	},
	"calf raise": {
		primary: { group: "Legs", displayName: "Calves", activation: 1.0 },
		secondary: [],
	},
	"hip thrust": {
		primary: { group: "Legs", displayName: "Glutes", activation: 1.0 },
		secondary: [
			{ group: "Legs", displayName: "Hamstrings", activation: 0.5 },
			{ group: "Core", activation: 0.2 },
		],
	},
	"glute bridge": {
		primary: { group: "Legs", displayName: "Glutes", activation: 1.0 },
		secondary: [
			{ group: "Legs", displayName: "Hamstrings", activation: 0.45 },
			{ group: "Core", activation: 0.2 },
		],
	},
	"step up": {
		primary: { group: "Legs", displayName: "Quads", activation: 1.0 },
		secondary: [
			{ group: "Legs", displayName: "Glutes", activation: 0.6 },
			{ group: "Legs", displayName: "Hamstrings", activation: 0.3 },
		],
	},
	"romanian deadlift": {
		primary: { group: "Legs", displayName: "Hamstrings", activation: 1.0 },
		secondary: [
			{ group: "Legs", displayName: "Glutes", activation: 0.7 },
			{ group: "Back", displayName: "Lower Back", activation: 0.4 },
		],
	},
	rdl: {
		primary: { group: "Legs", displayName: "Hamstrings", activation: 1.0 },
		secondary: [
			{ group: "Legs", displayName: "Glutes", activation: 0.7 },
			{ group: "Back", displayName: "Lower Back", activation: 0.4 },
		],
	},
	"bulgarian split squat": {
		primary: { group: "Legs", displayName: "Quads", activation: 1.0 },
		secondary: [
			{ group: "Legs", displayName: "Glutes", activation: 0.7 },
			{ group: "Legs", displayName: "Hamstrings", activation: 0.35 },
			{ group: "Core", activation: 0.2 },
		],
	},
	"split squat": {
		primary: { group: "Legs", displayName: "Quads", activation: 1.0 },
		secondary: [
			{ group: "Legs", displayName: "Glutes", activation: 0.65 },
			{ group: "Legs", displayName: "Hamstrings", activation: 0.3 },
		],
	},
	"sumo deadlift": {
		primary: { group: "Legs", displayName: "Glutes", activation: 1.0 },
		secondary: [
			{ group: "Legs", displayName: "Quads", activation: 0.6 },
			{ group: "Back", activation: 0.5 },
		],
	},
	"hack squat": {
		primary: { group: "Legs", displayName: "Quads", activation: 1.0 },
		secondary: [{ group: "Legs", displayName: "Glutes", activation: 0.5 }],
	},
	"hip abduction": {
		primary: { group: "Legs", displayName: "Abductors", activation: 1.0 },
		secondary: [{ group: "Legs", displayName: "Glutes", activation: 0.4 }],
	},
	"hip adduction": {
		primary: { group: "Legs", displayName: "Adductors", activation: 1.0 },
		secondary: [],
	},

	// ── Core ───────────────────────────────────────────────────────────────────
	plank: {
		primary: { group: "Core", activation: 1.0 },
		secondary: [
			{ group: "Shoulders", activation: 0.3 },
			{ group: "Legs", displayName: "Glutes", activation: 0.25 },
		],
	},
	"side plank": {
		primary: { group: "Core", displayName: "Obliques", activation: 1.0 },
		secondary: [{ group: "Shoulders", activation: 0.3 }],
	},
	crunch: {
		primary: { group: "Core", displayName: "Abs", activation: 1.0 },
		secondary: [],
	},
	"sit up": {
		primary: { group: "Core", displayName: "Abs", activation: 1.0 },
		secondary: [{ group: "Legs", displayName: "Hip Flexors", activation: 0.4 }],
	},
	situp: {
		primary: { group: "Core", displayName: "Abs", activation: 1.0 },
		secondary: [{ group: "Legs", displayName: "Hip Flexors", activation: 0.4 }],
	},
	"leg raise": {
		primary: { group: "Core", displayName: "Lower Abs", activation: 1.0 },
		secondary: [{ group: "Legs", displayName: "Hip Flexors", activation: 0.5 }],
	},
	"hanging leg raise": {
		primary: { group: "Core", displayName: "Lower Abs", activation: 1.0 },
		secondary: [
			{ group: "Legs", displayName: "Hip Flexors", activation: 0.5 },
			{ group: "Back", displayName: "Lats", activation: 0.2 },
		],
	},
	"hanging knee raise": {
		primary: { group: "Core", displayName: "Lower Abs", activation: 1.0 },
		secondary: [
			{ group: "Legs", displayName: "Hip Flexors", activation: 0.45 },
		],
	},
	"russian twist": {
		primary: { group: "Core", displayName: "Obliques", activation: 1.0 },
		secondary: [{ group: "Core", displayName: "Abs", activation: 0.4 }],
	},
	woodchop: {
		primary: { group: "Core", displayName: "Obliques", activation: 1.0 },
		secondary: [
			{ group: "Shoulders", activation: 0.35 },
			{ group: "Legs", activation: 0.2 },
		],
	},
	"wood chop": {
		primary: { group: "Core", displayName: "Obliques", activation: 1.0 },
		secondary: [{ group: "Shoulders", activation: 0.35 }],
	},
	"ab rollout": {
		primary: { group: "Core", activation: 1.0 },
		secondary: [
			{ group: "Shoulders", activation: 0.4 },
			{ group: "Arms", displayName: "Triceps", activation: 0.25 },
		],
	},
	"ab wheel": {
		primary: { group: "Core", activation: 1.0 },
		secondary: [{ group: "Shoulders", activation: 0.4 }],
	},
	"cable crunch": {
		primary: { group: "Core", displayName: "Abs", activation: 1.0 },
		secondary: [],
	},
	"bicycle crunch": {
		primary: { group: "Core", displayName: "Obliques", activation: 1.0 },
		secondary: [{ group: "Core", displayName: "Abs", activation: 0.6 }],
	},
	"mountain climber": {
		primary: { group: "Core", activation: 1.0 },
		secondary: [
			{ group: "Shoulders", activation: 0.35 },
			{ group: "Legs", displayName: "Hip Flexors", activation: 0.4 },
		],
	},
	"dragon flag": {
		primary: { group: "Core", activation: 1.0 },
		secondary: [{ group: "Back", activation: 0.3 }],
	},
	"hollow hold": {
		primary: { group: "Core", activation: 1.0 },
		secondary: [],
	},
	"dead bug": {
		primary: { group: "Core", activation: 1.0 },
		secondary: [],
	},
};

/**
 * Computes the Jaccard-style token overlap ratio between two normalized strings.
 * Returns a value in [0, 1] where 1 means identical token sets.
 */
function tokenOverlapRatio(a: string, b: string): number {
	const tokensA = new Set(a.split(/\s+/).filter(Boolean));
	const tokensB = new Set(b.split(/\s+/).filter(Boolean));
	if (tokensA.size === 0 || tokensB.size === 0) return 0;
	let intersectionCount = 0;
	for (const token of tokensA) {
		if (tokensB.has(token)) intersectionCount++;
	}
	const unionSize = tokensA.size + tokensB.size - intersectionCount;
	return intersectionCount / unionSize;
}

const FUZZY_THRESHOLD = 0.7;

/**
 * Keyword/substring classification rules, applied in order (first match wins)
 * against the normalized exercise name. This catches the long tail of named
 * variants ("Conventional Deadlift", "Low Bar Squat", "Bayesian Curl", grip /
 * stance / unilateral descriptors, etc.) that are real movements but don't
 * match EXERCISE_MAP exactly and fall below the fuzzy threshold.
 *
 * ORDER IS LOAD-BEARING — specific rules must precede generic ones:
 *   - "romanian/rdl/stiff-leg" -> Legs BEFORE generic "deadlift" -> Back
 *   - "hamstring|leg (press|ext|curl)" -> Legs BEFORE generic "curl" -> Arms
 *   - "rear delt" -> Shoulders BEFORE generic "row" -> Back
 *   - "tricep" -> Arms BEFORE generic "dip"/"curl"
 *   - "plank/hip dips" -> Core BEFORE generic "dip" -> Chest
 *   - "leg raise|knee raise" -> Core (never matched by the Legs rules, which
 *     only match "leg press|extension|curl")
 */
const KEYWORD_RULES: Array<{ pattern: RegExp; group: string }> = [
	// ── Legs (specific posterior-chain & knee/hip patterns first) ──
	{
		pattern:
			/\b(romanian deadlifts?|rdls?|stiff[- ]?leg(?:ged)?(?: deadlifts?)?)\b/,
		group: "Legs",
	},
	{ pattern: /\bhamstrings?\b/, group: "Legs" },
	{ pattern: /\bglutes?\b/, group: "Legs" },
	{ pattern: /\b(calf|calves)\b/, group: "Legs" },
	{ pattern: /\bquads?\b|\bquadriceps\b/, group: "Legs" },
	{ pattern: /\bleg (press(?:es)?|extension|curl)s?\b/, group: "Legs" },
	{ pattern: /\bhip (thrust|abduction|adduction)s?\b/, group: "Legs" },
	{ pattern: /\b(abductor|adductor)s?\b/, group: "Legs" },
	{ pattern: /\bsquat/, group: "Legs" },
	{ pattern: /\blunge/, group: "Legs" },
	{ pattern: /\bstep[- ]?up/, group: "Legs" },
	// ── Back ──
	{ pattern: /\bdeadlifts?\b/, group: "Back" },
	// ── Shoulders (rear-delt & raises before generic row) ──
	{
		pattern: /\b(rear delts?|reverse fl(?:y|ies|ye?s?))\b/,
		group: "Shoulders",
	},
	{ pattern: /\b(lateral|side|front) raises?\b/, group: "Shoulders" },
	{
		pattern: /\b(shoulder|overhead|military|arnold) press(?:es)?\b/,
		group: "Shoulders",
	},
	{ pattern: /\bupright rows?\b/, group: "Shoulders" },
	{ pattern: /\bface pulls?\b/, group: "Shoulders" },
	// ── Back (pull patterns) ──
	{ pattern: /\bpulldowns?\b/, group: "Back" },
	{ pattern: /\bpullovers?\b/, group: "Chest" },
	{ pattern: /\b(pull[- ]?ups?|chin[- ]?ups?)\b/, group: "Back" },
	{ pattern: /\brows?\b/, group: "Back" },
	{ pattern: /\bshrugs?\b/, group: "Back" },
	// ── Arms (tricep before generic dip/curl) ──
	{ pattern: /\b(triceps?|skulls?|kick ?backs?)\b/, group: "Arms" },
	{ pattern: /\bcurls?\b/, group: "Arms" },
	// ── Core dip variants before generic chest dips ──
	{
		pattern: /\bhip dips?\b|\b(plank|oblique)s?\b.*\bdips?\b/,
		group: "Core",
	},
	// ── Chest ──
	{ pattern: /\b(fl(?:y|ies|ye?s?)|pecs?)\b/, group: "Chest" },
	{ pattern: /\b(bench|chest) press(?:es)?\b/, group: "Chest" },
	{ pattern: /\bpush[- ]?ups?\b/, group: "Chest" },
	{ pattern: /\bcrossovers?\b/, group: "Chest" },
	{ pattern: /\bdips?\b/, group: "Chest" },
	// ── Core ──
	{
		pattern:
			/\b(crunch(?:es)?|planks?|obliques?|sit[- ]?ups?|leg raises?|knee raises?|hollows?|dead bugs?|wood ?chops?|russian twists?|mountain climbers?|ab wheels?|ab rollouts?)\b/,
		group: "Core",
	},
];

/**
 * Looks up an exercise profile by name.
 *
 * Resolution order:
 * 1. Exact match after normalization
 * 2. Fuzzy token-overlap match (threshold: 0.7)
 * 3. Keyword/substring match (KEYWORD_RULES, ordered)
 * 4. Fallback to `dbMuscleGroup` at 100% activation with no secondaries
 * 5. Fallback to "General" with 100% activation and no secondaries
 */
export function getExerciseProfile(
	exerciseName: string,
	dbMuscleGroup?: string,
): ExerciseProfile {
	const normalized = normalizeExerciseName(exerciseName);

	// 1. Exact match
	if (EXERCISE_MAP[normalized]) {
		return EXERCISE_MAP[normalized];
	}

	// 2. Fuzzy token-overlap match
	let bestScore = 0;
	let bestKey: string | null = null;
	for (const key of Object.keys(EXERCISE_MAP)) {
		const score = tokenOverlapRatio(normalized, key);
		if (score > bestScore) {
			bestScore = score;
			bestKey = key;
		}
	}
	if (bestKey !== null && bestScore >= FUZZY_THRESHOLD) {
		return EXERCISE_MAP[bestKey];
	}

	// 3. Keyword/substring match (ordered, specific-before-generic)
	for (const { pattern, group } of KEYWORD_RULES) {
		if (pattern.test(normalized)) {
			return { primary: { group, activation: 1.0 }, secondary: [] };
		}
	}

	// 4. DB muscle group fallback
	const canonicalHint = canonicalizeMuscleGroup(dbMuscleGroup);
	if (canonicalHint) {
		return {
			primary: { group: canonicalHint, activation: 1.0 },
			secondary: [],
		};
	}

	// 5. Generic fallback
	return {
		primary: { group: "General", activation: 1.0 },
		secondary: [],
	};
}

/**
 * Classifies an exercise to one of the six canonical muscle groups
 * (Chest, Back, Shoulders, Arms, Legs, Core) or "General" when unknown.
 *
 * A real `dbMuscleGroup` is only used as a fallback when the name itself
 * cannot be classified. The literal placeholder "General" is treated as
 * "no information" so it never short-circuits name-based classification.
 */
export function classifyMuscleGroup(
	exerciseName: string,
	dbMuscleGroup?: string | null,
): string {
	const hint =
		dbMuscleGroup?.trim() && dbMuscleGroup !== "General"
			? dbMuscleGroup
			: undefined;
	return getExerciseProfile(exerciseName, hint).primary.group;
}
