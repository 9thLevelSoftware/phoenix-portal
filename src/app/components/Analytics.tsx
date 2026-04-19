import { useQuery } from "@tanstack/react-query";
import {
	Activity,
	AlertCircle,
	Download,
	Dumbbell,
	Flame,
	Target,
	TrendingDown,
	TrendingUp,
	Zap,
} from "lucide-react";
import { motion } from "motion/react";
import { lazy, Suspense, useMemo, useState } from "react";
import type { ExtendedBodyPart, Slug } from "react-muscle-highlighter";
import { useSearchParams } from "react-router";
import { toast } from "sonner";
import {
	CHART_COLORS,
	ECHARTS_GRID,
} from "@/app/components/charts/shared/EChartsTheme";
import { WEIGHT_MULTIPLIER } from "@/schemas/transforms";
import type { InsightItem } from "@/app/components/InsightsFeed";
import { PageShell } from "@/app/components/PageShell";
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
import { getExerciseProfile } from "@/lib/exercise-muscles";
import { downloadCSV } from "@/lib/export/csv";
import type { Recommendation } from "@/lib/recommendations";
import {
	generateSraRecommendations,
	generateVolumeRecommendations,
	mergeRecommendations,
} from "@/lib/recommendations";
import type { MuscleRecovery } from "@/lib/sra-recovery";
import { computeSraStatus } from "@/lib/sra-recovery";
import { calculateRTL, classifyTrainingLoad } from "@/lib/training-load";
import { convertWeight, formatVolume, type WeightUnit } from "@/lib/units";
import type { ExerciseSessionData } from "@/lib/volume-landmarks";
import { computeWeeklyVolume } from "@/lib/volume-landmarks";
import {
	muscleGroupOptions,
	strengthProgressOptions,
	volumeComparisonOptions,
	volumeTrendOptions,
} from "@/queries/analytics";
import { bodyIntelligenceOptions } from "@/queries/body-intelligence";
import { insightsOptions } from "@/queries/insights";
import { externalActivitiesOptions } from "@/queries/integrations";
import { profileOptions } from "@/queries/profile";
import { useProfileFilterStore } from "@/stores/useProfileFilterStore";

// Lazy-loaded tab components for code splitting (desktop)
const OverviewTab = lazy(
	() => import("@/app/components/analytics/OverviewTab"),
);
const ProgressTab = lazy(
	() => import("@/app/components/analytics/ProgressTab"),
);
const BodyTab = lazy(() => import("@/app/components/analytics/BodyTab"));
const PerformanceTab = lazy(
	() => import("@/app/components/analytics/PerformanceTab"),
);
const RecordsTab = lazy(() => import("@/app/components/analytics/RecordsTab"));

// Lazy-loaded tab components for code splitting (mobile)
const MobileOverviewTab = lazy(
	() => import("@/app/components/analytics/MobileOverviewTab"),
);
const MobileProgressTab = lazy(
	() => import("@/app/components/analytics/MobileProgressTab"),
);
const MobileBodyTab = lazy(
	() => import("@/app/components/analytics/MobileBodyTab"),
);
const MobilePerformanceTab = lazy(
	() => import("@/app/components/analytics/MobilePerformanceTab"),
);

function AnalyticsTabSkeleton() {
	return (
		<div className="space-y-6">
			<ChartSkeleton />
			<div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
				<ChartSkeleton />
				<ChartSkeleton />
			</div>
		</div>
	);
}

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

const VALID_TABS = ["overview", "progress", "body", "performance", "records"];

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
		existing.volume += item.total_volume * WEIGHT_MULTIPLIER;
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
		weeks.set(
			weekKey,
			(weeks.get(weekKey) ?? 0) + item.total_volume * WEIGHT_MULTIPLIER,
		);
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
		<Card className="min-w-[120px] p-4 bg-surface-2 border-secondary">
			<div className="flex flex-col">
				<div className="text-muted-foreground text-xs mb-1">{label}</div>
				<div className="flex items-center justify-between">
					<span className="text-2xl font-bold text-white font-data">
						{value}
					</span>
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

/** Compute percent delta between two values, returning null if not meaningful */
function percentDelta(current: number, previous: number): number | null {
	if (previous === 0) return current > 0 ? 100 : null;
	return Math.round(((current - previous) / previous) * 100);
}

// Map muscle group names → react-muscle-highlighter slugs for body heatmap
const muscleSlugToGroup: Record<string, string> = {
	chest: "Chest",
	deltoids: "Shoulders",
	trapezius: "Shoulders",
	biceps: "Arms",
	triceps: "Arms",
	forearm: "Arms",
	abs: "Core",
	obliques: "Core",
	quadriceps: "Legs",
	hamstring: "Legs",
	calves: "Legs",
	adductors: "Legs",
	gluteal: "Legs",
	"upper-back": "Back",
	"lower-back": "Back",
};

