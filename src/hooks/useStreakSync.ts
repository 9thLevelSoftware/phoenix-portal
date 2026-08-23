import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { useAuth } from "@/app/hooks/useAuth";
import { workoutStreakOptions } from "@/queries/workouts";
import { useUIStore } from "@/stores/useUIStore";

/**
 * Loads the SQL workout streak and syncs it to the UI store.
 * Mount once in AppLayout so Navigation and MobileBottomNav always
 * reflect the real streak value (not the first page of history).
 */
export function useStreakSync(): void {
	const { user } = useAuth();
	const { data: streak } = useQuery({
		...workoutStreakOptions(user?.id ?? ""),
		enabled: !!user?.id,
	});
	const setStreak = useUIStore((s) => s.setStreak);

	useEffect(() => {
		setStreak(typeof streak === "number" ? streak : 0);
	}, [streak, setStreak]);
}
