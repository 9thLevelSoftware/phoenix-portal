import { queryOptions } from "@tanstack/react-query";
import { z } from "zod";
import { supabase } from "@/lib/supabase";
import { fetchAllKeysetPages } from "@/lib/supabasePaging";
import {
	repSummarySchema,
	type TelemetryPointRow,
	telemetryPointSchema,
} from "@/schemas/telemetry";
import { queryKeys } from "./keys";

const TELEMETRY_CHART_COLUMNS =
	"id, timestamp_ms, force_n, velocity_mps, position_mm, cable";

type TelemetryCursor = { timestamp_ms: number; id: string };

/**
 * Read every telemetry sample of a set, ordered by (timestamp_ms, id).
 *
 * A set holds one row per sample per cable (~100 rows/s), so a single
 * unpaged select is silently cut at PostgREST's max_rows (~10 s of data).
 * Keyset paging on the unique (timestamp_ms, id) key reads the whole set;
 * `id` breaks the timestamp ties between cables.
 */
export async function fetchSetTelemetry(
	source: "rep_telemetry" | "telemetry_points",
	setId: string,
): Promise<TelemetryPointRow[]> {
	const rows = await fetchAllKeysetPages<
		Record<string, unknown>,
		TelemetryCursor
	>(
		(after, limit) => {
			let query = supabase
				.from(source)
				.select(TELEMETRY_CHART_COLUMNS)
				.eq("set_id", setId);
			if (after) {
				query = query.or(
					`timestamp_ms.gt.${after.timestamp_ms},and(timestamp_ms.eq.${after.timestamp_ms},id.gt.${after.id})`,
				);
			}
			return query
				.order("timestamp_ms", { ascending: true })
				.order("id", { ascending: true })
				.limit(limit);
		},
		(row) => ({
			timestamp_ms: row.timestamp_ms as number,
			id: row.id as string,
		}),
	);
	// The schema strips the cursor-only `id` column.
	return z.array(telemetryPointSchema).parse(rows);
}

/** Per-set raw telemetry points for force/velocity curve rendering */
export function repTelemetryOptions(setId: string) {
	return queryOptions({
		queryKey: queryKeys.telemetry.bySet(setId),
		queryFn: () => fetchSetTelemetry("rep_telemetry", setId),
		enabled: !!setId,
	});
}

/** Per-set rep summaries with VBT zones and biomechanics metrics */
export function repSummariesOptions(setId: string) {
	return queryOptions({
		queryKey: queryKeys.telemetry.repSummaries(setId),
		queryFn: async () => {
			const { data, error } = await supabase
				.from("rep_summaries")
				.select("*")
				.eq("set_id", setId)
				.order("rep_number", { ascending: true });
			if (error) throw error;
			return z.array(repSummarySchema).parse(data);
		},
		enabled: !!setId,
	});
}
