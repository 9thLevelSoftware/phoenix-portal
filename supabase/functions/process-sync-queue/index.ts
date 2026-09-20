import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { backOff } from 'npm:exponential-backoff@3.1.1';
import { getCorsHeaders } from '../_shared/cors.ts';
import { dailyRateLimitKey } from '../_shared/providerRateLimit.ts';
import { requireSubscription } from '../_shared/requireSubscription.ts';
import { type EnvReader, hasValidCronSecret } from '../_shared/cronSecret.ts';
import { isServiceRoleBearer } from '../_shared/timingSafe.ts';

/**
 * Loose Supabase client type for helper signatures. The bare
 * `ReturnType<typeof createClient>` collapses table payload types to `never`.
 */
type DbClient = SupabaseClient<any, any, any>;

/**
 * What `callSyncFunction` throws. `status` is the provider sync function's
 * HTTP status (absent for a transport-level throw); `failureCode` overrides
 * the derived code for failures the processor raises itself.
 */
type SyncFunctionError = Error & { status?: number; failureCode?: string };

/**
 * Scheduled sync queue processor.
 * Called by pg_cron (job `process-sync-queue`, every 5 minutes, through
 * private.invoke_edge_function) with the x-cron-secret header.
 * Processes pending sync tasks with rate limit checking and exponential backoff.
 *
 * Per (user_id, provider) the processor runs at most one task at a time:
 * a pending row is not claimed while another row for the same pair is
 * `processing` (in this or an overlapping pass, within the lease), nor after
 * an earlier row for the pair failed retryably in this pass. Rows are taken
 * oldest-first, so a kept `initial` runs before a newer incremental/manual
 * row, and the newer row only runs in the same pass if the initial completed.
 */

const MAX_RETRIES = 10;

// A task that has sat in `processing` longer than its lease is assumed to have
// crashed mid-run (the worker died before marking it completed/failed) and is
// reclaimed back to `pending` so it can be retried.
//
// Providers that renew their lease while they run (heartbeatSyncQueueEntry in
// _shared/syncQueue.ts bumps `started_at` after every upsert chunk and every
// few fetched pages) get a short lease: a row whose heartbeat is older than
// 5 minutes has stopped making progress, so it is reclaimed within a cron
// tick or two instead of stranding the user's sync for half an hour.
export const HEARTBEAT_LEASE_MS = 5 * 60 * 1000;

// Providers that do NOT heartbeat keep the long lease. It must comfortably
// exceed the longest a live task can run: a pass runs up to the Edge
// wall-clock limit (400 s on paid plans) and the cron fires every 5 minutes,
// so passes can overlap. A lease at or below that would let the next pass
// reclaim and re-dispatch a row whose sync is still running.
export const PROCESSING_LEASE_MS = 30 * 60 * 1000;

/** Provider sync functions that call heartbeatSyncQueueEntry while running. */
const HEARTBEAT_PROVIDERS: ReadonlySet<string> = new Set(['strava', 'hevy', 'liftosaur']);

export function processingLeaseMs(provider: string): number {
  return HEARTBEAT_PROVIDERS.has(provider) ? HEARTBEAT_LEASE_MS : PROCESSING_LEASE_MS;
}

const PROVIDERS = ['strava', 'fitbit', 'garmin', 'hevy', 'liftosaur'] as const;

/** Maximum sync tasks dispatched per provider per cron pass. */
const TASKS_PER_PROVIDER = 5;

const RETRYABLE_STATUSES = [429, 502, 503, 504];

const RATE_LIMITS: Record<string, { requests: number; windowMs: number }> = {
  strava: { requests: 80, windowMs: 15 * 60 * 1000 },
  fitbit: { requests: 120, windowMs: 60 * 60 * 1000 },
  garmin: { requests: 40, windowMs: 60 * 60 * 1000 },
  hevy: { requests: 40, windowMs: 60 * 60 * 1000 },
  // fix(audit): H — liftosaur is in PROVIDERS but was missing here, so its
  // tasks ran with no per-provider rate cap. Liftosaur's public API doesn't
  // publish a hard rate limit, so we use a conservative ceiling in line with
  // the other lightweight clients.
  liftosaur: { requests: 40, windowMs: 60 * 60 * 1000 },
};

