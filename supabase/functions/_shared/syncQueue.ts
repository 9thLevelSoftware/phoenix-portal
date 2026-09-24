import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';

/**
 * sync_queue helpers shared by the provider sync functions (strava-sync,
 * fitbit-sync, hevy-sync, liftosaur-sync) and process-sync-queue.
 *
 * Every run owns AT MOST ONE queue row, and always in status `processing`:
 *
 *  - dispatched by process-sync-queue: the row named by `queue_id`, claimed
 *    (pending -> processing) before the call;
 *  - browser-initiated (a user JWT, no `queue_id`): a row this run inserts
 *    itself, directly as `processing` so a cron pass cannot claim and
 *    dispatch it a second time while the direct call is still running.
 *
 * Owning the row is what makes the lease heartbeat and the completion safe:
 * both key on "row X, this user, still `processing`". A run never completes
 * "all pending rows" for the user — a second queued task (e.g. a kept
 * `initial` next to a newer incremental) must still run.
 *
 * Migration 20260920005200 allows one active row per (user_id, provider,
 * initial-or-not), and its `sync_queue_one_processing` index allows only one
 * executing row per provider across both classes. A concurrent browser or
 * queue run loses the processing-row race with SQLSTATE 23505 and is retried
 * later (queue) or answered with HTTP 409 `sync_already_queued` (browser).
 */

// deno-lint-ignore no-explicit-any
export type DbClient = SupabaseClient<any, any, any>;

/** SQLSTATE raised by the unique index (and by PR 31's insert guard). */
const UNIQUE_VIOLATION = '23505';

/** Error code returned to the caller when another sync is already queued. */
export const SYNC_ALREADY_QUEUED = 'sync_already_queued';

/** Error code returned when a browser run cannot acquire its ownership row. */
export const SYNC_QUEUE_UNAVAILABLE = 'sync_queue_unavailable';

export interface CompleteSyncQueueEntryOptions {
  userId: string;
  provider: string;
  /** The row this run owns (dispatched or self-created), if any. */
  queueId: string | null;
  /**
   * The row's claim generation (retry_count) when this run was claimed. When
   * given, a row reclaimed by another worker since is not completed.
   */
  claimGeneration?: number | null;
}

/**
 * Mark the queue row this run owns `completed`.
 *
 * Only the named row is touched, and only while it is still `processing`:
 * a row that was reclaimed after a lease expiry, cancelled or already
 * finished must not be overwritten by a late worker. Without a queue id
 * there is nothing this run owns, and nothing is completed.
 */
/**
 * Returns true only when this worker's `processing` row became `completed`
 * (or there is no row). False on a write error, and also when the update
 * matched nothing: the row was cancelled by a disconnect or reclaimed, so the
 * caller no longer owns it.
 */
export async function completeSyncQueueEntry(
  supabase: DbClient,
  options: CompleteSyncQueueEntryOptions,
): Promise<boolean> {
  if (!options.queueId) return true;

  let query = supabase
    .from('sync_queue')
    .update({
      status: 'completed',
      completed_at: new Date().toISOString(),
      error_message: null,
    })
    .eq('id', options.queueId)
    .eq('user_id', options.userId)
    .eq('provider', options.provider)
    .eq('status', 'processing');
  if (options.claimGeneration !== undefined && options.claimGeneration !== null) {
    query = query.eq('retry_count', options.claimGeneration);
  }
  const { data, error } = await query.select('id');

  if (error) {
    console.error(`Failed to complete ${options.provider} sync queue entry:`, error);
    return false;
  }
  if (!Array.isArray(data) || data.length === 0) {
    console.warn(`${options.provider} sync queue entry was no longer processing; not completed`);
    return false;
  }
  return true;
}

export interface CreateSyncQueueEntryOptions {
  userId: string;
  provider: string;
  /** 'initial' | 'incremental' | 'manual'. */
  syncType: string;
  now?: Date;
}

export interface CreateSyncQueueEntryResult {
  /** The row this run now owns, or null when none could be created. */
  queueId: string | null;
  /** Another sync of the same kind is already pending or processing. */
  conflict: boolean;
}

/**
 * Insert the queue row for a browser-initiated sync, as the service role.
 *
 * The row is created directly in `processing` with a fresh `started_at`: this
 * run is the worker, and a `pending` row would be claimed by the next cron
 * pass and dispatched a second time (PR 31 review R-1).
 *
 * Returns `{ conflict: true }` when either queue index rejects the insert —
 * another sync of the same kind is queued, or any class is already running
 * for this (user, provider). Any other insert failure yields no row. Callers
 * must fail closed before provider or credential work when `queueId` is null:
 * running without ownership would reopen the concurrency race this row closes.
 */
