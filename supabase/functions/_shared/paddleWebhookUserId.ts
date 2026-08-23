const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const JSON_HEADERS = {
  "Content-Type": "application/json",
};

export type PaddleWebhookUserIdResult =
  | { kind: "response"; response: Response }
  | { kind: "bound"; userId: string };

/**
 * Bind a Paddle webhook to a portal user AFTER HMAC verification.
 *
 * Missing `custom_data.user_id` is unbindable — ack HTTP 200 `{ ignored: true }`
 * so Paddle does not retry forever. Malformed UUIDs stay 400. Callers must
 * still return 500 on later DB failures.
 */
export function paddleWebhookResponseForCustomUserId(
  userId: unknown,
  headers: Record<string, string> = JSON_HEADERS,
): PaddleWebhookUserIdResult {
  if (typeof userId !== "string" || userId.length === 0) {
    return {
      kind: "response",
      response: new Response(JSON.stringify({ ignored: true }), {
        status: 200,
        headers,
      }),
    };
  }

  if (!UUID_RE.test(userId)) {
    return {
      kind: "response",
      response: new Response(
        JSON.stringify({ error: "Invalid user_id in custom_data" }),
        { status: 400, headers },
      ),
    };
  }

  return { kind: "bound", userId };
}
