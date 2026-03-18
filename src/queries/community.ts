import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";
import { z } from "zod";
import { supabase } from "@/lib/supabase";
import {
	communityVoteSchema,
	creatorStatsSchema,
	savedItemSchema,
	sharedCycleSchema,
	sharedRoutineSchema,
} from "@/schemas/community";
import { queryKeys } from "./keys";

const PAGE_SIZE = 20;

type FeedTab = "routines" | "cycles";
type FeedSort = "hot" | "top" | "new";

interface FeedParams {
	tab: FeedTab;
	sort: FeedSort;
	filters?: {
		muscleGroup?: string;
		difficulty?: string;
	};
	search?: string;
	userId?: string;
}

export function communityFeedOptions(params: FeedParams) {
	const table = params.tab === "routines" ? "shared_routines" : "shared_cycles";
	const schema =
		params.tab === "routines"
			? z.array(sharedRoutineSchema)
			: z.array(sharedCycleSchema);

	return infiniteQueryOptions({
		queryKey: queryKeys.community.feed({
			tab: params.tab,
			sort: params.sort,
			filters: params.filters as Record<string, string> | undefined,
			search: params.search,
			userId: params.userId,
		}),
		queryFn: async ({ pageParam = 0 }) => {
			// shared_routines/shared_cycles.user_id -> auth.users(id), not profiles(id)
			// PostgREST cannot resolve the profiles join directly, so we do a
			// two-step fetch: get feed rows first, then batch-fetch profiles.
			let query = supabase.from(table).select("*");

			// Sort
			if (params.sort === "new") {
				query = query.order("shared_at", { ascending: false });
			} else if (params.sort === "top") {
				query = query.order("vote_count", { ascending: false });
			} else {
				query = query.order("hot_score", { ascending: false });
			}

			// Creator filter
			if (params.userId) {
				query = query.eq("user_id", params.userId);
			}

			// Filters
			if (params.filters?.muscleGroup) {
				query = query.contains("tags", [params.filters.muscleGroup]);
			}
			if (params.filters?.difficulty) {
				query = query.eq("difficulty", params.filters.difficulty);
			}

			// Search
			if (params.search) {
				query = query.ilike("name", `%${params.search}%`);
			}

			// Pagination
			query = query.range(pageParam, pageParam + PAGE_SIZE - 1);

			const { data, error } = await query;
			if (error) throw error;

			// Batch-fetch profiles for all non-null user_ids in this page
			const userIds = [
				...new Set(
					(data as { user_id: string | null }[])
						.map((row) => row.user_id)
						.filter((id): id is string => id !== null),
				),
			];

			let profileMap: Record<
				string,
				{ display_name: string; avatar_url: string | null }
			> = {};

			if (userIds.length > 0) {
				const { data: profiles } = await supabase
					.from("profiles")
					.select("id, display_name, avatar_url")
					.in("id", userIds);

				if (profiles) {
					for (const p of profiles as {
						id: string;
						display_name: string;
						avatar_url: string | null;
					}[]) {
						profileMap[p.id] = {
							display_name: p.display_name,
							avatar_url: p.avatar_url,
						};
					}
				}
			}

			const merged = (data as { user_id: string | null }[]).map((row) => ({
				...row,
				profiles: row.user_id ? (profileMap[row.user_id] ?? null) : null,
			}));

			return schema.parse(merged);
		},
		initialPageParam: 0,
		getNextPageParam: (lastPage, allPages) => {
			if (lastPage.length < PAGE_SIZE) return undefined;
			return allPages.reduce((total, page) => total + page.length, 0);
		},
	});
}

export function creatorStatsOptions(userId: string) {
	return queryOptions({
		queryKey: queryKeys.community.creators.profile(userId),
		queryFn: async () => {
			const { data, error } = await supabase
				.from("creator_stats")
				.select("*")
				.eq("user_id", userId)
				.single();
			if (error) throw error;
			return creatorStatsSchema.parse(data);
		},
	});
}

export function featuredCreatorsOptions() {
	return queryOptions({
		queryKey: queryKeys.community.creators.featured(),
		queryFn: async () => {
			const { data, error } = await supabase
				.from("creator_stats")
				.select("*")
				.gte("total_shares", 3)
				.order("total_upvotes", { ascending: false })
				.limit(10);
			if (error) throw error;
			return z.array(creatorStatsSchema).parse(data);
		},
	});
}

export function savedItemsOptions(userId: string) {
	return queryOptions({
		queryKey: queryKeys.community.saves(userId),
		queryFn: async () => {
			const { data, error } = await supabase
				.from("saved_community_items")
				.select("*")
				.eq("user_id", userId)
				.order("saved_at", { ascending: false });
			if (error) throw error;
			return z.array(savedItemSchema).parse(data);
		},
	});
}

export function isFollowingOptions(followerId: string, followedId: string) {
	return queryOptions({
		queryKey: queryKeys.community.follows(followerId, followedId),
		queryFn: async () => {
			const { data, error } = await supabase
				.from("creator_follows" as never)
				.select("id")
				.eq("follower_id", followerId)
				.eq("followed_id", followedId)
				.maybeSingle();
			if (error) throw error;
			return !!data;
		},
		enabled: !!followerId && !!followedId && followerId !== followedId,
	});
}

export function blockedUsersOptions(userId: string) {
	return queryOptions({
		queryKey: queryKeys.community.blocks(userId),
		queryFn: async () => {
			const { data, error } = await supabase
				.from("user_blocks" as never)
				.select("blocked_id")
				.eq("blocker_id", userId);
			if (error) throw error;
			return (data as { blocked_id: string }[]).map((row) => row.blocked_id);
		},
	});
}

export function userVotesOptions(userId: string) {
	return queryOptions({
		queryKey: queryKeys.community.votes(userId),
		queryFn: async () => {
			const { data, error } = await supabase
				.from("community_votes")
				.select("*")
				.eq("user_id", userId);
			if (error) throw error;
			const votes = z.array(communityVoteSchema).parse(data);
			return new Set(votes.map((v) => v.item_id));
		},
	});
}
