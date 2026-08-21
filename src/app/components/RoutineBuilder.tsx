import { move } from "@dnd-kit/helpers";
import { DragDropProvider } from "@dnd-kit/react";
import { useSortable } from "@dnd-kit/react/sortable";
import { useQuery } from "@tanstack/react-query";
import {
	ArrowLeft,
	ChevronDown,
	Dumbbell,
	Edit,
	Eye,
	GripVertical,
	Loader2,
	Plus,
	Save,
	Search,
	X,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { toast } from "sonner";
import { SelectionModeBar } from "@/app/components/routine-builder/SelectionModeBar";
import { Badge } from "@/app/components/ui/badge";
import { Button } from "@/app/components/ui/button";
import { Card } from "@/app/components/ui/card";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@/app/components/ui/collapsible";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/app/components/ui/dialog";
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import { Switch } from "@/app/components/ui/switch";
import { UnsavedChangesDialog } from "@/app/components/ui/unsaved-changes-dialog";
import { useExerciseCatalog } from "@/hooks/useExerciseCatalog";
import {
	convertWeight,
	formatWeight,
	getUnitLabel,
	toKg,
	type WeightUnit,
	weightInputValue,
} from "@/lib/units";
import { useSaveRoutine, useUpdateRoutine } from "@/mutations/routines";
import { useAuth } from "@/providers/AuthProvider";
import { profileOptions } from "@/queries/profile";
import { routineDetailOptions } from "@/queries/routines";
import { formatEquipment } from "@/schemas/transforms";

const SUPERSET_COLORS = ["#6366F1", "#EC4899", "#10B981", "#F59E0B"] as const;

interface Exercise {
	id: string;
	name: string;
	muscleGroup: string;
	exerciseId?: string | null;
	sets: number;
	reps: number;
	weight: number;
	rest: number;
	durationSeconds: number | null;
	mode: string;
	supersetId: string | null;
	supersetColor: string | null;
	supersetOrder: number | null;
	perSetWeights: unknown;
	perSetRest: unknown;
	perSetReps: unknown;
	isAmrap: boolean;
	isBodyweight: boolean;
	prPercentage: number | null;
	repCountTiming: string | null;
	stopAtPosition: string | null;
	stallDetection: boolean;
	eccentricLoad: string | null;
	echoLevel: string | null;
	dropSetEnabled: boolean;
	dropSetMinWeightKg: number | null;
}

type GroupedExerciseItem =
	| { type: "exercise"; exercise: Exercise }
	| {
			type: "superset";
			id: string;
			color: string | null;
			exercises: Exercise[];
	  };

function isOldSchoolMode(mode: string) {
	const key = mode
		.trim()
		.toUpperCase()
		.replace(/[\s-]+/g, "_");
	return key === "OLD_SCHOOL" || key === "CLASSIC";
}

function isDropSetEligible(exercise: Pick<Exercise, "mode" | "isBodyweight">) {
	return isOldSchoolMode(exercise.mode) && !exercise.isBodyweight;
}

function isDropSetConfigValid(exercise: Exercise) {
	if (!exercise.dropSetEnabled || !isDropSetEligible(exercise)) return true;
	return (
		exercise.dropSetMinWeightKg != null &&
		Number.isFinite(exercise.dropSetMinWeightKg) &&
		exercise.dropSetMinWeightKg > 0
	);
}

function getDisplayWeight(weightKg: number, unit: WeightUnit) {
	const converted = convertWeight(weightKg, unit);
	return unit === "lbs" ? converted.toFixed(1) : `${Math.round(converted)}`;
}

function formatExerciseSummary(exercise: Exercise, unit: WeightUnit) {
	const loadLabel = exercise.isBodyweight
		? "Bodyweight"
		: formatWeight(exercise.weight, unit);

	if (exercise.durationSeconds) {
		return `${exercise.sets} sets • ${exercise.durationSeconds}s • ${loadLabel} • ${exercise.mode}`;
	}

	if (exercise.isAmrap) {
		return `${exercise.sets} sets • AMRAP • ${loadLabel} • ${exercise.mode}`;
	}

	return `${exercise.sets} sets • ${exercise.reps} reps • ${loadLabel} • ${exercise.mode}`;
}

function getPerSetValues(
	source: unknown,
	count: number,
	fallback: number,
): number[] {
	if (Array.isArray(source)) {
		return Array.from({ length: count }, (_, index) => {
			const parsed = Number(source[index]);
			return Number.isFinite(parsed) ? parsed : fallback;
		});
	}

	return Array.from({ length: count }, () => fallback);
}

function getNextSupersetColor(exercises: Exercise[]) {
	const usedColors = new Set(
		exercises.map((exercise) => exercise.supersetColor).filter(Boolean),
	);

	return (
		SUPERSET_COLORS.find((color) => !usedColors.has(color)) ??
		SUPERSET_COLORS[0]
	);
}

function groupExercises(exercises: Exercise[]): GroupedExerciseItem[] {
	const seenSupersets = new Set<string>();
	const grouped: GroupedExerciseItem[] = [];

	for (const exercise of exercises) {
		if (!exercise.supersetId) {
			grouped.push({ type: "exercise", exercise });
			continue;
		}

		if (seenSupersets.has(exercise.supersetId)) {
			continue;
		}

		seenSupersets.add(exercise.supersetId);
		grouped.push({
			type: "superset",
			id: exercise.supersetId,
			color: exercise.supersetColor,
			exercises: exercises
				.filter((entry) => entry.supersetId === exercise.supersetId)
				.sort((a, b) => (a.supersetOrder ?? 0) - (b.supersetOrder ?? 0)),
		});
	}

	return grouped;
}

export function RoutineBuilder() {
	const { routineId } = useParams<{ routineId: string }>();
	const navigate = useNavigate();
	const { user } = useAuth();
	const { data: profile } = useQuery({
		...profileOptions(user?.id ?? ""),
		enabled: !!user?.id,
	});
	const unit: WeightUnit = profile?.weight_unit === "lbs" ? "lbs" : "kg";
	const saveMutation = useSaveRoutine();
	const updateMutation = useUpdateRoutine();
	const isEditing = !!routineId;

	// Fetch existing routine for editing
	const { data: existingRoutine, isLoading: isLoadingRoutine } = useQuery({
		...routineDetailOptions(routineId ?? ""),
		enabled: !!routineId,
	});

	const [routineName, setRoutineName] = useState("Untitled Routine");
	// Preserve the routine's existing description even though this builder has no
	// description field, so editing+saving doesn't erase it.
	const [description, setDescription] = useState("");
	const [exercises, setExercises] = useState<Exercise[]>([]);
	const [selectedExercise, setSelectedExercise] = useState<string | null>(null);
	const [showExercisePicker, setShowExercisePicker] = useState(false);
	const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
	const [showUnsavedDialog, setShowUnsavedDialog] = useState(false);
	const [showPreview, setShowPreview] = useState(false);
	const [isSelectionMode, setIsSelectionMode] = useState(false);
	const [selectedExerciseIds, setSelectedExerciseIds] = useState<Set<string>>(
		new Set(),
	);

	// Populate form state from existing routine
	useEffect(() => {
		if (existingRoutine) {
			setRoutineName(existingRoutine.name);
			setDescription(existingRoutine.description ?? "");
			setExercises(
				existingRoutine.routine_exercises.map((ex) => ({
					id: ex.id,
					name: ex.name,
					muscleGroup: ex.muscle_group,
					exerciseId: ex.exercise_id ?? null,
					sets: ex.sets,
					reps: ex.reps,
					weight: ex.weight,
					rest: ex.rest_seconds,
					durationSeconds: ex.duration_seconds ?? null,
					mode: ex.mode,
					supersetId: ex.superset_id ?? null,
					supersetColor: ex.superset_color ?? null,
					supersetOrder: ex.superset_order ?? null,
					perSetWeights: ex.per_set_weights ?? null,
					perSetRest: ex.per_set_rest ?? null,
					perSetReps: ex.per_set_reps ?? null,
					isAmrap: ex.is_amrap ?? false,
					isBodyweight: ex.is_bodyweight ?? false,
					prPercentage: ex.pr_percentage ?? null,
					repCountTiming: ex.rep_count_timing ?? null,
					stopAtPosition: ex.stop_at_position ?? null,
					stallDetection: ex.stall_detection ?? true,
					eccentricLoad: ex.eccentric_load ?? null,
					echoLevel: ex.echo_level ?? null,
					dropSetEnabled: ex.drop_set_enabled ?? false,
					dropSetMinWeightKg: ex.drop_set_min_weight_kg ?? null,
				})),
			);
		}
	}, [existingRoutine]);

	useEffect(() => {
		setSelectedExerciseIds((current) => {
			const next = new Set(
				[...current].filter((id) =>
					exercises.some((exercise) => exercise.id === id),
				),
			);
			return next;
		});
	}, [exercises]);

	const handleDragEnd = (event: { canceled: boolean }) => {
		if (!event.canceled) {
			setExercises((items) =>
				move(
					items,
					event as {
						canceled: boolean;
						active: { id: string };
						over: { id: string } | null;
					},
				),
			);
			setHasUnsavedChanges(true);
		}
	};

	const handleDeleteExercise = (id: string) => {
		setExercises((current) => {
			const remaining = current.filter((ex) => ex.id !== id);
			// Ungroup any superset left with fewer than two members after deletion.
			const countBySuperset = new Map<string, number>();
			for (const ex of remaining) {
				if (ex.supersetId) {
					countBySuperset.set(
						ex.supersetId,
						(countBySuperset.get(ex.supersetId) ?? 0) + 1,
					);
				}
			}
			return remaining.map((ex) =>
				ex.supersetId && (countBySuperset.get(ex.supersetId) ?? 0) < 2
					? {
							...ex,
							supersetId: null,
							supersetColor: null,
							supersetOrder: null,
						}
					: ex,
			);
		});
		if (selectedExercise === id) {
			setSelectedExercise(null);
		}
		setHasUnsavedChanges(true);
	};

	const toggleExerciseSelection = (id: string) => {
		setSelectedExerciseIds((current) => {
			const next = new Set(current);
			if (next.has(id)) {
				next.delete(id);
			} else {
				next.add(id);
			}
			return next;
		});
	};

	const handleCreateSuperset = () => {
		const selectedIds = [...selectedExerciseIds];
		if (selectedIds.length < 2) return;

		const supersetId = crypto.randomUUID();
		const supersetColor = getNextSupersetColor(exercises);
		const selectedSet = new Set(selectedIds);

		// Source supersets that lose members to the new group: if any is left with
		// a single member, ungroup it so we don't strand an invalid 1-exercise
		// superset.
		const remainingCountBySource = new Map<string, number>();
		for (const ex of exercises) {
			if (ex.supersetId && !selectedSet.has(ex.id)) {
				remainingCountBySource.set(
					ex.supersetId,
					(remainingCountBySource.get(ex.supersetId) ?? 0) + 1,
				);
			}
		}
		const orphanedSupersetIds = new Set(
			[...remainingCountBySource.entries()]
				.filter(([, count]) => count < 2)
				.map(([id]) => id),
		);

		// supersetOrder follows the exercises' order in the routine, not the order
		// in which the user clicked them.
		let nextOrder = 0;
		setExercises((current) =>
			current.map((exercise) => {
				if (selectedSet.has(exercise.id)) {
					return {
						...exercise,
						supersetId,
						supersetColor,
						supersetOrder: nextOrder++,
					};
				}
				if (
					exercise.supersetId &&
					orphanedSupersetIds.has(exercise.supersetId)
				) {
					return {
						...exercise,
						supersetId: null,
						supersetColor: null,
						supersetOrder: null,
					};
				}
				return exercise;
			}),
		);
		setSelectedExerciseIds(new Set());
		setIsSelectionMode(false);
		setHasUnsavedChanges(true);
	};

	const handleUngroupSuperset = (supersetId: string) => {
		setExercises((current) =>
			current.map((exercise) =>
				exercise.supersetId === supersetId
					? {
							...exercise,
							supersetId: null,
							supersetColor: null,
							supersetOrder: null,
						}
					: exercise,
			),
		);
		setHasUnsavedChanges(true);
	};

	const buildExercisePayload = () =>
		exercises.map((ex, i) => ({
			name: ex.name,
			muscle_group: ex.muscleGroup,
			exercise_id: ex.exerciseId ?? null,
			sets: ex.sets,
			reps: ex.reps,
			weight: ex.weight,
			rest_seconds: ex.rest,
			duration_seconds: ex.durationSeconds,
			mode: ex.mode,
			order_index: i,
			superset_id: ex.supersetId,
			superset_color: ex.supersetColor,
			superset_order: ex.supersetOrder,
			per_set_weights: ex.perSetWeights,
			per_set_rest: ex.perSetRest,
			per_set_reps: ex.perSetReps,
			is_amrap: ex.isAmrap,
			is_bodyweight: ex.isBodyweight,
			pr_percentage: ex.prPercentage,
			rep_count_timing: ex.repCountTiming,
			stop_at_position: ex.stopAtPosition,
			stall_detection: ex.stallDetection,
			eccentric_load: ex.eccentricLoad,
			echo_level: ex.echoLevel,
			drop_set_enabled: ex.dropSetEnabled,
			drop_set_min_weight_kg: ex.dropSetMinWeightKg,
		}));

	// Resolve the selected exercise; may be undefined if the id went stale after
	// a deletion/mutation, in which case the detail panel shows its empty state.
	const selectedExerciseData = selectedExercise
		? exercises.find((ex) => ex.id === selectedExercise)
		: undefined;

	const handleSave = () => {
		if (exercises.some((exercise) => !isDropSetConfigValid(exercise))) {
			toast.error(
				"Drop-set exercises need a minimum weight greater than zero.",
			);
			return;
		}

		const payload = {
			name: routineName,
			description,
			exercises: buildExercisePayload(),
		};

		if (isEditing && routineId) {
			updateMutation.mutate(
				{ ...payload, routineId },
				{
					onSuccess: () => {
						setHasUnsavedChanges(false);
						navigate("/routines");
					},
				},
			);
		} else {
			saveMutation.mutate(payload, {
				onSuccess: () => {
					setHasUnsavedChanges(false);
					navigate("/routines");
				},
			});
		}
	};

	const handleBackClick = () => {
		if (hasUnsavedChanges) {
			setShowUnsavedDialog(true);
		} else {
			navigate("/routines");
		}
	};

	const isSaving = saveMutation.isPending || updateMutation.isPending;
	const groupedExercises = groupExercises(exercises);

	const totalDuration = exercises.reduce((sum, ex) => {
		const workMinutes =
			ex.durationSeconds != null
				? (ex.durationSeconds * ex.sets) / 60
				: ex.sets * 2.5;
		return sum + workMinutes + ((ex.sets - 1) * ex.rest) / 60;
	}, 0);

	if (isEditing && isLoadingRoutine) {
		return (
			<div className="min-h-screen flex items-center justify-center">
				<div className="flex flex-col items-center gap-4">
					<Loader2 className="w-8 h-8 text-primary animate-spin" />
					<p className="text-muted-foreground">Loading routine...</p>
				</div>
			</div>
		);
	}

	return (
		<div className="min-h-screen pb-24 md:pb-8">
			{/* Top Bar */}
			<div className="bg-gradient-to-b from-surface-2 to-background border-b border-secondary sticky top-0 z-50">
				<div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
					<div className="flex items-center justify-between">
						<Button
							variant="outline"
							size="sm"
							onClick={handleBackClick}
							className="border-secondary text-muted-foreground hover:border-primary hover:text-primary"
						>
							<ArrowLeft className="w-4 h-4 mr-2" />
							{isEditing ? "Back" : "Cancel"}
						</Button>

						<div className="flex items-center gap-3">
							{hasUnsavedChanges && (
								<div className="flex items-center gap-2">
									<div className="w-2 h-2 bg-primary rounded-full animate-pulse" />
									<span className="text-sm text-muted-foreground">
										Unsaved changes
									</span>
								</div>
							)}
							<Input
								value={routineName}
								onChange={(e) => {
									setRoutineName(e.target.value);
									setHasUnsavedChanges(true);
								}}
								className="text-xl font-semibold bg-transparent border-none text-white focus-visible:ring-0 w-full max-w-xs md:max-w-md text-center"
							/>
						</div>

						<div className="flex gap-2">
							<Button
								variant="outline"
								size="sm"
								onClick={() => setShowPreview(true)}
								className="border-secondary text-muted-foreground hover:border-primary hover:text-primary"
							>
								<Eye className="w-4 h-4 mr-2" />
								Preview
							</Button>
							<Button
								size="sm"
								onClick={handleSave}
								disabled={isSaving}
								variant="cta"
							>
								{isSaving ? (
									<Loader2 className="w-4 h-4 mr-2 animate-spin" />
								) : (
									<Save className="w-4 h-4 mr-2" />
								)}
								{isSaving ? "Saving..." : "Save Routine"}
							</Button>
						</div>
					</div>
				</div>
			</div>

			{/* Main Content */}
			<div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
				<div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
					{/* Left: Exercise List */}
					<div className="lg:col-span-2">
						<div className="mb-4 flex items-center justify-between">
							<div>
								<h2 className="text-xl font-semibold text-white">Exercises</h2>
								<p className="text-sm text-muted-foreground">
									{exercises.length} exercises • ~{Math.round(totalDuration)}{" "}
									min
								</p>
							</div>
							{exercises.length >= 2 && (
								<Button
									size="sm"
									variant="outline"
									onClick={() => {
										setIsSelectionMode((current) => !current);
										setSelectedExerciseIds(new Set());
									}}
									className="border-secondary text-muted-foreground hover:border-primary hover:text-primary"
								>
									{isSelectionMode ? "Cancel Superset" : "Create Superset"}
								</Button>
							)}
						</div>

						<DragDropProvider onDragEnd={handleDragEnd}>
							<div className="space-y-3">
								{groupedExercises.map((item) =>
									item.type === "exercise" ? (
										<SortableExerciseItem
											key={item.exercise.id}
											exercise={item.exercise}
											index={exercises.findIndex(
												(exercise) => exercise.id === item.exercise.id,
											)}
											isSelected={selectedExercise === item.exercise.id}
											isSelectionMode={isSelectionMode}
											isSelectionSelected={selectedExerciseIds.has(
												item.exercise.id,
											)}
											onSelect={() =>
												isSelectionMode
													? toggleExerciseSelection(item.exercise.id)
													: setSelectedExercise(item.exercise.id)
											}
											onDelete={() => handleDeleteExercise(item.exercise.id)}
											unit={unit}
										/>
									) : (
										<div
											key={item.id}
											className="rounded-xl border border-secondary/70 bg-surface-2/40 p-4"
											style={{
												borderLeftColor: item.color ?? undefined,
												borderLeftWidth: 4,
											}}
										>
											<div className="mb-3 flex items-center justify-between">
												<div className="flex items-center gap-2">
													<Badge
														variant="outline"
														className="border-primary/40 text-primary"
													>
														Superset
													</Badge>
													<span className="text-sm text-muted-foreground">
														{item.exercises.length} exercises
													</span>
												</div>
												<Button
													size="sm"
													variant="ghost"
													onClick={() => handleUngroupSuperset(item.id)}
													className="text-muted-foreground hover:text-white"
												>
													Ungroup
												</Button>
											</div>
											<div className="space-y-3">
												{item.exercises.map((exercise) => (
													<SortableExerciseItem
														key={exercise.id}
														exercise={exercise}
														index={exercises.findIndex(
															(entry) => entry.id === exercise.id,
														)}
														isSelected={selectedExercise === exercise.id}
														isSelectionMode={isSelectionMode}
														isSelectionSelected={selectedExerciseIds.has(
															exercise.id,
														)}
														onSelect={() =>
															isSelectionMode
																? toggleExerciseSelection(exercise.id)
																: setSelectedExercise(exercise.id)
														}
														onDelete={() => handleDeleteExercise(exercise.id)}
														unit={unit}
													/>
												))}
											</div>
										</div>
									),
								)}
							</div>
						</DragDropProvider>

						<Button
							onClick={() => setShowExercisePicker(true)}
							variant="outline"
							className="w-full mt-4 border-dashed border-2 border-secondary text-muted-foreground hover:border-primary hover:text-primary"
						>
							<Plus className="w-4 h-4 mr-2" />
							Add Exercise
						</Button>
					</div>

					{/* Right: Exercise Detail Panel */}
					<div className="lg:col-span-1">
						<AnimatePresence mode="wait">
							{selectedExerciseData ? (
								<ExerciseDetailPanel
									exercise={selectedExerciseData}
									onUpdate={(updated) => {
										setExercises(
											exercises.map((ex) =>
												ex.id === selectedExercise ? { ...ex, ...updated } : ex,
											),
										);
										setHasUnsavedChanges(true);
									}}
									onClose={() => setSelectedExercise(null)}
									onUngroup={() => {
										if (selectedExerciseData.supersetId) {
											handleUngroupSuperset(selectedExerciseData.supersetId);
										}
									}}
									unit={unit}
								/>
							) : (
								<EmptyDetailPanel />
							)}
						</AnimatePresence>
					</div>
				</div>
			</div>

			{/* Exercise Picker Modal */}
			<AnimatePresence>
				{showExercisePicker && (
					<ExercisePickerModal
						onClose={() => setShowExercisePicker(false)}
						onSelect={(exercise) => {
							const newExercise: Exercise = {
								id: crypto.randomUUID(),
								name: exercise.name,
								muscleGroup: exercise.muscleGroup,
								exerciseId: exercise.exerciseId ?? null,
								sets: 3,
								reps: 10,
								weight: 0,
								rest: 90,
								durationSeconds: null,
								mode: "Old School",
								supersetId: null,
								supersetColor: null,
								supersetOrder: null,
								perSetWeights: null,
								perSetRest: null,
								perSetReps: null,
								isAmrap: false,
								isBodyweight: false,
								prPercentage: null,
								repCountTiming: null,
								stopAtPosition: null,
								stallDetection: true,
								eccentricLoad: null,
								echoLevel: null,
								dropSetEnabled: false,
								dropSetMinWeightKg: null,
							};
							setExercises([...exercises, newExercise]);
							setShowExercisePicker(false);
							setHasUnsavedChanges(true);
						}}
					/>
				)}
			</AnimatePresence>

			{/* Unsaved Changes Dialog */}
			<UnsavedChangesDialog
				open={showUnsavedDialog}
				onSave={() => {
					setShowUnsavedDialog(false);
					handleSave();
				}}
				onDiscard={() => {
					setShowUnsavedDialog(false);
					navigate("/routines");
				}}
				onCancel={() => setShowUnsavedDialog(false)}
			/>

			{/* Preview Dialog */}
			<Dialog open={showPreview} onOpenChange={setShowPreview}>
				<DialogContent className="bg-surface-2 border-secondary">
					<DialogHeader>
						<DialogTitle className="text-white">{routineName}</DialogTitle>
						<DialogDescription>Routine summary</DialogDescription>
					</DialogHeader>
					<div className="space-y-4">
						<div className="grid grid-cols-2 gap-4">
							<div className="p-3 bg-background rounded-lg border border-secondary">
								<div className="text-sm text-muted-foreground">Exercises</div>
								<div className="text-2xl font-bold text-white">
									{exercises.length}
								</div>
							</div>
							<div className="p-3 bg-background rounded-lg border border-secondary">
								<div className="text-sm text-muted-foreground">
									Est. Duration
								</div>
								<div className="text-2xl font-bold text-white">
									~{Math.round(totalDuration)} min
								</div>
							</div>
						</div>
						<div className="space-y-2">
							{exercises.map((ex) => (
								<div
									key={ex.id}
									className="flex items-center justify-between p-2 bg-background rounded-lg border border-secondary"
								>
									<div>
										<div className="font-medium text-white text-sm">
											{ex.name}
										</div>
										<div className="text-xs text-muted-foreground">
											{ex.muscleGroup}
										</div>
									</div>
									<div className="text-sm text-muted-foreground">
										{formatExerciseSummary(ex, unit)}
									</div>
								</div>
							))}
						</div>
					</div>
				</DialogContent>
			</Dialog>

			<SelectionModeBar
				selectedCount={selectedExerciseIds.size}
				isActive={isSelectionMode}
				onCreateSuperset={handleCreateSuperset}
				onCancel={() => {
					setIsSelectionMode(false);
					setSelectedExerciseIds(new Set());
				}}
			/>
		</div>
	);
}

function SortableExerciseItem({
	exercise,
	index,
	isSelected,
	isSelectionMode = false,
	isSelectionSelected = false,
	onSelect,
	onDelete,
	unit,
}: {
	exercise: Exercise;
	index: number;
	isSelected: boolean;
	isSelectionMode?: boolean;
	isSelectionSelected?: boolean;
	onSelect: () => void;
	onDelete: () => void;
	unit: WeightUnit;
}) {
	const { ref, handleRef, isDragging } = useSortable({
		id: exercise.id,
		index,
	});

	const getMuscleGroupColor = (group: string) => {
		const colors: Record<string, string> = {
			Chest: "bg-primary",
			Back: "bg-success",
			Shoulders: "bg-accent",
			Legs: "bg-chart-2",
			Arms: "bg-warning",
		};
		return colors[group] || "bg-muted";
	};

	return (
		<div ref={ref} style={{ opacity: isDragging ? 0.5 : 1 }}>
			<Card
				onClick={onSelect}
				className={`p-4 bg-surface-2 border-secondary hover:border-primary/50 cursor-pointer transition-all ${
					isSelected ? "border-primary ring-1 ring-primary" : ""
				} ${isSelectionSelected ? "border-primary ring-2 ring-primary/60" : ""}`}
			>
				<div className="flex items-center gap-3">
					{isSelectionMode ? (
						<div
							className={`flex h-5 w-5 items-center justify-center rounded border text-xs ${
								isSelectionSelected
									? "border-primary bg-primary text-white"
									: "border-secondary text-muted-foreground"
							}`}
						>
							{isSelectionSelected ? "✓" : ""}
						</div>
					) : (
						<button
							type="button"
							ref={handleRef}
							className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-muted-foreground"
						>
							<GripVertical className="w-5 h-5" />
						</button>
					)}

					<div className="flex-1">
						<div className="flex items-center gap-2 mb-1">
							<h3 className="font-semibold text-white">{exercise.name}</h3>
							<Badge
								className={`${getMuscleGroupColor(exercise.muscleGroup)} text-white border-0 text-xs`}
							>
								{exercise.muscleGroup}
							</Badge>
							{exercise.isAmrap && (
								<Badge
									variant="outline"
									className="border-accent/40 text-accent text-xs"
								>
									AMRAP
								</Badge>
							)}
							{exercise.isBodyweight && (
								<Badge
									variant="outline"
									className="border-secondary text-muted-foreground text-xs"
								>
									Bodyweight
								</Badge>
							)}
							{exercise.dropSetEnabled && (
								<Badge
									variant="outline"
									className="border-primary/40 text-primary text-xs"
								>
									Drop set
								</Badge>
							)}
						</div>
						<p className="text-sm text-muted-foreground">
							{formatExerciseSummary(exercise, unit)}
						</p>
						<p className="text-xs text-muted-foreground mt-1">
							Rest: {exercise.rest}s between sets
						</p>
					</div>

					<div className="flex items-center gap-2">
						<Button
							size="sm"
							variant="outline"
							onClick={(e) => {
								e.stopPropagation();
								onSelect();
							}}
							className="border-secondary text-muted-foreground hover:border-primary hover:text-primary"
							disabled={isSelectionMode}
							aria-label="Edit exercise"
						>
							<Edit className="w-4 h-4" />
						</Button>
						<Button
							size="sm"
							variant="outline"
							onClick={(e) => {
								e.stopPropagation();
								onDelete();
							}}
							className="border-secondary text-destructive hover:border-destructive"
							disabled={isSelectionMode}
						>
							<X className="w-4 h-4" />
						</Button>
					</div>
				</div>
			</Card>
		</div>
	);
}

function ExerciseDetailPanel({
	exercise,
	onUpdate,
	onClose,
	onUngroup,
	unit,
}: {
	exercise: Exercise;
	onUpdate: (updates: Partial<Exercise>) => void;
	onClose: () => void;
	onUngroup: () => void;
	unit: WeightUnit;
}) {
	const isDurationBased = exercise.durationSeconds != null;
	const weightValues = getPerSetValues(
		exercise.perSetWeights,
		exercise.sets,
		exercise.weight,
	);
	const repsValues = getPerSetValues(
		exercise.perSetReps,
		exercise.sets,
		exercise.reps,
	);
	const restValues = getPerSetValues(
		exercise.perSetRest,
		exercise.sets,
		exercise.rest,
	);

	const updatePerSetReps = (index: number, value: string) => {
		const nextReps = [...repsValues];
		nextReps[index] = parseInt(value, 10) || 0;
		onUpdate({
			reps: nextReps[0] ?? 0,
			perSetReps: nextReps,
		});
	};

	const updatePerSetWeight = (index: number, value: string) => {
		const nextWeights = [...weightValues];
		const parsed = Number(value);
		nextWeights[index] = Number.isFinite(parsed)
			? unit === "lbs"
				? toKg(parsed)
				: parsed
			: 0;
		onUpdate({
			weight: nextWeights[0] ?? 0,
			perSetWeights: nextWeights,
		});
	};

	const updatePerSetRest = (index: number, value: string) => {
		const nextRest = [...restValues];
		nextRest[index] = parseInt(value, 10) || 0;
		onUpdate({
			rest: nextRest[0] ?? 0,
			perSetRest: nextRest,
		});
	};

	return (
		<motion.div
			initial={{ opacity: 0, x: 20 }}
			animate={{ opacity: 1, x: 0 }}
			exit={{ opacity: 0, x: 20 }}
		>
			<Card className="p-6 bg-surface-2 border-secondary sticky top-24">
				<div className="flex items-center justify-between mb-6">
					<h3 className="text-lg font-semibold text-white">
						Exercise Settings
					</h3>
					<Button
						size="sm"
						variant="ghost"
						onClick={onClose}
						className="text-muted-foreground hover:text-white"
					>
						<X className="w-4 h-4" />
					</Button>
				</div>

				<div className="space-y-6">
					<div className="space-y-4 rounded-lg border border-secondary/70 bg-background/60 p-4">
						<div className="flex items-center justify-between">
							<div>
								<Label className="text-white">Bodyweight</Label>
								<p className="text-xs text-muted-foreground">
									Hides external load and stores this movement as
									bodyweight-only.
								</p>
							</div>
							<Switch
								checked={exercise.isBodyweight}
								onCheckedChange={(checked) =>
									onUpdate({
										isBodyweight: checked,
										weight: checked ? 0 : exercise.weight,
										perSetWeights: checked ? null : exercise.perSetWeights,
									})
								}
							/>
						</div>

						<div className="flex items-center justify-between gap-4">
							<div>
								<Label className="text-white">Exercise Type</Label>
								<p className="text-xs text-muted-foreground">
									Switch between rep-based and duration-based prescriptions.
								</p>
							</div>
							<div className="flex gap-2">
								<Button
									size="sm"
									variant={!isDurationBased ? "default" : "outline"}
									onClick={() => onUpdate({ durationSeconds: null })}
									className={!isDurationBased ? "bg-primary text-white" : ""}
								>
									Reps
								</Button>
								<Button
									size="sm"
									variant={isDurationBased ? "default" : "outline"}
									onClick={() =>
										onUpdate({
											durationSeconds: exercise.durationSeconds ?? 30,
										})
									}
									className={isDurationBased ? "bg-primary text-white" : ""}
								>
									Duration
								</Button>
							</div>
						</div>

						<div className="flex items-center justify-between">
							<div>
								<Label className="text-white">AMRAP</Label>
								<p className="text-xs text-muted-foreground">
									Marks the set target as as many reps as possible.
								</p>
							</div>
							<Switch
								checked={exercise.isAmrap}
								onCheckedChange={(checked) => onUpdate({ isAmrap: checked })}
							/>
						</div>

						{exercise.supersetId && (
							<div className="rounded-lg border border-primary/30 bg-primary/5 p-3">
								<div className="mb-2 flex items-center justify-between">
									<div>
										<Label className="text-white">Superset Group</Label>
										<p className="text-xs text-muted-foreground">
											This exercise is currently grouped with other movements.
										</p>
									</div>
									<Button
										size="sm"
										variant="outline"
										onClick={onUngroup}
										className="border-secondary text-muted-foreground hover:border-primary hover:text-primary"
									>
										Ungroup
									</Button>
								</div>
								<Badge
									variant="outline"
									className="border-primary/40 text-primary"
								>
									Superset order {exercise.supersetOrder ?? 1}
								</Badge>
							</div>
						)}
					</div>

					<div>
						<Label className="text-sm font-medium text-secondary-foreground mb-3 block">
							Sets
						</Label>
						<div className="space-y-2">
							{Array.from({ length: exercise.sets }).map((_, i) => (
								<div
									// biome-ignore lint/suspicious/noArrayIndexKey: set indices are positional and never reorder independently
									key={i}
									className={`grid gap-3 text-sm ${
										exercise.isBodyweight ? "grid-cols-2" : "grid-cols-3"
									}`}
								>
									<div className="space-y-1">
										<Label className="text-xs text-muted-foreground">
											{isDurationBased
												? "Duration (sec)"
												: exercise.isAmrap
													? "AMRAP"
													: "Reps"}
										</Label>
										{exercise.isAmrap && !isDurationBased ? (
											<div className="flex h-10 items-center rounded-md border border-secondary bg-background px-3 text-sm text-accent">
												AMRAP
											</div>
										) : (
											<Input
												type="number"
												value={
													isDurationBased
														? (exercise.durationSeconds ?? 0)
														: (repsValues[i] ?? exercise.reps)
												}
												onChange={(e) =>
													isDurationBased
														? onUpdate({
																durationSeconds:
																	parseInt(e.target.value, 10) || 0,
															})
														: updatePerSetReps(i, e.target.value)
												}
												className="bg-background border-secondary text-white"
												placeholder={isDurationBased ? "30" : "10"}
											/>
										)}
									</div>
									{!exercise.isBodyweight && (
										<div className="space-y-1">
											<Label className="text-xs text-muted-foreground">
												Weight ({getUnitLabel(unit)})
											</Label>
											<Input
												type="number"
												step={unit === "lbs" ? "0.5" : "1"}
												value={getDisplayWeight(weightValues[i] ?? 0, unit)}
												onChange={(e) => updatePerSetWeight(i, e.target.value)}
												className="bg-background border-secondary text-white"
												placeholder={unit === "lbs" ? "45.0" : "20"}
											/>
										</div>
									)}
									<div className="space-y-1">
										<Label className="text-xs text-muted-foreground">
											Rest (sec)
										</Label>
										<Input
											type="number"
											value={restValues[i] ?? 0}
											onChange={(e) => updatePerSetRest(i, e.target.value)}
											className="bg-background border-secondary text-white"
											placeholder="90"
										/>
									</div>
								</div>
							))}
						</div>
						<div className="flex gap-2 mt-3">
							<Button
								size="sm"
								variant="outline"
								onClick={() => onUpdate({ sets: exercise.sets + 1 })}
								className="border-secondary text-muted-foreground flex-1"
							>
								<Plus className="w-4 h-4 mr-1" />
								Add Set
							</Button>
							{exercise.sets > 1 && (
								<Button
									size="sm"
									variant="outline"
									onClick={() => onUpdate({ sets: exercise.sets - 1 })}
									className="border-secondary text-destructive flex-1"
								>
									Remove Set
								</Button>
							)}
						</div>
					</div>

					<div>
						<Label className="text-sm font-medium text-secondary-foreground mb-2 block">
							Training Mode
						</Label>
						<select
							value={exercise.mode}
							onChange={(e) => onUpdate({ mode: e.target.value })}
							className="w-full px-3 py-2 rounded-lg bg-background border border-secondary text-white text-sm focus:border-primary focus:outline-none"
						>
							<option>Old School</option>
							<option>Pump</option>
							<option>TUT</option>
							<option>TUT Beast</option>
							<option>Eccentric Only</option>
							<option>Echo</option>
						</select>
						<p className="text-xs text-muted-foreground mt-1">
							{exercise.mode === "Pump"
								? "High-rep hypertrophy focused training"
								: exercise.mode === "TUT"
									? "Time under tension for muscle growth"
									: exercise.mode === "TUT Beast"
										? "Extended time under tension with slow eccentrics"
										: exercise.mode === "Eccentric Only"
											? "Negative-only reps for maximum muscle damage"
											: exercise.mode === "Echo"
												? "Alternating intensity echo sets"
												: "Traditional resistance training"}
						</p>
					</div>

					{isDropSetEligible(exercise) && (
						<div className="space-y-3 rounded-lg border border-secondary/70 bg-background/60 px-4 py-3">
							<div className="flex items-center justify-between gap-4">
								<div>
									<Label className="text-white">
										Offer drop set after failure
									</Label>
									<p className="text-xs text-muted-foreground">
										After an Old School stall, rest can offer a 10/20/30% retry.
										Saved programmed weights stay unchanged.
									</p>
								</div>
								<Switch
									checked={exercise.dropSetEnabled}
									onCheckedChange={(checked) =>
										onUpdate({ dropSetEnabled: checked })
									}
									aria-label="Offer drop set after failure"
								/>
							</div>
							{exercise.dropSetEnabled && (
								<div className="space-y-1">
									<Label className="text-xs text-muted-foreground">
										Minimum weight ({getUnitLabel(unit)})
									</Label>
									<Input
										type="number"
										min={0}
										step={unit === "lbs" ? "0.5" : "1"}
										value={weightInputValue(exercise.dropSetMinWeightKg, unit)}
										onChange={(e) => {
											const raw = e.target.value;
											if (raw.trim() === "") {
												onUpdate({ dropSetMinWeightKg: null });
												return;
											}
											const parsed = Number(raw);
											if (!Number.isFinite(parsed)) return;
											onUpdate({
												dropSetMinWeightKg:
													unit === "lbs" ? toKg(parsed) : parsed,
											});
										}}
										className="bg-background border-secondary text-white"
										placeholder={unit === "lbs" ? "45.0" : "20"}
									/>
									{(exercise.dropSetMinWeightKg == null ||
										exercise.dropSetMinWeightKg <= 0) && (
										<p className="text-xs text-destructive">
											Enter a minimum weight greater than zero.
										</p>
									)}
								</div>
							)}
						</div>
					)}

					<Collapsible>
						<CollapsibleTrigger className="flex w-full items-center justify-between rounded-lg border border-secondary px-4 py-3 text-sm text-muted-foreground transition-colors hover:text-white">
							<span>Advanced Settings</span>
							<ChevronDown className="h-4 w-4" />
						</CollapsibleTrigger>
						<CollapsibleContent className="space-y-4 pt-4">
							<div className="grid gap-4 sm:grid-cols-2">
								<div className="space-y-1">
									<Label className="text-xs text-muted-foreground">
										Eccentric Load
									</Label>
									<select
										value={exercise.eccentricLoad ?? ""}
										onChange={(e) =>
											onUpdate({
												eccentricLoad: e.target.value || null,
											})
										}
										className="w-full px-3 py-2 rounded-lg bg-background border border-secondary text-white text-sm focus:border-primary focus:outline-none"
									>
										<option value="">Standard</option>
										<option value="light">Light</option>
										<option value="moderate">Moderate</option>
										<option value="heavy">Heavy</option>
									</select>
								</div>
								<div className="space-y-1">
									<Label className="text-xs text-muted-foreground">
										Echo Level
									</Label>
									<select
										value={exercise.echoLevel ?? ""}
										onChange={(e) =>
											onUpdate({ echoLevel: e.target.value || null })
										}
										className="w-full px-3 py-2 rounded-lg bg-background border border-secondary text-white text-sm focus:border-primary focus:outline-none"
									>
										<option value="">Off</option>
										<option value="low">Low</option>
										<option value="medium">Medium</option>
										<option value="high">High</option>
									</select>
								</div>
								<div className="space-y-1">
									<Label className="text-xs text-muted-foreground">
										Rep Count Timing
									</Label>
									<Input
										value={exercise.repCountTiming ?? ""}
										onChange={(e) =>
											onUpdate({
												repCountTiming: e.target.value || null,
											})
										}
										className="bg-background border-secondary text-white"
										placeholder="2-0-2"
									/>
								</div>
								<div className="space-y-1">
									<Label className="text-xs text-muted-foreground">
										Stop at Position
									</Label>
									<Input
										value={exercise.stopAtPosition ?? ""}
										onChange={(e) =>
											onUpdate({
												stopAtPosition: e.target.value || null,
											})
										}
										className="bg-background border-secondary text-white"
										placeholder="Lockout"
									/>
								</div>
							</div>

							<div className="flex items-center justify-between rounded-lg border border-secondary/70 bg-background/60 px-4 py-3">
								<div>
									<Label className="text-white">Stall Detection</Label>
									<p className="text-xs text-muted-foreground">
										Flag stalled reps in synced session playback.
									</p>
								</div>
								<Switch
									checked={exercise.stallDetection}
									onCheckedChange={(checked) =>
										onUpdate({ stallDetection: checked })
									}
								/>
							</div>
						</CollapsibleContent>
					</Collapsible>
				</div>
			</Card>
		</motion.div>
	);
}

function EmptyDetailPanel() {
	return (
		<motion.div
			initial={{ opacity: 0 }}
			animate={{ opacity: 1 }}
			exit={{ opacity: 0 }}
		>
			<Card className="p-6 bg-surface-2 border-secondary sticky top-24">
				<div className="text-center py-12">
					<Dumbbell className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
					<p className="text-muted-foreground">
						Select an exercise to configure
					</p>
				</div>
			</Card>
		</motion.div>
	);
}

function ExercisePickerModal({
	onClose,
	onSelect,
}: {
	onClose: () => void;
	onSelect: (exercise: {
		name: string;
		muscleGroup: string;
		exerciseId?: string | null;
	}) => void;
}) {
	const [searchQuery, setSearchQuery] = useState("");
	const [muscleFilter, setMuscleFilter] = useState<string | null>(null);

	// Fetch exercises from the exercise_catalog table
	const { data: catalogExercises, isLoading: catalogLoading } =
		useExerciseCatalog();

	const allExercises = useMemo(() => {
		return (catalogExercises ?? []).map((ex) => {
			return {
				name: ex.display_name,
				muscleGroup: ex.muscle_group,
				exerciseId: ex.id,
				equipment: ex.equipment,
				demoThumbnailUrl: ex.thumbnail_url ?? null,
				source: ex.source ?? null,
				license: ex.license ?? null,
				licenseAuthor: ex.license_author ?? null,
			};
		});
	}, [catalogExercises]);

	// Get unique muscle groups for filter buttons
	const muscleGroups = useMemo(() => {
		const groups = new Set(allExercises.map((e) => e.muscleGroup));
		return Array.from(groups).sort();
	}, [allExercises]);

	// Filter exercises by search and muscle group
	const filteredExercises = useMemo(() => {
		return allExercises.filter((ex) => {
			const matchesSearch =
				!searchQuery ||
				ex.name.toLowerCase().includes(searchQuery.toLowerCase());
			const matchesMuscle = !muscleFilter || ex.muscleGroup === muscleFilter;
			return matchesSearch && matchesMuscle;
		});
	}, [allExercises, searchQuery, muscleFilter]);

	return (
		<>
			<motion.div
				initial={{ opacity: 0 }}
				animate={{ opacity: 1 }}
				exit={{ opacity: 0 }}
				onClick={onClose}
				className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50"
			/>
			<motion.div
				initial={{ opacity: 0, scale: 0.95 }}
				animate={{ opacity: 1, scale: 1 }}
				exit={{ opacity: 0, scale: 0.95 }}
				className="fixed inset-4 md:inset-auto md:left-1/2 md:top-1/2 md:-translate-x-1/2 md:-translate-y-1/2 md:w-full md:max-w-2xl bg-background rounded-lg border border-secondary z-50 overflow-hidden flex flex-col max-h-[80vh]"
			>
				<div className="p-6 border-b border-secondary">
					<div className="flex items-center justify-between mb-4">
						<h2 className="text-xl font-semibold text-white">Add Exercise</h2>
						<Button size="sm" variant="ghost" onClick={onClose}>
							<X className="w-4 h-4" />
						</Button>
					</div>

					{/* Search */}
					<div className="relative mb-3">
						<Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
						<Input
							placeholder="Search exercises..."
							value={searchQuery}
							onChange={(e) => setSearchQuery(e.target.value)}
							className="pl-9 bg-surface-2 border-secondary text-white placeholder:text-muted"
						/>
					</div>

					{/* Muscle group filter */}
					<div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
						<Button
							size="sm"
							onClick={() => setMuscleFilter(null)}
							className={
								!muscleFilter
									? "bg-primary border-0 text-white flex-shrink-0"
									: "bg-secondary border-0 text-muted-foreground hover:bg-muted flex-shrink-0"
							}
						>
							All
						</Button>
						{muscleGroups.map((group) => (
							<Button
								key={group}
								size="sm"
								onClick={() =>
									setMuscleFilter(muscleFilter === group ? null : group)
								}
								className={
									muscleFilter === group
										? "bg-primary border-0 text-white flex-shrink-0"
										: "bg-secondary border-0 text-muted-foreground hover:bg-muted flex-shrink-0"
								}
							>
								{group}
							</Button>
						))}
					</div>
				</div>

				<div className="p-6 overflow-y-auto flex-1">
					{catalogLoading ? (
						<div className="flex items-center justify-center py-8 text-muted-foreground">
							<Loader2 className="w-6 h-6 animate-spin mr-2" />
							<p>Loading exercises...</p>
						</div>
					) : filteredExercises.length === 0 ? (
						<div className="text-center py-8 text-muted-foreground">
							<Dumbbell className="w-8 h-8 mx-auto mb-2 opacity-50" />
							<p>No exercises found</p>
						</div>
					) : (
						<div className="space-y-2">
							{filteredExercises.map((exercise) => (
								<button
									type="button"
									key={exercise.exerciseId ?? exercise.name}
									onClick={() => onSelect(exercise)}
									className="w-full p-4 rounded-lg bg-surface-2 border border-secondary hover:border-primary transition-all text-left"
								>
									<div className="flex items-center justify-between">
										<div className="flex min-w-0 items-center gap-3">
											{exercise.demoThumbnailUrl && (
												<div className="relative h-14 w-14 flex-shrink-0 overflow-hidden rounded-md border border-secondary bg-background">
													<img
														src={exercise.demoThumbnailUrl}
														alt={`Demo preview for ${exercise.name}`}
														loading="lazy"
														className="h-full w-full object-cover"
													/>
												</div>
											)}
											<div className="min-w-0">
												<h4 className="mb-1 truncate font-semibold text-white">
													{exercise.name}
												</h4>
												<div className="flex flex-wrap gap-1.5">
													<Badge className="bg-primary text-white border-0 text-xs">
														{exercise.muscleGroup}
													</Badge>
													{exercise.equipment.length > 0 && (
														<Badge className="bg-secondary text-muted-foreground border-0 text-xs">
															{formatEquipment(exercise.equipment)}
														</Badge>
													)}
												</div>
												{exercise.source === "wger" && (
													<p className="mt-1 text-[10px] text-muted-foreground">
														wger
														{exercise.licenseAuthor
															? ` · ${exercise.licenseAuthor}`
															: ""}
														{exercise.license ? ` · ${exercise.license}` : ""}
													</p>
												)}
											</div>
										</div>
										<Plus className="ml-3 h-5 w-5 flex-shrink-0 text-muted-foreground" />
									</div>
								</button>
							))}
						</div>
					)}
				</div>
			</motion.div>
		</>
	);
}
