import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { getCorsHeaders } from '../_shared/cors.ts';
import {
  DATA_SHARING_MIN_TIER,
  type DataSharingScope,
  isDataSharingScope,
  MAX_WEBHOOK_ENDPOINTS,
} from '../_shared/dataSharingScopes.ts';
import { decryptOAuthSecret, encryptOAuthSecret } from '../_shared/oauthTokenCrypto.ts';
import { checkRateLimit } from '../_shared/rateLimit.ts';
import { readBoundedRequestBody, REQUEST_BODY_LIMITS } from '../_shared/requestBody.ts';
import { requireSubscription } from '../_shared/requireSubscription.ts';
import { loadWebhookCredentials } from '../_shared/webhookCredentials.ts';
import { sendWebhook, webhookEnvelope, type WebhookSendResult } from '../_shared/webhookSend.ts';
import { generateWebhookSecret, webhookSecretHint } from '../_shared/webhookSigning.ts';
import {
  CUSTOM_HEADER_MESSAGES,
  type DnsResolver,
  ownHostsFromEnv,
  resolveWebhookTarget,
  systemDnsResolver,
  validateCustomHeader,
  WEBHOOK_TARGET_MESSAGES,
} from '../_shared/webhookTarget.ts';

/**
 * Data sharing: the one write path for a user's outbound webhook endpoints.
 *
 * POST { action, ... } with the user's JWT:
 *   create        { label, url, scopes, customHeader? }        -> 201 { endpoint, signingSecret }
 *   update        { endpointId, label?, url?, scopes?,
 *                   customHeader? | null, status? }            -> { endpoint }
 *   rotate_secret { endpointId }                               -> { endpoint, signingSecret }
 *   test          { endpointId }                               -> { delivered, statusCode, errorCode, durationMs }
 *   resend_all    { endpointId }                               -> { enqueued }
 *   delete        { endpointId }                               -> { deleted: true }
 *
 * Isolation (FP-1): the user id comes only from the verified JWT, and every
 * read and write below carries `.eq('user_id', userId)` or passes it to a
 * user-scoped RPC. An endpoint id that belongs to someone else is a 404.
 *
 * Tier (FP-2): FLAME and above, checked here on every action except `delete`
 * and a pause, which a lapsed user must always be able to do.
 *
 * Secrets (FP-5): the signing secret is generated here, stored encrypted and
 * returned exactly once, by `create` and `rotate_secret`. Nothing else ever
 * returns it, and nothing logs it, the custom header value, or the URL.
 *
 * Reads (the endpoint list and the delivery log) do not come through here:
 * the portal reads both tables directly under owner RLS.
 */

export const WEBHOOK_ENDPOINTS_RATE_LIMIT = { maxRequests: 60, windowSeconds: 300 } as const;
/**
 * create, test, a URL change and a resume are the only requests the portal
 * makes to a host a user chose, on demand. Kept tight so the function cannot
 * be used to probe hosts or names.
 */
export const WEBHOOK_OUTBOUND_RATE_LIMIT = { maxRequests: 10, windowSeconds: 900 } as const;
export const WEBHOOK_RESEND_RATE_LIMIT = { maxRequests: 2, windowSeconds: 3600 } as const;

const ENDPOINT_COLUMNS =
  'id, label, url, scopes, status, disabled_reason, custom_header_name, signing_key_hint, ' +
  'consecutive_failures, last_success_at, last_failure_at, created_at, updated_at';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LABEL_MAX = 80;

type Json = Record<string, unknown>;

interface EndpointRow {
  id: string;
  label: string;
  url: string;
  scopes: string[];
  status: 'active' | 'paused' | 'disabled';
  disabled_reason: string | null;
  custom_header_name: string | null;
  signing_key_hint: string;
  consecutive_failures: number;
  last_success_at: string | null;
  last_failure_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface WebhookEndpointsAuthClient {
  auth: { getUser(jwt: string): Promise<unknown> };
}

export interface WebhookEndpointsDependencies {
  createAuthClient(authorization: string): WebhookEndpointsAuthClient;
  createAdminClient(): SupabaseClient;
  fetch: typeof fetch;
  resolveDns: DnsResolver;
  env(name: string): string | undefined;
  now(): Date;
  encrypt(plain: string): Promise<string | null | undefined>;
  decrypt(stored: string): Promise<string | null | undefined>;
  generateSecret(): string;
  newId(): string;
}

function defaultDependencies(): WebhookEndpointsDependencies {
  return {
    createAuthClient(authorization: string) {
      return createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_ANON_KEY')!,
        {
          global: { headers: { Authorization: authorization } },
          auth: { persistSession: false, autoRefreshToken: false },
        },
      );
    },
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
    encrypt: encryptOAuthSecret,
    decrypt: decryptOAuthSecret,
    generateSecret: generateWebhookSecret,
    newId: () => crypto.randomUUID(),
  };
}

