import { queryOptions } from "@tanstack/react-query";
import type { IntegrationProvider } from "@/lib/integrations/types";
import { supabase } from "@/lib/supabase";
import { queryKeys } from "./keys";

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
 * Fetch external activities for a user, optionally filtered by provider.
 * Returns external_activities rows ordered by most recent first.
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
			let query = supabase
				.from("external_activities")
				.select("*")
				.eq("user_id", userId)
				.order("started_at", { ascending: false })
				.limit(100);

			if (provider) {
				query = query.eq("provider", provider);
			}

			const { data, error } = await query;
			if (error) throw error;
			return data;
		},
		enabled: !!userId,
	});
}

/** Latest rows shown in the sync activity list. Not the active-work count. */
export const SYNC_QUEUE_ACTIVITY_LIMIT = 10;

const SYNC_QUEUE_ACTIVE_STATUSES = ["pending", "processing"] as const;

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
 * Count of rows still in `pending` or `processing`, plus the provider of a
 * processing row when one exists. Filtered by status, with no recency cap.
 */
export function syncQueueActiveCountOptions(userId: string) {
	return queryOptions({
		queryKey: queryKeys.integrations.syncQueueActive(userId),
		queryFn: async (): Promise<SyncQueueActiveCount> => {
			const { data, error } = await supabase
				.from("sync_queue")
				.select("provider, status")
				.eq("user_id", userId)
				.in("status", [...SYNC_QUEUE_ACTIVE_STATUSES])
				.order("created_at", { ascending: false });
			if (error) throw error;
			const rows = data ?? [];
			const processing = rows.find((row) => row.status === "processing");
			return {
				pending: rows.filter((row) => row.status === "pending").length,
				processingProvider: processing?.provider ?? null,
			};
		},
		enabled: !!userId,
	});
}
