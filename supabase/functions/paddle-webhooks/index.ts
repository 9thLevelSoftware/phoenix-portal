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
  mapPaddleStatusToSubscriptionStatus,
  type PaddleSubscriptionState,
  resolveBasePlanPriceId,
} from "../_shared/paddleSubscriptionState.ts";
import {
  classifySubscriptionEventTarget,
} from "../_shared/billingAction.ts";
import {
  classifyPaddleEventOrder,
  evaluatePaddleCustomDataTrust,
  verifyPaddleCustomDataSignature,
  verifyPaddleSignature,
} from "../_shared/paddleWebhookSecurity.ts";

const responseHeaders = {
  "Content-Type": "application/json",
};

/** The stored subscription columns this handler reads. */
export interface StoredSubscriptionRow {
  last_event_id?: string | null;
  last_event_occurred_at?: string | null;
  tier?: string | null;
  paddle_subscription_id?: string | null;
  status?: string | null;
  current_period_end?: string | null;
  cancel_at_period_end?: boolean | null;
}

export interface SubscriptionsTableQuery {
  select(columns: string): {
    eq(column: "user_id", value: string): {
      maybeSingle(): PromiseLike<{
        data: StoredSubscriptionRow | null;
        error: unknown;
      }>;
    };
  };
}

export interface SubscriptionEventsTableQuery {
  insert(values: Record<string, unknown>): PromiseLike<{ error: unknown }>;
}

/** The slice of the service-role client this handler uses. */
export interface PaddleWebhooksDbClient {
  from(table: "subscriptions"): SubscriptionsTableQuery;
  from(table: "subscription_events"): SubscriptionEventsTableQuery;
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
  /** Paddle API fetch (used to look for a second live subscription). */
  fetch: typeof fetch;
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
    fetch: (input, init) => fetch(input, init),
  };
}

/**
 * The customer's other live Paddle subscriptions, newest first.
 *
 * Used when the tracked subscription is cancelled: if the customer is still
 * paying for an untracked one, adopting it beats downgrading them (R-34).
 * Returns `null` when Paddle could not be asked at all.
 */
async function listLiveCustomerSubscriptions(
  {
    env,
    fetch: fetchImpl,
    customerId,
    excludeSubscriptionId,
  }: {
    env: { get(key: string): string | undefined };
    fetch: typeof fetch;
    customerId: string;
    excludeSubscriptionId: string;
  },
): Promise<PaddleSubscriptionState[] | null> {
  const apiKey = env.get("PADDLE_API_KEY");
  if (!apiKey) {
    console.warn(
      "[Paddle] PADDLE_API_KEY is not set — cannot look for an untracked subscription",
    );
    return null;
  }
  const baseUrl = env.get("PADDLE_ENVIRONMENT") === "sandbox"
    ? "https://sandbox-api.paddle.com"
    : "https://api.paddle.com";
  const url =
    `${baseUrl}/subscriptions?customer_id=${encodeURIComponent(customerId)}` +
    "&status=active,trialing,past_due";

  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
    });
  } catch (err) {
    console.error("[Paddle] Customer subscription listing failed:", err);
    return null;
  }
  if (!response.ok) {
    console.error(
      "[Paddle] Customer subscription listing failed:",
      response.status,
      await response.text(),
    );
    return null;
  }
  let body: { data?: PaddleSubscriptionState[] } | null = null;
  try {
    body = await response.json();
  } catch {
    console.error("[Paddle] Customer subscription listing returned non-JSON");
    return null;
  }
  return (body?.data ?? []).filter(
    (subscription) =>
      typeof subscription?.id === "string" &&
      subscription.id !== excludeSubscriptionId,
  );
}

// ─── Webhook Handler ────────────────────────────────────────────────────────

export function createPaddleWebhooksHandler(
  dependencies: PaddleWebhooksDependencies = defaultPaddleWebhooksDependencies(),
): (req: Request) => Promise<Response> {
  return (req) => paddleWebhooksHandler(req, dependencies);
}

