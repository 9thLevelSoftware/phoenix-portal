import { createClient } from 'jsr:@supabase/supabase-js@2';
import { backOff } from 'npm:exponential-backoff@3.1.1';
import { getCorsHeaders } from '../_shared/cors.ts';
import { requireSubscription } from '../_shared/requireSubscription.ts';

/**
 * Scheduled sync queue processor.
 * Called by Supabase cron or external scheduler every 5 minutes.
 * Processes pending sync tasks with rate limit checking and exponential backoff.
 */

const MAX_RETRIES = 10;

const PROVIDERS = ['strava', 'fitbit', 'garmin', 'hevy', 'liftosaur'] as const;

const RETRYABLE_STATUSES = [429, 502, 503, 504];

const RATE_LIMITS: Record<string, { requests: number; windowMs: number }> = {
  strava: { requests: 80, windowMs: 15 * 60 * 1000 },
  fitbit: { requests: 120, windowMs: 60 * 60 * 1000 },
  garmin: { requests: 40, windowMs: 60 * 60 * 1000 },
  hevy: { requests: 40, windowMs: 60 * 60 * 1000 },
};

function timingSafeEqualString(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  if (ea.length !== eb.length) return false;
  let diff = 0;
  for (let i = 0; i < ea.length; i++) diff |= ea[i] ^ eb[i];
  return diff === 0;
}

function isServiceRoleRequest(req: Request): boolean {
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!serviceRoleKey) return false;
  const authHeader = req.headers.get('Authorization') ?? '';
  return timingSafeEqualString(`Bearer ${serviceRoleKey}`, authHeader);
}

function hasValidCronSecret(req: Request): boolean {
  const expectedSecret =
    Deno.env.get('CRON_SYNC_QUEUE_SECRET') ??
    Deno.env.get('PROCESS_SYNC_QUEUE_SECRET');
  if (!expectedSecret) return false;
  const provided = req.headers.get('x-cron-secret') ?? '';
  return timingSafeEqualString(expectedSecret, provided);
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors });
  }

  if (!isServiceRoleRequest(req) && !hasValidCronSecret(req)) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  const results = { processed: 0, failed: 0, skipped: 0 };

  // Process tasks per-provider to prevent queue starvation (SQ-05).
  // A rate-limited provider no longer blocks tasks from other providers.
  for (const provider of PROVIDERS) {
    // Check this provider's rate limit before fetching tasks
    const limit = RATE_LIMITS[provider as keyof typeof RATE_LIMITS];
    if (limit) {
      const { data: rateLimit } = await supabase
        .from('rate_limit_tracking')
        .select('*')
        .eq('provider', provider)
        .is('user_id', null)
        .maybeSingle();

      if (isRateLimited(rateLimit, limit)) {
        continue;
      }
    }

    // Fetch pending tasks for this provider only
    const { data: tasks } = await supabase
      .from('sync_queue')
      .select('*')
      .eq('provider', provider)
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(5);

    for (const task of tasks ?? []) {
      // SQ-04: Enforce max retry cap before processing
      if ((task.retry_count ?? 0) >= MAX_RETRIES) {
        await supabase
          .from('sync_queue')
          .update({
            status: 'permanently_failed',
            error_message: `Max retries (${MAX_RETRIES}) exceeded. Last error: ${task.error_message ?? 'unknown'}`,
            completed_at: new Date().toISOString(),
          })
          .eq('id', task.id);
        console.warn(`[SYNC_QUEUE] Task ${task.id} permanently failed after ${MAX_RETRIES} retries`);
        results.failed++;
        continue;
      }

      // Mark as processing
      await supabase
        .from('sync_queue')
        .update({ status: 'processing', started_at: new Date().toISOString() })
        .eq('id', task.id);

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
          () => callSyncFunction(task.provider, task.user_id),
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
        await incrementRateLimit(supabase, task.provider);

        results.processed++;
      } catch (error) {
        const err = error as Error & { status?: number };
        const nextRetryCount = (task.retry_count ?? 0) + 1;

        // SQ-03: Re-queue on retryable statuses (429, 502, 503, 504), mark failed otherwise
        // SQ-04: If retries exhausted, mark permanently_failed regardless of status code
        let nextStatus: string;
        let errorMessage = err.message;

        if (err.status !== undefined && RETRYABLE_STATUSES.includes(err.status)) {
          if (nextRetryCount >= MAX_RETRIES) {
            nextStatus = 'permanently_failed';
            errorMessage = `Max retries (${MAX_RETRIES}) exceeded. Last error: ${err.message}`;
            console.warn(`[SYNC_QUEUE] Task ${task.id} permanently failed after ${MAX_RETRIES} retries`);
          } else {
            nextStatus = 'pending';
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
});

/**
 * Call the provider-specific sync Edge Function.
 */
async function callSyncFunction(provider: string, userId: string) {
  if (provider === 'garmin') {
    const error = new Error(
      'Garmin sync is webhook-driven and cannot be queued manually.'
    ) as Error & { status: number };
    error.status = 400;
    throw error;
  }

  const functionName = `${provider}-sync`;
  const response = await fetch(
    `${Deno.env.get('SUPABASE_URL')}/functions/v1/${functionName}`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ user_id: userId }),
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
async function incrementRateLimit(supabase: ReturnType<typeof createClient>, provider: string) {
  const now = new Date();
  const limit = RATE_LIMITS[provider as keyof typeof RATE_LIMITS];
  if (!limit) return;

  const { data: existing } = await supabase
    .from('rate_limit_tracking')
    .select('*')
    .eq('provider', provider)
    .single();

  if (!existing) {
    await supabase.from('rate_limit_tracking').insert({
      provider,
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
      .eq('provider', provider);
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
