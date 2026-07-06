import { describe, expect, it } from "vitest";
import {
	extractGarminProviderUserId,
	type GarminIdentityCandidate,
	resolveGarminWebhookIdentity,
} from "../../supabase/functions/_shared/garminIdentity.ts";
import { hmacSha256Hex } from "../../supabase/functions/_shared/hmac.ts";
import {
	getConfiguredPriceIdForTierInterval,
	parsePaddleBillingInterval,
	parsePaddlePaidTier,
} from "../../supabase/functions/_shared/paddlePriceIds.ts";
import { buildSubscriptionUpsertFromPaddleState } from "../../supabase/functions/_shared/paddleSubscriptionState.ts";
import { buildPaddleSubscriptionPatch } from "../../supabase/functions/_shared/paddleSubscriptionUpdate.ts";
import {
	classifyPaddleEventOrder,
	evaluatePaddleCustomDataTrust,
	verifyPaddleCustomDataSignature,
} from "../../supabase/functions/_shared/paddleWebhookSecurity.ts";
import { isSubscriptionEntitled } from "../../supabase/functions/_shared/subscriptionEntitlement.ts";

describe("Paddle webhook security helpers", () => {
	it("requires valid signed custom_data for the Paddle user id", async () => {
		const secret = "paddle-custom-data-secret";
		const userId = "user-123";
		const cdSig = await hmacSha256Hex(secret, userId);

		await expect(
			verifyPaddleCustomDataSignature(userId, cdSig, secret),
		).resolves.toBe(true);
		await expect(
			verifyPaddleCustomDataSignature("victim-user", cdSig, secret),
		).resolves.toBe(false);
		await expect(
			verifyPaddleCustomDataSignature(userId, undefined, secret),
		).resolves.toBe(false);
	});

	it("rejects stale distinct Paddle events by occurred_at", () => {
		const existing = {
			last_event_id: "evt_new",
			last_event_occurred_at: "2026-05-17T17:10:00Z",
		};

		expect(
			classifyPaddleEventOrder("evt_new", "2026-05-17T17:00:00Z", existing),
		).toEqual({ action: "duplicate" });
		expect(
			classifyPaddleEventOrder("evt_old", "2026-05-17T17:00:00Z", existing),
		).toEqual({
			action: "stale",
			occurredAt: "2026-05-17T17:00:00Z",
			lastOccurredAt: "2026-05-17T17:10:00Z",
		});
		expect(
			classifyPaddleEventOrder(
				"evt_same_time",
				"2026-05-17T17:10:00Z",
				existing,
			),
		).toEqual({
			action: "stale",
			occurredAt: "2026-05-17T17:10:00Z",
			lastOccurredAt: "2026-05-17T17:10:00Z",
		});
		expect(
			classifyPaddleEventOrder("evt_next", "2026-05-17T17:11:00Z", existing),
		).toEqual({ action: "accept", occurredAt: "2026-05-17T17:11:00Z" });
	});

	it("accepts legacy unsigned events only for the stored Paddle subscription id", () => {
		expect(
			evaluatePaddleCustomDataTrust({
				signedCustomDataValid: true,
				eventSubscriptionId: "sub_new",
				existingSubscriptionId: undefined,
			}),
		).toEqual({ trusted: true, method: "signature" });

		expect(
			evaluatePaddleCustomDataTrust({
				signedCustomDataValid: false,
				eventSubscriptionId: "sub_existing",
				existingSubscriptionId: "sub_existing",
			}),
		).toEqual({ trusted: true, method: "legacy_subscription_match" });

		expect(
			evaluatePaddleCustomDataTrust({
				signedCustomDataValid: false,
				eventSubscriptionId: "sub_attacker",
				existingSubscriptionId: "sub_existing",
			}),
		).toEqual({ trusted: false, reason: "subscription_mismatch" });

		expect(
			evaluatePaddleCustomDataTrust({
				signedCustomDataValid: false,
				eventSubscriptionId: undefined,
				existingSubscriptionId: "sub_existing",
			}),
		).toEqual({ trusted: false, reason: "missing_subscription_id" });
	});

	it("denies Edge entitlements when the billing period is expired or missing", () => {
		const now = new Date("2026-05-17T12:00:00Z");

		expect(isSubscriptionEntitled("active", "2026-06-17T00:00:00Z", now)).toBe(
			true,
		);
		expect(isSubscriptionEntitled("active", "2026-04-17T00:00:00Z", now)).toBe(
			false,
		);
		expect(isSubscriptionEntitled("active", null, now)).toBe(false);
		expect(
			isSubscriptionEntitled("canceled", "2026-06-17T00:00:00Z", now),
		).toBe(false);
	});

	it("builds Paddle update bodies for switches, downgrades, and uncancel actions", () => {
		expect(
			buildPaddleSubscriptionPatch(
				"pri_flame_monthly",
				"pri_ember_monthly",
				false,
			),
		).toEqual({
			action: "switch",
			body: {
				items: [{ price_id: "pri_ember_monthly", quantity: 1 }],
				proration_billing_mode: "prorated_immediately",
			},
		});

		expect(
			buildPaddleSubscriptionPatch(
				"pri_flame_monthly",
				"pri_flame_annual",
				true,
			),
		).toEqual({
			action: "switch",
			body: {
				items: [{ price_id: "pri_flame_annual", quantity: 1 }],
				proration_billing_mode: "prorated_immediately",
				scheduled_change: null,
			},
		});

		expect(
			buildPaddleSubscriptionPatch(
				"pri_flame_monthly",
				"pri_flame_monthly",
				true,
			),
		).toEqual({ action: "uncancel", body: { scheduled_change: null } });
	});

	it("resolves server-side Paddle plan selections for subscription updates", () => {
		const env = {
			get: (key: string) =>
				({
					PADDLE_EMBER_MONTHLY_PRICE_ID: "pri_ember_monthly",
					PADDLE_FLAME_ANNUAL_PRICE_ID: "pri_flame_annual",
				})[key],
		};

		expect(parsePaddlePaidTier("ember")).toBe("EMBER");
		expect(parsePaddlePaidTier("invalid")).toBeNull();
		expect(parsePaddleBillingInterval("annual")).toBe("annual");
		expect(parsePaddleBillingInterval("weekly")).toBeNull();
		expect(getConfiguredPriceIdForTierInterval("EMBER", "monthly", env)).toBe(
			"pri_ember_monthly",
		);
		expect(getConfiguredPriceIdForTierInterval("FLAME", "annual", env)).toBe(
			"pri_flame_annual",
		);
		expect(
			getConfiguredPriceIdForTierInterval("FLAME", "monthly", env),
		).toBeNull();
	});

	it("maps fully canceled Paddle subscriptions to closed local state", () => {
		const upsert = buildSubscriptionUpsertFromPaddleState({
			userId: "user-123",
			tier: "FLAME",
			subscription: {
				id: "sub_123",
				customer_id: "ctm_123",
				status: "canceled",
				items: [{ price: { id: "pri_flame_monthly" }, quantity: 1 }],
				current_billing_period: {
					starts_at: "2026-04-17T00:00:00Z",
					ends_at: "2026-05-17T00:00:00Z",
				},
				scheduled_change: {
					action: "cancel",
					effective_at: "2026-05-17T00:00:00Z",
				},
			},
			eventId: "evt_canceled",
			occurredAt: "2026-05-17T00:00:00Z",
		});

		expect(upsert.status).toBe("canceled");
		expect(upsert.current_period_end).toBeNull();
		expect(upsert.cancel_at_period_end).toBe(false);
	});
});

