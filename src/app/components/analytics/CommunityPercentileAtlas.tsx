import { AlertCircle, BarChart3 } from "lucide-react";
import {
	CommunityRankings,
	type RankingItem,
} from "@/app/components/CommunityRankings";
import { Skeleton } from "@/app/components/ui/skeleton";

interface CommunityPercentileAtlasProps {
	rankings: RankingItem[];
	loading: boolean;
	error: boolean;
}

export function CommunityPercentileAtlas({
	rankings,
	loading,
	error,
}: CommunityPercentileAtlasProps) {
	return (
		<section className="space-y-4">
			<div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
				<div>
					<h3 className="text-xl text-white">Community Percentile Atlas</h3>
					<p className="text-sm text-muted-foreground">
						Top-percentile context from participating Phoenix users.
					</p>
				</div>
				<div className="flex items-center gap-1.5 text-xs text-muted-foreground">
					<BarChart3 className="size-4" aria-hidden="true" />
					<span>Daily aggregate</span>
				</div>
			</div>

			{loading ? (
				<div className="grid grid-cols-2 gap-4 md:grid-cols-4">
					<p className="sr-only">Loading percentile atlas</p>
					{Array.from({ length: 4 }).map((_, index) => (
						<Skeleton
							// biome-ignore lint/suspicious/noArrayIndexKey: static loading placeholders
							key={index}
							className="h-36 rounded-lg"
						/>
					))}
				</div>
			) : error ? (
				<div className="flex items-center gap-2 rounded-lg border border-warning/30 bg-warning/5 p-4 text-sm text-warning">
					<AlertCircle className="size-4" aria-hidden="true" />
					<span>Percentile atlas is unavailable right now.</span>
				</div>
			) : rankings.length === 0 ? (
				<div className="rounded-lg border border-secondary bg-muted/10 p-4 text-sm text-muted-foreground">
					No percentile data is available for your account yet.
				</div>
			) : (
				<CommunityRankings rankings={rankings} loading={false} />
			)}
		</section>
	);
}
