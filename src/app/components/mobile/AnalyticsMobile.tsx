import { useQuery } from "@tanstack/react-query";
import { Activity, Download, Dumbbell, Target, TrendingUp, Zap } from "lucide-react";
import { motion } from "motion/react";
import { useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import {
	Area,
	AreaChart,
	Bar,
	BarChart,
	Cell,
	Pie,
	PieChart,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from "recharts";
import { Card } from "@/app/components/ui/card";
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
import { useAuth } from "@/app/hooks/useAuth";
import { EmptyState } from "@/app/components/ui/empty-state";
import { PHOENIX } from "@/lib/colors";
import { downloadCSV } from "@/lib/export/csv";
import {
	muscleGroupOptions,
	strengthProgressOptions,
	volumeTrendOptions,
} from "@/queries/analytics";

const MUSCLE_GROUP_COLORS: Record<string, string> = {
	Chest: PHOENIX.ember,
	Back: PHOENIX.gold,
	Legs: PHOENIX.forgeGreen,
	Shoulders: "#6366F1",
	Arms: "#EC4899",
	Core: "#8B5CF6",
};

interface StatCardProps {
	label: string;
	value: string;
	icon: React.ReactNode;
	trend?: string;
	trendUp?: boolean;
}

function StatCard({ label, value, icon, trend, trendUp }: StatCardProps) {
	return (
		<Card className="min-w-[120px] p-4 bg-gradient-to-br from-surface-2 to-background border-secondary">
			<div className="flex flex-col">
				<div className="text-muted-foreground text-xs mb-1">{label}</div>
				<div className="flex items-center justify-between">
					<span className="text-2xl font-bold text-white">{value}</span>
					<div className="text-primary">{icon}</div>
				</div>
				{trend && (
					<div
						className={`text-xs mt-1 ${trendUp ? "text-success" : "text-destructive"}`}
					>
						{trend}
					</div>
				)}
			</div>
		</Card>
	);
}

interface ChartCardProps {
	title: string;
	onTap?: () => void;
	children: React.ReactNode;
}

function ChartCard({ title, onTap, children }: ChartCardProps) {
	return (
		<Card
			onClick={onTap}
			className="p-4 bg-gradient-to-br from-surface-2 to-background border-secondary active:scale-[0.98] transition-transform"
		>
			<h3 className="text-sm font-semibold text-white mb-3">{title}</h3>
			{children}
			{onTap && (
				<p className="text-xs text-muted text-center mt-2">Tap for details</p>
			)}
		</Card>
	);
}

function periodToQuery(period: string): string {
	switch (period) {
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

function bucketByWeek(
	data: Array<{ started_at: string; total_volume: number }>,
) {
	if (!data || data.length === 0) return [];
	const weeks = new Map<string, number>();
	for (const item of data) {
		const date = new Date(item.started_at);
		const day = date.getDay();
		const diff = date.getDate() - day + (day === 0 ? -6 : 1);
		const weekStart = new Date(date);
		weekStart.setDate(diff);
		const _key = `W${weeks.size + 1}`;
		const weekKey = weekStart.toISOString().slice(0, 10);
		// Use ISO date as internal key, display as W1, W2, etc.
		weeks.set(weekKey, (weeks.get(weekKey) ?? 0) + item.total_volume);
	}
	let i = 1;
	return Array.from(weeks.entries()).map(([, volume]) => ({
		date: `W${i++}`,
		volume: Math.round(volume),
	}));
}

export function AnalyticsMobile() {
	const { user } = useAuth();
	const [timePeriod, setTimePeriod] = useState("30D");
	const [activeTab, setActiveTab] = useState("overview");

	const queryPeriod = periodToQuery(timePeriod);
	const { data: volumeRaw, isPending: volumePending } = useQuery(
		volumeTrendOptions(user?.id, queryPeriod),
	);
	const { data: muscleGroupRaw, isPending: musclePending } = useQuery(
		muscleGroupOptions(user?.id),
	);
	const { data: strengthRaw, isPending: strengthPending } = useQuery(
		strengthProgressOptions(user?.id),
	);

	const isPending = volumePending || musclePending || strengthPending;

	const volumeData = bucketByWeek(volumeRaw ?? []);
	const muscleData = (muscleGroupRaw ?? []).map((m) => ({
		...m,
		color: MUSCLE_GROUP_COLORS[m.name] ?? PHOENIX.ashGray,
	}));

	// Build strength data from PR records (top exercises by value)
	const strengthMap = new Map<string, number>();
	for (const item of strengthRaw ?? []) {
		const existing = strengthMap.get(item.exercise_name) ?? 0;
		if (item.value > existing) {
			strengthMap.set(item.exercise_name, item.value);
		}
	}
	const strengthData = Array.from(strengthMap.entries())
		.sort((a, b) => b[1] - a[1])
		.slice(0, 5)
		.map(([exercise, weight]) => ({
			exercise: exercise.length > 8 ? exercise.slice(0, 8) : exercise,
			weight,
		}));

	// Derive stats
	const totalVolume = volumeData.reduce((sum, d) => sum + d.volume, 0);
	const totalWorkouts = (volumeRaw ?? []).length;

	const stats = [
		{
			label: "Volume",
			value:
				totalVolume > 1000
					? `${Math.round(totalVolume / 1000)}K`
					: `${totalVolume}`,
			icon: <TrendingUp className="w-5 h-5" />,
			trend: undefined,
			trendUp: undefined,
		},
		{
			label: "Workouts",
			value: `${totalWorkouts}`,
			icon: <Dumbbell className="w-5 h-5" />,
			trend: undefined,
			trendUp: undefined,
		},
		{
			label: "PRs",
			value: `${(strengthRaw ?? []).length}`,
			icon: <Target className="w-5 h-5" />,
			trend: undefined,
			trendUp: undefined,
		},
		{
			label: "Groups",
			value: `${muscleData.length}`,
			icon: <Zap className="w-5 h-5" />,
			trend: undefined,
			trendUp: undefined,
		},
	];

	if (isPending) {
		return (
			<div className="min-h-screen bg-background pb-20">
				<div className="sticky top-0 bg-background/95 backdrop-blur-lg z-10 px-4 py-3 border-b border-secondary">
					<Skeleton className="h-6 w-32" />
				</div>
				<div className="flex overflow-x-auto gap-3 px-4 py-4">
					{Array.from({ length: 4 }).map((_, i) => (
						<div key={i} className="min-w-[120px]">
							<StatCardSkeleton />
						</div>
					))}
				</div>
				<div className="px-4 py-4 space-y-4">
					<ChartSkeleton />
				</div>
			</div>
		);
	}

	const hasData = volumeData.length > 0 || muscleData.length > 0;

	return (
		<div className="min-h-screen bg-background pb-20">
			{/* Compact Header */}
			<div className="sticky top-0 bg-background/95 backdrop-blur-lg z-10 px-4 py-3 border-b border-secondary">
				<div className="flex items-center justify-between">
					<h1 className="text-xl font-bold">
						<span className="bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
							Analytics Hub
						</span>
					</h1>
					<div className="flex items-center gap-2">
						<Select value={timePeriod} onValueChange={setTimePeriod}>
							<SelectTrigger className="w-20 h-8 text-sm bg-surface-2 border-secondary">
								<SelectValue />
							</SelectTrigger>
							<SelectContent className="bg-surface-2 border-secondary">
								<SelectItem value="7D">7D</SelectItem>
								<SelectItem value="30D">30D</SelectItem>
								<SelectItem value="90D">90D</SelectItem>
								<SelectItem value="1Y">1Y</SelectItem>
								<SelectItem value="ALL">All</SelectItem>
							</SelectContent>
						</Select>
						<button
							className="w-8 h-8 flex items-center justify-center text-muted-foreground hover:text-white transition-colors"
							onClick={() => {
								const rows = volumeData.map((d) =>
									[d.date, d.volume].join(","),
								);
								const header = "Week,Volume (kg)";
								const csv = [header, ...rows].join("\n");
								downloadCSV(
									csv,
									`analytics-${timePeriod.toLowerCase()}-${new Date().toISOString().slice(0, 10)}`,
								);
								toast.success("Analytics exported as CSV");
							}}
						>
							<Download className="w-4 h-4" />
						</button>
					</div>
				</div>
			</div>

			{/* Horizontal Scroll Stats */}
			<div className="flex overflow-x-auto gap-3 px-4 py-4 scrollbar-hide snap-x snap-mandatory">
				{stats.map((stat) => (
					<motion.div
						key={stat.label}
						whileTap={{ scale: 0.95 }}
						className="snap-start"
					>
						<StatCard {...stat} />
					</motion.div>
				))}
			</div>

			{/* Scrollable Tabs */}
			<div className="overflow-x-auto scrollbar-hide border-b border-secondary">
				<div className="flex px-4 gap-1">
					{[
						{ value: "overview", label: "Overview" },
						{ value: "strength", label: "Strength" },
						{ value: "trends", label: "Trends" },
						{ value: "body", label: "Body" },
					].map((tab) => (
						<button
							key={tab.value}
							onClick={() => setActiveTab(tab.value)}
							className={`px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
								activeTab === tab.value
									? "text-white border-primary"
									: "text-muted-foreground border-transparent"
							}`}
						>
							{tab.label}
						</button>
					))}
				</div>
			</div>

			{/* Content */}
			<div className="px-4 py-4 space-y-4">
				{!hasData ? (
					<EmptyState
						icon={TrendingUp}
						title="Your analytics await"
						description="Complete a few workouts to unlock insights into your training volume, strength trends, and muscle balance."
					/>
				) : (
					<>
						{activeTab === "overview" && (
							<>
								{/* Volume Chart */}
								<ChartCard title="VOLUME OVER TIME">
									{volumeData.length > 0 ? (
										<ResponsiveContainer width="100%" height={200}>
											<AreaChart data={volumeData}>
												<defs>
													<linearGradient
														id="volumeGradient"
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
													style={{ fontSize: "12px" }}
												/>
												<YAxis
													stroke={PHOENIX.ashGray}
													style={{ fontSize: "12px" }}
													tickFormatter={(value) => `${value / 1000}k`}
												/>
												<Tooltip
													contentStyle={{
														backgroundColor: "var(--surface-2)",
														border: "1px solid #374151",
														borderRadius: "8px",
														color: "var(--foreground)",
													}}
													formatter={(value: number) => [
														`${value.toLocaleString()} kg`,
														"Volume",
													]}
												/>
												<Area
													type="monotone"
													dataKey="volume"
													stroke={PHOENIX.ember}
													strokeWidth={2}
													fill="url(#volumeGradient)"
												/>
											</AreaChart>
										</ResponsiveContainer>
									) : (
										<div className="h-[200px] flex items-center justify-center text-muted text-sm">
											No volume data for this period
										</div>
									)}
								</ChartCard>

								{/* Muscle Distribution */}
								<ChartCard title="MUSCLE DISTRIBUTION">
									{muscleData.length > 0 ? (
										<>
											<ResponsiveContainer width="100%" height={200}>
												<PieChart>
													<Pie
														data={muscleData}
														cx="50%"
														cy="50%"
														innerRadius={50}
														outerRadius={80}
														paddingAngle={2}
														dataKey="value"
													>
														{muscleData.map((entry, index) => (
															<Cell key={`cell-${index}`} fill={entry.color} />
														))}
													</Pie>
													<Tooltip
														contentStyle={{
															backgroundColor: "var(--surface-2)",
															border: "1px solid #374151",
															borderRadius: "8px",
															color: "var(--foreground)",
														}}
													/>
												</PieChart>
											</ResponsiveContainer>
											<div className="flex flex-wrap gap-2 mt-3 justify-center">
												{muscleData.map((muscle) => (
													<div
														key={muscle.name}
														className="flex items-center gap-1 text-xs"
													>
														<div
															className="w-3 h-3 rounded-full"
															style={{ backgroundColor: muscle.color }}
														/>
														<span className="text-muted-foreground">
															{muscle.name} {muscle.value}%
														</span>
													</div>
												))}
											</div>
										</>
									) : (
										<div className="h-[200px] flex items-center justify-center text-muted text-sm">
											No muscle group data yet
										</div>
									)}
								</ChartCard>
							</>
						)}

						{activeTab === "strength" && (
							<ChartCard title="TOP LIFTS (1RM)">
								{strengthData.length > 0 ? (
									<ResponsiveContainer width="100%" height={250}>
										<BarChart data={strengthData} layout="vertical">
											<XAxis
												type="number"
												stroke={PHOENIX.ashGray}
												style={{ fontSize: "12px" }}
											/>
											<YAxis
												type="category"
												dataKey="exercise"
												stroke={PHOENIX.ashGray}
												style={{ fontSize: "12px" }}
												width={70}
											/>
											<Tooltip
												contentStyle={{
													backgroundColor: "var(--surface-2)",
													border: "1px solid #374151",
													borderRadius: "8px",
													color: "var(--foreground)",
												}}
												formatter={(value: number) => [`${value} kg`, "1RM"]}
											/>
											<Bar
												dataKey="weight"
												fill={PHOENIX.ember}
												radius={[0, 4, 4, 0]}
											/>
										</BarChart>
									</ResponsiveContainer>
								) : (
									<div className="h-[250px] flex items-center justify-center text-muted text-sm">
										No strength data yet. Set some PRs!
									</div>
								)}
							</ChartCard>
						)}

						{activeTab === "trends" && (
							<ChartCard title="VOLUME TREND">
								{volumeData.length > 0 ? (
									<ResponsiveContainer width="100%" height={250}>
										<AreaChart data={volumeData}>
											<defs>
												<linearGradient
													id="trendGradient"
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
												style={{ fontSize: "12px" }}
											/>
											<YAxis
												stroke={PHOENIX.ashGray}
												style={{ fontSize: "12px" }}
												tickFormatter={(value) =>
													value >= 1000
														? `${value / 1000}k`
														: `${value}`
												}
											/>
											<Tooltip
												contentStyle={{
													backgroundColor: "var(--surface-2)",
													border: "1px solid #374151",
													borderRadius: "8px",
													color: "var(--foreground)",
												}}
												formatter={(value: number) => [
													`${value.toLocaleString()} kg`,
													"Volume",
												]}
											/>
											<Area
												type="monotone"
												dataKey="volume"
												stroke={PHOENIX.ember}
												strokeWidth={2}
												fill="url(#trendGradient)"
											/>
										</AreaChart>
									</ResponsiveContainer>
								) : (
									<div className="text-center py-12 text-muted">
										<TrendingUp className="w-12 h-12 mx-auto mb-3 opacity-50" />
										<p className="font-medium mb-1">
											Track your training trends
										</p>
										<p className="text-xs">
											Complete a few workouts to see your volume and
											strength trends here
										</p>
									</div>
								)}
							</ChartCard>
						)}

						{activeTab === "body" && (
							<div className="text-center py-12 text-muted">
								<Activity className="w-12 h-12 mx-auto mb-3 opacity-50" />
								<p className="font-medium mb-1">
									Body composition tracking
								</p>
								<p className="text-xs mb-4">
									Body metrics will be available when connected to a
									compatible tracker
								</p>
								<Link
									to="/integrations"
									className="text-primary text-sm hover:underline"
								>
									Set up integrations
								</Link>
							</div>
						)}
					</>
				)}
			</div>
		</div>
	);
}
