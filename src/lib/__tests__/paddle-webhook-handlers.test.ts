import { describe, expect, it } from "vitest";
import { hmacSha256Hex } from "../../../supabase/functions/_shared/hmac.ts";
import { mapPriceIdToTier } from "../../../supabase/functions/_shared/paddlePriceIds.ts";
import {
	buildSubscriptionUpsertFromPaddleState,
	mapPaddleStatusToSubscriptionStatus,
	type PaddleSubscriptionState,
} from "../../../supabase/functions/_shared/paddleSubscriptionState.ts";
import {
	PADDLE_SIGNATURE_TOLERANCE_SECONDS,
	verifyPaddleSignature,
} from "../../../supabase/functions/_shared/paddleWebhookSecurity.ts";
import { paddleWebhookResponseForCustomUserId } from "../../../supabase/functions/_shared/paddleWebhookUserId.ts";

// These tests exercise the production Edge modules in supabase/functions/_shared.
// The handler itself is covered by supabase/functions/paddle-webhooks/index.test.ts.

// ─── mapPriceIdToTier ───────────────────────────────────────────────────────

describe("mapPriceIdToTier", () => {
	function makeEnv(vars: Record<string, string>) {
		return { get: (key: string) => vars[key] };
	}

	it("returns FREE for unknown price IDs when no env vars are set", () => {
		expect(mapPriceIdToTier("pri_unknown_123", makeEnv({}))).toBe("FREE");
	});

	it("returns FREE for empty string", () => {
		expect(mapPriceIdToTier("", makeEnv({}))).toBe("FREE");
	});

	it("handles whitespace in comma-separated price ID env vars", () => {
		const env = makeEnv({
			PADDLE_INFERNO_PRICE_IDS: " pri_inferno_m , pri_inferno_y ",
			PADDLE_FLAME_PRICE_IDS: "pri_flame_m,  pri_flame_y",
			PADDLE_EMBER_PRICE_IDS: "pri_ember_m , pri_ember_y ",
		});

		expect(mapPriceIdToTier("pri_inferno_m", env)).toBe("INFERNO");
		expect(mapPriceIdToTier("pri_inferno_y", env)).toBe("INFERNO");
		expect(mapPriceIdToTier("pri_flame_m", env)).toBe("FLAME");
		expect(mapPriceIdToTier("pri_flame_y", env)).toBe("FLAME");
		expect(mapPriceIdToTier("pri_ember_m", env)).toBe("EMBER");
		expect(mapPriceIdToTier("pri_ember_y", env)).toBe("EMBER");
	});

	it("returns FREE for unknown price IDs", () => {
		const env = makeEnv({
			PADDLE_INFERNO_PRICE_IDS: "pri_inferno_m",
			PADDLE_FLAME_PRICE_IDS: "pri_flame_m",
			PADDLE_EMBER_PRICE_IDS: "pri_ember_m",
		});

		expect(mapPriceIdToTier("pri_unknown", env)).toBe("FREE");
	});

	it("filters out whitespace-only entries from env vars", () => {
		const env = makeEnv({
			PADDLE_INFERNO_PRICE_IDS: "pri_inferno_m, , ,pri_inferno_y",
			PADDLE_FLAME_PRICE_IDS: "x",
			PADDLE_EMBER_PRICE_IDS: "y",
		});

		expect(mapPriceIdToTier("pri_inferno_m", env)).toBe("INFERNO");
		expect(mapPriceIdToTier("pri_inferno_y", env)).toBe("INFERNO");
		expect(mapPriceIdToTier("", env)).toBe("FREE");
	});
});

// ─── mapPaddleStatusToSubscriptionStatus ─────────────────────────────────────

describe("mapPaddleStatusToSubscriptionStatus", () => {
	it.each([
		["active", "active"],
		["trialing", "trialing"],
		["canceled", "canceled"],
		["paused", "canceled"],
		["past_due", "past_due"],
		["something_else", "none"],
	])("maps %s to %s", (paddleStatus, expected) => {
		expect(mapPaddleStatusToSubscriptionStatus(paddleStatus)).toBe(expected);
	});
});

// ─── buildSubscriptionUpsertFromPaddleState ─────────────────────────────────

