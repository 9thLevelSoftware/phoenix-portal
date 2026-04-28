import { createClient } from "jsr:@supabase/supabase-js@2";
import { hmacSha256Hex } from "../_shared/hmac.ts";
import {
	mapPriceIdToTier,
	paddlePriceIdsConfigured,
} from "../_shared/paddlePriceIds.ts";

const supabase = createClient(
	Deno.env.get("SUPABASE_URL")!,
	Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const responseHeaders = {
	"Content-Type": "application/json",
};

// ─── Signature Verification ─────────────────────────────────────────────────

/**
 * Verifies a Paddle webhook signature using HMAC-SHA256.
 *
 * Paddle-Signature header format: ts=<timestamp>;h1=<hmac_hex>
 * HMAC payload: ts + ":" + raw_body
 */
async function verifyPaddleSignature(
	rawBody: string,
	signatureHeader: string,
	secret: string,
): Promise<boolean> {
	const parts = signatureHeader.split(";").map((part) => part.trim());
	const tsEntry = parts.find((p) => p.startsWith("ts="));
	const h1Entry = parts.find((p) => p.startsWith("h1="));

	if (!tsEntry || !h1Entry) return false;

	const ts = tsEntry.slice(3);
	const expectedHex = h1Entry.slice(3).toLowerCase();

	if (!/^\d+$/.test(ts) || !expectedHex || !/^[0-9a-f]+$/.test(expectedHex)) {
		return false;
	}

	// Reject signatures older than 5 minutes to prevent replay attacks
	const timestamp = Number(ts);
	if (!Number.isSafeInteger(timestamp)) return false;
	const signatureAge = Math.abs(Date.now() / 1000 - timestamp);
	if (signatureAge > 300) {
		console.warn(
			"[BILLING_ALERT] Webhook signature too old:",
			signatureAge,
			"seconds",
		);
		return false;
	}

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

	const computedHex = Array.from(new Uint8Array(signatureBuffer))
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");

	if (computedHex.length !== expectedHex.length) return false;

	const a = encoder.encode(computedHex);
	const b = encoder.encode(expectedHex);

	let mismatch = 0;
	for (let i = 0; i < a.length; i++) {
		mismatch |= a[i]! ^ b[i]!;
	}
	return mismatch === 0;
}

interface PaddleWebhookEvent {
	event_id: string;
	event_type: string;
	occurred_at: string;
	data: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidDateString(value: string): boolean {
	return Number.isFinite(new Date(value).getTime());
}

function parsePaddleWebhookEvent(
	rawBody: string,
): { ok: true; data: PaddleWebhookEvent } | { ok: false } {
	try {
		const payload: unknown = JSON.parse(rawBody);
		if (
			!isRecord(payload) ||
			typeof payload.event_id !== "string" ||
			typeof payload.event_type !== "string" ||
			typeof payload.occurred_at !== "string" ||
			!isValidDateString(payload.occurred_at) ||
			!isRecord(payload.data)
		) {
			return { ok: false };
		}

		return {
			ok: true,
			data: {
				event_id: payload.event_id,
				event_type: payload.event_type,
				occurred_at: payload.occurred_at,
				data: payload.data,
			},
		};
	} catch {
		return { ok: false };
	}
}

// ─── Status Mapping ─────────────────────────────────────────────────────────

/**
 * Maps a Paddle subscription status to the portal's subscription status.
 */
function mapPaddleStatusToSubscriptionStatus(
	paddleStatus: string,
): string | null {
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
			return null;
	}
}

// ─── Webhook Handler ────────────────────────────────────────────────────────

Deno.serve(async (req) => {
	// Only accept POST
	if (req.method !== "POST") {
		return new Response(JSON.stringify({ error: "Method not allowed" }), {
			status: 405,
			headers: responseHeaders,
		});
	}

	try {
		if (!paddlePriceIdsConfigured(Deno.env)) {
			console.error(
				"[FATAL] PADDLE_EMBER_PRICE_IDS, PADDLE_FLAME_PRICE_IDS, and PADDLE_INFERNO_PRICE_IDS must all be set",
			);
			return new Response(
				JSON.stringify({ error: "Billing configuration incomplete" }),
				{ status: 500, headers: responseHeaders },
			);
		}

		// Read raw body BEFORE parsing — needed for signature verification
		const rawBody = await req.text();

		// Verify Paddle-Signature header
		const webhookSecret = Deno.env.get("PADDLE_WEBHOOK_SECRET");
		const signatureHeader = req.headers.get("Paddle-Signature");

		if (!webhookSecret || !signatureHeader) {
			return new Response(JSON.stringify({ error: "Unauthorized" }), {
				status: 401,
				headers: responseHeaders,
			});
		}

		const isValid = await verifyPaddleSignature(
			rawBody,
			signatureHeader,
			webhookSecret,
		);
		if (!isValid) {
			return new Response(JSON.stringify({ error: "Invalid signature" }), {
				status: 401,
				headers: responseHeaders,
			});
		}

		// Parse the event after signature verification
		const parsedEvent = parsePaddleWebhookEvent(rawBody);
		if (!parsedEvent.ok) {
			return new Response(JSON.stringify({ error: "Invalid event payload" }), {
				status: 400,
				headers: responseHeaders,
			});
		}
		const event = parsedEvent.data;

		console.log(
			`[Paddle] Received event: ${event.event_type}, event_id: ${event.event_id}, customer_id: ${String(event.data.customer_id ?? "")}`,
		);

		const handledEvents = [
			"subscription.created",
			"subscription.updated",
			"subscription.canceled",
			"subscription.paused",
			"subscription.resumed",
			"subscription.activated",
			"subscription.past_due",
			"subscription.trialing",
			"transaction.completed",
			"transaction.payment_failed",
		];

		if (!handledEvents.includes(event.event_type)) {
			console.warn(`[Paddle] Unhandled event type: ${event.event_type}`);
			return new Response(JSON.stringify({ received: true }), {
				status: 200,
				headers: responseHeaders,
			});
		}

		// Transaction-only events: acknowledge (extend with billing_events table later)
		if (
			event.event_type === "transaction.completed" ||
			event.event_type === "transaction.payment_failed"
		) {
			console.log(
				`[Paddle] Acknowledged ${event.event_type} event_id=${event.event_id}`,
			);
			return new Response(JSON.stringify({ received: true }), {
				status: 200,
				headers: responseHeaders,
			});
		}

		// Extract user_id from custom_data
		const customData = event.data.custom_data;
		if (
			!isRecord(customData) ||
			typeof customData.user_id !== "string" ||
			customData.user_id.length === 0
		) {
			console.error(
				"[BILLING_ALERT] Missing custom_data.user_id in Paddle event:",
				event.event_id,
				"event_type:",
				event.event_type,
			);
			return new Response(
				JSON.stringify({ error: "Missing user_id in custom_data" }),
				{ status: 400, headers: responseHeaders },
			);
		}
		const userId = customData.user_id;
		const customerId =
			typeof event.data.customer_id === "string"
				? event.data.customer_id
				: null;
		const subscriptionId =
			typeof event.data.id === "string" ? event.data.id : null;
		const paddleStatus =
			typeof event.data.status === "string" ? event.data.status : null;
		if (!customerId || !subscriptionId || !paddleStatus) {
			console.error(
				"[BILLING_ALERT] Invalid Paddle subscription payload:",
				event.event_id,
				"event_type:",
				event.event_type,
			);
			return new Response(
				JSON.stringify({ error: "Invalid subscription payload" }),
				{ status: 400, headers: responseHeaders },
			);
		}

		// Verify the signed user_id handed out by paddle-checkout-custom-data so
		// a client can't forge another user's user_id in custom_data (P1-10).
		// Only enforce when the signing secret is configured — lets envs that
		// haven't rolled out the signed-checkout flow keep working.
		const customDataSecret = Deno.env.get("PADDLE_CUSTOM_DATA_SECRET");
		if (customDataSecret?.trim()) {
			const providedSig = customData.cd_sig;
			if (!providedSig || typeof providedSig !== "string") {
				console.error(
					"[BILLING_ALERT] Missing cd_sig in custom_data (user_id spoofing attempt?):",
					event.event_id,
					"user_id:",
					userId,
				);
				return new Response(
					JSON.stringify({ error: "Missing cd_sig in custom_data" }),
					{ status: 401, headers: responseHeaders },
				);
			}

			const expectedSig = await hmacSha256Hex(customDataSecret.trim(), userId);
			const a = new TextEncoder().encode(providedSig);
			const b = new TextEncoder().encode(expectedSig);
			let sigMismatch = a.length !== b.length ? 1 : 0;
			const cmpLen = Math.min(a.length, b.length);
			for (let i = 0; i < cmpLen; i++) {
				sigMismatch |= a[i]! ^ b[i]!;
			}
			if (sigMismatch !== 0) {
				console.error(
					"[BILLING_ALERT] Invalid cd_sig in custom_data (user_id spoofing attempt?):",
					event.event_id,
					"user_id:",
					userId,
				);
				return new Response(JSON.stringify({ error: "Invalid cd_sig" }), {
					status: 401,
					headers: responseHeaders,
				});
			}
		}

		// Idempotency and ordering check — skip duplicate or stale events.
		const eventOccurredAtMs = new Date(event.occurred_at).getTime();
		const { data: existing, error: existingError } = await supabase
			.from("subscriptions")
			.select("last_event_id, last_event_occurred_at")
			.eq("user_id", userId)
			.maybeSingle();

		if (existingError) {
			console.error(
				"[BILLING_ALERT] Failed to load subscription webhook state:",
				existingError,
			);
			return new Response(JSON.stringify({ error: "Database lookup failed" }), {
				status: 500,
				headers: responseHeaders,
			});
		}

		if (existing?.last_event_id === event.event_id) {
			return new Response(JSON.stringify({ received: true, duplicate: true }), {
				status: 200,
				headers: responseHeaders,
			});
		}

		const existingOccurredAt =
			typeof existing?.last_event_occurred_at === "string"
				? new Date(existing.last_event_occurred_at).getTime()
				: Number.NaN;
		if (
			Number.isFinite(existingOccurredAt) &&
			eventOccurredAtMs < existingOccurredAt
		) {
			console.warn("[Paddle] Ignoring stale subscription event:", {
				event_id: event.event_id,
				event_type: event.event_type,
				occurred_at: event.occurred_at,
				last_event_id: existing?.last_event_id,
				last_event_occurred_at: existing?.last_event_occurred_at,
			});
			return new Response(JSON.stringify({ received: true, stale: true }), {
				status: 200,
				headers: responseHeaders,
			});
		}

		// Map status and tier
		const status = mapPaddleStatusToSubscriptionStatus(paddleStatus);
		if (!status) {
			console.error(
				"[BILLING_ALERT] Unknown Paddle subscription status:",
				paddleStatus,
				"event_id:",
				event.event_id,
			);
			return new Response(
				JSON.stringify({ error: "Unknown subscription status" }),
				{ status: 400, headers: responseHeaders },
			);
		}
		const firstItem = Array.isArray(event.data.items)
			? event.data.items[0]
			: null;
		const price =
			isRecord(firstItem) && isRecord(firstItem.price) ? firstItem.price : null;
		const priceId = typeof price?.id === "string" ? price.id : "";
		if (!priceId) {
			console.error(
				"[BILLING_ALERT] Missing Paddle price ID:",
				event.event_id,
				"event_type:",
				event.event_type,
			);
			return new Response(JSON.stringify({ error: "Missing price_id" }), {
				status: 400,
				headers: responseHeaders,
			});
		}
		let tier = mapPriceIdToTier(priceId, Deno.env);

		if (tier === "FREE") {
			const { data: subRow } = await supabase
				.from("subscriptions")
				.select("tier")
				.eq("user_id", userId)
				.maybeSingle();
			const existingTier = subRow?.tier as string | undefined;
			if (existingTier && existingTier !== "FREE" && existingTier !== "free") {
				console.warn(
					`[BILLING_ALERT] Unknown price ID ${priceId} — preserving existing tier ${existingTier}`,
				);
				tier = existingTier as typeof tier;
			} else {
				console.error(
					"[BILLING_ALERT] Unknown price ID — no existing tier to preserve (check PADDLE_* price envs):",
					priceId,
				);
				return new Response(
					JSON.stringify({ error: "Unknown price_id — configuration error" }),
					{ status: 500, headers: responseHeaders },
				);
			}
		}

		// Detect cancel/pause scheduling
		const isCanceled =
			event.event_type === "subscription.canceled" ||
			(isRecord(event.data.scheduled_change) &&
				event.data.scheduled_change.action === "cancel");
		const isPaused =
			event.event_type === "subscription.paused" ||
			(isRecord(event.data.scheduled_change) &&
				event.data.scheduled_change.action === "pause");
		const billingPeriod = isRecord(event.data.current_billing_period)
			? event.data.current_billing_period
			: null;

		// Build upsert payload (uses legacy Stripe column names)
		const upsertData: Record<string, unknown> = {
			user_id: userId,
			paddle_customer_id: customerId,
			paddle_subscription_id: subscriptionId,
			tier,
			status,
			price_id: priceId || null,
			current_period_start:
				typeof billingPeriod?.starts_at === "string"
					? billingPeriod.starts_at
					: null,
			current_period_end:
				typeof billingPeriod?.ends_at === "string"
					? billingPeriod.ends_at
					: null,
			cancel_at_period_end: isCanceled || isPaused,
			last_event_id: event.event_id,
			last_event_occurred_at: event.occurred_at,
			updated_at: new Date().toISOString(),
		};

		const { error } = await supabase
			.from("subscriptions")
			.upsert(upsertData, { onConflict: "user_id" });

		if (error) {
			console.error(
				`[BILLING_ALERT] Error upserting subscription for ${event.event_type}:`,
				error,
			);
			return new Response(JSON.stringify({ error: "Database upsert failed" }), {
				status: 500,
				headers: responseHeaders,
			});
		}

		console.log(
			`[Paddle] Successfully processed ${event.event_type} for user ${userId}, paddle_customer_id: ${event.data.customer_id}`,
		);

		return new Response(JSON.stringify({ received: true }), {
			status: 200,
			headers: responseHeaders,
		});
	} catch (err) {
		console.error("Paddle webhook handler error:", err);
		return new Response(JSON.stringify({ error: "Internal server error" }), {
			status: 500,
			headers: responseHeaders,
		});
	}
});
