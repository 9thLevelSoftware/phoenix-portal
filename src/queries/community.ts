import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";
import { z } from "zod";
import { supabase } from "@/lib/supabase";
import {
	communityVoteSchema,
	creatorStatsSchema,
	savedItemSchema,
	sharedCycleDetailSchema,
	sharedCycleSchema,
	sharedRoutineDetailSchema,
	sharedRoutineSchema,
} from "@/schemas/community";
import { queryKeys } from "./keys";

const PAGE_SIZE = 20;
const ROUTINE_SUMMARY_SELECT =
	"id,user_id,routine_id,name,description,exercise_count,estimated_duration,tags,difficulty,vote_count,save_count,hot_score,comment_count,shared_at,updated_at";
const CYCLE_SUMMARY_SELECT =
	"id,user_id,cycle_id,name,description,duration_weeks,tags,difficulty,vote_count,save_count,hot_score,comment_count,shared_at,updated_at";
const ROUTINE_DETAIL_SELECT = `${ROUTINE_SUMMARY_SELECT},exercises_snapshot`;
const CYCLE_DETAIL_SELECT = `${CYCLE_SUMMARY_SELECT},cycle_snapshot`;

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

type ProfileSummary = {
	display_name: string | null;
	avatar_url: string | null;
};

async function hydrateProfiles<T extends { user_id: string | null }>(
	rows: T[],
): Promise<Array<T & { profiles: ProfileSummary | null }>> {
	const userIds = [
		...new Set(
			rows.map((row) => row.user_id).filter((id): id is string => id !== null),
		),
	];

	const profileMap: Record<string, ProfileSummary> = {};

	if (userIds.length > 0) {
		const { data: profiles, error } = await supabase
			.from("public_profiles")
			.select("id, display_name, avatar_url")
			.in("id", userIds);

		// Surface backend/RLS failures instead of silently rendering every creator
		// as having no public profile.
		if (error) throw error;

		if (profiles) {
			for (const p of profiles as Array<
				ProfileSummary & { id: string | null }
			>) {
				if (!p.id) continue;
				profileMap[p.id] = {
					display_name: p.display_name,
					avatar_url: p.avatar_url,
				};
			}
		}
	}

	return rows.map((row) => ({
		...row,
		profiles: row.user_id ? (profileMap[row.user_id] ?? null) : null,
	}));
}

export function communityFeedOptions(params: FeedParams) {
	const table = params.tab === "routines" ? "shared_routines" : "shared_cycles";
	const select =
		params.tab === "routines" ? ROUTINE_SUMMARY_SELECT : CYCLE_SUMMARY_SELECT;
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
			let query = supabase.from(table).select(select);

			// Sort
			if (params.sort === "new") {
				query = query.order("shared_at", { ascending: false });
			} else if (params.sort === "hot") {
				// "hot" ranks by the precomputed hot_score (recency-weighted votes),
				// with shared_at as a deterministic tie-breaker.
				query = query
					.order("hot_score", { ascending: false })
					.order("shared_at", { ascending: false });
			} else {
				query = query
					.order("vote_count", { ascending: false })
					.order("shared_at", { ascending: false });
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

			const merged = await hydrateProfiles(
				data as { user_id: string | null }[],
			);

			return schema.parse(merged);
		},
		initialPageParam: 0,
		getNextPageParam: (lastPage, allPages) => {
			if (lastPage.length < PAGE_SIZE) return undefined;
			return allPages.reduce((total, page) => total + page.length, 0);
		},
	});
}

export function communityItemDetailOptions(
	itemType: "routine" | "cycle",
	itemId: string,
) {
	const table = itemType === "routine" ? "shared_routines" : "shared_cycles";
	const select =
		itemType === "routine" ? ROUTINE_DETAIL_SELECT : CYCLE_DETAIL_SELECT;
	const schema =
		itemType === "routine"
			? sharedRoutineDetailSchema
			: sharedCycleDetailSchema;

	return queryOptions({
		queryKey: queryKeys.community.detail(itemType, itemId),
		queryFn: async () => {
			const { data, error } = await supabase
				.from(table)
				.select(select)
				.eq("id", itemId)
				.single();
			if (error) throw error;

			const [merged] = await hydrateProfiles([
				data as { user_id: string | null },
			]);
			return schema.parse(merged);
		},
		enabled: !!itemId,
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
