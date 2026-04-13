import { Dumbbell, Flame, TrendingUp } from "lucide-react";
import { formatVolume, type WeightUnit } from "@/lib/units";

interface WorkoutQuickStatsProps {
	weeklyWorkoutCount: number;
	currentStreak: number;
	monthlyVolume: number;
	unit: WeightUnit;
}

export function WorkoutQuickStats({
	weeklyWorkoutCount,
	currentStreak,
	monthlyVolume,
	unit,
}: WorkoutQuickStatsProps) {
	return (
		<div className="bg-surface-2 rounded-lg border border-secondary p-4 space-y-4">
			<h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
				Quick Stats
			</h3>

			<div className="space-y-3">
				<div className="flex items-center justify-between">
					<div className="flex items-center gap-2 text-sm text-muted-foreground">
						<Dumbbell className="h-4 w-4" />
						<span>This week</span>
					</div>
					<span className="text-sm font-medium text-white font-data">
						{weeklyWorkoutCount} workout{weeklyWorkoutCount !== 1 ? "s" : ""}
					</span>
				</div>

				<div className="flex items-center justify-between">
					<div className="flex items-center gap-2 text-sm text-muted-foreground">
						<Flame className="h-4 w-4 text-primary" />
						<span>Streak</span>
					</div>
					<span className="text-sm font-medium text-white font-data">
						{currentStreak} day{currentStreak !== 1 ? "s" : ""}
						{currentStreak >= 7 && " 🔥"}
					</span>
				</div>

				<div className="flex items-center justify-between">
					<div className="flex items-center gap-2 text-sm text-muted-foreground">
						<TrendingUp className="h-4 w-4" />
						<span>Monthly volume</span>
					</div>
					<span className="text-sm font-medium text-white font-data">
						{formatVolume(monthlyVolume, unit)}
					</span>
				</div>
			</div>
		</div>
	);
}
