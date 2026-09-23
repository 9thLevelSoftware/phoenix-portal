import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { IntegrationProvider } from "@/lib/integrations/types";
import { supabase } from "@/lib/supabase";
import { isTierDenied, TIER_DENIED_MESSAGE } from "@/lib/tierErrors";
import { queryKeys } from "@/queries/keys";

/**
 * Providers with a `<provider>-sync` Edge Function that the portal may invoke
 * on demand. Garmin is excluded because it is webhook-driven (there is nothing
 * to pull); Strong is a local file import; Apple Health and Health Connect are
 * pushed from the mobile app.
 *
 * Must stay aligned with the sync functions that actually exist under
 * `supabase/functions/` — enforced by src/mutations/__tests__/integrations.test.ts.
 */
export const MANUAL_SYNC_PROVIDERS: IntegrationProvider[] = [
	"strava",
	"fitbit",
	"hevy",
	"liftosaur",
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
 * Trigger manual sync - invokes the provider-specific Edge Function directly.
 * The Edge Function handles token refresh, API calls, and activity normalization.
 *
 * No sync_queue row is inserted: the scheduled process-sync-queue drains
 * pending rows, so a row inserted here would be claimed by a cron pass while
 * this direct call is still running and dispatched a second time (PR 31
 * review R-1). This is the PR 52 plan for useManualSync, taken early.
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

			const { error: invokeError } = await supabase.functions.invoke(
				`${provider}-sync`,
				{
					body: {
						user_id: userId,
						sync_type: "manual",
					},
				},
			);

			if (invokeError) throw invokeError;
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
		onError: (error: Error) => {
			console.error("[useManualSync] failed:", error);
			// The sync_queue INSERT (RLS 42501) and the `<provider>-sync` Edge
			// Function (402) both refuse below FLAME; the user was told nothing
			// before this.
			if (isTierDenied(error)) {
				toast.error(TIER_DENIED_MESSAGE);
				queryClient.invalidateQueries({
					queryKey: queryKeys.subscription.all,
				});
				return;
			}
			toast.error("Sync failed. Please try again.");
		},
	});
}
