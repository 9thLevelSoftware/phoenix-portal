import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useAuth } from "@/app/hooks/useAuth";
import { supabase } from "@/lib/supabase";
import { queryKeys } from "@/queries/keys";

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
				// Invalidate all data caches when mobile app syncs
				queryClient.invalidateQueries({ queryKey: queryKeys.workouts.all });
				queryClient.invalidateQueries({ queryKey: queryKeys.records.all });
				queryClient.invalidateQueries({ queryKey: queryKeys.analytics.all });
				queryClient.invalidateQueries({ queryKey: queryKeys.routines.all });
				queryClient.invalidateQueries({ queryKey: queryKeys.cycles.all });
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
