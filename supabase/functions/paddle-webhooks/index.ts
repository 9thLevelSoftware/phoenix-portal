import { createClient } from "jsr:@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
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
  secret: string
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
    ["sign"]
  );

  const payload = `${ts}:${rawBody}`;
  const signatureBuffer = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(payload)
  );

  const computedHex = Array.from(new Uint8Array(signatureBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  // Timing-safe comparison
  if (computedHex.length !== expectedHex.length) return false;

  const a = encoder.encode(computedHex);
  const b = encoder.encode(expectedHex);

  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a[i] ^ b[i];
  }
  return mismatch === 0;
}

// ─── Price → Tier Mapping ───────────────────────────────────────────────────

/**
 * Maps a Paddle price ID to a Phoenix Portal subscription tier.
 * Price IDs are configured via environment variables.
 */
function mapPriceIdToTier(priceId: string): string {
  const infernoPriceIds = (Deno.env.get("PADDLE_INFERNO_PRICE_IDS") ?? "")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);
  const flamePriceIds = (Deno.env.get("PADDLE_FLAME_PRICE_IDS") ?? "")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);
  const emberPriceIds = (Deno.env.get("PADDLE_EMBER_PRICE_IDS") ?? "")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);

  if (infernoPriceIds.includes(priceId)) return "INFERNO";
  if (flamePriceIds.includes(priceId)) return "FLAME";
  if (emberPriceIds.includes(priceId)) return "EMBER";

  if (priceId) {
    console.warn("[BILLING_ALERT] Unknown price ID mapped to FREE tier:", priceId, "— check PADDLE_*_PRICE_IDS env vars");
  }
  return "FREE";
}

// ─── Status Mapping ─────────────────────────────────────────────────────────

/**
 * Maps a Paddle subscription status to the portal's subscription status.
 */
function mapPaddleStatusToSubscriptionStatus(paddleStatus: string): string {
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

// ─── Webhook Handler ────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  // Only accept POST
  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      { status: 405, headers: responseHeaders }
    );
  }

  try {
    // Read raw body BEFORE parsing — needed for signature verification
    const rawBody = await req.text();

    // Verify Paddle-Signature header
    const webhookSecret = Deno.env.get("PADDLE_WEBHOOK_SECRET");
    const signatureHeader = req.headers.get("Paddle-Signature");

    if (!webhookSecret || !signatureHeader) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: responseHeaders }
      );
    }

    const isValid = await verifyPaddleSignature(rawBody, signatureHeader, webhookSecret);
    if (!isValid) {
      return new Response(
        JSON.stringify({ error: "Invalid signature" }),
        { status: 401, headers: responseHeaders }
      );
    }

    // Parse the event after signature verification
    const event = JSON.parse(rawBody);

    console.log(`[Paddle] Received event: ${event.event_type}, event_id: ${event.event_id}, customer_id: ${event.data?.customer_id}`);

    if (!event.event_id || !event.event_type || !event.data) {
      return new Response(
        JSON.stringify({ error: "Invalid event payload" }),
        { status: 400, headers: responseHeaders }
      );
    }

    // Only handle subscription events
    const handledEvents = [
      "subscription.created",
      "subscription.updated",
      "subscription.canceled",
      "subscription.paused",
      "subscription.resumed",
      "subscription.activated",
    ];

    if (!handledEvents.includes(event.event_type)) {
      // Return 200 for unknown events — don't trigger Paddle retries
      console.log(`Unhandled event type: ${event.event_type}`);
      return new Response(
        JSON.stringify({ received: true }),
        { status: 200, headers: responseHeaders }
      );
    }

    // Extract user_id from custom_data
    const userId = event.data.custom_data?.user_id;
    if (!userId) {
      console.error("[BILLING_ALERT] Missing custom_data.user_id in Paddle event:", event.event_id, "event_type:", event.event_type);
      return new Response(
        JSON.stringify({ error: "Missing user_id in custom_data" }),
        { status: 500, headers: responseHeaders }
      );
    }

    // Idempotency check — skip if this event was already processed
    const { data: existing } = await supabase
      .from("subscriptions")
      .select("last_event_id")
      .eq("user_id", userId)
      .maybeSingle();

    if (existing?.last_event_id === event.event_id) {
      return new Response(
        JSON.stringify({ received: true, duplicate: true }),
        { status: 200, headers: responseHeaders }
      );
    }

    // Map status and tier
    const status = mapPaddleStatusToSubscriptionStatus(event.data.status);
    const priceId = event.data.items?.[0]?.price?.id ?? "";
    const tier = mapPriceIdToTier(priceId);

    // Detect cancel/pause scheduling
    const isCanceled =
      event.event_type === "subscription.canceled" ||
      event.data.scheduled_change?.action === "cancel";
    const isPaused =
      event.event_type === "subscription.paused" ||
      event.data.scheduled_change?.action === "pause";

    // Build upsert payload (uses legacy Stripe column names)
    const upsertData: Record<string, unknown> = {
      user_id: userId,
      paddle_customer_id: event.data.customer_id,
      paddle_subscription_id: event.data.id,
      tier,
      status,
      price_id: priceId || null,
      current_period_start: event.data.current_billing_period?.starts_at ?? null,
      current_period_end: event.data.current_billing_period?.ends_at ?? null,
      cancel_at_period_end: isCanceled || isPaused,
      last_event_id: event.event_id,
      updated_at: new Date().toISOString(),
    };

    const { error } = await supabase
      .from("subscriptions")
      .upsert(upsertData, { onConflict: "user_id" });

    if (error) {
      console.error(`[BILLING_ALERT] Error upserting subscription for ${event.event_type}:`, error);
      return new Response(
        JSON.stringify({ error: "Database upsert failed" }),
        { status: 500, headers: responseHeaders }
      );
    }

    console.log(`[Paddle] Successfully processed ${event.event_type} for user ${userId}, paddle_customer_id: ${event.data.customer_id}`);

    return new Response(
      JSON.stringify({ received: true }),
      { status: 200, headers: responseHeaders }
    );
  } catch (err) {
    console.error("Paddle webhook handler error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: responseHeaders }
    );
  }
});
