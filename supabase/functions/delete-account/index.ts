import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { getCorsHeaders } from '../_shared/cors.ts';
import { type EnvReader, hasValidCronSecret } from '../_shared/cronSecret.ts';
import { checkRateLimit } from '../_shared/rateLimit.ts';
import {
  defaultPurgeUserDependencies,
  purgeUser,
  type PurgeResult,
  removeAvatars,
} from '../_shared/accountPurge.ts';

/** One delete-account attempt per user per window (charged after validation). */
const DELETE_RATE_LIMIT_WINDOW_SECONDS = 3600;

/** Requests executed per `process_due` run (reclaims included). */
export const PROCESS_DUE_BATCH_SIZE = 10;
/** An `executing` claim older than this belongs to a crashed run. */
export const STUCK_CLAIM_MINUTES = 15;
/** A request still open this long past `scheduled_for` raises an alert. */
export const OVERDUE_ALERT_DAYS = 2;
/** Orphan avatar folders removed per run by the residue sweep. */
const SWEEP_AVATAR_FOLDER_LIMIT = 100;
/** The purge stage only support can resolve; `process_due` never retries it. */
const NEEDS_SUPPORT_STAGE = 'billing_not_found';
const NEEDS_SUPPORT_REASON = 'billing_subscription_not_found';

interface DeleteAccountAuthClient {
  auth: {
    getUser(): Promise<{ data: { user: { id: string } | null } }>;
  };
}

export interface DeleteAccountHandlerDependencies {
  /** Client acting as the caller (their JWT), used only to identify them. */
  createAuthClient(authorization: string): DeleteAccountAuthClient;
  /** Service-role client for admin operations (bypasses RLS). */
  createAdminClient(): SupabaseClient;
  /** The purge core; injected so tests can stub Paddle. */
  purge(admin: SupabaseClient, userId: string): Promise<PurgeResult>;
  /** Environment lookup (Deno.env.get in production); reads CRON_SECRET. */
  env: EnvReader;
}

function defaultDeleteAccountDependencies(): DeleteAccountHandlerDependencies {
  let admin: SupabaseClient | null = null;
  return {
    createAuthClient(authorization: string) {
      return createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_ANON_KEY')!,
        { global: { headers: { Authorization: authorization } } },
      );
    },
    createAdminClient() {
      admin ??= createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      );
      return admin;
    },
    purge(adminClient, userId) {
      return purgeUser(adminClient, userId, defaultPurgeUserDependencies());
    },
    env: (key) => Deno.env.get(key),
  };
}

// ---------------------------------------------------------------------------
// The claim (R-29). Both executors move a request pending -> executing with a
// conditional UPDATE before any side effect, and proceed only if a row comes
// back. The user's own cancel is RLS-gated on status = 'pending', so it cannot
// race an execution, and two runs can never both process one request.
// ---------------------------------------------------------------------------

interface ClaimedRequest {
  id: string;
  user_id: string;
}

type ClaimOutcome =
  | { ok: true; request: ClaimedRequest }
  | { ok: false; error: unknown };

function claimOutcome(data: unknown, error: unknown): ClaimOutcome {
  if (error) return { ok: false, error };
  const rows = (data ?? []) as ClaimedRequest[];
  return rows.length > 0 ? { ok: true, request: rows[0] } : { ok: false, error: null };
}

async function claimPending(
  admin: SupabaseClient,
  requestId: string,
  nowIso: string,
): Promise<ClaimOutcome> {
  const { data, error } = await admin
    .from('deletion_requests')
    .update({ status: 'executing', claimed_at: nowIso })
    .eq('id', requestId)
    .eq('status', 'pending')
    .lte('scheduled_for', nowIso)
    .select('id, user_id');
  return claimOutcome(data, error);
}

/** Re-takes a claim whose run crashed (still `executing`, claim too old). */
async function reclaimStuck(
  admin: SupabaseClient,
  requestId: string,
  nowIso: string,
  cutoffIso: string,
): Promise<ClaimOutcome> {
  const { data, error } = await admin
    .from('deletion_requests')
    .update({ claimed_at: nowIso })
    .eq('id', requestId)
    .eq('status', 'executing')
    .lt('claimed_at', cutoffIso)
    .select('id, user_id');
  return claimOutcome(data, error);
}

/**
 * After a failed purge (the user and the request still exist): back to
 * `pending`, so the next run or the user can retry, or the user can cancel.
 * A failure only support can resolve is marked so `process_due` skips it.
 */
