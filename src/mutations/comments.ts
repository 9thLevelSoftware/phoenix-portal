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

		onError: (error) => {
			if (error.message?.includes("Rate limit exceeded")) {
				toast.error(
					"Rate limit exceeded: you can post up to 5 comments per hour",
				);
			} else {
				toast.error(`Failed to post comment: ${error.message}`);
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
		mutationFn: async ({
			commentId,
			body,
			createdAt,
		}: UpdateCommentArgs) => {
			if (!user) throw new Error("Must be logged in to edit");

			// Client-side check: 5-minute edit window
			const elapsed = Date.now() - createdAt.getTime();
			if (elapsed > 5 * 60 * 1000) {
				throw new Error("Edit window has expired");
			}

			const { error } = await supabase
				.from("community_comments")
				.update({ body, updated_at: new Date().toISOString() })
				.eq("id", commentId)
				.eq("user_id", user.id);

			if (error) throw error;
		},

		onSuccess: (_data, variables) => {
			queryClient.invalidateQueries({
				queryKey: queryKeys.comments.byItem(variables.itemId),
			});
		},

		onError: (error) => {
			toast.error(error.message);
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
			const { error } = await supabase
				.from("community_comments")
				.update({ deleted_at: new Date().toISOString() })
				.eq("id", commentId)
				.eq("user_id", user.id);

			if (error) throw error;
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

		onError: (error) => {
			toast.error(`Failed to delete comment: ${error.message}`);
		},
	});
}
