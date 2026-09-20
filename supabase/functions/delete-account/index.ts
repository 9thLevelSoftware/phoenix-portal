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
/**
 * A purge reported success but the request row is still there. `user_id` is
 * `REFERENCES auth.users ON DELETE CASCADE`, so the row can only survive if
 * the auth user was NOT deleted — `deleteUser` answered "not found" for a live
 * user. The account still holds personal data, so the request is parked
 * `pending` (never `executed`): the user keeps seeing it and can cancel, the
 * hourly batch skips it, and the overdue alert keeps naming it.
 */
const SURVIVED_PURGE_REASON = 'request_survived_purge';

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
  /**
   * The claim stamp this run took. Every later write is fenced on it, so a
   * run that lost the row to a reclaim cannot flip the winner's request.
   */
  claimed_at: string | null;
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
    .select('id, user_id, claimed_at');
  return claimOutcome(data, error);
}

/**
 * Re-takes a claim whose run crashed: still `executing` and either claimed
 * too long ago or carrying no `claimed_at` at all. A NULL stamp has no
 * default and no CHECK behind it (a support fix or a partial write can leave
 * one), and it matches neither the due query nor a `claimed_at < cutoff`
 * sweep, so without this it would sit `executing` for ever.
 */
function stuckClaimFilter(cutoffIso: string): string {
  return `claimed_at.is.null,claimed_at.lt.${cutoffIso}`;
}

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
    .or(stuckClaimFilter(cutoffIso))
    .select('id, user_id, claimed_at');
  return claimOutcome(data, error);
}

/**
 * Puts a claimed request back to `pending` (fenced on the claim this run
 * took), so the next run or the user can retry, or the user can cancel.
 * `last_attempt_at` is stamped so the due query can order a repeatedly
 * failing row behind rows that have never been attempted. A failure only
 * support can resolve is marked so `process_due` skips it entirely.
 *
 * Returns the number of rows it actually released — 0 means the row is gone
 * (cascaded away with the auth user) or is held by another run.
 */
async function releaseClaim(
  admin: SupabaseClient,
  request: ClaimedRequest,
  needsSupportReason: string | null,
): Promise<number> {
  const { data, error } = await admin
    .from('deletion_requests')
    .update({
      status: 'pending',
      claimed_at: null,
      last_attempt_at: new Date().toISOString(),
      ...(needsSupportReason ? { needs_support_reason: needsSupportReason } : {}),
    })
    .eq('id', request.id)
    .eq('status', 'executing')
    .eq('claimed_at', request.claimed_at)
    .select('id');
  if (error) {
    console.error('[DELETION_ALERT] claim_revert_failed', {
      user_id: request.user_id,
      request_id: request.id,
      error,
    });
    return 0;
  }
  return ((data ?? []) as unknown[]).length;
}

/** Releases a failed purge's claim and logs the support alert if there is one. */
async function releaseFailedClaim(
  admin: SupabaseClient,
  request: ClaimedRequest,
  result: Extract<PurgeResult, { ok: false }>,
): Promise<void> {
  const needsSupport = result.stage === NEEDS_SUPPORT_STAGE;
  await releaseClaim(admin, request, needsSupport ? NEEDS_SUPPORT_REASON : null);
  if (needsSupport) {
    console.error(
      `[DELETION_ALERT] needs_support ${NEEDS_SUPPORT_REASON} user=${request.user_id}`,
      { request_id: request.id, detail: result.detail },
    );
  }
}

/**
 * After a successful purge the request cascades away with the auth user. If
 * it is still there the user was NOT deleted (see SURVIVED_PURGE_REASON), so
 * the row is parked back on `pending` with that reason instead of being
 * closed as `executed`: closing it would strand a live account that can
 * neither be retried, cancelled nor re-requested.
 *
 * Returns true when the request survived (i.e. the account is still there).
 */
async function closeClaim(admin: SupabaseClient, request: ClaimedRequest): Promise<boolean> {
  const released = await releaseClaim(admin, request, SURVIVED_PURGE_REASON);
  if (released === 0) return false;
  console.error(`[DELETION_ALERT] ${SURVIVED_PURGE_REASON} user=${request.user_id}`, {
    request_id: request.id,
  });
  return true;
}

// ---------------------------------------------------------------------------
// process_due: the hourly executor (KD-11), called by pg_cron through
// private.invoke_edge_function with x-cron-secret.
// ---------------------------------------------------------------------------

/**
 * Counts only. pg_net persists this body in `net._http_response`, so the
 * UUIDs of accounts that were just erased must not appear in it (they would
 * outlive the tables the purge emptied). The per-user detail stays in the
 * Edge logs, which is where the [DELETION_ALERT] channel already reads it.
 */
export interface ProcessDueReport {
  purged: number;
  failed: number;
  failed_by_stage: Record<string, number>;
  reclaimed: number;
  needs_support: number;
  overdue: number;
  needs_support_overdue: number;
  residue: {
    deleted: Record<string, number>;
    skipped: string[];
    avatar_folders_removed: number;
    failed: boolean;
  };
}

/** Runs the purge, converting a throw into a releasable failure. */
async function runPurge(
  deps: DeleteAccountHandlerDependencies,
  admin: SupabaseClient,
  userId: string,
): Promise<PurgeResult> {
  try {
    return await deps.purge(admin, userId);
  } catch (err) {
    // Unknown progress; every step is idempotent, so release for a retry.
    return { ok: false, stage: 'delete_user', billingCancelled: false, detail: String(err) };
  }
}

