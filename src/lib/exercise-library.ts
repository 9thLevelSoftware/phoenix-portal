/**
 * Static fallback exercise library for Vitruvian Trainer.
 * Used when a user has no prior workout data.
 * Covers all major muscle groups for the cable machine.
 */
export const EXERCISE_LIBRARY: Array<{
	name: string;
	muscleGroup: string;
}> = [
	// Chest
	{ name: "Bench Press", muscleGroup: "Chest" },
	{ name: "Incline Bench Press", muscleGroup: "Chest" },
	{ name: "Decline Bench Press", muscleGroup: "Chest" },
	{ name: "Chest Fly", muscleGroup: "Chest" },
	{ name: "Cable Crossover", muscleGroup: "Chest" },

	// Back
	{ name: "Deadlift", muscleGroup: "Back" },
	{ name: "Barbell Row", muscleGroup: "Back" },
	{ name: "Lat Pulldown", muscleGroup: "Back" },
	{ name: "Seated Row", muscleGroup: "Back" },
	{ name: "Single Arm Row", muscleGroup: "Back" },
	{ name: "Pull-ups", muscleGroup: "Back" },

	// Shoulders
	{ name: "Overhead Press", muscleGroup: "Shoulders" },
	{ name: "Lateral Raise", muscleGroup: "Shoulders" },
	{ name: "Front Raise", muscleGroup: "Shoulders" },
	{ name: "Face Pull", muscleGroup: "Shoulders" },
	{ name: "Rear Delt Fly", muscleGroup: "Shoulders" },

	// Legs
	{ name: "Squat", muscleGroup: "Legs" },
	{ name: "Romanian Deadlift", muscleGroup: "Legs" },
	{ name: "Leg Press", muscleGroup: "Legs" },
	{ name: "Lunge", muscleGroup: "Legs" },
	{ name: "Calf Raise", muscleGroup: "Legs" },
	{ name: "Leg Extension", muscleGroup: "Legs" },
	{ name: "Leg Curl", muscleGroup: "Legs" },

	// Arms
	{ name: "Bicep Curl", muscleGroup: "Arms" },
	{ name: "Hammer Curl", muscleGroup: "Arms" },
	{ name: "Tricep Pushdown", muscleGroup: "Arms" },
	{ name: "Tricep Extension", muscleGroup: "Arms" },
	{ name: "Skull Crusher", muscleGroup: "Arms" },

	// Core
	{ name: "Cable Crunch", muscleGroup: "Core" },
	{ name: "Pallof Press", muscleGroup: "Core" },
	{ name: "Woodchop", muscleGroup: "Core" },
];
