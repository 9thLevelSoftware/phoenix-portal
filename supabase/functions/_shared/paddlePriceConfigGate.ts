/**
 * Shared pre-flight for billing Edge Functions that map a Paddle price id
 * onto a paid tier. Missing ids and a price id listed under two tiers both
 * fail closed before any Paddle or database call.
 *
 * Status, JSON body, and `console.error` arguments match the copies this
 * replaced in paddle-webhooks, paddle-checkout-custom-data,
 * paddle-refresh-subscription, and paddle-update-subscription.
 */
import {
  findCrossTierDuplicatePriceIds,
  PADDLE_PRICE_IDS_NOT_CONFIGURED_FATAL,
  paddlePriceIdsConfigured,
} from "./paddlePriceIds.ts";

export const PADDLE_CROSS_TIER_DUPLICATE_PRICE_IDS_FATAL =
  "[FATAL] Paddle price ID configured under multiple tiers (would map to wrong tier by precedence):";

type EnvReader = { get(key: string): string | undefined };

/**
 * Returns a 500 when the paid price map cannot be trusted, otherwise null.
 * Callers pass their own response headers so CORS stays local to each function.
 */
export function paddlePriceConfigGateResponse(
  env: EnvReader,
  headers: HeadersInit,
): Response | null {
  if (!paddlePriceIdsConfigured(env)) {
    console.error(PADDLE_PRICE_IDS_NOT_CONFIGURED_FATAL);
    return new Response(
      JSON.stringify({ error: "Billing configuration incomplete" }),
      { status: 500, headers },
    );
  }

  const duplicatePriceIds = findCrossTierDuplicatePriceIds(env);
  if (duplicatePriceIds.length > 0) {
    console.error(
      PADDLE_CROSS_TIER_DUPLICATE_PRICE_IDS_FATAL,
      duplicatePriceIds,
    );
    return new Response(
      JSON.stringify({ error: "Billing configuration invalid" }),
      { status: 500, headers },
    );
  }

  return null;
}
