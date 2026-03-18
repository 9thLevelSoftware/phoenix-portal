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
 * Algorithm: sliding-window counter.
 *  - Look up the row for (key, userId).
 *  - If the window has expired, reset the counter and allow.
 *  - If the counter is under the limit, increment and allow.
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

  // 1. Look up existing tracking row for this key + user
  const { data: existing } = await supabase
    .from('rate_limit_tracking')
    .select('id, requests_this_window, window_started_at')
    .eq('key', key)
    .eq('user_id', userId)
    .maybeSingle();

  if (!existing) {
    // First request ever for this key+user. Insert a new row.
    await supabase.from('rate_limit_tracking').insert({
      key,
      user_id: userId,
      provider: key, // backwards compat: populate provider column
      requests_this_window: 1,
      window_started_at: now.toISOString(),
      last_request_at: now.toISOString(),
    });
    return { allowed: true, remaining: maxRequests - 1 };
  }

  // 2. Check if the window has expired
  const windowStart = new Date(existing.window_started_at).getTime();
  const windowExpired = now.getTime() - windowStart > windowMs;

  if (windowExpired) {
    // Window expired. Reset counter.
    await supabase
      .from('rate_limit_tracking')
      .update({
        requests_this_window: 1,
        window_started_at: now.toISOString(),
        last_request_at: now.toISOString(),
        last_reset_at: now.toISOString(),
      })
      .eq('id', existing.id);
    return { allowed: true, remaining: maxRequests - 1 };
  }

  // 3. Window is active. Check count.
  const currentCount = existing.requests_this_window ?? 0;

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

  // 4. Under limit. Increment.
  await supabase
    .from('rate_limit_tracking')
    .update({
      requests_this_window: currentCount + 1,
      last_request_at: now.toISOString(),
    })
    .eq('id', existing.id);

  return { allowed: true, remaining: maxRequests - (currentCount + 1) };
}
