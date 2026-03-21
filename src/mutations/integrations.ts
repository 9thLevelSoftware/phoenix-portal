import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { IntegrationProvider } from "@/lib/integrations/types";
import { supabase } from "@/lib/supabase";
import { queryKeys } from "@/queries/keys";

const MANUAL_SYNC_PROVIDERS: IntegrationProvider[] = [
	"strava",
	"fitbit",
	"hevy",
];

/**
 * Disconnect an integration server-side so oauth_tokens are cleared alongside
 * the browser-readable integration state.
 */
export function useDisconnectIntegration() {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async ({
			provider,
		}: {
			userId: string;
			provider: IntegrationProvider;
		}) => {
			const { error } = await supabase.functions.invoke(
				"disconnect-integration",
				{
					body: { provider },
				},
			);

			if (error) throw error;
		},
		onSuccess: (_, { userId }) => {
			queryClient.invalidateQueries({
				queryKey: queryKeys.integrations.byUser(userId),
			});
			queryClient.invalidateQueries({
				queryKey: queryKeys.integrations.external(userId),
			});
			queryClient.invalidateQueries({
				queryKey: queryKeys.integrations.syncQueue(userId),
			});
		},
	});
}

/**
 * Trigger manual sync - inserts into sync_queue and invokes provider-specific Edge Function.
 * The Edge Function handles token refresh, API calls, and activity normalization.
 */
export function useManualSync() {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async ({
			userId,
			provider,
		}: {
			userId: string;
			provider: IntegrationProvider;
		}) => {
			if (!MANUAL_SYNC_PROVIDERS.includes(provider)) {
				throw new Error(
					`${provider} sync is not available from the portal. This integration updates automatically.`,
				);
			}

			// Insert into sync_queue with manual sync_type
			const { data: queuedSync, error: queueError } = await supabase
				.from("sync_queue")
				.insert({
					user_id: userId,
					provider,
					sync_type: "manual",
					status: "pending",
				})
				.select("id")
				.single();

			if (queueError) throw queueError;

			// Trigger the provider-specific sync Edge Function
			const { error: invokeError } = await supabase.functions.invoke(
				`${provider}-sync`,
				{
					body: { user_id: userId, sync_type: "manual" },
				},
			);

			if (invokeError) {
				await supabase
					.from("sync_queue")
					.update({
						status: "failed",
						error_message: invokeError.message,
						completed_at: new Date().toISOString(),
					})
					.eq("id", queuedSync.id);
				throw invokeError;
			}
		},
		onSettled: async (_, __, { userId }) => {
			await queryClient.invalidateQueries({
				queryKey: queryKeys.integrations.syncQueue(userId),
			});
		},
		onSuccess: (_, { userId }) => {
			queryClient.invalidateQueries({
				queryKey: queryKeys.integrations.byUser(userId),
			});
			queryClient.invalidateQueries({
				queryKey: queryKeys.integrations.external(userId),
			});
		},
	});
}

/**
 * Connect integration - for non-OAuth providers (e.g., Hevy API key).
 * OAuth providers (Strava, Fitbit, Garmin) use redirect flow via initiateXxxConnect()
 * functions, not this mutation.
 */
export function useConnectIntegration() {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async ({
			userId,
			provider,
		}: {
			userId: string;
			provider: IntegrationProvider;
		}) => {
			// API keys must only flow through provider sync Edge Functions
			// which store them in oauth_tokens (server-only table).
			// Never write api_key to user_integrations (client-readable via RLS).
			const { error } = await supabase.from("user_integrations").upsert(
				{
					user_id: userId,
					provider,
					status: "connected",
					connected_at: new Date().toISOString(),
				},
				{
					onConflict: "user_id,provider",
				},
			);

			if (error) throw error;

			// Queue initial sync after connecting
			await supabase.from("sync_queue").insert({
				user_id: userId,
				provider,
				sync_type: "initial",
				status: "pending",
			});
		},
		onSuccess: (_, { userId }) => {
			queryClient.invalidateQueries({
				queryKey: queryKeys.integrations.byUser(userId),
			});
		},
	});
}
