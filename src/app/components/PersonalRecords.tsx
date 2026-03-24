import { useQuery } from "@tanstack/react-query";
import {
	AlertTriangle,
	ArrowRight,
	ArrowUp,
	Award,
	ChevronDown,
	ChevronUp,
	Crown,
	Flame,
	Star,
	TrendingUp,
	Trophy,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { PageShell } from "@/app/components/PageShell";
import { Badge } from "@/app/components/ui/badge";
import { Button } from "@/app/components/ui/button";
import { Card } from "@/app/components/ui/card";
import { EmptyState } from "@/app/components/ui/empty-state";
import {
	CardSkeleton,
	Skeleton,
	StatCardSkeleton,
} from "@/app/components/ui/skeleton";
import { useAuth } from "@/app/hooks/useAuth";
import { convertWeight, type WeightUnit } from "@/lib/units";
import { profileOptions } from "@/queries/profile";
import { personalRecordsOptions } from "@/queries/records";
import type { PersonalRecord } from "@/schemas/transforms";

// Milestones are motivational UI content, sorted ascending (chronological
// order of achievement: the lower thresholds are reached first).
const milestones = [
	{ id: "4", count: 10, name: "10th PR", icon: Flame },
	{ id: "3", count: 25, name: "25th PR", icon: Award },
	{ id: "2", count: 50, name: "50th PR", icon: Trophy },
	{ id: "1", count: 100, name: "100th PR", icon: Crown },
];

const TIMELINE_INITIAL_LIMIT = 3;

const phaseFilters = ["all", "Combined", "Concentric", "Eccentric"] as const;

/** Map raw record_type DB values to friendly display names */
function formatRecordTypeLabel(recordType: string): string {
	const labels: Record<string, string> = {
		MAX_WEIGHT: "Weight PR",
		"1RM": "1RM PR",
		MAX_VOLUME: "Volume PR",
		MAX_REPS: "Reps PR",
		MAX_DURATION: "Duration PR",
		MAX_FORCE: "Force PR",
		MAX_VELOCITY: "Velocity PR",
	};
	return labels[recordType] ?? recordType;
}

function formatRecordMeasurement(
	value: number,
	originalUnit: string,
	unit: WeightUnit,
): string {
	if (originalUnit !== "kg") {
		return `${value} ${originalUnit}`;
	}

	const converted = convertWeight(value, unit);
	return unit === "lbs"
		? `${converted.toFixed(1)} lbs`
		: `${Math.round(converted)} kg`;
}

export function PersonalRecords() {
	const { user } = useAuth();
	const userId = user?.id ?? "";
	const { data: records, isPending } = useQuery({
		...personalRecordsOptions(userId),
		enabled: !!userId,
	});
	const { data: profile } = useQuery({
		...profileOptions(userId),
		enabled: !!userId,
	});
	const unit: WeightUnit = profile?.weight_unit === "lbs" ? "lbs" : "kg";

	const [activeFilter, setActiveFilter] = useState("All");
	const [phaseFilter, setPhaseFilter] = useState<
		"all" | "Combined" | "Concentric" | "Eccentric"
	>("all");
	const [viewMode, setViewMode] = useState<"list" | "timeline">("list");
	const [expandedExercises, setExpandedExercises] = useState<string[]>([]);
	const [showAllTimeline, setShowAllTimeline] = useState(false);
	const [hoveredBarIndex, setHoveredBarIndex] = useState<string | null>(null);

	const knownGroups = ["Chest", "Back", "Legs", "Shoulders", "Arms", "Core"];
	const filters = ["All", ...knownGroups, "Other"];

	// Derive stats from real data
	const totalPRs = records?.length ?? 0;
	const now = new Date();
	const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
	const monthlyPRs =
		records?.filter((r) => r.achieved_at >= startOfMonth).length ?? 0;

	// Apply phase filter before grouping
	const phaseFilteredRecords =
		phaseFilter === "all"
			? (records ?? [])
			: (records ?? []).filter((r) => r.workout_phase === phaseFilter);

	// Group records by exercise for the list view
	const exerciseMap = new Map<string, PersonalRecord[]>();
	for (const record of phaseFilteredRecords) {
		const existing = exerciseMap.get(record.exercise_name) ?? [];
		existing.push(record);
		exerciseMap.set(record.exercise_name, existing);
	}

	const exercisePRs = Array.from(exerciseMap.entries()).map(([name, recs]) => {
		const sorted = [...recs].sort(
			(a, b) => b.achieved_at.getTime() - a.achieved_at.getTime(),
		);
		const latest = sorted[0];
		const daysSinceLastPR = Math.floor(
			(now.getTime() - latest.achieved_at.getTime()) / (1000 * 60 * 60 * 24),
		);
		const trend: "improving" | "stable" | "plateau" =
			daysSinceLastPR < 14
				? "improving"
				: daysSinceLastPR < 42
					? "stable"
					: "plateau";

		return {
			exercise: name,
			muscleGroup: latest.muscle_group,
			currentValue: latest.value,
			recordType: latest.record_type,
			unit: latest.unit,
			lastPRDate: latest.achieved_at,
			trend,
			history: sorted,
		};
	});

	// All PRs sorted by date for the timeline view
	const allPRsSorted = [...(records ?? [])].sort(
		(a, b) => b.achieved_at.getTime() - a.achieved_at.getTime(),
	);
	const timelinePRs = showAllTimeline
		? allPRsSorted
		: allPRsSorted.slice(0, TIMELINE_INITIAL_LIMIT);

	// Recent PRs (top 3 most recent) for the spotlight
	const recentPRs = (records ?? []).slice(0, 3);

	// Most improved exercise (most PRs)
	const mostImproved =
		exercisePRs.length > 0
			? exercisePRs.reduce((best, ex) =>
					ex.history.length > best.history.length ? ex : best,
				).exercise
			: "N/A";

	const toggleExercise = (exercise: string) => {
		setExpandedExercises((prev) =>
			prev.includes(exercise)
				? prev.filter((e) => e !== exercise)
				: [...prev, exercise],
		);
	};

	const getTrendIcon = (trend: string) => {
		switch (trend) {
			case "improving":
				return <ArrowUp className="w-4 h-4 text-success" />;
			case "stable":
				return <ArrowRight className="w-4 h-4 text-muted-foreground" />;
			case "plateau":
				return <AlertTriangle className="w-4 h-4 text-warning" />;
			default:
				return null;
		}
	};

	const getTrendText = (trend: string) => {
		switch (trend) {
			case "improving":
				return "Improving";
			case "stable":
				return "Stable";
			case "plateau":
				return "Plateau";
			default:
				return "";
		}
	};

	const getMuscleGroupColor = (muscleGroup: string) => {
		const colors: Record<string, string> = {
			Chest: "bg-primary",
			Shoulders: "bg-accent",
			Back: "bg-success",
			Legs: "bg-chart-2",
			Arms: "bg-warning",
			Core: "bg-[#8B5CF6]",
		};
		return colors[muscleGroup] || "from-muted to-muted";
	};

	const filteredExercises =
		activeFilter === "All"
			? exercisePRs
			: activeFilter === "Other"
				? exercisePRs.filter((ex) => !knownGroups.includes(ex.muscleGroup))
				: exercisePRs.filter((ex) => ex.muscleGroup === activeFilter);

	const plateauExercises = exercisePRs.filter((ex) => ex.trend === "plateau");

	// Determine which milestones have been achieved
	const achievedMilestones = milestones.filter((m) => totalPRs >= m.count);

	if (isPending) {
		return (
			<div className="min-h-screen pb-24 md:pb-8">
				<div className="bg-gradient-to-b from-surface-2 to-background border-b border-secondary">
					<div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
						<Skeleton className="h-10 w-64 mb-2" />
						<Skeleton className="h-4 w-48" />
						<div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-6">
							{Array.from({ length: 4 }).map((_, i) => (
								<StatCardSkeleton key={i} />
							))}
						</div>
					</div>
				</div>
				<PageShell>
					<Skeleton className="h-8 w-40 mb-4" />
					<div className="space-y-3">
						{Array.from({ length: 4 }).map((_, i) => (
							<CardSkeleton key={i} />
						))}
					</div>
				</PageShell>
			</div>
		);
	}

	if (!records || records.length === 0) {
		return (
			<div className="min-h-screen pb-24 md:pb-8">
				<div className="bg-gradient-to-b from-surface-2 to-background border-b border-secondary">
					<div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
						<div className="flex items-center gap-3 mb-2">
							<Trophy className="w-8 h-8 text-accent" />
							<h1 className="text-3xl sm:text-4xl text-white">
								Personal Records
							</h1>
						</div>
					</div>
				</div>
				<PageShell>
					<EmptyState
						icon={Trophy}
						title="No personal records yet"
						description="Your PRs will appear here as you push your limits. Every new best is worth celebrating."
					/>
				</PageShell>
			</div>
		);
	}

	return (
		<div className="min-h-screen pb-24 md:pb-8">
			{/* Header */}
			<div className="bg-gradient-to-b from-surface-2 to-background border-b border-secondary">
				<div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
					<motion.div
						initial={{ opacity: 0, y: 20 }}
						animate={{ opacity: 1, y: 0 }}
					>
						<div className="flex items-center gap-3 mb-2">
							<Trophy className="w-8 h-8 text-accent" />
							<h1 className="text-3xl sm:text-4xl text-white">
								Personal Records
							</h1>
						</div>
						<p className="text-muted-foreground">Celebrate every victory</p>
					</motion.div>

					{/* Stats Row */}
					<motion.div
						initial={{ opacity: 0, y: 20 }}
						animate={{ opacity: 1, y: 0 }}
						transition={{ delay: 0.1 }}
						className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-6"
					>
						<Card className="p-4 bg-surface-2 border-secondary">
							<div className="flex items-center gap-2 mb-2">
								<Trophy className="w-5 h-5 text-accent" />
								<div className="text-sm text-muted-foreground">Total PRs</div>
							</div>
							<div className="text-2xl font-semibold text-white font-data">
								{totalPRs}
							</div>
						</Card>
						<Card className="p-4 bg-surface-2 border-secondary">
							<div className="flex items-center gap-2 mb-2">
								<TrendingUp className="w-5 h-5 text-success" />
								<div className="text-sm text-muted-foreground">This Month</div>
							</div>
							<div className="text-2xl font-semibold text-white font-data">
								{monthlyPRs}
							</div>
						</Card>
						<Card className="p-4 bg-surface-2 border-secondary">
							<div className="flex items-center gap-2 mb-2">
								<Flame className="w-5 h-5 text-primary" />
								<div className="text-sm text-muted-foreground">
									Exercises Tracked
								</div>
							</div>
							<div className="text-2xl font-semibold text-white font-data">
								{exercisePRs.length}
							</div>
						</Card>
						<Card className="p-4 bg-surface-2 border-secondary">
							<div className="flex items-center gap-2 mb-2">
								<Star className="w-5 h-5 text-warning" />
								<div className="text-sm text-muted-foreground">
									Most Improved
								</div>
							</div>
							<div className="text-lg font-semibold text-white truncate">
								{mostImproved}
							</div>
						</Card>
					</motion.div>
				</div>
			</div>

			{/* Content */}
			<PageShell>
				{/* Recent PRs Spotlight */}
				{recentPRs.length > 0 && (
					<motion.div
						initial={{ opacity: 0, y: 20 }}
						animate={{ opacity: 1, y: 0 }}
						transition={{ delay: 0.2 }}
						className="mb-8"
					>
						<h2 className="text-2xl font-semibold text-white mb-4">
							Recent PRs
						</h2>
						<div className="flex gap-4 overflow-x-auto pb-4 snap-x snap-mandatory">
							{recentPRs.map((pr, index) => {
								const isNew =
									now.getTime() - pr.achieved_at.getTime() <
									7 * 24 * 60 * 60 * 1000;
								return (
									<motion.div
										key={pr.id}
										initial={{ opacity: 0, x: 20 }}
										animate={{ opacity: 1, x: 0 }}
										transition={{ delay: 0.3 + index * 0.1 }}
										className="flex-shrink-0 w-80 snap-start"
									>
										<Card className="p-6 bg-surface-2 border-2 border-primary relative overflow-hidden group transition-transform">
											<div className="absolute inset-0 bg-gradient-to-br from-primary/20 to-accent/20 opacity-50 group-hover:opacity-70 transition-opacity" />
											<div className="relative z-10">
												{isNew && (
													<Badge className="mb-3 bg-accent text-white border-0 animate-pulse">
														NEW
													</Badge>
												)}
												<h3 className="text-xl font-semibold text-white mb-2">
													{pr.exercise_name}
												</h3>
												<Badge
													className={`mb-3 bg-gradient-to-r ${getMuscleGroupColor(pr.muscle_group)} text-white border-0`}
												>
													{pr.muscle_group}
												</Badge>
												<div className="text-3xl font-bold text-primary mb-2 font-data">
													{formatRecordMeasurement(pr.value, pr.unit, unit)}
												</div>
												{pr.previous_value && (
													<div className="text-sm text-muted-foreground mb-3">
														Previous:{" "}
														{formatRecordMeasurement(
															pr.previous_value,
															pr.unit,
															unit,
														)}
													</div>
												)}
												<div className="flex items-center justify-between">
													<div className="flex items-center gap-1.5">
														<Badge
															variant="outline"
															className="border-primary/30 text-primary"
														>
															{formatRecordTypeLabel(pr.record_type)}
														</Badge>
														{pr.workout_phase &&
															pr.workout_phase !== "Combined" && (
																<Badge
																	variant="outline"
																	className="border-accent/40 text-accent text-xs"
																>
																	{pr.workout_phase}
																</Badge>
															)}
													</div>
													<span className="text-xs text-muted-foreground">
														{pr.achieved_at.toLocaleDateString("en-US", {
															month: "short",
															day: "numeric",
														})}
													</span>
												</div>
											</div>
										</Card>
									</motion.div>
								);
							})}
						</div>
					</motion.div>
				)}

				{/* Filter Bar */}
				<motion.div
					initial={{ opacity: 0, y: 20 }}
					animate={{ opacity: 1, y: 0 }}
					transition={{ delay: 0.4 }}
					className="mb-6"
				>
					<div className="flex items-center justify-between mb-4">
						<div className="flex gap-2 overflow-x-auto pb-2">
							{filters.map((filter) => (
								<Button
									key={filter}
									onClick={() => setActiveFilter(filter)}
									size="sm"
									className={
										activeFilter === filter
											? "bg-primary border-0 text-white flex-shrink-0"
											: "bg-secondary border-0 text-muted-foreground hover:bg-muted flex-shrink-0"
									}
								>
									{filter}
								</Button>
							))}
						</div>

						<div className="flex gap-2 ml-4">
							<Button
								size="sm"
								variant="outline"
								onClick={() => setViewMode("list")}
								className={
									viewMode === "list"
										? "border-primary text-primary"
										: "border-secondary text-muted-foreground"
								}
							>
								List
							</Button>
							<Button
								size="sm"
								variant="outline"
								onClick={() => setViewMode("timeline")}
								className={
									viewMode === "timeline"
										? "border-primary text-primary"
										: "border-secondary text-muted-foreground"
								}
							>
								Timeline
							</Button>
						</div>
					</div>

					{/* Phase Filter */}
					<div className="flex gap-2 overflow-x-auto pb-2">
						{phaseFilters.map((phase) => (
							<Button
								key={phase}
								onClick={() => setPhaseFilter(phase)}
								size="sm"
								variant="outline"
								className={
									phaseFilter === phase
										? "border-accent text-accent flex-shrink-0"
										: "border-secondary text-muted-foreground hover:border-accent/50 flex-shrink-0"
								}
							>
								{phase === "all" ? "All Phases" : phase}
							</Button>
						))}
					</div>
				</motion.div>

				{/* Plateau Alerts */}
				{plateauExercises.length > 0 && viewMode === "list" && (
					<motion.div
						initial={{ opacity: 0, y: 20 }}
						animate={{ opacity: 1, y: 0 }}
						transition={{ delay: 0.5 }}
						className="mb-6"
					>
						{plateauExercises.map((exercise) => (
							<Card
								key={exercise.exercise}
								className="p-4 bg-gradient-to-br from-warning/10 to-accent/10 border-2 border-warning/50 mb-3"
							>
								<div className="flex items-start gap-3">
									<AlertTriangle className="w-5 h-5 text-warning flex-shrink-0 mt-0.5" />
									<div className="flex-1">
										<h4 className="text-white font-semibold mb-1">
											Your {exercise.exercise} has plateaued
										</h4>
										<p className="text-sm text-secondary-foreground mb-2">
											No PR in{" "}
											{Math.floor(
												(now.getTime() - exercise.lastPRDate.getTime()) /
													(1000 * 60 * 60 * 24 * 7),
											)}{" "}
											weeks
										</p>
										<p className="text-sm text-muted-foreground">
											Try: Add variation or reduce weight, increase reps
										</p>
									</div>
									<Button
										size="sm"
										variant="outline"
										className="border-warning text-warning hover:bg-warning/10"
									>
										Browse Routines
									</Button>
								</div>
							</Card>
						))}
					</motion.div>
				)}

				{/* Main Content Area */}
				<AnimatePresence mode="wait">
					{viewMode === "list" ? (
						<motion.div
							key="list"
							initial={{ opacity: 0, y: 20 }}
							animate={{ opacity: 1, y: 0 }}
							exit={{ opacity: 0, y: -20 }}
							transition={{ duration: 0.3 }}
							className="space-y-3"
						>
							<h2 className="text-2xl font-semibold text-white mb-4">
								PR List by Exercise
							</h2>
							{filteredExercises.length === 0 ? (
								<div className="text-center py-12 text-muted-foreground">
									<Trophy className="w-12 h-12 mx-auto mb-3 opacity-50" />
									<p>No records for this muscle group yet</p>
								</div>
							) : (
								filteredExercises.map((exercise, index) => (
									<motion.div
										key={exercise.exercise}
										initial={{ opacity: 0, y: 20 }}
										animate={{ opacity: 1, y: 0 }}
										transition={{ delay: index * 0.05 }}
									>
										<Card className="bg-surface-2 border-secondary overflow-hidden">
											<button
												onClick={() => toggleExercise(exercise.exercise)}
												className="w-full p-4 flex items-center justify-between hover:bg-surface-2/50 transition-colors"
											>
												<div className="flex items-center gap-4">
													<div>
														<h3 className="text-lg font-semibold text-white text-left">
															{exercise.exercise}
														</h3>
														<div className="flex items-center gap-2 mt-1">
															<Badge
																className={`${getMuscleGroupColor(exercise.muscleGroup)} text-white border-0 text-xs`}
															>
																{exercise.muscleGroup}
															</Badge>
														</div>
													</div>
												</div>

												<div className="flex items-center gap-4">
													<div className="text-right hidden sm:block">
														<div className="text-lg font-semibold text-white font-data">
															{formatRecordMeasurement(
																exercise.currentValue,
																exercise.unit,
																unit,
															)}
														</div>
														<div className="text-sm text-primary">
															{formatRecordTypeLabel(exercise.recordType)}
														</div>
													</div>
													<div className="flex items-center gap-2">
														{getTrendIcon(exercise.trend)}
														<span className="text-sm text-muted-foreground hidden sm:inline">
															{getTrendText(exercise.trend)}
														</span>
													</div>
													<span className="text-xs text-muted-foreground hidden sm:inline">
														{exercise.lastPRDate.toLocaleDateString("en-US", {
															month: "short",
															day: "numeric",
														})}
													</span>
													{expandedExercises.includes(exercise.exercise) ? (
														<ChevronUp className="w-5 h-5 text-muted-foreground" />
													) : (
														<ChevronDown className="w-5 h-5 text-muted-foreground" />
													)}
												</div>
											</button>

											{expandedExercises.includes(exercise.exercise) && (
												<div className="border-t border-secondary p-4">
													{/* M33: PR Progression bar chart with tooltips */}
													<div className="mb-4 p-4 rounded-lg bg-background border border-secondary">
														<div className="text-sm text-muted-foreground mb-3">
															PR Progression
														</div>
														<div className="h-32 flex items-end justify-between gap-2">
															{[...exercise.history]
																.reverse()
																.map((entry, idx) => {
																	const maxVal = Math.max(
																		...exercise.history.map((h) => h.value),
																	);
																	const height =
																		maxVal > 0
																			? (entry.value / maxVal) * 100
																			: 0;
																	const barKey = `${exercise.exercise}-${idx}`;
																	const isHovered = hoveredBarIndex === barKey;
																	return (
																		<div
																			key={idx}
																			role="group"
																			aria-label={`${entry.value} ${entry.unit} on ${entry.achieved_at.toLocaleDateString()}`}
																			className="flex-1 flex flex-col items-center gap-2 relative"
																			onMouseEnter={() =>
																				setHoveredBarIndex(barKey)
																			}
																			onMouseLeave={() =>
																				setHoveredBarIndex(null)
																			}
																		>
																			{/* Tooltip */}
																			{isHovered && (
																				<div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 z-10 whitespace-nowrap">
																					<div className="bg-surface-2 border border-secondary rounded-lg px-3 py-2 shadow-lg text-center">
																						<div className="text-sm font-semibold text-white font-data">
																							{formatRecordMeasurement(
																								entry.value,
																								entry.unit,
																								unit,
																							)}
																						</div>
																						<div className="text-xs text-muted-foreground">
																							{entry.record_type}
																						</div>
																						<div className="text-xs text-muted-foreground">
																							{entry.achieved_at.toLocaleDateString(
																								"en-US",
																								{
																									month: "short",
																									day: "numeric",
																									year: "numeric",
																								},
																							)}
																						</div>
																					</div>
																				</div>
																			)}
																			{/* Value label on hover */}
																			<div
																				className={`text-xs font-semibold text-primary transition-opacity font-data ${isHovered ? "opacity-100" : "opacity-0"}`}
																			>
																				{entry.value}
																			</div>
																			<div
																				className={`w-full bg-gradient-to-t from-primary to-accent rounded-t transition-all cursor-pointer ${isHovered ? "opacity-100 scale-x-110" : "hover:opacity-80"}`}
																				style={{ height: `${height}%` }}
																			/>
																			<div className="text-xs text-muted-foreground">
																				{entry.achieved_at.toLocaleDateString(
																					"en-US",
																					{
																						month: "short",
																						day: "numeric",
																					},
																				)}
																			</div>
																		</div>
																	);
																})}
														</div>
													</div>

													<div className="overflow-x-auto">
														<table className="w-full text-sm">
															<thead>
																<tr className="border-b border-secondary">
																	<th className="text-left py-2 text-muted-foreground">
																		Date
																	</th>
																	<th className="text-left py-2 text-muted-foreground">
																		Value
																	</th>
																	<th className="text-left py-2 text-muted-foreground">
																		Type
																	</th>
																	<th className="text-left py-2 text-muted-foreground">
																		Phase
																	</th>
																</tr>
															</thead>
															<tbody>
																{exercise.history.map((entry, idx) => (
																	<tr
																		key={idx}
																		className="border-b border-secondary/50"
																	>
																		<td className="py-3 text-secondary-foreground">
																			{entry.achieved_at.toLocaleDateString(
																				"en-US",
																				{
																					month: "short",
																					day: "numeric",
																					year: "numeric",
																				},
																			)}
																		</td>
																		<td className="py-3 text-white font-semibold font-data">
																			{formatRecordMeasurement(
																				entry.value,
																				entry.unit,
																				unit,
																			)}
																		</td>
																		<td className="py-3">
																			<Badge
																				variant="outline"
																				className="border-primary/30 text-primary"
																			>
																				{formatRecordTypeLabel(
																					entry.record_type,
																				)}
																			</Badge>
																		</td>
																		<td className="py-3">
																			{entry.workout_phase &&
																			entry.workout_phase !== "Combined" ? (
																				<Badge
																					variant="outline"
																					className="border-accent/40 text-accent text-xs"
																				>
																					{entry.workout_phase}
																				</Badge>
																			) : (
																				<span className="text-muted-foreground text-xs">
																					Combined
																				</span>
																			)}
																		</td>
																	</tr>
																))}
															</tbody>
														</table>
													</div>
												</div>
											)}
										</Card>
									</motion.div>
								))
							)}
						</motion.div>
					) : (
						<motion.div
							key="timeline"
							initial={{ opacity: 0, y: 20 }}
							animate={{ opacity: 1, y: 0 }}
							exit={{ opacity: 0, y: -20 }}
							transition={{ duration: 0.3 }}
						>
							<h2 className="text-2xl font-semibold text-white mb-6">
								PR Timeline
							</h2>

							<div className="relative">
								<div className="absolute left-8 top-0 bottom-0 w-0.5 bg-gradient-to-b from-primary via-chart-2 to-accent" />

								<div className="space-y-8">
									{/* Achieved milestones */}
									{achievedMilestones.map((milestone, index) => (
										<motion.div
											key={milestone.id}
											initial={{ opacity: 0, x: -20 }}
											animate={{ opacity: 1, x: 0 }}
											transition={{ delay: index * 0.1 }}
											className="relative pl-20"
										>
											<div className="absolute left-4 w-8 h-8 rounded-full bg-accent flex items-center justify-center border-4 border-background">
												<milestone.icon className="w-4 h-4 text-white" />
											</div>
											<Card className="p-4 bg-gradient-to-br from-accent/20 to-warning/20 border-2 border-accent/50">
												<div className="flex items-center justify-between">
													<div>
														<h3 className="text-lg font-semibold text-white mb-1">
															{milestone.name}
														</h3>
														<p className="text-sm text-secondary-foreground">
															Milestone achieved! {milestone.count} personal
															records
														</p>
													</div>
												</div>
											</Card>
										</motion.div>
									))}

									{/* PRs in Timeline (M32: show all or limited) */}
									{timelinePRs.map((pr, index) => (
										<motion.div
											key={pr.id}
											initial={{ opacity: 0, x: -20 }}
											animate={{ opacity: 1, x: 0 }}
											transition={{
												delay: (achievedMilestones.length + index) * 0.1,
											}}
											className="relative pl-20"
										>
											<div className="absolute left-5 w-6 h-6 rounded-full bg-primary border-4 border-background" />
											<Card className="p-4 bg-surface-2 border-secondary hover:border-primary/50 transition-all">
												<div className="flex items-center justify-between">
													<div>
														<div className="flex items-center gap-2 mb-1">
															<h3 className="text-lg font-semibold text-white">
																{pr.exercise_name}
															</h3>
															<Badge
																className={`${getMuscleGroupColor(pr.muscle_group)} text-white border-0 text-xs`}
															>
																{pr.muscle_group}
															</Badge>
															{pr.workout_phase &&
																pr.workout_phase !== "Combined" && (
																	<Badge
																		variant="outline"
																		className="border-accent/40 text-accent text-xs"
																	>
																		{pr.workout_phase}
																	</Badge>
																)}
														</div>
														<p className="text-xl font-bold text-primary font-data">
															{formatRecordMeasurement(pr.value, pr.unit, unit)}
														</p>
													</div>
													<div className="text-right">
														<Badge
															variant="outline"
															className="border-primary/30 text-primary mb-2"
														>
															{formatRecordTypeLabel(pr.record_type)}
														</Badge>
														<div className="text-xs text-muted-foreground">
															{pr.achieved_at.toLocaleDateString("en-US", {
																month: "short",
																day: "numeric",
																year: "numeric",
															})}
														</div>
													</div>
												</div>
											</Card>
										</motion.div>
									))}
								</div>
							</div>

							{/* M32: "See all" / "Show less" toggle */}
							{allPRsSorted.length > TIMELINE_INITIAL_LIMIT && (
								<div className="text-center mt-8">
									<Button
										variant="outline"
										onClick={() => setShowAllTimeline((prev) => !prev)}
										className="border-secondary text-muted-foreground hover:border-primary hover:text-primary"
									>
										{showAllTimeline
											? "Show less"
											: `See all ${allPRsSorted.length} PRs`}
									</Button>
								</div>
							)}
						</motion.div>
					)}
				</AnimatePresence>
			</PageShell>
		</div>
	);
}
