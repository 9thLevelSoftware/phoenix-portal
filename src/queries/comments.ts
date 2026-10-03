import { queryOptions } from "@tanstack/react-query";
import { z } from "zod";
import { supabase } from "@/lib/supabase";
import { fetchAllSupabasePages } from "@/lib/supabasePaging";
import { commentSchema } from "@/schemas/comments";
import { hydrateProfiles } from "./community";
import { queryKeys } from "./keys";

export function commentsOptions(itemId: string) {
	return queryOptions({
		queryKey: queryKeys.comments.byItem(itemId),
		queryFn: async () => {
			// One response is silently capped at PostgREST max_rows.
			// created_at is the thread order; id keeps a page boundary
			// from skipping ties.
			const data = await fetchAllSupabasePages((from, to) =>
				supabase
					.from("community_comments")
					.select("*")
					.eq("item_id", itemId)
					.is("deleted_at", null)
					.order("created_at", { ascending: true })
					.order("id", { ascending: true })
					.range(from, to),
			);

			const merged = await hydrateProfiles(data);
			return z.array(commentSchema).parse(merged);
		},
		enabled: !!itemId,
	});
}
