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
import { Badge } from "@/app/components/ui/badge";
import { Button } from "@/app/components/ui/button";
import { Card } from "@/app/components/ui/card";
import {
	CardSkeleton,
	Skeleton,
	StatCardSkeleton,
} from "@/app/components/ui/skeleton";
import { useAuth } from "@/app/hooks/useAuth";
import { personalRecordsOptions } from "@/queries/records";
import type { PersonalRecord } from "@/schemas/transforms";

// Milestones are motivational UI content, not user data
const milestones = [
	{ id: "1", count: 100, name: "100th PR", icon: Crown },
	{ id: "2", count: 50, name: "50th PR", icon: Trophy },
	{ id: "3", count: 25, name: "25th PR", icon: Award },
	{ id: "4", count: 10, name: "10th PR", icon: Flame },
];

export function PersonalRecords() {
	const { user } = useAuth();
	const { data: records, isPending } = useQuery(
		personalRecordsOptions(user?.id),
	);

	const [activeFilter, setActiveFilter] = useState("All");
	const [viewMode, setViewMode] = useState<"list" | "timeline">("list");
	const [expandedExercises, setExpandedExercises] = useState<string[]>([]);

	const filters = ["All", "Chest", "Back", "Legs", "Shoulders", "Arms", "Core"];

	// Derive stats from real data
	const totalPRs = records?.length ?? 0;
	const now = new Date();
	const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
	const monthlyPRs =
		records?.filter((r) => r.achieved_at >= startOfMonth).length ?? 0;

	// Group records by exercise for the list view
	const exerciseMap = new Map<string, PersonalRecord[]>();
	for (const record of records ?? []) {
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

	// Recent PRs (top 3 most recent)
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
			Chest: "from-primary to-chart-2",
			Shoulders: "from-accent to-warning",
			Back: "from-success to-[#059669]",
			Legs: "from-chart-2 to-[#991B1B]",
			Arms: "from-warning to-accent",
			Core: "from-[#8B5CF6] to-[#7C3AED]",
		};
		return colors[muscleGroup] || "from-muted to-muted";
	};

	const filteredExercises =
		activeFilter === "All"
			? exercisePRs
			: exercisePRs.filter((ex) => ex.muscleGroup === activeFilter);

	const plateauExercises = exercisePRs.filter((ex) => ex.trend === "plateau");

	// Determine which milestones have been achieved
	const achievedMilestones = milestones.filter((m) => totalPRs >= m.count);

	if (isPending) {
		return (
			<div className="min-h-screen bg-background pb-24 md:pb-8">
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
				<div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
					<Skeleton className="h-8 w-40 mb-4" />
					<div className="space-y-3">
						{Array.from({ length: 4 }).map((_, i) => (
							<CardSkeleton key={i} />
						))}
					</div>
				</div>
			</div>
		);
	}

	if (!records || records.length === 0) {
		return (
			<div className="min-h-screen bg-background pb-24 md:pb-8">
				<div className="bg-gradient-to-b from-surface-2 to-background border-b border-secondary">
					<div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
						<div className="flex items-center gap-3 mb-2">
							<Trophy className="w-8 h-8 text-accent" />
							<h1 className="text-3xl sm:text-4xl">
								<span className="bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
									Personal Records
								</span>
							</h1>
						</div>
					</div>
				</div>
				<div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 text-center">
					<div className="w-24 h-24 mx-auto mb-6 rounded-full bg-gradient-to-br from-accent/20 to-warning/20 flex items-center justify-center">
						<Trophy className="w-12 h-12 text-accent" />
					</div>
					<h3 className="text-2xl font-semibold text-white mb-2">
						No personal records yet
					</h3>
					<p className="text-muted-foreground max-w-md mx-auto">
						Complete workouts to start tracking your personal records. Every new
						best is a victory!
					</p>
				</div>
			</div>
		);
	}

	return (
		<div className="min-h-screen bg-background pb-24 md:pb-8">
			{/* Header */}
			<div className="bg-gradient-to-b from-surface-2 to-background border-b border-secondary">
				<div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
					<motion.div
						initial={{ opacity: 0, y: 20 }}
						animate={{ opacity: 1, y: 0 }}
					>
						<div className="flex items-center gap-3 mb-2">
							<Trophy className="w-8 h-8 text-accent" />
							<h1 className="text-3xl sm:text-4xl">
								<span className="bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
									Personal Records
								</span>
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
						<Card className="p-4 bg-gradient-to-br from-surface-2 to-background border-secondary">
							<div className="flex items-center gap-2 mb-2">
								<Trophy className="w-5 h-5 text-accent" />
								<div className="text-sm text-muted-foreground">Total PRs</div>
							</div>
							<div className="text-2xl font-semibold text-white">
								{totalPRs}
							</div>
						</Card>
						<Card className="p-4 bg-gradient-to-br from-surface-2 to-background border-secondary">
							<div className="flex items-center gap-2 mb-2">
								<TrendingUp className="w-5 h-5 text-success" />
								<div className="text-sm text-muted-foreground">This Month</div>
							</div>
							<div className="text-2xl font-semibold text-white">
								{monthlyPRs}
							</div>
						</Card>
						<Card className="p-4 bg-gradient-to-br from-surface-2 to-background border-secondary">
							<div className="flex items-center gap-2 mb-2">
								<Flame className="w-5 h-5 text-primary" />
								<div className="text-sm text-muted-foreground">Exercises Tracked</div>
							</div>
							<div className="text-2xl font-semibold text-white">
								{exercisePRs.length}
							</div>
						</Card>
						<Card className="p-4 bg-gradient-to-br from-surface-2 to-background border-secondary">
							<div className="flex items-center gap-2 mb-2">
								<Star className="w-5 h-5 text-warning" />
								<div className="text-sm text-muted-foreground">Most Improved</div>
							</div>
							<div className="text-lg font-semibold text-white truncate">
								{mostImproved}
							</div>
						</Card>
					</motion.div>
				</div>
			</div>

			{/* Content */}
			<div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
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
										<Card className="p-6 bg-gradient-to-br from-surface-2 to-background border-2 border-primary relative overflow-hidden group hover:scale-105 transition-transform">
											<div className="absolute inset-0 bg-gradient-to-br from-primary/20 to-accent/20 opacity-50 group-hover:opacity-70 transition-opacity" />
											<div className="relative z-10">
												{isNew && (
													<Badge className="mb-3 bg-gradient-to-r from-accent to-warning text-white border-0 animate-pulse">
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
												<div className="text-3xl font-bold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent mb-2">
													{pr.value} {pr.unit}
												</div>
												{pr.previous_value && (
													<div className="text-sm text-muted-foreground mb-3">
														Previous: {pr.previous_value} {pr.unit}
													</div>
												)}
												<div className="flex items-center justify-between">
													<Badge
														variant="outline"
														className="border-primary/30 text-primary"
													>
														{pr.record_type}
													</Badge>
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
											? "bg-gradient-to-r from-primary to-chart-2 border-0 text-white flex-shrink-0"
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
								<div className="text-center py-12 text-muted">
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
										<Card className="bg-gradient-to-br from-surface-2 to-background border-secondary overflow-hidden">
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
																className={`bg-gradient-to-r ${getMuscleGroupColor(exercise.muscleGroup)} text-white border-0 text-xs`}
															>
																{exercise.muscleGroup}
															</Badge>
														</div>
													</div>
												</div>

												<div className="flex items-center gap-4">
													<div className="text-right hidden sm:block">
														<div className="text-lg font-semibold text-white">
															{exercise.currentValue} {exercise.unit}
														</div>
														<div className="text-sm text-muted-foreground">
															{exercise.recordType}
														</div>
													</div>
													<div className="flex items-center gap-2">
														{getTrendIcon(exercise.trend)}
														<span className="text-sm text-muted-foreground hidden sm:inline">
															{getTrendText(exercise.trend)}
														</span>
													</div>
													<span className="text-xs text-muted hidden sm:inline">
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
													<div className="mb-4 p-4 rounded-lg bg-background border border-secondary">
														<div className="text-sm text-muted-foreground mb-3">
															PR Progression
														</div>
														<div className="h-32 flex items-end justify-between gap-2">
															{exercise.history.map((entry, idx) => {
																const maxVal = Math.max(
																	...exercise.history.map((h) => h.value),
																);
																const height =
																	maxVal > 0 ? (entry.value / maxVal) * 100 : 0;
																return (
																	<div
																		key={idx}
																		className="flex-1 flex flex-col items-center gap-2"
																	>
																		<div
																			className="w-full bg-gradient-to-t from-primary to-accent rounded-t transition-all hover:opacity-80"
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
																		<td className="py-3 text-white font-semibold">
																			{entry.value} {entry.unit}
																		</td>
																		<td className="py-3">
																			<Badge
																				variant="outline"
																				className="border-secondary text-muted-foreground"
																			>
																				{entry.record_type}
																			</Badge>
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
											<div className="absolute left-4 w-8 h-8 rounded-full bg-gradient-to-br from-accent to-warning flex items-center justify-center border-4 border-background">
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

									{/* Recent PRs in Timeline */}
									{recentPRs.map((pr, index) => (
										<motion.div
											key={pr.id}
											initial={{ opacity: 0, x: -20 }}
											animate={{ opacity: 1, x: 0 }}
											transition={{
												delay: (achievedMilestones.length + index) * 0.1,
											}}
											className="relative pl-20"
										>
											<div className="absolute left-5 w-6 h-6 rounded-full bg-gradient-to-br from-primary to-chart-2 border-4 border-background" />
											<Card className="p-4 bg-gradient-to-br from-surface-2 to-background border-secondary hover:border-primary/50 transition-all">
												<div className="flex items-center justify-between">
													<div>
														<div className="flex items-center gap-2 mb-1">
															<h3 className="text-lg font-semibold text-white">
																{pr.exercise_name}
															</h3>
															<Badge
																className={`bg-gradient-to-r ${getMuscleGroupColor(pr.muscle_group)} text-white border-0 text-xs`}
															>
																{pr.muscle_group}
															</Badge>
														</div>
														<p className="text-xl font-bold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
															{pr.value} {pr.unit}
														</p>
													</div>
													<div className="text-right">
														<Badge
															variant="outline"
															className="border-primary/30 text-primary mb-2"
														>
															{pr.record_type}
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
						</motion.div>
					)}
				</AnimatePresence>
			</div>
		</div>
	);
}
