import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { IntegrationProvider } from "@/lib/integrations/types";
import { supabase } from "@/lib/supabase";
import { queryKeys } from "@/queries/keys";

/**
 * Disconnect an integration - updates status in database and clears tokens.
 * Works for all provider types (OAuth and API key).
 */
export function useDisconnectIntegration() {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async ({
			userId,
			provider,
		}: {
			userId: string;
			provider: IntegrationProvider;
		}) => {
			const { error } = await supabase
				.from("user_integrations")
				.update({
					status: "disconnected",
					access_token: null,
					refresh_token: null,
				})
				.eq("user_id", userId)
				.eq("provider", provider);

			if (error) throw error;
		},
		onSuccess: (_, { userId }) => {
			queryClient.invalidateQueries({
				queryKey: queryKeys.integrations.byUser(userId),
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
			// Insert into sync_queue with manual sync_type
			const { error: queueError } = await supabase.from("sync_queue").insert({
				user_id: userId,
				provider,
				sync_type: "manual",
				status: "pending",
			});

			if (queueError) throw queueError;

			// Trigger the provider-specific sync Edge Function
			const { error: invokeError } = await supabase.functions.invoke(
				`${provider}-sync`,
				{
					body: { user_id: userId, sync_type: "manual" },
				},
			);

			if (invokeError) throw invokeError;
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
			apiKey,
		}: {
			userId: string;
			provider: IntegrationProvider;
			apiKey?: string;
		}) => {
			const { error } = await supabase.from("user_integrations").upsert(
				{
					user_id: userId,
					provider,
					api_key: apiKey,
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
