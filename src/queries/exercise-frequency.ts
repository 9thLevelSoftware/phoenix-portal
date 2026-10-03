import { queryOptions } from "@tanstack/react-query";
import { z } from "zod";
import { supabase } from "@/lib/supabase";
import { queryKeys } from "./keys";

/**
 * `exercise_frequency` returns one jsonb array (20260920004000). The generator
 * types a jsonb scalar as `Json`, so validate the shape at runtime instead of
 * trusting the FunctionOverrides cast in src/lib/database.ts.
 *
 * Counted in SQL (already ordered by sessions DESC, name ASC). The previous
 * two-step "every session id, then .in(session_id, ids)" read put every UUID
 * in the GET URL and failed at ~200 sessions (F-035), and the exercise rows
 * it fetched were capped at 1,000. An exercise repeated within one session
 * counts once.
 *
 * Profile (top 5) and analytics (muscle distribution) both subscribe to this
 * query. Each screen projects the cached rows with `select`, so opening the
 * other does not issue a second RPC while the entry is fresh.
 */
export const exerciseFrequencySchema = z.array(
	z.object({
		exercise_name: z.string().nullable(),
		muscle_group: z.string().nullable(),
		sessions: z.number().int().nonnegative(),
	}),
);

export type ExerciseFrequency = z.infer<typeof exerciseFrequencySchema>;

export function exerciseFrequencyOptions(
	userId: string,
	profileId?: string | null,
) {
	return queryOptions({
		queryKey: queryKeys.analytics.exerciseFrequency(userId, profileId),
		queryFn: async (): Promise<ExerciseFrequency> => {
			const { data, error } = await supabase.rpc(
				"exercise_frequency",
				profileId ? { p_profile_id: profileId } : {},
			);
			if (error) throw error;
			return exerciseFrequencySchema.parse(data ?? []);
		},
	});
}