/**
 * Whether a provider's published quota is charged against the whole
 * application or against each authorizing user independently.
 *
 * This distinction is load-bearing. Modelling a per-user quota as an app-wide
 * bucket silently caps the ENTIRE user base at one user's allowance — Fitbit
 * grants 150 requests/hour per authorized user, so a shared 120/hour bucket
 * meant the second concurrent Fitbit user could starve the first.
 *
 *  - 'app'  — quota is per registered application (keyed with user_id NULL).
 *  - 'user' — quota is per authorizing user / per API key (keyed by user_id).
 */
const RATE_LIMIT_SCOPE: Record<string, 'app' | 'user'> = {
  // Strava's documented limits are per-application across all athletes.
  strava: 'app',
  // Garmin meters per consumer key.
  garmin: 'app',
  // Fitbit: 150 requests/hour for EACH authorized user, reset on the hour.
  fitbit: 'user',
  // Hevy and Liftosaur authenticate with a per-user API key, so any quota
  // they enforce is inherently scoped to that key.
  hevy: 'user',
  liftosaur: 'user',
};

function rateLimitScope(provider: string): 'app' | 'user' {
  return RATE_LIMIT_SCOPE[provider] ?? 'app';
}

/**
 * Second, longer quota window for providers that meter one.
 *
 * Strava publishes 100 reads/15min AND 1,000 reads/day. Tracking only the
 * 15-minute window let a steady trickle of syncs exhaust the daily allowance
 * and start collecting 429s with nothing in the config able to explain why.
 * Values carry the same ~20% safety margin as RATE_LIMITS.
 */
const DAILY_RATE_LIMITS: Record<string, { requests: number; windowMs: number }> = {
  strava: { requests: 800, windowMs: 24 * 60 * 60 * 1000 }, // reserve 20% of 1,000
};

// CRON_SECRET (Operator Action 7) is read first by the shared helper; these
// older per-function names stay accepted as fallbacks.
const LEGACY_CRON_SECRET_NAMES = ['PROCESS_SYNC_QUEUE_SECRET', 'CRON_SYNC_QUEUE_SECRET'];

export interface ProcessSyncQueueDependencies {
  /** Environment lookup (Deno.env.get in production). */
  env: EnvReader;
  /** Service-role client factory. */
  createAdminClient: (url: string, serviceRoleKey: string) => DbClient;
  /** Used to call the provider `${provider}-sync` functions. */
  fetch: typeof fetch;
}

function defaultProcessSyncQueueDependencies(): ProcessSyncQueueDependencies {
  return {
    env: (key) => Deno.env.get(key),
    createAdminClient: (url, key) => createClient(url, key),
    fetch: (input, init) => fetch(input, init),
  };
}

function isServiceRoleRequest(req: Request, env: EnvReader): boolean {
  return isServiceRoleBearer(
    req.headers.get('Authorization'),
    env('SUPABASE_SERVICE_ROLE_KEY'),
  );
}

export function createProcessSyncQueueHandler(
  dependencies: ProcessSyncQueueDependencies = defaultProcessSyncQueueDependencies(),
): (req: Request) => Promise<Response> {
  return (req) => processSyncQueue(req, dependencies);
}

if (import.meta.main) {
  Deno.serve(createProcessSyncQueueHandler());
}

