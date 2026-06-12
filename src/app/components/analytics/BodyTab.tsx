import { AnimatePresence, motion } from "motion/react";
import { lazy, Suspense, useState } from "react";
import { MuscleRadar } from "@/app/components/charts/MuscleRadar";
import { EChartsWrapper } from "@/app/components/charts/shared/EChartsWrapper";
import { Badge } from "@/app/components/ui/badge";
import { Card } from "@/app/components/ui/card";
import type {
	BodyMuscleContribution,
	BodyMuscleFocusModel,
} from "@/lib/body-muscle-analytics";
import type { Recommendation } from "@/lib/recommendations";
import type { MuscleRecovery } from "@/lib/sra-recovery";
import { formatVolume, type WeightUnit } from "@/lib/units";
import { BodyMuscleHeatmap } from "./BodyMuscleHeatmap";

const ExerciseDeepDive = lazy(() =>
	import("./ExerciseDeepDive").then((m) => ({ default: m.ExerciseDeepDive })),
);
const VolumeLandmarks = lazy(() =>
	import("./VolumeLandmarks").then((m) => ({ default: m.VolumeLandmarks })),
);
const SraRecoveryMatrix = lazy(() =>
	import("./SraRecoveryMatrix").then((m) => ({
		default: m.SraRecoveryMatrix,
	})),
);
const RecommendationsPanel = lazy(() =>
	import("./RecommendationsPanel").then((m) => ({
		default: m.RecommendationsPanel,
	})),
);

type ChartOption = Record<string, unknown>;

interface MuscleGroupEntry {
	name: string;
	value: number;
	color: string;
}

export interface BodyTabProps {
	muscleGroupData: MuscleGroupEntry[];
	muscleDonutOption: ChartOption | null;
	muscleRadarData: Record<string, number>;
	bodyMuscleModel: BodyMuscleFocusModel;
	weeklyVolume: Record<string, number>;
	totalSessions: number;
	muscleRecoveries: MuscleRecovery[];
	recommendations: Recommendation[];
	exercisesByMuscle: Record<
		string,
		Array<{ name: string; sessionCount: number }>
	>;
	userId: string;
	unit: WeightUnit;
	profileId?: string | null;
}

