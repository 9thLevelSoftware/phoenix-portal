import { queryOptions } from "@tanstack/react-query";
import { z } from "zod";
import { supabase } from "@/lib/supabase";
import { repSummarySchema, telemetryPointSchema } from "@/schemas/telemetry";
import { queryKeys } from "./keys";

/** Per-set raw telemetry points for force/velocity curve rendering */
export function repTelemetryOptions(setId: string) {
	return queryOptions({
		queryKey: queryKeys.telemetry.bySet(setId),
		queryFn: async () => {
			const { data, error } = await supabase
				.from("rep_telemetry")
				.select("timestamp_ms, force_n, velocity_mps, position_mm, cable")
				.eq("set_id", setId)
				.order("timestamp_ms", { ascending: true });
			if (error) throw error;
			return z.array(telemetryPointSchema).parse(data);
		},
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
	});
}
