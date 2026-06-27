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

			// Client-side check: 5-minute edit window.
			// LIMITATION: Client clock manipulation can bypass
			// this check. The server-side .gte("created_at")
			// filter below provides a secondary guard, but a
			// proper RLS policy is the real fix:
			//   CREATE POLICY "enforce_edit_window"
			//     ON community_comments FOR UPDATE
			//     USING (
			//       auth.uid() = user_id
			//       AND created_at > now() - interval '5 min'
			//     );
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

export function useDeleteComment() {
	const { user } = useAuth();
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async ({ commentId }: DeleteCommentArgs) => {
			if (!user) throw new Error("Must be logged in to delete");

			// Soft delete: set deleted_at timestamp
			const { data: deleted, error } = await supabase
				.from("community_comments")
				.update({ deleted_at: new Date().toISOString() })
				.eq("id", commentId)
				.eq("user_id", user.id)
				.select("id")
				.maybeSingle();

			if (error) throw error;
			if (!deleted)
				throw new Error(
					"Comment not found or you don't have permission to delete it.",
				);
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
			toast.error("Failed to delete comment. Please try again.");
		},
	});
}
