/**
 * Account purge core (FP-6, PR 34). Shared by the user-initiated "Delete now"
 * path in `delete-account` and the scheduled `process_due` executor (PR 35).
 *
 * Every step is idempotent, so a failed or interrupted purge can simply be run
 * again, and every irreversible step comes after the checks that can abort:
 *
 *   1. Billing. If the user has a `paddle_subscription_id`, fetch its LIVE
 *      Paddle status and cancel it immediately unless it is already
 *      `canceled`. This covers `paused` and every other state (F-064). Any
 *      failure, including a missing PADDLE_API_KEY, aborts before anything
 *      is deleted. A Paddle 404 continues only when the local row is already
 *      terminal (`canceled`/`expired`); otherwise it aborts with
 *      `billing_not_found` for support to resolve, so a wrong key or
 *      environment can never let billing continue silently.
 *      Enumerate every customer page, prove each subscription's ownership,
 *      and cancel owned siblings including paused subscriptions. Cancel any
 *      outstanding server checkout too. The service-only checkout ledger
 *      retains cancellation evidence through retries until auth deletion.
 *   1b. Providers (PR 54): for every provider with a stored token, revoke
 *      the grant at the provider (best effort) and call
 *      `disconnect_integration` (`providerRevoke.ts#revokeAndDisconnect`).
 *      A database error aborts with `provider_disconnect`, user intact.
 *      Unlike step 2, this step has side effects that are NOT harmless to
 *      lose: provider grants revoked (irreversible at the provider),
 *      integrations reset to `disconnected` and queued syncs cancelled. That
 *      is intended (review R-12): if provider N fails, providers 1..N-1 stay
 *      disconnected, the user can reconnect, and a retry is idempotent (no
 *      stored token means no revoke, and the RPC is a no-op).
 *   2. Pre-pass: explicit rows that are harmless to lose if the purge then
 *      aborts (`oauth_tokens`, `paddle_webhook_events`). Any failure aborts
 *      with the user still intact.
 *   3. `auth.admin.deleteUser`. A user that is already gone counts as done.
 *   3a. Post-pass: every explicit table, after the user is gone. Targets
 *      marked `postOnly` are deleted only here. The cascade itself writes rows
 *      into FK-less tables: the prod `subscriptions` audit trigger inserts a
 *      DELETE row into `subscription_events`, and the `sync_tombstones`
 *      trigger would record the cascaded routine/cycle deletes if its guard
 *      ever failed (R-6, R-30). The user is already deleted, so a failure
 *      here is logged as `[DELETION_ALERT]` and returned in `residualTables`,
 *      not as a failed purge. The durable retry is the residue sweep that
 *      `delete-account` `process_due` runs every hour
 *      (public.sweep_deleted_account_residue, PR 35).
 *   4. Avatars, best effort, after the user is deleted.
 *
 * "Table/column does not exist" is tolerated only for targets marked
 * `mayBeAbsent` (prod-only tables with no migration yet); for every other
 * target it is a failure (a stale schema cache must not look like success).
 */
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { listPaddleCustomerSubscriptions, verifyCheckoutBinding } from './paddleCheckoutBinding.ts';
import { verifyPaddleCustomDataSignature } from './paddleWebhookSecurity.ts';
import {
  defaultProviderRevokeDependencies,
  type ProviderRevokeDependencies,
  revokeAndDisconnect,
} from './providerRevoke.ts';

/** How `purgeUser` finds one explicit table's rows for the user. */
export interface ExplicitPurgeTarget {
  table: string;
  /** Column holding the user id. */
  column: string;
  /**
   * Used instead of `column` when that column does not exist on this
   * database (a PostgREST JSON path filter). Only for `mayBeAbsent` targets.
   */
  fallbackColumn?: string;
  /**
   * Deleted only after `deleteUser` succeeds, never in the abortable pre-pass,
   * because losing these rows while the user survives an aborted purge would
   * hurt them: tombstones (a stale phone would resurrect deleted routines),
   * the billing audit trail, the rate limiter the handler just charged, and
   * user data that already cascades in prod.
   */
  postOnly?: true;
  /**
   * Prod-only table with no migration yet: skipped (logged) where it or its
   * filter column does not exist. Every other target must exist.
   */
  mayBeAbsent?: true;
}

