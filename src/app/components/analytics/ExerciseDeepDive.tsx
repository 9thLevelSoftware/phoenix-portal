import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
	Area,
	AreaChart,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from "recharts";
import { Card } from "@/app/components/ui/card";
import { getExerciseProfile } from "@/lib/exercise-muscles";
import { convertWeight, formatWeight, type WeightUnit } from "@/lib/units";
import { formatWorkoutPhase, WORKOUT_PHASES } from "@/lib/workout-phases";
import { exerciseProgressOptions } from "@/queries/progress";
import { personalRecordsOptions } from "@/queries/records";
import type { ExerciseProgress } from "@/schemas/telemetry";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ExerciseEntry {
	name: string;
	sessionCount: number;
}

export interface ExerciseDeepDiveProps {
	muscleGroup: string;
	exercises: ExerciseEntry[];
	userId: string;
	unit: WeightUnit;
	profileId?: string | null;
}

type TimeRange = "3M" | "6M" | "1Y" | "All";

const TIME_RANGE_DAYS: Record<TimeRange, number> = {
	"3M": 90,
	"6M": 180,
	"1Y": 365,
	All: Infinity,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function filterByTimeRange(
	data: ExerciseProgress[],
	range: TimeRange,
): ExerciseProgress[] {
	const days = TIME_RANGE_DAYS[range];
	if (days === Infinity || data.length === 0) return data;
	const cutoff = new Date();
	cutoff.setDate(cutoff.getDate() - days);
	return data.filter((d) => d.recorded_at >= cutoff);
}

function formatShortDate(date: Date): string {
	return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function computeDelta(values: number[]): number | null {
	if (values.length < 2) return null;
	const first = values[0];
	const last = values[values.length - 1];
	if (first === 0) return null;
	return Math.round(((last - first) / first) * 100);
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatCard({
	label,
	value,
	valueClass,
}: {
	label: string;
	value: string | number;
	valueClass?: string;
}) {
	return (
		<div className="bg-surface-2 rounded-lg p-3 flex flex-col gap-1">
			<span className="text-[11px] text-muted-foreground">{label}</span>
			<span
				className={`text-sm font-semibold tabular-nums ${valueClass ?? "text-white"}`}
			>
				{value}
			</span>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function ExerciseDeepDive({
	muscleGroup,
	exercises,
	userId,
	unit,
	profileId,
}: ExerciseDeepDiveProps) {
	// Sort defensively by session count descending
	const sortedExercises = useMemo(
		() => [...exercises].sort((a, b) => b.sessionCount - a.sessionCount),
		[exercises],
	);

	const [selectedExercise, setSelectedExercise] = useState<string>(
		sortedExercises[0]?.name ?? "",
	);
	const [timeRange, setTimeRange] = useState<TimeRange>("6M");

	// ── Queries ──────────────────────────────────────────────────────────────
	const { data: progressRaw } = useQuery({
		...exerciseProgressOptions(userId, selectedExercise, profileId),
		enabled: !!selectedExercise,
	});

	const { data: records } = useQuery(personalRecordsOptions(userId, profileId));

	// ── Derived data ─────────────────────────────────────────────────────────
	const filteredProgress = useMemo(
		() => filterByTimeRange(progressRaw ?? [], timeRange),
		[progressRaw, timeRange],
	);

	const chartData = useMemo(
		() =>
			filteredProgress.map((d) => ({
				date: formatShortDate(d.recorded_at),
				oneRM: convertWeight(d.estimated_1rm_kg, unit),
			})),
		[filteredProgress, unit],
	);

	const delta = useMemo(
		() => computeDelta(chartData.map((d) => d.oneRM)),
		[chartData],
	);

	const currentOneRM =
		filteredProgress.length > 0
			? filteredProgress[filteredProgress.length - 1].estimated_1rm_kg
			: null;

	const prsByPhaseInPeriod = useMemo(() => {
		const counts = new Map(WORKOUT_PHASES.map((phase) => [phase, 0]));
		if (!records || !selectedExercise) return counts;
		const days = TIME_RANGE_DAYS[timeRange];
		const cutoff =
			days === Infinity
				? null
				: (() => {
						const d = new Date();
						d.setDate(d.getDate() - days);
						return d;
					})();
		for (const r of records) {
			const exerciseMatch =
				r.exercise_name.toLowerCase() === selectedExercise.toLowerCase();
			if (!exerciseMatch) continue;
			if (cutoff && r.achieved_at < cutoff) continue;
			// achieved_at is already a Date (transformed by schema)
			const phase = formatWorkoutPhase(r.workout_phase);
			counts.set(phase, (counts.get(phase) ?? 0) + 1);
		}
		return counts;
	}, [records, selectedExercise, timeRange]);
	const prsInPeriod = Array.from(prsByPhaseInPeriod.values()).reduce(
		(sum, count) => sum + count,
		0,
	);

	const sessionCount =
		sortedExercises.find((e) => e.name === selectedExercise)?.sessionCount ?? 0;

	// ── Activation Profile ────────────────────────────────────────────────────
	const profile = getExerciseProfile(selectedExercise, muscleGroup);

	const hasData = chartData.length > 0;

	// ── Gradient id (unique per exercise to avoid SVG conflicts) ─────────────
	const gradientId = `deepdive-gradient-${selectedExercise.replace(/\s+/g, "-")}`;

	// ── Render ────────────────────────────────────────────────────────────────
	if (sortedExercises.length === 0) {
		return (
			<Card className="p-4 bg-surface-2 border-secondary">
				<p className="text-sm text-muted-foreground text-center py-8">
					No exercises found for {muscleGroup}
				</p>
			</Card>
		);
	}

	return (
		<Card className="p-4 bg-surface-2 border-secondary">
			<div className="flex gap-4 min-h-[320px]">
				{/* ── Left: exercise list ─────────────────────────────────────────── */}
				<div
					className="flex flex-col gap-0.5 shrink-0 overflow-y-auto"
					style={{ width: 160 }}
					data-testid="exercise-list"
				>
					{sortedExercises.map((ex) => {
						const isActive = ex.name === selectedExercise;
						return (
							<button
								key={ex.name}
								type="button"
								onClick={() => setSelectedExercise(ex.name)}
								className={[
									"text-left px-3 py-2 rounded-r-md text-[11px] leading-tight transition-colors cursor-pointer",
									isActive
										? "bg-primary/15 border-l-2 border-primary text-primary font-medium"
										: "text-muted-foreground hover:text-white border-l-2 border-transparent",
								].join(" ")}
							>
								<div className="truncate">{ex.name}</div>
								<div className="text-[10px] opacity-60 mt-0.5">
									{ex.sessionCount} sessions
								</div>
							</button>
						);
					})}
				</div>

				{/* ── Right: detail panel ─────────────────────────────────────────── */}
				<div className="flex-1 min-w-0 flex flex-col gap-4">
					{/* Activation Profile */}
					<div data-testid="activation-profile">
						<p className="text-[11px] text-muted-foreground mb-2 uppercase tracking-wide">
							Activation Profile
						</p>
						<div className="flex flex-wrap gap-x-4 gap-y-1">
							{/* Primary */}
							<span className="flex items-center gap-1.5 text-[11px]">
								<span
									className="w-2.5 h-2.5 rounded-full shrink-0"
									style={{ backgroundColor: "#DC2626" }}
								/>
								<span className="text-muted-foreground">
									{profile.primary.displayName ?? profile.primary.group}
								</span>
								<span className="text-white font-medium">100%</span>
							</span>
							{/* Secondaries */}
							{profile.secondary.map((s, i) => (
								<span
									key={`${s.group}-${s.displayName ?? i}`}
									className="flex items-center gap-1.5 text-[11px]"
								>
									<span
										className="w-2.5 h-2.5 rounded-full shrink-0"
										style={{ backgroundColor: "#F59E0B" }}
									/>
									<span className="text-muted-foreground">
										{s.displayName ?? s.group}
									</span>
									<span className="text-white font-medium">
										{Math.round(s.activation * 100)}%
									</span>
								</span>
							))}
						</div>
					</div>

					{/* 1RM Trend Chart */}
					<div className="flex-1 min-h-[140px]">
						<div className="flex items-center justify-between mb-2">
							<p className="text-[11px] text-muted-foreground uppercase tracking-wide">
								1RM Trend
							</p>
							<div className="flex gap-1">
								{(["3M", "6M", "1Y", "All"] as TimeRange[]).map((r) => (
									<button
										key={r}
										type="button"
										onClick={() => setTimeRange(r)}
										className={[
											"text-[10px] px-2 py-0.5 rounded transition-colors",
											timeRange === r
												? "bg-primary/20 text-primary"
												: "text-muted-foreground hover:text-white",
										].join(" ")}
									>
										{r}
									</button>
								))}
							</div>
						</div>

						{!hasData ? (
							<div
								className="flex items-center justify-center h-24 text-[11px] text-muted-foreground"
								data-testid="empty-state"
							>
								Not enough data for 1RM estimate
							</div>
						) : (
							<div className="flex items-start gap-3">
								<div className="flex-1">
									<ResponsiveContainer width="100%" height={120}>
										<AreaChart
											data={chartData}
											margin={{ top: 4, right: 4, left: -20, bottom: 0 }}
										>
											<defs>
												<linearGradient
													id={gradientId}
													x1="0"
													y1="0"
													x2="0"
													y2="1"
												>
													<stop
														offset="5%"
														stopColor="#FF6B35"
														stopOpacity={0.35}
													/>
													<stop
														offset="95%"
														stopColor="#FF6B35"
														stopOpacity={0}
													/>
												</linearGradient>
											</defs>
											<XAxis
												dataKey="date"
												tick={{ fontSize: 9, fill: "#888894" }}
												axisLine={false}
												tickLine={false}
												interval="preserveStartEnd"
											/>
											<YAxis
												tick={{ fontSize: 9, fill: "#888894" }}
												axisLine={false}
												tickLine={false}
												width={40}
											/>
											<Tooltip
												contentStyle={{
													backgroundColor: "#0a0a10",
													border: "1px solid #374151",
													borderRadius: 6,
													fontSize: 11,
												}}
												labelStyle={{ color: "#e0e0e8" }}
												itemStyle={{ color: "#FF6B35" }}
												formatter={(v: number) =>
													unit === "lbs"
														? `${v.toFixed(1)} lbs`
														: `${Math.round(v)} kg`
												}
											/>
											<Area
												type="monotone"
												dataKey="oneRM"
												stroke="#FF6B35"
												strokeWidth={2}
												fill={`url(#${gradientId})`}
												dot={false}
												activeDot={{ r: 4, fill: "#FF6B35" }}
											/>
										</AreaChart>
									</ResponsiveContainer>
								</div>

								{/* Delta badge */}
								{delta !== null && (
									<div
										className={[
											"shrink-0 text-[11px] font-semibold px-2 py-1 rounded-md mt-2",
											delta > 0
												? "bg-emerald-500/15 text-emerald-400"
												: delta < 0
													? "bg-red-500/15 text-red-400"
													: "bg-secondary/20 text-muted-foreground",
										].join(" ")}
										data-testid="delta-badge"
									>
										{delta > 0 ? "+" : ""}
										{delta}%
									</div>
								)}
							</div>
						)}
					</div>

					{/* Stats Row */}
					<div className="grid grid-cols-4 gap-2" data-testid="stats-row">
						<StatCard
							label="Current 1RM"
							value={
								currentOneRM != null ? formatWeight(currentOneRM, unit) : "—"
							}
						/>
						<StatCard
							label="Period Change"
							value={delta !== null ? `${delta > 0 ? "+" : ""}${delta}%` : "—"}
							valueClass={
								delta !== null && delta > 0
									? "text-emerald-400"
									: delta !== null && delta < 0
										? "text-red-400"
										: "text-white"
							}
						/>
						<StatCard label="Sessions" value={sessionCount} />
						<StatCard label="Phase PRs" value={prsInPeriod} />
					</div>
					{prsInPeriod > 0 && (
						<div
							className="flex flex-wrap gap-2"
							data-testid="phase-pr-breakdown"
						>
							{WORKOUT_PHASES.map((phase) => {
								const count = prsByPhaseInPeriod.get(phase) ?? 0;
								if (count === 0) return null;
								return (
									<span
										key={phase}
										className="rounded-full border border-secondary bg-muted/10 px-2 py-1 text-[10px] text-muted-foreground"
									>
										{phase}: <span className="text-white">{count}</span>
									</span>
								);
							})}
						</div>
					)}
				</div>
			</div>
		</Card>
	);
}
