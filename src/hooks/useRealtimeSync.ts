import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { useAuth } from "@/app/hooks/useAuth";
import { useSubscription } from "@/hooks/useSubscription";
import { supabase } from "@/lib/supabase";
import { queryKeys } from "@/queries/keys";

/** Coalesce rapid mobile broadcasts into a single invalidation burst. */
const INVALIDATION_DEBOUNCE_MS = 400;
const E2E_SYNC_COMPLETE_EVENT = "phoenix:e2e-sync-complete";

/**
 * Realtime sync bridge — listens for Supabase Broadcast events from the mobile app.
 * On `sync_complete`, invalidates only query families that mobile sync can change
 * (workouts, records, routines, cycles, analytics, profile, challenges, external
 * activities, and local profiles).
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
	const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	useEffect(() => {
		if (!user) return;

		// Wait for subscription data to resolve before deciding
		if (isLoading) return;

		// Free users don't get sync — skip the broadcast channel
		if (tier === "FREE") return;

		const scheduleInvalidation = () => {
			if (debounceTimerRef.current) {
				clearTimeout(debounceTimerRef.current);
			}
			debounceTimerRef.current = setTimeout(() => {
				debounceTimerRef.current = null;
				void Promise.all([
					queryClient.invalidateQueries({ queryKey: queryKeys.workouts.all }),
					queryClient.invalidateQueries({ queryKey: queryKeys.records.all }),
					queryClient.invalidateQueries({ queryKey: queryKeys.routines.all }),
					queryClient.invalidateQueries({ queryKey: queryKeys.cycles.all }),
					queryClient.invalidateQueries({
						queryKey: queryKeys.analytics.all,
					}),
					queryClient.invalidateQueries({
						queryKey: queryKeys.telemetry.all,
					}),
					queryClient.invalidateQueries({
						queryKey: queryKeys.biomechanics.all,
					}),
					queryClient.invalidateQueries({ queryKey: queryKeys.progress.all }),
					queryClient.invalidateQueries({ queryKey: queryKeys.replay.all }),
					queryClient.invalidateQueries({ queryKey: queryKeys.profile.all }),
					queryClient.invalidateQueries({
						queryKey: queryKeys.challenges.all,
					}),
					queryClient.invalidateQueries({
						queryKey: queryKeys.integrations.external(user.id),
					}),
					queryClient.invalidateQueries({
						queryKey: queryKeys.localProfiles.byUser(user.id),
					}),
				]);
			}, INVALIDATION_DEBOUNCE_MS);
		};

		const handleSyntheticSyncComplete: EventListener = (event) => {
			const detail = (event as CustomEvent<{ userId?: string }>).detail;
			if (detail?.userId && detail.userId !== user.id) {
				return;
			}
			scheduleInvalidation();
		};

		if (import.meta.env.DEV) {
			window.addEventListener(
				E2E_SYNC_COMPLETE_EVENT,
				handleSyntheticSyncComplete,
			);
		}

		const channel = supabase
			.channel(`sync:${user.id}`)
			.on("broadcast", { event: "sync_complete" }, () => {
				scheduleInvalidation();
			})
			.subscribe((status) => {
				// fix(audit): H — drop info-level console.log in production.
				// Keep console.error so real channel failures remain visible.
				if (status === "CHANNEL_ERROR") {
					console.error("[Phoenix] Realtime sync channel error");
				}
			});

		return () => {
			if (import.meta.env.DEV) {
				window.removeEventListener(
					E2E_SYNC_COMPLETE_EVENT,
					handleSyntheticSyncComplete,
				);
			}
			if (debounceTimerRef.current) {
				clearTimeout(debounceTimerRef.current);
				debounceTimerRef.current = null;
			}
			supabase.removeChannel(channel);
		};
	}, [user, tier, isLoading, queryClient]);
}
