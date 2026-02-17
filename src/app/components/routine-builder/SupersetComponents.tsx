import { ArrowDown, Edit, GripVertical, Plus, Unlink, X } from "lucide-react";
import { motion } from "motion/react";
import { Badge } from "@/app/components/ui/badge";
import { Button } from "@/app/components/ui/button";
import { Card } from "@/app/components/ui/card";
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import type { SupersetGroup } from "./superset-helpers";
import { PHOENIX } from "@/lib/colors";

interface SupersetCardProps {
	superset: SupersetGroup;
	exercises: Array<{
		id: string;
		name: string;
		muscleGroup: string;
		sets: number;
		reps: number;
		weight: number;
	}>;
	onUpdateTransition: (time: number) => void;
	onUpdateRest: (time: number) => void;
	onUngroup: () => void;
	onRemoveExercise: (exerciseId: string) => void;
	onEditExercise: (exerciseId: string) => void;
	onAddExercise: () => void;
}

export function SupersetCard({
	superset,
	exercises,
	onUpdateTransition,
	onUpdateRest,
	onUngroup,
	onRemoveExercise,
	onEditExercise,
	onAddExercise,
}: SupersetCardProps) {
	const supersetExercises = exercises.filter((ex) =>
		superset.exerciseIds.includes(ex.id),
	);
	const colorLabel =
		["A", "B", "C", "D"][
			["#6366F1", "#EC4899", PHOENIX.forgeGreen, PHOENIX.gold].indexOf(superset.color)
		] || "A";

	return (
		<Card
			className="p-4 bg-gradient-to-br from-surface-2 to-background border-l-4 relative"
			style={{ borderLeftColor: superset.color }}
		>
			{/* Superset Header */}
			<div className="flex items-center justify-between mb-4">
				<div className="flex items-center gap-2">
					<GripVertical className="w-5 h-5 text-muted cursor-grab active:cursor-grabbing" />
					<Badge
						className="text-white border-0"
						style={{ backgroundColor: superset.color }}
					>
						Superset {colorLabel}
					</Badge>
					<span className="text-xs text-muted">
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
						<div className="p-3 bg-background rounded-lg border border-secondary hover:border-primary transition-all">
							<div className="flex items-center justify-between">
								<div className="flex-1">
									<div className="flex items-center gap-2 mb-1">
										<GripVertical className="w-4 h-4 text-muted" />
										<span className="font-semibold text-white">
											{exercise.name}
										</span>
										<Badge
											variant="outline"
											className="text-xs border-secondary text-muted-foreground"
										>
											{exercise.muscleGroup}
										</Badge>
									</div>
									<div className="text-sm text-muted ml-6">
										{exercise.sets} sets • {exercise.reps} reps •{" "}
										{exercise.weight} kg
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
										onClick={() => onRemoveExercise(exercise.id)}
										className="text-destructive hover:text-chart-2"
									>
										<X className="w-4 h-4" />
									</Button>
								</div>
							</div>
						</div>

						{/* Transition Arrow */}
						{index < supersetExercises.length - 1 && (
							<div className="flex items-center justify-center my-2">
								<div className="flex items-center gap-2 text-xs text-muted">
									<ArrowDown className="w-4 h-4" />
									<span>Transition: {superset.transitionTime}s</span>
								</div>
							</div>
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
				Add to Superset
			</Button>

			{/* Superset Settings */}
			<div className="mt-4 pt-4 border-t border-secondary grid grid-cols-2 gap-4">
				<div>
					<Label className="text-xs text-muted-foreground mb-2">
						Transition Time (s)
					</Label>
					<div className="flex items-center gap-2">
						<Button
							size="sm"
							variant="outline"
							onClick={() =>
								onUpdateTransition(Math.max(0, superset.transitionTime - 5))
							}
							className="border-secondary"
						>
							−
						</Button>
						<Input
							type="number"
							value={superset.transitionTime}
							onChange={(e) =>
								onUpdateTransition(parseInt(e.target.value, 10) || 10)
							}
							className="text-center bg-background border-secondary h-8"
						/>
						<Button
							size="sm"
							variant="outline"
							onClick={() => onUpdateTransition(superset.transitionTime + 5)}
							className="border-secondary"
						>
							+
						</Button>
					</div>
				</div>

				<div>
					<Label className="text-xs text-muted-foreground mb-2">Rest After (s)</Label>
					<div className="flex items-center gap-2">
						<Button
							size="sm"
							variant="outline"
							onClick={() => onUpdateRest(Math.max(0, superset.restAfter - 15))}
							className="border-secondary"
						>
							−
						</Button>
						<Input
							type="number"
							value={superset.restAfter}
							onChange={(e) => onUpdateRest(parseInt(e.target.value, 10) || 90)}
							className="text-center bg-background border-secondary h-8"
						/>
						<Button
							size="sm"
							variant="outline"
							onClick={() => onUpdateRest(superset.restAfter + 15)}
							className="border-secondary"
						>
							+
						</Button>
					</div>
				</div>
			</div>
		</Card>
	);
}

interface SelectionModeBarProps {
	selectedCount: number;
	onCreateSuperset: () => void;
	onCancel: () => void;
}

export function SelectionModeBar({
	selectedCount,
	onCreateSuperset,
	onCancel,
}: SelectionModeBarProps) {
	return (
		<motion.div
			initial={{ y: 100, opacity: 0 }}
			animate={{ y: 0, opacity: 1 }}
			exit={{ y: 100, opacity: 0 }}
			className="fixed bottom-24 md:bottom-8 left-1/2 -translate-x-1/2 z-50"
		>
			<Card className="px-6 py-4 bg-gradient-to-br from-surface-2 to-background border-primary shadow-2xl">
				<div className="flex items-center gap-4">
					<div className="text-sm text-white">
						✓ <span className="font-semibold">{selectedCount}</span> exercises
						selected
					</div>

					<div className="h-6 w-px bg-secondary" />

					<Button
						onClick={onCreateSuperset}
						disabled={selectedCount < 2}
						className="bg-gradient-to-r from-primary to-chart-2 hover:from-chart-2 hover:to-accent border-0 disabled:opacity-50"
					>
						Create Superset
					</Button>

					<Button
						onClick={onCancel}
						variant="ghost"
						className="text-muted-foreground hover:text-white"
					>
						Cancel
					</Button>
				</div>
			</Card>
		</motion.div>
	);
}
