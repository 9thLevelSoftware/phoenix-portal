import { queryOptions } from "@tanstack/react-query";
import { z } from "zod";
import { supabase } from "@/lib/supabase";
import { commentSchema } from "@/schemas/comments";
import { queryKeys } from "./keys";

export function commentsOptions(itemId: string) {
	return queryOptions({
		queryKey: queryKeys.comments.byItem(itemId),
		queryFn: async () => {
			const { data, error } = await supabase
				.from("community_comments")
				.select("*")
				.eq("item_id", itemId)
				.is("deleted_at", null)
				.order("created_at", { ascending: true });

			if (error) throw error;

			const userIds = [
				...new Set(
					(data ?? [])
						.map((row) => row.user_id)
						.filter((id): id is string => id !== null),
				),
			];
			const profileMap: Record<
				string,
				{ display_name: string | null; avatar_url: string | null }
			> = {};

			if (userIds.length > 0) {
				const { data: profiles, error: profilesError } = await supabase
					.from("public_profiles")
					.select("id, display_name, avatar_url")
					.in("id", userIds);
				if (profilesError) throw profilesError;

				for (const profile of profiles ?? []) {
					if (!profile.id) continue;
					profileMap[profile.id] = {
						display_name: profile.display_name,
						avatar_url: profile.avatar_url,
					};
				}
			}

			const merged = (data ?? []).map((row) => ({
				...row,
				profiles: row.user_id ? (profileMap[row.user_id] ?? null) : null,
			}));

			return z.array(commentSchema).parse(merged);
		},
		enabled: !!itemId,
	});
}
