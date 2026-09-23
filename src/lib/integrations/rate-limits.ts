/**
 * Rate limit configuration per integration provider.
 * Values include a 20% safety margin below documented API limits.
 *
 * MUST stay in sync with RATE_LIMITS in
 * `supabase/functions/process-sync-queue/index.ts` — enforced by
 * `src/lib/__tests__/rate-limit-schema.test.ts`.
 */
export const RATE_LIMITS: Record<
	string,
	{ requests: number; windowMs: number }
> = {
	strava: { requests: 80, windowMs: 15 * 60 * 1000 }, // 80/15min (reserve 20% of 100)
	fitbit: { requests: 120, windowMs: 60 * 60 * 1000 }, // 120/hr per user (reserve 20% of 150)
	garmin: { requests: 40, windowMs: 60 * 60 * 1000 }, // Conservative estimate
	hevy: { requests: 40, windowMs: 60 * 60 * 1000 }, // Conservative estimate
	liftosaur: { requests: 40, windowMs: 60 * 60 * 1000 }, // Mirrors process-sync-queue server limit
};

/**
 * Whether a provider's quota is charged against the whole application or
 * against each authorizing user independently.
 *
 * Modelling a per-user quota as an app-wide bucket caps the entire user base at
 * one user's allowance; modelling an app-wide quota as per-user overruns the
 * provider's limit once enough users connect. Neither direction is safe to
 * guess, so each provider is declared explicitly.
 *
 * MUST stay in sync with RATE_LIMIT_SCOPE in
 * `supabase/functions/process-sync-queue/index.ts`.
 */
export const RATE_LIMIT_SCOPES: Record<string, "app" | "user"> = {
	strava: "app", // Documented per registered application, across all athletes
	garmin: "app", // Metered per consumer key
	fitbit: "user", // 150 req/hr for EACH authorized user, resets on the hour
	hevy: "user", // Per-user API key
	liftosaur: "user", // Per-user API key
};

/**
 * Second, longer quota window for providers that publish one.
 *
 * Strava enforces 100 reads/15min AND 1,000 reads/day. Tracking only the short
 * window lets a steady trickle of syncs exhaust the daily allowance and start
 * collecting 429s with no local state able to explain it.
 *
 * MUST stay in sync with DAILY_RATE_LIMITS in
 * `supabase/functions/process-sync-queue/index.ts`.
 */
export const DAILY_RATE_LIMITS: Record<
	string,
	{ requests: number; windowMs: number }
> = {
	strava: { requests: 800, windowMs: 24 * 60 * 60 * 1000 }, // reserve 20% of 1,000
};

/**
 * Check if a provider is currently rate-limited based on tracking data.
 * Returns true if requests in current window have reached the limit.
 */
export function isRateLimited(
	tracking: {
		requests_this_window: number | null;
		window_started_at: string | null;
	} | null,
	limit: { requests: number; windowMs: number },
): boolean {
	if (!tracking) return false;

	const windowStart = tracking.window_started_at
		? new Date(tracking.window_started_at).getTime()
		: Number.NaN;

	// Corrupt/missing timestamp -> treat as an expired/reset window (fail open
	// rather than relying on JavaScript date coercion of an invalid value).
	if (!Number.isFinite(windowStart)) return false;

	const now = Date.now();

	// Window expired, not rate limited
	if (now - windowStart > limit.windowMs) return false;

	// Within window, check count (missing count coerces to 0).
	return (tracking.requests_this_window ?? 0) >= limit.requests;
}
