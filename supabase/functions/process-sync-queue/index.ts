import { createClient } from 'jsr:@supabase/supabase-js@2';
import { backOff } from 'npm:exponential-backoff@3.1.1';
import { getCorsHeaders } from '../_shared/cors.ts';

/**
 * Scheduled sync queue processor.
 * Called by Supabase cron or external scheduler every 5 minutes.
 * Processes pending sync tasks with rate limit checking and exponential backoff.
 */

const RATE_LIMITS: Record<string, { requests: number; windowMs: number }> = {
  strava: { requests: 80, windowMs: 15 * 60 * 1000 },
  fitbit: { requests: 120, windowMs: 60 * 60 * 1000 },
  garmin: { requests: 40, windowMs: 60 * 60 * 1000 },
  hevy: { requests: 40, windowMs: 60 * 60 * 1000 },
};

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  // Get pending tasks ordered by creation time (FIFO)
  const { data: tasks } = await supabase
    .from('sync_queue')
    .select('*')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(10);

  const results = { processed: 0, failed: 0, skipped: 0 };

  for (const task of tasks ?? []) {
    // Check rate limit for this provider
    const { data: rateLimit } = await supabase
      .from('rate_limit_tracking')
      .select('*')
      .eq('provider', task.provider)
      .single();

    const limit = RATE_LIMITS[task.provider as keyof typeof RATE_LIMITS];
    if (limit && isRateLimited(rateLimit, limit)) {
      results.skipped++;
      continue;
    }

    // Mark as processing
    await supabase
      .from('sync_queue')
      .update({ status: 'processing', started_at: new Date().toISOString() })
      .eq('id', task.id);

    try {
      // Call provider-specific sync function with exponential backoff on 429s
      await backOff(
        () => callSyncFunction(task.provider, task.user_id),
        {
          numOfAttempts: 3,
          startingDelay: 1000,
          timeMultiple: 2,
          retry: (e: Error & { status?: number }) => e.status === 429,
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

      // Re-queue on 429 (rate limit), mark failed otherwise
      await supabase
        .from('sync_queue')
        .update({
          status: err.status === 429 ? 'pending' : 'failed',
          error_message: err.message,
          retry_count: (task.retry_count ?? 0) + 1,
        })
        .eq('id', task.id);

      results.failed++;
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
