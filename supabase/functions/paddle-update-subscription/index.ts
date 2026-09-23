import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { checkRateLimit } from "../_shared/rateLimit.ts";
import {
  findCrossTierDuplicatePriceIds,
  getConfiguredPriceIdForTierInterval,
  getAllAllowedPriceIds,
  mapPriceIdToTier,
  paddlePriceIdsConfigured,
  parsePaddleBillingInterval,
  parsePaddlePaidTier,
} from "../_shared/paddlePriceIds.ts";
import {
  applySubscriptionEvent,
  buildSubscriptionUpsertFromPaddleState,
  type PaddleSubscriptionState,
  paddleEventOccurredAt,
  resolveBasePlanPriceId,
  syntheticSubscriptionEventId,
} from "../_shared/paddleSubscriptionState.ts";
import {
  buildPaddleSubscriptionPatch,
  checkoutRequiredResponseBody,
} from "../_shared/paddleSubscriptionUpdate.ts";
import { billingAction } from "../_shared/billingAction.ts";

/** Anything with `get(key)`, e.g. `Deno.env`. */
export interface EnvReader {
  get(key: string): string | undefined;
}

export interface PaddleUpdateSubscriptionHandlerDependencies {
  /** User-scoped client used only for `auth.getUser()`. */
  createAuthClient(authorization: string): Pick<SupabaseClient, "auth">;
  /** Service-role client for DB queries (bypasses RLS). */
  createAdminClient(): SupabaseClient;
  /** Paddle API fetch. */
  fetch: typeof fetch;
  env: EnvReader;
  now(): Date;
}

function defaultPaddleUpdateSubscriptionHandlerDependencies(): PaddleUpdateSubscriptionHandlerDependencies {
  return {
    createAuthClient(authorization: string) {
      return createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_ANON_KEY")!,
        { global: { headers: { Authorization: authorization } } },
      );
    },
    createAdminClient() {
      return createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      );
    },
    fetch: (input, init) => fetch(input, init),
    env: Deno.env,
    now: () => new Date(),
  };
}

