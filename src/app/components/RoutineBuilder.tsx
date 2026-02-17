import { move } from "@dnd-kit/helpers";
import { DragDropProvider } from "@dnd-kit/react";
import { useSortable } from "@dnd-kit/react/sortable";
import { useQuery } from "@tanstack/react-query";
import {
	ArrowLeft,
	Dumbbell,
	Edit,
	Eye,
	GripVertical,
	Loader2,
	Plus,
	Save,
	X,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { Badge } from "@/app/components/ui/badge";
import { Button } from "@/app/components/ui/button";
import { Card } from "@/app/components/ui/card";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/app/components/ui/dialog";
import { Input } from "@/app/components/ui/input";
import { UnsavedChangesDialog } from "@/app/components/ui/unsaved-changes-dialog";
import { useSaveRoutine, useUpdateRoutine } from "@/mutations/routines";
import { useAuth } from "@/providers/AuthProvider";
import { routineDetailOptions } from "@/queries/routines";

interface Exercise {
	id: string;
	name: string;
	muscleGroup: string;
	sets: number;
	reps: number;
	weight: number;
	rest: number;
	mode: string;
}

export function RoutineBuilder() {
	const { routineId } = useParams<{ routineId: string }>();
	const navigate = useNavigate();
	const { user } = useAuth();
	const saveMutation = useSaveRoutine();
	const updateMutation = useUpdateRoutine();
	const isEditing = !!routineId;

	// Fetch existing routine for editing
	const { data: existingRoutine, isLoading: isLoadingRoutine } = useQuery({
		...routineDetailOptions(routineId ?? ""),
		enabled: !!routineId,
	});

	const [routineName, setRoutineName] = useState("Untitled Routine");
	const [exercises, setExercises] = useState<Exercise[]>([]);
	const [selectedExercise, setSelectedExercise] = useState<string | null>(
		null,
	);
	const [showExercisePicker, setShowExercisePicker] = useState(false);
	const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
	const [showUnsavedDialog, setShowUnsavedDialog] = useState(false);
	const [showPreview, setShowPreview] = useState(false);

	// Populate form state from existing routine
	useEffect(() => {
		if (existingRoutine) {
			setRoutineName(existingRoutine.name);
			setExercises(
				existingRoutine.routine_exercises.map((ex) => ({
					id: ex.id,
					name: ex.name,
					muscleGroup: ex.muscle_group,
					sets: ex.sets,
					reps: ex.reps,
					weight: ex.weight,
					rest: ex.rest_seconds,
					mode: ex.mode,
				})),
			);
		}
	}, [existingRoutine]);

	const handleDragEnd = (event: { canceled: boolean }) => {
		if (!event.canceled) {
			setExercises((items) => move(items, event as any));
			setHasUnsavedChanges(true);
		}
	};

	const handleDeleteExercise = (id: string) => {
		setExercises(exercises.filter((ex) => ex.id !== id));
		if (selectedExercise === id) {
			setSelectedExercise(null);
		}
		setHasUnsavedChanges(true);
	};

	const buildExercisePayload = () =>
		exercises.map((ex, i) => ({
			name: ex.name,
			muscle_group: ex.muscleGroup,
			sets: ex.sets,
			reps: ex.reps,
			weight: ex.weight,
			rest_seconds: ex.rest,
			mode: ex.mode,
			order_index: i,
		}));

	const handleSave = () => {
		const payload = {
			name: routineName,
			description: "",
			exercises: buildExercisePayload(),
		};

		if (isEditing && routineId) {
			updateMutation.mutate(
				{ ...payload, routineId },
				{ onSuccess: () => setHasUnsavedChanges(false) },
			);
		} else {
			saveMutation.mutate(payload, {
				onSuccess: () => setHasUnsavedChanges(false),
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

	const totalDuration = exercises.reduce((sum, ex) => {
		return sum + ex.sets * 2.5 + ((ex.sets - 1) * ex.rest) / 60;
	}, 0);

	if (isEditing && isLoadingRoutine) {
		return (
			<div className="min-h-screen bg-background flex items-center justify-center">
				<div className="flex flex-col items-center gap-4">
					<Loader2 className="w-8 h-8 text-primary animate-spin" />
					<p className="text-muted-foreground">Loading routine...</p>
				</div>
			</div>
		);
	}

	return (
		<div className="min-h-screen bg-background pb-24 md:pb-8">
			{/* Top Bar */}
			<div className="bg-gradient-to-b from-surface-2 to-background border-b border-secondary sticky top-0 z-50 backdrop-blur-xl">
				<div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
					<div className="flex items-center justify-between">
						<Button
							variant="outline"
							size="sm"
							onClick={handleBackClick}
							className="border-secondary text-muted-foreground hover:border-primary hover:text-primary"
						>
							<ArrowLeft className="w-4 h-4 mr-2" />
							Cancel
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
								className="text-xl font-semibold bg-transparent border-none text-white focus-visible:ring-0 w-64 text-center"
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
								className="bg-gradient-to-r from-primary to-chart-2 hover:from-chart-2 hover:to-accent border-0"
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
						</div>

						<DragDropProvider onDragEnd={handleDragEnd}>
							<div className="space-y-3">
								{exercises.map((exercise, index) => (
									<SortableExerciseItem
										key={exercise.id}
										exercise={exercise}
										index={index}
										isSelected={selectedExercise === exercise.id}
										onSelect={() => setSelectedExercise(exercise.id)}
										onDelete={() => handleDeleteExercise(exercise.id)}
									/>
								))}
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
							{selectedExercise ? (
								<ExerciseDetailPanel
									exercise={exercises.find((ex) => ex.id === selectedExercise)!}
									onUpdate={(updated) => {
										setExercises(
											exercises.map((ex) =>
												ex.id === selectedExercise ? { ...ex, ...updated } : ex,
											),
										);
										setHasUnsavedChanges(true);
									}}
									onClose={() => setSelectedExercise(null)}
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
								id: Date.now().toString(),
								...exercise,
								sets: 3,
								reps: 10,
								weight: 0,
								rest: 90,
								mode: "Old School",
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
										{ex.sets}x{ex.reps} @ {ex.weight}kg
									</div>
								</div>
							))}
						</div>
					</div>
				</DialogContent>
			</Dialog>
		</div>
	);
}

function SortableExerciseItem({
	exercise,
	index,
	isSelected,
	onSelect,
	onDelete,
}: {
	exercise: Exercise;
	index: number;
	isSelected: boolean;
	onSelect: () => void;
	onDelete: () => void;
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
				className={`p-4 bg-gradient-to-br from-surface-2 to-background border-secondary hover:border-primary/50 cursor-pointer transition-all ${
					isSelected ? "border-primary ring-1 ring-primary" : ""
				}`}
			>
				<div className="flex items-center gap-3">
					<button
						ref={handleRef}
						className="cursor-grab active:cursor-grabbing text-muted hover:text-muted-foreground"
					>
						<GripVertical className="w-5 h-5" />
					</button>

					<div className="flex-1">
						<div className="flex items-center gap-2 mb-1">
							<h3 className="font-semibold text-white">{exercise.name}</h3>
							<Badge
								className={`${getMuscleGroupColor(exercise.muscleGroup)} text-white border-0 text-xs`}
							>
								{exercise.muscleGroup}
							</Badge>
						</div>
						<p className="text-sm text-muted-foreground">
							{exercise.sets} sets • {exercise.reps} reps • {exercise.weight} kg
							• {exercise.mode}
						</p>
						<p className="text-xs text-muted mt-1">
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
}: {
	exercise: Exercise;
	onUpdate: (updates: Partial<Exercise>) => void;
	onClose: () => void;
}) {
	return (
		<motion.div
			initial={{ opacity: 0, x: 20 }}
			animate={{ opacity: 1, x: 0 }}
			exit={{ opacity: 0, x: 20 }}
		>
			<Card className="p-6 bg-gradient-to-br from-surface-2 to-background border-secondary sticky top-24">
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
					{/* Sets Configuration */}
					<div>
						<label className="text-sm font-medium text-secondary-foreground mb-3 block">
							Sets
						</label>
						<div className="space-y-2">
							{Array.from({ length: exercise.sets }).map((_, i) => (
								<div key={i} className="grid grid-cols-3 gap-2 text-sm">
									<Input
										type="number"
										value={exercise.reps}
										onChange={(e) =>
											onUpdate({ reps: parseInt(e.target.value, 10) || 0 })
										}
										className="bg-background border-secondary text-white"
										placeholder="Reps"
									/>
									<Input
										type="number"
										value={exercise.weight}
										onChange={(e) =>
											onUpdate({ weight: parseInt(e.target.value, 10) || 0 })
										}
										className="bg-background border-secondary text-white"
										placeholder="kg"
									/>
									<Input
										type="number"
										value={exercise.rest}
										onChange={(e) =>
											onUpdate({ rest: parseInt(e.target.value, 10) || 0 })
										}
										className="bg-background border-secondary text-white"
										placeholder="Rest"
									/>
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

					{/* Training Mode */}
					<div>
						<label className="text-sm font-medium text-secondary-foreground mb-2 block">
							Training Mode
						</label>
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
						<p className="text-xs text-muted mt-1">
							Traditional resistance training
						</p>
					</div>
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
			<Card className="p-6 bg-gradient-to-br from-surface-2 to-background border-secondary sticky top-24">
				<div className="text-center py-12">
					<Dumbbell className="w-12 h-12 text-muted mx-auto mb-4" />
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
	onSelect: (exercise: { name: string; muscleGroup: string }) => void;
}) {
	const exercises = [
		{ name: "Bench Press", muscleGroup: "Chest" },
		{ name: "Squat", muscleGroup: "Legs" },
		{ name: "Deadlift", muscleGroup: "Back" },
		{ name: "Overhead Press", muscleGroup: "Shoulders" },
		{ name: "Barbell Row", muscleGroup: "Back" },
		{ name: "Pull-ups", muscleGroup: "Back" },
	];

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
				className="fixed inset-4 md:inset-auto md:left-1/2 md:top-1/2 md:-translate-x-1/2 md:-translate-y-1/2 md:w-full md:max-w-2xl bg-background rounded-lg border border-secondary z-50 overflow-hidden"
			>
				<div className="p-6 border-b border-secondary">
					<div className="flex items-center justify-between">
						<h2 className="text-xl font-semibold text-white">Add Exercise</h2>
						<Button size="sm" variant="ghost" onClick={onClose}>
							<X className="w-4 h-4" />
						</Button>
					</div>
				</div>

				<div className="p-6 max-h-96 overflow-y-auto">
					<div className="space-y-2">
						{exercises.map((exercise) => (
							<button
								key={exercise.name}
								onClick={() => onSelect(exercise)}
								className="w-full p-4 rounded-lg bg-surface-2 border border-secondary hover:border-primary transition-all text-left"
							>
								<div className="flex items-center justify-between">
									<div>
										<h4 className="font-semibold text-white mb-1">
											{exercise.name}
										</h4>
										<Badge className="bg-primary text-white border-0 text-xs">
											{exercise.muscleGroup}
										</Badge>
									</div>
									<Plus className="w-5 h-5 text-muted-foreground" />
								</div>
							</button>
						))}
					</div>
				</div>
			</motion.div>
		</>
	);
}
