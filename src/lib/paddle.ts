/**
 * Paddle Billing webhook types and mapping utilities.
 *
 * This module mirrors the role of the former revenuecat.ts — it provides
 * pure functions that translate Paddle webhook payloads into the shape
 * expected by the portal's `subscriptions` table.
 *
 * Column names in the subscriptions table are legacy from Stripe:
 *   stripe_customer_id  -> Paddle customer_id  (ctm_XXXX)
 *   stripe_subscription_id -> Paddle subscription_id (sub_XXXX)
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export type PaddleEventType =
	| "subscription.created"
	| "subscription.updated"
	| "subscription.canceled"
	| "subscription.paused"
	| "subscription.resumed"
	| "subscription.activated"
	| "transaction.completed"
	| "transaction.payment_failed";

export interface PaddleSubscriptionItem {
	price: {
		id: string;
		product_id?: string;
	};
	quantity: number;
	status?: string;
}

export interface PaddleSubscriptionData {
	id: string; // sub_XXXX
	customer_id: string; // ctm_XXXX
	status: string; // active | trialing | paused | canceled | past_due
	items: PaddleSubscriptionItem[];
	custom_data?: {
		user_id?: string;
		[key: string]: unknown;
	};
	current_billing_period?: {
		starts_at: string; // ISO 8601
		ends_at: string; // ISO 8601
	};
	scheduled_change?: {
		action: string; // "cancel" | "pause" | "resume"
		effective_at: string;
	} | null;
	canceled_at?: string | null;
}

export interface PaddleWebhookEvent {
	event_id: string;
	event_type: PaddleEventType | string;
	occurred_at: string;
	data: PaddleSubscriptionData;
}

// ─── Price → Tier Mapping ───────────────────────────────────────────────────

/**
 * Maps a Paddle price ID to a Phoenix Portal subscription tier.
 *
 * Price IDs are configured in the Paddle dashboard and stored in env vars.
 * Falls back to "FREE" for unknown price IDs.
 */
export function mapPriceIdToTier(priceId: string): string {
	// Check env vars first (allows runtime configuration)
	const infernoPriceIds = (
		import.meta.env.VITE_PADDLE_INFERNO_PRICE_IDS ?? ""
	)
		.split(",")
		.filter(Boolean);
	const emberPriceIds = (import.meta.env.VITE_PADDLE_EMBER_PRICE_IDS ?? "")
		.split(",")
		.filter(Boolean);

	if (infernoPriceIds.includes(priceId)) return "INFERNO";
	if (emberPriceIds.includes(priceId)) return "EMBER";

	return "FREE";
}

/**
 * Server-side variant that reads from Deno.env (for Edge Functions).
 * Not exported from the client bundle — duplicated in the Edge Function.
 */
export function mapPriceIdToTierServer(
	priceId: string,
	env: { get(key: string): string | undefined },
): string {
	const infernoPriceIds = (env.get("PADDLE_INFERNO_PRICE_IDS") ?? "")
		.split(",")
		.filter(Boolean);
	const emberPriceIds = (env.get("PADDLE_EMBER_PRICE_IDS") ?? "")
		.split(",")
		.filter(Boolean);

	if (infernoPriceIds.includes(priceId)) return "INFERNO";
	if (emberPriceIds.includes(priceId)) return "EMBER";

	return "FREE";
}

// ─── Status Mapping ─────────────────────────────────────────────────────────

/**
 * Maps a Paddle subscription status to the portal's subscription status.
 */
export function mapPaddleStatusToSubscriptionStatus(
	paddleStatus: string,
): string {
	switch (paddleStatus) {
		case "active":
			return "active";
		case "trialing":
			return "trialing";
		case "paused":
			return "canceled";
		case "canceled":
			return "canceled";
		case "past_due":
			return "past_due";
		default:
			return "none";
	}
}

// ─── Upsert Builder ─────────────────────────────────────────────────────────

/**
 * Builds the upsert payload for the subscriptions table from a Paddle webhook event.
 *
 * Uses legacy column names for backwards compatibility:
 *   stripe_customer_id  -> Paddle customer_id
 *   stripe_subscription_id -> Paddle subscription_id
 *
 * Returns null if the event has no user_id in custom_data (can't associate with portal user).
 */
export function buildSubscriptionUpsert(
	event: PaddleWebhookEvent,
	tierResolver: (priceId: string) => string = mapPriceIdToTier,
): Record<string, unknown> | null {
	const data = event.data;
	const userId = data.custom_data?.user_id;

	if (!userId) return null;

	const status = mapPaddleStatusToSubscriptionStatus(data.status);

	// Resolve tier from the first item's price ID
	const priceId = data.items?.[0]?.price?.id ?? "";
	const tier = tierResolver(priceId);

	// Detect cancel_at_period_end from scheduled_change or event type
	const isCanceled =
		event.event_type === "subscription.canceled" ||
		data.scheduled_change?.action === "cancel";

	const isPaused =
		event.event_type === "subscription.paused" ||
		data.scheduled_change?.action === "pause";

	return {
		user_id: userId,
		stripe_customer_id: data.customer_id, // Legacy column, stores Paddle customer_id
		stripe_subscription_id: data.id, // Legacy column, stores Paddle subscription_id
		tier,
		status,
		price_id: priceId || null,
		current_period_start: data.current_billing_period?.starts_at ?? null,
		current_period_end: data.current_billing_period?.ends_at ?? null,
		cancel_at_period_end: isCanceled || isPaused,
		last_event_id: event.event_id,
		updated_at: new Date().toISOString(),
	};
}

// ─── Signature Verification ─────────────────────────────────────────────────

/**
 * Verifies a Paddle webhook signature using HMAC-SHA256 with Web Crypto API.
 *
 * Paddle-Signature header format: ts=<timestamp>;h1=<hmac_hex>
 * HMAC payload: ts + ":" + raw_body
 *
 * Uses timing-safe comparison to prevent timing attacks.
 */
export async function verifyPaddleSignature(
	rawBody: string,
	signatureHeader: string,
	secret: string,
): Promise<boolean> {
	// Parse header: ts=<timestamp>;h1=<hmac>
	const parts = signatureHeader.split(";");
	const tsEntry = parts.find((p) => p.startsWith("ts="));
	const h1Entry = parts.find((p) => p.startsWith("h1="));

	if (!tsEntry || !h1Entry) return false;

	const ts = tsEntry.slice(3);
	const expectedHex = h1Entry.slice(3);

	if (!ts || !expectedHex) return false;

	// Compute HMAC-SHA256
	const encoder = new TextEncoder();
	const key = await crypto.subtle.importKey(
		"raw",
		encoder.encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);

	const payload = `${ts}:${rawBody}`;
	const signatureBuffer = await crypto.subtle.sign(
		"HMAC",
		key,
		encoder.encode(payload),
	);

	// Convert to hex
	const computedHex = Array.from(new Uint8Array(signatureBuffer))
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");

	// Timing-safe comparison
	if (computedHex.length !== expectedHex.length) return false;

	const a = encoder.encode(computedHex);
	const b = encoder.encode(expectedHex);

	// Use crypto.subtle.timingSafeEqual if available, otherwise constant-time compare
	if (typeof crypto.subtle.timingSafeEqual === "function") {
		return crypto.subtle.timingSafeEqual(a, b);
	}

	// Fallback: constant-time comparison
	let mismatch = 0;
	for (let i = 0; i < a.length; i++) {
		mismatch |= a[i] ^ b[i];
	}
	return mismatch === 0;
}
