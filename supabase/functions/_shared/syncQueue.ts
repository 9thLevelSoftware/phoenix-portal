import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';

/**
 * sync_queue helpers shared by the provider sync functions (strava-sync,
 * hevy-sync, liftosaur-sync) and process-sync-queue.
 *
 * A provider function completes exactly one queue row: the one it was
 * dispatched for (`queue_id`). It must never complete "all pending rows" for
 * the user, because a second pending task (e.g. a kept `initial` next to a
 * newer incremental) would then be marked completed without ever running.
 */

// deno-lint-ignore no-explicit-any
export type DbClient = SupabaseClient<any, any, any>;

export interface CompleteSyncQueueEntryOptions {
  userId: string;
  provider: string;
  syncType: string;
  /** The row process-sync-queue dispatched this run for, if any. */
  queueId: string | null;
  /** True on the service-role path (process-sync-queue); false for a user JWT. */
  calledByQueueProcessor: boolean;
}

/**
 * Mark one sync_queue row completed.
 *
 * With a `queueId`, only that row is touched, and only while it is still in
 * the status this caller owns (`processing` when dispatched by the queue
 * processor). Without one (a browser-initiated sync), at most the single
 * newest pending row of the same sync_type is completed; the caller never
 * sweeps other rows.
 */
export async function completeSyncQueueEntry(
  supabase: DbClient,
  options: CompleteSyncQueueEntryOptions,
): Promise<void> {
  const targetStatus = options.calledByQueueProcessor ? 'processing' : 'pending';
  let queueId = options.queueId;

  if (queueId) {
    const { data: queueRow, error: selectError } = await supabase
      .from('sync_queue')
      .select('id')
      .eq('id', queueId)
      .eq('user_id', options.userId)
      .eq('provider', options.provider)
      .eq('status', targetStatus)
      .maybeSingle();

    if (selectError) {
      console.error(`Failed to verify ${options.provider} sync queue entry:`, selectError);
      return;
    }

    if (!queueRow) return;
    queueId = queueRow.id as string;
  } else if (options.calledByQueueProcessor) {
    // The processor always sends queue_id; without it there is no row this
    // run can claim to own, and guessing could complete someone else's task.
    return;
  } else {
    const { data: queueRow, error: selectError } = await supabase
      .from('sync_queue')
      .select('id')
      .eq('user_id', options.userId)
      .eq('provider', options.provider)
      .eq('status', targetStatus)
      .eq('sync_type', options.syncType)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (selectError) {
      console.error(`Failed to find ${options.provider} sync queue entry:`, selectError);
      return;
    }

    queueId = (queueRow?.id as string | undefined) ?? null;
  }

  if (!queueId) return;

  const { error: updateError } = await supabase
    .from('sync_queue')
    .update({
      status: 'completed',
      completed_at: new Date().toISOString(),
      error_message: null,
    })
    .eq('id', queueId)
    .eq('user_id', options.userId)
    .eq('provider', options.provider)
    .eq('status', targetStatus);

  if (updateError) {
    console.error(`Failed to complete ${options.provider} sync queue entry:`, updateError);
  }
}

/**
 * Lease heartbeat: bump `started_at` on the row this run is processing.
 *
 * process-sync-queue reclaims a `processing` row whose `started_at` is older
 * than its heartbeat lease (see HEARTBEAT_LEASE_MS there), so a long-running
 * provider sync must call this regularly (after each upsert chunk / every few
 * fetched pages). Only a row still `processing` is touched: a row that was
 * already reclaimed, cancelled or finished must not get its lease revived.
 * No-op without a queue id (browser-initiated runs hold no lease).
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
