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
	Trophy,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { Badge } from "@/app/components/ui/badge";
import { Button } from "@/app/components/ui/button";
import { Card } from "@/app/components/ui/card";
import { EmptyState } from "@/app/components/ui/empty-state";
import { CardSkeleton, Skeleton } from "@/app/components/ui/skeleton";
import { useAuth } from "@/app/hooks/useAuth";
import { convertWeight, type WeightUnit } from "@/lib/units";
import { personalRecordsOptions } from "@/queries/records";
import type { PersonalRecord } from "@/schemas/transforms";
import { useProfileFilterStore } from "@/stores/useProfileFilterStore";

// Milestones sorted ascending (chronological achievement order)
const milestones = [
	{ id: "4", count: 10, name: "10th PR", icon: Flame },
	{ id: "3", count: 25, name: "25th PR", icon: Award },
	{ id: "2", count: 50, name: "50th PR", icon: Trophy },
	{ id: "1", count: 100, name: "100th PR", icon: Crown },
];

const TIMELINE_INITIAL_LIMIT = 5;

const phaseFilters = ["all", "Combined", "Concentric", "Eccentric"] as const;
type PhaseFilter = (typeof phaseFilters)[number];

const knownGroups = ["Chest", "Back", "Legs", "Shoulders", "Arms", "Core"];

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

function getMuscleGroupColor(muscleGroup: string): string {
	const colors: Record<string, string> = {
		Chest: "bg-primary",
		Shoulders: "bg-accent",
		Back: "bg-success",
		Legs: "bg-chart-2",
		Arms: "bg-warning",
		Core: "bg-[#8B5CF6]",
	};
	return colors[muscleGroup] ?? "bg-muted";
}

interface ExercisePR {
	exercise: string;
	muscleGroup: string;
	currentValue: number;
	recordType: string;
	unit: string;
	lastPRDate: Date;
	trend: "improving" | "stable" | "plateau";
	history: PersonalRecord[];
}

function getTrendIcon(trend: string) {
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
}

function getTrendText(trend: string): string {
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
}

interface RecordsTabProps {
	unit: WeightUnit;
}

