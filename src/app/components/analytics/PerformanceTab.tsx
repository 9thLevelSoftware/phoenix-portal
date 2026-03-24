import { BiomechanicsContent } from "@/app/components/Biomechanics";
import { CommunityRankings } from "@/app/components/CommunityRankings";
import { SubscriptionGate } from "@/app/components/SubscriptionGate";
import { Card } from "@/app/components/ui/card";
import { convertWeight, type WeightUnit } from "@/lib/units";

interface VolumeComparisonData {
	current: Array<{
		total_volume: number | null;
		duration_seconds: number | null;
		set_count: number | null;
	}>;
	previous: Array<{
		total_volume: number | null;
		duration_seconds: number | null;
		set_count: number | null;
	}>;
}

export interface PerformanceTabProps {
	volumeComparison: VolumeComparisonData | undefined;
	unit: WeightUnit;
}

export default function PerformanceTab({
	volumeComparison,
	unit,
}: PerformanceTabProps) {
	return (
		<SubscriptionGate
			requiredTier="INFERNO"
			featureName="Performance Analytics"
		>
			{/* Community Rankings -- populated once benchmark Edge Function is scheduled */}
			<div className="space-y-6">
				<Card className="p-6 bg-surface-2 border-secondary">
					<h3 className="text-xl text-white mb-4">Community Rankings</h3>
					<p className="text-sm text-muted-foreground mb-4">
						Rankings update daily based on all participating Phoenix users.
					</p>
					<CommunityRankings rankings={[]} loading={false} />
				</Card>

				{/* Performance Metrics (Velocity, Power, TUT) */}
				<BiomechanicsContent view="performance" />

				{/* Training Efficiency */}
				<Card className="p-6 bg-surface-2 border-secondary">
					<h3 className="text-xl text-white mb-4">Training Efficiency</h3>
					<div className="grid grid-cols-2 gap-4">
						<div className="rounded-lg bg-muted/20 p-4">
							<p className="text-sm text-muted-foreground mb-1">
								Volume / Minute
							</p>
							<p className="text-2xl font-bold text-white">
								{volumeComparison?.current
									? (() => {
											const totalVol = volumeComparison.current.reduce(
												(s, r) => s + (r.total_volume ?? 0),
												0,
											);
											const totalMin = volumeComparison.current.reduce(
												(s, r) => s + (r.duration_seconds ?? 0) / 60,
												0,
											);
											return totalMin > 0
												? `${Math.round(convertWeight(totalVol / totalMin, unit))} ${unit}/min`
												: "--";
										})()
									: "--"}
							</p>
						</div>
						<div className="rounded-lg bg-muted/20 p-4">
							<p className="text-sm text-muted-foreground mb-1">
								Avg Session Duration
							</p>
							<p className="text-2xl font-bold text-white">
								{volumeComparison?.current &&
								volumeComparison.current.length > 0
									? `${Math.round(
											volumeComparison.current.reduce(
												(s, r) => s + (r.duration_seconds ?? 0),
												0,
											) /
												volumeComparison.current.length /
												60,
										)} min`
									: "--"}
							</p>
						</div>
					</div>
				</Card>
			</div>
		</SubscriptionGate>
	);
}
