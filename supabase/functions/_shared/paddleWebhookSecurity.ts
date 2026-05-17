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

export async function verifyPaddleCustomDataSignature(
  userId: string,
  providedSig: unknown,
  secret: string,
): Promise<boolean> {
  if (typeof providedSig !== "string" || providedSig.length === 0) {
    return false;
  }

  const expectedSig = await hmacSha256Hex(secret, userId);
  const encoder = new TextEncoder();
  const a = encoder.encode(providedSig);
  const b = encoder.encode(expectedSig);

  let mismatch = a.length !== b.length ? 1 : 0;
  const cmpLen = Math.min(a.length, b.length);
  for (let i = 0; i < cmpLen; i++) {
    mismatch |= a[i]! ^ b[i]!;
  }
  return mismatch === 0;
}
