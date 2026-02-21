import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
	Award,
	Bell,
	Calendar,
	ChevronRight,
	Dumbbell,
	Flame,
	Target,
	TrendingUp,
	Trophy,
} from "lucide-react";
import { motion } from "motion/react";
import { useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import { Badge } from "@/app/components/ui/badge";
import { Button } from "@/app/components/ui/button";
import { Card } from "@/app/components/ui/card";
import { Progress } from "@/app/components/ui/progress";
import { Skeleton, WorkoutCardSkeleton } from "@/app/components/ui/skeleton";
import { useAuth } from "@/app/hooks/useAuth";
import { useStreak } from "@/hooks/useStreak";
import { PHOENIX } from "@/lib/colors";
import { cycleListOptions } from "@/queries/cycles";
import { dashboardStatsOptions, workoutListOptions } from "@/queries/workouts";
import type { WorkoutSession } from "@/schemas/transforms";
import { GoalDashboardWidget } from "./GoalDashboardWidget";
import { NextWorkoutWidget } from "./NextWorkoutWidget";
import { PWAInstallPrompt } from "./PWAInstallPrompt";
import { RecoveryDashboardWidget } from "./RecoveryDashboardWidget";

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

export function DashboardMobile() {
	const [isPullRefreshing, setIsPullRefreshing] = useState(false);
	const { user } = useAuth();
	const queryClient = useQueryClient();

	const { data: workouts, isPending: workoutsLoading } = useQuery(
		workoutListOptions(user?.id),
	);
	const { data: weeklyStats, isPending: statsLoading } = useQuery(
		dashboardStatsOptions(user?.id),
	);
	const { data: cycles } = useQuery(cycleListOptions(user?.id ?? ""));

	const streak = useStreak(workouts);
	const activeCycle = cycles?.find((c) => c.status === "active");

	const recentWorkouts = workouts?.slice(0, 3) ?? [];

	// Derive weekly volume total from stats
	const weeklyTotal = (weeklyStats ?? []).reduce(
		(sum, row) => sum + row.total_volume * 2, // x2 for per-cable to total
		0,
	);

	// Derive daily volumes for bar chart (percentages relative to max)
	const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
	const volumeByDay: Record<string, number> = {};
	days.forEach((d) => (volumeByDay[d] = 0));
	(weeklyStats ?? []).forEach((row) => {
		const dayName = days[new Date(row.started_at).getDay()];
		volumeByDay[dayName] += row.total_volume * 2;
	});
	const orderedDays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
	const dailyVolumes = orderedDays.map((d) => volumeByDay[d]);
	const maxVolume = Math.max(...dailyVolumes, 1);
	const barHeights = dailyVolumes.map((v) => Math.round((v / maxVolume) * 100));

	const _handleRefresh = async () => {
		setIsPullRefreshing(true);
		await queryClient.invalidateQueries({ queryKey: ["workouts"] });
		setIsPullRefreshing(false);
	};

	// Zero-session welcome view for mobile
	const hasNoWorkouts =
		!workoutsLoading && (!workouts || workouts.length === 0);

	if (hasNoWorkouts) {
		return (
			<div className="min-h-screen bg-background pb-24">
				<div className="px-4 py-12">
					<motion.div
						initial={{ opacity: 0, y: 20 }}
						animate={{ opacity: 1, y: 0 }}
						className="text-center mb-10"
					>
						<div className="w-16 h-16 mx-auto mb-4 rounded-full bg-gradient-to-br from-primary/20 to-chart-2/20 flex items-center justify-center">
							<Flame className="w-8 h-8 text-primary" fill={PHOENIX.ember} />
						</div>
						<h1 className="text-3xl font-bold mb-3">
							<span className="bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
								Welcome to Phoenix Portal
							</span>
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
							<Card className="p-5 bg-gradient-to-br from-surface-2 to-background border-secondary">
								<div className="flex items-center gap-4">
									<div className="w-10 h-10 rounded-lg bg-gradient-to-br from-primary to-chart-2 flex items-center justify-center flex-shrink-0">
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
								<Card className="p-5 bg-gradient-to-br from-surface-2 to-background border-secondary">
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
								<Card className="p-5 bg-gradient-to-br from-surface-2 to-background border-secondary">
									<div className="flex items-center gap-4">
										<div className="w-10 h-10 rounded-lg bg-gradient-to-br from-accent to-[#D97706] flex items-center justify-center flex-shrink-0">
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
			</div>
		);
	}

	return (
		<div className="min-h-screen bg-background pb-24">
			{/* Mobile Header */}
			<div className="sticky top-0 z-40 bg-background/95 backdrop-blur-lg border-b border-secondary px-4 py-4">
				<div className="flex items-center justify-between">
					<div>
						<h1 className="text-2xl font-bold text-white">Welcome back!</h1>
						<p className="text-sm text-muted-foreground">Let's crush today</p>
					</div>
					<button
						className="relative p-2 hover:bg-surface-2 rounded-full transition-colors"
						onClick={() => toast("Notifications coming in a future update")}
					>
						<Bell className="w-6 h-6 text-secondary-foreground" />
						<span className="absolute top-1 right-1 w-2 h-2 bg-primary rounded-full animate-pulse" />
					</button>
				</div>
			</div>

			{/* Pull to Refresh Indicator */}
			{isPullRefreshing && (
				<div className="flex justify-center py-4">
					<motion.div
						animate={{ rotate: 360 }}
						transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
					>
						<Flame className="w-6 h-6 text-primary" fill={PHOENIX.ember} />
					</motion.div>
				</div>
			)}

			{/* Content */}
			<div className="px-4 py-6 space-y-6">
				{/* Streak Card - Full Width */}
				<motion.div
					initial={{ opacity: 0, y: 20 }}
					animate={{ opacity: 1, y: 0 }}
					transition={{ delay: 0.1 }}
				>
					<Card className="p-6 bg-gradient-to-br from-primary/20 to-chart-2/20 border-2 border-primary/50">
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
								<div className="text-4xl font-bold text-white mb-1">
									{streak} {streak === 1 ? "Day" : "Days"}
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
						<Card className="p-6 bg-gradient-to-br from-surface-2 to-background border-secondary">
							<div className="flex flex-col items-center justify-center py-6 text-center">
								<Calendar className="w-10 h-10 text-secondary mb-3" />
								<p className="text-muted-foreground mb-1">
									No scheduled workout
								</p>
								<p className="text-sm text-muted mb-4">
									Create a training cycle to see your next workout here
								</p>
								<Button
									className="bg-gradient-to-r from-primary to-chart-2 hover:from-chart-2 hover:to-accent border-0"
									asChild
								>
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
					<h2 className="text-lg font-semibold text-white mb-3">Quick Stats</h2>
					{workoutsLoading ? (
						<div className="flex gap-3 overflow-x-auto pb-2 -mx-4 px-4">
							{Array.from({ length: 4 }).map((_, i) => (
								<Card
									key={i}
									className="p-4 bg-gradient-to-br from-surface-2 to-background border-secondary min-w-[120px] flex-shrink-0"
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
								label="Workouts"
								gradient="from-primary to-chart-2"
							/>
							<QuickStatCard
								icon={<Award className="w-5 h-5" />}
								value={String(
									workouts?.reduce((sum, w) => sum + w.pr_count, 0) ?? 0,
								)}
								label="PRs"
								gradient="from-accent to-[#D97706]"
							/>
							<QuickStatCard
								icon={<TrendingUp className="w-5 h-5" />}
								value={
									weeklyTotal > 0 ? `${(weeklyTotal / 1000).toFixed(0)}k` : "--"
								}
								label="Volume"
								gradient="from-success to-[#059669]"
							/>
							<QuickStatCard
								icon={<Target className="w-5 h-5" />}
								value="--"
								label="Goals"
								gradient="from-[#6366F1] to-[#4F46E5]"
							/>
						</div>
					)}
				</motion.div>

				{/* Weekly Volume Chart */}
				<motion.div
					initial={{ opacity: 0, y: 20 }}
					animate={{ opacity: 1, y: 0 }}
					transition={{ delay: 0.4 }}
				>
					<h2 className="text-lg font-semibold text-white mb-3">This Week</h2>
					{statsLoading ? (
						<Card className="p-6 bg-gradient-to-br from-surface-2 to-background border-secondary">
							<Skeleton className="h-8 w-32 mb-1" />
							<Skeleton className="h-4 w-40 mb-4" />
							<Skeleton className="h-32 w-full" />
						</Card>
					) : weeklyTotal === 0 ? (
						<Card className="p-6 bg-gradient-to-br from-surface-2 to-background border-secondary">
							<div className="flex flex-col items-center justify-center py-8 text-center">
								<Dumbbell className="w-10 h-10 text-secondary mb-3" />
								<p className="text-muted-foreground mb-1">
									No workouts this week
								</p>
								<p className="text-sm text-muted">
									Complete a workout in the mobile app to see your stats here
								</p>
							</div>
						</Card>
					) : (
						<Card className="p-6 bg-gradient-to-br from-surface-2 to-background border-secondary">
							<div className="mb-4">
								<div className="text-3xl font-bold text-white mb-1">
									{Math.round(weeklyTotal).toLocaleString()} kg
								</div>
								<div className="text-sm text-success flex items-center gap-1">
									<TrendingUp className="w-4 h-4" />
									<span>This week's total</span>
								</div>
							</div>

							{/* Simple bar chart */}
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
										<span className="text-xs text-muted">
											{["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"][i]}
										</span>
									</div>
								))}
							</div>
						</Card>
					)}
				</motion.div>

				{/* Goal & Recovery Widgets (self-gate: premium only) */}
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
						<Card className="p-6 bg-gradient-to-br from-surface-2 to-background border-secondary">
							<div className="flex flex-col items-center justify-center py-6 text-center">
								<Dumbbell className="w-10 h-10 text-secondary mb-3" />
								<p className="text-muted-foreground mb-1">No workouts yet</p>
								<p className="text-sm text-muted">
									Sync from the Vitruvian mobile app to see your activity
								</p>
							</div>
						</Card>
					) : (
						<div className="space-y-3">
							{recentWorkouts.map((workout: WorkoutSession) => (
								<RecentActivityCard
									key={workout.id}
									title={workout.name}
									time={formatRelativeTime(workout.started_at)}
									volume={`${workout.total_volume.toLocaleString()} kg`}
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
	);
}

function QuickStatCard({
	icon,
	value,
	label,
	gradient,
}: {
	icon: React.ReactNode;
	value: string;
	label: string;
	gradient: string;
}) {
	return (
		<Card className="p-4 bg-gradient-to-br from-surface-2 to-background border-secondary min-w-[120px] flex-shrink-0">
			<div
				className={`w-10 h-10 rounded-lg bg-gradient-to-br ${gradient} flex items-center justify-center mb-3 text-white`}
			>
				{icon}
			</div>
			<div className="text-2xl font-bold text-white mb-1">{value}</div>
			<div className="text-xs text-muted-foreground">{label}</div>
		</Card>
	);
}

function RecentActivityCard({
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
		<Card className="p-4 bg-gradient-to-br from-surface-2 to-background border-secondary active:scale-[0.98] transition-transform">
			<div className="flex items-center justify-between mb-2">
				<h4 className="font-semibold text-white">{title}</h4>
				<span className="text-xs text-muted">{time}</span>
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