function makeSubscription(
	overrides: Partial<PaddleSubscriptionState> = {},
): PaddleSubscriptionState {
	return {
		id: "sub_01xyz",
		customer_id: "ctm_01abc",
		status: "active",
		items: [{ price: { id: "pri_ember_monthly" }, quantity: 1 }],
		current_billing_period: {
			starts_at: "2026-03-01T00:00:00Z",
			ends_at: "2026-04-01T00:00:00Z",
		},
		scheduled_change: null,
		...overrides,
	};
}

function buildUpsert(subscription: PaddleSubscriptionState) {
	return buildSubscriptionUpsertFromPaddleState({
		userId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
		subscription,
		tier: "EMBER",
		eventId: "evt_01abc",
		occurredAt: "2026-03-15T00:00:00Z",
	});
}

describe("buildSubscriptionUpsertFromPaddleState", () => {
	it("extracts correct fields from a Paddle subscription", () => {
		const result = buildUpsert(makeSubscription());

		expect(result.user_id).toBe("aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee");
		expect(result.paddle_customer_id).toBe("ctm_01abc");
		expect(result.paddle_subscription_id).toBe("sub_01xyz");
		expect(result.tier).toBe("EMBER");
		expect(result.status).toBe("active");
		expect(result.price_id).toBe("pri_ember_monthly");
		expect(result.last_event_id).toBe("evt_01abc");
		expect(result.last_event_occurred_at).toBe("2026-03-15T00:00:00Z");
	});

	it("extracts billing period dates", () => {
		const result = buildUpsert(makeSubscription());

		expect(result.current_period_start).toBe("2026-03-01T00:00:00Z");
		expect(result.current_period_end).toBe("2026-04-01T00:00:00Z");
	});

	it("clears pending-cancel state and period dates for a canceled subscription", () => {
		const result = buildUpsert(
			makeSubscription({
				status: "canceled",
				scheduled_change: {
					action: "cancel",
					effective_at: "2026-04-01T00:00:00Z",
				},
			}),
		);

		expect(result.status).toBe("canceled");
		expect(result.current_period_start).toBeNull();
		expect(result.current_period_end).toBeNull();
		expect(result.cancel_at_period_end).toBe(false);
	});

	it("sets cancel_at_period_end when an active subscription has a scheduled cancel", () => {
		const result = buildUpsert(
			makeSubscription({
				scheduled_change: {
					action: "cancel",
					effective_at: "2026-04-01T00:00:00Z",
				},
			}),
		);

		expect(result.cancel_at_period_end).toBe(true);
	});

	it("leaves cancel_at_period_end false without a scheduled change", () => {
		expect(buildUpsert(makeSubscription()).cancel_at_period_end).toBe(false);
	});
});

// ─── verifyPaddleSignature ──────────────────────────────────────────────────