async function releaseClaim(
  admin: SupabaseClient,
  request: ClaimedRequest,
  result: Extract<PurgeResult, { ok: false }>,
): Promise<void> {
  const needsSupport = result.stage === NEEDS_SUPPORT_STAGE;
  const { error } = await admin
    .from('deletion_requests')
    .update({
      status: 'pending',
      claimed_at: null,
      ...(needsSupport ? { needs_support_reason: NEEDS_SUPPORT_REASON } : {}),
    })
    .eq('id', request.id)
    .eq('status', 'executing');
  if (error) {
    console.error('[DELETION_ALERT] claim_revert_failed', {
      user_id: request.user_id,
      request_id: request.id,
      error,
    });
  }
  if (needsSupport) {
    console.error(
      `[DELETION_ALERT] needs_support ${NEEDS_SUPPORT_REASON} user=${request.user_id}`,
      { request_id: request.id, detail: result.detail },
    );
  }
}

/**
 * After a successful purge the request normally cascaded away with the user.
 * If it did not (the auth user was already gone, or the FK does not cascade),
 * close it so it is not reclaimed every 15 minutes, and alert.
 */
async function finishClaim(admin: SupabaseClient, request: ClaimedRequest): Promise<void> {
  const { data, error } = await admin
    .from('deletion_requests')
    .update({ status: 'executed', executed_at: new Date().toISOString() })
    .eq('id', request.id)
    .eq('status', 'executing')
    .select('id');
  if (error) {
    console.error('[DELETION_ALERT] claim_finish_failed', {
      user_id: request.user_id,
      request_id: request.id,
      error,
    });
  } else if (((data ?? []) as unknown[]).length > 0) {
    console.error(`[DELETION_ALERT] request_survived_purge user=${request.user_id}`, {
      request_id: request.id,
    });
  }
}

// ---------------------------------------------------------------------------
// process_due: the hourly executor (KD-11), called by pg_cron through
// private.invoke_edge_function with x-cron-secret.
// ---------------------------------------------------------------------------

export interface ProcessDueReport {
  purged: string[];
  failed: { user_id: string; stage: string }[];
  reclaimed: string[];
  needs_support: string[];
  overdue: number;
  residue: {
    deleted: Record<string, number>;
    avatar_folders_removed: number;
    failed: boolean;
  };
}

async function purgeClaimed(
  admin: SupabaseClient,
  deps: DeleteAccountHandlerDependencies,
  request: ClaimedRequest,
  report: ProcessDueReport,
): Promise<void> {
  let result: PurgeResult;
  try {
    result = await deps.purge(admin, request.user_id);
  } catch (err) {
    // Unknown progress; every step is idempotent, so release for a retry.
    result = { ok: false, stage: 'delete_user', billingCancelled: false, detail: String(err) };
  }
  if (result.ok) {
    await finishClaim(admin, request);
    report.purged.push(request.user_id);
    if (result.residualTables.length > 0) {
      console.error('[DELETION_ALERT] account deleted with residual rows', {
        user_id: request.user_id,
        residual_tables: result.residualTables,
      });
    }
    console.log(`[DELETE_DUE] purged user=${request.user_id}`, {
      billing_cancelled: result.billingCancelled,
    });
    return;
  }
  await releaseClaim(admin, request, result);
  if (result.stage === NEEDS_SUPPORT_STAGE) report.needs_support.push(request.user_id);
  report.failed.push({ user_id: request.user_id, stage: result.stage });
  console.error(`[DELETE_DUE] purge failed user=${request.user_id}`, {
    stage: result.stage,
    billing_cancelled: result.billingCancelled,
    detail: result.detail,
  });
}

/**
 * Durable retry for residue of accounts already deleted (PR 34's
 * residualTables, and the late webhook row the immediate Paddle cancel
 * triggers): FK-less rows whose user no longer exists, and avatar folders of
 * missing users. Best effort; a failure is an alert, not a 5xx.
 */
async function sweepResidue(admin: SupabaseClient, report: ProcessDueReport): Promise<void> {
  try {
    const { data, error } = await admin.rpc('sweep_deleted_account_residue', {
      p_avatar_limit: SWEEP_AVATAR_FOLDER_LIMIT,
    });
    if (error) throw error;
    const sweep = (data ?? {}) as {
      deleted?: Record<string, number>;
      orphan_avatar_folders?: string[];
    };
    report.residue.deleted = sweep.deleted ?? {};
    for (const folder of sweep.orphan_avatar_folders ?? []) {
      if (await removeAvatars(admin, folder)) {
        report.residue.avatar_folders_removed++;
      } else {
        report.residue.failed = true;
      }
    }
    const removedRows = Object.values(report.residue.deleted).reduce((a, b) => a + b, 0);
    if (removedRows > 0 || report.residue.avatar_folders_removed > 0) {
      console.log('[DELETE_DUE] swept residue of deleted accounts', report.residue);
    }
  } catch (err) {
    report.residue.failed = true;
    console.error('[DELETION_ALERT] residue_sweep_failed', { error: err });
  }
}

