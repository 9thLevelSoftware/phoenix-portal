import { createClient } from "jsr:@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { checkRateLimit } from "../_shared/rateLimit.ts";
import {
  mapPriceIdToTier,
  paddlePriceIdsConfigured,
} from "../_shared/paddlePriceIds.ts";
import {
  buildSubscriptionUpsertFromPaddleState,
  type PaddleSubscriptionState,
} from "../_shared/paddleSubscriptionState.ts";

const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

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
    if (!paddlePriceIdsConfigured(Deno.env)) {
      console.error("[FATAL] Paddle price IDs are not configured");
      return new Response(
        JSON.stringify({ error: "Billing configuration incomplete" }),
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
      maxRequests: 5,
      windowSeconds: 60,
    }, cors);
    if (!rateCheck.allowed) return rateCheck.response!;

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

    if (!localSubscription?.paddle_subscription_id) {
      return new Response(
        JSON.stringify({ status: "no_subscription" }),
        { status: 200, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

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
    const paddleResponse = await fetch(
      `${baseUrl}/subscriptions/${localSubscription.paddle_subscription_id}`,
      {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
      },
    );

    if (paddleResponse.status === 404) {
      const { error } = await supabaseAdmin
        .from("subscriptions")
        .update({
          status: "canceled",
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
            current_period_end: null,
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

    const paddleBody = await paddleResponse.json();
    const subscription = paddleBody?.data as PaddleSubscriptionState | undefined;
    if (!subscription?.id) {
      console.error("Paddle subscription response missing data.id");
      return new Response(
        JSON.stringify({ error: "Invalid Paddle response" }),
        { status: 502, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    const priceId = subscription.items?.[0]?.price?.id ?? "";
    let tier = mapPriceIdToTier(priceId, Deno.env);
    if (priceId && tier === "FREE") {
      const existingTier = localSubscription.tier as string | undefined;
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
          price_id: upsertData.price_id,
          current_period_end: upsertData.current_period_end,
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