async function paddleWebhooksHandler(
  req: Request,
  { env, createAdminClient, now, fetch: fetchImpl }: PaddleWebhooksDependencies,
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
    const webhookSecret = env.get("PADDLE_WEBHOOK_SECRET")?.trim();
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
      .select(
        "last_event_id, last_event_occurred_at, tier, paddle_subscription_id, status, current_period_end, cancel_at_period_end",
      )
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

    // A customer may hold more than one Paddle subscription, but the portal
    // keeps a single row per user. An event from an untracked subscription
    // must not revoke the access the tracked one grants (F-022).
    const incomingStatus = mapPaddleStatusToSubscriptionStatus(
      String(event.data.status ?? ""),
    );
    const eventTarget = classifySubscriptionEventTarget({
      incomingSubscriptionId: event.data.id,
      incomingStatus,
      storedRow: existingSubscription,
      now: new Date(now()),
    });
    if (eventTarget === "ignore_untracked_subscription") {
      console.error(
        "[BILLING_ALERT] foreign_subscription_event_ignored:",
        `event_id=${event.event_id}`,
        `event_type=${event.event_type}`,
        `user_id=${userId}`,
        `untracked_subscription_id=${event.data.id}`,
        `untracked_status=${incomingStatus}`,
        `tracked_subscription_id=${existingSubscription?.paddle_subscription_id}`,
      );
      // Audit the ignored subscription so PR 68's manual double-subscription
      // resolution has the id and status to work from. The same row is
      // written by public.apply_subscription_event when its own guard fires.
      const { error: noteError } = await supabase
        .from("subscription_events")
        .insert({
          user_id: userId,
          operation: "IGNORED",
          note: "untracked_subscription",
          status: incomingStatus,
          paddle_customer_id: event.data.customer_id ?? null,
          paddle_subscription_id: event.data.id ?? null,
          last_event_id: event.event_id,
          last_event_occurred_at: eventOrder.occurredAt,
          row_snapshot: {
            tracked_subscription_id:
              existingSubscription?.paddle_subscription_id ?? null,
            tracked_status: existingSubscription?.status ?? null,
            event_type: event.event_type,
          },
        });
      if (noteError) {
        console.error(
          "[BILLING_ALERT] Failed to record untracked_subscription note:",
          event.event_id,
          noteError,
        );
      }
      return new Response(
        JSON.stringify({ received: true, ignored: "untracked_subscription" }),
        { status: 200, headers: responseHeaders },
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

    // No lockout while the customer is still paying for an untracked
    // subscription (R-34): before letting a cancellation downgrade the user,
    // ask Paddle whether another subscription of theirs is still live.
    let untrackedSwitch: PaddleSubscriptionState | null = null;
    let untrackedSwitchTier = tier;
    let untrackedSwitchPriceId: string | undefined;
    const customerId = typeof event.data.customer_id === "string"
      ? event.data.customer_id
      : null;
    if (
      upsertData.status === "canceled" &&
      typeof event.data.id === "string" &&
      customerId
    ) {
      const liveSubscriptions = await listLiveCustomerSubscriptions({
        env,
        fetch: fetchImpl,
        customerId,
        excludeSubscriptionId: event.data.id,
      });
      if (liveSubscriptions === null) {
        console.warn(
          `[Paddle] Could not check for an untracked subscription before cancelling ${event.data.id}`,
        );
      } else if (liveSubscriptions.length > 0) {
        const candidate = liveSubscriptions[0]!;
        const candidatePriceId = resolveBasePlanPriceId(
          candidate,
          getAllAllowedPriceIds(env),
        );
        const candidateTier = mapPriceIdToTier(candidatePriceId, env);
        if (candidatePriceId && candidateTier === "FREE") {
          // An unknown price on the live subscription would downgrade the
          // user to FREE — worse than leaving the cancellation alone.
          console.error(
            "[BILLING_ALERT] Untracked live subscription has an unknown price ID; not adopting it:",
            candidatePriceId,
          );
        } else {
          untrackedSwitch = candidate;
          untrackedSwitchTier = candidateTier;
          untrackedSwitchPriceId = candidatePriceId;
        }
      }
    }

    // When a switch follows, the cancellation is recorded under a synthetic
    // event id: if the adoption fails, Paddle's redelivery must not be
    // dismissed as a duplicate.
    const applyEventId = untrackedSwitch
      ? `cancel:${event.data.id}:${eventOrder.occurredAt}`
      : event.event_id;

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
        p_last_event_id: applyEventId,
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

    if (untrackedSwitch) {
      // The tracked subscription is gone but the customer is still paying for
      // another one. Adopt it in the same delivery so they are never locked
      // out of a plan they are being charged for (R-34). The cancellation
      // above cleared the entitlement, which is what lets this second apply
      // past the untracked-subscription guard.
      const switchOccurredAt = new Date(
        Math.max(
          Date.parse(untrackedSwitch.updated_at ?? "") || 0,
          Date.parse(eventOrder.occurredAt) + 1000,
        ),
      ).toISOString();
      const switchUpsert = buildSubscriptionUpsertFromPaddleState({
        userId,
        subscription: untrackedSwitch,
        tier: untrackedSwitchTier,
        priceId: untrackedSwitchPriceId,
        eventId: event.event_id,
        occurredAt: switchOccurredAt,
      });
      const { data: switchApplied, error: switchError } = await supabase.rpc(
        "apply_subscription_event",
        {
          p_user_id: userId,
          p_paddle_customer_id:
            (switchUpsert.paddle_customer_id as string | null) ?? null,
          p_paddle_subscription_id:
            (switchUpsert.paddle_subscription_id as string | null) ?? null,
          p_tier: switchUpsert.tier as string,
          p_status: switchUpsert.status as string,
          p_price_id: (switchUpsert.price_id as string | null) ?? null,
          p_current_period_start:
            (switchUpsert.current_period_start as string | null) ?? null,
          p_current_period_end:
            (switchUpsert.current_period_end as string | null) ?? null,
          p_cancel_at_period_end: Boolean(switchUpsert.cancel_at_period_end),
          p_last_event_id: event.event_id,
          p_last_event_occurred_at: switchOccurredAt,
        },
      );
      if (switchError || switchApplied === false) {
        console.error(
          "[BILLING_ALERT] switch_to_untracked_subscription_failed:",
          `event_id=${event.event_id}`,
          `user_id=${userId}`,
          `untracked_subscription_id=${untrackedSwitch.id}`,
          switchError ?? "guard rejected the write",
        );
        // 500 so Paddle redelivers: the cancellation above recorded a
        // synthetic event id, so the redelivery is not a duplicate and the
        // switch is retried.
        return new Response(
          JSON.stringify({ error: "Failed to adopt live subscription" }),
          { status: 500, headers: responseHeaders },
        );
      }
      console.error(
        "[BILLING_ALERT] switched_to_untracked_subscription:",
        `event_id=${event.event_id}`,
        `user_id=${userId}`,
        `canceled_subscription_id=${event.data.id}`,
        `adopted_subscription_id=${untrackedSwitch.id}`,
        `adopted_status=${switchUpsert.status}`,
      );
      return new Response(
        JSON.stringify({ received: true, switchedToUntrackedSubscription: true }),
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
