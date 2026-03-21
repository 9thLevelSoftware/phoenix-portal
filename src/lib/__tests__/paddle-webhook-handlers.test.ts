import { describe, expect, it } from "vitest";
import {
	buildSubscriptionUpsert,
	mapPaddleStatusToSubscriptionStatus,
	mapPriceIdToTier,
	mapPriceIdToTierServer,
	type PaddleWebhookEvent,
	verifyPaddleSignature,
} from "../paddle";

// ─── mapPriceIdToTier ─────────────────────────────────────────────────────────

describe("mapPriceIdToTier", () => {
	it("returns FREE for unknown price IDs (env vars not set in test)", () => {
		expect(mapPriceIdToTier("pri_unknown_123")).toBe("FREE");
	});

	it("returns FREE for empty string", () => {
		expect(mapPriceIdToTier("")).toBe("FREE");
	});
});

// ─── mapPriceIdToTierServer (whitespace handling) ────────────────────────────

describe("mapPriceIdToTierServer", () => {
	function makeEnv(vars: Record<string, string>) {
		return { get: (key: string) => vars[key] };
	}

	it("handles whitespace in comma-separated price ID env vars", () => {
		const env = makeEnv({
			PADDLE_INFERNO_PRICE_IDS: " pri_inferno_m , pri_inferno_y ",
			PADDLE_FLAME_PRICE_IDS: "pri_flame_m,  pri_flame_y",
			PADDLE_EMBER_PRICE_IDS: "pri_ember_m , pri_ember_y ",
		});

		expect(mapPriceIdToTierServer("pri_inferno_m", env)).toBe("INFERNO");
		expect(mapPriceIdToTierServer("pri_inferno_y", env)).toBe("INFERNO");
		expect(mapPriceIdToTierServer("pri_flame_m", env)).toBe("FLAME");
		expect(mapPriceIdToTierServer("pri_flame_y", env)).toBe("FLAME");
		expect(mapPriceIdToTierServer("pri_ember_m", env)).toBe("EMBER");
		expect(mapPriceIdToTierServer("pri_ember_y", env)).toBe("EMBER");
	});

	it("returns FREE for unknown price IDs", () => {
		const env = makeEnv({
			PADDLE_INFERNO_PRICE_IDS: "pri_inferno_m",
			PADDLE_FLAME_PRICE_IDS: "pri_flame_m",
			PADDLE_EMBER_PRICE_IDS: "pri_ember_m",
		});

		expect(mapPriceIdToTierServer("pri_unknown", env)).toBe("FREE");
	});

	it("handles empty env vars gracefully", () => {
		const env = makeEnv({});
		expect(mapPriceIdToTierServer("pri_anything", env)).toBe("FREE");
	});

	it("filters out whitespace-only entries from env vars", () => {
		const env = makeEnv({
			PADDLE_INFERNO_PRICE_IDS: "pri_inferno_m, , ,pri_inferno_y",
		});

		expect(mapPriceIdToTierServer("pri_inferno_m", env)).toBe("INFERNO");
		expect(mapPriceIdToTierServer("pri_inferno_y", env)).toBe("INFERNO");
		// Whitespace-only entries should not match empty string
		expect(mapPriceIdToTierServer("", env)).toBe("FREE");
	});
});

// ─── mapPaddleStatusToSubscriptionStatus ─────────────────────────────────────

describe("mapPaddleStatusToSubscriptionStatus", () => {
	it("maps active to active", () => {
		expect(mapPaddleStatusToSubscriptionStatus("active")).toBe("active");
	});

	it("maps trialing to trialing", () => {
		expect(mapPaddleStatusToSubscriptionStatus("trialing")).toBe("trialing");
	});

	it("maps canceled to canceled", () => {
		expect(mapPaddleStatusToSubscriptionStatus("canceled")).toBe("canceled");
	});

	it("maps paused to canceled", () => {
		expect(mapPaddleStatusToSubscriptionStatus("paused")).toBe("canceled");
	});

	it("maps past_due to past_due", () => {
		expect(mapPaddleStatusToSubscriptionStatus("past_due")).toBe("past_due");
	});

	it("maps unknown status to none", () => {
		expect(mapPaddleStatusToSubscriptionStatus("something_else")).toBe("none");
	});
});

// ─── buildSubscriptionUpsert ────────────────────────────────────────────────

function makeMockEvent(
	overrides: Partial<PaddleWebhookEvent> = {},
): PaddleWebhookEvent {
	return {
		event_id: "evt_01abc",
		event_type: "subscription.updated",
		occurred_at: "2026-03-15T00:00:00Z",
		data: {
			id: "sub_01xyz",
			customer_id: "ctm_01abc",
			status: "active",
			items: [
				{
					price: { id: "pri_ember_monthly" },
					quantity: 1,
				},
			],
			custom_data: { user_id: "usr-supabase-uuid" },
			current_billing_period: {
				starts_at: "2026-03-01T00:00:00Z",
				ends_at: "2026-04-01T00:00:00Z",
			},
			scheduled_change: null,
		},
		...overrides,
	};
}

