import { hmacSha256Hex } from "./hmac.ts";
import { verifyPaddleCustomDataSignature } from "./paddleWebhookSecurity.ts";

export const CHECKOUT_LIFETIME_MS = 30 * 60 * 1000;
export interface CheckoutBinding {
  user_id: string;
  cd_version: 2;
  cd_nonce: string;
  cd_transaction_id: string;
  cd_price_id: string;
  cd_environment: string;
  cd_expires_at: string;
  cd_sig: string;
}

function signingPayload(data: Omit<CheckoutBinding, "cd_sig">): string {
  return JSON.stringify([2, data.user_id, data.cd_nonce, data.cd_transaction_id,
    data.cd_price_id, data.cd_environment, data.cd_expires_at]);
}

export async function signCheckoutBinding(
  data: Omit<CheckoutBinding, "cd_sig">,
  secret: string,
): Promise<CheckoutBinding> {
  return { ...data, cd_sig: await hmacSha256Hex(secret, signingPayload(data)) };
}

/** Identity proof only. Fresh adoption also requires the durable transaction binding. */
export async function verifyCheckoutBinding(data: unknown, secret: string): Promise<boolean> {
  if (!data || typeof data !== "object") return false;
  const value = data as CheckoutBinding;
  if (value.cd_version !== 2 || ![value.user_id, value.cd_nonce, value.cd_transaction_id,
    value.cd_price_id, value.cd_environment, value.cd_expires_at, value.cd_sig]
    .every((field) => typeof field === "string" && field.length > 0)) return false;
  if (!Number.isFinite(Date.parse(value.cd_expires_at))) return false;
  const expected = await hmacSha256Hex(secret, signingPayload(value));
  let mismatch = expected.length ^ value.cd_sig.length;
  for (let i = 0; i < expected.length; i++) mismatch |= expected.charCodeAt(i) ^ (value.cd_sig.charCodeAt(i) || 0);
  return mismatch === 0;
}

export function paddleApiBase(environment: string | undefined): string {
  return environment === "sandbox" ? "https://sandbox-api.paddle.com" : "https://api.paddle.com";
}

export interface CheckoutBindingDb {
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
}

export async function bindCheckoutSubscription({ data, userId, subscriptionId, customerId, priceId, environment, secret, apiKey, fetchImpl, db }: {
  data: unknown; userId: string; subscriptionId: string; customerId: string; priceId: string;
  environment: string; secret: string; apiKey: string | undefined; fetchImpl: typeof fetch; db: CheckoutBindingDb;
}): Promise<boolean> {
  const v2 = await verifyCheckoutBinding(data, secret);
  const legacy = !v2 && await verifyPaddleCustomDataSignature(userId, (data as { cd_sig?: unknown } | null)?.cd_sig, secret);
  if (!v2 && !legacy) return false;
  if ((data as { user_id?: unknown }).user_id !== userId) return false;
  const established = await db.rpc("is_paddle_subscription_bound", { p_user_id: userId, p_subscription_id: subscriptionId });
  if (established.error) throw new Error("Checkout ownership lookup failed");
  if (established.data === true) return true;
  if (!v2) return false;
  const binding = data as CheckoutBinding;
  if (binding.user_id !== userId || binding.cd_environment !== environment || binding.cd_price_id !== priceId) return false;
  if (!apiKey) throw new Error("Paddle API key required to verify checkout transaction");
  const response = await fetchImpl(`${paddleApiBase(environment)}/transactions/${encodeURIComponent(binding.cd_transaction_id)}`, {
    headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Checkout transaction lookup failed: HTTP ${response.status}`);
  const transaction = (await response.json())?.data;
  if (transaction?.id !== binding.cd_transaction_id) return false;
  // Paddle can deliver subscription.created while the originating transaction
  // is still being completed. Missing attribution then means retry, not replay.
  if (transaction.status !== "completed" || !transaction.billed_at || !transaction.subscription_id) throw new Error("Checkout transaction is not yet completed");
  if (transaction.subscription_id !== subscriptionId || transaction.customer_id !== customerId) return false;
  if (!await verifyCheckoutBinding(transaction.custom_data, secret) || transaction.custom_data.cd_sig !== binding.cd_sig
    || transaction.items?.length !== 1 || transaction.items[0]?.price?.id !== priceId || transaction.items[0]?.quantity !== 1) return false;
  const result = await db.rpc("bind_paddle_checkout", { p_user_id: userId, p_nonce: binding.cd_nonce,
    p_transaction_id: binding.cd_transaction_id, p_subscription_id: subscriptionId, p_customer_id: customerId,
    p_price_id: priceId, p_environment: environment, p_completed_at: transaction.billed_at });
  if (result.error) throw new Error("Checkout subscription binding failed");
  return result.data === true;
}

/** Complete pagination, with fixed-origin continuation and bounded resource use. */
export async function listPaddleCustomerSubscriptions(
  fetchImpl: typeof fetch, apiKey: string, environment: string | undefined, customerId: string,
): Promise<Array<Record<string, unknown>>> {
  const base = paddleApiBase(environment);
  let url: string | null = `${base}/subscriptions?customer_id=${encodeURIComponent(customerId)}&per_page=200&order_by=id%5BASC%5D`;
  const seen = new Set<string>();
  const rows: Array<Record<string, unknown>> = [];
  for (let page = 0; url && page < 100; page++) {
    if (seen.has(url)) throw new Error("Paddle pagination repeated a page");
    seen.add(url);
    const response: Response = await fetchImpl(url, { headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error(`Paddle listing failed: HTTP ${response.status}`);
    const body: { data?: Array<Record<string, unknown>>; meta?: { pagination?: { has_more?: boolean; next?: string } } } = await response.json();
    if (!Array.isArray(body?.data) || !body?.meta?.pagination || typeof body.meta.pagination.has_more !== "boolean") {
      throw new Error("Paddle listing has invalid pagination");
    }
    for (const row of body.data) {
      if (!row || typeof row.id !== "string" || row.customer_id !== customerId || typeof row.status !== "string") {
        throw new Error("Paddle listing has invalid subscription ownership context");
      }
      rows.push(row);
    }
    if (!body.meta.pagination.has_more) { url = null; break; }
    if (typeof body.meta.pagination.next !== "string") throw new Error("Paddle listing has no continuation");
    const next: URL = new URL(body.meta.pagination.next, base);
    if (next.origin !== base || next.pathname !== "/subscriptions" || next.searchParams.get("customer_id") !== customerId) {
      throw new Error("Paddle listing has unsafe continuation");
    }
    url = next.href;
  }
  if (url) throw new Error("Paddle pagination exceeded limit");
  return rows;
}
