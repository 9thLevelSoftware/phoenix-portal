/** Tailwind classes for muscle-group chips shared by Routine Builder, Session Detail, and Records. */
export const MUSCLE_GROUP_CHIP_CLASS: Record<string, string> = {
	Chest: "bg-primary text-background",
	Shoulders: "bg-accent text-background",
	Back: "bg-success text-background",
	Legs: "bg-chart-2 text-background",
	Arms: "bg-warning text-background",
	Core: "bg-chart-5 text-background",
};

const UNKNOWN_MUSCLE_GROUP_CHIP_CLASS =
	"bg-secondary text-secondary-foreground";

export function getMuscleGroupColor(muscleGroup: string): string {
	return (
		MUSCLE_GROUP_CHIP_CLASS[muscleGroup] ?? UNKNOWN_MUSCLE_GROUP_CHIP_CLASS
	);
}
