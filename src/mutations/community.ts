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
				.from("creator_follows")
				.select("id")
				.eq("follower_id", user.id)
				.eq("followed_id", followedId)
				.maybeSingle();

			if (checkError) throw checkError;

			if (existing) {
				const { error } = await supabase
					.from("creator_follows")
					.delete()
					.eq("id", existing.id);
				if (error) throw error;
				return { action: "unfollowed" as const };
			}
			const { error } = await supabase.from("creator_follows").insert({
				follower_id: user.id,
				followed_id: followedId,
			});
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

		onError: (error) => {
			toast.error(`Failed to update follow: ${error.message}`);
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