describe("Garmin webhook identity helpers", () => {
	const candidates: GarminIdentityCandidate[] = [
		{
			user_id: "attacker-user",
			provider_user_id: "victim-garmin-id",
			access_token: "attacker-token",
		},
		{
			user_id: "victim-user",
			provider_user_id: "victim-garmin-id",
			access_token: "victim-token",
		},
	];

	const decrypt = async (stored: string | null | undefined) => stored;

	it("extracts provider user ids from Garmin OAuth access-token responses", () => {
		expect(
			extractGarminProviderUserId(
				new URLSearchParams("oauth_token=tok&xoauth_garmin_user_id=garmin-123"),
			),
		).toBe("garmin-123");
		expect(
			extractGarminProviderUserId(
				new URLSearchParams("oauth_token=tok&user_id=garmin-456"),
			),
		).toBe("garmin-456");
	});

	it("does not trust provider_user_id without a matching server-held access token", async () => {
		await expect(
			resolveGarminWebhookIdentity(
				{ userId: "victim-garmin-id", userAccessToken: "victim-token" },
				[candidates[0]!],
				decrypt,
			),
		).resolves.toEqual({ ok: false, reason: "unbound" });

		await expect(
			resolveGarminWebhookIdentity(
				{ userId: "victim-garmin-id", userAccessToken: "victim-token" },
				candidates,
				decrypt,
			),
		).resolves.toEqual({
			ok: true,
			userId: "victim-user",
			bindProviderUserId: false,
		});
	});

	it("rejects ambiguous token bindings and safely binds unbound token matches", async () => {
		await expect(
			resolveGarminWebhookIdentity(
				{ userId: "garmin-1", userAccessToken: "shared-token" },
				[
					{
						user_id: "user-1",
						provider_user_id: null,
						access_token: "shared-token",
					},
					{
						user_id: "user-2",
						provider_user_id: null,
						access_token: "shared-token",
					},
				],
				decrypt,
			),
		).resolves.toEqual({ ok: false, reason: "ambiguous" });

		await expect(
			resolveGarminWebhookIdentity(
				{ userId: "garmin-1", userAccessToken: "token-1" },
				[
					{
						user_id: "user-1",
						provider_user_id: null,
						access_token: "token-1",
					},
				],
				decrypt,
			),
		).resolves.toEqual({
			ok: true,
			userId: "user-1",
			bindProviderUserId: true,
		});
	});
});
