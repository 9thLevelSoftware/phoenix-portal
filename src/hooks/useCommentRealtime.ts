import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { queryKeys } from "@/queries/keys";

const DEBOUNCE_MS = 1000;

/**
 * Subscribes to Supabase Realtime postgres_changes on community_comments,
 * scoped to a specific item_id. Debounces query invalidation to avoid
 * excessive refetches during comment bursts.
 */
export function useCommentRealtime(itemId: string) {
	const queryClient = useQueryClient();
	const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	useEffect(() => {
		if (!itemId) return;

		const channelSuffix =
			typeof globalThis.crypto?.randomUUID === "function"
				? globalThis.crypto.randomUUID()
				: Math.random().toString(36).slice(2);
		const channelTopic = `comments:${itemId}:${channelSuffix}`;

		const channel = supabase
			.channel(channelTopic)
			.on(
				"postgres_changes",
				{
					event: "*",
					schema: "public",
					table: "community_comments",
					filter: `item_id=eq.${itemId}`,
				},
				() => {
					// Clear existing debounce timer
					if (timerRef.current) {
						clearTimeout(timerRef.current);
					}

					// Set new debounced invalidation
					timerRef.current = setTimeout(() => {
						queryClient.invalidateQueries({
							queryKey: queryKeys.comments.byItem(itemId),
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
	}, [itemId, queryClient]);
}
