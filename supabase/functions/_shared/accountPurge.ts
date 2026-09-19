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
 *      is deleted.
 *   2. Explicit rows that are harmless to lose if the purge then aborts:
 *      `oauth_tokens`, `rate_limit_tracking`, `paddle_webhook_events`. Any
 *      failure other than "table/column does not exist here" aborts, with the
 *      user still intact. Targets marked `postOnly` are not touched here.
 *   3. `auth.admin.deleteUser`. A user that is already gone counts as done.
 *   3a. Every explicit table, after the user is gone. The cascade itself writes
 *      rows into FK-less tables: the prod `subscriptions` audit trigger
 *      inserts a DELETE row into `subscription_events`, and the
 *      `sync_tombstones` trigger would record the cascaded routine/cycle
 *      deletes if its guard ever failed (R-6, R-30). The user is already
 *      deleted, so a failure here is logged as `[DELETION_ALERT]`, not
 *      returned as a failed purge.
 *   4. Avatars, best effort, after the user is deleted.
 */
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';

/** How `purgeUser` finds one explicit table's rows for the user. */
export interface ExplicitPurgeTarget {
  table: string;
  /** Column holding the user id. */
  column: string;
  /**
   * Used instead of `column` when that column does not exist on this
   * database (a PostgREST JSON path filter).
   */
  fallbackColumn?: string;
  /**
   * Deleted only after `deleteUser` succeeds, never in the abortable pre-pass,
   * because losing these rows while the user survives an aborted purge would
   * hurt them: tombstones (a stale phone would resurrect deleted routines),
   * the billing audit trail, and user data that already cascades in prod.
   */
  postOnly?: true;
}

/**
 * Tables `purgeUser` deletes explicitly, by user id.
 *
 * INTEGRATION POINT (PR 36): this list mirrors the `purge: "explicit"` entries
 * of `USER_DATA_MANIFEST` / `EXCLUDED` in `_shared/userDataManifest.ts`, plus
 * `oauth_tokens` (cascades, but deleted first on purpose; PR 54 adds provider
 * revocation there). When PR 36 lands, derive this list from the manifest.
 *
 * Several of these tables exist only in prod (created from the dashboard, no
 * migration yet): a table or column that does not exist is skipped, not an
 * error.
 */
export const EXPLICIT_PURGE_TARGETS: readonly ExplicitPurgeTarget[] = [
  { table: 'oauth_tokens', column: 'user_id' },
  { table: 'rate_limit_tracking', column: 'user_id' },
  {
    table: 'paddle_webhook_events',
    column: 'user_id',
    fallbackColumn: 'payload->data->custom_data->>user_id',
  },
  // The cascade writes a DELETE row here (prod subscriptions audit trigger).
  { table: 'subscription_events', column: 'user_id', postOnly: true },
  // R-6, R-30: after the user is deleted (PR 16's trigger guard is the
  // primary defence; this is the safety net).
  { table: 'sync_tombstones', column: 'user_id', postOnly: true },
  // FK ON DELETE CASCADE in prod (prod-evidence.md); swept for DBs without it.
  { table: 'goal_snapshots', column: 'user_id', postOnly: true },
  { table: 'overload_suggestions', column: 'user_id', postOnly: true },
  { table: 'telemetry_analysis', column: 'user_id', postOnly: true },
  { table: 'wearable_daily_summaries', column: 'user_id', postOnly: true },
];

/**
 * Rows in `paddle_webhook_events` whose `user_id` column is NULL but whose
 * payload names the user. Deleted in addition to the `user_id` match.
 */
const PADDLE_WEBHOOK_PAYLOAD_USER = 'payload->data->custom_data->>user_id';

export type PurgeFailureStage =
  | 'billing_config'
  | 'billing_lookup'
  | 'billing_cancel'
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
}

