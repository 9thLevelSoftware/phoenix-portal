import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { useAuth } from "@/app/hooks/useAuth";
import { supabase } from "@/lib/supabase";
import { useUIStore } from "@/stores/useUIStore";

/**
 * Syncs notification badge counts to the UI store.
 * Mount once in AppLayout alongside useStreakSync.
 *
 * Challenges: active challenges the user joined but hasn't completed.
 * Community:  comments by others on the user's shared routines/cycles
 *             from the last 7 days (no read-tracking column exists yet,
 *             so recency is the best proxy).
 *
 * Both queries are lightweight count-only RPCs.
 * Refetches every 5 minutes + on window focus (react-query defaults).
 */
export function useNotificationSync(): void {
	const { user } = useAuth();
	const setNotifications = useUIStore((s) => s.setNotifications);

	// --- Challenges needing attention ---
	const { data: challengeCount, isSuccess: challengeSuccess } = useQuery({
		queryKey: ["notifications", "challenges", user?.id],
		queryFn: async () => {
			const { count, error } = await supabase
				.from("challenge_participants")
				.select("*", { count: "exact", head: true })
				.eq("user_id", user?.id)
				.is("completed_at", null);
			if (error) throw error;
			return count ?? 0;
		},
		enabled: !!user?.id,
		staleTime: 5 * 60 * 1000, // 5 minutes
	});

	// --- Recent community comments on user's content ---
	const { data: communityCount, isSuccess: communitySuccess } = useQuery({
		queryKey: ["notifications", "community", user?.id],
		queryFn: async () => {
			const sevenDaysAgo = new Date(
				Date.now() - 7 * 24 * 60 * 60 * 1000,
			).toISOString();

			// Get IDs of user's shared routines
			const { data: routines, error: routinesError } = await supabase
				.from("shared_routines")
				.select("id")
				.eq("user_id", user?.id);
			if (routinesError) throw routinesError;

			// Get IDs of user's shared cycles
			const { data: cycles, error: cyclesError } = await supabase
				.from("shared_cycles")
				.select("id")
				.eq("user_id", user?.id);
			if (cyclesError) throw cyclesError;

			const itemIds = [
				...(routines ?? []).map((r) => r.id),
				...(cycles ?? []).map((c) => c.id),
			];

			if (itemIds.length === 0) return 0;

			// Count recent comments by others on user's shared content
			const { count, error } = await supabase
				.from("community_comments")
				.select("*", { count: "exact", head: true })
				.in("item_id", itemIds)
				.neq("user_id", user?.id)
				.gte("created_at", sevenDaysAgo)
				.is("deleted_at", null);

			if (error) throw error;
			return count ?? 0;
		},
		enabled: !!user?.id,
		staleTime: 5 * 60 * 1000,
	});

	useEffect(() => {
		// Only write a count once its query has successfully resolved. Writing
		// during the initial loading window or after an error would briefly clear
		// badges on every mount/focus refetch and hide failures as empty counts.
		const next: { challenges?: number; community?: number } = {};
		if (challengeSuccess) {
			next.challenges = challengeCount ?? 0;
		}
		if (communitySuccess) {
			next.community = communityCount ?? 0;
		}
		if (next.challenges !== undefined || next.community !== undefined) {
			setNotifications(next);
		}
	}, [
		challengeCount,
		communityCount,
		challengeSuccess,
		communitySuccess,
		setNotifications,
	]);
}
