/**
 * Account purge core (FP-6, PR 34). Shared by the user-initiated "Delete now"
 * path in `delete-account` and, later, the scheduled `process_due` executor
 * (PR 35).
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
 *      Assumption: one Paddle subscription per user. `subscriptions` is
 *      UNIQUE(user_id) and is the only local record of Paddle ids, so the
 *      one locally known subscription is the one cancelled (review R-9).
 *   1b. Providers (PR 54): for every provider with a stored token, revoke
 *      the grant at the provider (best effort) and call
 *      `disconnect_integration` (`providerRevoke.ts#revokeAndDisconnect`).
 *      A database error aborts with `provider_disconnect`, user intact.
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
 *      not as a failed purge. (No durable retry exists yet: PR 35 hand-off.)
 *   4. Avatars, best effort, after the user is deleted.
 *
 * "Table/column does not exist" is tolerated only for targets marked
 * `mayBeAbsent` (prod-only tables with no migration yet); for every other
 * target it is a failure (a stale schema cache must not look like success).
 */
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
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
  /** Provider grant revocation (PR 54); defaults to the real providers. */
  providerRevoke?: ProviderRevokeDependencies;
}

export function defaultPurgeUserDependencies(): PurgeUserDependencies {
  return {
    fetch: (input, init) => fetch(input, init),
    paddleApiKey: Deno.env.get('PADDLE_API_KEY'),
    paddleEnvironment: Deno.env.get('PADDLE_ENVIRONMENT'),
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
    if (
      ids.subscriptionId &&
      await subscriptionIdIsOwnedSolelyBy(admin, ids.subscriptionId, userId)
    ) {
      matches.push(['paddle_subscription_id', ids.subscriptionId]);
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
    .select('paddle_subscription_id, status')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) return { ok: false, stage: 'billing_lookup', detail: describe(error) };

  const row = subscription as {
    paddle_subscription_id?: string | null;
    status?: string | null;
  } | null;
  const ids: BillingIds = { subscriptionId: row?.paddle_subscription_id ?? null };
  const subscriptionId = ids.subscriptionId;
  if (!subscriptionId) return { ok: true, cancelled: false, ids };

  if (!deps.paddleApiKey) {
    return { ok: false, stage: 'billing_config', detail: 'PADDLE_API_KEY is not set' };
  }
  const encodedId = encodeURIComponent(subscriptionId);

  // The local row can be stale (e.g. `paused` was never mirrored), so decide
  // from Paddle's live status, never from `subscriptions.status`.
  const current = await paddleRequest(deps, deps.paddleApiKey, `/subscriptions/${encodedId}`);
  if (!current.ok) {
    if (current.status === 404) {
      if (TERMINAL_LOCAL_STATUSES.has(row?.status ?? '')) {
        console.warn('[BILLING_ALERT] paddle_subscription_not_found; local row terminal, continuing', {
          user_id: userId,
          paddle_subscription_id: subscriptionId,
          local_status: row?.status,
        });
        return { ok: true, cancelled: false, ids };
      }
      console.error('[BILLING_ALERT] paddle_subscription_not_found; local row not terminal, aborting', {
        user_id: userId,
        paddle_subscription_id: subscriptionId,
        local_status: row?.status ?? null,
      });
      return { ok: false, stage: 'billing_not_found', detail: current.detail };
    }
    return { ok: false, stage: 'billing_lookup', detail: current.detail };
  }
  const status = liveStatus(current.body);
  if (status === null) {
    return { ok: false, stage: 'billing_lookup', detail: 'Paddle response has no status' };
  }
  if (status === 'canceled') return { ok: true, cancelled: false, ids };

  const cancel = await paddleRequest(
    deps,
    deps.paddleApiKey,
    `/subscriptions/${encodedId}/cancel`,
    { method: 'POST', body: JSON.stringify({ effective_from: 'immediately' }) },
  );
  if (!cancel.ok) return { ok: false, stage: 'billing_cancel', detail: cancel.detail };

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
  console.log(`[PURGE] Paddle subscription cancelled for user ${userId} (was ${status})`);
  return { ok: true, cancelled: true, ids };
}

function isUserNotFound(error: unknown): boolean {
  const e = error as { status?: number; code?: string; message?: string } | null;
  return e?.status === 404 || e?.code === 'user_not_found' ||
    /user not found/i.test(e?.message ?? '');
}

async function removeAvatars(admin: SupabaseClient, userId: string): Promise<boolean> {
  try {
    const bucket = admin.storage.from('avatars');
    const { data: files, error } = await bucket.list(userId, { limit: 1000 });
    if (error) throw error;
    if (files && files.length > 0) {
      const { error: removeError } = await bucket.remove(
        files.map((file) => `${userId}/${file.name}`),
      );
      if (removeError) throw removeError;
      console.log(`[PURGE] Removed ${files.length} avatar file(s) for user ${userId}`);
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
