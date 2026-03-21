import { CommunityDistribution } from "@/app/components/charts/CommunityDistribution";
import { Card, CardContent } from "@/app/components/ui/card";
import { Skeleton } from "@/app/components/ui/skeleton";

export interface RankingItem {
	label: string;
	percentile: number;
	value: number;
	unit: string;
	rank: number;
	totalUsers: number;
	color: string;
	percentiles: Record<string, number>;
}

export interface CommunityRankingsProps {
	rankings: RankingItem[];
	loading?: boolean;
}

function RankingCardSkeleton() {
	return (
		<Card className="border-border p-0">
			<CardContent className="flex flex-col gap-3 p-4">
				<Skeleton className="h-3 w-20" />
				<Skeleton className="h-8 w-16" />
				<Skeleton className="h-3 w-28" />
				<Skeleton className="h-14 w-full" />
			</CardContent>
		</Card>
	);
}

export function CommunityRankings({
	rankings,
	loading = false,
}: CommunityRankingsProps) {
	if (loading) {
		return (
			<div className="grid grid-cols-2 gap-4 md:grid-cols-4">
				<RankingCardSkeleton />
				<RankingCardSkeleton />
				<RankingCardSkeleton />
				<RankingCardSkeleton />
			</div>
		);
	}

	if (rankings.length === 0) {
		return (
			<Card className="border-border p-6 text-center text-sm text-muted-foreground">
				No ranking data available yet.
			</Card>
		);
	}

	return (
		<div className="grid grid-cols-2 gap-4 md:grid-cols-4">
			{rankings.map((item) => (
				<Card
					key={item.label}
					className="border-border overflow-hidden p-0"
					style={{
						background: `linear-gradient(135deg, ${item.color}0D 0%, transparent 60%)`,
						borderTopColor: item.color,
						borderTopWidth: 2,
					}}
				>
					<CardContent className="flex flex-col gap-2 p-4">
						{/* Label */}
						<p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
							{item.label}
						</p>

						{/* Top X% */}
						<p
							className="text-3xl font-bold leading-none"
							style={{ color: item.color }}
						>
							Top {item.percentile}%
						</p>

						{/* Value + rank */}
						<p className="text-xs text-muted-foreground">
							{item.value} {item.unit}&nbsp;&middot;&nbsp;Rank #{item.rank}
						</p>

						{/* Distribution chart */}
						<div className="mt-1">
							<CommunityDistribution
								percentiles={item.percentiles}
								userValue={item.value}
								color={item.color}
								label={item.label}
							/>
						</div>
					</CardContent>
				</Card>
			))}
		</div>
	);
}