export function defaultPurgeUserDependencies(): PurgeUserDependencies {
  return {
    fetch: (input, init) => fetch(input, init),
    paddleApiKey: Deno.env.get('PADDLE_API_KEY'),
    paddleEnvironment: Deno.env.get('PADDLE_ENVIRONMENT'),
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

async function deleteWhere(
  admin: SupabaseClient,
  table: string,
  column: string,
  userId: string,
): Promise<'deleted' | 'missing_table' | 'missing_column' | PostgrestLikeError> {
  const { error } = await admin.from(table).delete().eq(column, userId);
  if (!error) return 'deleted';
  if (isMissingTable(error)) return 'missing_table';
  if (isMissingColumn(error)) return 'missing_column';
  return error;
}

/**
 * Deletes the user's rows from the explicit tables of `phase` (`pre`: all but
 * `postOnly` targets; `post`: all). Returns the tables that failed with an
 * error other than "does not exist here".
 */
async function purgeExplicitRows(
  admin: SupabaseClient,
  userId: string,
  phase: 'pre' | 'post',
): Promise<{ table: string; detail: string }[]> {
  const failures: { table: string; detail: string }[] = [];
  for (const target of EXPLICIT_PURGE_TARGETS) {
    if (phase === 'pre' && target.postOnly) continue;
    let outcome = await deleteWhere(admin, target.table, target.column, userId);
    if (outcome === 'missing_column' && target.fallbackColumn) {
      outcome = await deleteWhere(admin, target.table, target.fallbackColumn, userId);
    } else if (outcome === 'deleted' && target.table === 'paddle_webhook_events') {
      // Also rows whose user_id column was never filled in.
      outcome = await deleteWhere(admin, target.table, PADDLE_WEBHOOK_PAYLOAD_USER, userId);
    }
    if (outcome === 'missing_table') {
      console.warn(`[PURGE] ${target.table} does not exist here; skipped`);
      continue;
    }
    if (outcome === 'missing_column') {
      console.warn(`[PURGE] ${target.table} has no user column here; skipped`);
      continue;
    }
    if (outcome !== 'deleted') {
      failures.push({ table: target.table, detail: describe(outcome) });
    }
  }
  return failures;
}

async function paddleRequest(
  deps: PurgeUserDependencies,
  apiKey: string,
  path: string,
  init: RequestInit = {},
): Promise<{ ok: true; body: unknown } | { ok: false; detail: string }> {
  try {
    const res = await deps.fetch(`${paddleBaseUrl(deps.paddleEnvironment)}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    });
    const text = await res.text();
    if (!res.ok) return { ok: false, detail: `HTTP ${res.status}: ${text.slice(0, 500)}` };
    try {
      return { ok: true, body: text ? JSON.parse(text) : null };
    } catch {
      return { ok: false, detail: 'unparseable Paddle response' };
    }
  } catch (err) {
    return { ok: false, detail: describe(err) };
  }
}

function liveStatus(body: unknown): string | null {
  const status = (body as { data?: { status?: unknown } } | null)?.data?.status;
  return typeof status === 'string' ? status : null;
}

type BillingOutcome =
  | { ok: true; cancelled: boolean }
  | { ok: false; stage: PurgeFailureStage; detail: string };

async function cancelBilling(
  admin: SupabaseClient,
  userId: string,
  deps: PurgeUserDependencies,
): Promise<BillingOutcome> {
  const { data: subscription, error } = await admin
    .from('subscriptions')
    .select('paddle_subscription_id')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) return { ok: false, stage: 'billing_lookup', detail: describe(error) };

  const subscriptionId = (subscription as { paddle_subscription_id?: string | null } | null)
    ?.paddle_subscription_id;
  if (!subscriptionId) return { ok: true, cancelled: false };

  if (!deps.paddleApiKey) {
    return { ok: false, stage: 'billing_config', detail: 'PADDLE_API_KEY is not set' };
  }
  const encodedId = encodeURIComponent(subscriptionId);

  // The local row can be stale (e.g. `paused` was never mirrored), so decide
  // from Paddle's live status, never from `subscriptions.status`.
  const current = await paddleRequest(deps, deps.paddleApiKey, `/subscriptions/${encodedId}`);
  if (!current.ok) return { ok: false, stage: 'billing_lookup', detail: current.detail };
  const status = liveStatus(current.body);
  if (status === null) {
    return { ok: false, stage: 'billing_lookup', detail: 'Paddle response has no status' };
  }
  if (status === 'canceled') return { ok: true, cancelled: false };

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
  return { ok: true, cancelled: true };
}

function isUserNotFound(error: unknown): boolean {
  const e = error as { status?: number; code?: string; message?: string } | null;
  return e?.status === 404 || e?.code === 'user_not_found' ||
    /user not found/i.test(e?.message ?? '');
}

async function removeAvatars(admin: SupabaseClient, userId: string): Promise<void> {
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
  } catch (err) {
    console.error('[DELETION_ALERT] avatar_cleanup_failed', { user_id: userId, error: describe(err) });
  }
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

  // 2. Explicit rows (abort point: the user still exists).
  const preFailures = await purgeExplicitRows(admin, userId, 'pre');
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

  // 3a. Rows the cascade itself wrote into FK-less tables.
  const postFailures = await purgeExplicitRows(admin, userId, 'post');
  if (postFailures.length > 0) {
    console.error('[DELETION_ALERT] post_delete_purge_failed', {
      user_id: userId,
      failures: postFailures,
    });
  }

  // 4. Avatars (best effort).
  await removeAvatars(admin, userId);

  return {
    ok: true,
    billingCancelled,
    residualTables: postFailures.map((f) => f.table),
  };
}
