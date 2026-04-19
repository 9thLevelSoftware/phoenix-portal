import NumberFlow from "@number-flow/react";
import { useQueries, useQuery } from "@tanstack/react-query";
import {
	ArrowRight,
	Award,
	Calendar,
	ChevronRight,
	Dumbbell,
	Flame,
	Target,
	TrendingUp,
	Trophy,
} from "lucide-react";
import { motion } from "motion/react";
import { Link } from "react-router";
import {
	Area,
	AreaChart,
	CartesianGrid,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from "recharts";
import { RechartsTooltip } from "@/app/components/charts/shared/RechartsTooltip";
import { PageShell } from "@/app/components/PageShell";
import { Badge } from "@/app/components/ui/badge";
import { Button } from "@/app/components/ui/button";
import { Card } from "@/app/components/ui/card";
import { Progress } from "@/app/components/ui/progress";
import {
	ChartSkeleton,
	Skeleton,
	WorkoutCardSkeleton,
} from "@/app/components/ui/skeleton";
import { useAuth } from "@/app/hooks/useAuth";
import { useStreak } from "@/hooks/useStreak";
import { fadeUp, hover, staggerContainer } from "@/lib/animations";
import { PHOENIX } from "@/lib/colors";
import {
	convertWeight,
	formatVolume,
	formatWeight,
	type WeightUnit,
} from "@/lib/units";
import {
	challengeProgressOptions,
	userChallengesOptions,
} from "@/queries/challenges";
import { cycleListOptions } from "@/queries/cycles";
import { earnedBadgesOptions, profileOptions } from "@/queries/profile";
import {
	dashboardStatsOptions,
	recentPRsOptions,
	workoutListOptions,
} from "@/queries/workouts";
import type { PersonalRecord, WorkoutSession } from "@/schemas/transforms";
import { useProfileFilterStore } from "@/stores/useProfileFilterStore";
import { GoalDashboardWidget } from "./GoalDashboardWidget";
import { NextWorkoutWidget } from "./NextWorkoutWidget";
import { PortalBanner } from "./PortalBanner";
import { PWAInstallPrompt } from "./PWAInstallPrompt";
import { RecoveryDashboardWidget } from "./RecoveryDashboardWidget";

/** Derive weekly volume chart data from dashboard stats */
function deriveWeeklyVolume(
	stats: { started_at: string; total_volume: number }[] | undefined,
): { day: string; volume: number }[] {
	const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
	const volumeByDay: Record<string, number> = {};
	days.forEach((d) => (volumeByDay[d] = 0));

	if (stats) {
		for (const row of stats) {
			const dayName = days[new Date(row.started_at).getDay()];
			// total_volume is per-cable in DB; multiply by 2 for display
			volumeByDay[dayName] += row.total_volume * 2;
		}
	}

	// Return Mon-Sun order for chart
	const orderedDays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
	return orderedDays.map((day) => ({
		day,
		volume: Math.round(volumeByDay[day]),
	}));
}

/** Format a relative time string from a Date */
function formatRelativeTime(date: Date): string {
	const now = new Date();
	const diffMs = now.getTime() - date.getTime();
	const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
	const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

	if (diffHours < 1) return "Just now";
	if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? "s" : ""} ago`;
	if (diffDays === 1) return "Yesterday";
	return `${diffDays} days ago`;
}

function getDaysRemaining(endDate: string): number {
	const diffMs = new Date(endDate).getTime() - Date.now();
	return Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
}

function formatPersonalRecordValue(
	record: PersonalRecord,
	unit: WeightUnit,
): string {
	if (record.unit === "kg") {
		return formatWeight(record.value, unit);
	}
	return `${record.value} ${record.unit}`;
}

function QuickStatCard({
	icon,
	value,
	numericValue,
	label,
	gradient,
}: {
	icon: React.ReactNode;
	value: string;
	numericValue?: number;
	label: string;
	gradient: string;
}) {
	return (
		<motion.div whileHover={hover.lift}>
			<Card className="p-4 signal-panel min-w-[120px] flex-shrink-0">
				<div
					className={`w-10 h-10 rounded-lg bg-gradient-to-br ${gradient} flex items-center justify-center mb-3 text-white`}
				>
					{icon}
				</div>
				<div className="text-2xl font-bold text-white mb-1 font-data">
					{numericValue != null ? (
						<NumberFlow value={numericValue} className="tabular-nums" />
					) : (
						value
					)}
				</div>
				<div className="eyebrow text-muted-foreground">{label}</div>
			</Card>
		</motion.div>
	);
}

function MobileRecentActivityCard({
	title,
	time,
	volume,
	duration,
	prs,
}: {
	title: string;
	time: string;
	volume: string;
	duration: string;
	prs: number;
}) {
	return (
		<Card className="p-4 signal-panel active:scale-[0.98] transition-transform">
			<div className="flex items-center justify-between mb-2">
				<h4 className="font-semibold text-white">{title}</h4>
				<span className="text-xs text-muted-foreground">{time}</span>
			</div>
			<div className="flex items-center gap-4 text-sm text-muted-foreground">
				<span>{volume}</span>
				<span>-</span>
				<span>{duration}</span>
				{prs > 0 && (
					<>
						<span>-</span>
						<Badge className="bg-accent/20 text-accent border-accent/30 text-xs">
							{prs} PR
						</Badge>
					</>
				)}
			</div>
		</Card>
	);
}

function ActiveChallengesSection({ userId }: { userId: string }) {
	const {
		data: userChallenges,
		isPending,
		isError,
	} = useQuery({
		...userChallengesOptions(userId),
		enabled: !!userId,
	});
	const activeChallenges = (userChallenges ?? []).filter(
		(entry) => entry.completed_at == null && entry.challenges.is_active,
	);
	const progressQueries = useQueries({
		queries: activeChallenges.map((entry) =>
			challengeProgressOptions(
				userId,
				entry.challenge_id,
				entry.challenges.challenge_type,
				entry.challenges.target_value,
				entry.challenges.start_date,
				entry.challenges.end_date,
			),
		),
	});

	if (isPending) {
		return (
			<div className="space-y-3">
				{Array.from({ length: 2 }).map((_, index) => (
					<div
						key={index}
						className="rounded-lg border border-secondary bg-background p-4"
					>
						<Skeleton className="mb-3 h-5 w-32" />
						<Skeleton className="mb-2 h-3 w-full" />
						<Skeleton className="h-3 w-24" />
					</div>
				))}
			</div>
		);
	}

	if (isError) {
		return (
			<div className="py-4 text-center">
				<p className="text-sm text-muted-foreground">
					Your joined challenges could not be loaded.
				</p>
				<Button
					variant="outline"
					className="mt-4 w-full border-primary text-primary hover:bg-primary/10"
					asChild
				>
					<Link to="/challenges">Open Challenges</Link>
				</Button>
			</div>
		);
	}

	if (activeChallenges.length === 0) {
		return (
			<>
				<div className="flex flex-col items-center justify-center py-6 text-center">
					<Trophy className="mb-2 h-8 w-8 text-secondary" />
					<p className="text-sm text-muted-foreground">
						No active challenges yet
					</p>
					<p className="mt-1 text-xs text-muted-foreground">
						Join challenges from the Challenges page to track your progress here
					</p>
				</div>
				<Button
					variant="outline"
					className="mt-4 w-full border-primary text-primary hover:bg-primary/10"
					asChild
				>
					<Link to="/challenges">Browse Challenges</Link>
				</Button>
			</>
		);
	}

	return (
		<div className="space-y-3">
			{activeChallenges.slice(0, 3).map((entry, index) => {
				const challenge = entry.challenges;
				const progress = progressQueries[index]?.data;
				return (
					<div
						key={entry.id}
						className="rounded-lg border border-secondary bg-background p-4"
					>
						<div className="mb-3 flex items-start justify-between gap-3">
							<div>
								<h4 className="text-sm font-semibold text-white">
									{challenge.name}
								</h4>
								<p className="text-xs text-muted-foreground">
									{challenge.target_value.toLocaleString()}
									{challenge.target_unit ? ` ${challenge.target_unit}` : ""}{" "}
									target
								</p>
							</div>
							<Badge
								variant="outline"
								className="border-primary/30 text-primary"
							>
								{getDaysRemaining(challenge.end_date)}d left
							</Badge>
						</div>
						<div className="mb-2 flex items-center justify-between text-xs">
							<span className="text-muted-foreground">Progress</span>
							<span className="font-semibold text-primary font-data">
								{progress?.percentage ?? 0}%
							</span>
						</div>
						<Progress value={progress?.percentage ?? 0} className="h-2" />
						<p className="mt-2 text-xs text-muted-foreground">
							{progress
								? `${Math.round(progress.current).toLocaleString()} / ${Math.round(progress.target).toLocaleString()}`
								: "Calculating progress..."}
						</p>
					</div>
				);
			})}
			<Button
				variant="outline"
				className="w-full border-primary text-primary hover:bg-primary/10"
				asChild
			>
				<Link to="/challenges">Manage Challenges</Link>
			</Button>
		</div>
	);
}

export function Dashboard() {
	const { user } = useAuth();
	const userId = user?.id ?? "";
	const { activeProfileId } = useProfileFilterStore();

	const { data: workouts, isPending: workoutsLoading } = useQuery({
		...workoutListOptions(userId, activeProfileId),
		enabled: !!userId,
	});
	const { data: weeklyStats, isPending: statsLoading } = useQuery({
		...dashboardStatsOptions(userId, activeProfileId),
		enabled: !!userId,
	});
	const { data: recentPRs, isPending: prsLoading } = useQuery({
		...recentPRsOptions(userId, activeProfileId),
		enabled: !!userId,
	});
	const { data: profile } = useQuery({
		...profileOptions(userId),
		enabled: !!userId,
	});
	const { data: earnedBadges, isPending: badgesLoading } = useQuery({
		...earnedBadgesOptions(userId),
		enabled: !!userId,
	});
	const { data: cycles } = useQuery({
		...cycleListOptions(userId, activeProfileId),
		enabled: !!userId,
	});

	const streak = useStreak(workouts);
	const activeCycle = cycles?.find((c) => c.status === "active");
	const unit: WeightUnit = profile?.weight_unit === "lbs" ? "lbs" : "kg";

	const recentWorkouts = workouts?.slice(0, 5) ?? [];
	const recentBadges = earnedBadges?.slice(0, 3) ?? [];
	const weeklyVolumeData = deriveWeeklyVolume(weeklyStats ?? undefined).map(
		(row) => ({
			...row,
			volume: Math.round(convertWeight(row.volume, unit) * 10) / 10,
		}),
	);
	const weeklyTotal = weeklyVolumeData.reduce((sum, d) => sum + d.volume, 0);

	// Weekly estimated calories from dashboard stats
	const weeklyCalories = (weeklyStats ?? []).reduce(
		(sum, s) => sum + (s.estimated_calories ?? 0),
		0,
	);

	// Mobile simple bar chart heights
	const dailyVolumes = weeklyVolumeData.map((d) => d.volume);
	const maxVolume = Math.max(...dailyVolumes, 1);
	const barHeights = dailyVolumes.map((v) => Math.round((v / maxVolume) * 100));

	// Zero-session welcome view
	const hasNoWorkouts =
		!workoutsLoading && (!workouts || workouts.length === 0);

	if (hasNoWorkouts) {
		return (
			<div className="min-h-screen pb-20 md:pb-8">
				{/* Mobile welcome */}
				<div className="block md:hidden px-4 py-12">
					<motion.div
						initial={{ opacity: 0, y: 20 }}
						animate={{ opacity: 1, y: 0 }}
						className="text-center mb-10"
					>
						<div className="w-16 h-16 mx-auto mb-4 rounded-full bg-gradient-to-br from-primary/20 to-chart-2/20 flex items-center justify-center">
							<Flame className="w-8 h-8 text-primary" fill={PHOENIX.ember} />
						</div>
						<h1 className="text-display-2 mb-3 text-white">
							Welcome to Phoenix Portal
						</h1>
						<p className="text-muted-foreground max-w-xs mx-auto">
							Your training journey starts here. Complete your first workout in
							the mobile app and watch your dashboard come alive.
						</p>
					</motion.div>

					<div className="space-y-4">
						<motion.div
							initial={{ opacity: 0, y: 20 }}
							animate={{ opacity: 1, y: 0 }}
							transition={{ delay: 0.1 }}
						>
							<Card className="p-5 signal-panel">
								<div className="flex items-center gap-4">
									<div className="w-10 h-10 rounded-lg bg-primary flex items-center justify-center flex-shrink-0">
										<TrendingUp className="w-5 h-5 text-white" />
									</div>
									<div>
										<h3 className="font-semibold text-white">
											Track your progress
										</h3>
										<p className="text-xs text-muted-foreground">
											Volume, strength, and muscle insights
										</p>
									</div>
								</div>
							</Card>
						</motion.div>

						<motion.div
							initial={{ opacity: 0, y: 20 }}
							animate={{ opacity: 1, y: 0 }}
							transition={{ delay: 0.2 }}
						>
							<Link to="/routines/new">
								<Card className="p-5 signal-panel">
									<div className="flex items-center gap-4">
										<div className="w-10 h-10 rounded-lg bg-gradient-to-br from-chart-2 to-accent flex items-center justify-center flex-shrink-0">
											<Dumbbell className="w-5 h-5 text-white" />
										</div>
										<div>
											<h3 className="font-semibold text-white">
												Build custom routines
											</h3>
											<p className="text-xs text-muted-foreground">
												Create tailored workout programs
											</p>
										</div>
										<ChevronRight className="w-5 h-5 text-muted-foreground ml-auto" />
									</div>
								</Card>
							</Link>
						</motion.div>

						<motion.div
							initial={{ opacity: 0, y: 20 }}
							animate={{ opacity: 1, y: 0 }}
							transition={{ delay: 0.3 }}
						>
							<Link to="/challenges">
								<Card className="p-5 signal-panel">
									<div className="flex items-center gap-4">
										<div className="w-10 h-10 rounded-lg bg-accent flex items-center justify-center flex-shrink-0">
											<Trophy className="w-5 h-5 text-white" />
										</div>
										<div>
											<h3 className="font-semibold text-white">
												Join challenges
											</h3>
											<p className="text-xs text-muted-foreground">
												Compete with other athletes
											</p>
										</div>
										<ChevronRight className="w-5 h-5 text-muted-foreground ml-auto" />
									</div>
								</Card>
							</Link>
						</motion.div>
					</div>
				</div>

				{/* Desktop welcome */}
				<div className="hidden md:block max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
					<motion.div
						initial={{ opacity: 0, y: 20 }}
						animate={{ opacity: 1, y: 0 }}
						className="text-center mb-12"
					>
						<div className="w-20 h-20 mx-auto mb-6 rounded-full bg-gradient-to-br from-primary/20 to-chart-2/20 flex items-center justify-center">
							<Flame className="w-10 h-10 text-primary" />
						</div>
						<h1 className="text-display-1 mb-4 text-white">
							Welcome to Phoenix Portal
						</h1>
						<p className="text-xl text-muted-foreground max-w-xl mx-auto">
							Your training journey starts here. Complete your first workout in
							the mobile app and watch your dashboard come alive.
						</p>
					</motion.div>

					<motion.div
						variants={staggerContainer}
						initial="hidden"
						animate="visible"
						className="grid grid-cols-1 md:grid-cols-3 gap-6"
					>
						<motion.div variants={fadeUp}>
							<Card className="p-6 signal-panel h-full">
								<div className="w-12 h-12 rounded-lg bg-primary flex items-center justify-center mb-4">
									<TrendingUp className="w-6 h-6 text-white" />
								</div>
								<h3 className="text-lg font-semibold text-white mb-2">
									Track your progress
								</h3>
								<p className="text-sm text-muted-foreground">
									See volume trends, strength gains, and muscle balance insights
									once you start training.
								</p>
							</Card>
						</motion.div>

						<motion.div variants={fadeUp}>
							<Link to="/routines/new" className="block h-full">
								<Card className="p-6 signal-panel h-full">
									<div className="w-12 h-12 rounded-lg bg-gradient-to-br from-chart-2 to-accent flex items-center justify-center mb-4">
										<Dumbbell className="w-6 h-6 text-white" />
									</div>
									<h3 className="text-lg font-semibold text-white mb-2">
										Build custom routines
									</h3>
									<p className="text-sm text-muted-foreground">
										Create workout routines tailored to your goals with
										drag-and-drop exercise management.
									</p>
								</Card>
							</Link>
						</motion.div>

						<motion.div variants={fadeUp}>
							<Link to="/challenges" className="block h-full">
								<Card className="p-6 signal-panel h-full">
									<div className="w-12 h-12 rounded-lg bg-accent flex items-center justify-center mb-4">
										<Trophy className="w-6 h-6 text-white" />
									</div>
									<h3 className="text-lg font-semibold text-white mb-2">
										Join challenges
									</h3>
									<p className="text-sm text-muted-foreground">
										Compete with other athletes in community challenges and earn
										recognition.
									</p>
								</Card>
							</Link>
						</motion.div>
					</motion.div>
				</div>
			</div>
		);
	}

	return (
		<div className="min-h-screen pb-20 md:pb-8">
			{/* ---- MOBILE LAYOUT (< 768px) ---- */}
			<div className="block md:hidden">
				{/* Mobile compact header */}
				<div className="sticky top-0 z-40 bg-surface-1 border-b border-secondary px-4 py-4">
					<div className="flex items-center justify-between">
						<div>
							<h1 className="text-2xl font-bold text-white">Welcome back!</h1>
							<p className="text-sm text-muted-foreground">Let's crush today</p>
						</div>
					</div>
				</div>

				<div className="px-4 py-6 space-y-6">
					{/* Streak Card - animated with progress bar */}
					<motion.div
						initial={{ opacity: 0, y: 20 }}
						animate={{ opacity: 1, y: 0 }}
						transition={{ delay: 0.1 }}
					>
						<Card className="p-6 signal-panel-highlight">
							<div className="flex items-center gap-4">
								<motion.div
									animate={{
										scale: [1, 1.1, 1],
										filter: [
											"drop-shadow(0 0 10px #FF6B35)",
											"drop-shadow(0 0 20px #DC2626)",
											"drop-shadow(0 0 10px #FF6B35)",
										],
									}}
									transition={{
										duration: 2,
										repeat: Infinity,
										ease: "easeInOut",
									}}
								>
									<Flame
										className="w-16 h-16 text-primary"
										fill={PHOENIX.ember}
									/>
								</motion.div>
								<div className="flex-1">
									<div className="text-4xl font-bold text-white mb-1 font-data">
										<NumberFlow value={streak ?? 0} className="tabular-nums" />{" "}
										{streak === 1 ? "Day" : "Days"}
									</div>
									<div className="text-sm text-secondary-foreground">
										{streak > 0
											? "Keep the fire burning!"
											: "Start your streak today!"}
									</div>
									<div className="flex items-center gap-2 mt-2">
										<Progress
											value={Math.min(
												(streak / Math.max(Math.ceil(streak / 7) * 7, 7)) * 100,
												100,
											)}
											className="h-2 flex-1 bg-surface-2"
										/>
										<span className="text-xs text-muted-foreground whitespace-nowrap">
											{streak}/{Math.max(Math.ceil(streak / 7) * 7, 7)} day goal
										</span>
									</div>
								</div>
							</div>
						</Card>
					</motion.div>

					{/* Today's Workout */}
					<motion.div
						initial={{ opacity: 0, y: 20 }}
						animate={{ opacity: 1, y: 0 }}
						transition={{ delay: 0.2 }}
					>
						<h2 className="text-lg font-semibold text-white mb-3">
							Today's Workout
						</h2>
						{activeCycle ? (
							<NextWorkoutWidget cycleId={activeCycle.id} />
						) : (
							<Card className="p-5 signal-panel">
								<div className="flex flex-col items-center justify-center py-6 text-center">
									<Calendar className="w-10 h-10 text-secondary mb-3" />
									<p className="text-muted-foreground mb-1">
										No scheduled workout
									</p>
									<p className="text-sm text-muted-foreground mb-4">
										Create a training cycle to see your next workout here
									</p>
									<Button variant="cta" asChild>
										<Link to="/cycles">
											<Calendar className="w-4 h-4 mr-2" />
											Browse Training Cycles
										</Link>
									</Button>
								</div>
							</Card>
						)}
					</motion.div>

					{/* Quick Stats - Horizontal Scroll */}
					<motion.div
						initial={{ opacity: 0, y: 20 }}
						animate={{ opacity: 1, y: 0 }}
						transition={{ delay: 0.3 }}
					>
						<h2 className="text-lg font-semibold text-white mb-3">
							Quick Stats
						</h2>
						{workoutsLoading ? (
							<div className="flex gap-3 overflow-x-auto pb-2 -mx-4 px-4">
								{Array.from({ length: 4 }).map((_, i) => (
									<Card
										key={i}
										className="p-4 signal-panel min-w-[120px] flex-shrink-0"
									>
										<Skeleton className="w-10 h-10 rounded-lg mb-3" />
										<Skeleton className="h-7 w-16 mb-1" />
										<Skeleton className="h-3 w-12" />
									</Card>
								))}
							</div>
						) : (
							<div className="flex gap-3 overflow-x-auto pb-2 -mx-4 px-4 scrollbar-hide">
								<QuickStatCard
									icon={<Dumbbell className="w-5 h-5" />}
									value={String(workouts?.length ?? 0)}
									numericValue={workouts?.length ?? 0}
									label="Workouts"
									gradient="bg-primary"
								/>
								<QuickStatCard
									icon={<Award className="w-5 h-5" />}
									value={String(
										workouts?.reduce((sum, w) => sum + w.pr_count, 0) ?? 0,
									)}
									numericValue={
										workouts?.reduce((sum, w) => sum + w.pr_count, 0) ?? 0
									}
									label="PRs"
									gradient="bg-accent"
								/>
								<QuickStatCard
									icon={<TrendingUp className="w-5 h-5" />}
									value={formatVolume(weeklyTotal, unit)}
									label="Volume"
									gradient="bg-success"
								/>
								{weeklyCalories > 0 && (
									<QuickStatCard
										icon={<Flame className="w-5 h-5" />}
										value={`${Math.round(weeklyCalories)}`}
										numericValue={Math.round(weeklyCalories)}
										label="Calories"
										gradient="from-chart-2 to-primary"
									/>
								)}
								<QuickStatCard
									icon={<Target className="w-5 h-5" />}
									value="--"
									label="Goals"
									gradient="from-indigo-500 to-indigo-600"
								/>
							</div>
						)}
					</motion.div>

					{/* Weekly Volume - Simple CSS Bars */}
					<motion.div
						initial={{ opacity: 0, y: 20 }}
						animate={{ opacity: 1, y: 0 }}
						transition={{ delay: 0.4 }}
					>
						<h2 className="text-lg font-semibold text-white mb-3">This Week</h2>
						{statsLoading ? (
							<Card className="p-5 signal-panel">
								<Skeleton className="h-8 w-32 mb-1" />
								<Skeleton className="h-4 w-40 mb-4" />
								<Skeleton className="h-32 w-full" />
							</Card>
						) : weeklyTotal === 0 ? (
							<Card className="p-5 signal-panel">
								<div className="flex flex-col items-center justify-center py-8 text-center">
									<Dumbbell className="w-10 h-10 text-secondary mb-3" />
									<p className="text-muted-foreground mb-1">
										No workouts this week
									</p>
									<p className="text-sm text-muted-foreground">
										Complete a workout in the mobile app to see your stats here
									</p>
								</div>
							</Card>
						) : (
							<Card className="p-5 signal-panel">
								<div className="mb-4">
									<div className="text-3xl font-bold text-white mb-1 font-data">
										{formatVolume(weeklyTotal, unit)}
									</div>
									<div className="text-sm text-success flex items-center gap-1">
										<TrendingUp className="w-4 h-4" />
										<span>This week's total</span>
									</div>
								</div>

								<div className="flex items-end justify-between h-32 gap-2">
									{barHeights.map((height, i) => (
										<div
											key={i}
											className="flex-1 flex flex-col items-center gap-2"
										>
											<motion.div
												className="w-full bg-gradient-to-t from-primary to-accent rounded-t"
												initial={{ height: 0 }}
												animate={{ height: `${Math.max(height, 2)}%` }}
												transition={{ delay: 0.5 + i * 0.1, duration: 0.5 }}
											/>
											<span className="text-xs text-muted-foreground">
												{["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"][i]}
											</span>
										</div>
									))}
								</div>
							</Card>
						)}
					</motion.div>

					{/* Goal & Recovery Widgets */}
					<motion.div
						initial={{ opacity: 0, y: 20 }}
						animate={{ opacity: 1, y: 0 }}
						transition={{ delay: 0.45 }}
					>
						<GoalDashboardWidget />
					</motion.div>
					<motion.div
						initial={{ opacity: 0, y: 20 }}
						animate={{ opacity: 1, y: 0 }}
						transition={{ delay: 0.47 }}
					>
						<RecoveryDashboardWidget />
					</motion.div>

					{/* Recent Activity */}
					<motion.div
						initial={{ opacity: 0, y: 20 }}
						animate={{ opacity: 1, y: 0 }}
						transition={{ delay: 0.5 }}
					>
						<div className="flex items-center justify-between mb-3">
							<h2 className="text-lg font-semibold text-white">
								Recent Activity
							</h2>
							<Link
								to="/history"
								className="text-sm text-primary flex items-center gap-1"
							>
								View All
								<ChevronRight className="w-4 h-4" />
							</Link>
						</div>

						{workoutsLoading ? (
							<div className="space-y-3">
								{Array.from({ length: 3 }).map((_, i) => (
									<WorkoutCardSkeleton key={i} />
								))}
							</div>
						) : recentWorkouts.length === 0 ? (
							<Card className="p-5 signal-panel">
								<div className="flex flex-col items-center justify-center py-6 text-center">
									<Dumbbell className="w-10 h-10 text-secondary mb-3" />
									<p className="text-muted-foreground mb-1">No workouts yet</p>
									<p className="text-sm text-muted-foreground">
										Sync from the Vitruvian mobile app to see your activity
									</p>
								</div>
							</Card>
						) : (
							<div className="space-y-3">
								{recentWorkouts.slice(0, 3).map((workout: WorkoutSession) => (
									<MobileRecentActivityCard
										key={workout.id}
										title={workout.name}
										time={formatRelativeTime(workout.started_at)}
										volume={formatVolume(workout.total_volume, unit)}
										duration={`${workout.duration_seconds} min`}
										prs={workout.pr_count}
									/>
								))}
							</div>
						)}
					</motion.div>

					{/* PWA Install Prompt */}
					<PWAInstallPrompt workoutCount={workouts?.length ?? 0} />
				</div>
			</div>

			{/* ---- DESKTOP LAYOUT (>= 768px) ---- */}
			<div className="hidden md:block">
				<PageShell>
					{/* Welcome Header */}
					<motion.div
						initial={{ opacity: 0, y: 20 }}
						animate={{ opacity: 1, y: 0 }}
						className="mb-8 pb-8 border-b border-border"
					>
						<h1 className="text-display-1 mb-2">
							Welcome back,{" "}
							<span className="text-primary">
								{profile?.display_name ??
									user?.email?.split("@")[0] ??
									"Athlete"}
							</span>
						</h1>
						<p className="text-muted-foreground text-lg">
							Let's make today count. Your strength awaits.
						</p>
					</motion.div>

					{/* Portal Banner */}
					<PortalBanner />

					{/* ── Top Row: Streak + Quick Stats (5/7 split) ── */}
					<div className="grid grid-cols-1 lg:grid-cols-12 gap-6 mb-6">
						{/* Streak Widget */}
						<motion.div
							initial={{ opacity: 0, y: 20 }}
							animate={{ opacity: 1, y: 0 }}
							transition={{ delay: 0.1 }}
							whileHover={hover.lift}
							className="col-span-1 lg:col-span-5"
						>
							<div className="signal-panel p-8 flex items-center justify-center relative overflow-hidden h-full">
								<div className="absolute inset-0 bg-gradient-to-r from-primary/10 to-transparent opacity-50" />
								<div className="flex items-center gap-6 z-10">
									<motion.div
										animate={{
											scale: [1, 1.1, 1],
											filter: [
												"drop-shadow(0 0 10px #FF6B35)",
												"drop-shadow(0 0 20px #DC2626)",
												"drop-shadow(0 0 10px #FF6B35)",
											],
										}}
										transition={{
											duration: 2,
											repeat: Number.POSITIVE_INFINITY,
											ease: "easeInOut",
										}}
									>
										<Flame
											className="w-16 h-16 text-primary"
											fill={PHOENIX.ember}
										/>
									</motion.div>
									<div>
										<h3 className="text-3xl font-bold mb-1 text-white font-data">
											<NumberFlow
												value={streak ?? 0}
												className="tabular-nums"
											/>{" "}
											Day Streak
										</h3>
										<p className="text-muted-foreground">
											{streak > 0
												? "Keep the fire burning!"
												: "Start your streak today!"}
										</p>
									</div>
								</div>
							</div>
						</motion.div>

						{/* Quick Stats Widget */}
						<motion.div
							initial={{ opacity: 0, y: 20 }}
							animate={{ opacity: 1, y: 0 }}
							transition={{ delay: 0.15 }}
							className="col-span-1 lg:col-span-7"
						>
							<div className="signal-panel p-6 h-full">
								<h3 className="text-lg font-medium mb-6 text-white">
									Quick Stats
								</h3>
								{workoutsLoading ? (
									<div className="grid grid-cols-2 gap-y-6 gap-x-4">
										{Array.from({ length: 4 }).map((_, i) => (
											<div key={i} className="flex items-center gap-4">
												<Skeleton className="w-12 h-12 rounded-xl" />
												<div>
													<Skeleton className="h-3 w-20 mb-2" />
													<Skeleton className="h-6 w-12" />
												</div>
											</div>
										))}
									</div>
								) : (
									<div className="grid grid-cols-2 gap-y-6 gap-x-4">
										<div className="flex items-center gap-4">
											<div className="w-12 h-12 rounded-xl bg-surface-3 flex items-center justify-center text-muted-foreground border border-white/5">
												<Dumbbell className="w-5 h-5" />
											</div>
											<div>
												<div className="text-sm text-muted-foreground mb-1">
													Total Workouts
												</div>
												<div className="text-2xl font-semibold text-white font-data">
													<NumberFlow
														value={workouts?.length ?? 0}
														className="tabular-nums"
													/>
												</div>
											</div>
										</div>
										<div className="flex items-center gap-4">
											<div className="w-12 h-12 rounded-xl bg-surface-3 flex items-center justify-center text-muted-foreground border border-white/5">
												<Trophy className="w-5 h-5" />
											</div>
											<div>
												<div className="text-sm text-muted-foreground mb-1">
													Personal Records
												</div>
												<div className="text-2xl font-semibold text-white font-data">
													<NumberFlow
														value={recentPRs?.length ?? 0}
														className="tabular-nums"
													/>
												</div>
											</div>
										</div>
										<div className="flex items-center gap-4">
											<div className="w-12 h-12 rounded-xl bg-surface-3 flex items-center justify-center text-muted-foreground border border-white/5">
												<Award className="w-5 h-5" />
											</div>
											<div>
												<div className="text-sm text-muted-foreground mb-1">
													Badges Earned
												</div>
												<div className="text-2xl font-semibold text-white font-data">
													{badgesLoading ? "..." : (earnedBadges?.length ?? 0)}
												</div>
											</div>
										</div>
										<div className="flex items-center gap-4">
											<div className="w-12 h-12 rounded-xl bg-surface-3 flex items-center justify-center text-muted-foreground border border-white/5">
												<TrendingUp className="w-5 h-5" />
											</div>
											<div>
												<div className="text-sm text-muted-foreground mb-1">
													Weekly Volume
												</div>
												<div className="text-2xl font-semibold text-white font-data">
													{formatVolume(weeklyTotal, unit)}
												</div>
											</div>
										</div>
									</div>
								)}
							</div>
						</motion.div>
					</div>

					{/* ── Middle Row: 4-column widget grid ── */}
					<div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6 mb-6">
						{/* Scheduled Workout */}
						<motion.div
							initial={{ opacity: 0, y: 20 }}
							animate={{ opacity: 1, y: 0 }}
							transition={{ delay: 0.2 }}
						>
							{activeCycle ? (
								<NextWorkoutWidget cycleId={activeCycle.id} />
							) : (
								<div className="signal-panel p-6 flex flex-col items-center justify-center text-center h-full">
									<Calendar className="w-12 h-12 text-primary mb-4 opacity-80" />
									<h3 className="text-xl font-medium text-white mb-6">
										Scheduled
										<br />
										Workout
									</h3>
									<Button
										variant="outline"
										className="w-full border-white/10 hover:bg-surface-3"
										asChild
									>
										<Link to="/cycles">Browse Training Cycles</Link>
									</Button>
								</div>
							)}
						</motion.div>

						{/* Weekly Volume */}
						<motion.div
							initial={{ opacity: 0, y: 20 }}
							animate={{ opacity: 1, y: 0 }}
							transition={{ delay: 0.25 }}
						>
							{statsLoading ? (
								<ChartSkeleton />
							) : (
								<div className="signal-panel p-6 flex flex-col h-full">
									<h3 className="text-lg font-medium mb-6 text-white">
										Weekly Volume
									</h3>
									{weeklyTotal === 0 ? (
										<div className="flex-1 flex flex-col items-center justify-center text-center">
											<Dumbbell className="w-10 h-10 text-secondary mb-3" />
											<p className="text-sm text-muted-foreground">
												No workouts this week
											</p>
										</div>
									) : (
										<>
											<div className="flex-1 flex items-end justify-between gap-2 mb-2 min-h-[128px]">
												{barHeights.map((height, i) => (
													<div
														key={i}
														className="flex-1 flex flex-col items-center gap-0 h-full justify-end"
													>
														<motion.div
															className="w-full bg-primary rounded-t-sm"
															initial={{ height: 0 }}
															animate={{
																height: `${Math.max(height, 2)}%`,
															}}
															transition={{
																delay: 0.5 + i * 0.1,
																duration: 0.5,
															}}
															style={{
																background: `linear-gradient(to top, var(--primary), var(--accent))`,
															}}
														/>
													</div>
												))}
											</div>
											<div className="flex justify-between text-xs text-muted-foreground">
												{["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].map(
													(day) => (
														<span key={day}>{day}</span>
													),
												)}
											</div>
										</>
									)}
								</div>
							)}
						</motion.div>

						{/* Goals Widget */}
						<motion.div
							initial={{ opacity: 0, y: 20 }}
							animate={{ opacity: 1, y: 0 }}
							transition={{ delay: 0.3 }}
						>
							<GoalDashboardWidget />
						</motion.div>

						{/* Recovery Widget */}
						<motion.div
							initial={{ opacity: 0, y: 20 }}
							animate={{ opacity: 1, y: 0 }}
							transition={{ delay: 0.35 }}
						>
							<RecoveryDashboardWidget />
						</motion.div>
					</div>

					{/* ── Bottom Section: Activity + Sidebar Widgets ── */}
					<div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
						{/* Left: Recent Activity + Volume Chart */}
						<div className="lg:col-span-2 space-y-6">
							{/* Recent Workouts */}
							<motion.div
								initial={{ opacity: 0, y: 20 }}
								animate={{ opacity: 1, y: 0 }}
								transition={{ delay: 0.4 }}
							>
								<Card className="p-5 signal-panel">
									<div className="flex items-center justify-between mb-4">
										<h3 className="text-xl text-white">Recent Activity</h3>
										<Button
											variant="ghost"
											className="text-primary hover:bg-primary/10"
											asChild
										>
											<Link to="/history">
												View All
												<ArrowRight className="w-4 h-4 ml-2" />
											</Link>
										</Button>
									</div>
									{workoutsLoading ? (
										<div className="space-y-3">
											{Array.from({ length: 3 }).map((_, i) => (
												<WorkoutCardSkeleton key={i} />
											))}
										</div>
									) : recentWorkouts.length === 0 ? (
										<div className="flex flex-col items-center justify-center py-8 text-center">
											<Dumbbell className="w-10 h-10 text-secondary mb-3" />
											<p className="text-muted-foreground mb-1">
												No workouts yet
											</p>
											<p className="text-sm text-muted-foreground">
												Sync your first workout from the Vitruvian mobile app
											</p>
										</div>
									) : (
										<div className="space-y-3">
											{recentWorkouts.map((workout: WorkoutSession) => (
												<div
													key={workout.id}
													className="flex items-center justify-between p-3 bg-background rounded-lg border border-white/5 hover:border-primary/50 transition-all cursor-pointer"
												>
													<div className="flex-1">
														<div className="flex items-center gap-2 mb-1">
															<h4 className="text-white">{workout.name}</h4>
															{workout.pr_count > 0 && (
																<Badge className="bg-accent text-background border-0 text-xs">
																	{workout.pr_count} PR
																	{workout.pr_count > 1 ? "s" : ""}
																</Badge>
															)}
														</div>
														<p className="text-sm text-muted-foreground">
															{formatRelativeTime(workout.started_at)}
														</p>
													</div>
													<div className="text-right">
														<div className="text-primary font-semibold font-data">
															{formatVolume(workout.total_volume, unit)}
														</div>
														<div className="text-sm text-muted-foreground font-data">
															{workout.duration_seconds} min
														</div>
													</div>
												</div>
											))}
										</div>
									)}
								</Card>
							</motion.div>

							{/* Detailed Volume Chart (larger space for the area chart) */}
							{weeklyTotal > 0 && (
								<motion.div
									initial={{ opacity: 0, y: 20 }}
									animate={{ opacity: 1, y: 0 }}
									transition={{ delay: 0.45 }}
								>
									<Card className="p-5 signal-panel">
										<h3 className="text-xl text-white mb-6">
											Volume Breakdown
										</h3>
										<ResponsiveContainer width="100%" height={200}>
											<AreaChart data={weeklyVolumeData}>
												<defs>
													<linearGradient
														id="volumeGradient"
														x1="0"
														y1="0"
														x2="0"
														y2="1"
													>
														<stop
															offset="5%"
															stopColor={PHOENIX.ember}
															stopOpacity={0.8}
														/>
														<stop
															offset="95%"
															stopColor={PHOENIX.flameRed}
															stopOpacity={0.1}
														/>
													</linearGradient>
												</defs>
												<CartesianGrid strokeOpacity={0.3} vertical={false} />
												<XAxis
													dataKey="day"
													stroke={PHOENIX.mutedForeground}
													tickLine={false}
													axisLine={false}
													tick={{
														fontSize: 11,
														fontFamily: "Inter, sans-serif",
													}}
												/>
												<YAxis
													stroke={PHOENIX.mutedForeground}
													tickLine={false}
													axisLine={false}
													tick={{
														fontSize: 11,
														fontFamily: "Inter, sans-serif",
													}}
												/>
												<Tooltip content={<RechartsTooltip />} />
												<Area
													type="monotone"
													dataKey="volume"
													stroke={PHOENIX.ember}
													strokeWidth={2}
													fill="url(#volumeGradient)"
													animationDuration={800}
													animationEasing="ease-out"
												/>
											</AreaChart>
										</ResponsiveContainer>
										<div className="mt-4 flex items-center justify-between text-sm">
											<span className="text-muted-foreground">
												Total this week
											</span>
											<span className="text-primary font-semibold font-data">
												{formatVolume(weeklyTotal, unit)}
											</span>
										</div>
									</Card>
								</motion.div>
							)}
						</div>

						{/* Right: PRs, Challenges, Badges */}
						<motion.div
							variants={staggerContainer}
							initial="hidden"
							animate="visible"
							className="space-y-6"
						>
							{/* Recent PRs */}
							<motion.div variants={fadeUp}>
								<Card className="p-5 signal-panel">
									<h3 className="text-xl text-white mb-4 flex items-center gap-2">
										<Trophy className="w-5 h-5 text-accent" />
										Recent PRs
									</h3>
									{prsLoading ? (
										<div className="space-y-3">
											{Array.from({ length: 3 }).map((_, i) => (
												<div
													key={i}
													className="p-3 rounded-lg border border-white/5"
												>
													<Skeleton className="h-4 w-24 mb-2" />
													<Skeleton className="h-4 w-32" />
												</div>
											))}
										</div>
									) : !recentPRs || recentPRs.length === 0 ? (
										<div className="flex flex-col items-center justify-center py-6 text-center">
											<Trophy className="w-8 h-8 text-secondary mb-2" />
											<p className="text-sm text-muted-foreground">
												No personal records yet
											</p>
										</div>
									) : (
										<div className="space-y-3">
											{recentPRs.map((pr: PersonalRecord) => (
												<div
													key={pr.id}
													className="p-3 bg-gradient-to-br from-primary/10 to-chart-2/10 border border-primary/30 rounded-lg"
												>
													<div className="flex items-center justify-between mb-1">
														<h4 className="text-white">{pr.exercise_name}</h4>
														<Badge className="bg-accent text-background border-0">
															NEW
														</Badge>
													</div>
													<div className="flex items-center justify-between">
														<span className="text-primary font-data">
															{formatPersonalRecordValue(pr, unit)}
														</span>
														<span className="text-sm text-muted-foreground">
															{formatRelativeTime(pr.achieved_at)}
														</span>
													</div>
												</div>
											))}
										</div>
									)}
								</Card>
							</motion.div>

							{/* Active Challenges */}
							<motion.div variants={fadeUp}>
								<Card className="p-5 signal-panel">
									<h3 className="text-xl text-white mb-4">Active Challenges</h3>
									<ActiveChallengesSection userId={user?.id ?? ""} />
								</Card>
							</motion.div>

							{/* Badge Showcase */}
							<motion.div variants={fadeUp}>
								<Card className="p-5 signal-panel">
									<h3 className="text-xl text-white mb-4">Recent Badges</h3>
									{badgesLoading ? (
										<div className="space-y-3">
											{Array.from({ length: 3 }).map((_, i) => (
												<div
													key={i}
													className="p-3 rounded-lg border border-white/5"
												>
													<Skeleton className="h-4 w-24 mb-2" />
													<Skeleton className="h-3 w-32" />
												</div>
											))}
										</div>
									) : recentBadges.length === 0 ? (
										<div className="flex flex-col items-center justify-center py-6 text-center">
											<Award className="w-8 h-8 text-secondary mb-2" />
											<p className="text-sm text-muted-foreground">
												No badges earned yet
											</p>
											<p className="text-xs text-muted-foreground mt-1">
												Complete workouts in the mobile app to start earning
												badges
											</p>
										</div>
									) : (
										<div className="space-y-3">
											{recentBadges.map((badge) => (
												<div
													key={`${badge.badge_id}-${badge.earned_at.toISOString()}`}
													className="p-3 bg-gradient-to-br from-primary/10 to-chart-2/10 border border-primary/30 rounded-lg"
												>
													<div className="flex items-center justify-between gap-3">
														<div>
															<div className="text-white">
																{badge.badge_name}
															</div>
															<div className="text-xs text-muted-foreground">
																{badge.badge_description ?? badge.badge_id}
															</div>
														</div>
														<Badge className="bg-accent text-background border-0 uppercase">
															{badge.badge_tier}
														</Badge>
													</div>
												</div>
											))}
										</div>
									)}
								</Card>
							</motion.div>
						</motion.div>
					</div>

					{/* PWA Install Prompt */}
					<div className="mt-6">
						<PWAInstallPrompt workoutCount={workouts?.length ?? 0} />
					</div>
				</PageShell>
			</div>
		</div>
	);
}
