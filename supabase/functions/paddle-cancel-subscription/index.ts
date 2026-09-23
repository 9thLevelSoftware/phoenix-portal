import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { checkRateLimit } from "../_shared/rateLimit.ts";
import {
  applySubscriptionEvent,
  buildSubscriptionUpsertFromPaddleState,
  type PaddleSubscriptionState,
  paddleEventOccurredAt,
  syntheticSubscriptionEventId,
} from "../_shared/paddleSubscriptionState.ts";
import { resolvePaddleCancelRequest } from "../_shared/paddleSubscriptionUpdate.ts";

/** Anything with `get(key)`, e.g. `Deno.env`. */
export interface EnvReader {
  get(key: string): string | undefined;
}

export interface PaddleCancelSubscriptionHandlerDependencies {
  /** User-scoped client used only for `auth.getUser()`. */
  createAuthClient(authorization: string): Pick<SupabaseClient, "auth">;
  /** Service-role client for DB queries (bypasses RLS). */
  createAdminClient(): SupabaseClient;
  /** Paddle API fetch. */
  fetch: typeof fetch;
  env: EnvReader;
  now(): Date;
}

function defaultPaddleCancelSubscriptionHandlerDependencies(): PaddleCancelSubscriptionHandlerDependencies {
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

async function paddleCancelSubscriptionHandler(
  req: Request,
  deps: PaddleCancelSubscriptionHandlerDependencies,
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
      key: "paddle-cancel-subscription",
      userId: user.id,
      maxRequests: 3,
      windowSeconds: 60,
    }, cors);
    if (!rateCheck.allowed) return rateCheck.response!;

    // Look up user's current subscription. The ordered writer rewrites the
    // whole row, so the plan fields it writes have to be read first — a cancel
    // keeps the plan the row already had (tier / price_id).
    const { data: sub, error: subError } = await supabaseAdmin
      .from("subscriptions")
      .select("paddle_subscription_id, status, tier, price_id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (subError) {
      console.error("Error fetching subscription:", subError);
      return new Response(
        JSON.stringify({ error: "Failed to fetch subscription" }),
        { status: 500, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    // Validate subscription state
    if (!sub || !sub.paddle_subscription_id) {
      return new Response(
        JSON.stringify({ error: "No active subscription found" }),
        { status: 400, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    // active/trialing: cancel at period end. past_due (keeps access during
    // Paddle's retry window): cancel immediately. See resolvePaddleCancelRequest.
    const cancelRequest = resolvePaddleCancelRequest(sub.status);
    if (!cancelRequest.allowed) {
      return new Response(
        JSON.stringify({ error: "No active subscription found" }),
        { status: 400, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    // Call Paddle API to cancel the subscription
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

    const paddleResponse = await deps.fetch(
      `${baseUrl}/subscriptions/${sub.paddle_subscription_id}/cancel`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ effective_from: cancelRequest.effectiveFrom }),
      },
    );

    if (!paddleResponse.ok) {
      const paddleError = await paddleResponse.text();
      console.error("Paddle API error:", paddleResponse.status, paddleError);
      return new Response(
        JSON.stringify({
          error: "Failed to cancel subscription",
          code: "paddle_cancel_failed",
        }),
        { status: 502, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    // Persist the cancellation (scheduled, or immediate for past_due) locally
    // so the UI reflects it before the webhook arrives (and even if the
    // webhook is delayed/failing). The webhook still reconciles the
    // authoritative state later.
    //
    // Every write goes through `public.apply_subscription_event` — the one
    // ordered, guarded writer — never a direct `.update`/`.upsert`. Paddle's
    // own `updated_at` is the clock, so a cancel response older than an event
    // already stored (a renewal webhook that landed first) cannot regress the
    // row (same rule as paddle-refresh-subscription).
    let paddleBody: Record<string, unknown> | null = null;
    try {
      paddleBody = await paddleResponse.json();
    } catch {
      console.error(
        "Paddle cancel response was not JSON; local write skipped",
      );
      paddleBody = null;
    }
    const subscription = paddleBody?.data as PaddleSubscriptionState | undefined;

    // A cancel response for a different subscription than the one we asked
    // Paddle to cancel is never stored: it would overwrite this user's row
    // with some other subscription's state. Paddle still accepted *our*
    // cancel, so the call stays successful and the webhook reconciles.
    if (!subscription?.id || subscription.id !== sub.paddle_subscription_id) {
      console.error(
        "[BILLING_ALERT] Paddle cancel response id mismatch; local write skipped:",
        {
          requested: sub.paddle_subscription_id,
          returned: subscription?.id ?? null,
        },
      );
    } else {
      const occurredAt = paddleEventOccurredAt(subscription, deps.now());
      const upsertData = buildSubscriptionUpsertFromPaddleState({
        userId: user.id,
        subscription,
        // A cancel keeps the plan the row already had.
        tier: sub.tier ?? "FREE",
        priceId: sub.price_id ?? undefined,
        eventId: syntheticSubscriptionEventId(
          "cancel",
          subscription.id,
          occurredAt,
        ),
        occurredAt,
      });

      const write = await applySubscriptionEvent(supabaseAdmin, upsertData, {
        storedSubscriptionId: sub.paddle_subscription_id,
      });

      if (write.outcome === "error" || write.outcome === "already_bound") {
        // Paddle already scheduled the cancellation; treat the local write as
        // best-effort and let the webhook reconcile rather than failing the call.
        console.error(
          "Error persisting cancel state after Paddle cancel:",
          write.outcome,
          write.error,
        );
      } else if (write.outcome !== "applied") {
        console.warn(
          "[Paddle] Cancel state not stored (newer event or guard refusal):",
          write.outcome,
          subscription.id,
        );
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        cancelAtPeriodEnd: cancelRequest.effectiveFrom === "next_billing_period",
        canceledImmediately: cancelRequest.effectiveFrom === "immediately",
      }),
      { status: 200, headers: { ...cors, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("paddle-cancel-subscription error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...cors, "Content-Type": "application/json" } },
    );
  }
}

export function createPaddleCancelSubscriptionHandler(
  deps: PaddleCancelSubscriptionHandlerDependencies = defaultPaddleCancelSubscriptionHandlerDependencies(),
): (req: Request) => Promise<Response> {
  return (req) => paddleCancelSubscriptionHandler(req, deps);
}

if (import.meta.main) {
  Deno.serve(createPaddleCancelSubscriptionHandler());
}
