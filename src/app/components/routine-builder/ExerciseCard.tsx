import { Check, Edit, GripVertical, X } from "lucide-react";
import { motion } from "motion/react";
import { Badge } from "@/app/components/ui/badge";
import { Button } from "@/app/components/ui/button";
import { Card } from "@/app/components/ui/card";
import type { RoutineExercise } from "./superset-types";

interface ExerciseCardProps {
	exercise: RoutineExercise;
	onEdit: () => void;
	onRemove: () => void;
	isDragging?: boolean;
	isSelectionMode?: boolean;
	isSelected?: boolean;
	onToggleSelect?: () => void;
}

export function ExerciseCard({
	exercise,
	onEdit,
	onRemove,
	isDragging = false,
	isSelectionMode = false,
	isSelected = false,
	onToggleSelect,
}: ExerciseCardProps) {
	const handleCardClick = () => {
		if (isSelectionMode && onToggleSelect) {
			onToggleSelect();
		}
	};

	return (
		<motion.div
			whileHover={!isSelectionMode ? { scale: 1.01 } : undefined}
			whileTap={isSelectionMode ? { scale: 0.98 } : undefined}
			className={isDragging ? "opacity-50" : ""}
		>
			<Card
				onClick={handleCardClick}
				className={`p-4 bg-gradient-to-br from-surface-2 to-background border transition-all ${
					isSelectionMode ? "cursor-pointer" : ""
				} ${
					isSelected
						? "border-primary bg-primary/10"
						: "border-secondary hover:border-primary/50"
				}`}
			>
				<div className="flex items-center justify-between">
					{/* Left Side: Drag/Checkbox + Exercise Info */}
					<div className="flex items-center gap-3 flex-1 min-w-0">
						{/* Drag Handle or Checkbox */}
						<div className="flex-shrink-0">
							{isSelectionMode ? (
								<div
									className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-all ${
										isSelected
											? "bg-primary border-primary"
											: "border-muted hover:border-muted-foreground"
									}`}
								>
									{isSelected && <Check className="w-3 h-3 text-white" />}
								</div>
							) : (
								<GripVertical className="w-5 h-5 text-muted cursor-grab active:cursor-grabbing" />
							)}
						</div>

						{/* Exercise Info */}
						<div className="flex-1 min-w-0">
							<div className="flex items-center gap-2 mb-1 flex-wrap">
								<h4 className="font-semibold text-white truncate">
									{exercise.exerciseName}
								</h4>
								<Badge
									variant="outline"
									className="text-xs border-secondary text-muted-foreground flex-shrink-0"
								>
									{exercise.muscleGroup}
								</Badge>
							</div>
							<div className="text-sm text-muted">
								{exercise.sets.length} sets • {exercise.sets[0]?.reps || 0} reps
								• {exercise.sets[0]?.weight || 0} kg • {exercise.programMode}
							</div>
						</div>
					</div>

					{/* Right Side: Action Buttons */}
					{!isSelectionMode && (
						<div className="flex items-center gap-2 ml-4">
							<Button
								size="sm"
								variant="ghost"
								onClick={(e) => {
									e.stopPropagation();
									onEdit();
								}}
								className="text-muted-foreground hover:text-white"
							>
								<Edit className="w-4 h-4" />
							</Button>
							<Button
								size="sm"
								variant="ghost"
								onClick={(e) => {
									e.stopPropagation();
									onRemove();
								}}
								className="text-destructive hover:text-chart-2"
							>
								<X className="w-4 h-4" />
							</Button>
						</div>
					)}
				</div>
			</Card>
		</motion.div>
	);
}
