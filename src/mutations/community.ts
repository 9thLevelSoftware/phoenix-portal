import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/providers/AuthProvider";
import { queryKeys } from "@/queries/keys";

// ---------- useVote (confirmed pattern) ----------

interface VoteMutationArgs {
	itemId: string;
	itemType: "routine" | "cycle";
}

export function useVote() {
	const { user } = useAuth();
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async ({ itemId, itemType }: VoteMutationArgs) => {
			if (!user) throw new Error("Must be logged in to vote");

			// Check if vote already exists
			const { data: existing, error: checkError } = await supabase
				.from("community_votes")
				.select("id")
				.eq("user_id", user.id)
				.eq("item_id", itemId)
				.eq("item_type", itemType)
				.maybeSingle();

			if (checkError) throw checkError;

			if (existing) {
				// Remove vote
				const { error } = await supabase
					.from("community_votes")
					.delete()
					.eq("id", existing.id);
				if (error) throw error;
				return { action: "removed" as const };
			} else {
				// Add vote
				const { error } = await supabase
					.from("community_votes")
					.insert({ user_id: user.id, item_id: itemId, item_type: itemType });
				if (error) throw error;
				return { action: "added" as const };
			}
		},

		onSuccess: () => {
			// Confirmed pattern: invalidate to refetch fresh data from server
			queryClient.invalidateQueries({
				queryKey: queryKeys.community.all,
			});
			if (user) {
				queryClient.invalidateQueries({
					queryKey: queryKeys.community.votes(user.id),
				});
			}
		},
	});
}

// ---------- useShareContent ----------

interface ShareContentArgs {
	type: "routine" | "cycle";
	sourceId: string;
	name: string;
	description: string;
	tags: string[];
	difficulty: "Beginner" | "Intermediate" | "Advanced";
	exerciseCount?: number;
	estimatedDuration?: number;
	exercisesSnapshot?: unknown;
	durationWeeks?: number;
}

export function useShareContent() {
	const { user } = useAuth();
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (args: ShareContentArgs) => {
			if (!user) throw new Error("Must be logged in to share");

			if (args.type === "routine") {
				const { error } = await supabase.from("shared_routines").insert({
					user_id: user.id,
					routine_id: args.sourceId,
					name: args.name,
					description: args.description,
					tags: args.tags,
					difficulty: args.difficulty,
					exercise_count: args.exerciseCount ?? 0,
					estimated_duration: args.estimatedDuration ?? 0,
					exercises_snapshot: args.exercisesSnapshot ?? null,
				});
				if (error) throw error;
			} else {
				const { error } = await supabase.from("shared_cycles").insert({
					user_id: user.id,
					cycle_id: args.sourceId,
					name: args.name,
					description: args.description,
					tags: args.tags,
					difficulty: args.difficulty,
					duration_weeks: args.durationWeeks ?? 0,
				});
				if (error) throw error;
			}
		},

		onSuccess: () => {
			// Invalidate community feed so new item appears
			queryClient.invalidateQueries({ queryKey: queryKeys.community.all });
		},

		onError: (error) => {
			toast.error(`Failed to share content: ${error.message}`);
		},
	});
}

// ---------- useFollowCreator ----------

interface FollowCreatorArgs {
	followedId: string;
}

export function useFollowCreator() {
	const { user } = useAuth();
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async ({ followedId }: FollowCreatorArgs) => {
			if (!user) throw new Error("Must be logged in to follow");

			const { data: existing, error: checkError } = await supabase
				.from("creator_follows" as never)
				.select("id")
				.eq("follower_id", user.id)
				.eq("followed_id", followedId)
				.maybeSingle();

			if (checkError) throw checkError;

			if (existing) {
				const { error } = await supabase
					.from("creator_follows" as never)
					.delete()
					.eq("id", (existing as { id: string }).id);
				if (error) throw error;
				return { action: "unfollowed" as const };
			}
			const { error } = await supabase.from("creator_follows" as never).insert({
				follower_id: user.id,
				followed_id: followedId,
			} as never);
			if (error) throw error;
			return { action: "followed" as const };
		},

		onSuccess: (_data, variables) => {
			if (user) {
				queryClient.invalidateQueries({
					queryKey: queryKeys.community.follows(user.id, variables.followedId),
				});
			}
		},

		onError: (error: Error) => {
			toast.error(`Failed to update follow: ${error.message}`);
		},
	});
}

