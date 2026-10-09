import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import {
  billingAction,
  EXISTING_SUBSCRIPTION_HTTP_STATUS,
  existingSubscriptionResponseBody,
  mayOpenNewCheckout,
} from "../_shared/billingAction.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { getAllAllowedPriceIds } from "../_shared/paddlePriceIds.ts";
import { CHECKOUT_LIFETIME_MS, paddleApiBase, signCheckoutBinding } from "../_shared/paddleCheckoutBinding.ts";
import { checkRateLimit } from "../_shared/rateLimit.ts";
import { readBoundedRequestBody } from "../_shared/requestBody.ts";

class PaddleTransactionHttpError extends Error {
  constructor(readonly status: number) { super(`Paddle transaction request failed: HTTP ${status}`); }
}

/** Anything with `get(key)`, e.g. `Deno.env`. */
export interface EnvReader {
  get(key: string): string | undefined;
}

export interface PaddleCheckoutCustomDataDependencies {
  /** User-scoped client used only for `auth.getUser()`. */
  createAuthClient(authorization: string): Pick<SupabaseClient, "auth">;
  /** Service-role client for the rate limit and subscription lookup (bypasses RLS). */
  createAdminClient(): SupabaseClient;
  env: EnvReader;
  now(): Date;
  fetch: typeof fetch;
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
    fetch: (input, init) => fetch(input, init),
  };
}

