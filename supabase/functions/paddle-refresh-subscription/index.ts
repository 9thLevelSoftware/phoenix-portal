import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { checkRateLimit } from "../_shared/rateLimit.ts";
import {
  findCrossTierDuplicatePriceIds,
  getAllAllowedPriceIds,
  mapPriceIdToTier,
  paddlePriceIdsConfigured,
} from "../_shared/paddlePriceIds.ts";
import {
  applySubscriptionEvent,
  buildSubscriptionUpsertFromPaddleState,
  type PaddleSubscriptionState,
  paddleEventOccurredAt,
  resolveBasePlanPriceId,
  type SubscriptionEventWriteResult,
  syntheticSubscriptionEventId,
} from "../_shared/paddleSubscriptionState.ts";
import { verifyPaddleCustomDataSignature } from "../_shared/paddleWebhookSecurity.ts";

/** Anything with `get(key)`, e.g. `Deno.env`. */
export interface EnvReader {
  get(key: string): string | undefined;
}

export interface PaddleRefreshSubscriptionHandlerDependencies {
  /** User-scoped client used only for `auth.getUser()`. */
  createAuthClient(authorization: string): Pick<SupabaseClient, "auth">;
  /** Service-role client for DB queries (bypasses RLS). */
  createAdminClient(): SupabaseClient;
  /** Paddle API fetch. */
  fetch: typeof fetch;
  env: EnvReader;
  now(): Date;
}

function defaultPaddleRefreshSubscriptionHandlerDependencies(): PaddleRefreshSubscriptionHandlerDependencies {
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

interface PaddleTransactionState {
  id: string;
  subscription_id?: string | null;
  custom_data?: {
    user_id?: string | null;
    cd_sig?: string | null;
  } | null;
}

/** The columns the refresh reads, writes back and reports to the client. */
interface StoredSubscriptionRow {
  paddle_subscription_id: string | null;
  paddle_customer_id: string | null;
  tier: string | null;
  status: string | null;
  price_id: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean | null;
}

const STORED_SUBSCRIPTION_COLUMNS =
  "paddle_subscription_id, paddle_customer_id, tier, status, price_id, current_period_end, cancel_at_period_end";

function parsePaddleTransactionId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return /^txn_[a-z0-9]{26}$/.test(trimmed) ? trimmed : null;
}

function subscriptionPayload(
  fields: {
    status: unknown;
    tier: unknown;
    priceId: unknown;
    currentPeriodEnd: unknown;
    cancelAtPeriodEnd: unknown;
  },
) {
  return {
    status: fields.status,
    tier: fields.tier,
    priceId: fields.priceId,
    price_id: fields.priceId,
    currentPeriodEnd: fields.currentPeriodEnd,
    current_period_end: fields.currentPeriodEnd,
    cancelAtPeriodEnd: fields.cancelAtPeriodEnd,
    cancel_at_period_end: fields.cancelAtPeriodEnd,
  };
}

/**
 * The write was deliberately not applied (a newer event already wrote the
 * row, or the guard refused an untracked subscription). Report the row as it
 * actually stands: the client copies `subscription` straight into its cache,
 * so returning the state we fetched from Paddle would show the user something
 * the database does not hold.
 */
async function notAppliedResponse(
  supabaseAdmin: SupabaseClient,
  userId: string,
  write: SubscriptionEventWriteResult,
  fallback: StoredSubscriptionRow,
  cors: Record<string, string>,
): Promise<Response> {
  const { data } = await supabaseAdmin
    .from("subscriptions")
    .select(STORED_SUBSCRIPTION_COLUMNS)
    .eq("user_id", userId)
    .maybeSingle();
  const row = (data as StoredSubscriptionRow | null) ?? fallback;

  return new Response(
    JSON.stringify({
      status: "refreshed",
      applied: false,
      reason: write.outcome,
      subscription: subscriptionPayload({
        status: row.status ?? "none",
        tier: row.tier ?? "FREE",
        priceId: row.price_id ?? null,
        currentPeriodEnd: row.current_period_end ?? null,
        cancelAtPeriodEnd: Boolean(row.cancel_at_period_end),
      }),
    }),
    { status: 200, headers: { ...cors, "Content-Type": "application/json" } },
  );
}

