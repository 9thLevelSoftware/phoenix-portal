import { BarChart3 } from "lucide-react";
import { Card } from "@/app/components/ui/card";
import { PHOENIX } from "@/lib/colors";
import type { CycleDay } from "./types";

interface WeekOverviewProps {
	days: CycleDay[];
}

export function WeekOverview({ days }: WeekOverviewProps) {
	const workoutDays = days.filter((d) => d.type === "workout").length;
	const restDays = days.filter((d) => d.type === "rest").length;

	// Calculate muscle distribution (mock calculation)
	const muscleDistribution = [
		{ name: "Chest", percentage: 22, color: "var(--primary)" },
		{ name: "Back", percentage: 20, color: PHOENIX.flameRed },
		{ name: "Legs", percentage: 18, color: PHOENIX.gold },
		{ name: "Shoulders", percentage: 15, color: PHOENIX.forgeGreen },
		{ name: "Arms", percentage: 15, color: "#6366F1" },
		{ name: "Core", percentage: 10, color: "#EC4899" },
	];

	const dayNames = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

	return (
		<Card className="p-6 bg-gradient-to-br from-surface-2 to-background border-secondary">
			<h2 className="text-xl font-semibold text-white mb-6 flex items-center gap-2">
				<BarChart3 className="w-5 h-5 text-primary" />
				Week at a Glance
			</h2>

			{/* Week Grid */}
			<div className="grid grid-cols-7 gap-2 mb-6">
				{dayNames.slice(0, days.length).map((dayName, i) => {
					const day = days[i];
					return (
						<div key={dayName} className="text-center">
							<div className="text-xs text-muted-foreground mb-2">
								{dayName}
							</div>
							<div
								className={`h-20 rounded-lg flex flex-col items-center justify-center text-2xl transition-all ${
									day?.type === "workout"
										? "bg-gradient-to-br from-primary/20 to-chart-2/10 border-2 border-primary/30"
										: "bg-secondary/20 border-2 border-secondary"
								}`}
							>
								{day?.type === "workout" ? "🏋️" : "🛋️"}
							</div>
							<div className="text-xs text-muted-foreground mt-1 truncate">
								{day?.routineName || (day?.type === "rest" ? "REST" : "-")}
							</div>
						</div>
					);
				})}
			</div>

			{/* Summary */}
			<div className="text-sm text-secondary-foreground mb-6">
				📊 {workoutDays} workout days • {restDays} rest days
			</div>

			{/* Muscle Distribution */}
			<div className="border-t border-secondary pt-6">
				<h3 className="font-semibold text-white mb-4">
					Muscle Group Distribution
				</h3>
				<p className="text-sm text-muted-foreground mb-4">
					Based on assigned routines:
				</p>

				<div className="space-y-3">
					{muscleDistribution.map((muscle) => (
						<div key={muscle.name}>
							<div className="flex items-center justify-between mb-1">
								<span className="text-sm text-secondary-foreground">
									{muscle.name}
								</span>
								<span className="text-sm text-muted-foreground">
									{muscle.percentage}%
								</span>
							</div>
							<div className="w-full h-2 bg-background rounded-full overflow-hidden">
								<div
									className="h-full rounded-full transition-all"
									style={{
										width: `${muscle.percentage}%`,
										backgroundColor: muscle.color,
									}}
								/>
							</div>
						</div>
					))}
				</div>

				{/* Balance Warning (example) */}
				{muscleDistribution[0].percentage - muscleDistribution[1].percentage >
					10 && (
					<div className="mt-4 p-4 bg-warning/10 border border-warning/30 rounded-lg">
						<div className="text-sm text-warning">
							⚠️ Note: {muscleDistribution[0].name} is receiving more volume than{" "}
							{muscleDistribution[1].name}. Consider adding more pulling
							exercises for balance.
						</div>
					</div>
				)}
			</div>
		</Card>
	);
}
