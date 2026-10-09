import { queryOptions } from "@tanstack/react-query";
import type { IntegrationProvider } from "@/lib/integrations/types";
import { supabase } from "@/lib/supabase";
import { fetchAllSupabasePages } from "@/lib/supabasePaging";
import { queryKeys } from "./keys";

/**
 * Integrations list columns. `raw_data` is the provider JSON document and is
 * omitted: the activity table never renders it, and a paged `select("*")`
 * would pull that blob for every row.
 */
export const EXTERNAL_ACTIVITY_LIST_COLUMNS =
	"id, user_id, external_id, provider, name, activity_type, started_at, duration_seconds, distance_meters, calories, avg_heart_rate, max_heart_rate, elevation_gain_meters, synced_at" as const;

/**
 * Analytics overview columns. Duration, calories and activity type are the
 * heavier fields that card aggregates; the read stays bounded so it does not
 * page the full history. `raw_data` is still omitted — the chart does not
 * read the provider document.
 */
export const EXTERNAL_ACTIVITY_CHART_COLUMNS =
	"id, provider, activity_type, started_at, duration_seconds, calories" as const;

/**
 * Latest activities the analytics overview counts and sums. Same cap the
 * shared list query used to apply, so those totals stay on that window.
 */
export const EXTERNAL_ACTIVITY_CHART_LIMIT = 100;

/**
 * Fetch all integrations for a user.
 * Returns user_integrations rows with connection status.
 */
export function integrationsOptions(userId: string) {
	return queryOptions({
		queryKey: queryKeys.integrations.byUser(userId),
		queryFn: async () => {
			const { data, error } = await supabase
				.from("user_integrations")
				.select(
					"id, user_id, provider, provider_user_id, connected_at, last_sync_at, status, error_message",
				)
				.eq("user_id", userId)
				.order("connected_at", { ascending: false });
			if (error) throw error;
			return data;
		},
		enabled: !!userId,
	});
}

/**
 * Every external activity for a user, optionally filtered by provider.
 *
 * PostgREST silently caps one response at `max_rows`, so this pages until a
 * short page. `started_at` is the display order; `id` is the unique tiebreak
 * so an offset boundary cannot skip or repeat a row. `raw_data` is not
 * selected — see {@link EXTERNAL_ACTIVITY_LIST_COLUMNS}.
 */
export function externalActivitiesOptions(
	userId: string,
	provider?: IntegrationProvider,
) {
	return queryOptions({
		queryKey: provider
			? ([...queryKeys.integrations.external(userId), provider] as const)
			: queryKeys.integrations.external(userId),
		queryFn: async () => {
			return fetchAllSupabasePages((from, to) => {
				let query = supabase
					.from("external_activities")
					.select(EXTERNAL_ACTIVITY_LIST_COLUMNS)
					.eq("user_id", userId);

				if (provider) {
					query = query.eq("provider", provider);
				}

				return query
					.order("started_at", { ascending: false })
					.order("id", { ascending: true })
					.range(from, to);
			});
		},
		enabled: !!userId,
	});
}

/**
 * Bounded external-activity read for the analytics overview.
 *
 * Separate from {@link externalActivitiesOptions}: that list pages the full
 * history without `raw_data`, while this keeps the 100-row window and the
 * metric columns the overview sums. Nested under the list query key so a
 * sync invalidation refreshes both.
 */
export function externalActivitiesChartOptions(userId: string) {
	return queryOptions({
		queryKey: queryKeys.integrations.externalChart(userId),
		queryFn: async () => {
			const { data, error } = await supabase
				.from("external_activities")
				.select(EXTERNAL_ACTIVITY_CHART_COLUMNS)
				.eq("user_id", userId)
				.order("started_at", { ascending: false })
				.order("id", { ascending: true })
				.limit(EXTERNAL_ACTIVITY_CHART_LIMIT);
			if (error) throw error;
			return data ?? [];
		},
		enabled: !!userId,
	});
}

/** Latest rows shown in the sync activity list. Not the active-work count. */
export const SYNC_QUEUE_ACTIVITY_LIMIT = 10;

export type SyncQueueActiveCount = {
	pending: number;
	processingProvider: string | null;
};

/**
 * Recent activity for one user: the latest 10 `sync_queue` rows, whatever
 * their status. Pending and processing totals live in
 * `syncQueueActiveCountOptions` so a burst of finished rows cannot hide
 * older work that is still queued.
 */
export function syncQueueOptions(userId: string) {
	return queryOptions({
		queryKey: queryKeys.integrations.syncQueue(userId),
		queryFn: async () => {
			const { data, error } = await supabase
				.from("sync_queue")
				.select("*")
				.eq("user_id", userId)
				.order("created_at", { ascending: false })
				.limit(SYNC_QUEUE_ACTIVITY_LIMIT);
			if (error) throw error;
			return data ?? [];
		},
		enabled: !!userId,
	});
}

/**
 * Pending total, plus the provider of a processing row when one exists.
 * Pending is an exact head count so PostgREST's max-rows cap cannot turn a
 * long queue into a short page. The provider is a separate `limit(1)` lookup.
 */
export function syncQueueActiveCountOptions(userId: string) {
	return queryOptions({
		queryKey: queryKeys.integrations.syncQueueActive(userId),
		queryFn: async (): Promise<SyncQueueActiveCount> => {
			const [pendingResult, processingResult] = await Promise.all([
				supabase
					.from("sync_queue")
					.select("id", { count: "exact", head: true })
					.eq("user_id", userId)
					.eq("status", "pending"),
				supabase
					.from("sync_queue")
					.select("provider")
					.eq("user_id", userId)
					.eq("status", "processing")
					.order("created_at", { ascending: false })
					.limit(1),
			]);
			if (pendingResult.error) throw pendingResult.error;
			if (processingResult.error) throw processingResult.error;
			return {
				pending: pendingResult.count ?? 0,
				processingProvider: processingResult.data?.[0]?.provider ?? null,
			};
		},
		enabled: !!userId,
	});
}
