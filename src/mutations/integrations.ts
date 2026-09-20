import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { IntegrationProvider } from "@/lib/integrations/types";
import { supabase } from "@/lib/supabase";
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

/** Text shown when the provider function refuses a duplicate run (HTTP 409). */
export const SYNC_ALREADY_RUNNING_MESSAGE = "A sync is already running";

/**
 * True when a `functions.invoke` failure carries an HTTP 409 response.
 *
 * `FunctionsHttpError.context` is the raw `Response`; the other two invoke
 * errors (fetch/relay) carry no status, hence the duck-typed read. The only
 * 409 emitter in this stack is `_shared/syncQueue.ts#syncAlreadyQueuedResponse`,
 * which the provider sync functions return when `sync_queue_one_active`
 * rejects their insert.
 */
function isAlreadyRunningError(error: unknown): boolean {
	const context = (error as { context?: { status?: unknown } } | null)?.context;
	return context?.status === 409;
}

/**
 * Trigger manual sync - invokes the provider-specific Edge Function directly.
 * The Edge Function handles token refresh, API calls, and activity normalization.
 *
 * The browser never writes `sync_queue`. The provider function owns its own
 * row (PR 52: inserted directly as `processing`, because a `pending` row would
 * be claimed by the next process-sync-queue pass and dispatched a second time
 * — PR 31 review R-1), and answers a duplicate run with HTTP 409.
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

			if (isAlreadyRunningError(invokeError)) {
				throw new Error(SYNC_ALREADY_RUNNING_MESSAGE);
			}
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
	});
}

/*
 * There is deliberately no "connect integration" mutation here. Connecting is
 * never a browser table write:
 *  - OAuth providers go through `initiate-oauth` and the `<provider>-oauth`
 *    callback, which writes `user_integrations` as the service role, and
 *    queues the initial import too for Strava and Fitbit (garmin-oauth queues
 *    nothing — it is webhook-driven, so there is nothing to pull);
 *  - API-key providers (Hevy, Liftosaur) go through `<provider>-sync` with an
 *    `api_key` in the body, which stores the key in `oauth_tokens` (a
 *    server-only table) — never in the client-readable `user_integrations`.
 * The connect mutation removed here (F-10 / NF-23) had no caller and was the
 * last browser writer of either table.
 */
