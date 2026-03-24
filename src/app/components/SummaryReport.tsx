import { useQuery } from "@tanstack/react-query";
import {
	Calendar,
	Dumbbell,
	Flame,
	Target,
	TrendingDown,
	TrendingUp,
	Trophy,
	Zap,
} from "lucide-react";
import { motion } from "motion/react";
import { useMemo, useState } from "react";
import { Bar, BarChart, Line, LineChart, ResponsiveContainer } from "recharts";
import { Card } from "@/app/components/ui/card";
import { Skeleton } from "@/app/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/app/components/ui/tabs";
import { PHOENIX } from "@/lib/colors";
import { weeklySummaryOptions } from "@/queries/progress";
import type { ExerciseProgress } from "@/schemas/telemetry";
import { useProfileFilterStore } from "@/stores/useProfileFilterStore";

export interface SummaryReportProps {
	userId: string;
}

/** Reasonable default workout targets per period.
 *  Week: 5 days (standard training week). Month: 20 days (~5 per week). */
function getTargetDays(period: "week" | "month"): number {
	return period === "week" ? 5 : 20;
}

interface PeriodSummary {
	totalVolume: number;
	workoutDays: number;
	prs: Array<{ exercise: string; improvement: number }>;
	consistencyScore: number;
	dailyVolume: Array<{ day: string; volume: number }>;
	dailyWorkouts: Array<{ day: string; sessions: number }>;
	bestSessionVolume: number;
	bestSessionDate: string;
	mostImprovedExercise: string;
	mostImprovedAmount: number;
	longestStreak: number;
	previousVolume: number;
	previousWorkoutDays: number;
	targetDays: number;
}

