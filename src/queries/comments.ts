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
				.select("*, profiles(display_name, avatar_url)")
				.eq("item_id", itemId)
				.is("deleted_at", null)
				.order("created_at", { ascending: true });

			if (error) throw error;
			return z.array(commentSchema).parse(data);
		},
		enabled: !!itemId,
	});
}
