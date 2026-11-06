/**
 * One signed POST to a user's data-sharing endpoint, and what came of it.
 *
 * Shared by the `test` action of webhook-endpoints and the deliver-webhooks
 * worker so a test delivery is exactly a real one. The request carries the
 * signing headers, a fixed User-Agent and at most the one header the user
 * configured. Nothing else: no Supabase credential ever leaves through here.
 *
 * Only the status code and a fixed error code are returned. The response
 * body and headers (bar Retry-After) are discarded unread, so an endpoint
 * cannot be used to read back what some other host answered.
 */
import { parseRetryAfterSeconds } from './providerRateLimit.ts';
import { webhookSignatureHeaders } from './webhookSigning.ts';
import {
  type DnsResolver,
  fetchWebhookTarget,
  resolveWebhookTarget,
  type WebhookTargetRejection,
} from './webhookTarget.ts';

export const WEBHOOK_USER_AGENT = 'PhoenixPortal-Webhooks/1.0';
export const WEBHOOK_API_VERSION = '2026-11-01';
/** A payload larger than this is not sent. */
export const WEBHOOK_MAX_BODY_BYTES = 1_000_000;

/** Fixed codes stored in webhook_deliveries.last_error_code and shown to the owner. */
export type WebhookErrorCode =
  | 'http_error'
  | 'redirect_not_followed'
  | 'timeout'
  | 'connection_failed'
  | 'dns_failed'
  | 'target_not_allowed'
  | 'payload_too_large';

export type WebhookSendResult =
  | { outcome: 'delivered'; statusCode: number; errorCode: null; retryAfterSeconds: null; durationMs: number }
  | {
    outcome: 'failed' | 'gone' | 'skipped';
    statusCode: number | null;
    errorCode: WebhookErrorCode;
    retryAfterSeconds: number | null;
    durationMs: number;
  };

export interface WebhookSendDependencies {
  fetch: typeof fetch;
  resolveDns: DnsResolver;
  /** This project's own hosts (ownHostsFromEnv). */
  ownHosts: readonly string[];
  now: () => Date;
}

export interface WebhookSendInput {
  /** The stored endpoint URL. Re-validated here on every send. */
  url: string;
  /** Becomes `webhook-id`; the receiver's idempotency key. */
  deliveryId: string;
  /** Current signing secret first, then a previous one still in its overlap. */
  secrets: readonly string[];
  customHeader: { name: string; value: string } | null;
  /** The exact JSON text to send and sign. */
  body: string;
}

function targetErrorCode(code: WebhookTargetRejection): WebhookErrorCode {
  return code === 'dns_failed' ? 'dns_failed' : 'target_not_allowed';
}

export async function sendWebhook(
  deps: WebhookSendDependencies,
  input: WebhookSendInput,
): Promise<WebhookSendResult> {
  const started = deps.now().getTime();
  const elapsed = () => Math.max(0, deps.now().getTime() - started);

  if (new TextEncoder().encode(input.body).byteLength > WEBHOOK_MAX_BODY_BYTES) {
    return { outcome: 'skipped', statusCode: null, errorCode: 'payload_too_large', retryAfterSeconds: null, durationMs: 0 };
  }

  // The URL was validated when it was saved; DNS may have changed since, and
  // a stored row is not proof of anything.
  const target = await resolveWebhookTarget(input.url, deps.ownHosts, deps.resolveDns);
  if (!target.ok) {
    return {
      outcome: 'failed',
      statusCode: null,
      errorCode: targetErrorCode(target.code),
      retryAfterSeconds: null,
      durationMs: elapsed(),
    };
  }

  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'user-agent': WEBHOOK_USER_AGENT,
    ...(await webhookSignatureHeaders(input.secrets, input.deliveryId, deps.now(), input.body)),
  };
  if (input.customHeader) headers[input.customHeader.name] = input.customHeader.value;

  let response: Response;
  try {
    response = await fetchWebhookTarget(deps.fetch, target.normalized, { headers, body: input.body });
  } catch (error) {
    const name = error instanceof Error ? error.name : '';
    return {
      outcome: 'failed',
      statusCode: null,
      // One code for everything that failed before an HTTP status (refused,
      // reset, TLS, unreachable): see the residual-risk note in webhookTarget.ts.
      errorCode: name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'connection_failed',
      retryAfterSeconds: null,
      durationMs: elapsed(),
    };
  }

  const statusCode = response.status;
  const retryAfterSeconds = statusCode === 429 || statusCode === 503
    ? parseRetryAfterSeconds(response.headers, deps.now())
    : null;
  // Never read what the host answered.
  try {
    await response.body?.cancel();
  } catch {
    // Already closed.
  }
  const durationMs = elapsed();

  if (statusCode >= 200 && statusCode < 300) {
    return { outcome: 'delivered', statusCode, errorCode: null, retryAfterSeconds: null, durationMs };
  }
  if (statusCode === 410) {
    return { outcome: 'gone', statusCode, errorCode: 'http_error', retryAfterSeconds: null, durationMs };
  }
  if (statusCode >= 300 && statusCode < 400) {
    return { outcome: 'failed', statusCode, errorCode: 'redirect_not_followed', retryAfterSeconds: null, durationMs };
  }
  return { outcome: 'failed', statusCode, errorCode: 'http_error', retryAfterSeconds, durationMs };
}

/** The envelope every event uses. `data` differs by event type. */
export function webhookEnvelope(type: string, now: Date, data: Record<string, unknown>): string {
  return JSON.stringify({
    type,
    timestamp: now.toISOString(),
    data: { apiVersion: WEBHOOK_API_VERSION, ...data },
  });
}
