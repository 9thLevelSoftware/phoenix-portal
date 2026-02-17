import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { voteMutedRef } from "@/mutations/community";
import { queryKeys } from "@/queries/keys";

const DEBOUNCE_MS = 2500;

/**
 * Subscribes to Supabase Realtime postgres_changes on the community_votes table.
 * Debounces query invalidation to avoid excessive refetches during vote bursts.
 *
 * Checks voteMutedRef to skip invalidation during the mute window after an
 * optimistic vote update, preventing double-update flicker.
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
					// Skip invalidation during optimistic vote mute window
					if (Date.now() < voteMutedRef.current) return;

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
