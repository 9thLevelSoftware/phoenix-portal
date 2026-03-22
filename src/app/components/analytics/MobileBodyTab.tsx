import { Activity } from "lucide-react";
import { Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { BiomechanicsContent } from "@/app/components/Biomechanics";
import { MuscleRadar } from "@/app/components/charts/MuscleRadar";
import { RechartsTooltip } from "@/app/components/charts/shared/RechartsTooltip";
import { SubscriptionGate } from "@/app/components/SubscriptionGate";
import { Card } from "@/app/components/ui/card";

function MobileChartCard({
	title,
	children,
}: {
	title: string;
	children: React.ReactNode;
}) {
	return (
		<Card className="p-4 bg-gradient-to-br from-surface-2 to-background border-secondary active:scale-[0.98] transition-transform">
			<h3 className="text-sm font-semibold text-white mb-3">{title}</h3>
			{children}
		</Card>
	);
}

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
}

export default function MobileBodyTab({
	muscleGroupData,
	muscleRadarData,
	mobileMusclData,
}: MobileBodyTabProps) {
	if (muscleGroupData.length === 0) {
		return (
			<div className="text-center py-12 text-muted">
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

			{/* Biomechanics -- gated for Inferno */}
			<SubscriptionGate
				requiredTier="INFERNO"
				featureName="Biomechanics Analysis"
			>
				<Card className="p-4 border-secondary">
					<BiomechanicsContent view="biomechanics" />
				</Card>
			</SubscriptionGate>
		</>
	);
}