export default function RecordsTab({ unit }: RecordsTabProps) {
	const { user } = useAuth();
	const userId = user?.id ?? "";
	const activeProfileId = useProfileFilterStore((s) => s.activeProfileId);

	const { data: records, isPending } = useQuery({
		...personalRecordsOptions(userId, activeProfileId),
		enabled: !!userId,
	});

	const [activeFilter, setActiveFilter] = useState("All");
	const [phaseFilter, setPhaseFilter] = useState<PhaseFilter>("all");
	const [viewMode, setViewMode] = useState<"grouped" | "timeline">("grouped");
	const [expandedExercises, setExpandedExercises] = useState<string[]>([]);
	const [showAllTimeline, setShowAllTimeline] = useState(false);
	const [hoveredBarIndex, setHoveredBarIndex] = useState<string | null>(null);

	const filters = ["All", ...knownGroups, "Other"];
	const now = new Date();

	// Apply phase filter
	const phaseFiltered =
		phaseFilter === "all"
			? (records ?? [])
			: (records ?? []).filter((r) => r.workout_phase === phaseFilter);

	// Group by exercise
	const exerciseMap = new Map<string, PersonalRecord[]>();
	for (const record of phaseFiltered) {
		const existing = exerciseMap.get(record.exercise_name) ?? [];
		existing.push(record);
		exerciseMap.set(record.exercise_name, existing);
	}

	const exercisePRs: ExercisePR[] = Array.from(exerciseMap.entries()).map(
		([name, recs]) => {
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
		},
	);

	const filteredExercises =
		activeFilter === "All"
			? exercisePRs
			: activeFilter === "Other"
				? exercisePRs.filter((ex) => !knownGroups.includes(ex.muscleGroup))
				: exercisePRs.filter((ex) => ex.muscleGroup === activeFilter);

	// Timeline — all records sorted by date
	const allPRsSorted = [...(records ?? [])].sort(
		(a, b) => b.achieved_at.getTime() - a.achieved_at.getTime(),
	);
	const timelinePRs = showAllTimeline
		? allPRsSorted
		: allPRsSorted.slice(0, TIMELINE_INITIAL_LIMIT);

	const totalPRs = records?.length ?? 0;
	const achievedMilestones = milestones.filter((m) => totalPRs >= m.count);

	const toggleExercise = (exercise: string) => {
		setExpandedExercises((prev) =>
			prev.includes(exercise)
				? prev.filter((e) => e !== exercise)
				: [...prev, exercise],
		);
	};

	// --- Loading state ---
	if (isPending) {
		return (
			<div className="space-y-4">
				<div className="flex gap-2">
					{Array.from({ length: 4 }).map((_, i) => (
						<Skeleton key={i} className="h-8 w-20" />
					))}
				</div>
				<div className="space-y-3">
					{Array.from({ length: 5 }).map((_, i) => (
						<CardSkeleton key={i} />
					))}
				</div>
			</div>
		);
	}

	// --- Empty state ---
	if (!records || records.length === 0) {
		return (
			<EmptyState
				icon={Trophy}
				title="No personal records yet"
				description="Your PRs will appear here as you push your limits. Every new best is worth celebrating."
			/>
		);
	}

	return (
		<div className="space-y-6">
			{/* Filter bar */}
			<motion.div
				initial={{ opacity: 0, y: 16 }}
				animate={{ opacity: 1, y: 0 }}
				transition={{ duration: 0.25 }}
			>
				{/* Muscle group + view toggle row */}
				<div className="flex items-center justify-between gap-4 mb-3 flex-wrap">
					<div className="flex gap-2 overflow-x-auto pb-1 flex-wrap">
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

					<div className="flex gap-2 flex-shrink-0">
						<Button
							size="sm"
							variant="outline"
							onClick={() => setViewMode("grouped")}
							className={
								viewMode === "grouped"
									? "border-primary text-primary"
									: "border-secondary text-muted-foreground"
							}
						>
							By Exercise
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

				{/* Phase filter row */}
				<div className="flex gap-2 overflow-x-auto pb-1 flex-wrap">
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

			{/* Summary stats row */}
			<motion.div
				initial={{ opacity: 0, y: 16 }}
				animate={{ opacity: 1, y: 0 }}
				transition={{ duration: 0.25, delay: 0.05 }}
				className="grid grid-cols-3 gap-4"
			>
				<Card className="p-4 bg-surface-2 border-secondary">
					<div className="flex items-center gap-2 mb-1">
						<Trophy className="w-4 h-4 text-accent" />
						<span className="text-xs text-muted-foreground">Total PRs</span>
					</div>
					<div className="text-2xl font-semibold text-white font-data">
						{totalPRs}
					</div>
				</Card>
				<Card className="p-4 bg-surface-2 border-secondary">
					<div className="flex items-center gap-2 mb-1">
						<Flame className="w-4 h-4 text-primary" />
						<span className="text-xs text-muted-foreground">Exercises</span>
					</div>
					<div className="text-2xl font-semibold text-white font-data">
						{exercisePRs.length}
					</div>
				</Card>
				<Card className="p-4 bg-surface-2 border-secondary">
					<div className="flex items-center gap-2 mb-1">
						<Star className="w-4 h-4 text-warning" />
						<span className="text-xs text-muted-foreground">This Month</span>
					</div>
					<div className="text-2xl font-semibold text-white font-data">
						{
							(records ?? []).filter(
								(r) =>
									r.achieved_at >=
									new Date(now.getFullYear(), now.getMonth(), 1),
							).length
						}
					</div>
				</Card>
			</motion.div>

			{/* Main content */}
			<AnimatePresence mode="wait">
				{viewMode === "grouped" ? (
					<motion.div
						key="grouped"
						initial={{ opacity: 0, y: 16 }}
						animate={{ opacity: 1, y: 0 }}
						exit={{ opacity: 0, y: -16 }}
						transition={{ duration: 0.25 }}
						className="space-y-3"
					>
						{filteredExercises.length === 0 ? (
							<div className="text-center py-10 text-muted-foreground">
								<Trophy className="w-10 h-10 mx-auto mb-3 opacity-40" />
								<p>No records for this filter</p>
							</div>
						) : (
							filteredExercises.map((exercise, index) => (
								<motion.div
									key={exercise.exercise}
									initial={{ opacity: 0, y: 16 }}
									animate={{ opacity: 1, y: 0 }}
									transition={{ delay: index * 0.04 }}
								>
									<Card className="bg-surface-2 border-secondary overflow-hidden">
										<button
											type="button"
											onClick={() => toggleExercise(exercise.exercise)}
											className="w-full p-4 flex items-center justify-between hover:bg-surface-2/50 transition-colors"
										>
											<div className="flex items-center gap-3">
												<div className="text-left">
													<h3 className="text-base font-semibold text-white">
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

											<div className="flex items-center gap-3">
												<div className="text-right hidden sm:block">
													<div className="text-base font-semibold text-white font-data">
														{formatRecordMeasurement(
															exercise.currentValue,
															exercise.unit,
															unit,
														)}
													</div>
													<div className="text-xs text-primary">
														{formatRecordTypeLabel(exercise.recordType)}
													</div>
												</div>
												<div className="flex items-center gap-1.5">
													{getTrendIcon(exercise.trend)}
													<span className="text-xs text-muted-foreground hidden sm:inline">
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
													<ChevronUp className="w-4 h-4 text-muted-foreground flex-shrink-0" />
												) : (
													<ChevronDown className="w-4 h-4 text-muted-foreground flex-shrink-0" />
												)}
											</div>
										</button>

										{expandedExercises.includes(exercise.exercise) && (
											<div className="border-t border-secondary p-4">
												{/* PR Progression bar chart */}
												<div className="mb-4 p-3 rounded-lg bg-background border border-secondary">
													<div className="text-xs text-muted-foreground mb-3">
														PR Progression
													</div>
													<div className="h-28 flex items-end justify-between gap-1.5">
														{[...exercise.history]
															.reverse()
															.map((entry, idx) => {
																const maxVal = Math.max(
																	...exercise.history.map((h) => h.value),
																);
																const height =
																	maxVal > 0 ? (entry.value / maxVal) * 100 : 0;
																const barKey = `${exercise.exercise}-${idx}`;
																const isHovered = hoveredBarIndex === barKey;
																return (
																	<div
																		key={barKey}
																		role="group"
																		aria-label={`${entry.value} ${entry.unit} on ${entry.achieved_at.toLocaleDateString()}`}
																		className="flex-1 flex flex-col items-center gap-1 relative"
																		onMouseEnter={() =>
																			setHoveredBarIndex(barKey)
																		}
																		onMouseLeave={() =>
																			setHoveredBarIndex(null)
																		}
																	>
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
																						{formatRecordTypeLabel(
																							entry.record_type,
																						)}
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

												{/* History table */}
												<div className="overflow-x-auto">
													<table className="w-full text-sm">
														<thead>
															<tr className="border-b border-secondary">
																<th className="text-left py-2 text-muted-foreground font-normal">
																	Date
																</th>
																<th className="text-left py-2 text-muted-foreground font-normal">
																	Value
																</th>
																<th className="text-left py-2 text-muted-foreground font-normal">
																	Type
																</th>
																<th className="text-left py-2 text-muted-foreground font-normal">
																	Phase
																</th>
															</tr>
														</thead>
														<tbody>
															{exercise.history.map((entry, idx) => (
																<tr
																	key={`${entry.id}-${idx}`}
																	className="border-b border-secondary/50"
																>
																	<td className="py-2.5 text-secondary-foreground">
																		{entry.achieved_at.toLocaleDateString(
																			"en-US",
																			{
																				month: "short",
																				day: "numeric",
																				year: "numeric",
																			},
																		)}
																	</td>
																	<td className="py-2.5 text-white font-semibold font-data">
																		{formatRecordMeasurement(
																			entry.value,
																			entry.unit,
																			unit,
																		)}
																	</td>
																	<td className="py-2.5">
																		<Badge
																			variant="outline"
																			className="border-primary/30 text-primary"
																		>
																			{formatRecordTypeLabel(entry.record_type)}
																		</Badge>
																	</td>
																	<td className="py-2.5">
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
						initial={{ opacity: 0, y: 16 }}
						animate={{ opacity: 1, y: 0 }}
						exit={{ opacity: 0, y: -16 }}
						transition={{ duration: 0.25 }}
					>
						<div className="relative">
							<div className="absolute left-8 top-0 bottom-0 w-0.5 bg-gradient-to-b from-primary via-chart-2 to-accent" />

							<div className="space-y-6">
								{/* Achieved milestone markers */}
								{achievedMilestones.map((milestone, index) => (
									<motion.div
										key={milestone.id}
										initial={{ opacity: 0, x: -16 }}
										animate={{ opacity: 1, x: 0 }}
										transition={{ delay: index * 0.08 }}
										className="relative pl-20"
									>
										<div className="absolute left-4 w-8 h-8 rounded-full bg-accent flex items-center justify-center border-4 border-background">
											<milestone.icon className="w-4 h-4 text-white" />
										</div>
										<Card className="p-4 bg-gradient-to-br from-accent/20 to-warning/20 border-2 border-accent/50">
											<h3 className="text-base font-semibold text-white">
												{milestone.name}
											</h3>
											<p className="text-sm text-secondary-foreground">
												Milestone — {milestone.count} personal records
											</p>
										</Card>
									</motion.div>
								))}

								{/* PR entries */}
								{timelinePRs.map((pr, index) => (
									<motion.div
										key={pr.id}
										initial={{ opacity: 0, x: -16 }}
										animate={{ opacity: 1, x: 0 }}
										transition={{
											delay: (achievedMilestones.length + index) * 0.06,
										}}
										className="relative pl-20"
									>
										<div className="absolute left-5 w-6 h-6 rounded-full bg-primary border-4 border-background" />
										<Card className="p-4 bg-surface-2 border-secondary hover:border-primary/50 transition-all">
											<div className="flex items-center justify-between gap-2">
												<div className="min-w-0">
													<div className="flex items-center gap-2 mb-1 flex-wrap">
														<h3 className="text-base font-semibold text-white truncate">
															{pr.exercise_name}
														</h3>
														<Badge
															className={`${getMuscleGroupColor(pr.muscle_group)} text-white border-0 text-xs flex-shrink-0`}
														>
															{pr.muscle_group}
														</Badge>
														{pr.workout_phase &&
															pr.workout_phase !== "Combined" && (
																<Badge
																	variant="outline"
																	className="border-accent/40 text-accent text-xs flex-shrink-0"
																>
																	{pr.workout_phase}
																</Badge>
															)}
													</div>
													<p className="text-xl font-bold text-primary font-data">
														{formatRecordMeasurement(pr.value, pr.unit, unit)}
													</p>
												</div>
												<div className="text-right flex-shrink-0">
													<Badge
														variant="outline"
														className="border-primary/30 text-primary mb-1 block"
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
		</div>
	);
}
