import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import {
	ArrowBigUp,
	ArrowLeft,
	Share2,
	Star,
	UserMinus,
	UserPlus,
} from "lucide-react";
import { CommunityFeedCard } from "@/app/components/community/CommunityFeedCard";
import {
	Avatar,
	AvatarFallback,
	AvatarImage,
} from "@/app/components/ui/avatar";
import { Button } from "@/app/components/ui/button";
import { Card } from "@/app/components/ui/card";
import { Skeleton } from "@/app/components/ui/skeleton";
import { useFollowCreator } from "@/mutations/community";
import { useAuth } from "@/providers/AuthProvider";
import {
	communityFeedOptions,
	creatorStatsOptions,
	isFollowingOptions,
	userVotesOptions,
} from "@/queries/community";

interface CreatorProfileProps {
	userId: string;
	onBack: () => void;
	onSelectItem?: (id: string) => void;
	onVote?: (id: string) => void;
}

function getInitials(name: string): string {
	return name
		.split(" ")
		.map((w) => w.charAt(0))
		.join("")
		.toUpperCase()
		.slice(0, 2);
}

export function CreatorProfile({
	userId,
	onBack,
	onSelectItem,
	onVote,
}: CreatorProfileProps) {
	const { user } = useAuth();
	const { data: stats, isLoading: statsLoading } = useQuery(
		creatorStatsOptions(userId),
	);

	const { data: feedData, isLoading: feedLoading } = useInfiniteQuery(
		communityFeedOptions({
			tab: "routines",
			sort: "new",
			userId,
		}),
	);

	const { data: cycleData } = useInfiniteQuery(
		communityFeedOptions({
			tab: "cycles",
			sort: "new",
			userId,
		}),
	);

	const { data: votedIds } = useQuery({
		...userVotesOptions(user?.id ?? ""),
		enabled: !!user?.id,
	});

	const { data: isFollowing } = useQuery(
		isFollowingOptions(user?.id ?? "", userId),
	);
	const followMutation = useFollowCreator();
	const isSelf = user?.id === userId;

	const routineItems = feedData?.pages.flat() ?? [];
	const cycleItems = cycleData?.pages.flat() ?? [];
	const allItems = [...routineItems, ...cycleItems];

	return (
		<div>
			{/* Back button */}
			<Button
				variant="ghost"
				size="sm"
				onClick={onBack}
				className="text-muted-foreground hover:text-white mb-4"
			>
				<ArrowLeft className="w-4 h-4 mr-1.5" />
				Back to feed
			</Button>

			{/* Stats banner */}
			{statsLoading ? (
				<Card className="p-6 bg-surface-2 border-secondary mb-6">
					<div className="flex items-center gap-4">
						<Skeleton className="w-16 h-16 rounded-full" />
						<div className="flex-1 space-y-2">
							<Skeleton className="w-32 h-5 rounded" />
							<div className="flex gap-4">
								<Skeleton className="w-20 h-10 rounded" />
								<Skeleton className="w-20 h-10 rounded" />
								<Skeleton className="w-20 h-10 rounded" />
							</div>
						</div>
					</div>
				</Card>
			) : stats ? (
				<Card className="p-6 bg-surface-2 border-secondary mb-6">
					<div className="flex items-center gap-4">
						<Avatar className="w-16 h-16">
							{stats.avatar_url && (
								<AvatarImage src={stats.avatar_url} alt={stats.display_name} />
							)}
							<AvatarFallback className="bg-gradient-to-br from-primary to-chart-2 text-white text-lg">
								{getInitials(stats.display_name)}
							</AvatarFallback>
						</Avatar>

						<div className="flex-1 min-w-0">
							<div className="flex items-center gap-3 mb-3">
								<h2 className="text-xl font-bold text-white truncate">
									{stats.display_name}
								</h2>
								{user && !isSelf && (
									<Button
										size="sm"
										variant={isFollowing ? "outline" : "default"}
										className={
											isFollowing
												? "border-secondary text-muted-foreground hover:text-white hover:border-destructive gap-1.5 h-8 text-xs"
												: "bg-primary hover:bg-primary/90 gap-1.5 h-8 text-xs"
										}
										onClick={() =>
											followMutation.mutate({
												followedId: userId,
											})
										}
										disabled={followMutation.isPending}
									>
										{isFollowing ? (
											<>
												<UserMinus className="w-3.5 h-3.5" />
												Unfollow
											</>
										) : (
											<>
												<UserPlus className="w-3.5 h-3.5" />
												Follow
											</>
										)}
									</Button>
								)}
							</div>
							<div className="flex gap-4">
								{/* Total Shares */}
								<div className="flex items-center gap-2 bg-background rounded-lg px-3 py-2">
									<Share2 className="w-4 h-4 text-primary" />
									<div>
										<p className="text-lg font-bold text-white leading-none">
											{stats.total_shares}
										</p>
										<p className="text-[10px] text-muted">Shares</p>
									</div>
								</div>

								{/* Total Upvotes */}
								<div className="flex items-center gap-2 bg-background rounded-lg px-3 py-2">
									<ArrowBigUp className="w-4 h-4 text-accent" />
									<div>
										<p className="text-lg font-bold text-white leading-none">
											{stats.total_upvotes}
										</p>
										<p className="text-[10px] text-muted">Upvotes</p>
									</div>
								</div>

								{/* Featured Count */}
								<div className="flex items-center gap-2 bg-background rounded-lg px-3 py-2">
									<Star className="w-4 h-4 text-success" />
									<div>
										<p className="text-lg font-bold text-white leading-none">
											{stats.featured_count}
										</p>
										<p className="text-[10px] text-muted">Featured</p>
									</div>
								</div>
							</div>
						</div>
					</div>
				</Card>
			) : (
				<Card className="p-6 bg-surface-2 border-secondary mb-6">
					<p className="text-muted">Creator not found</p>
				</Card>
			)}

			{/* Shared Content */}
			<h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">
				Shared Content
			</h3>

			{feedLoading ? (
				<div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
					{Array.from({ length: 3 }).map((_, i) => (
						<Card
							key={i}
							className="p-5 bg-surface-2 border-secondary animate-pulse h-48"
						/>
					))}
				</div>
			) : allItems.length === 0 ? (
				<div className="text-center py-12 text-muted">
					<p>This creator has not shared any content yet.</p>
				</div>
			) : (
				<div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
					{allItems.map((item) => (
						<CommunityFeedCard
							key={item.id}
							item={item}
							onSelect={onSelectItem ?? (() => {})}
							isVoted={votedIds?.has(item.id) ?? false}
							onVote={onVote ?? (() => {})}
						/>
					))}
				</div>
			)}
		</div>
	);
}
