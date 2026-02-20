import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { CommunityDetailDrawer } from "@/app/components/community/CommunityDetailDrawer";
import { CommunityFeedCard } from "@/app/components/community/CommunityFeedCard";
import { CommunityFilterPanel } from "@/app/components/community/CommunityFilterPanel";
import { CommunitySearch } from "@/app/components/community/CommunitySearch";
import { CreatorProfile } from "@/app/components/community/CreatorProfile";
import { FeaturedCreators } from "@/app/components/community/FeaturedCreators";
import { CommunityMobile } from "@/app/components/mobile/CommunityMobile";
import { Card } from "@/app/components/ui/card";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/app/components/ui/select";
import {
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from "@/app/components/ui/tabs";
import { useIsMobile } from "@/app/hooks/useIsMobile";
import { useCommunityRealtime } from "@/hooks/useCommunityRealtime";
import { useDebounce } from "@/hooks/useDebounce";
import { useVote } from "@/mutations/community";
import { useAuth } from "@/providers/AuthProvider";
import { communityFeedOptions, userVotesOptions } from "@/queries/community";
import type { CommunityFeedItem } from "@/schemas/community";
import { useCommunityStore } from "@/stores/useCommunityStore";

const SORT_OPTIONS = [
	{ value: "hot", label: "Hot" },
	{ value: "top", label: "Top" },
	{ value: "new", label: "New" },
] as const;

export function Community() {
	const isMobile = useIsMobile();

	if (isMobile) {
		return <CommunityMobile />;
	}

	return <CommunityDesktop />;
}

function CommunityDesktop() {
	const { user } = useAuth();
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

	const voteMutation = useVote();

	const allItems: CommunityFeedItem[] = data?.pages.flat() ?? [];

	const selectedItem = selectedItemId
		? (allItems.find((item) => item.id === selectedItemId) ?? null)
		: null;

	const handleVote = useCallback(
		(id: string) => {
			voteMutation.mutate({
				itemId: id,
				itemType: activeTab === "routines" ? "routine" : "cycle",
			});
		},
		[voteMutation, activeTab],
	);

	return (
		<div className="min-h-screen bg-background pb-20 md:pb-8">
			<div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
				{/* Header */}
				<div className="mb-8">
					<h1 className="text-3xl sm:text-4xl mb-2">
						<span className="bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
							Community Hub
						</span>
					</h1>
					<p className="text-muted-foreground">
						Discover, share, and connect with fellow athletes
					</p>
				</div>

				{/* Tabs */}
				<Tabs
					value={activeTab}
					onValueChange={(v) => setActiveTab(v as "routines" | "cycles")}
					className="mb-6"
				>
					<TabsList className="bg-surface-2 border border-secondary p-1">
						<TabsTrigger
							value="routines"
							className="data-[state=active]:bg-primary/20 data-[state=active]:text-primary"
						>
							Routines
						</TabsTrigger>
						<TabsTrigger
							value="cycles"
							className="data-[state=active]:bg-primary/20 data-[state=active]:text-primary"
						>
							Cycles
						</TabsTrigger>
					</TabsList>
					<TabsContent value="routines" />
					<TabsContent value="cycles" />
				</Tabs>

				{viewingCreatorId ? (
					/* Creator profile view */
					<CreatorProfile
						userId={viewingCreatorId}
						onBack={() => setViewingCreatorId(null)}
						onSelectItem={(id) => setSelectedItemId(id)}
						onVote={handleVote}
					/>
				) : (
					<>
						{/* Toolbar: Search + Sort + Filter */}
						<div className="flex items-center gap-3 mb-6">
							<CommunitySearch />

							<Select
								value={sort}
								onValueChange={(v) => setSort(v as "hot" | "top" | "new")}
							>
								<SelectTrigger
									aria-label="Sort order"
									className="w-[120px] bg-surface-2 border-secondary text-white"
								>
									<SelectValue />
								</SelectTrigger>
								<SelectContent className="bg-surface-2 border-secondary">
									{SORT_OPTIONS.map((opt) => (
										<SelectItem key={opt.value} value={opt.value}>
											{opt.label}
										</SelectItem>
									))}
								</SelectContent>
							</Select>

							<CommunityFilterPanel />
						</div>

						{/* Featured creators */}
						<FeaturedCreators onSelectCreator={setViewingCreatorId} />

						{/* Feed grid */}
						{isLoading ? (
							<div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
								{Array.from({ length: 6 }).map((_, i) => (
									<Card
										key={i}
										className="p-5 bg-surface-2 border-secondary animate-pulse h-48"
									/>
								))}
							</div>
						) : isError ? (
							<div className="text-center py-16 text-muted">
								<p className="text-lg mb-2">Something went wrong</p>
								<p className="text-sm">
									Failed to load community feed. Please try again.
								</p>
							</div>
						) : allItems.length === 0 ? (
							<div className="text-center py-16 text-muted">
								<Search className="w-12 h-12 mx-auto mb-3 opacity-50" />
								<p className="text-lg">
									No {activeTab === "routines" ? "routines" : "cycles"} found
								</p>
								{debouncedSearch && (
									<p className="text-sm mt-1">
										Try adjusting your search or filters
									</p>
								)}
							</div>
						) : (
							<div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
								{allItems.map((item) => (
									<CommunityFeedCard
										key={item.id}
										item={item}
										onSelect={(id) => setSelectedItemId(id)}
										isVoted={votedIds?.has(item.id) ?? false}
										onVote={handleVote}
										onAuthorClick={setViewingCreatorId}
									/>
								))}
							</div>
						)}

						{/* Infinite scroll sentinel */}
						<div ref={sentinelRef} className="h-4" />
						{isFetchingNextPage && (
							<div className="flex justify-center py-4">
								<div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
							</div>
						)}
					</>
				)}

				{/* Detail drawer/dialog */}
				<CommunityDetailDrawer
					item={selectedItem}
					open={!!selectedItemId}
					onClose={() => setSelectedItemId(null)}
				/>
			</div>
		</div>
	);
}