/**
 * Tables `purgeUser` deletes explicitly, by user id.
 *
 * INTEGRATION POINT (PR 36): this list mirrors the `purge: "explicit"` entries
 * of `USER_DATA_MANIFEST` / `EXCLUDED` in `_shared/userDataManifest.ts`, plus
 * `oauth_tokens` (cascades, but deleted first on purpose; step 1b has already
 * revoked and disconnected each provider, so this is the safety net). When PR 36 lands, derive this list from the manifest and
 * carry over `postOnly` and `mayBeAbsent`.
 */
export const EXPLICIT_PURGE_TARGETS: readonly ExplicitPurgeTarget[] = [
  { table: 'oauth_tokens', column: 'user_id' },
  {
    table: 'paddle_webhook_events',
    column: 'user_id',
    fallbackColumn: 'payload->data->custom_data->>user_id',
    mayBeAbsent: true,
  },
  // The handler charges this just before the purge; keeping it until the
  // user is gone means a failed purge cannot reset the limiter (R-15).
  { table: 'rate_limit_tracking', column: 'user_id', postOnly: true },
  // The cascade writes a DELETE row here (prod subscriptions audit trigger).
  { table: 'subscription_events', column: 'user_id', postOnly: true, mayBeAbsent: true },
  // R-6, R-30: after the user is deleted (PR 16's trigger guard is the
  // primary defence; this is the safety net).
  { table: 'sync_tombstones', column: 'user_id', postOnly: true },
  // FK ON DELETE CASCADE in prod (prod-evidence.md); swept for DBs without it.
  { table: 'goal_snapshots', column: 'user_id', postOnly: true, mayBeAbsent: true },
  { table: 'overload_suggestions', column: 'user_id', postOnly: true, mayBeAbsent: true },
  { table: 'telemetry_analysis', column: 'user_id', postOnly: true, mayBeAbsent: true },
  { table: 'wearable_daily_summaries', column: 'user_id', postOnly: true, mayBeAbsent: true },
  // Pre-20260925200000 force-curve rows (manifest: purge "explicit"). Its FK
  // to auth.users still cascades; this is the safety net, and the table is
  // dropped once the set_telemetry backfill is verified.
  { table: 'rep_telemetry_legacy', column: 'user_id', postOnly: true, mayBeAbsent: true },
];

/**
 * Additional `paddle_webhook_events` matches, beyond `user_id`: rows whose
 * `user_id` was never filled in but whose payload names the user, and rows
 * keyed by the user's Paddle subscription id when no other user references it
 * (R-7, R-21). Never by customer id.
 */
const PADDLE_WEBHOOK_PAYLOAD_USER = 'payload->data->custom_data->>user_id';

export type PurgeFailureStage =
  | 'billing_config'
  | 'billing_lookup'
  | 'billing_not_found'
  | 'billing_cancel'
  | 'provider_disconnect'
  | 'explicit_rows'
  | 'delete_user';

export type PurgeResult =
  | {
    ok: true;
    /** A live Paddle subscription was cancelled by this run. */
    billingCancelled: boolean;
    /** Tables whose post-delete sweep failed (already logged as an alert). */
    residualTables: string[];
  }
  | {
    ok: false;
    stage: PurgeFailureStage;
    /** A Paddle cancel succeeded before the failure (irreversible). */
    billingCancelled: boolean;
    detail: string;
  };

export interface PurgeUserDependencies {
  fetch: typeof fetch;
  /** PADDLE_API_KEY, or undefined when not configured. */
  paddleApiKey: string | undefined;
  /** `sandbox` or `production` (default). */
  paddleEnvironment: string | undefined;
  paddleCustomDataSecret?: string;
  /** Provider grant revocation (PR 54); defaults to the real providers. */
  providerRevoke?: ProviderRevokeDependencies;
}

