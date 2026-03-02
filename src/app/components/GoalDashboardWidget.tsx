import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Lock, Target } from "lucide-react";
import { Link } from "react-router";
import { Button } from "@/app/components/ui/button";
import { Card } from "@/app/components/ui/card";
import { useAuth } from "@/app/hooks/useAuth";
import { useSubscription } from "@/hooks/useSubscription";
import { goalsOptions } from "@/queries/goals";
import { GoalProgressRing } from "./GoalProgressRing";
import { useGoalProgress } from "./Goals";

export function GoalDashboardWidget() {
	const { user } = useAuth();
	const { isPremium } = useSubscription();
	const { data: goals } = useQuery({
		...goalsOptions(user?.id ?? ""),
		enabled: isPremium && !!user?.id,
	});

	const activeGoals = goals?.filter((g) => g.status === "active") ?? [];
	const progressMap = useGoalProgress();

	if (!isPremium) {
		return (
			<Card className="relative overflow-hidden p-6 card-primary">
				<div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-chart-2/5 pointer-events-none" />
				<div className="relative z-10">
					<div className="flex items-center justify-between mb-3">
						<h3 className="text-xl text-white flex items-center gap-2">
							<Target className="w-5 h-5 text-primary" />
							Goals
						</h3>
						<Lock className="w-4 h-4 text-muted-foreground" />
					</div>
					<p className="text-sm text-muted-foreground mb-3">
						Set custom frequency, volume, and PR targets. Track progress with
						visual rings and stay on top of your training plan.
					</p>
					<Button
						variant="outline"
						size="sm"
						className="border-primary text-primary hover:bg-primary/10"
						asChild
					>
						<Link to="/pricing">Upgrade to unlock</Link>
					</Button>
				</div>
			</Card>
		);
	}

	return (
		<Card className="p-6 card-primary">
			<div className="flex items-center justify-between mb-4">
				<h3 className="text-xl text-white flex items-center gap-2">
					<Target className="w-5 h-5 text-primary" />
					Goals
				</h3>
				<Button
					variant="ghost"
					className="text-primary hover:bg-primary/10"
					asChild
				>
					<Link to="/goals">
						View All
						<ArrowRight className="w-4 h-4 ml-2" />
					</Link>
				</Button>
			</div>

			{activeGoals.length === 0 ? (
				<div className="flex flex-col items-center justify-center py-6 text-center">
					<Target className="w-8 h-8 text-secondary mb-2" />
					<p className="text-sm text-muted-foreground mb-2">No active goals</p>
					<Button
						variant="outline"
						size="sm"
						className="border-primary text-primary hover:bg-primary/10"
						asChild
					>
						<Link to="/goals">Set your first goal</Link>
					</Button>
				</div>
			) : (
				<div className="space-y-3">
					{activeGoals.slice(0, 3).map((goal) => {
						const progress = progressMap.get(goal.id) ?? 0;
						return (
							<div
								key={goal.id}
								className="flex items-center gap-3 p-2 rounded-lg bg-background/50"
							>
								<GoalProgressRing
									progress={progress}
									size={48}
									strokeWidth={4}
								/>
								<div className="flex-1 min-w-0">
									<p className="text-sm text-white truncate">
										{getGoalLabel(goal)}
									</p>
									<p className="text-xs text-muted-foreground">
										{getGoalProgressText(goal, progress)}
									</p>
								</div>
							</div>
						);
					})}
				</div>
			)}
		</Card>
	);
}

function getGoalLabel(goal: {
	goal_type: string;
	target_value: number;
	target_unit: string;
	exercise_name: string | null;
}): string {
	switch (goal.goal_type) {
		case "frequency":
			return `${goal.target_value} workouts / ${goal.target_unit === "workouts/month" ? "month" : "week"}`;
		case "volume":
			return `${goal.target_value.toLocaleString()} kg / ${goal.target_unit === "kg/month" ? "month" : "week"}`;
		case "pr":
			return `${goal.exercise_name}: ${goal.target_value} kg PR`;
		default:
			return "Goal";
	}
}

function getGoalProgressText(
	goal: { goal_type: string; target_value: number },
	progress: number,
): string {
	const achieved = Math.round((progress / 100) * goal.target_value);
	if (goal.goal_type === "frequency") {
		return `${achieved}/${goal.target_value} workouts`;
	}
	if (goal.goal_type === "volume") {
		return `${achieved.toLocaleString()}/${goal.target_value.toLocaleString()} kg`;
	}
	return `${progress >= 100 ? "Achieved" : `${Math.round(progress)}%`}`;
}
