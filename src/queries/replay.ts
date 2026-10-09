import { queryOptions } from "@tanstack/react-query";
import { authoritativeRepPower } from "@/lib/biomechanics";
import { supabase } from "@/lib/supabase";
import { repPowerMethodSchema } from "@/schemas/telemetry";
import { queryKeys } from "./keys";
import { fetchSetTelemetry } from "./telemetry";

/**
 * Query options for session replay data.
 * Fetches session structure with exercises and sets for navigation.
 */
export const replaySessionOptions = (userId: string, sessionId: string) =>
	queryOptions({
		queryKey: queryKeys.replay.session(userId, sessionId),
		queryFn: async () => {
			const { data, error } = await supabase
				.from("workout_sessions")
				.select(`
          id,
          started_at,
          exercises (
            id,
            exercise_name:name,
            sets (
              id,
              set_number
            )
          )
        `)
				.eq("id", sessionId)
				.single();

			if (error) throw error;
			return data;
		},
		staleTime: 5 * 60 * 1000, // 5 minutes
		enabled: !!userId && !!sessionId,
	});

/**
 * Query options for telemetry data of a specific set.
 * Fetches every telemetry point (chart columns only, keyset-paged) and the
 * rep summaries for replay visualization.
 */
export const replayTelemetryOptions = (userId: string, setId: string) =>
	queryOptions({
		queryKey: queryKeys.replay.telemetry(userId, setId),
		queryFn: async () => {
			const [telemetry, summaryRes] = await Promise.all([
				fetchSetTelemetry("telemetry_points", setId),
				supabase
					.from("rep_summaries")
					.select("*")
					.eq("set_id", setId)
					.order("rep_number"),
			]);

			if (summaryRes.error) throw summaryRes.error;

			return {
				telemetry,
				repSummaries: (summaryRes.data ?? []).map((rep) => ({
					...rep,
					power_watts: authoritativeRepPower(rep).meanWatts,
					peak_power_watts: authoritativeRepPower(rep).peakWatts,
					power_method: repPowerMethodSchema.parse(
						"power_method" in rep ? rep.power_method : undefined,
					),
				})),
			};
		},
		staleTime: 10 * 60 * 1000, // Telemetry is immutable, cache longer
		enabled: !!userId && !!setId,
	});