describe("buildSubscriptionUpsert", () => {
	it("extracts correct fields from a Paddle event", () => {
		const event = makeMockEvent();
		// Use a stub resolver so we don't depend on env vars
		const result = buildSubscriptionUpsert(event, () => "EMBER");

		expect(result).not.toBeNull();
		expect(result?.user_id).toBe("usr-supabase-uuid");
		expect(result?.paddle_customer_id).toBe("ctm_01abc");
		expect(result?.paddle_subscription_id).toBe("sub_01xyz");
		expect(result?.tier).toBe("EMBER");
		expect(result?.status).toBe("active");
		expect(result?.price_id).toBe("pri_ember_monthly");
		expect(result?.last_event_id).toBe("evt_01abc");
	});

	it("extracts billing period dates", () => {
		const event = makeMockEvent();
		const result = buildSubscriptionUpsert(event, () => "EMBER");

		expect(result?.current_period_start).toBe("2026-03-01T00:00:00Z");
		expect(result?.current_period_end).toBe("2026-04-01T00:00:00Z");
	});

	it("sets cancel_at_period_end to true for subscription.canceled", () => {
		const event = makeMockEvent({
			event_type: "subscription.canceled",
		});
		const result = buildSubscriptionUpsert(event, () => "EMBER");

		expect(result?.cancel_at_period_end).toBe(true);
	});

	it("sets cancel_at_period_end to true when scheduled_change action is cancel", () => {
		const event = makeMockEvent();
		event.data.scheduled_change = {
			action: "cancel",
			effective_at: "2026-04-01T00:00:00Z",
		};
		const result = buildSubscriptionUpsert(event, () => "EMBER");

		expect(result?.cancel_at_period_end).toBe(true);
	});

	it("sets cancel_at_period_end to false for active subscription without scheduled change", () => {
		const event = makeMockEvent();
		const result = buildSubscriptionUpsert(event, () => "EMBER");

		expect(result?.cancel_at_period_end).toBe(false);
	});

	it("returns null when custom_data.user_id is missing", () => {
		const event = makeMockEvent();
		event.data.custom_data = undefined;
		const result = buildSubscriptionUpsert(event, () => "EMBER");

		expect(result).toBeNull();
	});

	it("returns null when custom_data exists but user_id is missing", () => {
		const event = makeMockEvent();
		event.data.custom_data = {};
		const result = buildSubscriptionUpsert(event, () => "EMBER");

		expect(result).toBeNull();
	});

	it("uses Paddle column names for customer and subscription IDs", () => {
		const event = makeMockEvent();
		const result = buildSubscriptionUpsert(event, () => "EMBER");

		expect(result).toHaveProperty("paddle_customer_id");
		expect(result).toHaveProperty("paddle_subscription_id");
	});
});

// ─── verifyPaddleSignature ──────────────────────────────────────────────────

describe("verifyPaddleSignature", () => {
	const secret = "pdl_ntf_test_secret_01abc";

	async function computeHmac(payload: string, key: string): Promise<string> {
		const encoder = new TextEncoder();
		const cryptoKey = await crypto.subtle.importKey(
			"raw",
			encoder.encode(key),
			{ name: "HMAC", hash: "SHA-256" },
			false,
			["sign"],
		);
		const sig = await crypto.subtle.sign(
			"HMAC",
			cryptoKey,
			encoder.encode(payload),
		);
		return Array.from(new Uint8Array(sig))
			.map((b) => b.toString(16).padStart(2, "0"))
			.join("");
	}

	it("returns true for a valid signature", async () => {
		const body = '{"event_type":"subscription.created"}';
		const ts = "1710460800";
		const hmac = await computeHmac(`${ts}:${body}`, secret);
		const header = `ts=${ts};h1=${hmac}`;

		const result = await verifyPaddleSignature(body, header, secret);
		expect(result).toBe(true);
	});

	it("returns false for an invalid signature", async () => {
		const body = '{"event_type":"subscription.created"}';
		const header =
			"ts=1710460800;h1=deadbeef0000000000000000000000000000000000000000000000000000dead";

		const result = await verifyPaddleSignature(body, header, secret);
		expect(result).toBe(false);
	});

	it("returns false when ts= is missing from header", async () => {
		const result = await verifyPaddleSignature("body", "h1=abc123", secret);
		expect(result).toBe(false);
	});

	it("returns false when h1= is missing from header", async () => {
		const result = await verifyPaddleSignature("body", "ts=1710460800", secret);
		expect(result).toBe(false);
	});

	it("returns false when header is empty", async () => {
		const result = await verifyPaddleSignature("body", "", secret);
		expect(result).toBe(false);
	});

	it("returns false when body differs from signed body", async () => {
		const originalBody = '{"event_type":"subscription.created"}';
		const tamperedBody = '{"event_type":"subscription.canceled"}';
		const ts = "1710460800";
		const hmac = await computeHmac(`${ts}:${originalBody}`, secret);
		const header = `ts=${ts};h1=${hmac}`;

		const result = await verifyPaddleSignature(tamperedBody, header, secret);
		expect(result).toBe(false);
	});
});