async function paddleUpdateSubscriptionHandler(
  req: Request,
  deps: PaddleUpdateSubscriptionHandlerDependencies,
): Promise<Response> {
  const supabaseAdmin = deps.createAdminClient();
  const cors = getCorsHeaders(req);

  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: cors });
  }

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      { status: 405, headers: { ...cors, "Content-Type": "application/json" } },
    );
  }

  try {
    if (!paddlePriceIdsConfigured(deps.env)) {
      console.error(
        "[FATAL] PADDLE_EMBER_PRICE_IDS, PADDLE_FLAME_PRICE_IDS, and PADDLE_INFERNO_PRICE_IDS must all be set",
      );
      return new Response(
        JSON.stringify({ error: "Billing configuration incomplete" }),
        { status: 500, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    const duplicatePriceIds = findCrossTierDuplicatePriceIds(deps.env);
    if (duplicatePriceIds.length > 0) {
      console.error(
        "[FATAL] Paddle price ID configured under multiple tiers (would map to wrong tier by precedence):",
        duplicatePriceIds,
      );
      return new Response(
        JSON.stringify({ error: "Billing configuration invalid" }),
        { status: 500, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    const ALLOWED_PRICE_IDS = getAllAllowedPriceIds(deps.env);

    // Authenticate the user via their JWT
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Not authenticated" }),
        { status: 401, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }
    const supabase = deps.createAuthClient(authHeader);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return new Response(
        JSON.stringify({ error: "Not authenticated" }),
        { status: 401, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    // Rate limit: 3 requests per minute per user
    const rateCheck = await checkRateLimit(supabaseAdmin, {
      key: "paddle-update-subscription",
      userId: user.id,
      maxRequests: 3,
      windowSeconds: 60,
    }, cors);
    if (!rateCheck.allowed) return rateCheck.response!;

    // Look up user's current subscription FIRST: the billing action decides
    // whether a plan selection is needed at all (update_payment and refresh
    // carry none).
    const { data: sub, error: subError } = await supabaseAdmin
      .from("subscriptions")
      .select("paddle_subscription_id, price_id, tier, status, current_period_end, cancel_at_period_end")
      .eq("user_id", user.id)
      .maybeSingle();

    if (subError) {
      console.error("Error fetching subscription:", subError);
      return new Response(
        JSON.stringify({ error: "Failed to fetch subscription" }),
        { status: 500, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    // Paddle API config, needed by both the update-payment route and the
    // plan change below.
    const paddleEnv = deps.env.get("PADDLE_ENVIRONMENT") ?? "production";
    const baseUrl = paddleEnv === "sandbox"
      ? "https://sandbox-api.paddle.com"
      : "https://api.paddle.com";
    const apiKey = deps.env.get("PADDLE_API_KEY");

    if (!apiKey) {
      console.error("PADDLE_API_KEY is not set");
      return new Response(
        JSON.stringify({ error: "Billing service not configured" }),
        { status: 500, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    // One shared predicate (R-11): `checkout_required` is returned exactly
    // when paddle-checkout-custom-data would sign a new checkout, so no state
    // can be told to check out and then be refused the checkout.
    const action = billingAction(sub, deps.now());
    if (action.action === "checkout") {
      return new Response(
        JSON.stringify(checkoutRequiredResponseBody(action.reason)),
        { status: 200, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }
    if (action.action === "refresh") {
      // A live subscription whose stored state has lapsed (e.g. the renewal
      // webhook is late). Ask Paddle for the truth instead of selling the
      // user a second subscription (F-022).
      return new Response(
        JSON.stringify({
          action: "refresh",
          code: "refresh_required",
          message: "Refreshing your plan…",
          reason: action.reason,
        }),
        { status: 200, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }
    if (!sub || !action.paddleSubscriptionId) {
      // Unreachable: manage/refresh both require a stored subscription id.
      throw new Error("billing action proceeded without a subscription row");
    }
    const currentPaddleSubscriptionId = action.paddleSubscriptionId;

    if (action.needsPaymentUpdate) {
      // past_due keeps full access (user decision, R-33). Paddle refuses item
      // changes while a subscription is past due, so hand the client the
      // transaction that updates the card instead.
      const transactionResponse = await deps.fetch(
        `${baseUrl}/subscriptions/${currentPaddleSubscriptionId}/update-payment-method-transaction`,
        {
          method: "GET",
          headers: {
            "Authorization": `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
        },
      );
      if (!transactionResponse.ok) {
        const transactionError = await transactionResponse.text();
        console.error(
          "Paddle update-payment-method transaction failed:",
          transactionResponse.status,
          transactionError,
        );
        return new Response(
          JSON.stringify({
            error: "Failed to start a payment update",
            code: "paddle_update_payment_failed",
          }),
          { status: 502, headers: { ...cors, "Content-Type": "application/json" } },
        );
      }
      let transactionBody: Record<string, unknown> | null = null;
      try {
        transactionBody = await transactionResponse.json();
      } catch {
        transactionBody = null;
      }
      const transactionId =
        (transactionBody?.data as { id?: unknown } | undefined)?.id;
      if (typeof transactionId !== "string" || transactionId.length === 0) {
        console.error("Paddle update-payment-method response missing data.id");
        return new Response(
          JSON.stringify({ error: "Invalid Paddle response" }),
          { status: 502, headers: { ...cors, "Content-Type": "application/json" } },
        );
      }
      return new Response(
        JSON.stringify({
          action: "update_payment",
          transactionId,
          message:
            "Your last payment failed — update your card to keep your plan.",
        }),
        { status: 200, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    // Parse request body
    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return new Response(
        JSON.stringify({ error: "Invalid JSON body" }),
        { status: 400, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }
    const fallbackPriceId = body.price_id;
    const requestedTier = parsePaddlePaidTier(body.tier);
    const requestedBillingInterval = parsePaddleBillingInterval(body.billing_interval);
    const serverResolvedPriceId = requestedTier && requestedBillingInterval
      ? getConfiguredPriceIdForTierInterval(
        requestedTier,
        requestedBillingInterval,
        deps.env,
      )
      : null;
    const newPriceId = serverResolvedPriceId ||
      (typeof fallbackPriceId === "string" ? fallbackPriceId : null);

    if (!newPriceId || newPriceId.length > 255) {
      return new Response(
        JSON.stringify({
          error: "Missing or invalid plan selection",
          code: "invalid_plan_selection",
          message: "Choose a valid paid plan and billing interval.",
        }),
        { status: 400, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    // Validate price_id against allowed set (PADDLE_*_PRICE_IDS)
    if (!ALLOWED_PRICE_IDS.has(newPriceId)) {
      console.warn("Invalid price_id attempted:", newPriceId);
      return new Response(
        JSON.stringify({
          error: "Invalid price_id",
          code: "invalid_price_id",
          message:
            "Billing price is not configured for this environment. Check Paddle price ID secrets.",
        }),
        { status: 400, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    // Fetch the authoritative current subscription so we can (a) carry forward
    // add-ons/metered items on a plan switch and (b) reconcile against Paddle's
    // current item state rather than a possibly-stale local price_id.
    const currentSubResponse = await deps.fetch(
      `${baseUrl}/subscriptions/${currentPaddleSubscriptionId}`,
      {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
      },
    );

    let currentItems: PaddleSubscriptionState["items"] = undefined;
    let authoritativeCurrentPriceId: string | null = sub.price_id;
    if (currentSubResponse.ok) {
      let currentBody: Record<string, unknown> | null = null;
      try {
        currentBody = await currentSubResponse.json();
      } catch {
        console.error("Paddle API returned non-JSON subscription response");
        return new Response(
          JSON.stringify({ error: "Invalid Paddle response" }),
          { status: 502, headers: { ...cors, "Content-Type": "application/json" } },
        );
      }
      const currentSub = currentBody?.data as PaddleSubscriptionState | undefined;
      if (currentSub?.items) {
        currentItems = currentSub.items;
        authoritativeCurrentPriceId = resolveBasePlanPriceId(
          currentSub,
          ALLOWED_PRICE_IDS,
        ) || sub.price_id;
      }
    } else {
      // Non-fatal: fall back to local price_id. Log the raw error server-side.
      const fetchError = await currentSubResponse.text();
      console.error(
        "Paddle current subscription fetch failed:",
        currentSubResponse.status,
        fetchError,
      );
    }

    const patchDecision = buildPaddleSubscriptionPatch(
      authoritativeCurrentPriceId,
      newPriceId,
      Boolean(sub.cancel_at_period_end),
      currentItems,
    );
    if (patchDecision.action === "already_current") {
      return new Response(
        JSON.stringify({ error: "Already on this plan" }),
        { status: 400, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    const paddleResponse = await deps.fetch(
      `${baseUrl}/subscriptions/${currentPaddleSubscriptionId}`,
      {
        method: "PATCH",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(patchDecision.body),
      },
    );

    if (!paddleResponse.ok) {
      const paddleError = await paddleResponse.text();
      console.error("Paddle API error:", paddleResponse.status, paddleError);
      return new Response(
        JSON.stringify({
          error: "Failed to update subscription",
          code: "paddle_update_failed",
        }),
        { status: 502, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    let paddleBody: Record<string, unknown> | null = null;
    try {
      paddleBody = await paddleResponse.json();
    } catch {
      console.error("Paddle API returned non-JSON update response");
      return new Response(
        JSON.stringify({ error: "Invalid Paddle response" }),
        { status: 502, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    const updatedSubscription = paddleBody?.data as PaddleSubscriptionState | undefined;
    if (!updatedSubscription?.id) {
      console.error("Paddle subscription update response missing data.id");
      return new Response(
        JSON.stringify({ error: "Invalid Paddle response" }),
        { status: 502, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    if (updatedSubscription.id !== currentPaddleSubscriptionId) {
      console.error(
        "[BILLING_ALERT] Paddle update response subscription mismatch:",
        updatedSubscription.id,
        currentPaddleSubscriptionId,
      );
      return new Response(
        JSON.stringify({ error: "Paddle subscription mismatch" }),
        { status: 502, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    const updatedPriceId =
      resolveBasePlanPriceId(updatedSubscription, ALLOWED_PRICE_IDS) || newPriceId;
    let updatedTier = mapPriceIdToTier(updatedPriceId, deps.env);
    if (updatedPriceId && updatedTier === "FREE") {
      const existingTier = sub.tier as string | undefined;
      if (existingTier && existingTier !== "FREE" && existingTier !== "free") {
        console.warn(
          `[BILLING_ALERT] Unknown price ID ${updatedPriceId} after update — preserving existing tier ${existingTier}`,
        );
        updatedTier = existingTier as typeof updatedTier;
      } else {
        console.error(
          "[BILLING_ALERT] Unknown price ID after update — no existing tier to preserve:",
          updatedPriceId,
        );
        return new Response(
          JSON.stringify({ error: "Unknown price_id — configuration error" }),
          { status: 500, headers: { ...cors, "Content-Type": "application/json" } },
        );
      }
    }

    // Every write goes through `public.apply_subscription_event` — the one
    // ordered, guarded writer — never a direct `.upsert`/`.update`. Paddle's
    // own `updated_at` is the clock, so an update response older than an event
    // already stored (a renewal webhook that landed first) cannot regress the
    // row (same rule as paddle-cancel-subscription).
    const occurredAt = paddleEventOccurredAt(updatedSubscription, deps.now());
    const upsertData = buildSubscriptionUpsertFromPaddleState({
      userId: user.id,
      subscription: updatedSubscription,
      tier: updatedTier,
      priceId: updatedPriceId,
      eventId: syntheticSubscriptionEventId(
        "update",
        updatedSubscription.id,
        occurredAt,
      ),
      occurredAt,
    });
    const write = await applySubscriptionEvent(supabaseAdmin, upsertData, {
      storedSubscriptionId: sub.paddle_subscription_id,
    });

    // On a refused write the client must copy the STORED row into its cache,
    // not the state we just fetched: that state never landed.
    const storedSubscriptionView = {
      tier: sub.tier,
      status: sub.status,
      priceId: sub.price_id,
      currentPeriodEnd: sub.current_period_end,
      cancelAtPeriodEnd: sub.cancel_at_period_end,
    };
    const updatedSubscriptionView = {
      tier: upsertData.tier,
      status: upsertData.status,
      priceId: upsertData.price_id,
      currentPeriodEnd: upsertData.current_period_end,
      cancelAtPeriodEnd: upsertData.cancel_at_period_end,
    };

    if (write.outcome === "already_bound") {
      // 23505: this Paddle subscription is already bound to another user.
      return new Response(
        JSON.stringify({
          error: "Subscription already bound to another account",
          code: "subscription_already_bound",
        }),
        { status: 409, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }
    if (write.outcome === "stale" || write.outcome === "untracked_subscription") {
      // A newer event already wrote the row, or the untracked-subscription
      // guard refused it. Report the stored state and let the caller refresh.
      console.warn(
        "[Paddle] Update state not stored:",
        write.outcome,
        updatedSubscription.id,
      );
      return new Response(
        JSON.stringify({
          applied: false,
          reason: "stale",
          subscription: storedSubscriptionView,
        }),
        { status: 200, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }
    if (write.outcome === "error") {
      // `write.error` is raw database text. Log it, never return it.
      console.error("Error persisting subscription after Paddle update:", write.error);
      return new Response(
        JSON.stringify({ error: "Database upsert failed" }),
        { status: 500, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        action: patchDecision.action,
        subscription: updatedSubscriptionView,
      }),
      { status: 200, headers: { ...cors, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("paddle-update-subscription error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...cors, "Content-Type": "application/json" } },
    );
  }
}

export function createPaddleUpdateSubscriptionHandler(
  deps: PaddleUpdateSubscriptionHandlerDependencies = defaultPaddleUpdateSubscriptionHandlerDependencies(),
): (req: Request) => Promise<Response> {
  return (req) => paddleUpdateSubscriptionHandler(req, deps);
}

if (import.meta.main) {
  Deno.serve(createPaddleUpdateSubscriptionHandler());
}
