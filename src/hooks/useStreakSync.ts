import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { useAuth } from "@/app/hooks/useAuth";
import { workoutListOptions } from "@/queries/workouts";
import { useUIStore } from "@/stores/useUIStore";
import { useStreak } from "./useStreak";

/**
 * Computes the current workout streak and syncs it to the UI store.
 * Mount once in AppLayout so Navigation and MobileBottomNav always
 * reflect the real streak value.
 *
 * Re-uses the cached workoutList query (react-query deduplicates),
 * so no extra network requests when Dashboard is also mounted.
 */
export function useStreakSync(): void {
	const { user } = useAuth();
	const { data: workouts } = useQuery({
		...workoutListOptions(user?.id ?? ""),
		enabled: !!user?.id,
	});
	const streak = useStreak(workouts);
	const setStreak = useUIStore((s) => s.setStreak);

	useEffect(() => {
		setStreak(streak);
	}, [streak, setStreak]);
}
