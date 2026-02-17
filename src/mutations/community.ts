import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/providers/AuthProvider";
import { queryKeys } from "@/queries/keys";
import type { CommunityFeedItem } from "@/schemas/community";

// Module-level mute ref: realtime hook checks this to skip invalidation
// after an optimistic vote update (prevents flicker from double-update)
export const voteMutedRef: { current: number } = { current: 0 };

const MUTE_WINDOW_MS = 3000;

// ---------- useVote ----------

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

		onMutate: async ({ itemId, itemType }: VoteMutationArgs) => {
			// Set mute window so realtime hook skips invalidation
			voteMutedRef.current = Date.now() + MUTE_WINDOW_MS;

			// Cancel outgoing feed queries
			await queryClient.cancelQueries({ queryKey: queryKeys.community.all });

			// Snapshot current feed data
			const feedQueryKey = queryKeys.community.all;
			const previousData = queryClient.getQueriesData<{
				pages: CommunityFeedItem[][];
				pageParams: number[];
			}>({ queryKey: feedQueryKey });

			// Determine if user already voted (check votes set in cache)
			const votesKey = user ? queryKeys.community.votes(user.id) : undefined;
			const currentVotes = votesKey
				? queryClient.getQueryData<Set<string>>(votesKey)
				: undefined;
			const isCurrentlyVoted = currentVotes?.has(itemId) ?? false;
			const delta = isCurrentlyVoted ? -1 : 1;

			// Optimistically update feed items across all feed query caches
			queryClient.setQueriesData<{
				pages: CommunityFeedItem[][];
				pageParams: number[];
			}>({ queryKey: feedQueryKey }, (old) => {
				if (!old) return old;
				return {
					...old,
					pages: old.pages.map((page) =>
						page.map((item) => {
							if (item.id === itemId) {
								return {
									...item,
									vote_count: Math.max(0, item.vote_count + delta),
								};
							}
							return item;
						}),
					),
				};
			});

			// Optimistically update the user's votes set
			if (votesKey) {
				queryClient.setQueryData<Set<string>>(votesKey, (old) => {
					const next = new Set(old);
					if (isCurrentlyVoted) {
						next.delete(itemId);
					} else {
						next.add(itemId);
					}
					return next;
				});
			}

			return { previousData, mutedUntil: voteMutedRef.current };
		},

		onError: (_error, _variables, context) => {
			// Rollback to snapshot
			if (context?.previousData) {
				for (const [key, data] of context.previousData) {
					queryClient.setQueryData(key, data);
				}
			}
		},

		// onSettled: intentionally omitted — let realtime handle eventual consistency
		// This prevents double-update flicker (pitfall #5)
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
			console.error("Failed to share content:", error);
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
