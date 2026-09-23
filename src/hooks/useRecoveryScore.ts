import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { computeReadinessScore, type RecoveryResult } from "@/lib/recovery";
import { useAuth } from "@/providers/AuthProvider";
import {
	activeCyclePositionOptions,
	recoverySessionsOptions,
	wearableRecoveryOptions,
} from "@/queries/recovery";
import type { WearableRecoveryRow } from "@/schemas/recovery";

interface UseRecoveryScoreResult {
	recovery: RecoveryResult | null;
	wearable: WearableRecoveryRow[] | null;
	isLoading: boolean;
	/** True if any query feeding the recovery score failed. */
	isError: boolean;
	error: Error | null;
	daysSinceFirstSession: number;
}

export function useRecoveryScore(): UseRecoveryScoreResult {
	const { user } = useAuth();
	const userId = user?.id ?? "";

	const {
		data: sessions,
		isPending: sessionsLoading,
		isError: sessionsError,
		error: sessionsErr,
	} = useQuery(recoverySessionsOptions(userId));
	const {
		data: wearable,
		isPending: wearableLoading,
		isError: wearableError,
		error: wearableErr,
	} = useQuery(wearableRecoveryOptions(userId));
	const {
		data: activeCycle,
		isPending: cycleLoading,
		isError: cycleError,
		error: cycleErr,
	} = useQuery(activeCyclePositionOptions(userId));

	const result = useMemo(() => {
		if (!sessions) return { recovery: null, daysSinceFirstSession: 0 };

		// Compute daysSinceFirstSession from the oldest session
		let daysSinceFirstSession = 0;
		if (sessions.length > 0) {
			const oldest = sessions.reduce((min, s) =>
				s.started_at < min.started_at ? s : min,
			);
			const now = new Date();
			daysSinceFirstSession = Math.floor(
				(now.getTime() - oldest.started_at.getTime()) / (1000 * 60 * 60 * 24),
			);
		}

		const cyclePosition = activeCycle
			? {
					currentWeek: activeCycle.current_week,
					durationWeeks: activeCycle.duration_weeks,
					status: activeCycle.status as "active" | "completed" | "draft",
				}
			: null;

		const recovery = computeReadinessScore({
			sessions,
			daysSinceFirstSession,
			cyclePosition,
		});

		return { recovery, daysSinceFirstSession };
	}, [sessions, activeCycle]);

	const firstError = sessionsErr ?? cycleErr ?? wearableErr ?? null;

	return {
		recovery: result.recovery,
		wearable: wearable ?? null,
		// Wait for every input that affects the final score to resolve before
		// presenting it, so the displayed score isn't incomplete then revised.
		isLoading: sessionsLoading || cycleLoading || wearableLoading,
		isError: sessionsError || cycleError || wearableError,
		error: firstError instanceof Error ? firstError : null,
		daysSinceFirstSession: result.daysSinceFirstSession,
	};
}
