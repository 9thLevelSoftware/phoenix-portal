import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { CommunityPercentileAtlas } from "@/app/components/analytics/CommunityPercentileAtlas";
import { BiomechanicsContent } from "@/app/components/Biomechanics";
import { SubscriptionGate } from "@/app/components/SubscriptionGate";
import {
	buildCommunityPercentileRankings,
	buildEstimatedCommunityPercentileRankings,
} from "@/lib/community-atlas";
import type { WeightUnit } from "@/lib/units";
import { communityBenchmarksOptions } from "@/queries/benchmarks";
import { userRankingOptions } from "@/queries/leaderboard";
import { gamificationStatsOptions } from "@/queries/profile";

interface MobilePerformanceTabProps {
	userId: string;
	unit: WeightUnit;
}

export default function MobilePerformanceTab({
	userId,
	unit,
}: MobilePerformanceTabProps) {
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
		<div className="space-y-4">
			<CommunityPercentileAtlas
				rankings={percentileRankings}
				loading={atlasLoading}
				error={atlasError}
			/>

			<SubscriptionGate
				requiredTier="INFERNO"
				featureName="Performance Analytics"
			>
				<BiomechanicsContent view="performance" />
			</SubscriptionGate>
		</div>
	);
}
