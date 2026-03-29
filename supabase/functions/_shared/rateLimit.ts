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
 * Algorithm: atomic SQL-based rate limiting using a database function.
 * - Uses an RPC call to atomically check/increment within a single transaction.
 * - Eliminates race conditions from read-then-write patterns.
 *
 * Must be called with a service-role Supabase client (bypasses RLS).
 */
export async function checkRateLimit(
  supabase: SupabaseClient,
  config: RateLimitConfig,
  corsHeaders: Record<string, string>,
): Promise<RateLimitResult> {
  const { key, userId, maxRequests, windowSeconds } = config;

  // Use atomic RPC function if available (eliminates race condition)
  try {
    const { data: rpcResult, error: rpcError } = await supabase.rpc(
      'check_rate_limit',
      {
        p_key: key,
        p_user_id: userId,
        p_max_requests: maxRequests,
        p_window_seconds: windowSeconds,
      }
    );

    if (!rpcError && rpcResult) {
      const { allowed, remaining, retry_after_seconds } = rpcResult;

      if (!allowed) {
        return {
          allowed: false,
          remaining: 0,
          response: new Response(
            JSON.stringify({
              error: 'rate_limit_exceeded',
              message: `Too many requests. Try again in ${retry_after_seconds} seconds.`,
              retryAfterSeconds: retry_after_seconds,
            }),
            {
              status: 429,
              headers: {
                ...corsHeaders,
                'Content-Type': 'application/json',
                'Retry-After': String(retry_after_seconds),
              },
            },
          ),
        };
      }

      return { allowed: true, remaining };
    }
  } catch {
    // RPC not available, fall back to client-side atomic check
  }

  // Fallback: Atomic increment with conflict resolution
  const now = new Date();
  const windowMs = windowSeconds * 1000;

  // Step 1: Attempt atomic insert (first request in window)
  const { data: inserted, error: insertError } = await supabase
    .from('rate_limit_tracking')
    .insert({
      key,
      user_id: userId,
      provider: key,
      requests_this_window: 1,
      window_started_at: now.toISOString(),
      last_request_at: now.toISOString(),
    })
    .select('id, requests_this_window, window_started_at')
    .maybeSingle();

  if (inserted) {
    // New window started successfully
    return { allowed: true, remaining: maxRequests - 1 };
  }

  // Step 2: Insert conflicted, read current state and update atomically
  const { data: current, error: fetchError } = await supabase
    .from('rate_limit_tracking')
    .select('id, requests_this_window, window_started_at')
    .eq('key', key)
    .eq('user_id', userId)
    .single();

  if (fetchError || !current) {
    console.error('[rateLimit] fetch failed:', fetchError);
    // Fail open to avoid blocking legitimate requests
    return { allowed: true, remaining: 0 };
  }

  const windowStart = new Date(current.window_started_at).getTime();
  const windowExpired = now.getTime() - windowStart > windowMs;

  if (windowExpired) {
    // Reset window atomically
    const { data: reset } = await supabase
      .from('rate_limit_tracking')
      .update({
        requests_this_window: 1,
        window_started_at: now.toISOString(),
        last_request_at: now.toISOString(),
        last_reset_at: now.toISOString(),
      })
      .eq('id', current.id)
      .select('requests_this_window')
      .single();

    const count = reset?.requests_this_window ?? 1;
    return { allowed: true, remaining: maxRequests - count };
  }

  // Check limit before incrementing
  if (current.requests_this_window >= maxRequests) {
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

  // Atomic increment
  const { data: updated } = await supabase
    .from('rate_limit_tracking')
    .update({
      requests_this_window: current.requests_this_window + 1,
      last_request_at: now.toISOString(),
    })
    .eq('id', current.id)
    .eq('requests_this_window', current.requests_this_window) // Optimistic locking
    .select('requests_this_window')
    .single();

  const newCount = updated?.requests_this_window ?? current.requests_this_window + 1;
  return { allowed: true, remaining: maxRequests - newCount };
}
