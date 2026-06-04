import { TrendingUp } from "lucide-react";
import {
	Area,
	AreaChart,
	Bar,
	BarChart,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from "recharts";
import { MobileChartCard } from "@/app/components/analytics/MobileChartCard";
import { RechartsTooltip } from "@/app/components/charts/shared/RechartsTooltip";
import { Button } from "@/app/components/ui/button";
import { PHOENIX } from "@/lib/colors";
import type { WeightUnit } from "@/lib/units";
import {
	WORKOUT_PHASE_FILTERS,
	type WorkoutPhaseFilter,
} from "@/lib/workout-phases";
import type { PhaseMetricSummary } from "./phaseStatisticsTransforms";

export interface MobileProgressTabProps {
	unit: WeightUnit;
	mobileStrengthData: Array<{
		exercise: string;
		weight: number;
		phase: string;
	}>;
	mobileVolumeData: Array<{ date: string; volume: number }>;
	prCount: number;
	daysSinceLastPR: number | null;
	phaseFilter: WorkoutPhaseFilter;
	onPhaseFilterChange: (phase: WorkoutPhaseFilter) => void;
	phaseMetricSummary: PhaseMetricSummary;
}

function formatMetric(value: number, decimals = 1): string {
	return value.toFixed(decimals).replace(/\.0$/, "");
}

export default function MobileProgressTab({
	unit,
	mobileStrengthData,
	mobileVolumeData,
	prCount,
	daysSinceLastPR,
	phaseFilter,
	onPhaseFilterChange,
	phaseMetricSummary,
}: MobileProgressTabProps) {
	const titlePhase =
		phaseFilter === "all" ? "PHASE" : phaseFilter.toUpperCase();

	return (
		<>
			<MobileChartCard title="PHASE METRICS">
				<div className="flex flex-wrap gap-2 mb-4">
					{WORKOUT_PHASE_FILTERS.map((phase) => (
						<Button
							key={phase}
							type="button"
							size="sm"
							variant={phaseFilter === phase ? "default" : "outline"}
							onClick={() => onPhaseFilterChange(phase)}
							className={
								phaseFilter === phase
									? "h-8 text-xs"
									: "h-8 text-xs border-secondary text-muted-foreground"
							}
						>
							{phase === "all" ? "All" : phase}
						</Button>
					))}
				</div>
				{phaseMetricSummary.rowCount > 0 ? (
					<div className="grid grid-cols-3 gap-2">
						{[
							{
								label: "Load",
								value: phaseMetricSummary.load.eccentricMax,
								unit,
								decimals: 1,
							},
							{
								label: "Velocity",
								value: phaseMetricSummary.velocity.concentricMax,
								unit: "m/s",
								decimals: 2,
							},
							{
								label: "Power",
								value: phaseMetricSummary.power.eccentricMax,
								unit: "W",
								decimals: 0,
							},
						].map((item) => (
							<div
								key={item.label}
								className="rounded-lg border border-secondary bg-muted/10 p-3"
							>
								<div className="text-[10px] uppercase text-muted-foreground">
									{item.label}
								</div>
								<div className="mt-1 text-lg font-bold text-primary">
									{formatMetric(item.value, item.decimals)}
								</div>
								<div className="text-[10px] text-muted-foreground">
									{item.unit}
								</div>
							</div>
						))}
					</div>
				) : (
					<div className="py-8 text-center text-sm text-muted-foreground">
						No phase statistics for this period
					</div>
				)}
			</MobileChartCard>

			<MobileChartCard
				title={`TOP LIFTS (${titlePhase} - ${unit.toUpperCase()})`}
			>
				{mobileStrengthData.length > 0 ? (
					<ResponsiveContainer width="100%" height={250}>
						<BarChart data={mobileStrengthData} layout="vertical">
							<XAxis
								type="number"
								stroke={PHOENIX.ashGray}
								tickLine={false}
								axisLine={false}
								tick={{
									fontSize: 11,
									fontFamily: "Inter, sans-serif",
								}}
							/>
							<YAxis
								type="category"
								dataKey="exercise"
								stroke={PHOENIX.ashGray}
								width={70}
								tickLine={false}
								axisLine={false}
								tick={{
									fontSize: 11,
									fontFamily: "Inter, sans-serif",
								}}
							/>
							<Tooltip content={<RechartsTooltip />} />
							<Bar
								dataKey="weight"
								name={`Weight (${unit})`}
								fill={PHOENIX.ember}
								radius={[0, 4, 4, 0]}
								animationDuration={800}
								animationEasing="ease-out"
							/>
						</BarChart>
					</ResponsiveContainer>
				) : (
					<div className="h-[250px] flex items-center justify-center text-muted-foreground text-sm">
						No strength data yet. Set some PRs!
					</div>
				)}
			</MobileChartCard>

			<MobileChartCard title="VOLUME TREND">
				{mobileVolumeData.length > 0 ? (
					<ResponsiveContainer width="100%" height={250}>
						<AreaChart data={mobileVolumeData}>
							<defs>
								<linearGradient
									id="mobileTrendGradient"
									x1="0"
									y1="0"
									x2="0"
									y2="1"
								>
									<stop
										offset="5%"
										stopColor={PHOENIX.ember}
										stopOpacity={0.3}
									/>
									<stop
										offset="95%"
										stopColor={PHOENIX.ember}
										stopOpacity={0}
									/>
								</linearGradient>
							</defs>
							<XAxis
								dataKey="date"
								stroke={PHOENIX.ashGray}
								tickLine={false}
								axisLine={false}
								tick={{
									fontSize: 11,
									fontFamily: "Inter, sans-serif",
								}}
							/>
							<YAxis
								stroke={PHOENIX.ashGray}
								tickFormatter={(value) =>
									value >= 1000 ? `${value / 1000}k` : `${value}`
								}
								tickLine={false}
								axisLine={false}
								tick={{
									fontSize: 11,
									fontFamily: "Inter, sans-serif",
								}}
							/>
							<Tooltip content={<RechartsTooltip />} />
							<Area
								type="monotone"
								dataKey="volume"
								stroke={PHOENIX.ember}
								strokeWidth={2}
								fill="url(#mobileTrendGradient)"
								animationDuration={800}
								animationEasing="ease-out"
							/>
						</AreaChart>
					</ResponsiveContainer>
				) : (
					<div className="text-center py-12 text-muted-foreground">
						<TrendingUp className="w-12 h-12 mx-auto mb-3 opacity-50" />
						<p className="font-medium mb-1">Track your training trends</p>
						<p className="text-xs">
							Complete a few workouts to see your volume and strength trends
							here
						</p>
					</div>
				)}
			</MobileChartCard>

			{/* PR counter */}
			{prCount > 0 && (
				<MobileChartCard title="PERSONAL RECORDS">
					<div className="flex items-center gap-4">
						<div className="flex flex-col items-center justify-center rounded-lg bg-primary/10 px-4 py-3">
							<span className="text-2xl font-bold text-primary">{prCount}</span>
							<span className="text-[10px] text-muted-foreground">
								phase PRs
							</span>
						</div>
						{daysSinceLastPR != null && (
							<div className="flex flex-col items-center justify-center rounded-lg bg-muted/30 px-4 py-3">
								<span className="text-2xl font-bold text-white">
									{daysSinceLastPR}
								</span>
								<span className="text-[10px] text-muted-foreground">
									days since last PR
								</span>
							</div>
						)}
					</div>
				</MobileChartCard>
			)}
		</>
	);
}