/**
 * Returns server-signed Paddle `custom_data` for Checkout.open.
 *
 * - Prevents clients from forging another user's user_id in custom_data (P1-10).
 * - Refuses to sign at all while the user already has a live Paddle
 *   subscription (409 `existing_subscription`, F-022/A-016). That is exactly
 *   the set of states for which paddle-update-subscription does NOT answer
 *   `checkout_required`, so no user is ever sent to a checkout that is then
 *   refused.
 *
 * Checkout is a server-created transaction, serialized per user. A retained
 * transaction ID collects that purchase rather than creating another one.
 * Old clients without a requested price fail closed during the rollout.
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
    const secret = deps.env.get("PADDLE_CUSTOM_DATA_SECRET")?.trim();
    if (!secret) {
      console.error("[FATAL] PADDLE_CUSTOM_DATA_SECRET must be set");
      return new Response(
        JSON.stringify({ error: "Billing custom_data signing is not configured" }),
        {
          status: 500,
          headers: { ...cors, "Content-Type": "application/json" },
        },
      );
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

    // Same per-user budget and 429 body as paddle-refresh-subscription.
    // Runs before the subscription read, the Paddle API calls and the
    // signature so a flood cannot force transaction or signing work.
    const supabaseAdmin = deps.createAdminClient();
    const rateCheck = await checkRateLimit(supabaseAdmin, {
      key: "paddle-checkout-custom-data",
      userId: user.id,
      maxRequests: 10,
      windowSeconds: 60,
    }, cors);
    if (!rateCheck.allowed) return rateCheck.response!;

    const { data: sub, error: subError } = await supabaseAdmin
      .from("subscriptions")
      .select("paddle_subscription_id, tier, status, current_period_end, cancel_at_period_end")
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

    const headers = { ...cors, "Content-Type": "application/json" };
    let input: { price_id?: unknown };
    const bodyRead = await readBoundedRequestBody(req, 4096);
    if (bodyRead.kind !== "ok") return new Response(JSON.stringify({ error: "Invalid checkout request" }), { status: bodyRead.kind === "too_large" ? 413 : 400, headers });
    try { input = JSON.parse(new TextDecoder().decode(bodyRead.bytes)); } catch { return new Response(JSON.stringify({ error: "A checkout price is required", code: "checkout_client_upgrade_required" }), { status: 400, headers }); }
    const priceId = input?.price_id;
    if (typeof priceId !== "string" || !getAllAllowedPriceIds(deps.env).has(priceId)) {
      return new Response(JSON.stringify({ error: "Invalid checkout price" }), { status: 400, headers });
    }
    const apiKey = deps.env.get("PADDLE_API_KEY");
    if (!apiKey) return new Response(JSON.stringify({ error: "Billing API is not configured" }), { status: 500, headers });
    const environment = deps.env.get("PADDLE_ENVIRONMENT") === "sandbox" ? "sandbox" : "production";
    const admin = deps.createAdminClient();
    const paddle = async (path: string, method = "GET", body?: unknown) => {
      const response = await deps.fetch(`${paddleApiBase(environment)}${path}`, {
        method, headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new PaddleTransactionHttpError(response.status);
      return (await response.json()).data;
    };
    // Paddle paused maps to local canceled and can resume later. A terminal
    // local mirror alone must not authorize another chargeable contract.
    if (sub?.paddle_subscription_id) {
      const current = await paddle(`/subscriptions/${encodeURIComponent(sub.paddle_subscription_id)}`);
      if (current?.id !== sub.paddle_subscription_id || typeof current.status !== "string") {
        throw new Error("Prior subscription ownership could not be confirmed");
      }
      if (current.status !== "canceled") {
        return new Response(JSON.stringify(existingSubscriptionResponseBody({ action: "manage", reason: "entitled",
          needsPaymentUpdate: current.status === "past_due", entitled: true, paddleSubscriptionId: sub.paddle_subscription_id })),
          { status: EXISTING_SUBSCRIPTION_HTTP_STATUS, headers });
      }
    }
    for (let attempt = 0; attempt < 2; attempt++) {
      const nonce = crypto.randomUUID();
      const expiresAt = new Date(deps.now().getTime() + CHECKOUT_LIFETIME_MS).toISOString();
      const { data: reservation, error } = await admin.rpc("reserve_paddle_checkout", {
        p_user_id: user.id, p_nonce: nonce, p_price_id: priceId, p_environment: environment, p_expires_at: expiresAt,
      });
      if (error) throw new Error("Checkout reservation failed");
      if (!reservation || ["busy", "blocked"].includes(reservation.action)) {
        return new Response(JSON.stringify({ error: "Checkout is unavailable while billing is being reconciled", code: "checkout_pending" }), { status: 409, headers });
      }
      if (reservation.action === "close") {
        const transaction = await paddle(`/transactions/${encodeURIComponent(reservation.transaction_id)}`);
        if (!["draft", "ready", "canceled"].includes(transaction?.status)) {
          const restored = await admin.rpc("finish_paddle_checkout", { p_user_id: user.id, p_nonce: reservation.nonce, p_transaction_id: reservation.transaction_id });
          if (restored.error) throw new Error("Checkout reconciliation could not be recorded");
          return new Response(JSON.stringify({ error: "A prior checkout is processing", code: "checkout_pending" }), { status: 409, headers });
        }
        if (transaction.status !== "canceled") {
          const canceled = await paddle(`/transactions/${encodeURIComponent(reservation.transaction_id)}`, "PATCH", { status: "canceled" });
          if (canceled?.status !== "canceled") throw new Error("Paddle did not confirm transaction cancellation");
        }
        const finished = await admin.rpc("finish_paddle_checkout", { p_user_id: user.id, p_nonce: reservation.nonce, p_transaction_id: reservation.transaction_id, p_canceled: true });
        if (finished.error || finished.data !== true) throw new Error("Checkout cancellation could not be recorded");
        continue;
      }
      let transactionId = reservation.transaction_id;
      if (reservation.action === "create") {
        let transaction;
        try {
          transaction = await paddle("/transactions", "POST", { items: [{ price_id: priceId, quantity: 1 }], collection_mode: "automatic",
            custom_data: { user_id: user.id, cd_nonce: reservation.nonce } });
        } catch (error) {
          // Only definitive no-create responses may release the reservation.
          // Network loss / 5xx can hide a successful chargeable transaction.
          if (error instanceof PaddleTransactionHttpError && [400, 401, 403, 422].includes(error.status)) {
            const released = await admin.rpc("finish_paddle_checkout", { p_user_id: user.id, p_nonce: reservation.nonce, p_transaction_id: null, p_canceled: true });
            if (released.error || released.data !== true) throw new Error("Rejected checkout reservation could not be released");
          }
          throw error;
        }
        transactionId = transaction?.id;
        if (typeof transactionId !== "string" || !transactionId.startsWith("txn_")) throw new Error("Paddle returned no transaction ID");
        const recorded = await admin.rpc("record_paddle_checkout_transaction", { p_user_id: user.id, p_nonce: reservation.nonce, p_transaction_id: transactionId });
        if (recorded.error || recorded.data !== true) throw new Error("Checkout transaction ID could not be recorded");
      }
      const customData = await signCheckoutBinding({ user_id: user.id, cd_version: 2, cd_nonce: reservation.nonce,
        cd_transaction_id: transactionId, cd_price_id: reservation.price_id ?? priceId, cd_environment: reservation.environment ?? environment, cd_expires_at: reservation.expires_at }, secret);
      if (reservation.action === "create" || reservation.action === "configure") {
        await paddle(`/transactions/${encodeURIComponent(transactionId)}`, "PATCH", { custom_data: customData });
        const finished = await admin.rpc("finish_paddle_checkout", { p_user_id: user.id, p_nonce: reservation.nonce, p_transaction_id: transactionId });
        if (finished.error || finished.data !== true) throw new Error("Checkout transaction could not be recorded");
      }
      if (customData.cd_price_id !== priceId || customData.cd_environment !== environment) {
        return new Response(JSON.stringify({ error: "A prior checkout has been reconciled; retry your selected plan", code: "checkout_pending" }), { status: 409, headers });
      }
      return new Response(JSON.stringify({ transaction_id: transactionId, custom_data: customData }), { headers });
    }
    throw new Error("Checkout replacement could not be reserved");
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
