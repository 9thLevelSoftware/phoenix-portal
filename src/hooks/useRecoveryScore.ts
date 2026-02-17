import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useAuth } from "@/providers/AuthProvider";
import {
	computeReadinessScore,
	type RecoveryResult,
} from "@/lib/recovery";
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
	daysSinceFirstSession: number;
}

export function useRecoveryScore(): UseRecoveryScoreResult {
	const { user } = useAuth();
	const userId = user?.id ?? "";

	const { data: sessions, isPending: sessionsLoading } = useQuery(
		recoverySessionsOptions(userId),
	);
	const { data: wearable } = useQuery(wearableRecoveryOptions(userId));
	const { data: activeCycle } = useQuery(activeCyclePositionOptions(userId));

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

	return {
		recovery: result.recovery,
		wearable: wearable ?? null,
		isLoading: sessionsLoading,
		daysSinceFirstSession: result.daysSinceFirstSession,
	};
}
