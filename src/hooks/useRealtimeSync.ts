import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useAuth } from "@/app/hooks/useAuth";
import { useSubscription } from "@/hooks/useSubscription";
import { supabase } from "@/lib/supabase";

/**
 * Realtime sync bridge -- listens for Supabase Broadcast events from the mobile app.
 * When a sync_complete event is received, invalidates all TanStack Query caches
 * so visible pages refetch fresh data.
 *
 * Only subscribes for EMBER+ users. Free users skip the broadcast channel
 * to avoid unnecessary WebSocket connections.
 *
 * Must be mounted once in the app shell (AppLayout), not per-page.
 */
export function useRealtimeSync() {
	const { user } = useAuth();
	const { tier, isLoading } = useSubscription();
	const queryClient = useQueryClient();

	useEffect(() => {
		if (!user) return;

		// Wait for subscription data to resolve before deciding
		if (isLoading) return;

		// Free users don't get sync — skip the broadcast channel
		if (tier === "FREE") return;

		const channel = supabase
			.channel(`sync:${user.id}`)
			.on("broadcast", { event: "sync_complete" }, (_payload) => {
				// Sync can affect any derived surface, so invalidate the full cache.
				queryClient.invalidateQueries();
			})
			.subscribe((status) => {
				if (status === "SUBSCRIBED") {
					console.log("[Phoenix] Realtime sync channel active");
				}
				if (status === "CHANNEL_ERROR") {
					console.error("[Phoenix] Realtime sync channel error");
				}
			});

		return () => {
			supabase.removeChannel(channel);
		};
	}, [user, tier, isLoading, queryClient]);
}
