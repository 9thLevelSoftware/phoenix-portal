import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';

// deno-lint-ignore no-explicit-any
type DbClient = SupabaseClient<any, any, any>;

/**
 * Complete exactly the queue row claimed by process-sync-queue.
 *
 * Browser calls do not own a queue row, so callers must pass null for them.
 * The status predicate fences this write against retries and stale dispatches.
 */
export async function completeClaimedSyncQueueEntry(
  supabase: DbClient,
  options: {
    queueId: string | null;
    userId: string;
    provider: string;
  },
): Promise<void> {
  if (!options.queueId) return;

  const { error } = await supabase
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

  if (error) {
    console.error(`Failed to complete ${options.provider} sync queue entry:`, error);
  }
}
