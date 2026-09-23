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
	// Page size must not exceed the server's max_rows (hosted default 1,000; no
	// override in supabase/config.toml), or a capped full page looks short and
	// paging stops early. See SUPABASE_PAGE_SIZE.
	const rows = await fetchAllKeysetPages<
		Record<string, unknown>,
		TelemetryCursor
	>(
		(after, limit) => {
			// `from` cannot take the union of two table names and still type
			// `.select` / `.eq` (the column set collapses to `never`). Both
			// tables carry the same chart columns, so name one and let the
			// other ride the identical chain.
			let query = supabase
				.from(source as "rep_telemetry")
				.select(TELEMETRY_CHART_COLUMNS)
				.eq("set_id", setId);
			if (after) {
				// The redundant gte gives Postgres an index range start on
				// (set_id, timestamp_ms); the OR alone would only be a filter,
				// so every page would rescan the set from its first sample.
				query = query
					.gte("timestamp_ms", after.timestamp_ms)
					.or(
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
	return parseTelemetryRows(rows, setId);
}

/**
 * Validate rows one by one and drop the invalid ones. The table and the push
 * payload allow null metrics and free-form `cable` values, so one bad sample
 * must not fail the whole set. The schema also strips the cursor-only `id`.
 */
function parseTelemetryRows(
	rows: Record<string, unknown>[],
	setId: string,
): TelemetryPointRow[] {
	const points: TelemetryPointRow[] = [];
	let dropped = 0;
	for (const row of rows) {
		const parsed = telemetryPointSchema.safeParse(row);
		if (parsed.success) {
			points.push(parsed.data);
		} else {
			dropped++;
		}
	}
	if (dropped > 0) {
		console.warn(
			`[telemetry] dropped ${dropped} of ${rows.length} invalid samples for set ${setId}`,
		);
	}
	return points;
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
