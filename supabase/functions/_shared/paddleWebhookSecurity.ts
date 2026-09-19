import { hmacSha256Hex } from "./hmac.ts";

export type PaddleEventOrderDecision =
  | { action: "accept"; occurredAt: string }
  | { action: "duplicate" }
  | { action: "stale"; occurredAt: string; lastOccurredAt: string }
  | { action: "invalid"; reason: "missing_occurred_at" | "invalid_occurred_at" };

function parseEventTime(value: string | null | undefined): number | null {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

export function classifyPaddleEventOrder(
  eventId: string,
  occurredAt: string | null | undefined,
  existing: {
    last_event_id?: string | null;
    last_event_occurred_at?: string | null;
  } | null | undefined,
): PaddleEventOrderDecision {
  if (existing?.last_event_id === eventId) {
    return { action: "duplicate" };
  }

  const incomingTime = parseEventTime(occurredAt);
  if (!occurredAt) {
    return { action: "invalid", reason: "missing_occurred_at" };
  }
  if (incomingTime === null) {
    return { action: "invalid", reason: "invalid_occurred_at" };
  }

  const lastOccurredAt = existing?.last_event_occurred_at ?? null;
  const lastTime = parseEventTime(lastOccurredAt);
  if (lastTime !== null && incomingTime <= lastTime) {
    return {
      action: "stale",
      occurredAt,
      lastOccurredAt: lastOccurredAt!,
    };
  }

  return { action: "accept", occurredAt };
}

function constantTimeEqual(left: string, right: string): boolean {
  const encoder = new TextEncoder();
  const a = encoder.encode(left);
  const b = encoder.encode(right);

  let mismatch = a.length !== b.length ? 1 : 0;
  const cmpLen = Math.min(a.length, b.length);
  for (let i = 0; i < cmpLen; i++) {
    mismatch |= a[i]! ^ b[i]!;
  }
  return mismatch === 0;
}

/** Paddle's replay window for `Paddle-Signature` timestamps, in seconds. */
export const PADDLE_SIGNATURE_TOLERANCE_SECONDS = 300;

/**
 * Verifies a Paddle webhook `Paddle-Signature` header (HMAC-SHA256).
 *
 * Header format: `ts=<unix seconds>;h1=<hex>[;h1=<hex>...]`; the HMAC payload
 * is `ts + ":" + rawBody`. Fails closed: exactly one `ts`, all digits, within
 * `toleranceSeconds` of `now()` in either direction. While a webhook secret is
 * being rotated Paddle sends one `h1` per active secret, so the event is
 * accepted when any `h1` matches; each value is compared in constant time.
 */
export async function verifyPaddleSignature(
  rawBody: string,
  signatureHeader: string,
  secret: string,
  options: { now?: () => number; toleranceSeconds?: number } = {},
): Promise<boolean> {
  const now = options.now ?? Date.now;
  const toleranceSeconds = options.toleranceSeconds ??
    PADDLE_SIGNATURE_TOLERANCE_SECONDS;

  const parts = signatureHeader.split(";").map((part) => part.trim());
  const tsEntries = parts.filter((part) => part.startsWith("ts="));
  if (tsEntries.length !== 1) return false;
  const ts = tsEntries[0]!.slice(3);
  if (!/^\d+$/.test(ts)) return false;

  const candidates = parts
    .filter((part) => part.startsWith("h1="))
    .map((part) => part.slice(3))
    .filter((value) => value.length > 0);
  if (candidates.length === 0) return false;

  const signatureAge = Math.abs(now() / 1000 - Number(ts));
  if (!(signatureAge <= toleranceSeconds)) {
    console.warn(
      "[BILLING_ALERT] Webhook signature outside tolerance:",
      signatureAge,
      "seconds",
    );
    return false;
  }

  const expectedHex = await hmacSha256Hex(secret, `${ts}:${rawBody}`);
  let matched = false;
  for (const candidate of candidates) {
    // Compare every candidate; no early exit on the first match.
    if (constantTimeEqual(candidate, expectedHex)) matched = true;
  }
  return matched;
}

export async function verifyPaddleCustomDataSignature(
  userId: string,
  providedSig: unknown,
  secret: string,
): Promise<boolean> {
  if (typeof providedSig !== "string" || providedSig.length === 0) {
    return false;
  }

  const expectedSig = await hmacSha256Hex(secret, userId);
  return constantTimeEqual(providedSig, expectedSig);
}

export type PaddleCustomDataTrustDecision =
  | { trusted: true; method: "signature" | "legacy_subscription_match" }
  | { trusted: false; reason: "invalid_signature" | "missing_subscription_id" | "subscription_mismatch" };

export function evaluatePaddleCustomDataTrust({
  signedCustomDataValid,
  eventSubscriptionId,
  existingSubscriptionId,
}: {
  signedCustomDataValid: boolean;
  eventSubscriptionId: unknown;
  existingSubscriptionId: string | null | undefined;
}): PaddleCustomDataTrustDecision {
  if (signedCustomDataValid) {
    return { trusted: true, method: "signature" };
  }

  if (typeof eventSubscriptionId !== "string" || eventSubscriptionId.length === 0) {
    return { trusted: false, reason: "missing_subscription_id" };
  }

  if (existingSubscriptionId && existingSubscriptionId === eventSubscriptionId) {
    return { trusted: true, method: "legacy_subscription_match" };
  }

  return { trusted: false, reason: "subscription_mismatch" };
}
