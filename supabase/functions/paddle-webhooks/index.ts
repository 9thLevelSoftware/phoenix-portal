import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  mapPriceIdToTier,
  paddlePriceIdsConfigured,
} from "../_shared/paddlePriceIds.ts";
import {
  buildSubscriptionUpsertFromPaddleState,
  type PaddleSubscriptionState,
} from "../_shared/paddleSubscriptionState.ts";
import {
  classifyPaddleEventOrder,
  evaluatePaddleCustomDataTrust,
  verifyPaddleCustomDataSignature,
} from "../_shared/paddleWebhookSecurity.ts";

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
  const parts = signatureHeader.split(";");
  const tsEntry = parts.find((p) => p.startsWith("ts="));
  const h1Entry = parts.find((p) => p.startsWith("h1="));

  if (!tsEntry || !h1Entry) return false;

  const ts = tsEntry.slice(3);
  const expectedHex = h1Entry.slice(3);

  if (!ts || !expectedHex) return false;

  // Reject signatures older than 5 minutes to prevent replay attacks
  const signatureAge = Math.abs(Date.now() / 1000 - parseInt(ts, 10));
  if (signatureAge > 300) {
    console.warn("[BILLING_ALERT] Webhook signature too old:", signatureAge, "seconds");
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

// ─── Webhook Handler ────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  // Only accept POST
  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      { status: 405, headers: responseHeaders },
    );
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
    const customDataSecret = Deno.env.get("PADDLE_CUSTOM_DATA_SECRET")?.trim();
    if (!customDataSecret) {
      console.error("[FATAL] PADDLE_CUSTOM_DATA_SECRET must be set");
      return new Response(
        JSON.stringify({ error: "Billing custom_data signing is not configured" }),
        { status: 500, headers: responseHeaders },
      );
    }

    // Read raw body BEFORE parsing — needed for signature verification
    const rawBody = await req.text();

    // Verify Paddle-Signature header
    const webhookSecret = Deno.env.get("PADDLE_WEBHOOK_SECRET");
    const signatureHeader = req.headers.get("Paddle-Signature");

    if (!webhookSecret || !signatureHeader) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: responseHeaders },
      );
    }

    const isValid = await verifyPaddleSignature(rawBody, signatureHeader, webhookSecret);
    if (!isValid) {
      return new Response(
        JSON.stringify({ error: "Invalid signature" }),
        { status: 401, headers: responseHeaders },
      );
    }

    // Parse the event after signature verification
    const event = JSON.parse(rawBody);

    console.log(
      `[Paddle] Received event: ${event.event_type}, event_id: ${event.event_id}, customer_id: ${event.data?.customer_id}`,
    );

    if (!event.event_id || !event.event_type || !event.data) {
      return new Response(
        JSON.stringify({ error: "Invalid event payload" }),
        { status: 400, headers: responseHeaders },
      );
    }

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
      return new Response(
        JSON.stringify({ received: true }),
        { status: 200, headers: responseHeaders },
      );
    }

    // Transaction-only events: acknowledge (extend with billing_events table later)
    if (
      event.event_type === "transaction.completed" ||
      event.event_type === "transaction.payment_failed"
    ) {
      console.log(
        `[Paddle] Acknowledged ${event.event_type} event_id=${event.event_id}`,
      );
      return new Response(
        JSON.stringify({ received: true }),
        { status: 200, headers: responseHeaders },
      );
    }

    // Extract user_id from custom_data
    const userId = event.data.custom_data?.user_id;
    if (!userId) {
      console.error(
        "[BILLING_ALERT] Missing custom_data.user_id in Paddle event:",
        event.event_id,
        "event_type:",
        event.event_type,
      );
      return new Response(
        JSON.stringify({ error: "Missing user_id in custom_data" }),
        { status: 500, headers: responseHeaders },
      );
    }

    // Load the existing row before custom_data trust checks. New checkouts must
    // carry cd_sig; legacy subscriptions may omit it only when the Paddle
    // subscription ID already matches the stored row for the same user.
    const { data: existingSubscription, error: existingSubscriptionError } = await supabase
      .from("subscriptions")
      .select("last_event_id, last_event_occurred_at, tier, paddle_subscription_id")
      .eq("user_id", userId)
      .maybeSingle();

    // A failed lookup (DB outage, schema drift, multiple rows) must NOT be
    // treated as "no existing subscription" — that silently disables duplicate
    // and stale-event detection and rejects legacy unsigned events for the wrong
    // reason. Return 500 so Paddle retries with full ordering/trust context.
    if (existingSubscriptionError) {
      console.error(
        "[BILLING_ALERT] Failed to load existing subscription:",
        event.event_id,
        existingSubscriptionError,
      );
      return new Response(
        JSON.stringify({ error: "Failed to load subscription state" }),
        { status: 500, headers: responseHeaders },
      );
    }

    // Verify the signed user_id handed out by paddle-checkout-custom-data so
    // a client can't forge another user's user_id in custom_data (P1-10).
    const providedSig = event.data.custom_data?.cd_sig;
    const signedCustomDataValid = await verifyPaddleCustomDataSignature(
      userId,
      providedSig,
      customDataSecret,
    );
    const trustDecision = evaluatePaddleCustomDataTrust({
      signedCustomDataValid,
      eventSubscriptionId: event.data.id,
      existingSubscriptionId: existingSubscription?.paddle_subscription_id,
    });
    if (!trustDecision.trusted) {
      console.error(
        "[BILLING_ALERT] Missing or invalid cd_sig in custom_data (user_id spoofing attempt?):",
        event.event_id,
        "user_id:",
        userId,
        "reason:",
        trustDecision.reason,
      );
      return new Response(
        JSON.stringify({ error: "Invalid cd_sig" }),
        { status: 401, headers: responseHeaders },
      );
    }
    if (trustDecision.method === "legacy_subscription_match") {
      console.warn(
        `[Paddle] Accepted legacy unsigned event ${event.event_id} by stored subscription match`,
      );
    }

    // Idempotency and ordering check — skip duplicates and stale delivery.
    const eventOrder = classifyPaddleEventOrder(
      event.event_id,
      event.occurred_at,
      existingSubscription,
    );
    if (eventOrder.action === "duplicate") {
      return new Response(
        JSON.stringify({ received: true, duplicate: true }),
        { status: 200, headers: responseHeaders },
      );
    }
    if (eventOrder.action === "stale") {
      console.warn(
        `[Paddle] Ignoring stale event ${event.event_id}: occurred_at=${eventOrder.occurredAt}, last_event_occurred_at=${eventOrder.lastOccurredAt}`,
      );
      return new Response(
        JSON.stringify({ received: true, stale: true }),
        { status: 200, headers: responseHeaders },
      );
    }
    if (eventOrder.action === "invalid") {
      console.error(
        "[BILLING_ALERT] Missing or invalid Paddle occurred_at:",
        event.event_id,
      );
      return new Response(
        JSON.stringify({ error: "Invalid occurred_at" }),
        { status: 400, headers: responseHeaders },
      );
    }

    const priceId = event.data.items?.[0]?.price?.id ?? "";
    let tier = mapPriceIdToTier(priceId, Deno.env);

    if (priceId && tier === "FREE") {
      const existingTier = existingSubscription?.tier as string | undefined;
      if (
        existingTier &&
        existingTier !== "FREE" &&
        existingTier !== "free"
      ) {
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

    // Build upsert payload (uses legacy Stripe column names)
    const upsertData = buildSubscriptionUpsertFromPaddleState({
      userId,
      subscription: event.data as PaddleSubscriptionState,
      tier,
      eventId: event.event_id,
      occurredAt: eventOrder.occurredAt,
    });

    const { error } = await supabase
      .from("subscriptions")
      .upsert(upsertData, { onConflict: "user_id" });

    if (error) {
      console.error(`[BILLING_ALERT] Error upserting subscription for ${event.event_type}:`, error);
      return new Response(
        JSON.stringify({ error: "Database upsert failed" }),
        { status: 500, headers: responseHeaders },
      );
    }

    console.log(
      `[Paddle] Successfully processed ${event.event_type} for user ${userId}, paddle_customer_id: ${event.data.customer_id}`,
    );

    return new Response(
      JSON.stringify({ received: true }),
      { status: 200, headers: responseHeaders },
    );
  } catch (err) {
    console.error("Paddle webhook handler error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: responseHeaders },
    );
  }
});