async function paddleRefreshSubscriptionHandler(
  req: Request,
  deps: PaddleRefreshSubscriptionHandlerDependencies,
): Promise<Response> {
  const supabaseAdmin = deps.createAdminClient();
  const cors = getCorsHeaders(req);

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
    let requestBody: Record<string, unknown> = {};
    try {
      const rawBody = await req.text();
      if (rawBody.trim()) {
        const parsedBody = JSON.parse(rawBody);
        if (
          !parsedBody ||
          typeof parsedBody !== "object" ||
          Array.isArray(parsedBody)
        ) {
          throw new Error("Body must be an object");
        }
        requestBody = parsedBody;
      }
    } catch {
      return new Response(
        JSON.stringify({ error: "Invalid JSON body" }),
        { status: 400, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }
    const requestedTransactionId = requestBody.transaction_id === undefined
      ? null
      : parsePaddleTransactionId(requestBody.transaction_id);
    if (requestBody.transaction_id !== undefined && !requestedTransactionId) {
      return new Response(
        JSON.stringify({ error: "Invalid transaction_id" }),
        { status: 400, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    if (!paddlePriceIdsConfigured(deps.env)) {
      console.error("[FATAL] Paddle price IDs are not configured");
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

    const rateCheck = await checkRateLimit(supabaseAdmin, {
      key: "paddle-refresh-subscription",
      userId: user.id,
      maxRequests: 10,
      windowSeconds: 60,
    }, cors);
    if (!rateCheck.allowed) return rateCheck.response!;

    const apiKey = deps.env.get("PADDLE_API_KEY");
    if (!apiKey) {
      console.error("PADDLE_API_KEY is not set");
      return new Response(
        JSON.stringify({ error: "Billing service not configured" }),
        { status: 500, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    const paddleEnv = deps.env.get("PADDLE_ENVIRONMENT") ?? "production";
    const baseUrl = paddleEnv === "sandbox"
      ? "https://sandbox-api.paddle.com"
      : "https://api.paddle.com";

    const { data: storedSubscription, error: subError } = await supabaseAdmin
      .from("subscriptions")
      // The ordered writer rewrites the whole row, so every column it writes
      // has to be read first — `paddle_customer_id` above all, which the
      // Paddle-404 path carries forward rather than nulling.
      .select(STORED_SUBSCRIPTION_COLUMNS)
      .eq("user_id", user.id)
      .maybeSingle();

    if (subError) {
      console.error("Error fetching local subscription:", subError);
      return new Response(
        JSON.stringify({ error: "Failed to fetch subscription" }),
        { status: 500, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    const localSubscription = storedSubscription as StoredSubscriptionRow | null;
    const storedSubscriptionId = localSubscription?.paddle_subscription_id ?? null;
    let paddleSubscriptionId = storedSubscriptionId;
    let existingTier = localSubscription?.tier ?? undefined;

    if (requestedTransactionId) {
      const transactionResponse = await deps.fetch(
        `${baseUrl}/transactions/${requestedTransactionId}`,
        {
          method: "GET",
          headers: {
            "Authorization": `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
        },
      );

      if (!transactionResponse.ok) {
        const paddleError = await transactionResponse.text();
        console.error(
          "Paddle transaction API error:",
          transactionResponse.status,
          paddleError,
        );
        return new Response(
          JSON.stringify({ error: "Failed to refresh subscription" }),
          { status: 502, headers: { ...cors, "Content-Type": "application/json" } },
        );
      }

      let transactionBody: Record<string, unknown> | null = null;
      try {
        transactionBody = await transactionResponse.json();
      } catch {
        console.error("Paddle transaction API returned non-JSON response");
        return new Response(
          JSON.stringify({ error: "Invalid Paddle response" }),
          { status: 502, headers: { ...cors, "Content-Type": "application/json" } },
        );
      }
      const transaction = transactionBody?.data as PaddleTransactionState | undefined;
      if (!transaction?.id || transaction.id !== requestedTransactionId) {
        console.error("Paddle transaction response missing or mismatched data.id");
        return new Response(
          JSON.stringify({ error: "Invalid Paddle response" }),
          { status: 502, headers: { ...cors, "Content-Type": "application/json" } },
        );
      }

      if (transaction.custom_data?.user_id !== user.id) {
        console.error(
          "[BILLING_ALERT] Paddle transaction custom_data.user_id mismatch:",
          requestedTransactionId,
        );
        return new Response(
          JSON.stringify({ error: "Transaction does not belong to user" }),
          { status: 403, headers: { ...cors, "Content-Type": "application/json" } },
        );
      }

      const customDataSecret = deps.env.get("PADDLE_CUSTOM_DATA_SECRET")?.trim();
      if (!customDataSecret) {
        console.error("[FATAL] PADDLE_CUSTOM_DATA_SECRET must be set");
        return new Response(
          JSON.stringify({ error: "Billing custom_data signing is not configured" }),
          { status: 500, headers: { ...cors, "Content-Type": "application/json" } },
        );
      }
      const signedCustomDataValid = await verifyPaddleCustomDataSignature(
        user.id,
        transaction.custom_data?.cd_sig,
        customDataSecret,
      );
      if (!signedCustomDataValid) {
        console.error(
          "[BILLING_ALERT] Invalid cd_sig on Paddle transaction:",
          requestedTransactionId,
        );
        return new Response(
          JSON.stringify({ error: "Invalid transaction signature" }),
          { status: 403, headers: { ...cors, "Content-Type": "application/json" } },
        );
      }

      if (!transaction.subscription_id) {
        return new Response(
          JSON.stringify({ status: "no_subscription", reason: "transaction_pending" }),
          { status: 200, headers: { ...cors, "Content-Type": "application/json" } },
        );
      }

      paddleSubscriptionId = transaction.subscription_id;
      existingTier = undefined;
    }

    if (!paddleSubscriptionId) {
      return new Response(
        JSON.stringify({ status: "no_subscription" }),
        { status: 200, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    const fallbackRow: StoredSubscriptionRow = localSubscription ?? {
      paddle_subscription_id: null,
      paddle_customer_id: null,
      tier: "FREE",
      status: "none",
      price_id: null,
      current_period_end: null,
      cancel_at_period_end: false,
    };

    const paddleResponse = await deps.fetch(
      `${baseUrl}/subscriptions/${paddleSubscriptionId}`,
      {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
      },
    );

    if (paddleResponse.status === 404) {
      console.error(
        "[BILLING_ALERT] Paddle subscription not found (404), clearing provider identifiers:",
        paddleSubscriptionId,
      );
      // Clear the provider identifiers and price so future refresh/cancel/update
      // paths do not keep targeting a Paddle subscription that no longer exists,
      // and so stale price data is not left attached to a canceled row.
      //
      // This is the one write with no Paddle state behind it: there is no
      // subscription to read an `updated_at` from, so the local clock orders
      // it, and `paddle_subscription_id` is written as NULL rather than as the
      // id that just 404'd. A NULL id never trips the untracked-subscription
      // guard, so the clearing always reaches the ordering check.
      const occurredAt = deps.now().toISOString();
      const write = await applySubscriptionEvent(supabaseAdmin, {
        user_id: user.id,
        paddle_customer_id: localSubscription?.paddle_customer_id ?? null,
        paddle_subscription_id: null,
        tier: localSubscription?.tier ?? "FREE",
        status: "canceled",
        price_id: null,
        current_period_start: null,
        current_period_end: null,
        cancel_at_period_end: false,
        last_event_id: syntheticSubscriptionEventId(
          "refresh",
          paddleSubscriptionId,
          occurredAt,
        ),
        last_event_occurred_at: occurredAt,
      }, { storedSubscriptionId });

      if (write.outcome === "error" || write.outcome === "already_bound") {
        console.error("Error marking missing Paddle subscription canceled:", write.error);
        return new Response(
          JSON.stringify({ error: "Database update failed" }),
          { status: 500, headers: { ...cors, "Content-Type": "application/json" } },
        );
      }

      if (write.outcome !== "applied") {
        console.warn(
          "[Paddle] Missing-subscription cleanup not stored: a newer event already wrote the row",
          paddleSubscriptionId,
        );
        return await notAppliedResponse(
          supabaseAdmin,
          user.id,
          write,
          fallbackRow,
          cors,
        );
      }

      return new Response(
        JSON.stringify({
          status: "refreshed",
          subscription: subscriptionPayload({
            status: "canceled",
            tier: localSubscription?.tier ?? "FREE",
            priceId: null,
            currentPeriodEnd: null,
            cancelAtPeriodEnd: false,
          }),
        }),
        { status: 200, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    if (!paddleResponse.ok) {
      const paddleError = await paddleResponse.text();
      console.error("Paddle API error:", paddleResponse.status, paddleError);
      return new Response(
        JSON.stringify({ error: "Failed to refresh subscription" }),
        { status: 502, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    let paddleBody: Record<string, unknown> | null = null;
    try {
      paddleBody = await paddleResponse.json();
    } catch {
      console.error("Paddle subscription API returned non-JSON response");
      return new Response(
        JSON.stringify({ error: "Invalid Paddle response" }),
        { status: 502, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }
    const subscription = paddleBody?.data as PaddleSubscriptionState | undefined;
    if (!subscription?.id) {
      console.error("Paddle subscription response missing data.id");
      return new Response(
        JSON.stringify({ error: "Invalid Paddle response" }),
        { status: 502, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    const priceId = resolveBasePlanPriceId(
      subscription,
      getAllAllowedPriceIds(deps.env),
    );
    let tier = mapPriceIdToTier(priceId, deps.env);
    if (priceId && tier === "FREE") {
      if (existingTier && existingTier !== "FREE" && existingTier !== "free") {
        console.warn(
          `[BILLING_ALERT] Unknown price ID ${priceId} during refresh — preserving existing tier ${existingTier}`,
        );
        tier = existingTier as typeof tier;
      } else {
        console.error(
          "[BILLING_ALERT] Unknown price ID during refresh — no existing tier to preserve:",
          priceId,
        );
        return new Response(
          JSON.stringify({ error: "Unknown price_id — configuration error" }),
          { status: 500, headers: { ...cors, "Content-Type": "application/json" } },
        );
      }
    }

    // Ordered write: Paddle's own `updated_at` is the clock, so a refresh that
    // read an older state than the webhook already stored cannot regress the
    // row (F-055).
    const occurredAt = paddleEventOccurredAt(subscription, deps.now());
    const upsertData = buildSubscriptionUpsertFromPaddleState({
      userId: user.id,
      subscription,
      tier,
      priceId,
      eventId: syntheticSubscriptionEventId(
        "refresh",
        subscription.id,
        occurredAt,
      ),
      occurredAt,
    });

    const write = await applySubscriptionEvent(supabaseAdmin, upsertData, {
      storedSubscriptionId,
    });

    if (write.outcome === "already_bound") {
      console.error(
        "[BILLING_ALERT] subscription_already_bound_to_another_user:",
        `source=refresh`,
        `user_id=${user.id}`,
        `paddle_subscription_id=${subscription.id}`,
        write.error,
      );
      return new Response(
        JSON.stringify({
          error: "Subscription already linked to another account",
          code: "subscription_already_bound",
          message:
            "This subscription is linked to a different account. Contact support.",
        }),
        { status: 409, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    if (write.outcome === "error") {
      console.error("Error applying refreshed subscription:", write.error);
      return new Response(
        JSON.stringify({ error: "Database upsert failed" }),
        { status: 500, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    if (write.outcome !== "applied") {
      if (write.outcome === "untracked_subscription") {
        console.error(
          "[BILLING_ALERT] subscription_guard_rejected_write:",
          `source=refresh`,
          `user_id=${user.id}`,
          `attempted_subscription_id=${subscription.id}`,
          `tracked_subscription_id=${storedSubscriptionId}`,
        );
      } else {
        console.warn(
          "[Paddle] Refreshed state not stored: a newer event already wrote the row",
          subscription.id,
        );
      }
      return await notAppliedResponse(
        supabaseAdmin,
        user.id,
        write,
        fallbackRow,
        cors,
      );
    }

    return new Response(
      JSON.stringify({
        status: "refreshed",
        subscription: subscriptionPayload({
          status: upsertData.status,
          tier: upsertData.tier,
          priceId: upsertData.price_id,
          currentPeriodEnd: upsertData.current_period_end,
          cancelAtPeriodEnd: upsertData.cancel_at_period_end,
        }),
      }),
      { status: 200, headers: { ...cors, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("paddle-refresh-subscription error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...cors, "Content-Type": "application/json" } },
    );
  }
}

export function createPaddleRefreshSubscriptionHandler(
  deps: PaddleRefreshSubscriptionHandlerDependencies =
    defaultPaddleRefreshSubscriptionHandlerDependencies(),
): (req: Request) => Promise<Response> {
  return (req) => paddleRefreshSubscriptionHandler(req, deps);
}

if (import.meta.main) {
  Deno.serve(createPaddleRefreshSubscriptionHandler());
}
