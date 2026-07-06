import { useQuery } from "@tanstack/react-query";
import {
	Archive,
	Award,
	Check,
	ChevronDown,
	ChevronsUpDown,
	ChevronUp,
	Edit2,
	Plus,
	RotateCcw,
	Target,
	TrendingUp,
} from "lucide-react";
import { motion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FeatureHint } from "@/app/components/FeatureHint";
import { Button } from "@/app/components/ui/button";
import { Card } from "@/app/components/ui/card";
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from "@/app/components/ui/command";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from "@/app/components/ui/dialog";
import { EmptyState } from "@/app/components/ui/empty-state";
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/app/components/ui/popover";
import {
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from "@/app/components/ui/tabs";
import { cn } from "@/app/components/ui/utils";
import { useAuth } from "@/app/hooks/useAuth";
import { usePreferredWeightUnit } from "@/app/hooks/usePreferredWeightUnit";
import { useSubscription } from "@/hooks/useSubscription";
import {
	formatVolume,
	formatWeight,
	type WeightUnit,
	weightInputToKg,
	weightInputValue,
} from "@/lib/units";
import {
	useArchiveGoal,
	useCreateGoal,
	useUpdateGoal,
} from "@/mutations/goals";
import { goalsOptions } from "@/queries/goals";
import { personalRecordsOptions } from "@/queries/records";
import { workoutListOptions } from "@/queries/workouts";
import type { Goal } from "@/schemas/goals";
import { useProfileFilterStore } from "@/stores/useProfileFilterStore";
import { GoalProgressRing } from "./GoalProgressRing";

// ---------- Progress computation hook (exported for Dashboard widget) ----------

export function useGoalProgress(
	profileId?: string | null,
): Map<string, number> {
	const { user } = useAuth();
	const { data: goals } = useQuery(goalsOptions(user?.id ?? ""));
	const { data: workouts } = useQuery(
		workoutListOptions(user?.id ?? "", profileId),
	);
	const { data: records } = useQuery(
		personalRecordsOptions(user?.id ?? "", profileId),
	);

	return useMemo(() => {
		const map = new Map<string, number>();
		if (!goals) return map;

		const now = new Date();
		const activeGoals = goals.filter((g) => g.status === "active");

		for (const goal of activeGoals) {
			let progress = 0;

			if (goal.goal_type === "frequency" && workouts) {
				const periodStart = getPeriodStart(now, goal.period);
				const workoutsInPeriod = workouts.filter(
					(w) => w.started_at >= periodStart,
				);
				// Count distinct workout days
				const distinctDays = new Set(
					workoutsInPeriod.map((w) => w.started_at.toDateString()),
				);
				progress = (distinctDays.size / goal.target_value) * 100;
			} else if (goal.goal_type === "volume" && workouts) {
				const periodStart = getPeriodStart(now, goal.period);
				const workoutsInPeriod = workouts.filter(
					(w) => w.started_at >= periodStart,
				);
				// total_volume is per-cable kg from the DB; the Phase 4 fix removed the portal-side doubling
				const totalVolume = workoutsInPeriod.reduce(
					(sum, w) => sum + w.total_volume,
					0,
				);
				progress = (totalVolume / goal.target_value) * 100;
			} else if (goal.goal_type === "pr" && records && goal.exercise_name) {
				// Goals do not persist a target phase yet, so any combined,
				// concentric, or eccentric PR for the exercise can satisfy the target.
				// PR values are already Zod-transformed (doubled).
				const exercisePRs = records.filter((r) => {
					// Prefer exercise_id match if both sides have it
					if (goal.exercise_id && r.exercise_id) {
						return r.exercise_id === goal.exercise_id;
					}
					// Fall back to case-insensitive name match
					return (
						r.exercise_name.toLowerCase() === goal.exercise_name?.toLowerCase()
					);
				});
				if (exercisePRs.length > 0) {
					const bestPR = Math.max(...exercisePRs.map((r) => r.value));
					progress = (bestPR / goal.target_value) * 100;
				}
			}

			map.set(goal.id, Math.min(progress, 100));
		}

		return map;
	}, [goals, workouts, records]);
}

function getPeriodStart(now: Date, period: string): Date {
	const start = new Date(now);
	if (period === "monthly") {
		start.setDate(1);
		start.setHours(0, 0, 0, 0);
	} else {
		// weekly: start of current week (Monday)
		const day = start.getDay();
		const diff = day === 0 ? 6 : day - 1; // Monday = 0
		start.setDate(start.getDate() - diff);
		start.setHours(0, 0, 0, 0);
	}
	return start;
}

// ---------- Goal type labels ----------

const goalTypeIcons = {
	frequency: Target,
	volume: TrendingUp,
	pr: Award,
};

function getGoalDescription(goal: Goal, unit: WeightUnit): string {
	switch (goal.goal_type) {
		case "frequency":
			return `${goal.target_value} workouts per ${goal.period === "monthly" ? "month" : "week"}`;
		case "volume":
			return `${formatVolume(goal.target_value, unit)} per ${goal.period === "monthly" ? "month" : "week"}`;
		case "pr":
			return `${goal.exercise_name}: ${formatWeight(goal.target_value, unit)}`;
		default:
			return "Goal";
	}
}

function getProgressText(
	goal: Goal,
	progress: number,
	unit: WeightUnit,
): string {
	const achieved = Math.round((progress / 100) * goal.target_value);
	switch (goal.goal_type) {
		case "frequency":
			return `${achieved}/${goal.target_value} workouts this ${goal.period === "monthly" ? "month" : "week"}`;
		case "volume":
			return `${formatVolume(achieved, unit)}/${formatVolume(goal.target_value, unit)} this ${goal.period === "monthly" ? "month" : "week"}`;
		case "pr":
			return progress >= 100
				? "Target reached!"
				: `${Math.round(progress)}% of target`;
		default:
			return `${Math.round(progress)}%`;
	}
}

// ---------- Exercise Name Combobox (M26) ----------

function ExerciseNameCombobox({
	value,
	onChange,
	exerciseNames,
}: {
	value: string;
	onChange: (value: string) => void;
	exerciseNames: string[];
}) {
	const [open, setOpen] = useState(false);

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<Button
					variant="outline"
					role="combobox"
					aria-expanded={open}
					className={cn(
						"w-full justify-between mt-1 bg-input/30 border-secondary font-normal",
						!value && "text-muted-foreground",
					)}
				>
					{value || "Select or type exercise..."}
					<ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
				</Button>
			</PopoverTrigger>
			<PopoverContent
				className="w-[--radix-popover-trigger-width] p-0 border-secondary"
				align="start"
			>
				<Command>
					<CommandInput
						placeholder="Search exercises..."
						onValueChange={(search) => {
							// Allow typing a custom name even if not in the list
							if (
								search &&
								!exerciseNames.some(
									(n) => n.toLowerCase() === search.toLowerCase(),
								)
							) {
								onChange(search);
							}
						}}
					/>
					<CommandList>
						<CommandEmpty>
							<span className="text-muted-foreground">
								No matching exercises.
							</span>
							<br />
							<span className="text-xs text-muted-foreground">
								The typed name will be used as-is.
							</span>
						</CommandEmpty>
						<CommandGroup>
							{exerciseNames.map((name) => (
								<CommandItem
									key={name}
									value={name}
									onSelect={(selected) => {
										onChange(selected === value ? "" : selected);
										setOpen(false);
									}}
								>
									<Check
										className={cn(
											"mr-2 h-4 w-4",
											value.toLowerCase() === name.toLowerCase()
												? "opacity-100"
												: "opacity-0",
										)}
									/>
									{name}
								</CommandItem>
							))}
						</CommandGroup>
					</CommandList>
				</Command>
			</PopoverContent>
		</Popover>
	);
}

