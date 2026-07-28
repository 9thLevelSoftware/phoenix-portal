/**
 * Provider rate-limit accounting.
 *
 * Providers report their own quota state on every response. Reading those
 * headers is strictly better than inferring usage locally: a local counter
 * cannot see requests made by another Edge Function instance, cannot see the
 * provider's own clock, and drifts permanently once the two disagree.
 *
 * Pure helpers live here so they can be tested from Vitest — see
 * src/lib/__tests__/provider-rate-limit.test.ts.
 */

// ─── Window boundaries ───────────────────────────────────────────────────────

/**
 * Strava resets its 15-minute window "at natural 15-minute intervals
 * corresponding to 0, 15, 30 and 45 minutes after the hour" — not 15 minutes
 * after whenever we happened to get throttled.
 */
export function startOfCurrentQuarterHour(now: Date = new Date()): string {
  const d = new Date(now.getTime());
  d.setUTCMinutes(Math.floor(d.getUTCMinutes() / 15) * 15, 0, 0);
  return d.toISOString();
}

/** Fitbit's per-user quota resets at the top of each hour. */
export function topOfCurrentHour(now: Date = new Date()): string {
  const d = new Date(now.getTime());
  d.setUTCMinutes(0, 0, 0);
  return d.toISOString();
}

/** Strava's daily quota resets at midnight UTC. */
export function startOfUtcDay(now: Date = new Date()): string {
  const d = new Date(now.getTime());
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

// ─── Header parsing ──────────────────────────────────────────────────────────

export interface RateLimitPair {
  /** Quota for the 15-minute window. */
  shortTerm: number | null;
  /** Quota for the rolling day. */
  daily: number | null;
}

export interface StravaRateLimitSnapshot {
  /** X-RateLimit-Limit / X-RateLimit-Usage — all request types. */
  overallLimit: RateLimitPair;
  overallUsage: RateLimitPair;
  /** X-ReadRateLimit-Limit / X-ReadRateLimit-Usage — read requests only. */
  readLimit: RateLimitPair;
  readUsage: RateLimitPair;
}

/**
 * Strava sends each quota header as two comma-separated integers:
 * "<15-minute value>,<daily value>". Missing or malformed headers yield nulls
 * rather than zeros — zero would read as "no quota consumed" and is dangerously
 * wrong in the permissive direction.
 */
export function parseRateLimitPair(value: string | null): RateLimitPair {
  if (!value) return { shortTerm: null, daily: null };

  const parts = value.split(',').map((part) => {
    const n = Number(part.trim());
    return Number.isFinite(n) ? n : null;
  });

  return { shortTerm: parts[0] ?? null, daily: parts[1] ?? null };
}

export function parseStravaRateLimitHeaders(
  headers: Headers,
): StravaRateLimitSnapshot {
  return {
    overallLimit: parseRateLimitPair(headers.get('x-ratelimit-limit')),
    overallUsage: parseRateLimitPair(headers.get('x-ratelimit-usage')),
    readLimit: parseRateLimitPair(headers.get('x-readratelimit-limit')),
    readUsage: parseRateLimitPair(headers.get('x-readratelimit-usage')),
  };
}

/**
 * Retry-After may be either delta-seconds or an HTTP date. Returns seconds from
 * now, floored at 0, or null when absent/unparseable.
 */
export function parseRetryAfterSeconds(
  headers: Headers,
  now: Date = new Date(),
): number | null {
  const raw = headers.get('retry-after');
  if (!raw) return null;

  const asSeconds = Number(raw.trim());
  if (Number.isFinite(asSeconds)) return Math.max(0, Math.round(asSeconds));

  const asDate = Date.parse(raw);
  if (Number.isFinite(asDate)) {
    return Math.max(0, Math.round((asDate - now.getTime()) / 1000));
  }
  return null;
}

// ─── Budget decisions ────────────────────────────────────────────────────────

export interface BudgetCheck {
  /** True when another request may be issued. */
  hasHeadroom: boolean;
  /** Requests left before the tighter of the two windows is exhausted. */
  remaining: number | null;
}

/**
 * Decide whether to keep paginating, given the provider's reported usage and a
 * reserve we decline to spend.
 *
 * `reserve` keeps a margin free so a long backfill for one user cannot consume
 * the entire application-wide budget and lock every other user out.
 */
export function checkReadBudget(
  snapshot: StravaRateLimitSnapshot,
  reserve = 0,
): BudgetCheck {
  // Prefer the read-specific quota; fall back to the overall quota when Strava
  // omits the read headers.
  const limit = snapshot.readLimit.shortTerm ?? snapshot.overallLimit.shortTerm;
  const usage = snapshot.readUsage.shortTerm ?? snapshot.overallUsage.shortTerm;
  const dailyLimit = snapshot.readLimit.daily ?? snapshot.overallLimit.daily;
  const dailyUsage = snapshot.readUsage.daily ?? snapshot.overallUsage.daily;

  const remainings: number[] = [];
  if (limit != null && usage != null) {
    remainings.push(limit - usage - reserve);
  }
  if (dailyLimit != null && dailyUsage != null) {
    remainings.push(dailyLimit - dailyUsage - reserve);
  }

  // No usable headers — defer to the caller's own page ceiling rather than
  // blocking, so a provider that stops sending headers does not halt syncing.
  if (remainings.length === 0) return { hasHeadroom: true, remaining: null };

  const remaining = Math.min(...remainings);
  return { hasHeadroom: remaining > 0, remaining };
}

// ─── Persistence ─────────────────────────────────────────────────────────────

/** Suffix for the companion row tracking a provider's daily quota. */
export const DAILY_KEY_SUFFIX = ':daily';

export function dailyRateLimitKey(provider: string): string {
  return `${provider}${DAILY_KEY_SUFFIX}`;
}

// deno-lint-ignore no-explicit-any
type DbClient = any;

/**
 * Upsert a rate-limit tracking row keyed (key, user_id).
 *
 * `userId` is null for application-scoped quotas, matching the
 * `uq_rate_limit_key_user` index which collapses NULL onto the zero UUID.
 */
export async function upsertRateLimitRow(
  supabase: DbClient,
  key: string,
  userId: string | null,
  fields: Record<string, unknown>,
): Promise<void> {
  let query = supabase.from('rate_limit_tracking').select('id').eq('key', key);
  query = userId === null ? query.is('user_id', null) : query.eq('user_id', userId);

  const { data: existing } = await query.maybeSingle();

  if (!existing) {
    await supabase.from('rate_limit_tracking').insert({
      key,
      // `provider` predates `key` and is still NOT NULL on some environments;
      // strip any window suffix so it stays a real provider name.
      provider: key.replace(DAILY_KEY_SUFFIX, ''),
      user_id: userId,
      requests_this_window: 0,
      window_started_at: new Date().toISOString(),
      ...fields,
    });
  } else {
    await supabase
      .from('rate_limit_tracking')
      .update(fields)
      .eq('id', existing.id);
  }
}

/**
 * Persist Strava's reported usage into both the 15-minute and daily buckets.
 *
 * Writes the provider's own numbers rather than a locally incremented counter,
 * so concurrent Edge Function instances converge on the truth instead of each
 * keeping a partial tally.
 */
export async function recordStravaUsage(
  supabase: DbClient,
  snapshot: StravaRateLimitSnapshot,
  now: Date = new Date(),
): Promise<void> {
  const nowIso = now.toISOString();

  const shortTermUsage =
    snapshot.readUsage.shortTerm ?? snapshot.overallUsage.shortTerm;
  if (shortTermUsage != null) {
    await upsertRateLimitRow(supabase, 'strava', null, {
      requests_this_window: shortTermUsage,
      window_started_at: startOfCurrentQuarterHour(now),
      last_request_at: nowIso,
    });
  }

  const dailyUsage = snapshot.readUsage.daily ?? snapshot.overallUsage.daily;
  if (dailyUsage != null) {
    await upsertRateLimitRow(supabase, dailyRateLimitKey('strava'), null, {
      requests_this_window: dailyUsage,
      window_started_at: startOfUtcDay(now),
      last_request_at: nowIso,
    });
  }
}
