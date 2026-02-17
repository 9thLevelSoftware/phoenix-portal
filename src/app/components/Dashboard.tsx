import { useQuery } from "@tanstack/react-query";
import {
	ArrowRight,
	Award,
	Calendar,
	Clock,
	Dumbbell,
	Eye,
	Flame,
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
import { Badge } from "@/app/components/ui/badge";
import { Button } from "@/app/components/ui/button";
import { Card } from "@/app/components/ui/card";
import {
	ChartSkeleton,
	Skeleton,
	WorkoutCardSkeleton,
} from "@/app/components/ui/skeleton";
import { useAuth } from "@/app/hooks/useAuth";
import {
	dashboardStatsOptions,
	recentPRsOptions,
	workoutListOptions,
} from "@/queries/workouts";
import type { PersonalRecord, WorkoutSession } from "@/schemas/transforms";
import { PortalBanner } from "./PortalBanner";
import { SyncStatus } from "./SyncStatus";

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

export function Dashboard() {
	const { user } = useAuth();
	const { data: workouts, isPending: workoutsLoading } = useQuery(
		workoutListOptions(user?.id),
	);
	const { data: weeklyStats, isPending: statsLoading } = useQuery(
		dashboardStatsOptions(user?.id),
	);
	const { data: recentPRs, isPending: prsLoading } = useQuery(
		recentPRsOptions(user?.id),
	);

	const recentWorkouts = workouts?.slice(0, 5) ?? [];
	const weeklyVolumeData = deriveWeeklyVolume(weeklyStats ?? undefined);
	const weeklyTotal = weeklyVolumeData.reduce((sum, d) => sum + d.volume, 0);

	return (
		<div className="min-h-screen bg-background pb-20 md:pb-8">
			<div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
				{/* Welcome Header */}
				<motion.div
					initial={{ opacity: 0, y: 20 }}
					animate={{ opacity: 1, y: 0 }}
					className="mb-8"
				>
					<h1 className="text-3xl sm:text-4xl mb-2">
						Welcome back,{" "}
						<span className="bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
							{user?.email?.split("@")[0] ?? "Athlete"}
						</span>
					</h1>
					<p className="text-muted-foreground">
						Let's make today count. Your strength awaits.
					</p>
				</motion.div>

				{/* Portal Banner */}
				<PortalBanner />

				{/* Main Grid */}
				<div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
					{/* Left Column - Main Stats */}
					<div className="lg:col-span-2 space-y-6">
						{/* Vitruvian Sync Status */}
						<motion.div
							initial={{ opacity: 0, y: 20 }}
							animate={{ opacity: 1, y: 0 }}
							transition={{ delay: 0.05 }}
						>
							<SyncStatus lastSync="2 minutes ago" status="synced" />
						</motion.div>

						{/* Streak Card */}
						<motion.div
							initial={{ opacity: 0, y: 20 }}
							animate={{ opacity: 1, y: 0 }}
							transition={{ delay: 0.1 }}
						>
							<Card className="p-6 bg-gradient-to-br from-primary/20 to-chart-2/20 border-primary border-2">
								<div className="flex items-center justify-between">
									<div>
										<div className="flex items-center gap-3 mb-2">
											<Flame
												className="w-8 h-8 text-accent"
												fill="#FF6B35"
											/>
											<div>
												<h3 className="text-2xl text-white">7 Day Streak</h3>
												<p className="text-secondary-foreground text-sm">
													Keep the fire burning!
												</p>
											</div>
										</div>
									</div>
									<div className="text-right">
										<div className="text-4xl bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
											{"\u{1F525}"}
										</div>
									</div>
								</div>
							</Card>
						</motion.div>

						{/* Today's Workout Card */}
						<motion.div
							initial={{ opacity: 0, y: 20 }}
							animate={{ opacity: 1, y: 0 }}
							transition={{ delay: 0.2 }}
						>
							<Card className="p-6 bg-gradient-to-br from-surface-2 to-background border-secondary hover:border-primary/50 transition-all duration-300">
								<div className="flex items-center justify-between mb-4">
									<h3 className="text-xl text-white">Scheduled Workout</h3>
									<Badge className="bg-success text-white border-0">
										Scheduled
									</Badge>
								</div>
								<div className="space-y-4">
									<div>
										<h4 className="text-2xl text-primary mb-2">Push Day A</h4>
										<p className="text-muted-foreground">
											Part of: Upper/Lower 4-Day Split
										</p>
									</div>
									<div className="flex items-center gap-4 text-sm text-muted-foreground">
										<div className="flex items-center gap-2">
											<Dumbbell className="w-4 h-4" />
											<span>6 exercises</span>
										</div>
										<div className="flex items-center gap-2">
											<Clock className="w-4 h-4" />
											<span>~60 min</span>
										</div>
									</div>
									<Button className="w-full bg-gradient-to-r from-primary to-chart-2 hover:from-chart-2 hover:to-accent border-0 shadow-lg shadow-primary/50">
										<Eye className="w-4 h-4 mr-2" />
										View Routine Details
									</Button>
								</div>
							</Card>
						</motion.div>

						{/* Weekly Volume Chart */}
						<motion.div
							initial={{ opacity: 0, y: 20 }}
							animate={{ opacity: 1, y: 0 }}
							transition={{ delay: 0.3 }}
						>
							{statsLoading ? (
								<ChartSkeleton />
							) : (
								<Card className="p-6 bg-gradient-to-br from-surface-2 to-background border-secondary">
									<h3 className="text-xl text-white mb-6">Weekly Volume</h3>
									{weeklyTotal === 0 ? (
										<div className="flex flex-col items-center justify-center py-12 text-center">
											<Dumbbell className="w-12 h-12 text-secondary mb-4" />
											<p className="text-muted-foreground mb-2">
												No workouts this week yet
											</p>
											<p className="text-sm text-muted">
												Complete a workout in the mobile app to see your volume
												here
											</p>
										</div>
									) : (
										<>
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
																stopColor="#FF6B35"
																stopOpacity={0.8}
															/>
															<stop
																offset="95%"
																stopColor="#DC2626"
																stopOpacity={0.1}
															/>
														</linearGradient>
													</defs>
													<CartesianGrid
														strokeDasharray="3 3"
														stroke="#374151"
													/>
													<XAxis dataKey="day" stroke="#9CA3AF" />
													<YAxis stroke="#9CA3AF" />
													<Tooltip
														contentStyle={{
															backgroundColor: "#1a1a1a",
															border: "1px solid #374151",
															borderRadius: "8px",
															color: "#E5E7EB",
														}}
													/>
													<Area
														type="monotone"
														dataKey="volume"
														stroke="#FF6B35"
														strokeWidth={2}
														fill="url(#volumeGradient)"
													/>
												</AreaChart>
											</ResponsiveContainer>
											<div className="mt-4 flex items-center justify-between text-sm">
												<span className="text-muted-foreground">Total this week</span>
												<span className="text-primary font-semibold">
													{weeklyTotal.toLocaleString()} kg
												</span>
											</div>
										</>
									)}
								</Card>
							)}
						</motion.div>

						{/* Recent Workouts */}
						<motion.div
							initial={{ opacity: 0, y: 20 }}
							animate={{ opacity: 1, y: 0 }}
							transition={{ delay: 0.4 }}
						>
							<Card className="p-6 bg-gradient-to-br from-surface-2 to-background border-secondary">
								<div className="flex items-center justify-between mb-4">
									<h3 className="text-xl text-white">Recent Activity</h3>
									<Button
										variant="ghost"
										className="text-primary hover:bg-primary/10"
									>
										View All
										<ArrowRight className="w-4 h-4 ml-2" />
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
										<p className="text-muted-foreground mb-1">No workouts yet</p>
										<p className="text-sm text-muted">
											Sync your first workout from the Vitruvian mobile app
										</p>
									</div>
								) : (
									<div className="space-y-3">
										{recentWorkouts.map((workout: WorkoutSession) => (
											<div
												key={workout.id}
												className="flex items-center justify-between p-3 bg-background rounded-lg border border-secondary hover:border-primary/50 transition-all cursor-pointer"
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
													<div className="text-primary font-semibold">
														{workout.total_volume.toLocaleString()} kg
													</div>
													<div className="text-sm text-muted-foreground">
														{workout.duration_seconds} min
													</div>
												</div>
											</div>
										))}
									</div>
								)}
							</Card>
						</motion.div>
					</div>

					{/* Right Column - Quick Stats & Challenges */}
					<div className="space-y-6">
						{/* Quick Stats */}
						<motion.div
							initial={{ opacity: 0, y: 20 }}
							animate={{ opacity: 1, y: 0 }}
							transition={{ delay: 0.2 }}
						>
							<Card className="p-6 bg-gradient-to-br from-surface-2 to-background border-secondary">
								<h3 className="text-xl text-white mb-4">Quick Stats</h3>
								{workoutsLoading ? (
									<div className="space-y-4">
										{Array.from({ length: 4 }).map((_, i) => (
											<div
												key={i}
												className="flex items-center justify-between"
											>
												<Skeleton className="h-4 w-28" />
												<Skeleton className="h-5 w-12" />
											</div>
										))}
									</div>
								) : (
									<div className="space-y-4">
										<div className="flex items-center justify-between">
											<div className="flex items-center gap-2 text-muted-foreground">
												<Calendar className="w-4 h-4" />
												<span>Total Workouts</span>
											</div>
											<span className="text-white text-lg">
												{workouts?.length ?? 0}
											</span>
										</div>
										<div className="flex items-center justify-between">
											<div className="flex items-center gap-2 text-muted-foreground">
												<Trophy className="w-4 h-4" />
												<span>Personal Records</span>
											</div>
											<span className="text-white text-lg">
												{recentPRs?.length ?? 0}
											</span>
										</div>
										<div className="flex items-center justify-between">
											<div className="flex items-center gap-2 text-muted-foreground">
												<Award className="w-4 h-4" />
												<span>Badges Earned</span>
											</div>
											<span className="text-white text-lg">--</span>
										</div>
										<div className="flex items-center justify-between">
											<div className="flex items-center gap-2 text-muted-foreground">
												<TrendingUp className="w-4 h-4" />
												<span>Weekly Volume</span>
											</div>
											<span className="text-primary text-lg">
												{weeklyTotal > 0
													? `${(weeklyTotal / 1000).toFixed(1)}k kg`
													: "--"}
											</span>
										</div>
									</div>
								)}
							</Card>
						</motion.div>

						{/* Recent PRs */}
						<motion.div
							initial={{ opacity: 0, y: 20 }}
							animate={{ opacity: 1, y: 0 }}
							transition={{ delay: 0.3 }}
						>
							<Card className="p-6 bg-gradient-to-br from-surface-2 to-background border-secondary">
								<h3 className="text-xl text-white mb-4 flex items-center gap-2">
									<Trophy className="w-5 h-5 text-accent" />
									Recent PRs
								</h3>
								{prsLoading ? (
									<div className="space-y-3">
										{Array.from({ length: 3 }).map((_, i) => (
											<div
												key={i}
												className="p-3 rounded-lg border border-secondary"
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
													<span className="text-primary">
														{pr.value} {pr.unit}
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
						<motion.div
							initial={{ opacity: 0, y: 20 }}
							animate={{ opacity: 1, y: 0 }}
							transition={{ delay: 0.4 }}
						>
							<Card className="p-6 bg-gradient-to-br from-surface-2 to-background border-secondary">
								<h3 className="text-xl text-white mb-4">Active Challenges</h3>
								<div className="flex flex-col items-center justify-center py-6 text-center">
									<Trophy className="w-8 h-8 text-secondary mb-2" />
									<p className="text-sm text-muted-foreground">
										No active challenges yet
									</p>
									<p className="text-xs text-muted mt-1">
										Join challenges from the Challenges page to track your
										progress here
									</p>
								</div>
								<Button
									variant="outline"
									className="w-full mt-4 border-primary text-primary hover:bg-primary/10"
									asChild
								>
									<Link to="/challenges">Browse Challenges</Link>
								</Button>
							</Card>
						</motion.div>

						{/* Badge Showcase */}
						<motion.div
							initial={{ opacity: 0, y: 20 }}
							animate={{ opacity: 1, y: 0 }}
							transition={{ delay: 0.5 }}
						>
							<Card className="p-6 bg-gradient-to-br from-surface-2 to-background border-secondary">
								<h3 className="text-xl text-white mb-4">Recent Badges</h3>
								<div className="flex flex-col items-center justify-center py-6 text-center">
									<Award className="w-8 h-8 text-secondary mb-2" />
									<p className="text-sm text-muted-foreground">No badges earned yet</p>
									<p className="text-xs text-muted mt-1">
										Complete challenges and hit milestones to earn badges
									</p>
								</div>
							</Card>
						</motion.div>
					</div>
				</div>
			</div>
		</div>
	);
}
