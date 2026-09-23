import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { queryKeys } from "@/queries/keys";

const DEBOUNCE_MS = 1000;

/**
 * Subscribes to Supabase Realtime postgres_changes on community_comments,
 * scoped to a specific item_id. Debounces query invalidation to avoid
 * excessive refetches during comment bursts.
 *
 * Deletes need their own listener (NF-22). Realtime cannot filter DELETE
 * events, so the item-filtered subscription never sees one, and with RLS on
 * the old record carries only the primary key (even with REPLICA IDENTITY
 * FULL). The DELETE listener is therefore unfiltered and invalidates only when
 * the deleted id is one of this item's cached comments. It exposes nothing
 * beyond the ids of deleted comments, which every signed-in user could read.
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
		const commentsKey = queryKeys.comments.byItem(itemId);

		const scheduleInvalidate = () => {
			// Clear existing debounce timer
			if (timerRef.current) {
				clearTimeout(timerRef.current);
			}

			// Set new debounced invalidation
			timerRef.current = setTimeout(() => {
				queryClient.invalidateQueries({ queryKey: commentsKey });
				timerRef.current = null;
			}, DEBOUNCE_MS);
		};

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
				scheduleInvalidate,
			)
			.on(
				"postgres_changes",
				{ event: "DELETE", schema: "public", table: "community_comments" },
				(payload: { old?: { id?: unknown } | null }) => {
					const deletedId = payload.old?.id;
					if (typeof deletedId !== "string") return;
					const cached =
						queryClient.getQueryData<Array<{ id: string }>>(commentsKey);
					// No data yet: the first fetch may already have read the
					// deleted row, so refetch rather than drop the event.
					if (
						cached === undefined ||
						cached.some((comment) => comment.id === deletedId)
					) {
						scheduleInvalidate();
					}
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
