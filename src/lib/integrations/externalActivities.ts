import { supabase } from "@/lib/supabase";
import type { IntegrationProvider, NormalizedActivity } from "./types";

/**
 * Same chunk size as the Hevy and Strava sync upserts. A CSV history can be
 * thousands of workouts; those handlers already refuse one unbounded payload.
 */
const UPSERT_CHUNK_SIZE = 100;

/**
 * Upsert workout-level activities into `external_activities`.
 *
 * Shared by the Hevy and Strong CSV import paths. Writes in chunks of 100.
 * The first failed chunk throws; rows from earlier chunks are already stored,
 * and a retry is idempotent on (user_id, provider, external_id).
 *
 * Set loads are not part of this write.
 */
export async function upsertExternalActivities(
	userId: string,
	provider: IntegrationProvider,
	activities: readonly NormalizedActivity[],
): Promise<number> {
	if (activities.length === 0) return 0;

	const rows = activities.map((activity) => ({
		user_id: userId,
		external_id: activity.external_id,
		provider,
		name: activity.name,
		activity_type: activity.activity_type,
		started_at: activity.started_at,
		duration_seconds: activity.duration_seconds,
		distance_meters: activity.distance_meters,
		calories: activity.calories,
		avg_heart_rate: activity.avg_heart_rate,
		max_heart_rate: activity.max_heart_rate,
		elevation_gain_meters: activity.elevation_gain_meters,
	}));

	for (let index = 0; index < rows.length; index += UPSERT_CHUNK_SIZE) {
		const chunk = rows.slice(index, index + UPSERT_CHUNK_SIZE);
		const { error } = await supabase
			.from("external_activities")
			.upsert(chunk, { onConflict: "user_id,provider,external_id" });
		if (error) throw error;
	}

	return activities.length;
}
