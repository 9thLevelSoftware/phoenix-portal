import type { LucideIcon } from "lucide-react";
import { Clock } from "lucide-react";
import { EChartsWrapper } from "@/app/components/charts/shared/EChartsWrapper";
import { Card } from "@/app/components/ui/card";
import type { WeightUnit } from "@/lib/units";

type ChartOption = Record<string, unknown>;

interface Insight {
	type: "positive" | "warning" | "neutral";
	title: string;
	description: string;
	icon: LucideIcon;
}

export interface ProgressTabProps {
	unit: WeightUnit;
	strengthEChartsOption: ChartOption | null;
	volumeAreaOption: ChartOption | null;
	prCount: number;
	daysSinceLastPR: number | null;
	strengthExercises: string[];
	insights: Insight[];
}

export default function ProgressTab({
	unit,
	strengthEChartsOption,
	volumeAreaOption,
	prCount,
	daysSinceLastPR,
	strengthExercises,
	insights,
}: ProgressTabProps) {
	return (
		<>
			{/* 1RM Progression */}
			<Card className="p-6 bg-surface-2 border-secondary">
				<h3 className="text-xl text-white mb-6">1RM Progression ({unit})</h3>
				{strengthEChartsOption ? (
					<EChartsWrapper option={strengthEChartsOption} height={400} />
				) : (
					<div className="h-[400px] flex items-center justify-center text-muted-foreground">
						No strength progress data yet. Set some PRs to see your progression!
					</div>
				)}
			</Card>

			{/* Volume & Frequency Trends */}
			<Card className="p-6 bg-surface-2 border-secondary">
				<h3 className="text-xl text-white mb-6">Volume & Frequency Trends</h3>
				{volumeAreaOption ? (
					<EChartsWrapper option={volumeAreaOption} height={300} />
				) : (
					<div className="h-[300px] flex items-center justify-center text-muted-foreground">
						No volume data for this period
					</div>
				)}
			</Card>

			{/* PR Timeline + Insights */}
			<div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
				{/* PR Timeline */}
				<Card className="p-6 bg-surface-2 border-secondary">
					<h3 className="text-xl text-white mb-4">Personal Records</h3>
					<div className="flex items-center gap-6 mb-4">
						<div className="flex flex-col items-center justify-center rounded-xl bg-primary/10 px-6 py-4">
							<span className="text-3xl font-bold text-primary">{prCount}</span>
							<span className="text-xs text-muted-foreground mt-1">
								total PRs
							</span>
						</div>
						{daysSinceLastPR != null && (
							<div className="flex flex-col items-center justify-center rounded-xl bg-muted/20 px-6 py-4">
								<div className="flex items-center gap-1.5">
									<Clock className="w-4 h-4 text-muted-foreground" />
									<span className="text-3xl font-bold text-white">
										{daysSinceLastPR}
									</span>
								</div>
								<span className="text-xs text-muted-foreground mt-1">
									days since last PR
								</span>
							</div>
						)}
					</div>
					{strengthExercises.length > 0 && (
						<div className="text-sm text-muted-foreground">
							Tracking: {strengthExercises.join(", ")}
						</div>
					)}
				</Card>

				{/* Insight cards (legacy style) */}
				<Card className="p-6 bg-surface-2 border-secondary">
					<h3 className="text-xl text-white mb-4">Trend Insights</h3>
					<div className="flex flex-col gap-3">
						{insights.map((insight) => (
							<div
								key={insight.title}
								className={`flex items-start gap-3 p-3 rounded-lg border ${
									insight.type === "positive"
										? "bg-success/5 border-success/30"
										: insight.type === "warning"
											? "bg-warning/5 border-warning/30"
											: "bg-muted/5 border-muted/30"
								}`}
							>
								<div
									className={`p-2 rounded-lg ${
										insight.type === "positive"
											? "bg-success/20"
											: insight.type === "warning"
												? "bg-warning/20"
												: "bg-muted/20"
									}`}
								>
									<insight.icon
										className={`w-4 h-4 ${
											insight.type === "positive"
												? "text-success"
												: insight.type === "warning"
													? "text-warning"
													: "text-muted-foreground"
										}`}
									/>
								</div>
								<div className="flex-1 min-w-0">
									<h4 className="text-sm font-semibold text-white">
										{insight.title}
									</h4>
									<p className="text-xs text-muted-foreground mt-0.5">
										{insight.description}
									</p>
								</div>
							</div>
						))}
					</div>
				</Card>
			</div>
		</>
	);
}
