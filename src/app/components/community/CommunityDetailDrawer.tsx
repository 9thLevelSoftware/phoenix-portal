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
import { Link } from "react-router";
import { FeatureHint } from "@/app/components/FeatureHint";
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
import { usePreferredWeightUnit } from "@/app/hooks/usePreferredWeightUnit";
import { PHOENIX } from "@/lib/colors";
import { useSaveItem, useVote } from "@/mutations/community";
import { useAuth } from "@/providers/AuthProvider";
import {
	communityItemDetailOptions,
	savedItemsOptions,
} from "@/queries/community";
import type {
	CommunityFeedItem,
	CommunityItemDetail,
	SharedRoutine,
	SharedRoutineDetail,
} from "@/schemas/community";
import { CommentThread } from "./CommentThread";
import {
	CycleSnapshotPreview,
	RoutineSnapshotPreview,
} from "./CommunityContentPreview";
import { ContentActionMenu } from "./ContentActionMenu";

interface CommunityDetailDrawerProps {
	item: CommunityFeedItem | null;
	open: boolean;
	onClose: () => void;
}

function isRoutine(
	item: CommunityFeedItem | CommunityItemDetail,
): item is SharedRoutine | SharedRoutineDetail {
	return "exercise_count" in item;
}

function DetailContent({
	item,
	detail,
	detailLoading,
	detailError,
}: {
	item: CommunityFeedItem;
	detail: CommunityItemDetail | undefined;
	detailLoading: boolean;
	detailError: boolean;
}) {
	const { user } = useAuth();
	const unit = usePreferredWeightUnit();
	const displayItem = detail ?? item;
	const isDeletedUser = displayItem.user_id === null;
	const authorName = isDeletedUser
		? "[Deleted User]"
		: (displayItem.profiles?.display_name ?? "Unknown");
	const sharedAgo = formatDistanceToNow(displayItem.shared_at, {
		addSuffix: true,
	});
	const itemType = isRoutine(displayItem) ? "routine" : "cycle";

	const voteMutation = useVote();
	const saveMutation = useSaveItem();

	const { data: savedItems } = useQuery({
		...savedItemsOptions(user?.id ?? ""),
		enabled: !!user?.id,
	});

	const savedItem = useMemo(
		() =>
			savedItems?.find(
				(s) => s.shared_item_id === displayItem.id && s.item_type === itemType,
			) ?? null,
		[savedItems, displayItem.id, itemType],
	);
	const importedId =
		itemType === "routine"
			? savedItem?.imported_routine_id
			: savedItem?.imported_cycle_id;
	const isImported = Boolean(importedId);
	const importedHref =
		itemType === "routine"
			? `/routines/${importedId}/view`
			: `/cycles/${importedId}`;
	const hasImportableSnapshot = isRoutine(displayItem)
		? "exercises_snapshot" in displayItem &&
			Array.isArray(displayItem.exercises_snapshot) &&
			displayItem.exercises_snapshot.length > 0
		: "cycle_snapshot" in displayItem && Boolean(displayItem.cycle_snapshot);

	return (
		<div className="space-y-4">
			{/* Author */}
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-2">
					<div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center text-white text-sm">
						{authorName.charAt(0).toUpperCase()}
					</div>
					<div>
						<p className="text-sm text-white">{authorName}</p>
						<p className="text-xs text-muted-foreground">Shared {sharedAgo}</p>
					</div>
				</div>
				{user && (
					<ContentActionMenu
						contentId={displayItem.id}
						contentType={itemType}
						authorId={displayItem.user_id}
						currentUserId={user.id}
					/>
				)}
			</div>

			{/* Description */}
			<p className="text-sm text-secondary-foreground">
				{displayItem.description}
			</p>

			{/* Tags */}
			{displayItem.tags.length > 0 && (
				<div className="flex flex-wrap gap-1.5">
					{displayItem.tags.map((tag) => (
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
				{isRoutine(displayItem) ? (
					<>
						<div className="flex items-center gap-1">
							<Dumbbell className="w-4 h-4" />
							<span>{displayItem.exercise_count} exercises</span>
						</div>
						<div className="flex items-center gap-1">
							<Clock className="w-4 h-4" />
							<span>{displayItem.estimated_duration} min</span>
						</div>
					</>
				) : (
					<div className="flex items-center gap-1">
						<Calendar className="w-4 h-4" />
						<span>{displayItem.duration_weeks} weeks</span>
					</div>
				)}
			</div>

			{detailLoading ? (
				<div className="rounded-lg border border-secondary bg-surface-2 p-4 text-sm text-muted-foreground">
					Loading full details...
				</div>
			) : detailError ? (
				<div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
					Full details could not be loaded.
				</div>
			) : isRoutine(displayItem) ? (
				<RoutineSnapshotPreview
					exercises={
						"exercises_snapshot" in displayItem
							? displayItem.exercises_snapshot
							: null
					}
					unit={unit}
				/>
			) : (
				<CycleSnapshotPreview
					snapshot={
						"cycle_snapshot" in displayItem ? displayItem.cycle_snapshot : null
					}
					unit={unit}
				/>
			)}

			{/* Vote + Save actions */}
			<div className="flex items-center gap-3 pt-2">
				<Button
					variant="outline"
					onClick={() =>
						voteMutation.mutate({ itemId: displayItem.id, itemType })
					}
					disabled={voteMutation.isPending}
					className="flex-1 border-secondary text-muted-foreground hover:border-primary hover:text-white"
				>
					<ArrowBigUp className="w-5 h-5 mr-1.5" />
					{displayItem.vote_count}
				</Button>
				{isImported && importedId ? (
					<Button
						asChild
						variant="outline"
						className="flex-1 border-primary/50 text-primary transition-colors"
					>
						<Link to={importedHref}>
							<Bookmark className="w-4 h-4 mr-1.5" fill={PHOENIX.ember} />
							{itemType === "routine"
								? "Saved to My Routines"
								: "Saved to My Cycles"}
						</Link>
					</Button>
				) : (
					<Button
						variant="outline"
						onClick={() =>
							saveMutation.mutate({ sharedItemId: displayItem.id, itemType })
						}
						disabled={
							saveMutation.isPending ||
							detailLoading ||
							detailError ||
							!hasImportableSnapshot
						}
						className="flex-1 border-secondary text-muted-foreground transition-colors hover:border-primary hover:text-white"
					>
						<Bookmark className="w-4 h-4 mr-1.5" />
						{saveMutation.isPending
							? "Saving..."
							: itemType === "routine"
								? "Save to My Routines"
								: "Save to My Cycles"}
					</Button>
				)}
			</div>

			{/* Linked reference indicator */}
			{isImported && (
				<div className="flex items-center gap-1.5 text-xs text-muted-foreground pt-1">
					<Link2 className="w-3 h-3" />
					<span>
						Imported as an editable copy. Community comments stay linked to the
						original share.
					</span>
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
	const itemType = item && isRoutine(item) ? "routine" : "cycle";
	const detailQuery = useQuery({
		...communityItemDetailOptions(itemType, item?.id ?? ""),
		enabled: open && !!item,
	});

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
						<DetailContent
							item={item}
							detail={detailQuery.data}
							detailLoading={detailQuery.isLoading}
							detailError={detailQuery.isError}
						/>
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
				<DetailContent
					item={item}
					detail={detailQuery.data}
					detailLoading={detailQuery.isLoading}
					detailError={detailQuery.isError}
				/>
				<FeatureHint
					hintId="community-comments"
					content="Join the discussion -- share feedback on routines and training cycles"
					side="top"
				>
					<div className="mt-4 pt-4 border-t border-secondary">
						<CommentThread
							itemId={item.id}
							itemType={isRoutine(item) ? "routine" : "cycle"}
						/>
					</div>
				</FeatureHint>
			</DialogContent>
		</Dialog>
	);
}