async function processSyncQueue(
  req: Request,
  deps: ProcessSyncQueueDependencies,
): Promise<Response> {
  const { env } = deps;
  const cors = getCorsHeaders(req);

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors });
  }

  if (!isServiceRoleRequest(req, env) && !hasValidCronSecret(req, env, LEGACY_CRON_SECRET_NAMES)) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }

  const supabase = deps.createAdminClient(
    env('SUPABASE_URL')!,
    env('SUPABASE_SERVICE_ROLE_KEY')!
  );

  const results = { processed: 0, failed: 0, skipped: 0 };

  // Process tasks per-provider to prevent queue starvation (SQ-05).
  // A rate-limited provider no longer blocks tasks from other providers.
  for (const provider of PROVIDERS) {
    const limit = RATE_LIMITS[provider as keyof typeof RATE_LIMITS];
    const scope = rateLimitScope(provider);

    // App-scoped providers can be short-circuited for the whole provider before
    // any task is read: one exhausted bucket blocks every user equally.
    // User-scoped providers must NOT be checked here — a single throttled user
    // would skip the entire provider for everyone. They are checked per task
    // against their own bucket just before the claim, below.
    if (limit && scope === 'app') {
      const { data: rateLimit } = await supabase
        .from('rate_limit_tracking')
        .select('*')
        .eq('key', provider)
        .is('user_id', null)
        .maybeSingle();

      if (isRateLimited(rateLimit, limit)) {
        continue;
      }
    }

    // Some providers meter a second, longer window on top of the short one.
    // Strava caps reads at 1,000/day as well as 100/15min; exhausting the daily
    // budget must halt dispatch even though the 15-minute bucket looks healthy.
    const dailyLimit = DAILY_RATE_LIMITS[provider as keyof typeof DAILY_RATE_LIMITS];
    if (dailyLimit) {
      const { data: dailyTracking } = await supabase
        .from('rate_limit_tracking')
        .select('*')
        .eq('key', dailyRateLimitKey(provider))
        .is('user_id', null)
        .maybeSingle();

      if (isRateLimited(dailyTracking, dailyLimit)) {
        console.warn(`[SYNC_QUEUE] ${provider} daily quota exhausted; skipping`);
        continue;
      }
    }

    // Reclaim tasks stuck in `processing` past the lease (crashed workers, or a
    // heartbeating provider whose heartbeat went quiet) so
    // they are retried instead of being stranded forever. Increment retry_count
    // on each reclaim and mark `permanently_failed` at the cap; otherwise a task
    // whose sync deterministically times out/crashes would be requeued every
    // lease interval forever and never reach a terminal state.
    const leaseExpiry = new Date(Date.now() - processingLeaseMs(provider)).toISOString();
    const { data: staleTasks } = await supabase
      .from('sync_queue')
      .select('id, retry_count')
      .eq('provider', provider)
      .eq('status', 'processing')
      .lt('started_at', leaseExpiry);

    for (const stale of staleTasks ?? []) {
      const nextRetryCount = (stale.retry_count ?? 0) + 1;
      // Re-assert the expired-lease predicate in the update so a concurrent
      // processor that has already reclaimed (or freshly re-claimed) this row
      // cannot be clobbered: a fresh claim sets started_at >= leaseExpiry, so
      // this `lt` no longer matches and the stale snapshot becomes a no-op.
      if (nextRetryCount >= MAX_RETRIES) {
        await supabase
          .from('sync_queue')
          .update({
            status: 'permanently_failed',
            retry_count: nextRetryCount,
            error_message: `Max retries (${MAX_RETRIES}) exceeded: processing lease expired repeatedly`,
            completed_at: new Date().toISOString(),
          })
          .eq('id', stale.id)
          .eq('status', 'processing')
          .lt('started_at', leaseExpiry);
      } else {
        await supabase
          .from('sync_queue')
          .update({
            status: 'pending',
            retry_count: nextRetryCount,
            error_message: 'Reclaimed after processing lease expired',
          })
          .eq('id', stale.id)
          .eq('status', 'processing')
          .lt('started_at', leaseExpiry);
      }
    }

    // Fetch pending tasks for this provider only.
    //
    // User-scoped providers read a wider candidate window than they will
    // process: tasks belonging to a throttled user are skipped rather than
    // claimed, and with a window of exactly TASKS_PER_PROVIDER one busy user
    // sitting at the head of the queue would stall every other user until
    // their window rolled over. Reading deeper lets the processor step past
    // them to tasks it can actually run.
    const candidateLimit =
      scope === 'user' ? TASKS_PER_PROVIDER * 5 : TASKS_PER_PROVIDER;
    const { data: tasks } = await supabase
      .from('sync_queue')
      .select('*')
      .eq('provider', provider)
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(candidateLimit);

    let claimedThisProvider = 0;

    // Serialize per (user_id, provider). Users with a row still `processing`
    // for this provider (a live task from this or an overlapping pass; stale
    // ones were reclaimed above) are skipped, as are users whose earlier row
    // failed retryably in this pass.
    const { data: processingRows } = await supabase
      .from('sync_queue')
      .select('user_id')
      .eq('provider', provider)
      .eq('status', 'processing');
    const busyUsers = new Set<string>(
      (processingRows ?? []).map((r: { user_id: string }) => r.user_id),
    );

    for (const task of tasks ?? []) {
      // Honour the per-provider dispatch budget regardless of how many
      // candidates were read above.
      if (claimedThisProvider >= TASKS_PER_PROVIDER) break;

      // SQ-04: Enforce max retry cap before processing
      if ((task.retry_count ?? 0) >= MAX_RETRIES) {
        await supabase
          .from('sync_queue')
          .update({
            status: 'permanently_failed',
            // Same terminal state as the catch block below, so the same
            // spelling — anything grouping this column sees one format. The
            // previous value is deliberately not re-wrapped: a legacy row may
            // still hold a raw provider body, and it is in the log line below.
            error_message: 'max_retries_exceeded',
            completed_at: new Date().toISOString(),
          })
          .eq('id', task.id);
        console.warn(
          `[SYNC_QUEUE] Task ${task.id} permanently failed after ${MAX_RETRIES} retries;`,
          `last error: ${task.error_message ?? 'unknown'}`,
        );
        results.failed++;
        continue;
      }

      if (busyUsers.has(task.user_id)) {
        results.skipped++;
        continue;
      }

      // User-scoped quotas are checked per task, against this user's own
      // bucket, so one throttled user cannot stall the provider for everyone.
      // Leave the task `pending` — the next cron pass retries it once the
      // user's window rolls over.
      if (limit && scope === 'user') {
        const { data: userRateLimit } = await supabase
          .from('rate_limit_tracking')
          .select('*')
          .eq('key', provider)
          .eq('user_id', task.user_id)
          .maybeSingle();

        if (isRateLimited(userRateLimit, limit)) {
          results.skipped++;
          continue;
        }
      }

      // Atomically claim the task: only transition pending -> processing, and
      // proceed only if THIS invocation won the row. Two concurrent cron runs
      // can read the same pending rows, so an unconditional update would let
      // both call the provider sync (duplicate external API calls/writes).
      const { data: claimed } = await supabase
        .from('sync_queue')
        .update({ status: 'processing', started_at: new Date().toISOString() })
        .eq('id', task.id)
        .eq('status', 'pending')
        .select('id')
        .maybeSingle();

      if (!claimed) {
        busyUsers.add(task.user_id);
        // Another concurrent invocation already claimed this task — skip it.
        continue;
      }

      claimedThisProvider++;

      // Check subscription before calling sync function
      const gate = await requireSubscription(supabase, task.user_id, 'FLAME', cors);
      if (!gate.allowed) {
        await supabase
          .from('sync_queue')
          .update({
            status: 'failed',
            error_message: `Subscription required: ${gate.tier} does not meet FLAME minimum`,
            completed_at: new Date().toISOString(),
          })
          .eq('id', task.id);
        results.failed++;
        continue;
      }

      try {
        // Call provider-specific sync function with exponential backoff on transient errors
        await backOff(
          () => callSyncFunction(
            deps,
            task.provider,
            task.user_id,
            task.sync_type ?? 'incremental',
            task.id,
          ),
          {
            numOfAttempts: 3,
            startingDelay: 1000,
            timeMultiple: 2,
            // SQ-03: Retry on 429 AND transient server errors (502, 503, 504)
            retry: (e: Error & { status?: number }) =>
              e.status !== undefined && RETRYABLE_STATUSES.includes(e.status),
          }
        );

        // Mark completed
        await supabase
          .from('sync_queue')
          .update({ status: 'completed', completed_at: new Date().toISOString() })
          .eq('id', task.id);

        // Increment rate limit counter
        // Charge the request against the same bucket the dispatch check reads.
        await incrementRateLimit(
          supabase,
          task.provider,
          rateLimitScope(task.provider) === 'user' ? task.user_id : null,
        );

        results.processed++;
      } catch (error) {
        const err = error as SyncFunctionError;
        const nextRetryCount = (task.retry_count ?? 0) + 1;

        // SQ-03: Re-queue on retryable statuses (429, 502, 503, 504), mark failed otherwise
        // SQ-04: If retries exhausted, mark permanently_failed regardless of status code
        let nextStatus: string;
        // `err.message` is the provider sync function's response body (see
        // callSyncFunction). sync_queue.error_message is readable by the user
        // through RLS and rendered in the UI, so only a stable code goes in;
        // the body itself is logged here and nowhere else.
        console.error(
          `[SYNC_QUEUE] Task ${task.id} (${task.provider}) failed`,
          `status=${err.status ?? 'none'}`,
          err.message,
        );
        const failureCode = err.failureCode ??
          (err.status === undefined
            ? 'provider_sync_failed'
            : `provider_sync_http_${err.status}`);
        let errorMessage = failureCode;

        if (err.status !== undefined && RETRYABLE_STATUSES.includes(err.status)) {
          if (nextRetryCount >= MAX_RETRIES) {
            nextStatus = 'permanently_failed';
            errorMessage = `max_retries_exceeded: ${failureCode}`;
            console.warn(`[SYNC_QUEUE] Task ${task.id} permanently failed after ${MAX_RETRIES} retries`);
          } else {
            nextStatus = 'pending';
            // Keep this user's newer rows for the pair until the retry runs.
            busyUsers.add(task.user_id);
          }
        } else {
          nextStatus = 'failed';
        }

        await supabase
          .from('sync_queue')
          .update({
            status: nextStatus,
            error_message: errorMessage,
            retry_count: nextRetryCount,
            ...(nextStatus !== 'pending' && { completed_at: new Date().toISOString() }),
          })
          .eq('id', task.id);

        results.failed++;
      }
    }
  }

  return new Response(JSON.stringify(results), {
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

/**
 * Call the provider-specific sync Edge Function.
 */
async function callSyncFunction(
  deps: ProcessSyncQueueDependencies,
  provider: string,
  userId: string,
  syncType: string,
  queueId: string,
) {
  if (provider === 'garmin') {
    // A local refusal, not a provider response: carry an explicit code so the
    // queue row says why instead of claiming an upstream 400.
    const error = new Error(
      'Garmin sync is webhook-driven and cannot be queued manually.'
    ) as SyncFunctionError;
    error.status = 400;
    error.failureCode = 'garmin_not_queueable';
    throw error;
  }

  const functionName = `${provider}-sync`;
  const response = await deps.fetch(
    `${deps.env('SUPABASE_URL')}/functions/v1/${functionName}`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${deps.env('SUPABASE_SERVICE_ROLE_KEY')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ user_id: userId, sync_type: syncType, queue_id: queueId }),
    }
  );

  if (!response.ok) {
    const error = new Error(await response.text()) as Error & { status: number };
    error.status = response.status;
    throw error;
  }

  return response.json();
}

