import { AnimatePresence, motion } from "motion/react";
import { lazy, Suspense, useState } from "react";
import MuscleHighlighter, {
	type ExtendedBodyPart,
} from "react-muscle-highlighter";
import { MuscleRadar } from "@/app/components/charts/MuscleRadar";
import { EChartsWrapper } from "@/app/components/charts/shared/EChartsWrapper";
import { Card } from "@/app/components/ui/card";
import type { Recommendation } from "@/lib/recommendations";
import type { MuscleRecovery } from "@/lib/sra-recovery";
import type { WeightUnit } from "@/lib/units";

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
	muscleHighlighterData: ExtendedBodyPart[];
	muscleSlugToGroup: Record<string, string>;
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
	muscleHighlighterData,
	muscleSlugToGroup,
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
	const [selectedMuscleGroup, setSelectedMuscleGroup] = useState<string | null>(
		null,
	);

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
								onClick={() => setSelectedMuscleGroup(null)}
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
				<div className="flex justify-center">
					<MuscleHighlighter
						data={muscleHighlighterData}
						side={bodySide}
						gender="male"
						scale={1.5}
						border="none"
						defaultFill="#2a2a2a"
						defaultStroke="#444"
						defaultStrokeWidth={0.5}
						colors={[
							"#FF6B3520",
							"#FF6B3550",
							"#FF6B3580",
							"#FF6B35B0",
							"#FF6B35",
						]}
						onBodyPartPress={(part) => {
							if (part.slug) {
								const group = muscleSlugToGroup[part.slug] ?? null;
								setSelectedMuscleGroup((prev) =>
									prev === group ? null : group,
								);
							}
						}}
					/>
				</div>
				<div className="flex justify-center gap-1 mt-4">
					{["#FF6B3520", "#FF6B3550", "#FF6B3580", "#FF6B35B0", "#FF6B35"].map(
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
					<span>Low volume</span>
					<span>High volume</span>
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