async function processDue(
  admin: SupabaseClient,
  deps: DeleteAccountHandlerDependencies,
): Promise<ProcessDueReport> {
  const report: ProcessDueReport = {
    purged: [],
    failed: [],
    reclaimed: [],
    needs_support: [],
    overdue: 0,
    residue: { deleted: {}, avatar_folders_removed: 0, failed: false },
  };
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const cutoffIso = new Date(now - STUCK_CLAIM_MINUTES * 60_000).toISOString();

  // 1. Claims left behind by a crashed run. Every purge step is idempotent
  //    (live Paddle status, deletes by user id, a missing user counts as
  //    deleted), so running one again is safe.
  const { data: stuck, error: stuckError } = await admin
    .from('deletion_requests')
    .select('id, user_id')
    .eq('status', 'executing')
    .lt('claimed_at', cutoffIso)
    .order('claimed_at', { ascending: true })
    .limit(PROCESS_DUE_BATCH_SIZE);
  if (stuckError) throw stuckError;
  // Requests attempted in this run; a failed one waits for the next run.
  const attempted = new Set<string>();
  for (const row of (stuck ?? []) as ClaimedRequest[]) {
    attempted.add(row.id);
    const claim = await reclaimStuck(admin, row.id, nowIso, cutoffIso);
    if (!claim.ok) {
      if (claim.error) {
        console.error('[DELETE_DUE] reclaim failed', { user_id: row.user_id, error: claim.error });
      }
      continue;
    }
    console.error(`[DELETION_ALERT] reclaimed_stuck_claim user=${row.user_id}`, {
      request_id: row.id,
    });
    report.reclaimed.push(row.user_id);
    await purgeClaimed(admin, deps, claim.request, report);
  }

  // 2. Due requests, oldest first; requests waiting on support are skipped.
  const remaining = PROCESS_DUE_BATCH_SIZE - report.reclaimed.length;
  if (remaining > 0) {
    const { data: due, error: dueError } = await admin
      .from('deletion_requests')
      .select('id, user_id')
      .eq('status', 'pending')
      .lte('scheduled_for', nowIso)
      .is('needs_support_reason', null)
      .order('scheduled_for', { ascending: true })
      .limit(remaining);
    if (dueError) throw dueError;
    for (const row of (due ?? []) as ClaimedRequest[]) {
      if (attempted.has(row.id)) continue;
      const claim = await claimPending(admin, row.id, nowIso);
      if (!claim.ok) {
        // Cancelled by the user, or claimed by another run, since the select.
        if (claim.error) {
          console.error('[DELETE_DUE] claim failed', { user_id: row.user_id, error: claim.error });
        }
        continue;
      }
      await purgeClaimed(admin, deps, claim.request, report);
    }
  }

  // 3. Anything still open well past its date (PR 68 runbook).
  const overdueCutoff = new Date(now - OVERDUE_ALERT_DAYS * 86_400_000).toISOString();
  const { data: overdue, error: overdueError } = await admin
    .from('deletion_requests')
    .select('user_id, status, scheduled_for, claimed_at, needs_support_reason')
    .in('status', ['pending', 'executing'])
    .lt('scheduled_for', overdueCutoff);
  if (overdueError) {
    console.error('[DELETION_ALERT] overdue_check_failed', { error: overdueError });
  } else {
    for (const row of (overdue ?? []) as Record<string, unknown>[]) {
      report.overdue++;
      console.error(`[DELETION_ALERT] overdue user=${row.user_id}`, row);
    }
  }

  // 4. Residue of deleted accounts.
  await sweepResidue(admin, report);
  return report;
}

