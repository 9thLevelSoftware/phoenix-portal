import { formatDistanceToNow } from "date-fns";
import {
	ArrowBigUp,
	Calendar,
	Clock,
	Dumbbell,
	MessageSquare,
} from "lucide-react";
import { motion } from "motion/react";
import { Badge } from "@/app/components/ui/badge";
import { Card } from "@/app/components/ui/card";
import { PHOENIX } from "@/lib/colors";
import type { CommunityFeedItem, SharedRoutine } from "@/schemas/community";
import { ContentActionMenu } from "./ContentActionMenu";

interface CommunityFeedCardProps {
	item: CommunityFeedItem;
	onSelect: (id: string) => void;
	isVoted: boolean;
	onVote: (id: string) => void;
	onAuthorClick?: (userId: string) => void;
	currentUserId?: string;
	contentType?: "routine" | "cycle";
}

function isRoutine(item: CommunityFeedItem): item is SharedRoutine {
	return "exercise_count" in item;
}

export function CommunityFeedCard({
	item,
	onSelect,
	isVoted,
	onVote,
	onAuthorClick,
	currentUserId,
	contentType = "routine",
}: CommunityFeedCardProps) {
	const isDeletedUser = item.user_id === null;
	const authorName = isDeletedUser
		? "[Deleted User]"
		: item.profiles?.display_name || "Anonymous";
	const sharedAgo = formatDistanceToNow(item.shared_at, { addSuffix: true });

	return (
		<motion.div whileTap={{ scale: 0.98 }}>
			<Card
				onClick={() => onSelect(item.id)}
				className="p-5 bg-surface-2 border-secondary hover:scale-[1.02] hover:shadow-lg hover:shadow-primary/5 transition-all cursor-pointer"
			>
				{/* Header: Author + Actions */}
				<div className="flex items-start justify-between mb-3">
					<div className="flex items-center gap-2 min-w-0">
						<div className="w-7 h-7 rounded-full bg-primary flex items-center justify-center text-white text-xs shrink-0">
							{authorName.charAt(0).toUpperCase()}
						</div>
						<button
							onClick={(e) => {
								e.stopPropagation();
								if (!isDeletedUser && item.user_id) {
									onAuthorClick?.(item.user_id);
								}
							}}
							className="text-xs text-muted-foreground truncate hover:text-primary transition-colors"
							disabled={isDeletedUser}
						>
							{authorName}
						</button>
					</div>
					<div className="flex items-center gap-1">
						{currentUserId && (
							<ContentActionMenu
								contentId={item.id}
								contentType={contentType}
								authorId={item.user_id}
								currentUserId={currentUserId}
							/>
						)}
						<button
							onClick={(e) => {
								e.stopPropagation();
								onVote(item.id);
							}}
							className={`flex items-center gap-1 px-2 py-1 rounded-md transition-colors ${
								isVoted
									? "text-primary bg-primary/10"
									: "text-muted-foreground hover:text-primary hover:bg-primary/5"
							}`}
						>
							<ArrowBigUp
								className="w-5 h-5"
								fill={isVoted ? PHOENIX.ember : "none"}
							/>
							<span className="text-sm font-medium">{item.vote_count}</span>
						</button>
					</div>
				</div>

				{/* Title */}
				<h3 className="text-white font-semibold mb-2 line-clamp-2">
					{item.name}
				</h3>

				{/* Tags */}
				{item.tags.length > 0 && (
					<div className="flex flex-wrap gap-1.5 mb-3">
						{item.tags.slice(0, 4).map((tag) => (
							<Badge
								key={tag}
								className="bg-secondary text-secondary-foreground border-0 text-[11px] px-2 py-0"
							>
								{tag}
							</Badge>
						))}
					</div>
				)}

				{/* Stats row */}
				<div className="flex items-center gap-4 text-xs text-muted-foreground mb-2">
					{isRoutine(item) ? (
						<>
							<div className="flex items-center gap-1">
								<Dumbbell className="w-3.5 h-3.5" />
								<span>{item.exercise_count} exercises</span>
							</div>
							<div className="flex items-center gap-1">
								<Clock className="w-3.5 h-3.5" />
								<span>
									{item.estimated_duration > 300
										? Math.round(item.estimated_duration / 60)
										: item.estimated_duration}{" "}
									min
								</span>
							</div>
						</>
					) : (
						<div className="flex items-center gap-1">
							<Calendar className="w-3.5 h-3.5" />
							<span>{item.duration_weeks} weeks</span>
						</div>
					)}
				</div>

				{/* Timestamp + Comment count */}
				<div className="flex items-center justify-between">
					<p className="text-[11px] text-muted-foreground">Shared {sharedAgo}</p>
					<div className="flex items-center gap-1 text-xs text-muted-foreground">
						<MessageSquare className="w-3.5 h-3.5" />
						<span>{item.comment_count ?? 0}</span>
					</div>
				</div>
			</Card>
		</motion.div>
	);
}
