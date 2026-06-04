import { type SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { normalizeRateLimitRpcResult } from './rateLimitRpc.ts';

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

const FALLBACK_UPDATE_ATTEMPTS = 3;

function rateLimitUnavailable(
  corsHeaders: Record<string, string>,
): RateLimitResult {
  return {
    allowed: false,
    remaining: 0,
    response: new Response(
      JSON.stringify({
        error: 'rate_limit_unavailable',
        message: 'Rate limit check temporarily unavailable. Please retry shortly.',
      }),
      {
        status: 503,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
          'Retry-After': '30',
        },
      },
    ),
  };
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

  // Use atomic RPC function if available (eliminates race condition).
  // fix(audit): C7 — Distinguish "RPC not deployed" (fall through to fallback)
  // from "RPC failed unexpectedly" (fail closed with 503). Never allow the
  // request purely because the rate-limit check errored.
  let rpcMissing = false;
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

    if (rpcError) {
      // Postgres returns code 42883 for "function does not exist" and PGRST202
      // from PostgREST when a schema refresh hasn't picked up the function yet.
      // Treat those as "RPC not deployed" and fall back. Any other error is
      // treated as an infrastructure failure and we fail closed.
      const code = (rpcError as { code?: string }).code;
      const message = rpcError.message ?? '';
      const looksMissing =
        code === '42883' ||
        code === 'PGRST202' ||
        /function\s+.*does\s+not\s+exist/i.test(message) ||
        /could\s+not\s+find\s+the\s+function/i.test(message);
      if (looksMissing) {
        rpcMissing = true;
      } else {
        console.error('[rateLimit] RPC check_rate_limit failed:', rpcError);
        return rateLimitUnavailable(corsHeaders);
      }
    } else if (rpcResult) {
      const normalized = normalizeRateLimitRpcResult(rpcResult);
      if (!normalized) {
        console.error('[rateLimit] check_rate_limit returned unexpected shape:', rpcResult);
        return rateLimitUnavailable(corsHeaders);
      }

      const { allowed, remaining, retry_after_seconds } = normalized;
      const retryAfterSeconds = retry_after_seconds ?? 30;

      if (!allowed) {
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

      return { allowed: true, remaining };
    }
    // rpcResult is null/undefined with no error — defensively fall through to
    // the atomic fallback rather than silently allowing traffic.
  } catch (e) {
    // fix(audit): C7 — unexpected exception (network / client bug). Fail
    // closed so an outage doesn't disable rate limiting entirely.
    console.error('[rateLimit] unexpected error calling check_rate_limit:', e);
    return rateLimitUnavailable(corsHeaders);
  }

  if (!rpcMissing) {
    // We neither got a result nor a "function missing" signal — don't let the
    // fallback implicitly allow traffic.
    console.error('[rateLimit] check_rate_limit returned no result and no error');
    return rateLimitUnavailable(corsHeaders);
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

  // fix(audit): C7 — an insert error that isn't a unique-violation is an
  // infrastructure failure (missing table, RLS misconfig, network). Fail
  // closed instead of falling through to the update path with stale data.
  if (insertError && (insertError as { code?: string }).code !== '23505') {
    console.error('[rateLimit] insert failed:', insertError);
    return rateLimitUnavailable(corsHeaders);
  }

  // Step 2: Insert conflicted, read current state and update atomically.
  // If another request wins the optimistic lock, retry against the latest
  // counter. Never synthesize success when the update returned no row.
  for (let attempt = 0; attempt < FALLBACK_UPDATE_ATTEMPTS; attempt++) {
    const { data: current, error: fetchError } = await supabase
      .from('rate_limit_tracking')
      .select('id, requests_this_window, window_started_at')
      .eq('key', key)
      .eq('user_id', userId)
      .single();

    if (fetchError || !current) {
      // fix(audit): C7 — fail closed. If we can't read the tracking row after
      // an insert conflict, something is wrong with the DB; allowing unlimited
      // traffic until it's fixed would let abuse through.
      console.error('[rateLimit] fetch failed:', fetchError);
      return rateLimitUnavailable(corsHeaders);
    }

    const windowStart = new Date(current.window_started_at).getTime();
    const attemptNow = new Date();
    const attemptNowMs = attemptNow.getTime();
    const windowExpired = attemptNowMs - windowStart > windowMs;

    if (windowExpired) {
      const { data: reset, error: resetError } = await supabase
        .from('rate_limit_tracking')
        .update({
          requests_this_window: 1,
          window_started_at: attemptNow.toISOString(),
          last_request_at: attemptNow.toISOString(),
          last_reset_at: attemptNow.toISOString(),
        })
        .eq('id', current.id)
        .eq('requests_this_window', current.requests_this_window)
        .select('requests_this_window')
        .maybeSingle();

      if (resetError) {
        console.error('[rateLimit] reset failed:', resetError);
        return rateLimitUnavailable(corsHeaders);
      }
      if (reset) {
        const count = reset.requests_this_window ?? 1;
        return { allowed: true, remaining: Math.max(maxRequests - count, 0) };
      }
      continue;
    }

    // Check limit before incrementing
    if (current.requests_this_window >= maxRequests) {
      const retryAfterMs = windowMs - (attemptNowMs - windowStart);
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

    const { data: updated, error: updateError } = await supabase
      .from('rate_limit_tracking')
      .update({
        requests_this_window: current.requests_this_window + 1,
        last_request_at: attemptNow.toISOString(),
      })
      .eq('id', current.id)
      .eq('requests_this_window', current.requests_this_window) // Optimistic locking
      .select('requests_this_window')
      .maybeSingle();

    if (updateError) {
      console.error('[rateLimit] update failed:', updateError);
      return rateLimitUnavailable(corsHeaders);
    }
    if (updated) {
      const newCount = updated.requests_this_window;
      return { allowed: true, remaining: Math.max(maxRequests - newCount, 0) };
    }
  }

  console.warn('[rateLimit] optimistic fallback update did not commit after retries');
  return rateLimitUnavailable(corsHeaders);
}
