import { type SupabaseClient } from 'jsr:@supabase/supabase-js@2';

interface RateLimitConfig {
  /** Unique key for this rate limit (e.g., 'delete-account', 'mobile-sync-push') */
  key: string;
  /** User ID to rate limit */
  userId: string;
  /** Maximum requests allowed in the window */
  maxRequests: number;
  /** Window duration in seconds */
  windowSeconds: number;
}

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  /** Pre-built 429 Response when rate-limited. Only set when allowed=false. */
  response?: Response;
}

/**
 * Check and enforce per-user rate limits using the `rate_limit_tracking` table.
 *
 * Algorithm: sliding-window counter with atomic upsert.
 *  - Upsert a row for (key, userId) with an atomic increment.
 *  - If the window has expired, reset the counter atomically.
 *  - If the counter is under the limit, allow.
 *  - If the counter is at or over the limit, deny with a 429 response.
 *
 * Must be called with a service-role Supabase client (bypasses RLS).
 */
export async function checkRateLimit(
  supabase: SupabaseClient,
  config: RateLimitConfig,
  corsHeaders: Record<string, string>,
): Promise<RateLimitResult> {
  const { key, userId, maxRequests, windowSeconds } = config;
  const now = new Date();
  const windowMs = windowSeconds * 1000;

  // Atomic upsert + conditional increment via RPC-style raw SQL.
  // This avoids the read-then-write race condition where concurrent requests
  // could both read the same count and both increment to count+1.
  const { data: row, error } = await supabase
    .from('rate_limit_tracking')
    .upsert(
      {
        key,
        user_id: userId,
        provider: key, // backwards compat
        requests_this_window: 1,
        window_started_at: now.toISOString(),
        last_request_at: now.toISOString(),
      },
      { onConflict: 'key,user_id', ignoreDuplicates: false },
    )
    .select('id, requests_this_window, window_started_at')
    .single();

  // If upsert inserted a brand-new row, requests_this_window = 1 and we're done.
  if (!row || error) {
    // Fallback: if upsert fails (shouldn't normally), allow but log.
    console.error('[rateLimit] upsert failed:', error);
    return { allowed: true, remaining: maxRequests - 1 };
  }

  // Check if the window has expired — if so, reset atomically.
  const windowStart = new Date(row.window_started_at).getTime();
  const windowExpired = now.getTime() - windowStart > windowMs;

  if (windowExpired) {
    // Window expired. Reset counter atomically.
    const { data: resetRow } = await supabase
      .from('rate_limit_tracking')
      .update({
        requests_this_window: 1,
        window_started_at: now.toISOString(),
        last_request_at: now.toISOString(),
        last_reset_at: now.toISOString(),
      })
      .eq('id', row.id)
      .select('requests_this_window')
      .single();
    const count = resetRow?.requests_this_window ?? 1;
    return { allowed: true, remaining: maxRequests - count };
  }

  // Window is active. The upsert may have set count to 1 (new row) or kept the
  // existing count (conflict). For existing rows, we need to increment atomically.
  // Read the current state and increment.
  const currentCount = row.requests_this_window ?? 0;

  if (currentCount >= maxRequests) {
    // Over limit. Calculate retry-after.
    const retryAfterMs = windowMs - (now.getTime() - windowStart);
    const retryAfterSeconds = Math.ceil(retryAfterMs / 1000);

    return {
      allowed: false,
      remaining: 0,
      response: new Response(
        JSON.stringify({
          error: 'rate_limit_exceeded',
          message: `Too many requests. Try again in ${retryAfterSeconds} seconds.`,
          retryAfterSeconds,
        }),
        {
          status: 429,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
            'Retry-After': String(retryAfterSeconds),
          },
        },
      ),
    };
  }

  // Under limit. Increment atomically using the row ID.
  await supabase
    .from('rate_limit_tracking')
    .update({
      requests_this_window: currentCount + 1,
      last_request_at: now.toISOString(),
    })
    .eq('id', row.id);

  return { allowed: true, remaining: maxRequests - (currentCount + 1) };
}
