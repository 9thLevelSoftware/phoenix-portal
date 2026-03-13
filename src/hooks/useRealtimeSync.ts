import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useAuth } from "@/app/hooks/useAuth";
import { supabase } from "@/lib/supabase";

/**
 * Realtime sync bridge -- listens for Supabase Broadcast events from the mobile app.
 * When a sync_complete event is received, invalidates all TanStack Query caches
 * so visible pages refetch fresh data.
 *
 * Must be mounted once in the app shell (App.tsx), not per-page.
 */
export function useRealtimeSync() {
	const { user } = useAuth();
	const queryClient = useQueryClient();

	useEffect(() => {
		if (!user) return;

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
	}, [user, queryClient]);
}
