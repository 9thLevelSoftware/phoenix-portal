import {
	CheckSquare,
	ChevronLeft,
	Loader2,
	Plus,
	Save,
	Square,
} from "lucide-react";
import { AnimatePresence } from "motion/react";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/app/components/ui/badge";
import { Button } from "@/app/components/ui/button";
import { Card } from "@/app/components/ui/card";
import { Input } from "@/app/components/ui/input";
import { useSaveRoutine } from "@/mutations/routines";
import { ExerciseCard } from "./routine-builder/ExerciseCard";
import { SelectionModeBar } from "./routine-builder/SelectionModeBar";
import { SupersetContainer } from "./routine-builder/SupersetContainer";
import {
	getNextSupersetColor,
	type RoutineExercise,
	type Superset,
} from "./routine-builder/superset-types";

interface RoutineBuilderEnhancedProps {
	routineId?: string;
	onBack: () => void;
	onSave: (routine: any) => void;
}

export function RoutineBuilderEnhanced({
	routineId,
	onBack,
	onSave,
}: RoutineBuilderEnhancedProps) {
	const saveMutation = useSaveRoutine();
	const [routineName, setRoutineName] = useState("Untitled Routine");
	const [exercises, setExercises] = useState<RoutineExercise[]>([]);
	const [showExercisePicker, setShowExercisePicker] = useState(false);

	const [supersets, setSupersets] = useState<Superset[]>([]);
	const [isSelectionMode, setIsSelectionMode] = useState(false);
	const [selectedExerciseIds, setSelectedExerciseIds] = useState<string[]>([]);
	const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
	const [editingExerciseId, setEditingExerciseId] = useState<string | null>(
		null,
	);

	const handleToggleSelectionMode = () => {
		setIsSelectionMode(!isSelectionMode);
		setSelectedExerciseIds([]);
	};

	const handleToggleSelect = (exerciseId: string) => {
		setSelectedExerciseIds((prev) =>
			prev.includes(exerciseId)
				? prev.filter((id) => id !== exerciseId)
				: [...prev, exerciseId],
		);
	};

	const handleCreateSuperset = () => {
		if (selectedExerciseIds.length < 2) return;

		const newSuperset: Superset = {
			id: `superset-${Date.now()}`,
			color: getNextSupersetColor(supersets),
			restAfter: 90,
			exerciseIds: selectedExerciseIds,
		};

		// Update exercises with superset info
		const updatedExercises = exercises.map((ex, _index) => {
			if (selectedExerciseIds.includes(ex.id)) {
				const supersetOrder = selectedExerciseIds.indexOf(ex.id);
				return {
					...ex,
					supersetId: newSuperset.id,
					supersetOrder,
					transitionTime:
						supersetOrder < selectedExerciseIds.length - 1 ? 10 : undefined,
				};
			}
			return ex;
		});

		setExercises(updatedExercises);
		setSupersets([...supersets, newSuperset]);
		setSelectedExerciseIds([]);
		setIsSelectionMode(false);
		setHasUnsavedChanges(true);
		toast.success("Superset created");
	};

	const handleUngroupSuperset = (supersetId: string) => {
		// Remove superset
		setSupersets(supersets.filter((s) => s.id !== supersetId));

		// Update exercises
		const updatedExercises = exercises.map((ex) => {
			if (ex.supersetId === supersetId) {
				const {
					supersetId: _,
					supersetOrder: __,
					transitionTime: ___,
					...rest
				} = ex;
				return { ...rest, restTime: ex.restTime || 90 };
			}
			return ex;
		});

		setExercises(updatedExercises);
		setHasUnsavedChanges(true);
		toast.info("Superset ungrouped");
	};

	const handleUpdateTransitionTime = (exerciseId: string, time: number) => {
		setExercises(
			exercises.map((ex) =>
				ex.id === exerciseId ? { ...ex, transitionTime: time } : ex,
			),
		);
		setHasUnsavedChanges(true);
	};

	const handleUpdateSupsersetRest = (supersetId: string, time: number) => {
		setSupersets(
			supersets.map((s) =>
				s.id === supersetId ? { ...s, restAfter: time } : s,
			),
		);
		setHasUnsavedChanges(true);
	};

	const handleRemoveExercise = (exerciseId: string) => {
		setExercises(exercises.filter((ex) => ex.id !== exerciseId));
		setHasUnsavedChanges(true);
	};

	const handleEditExercise = (exerciseId: string) => {
		setEditingExerciseId(editingExerciseId === exerciseId ? null : exerciseId);
	};

	const handleSave = () => {
		// Build exercise payload for the mutation
		const exercisePayload = exercises.map((ex, i) => ({
			name: ex.exerciseName,
			muscle_group: ex.muscleGroup,
			sets: ex.sets.length,
			reps: ex.sets[0]?.reps ?? 10,
			weight: ex.sets[0]?.weight ?? 0,
			rest_seconds: ex.restTime,
			mode: ex.programMode,
			order_index: i,
		}));

		saveMutation.mutate(
			{
				name: routineName,
				description: "",
				exercises: exercisePayload,
			},
			{
				onSuccess: () => {
					setHasUnsavedChanges(false);
					// Also call the parent callback for compatibility
					onSave({
						id: routineId || `routine-${Date.now()}`,
						name: routineName,
						exercises,
						supersets,
					});
				},
			},
		);
	};

	const handleAddExercise = () => {
		setShowExercisePicker(true);
	};

	// Group exercises by superset or individual
	const exerciseGroups: Array<{
		type: "superset" | "exercise";
		id: string;
		data: any;
	}> = [];
	const processedExerciseIds = new Set<string>();

	supersets.forEach((superset) => {
		exerciseGroups.push({ type: "superset", id: superset.id, data: superset });
		superset.exerciseIds.forEach((id) => processedExerciseIds.add(id));
	});

	exercises.forEach((exercise) => {
		if (!processedExerciseIds.has(exercise.id)) {
			exerciseGroups.push({
				type: "exercise",
				id: exercise.id,
				data: exercise,
			});
		}
	});

	return (
		<div className="min-h-screen bg-background pb-8">
			{/* Sticky Top Bar */}
			<div className="sticky top-0 z-40 bg-background/95 backdrop-blur-lg border-b border-secondary px-4 py-4">
				<div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
					<div className="flex items-center gap-4 flex-1 min-w-0">
						<Button
							variant="ghost"
							size="sm"
							onClick={onBack}
							className="text-muted-foreground hover:text-white"
						>
							<ChevronLeft className="w-5 h-5 mr-1" />
							Back
						</Button>

						<Input
							value={routineName}
							onChange={(e) => {
								setRoutineName(e.target.value);
								setHasUnsavedChanges(true);
							}}
							className="text-xl font-semibold bg-transparent border-none focus:ring-0 max-w-md"
							placeholder="Routine Name"
						/>

						{hasUnsavedChanges && (
							<Badge
								variant="outline"
								className="bg-accent/20 text-accent border-accent/30"
							>
								Unsaved
							</Badge>
						)}
					</div>

					<div className="flex items-center gap-3">
						<Button
							onClick={handleSave}
							disabled={saveMutation.isPending}
							className="bg-gradient-to-r from-primary to-chart-2 hover:from-chart-2 hover:to-accent border-0"
						>
							{saveMutation.isPending ? (
								<Loader2 className="w-4 h-4 mr-2 animate-spin" />
							) : (
								<Save className="w-4 h-4 mr-2" />
							)}
							{saveMutation.isPending ? "Saving..." : "Save"}
						</Button>
					</div>
				</div>
			</div>

			{/* Main Content */}
			<div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
				{/* Exercises Section */}
				<Card className="p-6 bg-gradient-to-br from-surface-2 to-background border-secondary">
					<div className="flex items-center justify-between mb-6">
						<h2 className="text-xl font-semibold text-white">
							EXERCISES ({exercises.length})
						</h2>

						<div className="flex items-center gap-3">
							<Button
								size="sm"
								variant={isSelectionMode ? "default" : "outline"}
								onClick={handleToggleSelectionMode}
								className={
									isSelectionMode
										? "bg-primary hover:bg-chart-2 border-0"
										: "border-secondary hover:border-primary"
								}
							>
								{isSelectionMode ? (
									<>
										<CheckSquare className="w-4 h-4 mr-2" />
										Done
									</>
								) : (
									<>
										<Square className="w-4 h-4 mr-2" />
										Select
									</>
								)}
							</Button>

							<Button
								size="sm"
								onClick={handleAddExercise}
								className="bg-primary hover:bg-chart-2 border-0"
							>
								<Plus className="w-4 h-4 mr-2" />
								Add Exercise
							</Button>
						</div>
					</div>

					{/* Exercise List */}
					<div className="space-y-4">
						<AnimatePresence>
							{exerciseGroups.map((group) => {
								if (group.type === "superset") {
									const superset = group.data as Superset;
									return (
										<SupersetContainer
											key={group.id}
											superset={superset}
											exercises={exercises}
											onUpdateTransitionTime={handleUpdateTransitionTime}
											onUpdateRestAfter={(time) =>
												handleUpdateSupsersetRest(superset.id, time)
											}
											onUngroup={() => handleUngroupSuperset(superset.id)}
											onRemoveExercise={handleRemoveExercise}
											onEditExercise={handleEditExercise}
											onAddExercise={handleAddExercise}
										/>
									);
								} else {
									const exercise = group.data as RoutineExercise;
									return (
										<ExerciseCard
											key={group.id}
											exercise={exercise}
											onEdit={() => handleEditExercise(exercise.id)}
											onRemove={() => handleRemoveExercise(exercise.id)}
											isSelectionMode={isSelectionMode}
											isSelected={selectedExerciseIds.includes(exercise.id)}
											onToggleSelect={() => handleToggleSelect(exercise.id)}
										/>
									);
								}
							})}
						</AnimatePresence>

						{exercises.length === 0 && (
							<div className="text-center py-12 text-muted">
								<p className="mb-4">No exercises yet</p>
								<Button
									onClick={handleAddExercise}
									variant="outline"
									className="border-secondary hover:border-primary"
								>
									<Plus className="w-4 h-4 mr-2" />
									Add Your First Exercise
								</Button>
							</div>
						)}
					</div>
				</Card>
			</div>

			{/* Selection Mode Bar */}
			<SelectionModeBar
				selectedCount={selectedExerciseIds.length}
				onCreateSuperset={handleCreateSuperset}
				onCancel={() => {
					setIsSelectionMode(false);
					setSelectedExerciseIds([]);
				}}
			/>
		</div>
	);
}