export default function BodyTab({
	muscleGroupData,
	muscleDonutOption,
	muscleRadarData,
	bodyMuscleModel,
	weeklyVolume,
	totalSessions,
	muscleRecoveries,
	recommendations,
	exercisesByMuscle,
	userId,
	unit,
	profileId,
}: BodyTabProps) {
	const [bodySide, setBodySide] = useState<"front" | "back">("front");
	const [selectedMuscleId, setSelectedMuscleId] = useState<string | null>(null);
	const selectedMuscle = selectedMuscleId
		? (bodyMuscleModel.muscleById[selectedMuscleId] ?? null)
		: null;
	const selectedMuscleGroup = selectedMuscle
		? toCanonicalMuscleGroup(selectedMuscle.group)
		: null;

	return (
		<>
			<div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
				{/* Muscle Balance Radar */}
				<Card className="p-6 bg-surface-2 border-secondary">
					<h3 className="text-xl text-white mb-6">Muscle Balance Radar</h3>
					{muscleGroupData.length > 0 ? (
						<MuscleRadar currentData={muscleRadarData} />
					) : (
						<div className="h-[300px] flex items-center justify-center text-muted-foreground">
							No muscle data yet
						</div>
					)}
				</Card>

				{/* Muscle Distribution Donut */}
				<Card className="p-6 bg-surface-2 border-secondary">
					<h3 className="text-xl text-white mb-6">Muscle Distribution</h3>
					{muscleDonutOption ? (
						<EChartsWrapper option={muscleDonutOption} height={300} />
					) : (
						<div className="h-[300px] flex items-center justify-center text-muted-foreground">
							No muscle group data yet
						</div>
					)}
				</Card>
			</div>

			{/* Muscle Group Breakdown Table */}
			<Card className="p-6 bg-surface-2 border-secondary">
				<h3 className="text-xl text-white mb-6">Muscle Group Breakdown</h3>
				{muscleGroupData.length > 0 ? (
					<div className="overflow-x-auto">
						<table className="w-full text-sm">
							<thead>
								<tr className="border-b border-secondary text-muted-foreground">
									<th className="text-left py-2 px-3 font-medium">
										Muscle Group
									</th>
									<th className="text-right py-2 px-3 font-medium">Volume %</th>
									<th className="text-left py-2 px-3 font-medium w-1/2">
										Distribution
									</th>
								</tr>
							</thead>
							<tbody>
								{[...muscleGroupData]
									.sort((a, b) => b.value - a.value)
									.map((muscle) => (
										<tr
											key={muscle.name}
											className="border-b border-secondary/50"
										>
											<td className="py-3 px-3">
												<div className="flex items-center gap-2">
													<div
														className="w-3 h-3 rounded-full shrink-0"
														style={{
															backgroundColor: muscle.color,
														}}
													/>
													<span className="text-white">{muscle.name}</span>
												</div>
											</td>
											<td
												className="text-right py-3 px-3 font-medium"
												style={{ color: muscle.color }}
											>
												{muscle.value}%
											</td>
											<td className="py-3 px-3">
												<div className="h-2 w-full rounded-full bg-muted/20 overflow-hidden">
													<div
														className="h-full rounded-full transition-all duration-500"
														style={{
															width: `${muscle.value}%`,
															backgroundColor: muscle.color,
														}}
													/>
												</div>
											</td>
										</tr>
									))}
							</tbody>
						</table>
					</div>
				) : (
					<div className="text-center py-12 text-muted-foreground">
						No body part data yet
					</div>
				)}
			</Card>

			{/* Interactive Body Heatmap */}
			<Card className="p-6 bg-surface-2 border-secondary">
				<div className="flex justify-between items-center mb-6">
					<h3 className="text-xl text-white">Body Overview</h3>
					<div className="flex items-center gap-3">
						{selectedMuscleGroup && (
							<button
								type="button"
								className="text-xs text-primary hover:text-white transition-colors"
								onClick={() => setSelectedMuscleId(null)}
							>
								Clear selection
							</button>
						)}
						<div className="flex bg-muted/20 rounded-lg overflow-hidden">
							<button
								type="button"
								className={`px-3 py-1 text-sm transition-colors ${bodySide === "front" ? "bg-primary text-white" : "text-muted-foreground hover:text-white"}`}
								onClick={() => setBodySide("front")}
							>
								Front
							</button>
							<button
								type="button"
								className={`px-3 py-1 text-sm transition-colors ${bodySide === "back" ? "bg-primary text-white" : "text-muted-foreground hover:text-white"}`}
								onClick={() => setBodySide("back")}
							>
								Back
							</button>
						</div>
					</div>
				</div>
				<div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_420px] gap-6">
					<div>
						{bodyMuscleModel.muscles.length > 0 ? (
							<BodyMuscleHeatmap
								model={bodyMuscleModel}
								side={bodySide}
								selectedMuscleId={selectedMuscleId}
								onSelectMuscle={(muscleId) =>
									setSelectedMuscleId((prev) =>
										prev === muscleId ? null : muscleId,
									)
								}
							/>
						) : (
							<div className="h-[420px] flex items-center justify-center text-muted-foreground">
								No detailed body data yet
							</div>
						)}
						<div className="flex justify-center gap-1 mt-4">
							{["#334155", "#FACC15", "#FB923C", "#F97316", "#DC2626"].map(
								(c) => (
									<div
										key={c}
										className="w-10 h-2 rounded"
										style={{ backgroundColor: c }}
									/>
								),
							)}
						</div>
						<div className="flex justify-between text-xs text-muted-foreground mt-1 px-4">
							<span>Low contribution</span>
							<span>High contribution</span>
						</div>
						{bodyMuscleModel.estimatedExerciseCount > 0 && (
							<p className="mt-3 text-xs text-muted-foreground text-center">
								{bodyMuscleModel.estimatedExerciseCount} custom or unmatched{" "}
								{bodyMuscleModel.estimatedExerciseCount === 1
									? "exercise uses"
									: "exercises use"}{" "}
								estimated six-group mapping.
							</p>
						)}
					</div>

					<SelectedMuscleContribution
						muscle={selectedMuscle}
						topMuscles={bodyMuscleModel.muscles.slice(0, 8)}
						unit={unit}
						onSelectMuscle={setSelectedMuscleId}
					/>
				</div>
			</Card>

			{/* Exercise Deep-Dive (slides in when muscle selected) */}
			<AnimatePresence>
				{selectedMuscleGroup && exercisesByMuscle[selectedMuscleGroup] && (
					<motion.div
						key={selectedMuscleGroup}
						initial={{ opacity: 0, height: 0 }}
						animate={{ opacity: 1, height: "auto" }}
						exit={{ opacity: 0, height: 0 }}
						transition={{ duration: 0.3 }}
					>
						<Suspense
							fallback={
								<div className="h-64 animate-pulse bg-surface-2 rounded-lg" />
							}
						>
							<ExerciseDeepDive
								muscleGroup={selectedMuscleGroup}
								exercises={exercisesByMuscle[selectedMuscleGroup] ?? []}
								userId={userId}
								unit={unit}
								profileId={profileId}
							/>
						</Suspense>
					</motion.div>
				)}
			</AnimatePresence>

			{/* Volume Landmarks */}
			<Suspense
				fallback={
					<div className="h-48 animate-pulse bg-surface-2 rounded-lg" />
				}
			>
				<VolumeLandmarks
					weeklyVolume={weeklyVolume}
					selectedMuscleGroup={selectedMuscleGroup}
					recommendations={recommendations}
					totalSessions={totalSessions}
				/>
			</Suspense>

			{/* SRA Recovery Matrix (self-gates for INFERNO) */}
			<Suspense
				fallback={
					<div className="h-48 animate-pulse bg-surface-2 rounded-lg" />
				}
			>
				<SraRecoveryMatrix
					recoveries={muscleRecoveries}
					recommendations={recommendations}
				/>
			</Suspense>

			{/* Recommendations Panel (self-gates for INFERNO) */}
			<Suspense
				fallback={
					<div className="h-24 animate-pulse bg-surface-2 rounded-lg" />
				}
			>
				<RecommendationsPanel recommendations={recommendations} />
			</Suspense>
		</>
	);
}

