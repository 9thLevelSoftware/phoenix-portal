import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/providers/AuthProvider";
import { queryKeys } from "@/queries/keys";

// ---------- useCreateComment ----------

interface CreateCommentArgs {
	itemId: string;
	itemType: "routine" | "cycle";
	body: string;
}

export function useCreateComment() {
	const { user } = useAuth();
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async ({ itemId, itemType, body }: CreateCommentArgs) => {
			if (!user) throw new Error("Must be logged in to comment");

			const { error } = await supabase.from("community_comments").insert({
				item_id: itemId,
				item_type: itemType,
				user_id: user.id,
				body,
			});

			if (error) throw error;
		},

		onSuccess: (_data, variables) => {
			toast.success("Comment posted");
			queryClient.invalidateQueries({
				queryKey: queryKeys.comments.byItem(variables.itemId),
			});
			queryClient.invalidateQueries({
				queryKey: queryKeys.community.all,
			});
		},

		onError: (error: Error) => {
			console.error("[useCreateComment] failed:", error);
			if (error.message?.includes("Rate limit exceeded")) {
				toast.error(
					"You can post up to 5 comments per hour. Please wait and try again.",
				);
			} else {
				toast.error("Failed to post comment. Please try again.");
			}
		},
	});
}

// ---------- useUpdateComment ----------

interface UpdateCommentArgs {
	commentId: string;
	itemId: string;
	body: string;
	createdAt: Date;
}

export function useUpdateComment() {
	const { user } = useAuth();
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async ({ commentId, body, createdAt }: UpdateCommentArgs) => {
			if (!user) throw new Error("Must be logged in to edit");

			// Client-side check: 5-minute edit window. Client clock manipulation
			// can bypass it, but it is only the first of three guards. The
			// .gte("created_at") filter below is the second, and the RLS policy
			// "Users can edit own comments within 5 minutes" is authoritative:
			// since 20260920000901 it checks the window in USING (the stored
			// row) as well as WITH CHECK, and authenticated clients only hold
			// column grants on (body, updated_at), so created_at cannot be
			// refreshed to reopen the window.
			const elapsed = Date.now() - createdAt.getTime();
			if (elapsed > 5 * 60 * 1000) {
				throw new Error("Edit window has expired");
			}

			// Server-side belt-and-suspenders: the .gte filter
			// causes a 0-row match if the comment is too old,
			// making the update a no-op even if the client
			// check was bypassed.
			const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();

			// `.select()` is required for the row check: a bare `.update()` does
			// not populate `count`, so the previous `count === 0` guard never
			// fired and the server-side edit-window check was a no-op.
			const { data: updated, error } = await supabase
				.from("community_comments")
				.update({
					body,
					updated_at: new Date().toISOString(),
				})
				.eq("id", commentId)
				.eq("user_id", user.id)
				.gte("created_at", fiveMinutesAgo)
				.select("id")
				.maybeSingle();

			if (error) throw error;
			if (!updated) {
				throw new Error("Edit window has expired");
			}
		},

		onSuccess: (_data, variables) => {
			queryClient.invalidateQueries({
				queryKey: queryKeys.comments.byItem(variables.itemId),
			});
		},

		onError: (error: Error) => {
			console.error("[useUpdateComment] failed:", error);
			if (error.message === "Edit window has expired") {
				toast.error(
					"Edit window has expired. Comments can only be edited within 5 minutes.",
				);
			} else {
				toast.error("Failed to update comment. Please try again.");
			}
		},
	});
}

// ---------- useDeleteComment ----------

interface DeleteCommentArgs {
	commentId: string;
	itemId: string;
}

/** Sentinel for "the DELETE matched no row" — mapped to its own toast below. */
const COMMENT_NOT_DELETED = "Comment was not deleted";

export function useDeleteComment() {
	const { user } = useAuth();
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async ({ commentId }: DeleteCommentArgs) => {
			if (!user) throw new Error("Must be logged in to delete");

			// Hard DELETE, not a soft-delete UPDATE.
			//
			// The soft-delete UPDATE could never work: the SELECT policy is
			// `deleted_at IS NULL` and Postgres applies SELECT policies to the
			// new row of an UPDATE, so setting deleted_at always raised 42501.
			// It also carried the 5-minute edit window and, since
			// 20260920000900, a FLAME check. The owner DELETE policy has none
			// of those, so this is the path a downgraded author can still use
			// to withdraw a comment.
			//
			// `.select("id")` makes a 0-row outcome observable: without it a
			// delete that matched nothing (wrong owner, already gone, a future
			// tier check) would look identical to a success.
			const { data: deleted, error } = await supabase
				.from("community_comments")
				.delete()
				.eq("id", commentId)
				.eq("user_id", user.id)
				.select("id")
				.maybeSingle();

			if (error) throw error;
			if (!deleted) {
				throw new Error(COMMENT_NOT_DELETED);
			}
		},

		onSuccess: (_data, variables) => {
			toast.success("Comment deleted");
			queryClient.invalidateQueries({
				queryKey: queryKeys.comments.byItem(variables.itemId),
			});
			queryClient.invalidateQueries({
				queryKey: queryKeys.community.all,
			});
		},

		onError: (error: Error) => {
			console.error("[useDeleteComment] failed:", error);
			if (error.message === COMMENT_NOT_DELETED) {
				toast.error(
					"Comment not found, or you don't have permission to delete it.",
				);
			} else {
				toast.error("Failed to delete comment. Please try again.");
			}
		},
	});
}
