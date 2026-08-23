import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { useAuth } from "@/app/hooks/useAuth";
import { workoutListOptions, workoutStreakOptions } from "@/queries/workouts";
import { useUIStore } from "@/stores/useUIStore";
import { useStreak } from "./useStreak";

/**
 * Loads the SQL workout streak and syncs it to the UI store.
 * Mount once in AppLayout so Navigation and MobileBottomNav always
 * reflect the real streak value (not the first page of history).
 *
 * Matches Dashboard: RPC when present, otherwise the list reduction.
 * Missing RPC while the list is still loading does not overwrite last-known
 * with 0.
 */
export function useStreakSync(): void {
	const { user } = useAuth();
	const { data: rpcStreak } = useQuery({
		...workoutStreakOptions(user?.id ?? ""),
		enabled: !!user?.id,
	});
	const { data: workouts } = useQuery({
		...workoutListOptions(user?.id ?? ""),
		enabled: !!user?.id,
	});
	const listStreak = useStreak(workouts);
	const setStreak = useUIStore((s) => s.setStreak);

	useEffect(() => {
		if (typeof rpcStreak === "number") {
			setStreak(rpcStreak);
			return;
		}
		if (workouts !== undefined) {
			setStreak(listStreak);
		}
	}, [rpcStreak, workouts, listStreak, setStreak]);
}