/**
 * Increment the rate limit counter for a provider, resetting the window if expired.
 */
async function incrementRateLimit(
  supabase: DbClient,
  provider: string,
  userId: string | null,
) {
  const now = new Date();
  const limit = RATE_LIMITS[provider as keyof typeof RATE_LIMITS];
  if (!limit) return;

  // Accounting MUST target the same row the dispatch check reads, on both axes:
  //  - the `key` column (the check filters on `key`, not the legacy `provider`)
  //  - the same user scope (a per-user check against a bucket only ever
  //    incremented at user_id IS NULL never accumulates, so the limit is
  //    unenforceable and never blocks dispatch)
  const scopedQuery = supabase
    .from('rate_limit_tracking')
    .select('*')
    .eq('key', provider);

  const { data: existing } = await (userId === null
    ? scopedQuery.is('user_id', null)
    : scopedQuery.eq('user_id', userId)
  ).maybeSingle();

  if (!existing) {
    await supabase.from('rate_limit_tracking').insert({
      key: provider,
      provider,
      user_id: userId,
      requests_this_window: 1,
      window_started_at: now.toISOString(),
      last_request_at: now.toISOString(),
    });
  } else {
    const windowStart = new Date(existing.window_started_at).getTime();
    const windowExpired = now.getTime() - windowStart > limit.windowMs;

    await supabase
      .from('rate_limit_tracking')
      .update({
        requests_this_window: windowExpired ? 1 : existing.requests_this_window + 1,
        window_started_at: windowExpired ? now.toISOString() : existing.window_started_at,
        last_request_at: now.toISOString(),
        last_reset_at: windowExpired ? now.toISOString() : existing.last_reset_at,
      })
      .eq('id', existing.id);
  }
}

/**
 * Check if a provider is currently rate-limited based on tracking data.
 */
function isRateLimited(
  tracking: { requests_this_window: number; window_started_at: string } | null,
  limit: { requests: number; windowMs: number }
): boolean {
  if (!tracking) return false;
  const windowStart = new Date(tracking.window_started_at).getTime();
  const now = Date.now();
  if (now - windowStart > limit.windowMs) return false;
  return tracking.requests_this_window >= limit.requests;
}
