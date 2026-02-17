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
import { Badge } from "@/app/components/ui/badge";
import { Button } from "@/app/components/ui/button";
import { Card } from "@/app/components/ui/card";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/app/components/ui/dropdown-menu";
import { RoutineCardSkeleton } from "@/app/components/ui/skeleton";
import {
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from "@/app/components/ui/tabs";
import { useAuth } from "@/app/hooks/useAuth";
import { EmptyState } from "@/app/components/ui/empty-state";
import { routineListOptions } from "@/queries/routines";
import type { Routine } from "@/schemas/transforms";

export function RoutinesEnhanced() {
	const navigate = useNavigate();
	const { user } = useAuth();
	const { data: routines, isPending } = useQuery(routineListOptions(user?.id));

	const [shareDialogOpen, setShareDialogOpen] = useState(false);

	// Local state for UI-only operations (these would need mutations for persistence)
	const [localFavorites, setLocalFavorites] = useState<Set<string>>(new Set());

	const toggleFavorite = (id: string) => {
		setLocalFavorites((prev) => {
			const next = new Set(prev);
			if (next.has(id)) {
				next.delete(id);
			} else {
				next.add(id);
			}
			return next;
		});
	};

	const isFavorite = (routine: Routine) =>
		localFavorites.has(routine.id) ? !routine.is_favorite : routine.is_favorite;

	const allRoutines = routines ?? [];
	const favoriteRoutines = allRoutines.filter((r) => isFavorite(r));

	if (isPending) {
		return (
			<div className="min-h-screen bg-background pb-24 md:pb-8">
				<div className="bg-gradient-to-b from-surface-2 to-background border-b border-secondary sticky top-0 z-40 backdrop-blur-xl">
					<div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
						<div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
							<div>
								<h1 className="text-3xl sm:text-4xl mb-2">
									<span className="bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
										My Routines
									</span>
								</h1>
								<p className="text-muted-foreground">
									Build your perfect workout
								</p>
							</div>
						</div>
					</div>
				</div>
				<div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
					<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
						{Array.from({ length: 3 }).map((_, i) => (
							<RoutineCardSkeleton key={i} />
						))}
					</div>
				</div>
			</div>
		);
	}

	return (
		<div className="min-h-screen bg-background pb-24 md:pb-8">
			{/* Header */}
			<div className="bg-gradient-to-b from-surface-2 to-background border-b border-secondary sticky top-0 z-40 backdrop-blur-xl">
				<div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
					<motion.div
						initial={{ opacity: 0, y: 20 }}
						animate={{ opacity: 1, y: 0 }}
						className="flex flex-col md:flex-row md:items-center md:justify-between gap-4"
					>
						<div>
							<h1 className="text-3xl sm:text-4xl mb-2">
								<span className="bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
									My Routines
								</span>
							</h1>
							<p className="text-muted-foreground">
								Build your perfect workout
							</p>
						</div>

						<Button
							onClick={() => navigate("/routines/new")}
							className="bg-gradient-to-r from-primary to-chart-2 hover:from-chart-2 hover:to-accent border-0"
						>
							<Plus className="w-4 h-4 mr-2" />
							Create Routine
						</Button>
					</motion.div>
				</div>
			</div>

			{/* Content */}
			<div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
				<Tabs defaultValue="my-routines" className="w-full">
					<TabsList className="bg-surface-2 border border-secondary mb-6">
						<TabsTrigger
							value="my-routines"
							className="data-[state=active]:bg-gradient-to-r data-[state=active]:from-primary data-[state=active]:to-chart-2"
						>
							My Routines
						</TabsTrigger>
						<TabsTrigger
							value="favorites"
							className="data-[state=active]:bg-gradient-to-r data-[state=active]:from-primary data-[state=active]:to-chart-2"
						>
							Favorites
						</TabsTrigger>
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
								onToggleFavorite={toggleFavorite}
								isFavorite={isFavorite}
								onShare={() => setShareDialogOpen(true)}
							/>
						)}
					</TabsContent>

					<TabsContent value="favorites">
						{favoriteRoutines.length === 0 ? (
							<div className="text-center py-12 text-muted">
								<Heart className="w-12 h-12 mx-auto mb-3 opacity-50" />
								<p>No favorite routines yet. Heart a routine to add it here.</p>
							</div>
						) : (
							<RoutineGrid
								routines={favoriteRoutines}
								onEdit={(id: string) => navigate(`/routines/${id}`)}
								onToggleFavorite={toggleFavorite}
								isFavorite={isFavorite}
								onShare={() => setShareDialogOpen(true)}
							/>
						)}
					</TabsContent>
				</Tabs>
			</div>

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
	onToggleFavorite,
	isFavorite,
	onShare,
}: {
	routines: Routine[];
	onEdit: (id: string) => void;
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
						<Card className="p-6 bg-gradient-to-br from-surface-2 to-background border-secondary hover:border-primary/50 transition-all group">
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
									<button
										onClick={() => onToggleFavorite(routine.id)}
										className="text-muted-foreground hover:text-accent transition-colors"
									>
										<Heart
											className={`w-5 h-5 ${favorite ? "fill-[#F59E0B] text-accent" : ""}`}
										/>
									</button>
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
									<span>~{routine.estimated_duration} min</span>
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
								<div className="text-xs text-muted">
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
										className="bg-gradient-to-r from-primary to-chart-2 hover:from-chart-2 hover:to-accent border-0"
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

