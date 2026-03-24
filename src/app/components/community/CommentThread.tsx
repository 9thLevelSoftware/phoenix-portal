import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { Lock, MessageSquare, Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from "@/app/components/ui/alert-dialog";
import { Button } from "@/app/components/ui/button";
import { Textarea } from "@/app/components/ui/textarea";
import { useBlockedUsers } from "@/hooks/useBlockedUsers";
import { useCommentRealtime } from "@/hooks/useCommentRealtime";
import { useSubscription } from "@/hooks/useSubscription";
import {
	useCreateComment,
	useDeleteComment,
	useUpdateComment,
} from "@/mutations/comments";
import { useAuth } from "@/providers/AuthProvider";
import { commentsOptions } from "@/queries/comments";
import type { Comment } from "@/schemas/comments";
import { ContentActionMenu } from "./ContentActionMenu";

interface CommentThreadProps {
	itemId: string;
	itemType: "routine" | "cycle";
}

const EDIT_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

function CommentItem({
	comment,
	isOwn,
	itemId,
	currentUserId,
}: {
	comment: Comment;
	isOwn: boolean;
	itemId: string;
	currentUserId?: string;
}) {
	const [isEditing, setIsEditing] = useState(false);
	const [editBody, setEditBody] = useState(comment.body);

	const updateMutation = useUpdateComment();
	const deleteMutation = useDeleteComment();

	const canEdit =
		isOwn && Date.now() - comment.created_at.getTime() < EDIT_WINDOW_MS;

	const isDeletedUser = comment.user_id === null;
	const authorName = isDeletedUser
		? "[Deleted User]"
		: (comment.profiles?.display_name ?? "Unknown");
	const timeAgo = formatDistanceToNow(comment.created_at, {
		addSuffix: true,
	});

	function handleSaveEdit() {
		if (!editBody.trim()) return;
		updateMutation.mutate(
			{
				commentId: comment.id,
				itemId,
				body: editBody.trim(),
				createdAt: comment.created_at,
			},
			{
				onSuccess: () => setIsEditing(false),
			},
		);
	}

	function handleCancelEdit() {
		setEditBody(comment.body);
		setIsEditing(false);
	}

	const avatarUrl = comment.profiles?.avatar_url;

	return (
		<div className="flex gap-3 py-3">
			{/* Avatar */}
			{avatarUrl ? (
				<img
					src={avatarUrl}
					alt={authorName}
					className="w-8 h-8 rounded-full object-cover shrink-0"
				/>
			) : (
				<div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center text-white text-xs shrink-0">
					{authorName.charAt(0).toUpperCase()}
				</div>
			)}

			{/* Content */}
			<div className="flex-1 min-w-0">
				<div className="flex items-center justify-between">
					<div className="flex items-center gap-2">
						<span className="text-sm text-white font-medium">{authorName}</span>
						<span className="text-xs text-muted-foreground">{timeAgo}</span>
					</div>
					{currentUserId && !isOwn && (
						<ContentActionMenu
							contentId={comment.id}
							contentType="comment"
							authorId={comment.user_id}
							currentUserId={currentUserId}
						/>
					)}
				</div>

				{isEditing ? (
					<div className="mt-2 space-y-2">
						<Textarea
							value={editBody}
							onChange={(e) => setEditBody(e.target.value)}
							maxLength={500}
							className="text-sm bg-surface-2 border-secondary text-white min-h-12"
						/>
						<div className="flex items-center justify-between">
							<span
								className={`text-xs ${editBody.length >= 480 ? "text-destructive font-medium" : editBody.length >= 400 ? "text-amber-400" : "text-muted-foreground"}`}
							>
								{editBody.length}/500
							</span>
							<div className="flex gap-2">
								<Button
									variant="ghost"
									size="sm"
									onClick={handleCancelEdit}
									className="text-muted-foreground hover:text-white h-7 text-xs"
								>
									Cancel
								</Button>
								<Button
									size="sm"
									onClick={handleSaveEdit}
									disabled={
										updateMutation.isPending ||
										!editBody.trim() ||
										editBody.trim() === comment.body
									}
									className="bg-primary hover:bg-primary/90 h-7 text-xs"
								>
									Save
								</Button>
							</div>
						</div>
					</div>
				) : (
					<p className="text-sm text-secondary-foreground mt-0.5">
						{comment.body}
					</p>
				)}

				{/* Actions row (own comments only) */}
				{isOwn && !isEditing && (
					<div className="flex items-center gap-2 mt-1">
						{canEdit && (
							<button
								onClick={() => setIsEditing(true)}
								className="flex items-center gap-1 text-xs text-muted-foreground hover:text-white transition-colors"
							>
								<Pencil className="w-3 h-3" />
								Edit
							</button>
						)}

						<AlertDialog>
							<AlertDialogTrigger asChild>
								<button className="flex items-center gap-1 text-xs text-muted-foreground hover:text-destructive transition-colors">
									<Trash2 className="w-3 h-3" />
									Delete
								</button>
							</AlertDialogTrigger>
							<AlertDialogContent className="bg-background border-secondary">
								<AlertDialogHeader>
									<AlertDialogTitle className="text-white">
										Delete comment?
									</AlertDialogTitle>
									<AlertDialogDescription>
										This action cannot be undone. Your comment will be
										permanently removed.
									</AlertDialogDescription>
								</AlertDialogHeader>
								<AlertDialogFooter>
									<AlertDialogCancel className="border-secondary text-muted-foreground">
										Cancel
									</AlertDialogCancel>
									<AlertDialogAction
										onClick={() =>
											deleteMutation.mutate({
												commentId: comment.id,
												itemId,
											})
										}
										className="bg-destructive hover:bg-destructive/90"
									>
										Delete
									</AlertDialogAction>
								</AlertDialogFooter>
							</AlertDialogContent>
						</AlertDialog>
					</div>
				)}
			</div>
		</div>
	);
}

export function CommentThread({ itemId, itemType }: CommentThreadProps) {
	const { user } = useAuth();
	const { isPremium } = useSubscription();
	const { blockedUserIds } = useBlockedUsers();
	const [newComment, setNewComment] = useState("");

	const { data: comments, isLoading } = useQuery(commentsOptions(itemId));
	useCommentRealtime(itemId);

	const createMutation = useCreateComment();

	function handlePost() {
		const body = newComment.trim();
		if (!body) return;

		createMutation.mutate(
			{ itemId, itemType, body },
			{
				onSuccess: () => setNewComment(""),
			},
		);
	}

	return (
		<div className="space-y-3">
			{/* Header */}
			<div className="flex items-center gap-2">
				<MessageSquare className="w-4 h-4 text-muted-foreground" />
				<h4 className="text-sm font-semibold text-white">
					Comments
					{comments && comments.length > 0 && (
						<span className="text-muted-foreground font-normal ml-1">
							({comments.length})
						</span>
					)}
				</h4>
			</div>

			{/* Comment list */}
			{isLoading ? (
				<div className="py-4 text-center text-sm text-muted-foreground">
					Loading comments...
				</div>
			) : comments && comments.length > 0 ? (
				<div className="divide-y divide-secondary">
					{comments
						.filter((c) => c.user_id === null || !blockedUserIds.has(c.user_id))
						.map((comment) => (
							<CommentItem
								key={comment.id}
								comment={comment}
								isOwn={comment.user_id === user?.id}
								itemId={itemId}
								currentUserId={user?.id}
							/>
						))}
				</div>
			) : (
				<div className="py-6 text-center text-sm text-muted-foreground">
					No comments yet. Be the first to share your thoughts!
				</div>
			)}

			{/* Comment input area */}
			{user && isPremium ? (
				<div className="space-y-2 pt-2">
					<Textarea
						value={newComment}
						onChange={(e) => setNewComment(e.target.value)}
						placeholder="Write a comment..."
						maxLength={500}
						className="text-sm bg-surface-2 border-secondary text-white min-h-12"
					/>
					<div className="flex items-center justify-between">
						<span
							className={`text-xs ${newComment.length >= 480 ? "text-destructive font-medium" : newComment.length >= 400 ? "text-amber-400" : "text-muted-foreground"}`}
						>
							{newComment.length}/500
						</span>
						<Button
							size="sm"
							onClick={handlePost}
							disabled={createMutation.isPending || !newComment.trim()}
							className="bg-primary hover:bg-primary/90 h-7 text-xs"
						>
							Post
						</Button>
					</div>
				</div>
			) : user ? (
				<div className="flex items-center gap-2 p-3 bg-surface-2 rounded-md border border-secondary">
					<Lock className="w-4 h-4 text-muted-foreground shrink-0" />
					<span className="text-sm text-muted-foreground">
						<Link to="/pricing" className="text-primary hover:underline">
							Upgrade to comment
						</Link>
					</span>
				</div>
			) : null}
		</div>
	);
}