async function purgeClaimed(
  admin: SupabaseClient,
  deps: DeleteAccountHandlerDependencies,
  request: ClaimedRequest,
  report: ProcessDueReport,
): Promise<void> {
  const result = await runPurge(deps, admin, request.user_id);
  if (result.ok) {
    if (result.residualTables.length > 0) {
      console.error('[DELETION_ALERT] account deleted with residual rows', {
        user_id: request.user_id,
        residual_tables: result.residualTables,
      });
    }
    if (await closeClaim(admin, request)) {
      // The account is still there: not a purge, a support case.
      report.needs_support++;
      return;
    }
    report.purged++;
    console.log(`[DELETE_DUE] purged user=${request.user_id}`, {
      billing_cancelled: result.billingCancelled,
    });
    return;
  }
  await releaseFailedClaim(admin, request, result);
  if (result.stage === NEEDS_SUPPORT_STAGE) report.needs_support++;
  report.failed++;
  report.failed_by_stage[result.stage] = (report.failed_by_stage[result.stage] ?? 0) + 1;
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
      skipped?: string[];
      orphan_avatar_folders?: string[];
    };
    report.residue.deleted = sweep.deleted ?? {};
    report.residue.skipped = sweep.skipped ?? [];
    if (report.residue.skipped.length > 0) {
      // A table the sweep could not touch (schema drift) is residue that
      // silently survives, so it is an alert and not a clean run.
      report.residue.failed = true;
      console.error('[DELETION_ALERT] residue_sweep_skipped_tables', {
        skipped: report.residue.skipped,
      });
    }
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
    purged: 0,
    failed: 0,
    failed_by_stage: {},
    reclaimed: 0,
    needs_support: 0,
    overdue: 0,
    needs_support_overdue: 0,
    residue: { deleted: {}, skipped: [], avatar_folders_removed: 0, failed: false },
  };
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const cutoffIso = new Date(now - STUCK_CLAIM_MINUTES * 60_000).toISOString();

  // 1. Claims left behind by a crashed run. Every purge step is idempotent
  //    (live Paddle status, deletes by user id, a missing user counts as
  //    deleted), so running one again is safe.
  const { data: stuck, error: stuckError } = await admin
    .from('deletion_requests')
    .select('id, user_id, claimed_at')
    .eq('status', 'executing')
    .or(stuckClaimFilter(cutoffIso))
    .order('claimed_at', { ascending: true, nullsFirst: true })
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
    report.reclaimed++;
    await purgeClaimed(admin, deps, claim.request, report);
  }

  // 2. Due requests; requests waiting on support are skipped. Ordered by
  //    last_attempt_at NULLS FIRST so a row that keeps failing is retried
  //    behind every request that has never been attempted — ten poisoned
  //    rows cannot take the whole batch every hour. Among never-attempted
  //    rows this is still oldest scheduled_for first.
  const remaining = PROCESS_DUE_BATCH_SIZE - report.reclaimed;
  if (remaining > 0) {
    const { data: due, error: dueError } = await admin
      .from('deletion_requests')
      .select('id, user_id, claimed_at')
      .eq('status', 'pending')
      .lte('scheduled_for', nowIso)
      .is('needs_support_reason', null)
      .order('last_attempt_at', { ascending: true, nullsFirst: true })
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

  // 3. Anything still open well past its date (PR 68 runbook). A row parked
  //    for support is expected to sit there until a human clears the reason,
  //    so it alerts under its own tag instead of drowning the generic
  //    `overdue` alert with an hourly repeat.
  const overdueCutoff = new Date(now - OVERDUE_ALERT_DAYS * 86_400_000).toISOString();
  const { data: overdue, error: overdueError } = await admin
    .from('deletion_requests')
    .select('user_id, status, scheduled_for, claimed_at, needs_support_reason, last_attempt_at')
    .in('status', ['pending', 'executing'])
    .lt('scheduled_for', overdueCutoff);
  if (overdueError) {
    console.error('[DELETION_ALERT] overdue_check_failed', { error: overdueError });
  } else {
    for (const row of (overdue ?? []) as Record<string, unknown>[]) {
      if (row.needs_support_reason) {
        report.needs_support_overdue++;
        console.error(
          `[DELETION_ALERT] needs_support_overdue ${row.needs_support_reason} user=${row.user_id}`,
          row,
        );
        continue;
      }
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

    // A throw releases the claim too (runPurge), so a crash in the purge
    // cannot leave the row `executing` until the 15-minute cron reclaim.
    const result = await runPurge(deps, supabaseAdmin, userId);
    if (!result.ok) {
      // deleteUser did not succeed, so the user and the request still exist.
      await releaseFailedClaim(supabaseAdmin, claim.request, result);
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

    if (result.residualTables.length > 0) {
      console.error('[DELETION_ALERT] account deleted with residual rows', {
        user_id: userId,
        residual_tables: result.residualTables,
      });
    }
    if (await closeClaim(supabaseAdmin, claim.request)) {
      // The request row is still there, so the auth user is too: the account
      // was NOT erased. Never report success — the SPA would sign the user
      // out of a live account and show the deletion as done.
      return json({
        error: 'Your account could not be fully deleted. It has been flagged for our support team; please contact support so we can finish it.',
        code: SURVIVED_PURGE_REASON,
      }, 500);
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
