import { useQuery } from "@tanstack/react-query";
import { Minus, TrendingDown, TrendingUp } from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import {
	Area,
	AreaChart,
	CartesianGrid,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from "recharts";
import { RechartsTooltip } from "@/app/components/charts/shared/RechartsTooltip";
import { Card } from "@/app/components/ui/card";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/app/components/ui/select";
import { Skeleton } from "@/app/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/app/components/ui/tabs";
import { estimateOneRepMax } from "@/lib/biomechanics";
import { PHOENIX } from "@/lib/colors";
import { convertWeight, getUnitLabel } from "@/lib/units";
import { profileOptions } from "@/queries/profile";
import {
	exerciseListOptions,
	exerciseProgressOptions,
} from "@/queries/progress";
import type { ExerciseProgress as ExerciseProgressType } from "@/schemas/telemetry";

export interface ExerciseProgressProps {
	userId: string;
	initialExercise?: string;
}

const TIME_RANGES = [
	{ label: "1M", days: 30 },
	{ label: "3M", days: 90 },
	{ label: "6M", days: 180 },
	{ label: "1Y", days: 365 },
	{ label: "All", days: Infinity },
] as const;

function formatDate(date: Date): string {
	return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function filterByTimeRange(
	data: ExerciseProgressType[],
	days: number,
): ExerciseProgressType[] {
	if (days === Infinity || data.length === 0) return data;
	const cutoff = new Date();
	cutoff.setDate(cutoff.getDate() - days);
	return data.filter((d) => d.recorded_at >= cutoff);
}

interface TrendStat {
	current: number;
	change: number;
	changePercent: number;
	direction: "up" | "down" | "flat";
}

function computeTrend(values: number[]): TrendStat {
	if (values.length === 0)
		return { current: 0, change: 0, changePercent: 0, direction: "flat" };
	const first = values[0];
	const last = values[values.length - 1];
	const change = last - first;
	const changePercent = first !== 0 ? Math.round((change / first) * 100) : 0;
	const direction = change > 0 ? "up" : change < 0 ? "down" : "flat";
	return {
		current: Math.round(last * 10) / 10,
		change: Math.round(change * 10) / 10,
		changePercent,
		direction,
	};
}

function DirectionIcon({ direction }: { direction: "up" | "down" | "flat" }) {
	if (direction === "up")
		return <TrendingUp className="w-4 h-4 text-success" />;
	if (direction === "down")
		return <TrendingDown className="w-4 h-4 text-chart-2" />;
	return <Minus className="w-4 h-4 text-muted-foreground" />;
}

function StatCard({
	label,
	stat,
	color,
	unit,
}: {
	label: string;
	stat: TrendStat;
	color: string;
	unit: string;
}) {
	return (
		<Card className="p-4 bg-surface-2 border-secondary">
			<div className="text-sm text-muted-foreground mb-1">{label}</div>
			<div className="text-4xl font-bold tabular-nums" style={{ color }}>
				{stat.current} {unit}
			</div>
			<div className="flex items-center gap-2 mt-2">
				{stat.changePercent !== 0 && (
					<span
						className={`inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-xs font-medium ${
							stat.changePercent > 0
								? "bg-emerald-500/15 text-emerald-400"
								: "bg-red-500/15 text-red-400"
						}`}
					>
						{stat.changePercent > 0 ? "\u2191" : "\u2193"}{" "}
						{Math.abs(stat.changePercent)}%
					</span>
				)}
				<div className="flex items-center gap-1 text-xs">
					<DirectionIcon direction={stat.direction} />
					<span
						className={
							stat.direction === "up"
								? "text-success"
								: stat.direction === "down"
									? "text-chart-2"
									: "text-muted-foreground"
						}
					>
						{stat.change > 0 ? "+" : ""}
						{stat.change} {unit}
					</span>
				</div>
			</div>
		</Card>
	);
}

export function ExerciseProgress({
	userId,
	initialExercise,
}: ExerciseProgressProps) {
	const [selectedExercise, setSelectedExercise] = useState<string>(
		initialExercise ?? "",
	);
	const [timeRange, setTimeRange] = useState<string>("3M");

	const { data: exercises, isPending: exercisesPending } = useQuery(
		exerciseListOptions(userId),
	);
	const { data: profile } = useQuery({
		...profileOptions(userId),
		enabled: !!userId,
	});

	const { data: progressRaw, isPending: progressPending } = useQuery({
		...exerciseProgressOptions(userId, selectedExercise),
		enabled: !!selectedExercise,
	});
	const unit = profile?.weight_unit === "lbs" ? "lbs" : "kg";

	useEffect(() => {
		if (!selectedExercise && exercises && exercises.length > 0) {
			setSelectedExercise(exercises[0]);
		}
	}, [exercises, selectedExercise]);

	const days = TIME_RANGES.find((r) => r.label === timeRange)?.days ?? 90;
	const filteredData = useMemo(
		() => filterByTimeRange(progressRaw ?? [], days),
		[progressRaw, days],
	);

	// Chart data
	const chartData = useMemo(
		() =>
			filteredData.map((d) => ({
				date: formatDate(d.recorded_at),
				rawDate: d.recorded_at.getTime(),
				maxWeight: convertWeight(d.max_weight_kg, unit),
				totalVolume: convertWeight(d.total_volume_kg, unit),
				estimated1RM: convertWeight(
					d.estimated_1rm_kg > 0
						? d.estimated_1rm_kg
						: estimateOneRepMax(d.max_weight_kg, d.max_reps),
					unit,
				),
			})),
		[filteredData, unit],
	);

	// Trend stats
	const weightTrend = useMemo(
		() => computeTrend(chartData.map((d) => d.maxWeight)),
		[chartData],
	);
	const volumeTrend = useMemo(
		() => computeTrend(chartData.map((d) => d.totalVolume)),
		[chartData],
	);
	const oneRmTrend = useMemo(
		() => computeTrend(chartData.map((d) => d.estimated1RM)),
		[chartData],
	);

	if (exercisesPending) {
		return (
			<div className="space-y-6">
				<Skeleton className="h-10 w-64" />
				<div className="grid grid-cols-1 md:grid-cols-3 gap-4">
					<Skeleton className="h-24" />
					<Skeleton className="h-24" />
					<Skeleton className="h-24" />
				</div>
				<div className="grid grid-cols-1 md:grid-cols-3 gap-6">
					<Skeleton className="h-[300px]" />
					<Skeleton className="h-[300px]" />
					<Skeleton className="h-[300px]" />
				</div>
			</div>
		);
	}

	if (!exercises || exercises.length === 0) {
		return (
			<div className="text-center py-16">
				<div className="w-24 h-24 mx-auto mb-6 rounded-full bg-gradient-to-br from-primary/20 to-accent/20 flex items-center justify-center">
					<TrendingUp className="w-12 h-12 text-primary" />
				</div>
				<h3 className="text-2xl font-semibold text-white mb-2">
					No progress data yet
				</h3>
				<p className="text-muted-foreground max-w-md mx-auto">
					Complete workouts to start tracking exercise progress. Weight, volume,
					and 1RM trends will appear here.
				</p>
			</div>
		);
	}

	return (
		<div className="space-y-6">
			{/* Exercise selector + time range */}
			<div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
				<Select value={selectedExercise} onValueChange={setSelectedExercise}>
					<SelectTrigger className="w-64 bg-surface-2 border-secondary text-white">
						<SelectValue placeholder="Select an exercise" />
					</SelectTrigger>
					<SelectContent>
						{exercises.map((name) => (
							<SelectItem key={name} value={name}>
								{name}
							</SelectItem>
						))}
					</SelectContent>
				</Select>

				<Tabs value={timeRange} onValueChange={setTimeRange}>
					<TabsList className="bg-surface-2 border border-secondary">
						{TIME_RANGES.map((r) => (
							<TabsTrigger
								key={r.label}
								value={r.label}
								className="data-[state=active]:bg-primary data-[state=active]:text-white text-xs px-3"
							>
								{r.label}
							</TabsTrigger>
						))}
					</TabsList>
				</Tabs>
			</div>

			{progressPending ? (
				<div className="grid grid-cols-1 md:grid-cols-3 gap-6">
					<Skeleton className="h-[300px]" />
					<Skeleton className="h-[300px]" />
					<Skeleton className="h-[300px]" />
				</div>
			) : chartData.length === 0 ? (
				<div className="text-center py-12 text-muted-foreground">
					No progress data for this exercise in the selected time range
				</div>
			) : (
				<>
					{/* Summary stats */}
					<motion.div
						className="grid grid-cols-1 sm:grid-cols-3 gap-4"
						initial={{ opacity: 0, y: 10 }}
						animate={{ opacity: 1, y: 0 }}
					>
						<StatCard
							label="Max Weight"
							stat={weightTrend}
							color={PHOENIX.ember}
							unit={getUnitLabel(unit)}
						/>
						<StatCard
							label="Total Volume"
							stat={volumeTrend}
							color={PHOENIX.gold}
							unit={getUnitLabel(unit)}
						/>
						<StatCard
							label="Est. 1RM"
							stat={oneRmTrend}
							color={PHOENIX.forgeGreen}
							unit={getUnitLabel(unit)}
						/>
					</motion.div>

					{/* Three trend chart panels */}
					<div className="grid grid-cols-1 md:grid-cols-3 gap-6">
						{/* Panel A: Max Weight Trend */}
						<motion.div
							initial={{ opacity: 0, y: 20 }}
							animate={{ opacity: 1, y: 0 }}
							transition={{ delay: 0.1 }}
						>
							<Card className="p-4 bg-surface-2 border-secondary">
								<h4 className="text-sm font-medium text-muted-foreground mb-4">
									Max Weight Trend
								</h4>
								<div role="img" aria-label="Exercise volume trend over time">
									<ResponsiveContainer width="100%" height={250}>
										<AreaChart data={chartData}>
											<defs>
												<linearGradient
													id="weightGradient"
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
														stopOpacity={0.05}
													/>
												</linearGradient>
											</defs>
											<CartesianGrid strokeOpacity={0.3} vertical={false} />
											<XAxis
												dataKey="date"
												stroke={PHOENIX.mutedForeground}
												tickLine={false}
												axisLine={false}
												tick={{ fontSize: 11, fontFamily: "Inter, sans-serif" }}
											/>
											<YAxis
												stroke={PHOENIX.mutedForeground}
												tickLine={false}
												axisLine={false}
												tick={{ fontSize: 11, fontFamily: "Inter, sans-serif" }}
											/>
											<Tooltip content={<RechartsTooltip />} />
											<Area
												type="monotone"
												dataKey="maxWeight"
												name={`Max Weight (${getUnitLabel(unit)})`}
												stroke={PHOENIX.ember}
												strokeWidth={2}
												fill="url(#weightGradient)"
												dot={{ fill: PHOENIX.ember, r: 3 }}
												activeDot={{ r: 5 }}
												animationDuration={800}
												animationEasing="ease-out"
											/>
										</AreaChart>
									</ResponsiveContainer>
								</div>
							</Card>
						</motion.div>

						{/* Panel B: Total Volume Trend */}
						<motion.div
							initial={{ opacity: 0, y: 20 }}
							animate={{ opacity: 1, y: 0 }}
							transition={{ delay: 0.2 }}
						>
							<Card className="p-4 bg-surface-2 border-secondary">
								<h4 className="text-sm font-medium text-muted-foreground mb-4">
									Total Volume Trend
								</h4>
								<div
									role="img"
									aria-label="Estimated one-rep max trend over time"
								>
									<ResponsiveContainer width="100%" height={250}>
										<AreaChart data={chartData}>
											<defs>
												<linearGradient
													id="volumeGradientProgress"
													x1="0"
													y1="0"
													x2="0"
													y2="1"
												>
													<stop
														offset="5%"
														stopColor={PHOENIX.gold}
														stopOpacity={0.3}
													/>
													<stop
														offset="95%"
														stopColor={PHOENIX.gold}
														stopOpacity={0.05}
													/>
												</linearGradient>
											</defs>
											<CartesianGrid strokeOpacity={0.3} vertical={false} />
											<XAxis
												dataKey="date"
												stroke={PHOENIX.mutedForeground}
												tickLine={false}
												axisLine={false}
												tick={{ fontSize: 11, fontFamily: "Inter, sans-serif" }}
											/>
											<YAxis
												stroke={PHOENIX.mutedForeground}
												tickLine={false}
												axisLine={false}
												tick={{ fontSize: 11, fontFamily: "Inter, sans-serif" }}
											/>
											<Tooltip content={<RechartsTooltip />} />
											<Area
												type="monotone"
												dataKey="totalVolume"
												name={`Volume (${getUnitLabel(unit)})`}
												stroke={PHOENIX.gold}
												strokeWidth={2}
												fill="url(#volumeGradientProgress)"
												dot={{ fill: PHOENIX.gold, r: 3 }}
												activeDot={{ r: 5 }}
												animationDuration={800}
												animationEasing="ease-out"
											/>
										</AreaChart>
									</ResponsiveContainer>
								</div>
							</Card>
						</motion.div>

						{/* Panel C: Estimated 1RM Trend */}
						<motion.div
							initial={{ opacity: 0, y: 20 }}
							animate={{ opacity: 1, y: 0 }}
							transition={{ delay: 0.3 }}
						>
							<Card className="p-4 bg-surface-2 border-secondary">
								<h4 className="text-sm font-medium text-muted-foreground mb-4">
									Estimated 1RM Trend
								</h4>
								<div role="img" aria-label="Average velocity trend over time">
									<ResponsiveContainer width="100%" height={250}>
										<AreaChart data={chartData}>
											<defs>
												<linearGradient
													id="oneRmGradient"
													x1="0"
													y1="0"
													x2="0"
													y2="1"
												>
													<stop
														offset="5%"
														stopColor={PHOENIX.forgeGreen}
														stopOpacity={0.3}
													/>
													<stop
														offset="95%"
														stopColor={PHOENIX.forgeGreen}
														stopOpacity={0.05}
													/>
												</linearGradient>
											</defs>
											<CartesianGrid strokeOpacity={0.3} vertical={false} />
											<XAxis
												dataKey="date"
												stroke={PHOENIX.mutedForeground}
												tickLine={false}
												axisLine={false}
												tick={{ fontSize: 11, fontFamily: "Inter, sans-serif" }}
											/>
											<YAxis
												stroke={PHOENIX.mutedForeground}
												tickLine={false}
												axisLine={false}
												tick={{ fontSize: 11, fontFamily: "Inter, sans-serif" }}
											/>
											<Tooltip content={<RechartsTooltip />} />
											<Area
												type="monotone"
												dataKey="estimated1RM"
												name={`Est. 1RM (${getUnitLabel(unit)})`}
												stroke={PHOENIX.forgeGreen}
												strokeWidth={2}
												fill="url(#oneRmGradient)"
												dot={{ fill: PHOENIX.forgeGreen, r: 3 }}
												activeDot={{ r: 5 }}
												animationDuration={800}
												animationEasing="ease-out"
											/>
										</AreaChart>
									</ResponsiveContainer>
								</div>
							</Card>
						</motion.div>
					</div>
				</>
			)}
		</div>
	);
}