describe("verifyPaddleSignature", () => {
	const secret = "pdl_ntf_test_secret_01abc";
	const body = '{"event_type":"subscription.created"}';
	const nowSeconds = 1_710_460_800;
	const now = () => nowSeconds * 1000;

	async function header(
		ts: number | string,
		signedBody = body,
		key = secret,
	): Promise<string> {
		return `ts=${ts};h1=${await hmacSha256Hex(key, `${ts}:${signedBody}`)}`;
	}

	it("accepts a valid signature", async () => {
		expect(
			await verifyPaddleSignature(body, await header(nowSeconds), secret, {
				now,
			}),
		).toBe(true);
	});

	it("rejects a signature made with another secret", async () => {
		const signed = await header(nowSeconds, body, "another_secret");
		expect(await verifyPaddleSignature(body, signed, secret, { now })).toBe(
			false,
		);
	});

	it("rejects a body that differs from the signed body", async () => {
		const signed = await header(nowSeconds);
		const tampered = '{"event_type":"subscription.canceled"}';
		expect(await verifyPaddleSignature(tampered, signed, secret, { now })).toBe(
			false,
		);
	});

	it("rejects a timestamp older than the tolerance", async () => {
		const ts = nowSeconds - PADDLE_SIGNATURE_TOLERANCE_SECONDS - 1;
		expect(
			await verifyPaddleSignature(body, await header(ts), secret, { now }),
		).toBe(false);
	});

	it("rejects a timestamp further in the future than the tolerance", async () => {
		const ts = nowSeconds + PADDLE_SIGNATURE_TOLERANCE_SECONDS + 1;
		expect(
			await verifyPaddleSignature(body, await header(ts), secret, { now }),
		).toBe(false);
	});

	it("accepts timestamps exactly at the tolerance boundary", async () => {
		for (const ts of [
			nowSeconds - PADDLE_SIGNATURE_TOLERANCE_SECONDS,
			nowSeconds + PADDLE_SIGNATURE_TOLERANCE_SECONDS,
		]) {
			expect(
				await verifyPaddleSignature(body, await header(ts), secret, { now }),
			).toBe(true);
		}
	});

	it("uses the real clock when none is injected", async () => {
		const stale = await header(nowSeconds);
		expect(await verifyPaddleSignature(body, stale, secret)).toBe(false);
		const fresh = await header(Math.floor(Date.now() / 1000));
		expect(await verifyPaddleSignature(body, fresh, secret)).toBe(true);
	});

	it.each([
		"abc",
		"1710460800abc",
		"-1710460800",
		"1710460800.5",
		"",
		// In-window values that Number() accepts: only the digits check rejects them.
		`${nowSeconds}.0`,
		`+${nowSeconds}`,
		`${nowSeconds}e0`,
	])("rejects a non-numeric ts %j even when correctly signed", async (ts) => {
		expect(
			await verifyPaddleSignature(body, await header(ts), secret, { now }),
		).toBe(false);
	});

	it("rejects a header with two ts values", async () => {
		const signed = `ts=${nowSeconds};${await header(nowSeconds)}`;
		expect(await verifyPaddleSignature(body, signed, secret, { now })).toBe(
			false,
		);
	});

	it("accepts when any h1 matches (secret rotation), in either order", async () => {
		const good = await hmacSha256Hex(secret, `${nowSeconds}:${body}`);
		const other = await hmacSha256Hex("old_secret", `${nowSeconds}:${body}`);

		for (const signed of [
			`ts=${nowSeconds};h1=${other};h1=${good}`,
			`ts=${nowSeconds};h1=${good};h1=${other}`,
		]) {
			expect(await verifyPaddleSignature(body, signed, secret, { now })).toBe(
				true,
			);
		}
	});

	it("rejects when no h1 matches", async () => {
		const a = await hmacSha256Hex("old_secret", `${nowSeconds}:${body}`);
		const b = await hmacSha256Hex("older_secret", `${nowSeconds}:${body}`);
		const signed = `ts=${nowSeconds};h1=${a};h1=${b}`;
		expect(await verifyPaddleSignature(body, signed, secret, { now })).toBe(
			false,
		);
	});

	it.each([
		["missing ts", "h1=abc123"],
		["missing h1", `ts=${nowSeconds}`],
		["empty h1", `ts=${nowSeconds};h1=`],
		["empty header", ""],
	])("rejects a header with %s", async (_label, signed) => {
		expect(await verifyPaddleSignature(body, signed, secret, { now })).toBe(
			false,
		);
	});
});

// ─── paddleWebhookResponseForCustomUserId ───────────────────────────────────

describe("paddleWebhookResponseForCustomUserId", () => {
	it("returns 200 { ignored: true } for a missing user_id", async () => {
		const result = paddleWebhookResponseForCustomUserId(undefined);
		expect(result.kind).toBe("response");
		if (result.kind !== "response") return;
		expect(result.response.status).toBe(200);
		await expect(result.response.json()).resolves.toEqual({ ignored: true });
	});

	it("keeps a malformed user_id as 400", () => {
		const result = paddleWebhookResponseForCustomUserId("not-a-uuid");
		expect(result.kind).toBe("response");
		if (result.kind !== "response") return;
		expect(result.response.status).toBe(400);
	});

	it("binds a valid UUID instead of ignoring it", () => {
		const userId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
		expect(paddleWebhookResponseForCustomUserId(userId)).toEqual({
			kind: "bound",
			userId,
		});
	});
});