function toCanonicalMuscleGroup(group: string): string | null {
	const map: Record<string, string> = {
		Chest: "Chest",
		Back: "Back",
		Shoulders: "Shoulders",
		Arms: "Arms",
		Legs: "Legs",
		Abdominals: "Core",
	};
	return map[group] ?? null;
}

function formatLoad(valueKg: number, fallbackSets: number, unit: WeightUnit) {
	if (valueKg > 0) return formatVolume(valueKg, unit);
	return `${fallbackSets.toFixed(1)} set-load`;
}

function SelectedMuscleContribution({
	muscle,
	topMuscles,
	unit,
	onSelectMuscle,
}: {
	muscle: BodyMuscleContribution | null;
	topMuscles: BodyMuscleContribution[];
	unit: WeightUnit;
	onSelectMuscle: (muscleId: string) => void;
}) {
	if (!muscle) {
		return (
			<div className="rounded-lg border border-secondary bg-muted/10 p-4">
				<p className="text-sm font-medium text-white mb-3">
					Ranked muscle contributions
				</p>
				<div className="space-y-2">
					{topMuscles.length > 0 ? (
						topMuscles.map((item) => (
							<button
								type="button"
								key={item.muscleId}
								onClick={() => onSelectMuscle(item.muscleId)}
								className="w-full rounded-md border border-secondary/60 bg-surface-2 px-3 py-2 text-left transition-colors hover:border-primary/60"
							>
								<div className="flex items-center justify-between gap-3">
									<span className="text-sm text-white">{item.muscleName}</span>
									<span className="text-xs text-primary tabular-nums">
										{item.loadShare}%
									</span>
								</div>
								<div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted/20">
									<div
										className="h-full rounded-full bg-primary"
										style={{ width: `${Math.min(100, item.loadShare)}%` }}
									/>
								</div>
							</button>
						))
					) : (
						<p className="py-8 text-center text-sm text-muted-foreground">
							Complete a workout to populate detailed muscle contributions.
						</p>
					)}
				</div>
			</div>
		);
	}

	return (
		<div
			className="rounded-lg border border-secondary bg-muted/10 p-4"
			data-testid="selected-muscle-contribution"
		>
			<div className="flex items-start justify-between gap-3">
				<div>
					<p className="text-sm text-muted-foreground">Selected muscle</p>
					<h4 className="text-lg font-semibold text-white">
						{muscle.muscleName}
					</h4>
				</div>
				{muscle.estimated && (
					<Badge variant="outline" className="text-[10px]">
						Estimated
					</Badge>
				)}
			</div>

			<div className="grid grid-cols-3 gap-2 my-4">
				<div className="rounded-md bg-surface-2 p-2">
					<p className="text-[10px] uppercase text-muted-foreground">Load</p>
					<p className="text-sm font-semibold text-white">
						{formatLoad(muscle.totalVolumeKg, muscle.totalSets, unit)}
					</p>
				</div>
				<div className="rounded-md bg-surface-2 p-2">
					<p className="text-[10px] uppercase text-muted-foreground">Reps</p>
					<p className="text-sm font-semibold text-white">
						{muscle.totalReps.toFixed(0)}
					</p>
				</div>
				<div className="rounded-md bg-surface-2 p-2">
					<p className="text-[10px] uppercase text-muted-foreground">Share</p>
					<p className="text-sm font-semibold text-white">
						{muscle.loadShare}%
					</p>
				</div>
			</div>

			<div className="space-y-2 max-h-[360px] overflow-y-auto pr-1">
				{muscle.exercises.map((exercise) => (
					<div
						key={`${exercise.sessionId}-${exercise.exerciseId}`}
						className="rounded-md border border-secondary/50 bg-surface-2 p-3"
					>
						<div className="flex items-start justify-between gap-3">
							<div className="min-w-0">
								<p className="truncate text-sm font-medium text-white">
									{exercise.exerciseName}
								</p>
								<p className="text-[11px] text-muted-foreground">
									{exercise.date
										? exercise.date.toLocaleDateString("en-US", {
												month: "short",
												day: "numeric",
											})
										: "Date unavailable"}
								</p>
							</div>
							<span className="text-xs text-primary tabular-nums">
								{exercise.shareOfMuscleLoad}%
							</span>
						</div>
						<div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
							<span>{exercise.allocatedSets.toFixed(1)} sets</span>
							<span>{exercise.allocatedReps.toFixed(0)} reps</span>
							<span>
								{formatLoad(
									exercise.allocatedVolumeKg,
									exercise.allocatedSets,
									unit,
								)}
							</span>
							{exercise.estimated && (
								<span className="text-amber-300">estimated mapping</span>
							)}
						</div>
					</div>
				))}
			</div>
		</div>
	);
}
