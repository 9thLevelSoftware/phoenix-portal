import { useQuery } from "@tanstack/react-query";
import {
	Activity,
	AlertCircle,
	Clock,
	Download,
	Dumbbell,
	Flame,
	Globe,
	Lock,
	Target,
	TrendingDown,
	TrendingUp,
	Zap,
} from "lucide-react";
import { motion } from "motion/react";
import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
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
import { toast } from "sonner";
import { RechartsTooltip } from "@/app/components/charts/shared/RechartsTooltip";
import { ConsistencyWidget } from "@/app/components/charts/ConsistencyWidget";
import { MuscleRadar } from "@/app/components/charts/MuscleRadar";
import { EChartsWrapper } from "@/app/components/charts/shared/EChartsWrapper";
import { CHART_COLORS, ECHARTS_GRID } from "@/app/components/charts/shared/EChartsTheme";
import { TrainingLoadGauge } from "@/app/components/charts/TrainingLoadGauge";
import { CommunityRankings } from "@/app/components/CommunityRankings";
import { FormAnalysis } from "@/app/components/FormAnalysis";
import { InsightsFeed, type InsightItem } from "@/app/components/InsightsFeed";
import { BiomechanicsContent } from "@/app/components/Biomechanics";
import { PageShell } from "@/app/components/PageShell";
import { SubscriptionGate } from "@/app/components/SubscriptionGate";
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
import { PHOENIX } from "@/lib/colors";
import { downloadCSV } from "@/lib/export/csv";
import { calculateRTL, classifyTrainingLoad } from "@/lib/training-load";
import { convertWeight, formatVolume, type WeightUnit } from "@/lib/units";
import {
	muscleGroupOptions,
	strengthProgressOptions,
	volumeComparisonOptions,
	volumeTrendOptions,
} from "@/queries/analytics";
import { insightsOptions } from "@/queries/insights";
import { externalActivitiesOptions } from "@/queries/integrations";
import { profileOptions } from "@/queries/profile";

const MUSCLE_GROUP_COLORS: Record<string, string> = {
	Chest: PHOENIX.ember,
	Back: PHOENIX.flameRed,
	Legs: PHOENIX.gold,
	Shoulders: PHOENIX.forgeGreen,
	Arms: PHOENIX.ashGray,
	Core: PHOENIX.flameYellow,
};

// Map old tab names to new tab names for backward compatibility
const TAB_MIGRATION: Record<string, string> = {
	overview: "overview",
	strength: "progress",
	insights: "progress",
	body: "body",
	external: "overview",
	biomechanics: "performance",
	performance: "performance",
};

const VALID_TABS = ["overview", "progress", "body", "performance"];

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

