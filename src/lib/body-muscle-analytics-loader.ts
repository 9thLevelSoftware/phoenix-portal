// The body-muscle analytics module statically pulls in the ~1.7 MB generated
// exercise -> body-muscle map. Load it on demand so only the Body heatmap and
// the analytics-tables ZIP export pay for it; every other chunk (CSV export,
// Profile, the rest of Analytics) stays small.
export type BodyMuscleAnalyticsModule =
	typeof import("@/lib/body-muscle-analytics");

let modulePromise: Promise<BodyMuscleAnalyticsModule> | null = null;

export function loadBodyMuscleAnalytics(): Promise<BodyMuscleAnalyticsModule> {
	if (!modulePromise) {
		modulePromise = import("@/lib/body-muscle-analytics").catch(
			(error: unknown) => {
				// Let the next caller retry (e.g. after reconnecting).
				modulePromise = null;
				throw error;
			},
		);
	}
	return modulePromise;
}