export function defaultPurgeUserDependencies(): PurgeUserDependencies {
  return {
    fetch: (input, init) => fetch(input, init),
    paddleApiKey: Deno.env.get('PADDLE_API_KEY'),
    paddleEnvironment: Deno.env.get('PADDLE_ENVIRONMENT'),
    paddleCustomDataSecret: Deno.env.get('PADDLE_CUSTOM_DATA_SECRET'),
    providerRevoke: defaultProviderRevokeDependencies(),
  };
}

function paddleBaseUrl(environment: string | undefined): string {
  return (environment ?? 'production') === 'sandbox'
    ? 'https://sandbox-api.paddle.com'
    : 'https://api.paddle.com';
}

interface PostgrestLikeError {
  code?: string;
  message?: string;
}

/** The table does not exist on this database (prod-only tables, locally). */
function isMissingTable(error: PostgrestLikeError): boolean {
  const message = error.message ?? '';
  return error.code === '42P01' ||
    error.code === 'PGRST205' ||
    /could not find the table/i.test(message) ||
    /relation .* does not exist/i.test(message);
}

/** The filter column does not exist on this table. */
function isMissingColumn(error: PostgrestLikeError): boolean {
  const message = error.message ?? '';
  return error.code === '42703' ||
    error.code === 'PGRST204' ||
    /column .* does not exist/i.test(message);
}

function describe(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object') {
    const { code, message } = error as PostgrestLikeError;
    return [code, message].filter(Boolean).join(': ') || 'unknown error';
  }
  return String(error);
}

type DeleteOutcome = 'deleted' | 'missing_table' | 'missing_column' | PostgrestLikeError;

async function deleteWhere(
  admin: SupabaseClient,
  table: string,
  column: string,
  value: string,
): Promise<DeleteOutcome> {
  const { error } = await admin.from(table).delete().eq(column, value);
  if (!error) return 'deleted';
  if (isMissingTable(error)) return 'missing_table';
  if (isMissingColumn(error)) return 'missing_column';
  return error;
}

/** Paddle ids known locally for the user (for the webhook-row match). */
interface BillingIds {
  subscriptionId: string | null;
  subscriptionIds?: string[];
}

/**
 * Whether `subscriptionId` belongs to this user alone: no OTHER user's
 * `subscriptions` row references it (R-21). Anything but a clean "no other
 * row" answer (including a lookup error) means "not safe", so the match is
 * skipped rather than risking another account's rows.
 */
async function subscriptionIdIsOwnedSolelyBy(
  admin: SupabaseClient,
  subscriptionId: string,
  userId: string,
): Promise<boolean> {
  const { count, error } = await admin
    .from('subscriptions')
    .select('user_id', { count: 'exact', head: true })
    .eq('paddle_subscription_id', subscriptionId)
    .neq('user_id', userId);
  if (error) {
    console.error('[PURGE] shared-subscription check failed; subscription-id match skipped', {
      user_id: userId,
      paddle_subscription_id: subscriptionId,
      error: describe(error),
    });
    return false;
  }
  if ((count ?? 0) > 0) {
    console.warn('[PURGE] paddle_subscription_id is referenced by another user; subscription-id match skipped', {
      user_id: userId,
      paddle_subscription_id: subscriptionId,
    });
    return false;
  }
  return true;
}

/**
 * Every (column, value) filter that selects the user's rows of `target`, in
 * order. The first is the primary owner column.
 *
 * Never matched by `paddle_customer_id`: Paddle customers are keyed by email
 * and can be shared between accounts, so a customer-id match could delete
 * another account's rows (R-21). The subscription-id match is used only when
 * no other user's `subscriptions` row references that id (re-checked in each
 * pass).
 */