export async function createSyncQueueEntry(
  supabase: DbClient,
  options: CreateSyncQueueEntryOptions,
): Promise<CreateSyncQueueEntryResult> {
  const nowIso = (options.now ?? new Date()).toISOString();

  const { data, error } = await supabase
    .from('sync_queue')
    .insert({
      user_id: options.userId,
      provider: options.provider,
      sync_type: options.syncType,
      status: 'processing',
      created_at: nowIso,
      started_at: nowIso,
      retry_count: 0,
    })
    .select('id')
    .maybeSingle();

  if (error) {
    if ((error as { code?: string }).code === UNIQUE_VIOLATION) {
      return { queueId: null, conflict: true };
    }
    console.error(`Failed to queue ${options.provider} sync:`, error);
    return { queueId: null, conflict: false };
  }

  return { queueId: (data as { id?: string } | null)?.id ?? null, conflict: false };
}

/**
 * Hand a browser-owned row back after the sync failed.
 *
 * A row left `processing` would block the user's next manual sync with a 409
 * until process-sync-queue reclaims it (and would then be retried by cron on
 * the user's behalf). Queue-DISPATCHED rows deliberately keep the opposite
 * behaviour: PR 51 leaves them `processing` so the queue re-runs them.
 *
 * `message` must be a fixed string — provider and database text is never
 * echoed back into the queue (PR 51).
 */
export async function failSyncQueueEntry(
  supabase: DbClient,
  queueId: string | null,
  userId: string,
  message: string,
): Promise<void> {
  if (!queueId) return;

  const { error } = await supabase
    .from('sync_queue')
    .update({
      status: 'failed',
      error_message: message,
      completed_at: new Date().toISOString(),
    })
    .eq('id', queueId)
    .eq('user_id', userId)
    .eq('status', 'processing');

  if (error) {
    console.error('Failed to release sync queue entry:', error);
  }
}

/** Fixed text stamped on a browser-owned row whose run did not succeed. */
export const SYNC_RUN_FAILED = 'Sync run failed';

/**
 * The queue row a browser-initiated run created for itself, filled in by the
 * handler body so the thin outer handler can hand it back when the run ends
 * in a non-2xx response.
 */
export interface OwnedQueueRow {
  supabase: DbClient | null;
  queueId: string | null;
  userId: string | null;
}

/** An empty holder; the handler body fills it once it owns a row. */
export function noOwnedQueueRow(): OwnedQueueRow {
  return { supabase: null, queueId: null, userId: null };
}

/**
 * Release a browser-owned row after a failed run (see failSyncQueueEntry).
 * Does nothing when this run created no row of its own.
 */
export async function releaseOwnedQueueRow(
  owned: OwnedQueueRow,
  message: string = SYNC_RUN_FAILED,
): Promise<void> {
  if (!owned.supabase || !owned.queueId || !owned.userId) return;
  await failSyncQueueEntry(owned.supabase, owned.queueId, owned.userId, message);
}

/**
 * Lease heartbeat: bump `started_at` on the row this run is processing.
 *
 * process-sync-queue reclaims a `processing` row whose `started_at` is older
 * than its heartbeat lease (see HEARTBEAT_LEASE_MS there), so a long-running
 * provider sync must call this regularly (after each upsert chunk / every few
 * fetched pages). Only a row still `processing` is touched: a row that was
 * already reclaimed, cancelled or finished must not get its lease revived.
 * No-op without a queue id (a run that owns no row holds no lease).
 */
export async function heartbeatSyncQueueEntry(
  supabase: DbClient,
  queueId: string | null,
  userId: string,
  now: Date = new Date(),
): Promise<void> {
  if (!queueId) return;
  const { error } = await supabase
    .from('sync_queue')
    .update({ started_at: now.toISOString() })
    .eq('id', queueId)
    .eq('user_id', userId)
    .eq('status', 'processing');
  if (error) {
    // A missed heartbeat only risks an early reclaim; never fail the sync.
    console.error('Failed to heartbeat sync queue entry:', error);
  }
}

/** 409 for a browser sync that lost the `sync_queue_one_active` race. */
export function syncAlreadyQueuedResponse(cors: Record<string, string>): Response {
  return new Response(
    JSON.stringify({
      error: 'A sync is already queued or running for this provider.',
      code: SYNC_ALREADY_QUEUED,
    }),
    { status: 409, headers: { ...cors, 'Content-Type': 'application/json' } },
  );
}

/** 503 when a browser sync cannot establish exclusive ownership. */
export function syncQueueUnavailableResponse(cors: Record<string, string>): Response {
  return new Response(
    JSON.stringify({
      error: 'Unable to start sync right now. Please retry.',
      code: SYNC_QUEUE_UNAVAILABLE,
    }),
    { status: 503, headers: { ...cors, 'Content-Type': 'application/json' } },
  );
}
