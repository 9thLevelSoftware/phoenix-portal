import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  findCrossTierDuplicatePriceIds,
  getAllAllowedPriceIds,
  mapPriceIdToTier,
  paddlePriceIdsConfigured,
} from "../_shared/paddlePriceIds.ts";
import { paddleWebhookResponseForCustomUserId } from "../_shared/paddleWebhookUserId.ts";
import {
  buildSubscriptionUpsertFromPaddleState,
  type PaddleSubscriptionState,
  resolveBasePlanPriceId,
} from "../_shared/paddleSubscriptionState.ts";
import {
  classifyPaddleEventOrder,
  evaluatePaddleCustomDataTrust,
  verifyPaddleCustomDataSignature,
  verifyPaddleSignature,
} from "../_shared/paddleWebhookSecurity.ts";

const responseHeaders = {
  "Content-Type": "application/json",
};

/** The slice of the service-role client this handler uses. */
export interface PaddleWebhooksDbClient {
  from(table: "subscriptions"): {
    select(columns: string): {
      eq(column: "user_id", value: string): {
        maybeSingle(): PromiseLike<{
          data: {
            last_event_id?: string | null;
            last_event_occurred_at?: string | null;
            tier?: string | null;
            paddle_subscription_id?: string | null;
          } | null;
          error: unknown;
        }>;
      };
    };
  };
  rpc(
    fn: "apply_subscription_event",
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: unknown }>;
}

export interface PaddleWebhooksDependencies {
  env: { get(key: string): string | undefined };
  createAdminClient(): PaddleWebhooksDbClient;
  /** Clock for the signature replay window (ms since epoch). */
  now(): number;
}

function defaultPaddleWebhooksDependencies(): PaddleWebhooksDependencies {
  let client: PaddleWebhooksDbClient | undefined;
  return {
    env: Deno.env,
    createAdminClient() {
      client ??= createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      ) as unknown as PaddleWebhooksDbClient;
      return client;
    },
    now() {
      return Date.now();
    },
  };
}

// ─── Webhook Handler ────────────────────────────────────────────────────────

export function createPaddleWebhooksHandler(
  dependencies: PaddleWebhooksDependencies = defaultPaddleWebhooksDependencies(),
): (req: Request) => Promise<Response> {
  return (req) => paddleWebhooksHandler(req, dependencies);
}

async function paddleWebhooksHandler(
  req: Request,
  { env, createAdminClient, now }: PaddleWebhooksDependencies,
): Promise<Response> {
  // Only accept POST
  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      { status: 405, headers: responseHeaders },
    );
  }

  try {
    if (!paddlePriceIdsConfigured(env)) {
      console.error(
        "[FATAL] PADDLE_EMBER_PRICE_IDS, PADDLE_FLAME_PRICE_IDS, and PADDLE_INFERNO_PRICE_IDS must all be set",
      );
      return new Response(
        JSON.stringify({ error: "Billing configuration incomplete" }),
        { status: 500, headers: responseHeaders },
      );
    }
    const duplicatePriceIds = findCrossTierDuplicatePriceIds(env);
    if (duplicatePriceIds.length > 0) {
      console.error(
        "[FATAL] Paddle price ID configured under multiple tiers (would map to wrong tier by precedence):",
        duplicatePriceIds,
      );
      return new Response(
        JSON.stringify({ error: "Billing configuration invalid" }),
        { status: 500, headers: responseHeaders },
      );
    }
    const customDataSecret = env.get("PADDLE_CUSTOM_DATA_SECRET")?.trim();
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
    const webhookSecret = env.get("PADDLE_WEBHOOK_SECRET");
    const signatureHeader = req.headers.get("Paddle-Signature");

    if (!webhookSecret || !signatureHeader) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: responseHeaders },
      );
    }

    const isValid = await verifyPaddleSignature(rawBody, signatureHeader, webhookSecret, {
      now,
    });
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

    // Extract user_id from custom_data. HMAC is already valid here.
    // Missing user_id is unbindable — 200 ignored so Paddle does not retry.
    // Malformed UUID stays 400. DB failures later still return 500.
    const userIdBinding = paddleWebhookResponseForCustomUserId(
      event.data.custom_data?.user_id,
      responseHeaders,
    );
    if (userIdBinding.kind === "response") {
      if (userIdBinding.response.status === 200) {
        console.warn(
          "[Paddle] Ignoring event with missing custom_data.user_id:",
          event.event_id,
          "event_type:",
          event.event_type,
        );
      } else {
        console.error(
          "[BILLING_ALERT] Malformed custom_data.user_id in Paddle event:",
          event.event_id,
        );
      }
      return userIdBinding.response;
    }
    const userId = userIdBinding.userId;

    // Load the existing row before custom_data trust checks. New checkouts must
    // carry cd_sig; legacy subscriptions may omit it only when the Paddle
    // subscription ID already matches the stored row for the same user.
    const supabase = createAdminClient();
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

    const priceId = resolveBasePlanPriceId(
      event.data as PaddleSubscriptionState,
      getAllAllowedPriceIds(env),
    );
    let tier = mapPriceIdToTier(priceId, env);

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

    // Apply atomically with an ordering guard: the RPC only writes when this
    // event is strictly newer than the stored last_event_occurred_at, closing
    // the read-then-upsert race between concurrent deliveries (F264).
    const { data: applied, error } = await supabase.rpc(
      "apply_subscription_event",
      {
        p_user_id: userId,
        p_paddle_customer_id:
          (upsertData.paddle_customer_id as string | null) ?? null,
        p_paddle_subscription_id:
          (upsertData.paddle_subscription_id as string | null) ?? null,
        p_tier: upsertData.tier as string,
        p_status: upsertData.status as string,
        p_price_id: (upsertData.price_id as string | null) ?? null,
        p_current_period_start:
          (upsertData.current_period_start as string | null) ?? null,
        p_current_period_end:
          (upsertData.current_period_end as string | null) ?? null,
        p_cancel_at_period_end: Boolean(upsertData.cancel_at_period_end),
        p_last_event_id: event.event_id,
        p_last_event_occurred_at: eventOrder.occurredAt,
      },
    );

    if (error) {
      console.error(`[BILLING_ALERT] Error applying subscription event for ${event.event_type}:`, error);
      return new Response(
        JSON.stringify({ error: "Database upsert failed" }),
        { status: 500, headers: responseHeaders },
      );
    }

    if (applied === false) {
      // A concurrent, newer event won the ordering race at write time.
      console.warn(
        `[Paddle] Skipped stale event ${event.event_id} at write time (lost ordering race)`,
      );
      return new Response(
        JSON.stringify({ received: true, stale: true }),
        { status: 200, headers: responseHeaders },
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
}

if (import.meta.main) {
  Deno.serve(createPaddleWebhooksHandler());
}
