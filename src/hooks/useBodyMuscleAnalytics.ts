import { useEffect, useState } from "react";
import {
	type BodyMuscleAnalyticsModule,
	loadBodyMuscleAnalytics,
} from "@/lib/body-muscle-analytics-loader";

export interface BodyMuscleAnalyticsState {
	analytics: BodyMuscleAnalyticsModule | null;
	failed: boolean;
}

/**
 * Lazily loads the body-muscle analytics module (and its generated map) the
 * first time `enabled` is true. Once loaded it stays loaded.
 */
export function useBodyMuscleAnalytics(
	enabled: boolean,
): BodyMuscleAnalyticsState {
	const [state, setState] = useState<BodyMuscleAnalyticsState>({
		analytics: null,
		failed: false,
	});
	const loaded = state.analytics !== null;

	useEffect(() => {
		if (!enabled || loaded) return;
		let cancelled = false;
		setState((current) =>
			current.failed ? { analytics: null, failed: false } : current,
		);
		loadBodyMuscleAnalytics().then(
			(analytics) => {
				if (!cancelled) setState({ analytics, failed: false });
			},
			() => {
				if (!cancelled) setState({ analytics: null, failed: true });
			},
		);
		return () => {
			cancelled = true;
		};
	}, [enabled, loaded]);

	return state;
}