export function Analytics() {
	const { user } = useAuth();
	const [timePeriod, setTimePeriod] = useState("30D");
	const [searchParams, setSearchParams] = useSearchParams();

	// Map old tab names to new ones for backward compatibility
	const rawTab = searchParams.get("tab") || "overview";
	const activeTab = VALID_TABS.includes(rawTab)
		? rawTab
		: (TAB_MIGRATION[rawTab] ?? "overview");
	const setActiveTab = (tab: string) => setSearchParams({ tab });

	const queryPeriod = periodToDays(timePeriod);
	const insightPeriod = periodToInsightPeriod(timePeriod);
	const userId = user?.id ?? "";
	const { activeProfileId } = useProfileFilterStore();
	const { data: profile } = useQuery({
		...profileOptions(userId),
		enabled: !!userId,
	});
	const { data: volumeRaw, isPending: volumePending } = useQuery(
		volumeTrendOptions(userId, queryPeriod, activeProfileId),
	);
	const { data: muscleGroupRaw, isPending: musclePending } = useQuery(
		muscleGroupOptions(userId, activeProfileId),
	);
	const { data: strengthRaw, isPending: strengthPending } = useQuery(
		strengthProgressOptions(userId, activeProfileId),
	);
	const { data: externalActivities } = useQuery({
		...externalActivitiesOptions(userId),
		enabled: !!user,
	});
	const { data: volumeComparison } = useQuery({
		...volumeComparisonOptions(userId, queryPeriod, activeProfileId),
		enabled: !!userId,
	});
	const { data: insightsData, isPending: insightsPending } = useQuery({
		...insightsOptions(userId, insightPeriod),
		enabled: !!userId,
	});
	const { data: bodyIntelData } = useQuery({
		...bodyIntelligenceOptions(userId, 7, activeProfileId),
		enabled: !!userId,
	});
	const unit: WeightUnit = profile?.weight_unit === "lbs" ? "lbs" : "kg";

	const isPending = volumePending || musclePending || strengthPending;

	// --- Body Intelligence derived data ---

	// Transform query result to ExerciseSessionData for volume computation
	const exerciseSessionData: ExerciseSessionData[] = useMemo(() => {
		return (bodyIntelData ?? []).map((row) => ({
			name: row.name,
			muscleGroup: row.muscle_group,
			setCount: row.setCount,
		}));
	}, [bodyIntelData]);

	const weeklyVolume = useMemo(
		() => computeWeeklyVolume(exerciseSessionData),
		[exerciseSessionData],
	);

	// Group exercises by primary muscle group for ExerciseDeepDive
	const exercisesByMuscle = useMemo(() => {
		const grouped: Record<string, Map<string, number>> = {};
		for (const ex of exerciseSessionData) {
			const profile = getExerciseProfile(ex.name, ex.muscleGroup ?? undefined);
			const group = profile.primary.group;
			if (group === "General") continue;
			if (!grouped[group]) grouped[group] = new Map();
			const current = grouped[group].get(ex.name) ?? 0;
			grouped[group].set(ex.name, current + 1);
		}
		const result: Record<
			string,
			Array<{ name: string; sessionCount: number }>
		> = {};
		for (const [group, exercises] of Object.entries(grouped)) {
			result[group] = [...exercises.entries()]
				.map(([name, count]) => ({ name, sessionCount: count }))
				.sort((a, b) => b.sessionCount - a.sessionCount);
		}
		return result;
	}, [exerciseSessionData]);

	// Compute SRA recovery for each muscle group
	const muscleRecoveries: MuscleRecovery[] = useMemo(() => {
		const groups = ["Chest", "Back", "Shoulders", "Legs", "Arms", "Core"];
		return groups.map((group) => {
			// Find most recent session for this muscle group
			const exercisesForGroup = (bodyIntelData ?? []).filter((row) => {
				const profile = getExerciseProfile(
					row.name,
					row.muscle_group ?? undefined,
				);
				return profile.primary.group === group;
			});

			if (exercisesForGroup.length === 0) {
				return computeSraStatus(group, {
					hoursSinceLastTrained: null,
					isHeavy: false,
					isHighVolume: false,
				});
			}

			// Find most recent session timestamp
			const mostRecent = exercisesForGroup.reduce(
				(latest, ex) => {
					const sessionDate = ex.workout_sessions?.started_at;
					if (!sessionDate) return latest;
					const date = new Date(sessionDate);
					return !latest || date > latest ? date : latest;
				},
				null as Date | null,
			);

			const hoursSince = mostRecent
				? (Date.now() - mostRecent.getTime()) / (1000 * 60 * 60)
				: null;

			// Simple intensity/volume check (without per-set weight data for now)
			const setsForGroup = weeklyVolume[group] ?? 0;
			const isHighVolume =
				setsForGroup >
				({
					Chest: 18,
					Back: 20,
					Shoulders: 16,
					Legs: 16,
					Arms: 14,
					Core: 12,
				}[group] ?? 16);

			return computeSraStatus(group, {
				hoursSinceLastTrained: hoursSince,
				isHeavy: false, // Conservative default; intensity calc deferred to sessionSetWeights integration
				isHighVolume,
			});
		});
	}, [bodyIntelData, weeklyVolume]);

	// Compute recommendations
	const recommendations: Recommendation[] = useMemo(() => {
		const volumeRecos = generateVolumeRecommendations(weeklyVolume);
		const sraRecos = generateSraRecommendations(muscleRecoveries);
		return mergeRecommendations([...volumeRecos, ...sraRecos]);
	}, [weeklyVolume, muscleRecoveries]);

	const totalSessions = useMemo(() => {
		const sessionIds = new Set((bodyIntelData ?? []).map((r) => r.session_id));
		return sessionIds.size;
	}, [bodyIntelData]);

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

	const muscleHighlighterData: ExtendedBodyPart[] = useMemo(() => {
		if (muscleGroupData.length === 0) return [];
		const maxVal = Math.max(...muscleGroupData.map((m) => m.value), 1);
		const groupToIntensity: Record<string, number> = {};
		for (const m of muscleGroupData) {
			groupToIntensity[m.name] = Math.max(
				1,
				Math.round((m.value / maxVal) * 5),
			);
		}
		return Object.entries(muscleSlugToGroup).map(([slug, group]) => ({
			slug: slug as Slug,
			intensity: groupToIntensity[group] ?? 0,
		}));
	}, [muscleGroupData]);

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
			(s, r) => s + (r.total_volume ?? 0) * WEIGHT_MULTIPLIER,
			0,
		);
		const previousVol = volumeComparison.previous.reduce(
			(s, r) => s + (r.total_volume ?? 0) * WEIGHT_MULTIPLIER,
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
			totalVolume: (s.total_volume ?? 0) * WEIGHT_MULTIPLIER,
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
			Math.ceil(
				raw.length > 0
					? (now.getTime() - new Date(raw[0].started_at).getTime()) /
							(7 * 24 * 60 * 60 * 1000)
					: 1,
			),
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
		if (
			insightsData &&
			Array.isArray(insightsData) &&
			insightsData.length > 0
		) {
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
			type:
				i.type === "positive"
					? ("success" as const)
					: i.type === "warning"
						? ("warning" as const)
						: ("info" as const),
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
		fill: MUSCLE_GROUP_COLORS_MOBILE[m.name] ?? PHOENIX.ashGray,
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
					<div className="sticky top-0 bg-surface-1 z-10 px-4 py-3 border-b border-secondary">
						<Skeleton className="h-6 w-32" />
					</div>
					<div className="flex overflow-x-auto gap-3 px-4 py-4">
						{Array.from({ length: 5 }).map((_, i) => (
							// biome-ignore lint/suspicious/noArrayIndexKey: Static skeleton placeholders
							<div key={`skeleton-mobile-${i}`} className="min-w-[120px]">
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
								// biome-ignore lint/suspicious/noArrayIndexKey: Static skeleton placeholders
								<StatCardSkeleton key={`skeleton-desktop-${i}`} />
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
				<div className="sticky top-0 bg-surface-1 z-10 px-4 py-3 border-b border-secondary">
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
								type="button"
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
							delta:
								heroDeltas.volume != null
									? {
											value: heroDeltas.volume,
											positive: heroDeltas.volume >= 0,
										}
									: undefined,
						},
						{
							label: "Workouts",
							value: `${mobileTotalWorkouts}`,
							icon: <Dumbbell className="w-5 h-5" />,
							delta:
								heroDeltas.workouts != null
									? {
											value: heroDeltas.workouts,
											positive: heroDeltas.workouts >= 0,
										}
									: undefined,
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

				{/* Scrollable Tabs -- 5 tabs */}
				<div className="overflow-x-auto scrollbar-hide border-b border-secondary">
					<div className="flex px-4 gap-1">
						{[
							{ value: "overview", label: "Overview" },
							{ value: "progress", label: "Progress" },
							{ value: "body", label: "Body" },
							{ value: "performance", label: "Performance" },
							{ value: "records", label: "Records" },
						].map((tab) => (
							<button
								type="button"
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
								<Suspense fallback={<AnalyticsTabSkeleton />}>
									<MobileOverviewTab
										mobileVolumeData={mobileVolumeData}
										trainingLoad={trainingLoad}
										consistencyData={consistencyData}
										insightsFeedItems={insightsFeedItems}
										insightsPending={insightsPending}
									/>
								</Suspense>
							)}

							{activeTab === "progress" && (
								<Suspense fallback={<AnalyticsTabSkeleton />}>
									<MobileProgressTab
										unit={unit}
										mobileStrengthData={mobileStrengthData}
										mobileVolumeData={mobileVolumeData}
										prCount={prCount}
										daysSinceLastPR={daysSinceLastPR}
									/>
								</Suspense>
							)}

							{activeTab === "body" && (
								<Suspense fallback={<AnalyticsTabSkeleton />}>
									<MobileBodyTab
										muscleGroupData={muscleGroupData}
										muscleRadarData={muscleRadarData}
										mobileMusclData={mobileMusclData}
										weeklyVolume={weeklyVolume}
										totalSessions={totalSessions}
										muscleRecoveries={muscleRecoveries}
										recommendations={recommendations}
										exercisesByMuscle={exercisesByMuscle}
										userId={userId}
										unit={unit}
										profileId={activeProfileId}
									/>
								</Suspense>
							)}

							{activeTab === "performance" && (
								<Suspense fallback={<AnalyticsTabSkeleton />}>
									<MobilePerformanceTab />
								</Suspense>
							)}

							{activeTab === "records" && (
								<Suspense fallback={<AnalyticsTabSkeleton />}>
									<RecordsTab unit={unit} />
								</Suspense>
							)}
						</>
					)}
				</div>
			</div>
			<div className="hidden md:block">
				<PageShell>
					{/* Header */}
					<div className="mb-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
						<div>
							<h1 className="text-display-2 mb-2 text-white">Analytics Hub</h1>
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
										<Card className="p-4 bg-surface-2 border-secondary">
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
								<TabsList variant="panel">
									<TabsTrigger value="overview">Overview</TabsTrigger>
									<TabsTrigger value="progress">Progress</TabsTrigger>
									<TabsTrigger value="body">Body</TabsTrigger>
									<TabsTrigger value="performance">Performance</TabsTrigger>
									<TabsTrigger value="records">Records</TabsTrigger>
								</TabsList>

								{/* ====== TAB 1: OVERVIEW ====== */}
								<TabsContent value="overview" className="space-y-6">
									<Suspense fallback={<AnalyticsTabSkeleton />}>
										<OverviewTab
											totalWorkouts={totalWorkouts}
											externalCount={externalCount}
											externalChartData={externalChartData}
											volumeEChartsOption={volumeEChartsOption}
											muscleDonutOption={muscleDonutOption}
											trainingLoad={trainingLoad}
											consistencyData={consistencyData}
											insightsFeedItems={insightsFeedItems}
											insightsPending={insightsPending}
										/>
									</Suspense>
								</TabsContent>

								{/* ====== TAB 2: PROGRESS ====== */}
								<TabsContent value="progress" className="space-y-6">
									<Suspense fallback={<AnalyticsTabSkeleton />}>
										<ProgressTab
											unit={unit}
											strengthEChartsOption={strengthEChartsOption}
											volumeAreaOption={volumeAreaOption}
											prCount={prCount}
											daysSinceLastPR={daysSinceLastPR}
											strengthExercises={strengthExercises}
											insights={insights}
										/>
									</Suspense>
								</TabsContent>

								{/* ====== TAB 3: BODY ====== */}
								<TabsContent value="body" className="space-y-6">
									<Suspense fallback={<AnalyticsTabSkeleton />}>
										<BodyTab
											muscleGroupData={muscleGroupData}
											muscleDonutOption={muscleDonutOption}
											muscleRadarData={muscleRadarData}
											muscleHighlighterData={muscleHighlighterData}
											muscleSlugToGroup={muscleSlugToGroup}
											weeklyVolume={weeklyVolume}
											totalSessions={totalSessions}
											muscleRecoveries={muscleRecoveries}
											recommendations={recommendations}
											exercisesByMuscle={exercisesByMuscle}
											userId={userId}
											unit={unit}
											profileId={activeProfileId}
										/>
									</Suspense>
								</TabsContent>

								{/* ====== TAB 4: PERFORMANCE ====== */}
								<TabsContent value="performance" className="space-y-6">
									<Suspense fallback={<AnalyticsTabSkeleton />}>
										<PerformanceTab
											volumeComparison={volumeComparison}
											unit={unit}
										/>
									</Suspense>
								</TabsContent>

								{/* ====== TAB 5: RECORDS ====== */}
								<TabsContent value="records" className="space-y-6">
									<Suspense fallback={<AnalyticsTabSkeleton />}>
										<RecordsTab unit={unit} />
									</Suspense>
								</TabsContent>
							</Tabs>
						</>
					)}
				</PageShell>
			</div>
			;
		</div>
	);
}
