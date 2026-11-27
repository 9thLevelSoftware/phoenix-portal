import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { hasValidCronSecret } from '../_shared/cronSecret.ts';
import { getDataSharingEntity } from '../_shared/dataSharingScopes.ts';
import { decryptOAuthSecret } from '../_shared/oauthTokenCrypto.ts';
import { isServiceRoleBearer } from '../_shared/timingSafe.ts';
import {
  loadWebhookCredentials,
  type WebhookCredentials,
} from '../_shared/webhookCredentials.ts';
import { buildWebhookEvent } from '../_shared/webhookPayload.ts';
import { sendWebhook, webhookEnvelope } from '../_shared/webhookSend.ts';
import { type DnsResolver, ownHostsFromEnv, systemDnsResolver } from '../_shared/webhookTarget.ts';

/**
 * Data sharing: the delivery worker. pg_cron calls it every minute through
 * private.invoke_edge_function (job `deliver-webhooks`); deactivating that
 * job stops every delivery.
 *
 * One pass: claim due rows -> build each payload from the current data ->
 * sign -> POST -> record the outcome. Retries, backoff, the per-endpoint
 * fairness cap, pausing an owner who is no longer FLAME (FP-2) and switching
 * off an endpoint that keeps failing (FP-8) are all decided in SQL
 * (claim_webhook_deliveries / complete_webhook_delivery), so this file cannot
 * drift from them.
 *
 * Isolation (FP-1): the user id used for every read comes from the claimed
 * delivery row, whose composite foreign key ties it to the endpoint's owner.
 * The endpoint, its secrets and the entity are each read with that id.
 *
 * Auth: not a browser endpoint. `x-cron-secret` (constant-time, CRON_SECRET)
 * or the service-role bearer; anything else is a 401.
 */

/** Rows claimed per batch. Small, so a pass never holds work it cannot finish. */
const BATCH_SIZE = 8;
const PER_ENDPOINT_PER_BATCH = 4;
const CONCURRENCY = 4;
/** Start no new batch after this: a batch can take 2 x the 10 s request timeout. */
const BATCH_START_BUDGET_MS = 25_000;
const MAX_DELIVERIES_PER_PASS = 200;
const LEASE_SECONDS = 180;

type Outcome = 'delivered' | 'failed' | 'gone' | 'skipped';

interface ClaimedDelivery {
  delivery_id: string;
  delivery_endpoint_id: string;
  delivery_user_id: string;
  delivery_entity: string;
  delivery_entity_id: string;
  delivery_attempt: number;
}

interface EndpointForDelivery {
  id: string;
  user_id: string;
  url: string;
  scopes: string[];
  status: string;
  custom_header_name: string | null;
}

export interface DeliverWebhooksDependencies {
  createAdminClient(): SupabaseClient;
  fetch: typeof fetch;
  resolveDns: DnsResolver;
  env(name: string): string | undefined;
  now(): Date;
  decrypt(stored: string): Promise<string | null | undefined>;
}

function defaultDependencies(): DeliverWebhooksDependencies {
  return {
    createAdminClient() {
      return createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
        { auth: { persistSession: false, autoRefreshToken: false } },
      );
    },
    fetch: (input, init) => fetch(input, init),
    resolveDns: systemDnsResolver,
    env: (name) => Deno.env.get(name),
    now: () => new Date(),
    decrypt: decryptOAuthSecret,
  };
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

interface PassContext {
  deps: DeliverWebhooksDependencies;
  admin: SupabaseClient;
  ownHosts: string[];
  endpoints: Map<string, Promise<EndpointForDelivery | null | 'error'>>;
  credentials: Map<string, Promise<WebhookCredentials | null>>;
}

