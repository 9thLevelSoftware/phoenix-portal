import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import {
	ArrowBigUp,
	Bookmark,
	Calendar,
	Clock,
	Dumbbell,
	Link2,
} from "lucide-react";
import { useMemo } from "react";
import { Badge } from "@/app/components/ui/badge";
import { Button } from "@/app/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/app/components/ui/dialog";
import {
	Drawer,
	DrawerContent,
	DrawerDescription,
	DrawerFooter,
	DrawerHeader,
	DrawerTitle,
} from "@/app/components/ui/drawer";
import { useIsMobile } from "@/app/hooks/useIsMobile";
import { PHOENIX } from "@/lib/colors";
import { useSaveItem, useVote } from "@/mutations/community";
import { useAuth } from "@/providers/AuthProvider";
import { savedItemsOptions } from "@/queries/community";
import type { CommunityFeedItem, SharedRoutine } from "@/schemas/community";
import { CommentThread } from "./CommentThread";

interface CommunityDetailDrawerProps {
	item: CommunityFeedItem | null;
	open: boolean;
	onClose: () => void;
}

function isRoutine(item: CommunityFeedItem): item is SharedRoutine {
	return "exercise_count" in item;
}

function DetailContent({ item }: { item: CommunityFeedItem }) {
	const { user } = useAuth();
	const authorName = item.profiles?.display_name ?? "Unknown";
	const sharedAgo = formatDistanceToNow(item.shared_at, { addSuffix: true });
	const itemType = isRoutine(item) ? "routine" : "cycle";

	const voteMutation = useVote();
	const saveMutation = useSaveItem();

	const { data: savedItems } = useQuery({
		...savedItemsOptions(user?.id ?? ""),
		enabled: !!user?.id,
	});

	const isSaved = useMemo(
		() => savedItems?.some((s) => s.shared_item_id === item.id) ?? false,
		[savedItems, item.id],
	);

	return (
		<div className="space-y-4">
			{/* Author */}
			<div className="flex items-center gap-2">
				<div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary to-chart-2 flex items-center justify-center text-white text-sm">
					{authorName.charAt(0).toUpperCase()}
				</div>
				<div>
					<p className="text-sm text-white">{authorName}</p>
					<p className="text-xs text-muted">Shared {sharedAgo}</p>
				</div>
			</div>

			{/* Description */}
			<p className="text-sm text-secondary-foreground">{item.description}</p>

			{/* Tags */}
			{item.tags.length > 0 && (
				<div className="flex flex-wrap gap-1.5">
					{item.tags.map((tag) => (
						<Badge
							key={tag}
							className="bg-secondary text-secondary-foreground border-0 text-xs"
						>
							{tag}
						</Badge>
					))}
				</div>
			)}

			{/* Stats */}
			<div className="flex items-center gap-4 text-sm text-muted-foreground">
				{isRoutine(item) ? (
					<>
						<div className="flex items-center gap-1">
							<Dumbbell className="w-4 h-4" />
							<span>{item.exercise_count} exercises</span>
						</div>
						<div className="flex items-center gap-1">
							<Clock className="w-4 h-4" />
							<span>{item.estimated_duration} min</span>
						</div>
					</>
				) : (
					<div className="flex items-center gap-1">
						<Calendar className="w-4 h-4" />
						<span>{item.duration_weeks} weeks</span>
					</div>
				)}
			</div>

			{/* Exercise list preview for routines */}
			{isRoutine(item) && item.exercises_snapshot && (
				<div>
					<h4 className="text-sm font-semibold text-white mb-2">Exercises</h4>
					<div className="space-y-1.5">
						{(Array.isArray(item.exercises_snapshot)
							? (item.exercises_snapshot as Array<{ name?: string }>)
							: []
						)
							.slice(0, 6)
							.map((ex, i) => (
								<div
									key={i}
									className="flex items-center gap-2 p-2 bg-surface-2 rounded-md text-sm"
								>
									<span className="text-muted w-5 text-right">{i + 1}</span>
									<span className="text-white">
										{typeof ex === "object" && ex?.name
											? ex.name
											: `Exercise ${i + 1}`}
									</span>
								</div>
							))}
					</div>
				</div>
			)}

			{/* Vote + Save actions */}
			<div className="flex items-center gap-3 pt-2">
				<Button
					variant="outline"
					onClick={() => voteMutation.mutate({ itemId: item.id, itemType })}
					disabled={voteMutation.isPending}
					className="flex-1 border-secondary text-muted-foreground hover:border-primary hover:text-white"
				>
					<ArrowBigUp className="w-5 h-5 mr-1.5" />
					{item.vote_count}
				</Button>
				<Button
					variant="outline"
					onClick={() =>
						saveMutation.mutate({ sharedItemId: item.id, itemType })
					}
					disabled={saveMutation.isPending}
					className={`flex-1 border-secondary transition-colors ${
						isSaved
							? "text-primary border-primary/50"
							: "text-muted-foreground hover:border-primary hover:text-white"
					}`}
				>
					<Bookmark
						className="w-4 h-4 mr-1.5"
						fill={isSaved ? PHOENIX.ember : "none"}
					/>
					{isSaved ? "Saved" : "Save"}
				</Button>
			</div>

			{/* Linked reference indicator */}
			{isSaved && (
				<div className="flex items-center gap-1.5 text-xs text-muted pt-1">
					<Link2 className="w-3 h-3" />
					<span>Linked to original</span>
				</div>
			)}
		</div>
	);
}

export function CommunityDetailDrawer({
	item,
	open,
	onClose,
}: CommunityDetailDrawerProps) {
	const isMobile = useIsMobile();

	if (!item) return null;

	if (isMobile) {
		return (
			<Drawer open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
				<DrawerContent className="bg-background border-secondary max-h-[85vh]">
					<DrawerHeader>
						<DrawerTitle className="text-white text-left">
							{item.name}
						</DrawerTitle>
						<DrawerDescription className="text-muted-foreground text-left">
							{item.difficulty} {isRoutine(item) ? "Routine" : "Cycle"}
						</DrawerDescription>
					</DrawerHeader>
					<div className="px-4 pb-4 overflow-y-auto">
						<DetailContent item={item} />
						<div className="mt-4 pt-4 border-t border-secondary">
							<CommentThread
								itemId={item.id}
								itemType={isRoutine(item) ? "routine" : "cycle"}
							/>
						</div>
					</div>
					<DrawerFooter />
				</DrawerContent>
			</Drawer>
		);
	}

	return (
		<Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
			<DialogContent className="bg-background border-secondary sm:max-w-2xl max-h-[80vh] overflow-y-auto">
				<DialogHeader>
					<DialogTitle className="text-white">{item.name}</DialogTitle>
					<DialogDescription className="text-muted-foreground">
						{item.difficulty} {isRoutine(item) ? "Routine" : "Cycle"}
					</DialogDescription>
				</DialogHeader>
				<DetailContent item={item} />
				<div className="mt-4 pt-4 border-t border-secondary">
					<CommentThread
						itemId={item.id}
						itemType={isRoutine(item) ? "routine" : "cycle"}
					/>
				</div>
			</DialogContent>
		</Dialog>
	);
}
