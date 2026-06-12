import { Activity } from "lucide-react";
import { lazy, Suspense, useState } from "react";
import { Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { MobileChartCard } from "@/app/components/analytics/MobileChartCard";
import { BiomechanicsContent } from "@/app/components/Biomechanics";
import { MuscleRadar } from "@/app/components/charts/MuscleRadar";
import { RechartsTooltip } from "@/app/components/charts/shared/RechartsTooltip";
import { Card } from "@/app/components/ui/card";
import type { BodyMuscleFocusModel } from "@/lib/body-muscle-analytics";
import type { Recommendation } from "@/lib/recommendations";
import type { MuscleRecovery } from "@/lib/sra-recovery";
import { formatVolume, type WeightUnit } from "@/lib/units";
import { BodyMuscleHeatmap } from "./BodyMuscleHeatmap";

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

interface MuscleEntry {
	name: string;
	value: number;
	color: string;
	fill: string;
}

export interface MobileBodyTabProps {
	muscleGroupData: Array<{ name: string; value: number; color: string }>;
	muscleRadarData: Record<string, number>;
	mobileMusclData: MuscleEntry[];
	bodyMuscleModel: BodyMuscleFocusModel;
	// New props
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

export default function MobileBodyTab({
	muscleGroupData,
	muscleRadarData,
	mobileMusclData,
	bodyMuscleModel,
	weeklyVolume,
	totalSessions,
	muscleRecoveries,
	recommendations,
	unit,
}: MobileBodyTabProps) {
	const [selectedMuscleId, setSelectedMuscleId] = useState<string | null>(null);
	const [bodySide, setBodySide] = useState<"front" | "back">("front");
	const selectedMuscle = selectedMuscleId
		? (bodyMuscleModel.muscleById[selectedMuscleId] ?? null)
		: null;

	if (muscleGroupData.length === 0) {
		return (
			<div className="text-center py-12 text-muted-foreground">
				<Activity className="w-12 h-12 mx-auto mb-3 opacity-50" />
				<p className="font-medium mb-1">Body analysis coming soon</p>
				<p className="text-xs mb-4">
					Complete some workouts to see your muscle balance and body part
					analysis
				</p>
			</div>
		);
	}

	return (
		<>
			<MobileChartCard title="MUSCLE BALANCE">
				<MuscleRadar currentData={muscleRadarData} />
			</MobileChartCard>

			<MobileChartCard title="MUSCLE DISTRIBUTION">
				<ResponsiveContainer width="100%" height={200}>
					<PieChart>
						<Pie
							data={mobileMusclData}
							cx="50%"
							cy="50%"
							innerRadius={50}
							outerRadius={80}
							paddingAngle={2}
							dataKey="value"
							animationDuration={800}
							animationEasing="ease-out"
						/>
						<Tooltip content={<RechartsTooltip />} />
					</PieChart>
				</ResponsiveContainer>
				<div className="flex flex-wrap gap-2 mt-3 justify-center">
					{mobileMusclData.map((muscle) => (
						<div key={muscle.name} className="flex items-center gap-1 text-xs">
							<div
								className="w-3 h-3 rounded-full"
								style={{ backgroundColor: muscle.color }}
							/>
							<span className="text-muted-foreground">
								{muscle.name} {muscle.value}%
							</span>
						</div>
					))}
				</div>
			</MobileChartCard>

			<MobileChartCard title="DETAILED BODY LOAD">
				<div className="mb-3 flex items-center justify-between gap-2">
					<div className="flex overflow-hidden rounded-lg bg-muted/20">
						<button
							type="button"
							className={`px-3 py-1 text-xs ${bodySide === "front" ? "bg-primary text-white" : "text-muted-foreground"}`}
							onClick={() => setBodySide("front")}
						>
							Front
						</button>
						<button
							type="button"
							className={`px-3 py-1 text-xs ${bodySide === "back" ? "bg-primary text-white" : "text-muted-foreground"}`}
							onClick={() => setBodySide("back")}
						>
							Back
						</button>
					</div>
					{selectedMuscle && (
						<button
							type="button"
							className="text-xs text-primary"
							onClick={() => setSelectedMuscleId(null)}
						>
							Clear
						</button>
					)}
				</div>
				{bodyMuscleModel.muscles.length > 0 && (
					<BodyMuscleHeatmap
						model={bodyMuscleModel}
						side={bodySide}
						selectedMuscleId={selectedMuscleId}
						onSelectMuscle={(muscleId) =>
							setSelectedMuscleId((prev) =>
								prev === muscleId ? null : muscleId,
							)
						}
						className="h-[360px]"
					/>
				)}
				<div className="mt-4 space-y-2">
					{(selectedMuscle
						? [selectedMuscle]
						: bodyMuscleModel.muscles.slice(0, 8)
					).map((muscle) => (
						<button
							key={muscle.muscleId}
							type="button"
							className="w-full rounded-md border border-secondary bg-surface-2 p-3 text-left"
							onClick={() => setSelectedMuscleId(muscle.muscleId)}
						>
							<div className="flex items-center justify-between gap-3">
								<span className="text-sm text-white">{muscle.muscleName}</span>
								<span className="text-xs text-primary">
									{muscle.loadShare}%
								</span>
							</div>
							<div className="mt-1 flex gap-3 text-[11px] text-muted-foreground">
								<span>{muscle.totalReps.toFixed(0)} reps</span>
								<span>
									{muscle.totalVolumeKg > 0
										? formatVolume(muscle.totalVolumeKg, unit)
										: `${muscle.totalSets.toFixed(1)} set-load`}
								</span>
								{muscle.estimated && <span>estimated</span>}
							</div>
						</button>
					))}
				</div>
				{bodyMuscleModel.estimatedExerciseCount > 0 && (
					<p className="mt-3 text-xs text-muted-foreground">
						{bodyMuscleModel.estimatedExerciseCount} custom or unmatched{" "}
						{bodyMuscleModel.estimatedExerciseCount === 1
							? "exercise uses"
							: "exercises use"}{" "}
						estimated mapping.
					</p>
				)}
			</MobileChartCard>

			<Card className="p-4 border-secondary">
				<BiomechanicsContent view="biomechanics" />
			</Card>

			{/* Volume Landmarks */}
			<Suspense
				fallback={
					<div className="h-48 animate-pulse bg-surface-2 rounded-lg" />
				}
			>
				<VolumeLandmarks
					weeklyVolume={weeklyVolume}
					selectedMuscleGroup={null}
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
