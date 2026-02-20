import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { queryKeys } from "@/queries/keys";

const DEBOUNCE_MS = 2500;

/**
 * Subscribes to Supabase Realtime postgres_changes on the community_votes table.
 * Debounces query invalidation to avoid excessive refetches during vote bursts.
 */
export function useCommunityRealtime() {
	const queryClient = useQueryClient();
	const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	useEffect(() => {
		const channel = supabase
			.channel("community-votes-realtime")
			.on(
				"postgres_changes",
				{
					event: "*",
					schema: "public",
					table: "community_votes",
				},
				() => {
					// Clear existing debounce timer
					if (timerRef.current) {
						clearTimeout(timerRef.current);
					}

					// Set new debounced invalidation
					timerRef.current = setTimeout(() => {
						queryClient.invalidateQueries({
							queryKey: queryKeys.community.all,
						});
						timerRef.current = null;
					}, DEBOUNCE_MS);
				},
			)
			.subscribe();

		return () => {
			supabase.removeChannel(channel);
			if (timerRef.current) {
				clearTimeout(timerRef.current);
				timerRef.current = null;
			}
		};
	}, [queryClient]);
}
