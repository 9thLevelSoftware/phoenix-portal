import { FunctionsFetchError, FunctionsHttpError } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Hoisted with the mock below, which is evaluated before this module's body.
const invoke = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase", () => ({
	supabase: { functions: { invoke } },
}));

import {
	DataSharingError,
	describeDeliveryError,
	describeDisabledReason,
	describeTestResult,
	invokeWebhookEndpoints,
} from "@/lib/dataSharing";
import { isTierDenied } from "@/lib/tierErrors";

function httpError(
	status: number,
	body: unknown,
	headers: Record<string, string> = {},
) {
	return new FunctionsHttpError(
		new Response(typeof body === "string" ? body : JSON.stringify(body), {
			status,
			headers,
		}),
	);
}

async function failure(): Promise<DataSharingError> {
	try {
		await invokeWebhookEndpoints({ action: "test", endpointId: "e-1" });
	} catch (error) {
		return error as DataSharingError;
	}
	throw new Error("expected invokeWebhookEndpoints to reject");
}

describe("invokeWebhookEndpoints", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("posts the action to webhook-endpoints and returns the body", async () => {
		invoke.mockResolvedValue({ data: { enqueued: 3 }, error: null });

		const result = await invokeWebhookEndpoints<{ enqueued: number }>({
			action: "resend_all",
			endpointId: "e-1",
		});

		expect(result).toEqual({ enqueued: 3 });
		expect(invoke).toHaveBeenCalledWith("webhook-endpoints", {
			body: { action: "resend_all", endpointId: "e-1" },
		});
	});

	it("turns a refusal into a DataSharingError carrying the server's code and message", async () => {
		invoke.mockResolvedValue({
			data: null,
			error: httpError(400, {
				error: "url_resolves_to_private_address",
				message: "That host resolves to a private or reserved address.",
			}),
		});

		const error = await failure();

		expect(error).toBeInstanceOf(DataSharingError);
		expect(error.code).toBe("url_resolves_to_private_address");
		expect(error.status).toBe(400);
		expect(error.message).toBe(
			"That host resolves to a private or reserved address.",
		);
	});

	it("keeps the test-delivery details of a refused resume", async () => {
		invoke.mockResolvedValue({
			data: null,
			error: httpError(409, {
				error: "test_delivery_failed",
				message:
					"The endpoint did not accept a test delivery, so it was not switched on.",
				statusCode: 503,
				errorCode: "http_error",
			}),
		});

		const error = await failure();

		expect(error.code).toBe("test_delivery_failed");
		expect(error.details.statusCode).toBe(503);
		expect(error.details.errorCode).toBe("http_error");
	});

	it("is recognised as a tier denial when the server answers 402", async () => {
		invoke.mockResolvedValue({
			data: null,
			error: httpError(402, {
				error: "subscription_required",
				message: "This feature requires FLAME.",
				requiredTier: "FLAME",
			}),
		});

		const error = await failure();

		expect(error.status).toBe(402);
		expect(isTierDenied(error)).toBe(true);
	});

	it("explains a rate limit and reads the wait from the response", async () => {
		invoke.mockResolvedValue({
			data: null,
			error: httpError(
				429,
				{ error: "rate_limit_exceeded", retryAfterSeconds: 240 },
				{ "Retry-After": "240" },
			),
		});

		const error = await failure();

		expect(error.code).toBe("rate_limit_exceeded");
		expect(error.retryAfterSeconds).toBe(240);
		expect(error.message).toMatch(/too many requests/i);
	});

	it("falls back to a generic message when the body is not JSON", async () => {
		invoke.mockResolvedValue({
			data: null,
			error: httpError(500, "<html>gateway</html>"),
		});

		const error = await failure();

		expect(error.code).toBe("unknown");
		expect(error.status).toBe(500);
		expect(error.message).not.toContain("html");
	});

	it("reports a network failure without leaking the underlying error text", async () => {
		invoke.mockResolvedValue({
			data: null,
			error: new FunctionsFetchError(new Error("ECONNRESET 10.0.0.5")),
		});

		const error = await failure();

		expect(error.code).toBe("network_error");
		expect(error.message).not.toContain("10.0.0.5");
	});

	it("reports a thrown invoke the same way", async () => {
		invoke.mockRejectedValue(new TypeError("Failed to fetch"));

		const error = await failure();

		expect(error.code).toBe("network_error");
	});
});

describe("data sharing copy", () => {
	it("explains why an endpoint is not active", () => {
		expect(describeDisabledReason(null)).toBeNull();
		expect(describeDisabledReason("subscription_lapsed")).toMatch(
			/plan no longer includes data sharing/,
		);
		expect(describeDisabledReason("too_many_failures")).toMatch(
			/repeated failed deliveries/,
		);
		expect(describeDisabledReason("endpoint_gone")).toMatch(/410 Gone/);
		// A code this build does not know still says something true.
		expect(describeDisabledReason("future_reason")).toBe(
			"This endpoint is switched off.",
		);
	});

	it("describes a delivery outcome with its status code when there is one", () => {
		expect(describeDeliveryError(null, 200)).toBeNull();
		expect(describeDeliveryError("http_error", 503)).toBe(
			"The receiver answered with an error status (503)",
		);
		expect(describeDeliveryError("connection_failed", null)).toBe(
			"Could not connect to the receiver",
		);
		expect(describeDeliveryError("future_code", null)).toBe("Delivery failed");
	});

	it("describes a test result as one sentence", () => {
		expect(
			describeTestResult({
				delivered: true,
				statusCode: 204,
				errorCode: null,
				durationMs: 80,
			}),
		).toBe("The receiver accepted the test delivery (204).");
		expect(
			describeTestResult({
				delivered: false,
				statusCode: 301,
				errorCode: "redirect_not_followed",
				durationMs: 40,
			}),
		).toBe(
			"The receiver answered with a redirect, which is not followed (301).",
		);
	});
});