function loadEndpoint(ctx: PassContext, delivery: ClaimedDelivery) {
  const key = delivery.delivery_endpoint_id;
  let cached = ctx.endpoints.get(key);
  if (!cached) {
    cached = (async () => {
      const { data, error } = await ctx.admin
        .from('webhook_endpoints')
        .select('id, user_id, url, scopes, status, custom_header_name')
        .eq('id', delivery.delivery_endpoint_id)
        .eq('user_id', delivery.delivery_user_id)
        .maybeSingle();
      if (error) return 'error' as const;
      return (data as unknown as EndpointForDelivery | null) ?? null;
    })();
    ctx.endpoints.set(key, cached);
  }
  return cached;
}

function loadCredentials(ctx: PassContext, endpoint: EndpointForDelivery) {
  let cached = ctx.credentials.get(endpoint.id);
  if (!cached) {
    cached = (async () => {
      const result = await loadWebhookCredentials(ctx.admin, {
        userId: endpoint.user_id,
        endpointId: endpoint.id,
        customHeaderName: endpoint.custom_header_name,
        now: ctx.deps.now(),
      }, ctx.deps.decrypt);
      if (!result.ok) {
        console.error('[DELIVER_WEBHOOKS] credentials unavailable', {
          endpointId: endpoint.id,
          reason: result.reason,
        });
        return null;
      }
      return result.credentials;
    })();
    ctx.credentials.set(endpoint.id, cached);
  }
  return cached;
}

interface Attempt {
  outcome: Outcome;
  eventType: string | null;
  statusCode: number | null;
  errorCode: string | null;
  durationMs: number | null;
  retryAfterSeconds: number | null;
}

const skipped = (errorCode: string): Attempt => ({
  outcome: 'skipped',
  eventType: null,
  statusCode: null,
  errorCode,
  durationMs: null,
  retryAfterSeconds: null,
});

const internalFailure = (): Attempt => ({
  outcome: 'failed',
  eventType: null,
  statusCode: null,
  // Ours, not the receiver's; it still retries on the same schedule.
  errorCode: 'internal_error',
  durationMs: null,
  retryAfterSeconds: null,
});

async function attemptDelivery(ctx: PassContext, delivery: ClaimedDelivery): Promise<Attempt> {
  const endpoint = await loadEndpoint(ctx, delivery);
  if (endpoint === 'error') return internalFailure();
  // Deleted, paused or disabled since the claim.
  if (!endpoint || endpoint.status !== 'active') return skipped('endpoint_inactive');

  // The scope may have been removed after the change was captured: what the
  // user shares now decides, not what they shared then.
  const definition = getDataSharingEntity(delivery.delivery_entity);
  if (!definition) return skipped('unknown_entity');
  if (!endpoint.scopes.includes(definition.scope)) return skipped('scope_removed');

  const credentials = await loadCredentials(ctx, endpoint);
  if (!credentials) return internalFailure();

  const event = await buildWebhookEvent(ctx.admin, {
    userId: delivery.delivery_user_id,
    endpointId: endpoint.id,
    entity: delivery.delivery_entity,
    entityId: delivery.delivery_entity_id,
  });
  if (event.kind === 'error') return internalFailure();
  if (event.kind === 'skip') return skipped(event.reason);

  const result = await sendWebhook(
    { fetch: ctx.deps.fetch, resolveDns: ctx.deps.resolveDns, ownHosts: ctx.ownHosts, now: ctx.deps.now },
    {
      url: endpoint.url,
      // The same id on every retry, so the receiver can deduplicate.
      deliveryId: delivery.delivery_id,
      secrets: credentials.secrets,
      customHeader: credentials.customHeader,
      body: webhookEnvelope(event.type, ctx.deps.now(), event.data),
    },
  );
  return {
    outcome: result.outcome,
    eventType: event.type,
    statusCode: result.statusCode,
    errorCode: result.errorCode,
    durationMs: result.durationMs,
    retryAfterSeconds: result.retryAfterSeconds,
  };
}

