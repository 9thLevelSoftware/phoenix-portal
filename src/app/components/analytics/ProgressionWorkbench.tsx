import { AlertTriangle, ArrowUpRight, Dumbbell, Target } from "lucide-react";
import { Button } from "@/app/components/ui/button";
import { Card } from "@/app/components/ui/card";
import type { ProgressionWorkbenchModel } from "@/lib/progression-workbench";
import type { WeightUnit } from "@/lib/units";

interface ProgressionWorkbenchProps {
	model: ProgressionWorkbenchModel;
	unit: WeightUnit;
	onSelectExercise: (exerciseName: string) => void;
}

function TrendSvg({
	points,
}: {
	points: NonNullable<ProgressionWorkbenchModel["selectedExercise"]>["points"];
}) {
	if (points.length < 2) {
		return (
			<div className="flex h-28 items-center justify-center text-sm text-muted-foreground">
				Need more sessions for a trend.
			</div>
		);
	}

	const width = 360;
	const height = 112;
	const values = points.map((point) => point.oneRm);
	const min = Math.min(...values);
	const max = Math.max(...values);
	const range = max - min || 1;
	const step = width / Math.max(points.length - 1, 1);
	const coordinates = points.map((point, index) => {
		const x = index * step;
		const y = height - ((point.oneRm - min) / range) * (height - 16) - 8;
		return `${x},${y}`;
	});

	return (
		<svg
			viewBox={`0 0 ${width} ${height}`}
			className="h-28 w-full overflow-visible"
			role="img"
			aria-label="Selected exercise one-rep max trend"
		>
			<polyline
				points={coordinates.join(" ")}
				fill="none"
				stroke="#FF6B35"
				strokeWidth="3"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
			{coordinates.map((coordinate, index) => {
				const [x, y] = coordinate.split(",").map(Number);
				return (
					<circle
						// biome-ignore lint/suspicious/noArrayIndexKey: point order is chronological and stable
						key={index}
						cx={x}
						cy={y}
						r="4"
						fill="#FF6B35"
					/>
				);
			})}
		</svg>
	);
}

export function ProgressionWorkbench({
	model,
	unit,
	onSelectExercise,
}: ProgressionWorkbenchProps) {
	const selected = model.selectedExercise;

	if (!selected) {
		return (
			<Card className="border-secondary bg-surface-2 p-6 text-sm text-muted-foreground">
				{model.emptyReason ?? "No exercise progress history is available yet."}
			</Card>
		);
	}

	const riskClass =
		selected.plateauRisk === "high"
			? "text-warning"
			: selected.plateauRisk === "medium"
				? "text-primary"
				: "text-success";

	return (
		<Card className="border-secondary bg-surface-2 p-6">
			<div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
				<div>
					<h3 className="text-xl text-white">Progression Workbench</h3>
					<p className="text-sm text-muted-foreground">
						1RM trend, phase-aware PRs, plateau risk, and next progression.
					</p>
				</div>
				<div className={`flex items-center gap-1.5 text-sm ${riskClass}`}>
					{selected.plateauRisk === "high" ? (
						<AlertTriangle className="size-4" aria-hidden="true" />
					) : (
						<ArrowUpRight className="size-4" aria-hidden="true" />
					)}
					<span className="capitalize">{selected.plateauRisk} risk</span>
				</div>
			</div>

			<div className="grid gap-5 lg:grid-cols-[220px_1fr]">
				<div className="flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible">
					{model.exercises.map((exercise) => (
						<Button
							key={exercise.exerciseName}
							type="button"
							variant={
								exercise.exerciseName === selected.exerciseName
									? "default"
									: "outline"
							}
							className="justify-start whitespace-nowrap lg:w-full"
							onClick={() => onSelectExercise(exercise.exerciseName)}
						>
							{exercise.exerciseName}
						</Button>
					))}
				</div>

				<div className="min-w-0 space-y-4">
					<div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
						<div>
							<h4 className="text-lg font-semibold text-white">
								{selected.exerciseName}
							</h4>
							<p className="text-sm text-muted-foreground">
								{selected.points.length} progress points
							</p>
						</div>
						<div className="text-right">
							<div className="text-2xl font-semibold text-white">
								{selected.currentOneRm} {unit}
							</div>
							<div className="text-xs text-muted-foreground">current 1RM</div>
						</div>
					</div>

					<div className="rounded-lg border border-secondary bg-background/50 p-3">
						<TrendSvg points={selected.points} />
					</div>

					<div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
						<div className="rounded-lg border border-secondary bg-muted/10 p-3">
							<div className="mb-1 flex items-center gap-1.5 text-xs text-muted-foreground">
								<ArrowUpRight className="size-3.5" aria-hidden="true" />
								<span>Gain rate</span>
							</div>
							<div className="text-lg font-semibold text-white">
								{selected.gainRatePctPer30Days}%
							</div>
						</div>
						<div className="rounded-lg border border-secondary bg-muted/10 p-3">
							<div className="mb-1 flex items-center gap-1.5 text-xs text-muted-foreground">
								<Target className="size-3.5" aria-hidden="true" />
								<span>Phase PRs</span>
							</div>
							<div className="text-lg font-semibold text-white">
								{selected.phasePrCount}
							</div>
						</div>
						<div className="col-span-2 rounded-lg border border-primary/30 bg-primary/5 p-3">
							<div className="mb-1 flex items-center gap-1.5 text-xs text-primary">
								<Dumbbell className="size-3.5" aria-hidden="true" />
								<span>{selected.recommendation.label}</span>
							</div>
							<div className="text-sm text-muted-foreground">
								{selected.recommendation.description}
							</div>
						</div>
					</div>
				</div>
			</div>
		</Card>
	);
}
