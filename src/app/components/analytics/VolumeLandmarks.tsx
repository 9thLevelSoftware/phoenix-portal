import { AlertTriangle, CheckCircle, TrendingDown } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { Card } from "@/app/components/ui/card";
import type { Recommendation } from "@/lib/recommendations";
import {
	classifyVolumeStatus,
	VOLUME_LANDMARKS,
	type VolumeStatus,
} from "@/lib/volume-landmarks";

// --- Props ---

export interface VolumeLandmarksProps {
	weeklyVolume: Record<string, number>;
	selectedMuscleGroup: string | null;
	recommendations?: Recommendation[];
	totalSessions?: number;
}

// --- Constants ---

const STATUS_COLORS: Record<VolumeStatus, string> = {
	below_mev: "#F59E0B",
	between_mev_mav: "#60A5FA",
	in_mav: "#10B981",
	above_mav: "#60A5FA",
	above_mrv: "#DC2626",
};

const VOLUME_SIGNAL_TYPES = new Set(["volume_above_mrv", "volume_below_mev"]);

// --- Helpers ---

function getBarColor(status: VolumeStatus | null): string {
	if (!status) return "#60A5FA";
	return STATUS_COLORS[status];
}

interface RecommendationCalloutProps {
	recommendation: Recommendation;
}

function RecommendationCallout({ recommendation }: RecommendationCalloutProps) {
	const isCritical = recommendation.priority === "critical";
	const borderColor = isCritical ? "#DC2626" : "#F59E0B";
	const bgColor = isCritical ? "rgba(220,38,38,0.08)" : "rgba(245,158,11,0.08)";

	return (
		<div
			className="flex items-start gap-3 rounded-md px-3 py-2 text-sm"
			style={{
				borderLeft: `2px solid ${borderColor}`,
				backgroundColor: bgColor,
			}}
		>
			<span className="mt-0.5 shrink-0">
				{isCritical ? (
					<AlertTriangle
						className="w-4 h-4"
						style={{ color: borderColor }}
						aria-hidden="true"
					/>
				) : (
					<TrendingDown
						className="w-4 h-4"
						style={{ color: borderColor }}
						aria-hidden="true"
					/>
				)}
			</span>
			<div className="min-w-0">
				<p className="font-medium text-white leading-snug">
					{recommendation.title}
				</p>
				<p className="text-muted-foreground text-xs mt-0.5">
					{recommendation.action}
				</p>
			</div>
		</div>
	);
}

// --- Main component ---