function computeSummary(
	data: ExerciseProgress[],
	period: "week" | "month",
): PeriodSummary {
	if (data.length === 0) {
		return {
			totalVolume: 0,
			workoutDays: 0,
			prs: [],
			consistencyScore: 0,
			dailyVolume: [],
			dailyWorkouts: [],
			bestSessionVolume: 0,
			bestSessionDate: "",
			mostImprovedExercise: "",
			mostImprovedAmount: 0,
			longestStreak: 0,
			previousVolume: 0,
			previousWorkoutDays: 0,
			targetDays: getTargetDays(period),
		};
	}

	const daysInPeriod = period === "week" ? 7 : 30;
	const now = new Date();
	const midpoint = new Date();
	midpoint.setDate(now.getDate() - daysInPeriod);

	// Split data into current and previous half for comparison
	const current = data.filter((d) => d.recorded_at >= midpoint);
	const previous = data.filter((d) => d.recorded_at < midpoint);

	// Total volume
	const totalVolume = Math.round(
		current.reduce((sum, d) => sum + d.total_volume_kg, 0),
	);
	const previousVolume = Math.round(
		previous.reduce((sum, d) => sum + d.total_volume_kg, 0),
	);

	// Workout days (unique dates)
	const workoutDateSet = new Set(
		current.map((d) => d.recorded_at.toISOString().slice(0, 10)),
	);
	const workoutDays = workoutDateSet.size;
	const previousWorkoutDays = new Set(
		previous.map((d) => d.recorded_at.toISOString().slice(0, 10)),
	).size;

	// Consistency
	const targetDays = getTargetDays(period);
	const consistencyScore = Math.min(
		100,
		Math.round((workoutDays / targetDays) * 100),
	);

	// PRs: exercises where current max weight > previous max weight
	const exerciseMaxCurrent = new Map<string, number>();
	const exerciseMaxPrevious = new Map<string, number>();
	for (const d of current) {
		const existing = exerciseMaxCurrent.get(d.exercise_name) ?? 0;
		if (d.max_weight_kg > existing)
			exerciseMaxCurrent.set(d.exercise_name, d.max_weight_kg);
	}
	for (const d of previous) {
		const existing = exerciseMaxPrevious.get(d.exercise_name) ?? 0;
		if (d.max_weight_kg > existing)
			exerciseMaxPrevious.set(d.exercise_name, d.max_weight_kg);
	}
	const prs: Array<{
		exercise: string;
		improvement: number;
		isFirstPR: boolean;
	}> = [];
	for (const [name, maxWeight] of exerciseMaxCurrent) {
		const prevMax = exerciseMaxPrevious.get(name) ?? 0;
		if (prevMax > 0 && maxWeight > prevMax) {
			prs.push({
				exercise: name,
				improvement: Math.round((maxWeight - prevMax) * 10) / 10,
				isFirstPR: false,
			});
		} else if (prevMax === 0) {
			// First-ever PR for this exercise
			prs.push({
				exercise: name,
				improvement: maxWeight,
				isFirstPR: true,
			});
		}
	}
	prs.sort((a, b) => b.improvement - a.improvement);

	// Daily volume sparkline
	const dailyVolumeMap = new Map<string, number>();
	const dailyWorkoutMap = new Map<string, number>();
	for (const d of current) {
		const dayKey = d.recorded_at.toLocaleDateString("en-US", {
			weekday: "short",
		});
		dailyVolumeMap.set(
			dayKey,
			(dailyVolumeMap.get(dayKey) ?? 0) + d.total_volume_kg,
		);
		dailyWorkoutMap.set(dayKey, (dailyWorkoutMap.get(dayKey) ?? 0) + 1);
	}
	const dailyVolume = Array.from(dailyVolumeMap.entries()).map(
		([day, volume]) => ({
			day,
			volume: Math.round(volume),
		}),
	);
	const dailyWorkouts = Array.from(dailyWorkoutMap.entries()).map(
		([day, sessions]) => ({
			day,
			sessions,
		}),
	);

	// Best session by volume
	const sessionVolumes = new Map<string, { volume: number; date: Date }>();
	for (const d of current) {
		const key = d.session_id;
		const existing = sessionVolumes.get(key) ?? {
			volume: 0,
			date: d.recorded_at,
		};
		existing.volume += d.total_volume_kg;
		sessionVolumes.set(key, existing);
	}
	let bestSessionVolume = 0;
	let bestSessionDate = "";
	for (const [, { volume, date }] of sessionVolumes) {
		if (volume > bestSessionVolume) {
			bestSessionVolume = Math.round(volume);
			bestSessionDate = date.toLocaleDateString("en-US", {
				month: "short",
				day: "numeric",
			});
		}
	}

	// Most improved exercise
	let mostImprovedExercise = "";
	let mostImprovedAmount = 0;
	for (const pr of prs) {
		if (pr.improvement > mostImprovedAmount) {
			mostImprovedExercise = pr.exercise;
			mostImprovedAmount = pr.improvement;
		}
	}

	// Longest streak
	const sortedDates = [...workoutDateSet].sort();
	let longestStreak = 0;
	let currentStreak = 1;
	for (let i = 1; i < sortedDates.length; i++) {
		const prev = new Date(sortedDates[i - 1]);
		const curr = new Date(sortedDates[i]);
		const diff = (curr.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24);
		if (diff === 1) {
			currentStreak++;
		} else {
			longestStreak = Math.max(longestStreak, currentStreak);
			currentStreak = 1;
		}
	}
	longestStreak = Math.max(longestStreak, currentStreak);
	if (sortedDates.length === 0) longestStreak = 0;

	return {
		totalVolume,
		workoutDays,
		prs,
		consistencyScore,
		dailyVolume,
		dailyWorkouts,
		bestSessionVolume,
		bestSessionDate,
		mostImprovedExercise,
		mostImprovedAmount,
		longestStreak,
		previousVolume,
		previousWorkoutDays,
		targetDays,
	};
}

function percentChange(current: number, previous: number): number {
	if (previous === 0) return current > 0 ? 100 : 0;
	return Math.round(((current - previous) / previous) * 100);
}