// ---------- Goals Page ----------

export function Goals() {
	const { user } = useAuth();
	const unit = usePreferredWeightUnit();
	const { isPremium, isInferno } = useSubscription();
	const { activeProfileId } = useProfileFilterStore();
	const { data: goals, isPending } = useQuery(goalsOptions(user?.id ?? ""));
	const { data: records } = useQuery({
		...personalRecordsOptions(user?.id ?? "", activeProfileId),
		enabled: !!user?.id,
	});
	const progressMap = useGoalProgress(activeProfileId);
	const createGoal = useCreateGoal();
	const updateGoal = useUpdateGoal();
	const archiveGoal = useArchiveGoal();

	const [createOpen, setCreateOpen] = useState(false);
	const [editGoal, setEditGoal] = useState<Goal | null>(null);
	const [showCompleted, setShowCompleted] = useState(false);
	const [showArchived, setShowArchived] = useState(false);

	const activeGoals = goals?.filter((g) => g.status === "active") ?? [];
	const completedGoals = goals?.filter((g) => g.status === "completed") ?? [];
	const archivedGoals = goals?.filter((g) => g.status === "archived") ?? [];

	// M24: INFERNO = unlimited goals, paid (EMBER/FLAME) = 3. There is no free
	// tier, so users without a subscription get 0 (and are gated out below).
	const maxGoals = isInferno ? Infinity : isPremium ? 3 : 0;
	const atLimit = activeGoals.length >= maxGoals;

	// M26: Derive distinct exercise names from personal records for autocomplete
	const knownExerciseOptions = useMemo(() => {
		if (!records) return [];
		const byName = new Map<
			string,
			{ displayName: string; exerciseIds: Set<string> }
		>();
		for (const record of records) {
			const name = record.exercise_name.trim();
			if (!name) continue;
			const normalizedName = name.toLowerCase();
			let option = byName.get(normalizedName);
			if (!option) {
				option = { displayName: name, exerciseIds: new Set() };
				byName.set(normalizedName, option);
			}
			if (record.exercise_id) {
				option.exerciseIds.add(record.exercise_id);
			}
		}
		return Array.from(byName.entries())
			.map(([key, { displayName, exerciseIds }]) => ({
				key,
				name: displayName,
				exerciseId:
					exerciseIds.size === 1 ? (Array.from(exerciseIds)[0] ?? null) : null,
			}))
			.sort((a, b) => a.name.localeCompare(b.name));
	}, [records]);
	const knownExerciseNames = useMemo(
		() => knownExerciseOptions.map((option) => option.name),
		[knownExerciseOptions],
	);
	const exerciseIdByName = useMemo(() => {
		return new Map(
			knownExerciseOptions.map((option) => [option.key, option.exerciseId]),
		);
	}, [knownExerciseOptions]);
	const resolveGoalExerciseId = useCallback(
		(
			data: {
				goal_type: "frequency" | "volume" | "pr";
				exercise_name?: string | null;
			},
			currentGoal?: Goal,
		) => {
			if (data.goal_type !== "pr" || !data.exercise_name) return null;

			const exerciseName = data.exercise_name.trim();
			const mappedExerciseId = exerciseIdByName.get(exerciseName.toLowerCase());
			if (mappedExerciseId) return mappedExerciseId;

			if (
				currentGoal?.exercise_id &&
				currentGoal.exercise_name?.trim().toLowerCase() ===
					exerciseName.toLowerCase()
			) {
				return currentGoal.exercise_id;
			}

			return null;
		},
		[exerciseIdByName],
	);

	// Track which goals we have already celebrated to avoid re-triggering
	const celebratedRef = useRef(new Set<string>());

	// Goal achievement detection
	const handleGoalComplete = useCallback(
		(goal: Goal) => {
			if (celebratedRef.current.has(goal.id)) return;
			celebratedRef.current.add(goal.id);

			updateGoal.mutate({
				goalId: goal.id,
				updates: {
					status: "completed",
					completed_at: new Date().toISOString(),
				},
			});
		},
		[updateGoal],
	);

	// Check for completed goals on each render
	useEffect(() => {
		for (const goal of activeGoals) {
			const progress = progressMap.get(goal.id) ?? 0;
			if (progress >= 100) {
				handleGoalComplete(goal);
				break; // Process one goal completion per render cycle
			}
		}
	}, [activeGoals, progressMap, handleGoalComplete]);

	// Tier gate for FREE users
	if (!isPremium && !isPending) {
		return (
			<div className="min-h-screen pb-20 md:pb-8">
				<div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
					<motion.div
						initial={{ opacity: 0, y: 20 }}
						animate={{ opacity: 1, y: 0 }}
					>
						<h1 className="text-display-2 mb-2 text-white">Training Goals</h1>
						<p className="text-muted-foreground mb-8">
							Set targets, track progress, achieve greatness.
						</p>
					</motion.div>

					<motion.div
						initial={{ opacity: 0, y: 20 }}
						animate={{ opacity: 1, y: 0 }}
						transition={{ delay: 0.1 }}
					>
						<EmptyState
							icon={Target}
							title="Upgrade to set goals"
							description="Goal tracking is available to subscribers. Set workout frequency, volume, and PR targets to stay motivated."
							actionLabel="View Plans"
							actionHref="/pricing"
						/>
					</motion.div>
				</div>
			</div>
		);
	}

	return (
		<div className="min-h-screen pb-20 md:pb-8">
			<div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
				{/* Header */}
				<motion.div
					initial={{ opacity: 0, y: 20 }}
					animate={{ opacity: 1, y: 0 }}
					className="flex items-center justify-between mb-8"
				>
					<div>
						<h1 className="text-display-2 mb-2 text-white">Training Goals</h1>
						<p className="text-muted-foreground">
							Set targets, track progress, achieve greatness.
						</p>
					</div>
					<FeatureHint
						hintId="goals-set-target"
						content="Set workout frequency, volume, or PR targets to track your progress"
						side="bottom"
					>
						<Button
							onClick={() => setCreateOpen(true)}
							disabled={atLimit}
							variant="cta"
							title={
								atLimit && maxGoals !== Infinity
									? `Maximum ${maxGoals} active goal${maxGoals > 1 ? "s" : ""} reached`
									: "Create new goal"
							}
						>
							<Plus className="w-4 h-4 mr-2" />
							New Goal
						</Button>
					</FeatureHint>
				</motion.div>

				{/* Active Goals */}
				{isPending ? (
					<div className="space-y-4">
						{Array.from({ length: 2 }).map((_, i) => (
							// biome-ignore lint/suspicious/noArrayIndexKey: static skeleton list never reorders
							<Card key={i} className="p-6 bg-surface-2 animate-pulse">
								<div className="h-20" />
							</Card>
						))}
					</div>
				) : activeGoals.length === 0 ? (
					<motion.div
						initial={{ opacity: 0, y: 20 }}
						animate={{ opacity: 1, y: 0 }}
						transition={{ delay: 0.1 }}
					>
						<EmptyState
							icon={Target}
							title="No active goals"
							description="Set a training goal to start tracking your progress. You can track workout frequency, volume, or personal records."
							actionLabel="Create a Goal"
							onAction={() => setCreateOpen(true)}
						/>
					</motion.div>
				) : (
					<div className="space-y-4 mb-8">
						{activeGoals.map((goal, index) => {
							const progress = progressMap.get(goal.id) ?? 0;
							const Icon = goalTypeIcons[goal.goal_type];
							return (
								<motion.div
									key={goal.id}
									initial={{ opacity: 0, y: 20 }}
									animate={{ opacity: 1, y: 0 }}
									transition={{ delay: index * 0.1 }}
								>
									<Card className="p-6 bg-surface-2 border-secondary hover:border-primary/50 transition-all">
										<div className="flex items-center gap-4">
											<GoalProgressRing progress={progress} />
											<div className="flex-1 min-w-0">
												<div className="flex items-center gap-2 mb-1">
													<Icon className="w-4 h-4 text-primary" />
													<h3 className="text-lg font-semibold text-white">
														{getGoalDescription(goal, unit)}
													</h3>
												</div>
												<p className="text-sm text-muted-foreground font-data">
													{getProgressText(goal, progress, unit)}
												</p>
												{goal.deadline && (
													<p className="text-xs text-muted-foreground mt-1">
														Deadline: {goal.deadline.toLocaleDateString()}
													</p>
												)}
											</div>
											<div className="flex items-center gap-2">
												<Button
													variant="ghost"
													size="icon"
													onClick={() => setEditGoal(goal)}
													className="hover:bg-primary/10"
													title="Edit goal"
												>
													<Edit2 className="w-4 h-4 text-muted-foreground" />
												</Button>
												<Button
													variant="ghost"
													size="icon"
													onClick={() => archiveGoal.mutate(goal.id)}
													className="hover:bg-chart-2/10"
													title="Archive goal"
												>
													<Archive className="w-4 h-4 text-muted-foreground" />
												</Button>
											</div>
										</div>
									</Card>
								</motion.div>
							);
						})}
					</div>
				)}

				{/* Completed Goals */}
				{completedGoals.length > 0 && (
					<motion.div
						initial={{ opacity: 0 }}
						animate={{ opacity: 1 }}
						transition={{ delay: 0.3 }}
					>
						<button
							type="button"
							onClick={() => setShowCompleted(!showCompleted)}
							className="flex items-center gap-2 text-muted-foreground hover:text-white mb-4 transition-colors"
						>
							{showCompleted ? (
								<ChevronUp className="w-4 h-4" />
							) : (
								<ChevronDown className="w-4 h-4" />
							)}
							<span className="text-sm font-medium">
								Completed Goals ({completedGoals.length})
							</span>
						</button>

						{showCompleted && (
							<div className="space-y-3">
								{completedGoals.map((goal) => (
									<Card
										key={goal.id}
										className="p-4 bg-surface-2/50 border-secondary"
									>
										<div className="flex items-center gap-3">
											<div className="w-8 h-8 rounded-full bg-success/20 flex items-center justify-center">
												<Award className="w-4 h-4 text-success" />
											</div>
											<div>
												<p className="text-sm text-white">
													{getGoalDescription(goal, unit)}
												</p>
												<p className="text-xs text-muted-foreground">
													Completed{" "}
													{goal.completed_at?.toLocaleDateString() ?? ""}
												</p>
											</div>
										</div>
									</Card>
								))}
							</div>
						)}
					</motion.div>
				)}

				{/* M27: Archived Goals */}
				{archivedGoals.length > 0 && (
					<motion.div
						initial={{ opacity: 0 }}
						animate={{ opacity: 1 }}
						transition={{ delay: 0.35 }}
						className="mt-4"
					>
						<button
							type="button"
							onClick={() => setShowArchived(!showArchived)}
							className="flex items-center gap-2 text-muted-foreground hover:text-white mb-4 transition-colors"
						>
							{showArchived ? (
								<ChevronUp className="w-4 h-4" />
							) : (
								<ChevronDown className="w-4 h-4" />
							)}
							<span className="text-sm font-medium">
								Archived Goals ({archivedGoals.length})
							</span>
						</button>

						{showArchived && (
							<div className="space-y-3">
								{archivedGoals.map((goal) => {
									const Icon = goalTypeIcons[goal.goal_type];
									return (
										<Card
											key={goal.id}
											className="p-4 bg-surface-2/30 border-secondary/50"
										>
											<div className="flex items-center gap-3">
												<div className="w-8 h-8 rounded-full bg-muted/20 flex items-center justify-center">
													<Icon className="w-4 h-4 text-muted-foreground" />
												</div>
												<div>
													<p className="text-sm text-muted-foreground">
														{getGoalDescription(goal, unit)}
													</p>
													<p className="text-xs text-muted-foreground mt-0.5">
														Archived {goal.updated_at.toLocaleDateString()}
													</p>
												</div>
												<Button
													variant="ghost"
													size="sm"
													onClick={() =>
														updateGoal.mutate({
															goalId: goal.id,
															updates: { status: "active" },
														})
													}
													className="hover:bg-primary/10 text-muted-foreground hover:text-white"
													title="Restore goal"
												>
													<RotateCcw className="w-4 h-4 mr-1" />
													Restore
												</Button>
											</div>
										</Card>
									);
								})}
							</div>
						)}
					</motion.div>
				)}

				{/* Limit indicator */}
				<motion.div
					initial={{ opacity: 0 }}
					animate={{ opacity: 1 }}
					transition={{ delay: 0.4 }}
					className="mt-6 text-center"
				>
					<p className="text-xs text-muted-foreground">
						{isInferno
							? `${activeGoals.length} active goal${activeGoals.length !== 1 ? "s" : ""} (unlimited)`
							: `${activeGoals.length}/${maxGoals} active goal${maxGoals > 1 ? "s" : ""}`}
						{!isPremium && " (upgrade for more)"}
					</p>
				</motion.div>
			</div>

			{/* Create Goal Dialog */}
			<GoalFormDialog
				open={createOpen}
				onOpenChange={setCreateOpen}
				title="Create Goal"
				unit={unit}
				exerciseNames={knownExerciseNames}
				onSubmit={(data) => {
					createGoal.mutate({
						...data,
						exercise_id: resolveGoalExerciseId(data),
					});
					setCreateOpen(false);
				}}
			/>

			{/* Edit Goal Dialog */}
			{editGoal && (
				<GoalFormDialog
					open={!!editGoal}
					onOpenChange={(open) => {
						if (!open) setEditGoal(null);
					}}
					title="Edit Goal"
					isEdit
					unit={unit}
					exerciseNames={knownExerciseNames}
					defaultValues={{
						goal_type: editGoal.goal_type,
						target_value: editGoal.target_value,
						exercise_name: editGoal.exercise_name ?? "",
						deadline: editGoal.deadline
							? editGoal.deadline.toISOString().split("T")[0]
							: "",
						period: editGoal.period,
					}}
					onSubmit={(data) => {
						updateGoal.mutate({
							goalId: editGoal.id,
							updates: {
								target_value: data.target_value,
								target_unit: data.target_unit,
								exercise_name: data.exercise_name ?? null,
								exercise_id: resolveGoalExerciseId(data, editGoal),
								deadline: data.deadline ?? null,
								period: data.period,
							},
						});
						setEditGoal(null);
					}}
				/>
			)}
		</div>
	);
}