// Map UI period to insight period format
function periodToInsightPeriod(timePeriod: string): string {
	switch (timePeriod) {
		case "7D":
			return "7d";
		case "30D":
			return "30d";
		case "90D":
			return "90d";
		case "1Y":
			return "1y";
		case "ALL":
			return "all";
		default:
			return "30d";
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

function convertStrengthSeriesPoint(
	point: Record<string, string | number>,
	unit: WeightUnit,
) {
	return Object.fromEntries(
		Object.entries(point).map(([key, value]) => [
			key,
			key === "date" ? value : convertWeight(Number(value), unit),
		]),
	) as Record<string, string | number>;
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

// Mobile-specific: bucket by week returning W1, W2... labels
function bucketByWeekMobile(
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
		const weekKey = weekStart.toISOString().slice(0, 10);
		weeks.set(weekKey, (weeks.get(weekKey) ?? 0) + item.total_volume);
	}
	let i = 1;
	return Array.from(weeks.entries()).map(([, volume]) => ({
		date: `W${i++}`,
		volume: Math.round(volume),
	}));
}

const MUSCLE_GROUP_COLORS_MOBILE: Record<string, string> = {
	Chest: PHOENIX.ember,
	Back: PHOENIX.gold,
	Legs: PHOENIX.forgeGreen,
	Shoulders: "#6366F1",
	Arms: "#EC4899",
	Core: "#8B5CF6",
};

interface MobileStatCardProps {
	label: string;
	value: string;
	icon: React.ReactNode;
	delta?: { value: number; positive: boolean };
}

function MobileStatCard({ label, value, icon, delta }: MobileStatCardProps) {
	return (
		<Card className="min-w-[120px] p-4 bg-gradient-to-br from-surface-2 to-background border-secondary">
			<div className="flex flex-col">
				<div className="text-muted-foreground text-xs mb-1">{label}</div>
				<div className="flex items-center justify-between">
					<span className="text-2xl font-bold text-white">{value}</span>
					<div className="text-primary">{icon}</div>
				</div>
				{delta && (
					<div
						className={`text-[10px] flex items-center gap-0.5 mt-1 ${
							delta.positive ? "text-success" : "text-muted-foreground"
						}`}
					>
						{delta.positive ? (
							<TrendingUp className="w-3 h-3" />
						) : (
							<TrendingDown className="w-3 h-3" />
						)}
						{delta.positive ? "+" : ""}
						{delta.value}%
					</div>
				)}
			</div>
		</Card>
	);
}

function MobileChartCard({
	title,
	children,
}: {
	title: string;
	children: React.ReactNode;
}) {
	return (
		<Card className="p-4 bg-gradient-to-br from-surface-2 to-background border-secondary active:scale-[0.98] transition-transform">
			<h3 className="text-sm font-semibold text-white mb-3">{title}</h3>
			{children}
		</Card>
	);
}

/** Compute percent delta between two values, returning null if not meaningful */
function percentDelta(current: number, previous: number): number | null {
	if (previous === 0) return current > 0 ? 100 : null;
	return Math.round(((current - previous) / previous) * 100);
}

export function Analytics() {
	const { user } = useAuth();
	const [timePeriod, setTimePeriod] = useState("30D");
	const [searchParams, setSearchParams] = useSearchParams();

	// Map old tab names to new ones for backward compatibility
	const rawTab = searchParams.get("tab") || "overview";
	const activeTab = VALID_TABS.includes(rawTab)
		? rawTab
		: TAB_MIGRATION[rawTab] ?? "overview";
	const setActiveTab = (tab: string) => setSearchParams({ tab });

	const queryPeriod = periodToDays(timePeriod);
	const insightPeriod = periodToInsightPeriod(timePeriod);
	const userId = user?.id ?? "";
	const { data: profile } = useQuery({
		...profileOptions(userId),
		enabled: !!userId,
	});
	const { data: volumeRaw, isPending: volumePending } = useQuery(
		volumeTrendOptions(userId, queryPeriod),
	);
	const { data: muscleGroupRaw, isPending: musclePending } = useQuery(
		muscleGroupOptions(userId),
	);
	const { data: strengthRaw, isPending: strengthPending } = useQuery(
		strengthProgressOptions(userId),
	);
	const { data: externalActivities } = useQuery({
		...externalActivitiesOptions(userId),
		enabled: !!user,
	});
	const { data: volumeComparison } = useQuery({
		...volumeComparisonOptions(userId, queryPeriod),
		enabled: !!userId,
	});
	const { data: insightsData, isPending: insightsPending } = useQuery({
		...insightsOptions(userId, insightPeriod),
		enabled: !!userId,
	});
	const unit: WeightUnit = profile?.weight_unit === "lbs" ? "lbs" : "kg";

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
	const volumeData = bucketByWeek(volumeRaw ?? []).map((entry) => ({
		...entry,
		volume: Math.round(convertWeight(entry.volume, unit) * 10) / 10,
	}));
	const muscleGroupData = (muscleGroupRaw ?? []).map((m) => ({
		...m,
		color: MUSCLE_GROUP_COLORS[m.name] ?? PHOENIX.ashGray,
	}));
	const strengthProgressData = groupStrengthByExercise(strengthRaw ?? []).map(
		(point) => convertStrengthSeriesPoint(point, unit),
	);
	const strengthExercises =
		strengthProgressData.length > 0
			? Object.keys(strengthProgressData[0]).filter((k) => k !== "date")
			: [];

	// Derive summary stats from real data
	const totalVolume = volumeData.reduce((sum, d) => sum + d.volume, 0);
	const totalWorkouts = volumeData.reduce((sum, d) => sum + d.workouts, 0);
	const insights = generateInsights(
		volumeData,
		muscleGroupData,
		strengthExercises,
		totalWorkouts,
	);

	// --- Hero stat deltas from volume comparison ---
	const heroDeltas = useMemo(() => {
		if (!volumeComparison) return { volume: null, workouts: null };
		const currentVol = volumeComparison.current.reduce(
			(s, r) => s + (r.total_volume ?? 0),
			0,
		);
		const previousVol = volumeComparison.previous.reduce(
			(s, r) => s + (r.total_volume ?? 0),
			0,
		);
		return {
			volume: percentDelta(currentVol, previousVol),
			workouts: percentDelta(
				volumeComparison.current.length,
				volumeComparison.previous.length,
			),
		};
	}, [volumeComparison]);

	// --- Training Load from session data ---
	const trainingLoad = useMemo(() => {
		const sessions = (volumeComparison?.current ?? []).map((s) => ({
			totalVolume: s.total_volume ?? 0,
			durationSeconds: s.duration_seconds ?? 0,
			setCount: s.set_count ?? 0,
		}));
		const rtl = calculateRTL(sessions);
		const zone = classifyTrainingLoad(rtl);
		return { rtl, zone };
	}, [volumeComparison]);

	// --- Consistency widget data ---
	const consistencyData = useMemo(() => {
		const raw = volumeRaw ?? [];
		const now = new Date();
		const startOfWeek = (d: Date) => {
			const day = d.getDay();
			const diff = d.getDate() - day + (day === 0 ? -6 : 1);
			const ws = new Date(d);
			ws.setDate(diff);
			ws.setHours(0, 0, 0, 0);
			return ws;
		};
		const thisWeekStart = startOfWeek(now);
		const lastWeekStart = new Date(thisWeekStart);
		lastWeekStart.setDate(lastWeekStart.getDate() - 7);
		const twoWeeksAgoStart = new Date(lastWeekStart);
		twoWeeksAgoStart.setDate(twoWeeksAgoStart.getDate() - 7);

		let thisWeek = 0;
		let lastWeek = 0;
		let twoWeeksAgo = 0;
		const dayCounts: Record<string, number> = {};
		const totalWeeks = Math.max(
			1,
			Math.ceil(raw.length > 0
				? (now.getTime() - new Date(raw[0].started_at).getTime()) / (7 * 24 * 60 * 60 * 1000)
				: 1),
		);
		let weeklyHits = 0;
		const weekSessionCounts = new Map<string, number>();

		for (const s of raw) {
			const d = new Date(s.started_at);
			const ws = startOfWeek(d);
			const wsKey = ws.toISOString().slice(0, 10);
			weekSessionCounts.set(wsKey, (weekSessionCounts.get(wsKey) ?? 0) + 1);

			if (d >= thisWeekStart) thisWeek++;
			else if (d >= lastWeekStart) lastWeek++;
			else if (d >= twoWeeksAgoStart) twoWeeksAgo++;

			const dayName = d.toLocaleDateString("en-US", { weekday: "short" });
			dayCounts[dayName] = (dayCounts[dayName] ?? 0) + 1;
		}

		// Count weeks where sessions >= 3 (target hit)
		for (const count of weekSessionCounts.values()) {
			if (count >= 3) weeklyHits++;
		}

		const mostActiveDay =
			Object.entries(dayCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "N/A";
		const avgPerWeek = raw.length / totalWeeks;
		const hitRate = totalWeeks > 0 ? (weeklyHits / totalWeeks) * 100 : 0;

		return {
			weeklyData: { current: thisWeek, target: 3, lastWeek, twoWeeksAgo },
			avgPerWeek,
			hitRate,
			mostActiveDay,
		};
	}, [volumeRaw]);

	// --- ECharts: Volume Over Time (area + bar combo) ---
	const volumeEChartsOption = useMemo(() => {
		if (volumeData.length === 0) return null;
		return {
			tooltip: {
				trigger: "axis" as const,
				axisPointer: { type: "cross" as const },
			},
			grid: ECHARTS_GRID,
			xAxis: {
				type: "category" as const,
				data: volumeData.map((d) => d.date),
			},
			yAxis: [
				{
					type: "value" as const,
					name: `Volume (${unit})`,
					nameTextStyle: { color: CHART_COLORS.axisText, fontSize: 11 },
				},
				{
					type: "value" as const,
					name: "Sessions",
					nameTextStyle: { color: CHART_COLORS.axisText, fontSize: 11 },
					splitLine: { show: false },
				},
			],
			series: [
				{
					name: "Volume",
					type: "line",
					data: volumeData.map((d) => d.volume),
					smooth: true,
					areaStyle: {
						color: {
							type: "linear" as const,
							x: 0,
							y: 0,
							x2: 0,
							y2: 1,
							colorStops: [
								{ offset: 0, color: `${CHART_COLORS.primary}80` },
								{ offset: 1, color: `${CHART_COLORS.primary}08` },
							],
						},
					},
					lineStyle: { color: CHART_COLORS.primary, width: 2 },
					itemStyle: { color: CHART_COLORS.primary },
				},
				{
					name: "Sessions",
					type: "bar",
					yAxisIndex: 1,
					data: volumeData.map((d) => d.workouts),
					barWidth: "40%",
					itemStyle: {
						color: `${CHART_COLORS.secondary}99`,
						borderRadius: [4, 4, 0, 0],
					},
				},
			],
		};
	}, [volumeData, unit]);

	// --- ECharts: Muscle Distribution donut ---
	const muscleDonutOption = useMemo(() => {
		if (muscleGroupData.length === 0) return null;
		const sorted = [...muscleGroupData].sort((a, b) => b.value - a.value);
		return {
			tooltip: {
				trigger: "item" as const,
				formatter: "{b}: {c}% ({d}%)",
			},
			legend: {
				bottom: 0,
				textStyle: { color: CHART_COLORS.axisText, fontSize: 11 },
			},
			series: [
				{
					type: "pie",
					radius: ["40%", "70%"],
					center: ["50%", "45%"],
					avoidLabelOverlap: true,
					label: {
						show: true,
						position: "center" as const,
						formatter: sorted[0]?.name ?? "",
						fontSize: 14,
						fontWeight: 600,
						color: "#fff",
					},
					emphasis: {
						label: {
							show: true,
							fontSize: 16,
							fontWeight: 700,
							formatter: "{b}\n{c}%",
						},
					},
					data: muscleGroupData.map((m) => ({
						name: m.name,
						value: m.value,
						itemStyle: { color: m.color },
					})),
				},
			],
		};
	}, [muscleGroupData]);

	// --- ECharts: 1RM Progression line chart ---
	const strengthEChartsOption = useMemo(() => {
		if (strengthProgressData.length === 0) return null;
		const dates = strengthProgressData.map((d) => d.date as string);
		return {
			tooltip: { trigger: "axis" as const },
			legend: {
				data: strengthExercises,
				bottom: 0,
				textStyle: { color: CHART_COLORS.axisText, fontSize: 11 },
			},
			grid: { ...ECHARTS_GRID, bottom: 60 },
			xAxis: { type: "category" as const, data: dates },
			yAxis: {
				type: "value" as const,
				name: unit,
				nameTextStyle: { color: CHART_COLORS.axisText, fontSize: 11 },
			},
			series: strengthExercises.map((exercise, i) => ({
				name: exercise,
				type: "line",
				data: strengthProgressData.map((d) => d[exercise] ?? 0),
				smooth: true,
				lineStyle: { width: 2 },
				itemStyle: {
					color: EXERCISE_COLORS[i % EXERCISE_COLORS.length],
				},
				symbol: "circle",
				symbolSize: 6,
			})),
		};
	}, [strengthProgressData, strengthExercises, unit]);

	// --- ECharts: Volume trend area (for Progress tab) ---
	const volumeAreaOption = useMemo(() => {
		if (volumeData.length === 0) return null;
		return {
			tooltip: { trigger: "axis" as const },
			grid: ECHARTS_GRID,
			xAxis: {
				type: "category" as const,
				data: volumeData.map((d) => d.date),
			},
			yAxis: {
				type: "value" as const,
				name: `Volume (${unit})`,
				nameTextStyle: { color: CHART_COLORS.axisText, fontSize: 11 },
			},
			series: [
				{
					name: "Volume",
					type: "line",
					data: volumeData.map((d) => d.volume),
					smooth: true,
					areaStyle: {
						color: {
							type: "linear" as const,
							x: 0,
							y: 0,
							x2: 0,
							y2: 1,
							colorStops: [
								{ offset: 0, color: `${CHART_COLORS.success}60` },
								{ offset: 1, color: `${CHART_COLORS.success}08` },
							],
						},
					},
					lineStyle: { color: CHART_COLORS.success, width: 2 },
					itemStyle: { color: CHART_COLORS.success },
				},
			],
		};
	}, [volumeData, unit]);

	// --- Insights feed data (from server or local fallback) ---
	const insightsFeedItems: InsightItem[] = useMemo(() => {
		// If we have server-generated insights, use them
		if (insightsData && Array.isArray(insightsData) && insightsData.length > 0) {
			return insightsData.map((item: Record<string, unknown>) => ({
				id: (item.id as string) ?? String(Math.random()),
				type: ((item.type as string) ?? "info") as InsightItem["type"],
				title: (item.title as string) ?? "",
				description: (item.description as string) ?? "",
				recommendation: item.recommendation as string | undefined,
				metric: item.metric as InsightItem["metric"],
			}));
		}
		// Fallback: convert local insights to InsightsFeed format
		return insights.map((i, idx) => ({
			id: `local-${idx}`,
			type: i.type === "positive"
				? "success" as const
				: i.type === "warning"
					? "warning" as const
					: "info" as const,
			title: i.title,
			description: i.description,
		}));
	}, [insightsData, insights]);

	// --- Muscle radar data ---
	const muscleRadarData = useMemo(() => {
		const data: Record<string, number> = {};
		for (const m of muscleGroupData) {
			data[m.name] = m.value;
		}
		return data;
	}, [muscleGroupData]);

	// --- PR stats ---
	const prCount = (strengthRaw ?? []).length;
	const daysSinceLastPR = useMemo(() => {
		if (!strengthRaw || strengthRaw.length === 0) return null;
		const sorted = [...strengthRaw].sort(
			(a, b) =>
				new Date(b.achieved_at).getTime() - new Date(a.achieved_at).getTime(),
		);
		const lastPR = new Date(sorted[0].achieved_at);
		const now = new Date();
		return Math.floor(
			(now.getTime() - lastPR.getTime()) / (1000 * 60 * 60 * 24),
		);
	}, [strengthRaw]);

	// Mobile-specific derived data
	const mobileVolumeData = bucketByWeekMobile(volumeRaw ?? []).map((entry) => ({
		...entry,
		volume: Math.round(convertWeight(entry.volume, unit) * 10) / 10,
	}));
	const mobileMusclData = (muscleGroupRaw ?? []).map((m) => ({
		...m,
		color: MUSCLE_GROUP_COLORS_MOBILE[m.name] ?? PHOENIX.ashGray,
	}));
	const strengthMap = new Map<string, number>();
	for (const item of strengthRaw ?? []) {
		const existing = strengthMap.get(item.exercise_name) ?? 0;
		if (item.value > existing) {
			strengthMap.set(item.exercise_name, item.value);
		}
	}
	const mobileStrengthData = Array.from(strengthMap.entries())
		.sort((a, b) => b[1] - a[1])
		.slice(0, 5)
		.map(([exercise, weight]) => ({
			exercise: exercise.length > 8 ? exercise.slice(0, 8) : exercise,
			weight: Math.round(convertWeight(weight, unit) * 10) / 10,
		}));
	const mobileTotalWorkouts = (volumeRaw ?? []).length;
	const mobileHasData =
		mobileVolumeData.length > 0 || mobileMusclData.length > 0;

	if (isPending) {
		return (
			<div className="min-h-screen pb-20 md:pb-8">
				{/* Mobile loading skeleton */}
				<div className="block md:hidden">
					<div className="sticky top-0 bg-background/95 backdrop-blur-lg z-10 px-4 py-3 border-b border-secondary">
						<Skeleton className="h-6 w-32" />
					</div>
					<div className="flex overflow-x-auto gap-3 px-4 py-4">
						{Array.from({ length: 5 }).map((_, i) => (
							<div key={i} className="min-w-[120px]">
								<StatCardSkeleton />
							</div>
						))}
					</div>
					<div className="px-4 py-4 space-y-4">
						<ChartSkeleton />
					</div>
				</div>
				{/* Desktop loading skeleton */}
				<div className="hidden md:block">
					<PageShell>
						<Skeleton className="h-10 w-48 mb-2" />
						<Skeleton className="h-4 w-64 mb-8" />
						<div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-8">
							{Array.from({ length: 5 }).map((_, i) => (
								<StatCardSkeleton key={i} />
							))}
						</div>
						<div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
							<ChartSkeleton />
							<ChartSkeleton />
						</div>
					</PageShell>
				</div>
			</div>
		);
	}

	const externalCount = externalActivities?.length ?? 0;
	const hasData =
		volumeData.length > 0 || muscleGroupData.length > 0 || externalCount > 0;

	return (
		<div className="min-h-screen pb-20 md:pb-8">
			{/* ---- MOBILE LAYOUT (< 768px) ---- */}
			<div className="block md:hidden">
				{/* Compact Header */}
				<div className="sticky top-0 bg-background/95 backdrop-blur-lg z-10 px-4 py-3 border-b border-secondary">
					<div className="flex items-center justify-between">
						<h1 className="text-xl font-bold text-white">Analytics Hub</h1>
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
									const rows = mobileVolumeData.map((d) =>
										[d.date, d.volume].join(","),
									);
									const header = `Week,Volume (${unit})`;
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
					{[
						{
							label: "Volume",
							value: formatVolume(totalVolume, unit),
							icon: <TrendingUp className="w-5 h-5" />,
							delta: heroDeltas.volume != null ? { value: heroDeltas.volume, positive: heroDeltas.volume >= 0 } : undefined,
						},
						{
							label: "Workouts",
							value: `${mobileTotalWorkouts}`,
							icon: <Dumbbell className="w-5 h-5" />,
							delta: heroDeltas.workouts != null ? { value: heroDeltas.workouts, positive: heroDeltas.workouts >= 0 } : undefined,
						},
						{
							label: "Load",
							value: `${trainingLoad.rtl}`,
							icon: <Flame className="w-5 h-5" />,
						},
						{
							label: "PRs",
							value: `${prCount}`,
							icon: <Target className="w-5 h-5" />,
						},
						{
							label: "Groups",
							value: `${mobileMusclData.length}`,
							icon: <Zap className="w-5 h-5" />,
						},
					].map((stat) => (
						<motion.div
							key={stat.label}
							whileTap={{ scale: 0.95 }}
							className="snap-start"
						>
							<MobileStatCard {...stat} />
						</motion.div>
					))}
				</div>

				{/* Scrollable Tabs -- 4 tabs */}
				<div className="overflow-x-auto scrollbar-hide border-b border-secondary">
					<div className="flex px-4 gap-1">
						{[
							{ value: "overview", label: "Overview" },
							{ value: "progress", label: "Progress" },
							{ value: "body", label: "Body" },
							{ value: "performance", label: "Performance" },
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

				{/* Mobile Content */}
				<div className="px-4 py-4 space-y-4">
					{!mobileHasData ? (
						<EmptyState
							icon={TrendingUp}
							title="Your analytics await"
							description="Complete a few workouts to unlock insights into your training volume, strength trends, and muscle balance."
						/>
					) : (
						<>
							{activeTab === "overview" && (
								<>
									<MobileChartCard title="VOLUME OVER TIME">
										{mobileVolumeData.length > 0 ? (
											<ResponsiveContainer width="100%" height={200}>
												<AreaChart data={mobileVolumeData}>
													<defs>
														<linearGradient
															id="mobileVolumeGradient"
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
														tickFormatter={(value) => `${value / 1000}k`}
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
														fill="url(#mobileVolumeGradient)"
														animationDuration={800}
														animationEasing="ease-out"
													/>
												</AreaChart>
											</ResponsiveContainer>
										) : (
											<div className="h-[200px] flex items-center justify-center text-muted text-sm">
												No volume data for this period
											</div>
										)}
									</MobileChartCard>

									<MobileChartCard title="TRAINING LOAD">
										<TrainingLoadGauge
											score={trainingLoad.rtl}
											zone={trainingLoad.zone}
										/>
									</MobileChartCard>

									<MobileChartCard title="CONSISTENCY">
										<ConsistencyWidget {...consistencyData} />
									</MobileChartCard>

									<MobileChartCard title="INSIGHTS">
										<InsightsFeed
											insights={insightsFeedItems}
											loading={insightsPending}
										/>
									</MobileChartCard>
								</>
							)}

							{activeTab === "progress" && (
								<>
									<MobileChartCard
										title={`TOP LIFTS (1RM - ${unit.toUpperCase()})`}
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
											<div className="h-[250px] flex items-center justify-center text-muted text-sm">
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
											<div className="text-center py-12 text-muted">
												<TrendingUp className="w-12 h-12 mx-auto mb-3 opacity-50" />
												<p className="font-medium mb-1">
													Track your training trends
												</p>
												<p className="text-xs">
													Complete a few workouts to see your volume and strength
													trends here
												</p>
											</div>
										)}
									</MobileChartCard>

									{/* PR counter */}
									{prCount > 0 && (
										<MobileChartCard title="PERSONAL RECORDS">
											<div className="flex items-center gap-4">
												<div className="flex flex-col items-center justify-center rounded-lg bg-primary/10 px-4 py-3">
													<span className="text-2xl font-bold text-primary">
														{prCount}
													</span>
													<span className="text-[10px] text-muted-foreground">
														total PRs
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
							)}

							{activeTab === "body" && (
								<>
									{muscleGroupData.length > 0 ? (
										<>
											<MobileChartCard title="MUSCLE BALANCE">
												<MuscleRadar currentData={muscleRadarData} />
											</MobileChartCard>

											<MobileChartCard title="MUSCLE DISTRIBUTION">
												<ResponsiveContainer width="100%" height={200}>
													<PieChart>
														<Pie
															data={mobileMusclData}
															cx="50%"
															cy="50%"
															innerRadius={50}
															outerRadius={80}
															paddingAngle={2}
															dataKey="value"
															animationDuration={800}
															animationEasing="ease-out"
														>
															{mobileMusclData.map((entry, index) => (
																<Cell
																	key={`cell-${index}`}
																	fill={entry.color}
																/>
															))}
														</Pie>
														<Tooltip content={<RechartsTooltip />} />
													</PieChart>
												</ResponsiveContainer>
												<div className="flex flex-wrap gap-2 mt-3 justify-center">
													{mobileMusclData.map((muscle) => (
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
											</MobileChartCard>

											{/* Biomechanics teaser */}
											<Card className="relative overflow-hidden p-4 border-secondary">
												<div className="absolute inset-0 bg-background/60 backdrop-blur-sm z-10 flex flex-col items-center justify-center gap-2">
													<Lock className="w-6 h-6 text-primary" />
													<p className="text-xs font-semibold text-white">
														Inferno Tier
													</p>
													<p className="text-[10px] text-muted-foreground text-center px-4">
														L/R Asymmetry, ROM Analysis, Force Consistency
													</p>
												</div>
												<div className="opacity-30 pointer-events-none">
													<h3 className="text-sm font-semibold text-white mb-2">
														BIOMECHANICS
													</h3>
													<div className="grid grid-cols-3 gap-2">
														<div className="h-16 rounded bg-muted/20" />
														<div className="h-16 rounded bg-muted/20" />
														<div className="h-16 rounded bg-muted/20" />
													</div>
												</div>
											</Card>
										</>
									) : (
										<div className="text-center py-12 text-muted">
											<Activity className="w-12 h-12 mx-auto mb-3 opacity-50" />
											<p className="font-medium mb-1">
												Body analysis coming soon
											</p>
											<p className="text-xs mb-4">
												Complete some workouts to see your muscle balance and
												body part analysis
											</p>
										</div>
									)}
								</>
							)}

							{activeTab === "performance" && (
								<SubscriptionGate
									requiredTier="INFERNO"
									featureName="Performance Analytics"
								>
									<BiomechanicsContent view="performance" />
								</SubscriptionGate>
							)}
						</>
					)}
				</div>
			</div>

			{/* ---- DESKTOP LAYOUT (>= 768px) ---- */}
			<div className="hidden md:block">
				<PageShell>
					{/* Header */}
					<div className="mb-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
						<div>
							<h1 className="text-3xl sm:text-4xl mb-2 text-white">
								Analytics Hub
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
									const header = `Week,Volume (${unit}),Workouts`;
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
							{/* Hero Stats Row -- 5 cards */}
							<div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-8">
								{[
									{
										label: "Total Volume",
										value: formatVolume(totalVolume, unit),
										delta: heroDeltas.volume,
										icon: <TrendingUp className="w-4 h-4" />,
									},
									{
										label: "Workouts",
										value: `${totalWorkouts}`,
										delta: heroDeltas.workouts,
										icon: <Dumbbell className="w-4 h-4" />,
									},
									{
										label: "Training Load",
										value: `${trainingLoad.rtl}`,
										delta: null,
										icon: <Flame className="w-4 h-4" />,
										badge: trainingLoad.zone,
									},
									{
										label: "PRs",
										value: `${prCount}`,
										delta: null,
										icon: <Target className="w-4 h-4" />,
									},
									{
										label: "Streak",
										value: `${consistencyData.weeklyData.current}`,
										delta: null,
										icon: <Zap className="w-4 h-4" />,
										suffix: "this week",
									},
								].map((stat, index) => (
									<motion.div
										key={stat.label}
										initial={{ opacity: 0, y: 20 }}
										animate={{ opacity: 1, y: 0 }}
										transition={{ delay: index * 0.08 }}
									>
										<Card className="p-4 bg-gradient-to-br from-surface-2 to-background border-secondary">
											<div className="flex items-center justify-between mb-1">
												<span className="text-sm text-muted-foreground">
													{stat.label}
												</span>
												<span className="text-primary">{stat.icon}</span>
											</div>
											<div className="text-2xl text-white mb-1">
												{stat.value}
											</div>
											<div className="flex items-center gap-2">
												{stat.delta != null && (
													<span
														className={`text-xs flex items-center gap-0.5 ${
															stat.delta >= 0
																? "text-success"
																: "text-muted-foreground"
														}`}
													>
														{stat.delta >= 0 ? (
															<TrendingUp className="w-3 h-3" />
														) : (
															<TrendingDown className="w-3 h-3" />
														)}
														{stat.delta >= 0 ? "+" : ""}
														{stat.delta}%
													</span>
												)}
												{"badge" in stat && stat.badge && (
													<Badge
														variant="outline"
														className="text-[10px] capitalize"
													>
														{stat.badge}
													</Badge>
												)}
												{"suffix" in stat && stat.suffix && (
													<span className="text-xs text-muted-foreground">
														{stat.suffix}
													</span>
												)}
											</div>
										</Card>
									</motion.div>
								))}
							</div>

							{/* Main Content Tabs -- 4 tabs */}
							<Tabs
								value={activeTab}
								onValueChange={setActiveTab}
								className="space-y-6"
							>
								<TabsList className="bg-surface-2 border border-secondary p-1">
									<TabsTrigger
										value="overview"
										className="data-[state=active]:bg-primary"
									>
										Overview
									</TabsTrigger>
									<TabsTrigger
										value="progress"
										className="data-[state=active]:bg-primary"
									>
										Progress
									</TabsTrigger>
									<TabsTrigger
										value="body"
										className="data-[state=active]:bg-primary"
									>
										Body
									</TabsTrigger>
									<TabsTrigger
										value="performance"
										className="data-[state=active]:bg-primary"
									>
										Performance
									</TabsTrigger>
								</TabsList>

								{/* ====== TAB 1: OVERVIEW ====== */}
								<TabsContent value="overview" className="space-y-6">
									{/* Activity Sources (folded in from External tab) */}
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

									{/* Volume Over Time + Muscle Distribution */}
									<div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
										<Card className="p-6 bg-gradient-to-br from-surface-2 to-background border-secondary">
											<h3 className="text-xl text-white mb-6">
												Volume Over Time
											</h3>
											{volumeEChartsOption ? (
												<EChartsWrapper
													option={volumeEChartsOption}
													height={300}
												/>
											) : (
												<div className="h-[300px] flex items-center justify-center text-muted">
													No volume data for this period
												</div>
											)}
										</Card>

										<Card className="p-6 bg-gradient-to-br from-surface-2 to-background border-secondary">
											<h3 className="text-xl text-white mb-6">
												Muscle Group Distribution
											</h3>
											{muscleDonutOption ? (
												<EChartsWrapper
													option={muscleDonutOption}
													height={300}
												/>
											) : (
												<div className="h-[300px] flex items-center justify-center text-muted">
													No muscle group data yet
												</div>
											)}
										</Card>
									</div>

									{/* Training Load + Consistency + Insights */}
									<div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
										<Card className="p-6 bg-gradient-to-br from-surface-2 to-background border-secondary">
											<h3 className="text-lg text-white mb-4">
												Training Load
											</h3>
											<TrainingLoadGauge
												score={trainingLoad.rtl}
												zone={trainingLoad.zone}
											/>
										</Card>

										<Card className="p-6 bg-gradient-to-br from-surface-2 to-background border-secondary">
											<h3 className="text-lg text-white mb-4">
												Consistency
											</h3>
											<ConsistencyWidget {...consistencyData} />
										</Card>

										<Card className="p-6 bg-gradient-to-br from-surface-2 to-background border-secondary">
											<h3 className="text-lg text-white mb-4">
												Insights
											</h3>
											<InsightsFeed
												insights={insightsFeedItems.slice(0, 3)}
												loading={insightsPending}
											/>
										</Card>
									</div>
								</TabsContent>

								{/* ====== TAB 2: PROGRESS ====== */}
								<TabsContent value="progress" className="space-y-6">
									{/* 1RM Progression */}
									<Card className="p-6 bg-gradient-to-br from-surface-2 to-background border-secondary">
										<h3 className="text-xl text-white mb-6">
											1RM Progression ({unit})
										</h3>
										{strengthEChartsOption ? (
											<EChartsWrapper
												option={strengthEChartsOption}
												height={400}
											/>
										) : (
											<div className="h-[400px] flex items-center justify-center text-muted">
												No strength progress data yet. Set some PRs to see your
												progression!
											</div>
										)}
									</Card>

									{/* Volume & Frequency Trends */}
									<Card className="p-6 bg-gradient-to-br from-surface-2 to-background border-secondary">
										<h3 className="text-xl text-white mb-6">
											Volume & Frequency Trends
										</h3>
										{volumeAreaOption ? (
											<EChartsWrapper
												option={volumeAreaOption}
												height={300}
											/>
										) : (
											<div className="h-[300px] flex items-center justify-center text-muted">
												No volume data for this period
											</div>
										)}
									</Card>

									{/* PR Timeline + Insights */}
									<div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
										{/* PR Timeline */}
										<Card className="p-6 bg-gradient-to-br from-surface-2 to-background border-secondary">
											<h3 className="text-xl text-white mb-4">
												Personal Records
											</h3>
											<div className="flex items-center gap-6 mb-4">
												<div className="flex flex-col items-center justify-center rounded-xl bg-primary/10 px-6 py-4">
													<span className="text-3xl font-bold text-primary">
														{prCount}
													</span>
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
										<Card className="p-6 bg-gradient-to-br from-surface-2 to-background border-secondary">
											<h3 className="text-xl text-white mb-4">
												Trend Insights
											</h3>
											<div className="flex flex-col gap-3">
												{insights.map((insight, index) => (
													<div
														key={index}
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
																			: "text-muted"
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
								</TabsContent>

								{/* ====== TAB 3: BODY ====== */}
								<TabsContent value="body" className="space-y-6">
									<div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
										{/* Muscle Balance Radar */}
										<Card className="p-6 bg-gradient-to-br from-surface-2 to-background border-secondary">
											<h3 className="text-xl text-white mb-6">
												Muscle Balance Radar
											</h3>
											{muscleGroupData.length > 0 ? (
												<MuscleRadar currentData={muscleRadarData} />
											) : (
												<div className="h-[300px] flex items-center justify-center text-muted">
													No muscle data yet
												</div>
											)}
										</Card>

										{/* Muscle Distribution Donut */}
										<Card className="p-6 bg-gradient-to-br from-surface-2 to-background border-secondary">
											<h3 className="text-xl text-white mb-6">
												Muscle Distribution
											</h3>
											{muscleDonutOption ? (
												<EChartsWrapper
													option={muscleDonutOption}
													height={300}
												/>
											) : (
												<div className="h-[300px] flex items-center justify-center text-muted">
													No muscle group data yet
												</div>
											)}
										</Card>
									</div>

									{/* Muscle Group Breakdown Table */}
									<Card className="p-6 bg-gradient-to-br from-surface-2 to-background border-secondary">
										<h3 className="text-xl text-white mb-6">
											Muscle Group Breakdown
										</h3>
										{muscleGroupData.length > 0 ? (
											<div className="overflow-x-auto">
												<table className="w-full text-sm">
													<thead>
														<tr className="border-b border-secondary text-muted-foreground">
															<th className="text-left py-2 px-3 font-medium">
																Muscle Group
															</th>
															<th className="text-right py-2 px-3 font-medium">
																Volume %
															</th>
															<th className="text-left py-2 px-3 font-medium w-1/2">
																Distribution
															</th>
														</tr>
													</thead>
													<tbody>
														{[...muscleGroupData]
															.sort((a, b) => b.value - a.value)
															.map((muscle) => (
																<tr
																	key={muscle.name}
																	className="border-b border-secondary/50"
																>
																	<td className="py-3 px-3">
																		<div className="flex items-center gap-2">
																			<div
																				className="w-3 h-3 rounded-full shrink-0"
																				style={{
																					backgroundColor: muscle.color,
																				}}
																			/>
																			<span className="text-white">
																				{muscle.name}
																			</span>
																		</div>
																	</td>
																	<td
																		className="text-right py-3 px-3 font-medium"
																		style={{ color: muscle.color }}
																	>
																		{muscle.value}%
																	</td>
																	<td className="py-3 px-3">
																		<div className="h-2 w-full rounded-full bg-muted/20 overflow-hidden">
																			<div
																				className="h-full rounded-full transition-all duration-500"
																				style={{
																					width: `${muscle.value}%`,
																					backgroundColor: muscle.color,
																				}}
																			/>
																		</div>
																	</td>
																</tr>
															))}
													</tbody>
												</table>
											</div>
										) : (
											<div className="text-center py-12 text-muted">
												No body part data yet
											</div>
										)}
									</Card>

									{/* Biomechanics Teaser (blurred/gated for Inferno) */}
									<Card className="relative overflow-hidden p-6 bg-gradient-to-br from-surface-2 to-background border-secondary">
										<div className="absolute inset-0 bg-background/70 backdrop-blur-sm z-10 flex flex-col items-center justify-center gap-3">
											<div className="p-3 rounded-full bg-primary/20">
												<Lock className="w-6 h-6 text-primary" />
											</div>
											<p className="text-lg font-semibold text-white">
												Biomechanics Analysis
											</p>
											<p className="text-sm text-muted-foreground text-center max-w-md">
												L/R Asymmetry, Range of Motion, and Force Consistency
												metrics are available with the Inferno tier.
											</p>
											<Link
												to="/settings?tab=billing"
												className="text-primary text-sm hover:underline mt-1"
											>
												Upgrade to Inferno
											</Link>
										</div>
										{/* Blurred placeholder content */}
										<div className="opacity-20 pointer-events-none select-none">
											<h3 className="text-xl text-white mb-4">
												Biomechanics Analysis
											</h3>
											<div className="grid grid-cols-3 gap-4">
												<div className="rounded-lg bg-muted/20 p-4 h-24">
													<div className="text-sm text-muted-foreground">
														L/R Asymmetry
													</div>
													<div className="text-2xl text-white mt-2">--</div>
												</div>
												<div className="rounded-lg bg-muted/20 p-4 h-24">
													<div className="text-sm text-muted-foreground">
														Range of Motion
													</div>
													<div className="text-2xl text-white mt-2">--</div>
												</div>
												<div className="rounded-lg bg-muted/20 p-4 h-24">
													<div className="text-sm text-muted-foreground">
														Force Consistency
													</div>
													<div className="text-2xl text-white mt-2">--</div>
												</div>
											</div>
										</div>
									</Card>
								</TabsContent>

								{/* ====== TAB 4: PERFORMANCE ====== */}
								<TabsContent value="performance" className="space-y-6">
									<SubscriptionGate
										requiredTier="INFERNO"
										featureName="Performance Analytics"
									>
										{/* Community Rankings */}
										<div className="space-y-6">
											<Card className="p-6 bg-gradient-to-br from-surface-2 to-background border-secondary">
												<h3 className="text-xl text-white mb-4">
													Community Rankings
												</h3>
												<CommunityRankings rankings={[]} loading={false} />
											</Card>

											{/* Biomechanics Content */}
											<BiomechanicsContent view="biomechanics" />
											<BiomechanicsContent view="performance" />

											{/* Form Analysis */}
											<Card className="p-6 bg-gradient-to-br from-surface-2 to-background border-secondary">
												<h3 className="text-xl text-white mb-4">
													Form Analysis
												</h3>
												<FormAnalysis reps={[]} />
											</Card>

											{/* Training Efficiency */}
											<Card className="p-6 bg-gradient-to-br from-surface-2 to-background border-secondary">
												<h3 className="text-xl text-white mb-4">
													Training Efficiency
												</h3>
												<div className="grid grid-cols-2 gap-4">
													<div className="rounded-lg bg-muted/20 p-4">
														<p className="text-sm text-muted-foreground mb-1">
															Volume / Minute
														</p>
														<p className="text-2xl font-bold text-white">
															{volumeComparison?.current
																? (() => {
																		const totalVol =
																			volumeComparison.current.reduce(
																				(s, r) => s + (r.total_volume ?? 0),
																				0,
																			);
																		const totalMin =
																			volumeComparison.current.reduce(
																				(s, r) =>
																					s +
																					(r.duration_seconds ?? 0) / 60,
																				0,
																			);
																		return totalMin > 0
																			? `${Math.round(convertWeight(totalVol / totalMin, unit))} ${unit}/min`
																			: "--";
																	})()
																: "--"}
														</p>
													</div>
													<div className="rounded-lg bg-muted/20 p-4">
														<p className="text-sm text-muted-foreground mb-1">
															Avg Session Duration
														</p>
														<p className="text-2xl font-bold text-white">
															{volumeComparison?.current &&
															volumeComparison.current.length > 0
																? `${Math.round(
																		volumeComparison.current.reduce(
																			(s, r) =>
																				s + (r.duration_seconds ?? 0),
																			0,
																		) /
																			volumeComparison.current.length /
																			60,
																	)} min`
																: "--"}
														</p>
													</div>
												</div>
											</Card>
										</div>
									</SubscriptionGate>
								</TabsContent>
							</Tabs>
						</>
					)}
				</PageShell>
			</div>
		</div>
	);
}