async function processDelivery(ctx: PassContext, delivery: ClaimedDelivery): Promise<Outcome | 'lost'> {
  let attempt: Attempt;
  try {
    attempt = await attemptDelivery(ctx, delivery);
  } catch (error) {
    // The name only: a message could carry a URL or a header value.
    console.error('[DELIVER_WEBHOOKS] attempt threw', {
      deliveryId: delivery.delivery_id,
      name: error instanceof Error ? error.name : 'unknown',
    });
    attempt = internalFailure();
  }

  const { data, error } = await ctx.admin.rpc('complete_webhook_delivery', {
    p_delivery_id: delivery.delivery_id,
    p_attempt: delivery.delivery_attempt,
    p_outcome: attempt.outcome,
    p_event_type: attempt.eventType,
    p_status_code: attempt.statusCode,
    p_error_code: attempt.errorCode,
    p_duration_ms: attempt.durationMs,
    p_retry_after_seconds: attempt.retryAfterSeconds,
  });
  if (error) {
    // The row stays `delivering` and is reclaimed when its lease runs out.
    console.error('[DELIVER_WEBHOOKS] completion failed', {
      deliveryId: delivery.delivery_id,
      code: (error as { code?: string }).code,
    });
    return 'lost';
  }
  // NULL: another worker reclaimed the row after our lease expired.
  if (data === null) return 'lost';
  return attempt.outcome;
}

async function runInPool<T>(items: readonly T[], size: number, work: (item: T) => Promise<void>) {
  let next = 0;
  const workers = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next];
      next += 1;
      await work(item);
    }
  });
  await Promise.all(workers);
}

async function deliverWebhooksHandler(
  req: Request,
  deps: DeliverWebhooksDependencies,
): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const authorized = hasValidCronSecret(req, deps.env) ||
    isServiceRoleBearer(req.headers.get('Authorization'), deps.env('SUPABASE_SERVICE_ROLE_KEY'));
  if (!authorized) return json({ error: 'Unauthorized' }, 401);

  const started = deps.now().getTime();
  const counts = { claimed: 0, delivered: 0, failed: 0, gone: 0, skipped: 0, lost: 0 };

  try {
    const admin = deps.createAdminClient();
    const ctx: PassContext = {
      deps,
      admin,
      ownHosts: ownHostsFromEnv(deps.env),
      endpoints: new Map(),
      credentials: new Map(),
    };

    while (
      counts.claimed < MAX_DELIVERIES_PER_PASS &&
      deps.now().getTime() - started < BATCH_START_BUDGET_MS
    ) {
      const { data, error } = await admin.rpc('claim_webhook_deliveries', {
        p_limit: BATCH_SIZE,
        p_per_endpoint: PER_ENDPOINT_PER_BATCH,
        p_lease_seconds: LEASE_SECONDS,
      });
      if (error) {
        console.error('[DELIVER_WEBHOOKS] claim failed', { code: (error as { code?: string }).code });
        return json({ error: 'claim_failed', ...counts }, 503);
      }
      const batch = (data ?? []) as ClaimedDelivery[];
      if (batch.length === 0) break;
      counts.claimed += batch.length;

      await runInPool(batch, CONCURRENCY, async (delivery) => {
        const outcome = await processDelivery(ctx, delivery);
        counts[outcome] += 1;
      });

      // An endpoint the batch switched off (dead, 410) must be re-read.
      ctx.endpoints.clear();
    }

    return json(counts, 200);
  } catch (error) {
    console.error('[DELIVER_WEBHOOKS] pass failed', {
      name: error instanceof Error ? error.name : 'unknown',
    });
    return json({ error: 'Internal server error', ...counts }, 500);
  }
}

export function createDeliverWebhooksHandler(
  deps: DeliverWebhooksDependencies = defaultDependencies(),
): (req: Request) => Promise<Response> {
  return (req) => deliverWebhooksHandler(req, deps);
}

if (import.meta.main) Deno.serve(createDeliverWebhooksHandler());
