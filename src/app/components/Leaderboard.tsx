import { useQuery } from "@tanstack/react-query";
import { Award, Crown, Medal, Shield, TrendingUp, Trophy } from "lucide-react";
import { motion } from "motion/react";
import { PageShell } from "@/app/components/PageShell";
import { Badge } from "@/app/components/ui/badge";
import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from "@/app/components/ui/card";
import { Skeleton } from "@/app/components/ui/skeleton";
import {
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from "@/app/components/ui/tabs";
import { useAuth } from "@/providers/AuthProvider";
import {
	type GlobalLeaderboard,
	globalLeaderboardOptions,
	type LeaderboardEntry,
	type UserRanking,
	userRankingOptions,
	type WeeklyCompetition,
	weeklyCompetitionOptions,
} from "@/queries/leaderboard";

// ---- Rank medal helpers ----

function getRankIcon(rank: number) {
	if (rank === 1)
		return <Crown className="size-5 text-[#F59E0B]" aria-label="1st place" />;
	if (rank === 2)
		return <Medal className="size-5 text-[#9CA3AF]" aria-label="2nd place" />;
	if (rank === 3)
		return <Award className="size-5 text-[#CD7F32]" aria-label="3rd place" />;
	return (
		<span className="flex size-5 items-center justify-center text-xs font-bold text-muted-foreground">
			{rank}
		</span>
	);
}

function getRankBg(rank: number): string {
	if (rank === 1) return "bg-[#F59E0B]/10 border-[#F59E0B]/30";
	if (rank === 2) return "bg-[#9CA3AF]/10 border-[#9CA3AF]/30";
	if (rank === 3) return "bg-[#CD7F32]/10 border-[#CD7F32]/30";
	return "bg-card border-border";
}

function formatValue(value: number, metric: string): string {
	if (metric.toLowerCase().includes("volume")) {
		return value >= 1000 ? `${(value / 1000).toFixed(1)}k kg` : `${value} kg`;
	}
	if (
		metric.toLowerCase().includes("streak") ||
		metric.toLowerCase().includes("count") ||
		metric.toLowerCase().includes("mastery")
	) {
		return String(value);
	}
	return String(value);
}

// ---- Entry row ----

interface EntryRowProps {
	entry: LeaderboardEntry;
	metric: string;
	isCurrentUser: boolean;
}

function EntryRow({ entry, metric, isCurrentUser }: EntryRowProps) {
	return (
		<motion.div
			initial={{ opacity: 0, x: -8 }}
			animate={{ opacity: 1, x: 0 }}
			className={`flex items-center gap-3 rounded-lg border px-3 py-2 ${
				isCurrentUser
					? "border-primary/40 bg-primary/10"
					: getRankBg(entry.rank)
			}`}
		>
			<div className="flex w-6 justify-center">{getRankIcon(entry.rank)}</div>

			{/* Avatar placeholder */}
			<div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold uppercase text-muted-foreground">
				{entry.displayName.charAt(0)}
			</div>

			<div className="min-w-0 flex-1">
				<p
					className={`truncate text-sm font-medium ${
						isCurrentUser ? "text-primary" : "text-foreground"
					}`}
				>
					{entry.displayName}
					{isCurrentUser && (
						<span className="ml-1.5 text-xs text-muted-foreground">(you)</span>
					)}
				</p>
				<p className="text-xs text-muted-foreground">Top {entry.percentile}%</p>
			</div>

			<span className="shrink-0 text-sm font-semibold text-foreground">
				{formatValue(entry.value, metric)}
			</span>
		</motion.div>
	);
}

// ---- Ranking Card ----

interface RankingCardProps {
	title: string;
	icon: React.ReactNode;
	entries: LeaderboardEntry[];
	metric: string;
	currentUserId: string | undefined;
	userEntry?: LeaderboardEntry;
}

function RankingCard({
	title,
	icon,
	entries,
	metric,
	currentUserId,
	userEntry,
}: RankingCardProps) {
	const top3 = entries.slice(0, 3);
	const userInTop3 =
		currentUserId != null && top3.some((e) => e.userId === currentUserId);
	const showUserEntry = !userInTop3 && userEntry != null && userEntry.rank > 3;

	return (
		<Card className="border-border flex flex-col gap-0 overflow-hidden p-0">
			<CardHeader className="border-b border-border px-4 py-3">
				<CardTitle className="flex items-center gap-2 text-sm font-semibold text-foreground">
					{icon}
					{title}
				</CardTitle>
			</CardHeader>
			<CardContent className="flex flex-col gap-2 p-4">
				{top3.length === 0 ? (
					<p className="text-center text-xs text-muted-foreground">
						No data yet.
					</p>
				) : (
					top3.map((entry) => (
						<EntryRow
							key={entry.userId}
							entry={entry}
							metric={metric}
							isCurrentUser={entry.userId === currentUserId}
						/>
					))
				)}

				{showUserEntry && userEntry != null && (
					<>
						<div className="my-1 flex items-center gap-2">
							<div className="h-px flex-1 bg-border" />
							<span className="text-xs text-muted-foreground">your rank</span>
							<div className="h-px flex-1 bg-border" />
						</div>
						<EntryRow entry={userEntry} metric={metric} isCurrentUser />
					</>
				)}
			</CardContent>
		</Card>
	);
}

// ---- Ranking Card Skeleton ----

function RankingCardSkeleton() {
	return (
		<Card className="border-border flex flex-col gap-0 overflow-hidden p-0">
			<div className="border-b border-border px-4 py-3">
				<Skeleton className="h-4 w-32" />
			</div>
			<div className="flex flex-col gap-2 p-4">
				<Skeleton className="h-11 w-full rounded-lg" />
				<Skeleton className="h-11 w-full rounded-lg" />
				<Skeleton className="h-11 w-full rounded-lg" />
			</div>
		</Card>
	);
}

// ---- Global Rankings Tab ----

interface GlobalRankingsProps {
	data: GlobalLeaderboard | undefined;
	isLoading: boolean;
	currentUserId: string | undefined;
}

function GlobalRankings({
	data,
	isLoading,
	currentUserId,
}: GlobalRankingsProps) {
	if (isLoading) {
		return (
			<div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
				{Array.from({ length: 6 }).map((_, i) => (
					// biome-ignore lint/suspicious/noArrayIndexKey: static skeleton list
					<RankingCardSkeleton key={i} />
				))}
			</div>
		);
	}

	if (data == null) {
		return (
			<Card className="border-border p-8 text-center text-sm text-muted-foreground">
				Rankings data unavailable. Check back soon.
			</Card>
		);
	}

	function findUserEntry(
		entries: LeaderboardEntry[],
		userId: string | undefined,
	): LeaderboardEntry | undefined {
		if (userId == null) return undefined;
		return entries.find((e) => e.userId === userId);
	}

	const metrics: Array<{
		key: keyof GlobalLeaderboard;
		title: string;
		icon: React.ReactNode;
		metricLabel: string;
	}> = [
		{
			key: "totalVolume",
			title: "Total Volume Lifted",
			icon: <TrendingUp className="size-4 text-primary" />,
			metricLabel: "volume",
		},
		{
			key: "workoutCount",
			title: "Most Workouts",
			icon: <Trophy className="size-4 text-[#F59E0B]" />,
			metricLabel: "count",
		},
		{
			key: "longestStreak",
			title: "Longest Streak",
			icon: <Award className="size-4 text-[#FF6B35]" />,
			metricLabel: "streak",
		},
		{
			key: "currentStreak",
			title: "Current Streak",
			icon: <Shield className="size-4 text-[#10B981]" />,
			metricLabel: "streak",
		},
		{
			key: "prCount",
			title: "Personal Records",
			icon: <Medal className="size-4 text-[#9CA3AF]" />,
			metricLabel: "count",
		},
		{
			key: "exerciseMastery",
			title: "Exercise Mastery",
			icon: <Crown className="size-4 text-[#F59E0B]" />,
			metricLabel: "mastery",
		},
	];

	return (
		<div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
			{metrics.map(({ key, title, icon, metricLabel }) => (
				<RankingCard
					key={key}
					title={title}
					icon={icon}
					entries={data[key]}
					metric={metricLabel}
					currentUserId={currentUserId}
					userEntry={findUserEntry(data[key], currentUserId)}
				/>
			))}
		</div>
	);
}

// ---- Weekly Challenge Tab ----

interface WeeklyChallengeProps {
	data: WeeklyCompetition | undefined;
	isLoading: boolean;
	currentUserId: string | undefined;
}

function WeeklyChallengeTab({
	data,
	isLoading,
	currentUserId,
}: WeeklyChallengeProps) {
	if (isLoading) {
		return (
			<div className="flex flex-col gap-4">
				<Skeleton className="h-16 w-full rounded-lg" />
				<Card className="border-border p-0">
					<div className="flex flex-col gap-2 p-4">
						{Array.from({ length: 10 }).map((_, i) => (
							// biome-ignore lint/suspicious/noArrayIndexKey: static skeleton list
							<Skeleton key={i} className="h-11 w-full rounded-lg" />
						))}
					</div>
				</Card>
			</div>
		);
	}

	if (data == null) {
		return (
			<Card className="border-border p-8 text-center text-sm text-muted-foreground">
				No active weekly challenge right now. Check back on Monday.
			</Card>
		);
	}

	const endDate = new Date(data.endDate);
	const now = new Date();
	const daysLeft = Math.max(
		0,
		Math.ceil((endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)),
	);

	return (
		<div className="flex flex-col gap-4">
			{/* Challenge header */}
			<motion.div
				initial={{ opacity: 0, y: -8 }}
				animate={{ opacity: 1, y: 0 }}
				className="rounded-xl border border-primary/30 bg-gradient-to-r from-primary/10 to-[#F59E0B]/10 p-4"
			>
				<div className="flex flex-wrap items-center justify-between gap-2">
					<div>
						<div className="flex items-center gap-2">
							<Trophy className="size-5 text-primary" />
							<h3 className="font-semibold text-foreground">
								{data.isSpecialEvent && data.eventName != null
									? data.eventName
									: data.metricLabel}
							</h3>
							{data.isSpecialEvent && (
								<Badge variant="default" className="text-xs">
									Special Event
								</Badge>
							)}
						</div>
						<p className="mt-0.5 text-xs text-muted-foreground">
							{new Date(data.startDate).toLocaleDateString()} –{" "}
							{endDate.toLocaleDateString()}
						</p>
					</div>
					<div className="text-right">
						<p className="text-2xl font-bold text-primary">{daysLeft}</p>
						<p className="text-xs text-muted-foreground">
							day{daysLeft !== 1 ? "s" : ""} left
						</p>
					</div>
				</div>
			</motion.div>

			{/* Full ranking list */}
			<Card className="border-border overflow-hidden p-0">
				<CardHeader className="border-b border-border px-4 py-3">
					<CardTitle className="text-sm font-semibold text-foreground">
						Full Standings — {data.entries.length} athlete
						{data.entries.length !== 1 ? "s" : ""}
					</CardTitle>
				</CardHeader>
				<CardContent className="flex flex-col gap-2 p-4">
					{data.entries.length === 0 ? (
						<p className="text-center text-xs text-muted-foreground">
							No entries yet. Be the first to compete!
						</p>
					) : (
						data.entries.map((entry) => (
							<EntryRow
								key={entry.userId}
								entry={entry}
								metric={data.metric}
								isCurrentUser={entry.userId === currentUserId}
							/>
						))
					)}
				</CardContent>
			</Card>
		</div>
	);
}

// ---- My Rankings Tab ----

interface MyRankingsProps {
	data: UserRanking[] | undefined;
	isLoading: boolean;
	isLoggedIn: boolean;
}

const METRIC_META: Record<
	string,
	{ label: string; icon: React.ReactNode; unit: string }
> = {
	totalVolume: {
		label: "Total Volume",
		icon: <TrendingUp className="size-4 text-primary" />,
		unit: "kg",
	},
	workoutCount: {
		label: "Workout Count",
		icon: <Trophy className="size-4 text-[#F59E0B]" />,
		unit: "sessions",
	},
	longestStreak: {
		label: "Longest Streak",
		icon: <Award className="size-4 text-[#FF6B35]" />,
		unit: "days",
	},
	currentStreak: {
		label: "Current Streak",
		icon: <Shield className="size-4 text-[#10B981]" />,
		unit: "days",
	},
	prCount: {
		label: "Personal Records",
		icon: <Medal className="size-4 text-[#9CA3AF]" />,
		unit: "PRs",
	},
	exerciseMastery: {
		label: "Exercise Mastery",
		icon: <Crown className="size-4 text-[#F59E0B]" />,
		unit: "score",
	},
};

function MyRankingsTab({ data, isLoading, isLoggedIn }: MyRankingsProps) {
	if (!isLoggedIn) {
		return (
			<Card className="border-border p-8 text-center text-sm text-muted-foreground">
				Sign in to see your personal rankings.
			</Card>
		);
	}

	if (isLoading) {
		return (
			<div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
				{Array.from({ length: 6 }).map((_, i) => (
					// biome-ignore lint/suspicious/noArrayIndexKey: static skeleton list
					<Skeleton key={i} className="h-28 w-full rounded-xl" />
				))}
			</div>
		);
	}

	if (data == null || data.length === 0) {
		return (
			<Card className="border-border p-8 text-center text-sm text-muted-foreground">
				No ranking data yet. Complete workouts to appear on the leaderboard.
			</Card>
		);
	}

	return (
		<div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
			{data.map((ranking, index) => {
				const meta = METRIC_META[ranking.metric];
				return (
					<motion.div
						key={ranking.metric}
						initial={{ opacity: 0, y: 12 }}
						animate={{ opacity: 1, y: 0 }}
						transition={{ delay: index * 0.05 }}
					>
						<Card className="border-border overflow-hidden p-0">
							<CardContent className="flex flex-col gap-3 p-4">
								<div className="flex items-center gap-2">
									{meta?.icon ?? (
										<Trophy className="size-4 text-muted-foreground" />
									)}
									<p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
										{meta?.label ?? ranking.metric}
									</p>
								</div>

								<div className="flex items-end justify-between">
									<div>
										<p className="text-3xl font-bold leading-none text-primary">
											#{ranking.rank}
										</p>
										<p className="mt-0.5 text-xs text-muted-foreground">
											of {ranking.totalUsers.toLocaleString()} athletes
										</p>
									</div>
									<div className="text-right">
										<p className="text-sm font-semibold text-foreground">
											Top {ranking.percentile}%
										</p>
										<p className="text-xs text-muted-foreground">
											{ranking.value.toLocaleString()} {meta?.unit ?? ""}
										</p>
									</div>
								</div>
							</CardContent>
						</Card>
					</motion.div>
				);
			})}
		</div>
	);
}

// ---- Main Leaderboard page ----

export function Leaderboard() {
	const { user } = useAuth();

	const { data: globalData, isLoading: globalLoading } = useQuery(
		globalLeaderboardOptions(),
	);

	const { data: weeklyData, isLoading: weeklyLoading } = useQuery(
		weeklyCompetitionOptions(),
	);

	const { data: userRankings, isLoading: userRankingsLoading } = useQuery(
		userRankingOptions(user?.id ?? ""),
	);

	return (
		<PageShell>
			<motion.div
				initial={{ opacity: 0, y: 12 }}
				animate={{ opacity: 1, y: 0 }}
				transition={{ duration: 0.3 }}
				className="flex flex-col gap-6"
			>
				{/* Page header */}
				<div className="flex items-center gap-3">
					<div className="flex size-10 items-center justify-center rounded-xl bg-primary/10">
						<Trophy className="size-5 text-primary" />
					</div>
					<div>
						<h1 className="text-2xl font-bold text-foreground">Leaderboard</h1>
						<p className="text-sm text-muted-foreground">
							See how you stack up against the Phoenix community
						</p>
					</div>
				</div>

				{/* Tabs */}
				<Tabs defaultValue="global" className="flex flex-col gap-4">
					<TabsList variant="underline" className="w-full justify-start">
						<TabsTrigger variant="underline" value="global">
							<Trophy className="size-4" />
							All-Time Rankings
						</TabsTrigger>
						<TabsTrigger variant="underline" value="weekly">
							<Shield className="size-4" />
							Weekly Challenge
						</TabsTrigger>
						<TabsTrigger variant="underline" value="mine">
							<Award className="size-4" />
							My Rankings
						</TabsTrigger>
					</TabsList>

					<TabsContent value="global">
						<GlobalRankings
							data={globalData}
							isLoading={globalLoading}
							currentUserId={user?.id}
						/>
					</TabsContent>

					<TabsContent value="weekly">
						<WeeklyChallengeTab
							data={weeklyData}
							isLoading={weeklyLoading}
							currentUserId={user?.id}
						/>
					</TabsContent>

					<TabsContent value="mine">
						<MyRankingsTab
							data={userRankings}
							isLoading={userRankingsLoading}
							isLoggedIn={user != null}
						/>
					</TabsContent>
				</Tabs>
			</motion.div>
		</PageShell>
	);
}