function ConsistencyRing({ score }: { score: number }) {
	const radius = 28;
	const circumference = 2 * Math.PI * radius;
	const offset = circumference - (score / 100) * circumference;
	const color =
		score > 80
			? PHOENIX.forgeGreen
			: score >= 50
				? PHOENIX.gold
				: PHOENIX.flameRed;

	return (
		<svg width="68" height="68" viewBox="0 0 68 68">
			<circle
				cx="34"
				cy="34"
				r={radius}
				fill="none"
				stroke={PHOENIX.moltenSteel}
				strokeWidth="5"
			/>
			<circle
				cx="34"
				cy="34"
				r={radius}
				fill="none"
				stroke={color}
				strokeWidth="5"
				strokeDasharray={circumference}
				strokeDashoffset={offset}
				strokeLinecap="round"
				transform="rotate(-90 34 34)"
			/>
			<text
				x="34"
				y="38"
				textAnchor="middle"
				fill={color}
				fontSize="14"
				fontWeight="bold"
			>
				{score}
			</text>
		</svg>
	);
}

function SkeletonCards() {
	return (
		<div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
			{Array.from({ length: 4 }).map((_, i) => (
				<Card key={i} className="p-5 bg-surface-2 border-secondary">
					<Skeleton className="h-4 w-20 mb-3" />
					<Skeleton className="h-8 w-24 mb-2" />
					<Skeleton className="h-12 w-full mb-2" />
					<Skeleton className="h-3 w-28" />
				</Card>
			))}
		</div>
	);
}

