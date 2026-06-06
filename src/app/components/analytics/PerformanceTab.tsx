import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { CommunityPercentileAtlas } from "@/app/components/analytics/CommunityPercentileAtlas";
import { BiomechanicsContent } from "@/app/components/Biomechanics";
import { SubscriptionGate } from "@/app/components/SubscriptionGate";
import { Card } from "@/app/components/ui/card";
import {
	buildCommunityPercentileRankings,
	buildEstimatedCommunityPercentileRankings,
} from "@/lib/community-atlas";
import { convertWeight, type WeightUnit } from "@/lib/units";
import { communityBenchmarksOptions } from "@/queries/benchmarks";
import { userRankingOptions } from "@/queries/leaderboard";
import { gamificationStatsOptions } from "@/queries/profile";

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
	userId: string;
}

export default function PerformanceTab({
	volumeComparison,
	unit,
	userId,
}: PerformanceTabProps) {
	const {
		data: benchmarks,
		isPending: benchmarksPending,
		error: benchmarksError,
	} = useQuery(communityBenchmarksOptions());
	const {
		data: userRankings,
		isPending: rankingsPending,
		error: rankingsError,
	} = useQuery({
		...userRankingOptions(userId),
		enabled: !!userId,
	});
	const {
		data: gamificationStats,
		isPending: statsPending,
		error: statsError,
	} = useQuery({
		...gamificationStatsOptions(userId),
		enabled: !!userId,
	});
	const exactPercentileRankings = useMemo(
		() =>
			buildCommunityPercentileRankings({
				benchmarks: benchmarks ?? [],
				userRankings: userRankings ?? [],
				unit,
			}),
		[benchmarks, userRankings, unit],
	);
	const estimatedPercentileRankings = useMemo(
		() =>
			buildEstimatedCommunityPercentileRankings({
				benchmarks: benchmarks ?? [],
				userStats: gamificationStats,
				unit,
			}),
		[benchmarks, gamificationStats, unit],
	);
	const percentileRankings =
		exactPercentileRankings.length > 0
			? exactPercentileRankings
			: estimatedPercentileRankings;
	const atlasLoading =
		benchmarksPending ||
		((rankingsPending || statsPending) && percentileRankings.length === 0);
	const atlasError =
		benchmarksError != null ||
		(rankingsError != null &&
			statsError != null &&
			percentileRankings.length === 0);

	return (
		<div className="space-y-6">
			<CommunityPercentileAtlas
				rankings={percentileRankings}
				loading={atlasLoading}
				error={atlasError}
			/>

			<SubscriptionGate
				requiredTier="INFERNO"
				featureName="Performance Analytics"
			>
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
			</SubscriptionGate>
		</div>
	);
}
