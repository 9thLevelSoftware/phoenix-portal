/**
 * Rate limit configuration per integration provider.
 * Values include a 20% safety margin below documented API limits.
 */
export const RATE_LIMITS: Record<string, { requests: number; windowMs: number }> = {
  strava: { requests: 80, windowMs: 15 * 60 * 1000 },   // 80/15min (reserve 20% of 100)
  fitbit: { requests: 120, windowMs: 60 * 60 * 1000 },   // 120/hr (reserve 20% of 150)
  garmin: { requests: 40, windowMs: 60 * 60 * 1000 },    // Conservative estimate
  hevy: { requests: 40, windowMs: 60 * 60 * 1000 },      // Conservative estimate
};

/**
 * Check if a provider is currently rate-limited based on tracking data.
 * Returns true if requests in current window have reached the limit.
 */
export function isRateLimited(
  tracking: { requests_this_window: number; window_started_at: string } | null,
  limit: { requests: number; windowMs: number }
): boolean {
  if (!tracking) return false;

  const windowStart = new Date(tracking.window_started_at).getTime();
  const now = Date.now();

  // Window expired, not rate limited
  if (now - windowStart > limit.windowMs) return false;

  // Within window, check count
  return tracking.requests_this_window >= limit.requests;
}