export function SummaryReport({ userId }: SummaryReportProps) {
	const [period, setPeriod] = useState<"week" | "month">("week");
	const { activeProfileId } = useProfileFilterStore();

	const { data: rawData, isPending } = useQuery(
		weeklySummaryOptions(userId, period, activeProfileId),
	);

	const summary = useMemo(
		() => computeSummary(rawData ?? [], period),
		[rawData, period],
	);

	const volumeChange = percentChange(
		summary.totalVolume,
		summary.previousVolume,
	);
	const frequencyChange = percentChange(
		summary.workoutDays,
		summary.previousWorkoutDays,
	);

	if (isPending) {
		return (
			<div className="space-y-6">
				<Tabs value={period}>
					<TabsList variant="panel">
						<TabsTrigger value="week">
							This Week
						</TabsTrigger>
						<TabsTrigger value="month">
							This Month
						</TabsTrigger>
					</TabsList>
				</Tabs>
				<SkeletonCards />
			</div>
		);
	}

	const hasData = (rawData ?? []).length > 0;

	if (!hasData) {
		return (
			<div className="space-y-6">
				<Tabs
					value={period}
					onValueChange={(v) => setPeriod(v as "week" | "month")}
				>
					<TabsList variant="panel">
						<TabsTrigger value="week">
							This Week
						</TabsTrigger>
						<TabsTrigger value="month">
							This Month
						</TabsTrigger>
					</TabsList>
				</Tabs>
				<div className="text-center py-12">
					<div className="w-20 h-20 mx-auto mb-4 rounded-full bg-gradient-to-br from-primary/20 to-accent/20 flex items-center justify-center">
						<Dumbbell className="w-10 h-10 text-primary" />
					</div>
					<h3 className="text-xl font-semibold text-white mb-2">
						No summary data yet
					</h3>
					<p className="text-muted-foreground max-w-sm mx-auto">
						Complete some workouts to see your{" "}
						{period === "week" ? "weekly" : "monthly"} summary report.
					</p>
				</div>
			</div>
		);
	}

	return (
		<div className="space-y-6">
			{/* Period selector */}
			<Tabs
				value={period}
				onValueChange={(v) => setPeriod(v as "week" | "month")}
			>
				<TabsList variant="panel">
					<TabsTrigger value="week">
						This Week
					</TabsTrigger>
					<TabsTrigger value="month">
						This Month
					</TabsTrigger>
				</TabsList>
			</Tabs>

			{/* Summary cards grid */}
			<div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
				{/* Card A: Total Volume */}
				<motion.div
					initial={{ opacity: 0, y: 20 }}
					animate={{ opacity: 1, y: 0 }}
					transition={{ delay: 0 }}
				>
					<Card className="p-5 bg-surface-2 border-secondary h-full">
						<div className="flex items-center gap-2 mb-3">
							<div className="p-2 rounded-lg bg-primary/20">
								<Dumbbell className="w-4 h-4 text-primary" />
							</div>
							<span className="text-sm text-muted-foreground">
								Total Volume
							</span>
						</div>
						<div className="text-2xl font-semibold text-white mb-2">
							{summary.totalVolume > 1000
								? `${(summary.totalVolume / 1000).toFixed(1)}K`
								: summary.totalVolume}{" "}
							<span className="text-sm text-muted-foreground">kg</span>
						</div>
						{summary.dailyVolume.length > 0 && (
							<div className="mb-2">
								<div role="img" aria-label="Daily volume sparkline">
									<ResponsiveContainer width="100%" height={40}>
										<LineChart data={summary.dailyVolume}>
											<Line
												type="monotone"
												dataKey="volume"
												stroke={PHOENIX.ember}
												strokeWidth={2}
												dot={false}
												t
												animationDuration={800}
												animationEasing="ease-out"
											/>
										</LineChart>
									</ResponsiveContainer>
								</div>
							</div>
						)}
						<div className="flex items-center gap-1 text-xs">
							{volumeChange >= 0 ? (
								<TrendingUp className="w-3 h-3 text-success" />
							) : (
								<TrendingDown className="w-3 h-3 text-chart-2" />
							)}
							<span
								className={volumeChange >= 0 ? "text-success" : "text-chart-2"}
							>
								{volumeChange > 0 ? "+" : ""}
								{volumeChange}% vs last {period}
							</span>
						</div>
					</Card>
				</motion.div>

				{/* Card B: Workout Frequency */}
				<motion.div
					initial={{ opacity: 0, y: 20 }}
					animate={{ opacity: 1, y: 0 }}
					transition={{ delay: 0.1 }}
				>
					<Card className="p-5 bg-surface-2 border-secondary h-full">
						<div className="flex items-center gap-2 mb-3">
							<div className="p-2 rounded-lg bg-accent/20">
								<Calendar className="w-4 h-4 text-accent" />
							</div>
							<span className="text-sm text-muted-foreground">Frequency</span>
						</div>
						<div className="text-2xl font-semibold text-white mb-2">
							{summary.workoutDays}{" "}
							<span className="text-sm text-muted-foreground">
								of {summary.targetDays} target
							</span>
						</div>
						{summary.dailyWorkouts.length > 0 && (
							<div className="mb-2">
								<div role="img" aria-label="Daily workout count sparkline">
									<ResponsiveContainer width="100%" height={40}>
										<BarChart data={summary.dailyWorkouts}>
											<Bar
												dataKey="sessions"
												fill={PHOENIX.gold}
												radius={[2, 2, 0, 0]}
												animationDuration={800}
												animationEasing="ease-out"
											/>
										</BarChart>
									</ResponsiveContainer>
								</div>
							</div>
						)}
						<div className="flex items-center gap-1 text-xs">
							{frequencyChange >= 0 ? (
								<TrendingUp className="w-3 h-3 text-success" />
							) : (
								<TrendingDown className="w-3 h-3 text-chart-2" />
							)}
							<span
								className={
									frequencyChange >= 0 ? "text-success" : "text-chart-2"
								}
							>
								{frequencyChange > 0 ? "+" : ""}
								{frequencyChange}% vs last {period}
							</span>
						</div>
					</Card>
				</motion.div>

				{/* Card C: Personal Records */}
				<motion.div
					initial={{ opacity: 0, y: 20 }}
					animate={{ opacity: 1, y: 0 }}
					transition={{ delay: 0.2 }}
				>
					<Card className="p-5 bg-surface-2 border-secondary h-full">
						<div className="flex items-center gap-2 mb-3">
							<div className="p-2 rounded-lg bg-success/20">
								<Trophy className="w-4 h-4 text-success" />
							</div>
							<span className="text-sm text-muted-foreground">
								Personal Records
							</span>
						</div>
						<div className="text-2xl font-semibold text-white mb-2">
							{summary.prs.length}{" "}
							<span className="text-sm text-muted-foreground">PRs hit</span>
						</div>
						{summary.prs.length > 0 ? (
							<div className="space-y-1">
								{summary.prs.slice(0, 3).map((pr) => (
									<div
										key={pr.exercise}
										className="text-xs text-muted-foreground truncate"
									>
										{pr.exercise}{" "}
										<span className="text-success">
											{pr.isFirstPR
												? `${pr.improvement}kg (first!)`
												: `+${pr.improvement}kg`}
										</span>
									</div>
								))}
							</div>
						) : (
							<div className="text-xs text-muted-foreground">No new PRs this {period}</div>
						)}
					</Card>
				</motion.div>

				{/* Card D: Consistency Score */}
				<motion.div
					initial={{ opacity: 0, y: 20 }}
					animate={{ opacity: 1, y: 0 }}
					transition={{ delay: 0.3 }}
				>
					<Card className="p-5 bg-surface-2 border-secondary h-full">
						<div className="flex items-center gap-2 mb-3">
							<div className="p-2 rounded-lg bg-chart-2/20">
								<Flame className="w-4 h-4 text-chart-2" />
							</div>
							<span className="text-sm text-muted-foreground">Consistency</span>
						</div>
						<div className="flex items-center gap-3">
							<ConsistencyRing score={summary.consistencyScore} />
							<div>
								<div
									className="text-2xl font-semibold"
									style={{
										color:
											summary.consistencyScore > 80
												? PHOENIX.forgeGreen
												: summary.consistencyScore >= 50
													? PHOENIX.gold
													: PHOENIX.flameRed,
									}}
								>
									{summary.consistencyScore}%
								</div>
								<div className="text-xs text-muted-foreground">
									{summary.workoutDays}/{summary.targetDays} days
								</div>
							</div>
						</div>
					</Card>
				</motion.div>
			</div>

			{/* Highlights section */}
			{(summary.bestSessionVolume > 0 ||
				summary.mostImprovedExercise ||
				summary.longestStreak > 0) && (
				<motion.div
					initial={{ opacity: 0, y: 20 }}
					animate={{ opacity: 1, y: 0 }}
					transition={{ delay: 0.4 }}
				>
					<Card className="p-5 bg-surface-2 border-secondary">
						<h4 className="text-lg font-medium text-white mb-4 flex items-center gap-2">
							<Zap className="w-5 h-5 text-accent" />
							Highlights
						</h4>
						<div className="space-y-3">
							{summary.bestSessionVolume > 0 && (
								<div className="flex items-start gap-3">
									<Target className="w-4 h-4 text-primary mt-0.5 shrink-0" />
									<div>
										<span className="text-white text-sm">
											Best session by volume:{" "}
										</span>
										<span className="text-primary text-sm font-medium">
											{summary.bestSessionVolume} kg
										</span>
										{summary.bestSessionDate && (
											<span className="text-muted-foreground text-xs ml-1">
												on {summary.bestSessionDate}
											</span>
										)}
									</div>
								</div>
							)}
							{summary.mostImprovedExercise && (
								<div className="flex items-start gap-3">
									<TrendingUp className="w-4 h-4 text-success mt-0.5 shrink-0" />
									<div>
										<span className="text-white text-sm">Most improved: </span>
										<span className="text-success text-sm font-medium">
											{summary.mostImprovedExercise} (+
											{summary.mostImprovedAmount}kg)
										</span>
									</div>
								</div>
							)}
							{summary.longestStreak > 0 && (
								<div className="flex items-start gap-3">
									<Flame className="w-4 h-4 text-accent mt-0.5 shrink-0" />
									<div>
										<span className="text-white text-sm">Longest streak: </span>
										<span className="text-accent text-sm font-medium">
											{summary.longestStreak} consecutive days
										</span>
									</div>
								</div>
							)}
						</div>
					</Card>
				</motion.div>
			)}
		</div>
	);
}
