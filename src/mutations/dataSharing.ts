import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
	DataSharingError,
	invokeWebhookEndpoints,
	type WebhookEndpoint,
	type WebhookEndpointsRequest,
	type WebhookTestResult,
} from "@/lib/dataSharing";
import { isTierDenied, TIER_DENIED_MESSAGE } from "@/lib/tierErrors";
import { queryKeys } from "@/queries/keys";

/**
 * Data sharing writes. Each one is a single `webhook-endpoints` action; the
 * server derives the user from the session, so nothing here sends a user id
 * for it to trust. `userId` is only used to invalidate the right cache keys.
 */

type CreateInput = Omit<
	Extract<WebhookEndpointsRequest, { action: "create" }>,
	"action"
>;
type UpdateInput = Omit<
	Extract<WebhookEndpointsRequest, { action: "update" }>,
	"action"
>;

export interface EndpointWithSecret {
	endpoint: WebhookEndpoint;
	/** Shown once. The server never returns it again. */
	signingSecret: string;
}

/** The message to show for a failed data sharing action. */
export function dataSharingErrorMessage(error: unknown): string {
	if (isTierDenied(error)) return TIER_DENIED_MESSAGE;
	if (error instanceof DataSharingError) return error.message;
	return "Data sharing could not be updated. Please try again in a moment.";
}

function useDataSharingMutation<TInput, TResult>(
	userId: string,
	mutationFn: (input: TInput) => Promise<TResult>,
) {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn,
		// Settled, not only success: a refused resume has still written a test
		// delivery to the log, and a failed edit may have applied in part.
		onSettled: () => {
			void queryClient.invalidateQueries({
				queryKey: queryKeys.dataSharing.endpoints(userId),
			});
		},
		onError: (error) => {
			toast.error(dataSharingErrorMessage(error));
			if (isTierDenied(error)) {
				// The plan changed under an open page: let the gate catch up.
				void queryClient.invalidateQueries({
					queryKey: queryKeys.subscription.all,
				});
			}
		},
	});
}

export function useCreateWebhookEndpoint(userId: string) {
	return useDataSharingMutation(userId, (input: CreateInput) =>
		invokeWebhookEndpoints<EndpointWithSecret>({ action: "create", ...input }),
	);
}

export function useUpdateWebhookEndpoint(userId: string) {
	return useDataSharingMutation(userId, (input: UpdateInput) =>
		invokeWebhookEndpoints<{ endpoint: WebhookEndpoint }>({
			action: "update",
			...input,
		}),
	);
}

export function useRotateWebhookSecret(userId: string) {
	return useDataSharingMutation(userId, (endpointId: string) =>
		invokeWebhookEndpoints<EndpointWithSecret>({
			action: "rotate_secret",
			endpointId,
		}),
	);
}

export function useTestWebhookEndpoint(userId: string) {
	return useDataSharingMutation(userId, (endpointId: string) =>
		invokeWebhookEndpoints<WebhookTestResult>({ action: "test", endpointId }),
	);
}

export function useResendWebhookData(userId: string) {
	return useDataSharingMutation(userId, (endpointId: string) =>
		invokeWebhookEndpoints<{ enqueued: number }>({
			action: "resend_all",
			endpointId,
		}),
	);
}

export function useDeleteWebhookEndpoint(userId: string) {
	return useDataSharingMutation(userId, (endpointId: string) =>
		invokeWebhookEndpoints<{ deleted: true }>({ action: "delete", endpointId }),
	);
}
