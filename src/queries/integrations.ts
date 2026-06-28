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
