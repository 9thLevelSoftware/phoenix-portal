import { X } from "lucide-react";
import { motion } from "motion/react";
import { Button } from "@/app/components/ui/button";
import { Card } from "@/app/components/ui/card";
import type { CycleDay } from "./types";

interface DayCardProps {
	day: CycleDay;
	onClick: () => void;
	onSetRest: () => void;
	onRemove?: () => void;
	isSelected: boolean;
}

export function DayCard({
	day,
	onClick,
	onSetRest,
	onRemove,
	isSelected,
}: DayCardProps) {
	// Empty State
	if (day.type === "workout" && !day.routineId) {
		return (
			<motion.div
				whileHover={{ scale: 1.02 }}
				whileTap={{ scale: 0.98 }}
				className={`relative min-w-[180px] cursor-pointer ${
					isSelected ? "ring-2 ring-primary" : ""
				}`}
			>
				<Card
					onClick={onClick}
					className="p-4 border-2 border-dashed border-secondary hover:border-primary bg-gradient-to-br from-surface-2/50 to-background transition-all"
				>
					<div className="text-center mb-3">
						<div className="text-sm font-semibold text-muted-foreground">
							Day {day.dayNumber}
						</div>
					</div>

					<div className="text-center space-y-3 py-4">
						<div className="w-12 h-12 mx-auto rounded-full border-2 border-dashed border-secondary flex items-center justify-center text-2xl text-muted-foreground">
							+
						</div>
						<div className="text-sm text-muted-foreground">Add Routine</div>
					</div>

					<button
						type="button"
						onClick={(e) => {
							e.stopPropagation();
							onSetRest();
						}}
						className="w-full text-xs text-muted-foreground hover:text-muted-foreground transition-colors mt-2"
					>
						Mark as Rest Day
					</button>
				</Card>

				{onRemove && day.dayNumber > 1 && (
					<button
						type="button"
						onClick={(e) => {
							e.stopPropagation();
							onRemove();
						}}
						className="absolute -top-2 -right-2 p-1 bg-destructive hover:bg-chart-2 rounded-full transition-colors"
					>
						<X className="w-3 h-3 text-white" />
					</button>
				)}
			</motion.div>
		);
	}

	// Workout State
	if (day.type === "workout" && day.routineId) {
		return (
			<motion.div
				whileHover={{ scale: 1.02 }}
				whileTap={{ scale: 0.98 }}
				className={`relative min-w-[180px] cursor-pointer ${
					isSelected ? "ring-2 ring-primary" : ""
				}`}
			>
				<Card
					onClick={onClick}
					className="p-4 bg-gradient-to-br from-primary/10 to-chart-2/5 border-l-4 border-l-[#FF6B35] border-r border-t border-b border-secondary hover:border-primary/50 transition-all"
				>
					<div className="text-center mb-3">
						<div className="text-sm font-semibold text-muted-foreground">
							Day {day.dayNumber}
						</div>
					</div>

					<div className="text-center space-y-2">
						<div className="text-3xl">🏋️</div>
						<div className="font-semibold text-white text-sm line-clamp-2 min-h-[2.5rem]">
							{day.routineName}
						</div>
						<div className="text-xs text-muted-foreground space-y-1">
							<div>{day.exerciseCount} exercises</div>
							<div>~{day.duration} min</div>
						</div>
					</div>

					<div className="flex gap-2 mt-3">
						<Button
							size="sm"
							variant="ghost"
							onClick={(e) => {
								e.stopPropagation();
								onClick();
							}}
							className="flex-1 text-xs text-muted-foreground hover:text-white h-7"
						>
							Change
						</Button>
					</div>
				</Card>

				{onRemove && day.dayNumber > 1 && (
					<button
						type="button"
						onClick={(e) => {
							e.stopPropagation();
							onRemove();
						}}
						className="absolute -top-2 -right-2 p-1 bg-destructive hover:bg-chart-2 rounded-full transition-colors"
					>
						<X className="w-3 h-3 text-white" />
					</button>
				)}
			</motion.div>
		);
	}

	// Rest State
	return (
		<motion.div
			whileHover={{ scale: 1.02 }}
			whileTap={{ scale: 0.98 }}
			className={`relative min-w-[180px] cursor-pointer ${
				isSelected ? "ring-2 ring-primary" : ""
			}`}
		>
			<Card
				onClick={onClick}
				className="p-4 bg-gradient-to-br from-secondary/20 to-background border-secondary hover:border-muted-foreground transition-all"
			>
				<div className="text-center mb-3">
					<div className="text-sm font-semibold text-muted-foreground">
						Day {day.dayNumber}
					</div>
				</div>

				<div className="text-center space-y-2 py-4">
					<div className="text-4xl">🛋️</div>
					<div className="font-semibold text-muted-foreground">REST</div>
					<div className="text-xs text-muted-foreground capitalize">
						{day.restType || "complete"} rest
					</div>
				</div>

				<button
					type="button"
					onClick={(e) => {
						e.stopPropagation();
						onClick();
					}}
					className="w-full text-xs text-muted-foreground hover:text-muted-foreground transition-colors mt-2"
				>
					Convert to Workout
				</button>
			</Card>

			{onRemove && day.dayNumber > 1 && (
				<button
					type="button"
					onClick={(e) => {
						e.stopPropagation();
						onRemove();
					}}
					className="absolute -top-2 -right-2 p-1 bg-destructive hover:bg-chart-2 rounded-full transition-colors"
				>
					<X className="w-3 h-3 text-white" />
				</button>
			)}
		</motion.div>
	);
}
