import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { useAuth } from "@/app/hooks/useAuth";
import { useSubscription } from "@/hooks/useSubscription";
import { supabase } from "@/lib/supabase";
import { syncBroadcastTopic } from "@/lib/syncBroadcast";
import { queryKeys } from "@/queries/keys";

/** Coalesce rapid mobile broadcasts into a single invalidation burst. */
const INVALIDATION_DEBOUNCE_MS = 400;
const E2E_SYNC_COMPLETE_EVENT = "phoenix:e2e-sync-complete";
/** While the channel is down, poll workouts at this interval until SUBSCRIBED. */
export const DEGRADED_POLL_INTERVAL_MS = 60_000;
const DEGRADED_STATUSES = new Set(["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"]);

/**
 * Per-user teardown so a StrictMode remount awaits removeChannel instead of
 * opening a different room (no UUID suffix).
 */
const channelTeardown = new Map<string, Promise<unknown>>();

/**
 * Realtime sync bridge — listens for Supabase Broadcast events from the mobile app.
 * On `sync_complete`, invalidates only query families that mobile sync can change
 * (workouts, records, routines, cycles, analytics, profile, challenges, external
 * activities, local profiles, onboarding, goals, and insights).
 *
 * Subscribes to the exact private topic `sync:{userId}`. The first SUBSCRIBED
 * for a user in this mount does not invalidate (queries just fetched on mount);
 * a later re-subscribe does, to catch up on broadcasts missed while down.
 * CHANNEL_ERROR, TIMED_OUT and CLOSED toast via sonner and poll workouts every
 * 60s until the next SUBSCRIBED. There is no fallback to a public topic.
 *
 * Subscribes for last-known EMBER+ users. A billing fetch error does not
 * skip the channel (error is not treated as FREE). Confirmed FREE users skip
 * the broadcast channel to avoid unnecessary WebSocket connections.
 *
 * Must be mounted once in the app shell (AppLayout), not per-page.
 */
export function useRealtimeSync() {
	const { user } = useAuth();
	const { tier, isLoading, isError } = useSubscription();
	const queryClient = useQueryClient();
	const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	// userId whose channel has reached SUBSCRIBED at least once in this mount.
	const subscribedUserRef = useRef<string | null>(null);

	useEffect(() => {
		if (!user) return;

		// Wait for subscription data to resolve before deciding
		if (isLoading) return;

		// Confirmed FREE users skip the broadcast channel. A billing outage
		// (`isError`) must not be treated as FREE — subscribe on last-known
		// EMBER+ or when entitlement is unknown.
		if (!isError && tier === "FREE") return;

		const userId = user.id;

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
					queryClient.invalidateQueries({ queryKey: queryKeys.recovery.all }),
					queryClient.invalidateQueries({ queryKey: queryKeys.replay.all }),
					queryClient.invalidateQueries({ queryKey: queryKeys.profile.all }),
					queryClient.invalidateQueries({
						queryKey: queryKeys.challenges.all,
					}),
					queryClient.invalidateQueries({
						queryKey: queryKeys.integrations.external(userId),
					}),
					queryClient.invalidateQueries({
						queryKey: queryKeys.localProfiles.byUser(userId),
					}),
					queryClient.invalidateQueries({
						queryKey: queryKeys.onboarding.all,
					}),
					queryClient.invalidateQueries({ queryKey: queryKeys.goals.all }),
					queryClient.invalidateQueries({ queryKey: queryKeys.insights.all }),
				]);
			}, INVALIDATION_DEBOUNCE_MS);
		};

		const handleSyntheticSyncComplete: EventListener = (event) => {
			const detail = (event as CustomEvent<{ userId?: string }>).detail;
			if (detail?.userId && detail.userId !== userId) {
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

		let cancelled = false;
		let channel: ReturnType<typeof supabase.channel> | null = null;
		let pollTimer: ReturnType<typeof setInterval> | null = null;
		// Set once the channel has been down; the next SUBSCRIBED must catch up.
		let wasDegraded = false;

		const stopPolling = () => {
			if (pollTimer) {
				clearInterval(pollTimer);
				pollTimer = null;
			}
		};

		const startPolling = () => {
			if (pollTimer) return;
			pollTimer = setInterval(() => {
				void queryClient.invalidateQueries({
					queryKey: queryKeys.workouts.all,
				});
			}, DEGRADED_POLL_INTERVAL_MS);
		};

		const start = async () => {
			const previousTeardown = channelTeardown.get(userId);
			if (previousTeardown) {
				await previousTeardown;
			}
			if (cancelled) return;

			channel = supabase
				.channel(syncBroadcastTopic(userId), { config: { private: true } })
				.on("broadcast", { event: "sync_complete" }, () => {
					scheduleInvalidation();
				})
				.subscribe((status) => {
					if (cancelled) return;
					if (status === "SUBSCRIBED") {
						stopPolling();
						if (subscribedUserRef.current === userId || wasDegraded) {
							// Re-subscribe: catch up on anything missed while down.
							scheduleInvalidation();
						}
						// First clean subscribe: queries just fetched on mount; skip the burst.
						subscribedUserRef.current = userId;
						wasDegraded = false;
						return;
					}
					if (DEGRADED_STATUSES.has(status)) {
						toast.error("Live sync unavailable. Refresh to retry.", {
							id: "phoenix-realtime-sync-unavailable",
						});
						wasDegraded = true;
						startPolling();
						// Do NOT fall back to a public unsuffixed sync:{userId} topic.
					}
				});

			if (cancelled) {
				await supabase.removeChannel(channel);
				channel = null;
			}
		};

		void start();

		return () => {
			cancelled = true;
			stopPolling();
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
			const toRemove = channel;
			const teardown = toRemove
				? Promise.resolve(supabase.removeChannel(toRemove))
				: Promise.resolve();
			channelTeardown.set(userId, teardown);
			void teardown.finally(() => {
				if (channelTeardown.get(userId) === teardown) {
					channelTeardown.delete(userId);
				}
			});
		};
	}, [user, tier, isLoading, isError, queryClient]);
}
