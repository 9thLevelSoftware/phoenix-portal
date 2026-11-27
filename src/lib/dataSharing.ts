/**
 * Data sharing (outbound webhooks): the browser's side of the
 * `webhook-endpoints` Edge Function.
 *
 * Every write goes through that function. The browser cannot write the
 * tables, never sees a stored secret, and never calls the user's endpoint
 * itself (the SPA's CSP `connect-src` forbids it, and a test delivery has to
 * come from where real deliveries come from).
 */
import { FunctionsHttpError } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import type { DataSharingScope } from "../../supabase/functions/_shared/dataSharingScopes.ts";

export {
	DATA_SHARING_SCOPE_INFO,
	DATA_SHARING_SCOPES,
	type DataSharingScope,
	isDataSharingScope,
	MAX_WEBHOOK_ENDPOINTS,
} from "../../supabase/functions/_shared/dataSharingScopes.ts";

export type WebhookEndpointStatus = "active" | "paused" | "disabled";

/** An endpoint as the server returns it. There is no secret in it, ever. */
export interface WebhookEndpoint {
	id: string;
	label: string;
	url: string;
	scopes: string[];
	status: WebhookEndpointStatus;
	disabled_reason: string | null;
	custom_header_name: string | null;
	signing_key_hint: string;
	consecutive_failures: number;
	last_success_at: string | null;
	last_failure_at: string | null;
	created_at: string;
	updated_at: string;
}

export interface WebhookTestResult {
	delivered: boolean;
	statusCode: number | null;
	errorCode: string | null;
	durationMs: number | null;
}

export interface WebhookCustomHeaderInput {
	name: string;
	value: string;
}

export type WebhookEndpointsRequest =
	| {
			action: "create";
			label: string;
			url: string;
			scopes: DataSharingScope[];
			customHeader?: WebhookCustomHeaderInput;
	  }
	| {
			action: "update";
			endpointId: string;
			label?: string;
			url?: string;
			scopes?: DataSharingScope[];
			/** `null` clears the header; omitted leaves it as it is. */
			customHeader?: WebhookCustomHeaderInput | null;
			status?: "active" | "paused";
	  }
	| { action: "rotate_secret"; endpointId: string }
	| { action: "test"; endpointId: string }
	| { action: "resend_all"; endpointId: string }
	| { action: "delete"; endpointId: string };

/**
 * A refusal from `webhook-endpoints`. `code` is the server's fixed code
 * (`url_not_https`, `endpoint_limit`, `test_delivery_failed`, ...) and
 * `message` is its user-facing sentence. `status` 402 is a tier denial, so
 * `isTierDenied` recognises this error too.
 */
export class DataSharingError extends Error {
	readonly code: string;
	readonly status: number;
	readonly retryAfterSeconds: number | null;
	readonly details: Record<string, unknown>;

	constructor(
		message: string,
		options: {
			code: string;
			status: number;
			retryAfterSeconds?: number | null;
			details?: Record<string, unknown>;
		},
	) {
		super(message);
		this.name = "DataSharingError";
		this.code = options.code;
		this.status = options.status;
		this.retryAfterSeconds = options.retryAfterSeconds ?? null;
		this.details = options.details ?? {};
	}
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

const GENERIC_FAILURE =
	"Data sharing could not be updated. Please try again in a moment.";

async function toDataSharingError(error: unknown): Promise<DataSharingError> {
	if (error instanceof FunctionsHttpError) {
		const response = error.context as Response;
		let body: unknown = null;
		try {
			body = await response.clone().json();
		} catch {
			// Not JSON: fall through to the status-only message.
		}
		const details = isPlainObject(body) ? body : {};
		const code = typeof details.error === "string" ? details.error : "unknown";
		const retryHeader = Number(response.headers.get("Retry-After"));
		const retryAfterSeconds =
			typeof details.retryAfterSeconds === "number"
				? details.retryAfterSeconds
				: Number.isFinite(retryHeader) && retryHeader > 0
					? retryHeader
					: null;
		let message =
			typeof details.message === "string" ? details.message : GENERIC_FAILURE;
		if (response.status === 429) {
			message =
				"Too many requests. Wait a few minutes before trying that again.";
		}
		return new DataSharingError(message, {
			// requireSubscription's 402 body uses `subscription_required`.
			code,
			status: response.status,
			retryAfterSeconds,
			details,
		});
	}
	// FunctionsFetchError / FunctionsRelayError: network or gateway.
	return new DataSharingError(
		"Could not reach the server. Check your connection and try again.",
		{ code: "network_error", status: 0 },
	);
}

/** Calls `webhook-endpoints` and returns its JSON body, or throws DataSharingError. */
export async function invokeWebhookEndpoints<T>(
	request: WebhookEndpointsRequest,
): Promise<T> {
	let result: { data: unknown; error: unknown };
	try {
		result = await supabase.functions.invoke("webhook-endpoints", {
			body: request,
		});
	} catch (error) {
		throw await toDataSharingError(error);
	}
	if (result.error) throw await toDataSharingError(result.error);
	return result.data as T;
}

const DISABLED_REASON_TEXT: Record<string, string> = {
	user_paused: "You paused this endpoint.",
	subscription_lapsed:
		"Paused because your plan no longer includes data sharing. Nothing is sent while it is paused.",
	too_many_failures:
		"Switched off after repeated failed deliveries. Fix the receiver, then switch it back on.",
	endpoint_gone:
		"Switched off because the receiver answered 410 Gone. Check the URL, then switch it back on.",
};

/** Why an endpoint is not active, in words. */
export function describeDisabledReason(reason: string | null): string | null {
	if (!reason) return null;
	return DISABLED_REASON_TEXT[reason] ?? "This endpoint is switched off.";
}

const DELIVERY_ERROR_TEXT: Record<string, string> = {
	http_error: "The receiver answered with an error status",
	redirect_not_followed:
		"The receiver answered with a redirect, which is not followed",
	timeout: "The receiver did not answer within 10 seconds",
	connection_failed: "Could not connect to the receiver",
	dns_failed: "The host name could not be resolved",
	target_not_allowed: "The URL is no longer an allowed target",
	payload_too_large: "The data was too large to send",
	subscription_lapsed: "Not sent: your plan no longer includes data sharing",
	superseded: "Replaced by a newer delivery for the same item",
	scope_removed: "Not sent: this kind of data is no longer selected",
	endpoint_inactive: "Not sent: the endpoint was switched off",
	not_shareable: "Not sent: this item is not shared",
	unknown_entity: "Not sent: this item is not shared",
	internal_error: "A problem on our side; it will be retried",
};

/** One line for a delivery's outcome, e.g. "The receiver answered with an error status (503)". */
export function describeDeliveryError(
	errorCode: string | null,
	statusCode: number | null,
): string | null {
	if (!errorCode) return null;
	const text = DELIVERY_ERROR_TEXT[errorCode] ?? "Delivery failed";
	return statusCode ? `${text} (${statusCode})` : text;
}

/** The result of a test delivery, as one sentence. */
export function describeTestResult(result: WebhookTestResult): string {
	if (result.delivered) {
		return `The receiver accepted the test delivery (${result.statusCode}).`;
	}
	return `${describeDeliveryError(result.errorCode, result.statusCode) ?? "The test delivery failed"}.`;
}
