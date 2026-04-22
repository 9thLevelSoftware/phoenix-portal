import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
	Award,
	BarChart3,
	Check,
	Clock,
	Dumbbell,
	Loader2,
	Lock,
	X,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import { CalendarWidget } from "@/app/components/CalendarWidget";
import { PageShell } from "@/app/components/PageShell";
import { Badge } from "@/app/components/ui/badge";
import { Button } from "@/app/components/ui/button";
import { Card } from "@/app/components/ui/card";
import { EmptyState } from "@/app/components/ui/empty-state";
import { Skeleton, WorkoutCardSkeleton } from "@/app/components/ui/skeleton";
import { WorkoutQuickStats } from "@/app/components/WorkoutQuickStats";
import { useAuth } from "@/app/hooks/useAuth";
import { useStreak } from "@/hooks/useStreak";
import { useSubscription } from "@/hooks/useSubscription";
import { formatVolume } from "@/lib/units";
import { profileOptions } from "@/queries/profile";
import {
	WORKOUTS_PAGE_SIZE,
	workoutListOptions,
	workoutListPageOptions,
} from "@/queries/workouts";
import type { WorkoutSession } from "@/schemas/transforms";
import { useProfileFilterStore } from "@/stores/useProfileFilterStore";

// ---------------------------------------------------------------------------
// WorkoutCard subcomponent
// ---------------------------------------------------------------------------

interface WorkoutCardProps {
	workout: WorkoutSession;
	unit: "kg" | "lbs";
	compareMode: boolean;
	isSelected: boolean;
	onClick: () => void;
}

