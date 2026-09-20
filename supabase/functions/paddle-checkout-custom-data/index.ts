import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import {
  billingAction,
  EXISTING_SUBSCRIPTION_HTTP_STATUS,
  existingSubscriptionResponseBody,
  mayOpenNewCheckout,
} from "../_shared/billingAction.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { hmacSha256Hex } from "../_shared/hmac.ts";

/** Anything with `get(key)`, e.g. `Deno.env`. */
export interface EnvReader {
  get(key: string): string | undefined;
}

export interface PaddleCheckoutCustomDataDependencies {
  /** User-scoped client used only for `auth.getUser()`. */
  createAuthClient(authorization: string): Pick<SupabaseClient, "auth">;
  /** Service-role client for the subscription lookup (bypasses RLS). */
  createAdminClient(): SupabaseClient;
  env: EnvReader;
  now(): Date;
}

function defaultPaddleCheckoutCustomDataDependencies(): PaddleCheckoutCustomDataDependencies {
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
    env: Deno.env,
    now: () => new Date(),
  };
}

/**
 * Returns server-signed Paddle `custom_data` for Checkout.open.
 *
 * - Prevents clients from forging another user's user_id in custom_data (P1-10).
 * - Refuses to sign at all while the user already has a live Paddle
 *   subscription (409 `existing_subscription`, F-022/A-016). That is exactly
 *   the set of states for which paddle-update-subscription does NOT answer
 *   `checkout_required`, so no user is sent to a checkout that is then
 *   refused — and a past-due subscriber can never open a second subscription
 *   while Paddle is still charging the first one.
 */
async function paddleCheckoutCustomDataHandler(
  req: Request,
  deps: PaddleCheckoutCustomDataDependencies,
): Promise<Response> {
  const cors = getCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: cors });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  try {
    const secret = deps.env.get("PADDLE_CUSTOM_DATA_SECRET");
    if (!secret?.trim()) {
      console.error("PADDLE_CUSTOM_DATA_SECRET is not set");
      return new Response(JSON.stringify({ error: "Billing signing not configured" }), {
        status: 500,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const supabase = deps.createAuthClient(authHeader);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const { data: sub, error: subError } = await deps.createAdminClient()
      .from("subscriptions")
      .select("paddle_subscription_id, status, current_period_end, cancel_at_period_end")
      .eq("user_id", user.id)
      .maybeSingle();

    // Fail closed: a lookup we cannot trust must not become "no subscription",
    // which is the one state that opens a second checkout.
    if (subError) {
      console.error("[BILLING_ALERT] Checkout signing subscription lookup failed:", subError);
      return new Response(
        JSON.stringify({
          error: "Failed to load subscription state",
          code: "subscription_lookup_failed",
        }),
        { status: 500, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    const action = billingAction(sub, deps.now());
    if (!mayOpenNewCheckout(action)) {
      console.warn(
        `[Paddle] Refused checkout signing for a live subscription (action=${action.action}, reason=${action.reason})`,
      );
      return new Response(JSON.stringify(existingSubscriptionResponseBody(action)), {
        status: EXISTING_SUBSCRIPTION_HTTP_STATUS,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const cd_sig = await hmacSha256Hex(secret, user.id);
    return new Response(
      JSON.stringify({
        custom_data: {
          user_id: user.id,
          cd_sig,
        },
      }),
      { headers: { ...cors, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("paddle-checkout-custom-data error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
}

export function createPaddleCheckoutCustomDataHandler(
  deps: PaddleCheckoutCustomDataDependencies =
    defaultPaddleCheckoutCustomDataDependencies(),
): (req: Request) => Promise<Response> {
  return (req) => paddleCheckoutCustomDataHandler(req, deps);
}

if (import.meta.main) {
  Deno.serve(createPaddleCheckoutCustomDataHandler());
}
