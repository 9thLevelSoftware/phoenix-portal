import { ArrowDown, Edit, GripVertical, Plus, Unlink, X } from "lucide-react";
import { motion } from "motion/react";
import { useState } from "react";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { formatWeight, type WeightUnit } from "@/lib/units";
import {
	getSupersetColorHex,
	getSupersetLabel,
	type RoutineExercise,
	type Superset,
} from "./superset-types";

interface SupersetContainerProps {
	superset: Superset;
	exercises: RoutineExercise[];
	onUpdateTransitionTime: (exerciseId: string, time: number) => void;
	onUpdateRestAfter: (time: number) => void;
	onUngroup: () => void;
	onRemoveExercise: (exerciseId: string) => void;
	onEditExercise: (exerciseId: string) => void;
	onAddExercise: () => void;
	isDragging?: boolean;
	unit?: WeightUnit;
}

export function SupersetContainer({
	superset,
	exercises,
	onUpdateTransitionTime,
	onUpdateRestAfter,
	onUngroup,
	onRemoveExercise,
	onEditExercise,
	onAddExercise,
	isDragging = false,
	unit = "kg",
}: SupersetContainerProps) {
	const supersetExercises = exercises
		.filter((ex) => superset.exerciseIds.includes(ex.id))
		.sort((a, b) => (a.supersetOrder || 0) - (b.supersetOrder || 0));

	const colorHex = getSupersetColorHex(superset.color);
	const label = getSupersetLabel(superset.color);

	return (
		<motion.div
			initial={{ opacity: 0, scale: 0.95 }}
			animate={{ opacity: 1, scale: 1 }}
			exit={{ opacity: 0, scale: 0.95 }}
			className={`relative rounded-lg border-l-4 p-4 transition-all ${isDragging ? "opacity-50" : ""}`}
			style={{
				borderLeftColor: colorHex,
				backgroundColor: `${colorHex}08`,
				borderTop: "1px solid #374151",
				borderRight: "1px solid #374151",
				borderBottom: "1px solid #374151",
			}}
		>
			{/* Superset Header */}
			<div className="flex items-center justify-between mb-4">
				<div className="flex items-center gap-2">
					<GripVertical className="w-5 h-5 text-muted-foreground cursor-grab active:cursor-grabbing" />
					<div
						className="text-sm font-bold px-2 py-1 rounded"
						style={{
							color: colorHex,
							backgroundColor: `${colorHex}20`,
						}}
					>
						SUPERSET {label}
					</div>
					<span className="text-xs text-muted-foreground">
						{supersetExercises.length} exercises
					</span>
				</div>

				<Button
					size="sm"
					variant="ghost"
					onClick={onUngroup}
					className="text-muted-foreground hover:text-white"
				>
					<Unlink className="w-4 h-4 mr-1" />
					Ungroup
				</Button>
			</div>

			{/* Exercises in Superset */}
			<div className="space-y-3">
				{supersetExercises.map((exercise, index) => (
					<div key={exercise.id}>
						{/* Exercise Card */}
						<div className="p-3 bg-background rounded-lg border border-secondary hover:border-primary transition-all">
							<div className="flex items-center justify-between">
								<div className="flex-1 flex items-center gap-3">
									<GripVertical className="w-4 h-4 text-muted-foreground cursor-grab active:cursor-grabbing" />
									<div className="flex-1">
										<div className="flex items-center gap-2 mb-1">
											<span className="font-semibold text-white">
												{exercise.exerciseName}
											</span>
											<span className="text-xs px-2 py-0.5 rounded bg-secondary text-muted-foreground">
												{exercise.muscleGroup}
											</span>
										</div>
										<div className="text-sm text-muted-foreground">
											{exercise.sets.length} sets •{" "}
											{exercise.sets[0]?.reps || 0} reps •{" "}
											{formatWeight(exercise.sets[0]?.weight ?? 0, unit)} •{" "}
											{exercise.programMode}
										</div>
									</div>
								</div>

								<div className="flex items-center gap-2">
									<Button
										size="sm"
										variant="ghost"
										onClick={() => onEditExercise(exercise.id)}
										className="text-muted-foreground hover:text-white"
									>
										<Edit className="w-4 h-4" />
									</Button>
									<Button
										size="sm"
										variant="ghost"
										onClick={() =>
											// A superset needs at least two exercises. Removing one
											// from a two-exercise group would leave an invalid
											// single-exercise superset, so ungroup instead.
											supersetExercises.length <= 2
												? onUngroup()
												: onRemoveExercise(exercise.id)
										}
										className="text-destructive hover:text-chart-2"
										title={
											supersetExercises.length <= 2
												? "Removing this exercise will ungroup the superset"
												: "Remove exercise from superset"
										}
									>
										<X className="w-4 h-4" />
									</Button>
								</div>
							</div>
						</div>

						{/* Transition Indicator */}
						{index < supersetExercises.length - 1 && (
							<TransitionIndicator
								time={exercise.transitionTime || 10}
								onUpdate={(time) => onUpdateTransitionTime(exercise.id, time)}
							/>
						)}
					</div>
				))}
			</div>

			{/* Add Exercise to Superset */}
			<Button
				size="sm"
				variant="outline"
				onClick={onAddExercise}
				className="w-full mt-3 border-dashed border-secondary text-muted-foreground hover:border-primary hover:text-white"
			>
				<Plus className="w-4 h-4 mr-2" />
				Add Exercise to Superset
			</Button>

			{/* Footer Controls */}
			<div className="mt-4 pt-4 border-t border-secondary flex items-center justify-between">
				<div className="flex items-center gap-2">
					<span className="text-sm text-muted-foreground">
						Rest after superset:
					</span>
					<Button
						size="sm"
						variant="outline"
						onClick={() =>
							onUpdateRestAfter(Math.max(0, superset.restAfter - 15))
						}
						className="border-secondary h-8 w-8 p-0"
					>
						−
					</Button>
					<Input
						type="number"
						value={superset.restAfter}
						onChange={(e) => {
							// Preserve an explicit 0; only fall back to the default when the
							// field is cleared or non-numeric.
							const raw = e.target.value;
							const parsed = parseInt(raw, 10);
							onUpdateRestAfter(
								raw === "" || !Number.isFinite(parsed)
									? 90
									: Math.max(0, parsed),
							);
						}}
						className="w-16 text-center bg-background border-secondary h-8"
					/>
					<span className="text-sm text-muted-foreground">s</span>
					<Button
						size="sm"
						variant="outline"
						onClick={() => onUpdateRestAfter(superset.restAfter + 15)}
						className="border-secondary h-8 w-8 p-0"
					>
						+
					</Button>
				</div>
			</div>
		</motion.div>
	);
}