async function readJsonBody(req: Request): Promise<unknown> {
  try {
    const text = await req.text();
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

async function deleteAccountHandler(
  req: Request,
  deps: DeleteAccountHandlerDependencies,
): Promise<Response> {
  const cors = getCorsHeaders(req);
  const json = (body: unknown, status: number, extra: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...cors, ...extra, 'Content-Type': 'application/json' },
    });

  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors });
  }

  // POST only — this is a destructive, state-changing endpoint. Reject any
  // other method before authentication so an accidental GET/HEAD or proxy
  // retry cannot trigger the deletion flow. (F317)
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  // Scheduled executor. Authenticated only by the cron secret: the gateway's
  // verify_jwt is off for this function (config.toml).
  const body = await readJsonBody(req);
  if ((body as { mode?: unknown } | null)?.mode === 'process_due') {
    if (!hasValidCronSecret(req, deps.env)) {
      return json({ error: 'Unauthorized' }, 401);
    }
    try {
      return json(await processDue(deps.createAdminClient(), deps), 200);
    } catch (err) {
      console.error('[DELETION_ALERT] process_due_failed', { error: err });
      return json({ error: 'process_due failed' }, 500);
    }
  }

  try {
    // Authenticate the user via their JWT. The account deleted is always the
    // JWT user; nothing in the request body can name another user.
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return json({ error: 'Missing Authorization header' }, 401);
    }
    const {
      data: { user },
    } = await deps.createAuthClient(authHeader).auth.getUser();
    if (!user) {
      return json({ error: 'Not authenticated' }, 401);
    }

    const userId = user.id;
    const supabaseAdmin = deps.createAdminClient();

    // Verify the user has a pending deletion request with expired grace period
    const { data: request, error: requestError } = await supabaseAdmin
      .from('deletion_requests')
      .select('id, scheduled_for')
      .eq('user_id', userId)
      .eq('status', 'pending')
      .single();

    if (requestError || !request) {
      return json({ error: 'No pending deletion request found' }, 400);
    }

    if (new Date(request.scheduled_for) > new Date()) {
      return json({
        error: 'Grace period has not expired yet',
        scheduled_for: request.scheduled_for,
      }, 400);
    }

    // Rate limit: 1 request per hour per user. Charged only once the request
    // is valid, so a premature click does not lock the user out for an hour.
    const rateCheck = await checkRateLimit(supabaseAdmin, {
      key: 'delete-account',
      userId,
      maxRequests: 1,
      windowSeconds: DELETE_RATE_LIMIT_WINDOW_SECONDS,
    }, cors);
    if (!rateCheck.allowed) return rateCheck.response!;

    // Claim the request (pending -> executing) before any side effect. On
    // success the row cascades away with the account; on failure it is
    // released back to 'pending' so the user can retry or cancel. A crash
    // mid-purge is reclaimed by process_due after STUCK_CLAIM_MINUTES.
    const claim = await claimPending(supabaseAdmin, request.id, new Date().toISOString());
    if (!claim.ok) {
      if (claim.error) {
        console.error('[DELETE_ACCOUNT] could not claim deletion request:', claim.error);
        return json({ error: 'Failed to process deletion. Please try again later.' }, 500);
      }
      return json({ error: 'Deletion request is no longer pending' }, 409);
    }

    const result = await deps.purge(supabaseAdmin, userId);
    if (!result.ok) {
      // deleteUser did not succeed, so the user and the request still exist.
      await releaseClaim(supabaseAdmin, claim.request, result);
      console.error('[DELETE_ACCOUNT] purge failed:', {
        user_id: userId,
        stage: result.stage,
        billing_cancelled: result.billingCancelled,
        detail: result.detail,
      });
      // The rate limit charged above stays in force (a failed purge never
      // deletes it), so tell the user when a retry will actually be accepted.
      const retry = { 'Retry-After': String(DELETE_RATE_LIMIT_WINDOW_SECONDS) };
      const retryText = 'You can try again in about an hour.';
      if (result.billingCancelled) {
        console.error('[DELETE_ACCOUNT_PARTIAL_FAILURE] Paddle subscription was canceled but the account was not deleted', {
          user_id: userId,
          stage: result.stage,
        });
        return json({
          error: `Billing subscription was canceled, but account deletion could not be completed. ${retryText} If it keeps failing, contact support.`,
          code: 'billing_canceled_account_delete_failed',
        }, 500, retry);
      }
      if (result.stage === NEEDS_SUPPORT_STAGE) {
        return json({
          error: 'Your billing subscription could not be verified with our payment provider, so account deletion was stopped to make sure you are not billed again. Please contact support to complete the deletion.',
          code: NEEDS_SUPPORT_REASON,
        }, 502);
      }
      if (result.stage.startsWith('billing_')) {
        return json({
          error: `Failed to cancel billing subscription. Account deletion aborted. ${retryText} If it keeps failing, contact support.`,
          code: 'billing_cancel_failed',
        }, 502, retry);
      }
      return json({ error: `Failed to delete account. ${retryText}` }, 500, retry);
    }

    await finishClaim(supabaseAdmin, claim.request);
    if (result.residualTables.length > 0) {
      console.error('[DELETION_ALERT] account deleted with residual rows', {
        user_id: userId,
        residual_tables: result.residualTables,
      });
    }
    console.log(`Account deleted successfully for user ${userId}`);
    return json({ success: true }, 200);
  } catch (err) {
    console.error('Unexpected error in delete-account:', err);
    return json({ error: 'Internal server error' }, 500);
  }
}

export function createDeleteAccountHandler(
  deps: DeleteAccountHandlerDependencies = defaultDeleteAccountDependencies(),
): (req: Request) => Promise<Response> {
  return (req) => deleteAccountHandler(req, deps);
}

if (import.meta.main) {
  Deno.serve(createDeleteAccountHandler());
}