// ---------- Goal Form Dialog ----------

interface GoalFormDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	title: string;
	unit: WeightUnit;
	/** When true, goal type tabs are hidden (type cannot change after creation). */
	isEdit?: boolean;
	/** Known exercise names for PR goal autocomplete. */
	exerciseNames?: string[];
	defaultValues?: {
		goal_type: "frequency" | "volume" | "pr";
		target_value: number;
		exercise_name?: string;
		deadline?: string;
		period: "weekly" | "monthly";
	};
	onSubmit: (data: {
		goal_type: "frequency" | "volume" | "pr";
		target_value: number;
		target_unit: string;
		exercise_name?: string | null;
		exercise_id?: string | null;
		deadline?: string | null;
		period: "weekly" | "monthly";
	}) => void;
}

function GoalFormDialog({
	open,
	onOpenChange,
	title,
	unit,
	isEdit = false,
	exerciseNames = [],
	defaultValues,
	onSubmit,
}: GoalFormDialogProps) {
	const [goalType, setGoalType] = useState<"frequency" | "volume" | "pr">(
		defaultValues?.goal_type ?? "frequency",
	);
	const initialTargetValue =
		defaultValues?.goal_type === "volume" || defaultValues?.goal_type === "pr"
			? weightInputValue(defaultValues.target_value, unit)
			: (defaultValues?.target_value?.toString() ?? "");
	const [targetValue, setTargetValue] = useState(initialTargetValue);
	const [exerciseName, setExerciseName] = useState(
		defaultValues?.exercise_name ?? "",
	);
	const [deadline, setDeadline] = useState(defaultValues?.deadline ?? "");
	const [period, setPeriod] = useState<"weekly" | "monthly">(
		defaultValues?.period ?? "weekly",
	);

	// Reset form when dialog opens with different defaults
	useEffect(() => {
		if (open) {
			setGoalType(defaultValues?.goal_type ?? "frequency");
			setTargetValue(
				defaultValues?.goal_type === "volume" ||
					defaultValues?.goal_type === "pr"
					? weightInputValue(defaultValues.target_value, unit)
					: (defaultValues?.target_value?.toString() ?? ""),
			);
			setExerciseName(defaultValues?.exercise_name ?? "");
			setDeadline(defaultValues?.deadline ?? "");
			setPeriod(defaultValues?.period ?? "weekly");
		}
	}, [
		open,
		defaultValues?.goal_type,
		defaultValues?.target_value,
		unit,
		defaultValues?.exercise_name,
		defaultValues?.deadline,
		defaultValues?.period,
	]);

	const getTargetUnit = (): string => {
		switch (goalType) {
			case "frequency":
				return period === "monthly" ? "workouts/month" : "workouts/week";
			case "volume":
				return period === "monthly" ? "kg/month" : "kg/week";
			case "pr":
				return "kg";
		}
	};

	const handleSubmit = () => {
		const parsedValue = parseFloat(targetValue);
		const value =
			goalType === "volume" || goalType === "pr"
				? weightInputToKg(targetValue, unit)
				: parsedValue;
		if (Number.isNaN(value) || value <= 0) return;
		if (goalType === "pr" && !exerciseName.trim()) return;

		onSubmit({
			goal_type: goalType,
			target_value: value,
			target_unit: getTargetUnit(),
			exercise_name: goalType === "pr" ? exerciseName.trim() : null,
			deadline: goalType === "pr" && deadline ? deadline : null,
			period,
		});
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="bg-background border-secondary sm:max-w-md">
				<DialogHeader>
					<DialogTitle className="text-white">{title}</DialogTitle>
				</DialogHeader>

				<div className="space-y-6 py-4">
					{/* Goal Type Tabs */}
					<Tabs
						value={goalType}
						onValueChange={(v) => {
							if (!isEdit) setGoalType(v as "frequency" | "volume" | "pr");
						}}
					>
						{/* M25: Hide type tabs in edit mode -- type cannot change after creation */}
						{isEdit ? (
							<div className="flex items-center gap-2 px-1 py-2 text-sm text-muted-foreground">
								{goalType === "frequency" && (
									<Target className="w-4 h-4 text-primary" />
								)}
								{goalType === "volume" && (
									<TrendingUp className="w-4 h-4 text-primary" />
								)}
								{goalType === "pr" && (
									<Award className="w-4 h-4 text-primary" />
								)}
								<span className="capitalize">
									{goalType === "pr" ? "Personal Record" : goalType}
								</span>
								<span className="text-muted-foreground text-xs">
									(type cannot be changed)
								</span>
							</div>
						) : (
							<TabsList className="w-full">
								<TabsTrigger value="frequency">
									<Target className="w-4 h-4 mr-1" />
									Frequency
								</TabsTrigger>
								<TabsTrigger value="volume">
									<TrendingUp className="w-4 h-4 mr-1" />
									Volume
								</TabsTrigger>
								<TabsTrigger value="pr">
									<Award className="w-4 h-4 mr-1" />
									PR
								</TabsTrigger>
							</TabsList>
						)}

						<TabsContent value="frequency" className="space-y-4 mt-4">
							<div>
								<Label htmlFor="freq-target">
									Target workouts per {period === "monthly" ? "month" : "week"}
								</Label>
								<Input
									id="freq-target"
									type="number"
									min={1}
									placeholder="e.g. 4"
									value={targetValue}
									onChange={(e) => setTargetValue(e.target.value)}
									className="mt-1 bg-input/30"
								/>
							</div>
							<div>
								<Label>Period</Label>
								<div className="flex gap-2 mt-1">
									<Button
										type="button"
										variant={period === "weekly" ? "default" : "outline"}
										size="sm"
										onClick={() => setPeriod("weekly")}
										className={
											period === "weekly"
												? "bg-primary border-primary"
												: "border-secondary"
										}
									>
										Weekly
									</Button>
									<Button
										type="button"
										variant={period === "monthly" ? "default" : "outline"}
										size="sm"
										onClick={() => setPeriod("monthly")}
										className={
											period === "monthly"
												? "bg-primary border-primary"
												: "border-secondary"
										}
									>
										Monthly
									</Button>
								</div>
							</div>
						</TabsContent>

						<TabsContent value="volume" className="space-y-4 mt-4">
							<div>
								<Label htmlFor="vol-target">
									Target volume ({unit}) per{" "}
									{period === "monthly" ? "month" : "week"}
								</Label>
								<Input
									id="vol-target"
									type="number"
									min={1}
									placeholder={unit === "lbs" ? "e.g. 22000" : "e.g. 10000"}
									value={targetValue}
									onChange={(e) => setTargetValue(e.target.value)}
									className="mt-1 bg-input/30"
								/>
							</div>
							<div>
								<Label>Period</Label>
								<div className="flex gap-2 mt-1">
									<Button
										type="button"
										variant={period === "weekly" ? "default" : "outline"}
										size="sm"
										onClick={() => setPeriod("weekly")}
										className={
											period === "weekly"
												? "bg-primary border-primary"
												: "border-secondary"
										}
									>
										Weekly
									</Button>
									<Button
										type="button"
										variant={period === "monthly" ? "default" : "outline"}
										size="sm"
										onClick={() => setPeriod("monthly")}
										className={
											period === "monthly"
												? "bg-primary border-primary"
												: "border-secondary"
										}
									>
										Monthly
									</Button>
								</div>
							</div>
						</TabsContent>

						<TabsContent value="pr" className="space-y-4 mt-4">
							{/* M26: Exercise name combobox with autocomplete from known exercises */}
							<div>
								<Label>Exercise Name</Label>
								<ExerciseNameCombobox
									value={exerciseName}
									onChange={setExerciseName}
									exerciseNames={exerciseNames}
								/>
							</div>
							<div>
								<Label htmlFor="pr-target">Target Weight ({unit})</Label>
								<Input
									id="pr-target"
									type="number"
									min={1}
									placeholder="e.g. 100"
									value={targetValue}
									onChange={(e) => setTargetValue(e.target.value)}
									className="mt-1 bg-input/30"
								/>
							</div>
							<div>
								<Label htmlFor="pr-deadline">Deadline (optional)</Label>
								<Input
									id="pr-deadline"
									type="date"
									value={deadline}
									onChange={(e) => setDeadline(e.target.value)}
									className="mt-1 bg-input/30"
								/>
							</div>
						</TabsContent>
					</Tabs>

					{/* Submit */}
					<Button
						onClick={handleSubmit}
						variant="cta"
						className="w-full"
						disabled={
							!targetValue ||
							parseFloat(targetValue) <= 0 ||
							(goalType === "pr" && !exerciseName.trim())
						}
					>
						{title === "Create Goal" ? "Create Goal" : "Save Changes"}
					</Button>
				</div>
			</DialogContent>
		</Dialog>
	);
}