async function matchesFor(
  admin: SupabaseClient,
  target: ExplicitPurgeTarget,
  userId: string,
  ids: BillingIds,
): Promise<[string, string][]> {
  const matches: [string, string][] = [[target.column, userId]];
  if (target.table === 'paddle_webhook_events') {
    matches.push([PADDLE_WEBHOOK_PAYLOAD_USER, userId]);
    for (const subscriptionId of ids.subscriptionIds ?? (ids.subscriptionId ? [ids.subscriptionId] : [])) {
      if (await subscriptionIdIsOwnedSolelyBy(admin, subscriptionId, userId)) {
        matches.push(['paddle_subscription_id', subscriptionId]);
      }
    }
  }
  return matches;
}

/**
 * Deletes the user's rows from the explicit tables of `phase` (`pre`: all but
 * `postOnly` targets; `post`: all). Returns the tables that failed.
 */
async function purgeExplicitRows(
  admin: SupabaseClient,
  userId: string,
  phase: 'pre' | 'post',
  ids: BillingIds,
): Promise<{ table: string; detail: string }[]> {
  const failures: { table: string; detail: string }[] = [];
  targets: for (const target of EXPLICIT_PURGE_TARGETS) {
    if (phase === 'pre' && target.postOnly) continue;
    const matches = await matchesFor(admin, target, userId, ids);
    for (const [index, [column, value]] of matches.entries()) {
      let outcome = await deleteWhere(admin, target.table, column, value);
      if (outcome === 'missing_column' && index === 0 && target.fallbackColumn) {
        outcome = await deleteWhere(admin, target.table, target.fallbackColumn, userId);
      }
      if (outcome === 'deleted') continue;
      if (outcome === 'missing_table' && target.mayBeAbsent) {
        console.warn(`[PURGE] ${target.table} does not exist here; skipped`);
        continue targets;
      }
      if (outcome === 'missing_column' && target.mayBeAbsent) {
        console.warn(`[PURGE] ${target.table}.${column} does not exist here; skipped`);
        continue;
      }
      const detail = outcome === 'missing_table'
        ? 'table does not exist'
        : outcome === 'missing_column'
        ? `column ${column} does not exist`
        : describe(outcome);
      failures.push({ table: target.table, detail });
      continue targets;
    }
  }
  return failures;
}

type PaddleResponse =
  | { ok: true; body: unknown }
  | { ok: false; status: number | null; detail: string };

async function paddleRequest(
  deps: PurgeUserDependencies,
  apiKey: string,
  path: string,
  init: RequestInit = {},
): Promise<PaddleResponse> {
  try {
    const res = await deps.fetch(`${paddleBaseUrl(deps.paddleEnvironment)}${path}`, {
      ...init,
      signal: AbortSignal.timeout(10_000),
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    });
    const text = await res.text();
    if (!res.ok) {
      return { ok: false, status: res.status, detail: `HTTP ${res.status}: ${text.slice(0, 500)}` };
    }
    try {
      return { ok: true, body: text ? JSON.parse(text) : null };
    } catch {
      return { ok: false, status: res.status, detail: 'unparseable Paddle response' };
    }
  } catch (err) {
    return { ok: false, status: null, detail: describe(err) };
  }
}

function liveStatus(body: unknown): string | null {
  const status = (body as { data?: { status?: unknown } } | null)?.data?.status;
  return typeof status === 'string' ? status : null;
}

/** Local mirror states in which nothing can bill the user any more. */
const TERMINAL_LOCAL_STATUSES = new Set(['canceled', 'expired']);

type BillingOutcome =
  | { ok: true; cancelled: boolean; ids: BillingIds }
  | { ok: false; stage: PurgeFailureStage; detail: string };

