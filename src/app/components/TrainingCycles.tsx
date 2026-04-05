import { useQuery } from "@tanstack/react-query";
import {
	BedDouble,
	Calendar,
	Dumbbell,
	Edit,
	Eye,
	Flame,
	MoreVertical,
	Plus,
	Share2,
} from "lucide-react";
import { motion } from "motion/react";
import { useState } from "react";
import { useNavigate } from "react-router";
import { ShareContentDialog } from "@/app/components/community/ShareContentDialog";
import { PageShell } from "@/app/components/PageShell";
import { Badge } from "@/app/components/ui/badge";
import { Button } from "@/app/components/ui/button";
import { Card } from "@/app/components/ui/card";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/app/components/ui/dropdown-menu";
import { EmptyState } from "@/app/components/ui/empty-state";
import { Progress } from "@/app/components/ui/progress";
import { CardSkeleton } from "@/app/components/ui/skeleton";
import { useAuth } from "@/app/hooks/useAuth";
import { cycleListOptions } from "@/queries/cycles";
import { useProfileFilterStore } from "@/stores/useProfileFilterStore";

export function TrainingCycles() {
	const navigate = useNavigate();
	const { user } = useAuth();
	const { activeProfileId } = useProfileFilterStore();
	const { data: cycles, isPending } = useQuery(
		cycleListOptions(user?.id, activeProfileId),
	);

	const [shareDialogOpen, setShareDialogOpen] = useState(false);
	const allCycles = (cycles ?? []).map((c) => {
		// Compute current_week from started_at instead of using the hardcoded DB value
		let currentWeek = c.current_week;
		if (c.status === "active" && c.started_at) {
			const elapsed = Date.now() - c.started_at.getTime();
			const weeksElapsed = Math.floor(elapsed / (7 * 24 * 60 * 60 * 1000));
			currentWeek = Math.min(Math.max(weeksElapsed + 1, 1), c.duration_weeks);
		}
		return { ...c, current_week: currentWeek };
	});
	const activeCycle = allCycles.find((c) => c.status === "active");

	if (isPending) {
		return (
			<div className="min-h-screen pb-24 md:pb-8">
				<div className="bg-gradient-to-b from-surface-2 to-background border-b border-secondary sticky top-0 z-40">
					<div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
						<div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
							<div>
								<h1 className="text-display-2 mb-2 text-white">
									Training Cycles
								</h1>
								<p className="text-muted-foreground">Periodize your progress</p>
							</div>
						</div>
					</div>
				</div>
				<PageShell>
					<CardSkeleton />
					<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
						{Array.from({ length: 3 }).map((_, i) => (
							<CardSkeleton key={i} />
						))}
					</div>
				</PageShell>
			</div>
		);
	}

	if (allCycles.length === 0) {
		return (
			<div className="min-h-screen pb-24 md:pb-8">
				<div className="bg-gradient-to-b from-surface-2 to-background border-b border-secondary sticky top-0 z-40">
					<div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
						<motion.div
							initial={{ opacity: 0, y: 20 }}
							animate={{ opacity: 1, y: 0 }}
							className="flex flex-col md:flex-row md:items-center md:justify-between gap-4"
						>
							<div>
								<h1 className="text-display-2 mb-2 text-white">
									Training Cycles
								</h1>
								<p className="text-muted-foreground">Periodize your progress</p>
							</div>
							<Button onClick={() => navigate("/cycles/new")} variant="cta">
								<Plus className="w-4 h-4 mr-2" />
								Create Cycle
							</Button>
						</motion.div>
					</div>
				</div>
				<PageShell>
					<EmptyState
						icon={Calendar}
						title="Plan your training cycle"
						description="Design a structured training program with progressive overload and scheduled deload weeks."
						actionLabel="Create Cycle"
						actionHref="/cycles/new"
					/>
				</PageShell>
			</div>
		);
	}

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
								Training Cycles
							</h1>
							<p className="text-muted-foreground">Periodize your progress</p>
						</div>

						<Button onClick={() => navigate("/cycles/new")} variant="cta">
							<Plus className="w-4 h-4 mr-2" />
							Create Cycle
						</Button>
					</motion.div>
				</div>
			</div>

			{/* Content */}
			<PageShell>
				{/* Active Cycle Card */}
				{activeCycle && (
					<motion.div
						initial={{ opacity: 0, y: 20 }}
						animate={{ opacity: 1, y: 0 }}
					>
						<Card className="p-6 sm:p-8 bg-gradient-to-br from-primary/10 to-chart-2/10 border-2 border-primary/50 relative overflow-hidden">
							<div className="absolute top-4 right-4">
								<Badge className="bg-primary text-white border-0">
									<Flame className="w-3 h-3 mr-1" />
									ACTIVE CYCLE
								</Badge>
							</div>

							<div className="mb-6">
								<h2 className="text-2xl sm:text-3xl font-bold text-white mb-2">
									{activeCycle.name}
								</h2>
								<div className="flex items-center gap-2 text-sm text-muted-foreground">
									<span className="font-data">
										Week {activeCycle.current_week} of{" "}
										{activeCycle.duration_weeks}
									</span>
									<span>-</span>
									<span>
										{Math.round(
											(activeCycle.current_week / activeCycle.duration_weeks) *
												100,
										)}
										% complete
									</span>
								</div>
							</div>

							<div className="mb-6">
								<Progress
									value={
										(activeCycle.current_week / activeCycle.duration_weeks) *
										100
									}
									className="h-3 bg-surface-2"
								/>
							</div>

							<div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
								<div className="flex gap-6 text-sm text-muted-foreground">
									<div className="flex items-center gap-2">
										<Dumbbell className="w-4 h-4 text-primary" />
										<span className="font-data">
											{activeCycle.workout_days} workout days/week
										</span>
									</div>
									<div className="flex items-center gap-2">
										<BedDouble className="w-4 h-4 text-muted-foreground" />
										<span>{activeCycle.rest_days} rest days/week</span>
									</div>
								</div>
								<div className="flex gap-3 w-full sm:w-auto">
									<Button
										variant="outline"
										onClick={() => navigate(`/cycles/${activeCycle.id}`)}
										className="border-primary text-primary hover:bg-primary/10"
									>
										<Eye className="w-4 h-4 mr-2" />
										View Full Cycle
									</Button>
								</div>
							</div>
						</Card>
					</motion.div>
				)}

				{/* My Cycles */}
				<div>
					<h2 className="text-2xl font-semibold text-white mb-6">My Cycles</h2>
					<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
						{allCycles.map((cycle, index) => {
							const lastUsedText = cycle.last_used_at
								? cycle.last_used_at.toLocaleDateString("en-US", {
										month: "short",
										day: "numeric",
									})
								: undefined;

							return (
								<motion.div
									key={cycle.id}
									initial={{ opacity: 0, y: 20 }}
									animate={{ opacity: 1, y: 0 }}
									transition={{ delay: index * 0.05 }}
								>
									<Card className="p-6 bg-surface-2 border-secondary hover:border-primary/50 transition-all">
										<div className="flex items-start justify-between mb-4">
											<div className="flex-1">
												<h3 className="text-lg font-semibold text-white mb-2">
													{cycle.name}
												</h3>
												<Badge
													className={
														cycle.status === "active"
															? "bg-success text-white border-0"
															: cycle.status === "completed"
																? "bg-muted text-white border-0"
																: "bg-accent text-white border-0"
													}
												>
													{cycle.status.toUpperCase()}
												</Badge>
											</div>
											<DropdownMenu>
												<DropdownMenuTrigger asChild>
													<button className="text-muted-foreground hover:text-white transition-colors">
														<MoreVertical className="w-5 h-5" />
													</button>
												</DropdownMenuTrigger>
												<DropdownMenuContent className="bg-surface-2 border-secondary">
													<DropdownMenuItem
														className="text-secondary-foreground hover:bg-secondary cursor-pointer"
														onClick={() => navigate(`/cycles/${cycle.id}`)}
													>
														<Eye className="w-4 h-4 mr-2" />
														View
													</DropdownMenuItem>
													<DropdownMenuItem
														className="text-secondary-foreground hover:bg-secondary cursor-pointer"
														onClick={() => setShareDialogOpen(true)}
													>
														<Share2 className="w-4 h-4 mr-2" />
														Share to Community
													</DropdownMenuItem>
												</DropdownMenuContent>
											</DropdownMenu>
										</div>

										<div className="space-y-3 mb-4">
											<div className="flex items-center justify-between text-sm">
												<span className="text-muted-foreground">Duration</span>
												<span className="text-white font-medium font-data">
													{cycle.duration_weeks} weeks
												</span>
											</div>
											<div className="flex items-center justify-between text-sm">
												<span className="text-muted-foreground">
													Workout days
												</span>
												<div className="flex items-center gap-2">
													<Dumbbell className="w-4 h-4 text-primary" />
													<span className="text-white font-medium font-data">
														{cycle.workout_days}
													</span>
													<span className="text-muted-foreground">/</span>
													<BedDouble className="w-4 h-4 text-muted-foreground" />
													<span className="text-muted-foreground">
														{cycle.rest_days}
													</span>
												</div>
											</div>
											{cycle.status !== "draft" && lastUsedText && (
												<div className="flex items-center justify-between text-sm">
													<span className="text-muted-foreground">
														Last used
													</span>
													<span className="text-white font-medium">
														{lastUsedText}
													</span>
												</div>
											)}
										</div>

										{cycle.status === "active" && (
											<div className="mb-4">
												<Progress
													value={
														(cycle.current_week / cycle.duration_weeks) * 100
													}
													className="h-2 bg-background"
												/>
											</div>
										)}

										<div className="flex gap-2">
											<Button
												size="sm"
												variant="outline"
												onClick={() => navigate(`/cycles/${cycle.id}`)}
												className="flex-1 border-secondary text-muted-foreground hover:border-primary hover:text-primary"
											>
												<Edit className="w-4 h-4 mr-1" />
												Edit
											</Button>
										</div>
									</Card>
								</motion.div>
							);
						})}
					</div>
				</div>
			</PageShell>

			<ShareContentDialog
				open={shareDialogOpen}
				onOpenChange={setShareDialogOpen}
				cycles={allCycles.map((c) => ({
					id: c.id,
					name: c.name,
					duration_weeks: c.duration_weeks,
				}))}
			/>
		</div>
	);
}
