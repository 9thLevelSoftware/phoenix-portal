import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { CommunityDetailDrawer } from "@/app/components/community/CommunityDetailDrawer";
import { CommunityFeedCard } from "@/app/components/community/CommunityFeedCard";
import { CommunityFilterPanel } from "@/app/components/community/CommunityFilterPanel";
import { CommunitySearch } from "@/app/components/community/CommunitySearch";
import { CreatorProfile } from "@/app/components/community/CreatorProfile";
import { FeaturedCreators } from "@/app/components/community/FeaturedCreators";
import { PageShell } from "@/app/components/PageShell";
import { Button } from "@/app/components/ui/button";
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
import { useBlockedUsers } from "@/hooks/useBlockedUsers";
import { useCommunityRealtime } from "@/hooks/useCommunityRealtime";
import { useDebounce } from "@/hooks/useDebounce";
import { useVote } from "@/mutations/community";
import { useAuth } from "@/providers/AuthProvider";
import { communityFeedOptions, userVotesOptions } from "@/queries/community";
import type { CommunityFeedItem } from "@/schemas/community";
import { useCommunityStore } from "@/stores/useCommunityStore";

const SORT_OPTIONS = [
	{ value: "top", label: "Top" },
	{ value: "new", label: "New" },
] as const;

export function Community() {
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

	const debouncedSearch = useDebounce(search, 300);

	// Wire realtime — called ONCE at top level (not in separate mobile/desktop branches)
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

	// Infinite scroll sentinels. Mobile and desktop layouts both stay mounted
	// (toggled via CSS), so they need separate refs/observers — sharing one ref
	// would let React point it at the hidden layout's sentinel and stall paging.
	const mobileSentinelRef = useRef<HTMLDivElement>(null);
	const desktopSentinelRef = useRef<HTMLDivElement>(null);
	useEffect(() => {
		const targets = [
			mobileSentinelRef.current,
			desktopSentinelRef.current,
		].filter((el): el is HTMLDivElement => el !== null);
		if (targets.length === 0) return;
		const observer = new IntersectionObserver(
			(entries) => {
				const intersecting = entries.some((entry) => entry.isIntersecting);
				if (intersecting && hasNextPage && !isFetchingNextPage) {
					fetchNextPage();
				}
			},
			{ threshold: 0.1 },
		);
		for (const el of targets) {
			observer.observe(el);
		}
		return () => observer.disconnect();
	}, [hasNextPage, isFetchingNextPage, fetchNextPage]);

	const voteMutation = useVote();
	const { blockedUserIds } = useBlockedUsers();

	const allItems: CommunityFeedItem[] = (data?.pages.flat() ?? []).filter(
		(item) => item.user_id === null || !blockedUserIds.has(item.user_id),
	);
	const hasActiveFilters = Boolean(
		debouncedSearch || filters.muscleGroup || filters.difficulty,
	);

	// When viewing a creator profile, the selected item may not be in the main
	// feed. Hold the full item so the drawer can render it regardless of source.
	const [selectedCreatorItem, setSelectedCreatorItem] =
		useState<CommunityFeedItem | null>(null);

	const selectedItem = selectedCreatorItem
		? selectedCreatorItem
		: selectedItemId
			? (allItems.find((item) => item.id === selectedItemId) ?? null)
			: null;

	const handleVote = useCallback(
		(id: string, itemType?: "routine" | "cycle") => {
			voteMutation.mutate({
				itemId: id,
				itemType: itemType ?? (activeTab === "routines" ? "routine" : "cycle"),
			});
		},
		[voteMutation, activeTab],
	);

	const handleSelectCreatorItem = useCallback(
		(item: CommunityFeedItem) => {
			setSelectedCreatorItem(item);
			setSelectedItemId(item.id);
		},
		[setSelectedItemId],
	);

	const closeDetail = useCallback(() => {
		setSelectedItemId(null);
		setSelectedCreatorItem(null);
	}, [setSelectedItemId]);

	return (
		<div className="min-h-screen pb-20 md:pb-8">
			{/* ---- MOBILE LAYOUT (< 768px) ---- */}
			<div className="block md:hidden">
				{/* Mobile Header */}
				<header className="flex items-center justify-between px-4 py-4 border-b border-secondary">
					<h1 className="text-2xl font-bold text-white">Community</h1>
				</header>

				{/* Mobile Tabs */}
				<Tabs
					value={activeTab}
					onValueChange={(v) => setActiveTab(v as "routines" | "cycles")}
				>
					<TabsList variant="underline" className="w-full px-4">
						<TabsTrigger variant="underline" value="routines">
							Routines
						</TabsTrigger>
						<TabsTrigger variant="underline" value="cycles">
							Cycles
						</TabsTrigger>
					</TabsList>
				</Tabs>

				{/* Mobile Search */}
				<div className="px-4 pt-3 pb-2">
					<CommunitySearch />
				</div>

				{viewingCreatorId ? (
					<div className="px-4 pt-3">
						<CreatorProfile
							userId={viewingCreatorId}
							onBack={() => setViewingCreatorId(null)}
							onSelectItem={handleSelectCreatorItem}
							onVote={handleVote}
						/>
					</div>
				) : (
					<>
						{/* Mobile Sort pills + Filter */}
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
												? "bg-primary text-white border-0 text-xs px-3 h-7"
												: "border-secondary text-muted-foreground text-xs px-3 h-7"
										}
									>
										{opt.label}
									</Button>
								))}
							</div>
							<CommunityFilterPanel />
						</div>

						{/* Mobile Featured creators */}
						<div className="px-4">
							<FeaturedCreators onSelectCreator={setViewingCreatorId} />
						</div>

						{/* Mobile Feed */}
						<div className="px-4 space-y-3">
							{isLoading ? (
								["s1", "s2", "s3", "s4"].map((id) => (
									<Card
										key={id}
										className="p-5 bg-surface-2 border-secondary animate-pulse h-40"
									/>
								))
							) : isError ? (
								<div className="text-center py-12 text-muted-foreground">
									<p className="mb-2">Something went wrong</p>
									<Button
										variant="outline"
										size="sm"
										onClick={() => refetch()}
										className="border-secondary text-muted-foreground"
									>
										Try Again
									</Button>
								</div>
							) : allItems.length === 0 ? (
								<div className="text-center py-12 text-muted-foreground">
									<Search className="w-10 h-10 mx-auto mb-2 opacity-50" />
									{hasActiveFilters ? (
										<p>
											No {activeTab === "routines" ? "routines" : "cycles"}{" "}
											found
										</p>
									) : (
										<>
											<p>
												No shared{" "}
												{activeTab === "routines" ? "routines" : "cycles"} yet
											</p>
											<p className="mt-1 text-sm text-muted-foreground">
												Be the first to share{" "}
												{activeTab === "routines"
													? "a routine"
													: "a training cycle"}{" "}
												with the community.
											</p>
										</>
									)}
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
										currentUserId={user?.id}
										contentType={activeTab === "routines" ? "routine" : "cycle"}
									/>
								))
							)}

							{/* Mobile Infinite scroll sentinel */}
							<div ref={mobileSentinelRef} className="h-4" />
							{isFetchingNextPage && (
								<div className="flex justify-center py-3">
									<div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
								</div>
							)}
						</div>
					</>
				)}

				{/* Mobile Detail drawer */}
				<CommunityDetailDrawer
					item={selectedItem}
					open={!!selectedItemId}
					onClose={closeDetail}
				/>
			</div>

			{/* ---- DESKTOP LAYOUT (>= 768px) ---- */}
			<div className="hidden md:block">
				<PageShell>
					{/* Desktop Header */}
					<div className="mb-8">
						<h1 className="text-display-2 mb-2 text-white">Community Hub</h1>
						<p className="text-muted-foreground">
							Discover, share, and connect with fellow athletes
						</p>
					</div>

					{/* Desktop Tabs */}
					<Tabs
						value={activeTab}
						onValueChange={(v) => setActiveTab(v as "routines" | "cycles")}
						className="mb-6"
					>
						<TabsList variant="panel">
							<TabsTrigger value="routines">Routines</TabsTrigger>
							<TabsTrigger value="cycles">Cycles</TabsTrigger>
						</TabsList>
						<TabsContent value="routines" />
						<TabsContent value="cycles" />
					</Tabs>

					{viewingCreatorId ? (
						<CreatorProfile
							userId={viewingCreatorId}
							onBack={() => setViewingCreatorId(null)}
							onSelectItem={handleSelectCreatorItem}
							onVote={handleVote}
						/>
					) : (
						<>
							{/* Desktop Toolbar: Search + Sort + Filter */}
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

							{/* Desktop Feed grid */}
							{isLoading ? (
								<div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
									{["d1", "d2", "d3", "d4", "d5", "d6"].map((id) => (
										<Card
											key={id}
											className="p-5 bg-surface-2 border-secondary animate-pulse h-48"
										/>
									))}
								</div>
							) : isError ? (
								<div className="text-center py-16 text-muted-foreground">
									<p className="text-lg mb-2">Something went wrong</p>
									<p className="text-sm mb-4">
										Failed to load community feed. Please try again.
									</p>
									<button
										type="button"
										onClick={() => refetch()}
										className="px-4 py-2 text-sm font-medium rounded-lg bg-primary hover:bg-primary/90 text-white transition-colors"
									>
										Retry
									</button>
								</div>
							) : allItems.length === 0 ? (
								<div className="text-center py-16 text-muted-foreground">
									<Search className="w-12 h-12 mx-auto mb-3 opacity-50" />
									<p className="text-lg">
										{hasActiveFilters
											? `No ${activeTab === "routines" ? "routines" : "cycles"} found`
											: `No shared ${activeTab === "routines" ? "routines" : "cycles"} yet`}
									</p>
									{hasActiveFilters ? (
										<p className="text-sm mt-1">
											Try adjusting your search or filters
										</p>
									) : (
										<p className="mt-1 text-sm">
											Be the first to share{" "}
											{activeTab === "routines"
												? "a routine"
												: "a training cycle"}{" "}
											with the community.
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
											contentType={
												activeTab === "routines" ? "routine" : "cycle"
											}
										/>
									))}
								</div>
							)}

							{/* Desktop Infinite scroll sentinel */}
							<div
								ref={desktopSentinelRef}
								className="h-10 flex items-center justify-center"
							>
								{isFetchingNextPage && (
									<div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
								)}
								{hasNextPage && !isFetchingNextPage && (
									<p className="text-xs text-muted-foreground">
										Scroll for more
									</p>
								)}
							</div>
						</>
					)}

					{/* Desktop Detail drawer/dialog */}
					<CommunityDetailDrawer
						item={selectedItem}
						open={!!selectedItemId}
						onClose={closeDetail}
					/>
				</PageShell>
			</div>
		</div>
	);
}
