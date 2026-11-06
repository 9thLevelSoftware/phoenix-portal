import { queryOptions } from "@tanstack/react-query";
import type { WebhookEndpoint } from "@/lib/dataSharing";
import { supabase } from "@/lib/supabase";
import { queryKeys } from "@/queries/keys";

/**
 * Data sharing reads. Both tables are read directly under owner RLS (the
 * owner may SELECT their own rows and nothing else); every write goes through
 * the `webhook-endpoints` Edge Function. `webhook_endpoint_secrets` is not
 * readable by any browser role, so there is no query for it.
 */

const ENDPOINT_COLUMNS =
	"id, label, url, scopes, status, disabled_reason, custom_header_name, signing_key_hint, consecutive_failures, last_success_at, last_failure_at, created_at, updated_at";

const DELIVERY_COLUMNS =
	"id, endpoint_id, entity, entity_id, event_type, status, attempt_count, next_attempt_at, last_status_code, last_error_code, duration_ms, created_at, finished_at";

export const WEBHOOK_DELIVERY_LOG_LIMIT = 20;

export interface WebhookDelivery {
	id: string;
	endpoint_id: string;
	entity: string;
	entity_id: string;
	event_type: string | null;
	status: "pending" | "delivering" | "delivered" | "dead" | "skipped";
	attempt_count: number;
	next_attempt_at: string;
	last_status_code: number | null;
	last_error_code: string | null;
	duration_ms: number | null;
	created_at: string;
	finished_at: string | null;
}

export function webhookEndpointsOptions(userId: string) {
	return queryOptions({
		queryKey: queryKeys.dataSharing.endpoints(userId),
		queryFn: async (): Promise<WebhookEndpoint[]> => {
			const { data, error } = await supabase
				.from("webhook_endpoints")
				.select(ENDPOINT_COLUMNS)
				.eq("user_id", userId)
				.order("created_at", { ascending: true });
			if (error) throw error;
			return (data ?? []) as WebhookEndpoint[];
		},
		enabled: !!userId,
	});
}

/** The latest deliveries for one endpoint, newest first. */
export function webhookDeliveriesOptions(userId: string, endpointId: string) {
	return queryOptions({
		queryKey: queryKeys.dataSharing.deliveries(userId, endpointId),
		queryFn: async (): Promise<WebhookDelivery[]> => {
			const { data, error } = await supabase
				.from("webhook_deliveries")
				.select(DELIVERY_COLUMNS)
				.eq("user_id", userId)
				.eq("endpoint_id", endpointId)
				.order("created_at", { ascending: false })
				.limit(WEBHOOK_DELIVERY_LOG_LIMIT);
			if (error) throw error;
			return (data ?? []) as WebhookDelivery[];
		},
		enabled: !!userId && !!endpointId,
	});
}
