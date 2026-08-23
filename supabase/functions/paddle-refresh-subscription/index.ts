import { createClient } from "jsr:@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { checkRateLimit } from "../_shared/rateLimit.ts";
import {
  findCrossTierDuplicatePriceIds,
  getAllAllowedPriceIds,
  mapPriceIdToTier,
  paddlePriceIdsConfigured,
} from "../_shared/paddlePriceIds.ts";
import {
  buildSubscriptionUpsertFromPaddleState,
  type PaddleSubscriptionState,
  resolveBasePlanPriceId,
} from "../_shared/paddleSubscriptionState.ts";
import { verifyPaddleCustomDataSignature } from "../_shared/paddleWebhookSecurity.ts";

const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

interface PaddleTransactionState {
  id: string;
  subscription_id?: string | null;
  custom_data?: {
    user_id?: string | null;
    cd_sig?: string | null;
  } | null;
}

function parsePaddleTransactionId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return /^txn_[a-z0-9]{26}$/.test(trimmed) ? trimmed : null;
}

Deno.serve(async (req) => {
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

    if (!paddlePriceIdsConfigured(Deno.env)) {
      console.error("[FATAL] Paddle price IDs are not configured");
      return new Response(
        JSON.stringify({ error: "Billing configuration incomplete" }),
        { status: 500, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    const duplicatePriceIds = findCrossTierDuplicatePriceIds(Deno.env);
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

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
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

    const apiKey = Deno.env.get("PADDLE_API_KEY");
    if (!apiKey) {
      console.error("PADDLE_API_KEY is not set");
      return new Response(
        JSON.stringify({ error: "Billing service not configured" }),
        { status: 500, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    const paddleEnv = Deno.env.get("PADDLE_ENVIRONMENT") ?? "production";
    const baseUrl = paddleEnv === "sandbox"
      ? "https://sandbox-api.paddle.com"
      : "https://api.paddle.com";

    const { data: localSubscription, error: subError } = await supabaseAdmin
      .from("subscriptions")
      .select("paddle_subscription_id, tier")
      .eq("user_id", user.id)
      .maybeSingle();

    if (subError) {
      console.error("Error fetching local subscription:", subError);
      return new Response(
        JSON.stringify({ error: "Failed to fetch subscription" }),
        { status: 500, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    let paddleSubscriptionId = localSubscription?.paddle_subscription_id ?? null;
    let existingTier = localSubscription?.tier as string | undefined;

    if (requestedTransactionId) {
      const transactionResponse = await fetch(
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

      const customDataSecret = Deno.env.get("PADDLE_CUSTOM_DATA_SECRET")?.trim();
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

    const paddleResponse = await fetch(
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
      const { error } = await supabaseAdmin
        .from("subscriptions")
        .update({
          status: "canceled",
          paddle_subscription_id: null,
          price_id: null,
          current_period_end: null,
          cancel_at_period_end: false,
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", user.id);

      if (error) {
        console.error("Error marking missing Paddle subscription canceled:", error);
        return new Response(
          JSON.stringify({ error: "Database update failed" }),
          { status: 500, headers: { ...cors, "Content-Type": "application/json" } },
        );
      }

      return new Response(
        JSON.stringify({
          status: "refreshed",
          subscription: {
            status: "canceled",
            tier: localSubscription?.tier ?? "FREE",
            priceId: null,
            price_id: null,
            currentPeriodEnd: null,
            current_period_end: null,
            cancelAtPeriodEnd: false,
            cancel_at_period_end: false,
          },
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
      getAllAllowedPriceIds(Deno.env),
    );
    let tier = mapPriceIdToTier(priceId, Deno.env);
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

    const upsertData = buildSubscriptionUpsertFromPaddleState({
      userId: user.id,
      subscription,
      tier,
      priceId,
    });

    const { error } = await supabaseAdmin
      .from("subscriptions")
      .upsert(upsertData, { onConflict: "user_id" });

    if (error) {
      console.error("Error upserting refreshed subscription:", error);
      return new Response(
        JSON.stringify({ error: "Database upsert failed" }),
        { status: 500, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({
        status: "refreshed",
        subscription: {
          status: upsertData.status,
          tier: upsertData.tier,
          priceId: upsertData.price_id,
          price_id: upsertData.price_id,
          currentPeriodEnd: upsertData.current_period_end,
          current_period_end: upsertData.current_period_end,
          cancelAtPeriodEnd: upsertData.cancel_at_period_end,
          cancel_at_period_end: upsertData.cancel_at_period_end,
        },
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
});