export function VolumeLandmarks({
	weeklyVolume,
	selectedMuscleGroup,
	recommendations = [],
	totalSessions,
}: VolumeLandmarksProps) {
	const isEmpty =
		Object.keys(weeklyVolume).length === 0 ||
		Object.values(weeklyVolume).every((v) => v === 0);

	const volumeRecos = recommendations.filter((r) =>
		VOLUME_SIGNAL_TYPES.has(r.signal),
	);

	// The scale max is the highest MRV across all landmarks, used as 100% width.
	const maxMrv = Math.max(...VOLUME_LANDMARKS.map((l) => l.mrv));

	return (
		<Card className="p-6 bg-surface-2 border-secondary">
			<div className="flex items-center justify-between mb-5">
				<h3 className="text-xl text-white">Weekly Volume Landmarks</h3>
				{typeof totalSessions === "number" && totalSessions < 3 && (
					<span className="text-xs text-amber-400 bg-amber-400/10 border border-amber-400/20 rounded px-2 py-1">
						Accuracy improves with more training history
					</span>
				)}
			</div>

			{isEmpty ? (
				<div className="py-10 text-center text-muted-foreground text-sm">
					No workouts this week — train to see your volume status
				</div>
			) : (
				<>
					{/* Legend */}
					<div className="flex flex-wrap gap-x-4 gap-y-1 mb-5 text-xs text-muted-foreground">
						<span className="flex items-center gap-1.5">
							<span
								className="inline-block w-2 h-2 rounded-full"
								style={{ backgroundColor: "#F59E0B" }}
							/>
							Below MEV
						</span>
						<span className="flex items-center gap-1.5">
							<span
								className="inline-block w-2 h-2 rounded-full"
								style={{ backgroundColor: "#60A5FA" }}
							/>
							MEV → MAV
						</span>
						<span className="flex items-center gap-1.5">
							<span
								className="inline-block w-2 h-2 rounded-full"
								style={{ backgroundColor: "#10B981" }}
							/>
							In MAV (optimal)
						</span>
						<span className="flex items-center gap-1.5">
							<span
								className="inline-block w-2 h-2 rounded-full"
								style={{ backgroundColor: "#DC2626" }}
							/>
							Above MRV
						</span>
					</div>

					{/* Muscle group rows */}
					<div className="space-y-3">
						{VOLUME_LANDMARKS.map((landmark) => {
							const sets = weeklyVolume[landmark.muscleGroup] ?? 0;
							const status = classifyVolumeStatus(landmark.muscleGroup, sets);
							const barColor = getBarColor(status);
							const isSelected = selectedMuscleGroup === landmark.muscleGroup;
							const isDimmed = selectedMuscleGroup !== null && !isSelected;

							// Marker positions as % of maxMrv
							const pct = (v: number) => Math.min((v / maxMrv) * 100, 100);
							const barWidthPct = Math.min((sets / maxMrv) * 100, 100);

							const isOptimal = status === "in_mav";
							const isOutOfRange =
								status === "below_mev" || status === "above_mrv";

							return (
								<div
									key={landmark.muscleGroup}
									className="flex items-center gap-3 transition-opacity duration-200"
									style={{ opacity: isDimmed ? 0.5 : 1 }}
									data-testid={`muscle-row-${landmark.muscleGroup.toLowerCase()}`}
								>
									{/* Muscle group name */}
									<span
										className="text-sm text-white shrink-0 text-right"
										style={{ width: 70 }}
									>
										{landmark.muscleGroup}
									</span>

									{/* Bar track */}
									<div className="relative flex-1 h-5 bg-muted/20 rounded overflow-visible">
										{/* MAV zone green shading */}
										<div
											className="absolute top-0 bottom-0 rounded"
											style={{
												left: `${pct(landmark.mavLow)}%`,
												width: `${pct(landmark.mavHigh) - pct(landmark.mavLow)}%`,
												backgroundColor: "rgba(16,185,129,0.15)",
											}}
											aria-hidden="true"
										/>

										{/* Threshold markers */}
										{[
											{ value: landmark.mev, label: "MEV" },
											{ value: landmark.mavLow, label: "MAVₗ" },
											{ value: landmark.mavHigh, label: "MAVₕ" },
											{ value: landmark.mrv, label: "MRV" },
										].map(({ value, label }) => (
											<div
												key={label}
												className="absolute top-0 bottom-0 w-px bg-white/20"
												style={{ left: `${pct(value)}%` }}
												aria-hidden="true"
												title={`${label}: ${value}`}
											/>
										))}

										{/* Filled bar — animated width */}
										<AnimatePresence initial={false}>
											<motion.div
												key={`${landmark.muscleGroup}-bar`}
												className="absolute top-0 bottom-0 left-0 rounded"
												initial={{ width: 0 }}
												animate={{ width: `${barWidthPct}%` }}
												transition={{ duration: 0.5, ease: "easeOut" }}
												style={{ backgroundColor: barColor }}
												aria-hidden="true"
											/>
										</AnimatePresence>
									</div>

									{/* Set count */}
									<span
										className="text-sm font-medium shrink-0 w-7 text-right"
										style={{ color: barColor }}
									>
										{sets}
									</span>

									{/* Status icon */}
									<span className="shrink-0 w-4">
										{isOptimal && (
											<CheckCircle
												className="w-4 h-4"
												style={{ color: "#10B981" }}
												aria-label="Optimal volume"
											/>
										)}
										{isOutOfRange && (
											<AlertTriangle
												className="w-4 h-4"
												style={{ color: barColor }}
												aria-label="Volume out of range"
											/>
										)}
									</span>
								</div>
							);
						})}
					</div>

					{/* Inline recommendation callouts */}
					{volumeRecos.length > 0 && (
						<div
							className="mt-5 space-y-2"
							data-testid="volume-recommendations"
						>
							{volumeRecos.map((reco) => (
								<RecommendationCallout key={reco.id} recommendation={reco} />
							))}
						</div>
					)}
				</>
			)}
		</Card>
	);
}
