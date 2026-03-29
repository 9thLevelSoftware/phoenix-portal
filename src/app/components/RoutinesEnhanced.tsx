import { useQuery } from "@tanstack/react-query";
import {
	Clock,
	Copy,
	Dumbbell,
	Edit,
	Eye,
	Heart,
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
import { RoutineCardSkeleton } from "@/app/components/ui/skeleton";
import {
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from "@/app/components/ui/tabs";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/app/components/ui/tooltip";
import { useAuth } from "@/app/hooks/useAuth";
import { useToggleFavorite } from "@/mutations/routines";
import { routineListOptions } from "@/queries/routines";
import type { Routine } from "@/schemas/transforms";

export function RoutinesEnhanced() {
	const navigate = useNavigate();
	const { user } = useAuth();
	const userId = user?.id ?? "";
	const { data: routines, isPending } = useQuery({
		...routineListOptions(userId),
		enabled: !!userId,
	});

	const [shareDialogOpen, setShareDialogOpen] = useState(false);
	const toggleFavoriteMutation = useToggleFavorite();

	const allRoutines = routines ?? [];
	const favoriteRoutines = allRoutines.filter((r) => r.is_favorite);

	const handleToggleFavorite = (id: string) => {
		const routine = allRoutines.find((r) => r.id === id);
		if (routine) {
			toggleFavoriteMutation.mutate({
				routineId: id,
				isFavorite: !routine.is_favorite,
			});
		}
	};

	const isFavorite = (routine: Routine) => routine.is_favorite;

	if (isPending) {
		return (
			<div className="min-h-screen pb-24 md:pb-8">
				<div className="bg-gradient-to-b from-surface-2 to-background border-b border-secondary sticky top-0 z-40">
					<div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
						<div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
							<div>
								<h1 className="text-display-2 mb-2 text-white">My Routines</h1>
								<p className="text-muted-foreground">
									Build your perfect workout
								</p>
							</div>
						</div>
					</div>
				</div>
				<PageShell>
					<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
						{Array.from({ length: 3 }).map((_, i) => (
							<RoutineCardSkeleton key={i} />
						))}
					</div>
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
							<h1 className="text-display-2 mb-2 text-white">My Routines</h1>
							<p className="text-muted-foreground">
								Build your perfect workout
							</p>
						</div>

						<Button onClick={() => navigate("/routines/new")} variant="cta">
							<Plus className="w-4 h-4 mr-2" />
							Create Routine
						</Button>
					</motion.div>
				</div>
			</div>

			{/* Content */}
			<PageShell>
				<Tabs defaultValue="my-routines" className="w-full">
					<TabsList variant="panel" className="mb-6">
						<TabsTrigger value="my-routines">My Routines</TabsTrigger>
						<TabsTrigger value="favorites">Favorites</TabsTrigger>
					</TabsList>

					<TabsContent value="my-routines">
						{allRoutines.length === 0 ? (
							<EmptyState
								icon={Dumbbell}
								title="Build your first routine"
								description="Create a custom workout routine tailored to your goals. Drag and drop exercises, set your reps and weights."
								actionLabel="Create Routine"
								actionHref="/routines/new"
							/>
						) : (
							<RoutineGrid
								routines={allRoutines}
								onEdit={(id: string) => navigate(`/routines/${id}`)}
								onView={(id: string) => navigate(`/routines/${id}/view`)}
								onToggleFavorite={handleToggleFavorite}
								isFavorite={isFavorite}
								onShare={() => setShareDialogOpen(true)}
							/>
						)}
					</TabsContent>

					<TabsContent value="favorites">
						{favoriteRoutines.length === 0 ? (
							<div className="text-center py-12 text-muted-foreground">
								<Heart className="w-12 h-12 mx-auto mb-3 opacity-50" />
								<p>No favorite routines yet. Heart a routine to add it here.</p>
							</div>
						) : (
							<RoutineGrid
								routines={favoriteRoutines}
								onEdit={(id: string) => navigate(`/routines/${id}`)}
								onView={(id: string) => navigate(`/routines/${id}/view`)}
								onToggleFavorite={handleToggleFavorite}
								isFavorite={isFavorite}
								onShare={() => setShareDialogOpen(true)}
							/>
						)}
					</TabsContent>
				</Tabs>
			</PageShell>

			<ShareContentDialog
				open={shareDialogOpen}
				onOpenChange={setShareDialogOpen}
				routines={allRoutines.map((r) => ({
					id: r.id,
					name: r.name,
					exercise_count: r.exercise_count,
					estimated_duration: r.estimated_duration,
				}))}
			/>
		</div>
	);
}

function RoutineGrid({
	routines,
	onEdit,
	onView,
	onToggleFavorite,
	isFavorite,
	onShare,
}: {
	routines: Routine[];
	onEdit: (id: string) => void;
	onView: (id: string) => void;
	onToggleFavorite: (id: string) => void;
	isFavorite: (routine: Routine) => boolean;
	onShare: () => void;
}) {
	return (
		<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
			{routines.map((routine, index) => {
				const favorite = isFavorite(routine);
				const lastUsedText = routine.last_used_at
					? routine.last_used_at.toLocaleDateString("en-US", {
							month: "short",
							day: "numeric",
						})
					: "Never";

				return (
					<motion.div
						key={routine.id}
						initial={{ opacity: 0, y: 20 }}
						animate={{ opacity: 1, y: 0 }}
						transition={{ delay: index * 0.05 }}
					>
						<Card className="p-6 bg-surface-2 border-secondary hover:border-primary/50 transition-all group">
							{/* Header */}
							<div className="flex items-start justify-between mb-3">
								<div className="flex-1">
									<h3 className="text-lg font-semibold text-white mb-1">
										{routine.name}
									</h3>
									<p className="text-sm text-muted-foreground line-clamp-2">
										{routine.description}
									</p>
								</div>
								<div className="flex items-center gap-2 ml-2">
									<Tooltip>
										<TooltipTrigger asChild>
											<button
												onClick={() => onToggleFavorite(routine.id)}
												aria-label={
													favorite
														? "Remove from favorites"
														: "Add to favorites"
												}
												className="text-muted-foreground hover:text-accent transition-colors"
											>
												<Heart
													className={`w-5 h-5 ${favorite ? "fill-[#F59E0B] text-accent" : ""}`}
												/>
											</button>
										</TooltipTrigger>
										<TooltipContent>
											{favorite ? "Remove from favorites" : "Add to favorites"}
										</TooltipContent>
									</Tooltip>
									<DropdownMenu>
										<DropdownMenuTrigger asChild>
											<button className="text-muted-foreground hover:text-white transition-colors">
												<MoreVertical className="w-5 h-5" />
											</button>
										</DropdownMenuTrigger>
										<DropdownMenuContent className="bg-surface-2 border-secondary">
											<DropdownMenuItem className="text-secondary-foreground hover:bg-secondary cursor-pointer">
												<Copy className="w-4 h-4 mr-2" />
												Duplicate
											</DropdownMenuItem>
											<DropdownMenuItem
												className="text-secondary-foreground hover:bg-secondary cursor-pointer"
												onClick={onShare}
											>
												<Share2 className="w-4 h-4 mr-2" />
												Share
											</DropdownMenuItem>
										</DropdownMenuContent>
									</DropdownMenu>
								</div>
							</div>

							{/* Stats */}
							<div className="flex items-center gap-4 mb-4 text-sm">
								<div className="flex items-center gap-1 text-muted-foreground">
									<Dumbbell className="w-4 h-4" />
									<span>{routine.exercise_count} exercises</span>
								</div>
								<div className="flex items-center gap-1 text-muted-foreground">
									<Clock className="w-4 h-4" />
									<span>
										~
										{routine.estimated_duration > 300
											? Math.round(routine.estimated_duration / 60)
											: routine.estimated_duration}{" "}
										min
									</span>
								</div>
							</div>

							{/* Tags */}
							{routine.tags && routine.tags.length > 0 && (
								<div className="flex flex-wrap gap-2 mb-4">
									{routine.tags.map((tag) => (
										<Badge
											key={tag}
											variant="outline"
											className="border-primary/30 text-primary text-xs"
										>
											{tag}
										</Badge>
									))}
								</div>
							)}

							{/* Footer */}
							<div className="flex items-center justify-between pt-4 border-t border-secondary">
								<div className="text-xs text-muted-foreground">
									<div>Used {routine.times_completed} times</div>
									<div>Last used: {lastUsedText}</div>
								</div>
								<div className="flex gap-2">
									<Button
										size="sm"
										variant="outline"
										onClick={() => onEdit(routine.id)}
										className="border-secondary text-muted-foreground hover:border-primary hover:text-primary"
									>
										<Edit className="w-4 h-4 mr-1" />
										Edit
									</Button>
									<Button
										size="sm"
										variant="cta"
										onClick={() => onView(routine.id)}
									>
										<Eye className="w-4 h-4 mr-1" />
										View
									</Button>
								</div>
							</div>
						</Card>
					</motion.div>
				);
			})}
		</div>
	);
}