function json(body: unknown, status: number, cors: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

function isPlainObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function authStatus(error: unknown): number | null {
  if (!isPlainObject(error)) return null;
  return typeof error.status === 'number' ? error.status : null;
}

function invalid(message: string, cors: Record<string, string>, error = 'invalid_request'): Response {
  return json({ error, message }, 400, cors);
}

function notFound(cors: Record<string, string>): Response {
  return json({ error: 'endpoint_not_found', message: 'Endpoint not found.' }, 404, cors);
}

function unavailable(cors: Record<string, string>): Response {
  return new Response(
    JSON.stringify({ error: 'data_sharing_unavailable', message: 'Data sharing is temporarily unavailable. Please try again.' }),
    { status: 503, headers: { ...cors, 'Content-Type': 'application/json', 'Retry-After': '30' } },
  );
}

function parseLabel(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const label = value.trim();
  return label.length >= 1 && label.length <= LABEL_MAX ? label : null;
}

function parseScopes(value: unknown): DataSharingScope[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const scopes = new Set<DataSharingScope>();
  for (const entry of value) {
    if (!isDataSharingScope(entry)) return null;
    scopes.add(entry);
  }
  return [...scopes];
}

function parseEndpointId(body: Json): string | null {
  return typeof body.endpointId === 'string' && UUID.test(body.endpointId) ? body.endpointId : null;
}

/**
 * The endpoint as the browser may see it: an explicit allowlist, so a column
 * added to the table (or a wider select) can never leak through a response.
 */
function publicEndpoint(row: EndpointRow): EndpointRow {
  return {
    id: row.id,
    label: row.label,
    url: row.url,
    scopes: row.scopes,
    status: row.status,
    disabled_reason: row.disabled_reason,
    custom_header_name: row.custom_header_name,
    signing_key_hint: row.signing_key_hint,
    consecutive_failures: row.consecutive_failures,
    last_success_at: row.last_success_at,
    last_failure_at: row.last_failure_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function loadEndpoint(
  admin: SupabaseClient,
  userId: string,
  endpointId: string,
): Promise<{ ok: true; endpoint: EndpointRow | null } | { ok: false }> {
  const { data, error } = await admin
    .from('webhook_endpoints')
    .select(ENDPOINT_COLUMNS)
    .eq('id', endpointId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) {
    console.error('[WEBHOOK_ENDPOINTS] endpoint read failed', { code: (error as { code?: string }).code });
    return { ok: false };
  }
  return { ok: true, endpoint: data ? publicEndpoint(data as unknown as EndpointRow) : null };
}

/**
 * Sends a signed `ping` to the endpoint and records it in the delivery log.
 * The result is the same shape a real delivery produces.
 */
async function sendPing(
  deps: WebhookEndpointsDependencies,
  admin: SupabaseClient,
  userId: string,
  endpoint: EndpointRow,
): Promise<{ ok: true; result: WebhookSendResult } | { ok: false }> {
  const credentials = await loadWebhookCredentials(admin, {
    userId,
    endpointId: endpoint.id,
    customHeaderName: endpoint.custom_header_name,
    now: deps.now(),
  }, deps.decrypt);
  if (!credentials.ok) {
    console.error('[WEBHOOK_ENDPOINTS] credentials unavailable', { reason: credentials.reason });
    return { ok: false };
  }

  const deliveryId = deps.newId();
  const result = await sendWebhook(
    { fetch: deps.fetch, resolveDns: deps.resolveDns, ownHosts: ownHostsFromEnv(deps.env), now: deps.now },
    {
      url: endpoint.url,
      deliveryId,
      secrets: credentials.credentials.secrets,
      customHeader: credentials.credentials.customHeader,
      body: webhookEnvelope('ping', deps.now(), { endpointId: endpoint.id }),
    },
  );

  const nowIso = deps.now().toISOString();
  const { error } = await admin.from('webhook_deliveries').insert({
    id: deliveryId,
    endpoint_id: endpoint.id,
    user_id: userId,
    entity: 'ping',
    entity_id: deliveryId,
    event_type: 'ping',
    status: result.outcome === 'delivered' ? 'delivered' : 'dead',
    attempt_count: 1,
    next_attempt_at: nowIso,
    last_status_code: result.statusCode,
    last_error_code: result.errorCode,
    duration_ms: result.durationMs,
    finished_at: nowIso,
  });
  if (error) {
    // The user still gets the result; only the log line is missing.
    console.error('[WEBHOOK_ENDPOINTS] ping log insert failed', { code: (error as { code?: string }).code });
  }
  return { ok: true, result };
}

function pingBody(result: WebhookSendResult): Json {
  return {
    delivered: result.outcome === 'delivered',
    statusCode: result.statusCode,
    errorCode: result.errorCode,
    durationMs: result.durationMs,
  };
}

async function handleCreate(
  deps: WebhookEndpointsDependencies,
  admin: SupabaseClient,
  userId: string,
  body: Json,
  cors: Record<string, string>,
): Promise<Response> {
  const label = parseLabel(body.label);
  if (!label) return invalid(`label must be 1 to ${LABEL_MAX} characters.`, cors);
  const scopes = parseScopes(body.scopes);
  if (!scopes) return invalid('scopes must be a non-empty list of data sharing scopes.', cors);

  let header: { name: string; value: string } | null = null;
  if (body.customHeader !== undefined && body.customHeader !== null) {
    if (!isPlainObject(body.customHeader)) return invalid('customHeader must be an object.', cors);
    const checked = validateCustomHeader(body.customHeader.name, body.customHeader.value);
    if (!checked.ok) return invalid(CUSTOM_HEADER_MESSAGES[checked.code], cors, checked.code);
    header = { name: checked.name, value: checked.value };
  }

  const target = await resolveWebhookTarget(body.url, ownHostsFromEnv(deps.env), deps.resolveDns);
  if (!target.ok) return invalid(WEBHOOK_TARGET_MESSAGES[target.code], cors, target.code);

  const signingSecret = deps.generateSecret();
  const secretEnc = await deps.encrypt(signingSecret);
  const headerEnc = header ? await deps.encrypt(header.value) : null;
  if (!secretEnc || (header && !headerEnc)) return unavailable(cors);

  const { data: endpointId, error } = await admin.rpc('create_webhook_endpoint', {
    p_user_id: userId,
    p_label: label,
    p_url: target.normalized,
    p_scopes: scopes,
    p_signing_secret_enc: secretEnc,
    p_signing_key_hint: webhookSecretHint(signingSecret),
    p_custom_header_name: header?.name ?? null,
    p_custom_header_value_enc: headerEnc,
  });
  if (error) {
    if ((error.message ?? '').includes('webhook_endpoint_limit')) {
      return json({
        error: 'endpoint_limit',
        message: `You can register up to ${MAX_WEBHOOK_ENDPOINTS} endpoints.`,
      }, 409, cors);
    }
    console.error('[WEBHOOK_ENDPOINTS] create failed', { code: (error as { code?: string }).code });
    return unavailable(cors);
  }

  const loaded = await loadEndpoint(admin, userId, endpointId as string);
  if (!loaded.ok || !loaded.endpoint) return unavailable(cors);
  // The only time the secret is ever returned.
  return json({ endpoint: loaded.endpoint, signingSecret }, 201, cors);
}

/** True when the request does nothing but pause: allowed without FLAME. */
function isPauseOnly(body: Json): boolean {
  if (body.status !== 'paused') return false;
  return Object.keys(body).every((key) => key === 'action' || key === 'endpointId' || key === 'status');
}

async function handlePause(
  admin: SupabaseClient,
  userId: string,
  endpointId: string,
  cors: Record<string, string>,
): Promise<Response> {
  const { data, error } = await admin
    .from('webhook_endpoints')
    .update({ status: 'paused', disabled_reason: 'user_paused' })
    .eq('id', endpointId)
    .eq('user_id', userId)
    // A disabled endpoint keeps the reason it was switched off for.
    .eq('status', 'active')
    .select(ENDPOINT_COLUMNS)
    .maybeSingle();
  if (error) return unavailable(cors);
  if (data) return json({ endpoint: publicEndpoint(data as unknown as EndpointRow) }, 200, cors);
  const loaded = await loadEndpoint(admin, userId, endpointId);
  if (!loaded.ok) return unavailable(cors);
  if (!loaded.endpoint) return notFound(cors);
  return json({ endpoint: loaded.endpoint }, 200, cors);
}

async function handleUpdate(
  deps: WebhookEndpointsDependencies,
  admin: SupabaseClient,
  userId: string,
  endpointId: string,
  body: Json,
  cors: Record<string, string>,
): Promise<Response> {
  const loaded = await loadEndpoint(admin, userId, endpointId);
  if (!loaded.ok) return unavailable(cors);
  if (!loaded.endpoint) return notFound(cors);

  const patch: Json = {};
  if (body.label !== undefined) {
    const label = parseLabel(body.label);
    if (!label) return invalid(`label must be 1 to ${LABEL_MAX} characters.`, cors);
    patch.label = label;
  }
  if (body.scopes !== undefined) {
    const scopes = parseScopes(body.scopes);
    if (!scopes) return invalid('scopes must be a non-empty list of data sharing scopes.', cors);
    patch.scopes = scopes;
  }
  if (body.status !== undefined && body.status !== 'active' && body.status !== 'paused') {
    return invalid("status must be 'active' or 'paused'.", cors);
  }

  let header: { name: string; value: string } | null | undefined;
  if (body.customHeader === null) {
    header = null;
  } else if (body.customHeader !== undefined) {
    if (!isPlainObject(body.customHeader)) return invalid('customHeader must be an object or null.', cors);
    const checked = validateCustomHeader(body.customHeader.name, body.customHeader.value);
    if (!checked.ok) return invalid(CUSTOM_HEADER_MESSAGES[checked.code], cors, checked.code);
    header = { name: checked.name, value: checked.value };
  }

  if (body.url !== undefined) {
    const target = await resolveWebhookTarget(body.url, ownHostsFromEnv(deps.env), deps.resolveDns);
    if (!target.ok) return invalid(WEBHOOK_TARGET_MESSAGES[target.code], cors, target.code);
    patch.url = target.normalized;
  }

  if (header !== undefined) {
    const valueEnc = header ? await deps.encrypt(header.value) : null;
    if (header && !valueEnc) return unavailable(cors);
    const { data: updated, error } = await admin.rpc('set_webhook_endpoint_header', {
      p_user_id: userId,
      p_endpoint_id: endpointId,
      p_custom_header_name: header?.name ?? null,
      p_custom_header_value_enc: valueEnc,
    });
    if (error) return unavailable(cors);
    if (updated !== true) return notFound(cors);
  }

  // A disabled endpoint keeps the reason it was switched off for.
  if (body.status === 'paused' && loaded.endpoint.status === 'active') {
    patch.status = 'paused';
    patch.disabled_reason = 'user_paused';
  }

  if (Object.keys(patch).length > 0) {
    const { error } = await admin
      .from('webhook_endpoints')
      .update(patch)
      .eq('id', endpointId)
      .eq('user_id', userId);
    if (error) {
      console.error('[WEBHOOK_ENDPOINTS] update failed', { code: (error as { code?: string }).code });
      return unavailable(cors);
    }
  }

  let current = await loadEndpoint(admin, userId, endpointId);
  if (!current.ok || !current.endpoint) return unavailable(cors);

  // Switching an endpoint back on needs proof that it answers: one signed
  // ping to the URL as it now stands. Whatever switched it off (the user, a
  // lapsed plan, repeated failures, a 410) is cleared only by that.
  if (body.status === 'active' && current.endpoint.status !== 'active') {
    const ping = await sendPing(deps, admin, userId, current.endpoint);
    if (!ping.ok) return unavailable(cors);
    if (ping.result.outcome !== 'delivered') {
      return json({
        error: 'test_delivery_failed',
        message: 'The endpoint did not accept a test delivery, so it was not switched on.',
        ...pingBody(ping.result),
      }, 409, cors);
    }
    const { error } = await admin
      .from('webhook_endpoints')
      // Both columns in one statement: the table requires an active endpoint
      // to have no disabled_reason.
      .update({ status: 'active', disabled_reason: null, consecutive_failures: 0 })
      .eq('id', endpointId)
      .eq('user_id', userId);
    if (error) return unavailable(cors);
    current = await loadEndpoint(admin, userId, endpointId);
    if (!current.ok || !current.endpoint) return unavailable(cors);
  }

  return json({ endpoint: current.endpoint }, 200, cors);
}

async function handleRotate(
  deps: WebhookEndpointsDependencies,
  admin: SupabaseClient,
  userId: string,
  endpointId: string,
  cors: Record<string, string>,
): Promise<Response> {
  const signingSecret = deps.generateSecret();
  const secretEnc = await deps.encrypt(signingSecret);
  if (!secretEnc) return unavailable(cors);
  const { data: rotated, error } = await admin.rpc('rotate_webhook_signing_secret', {
    p_user_id: userId,
    p_endpoint_id: endpointId,
    p_signing_secret_enc: secretEnc,
    p_signing_key_hint: webhookSecretHint(signingSecret),
  });
  if (error) {
    console.error('[WEBHOOK_ENDPOINTS] rotate failed', { code: (error as { code?: string }).code });
    return unavailable(cors);
  }
  if (rotated !== true) return notFound(cors);
  const loaded = await loadEndpoint(admin, userId, endpointId);
  if (!loaded.ok || !loaded.endpoint) return unavailable(cors);
  return json({ endpoint: loaded.endpoint, signingSecret }, 200, cors);
}

async function handleDelete(
  admin: SupabaseClient,
  userId: string,
  endpointId: string,
  cors: Record<string, string>,
): Promise<Response> {
  // The secret row and the delivery log cascade from the endpoint.
  const { data, error } = await admin
    .from('webhook_endpoints')
    .delete()
    .eq('id', endpointId)
    .eq('user_id', userId)
    .select('id');
  if (error) {
    console.error('[WEBHOOK_ENDPOINTS] delete failed', { code: (error as { code?: string }).code });
    return unavailable(cors);
  }
  if (!Array.isArray(data) || data.length === 0) return notFound(cors);
  return json({ deleted: true }, 200, cors);
}

async function webhookEndpointsHandler(
  req: Request,
  deps: WebhookEndpointsDependencies,
): Promise<Response> {
  const cors = getCorsHeaders(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405, cors);

  try {
    const authorization = req.headers.get('Authorization');
    const bearer = authorization ? /^Bearer ([^\s]+)$/.exec(authorization) : null;
    if (!authorization || !bearer) return json({ error: 'Missing bearer token' }, 401, cors);

    // A rejected JWT is 401; an auth-service failure is 503 so the client
    // retries instead of treating it as a signed-out session.
    let authResult: unknown;
    try {
      authResult = await deps.createAuthClient(authorization).auth.getUser(bearer[1]);
    } catch {
      console.error('[WEBHOOK_ENDPOINTS] auth service error');
      return json({ error: 'Authentication service unavailable' }, 503, cors);
    }
    const authError = isPlainObject(authResult) ? authResult.error : null;
    if (authError) {
      const status = authStatus(authError);
      if (status === 400 || status === 401 || status === 403) {
        return json({ error: 'Invalid bearer token' }, 401, cors);
      }
      console.error('[WEBHOOK_ENDPOINTS] auth service error', { status });
      return json({ error: 'Authentication service unavailable' }, 503, cors);
    }
    const authData = isPlainObject(authResult) ? authResult.data : null;
    const user = isPlainObject(authData) ? authData.user : null;
    if (!isPlainObject(user) || typeof user.id !== 'string' || user.id.length === 0) {
      return json({ error: 'Invalid bearer token' }, 401, cors);
    }
    const userId = user.id;

    const read = await readBoundedRequestBody(req, REQUEST_BODY_LIMITS.webhookEndpoints);
    if (read.kind === 'too_large') return json({ error: 'Request too large' }, 413, cors);
    if (read.kind === 'read_failure') return json({ error: 'Request body could not be read' }, 400, cors);
    let body: unknown;
    try {
      body = JSON.parse(new TextDecoder().decode(read.bytes));
    } catch {
      return invalid('Invalid JSON body.', cors);
    }
    if (!isPlainObject(body) || typeof body.action !== 'string') {
      return invalid('action is required.', cors);
    }
    const action = body.action;
    if (!['create', 'update', 'rotate_secret', 'test', 'resend_all', 'delete'].includes(action)) {
      return invalid('Unknown action.', cors);
    }

    let endpointId = '';
    if (action !== 'create') {
      const parsed = parseEndpointId(body);
      if (!parsed) return invalid('endpointId must be a UUID.', cors);
      endpointId = parsed;
    }

    const admin = deps.createAdminClient();
    const rate = await checkRateLimit(admin, {
      key: 'webhook-endpoints',
      userId,
      ...WEBHOOK_ENDPOINTS_RATE_LIMIT,
    }, cors);
    if (!rate.allowed) return rate.response!;

    // Before the tier gate, deliberately: someone whose plan lapsed must
    // still be able to stop their data leaving.
    if (action === 'delete') return await handleDelete(admin, userId, endpointId, cors);
    if (action === 'update' && isPauseOnly(body)) {
      return await handlePause(admin, userId, endpointId, cors);
    }

    const gate = await requireSubscription(admin, userId, DATA_SHARING_MIN_TIER, cors, deps.now());
    if (!gate.allowed) return gate.response;

    const outbound = action === 'create' || action === 'test' ||
      (action === 'update' && (body.url !== undefined || body.status === 'active'));
    if (outbound) {
      const outboundRate = await checkRateLimit(admin, {
        key: 'webhook-endpoints-outbound',
        userId,
        ...WEBHOOK_OUTBOUND_RATE_LIMIT,
      }, cors);
      if (!outboundRate.allowed) return outboundRate.response!;
    }

    if (action === 'create') return await handleCreate(deps, admin, userId, body, cors);
    if (action === 'update') return await handleUpdate(deps, admin, userId, endpointId, body, cors);
    if (action === 'rotate_secret') return await handleRotate(deps, admin, userId, endpointId, cors);

    if (action === 'test') {
      const loaded = await loadEndpoint(admin, userId, endpointId);
      if (!loaded.ok) return unavailable(cors);
      if (!loaded.endpoint) return notFound(cors);
      const ping = await sendPing(deps, admin, userId, loaded.endpoint);
      if (!ping.ok) return unavailable(cors);
      return json(pingBody(ping.result), 200, cors);
    }

    // resend_all
    const resendRate = await checkRateLimit(admin, {
      key: 'webhook-endpoints-resend',
      userId,
      ...WEBHOOK_RESEND_RATE_LIMIT,
    }, cors);
    if (!resendRate.allowed) return resendRate.response!;
    const loaded = await loadEndpoint(admin, userId, endpointId);
    if (!loaded.ok) return unavailable(cors);
    if (!loaded.endpoint) return notFound(cors);
    if (loaded.endpoint.status !== 'active') {
      return json({
        error: 'endpoint_not_active',
        message: 'Switch the endpoint on before resending.',
      }, 409, cors);
    }
    const { data: enqueued, error } = await admin.rpc('enqueue_webhook_backfill', {
      p_user_id: userId,
      p_endpoint_id: endpointId,
    });
    if (error) {
      console.error('[WEBHOOK_ENDPOINTS] backfill failed', { code: (error as { code?: string }).code });
      return unavailable(cors);
    }
    return json({ enqueued: typeof enqueued === 'number' ? enqueued : 0 }, 200, cors);
  } catch (error) {
    // The error name only: a message could carry a URL or a header value.
    console.error('[WEBHOOK_ENDPOINTS] unhandled error', {
      name: error instanceof Error ? error.name : 'unknown',
    });
    return json({ error: 'Internal server error' }, 500, cors);
  }
}

export function createWebhookEndpointsHandler(
  deps: WebhookEndpointsDependencies = defaultDependencies(),
): (req: Request) => Promise<Response> {
  return (req) => webhookEndpointsHandler(req, deps);
}

if (import.meta.main) Deno.serve(createWebhookEndpointsHandler());
