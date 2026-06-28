import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import {
	ArrowBigUp,
	ArrowLeft,
	Ban,
	Share2,
	Star,
	UserMinus,
	UserPlus,
} from "lucide-react";
import { useState } from "react";
import { CommunityFeedCard } from "@/app/components/community/CommunityFeedCard";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/app/components/ui/alert-dialog";
import {
	Avatar,
	AvatarFallback,
	AvatarImage,
} from "@/app/components/ui/avatar";
import { Button } from "@/app/components/ui/button";
import { Card } from "@/app/components/ui/card";
import { Skeleton } from "@/app/components/ui/skeleton";
import { useBlockedUsers } from "@/hooks/useBlockedUsers";
import {
	useBlockUser,
	useFollowCreator,
	useUnblockUser,
} from "@/mutations/community";
import { useAuth } from "@/providers/AuthProvider";
import {
	communityFeedOptions,
	creatorStatsOptions,
	isFollowingOptions,
	userVotesOptions,
} from "@/queries/community";
import type { CommunityFeedItem } from "@/schemas/community";

interface CreatorProfileProps {
	userId: string;
	onBack: () => void;
	/** Receives the full feed item so the caller can open the right detail. */
	onSelectItem?: (item: CommunityFeedItem) => void;
	/** Vote handler with an explicit item type (routine vs cycle). */
	onVote?: (id: string, itemType: "routine" | "cycle") => void;
}

/** A creator-profile feed item is a routine when it carries `routine_id`. */
function feedItemType(item: CommunityFeedItem): "routine" | "cycle" {
	return "routine_id" in item ? "routine" : "cycle";
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

	const {
		data: feedData,
		isLoading: feedLoading,
		isError: feedError,
		hasNextPage: hasMoreRoutines,
		isFetchingNextPage: fetchingMoreRoutines,
		fetchNextPage: fetchMoreRoutines,
	} = useInfiniteQuery(
		communityFeedOptions({
			tab: "routines",
			sort: "new",
			userId,
		}),
	);

	const {
		data: cycleData,
		isLoading: cycleLoading,
		isError: cycleError,
		hasNextPage: hasMoreCycles,
		isFetchingNextPage: fetchingMoreCycles,
		fetchNextPage: fetchMoreCycles,
	} = useInfiniteQuery(
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
	const blockMutation = useBlockUser();
	const unblockMutation = useUnblockUser();
	const { blockedUserIds } = useBlockedUsers();
	const isBlocked = blockedUserIds.has(userId);
	const [showBlockConfirm, setShowBlockConfirm] = useState(false);
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
							<AvatarFallback className="bg-primary text-white text-lg">
								{getInitials(stats.display_name)}
							</AvatarFallback>
						</Avatar>

						<div className="flex-1 min-w-0">
							<div className="flex items-center gap-3 mb-3">
								<h2 className="text-xl font-bold text-white truncate">
									{stats.display_name}
								</h2>
								{user && !isSelf && (
									<>
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
										<Button
											size="sm"
											variant="outline"
											className={
												isBlocked
													? "border-secondary text-muted-foreground hover:text-white gap-1.5 h-8 text-xs"
													: "border-red-500/30 text-red-400 hover:bg-red-500/10 gap-1.5 h-8 text-xs"
											}
											onClick={() =>
												isBlocked
													? unblockMutation.mutate({ blockedId: userId })
													: setShowBlockConfirm(true)
											}
											disabled={
												blockMutation.isPending || unblockMutation.isPending
											}
										>
											<Ban className="w-3.5 h-3.5" />
											{isBlocked ? "Unblock" : "Block"}
										</Button>
									</>
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
										<p className="text-[10px] text-muted-foreground">Shares</p>
									</div>
								</div>

								{/* Total Upvotes */}
								<div className="flex items-center gap-2 bg-background rounded-lg px-3 py-2">
									<ArrowBigUp className="w-4 h-4 text-accent" />
									<div>
										<p className="text-lg font-bold text-white leading-none">
											{stats.total_upvotes}
										</p>
										<p className="text-[10px] text-muted-foreground">Upvotes</p>
									</div>
								</div>

								{/* Featured Count */}
								<div className="flex items-center gap-2 bg-background rounded-lg px-3 py-2">
									<Star className="w-4 h-4 text-success" />
									<div>
										<p className="text-lg font-bold text-white leading-none">
											{stats.featured_count}
										</p>
										<p className="text-[10px] text-muted-foreground">
											Featured
										</p>
									</div>
								</div>
							</div>
						</div>
					</div>
				</Card>
			) : (
				<Card className="p-6 bg-surface-2 border-secondary mb-6">
					<p className="text-muted-foreground">Creator not found</p>
				</Card>
			)}

			{/* Shared Content */}
			<h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">
				Shared Content
			</h3>

			{feedLoading || cycleLoading ? (
				<div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
					{Array.from({ length: 3 }).map((_, i) => (
						<Card
							// biome-ignore lint/suspicious/noArrayIndexKey: static skeleton list never reorders
							key={i}
							className="p-5 bg-surface-2 border-secondary animate-pulse h-48"
						/>
					))}
				</div>
			) : feedError || cycleError ? (
				<div className="text-center py-12 text-muted-foreground">
					<p>Couldn't load this creator's shared content. Please try again.</p>
				</div>
			) : allItems.length === 0 ? (
				<div className="text-center py-12 text-muted-foreground">
					<p>This creator has not shared any content yet.</p>
				</div>
			) : (
				<>
					<div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
						{allItems.map((item) => (
							<CommunityFeedCard
								key={item.id}
								item={item}
								onSelect={() => onSelectItem?.(item)}
								isVoted={votedIds?.has(item.id) ?? false}
								onVote={(id) => onVote?.(id, feedItemType(item))}
								contentType={feedItemType(item)}
							/>
						))}
					</div>
					{(hasMoreRoutines || hasMoreCycles) && (
						<div className="flex justify-center mt-6">
							<Button
								variant="outline"
								size="sm"
								className="border-secondary text-muted-foreground"
								disabled={fetchingMoreRoutines || fetchingMoreCycles}
								onClick={() => {
									if (hasMoreRoutines) fetchMoreRoutines();
									if (hasMoreCycles) fetchMoreCycles();
								}}
							>
								{fetchingMoreRoutines || fetchingMoreCycles
									? "Loading..."
									: "Load more"}
							</Button>
						</div>
					)}
				</>
			)}

			{/* Block confirmation dialog */}
			<AlertDialog open={showBlockConfirm} onOpenChange={setShowBlockConfirm}>
				<AlertDialogContent className="bg-background border-secondary">
					<AlertDialogHeader>
						<AlertDialogTitle className="text-white">
							Block this user?
						</AlertDialogTitle>
						<AlertDialogDescription>
							Their posts and comments will be hidden from your feed. You can
							unblock them later in Settings.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel className="border-secondary text-muted-foreground">
							Cancel
						</AlertDialogCancel>
						<AlertDialogAction
							onClick={() => blockMutation.mutate({ blockedId: userId })}
							className="bg-destructive hover:bg-destructive/90"
						>
							Block
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	);
}
