/**
 * One timeout for every outbound Paddle Billing API call.
 *
 * Checkout, webhooks, and account purge already aborted at 10s. Cancel,
 * refresh, and plan updates did not. Routing every call through here keeps
 * that same bound: `fetch` rejects with the `TimeoutError` `AbortSignal.timeout`
 * raises, and callers keep their existing status codes, bodies, and logs.
 */
export const PADDLE_API_TIMEOUT_MS = 10_000;

/**
 * Paddle Billing API origin. The exact string `sandbox` selects the sandbox
 * host. Unset or any other value selects production.
 */
export function paddleApiBase(environment: string | undefined): string {
  return environment === "sandbox" ? "https://sandbox-api.paddle.com" : "https://api.paddle.com";
}

export function fetchPaddle(
  fetchImpl: typeof fetch,
  input: Parameters<typeof fetch>[0],
  init?: RequestInit,
): Promise<Response> {
  return fetchImpl(input, {
    ...init,
    signal: AbortSignal.timeout(PADDLE_API_TIMEOUT_MS),
  });
}
