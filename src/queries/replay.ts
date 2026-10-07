import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { queryKeys } from "./keys";
import { fetchSetTelemetry } from "./telemetry";

/**
 * Query options for session replay data.
 * Fetches session structure with exercises and sets for navigation.
 * Exercise and set order matches `loadSessionEmbed`: exercises by
 * `order_index`, nested sets by `set_number`.
 */
export const replaySessionOptions = (sessionId: string) =>
	queryOptions({
		queryKey: queryKeys.replay.session(sessionId),
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
				.order("order_index", {
					ascending: true,
					referencedTable: "exercises",
				})
				.order("set_number", {
					ascending: true,
					referencedTable: "exercises.sets",
				})
				.single();

			if (error) throw error;
			return data;
		},
		staleTime: 5 * 60 * 1000, // 5 minutes
		enabled: !!sessionId,
	});

/**
 * Query options for telemetry data of a specific set.
 * Fetches every telemetry point (chart columns only, keyset-paged) and the
 * rep summaries for replay visualization.
 */
export const replayTelemetryOptions = (setId: string) =>
	queryOptions({
		queryKey: queryKeys.replay.telemetry(setId),
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
				repSummaries: summaryRes.data,
			};
		},
		staleTime: 10 * 60 * 1000, // Telemetry is immutable, cache longer
		enabled: !!setId,
	});
