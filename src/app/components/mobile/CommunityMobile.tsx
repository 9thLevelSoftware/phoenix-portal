import {
	useInfiniteQuery,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import { Search } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { CommunityDetailDrawer } from "@/app/components/community/CommunityDetailDrawer";
import { CommunityFeedCard } from "@/app/components/community/CommunityFeedCard";
import { CommunityFilterPanel } from "@/app/components/community/CommunityFilterPanel";
import { CommunitySearch } from "@/app/components/community/CommunitySearch";
import { CreatorProfile } from "@/app/components/community/CreatorProfile";
import { FeaturedCreators } from "@/app/components/community/FeaturedCreators";
import { Button } from "@/app/components/ui/button";
import { Card } from "@/app/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/app/components/ui/tabs";
import { useCommunityRealtime } from "@/hooks/useCommunityRealtime";
import { useDebounce } from "@/hooks/useDebounce";
import { useAuth } from "@/providers/AuthProvider";
import { communityFeedOptions, userVotesOptions } from "@/queries/community";
import { queryKeys } from "@/queries/keys";
import type { CommunityFeedItem } from "@/schemas/community";
import { useCommunityStore } from "@/stores/useCommunityStore";

const SORT_OPTIONS = [
	{ value: "hot", label: "Hot" },
	{ value: "top", label: "Top" },
	{ value: "new", label: "New" },
] as const;

export function CommunityMobile() {
	const { user } = useAuth();
	const queryClient = useQueryClient();
	const [viewingCreatorId, setViewingCreatorId] = useState<string | null>(null);
	const activeTab = useCommunityStore((s) => s.activeTab);
	const sort = useCommunityStore((s) => s.sort);
	const search = useCommunityStore((s) => s.search);
	const filters = useCommunityStore((s) => s.filters);
	const selectedItemId = useCommunityStore((s) => s.selectedItemId);
	const setActiveTab = useCommunityStore((s) => s.setActiveTab);
	const setSort = useCommunityStore((s) => s.setSort);
	const setSelectedItemId = useCommunityStore((s) => s.setSelectedItemId);
	const resetAll = useCommunityStore((s) => s.resetAll);

	const debouncedSearch = useDebounce(search, 300);

	// Reset state on mount
	useEffect(() => {
		resetAll();
	}, [resetAll]); // eslint-disable-line react-hooks/exhaustive-deps

	// Wire realtime
	useCommunityRealtime();

	// Feed query
	const {
		data,
		fetchNextPage,
		hasNextPage,
		isFetchingNextPage,
		isLoading,
		isError,
		refetch,
	} = useInfiniteQuery(
		communityFeedOptions({
			tab: activeTab,
			sort,
			filters,
			search: debouncedSearch,
		}),
	);

	// User votes
	const { data: votedIds } = useQuery({
		...userVotesOptions(user?.id ?? ""),
		enabled: !!user?.id,
	});

	// Infinite scroll sentinel
	const sentinelRef = useRef<HTMLDivElement>(null);
	useEffect(() => {
		const el = sentinelRef.current;
		if (!el) return;
		const observer = new IntersectionObserver(
			(entries) => {
				if (entries[0].isIntersecting && hasNextPage && !isFetchingNextPage) {
					fetchNextPage();
				}
			},
			{ threshold: 0.1 },
		);
		observer.observe(el);
		return () => observer.disconnect();
	}, [hasNextPage, isFetchingNextPage, fetchNextPage]);

	// Pull-to-refresh
	const _handlePullRefresh = useCallback(() => {
		queryClient.invalidateQueries({ queryKey: queryKeys.community.all });
	}, [queryClient]);

	const allItems: CommunityFeedItem[] = data?.pages.flat() ?? [];

	const selectedItem = selectedItemId
		? (allItems.find((item) => item.id === selectedItemId) ?? null)
		: null;

	const handleVote = useCallback((id: string) => {
		console.log("Vote:", id);
	}, []);

	return (
		<div className="min-h-screen bg-[#0D0D0D] pb-20">
			{/* Header */}
			<header className="flex items-center justify-between px-4 py-4 border-b border-[#374151]">
				<h1 className="text-2xl font-bold">
					<span className="bg-gradient-to-r from-[#FF6B35] to-[#F59E0B] bg-clip-text text-transparent">
						Community
					</span>
				</h1>
			</header>

			{/* Tabs */}
			<Tabs
				value={activeTab}
				onValueChange={(v) => setActiveTab(v as "routines" | "cycles")}
			>
				<div className="border-b border-[#374151]">
					<TabsList className="flex w-full bg-transparent px-4 gap-1">
						<TabsTrigger
							value="routines"
							className="flex-1 py-3 text-sm font-medium data-[state=active]:text-white data-[state=active]:border-b-2 data-[state=active]:border-[#FF6B35]"
						>
							Routines
						</TabsTrigger>
						<TabsTrigger
							value="cycles"
							className="flex-1 py-3 text-sm font-medium data-[state=active]:text-white data-[state=active]:border-b-2 data-[state=active]:border-[#FF6B35]"
						>
							Cycles
						</TabsTrigger>
					</TabsList>
				</div>
			</Tabs>

			{/* Search */}
			<div className="px-4 pt-3 pb-2">
				<CommunitySearch />
			</div>

			{viewingCreatorId ? (
				<div className="px-4 pt-3">
					<CreatorProfile
						userId={viewingCreatorId}
						onBack={() => setViewingCreatorId(null)}
						onSelectItem={(id) => setSelectedItemId(id)}
						onVote={handleVote}
					/>
				</div>
			) : (
				<>
					{/* Sort pills + Filter */}
					<div className="flex items-center gap-2 px-4 pb-3">
						<div className="flex gap-1.5 flex-1">
							{SORT_OPTIONS.map((opt) => (
								<Button
									key={opt.value}
									size="sm"
									variant={sort === opt.value ? "default" : "outline"}
									onClick={() => setSort(opt.value as "hot" | "top" | "new")}
									className={
										sort === opt.value
											? "bg-[#FF6B35] text-white border-0 text-xs px-3 h-7"
											: "border-[#374151] text-[#9CA3AF] text-xs px-3 h-7"
									}
								>
									{opt.label}
								</Button>
							))}
						</div>
						<CommunityFilterPanel />
					</div>

					{/* Featured creators */}
					<div className="px-4">
						<FeaturedCreators onSelectCreator={setViewingCreatorId} />
					</div>

					{/* Feed */}
					<div className="px-4 space-y-3">
						{isLoading ? (
							Array.from({ length: 4 }).map((_, i) => (
								<Card
									key={i}
									className="p-5 bg-[#1A1A2E] border-[#374151] animate-pulse h-40"
								/>
							))
						) : isError ? (
							<div className="text-center py-12 text-[#6B7280]">
								<p className="mb-2">Something went wrong</p>
								<Button
									variant="outline"
									size="sm"
									onClick={() => refetch()}
									className="border-[#374151] text-[#9CA3AF]"
								>
									Try Again
								</Button>
							</div>
						) : allItems.length === 0 ? (
							<div className="text-center py-12 text-[#6B7280]">
								<Search className="w-10 h-10 mx-auto mb-2 opacity-50" />
								<p>
									No {activeTab === "routines" ? "routines" : "cycles"} found
								</p>
							</div>
						) : (
							allItems.map((item) => (
								<CommunityFeedCard
									key={item.id}
									item={item}
									onSelect={(id) => setSelectedItemId(id)}
									isVoted={votedIds?.has(item.id) ?? false}
									onVote={handleVote}
									onAuthorClick={setViewingCreatorId}
								/>
							))
						)}

						{/* Infinite scroll sentinel */}
						<div ref={sentinelRef} className="h-4" />
						{isFetchingNextPage && (
							<div className="flex justify-center py-3">
								<div className="w-5 h-5 border-2 border-[#FF6B35] border-t-transparent rounded-full animate-spin" />
							</div>
						)}
					</div>
				</>
			)}

			{/* Detail drawer */}
			<CommunityDetailDrawer
				item={selectedItem}
				open={!!selectedItemId}
				onClose={() => setSelectedItemId(null)}
			/>
		</div>
	);
}