function WorkoutCard({
	workout,
	unit,
	compareMode,
	isSelected,
	onClick,
}: WorkoutCardProps) {
	return (
		<Card
			onClick={onClick}
			className={`p-4 sm:p-6 bg-surface-2 transition-all cursor-pointer group ${
				isSelected
					? "border-primary ring-1 ring-primary/50"
					: "border-secondary hover:border-primary/50"
			}`}
		>
			<div className="flex flex-col sm:flex-row sm:items-center gap-4">
				{/* Compare mode checkbox */}
				{compareMode && (
					<div
						className={`w-6 h-6 rounded-md border-2 flex items-center justify-center shrink-0 transition-colors ${
							isSelected ? "bg-primary border-primary" : "border-secondary"
						}`}
					>
						{isSelected && <Check className="w-4 h-4 text-white" />}
					</div>
				)}

				{/* Left: Icon & Date */}
				<div className="flex items-center gap-4">
					<div className="relative">
						<div className="w-12 h-12 sm:w-14 sm:h-14 rounded-lg bg-primary flex items-center justify-center transition-transform">
							<Dumbbell className="w-6 h-6 sm:w-7 sm:h-7 text-white" />
						</div>
						<div className="absolute -bottom-1 -right-1 bg-background rounded px-1.5 py-0.5 text-xs text-muted-foreground border border-secondary">
							{workout.started_at.getDate()}
						</div>
					</div>

					<div>
						<h3 className="text-lg font-semibold text-white mb-1">
							{workout.name}
						</h3>
						<div className="flex items-center gap-2 text-sm text-muted-foreground">
							<span>
								{workout.started_at.toLocaleDateString("en-US", {
									weekday: "short",
									month: "short",
									day: "numeric",
								})}
							</span>
							<span>-</span>
							<span>
								{workout.started_at.toLocaleTimeString("en-US", {
									hour: "numeric",
									minute: "2-digit",
								})}
							</span>
						</div>
						{workout.routine_name && (
							<Badge
								variant="outline"
								className="mt-2 border-primary/30 text-primary text-xs"
							>
								{workout.routine_name}
							</Badge>
						)}
					</div>
				</div>

				{/* Right: Stats */}
				<div className="flex-1 grid grid-cols-2 sm:flex sm:items-center sm:justify-end gap-4 sm:gap-6">
					<div className="text-center">
						<div className="text-sm text-muted-foreground mb-1">Volume</div>
						<div className="text-lg font-semibold text-white font-data">
							{formatVolume(workout.total_volume, unit)}
						</div>
					</div>
					<div className="text-center">
						<div className="text-sm text-muted-foreground mb-1">Duration</div>
						<div className="text-lg font-semibold text-white flex items-center justify-center gap-1 font-data">
							<Clock className="w-4 h-4" />
							{workout.duration_seconds}m
						</div>
					</div>
					{workout.pr_count > 0 && (
						<div className="text-center col-span-2 sm:col-span-1">
							<Badge className="bg-accent text-white border-0">
								<Award className="w-3 h-3 mr-1" />
								{workout.pr_count} PR{workout.pr_count > 1 ? "s" : ""}
							</Badge>
						</div>
					)}
				</div>
			</div>
		</Card>
	);
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function WorkoutHistory() {
	const navigate = useNavigate();
	const { user } = useAuth();
	const { activeProfileId } = useProfileFilterStore();
	const { data: workouts, isPending } = useQuery(
		workoutListOptions(user?.id ?? "", activeProfileId),
	);
	const { data: profile } = useQuery({
		...profileOptions(user?.id ?? ""),
		enabled: !!user?.id,
	});

	const { isPremium, tier } = useSubscription();
	const queryClient = useQueryClient();
	const [dateRange, setDateRange] = useState("Last 30 days");

	// Free-tier history gating: 30-day limit
	const FREE_HISTORY_DAYS = 30;
	const PREMIUM_DATE_RANGES = ["Last 90 days", "Last 6 months", "All Time"];
	const isFreeTierExtendedRange =
		tier === "FREE" && PREMIUM_DATE_RANGES.includes(dateRange);

	const isEntryLocked = useCallback(
		(startedAt: Date) => {
			if (tier !== "FREE") return false;
			const cutoff = new Date();
			cutoff.setDate(cutoff.getDate() - FREE_HISTORY_DAYS);
			return startedAt < cutoff;
		},
		[tier],
	);

	const [compareMode, setCompareMode] = useState(false);
	const [selectedForCompare, setSelectedForCompare] = useState<string[]>([]);

	// Pagination: load additional pages on demand
	const [loadedPages, setLoadedPages] = useState(0);
	const [extraWorkouts, setExtraWorkouts] = useState<WorkoutSession[]>([]);
	const [isLoadingMore, setIsLoadingMore] = useState(false);
	const [hasMore, setHasMore] = useState(true);
	const unit = profile?.weight_unit === "lbs" ? "lbs" : "kg";

	const allWorkouts = useMemo(() => {
		if (!workouts) return [];
		return [...workouts, ...extraWorkouts];
	}, [workouts, extraWorkouts]);

	// Sidebar stats
	const workoutDates = useMemo(() => {
		const dates = new Set<string>();
		for (const w of allWorkouts) {
			const d = w.started_at;
			const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
			dates.add(key);
		}
		return dates;
	}, [allWorkouts]);

	const weeklyWorkoutCount = useMemo(() => {
		const now = new Date();
		const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
		return allWorkouts.filter((w) => w.started_at >= weekAgo).length;
	}, [allWorkouts]);

	const monthlyVolume = useMemo(() => {
		const now = new Date();
		const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
		return allWorkouts
			.filter((w) => w.started_at >= monthStart)
			.reduce((sum, w) => sum + w.total_volume, 0);
	}, [allWorkouts]);

	// Calendar sidebar state
	const [currentMonth, setCurrentMonth] = useState(new Date());
	const [selectedDay, setSelectedDay] = useState<Date | null>(null);

	// Index workouts by date for the slide-out panel
	const workoutsByDate = useMemo(() => {
		const map = new Map<string, WorkoutSession[]>();
		for (const w of allWorkouts) {
			const key = `${w.started_at.getFullYear()}-${w.started_at.getMonth()}-${w.started_at.getDate()}`;
			const arr = map.get(key) ?? [];
			arr.push(w);
			map.set(key, arr);
		}
		return map;
	}, [allWorkouts]);

	const getWorkoutsForDay = (date: Date) => {
		const key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
		return workoutsByDate.get(key) ?? [];
	};

	const streak = useStreak(allWorkouts);

	const handleLoadMore = useCallback(async () => {
		if (!user?.id || isLoadingMore) return;
		setIsLoadingMore(true);
		const nextOffset = (loadedPages + 1) * WORKOUTS_PAGE_SIZE;
		try {
			const opts = workoutListPageOptions(user.id, nextOffset);
			const page = await queryClient.fetchQuery({
				...opts,
				queryKey: opts.queryKey,
				queryFn: opts.queryFn!,
			});
			setExtraWorkouts((prev) => [...prev, ...page]);
			setLoadedPages((prev) => prev + 1);
			if (page.length < WORKOUTS_PAGE_SIZE) {
				setHasMore(false);
			}
		} finally {
			setIsLoadingMore(false);
		}
	}, [user?.id, isLoadingMore, loadedPages, queryClient]);

	const toggleCompareSelection = (sessionId: string) => {
		setSelectedForCompare((prev) => {
			if (prev.includes(sessionId)) {
				return prev.filter((id) => id !== sessionId);
			}
			if (prev.length >= 2) return prev; // max 2
			return [...prev, sessionId];
		});
	};

	const handleCompareSelected = () => {
		if (selectedForCompare.length === 2) {
			navigate(
				`/compare?a=${selectedForCompare[0]}&b=${selectedForCompare[1]}`,
			);
		}
	};

	const exitCompareMode = () => {
		setCompareMode(false);
		setSelectedForCompare([]);
	};

	// Filter workouts based on dateRange selection
	const filteredWorkouts = useMemo(() => {
		if (allWorkouts.length === 0) return [];
		const now = new Date();
		let cutoffDays: number | null = null;
		switch (dateRange) {
			case "Last 7 days":
				cutoffDays = 7;
				break;
			case "Last 30 days":
				cutoffDays = 30;
				break;
			case "Last 90 days":
				cutoffDays = 90;
				break;
			case "Last 6 months":
				cutoffDays = 180;
				break;
			default:
				cutoffDays = null;
				break;
		}
		if (cutoffDays === null) return allWorkouts;
		const cutoff = new Date(now.getTime() - cutoffDays * 24 * 60 * 60 * 1000);
		return allWorkouts.filter((w) => w.started_at >= cutoff);
	}, [allWorkouts, dateRange]);

	// Loading state
	if (isPending) {
		return (
			<div className="min-h-screen pb-24 md:pb-8">
				<div className="bg-gradient-to-b from-surface-2 to-background border-b border-secondary px-4 sm:px-6 lg:px-8 py-6">
					<div className="max-w-7xl mx-auto">
						<Skeleton className="h-10 w-64 mb-2" />
						<Skeleton className="h-5 w-48" />
					</div>
				</div>
				<PageShell>
					{Array.from({ length: 5 }).map((_, i) => (
						<WorkoutCardSkeleton key={i} />
					))}
				</PageShell>
			</div>
		);
	}

	// Empty state
	if (!workouts || workouts.length === 0) {
		return (
			<div className="min-h-screen pb-24 md:pb-8">
				<div className="bg-gradient-to-b from-surface-2 to-background border-b border-secondary px-4 sm:px-6 lg:px-8 py-6">
					<div className="max-w-7xl mx-auto">
						<h1 className="text-display-2 mb-2 text-white">Workout History</h1>
						<p className="text-muted-foreground">
							Your training journey, documented
						</p>
					</div>
				</div>
				<PageShell>
					<EmptyState
						icon={Dumbbell}
						title="No workouts yet"
						description="Complete your first workout in the mobile app to see your training history here."
					/>
				</PageShell>
			</div>
		);
	}

	// Whether the initial page was full (could be more)
	const initialPageFull = workouts.length >= WORKOUTS_PAGE_SIZE;

	const unlocked = filteredWorkouts.filter((w) => !isEntryLocked(w.started_at));
	const locked = filteredWorkouts.filter((w) => isEntryLocked(w.started_at));
	const lockedPreview = locked.slice(0, 3);
	const hiddenLockedCount = Math.max(0, locked.length - lockedPreview.length);

	return (
		<div className="min-h-screen pb-24 md:pb-8">
			{/* Header */}
			<div className="bg-gradient-to-b from-surface-2 to-background border-b border-secondary sticky top-0 z-40">
				<div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
					<motion.div
						initial={{ opacity: 0, y: 20 }}
						animate={{ opacity: 1, y: 0 }}
						className="flex flex-col md:flex-row md:items-center md:justify-between gap-4"
					>
						<div>
							<h1 className="text-display-2 mb-2 text-white">
								Workout History
							</h1>
							<p className="text-muted-foreground">
								Your training journey, documented
							</p>
						</div>

						<div className="flex flex-col sm:flex-row gap-3">
							{/* Compare Toggle */}
							{isPremium ? (
								<Button
									size="sm"
									variant={compareMode ? "default" : "outline"}
									onClick={() => {
										if (compareMode) {
											exitCompareMode();
										} else {
											setCompareMode(true);
										}
									}}
									className={
										compareMode
											? "bg-primary border-0 text-white"
											: "border-secondary text-muted-foreground hover:border-primary hover:text-primary"
									}
								>
									<BarChart3 className="w-4 h-4 mr-2" />
									{compareMode ? "Exit Compare" : "Compare"}
								</Button>
							) : (
								<Button
									size="sm"
									variant="outline"
									asChild
									className="border-secondary text-muted-foreground hover:border-primary hover:text-primary"
								>
									<Link to="/pricing">
										<Lock className="w-4 h-4 mr-2" />
										Compare
										<Badge
											variant="outline"
											className="ml-2 border-primary/30 text-primary text-[10px] px-1.5 py-0"
										>
											{tier === "FREE" ? "EMBER" : "UPGRADE"}
										</Badge>
									</Link>
								</Button>
							)}

							{/* Date Range Selector */}
							<select
								value={dateRange}
								onChange={(e) => setDateRange(e.target.value)}
								className="px-4 py-2 rounded-lg bg-surface-2 border border-secondary text-white text-sm focus:border-primary focus:outline-none"
							>
								<option>Last 7 days</option>
								<option>Last 30 days</option>
								<option>Last 90 days</option>
								<option>Last 6 months</option>
								<option>All Time</option>
							</select>
						</div>
					</motion.div>

					{/* Free-tier upgrade banner for extended date ranges */}
					{isFreeTierExtendedRange && (
						<div className="pt-4">
							<Card className="p-4 border-primary/20 bg-primary/5">
								<div className="flex items-center gap-3">
									<Lock className="w-5 h-5 text-primary shrink-0" />
									<div className="flex-1">
										<p className="text-sm font-medium text-zinc-200">
											Extended history requires Phoenix
										</p>
										<p className="text-xs text-zinc-400">
											Free accounts can view the last 30 days of workout history
										</p>
									</div>
									<Button
										asChild
										size="sm"
										variant="outline"
										className="ml-auto border-primary text-primary hover:bg-primary/10 shrink-0"
									>
										<Link to="/pricing">Upgrade</Link>
									</Button>
								</div>
							</Card>
						</div>
					)}
				</div>
			</div>

			{/* Two-column layout */}
			<PageShell>
				<div className="flex flex-col lg:flex-row gap-6">
					{/* Main: Workout list */}
					<div className="flex-1 min-w-0 space-y-4">
						{/* Compare mode info */}
						{compareMode && (
							<div className="flex items-center justify-between bg-surface-2 border border-secondary rounded-lg p-3">
								<span className="text-sm text-muted-foreground">
									Select 2 sessions to compare ({selectedForCompare.length}/2)
								</span>
								{selectedForCompare.length === 2 && (
									<Button
										size="sm"
										onClick={handleCompareSelected}
										variant="cta"
									>
										<BarChart3 className="w-4 h-4 mr-2" />
										Compare Selected
									</Button>
								)}
							</div>
						)}

						{/* Unlocked workout cards */}
						{unlocked.map((workout, index) => {
							const isSelected = selectedForCompare.includes(workout.id);
							return (
								<motion.div
									key={workout.id}
									initial={{ opacity: 0, y: 20 }}
									animate={{ opacity: 1, y: 0 }}
									transition={{ delay: index * 0.05 }}
								>
									<WorkoutCard
										workout={workout}
										unit={unit}
										compareMode={compareMode}
										isSelected={isSelected}
										onClick={() => {
											if (compareMode) {
												toggleCompareSelection(workout.id);
											} else {
												navigate(`/history/${workout.id}`);
											}
										}}
									/>
								</motion.div>
							);
						})}

						{/* Locked preview entries (free-tier) */}
						{lockedPreview.map((workout, index) => (
							<motion.div
								key={workout.id}
								initial={{ opacity: 0, y: 20 }}
								animate={{ opacity: 0.5, y: 0 }}
								transition={{ delay: (unlocked.length + index) * 0.05 }}
							>
								<Card className="relative p-4 sm:p-6 bg-surface-2 border-secondary pointer-events-none select-none">
									{/* Lock overlay */}
									<div className="absolute inset-0 flex items-center justify-center z-10">
										<Lock className="w-6 h-6 text-primary/60" />
									</div>
									<div className="flex flex-col sm:flex-row sm:items-center gap-4 opacity-40">
										<div className="flex items-center gap-4">
											<div className="w-12 h-12 sm:w-14 sm:h-14 rounded-lg bg-gradient-to-br from-primary/30 to-chart-2/30 flex items-center justify-center">
												<Dumbbell className="w-6 h-6 sm:w-7 sm:h-7 text-white/50" />
											</div>
											<div>
												<h3 className="text-lg font-semibold text-white/60 mb-1">
													{workout.name}
												</h3>
												<div className="text-sm text-muted-foreground/60">
													{workout.started_at.toLocaleDateString("en-US", {
														weekday: "short",
														month: "short",
														day: "numeric",
													})}
												</div>
											</div>
										</div>
									</div>
								</Card>
							</motion.div>
						))}

						{/* Upgrade banner after locked entries */}
						{locked.length > 0 && (
							<Card className="p-6 border-primary/20 bg-primary/5 text-center">
								<Lock className="w-8 h-8 text-primary mx-auto mb-3" />
								<h3 className="text-lg font-semibold text-zinc-200 mb-1">
									Unlock your full workout history
								</h3>
								<p className="text-sm text-zinc-400 mb-4">
									{hiddenLockedCount > 0
										? `${locked.length} older workouts are locked. `
										: `${locked.length} older workout${locked.length === 1 ? " is" : "s are"} locked. `}
									Upgrade to Phoenix for unlimited history.
								</p>
								<Button asChild variant="cta">
									<Link to="/pricing">View Plans</Link>
								</Button>
							</Card>
						)}

						{/* Load More */}
						{initialPageFull && hasMore && (
							<div className="text-center pt-4">
								<Button
									variant="outline"
									onClick={handleLoadMore}
									disabled={isLoadingMore}
									className="border-secondary text-muted-foreground hover:border-primary hover:text-primary"
								>
									{isLoadingMore ? (
										<>
											<Loader2 className="w-4 h-4 mr-2 animate-spin" />
											Loading more workouts...
										</>
									) : (
										"Load more workouts"
									)}
								</Button>
							</div>
						)}
					</div>

					{/* Sidebar: Calendar + Quick Stats */}
					<aside className="w-full lg:w-72 shrink-0 space-y-4">
						<CalendarWidget
							currentMonth={currentMonth}
							onMonthChange={setCurrentMonth}
							workoutDates={workoutDates}
							selectedDate={selectedDay}
							onDateSelect={(date) => {
								const key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
								if (workoutDates.has(key)) {
									setSelectedDay(date);
								}
							}}
							isDateLocked={isEntryLocked}
						/>

						<WorkoutQuickStats
							weeklyWorkoutCount={weeklyWorkoutCount}
							currentStreak={streak}
							monthlyVolume={monthlyVolume}
							unit={unit}
						/>
					</aside>
				</div>
			</PageShell>

			{/* Day Detail Slide-Out Panel */}
			<AnimatePresence>
				{selectedDay && (
					<>
						{/* Backdrop */}
						<motion.div
							initial={{ opacity: 0 }}
							animate={{ opacity: 1 }}
							exit={{ opacity: 0 }}
							onClick={() => setSelectedDay(null)}
							className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50"
						/>

						{/* Panel */}
						<motion.div
							initial={{ x: "100%" }}
							animate={{ x: 0 }}
							exit={{ x: "100%" }}
							transition={{ type: "spring", damping: 25, stiffness: 200 }}
							className="fixed right-0 top-0 h-full w-full sm:w-96 bg-background border-l border-secondary z-50 overflow-y-auto"
						>
							{/* Panel Header */}
							<div className="sticky top-0 bg-gradient-to-b from-surface-2 to-background border-b border-secondary p-6 flex items-center justify-between">
								<div>
									<h3 className="text-xl font-semibold text-white mb-1">
										{selectedDay.toLocaleDateString("en-US", {
											weekday: "long",
											month: "long",
											day: "numeric",
										})}
									</h3>
									<p className="text-sm text-muted-foreground">
										{getWorkoutsForDay(selectedDay).length} workout
										{getWorkoutsForDay(selectedDay).length !== 1 ? "s" : ""}
									</p>
								</div>
								<Button
									variant="outline"
									size="sm"
									onClick={() => setSelectedDay(null)}
									className="border-secondary text-muted-foreground hover:border-primary hover:text-primary"
								>
									<X className="w-4 h-4" />
								</Button>
							</div>

							{/* Panel Content */}
							<div className="p-6 space-y-4">
								{getWorkoutsForDay(selectedDay).map((workout) => (
									<Card
										key={workout.id}
										onClick={() => {
											setSelectedDay(null);
											navigate(`/history/${workout.id}`);
										}}
										className="p-4 bg-surface-2 border-secondary hover:border-primary/50 cursor-pointer transition-all"
									>
										<h4 className="text-lg font-semibold text-white mb-2">
											{workout.name}
										</h4>
										<div className="space-y-2 text-sm">
											<div className="flex items-center justify-between text-secondary-foreground">
												<span className="text-muted-foreground">Time</span>
												<span>
													{workout.started_at.toLocaleTimeString("en-US", {
														hour: "numeric",
														minute: "2-digit",
													})}
												</span>
											</div>
											<div className="flex items-center justify-between text-secondary-foreground">
												<span className="text-muted-foreground">Duration</span>
												<span className="font-data">
													{workout.duration_seconds} min
												</span>
											</div>
											<div className="flex items-center justify-between text-secondary-foreground">
												<span className="text-muted-foreground">Volume</span>
												<span className="font-data">
													{formatVolume(workout.total_volume, unit)}
												</span>
											</div>
											{workout.pr_count > 0 && (
												<div className="flex items-center justify-between">
													<span className="text-muted-foreground">PRs</span>
													<Badge className="bg-accent text-white border-0">
														{workout.pr_count}
													</Badge>
												</div>
											)}
										</div>
									</Card>
								))}
							</div>
						</motion.div>
					</>
				)}
			</AnimatePresence>
		</div>
	);
}