function TransitionIndicator({
	time,
	onUpdate,
}: {
	time: number;
	onUpdate: (time: number) => void;
}) {
	const [isEditing, setIsEditing] = useState(false);

	return (
		<div className="flex items-center justify-center my-2">
			<div className="flex items-center gap-2 text-xs text-muted-foreground">
				<ArrowDown className="w-4 h-4" />
				{isEditing ? (
					<div className="flex items-center gap-1">
						<Button
							size="sm"
							variant="ghost"
							onClick={() => onUpdate(Math.max(0, time - 5))}
							className="h-6 w-6 p-0"
						>
							−
						</Button>
						<Input
							type="number"
							value={time}
							onChange={(e) => {
								const raw = e.target.value;
								const parsed = parseInt(raw, 10);
								onUpdate(
									raw === "" || !Number.isFinite(parsed)
										? 10
										: Math.max(0, parsed),
								);
							}}
							onBlur={() => setIsEditing(false)}
							className="w-12 text-center h-6 text-xs bg-background border-secondary"
							autoFocus
						/>
						<Button
							size="sm"
							variant="ghost"
							onClick={() => onUpdate(time + 5)}
							className="h-6 w-6 p-0"
						>
							+
						</Button>
						<span>s transition</span>
					</div>
				) : (
					<button
						type="button"
						onClick={() => setIsEditing(true)}
						className="hover:text-muted-foreground transition-colors"
					>
						{time}s transition
					</button>
				)}
			</div>
		</div>
	);
}
