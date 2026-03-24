import { Globe } from "lucide-react";
import { ConsistencyWidget } from "@/app/components/charts/ConsistencyWidget";
import { EChartsWrapper } from "@/app/components/charts/shared/EChartsWrapper";
import { TrainingLoadGauge } from "@/app/components/charts/TrainingLoadGauge";
import { type InsightItem, InsightsFeed } from "@/app/components/InsightsFeed";
import { Badge } from "@/app/components/ui/badge";
import { Card } from "@/app/components/ui/card";

// Use generic record type to avoid importing echarts just for the type
type ChartOption = Record<string, unknown>;

interface ExternalChartEntry {
	date: string;
	provider: string;
	duration: number;
	calories: number;
	type: string;
	isExternal: boolean;
}

interface ConsistencyData {
	weeklyData: {
		current: number;
		target: number;
		lastWeek: number;
		twoWeeksAgo: number;
	};
	avgPerWeek: number;
	hitRate: number;
	mostActiveDay: string;
}

export interface OverviewTabProps {
	totalWorkouts: number;
	externalCount: number;
	externalChartData: ExternalChartEntry[];
	volumeEChartsOption: ChartOption | null;
	muscleDonutOption: ChartOption | null;
	trainingLoad: { rtl: number; zone: string };
	consistencyData: ConsistencyData;
	insightsFeedItems: InsightItem[];
	insightsPending: boolean;
}

export default function OverviewTab({
	totalWorkouts,
	externalCount,
	externalChartData,
	volumeEChartsOption,
	muscleDonutOption,
	trainingLoad,
	consistencyData,
	insightsFeedItems,
	insightsPending,
}: OverviewTabProps) {
	return (
		<>
			{/* Activity Sources (folded in from External tab) */}
			{(totalWorkouts > 0 || externalCount > 0) && (
				<Card className="p-6 bg-surface-2 border-secondary">
					<h3 className="text-xl text-white mb-4">Activity Sources</h3>
					<div className="grid grid-cols-2 md:grid-cols-4 gap-4">
						<div>
							<p className="text-2xl font-bold text-primary">{totalWorkouts}</p>
							<p className="text-sm text-muted-foreground">Phoenix Workouts</p>
						</div>
						<div>
							<p className="text-2xl font-bold text-blue-400">
								{externalCount}
							</p>
							<p className="text-sm text-muted-foreground">
								External Activities
							</p>
						</div>
						<div>
							<p className="text-2xl font-bold text-white">
								{totalWorkouts + externalCount}
							</p>
							<p className="text-sm text-muted-foreground">Total Activities</p>
						</div>
						<div>
							<p className="text-2xl font-bold text-emerald-400">
								{externalChartData
									.reduce((sum, a) => sum + a.calories, 0)
									.toLocaleString()}
							</p>
							<p className="text-sm text-muted-foreground">External Calories</p>
						</div>
					</div>
					{/* Provider badges */}
					{externalCount > 0 && (
						<div className="flex gap-2 mt-4 pt-4 border-t border-secondary">
							{Array.from(
								new Set(externalChartData.map((a) => a.provider)),
							).map((provider) => {
								const count = externalChartData.filter(
									(a) => a.provider === provider,
								).length;
								return (
									<Badge
										key={provider}
										variant="outline"
										className="capitalize text-xs"
									>
										<Globe className="w-3 h-3 mr-1" />
										{provider} ({count})
									</Badge>
								);
							})}
						</div>
					)}
				</Card>
			)}

			{/* Volume Over Time + Muscle Distribution */}
			<div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
				<Card className="p-6 bg-surface-2 border-secondary">
					<h3 className="text-xl text-white mb-6">Volume Over Time</h3>
					{volumeEChartsOption ? (
						<EChartsWrapper option={volumeEChartsOption} height={300} />
					) : (
						<div className="h-[300px] flex items-center justify-center text-muted-foreground">
							No volume data for this period
						</div>
					)}
				</Card>

				<Card className="p-6 bg-surface-2 border-secondary">
					<h3 className="text-xl text-white mb-6">Muscle Group Distribution</h3>
					{muscleDonutOption ? (
						<EChartsWrapper option={muscleDonutOption} height={300} />
					) : (
						<div className="h-[300px] flex items-center justify-center text-muted-foreground">
							No muscle group data yet
						</div>
					)}
				</Card>
			</div>

			{/* Training Load + Consistency + Insights */}
			<div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
				<Card className="p-6 bg-surface-2 border-secondary">
					<h3 className="text-lg text-white mb-4">Training Load</h3>
					<TrainingLoadGauge
						score={trainingLoad.rtl}
						zone={trainingLoad.zone}
					/>
				</Card>

				<Card className="p-6 bg-surface-2 border-secondary">
					<h3 className="text-lg text-white mb-4">Consistency</h3>
					<ConsistencyWidget {...consistencyData} />
				</Card>

				<Card className="p-6 bg-surface-2 border-secondary">
					<h3 className="text-lg text-white mb-4">Insights</h3>
					<InsightsFeed
						insights={insightsFeedItems.slice(0, 3)}
						loading={insightsPending}
					/>
				</Card>
			</div>
		</>
	);
}
