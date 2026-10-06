import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { queryKeys } from "./keys";

/**
 * Cached server insights for one period.
 *
 * Only NON-EXPIRED rows are returned (KD-14). `replace_user_insights` stamps
 * `expires_at = now() + 36h`, so a batch the scheduler has stopped refreshing
 * drops out of this query and the Analytics feed falls back to the browser
 * rules instead of showing stale server text as if it were current. Rows
 * written before migration 20260920006400 have `expires_at IS NULL`; PostgREST
 * `gt` excludes NULLs, so they are treated as expired — which is what we want.
 *
 * `replace_user_insights` writes the batch in one INSERT, so every row shares
 * `created_at`. Ordering on that timestamp is a tie, and a row cap would drop
 * part of the batch. `id` returns the whole set in a stable order. The feed
 * renders that array as returned.
 */
export function insightsOptions(userId: string, period: string = "30d") {
	return queryOptions({
		queryKey: queryKeys.insights.byUser(userId, period),
		queryFn: async () => {
			const { data, error } = await supabase
				.from("user_insights")
				.select("*")
				.eq("user_id", userId)
				.eq("period", period)
				.gt("expires_at", new Date().toISOString())
				.order("id", { ascending: true });
			if (error) throw error;
			return data;
		},
		enabled: !!userId,
	});
}