// ---------- useReportContent ----------

interface ReportContentArgs {
	contentId: string;
	contentType: "routine" | "cycle" | "comment";
	category: "harmful_content" | "impersonation" | "spam" | "malware" | "other";
	description?: string;
}

export function useReportContent() {
	const { user } = useAuth();

	return useMutation({
		mutationFn: async ({
			contentId,
			contentType,
			category,
			description,
		}: ReportContentArgs) => {
			if (!user) throw new Error("Must be logged in to report content");

			const { error } = await supabase.from("content_reports" as never).insert({
				reporter_id: user.id,
				content_id: contentId,
				content_type: contentType,
				category,
				...(description ? { description } : {}),
			} as never);

			if (error) {
				if (error.code === "23505") {
					throw new Error("You have already reported this content");
				}
				throw error;
			}
		},

		onSuccess: () => {
			toast.success(
				"Report submitted. Thank you for keeping the community safe.",
			);
		},

		onError: (error: Error) => {
			toast.error(error.message);
		},
	});
}

// ---------- useBlockUser ----------

interface BlockUserArgs {
	blockedId: string;
}

export function useBlockUser() {
	const { user } = useAuth();
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async ({ blockedId }: BlockUserArgs) => {
			if (!user) throw new Error("Must be logged in to block a user");
			if (blockedId === user.id) throw new Error("You cannot block yourself");

			const { error } = await supabase.from("user_blocks" as never).insert({
				blocker_id: user.id,
				blocked_id: blockedId,
			} as never);

			if (error) throw error;
		},

		onSuccess: () => {
			toast.success("User blocked");
			if (user) {
				queryClient.invalidateQueries({
					queryKey: queryKeys.community.all,
				});
				queryClient.invalidateQueries({
					queryKey: queryKeys.comments.all,
				});
				queryClient.invalidateQueries({
					queryKey: queryKeys.community.blocks(user.id),
				});
			}
		},

		onError: (error: Error) => {
			toast.error(error.message);
		},
	});
}

// ---------- useUnblockUser ----------

interface UnblockUserArgs {
	blockedId: string;
}

export function useUnblockUser() {
	const { user } = useAuth();
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async ({ blockedId }: UnblockUserArgs) => {
			if (!user) throw new Error("Must be logged in to unblock a user");

			const { error } = await supabase
				.from("user_blocks" as never)
				.delete()
				.eq("blocker_id", user.id)
				.eq("blocked_id", blockedId);

			if (error) throw error;
		},

		onSuccess: () => {
			toast.success("User unblocked");
			if (user) {
				queryClient.invalidateQueries({
					queryKey: queryKeys.community.all,
				});
				queryClient.invalidateQueries({
					queryKey: queryKeys.comments.all,
				});
				queryClient.invalidateQueries({
					queryKey: queryKeys.community.blocks(user.id),
				});
			}
		},

		onError: (error: Error) => {
			toast.error(error.message);
		},
	});
}

// ---------- useSaveItem ----------

interface SaveItemArgs {
	sharedItemId: string;
	itemType: "routine" | "cycle";
}

export function useSaveItem() {
	const { user } = useAuth();
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async ({ sharedItemId, itemType }: SaveItemArgs) => {
			if (!user) throw new Error("Must be logged in to save");

			// Check if already saved
			const { data: existing, error: checkError } = await supabase
				.from("saved_community_items")
				.select("id")
				.eq("user_id", user.id)
				.eq("shared_item_id", sharedItemId)
				.eq("item_type", itemType)
				.maybeSingle();

			if (checkError) throw checkError;

			if (existing) {
				// Remove save (linked reference)
				const { error } = await supabase
					.from("saved_community_items")
					.delete()
					.eq("id", existing.id);
				if (error) throw error;
				return { action: "unsaved" as const };
			} else {
				// Create linked reference (FK to shared_routines/shared_cycles, NOT a data copy)
				const { error } = await supabase.from("saved_community_items").insert({
					user_id: user.id,
					shared_item_id: sharedItemId,
					item_type: itemType,
				});
				if (error) throw error;
				return { action: "saved" as const };
			}
		},

		onSuccess: () => {
			if (user) {
				queryClient.invalidateQueries({
					queryKey: queryKeys.community.saves(user.id),
				});
			}
		},
	});
}
