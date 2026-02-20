import { useQuery } from "@tanstack/react-query";
import {
	Activity,
	AlertCircle,
	Download,
	Globe,
	Target,
	TrendingDown,
	TrendingUp,
} from "lucide-react";
import { motion } from "motion/react";
import { useState } from "react";
import {
	Area,
	AreaChart,
	Bar,
	BarChart,
	CartesianGrid,
	Cell,
	Legend,
	Line,
	LineChart,
	Pie,
	PieChart,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from "recharts";
import { toast } from "sonner";
import { AnalyticsMobile } from "@/app/components/mobile/AnalyticsMobile";
import { Badge } from "@/app/components/ui/badge";
import { Button } from "@/app/components/ui/button";
import { Card } from "@/app/components/ui/card";
import { EmptyState } from "@/app/components/ui/empty-state";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/app/components/ui/select";
import {
	ChartSkeleton,
	Skeleton,
	StatCardSkeleton,
} from "@/app/components/ui/skeleton";
import {
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from "@/app/components/ui/tabs";
import { useAuth } from "@/app/hooks/useAuth";
import { useIsMobile } from "@/app/hooks/useIsMobile";
import { PHOENIX } from "@/lib/colors";
import { downloadCSV } from "@/lib/export/csv";
import {
	muscleGroupOptions,
	strengthProgressOptions,
	volumeTrendOptions,
} from "@/queries/analytics";
import { externalActivitiesOptions } from "@/queries/integrations";

const MUSCLE_GROUP_COLORS: Record<string, string> = {
	Chest: PHOENIX.ember,
	Back: PHOENIX.flameRed,
	Legs: PHOENIX.gold,
	Shoulders: PHOENIX.forgeGreen,
	Arms: PHOENIX.ashGray,
	Core: PHOENIX.flameYellow,
};

// Time period to query period mapping
function periodToDays(timePeriod: string): string {
	switch (timePeriod) {
		case "7D":
			return "1w";
		case "30D":
			return "4w";
		case "90D":
			return "12w";
		case "1Y":
			return "52w";
		case "ALL":
			return "all";
		default:
			return "4w";
	}
}

// Bucket volume data into weekly aggregates for chart display
function bucketByWeek(
	data: Array<{ started_at: string; total_volume: number }>,
) {
	if (!data || data.length === 0) return [];
	const weeks = new Map<string, { volume: number; workouts: number }>();
	for (const item of data) {
		const date = new Date(item.started_at);
		// Get ISO week start (Monday)
		const day = date.getDay();
		const diff = date.getDate() - day + (day === 0 ? -6 : 1);
		const weekStart = new Date(date);
		weekStart.setDate(diff);
		const key = weekStart.toLocaleDateString("en-US", {
			month: "short",
			day: "numeric",
		});
		const existing = weeks.get(key) ?? { volume: 0, workouts: 0 };
		existing.volume += item.total_volume;
		existing.workouts += 1;
		weeks.set(key, existing);
	}
	return Array.from(weeks.entries()).map(([date, { volume, workouts }]) => ({
		date,
		volume: Math.round(volume),
		workouts,
	}));
}

// Group strength progress data by exercise for line chart
function groupStrengthByExercise(
	data: Array<{ exercise_name: string; value: number; achieved_at: string }>,
) {
	if (!data || data.length === 0) return [];
	// Get all unique dates and exercises
	const dateSet = new Set<string>();
	const exerciseMap = new Map<string, Map<string, number>>();

	for (const item of data) {
		const date = new Date(item.achieved_at).toLocaleDateString("en-US", {
			month: "short",
		});
		dateSet.add(date);
		if (!exerciseMap.has(item.exercise_name)) {
			exerciseMap.set(item.exercise_name, new Map());
		}
		// Keep highest value per exercise per month
		const existing = exerciseMap.get(item.exercise_name)?.get(date) ?? 0;
		if (item.value > existing) {
			exerciseMap.get(item.exercise_name)?.set(date, item.value);
		}
	}

	const dates = Array.from(dateSet);
	// Pick top 3 exercises by latest value
	const exercises = Array.from(exerciseMap.entries())
		.map(([name, values]) => ({
			name,
			latestValue: Array.from(values.values()).pop() ?? 0,
		}))
		.sort((a, b) => b.latestValue - a.latestValue)
		.slice(0, 3)
		.map((e) => e.name);

	return dates.map((date) => {
		const point: Record<string, string | number> = { date };
		for (const exercise of exercises) {
			point[exercise] = exerciseMap.get(exercise)?.get(date) ?? 0;
		}
		return point;
	});
}

const EXERCISE_COLORS = [PHOENIX.ember, PHOENIX.flameRed, PHOENIX.gold];

interface Insight {
	type: "positive" | "warning" | "neutral";
	title: string;
	description: string;
	icon: typeof TrendingUp;
}

function generateInsights(
	volumeData: Array<{ date: string; volume: number; workouts: number }>,
	muscleGroupData: Array<{ name: string; value: number; color: string }>,
	strengthExercises: string[],
	totalWorkouts: number,
): Insight[] {
	const insights: Insight[] = [];

	// 1. Volume Trend (requires >= 2 data points)
	if (volumeData.length >= 2) {
		const current = volumeData[volumeData.length - 1].volume;
		const previous = volumeData[volumeData.length - 2].volume;
		if (previous > 0) {
			const changeRaw = ((current - previous) / previous) * 100;
			const change = Math.abs(Math.round(changeRaw));
			if (changeRaw > 0) {
				insights.push({
					type: "positive",
					title: "Volume Trending Up",
					description: `${change}% increase vs previous week`,
					icon: TrendingUp,
				});
			} else if (changeRaw <= -20) {
				insights.push({
					type: "warning",
					title: "Volume Drop Detected",
					description: `${change}% decrease -- consider if this is an intentional deload or missed sessions`,
					icon: TrendingDown,
				});
			} else {
				insights.push({
					type: "neutral",
					title: "Volume Stable",
					description: `Slight ${change}% decrease -- within normal variation`,
					icon: Activity,
				});
			}
		}
	}

	// 2. Muscle Balance (requires >= 2 muscle groups)
	if (muscleGroupData.length >= 2) {
		const sorted = [...muscleGroupData].sort((a, b) => b.value - a.value);
		const dominant = sorted[0];
		const weakest = sorted[sorted.length - 1];
		if (weakest.value > 0 && dominant.value > 3 * weakest.value) {
			insights.push({
				type: "warning",
				title: "Muscle Imbalance",
				description: `${dominant.name} at ${dominant.value}% vs ${weakest.name} at ${weakest.value}% -- consider more ${weakest.name} work`,
				icon: AlertCircle,
			});
		} else {
			insights.push({
				type: "positive",
				title: "Balanced Training",
				description: `Good distribution across ${muscleGroupData.length} muscle groups`,
				icon: Target,
			});
		}
	}

	// 3. Consistency (requires workouts > 0)
	if (totalWorkouts > 0) {
		const avgPerWeek = Math.round(
			totalWorkouts / Math.max(volumeData.length, 1),
		);
		if (avgPerWeek >= 3) {
			insights.push({
				type: "positive",
				title: "Great Consistency",
				description: `Averaging ${avgPerWeek} workouts per week`,
				icon: Activity,
			});
		} else {
			insights.push({
				type: "neutral",
				title: "Room to Grow",
				description: `Averaging ${avgPerWeek} workouts per week -- 3+ is ideal for progress`,
				icon: Activity,
			});
		}
	}

	// 4. Strength Tracking (requires exercises)
	if (strengthExercises.length > 0) {
		const displayNames = strengthExercises.slice(0, 3).join(", ");
		insights.push({
			type: "positive",
			title: "Strength Tracking Active",
			description: `Tracking progress on ${strengthExercises.length} exercises: ${displayNames}`,
			icon: TrendingUp,
		});
	}

	// 5. Fallback -- guaranteed at least one insight
	if (insights.length === 0) {
		insights.push({
			type: "neutral",
			title: "Building Your Profile",
			description:
				"Complete more workouts to unlock personalized training insights",
			icon: Activity,
		});
	}

	return insights;
}

export function Analytics() {
	const isMobile = useIsMobile();
	const { user } = useAuth();
	const [timePeriod, setTimePeriod] = useState("30D");

	const queryPeriod = periodToDays(timePeriod);
	const { data: volumeRaw, isPending: volumePending } = useQuery(
		volumeTrendOptions(user?.id, queryPeriod),
	);
	const { data: muscleGroupRaw, isPending: musclePending } = useQuery(
		muscleGroupOptions(user?.id),
	);
	const { data: strengthRaw, isPending: strengthPending } = useQuery(
		strengthProgressOptions(user?.id),
	);
	const { data: externalActivities } = useQuery({
		...externalActivitiesOptions(user?.id),
		enabled: !!user,
	});

	if (isMobile) {
		return <AnalyticsMobile />;
	}

	const isPending = volumePending || musclePending || strengthPending;

	// Convert external activities to chart-compatible format
	const externalChartData = (externalActivities ?? []).map((activity) => ({
		date: activity.started_at,
		provider: activity.provider,
		duration: activity.duration_seconds ? activity.duration_seconds / 60 : 0, // minutes
		calories: activity.calories ?? 0,
		type: activity.activity_type,
		isExternal: true,
	}));
	const volumeData = bucketByWeek(volumeRaw ?? []);
	const muscleGroupData = (muscleGroupRaw ?? []).map((m) => ({
		...m,
		color: MUSCLE_GROUP_COLORS[m.name] ?? PHOENIX.ashGray,
	}));
	const strengthProgressData = groupStrengthByExercise(strengthRaw ?? []);
	const strengthExercises =
		strengthProgressData.length > 0
			? Object.keys(strengthProgressData[0]).filter((k) => k !== "date")
			: [];

	// Derive summary stats from real data
	const totalVolume = volumeData.reduce((sum, d) => sum + d.volume, 0);
	const totalWorkouts = volumeData.reduce((sum, d) => sum + d.workouts, 0);
	const _avgDuration =
		totalWorkouts > 0 ? Math.round(totalVolume / totalWorkouts / 100) : 0; // rough estimate

	const insights = generateInsights(
		volumeData,
		muscleGroupData,
		strengthExercises,
		totalWorkouts,
	);

	if (isPending) {
		return (
			<div className="min-h-screen bg-background pb-20 md:pb-8">
				<div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
					<Skeleton className="h-10 w-48 mb-2" />
					<Skeleton className="h-4 w-64 mb-8" />
					<div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
						{Array.from({ length: 4 }).map((_, i) => (
							<StatCardSkeleton key={i} />
						))}
					</div>
					<div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
						<ChartSkeleton />
						<ChartSkeleton />
					</div>
				</div>
			</div>
		);
	}

	const externalCount = externalActivities?.length ?? 0;
	const hasData =
		volumeData.length > 0 || muscleGroupData.length > 0 || externalCount > 0;

	return (
		<div className="min-h-screen bg-background pb-20 md:pb-8">
			<div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
				{/* Header */}
				<div className="mb-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
					<div>
						<h1 className="text-3xl sm:text-4xl mb-2">
							<span className="bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
								Analytics Hub
							</span>
						</h1>
						<p className="text-muted-foreground">
							Comprehensive insights into your training
						</p>
					</div>
					<div className="flex items-center gap-3">
						<Select value={timePeriod} onValueChange={setTimePeriod}>
							<SelectTrigger
								aria-label="Time period"
								className="w-32 bg-surface-2 border-secondary text-white"
							>
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="7D">7 Days</SelectItem>
								<SelectItem value="30D">30 Days</SelectItem>
								<SelectItem value="90D">90 Days</SelectItem>
								<SelectItem value="1Y">1 Year</SelectItem>
								<SelectItem value="ALL">All Time</SelectItem>
							</SelectContent>
						</Select>
						<Button
							variant="outline"
							className="border-primary text-primary hover:bg-primary/10"
							onClick={() => {
								const rows = volumeData.map((d) =>
									[d.date, d.volume, d.workouts].join(","),
								);
								const header = "Week,Volume (kg),Workouts";
								const csv = [header, ...rows].join("\n");
								downloadCSV(
									csv,
									`analytics-${timePeriod.toLowerCase()}-${new Date().toISOString().slice(0, 10)}`,
								);
								toast.success("Analytics exported as CSV");
							}}
						>
							<Download className="w-4 h-4 mr-2" />
							Export
						</Button>
					</div>
				</div>

				{!hasData ? (
					<EmptyState
						icon={TrendingUp}
						title="Your analytics await"
						description="Complete a few workouts to unlock insights into your training volume, strength trends, and muscle balance."
					/>
				) : (
					<>
						{/* Summary Cards */}
						<div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
							{[
								{
									label: "Total Volume",
									value:
										totalVolume > 1000
											? `${(totalVolume / 1000).toFixed(1)}K kg`
											: `${totalVolume} kg`,
									change: "",
									positive: true,
								},
								{
									label: "Workouts",
									value: `${totalWorkouts}`,
									change: "",
									positive: true,
								},
								{
									label: "Muscle Groups",
									value: `${muscleGroupData.length}`,
									change: "",
									positive: true,
								},
								{
									label: "Exercises Tracked",
									value: `${strengthExercises.length}`,
									change: "",
									positive: true,
								},
							].map((stat, index) => (
								<motion.div
									key={stat.label}
									initial={{ opacity: 0, y: 20 }}
									animate={{ opacity: 1, y: 0 }}
									transition={{ delay: index * 0.1 }}
								>
									<Card className="p-4 bg-gradient-to-br from-surface-2 to-background border-secondary">
										<div className="text-sm text-muted-foreground mb-1">
											{stat.label}
										</div>
										<div className="text-2xl text-white mb-1">{stat.value}</div>
										{stat.change && (
											<div
												className={`text-xs flex items-center gap-1 ${
													stat.positive ? "text-success" : "text-muted"
												}`}
											>
												{stat.positive ? (
													<TrendingUp className="w-3 h-3" />
												) : (
													<TrendingDown className="w-3 h-3" />
												)}
												{stat.change}
											</div>
										)}
									</Card>
								</motion.div>
							))}
						</div>

						{/* Main Content Tabs */}
						<Tabs defaultValue="overview" className="space-y-6">
							<TabsList className="bg-surface-2 border border-secondary p-1">
								<TabsTrigger
									value="overview"
									className="data-[state=active]:bg-primary"
								>
									Overview
								</TabsTrigger>
								<TabsTrigger
									value="strength"
									className="data-[state=active]:bg-primary"
								>
									Strength Progress
								</TabsTrigger>
								<TabsTrigger
									value="insights"
									className="data-[state=active]:bg-primary"
								>
									Trends & Insights
								</TabsTrigger>
								<TabsTrigger
									value="body"
									className="data-[state=active]:bg-primary"
								>
									Body Part Analysis
								</TabsTrigger>
								<TabsTrigger
									value="external"
									className="data-[state=active]:bg-primary"
								>
									External
								</TabsTrigger>
							</TabsList>

							{/* Overview Tab */}
							<TabsContent value="overview" className="space-y-6">
								{/* Activity Sources Breakdown */}
								{(totalWorkouts > 0 || externalCount > 0) && (
									<Card className="p-6 bg-gradient-to-br from-surface-2 to-background border-secondary">
										<h3 className="text-xl text-white mb-4">
											Activity Sources
										</h3>
										<div className="grid grid-cols-2 md:grid-cols-4 gap-4">
											<div>
												<p className="text-2xl font-bold text-primary">
													{totalWorkouts}
												</p>
												<p className="text-sm text-muted-foreground">
													Phoenix Workouts
												</p>
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
												<p className="text-sm text-muted-foreground">
													Total Activities
												</p>
											</div>
											<div>
												<p className="text-2xl font-bold text-emerald-400">
													{externalChartData
														.reduce((sum, a) => sum + a.calories, 0)
														.toLocaleString()}
												</p>
												<p className="text-sm text-muted-foreground">
													External Calories
												</p>
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

								<div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
									{/* Volume Over Time */}
									<Card className="p-6 bg-gradient-to-br from-surface-2 to-background border-secondary">
										<h3 className="text-xl text-white mb-6">
											Volume Over Time
										</h3>
										{volumeData.length > 0 ? (
											<ResponsiveContainer width="100%" height={300}>
												<AreaChart data={volumeData}>
													<defs>
														<linearGradient
															id="volumeGradientAnalytics"
															x1="0"
															y1="0"
															x2="0"
															y2="1"
														>
															<stop
																offset="5%"
																stopColor={PHOENIX.ember}
																stopOpacity={0.8}
															/>
															<stop
																offset="95%"
																stopColor={PHOENIX.flameRed}
																stopOpacity={0.1}
															/>
														</linearGradient>
													</defs>
													<CartesianGrid
														strokeDasharray="3 3"
														stroke={PHOENIX.moltenSteel}
													/>
													<XAxis
														dataKey="date"
														stroke={PHOENIX.mutedForeground}
													/>
													<YAxis stroke={PHOENIX.mutedForeground} />
													<Tooltip
														contentStyle={{
															backgroundColor: "var(--surface-2)",
															border: "1px solid #374151",
															borderRadius: "8px",
															color: "var(--secondary-foreground)",
														}}
													/>
													<Area
														type="monotone"
														dataKey="volume"
														stroke={PHOENIX.ember}
														strokeWidth={2}
														fill="url(#volumeGradientAnalytics)"
													/>
												</AreaChart>
											</ResponsiveContainer>
										) : (
											<div className="h-[300px] flex items-center justify-center text-muted">
												No volume data for this period
											</div>
										)}
									</Card>

									{/* Muscle Group Distribution */}
									<Card className="p-6 bg-gradient-to-br from-surface-2 to-background border-secondary">
										<h3 className="text-xl text-white mb-6">
											Muscle Group Distribution
										</h3>
										{muscleGroupData.length > 0 ? (
											<ResponsiveContainer width="100%" height={300}>
												<PieChart>
													<Pie
														data={muscleGroupData}
														cx="50%"
														cy="50%"
														labelLine={false}
														label={({ name, value }) => `${name} ${value}%`}
														outerRadius={100}
														fill="#8884d8"
														dataKey="value"
													>
														{muscleGroupData.map((entry, index) => (
															<Cell key={`cell-${index}`} fill={entry.color} />
														))}
													</Pie>
													<Tooltip
														contentStyle={{
															backgroundColor: "var(--surface-2)",
															border: "1px solid #374151",
															borderRadius: "8px",
															color: "var(--secondary-foreground)",
														}}
													/>
												</PieChart>
											</ResponsiveContainer>
										) : (
											<div className="h-[300px] flex items-center justify-center text-muted">
												No muscle group data yet
											</div>
										)}
									</Card>
								</div>
							</TabsContent>

							{/* Strength Progress Tab */}
							<TabsContent value="strength" className="space-y-6">
								<Card className="p-6 bg-gradient-to-br from-surface-2 to-background border-secondary">
									<h3 className="text-xl text-white mb-6">1RM Progression</h3>
									{strengthProgressData.length > 0 ? (
										<ResponsiveContainer width="100%" height={400}>
											<LineChart data={strengthProgressData}>
												<CartesianGrid
													strokeDasharray="3 3"
													stroke={PHOENIX.moltenSteel}
												/>
												<XAxis
													dataKey="date"
													stroke={PHOENIX.mutedForeground}
												/>
												<YAxis stroke={PHOENIX.mutedForeground} />
												<Tooltip
													contentStyle={{
														backgroundColor: "var(--surface-2)",
														border: "1px solid #374151",
														borderRadius: "8px",
														color: "var(--secondary-foreground)",
													}}
												/>
												<Legend />
												{strengthExercises.map((exercise, i) => (
													<Line
														key={exercise}
														type="monotone"
														dataKey={exercise}
														name={exercise}
														stroke={EXERCISE_COLORS[i % EXERCISE_COLORS.length]}
														strokeWidth={2}
														dot={{
															fill: EXERCISE_COLORS[i % EXERCISE_COLORS.length],
															r: 4,
														}}
													/>
												))}
											</LineChart>
										</ResponsiveContainer>
									) : (
										<div className="h-[400px] flex items-center justify-center text-muted">
											No strength progress data yet. Set some PRs to see your
											progression!
										</div>
									)}
								</Card>
							</TabsContent>

							{/* Trends & Insights Tab */}
							<TabsContent value="insights" className="space-y-6">
								<div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
									{insights.map((insight, index) => (
										<motion.div
											key={index}
											initial={{ opacity: 0, y: 20 }}
											animate={{ opacity: 1, y: 0 }}
											transition={{ delay: index * 0.1 }}
										>
											<Card
												className={`p-6 border-2 ${
													insight.type === "positive"
														? "bg-gradient-to-br from-success/10 to-background border-success"
														: insight.type === "warning"
															? "bg-gradient-to-br from-warning/10 to-background border-warning"
															: "bg-gradient-to-br from-muted/10 to-background border-muted"
												}`}
											>
												<div className="flex items-start gap-4">
													<div
														className={`p-3 rounded-lg ${
															insight.type === "positive"
																? "bg-success/20"
																: insight.type === "warning"
																	? "bg-warning/20"
																	: "bg-muted/20"
														}`}
													>
														<insight.icon
															className={`w-6 h-6 ${
																insight.type === "positive"
																	? "text-success"
																	: insight.type === "warning"
																		? "text-warning"
																		: "text-muted"
															}`}
														/>
													</div>
													<div className="flex-1">
														<h4 className="text-white text-lg mb-1">
															{insight.title}
														</h4>
														<p className="text-muted-foreground">
															{insight.description}
														</p>
													</div>
												</div>
											</Card>
										</motion.div>
									))}
								</div>
							</TabsContent>

							{/* Body Part Analysis Tab */}
							<TabsContent value="body" className="space-y-6">
								<Card className="p-6 bg-gradient-to-br from-surface-2 to-background border-secondary">
									<h3 className="text-xl text-white mb-6">
										Muscle Group Frequency
									</h3>
									{muscleGroupData.length > 0 ? (
										<div className="grid grid-cols-2 md:grid-cols-3 gap-4">
											{muscleGroupData.map((muscle) => (
												<div
													key={muscle.name}
													className="p-4 rounded-lg border-2 cursor-pointer hover:scale-105 transition-transform"
													style={{
														backgroundColor: `${muscle.color}20`,
														borderColor: muscle.color,
													}}
												>
													<div className="text-white mb-2">{muscle.name}</div>
													<div
														className="text-2xl mb-1"
														style={{ color: muscle.color }}
													>
														{muscle.value}%
													</div>
													<div className="text-xs text-muted-foreground">
														of total volume
													</div>
												</div>
											))}
										</div>
									) : (
										<div className="text-center py-12 text-muted">
											No body part data yet
										</div>
									)}
								</Card>
							</TabsContent>

							{/* External Activities Tab */}
							<TabsContent value="external" className="space-y-6">
								{externalCount > 0 ? (
									<>
										{/* External Activity Duration Chart */}
										<Card className="p-6 bg-gradient-to-br from-surface-2 to-background border-secondary">
											<h3 className="text-xl text-white mb-6">
												External Activity Duration
											</h3>
											<ResponsiveContainer width="100%" height={300}>
												<BarChart
													data={externalChartData.slice(0, 20).reverse()}
												>
													<CartesianGrid
														strokeDasharray="3 3"
														stroke={PHOENIX.moltenSteel}
													/>
													<XAxis
														dataKey="date"
														stroke={PHOENIX.mutedForeground}
														tickFormatter={(val: string) =>
															new Date(val).toLocaleDateString(undefined, {
																month: "short",
																day: "numeric",
															})
														}
													/>
													<YAxis
														stroke={PHOENIX.mutedForeground}
														label={{
															value: "min",
															angle: -90,
															position: "insideLeft",
															fill: PHOENIX.mutedForeground,
														}}
													/>
													<Tooltip
														contentStyle={{
															backgroundColor: "var(--surface-2)",
															border: "1px solid #374151",
															borderRadius: "8px",
															color: "var(--secondary-foreground)",
														}}
														labelFormatter={(val: string) =>
															new Date(val).toLocaleDateString(undefined, {
																month: "short",
																day: "numeric",
																year: "numeric",
															})
														}
														formatter={(value: number, name: string) => [
															`${Math.round(value)} min`,
															name === "duration" ? "Duration" : name,
														]}
													/>
													<Bar
														dataKey="duration"
														fill="#60A5FA"
														radius={[4, 4, 0, 0]}
													/>
												</BarChart>
											</ResponsiveContainer>
										</Card>

										{/* Recent External Activities List */}
										<Card className="p-6 bg-gradient-to-br from-surface-2 to-background border-secondary">
											<h3 className="text-xl text-white mb-4">
												Recent External Activities
											</h3>
											<div className="space-y-3">
												{externalChartData
													.slice(0, 10)
													.map((activity, index) => (
														<div
															key={index}
															className="flex items-center justify-between p-3 rounded-lg bg-surface-1 border border-secondary"
														>
															<div className="flex items-center gap-3">
																<div className="p-2 rounded-lg bg-blue-500/20">
																	<Globe className="w-4 h-4 text-blue-400" />
																</div>
																<div>
																	<p className="text-sm text-white capitalize">
																		{activity.type}
																	</p>
																	<p className="text-xs text-muted-foreground">
																		{new Date(activity.date).toLocaleDateString(
																			undefined,
																			{
																				month: "short",
																				day: "numeric",
																				year: "numeric",
																			},
																		)}
																	</p>
																</div>
															</div>
															<div className="flex items-center gap-4">
																<div className="text-right">
																	<p className="text-sm text-white">
																		{Math.round(activity.duration)} min
																	</p>
																	{activity.calories > 0 && (
																		<p className="text-xs text-muted-foreground">
																			{activity.calories} kcal
																		</p>
																	)}
																</div>
																<Badge
																	variant="outline"
																	className="capitalize text-xs"
																>
																	{activity.provider}
																</Badge>
															</div>
														</div>
													))}
											</div>
										</Card>
									</>
								) : (
									<div className="text-center py-16">
										<div className="w-24 h-24 mx-auto mb-6 rounded-full bg-gradient-to-br from-blue-500/20 to-blue-400/20 flex items-center justify-center">
											<Globe className="w-12 h-12 text-blue-400" />
										</div>
										<h3 className="text-2xl font-semibold text-white mb-2">
											No external activities
										</h3>
										<p className="text-muted-foreground max-w-md mx-auto">
											Connect fitness services in the Integrations page to see
											external activities here.
										</p>
									</div>
								)}
							</TabsContent>
						</Tabs>
					</>
				)}
			</div>
		</div>
	);
}