async function cancelBilling(
  admin: SupabaseClient,
  userId: string,
  deps: PurgeUserDependencies,
): Promise<BillingOutcome> {
  const { data: subscription, error } = await admin
    .from('subscriptions')
    .select('paddle_subscription_id, paddle_customer_id, status')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) return { ok: false, stage: 'billing_lookup', detail: describe(error) };

  const row = subscription as {
    paddle_subscription_id?: string | null;
    paddle_customer_id?: string | null;
    status?: string | null;
  } | null;
  const ids: BillingIds = { subscriptionId: row?.paddle_subscription_id ?? null };
  const subscriptionId = ids.subscriptionId;
  const { data: ledgerData, error: ledgerError } = await admin.from('paddle_checkout_authorizations')
    .select('nonce, transaction_id, subscription_id, customer_id, state').eq('user_id', userId).limit(1001);
  if (ledgerError) return { ok: false, stage: 'billing_lookup', detail: describe(ledgerError) };
  const ledger = (ledgerData ?? []) as { nonce: string; transaction_id: string | null; subscription_id: string | null; customer_id: string | null; state: string }[];
  if (ledger.length >= 1000) return { ok: false, stage: 'billing_lookup', detail: 'Checkout history exceeds reconciliation limit' };
  if (!subscriptionId && !row?.paddle_customer_id && ledger.length === 0) return { ok: true, cancelled: false, ids };
  if (!deps.paddleApiKey) {
    return { ok: false, stage: 'billing_config', detail: 'PADDLE_API_KEY is not set' };
  }
  const customers = new Set<string>();
  if (row?.paddle_customer_id) customers.add(row.paddle_customer_id);
  const owned = new Map<string, string>();
  const durableOwned = new Set(ledger.filter((entry) => entry.state !== 'canceled').map((entry) => entry.subscription_id).filter((id): id is string => !!id));
  if (subscriptionId) {
    if (!await subscriptionIdIsOwnedSolelyBy(admin, subscriptionId, userId)) return { ok: false, stage: 'billing_lookup', detail: 'Tracked subscription ownership is ambiguous' };
    const current = await paddleRequest(deps, deps.paddleApiKey, `/subscriptions/${encodeURIComponent(subscriptionId)}`);
    if (!current.ok) {
      if (current.status !== 404 || !TERMINAL_LOCAL_STATUSES.has(row?.status ?? '')) {
        return { ok: false, stage: current.status === 404 ? 'billing_not_found' : 'billing_lookup', detail: current.detail };
      }
    } else {
      const status = liveStatus(current.body);
      const data = (current.body as { data?: { id?: string; customer_id?: string } })?.data;
      if (!status || data?.id !== subscriptionId || (!data.customer_id && !row?.paddle_customer_id)) return { ok: false, stage: 'billing_lookup', detail: 'Paddle response has invalid subscription context' };
      if (data.customer_id) customers.add(data.customer_id);
      owned.set(subscriptionId, status);
    }
  }
  // Pending transactions must be terminal before erasure too: otherwise a
  // retained overlay can create a new subscription after the account is gone.
  for (const entry of ledger) {
    if (entry.customer_id) customers.add(entry.customer_id);
    if (entry.state === 'canceled' || entry.state === 'bound') continue;
    if (!entry.transaction_id) return { ok: false, stage: 'billing_lookup', detail: 'Checkout creation needs reconciliation' };
    const result = await paddleRequest(deps, deps.paddleApiKey, `/transactions/${encodeURIComponent(entry.transaction_id)}`);
    if (!result.ok) return { ok: false, stage: 'billing_lookup', detail: result.detail };
    const transaction = (result.body as { data?: { id?: string; status?: string; subscription_id?: string; customer_id?: string } })?.data;
    if (transaction?.id !== entry.transaction_id) return { ok: false, stage: 'billing_lookup', detail: 'Invalid checkout transaction response' };
    if (transaction.customer_id) customers.add(transaction.customer_id);
    if (transaction.subscription_id) durableOwned.add(transaction.subscription_id);
    if (transaction.status === 'completed' || transaction.status === 'paid') {
      if (!transaction.subscription_id) return { ok: false, stage: 'billing_lookup', detail: 'Checkout subscription is not yet resolved' };
      continue;
    }
    if (!['draft', 'ready', 'canceled'].includes(transaction.status ?? '')) return { ok: false, stage: 'billing_lookup', detail: 'Checkout status is ambiguous' };
    if (transaction.status !== 'canceled') {
      const cancel = await paddleRequest(deps, deps.paddleApiKey, `/transactions/${encodeURIComponent(entry.transaction_id)}`, { method: 'PATCH', body: JSON.stringify({ status: 'canceled' }) });
      if (!cancel.ok || liveStatus(cancel.body) !== 'canceled') return { ok: false, stage: 'billing_cancel', detail: 'Checkout transaction cancellation was not confirmed' };
    }
    const recorded = await admin.from('paddle_checkout_authorizations').update({ state: 'canceled' }).eq('user_id', userId).eq('nonce', entry.nonce);
    if (recorded.error) return { ok: false, stage: 'billing_lookup', detail: describe(recorded.error) };
  }
  if (customers.size === 0) {
    if (!subscriptionId && durableOwned.size === 0) return { ok: true, cancelled: false, ids };
    return { ok: false, stage: 'billing_lookup', detail: 'Billing customer is unknown' };
  }
  for (const customerId of customers) {
    let candidates: Array<Record<string, unknown>>;
    try { candidates = await listPaddleCustomerSubscriptions(deps.fetch, deps.paddleApiKey, deps.paddleEnvironment, customerId); }
    catch (error) { return { ok: false, stage: 'billing_lookup', detail: describe(error) }; }
    for (const candidate of candidates) {
      const id = candidate.id as string;
      const data = candidate.custom_data as { user_id?: unknown; cd_sig?: unknown } | null;
      if (id === subscriptionId || durableOwned.has(id)) {
        if (data?.user_id && data.user_id !== userId) return { ok: false, stage: 'billing_lookup', detail: 'Stored billing ownership contradicts Paddle' };
      } else {
        // Shared customer IDs are not ownership. Clearly foreign accounts are
        // left alone; missing or contradictory proof blocks erasure.
        if (typeof data?.user_id === 'string' && data.user_id !== userId) continue;
        if (data?.user_id !== userId || !deps.paddleCustomDataSecret ||
          !(await verifyCheckoutBinding(data, deps.paddleCustomDataSecret) || await verifyPaddleCustomDataSignature(userId, data.cd_sig, deps.paddleCustomDataSecret))) {
          return { ok: false, stage: 'billing_lookup', detail: 'Customer subscription ownership is ambiguous' };
        }
      }
      if (!await subscriptionIdIsOwnedSolelyBy(admin, id, userId)) return { ok: false, stage: 'billing_lookup', detail: 'Subscription is referenced by another account' };
      owned.set(id, candidate.status as string);
      // Durable cancellation evidence survives every abort until auth deletion.
      const recorded = await admin.from('paddle_checkout_authorizations').upsert({ nonce: crypto.randomUUID(), user_id: userId,
        price_id: 'legacy', environment: deps.paddleEnvironment === 'sandbox' ? 'sandbox' : 'production', expires_at: new Date().toISOString(),
        subscription_id: id, customer_id: customerId, state: 'bound' }, { onConflict: 'subscription_id', ignoreDuplicates: true });
      if (recorded.error) return { ok: false, stage: 'billing_lookup', detail: describe(recorded.error) };
    }
  }
  for (const id of durableOwned) {
    if (!owned.has(id)) return { ok: false, stage: 'billing_lookup', detail: 'Recorded subscription is absent from Paddle listing' };
  }
  let cancelled = false;
  for (const [id, status] of owned) {
    if (status !== 'canceled') {
      const cancel = await paddleRequest(deps, deps.paddleApiKey, `/subscriptions/${encodeURIComponent(id)}/cancel`, { method: 'POST', body: JSON.stringify({ effective_from: 'immediately' }) });
      if (!cancel.ok || liveStatus(cancel.body) !== 'canceled') return { ok: false, stage: 'billing_cancel', detail: 'Subscription cancellation was not confirmed' };
      cancelled = true;
    }
    const recorded = await admin.from('paddle_checkout_authorizations').update({ state: 'canceled' }).eq('user_id', userId).eq('subscription_id', id);
    if (recorded.error) return { ok: false, stage: 'billing_lookup', detail: describe(recorded.error) };
  }
  ids.subscriptionIds = [...owned.keys()];

  // Mirror the cancel locally right away so tier gating is correct even if a
  // later step fails; the Paddle webhook will converge to the same state.
  const { error: mirrorError } = await admin
    .from('subscriptions')
    .update({
      status: 'canceled',
      cancel_at_period_end: false,
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', userId);
  if (mirrorError) {
    console.error('[PURGE] Paddle cancelled but local subscription mirror failed:', {
      user_id: userId,
      error: describe(mirrorError),
    });
  }
  return { ok: true, cancelled, ids };
}

function isUserNotFound(error: unknown): boolean {
  const e = error as { status?: number; code?: string; message?: string } | null;
  return e?.status === 404 || e?.code === 'user_not_found' ||
    /user not found/i.test(e?.message ?? '');
}

/** Objects listed per `list()` page. */
const AVATAR_LIST_PAGE = 1000;
/** Nested prefixes below `avatars/<uid>/` are unexpected; bound the walk. */
const AVATAR_MAX_DEPTH = 5;

interface StorageEntry {
  name: string;
  /** Supabase returns `id: null` for a prefix (folder) placeholder. */
  id?: string | null;
}

type AvatarBucket = ReturnType<SupabaseClient['storage']['from']>;

/**
 * Every object key under `prefix`, descending into folder placeholders.
 * The storage RLS policy for avatars allows any key under `<uid>/%` (LIKE
 * matches further slashes), so `<uid>/thumbs/x.png` is reachable even though
 * the portal only writes `<uid>/avatar.<ext>`; a non-recursive list would
 * return `thumbs` as a folder, `remove('<uid>/thumbs')` would delete nothing,
 * and the image would stay publicly fetchable in a public bucket.
 */
async function listAvatarObjects(
  bucket: AvatarBucket,
  prefix: string,
  depth = 0,
): Promise<string[]> {
  const { data, error } = await bucket.list(prefix, { limit: AVATAR_LIST_PAGE });
  if (error) throw error;
  const keys: string[] = [];
  for (const entry of (data ?? []) as StorageEntry[]) {
    const key = `${prefix}/${entry.name}`;
    if (entry.id === null) {
      // A prefix, not an object. Anything deeper than the cap is reported as
      // not-removed rather than silently counted as cleaned.
      if (depth >= AVATAR_MAX_DEPTH) {
        throw new Error(`avatar prefix nested deeper than ${AVATAR_MAX_DEPTH}: ${key}`);
      }
      keys.push(...await listAvatarObjects(bucket, key, depth + 1));
      continue;
    }
    keys.push(key);
  }
  return keys;
}

/**
 * Removes every object under `avatars/<userId>/`, including nested prefixes.
 * Best effort: a failure is logged as `[DELETION_ALERT] avatar_cleanup_failed`
 * and returns false. Returns false as well when objects are still there after
 * the removal, so a folder that cannot be cleaned raises an alert instead of
 * counting as removed. Also used by the `process_due` residue sweep for
 * folders of deleted users.
 */
export async function removeAvatars(admin: SupabaseClient, userId: string): Promise<boolean> {
  try {
    const bucket = admin.storage.from('avatars');
    const keys = await listAvatarObjects(bucket, userId);
    if (keys.length > 0) {
      const { error: removeError } = await bucket.remove(keys);
      if (removeError) throw removeError;
      console.log(`[PURGE] Removed ${keys.length} avatar file(s) for user ${userId}`);
      const left = await listAvatarObjects(bucket, userId);
      if (left.length > 0) {
        throw new Error(`${left.length} avatar object(s) still present after removal`);
      }
    }
    return true;
  } catch (err) {
    console.error('[DELETION_ALERT] avatar_cleanup_failed', { user_id: userId, error: describe(err) });
    return false;
  }
}

/**
 * Revokes and disconnects every provider the user has a stored token for.
 * Returns a failure description, or null when every provider disconnected.
 * A failed provider revoke is logged inside `revokeAndDisconnect` and does not
 * fail the purge; only a database error does.
 */
async function disconnectProviders(
  admin: SupabaseClient,
  userId: string,
  revokeDeps: ProviderRevokeDependencies,
): Promise<string | null> {
  const { data, error } = await admin
    .from('oauth_tokens')
    .select('provider')
    .eq('user_id', userId);
  if (error) return `oauth_tokens: ${describe(error)}`;
  const providers = [
    ...new Set(((data ?? []) as { provider?: string | null }[]).map((row) => row.provider)),
  ].filter((provider): provider is string => typeof provider === 'string' && provider !== '');
  for (const provider of providers) {
    const result = await revokeAndDisconnect(admin, userId, provider, revokeDeps);
    if (!result.ok) return `${provider}: ${result.stage}: ${result.detail}`;
  }
  return null;
}

/**
 * Permanently deletes `userId` (service-role `admin` client). The caller must
 * already have authorised the deletion; this function trusts `userId`.
 */
export async function purgeUser(
  admin: SupabaseClient,
  userId: string,
  deps: PurgeUserDependencies = defaultPurgeUserDependencies(),
): Promise<PurgeResult> {
  // 1. Billing (abort point).
  const billing = await cancelBilling(admin, userId, deps);
  if (!billing.ok) {
    console.error('[PURGE] billing step failed; nothing deleted', {
      user_id: userId,
      stage: billing.stage,
      detail: billing.detail,
    });
    return { ok: false, stage: billing.stage, billingCancelled: false, detail: billing.detail };
  }
  const billingCancelled = billing.cancelled;

  // 1b. Connected providers (abort point: the user still exists). Revoke
  // each grant at the provider, then disconnect_integration, through the same
  // path as the disconnect endpoints, so deleting the account never leaves a
  // live third-party grant behind a deleted token.
  const disconnectFailure = await disconnectProviders(
    admin,
    userId,
    deps.providerRevoke ?? defaultProviderRevokeDependencies(),
  );
  if (disconnectFailure) {
    console.error('[PURGE] provider disconnect failed; user left intact', {
      user_id: userId,
      detail: disconnectFailure,
    });
    return { ok: false, stage: 'provider_disconnect', billingCancelled, detail: disconnectFailure };
  }

  // 2. Explicit rows (abort point: the user still exists).
  const preFailures = await purgeExplicitRows(admin, userId, 'pre', billing.ids);
  if (preFailures.length > 0) {
    const detail = preFailures.map((f) => `${f.table}: ${f.detail}`).join('; ');
    console.error('[PURGE] explicit row purge failed; user left intact', { user_id: userId, detail });
    return { ok: false, stage: 'explicit_rows', billingCancelled, detail };
  }

  // 3. The auth user (cascades every FK-owned row).
  const { error: deleteError } = await admin.auth.admin.deleteUser(userId);
  if (deleteError && !isUserNotFound(deleteError)) {
    return { ok: false, stage: 'delete_user', billingCancelled, detail: describe(deleteError) };
  }

  // 3a. Every explicit table, including rows the cascade itself wrote.
  const postFailures = await purgeExplicitRows(admin, userId, 'post', billing.ids);
  if (postFailures.length > 0) {
    console.error('[DELETION_ALERT] post_delete_purge_failed', {
      user_id: userId,
      failures: postFailures,
    });
  }

  // 4. Avatars (best effort).
  const avatarsRemoved = await removeAvatars(admin, userId);

  return {
    ok: true,
    billingCancelled,
    residualTables: [
      ...postFailures.map((f) => f.table),
      ...(avatarsRemoved ? [] : ['storage:avatars']),
    ],
  };
}
