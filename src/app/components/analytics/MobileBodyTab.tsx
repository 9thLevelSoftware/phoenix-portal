import { Activity } from "lucide-react";
import { lazy, Suspense } from "react";
import { Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { MobileChartCard } from "@/app/components/analytics/MobileChartCard";
import { BiomechanicsContent } from "@/app/components/Biomechanics";
import { MuscleRadar } from "@/app/components/charts/MuscleRadar";
import { RechartsTooltip } from "@/app/components/charts/shared/RechartsTooltip";
import { Card } from "@/app/components/ui/card";
import type { Recommendation } from "@/lib/recommendations";
import type { MuscleRecovery } from "@/lib/sra-recovery";
import type { WeightUnit } from "@/lib/units";

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
	// New props
	weeklyVolume: Record<string, number>;
	totalSessions: number;
	muscleRecoveries: MuscleRecovery[];
	recommendations: Recommendation[];
	exercisesByMuscle: Record<string, Array<{ name: string; sessionCount: number }>>;
	userId: string;
	unit: WeightUnit;
	profileId?: string | null;
}

export default function MobileBodyTab({
	muscleGroupData,
	muscleRadarData,
	mobileMusclData,
	weeklyVolume,
	totalSessions,
	muscleRecoveries,
	recommendations,
}: MobileBodyTabProps) {
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
