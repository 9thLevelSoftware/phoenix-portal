import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { getCorsHeaders } from '../_shared/cors.ts';
import { requireSubscription } from '../_shared/requireSubscription.ts';
import { checkRateLimit } from '../_shared/rateLimit.ts';

// =============================================================================
// Response Types (matching src/queries/leaderboard.ts)
// =============================================================================

interface LeaderboardEntry {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  rank: number;
  value: number;
  percentile: number;
}

interface UserRanking {
  metric: string;
  rank: number;
  value: number;
  percentile: number;
  totalUsers: number;
}

interface GlobalLeaderboard {
  totalVolume: LeaderboardEntry[];
  workoutCount: LeaderboardEntry[];
  longestStreak: LeaderboardEntry[];
  currentStreak: LeaderboardEntry[];
  prCount: LeaderboardEntry[];
  exerciseMastery: LeaderboardEntry[];
}

interface WeeklyCompetition {
  id: string;
  metric: string;
  metricLabel: string;
  startDate: string;
  endDate: string;
  entries: LeaderboardEntry[];
  isSpecialEvent: boolean;
  eventName?: string;
}

// =============================================================================
// Request Types
// =============================================================================

interface GlobalRequest {
  type: 'global';
}

interface WeeklyRequest {
  type: 'weekly';
  weekStart?: string;
}

interface UserRequest {
  type: 'user';
  userId: string;
}

type RankingRequest = GlobalRequest | WeeklyRequest | UserRequest;

type SupabaseAnyClient = SupabaseClient<any, 'public', any>;

// =============================================================================
// Weekly Metric Rotation
// =============================================================================

const WEEKLY_METRICS = [
  { metric: 'total_volume_kg', label: 'Total Volume' },
  { metric: 'total_workouts', label: 'Workouts Completed' },
  { metric: 'pr_count', label: 'Phase-Aware Personal Records' },
  { metric: 'current_streak', label: 'Current Streak' },
] as const;

function getWeeklyMetric(weekStart: string): { metric: string; label: string } {
  // Get week number of the year for rotation
  const date = new Date(weekStart);
  const startOfYear = new Date(date.getFullYear(), 0, 1);
  const days = Math.floor((date.getTime() - startOfYear.getTime()) / (24 * 60 * 60 * 1000));
  const weekNumber = Math.ceil((days + startOfYear.getDay() + 1) / 7);
  const metricIndex = (weekNumber - 1) % WEEKLY_METRICS.length;
  return WEEKLY_METRICS[metricIndex];
}

/**
 * Snap a `YYYY-MM-DD` to the NEAREST Monday (UTC ISO week start): Sunday goes
 * forward one day, Tuesday to Thursday go back, Friday and Saturday go forward.
 * Older SPA builds sent the browser-local Monday shifted by the UTC offset
 * (a Sunday east of UTC, a Tuesday west of UTC), always within one day of the
 * intended Monday, so rounding to the nearest Monday recovers it.
 */
export function nearestUtcMonday(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  const dow = d.getUTCDay(); // 0 = Sunday ... 6 = Saturday
  const shift = dow === 0 ? 1 : dow <= 4 ? 1 - dow : 8 - dow;
  d.setUTCDate(d.getUTCDate() + shift);
  return d.toISOString().slice(0, 10);
}

function currentUtcMonday(now: Date = new Date()): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

// Week bounds, rotation, event lookup, id and the snapshot period all come
// from the same snapped Monday, so metadata and data cannot disagree.
function getWeekBounds(weekStart?: string): { start: string; end: string } {
  const start = weekStart ? nearestUtcMonday(weekStart) : currentUtcMonday();
  const endDate = new Date(`${start}T00:00:00Z`);
  endDate.setUTCDate(endDate.getUTCDate() + 6);
  return { start, end: endDate.toISOString().slice(0, 10) };
}

// Reasonable historical/future window for weekly leaderboards. Requests outside
// this range would force unbounded scans for weeks that cannot hold meaningful
// data, so we reject them rather than running the query.
const WEEK_START_MIN = new Date('2023-01-01T00:00:00Z').getTime();
const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Validate a client-supplied weekStart as an ISO `YYYY-MM-DD` date within an
 * allowed historical/future window. Returns the normalized date string or an
 * error message. fix(F314): previously fed straight into `new Date(weekStart)`,
 * where invalid strings threw a RangeError (generic 500) and arbitrary dates
 * could request unbounded windows.
 */
function validateWeekStart(weekStart: string): { ok: true; value: string } | { ok: false; error: string } {
  if (!ISO_DATE_REGEX.test(weekStart)) {
    return { ok: false, error: 'weekStart must be an ISO date in YYYY-MM-DD format' };
  }
  const parsed = new Date(`${weekStart}T00:00:00Z`);
  const ms = parsed.getTime();
  if (Number.isNaN(ms)) {
    return { ok: false, error: 'weekStart is not a valid date' };
  }
  // Allow up to 1 week into the future to tolerate client/server clock skew.
  const maxMs = Date.now() + 7 * 24 * 60 * 60 * 1000;
  if (ms < WEEK_START_MIN || ms > maxMs) {
    return { ok: false, error: 'weekStart is outside the allowed range' };
  }
  return { ok: true, value: weekStart };
}

// =============================================================================
// Helper Functions
// =============================================================================

function calculatePercentile(rank: number, total: number): number {
  if (total <= 1) return 100;
  return Math.round(((total - rank) / (total - 1)) * 100);
}

// =============================================================================
// Snapshot reads
//
// Rankings are served from `leaderboard_snapshots`, rebuilt every 15 minutes by
// pg_cron (`refresh_leaderboard_snapshots()`, migration 20260920005600). No
// request carries a list of participant ids: top-N reads are one bounded
// `.range()` page ordered by (rank, user_id), totals are head counts, and
// display fields come from the embedded `profiles` row. The `!inner` embed with
// `profiles.leaderboard_participation = true` hides a user who opted out after
// the last refresh.
// =============================================================================

const ALL_TIME = 'all_time';
const TOP_LIMIT = 100;

// excludeZero: before the snapshot, the global PR-count and mastery lists came
// from RPCs that return only users with a value above zero. The other global
// lists, and every weekly list, always included zero-valued participants. A
// user's own rank (user rankings) still counts zeros, tied at "users with a
// value + 1", as before.
const GLOBAL_METRICS = [
  { key: 'totalVolume', metric: 'total_volume_kg', excludeZero: false },
  { key: 'workoutCount', metric: 'total_workouts', excludeZero: false },
  { key: 'longestStreak', metric: 'longest_streak', excludeZero: false },
  { key: 'currentStreak', metric: 'current_streak', excludeZero: false },
  { key: 'prCount', metric: 'pr_count', excludeZero: true },
  { key: 'exerciseMastery', metric: 'exercise_mastery', excludeZero: true },
] as const;

// Weekly metrics snapshotted per ISO week (period = the week's Monday).
// current_streak is not a per-week value; it reads the all-time snapshot.
const WEEK_PERIOD_METRICS = new Set(['total_volume_kg', 'total_workouts', 'pr_count']);

interface SnapshotRow {
  user_id: string;
  metric?: string;
  value: number | string;
  rank: number | string;
  profiles?: { display_name: string | null; avatar_url: string | null } | null;
}

async function countSnapshotUsers(
  supabase: SupabaseAnyClient,
  metric: string,
  period: string,
): Promise<number> {
  const { count, error } = await supabase
    .from('leaderboard_snapshots')
    .select('user_id, profiles!inner(leaderboard_participation)', { count: 'exact', head: true })
    .eq('metric', metric)
    .eq('period', period)
    .eq('profiles.leaderboard_participation', true);

  if (error) {
    console.error('Failed to count leaderboard snapshot rows:', error);
    throw new Error('Failed to read leaderboard snapshot');
  }
  return count ?? 0;
}

async function readTopEntries(
  supabase: SupabaseAnyClient,
  metric: string,
  period: string,
  totalUsers: number,
  options: { excludeZero?: boolean } = {},
): Promise<LeaderboardEntry[]> {
  let query = supabase
    .from('leaderboard_snapshots')
    .select('user_id, value, rank, profiles!inner(display_name, avatar_url, leaderboard_participation)')
    .eq('metric', metric)
    .eq('period', period)
    .eq('profiles.leaderboard_participation', true);
  if (options.excludeZero) query = query.gt('value', 0);
  const { data, error } = await query
    .order('rank', { ascending: true })
    .order('user_id', { ascending: true })
    .range(0, TOP_LIMIT - 1);

  if (error) {
    console.error('Failed to read leaderboard snapshot:', error);
    throw new Error('Failed to read leaderboard snapshot');
  }

  return ((data ?? []) as unknown as SnapshotRow[]).map((row) => {
    const rank = Number(row.rank);
    return {
      userId: row.user_id,
      displayName: row.profiles?.display_name ?? 'Anonymous',
      avatarUrl: row.profiles?.avatar_url ?? null,
      rank,
      value: Number(row.value),
      percentile: calculatePercentile(rank, totalUsers),
    };
  });
}

// =============================================================================
// Handler
// =============================================================================

export interface ComputeRankingsAuthClient {
  auth: {
    getUser(): Promise<{ data: { user: { id: string } | null } | null; error: unknown }>;
  };
}

export interface ComputeRankingsDependencies {
  createAuthClient(authorization: string): ComputeRankingsAuthClient;
  createServiceClient(): SupabaseAnyClient;
}

function requireEnv(): { url: string; anonKey: string; serviceKey: string } {
  const url = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !anonKey || !serviceKey) {
    throw new Error('Missing required environment variables: SUPABASE_URL, SUPABASE_ANON_KEY, or SUPABASE_SERVICE_ROLE_KEY');
  }
  return { url, anonKey, serviceKey };
}

function defaultDependencies(): ComputeRankingsDependencies {
  return {
    createAuthClient(authorization: string) {
      const { url, anonKey } = requireEnv();
      return createClient(url, anonKey, {
        global: { headers: { Authorization: authorization } },
      }) as unknown as ComputeRankingsAuthClient;
    },
    createServiceClient() {
      const { url, serviceKey } = requireEnv();
      return createClient(url, serviceKey) as SupabaseAnyClient;
    },
  };
}

function json(body: unknown, status: number, cors: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

async function computeRankingsHandler(
  req: Request,
  deps: ComputeRankingsDependencies,
): Promise<Response> {
  const cors = getCorsHeaders(req);

  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors });
  }

  // POST only
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405, cors);
  }

  try {
    // =========================================================================
    // 1. Verify JWT auth for all ranking requests
    // =========================================================================
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return json({ error: 'Missing Authorization header' }, 401, cors);
    }

    const supabaseAuth = deps.createAuthClient(authHeader);
    const { data, error: authError } = await supabaseAuth.auth.getUser();
    const user = data?.user;

    if (authError || !user) {
      return json({ error: 'Not authenticated' }, 401, cors);
    }

    // =========================================================================
    // 2. Parse request body
    // =========================================================================
    let body: RankingRequest;
    try {
      body = await req.json();
    } catch {
      return json({ error: 'Invalid JSON body' }, 400, cors);
    }

    if (!body?.type || !['global', 'weekly', 'user'].includes(body.type)) {
      return json({ error: 'Invalid request type. Must be "global", "weekly", or "user".' }, 400, cors);
    }

    // =========================================================================
    // 3. Service-role client for DB operations (bypasses RLS)
    // =========================================================================
    const supabase = deps.createServiceClient();

    // Rate limit, keyed by request type so global/weekly/user share separate
    // budgets.
    const rateCheck = await checkRateLimit(
      supabase,
      {
        key: `compute-rankings:${body.type}`,
        userId: user.id,
        maxRequests: 30,
        windowSeconds: 60,
      },
      cors,
    );
    if (!rateCheck.allowed) return rateCheck.response!;

    const gate = await requireSubscription(supabase, user.id, 'FLAME', cors);
    if (!gate.allowed) return gate.response;

    if (body.type === 'user') {
      if (!body.userId) {
        return json({ error: 'userId is required for user rankings' }, 400, cors);
      }
      if (body.userId !== user.id) {
        const { data: targetProfile } = await supabase
          .from('profiles')
          .select('leaderboard_participation')
          .eq('user_id', body.userId)
          .maybeSingle();
        if (!targetProfile?.leaderboard_participation) {
          return json({ error: 'Forbidden' }, 403, cors);
        }
      }
    }

    // =========================================================================
    // 4. Handle each request type
    // =========================================================================
    if (body.type === 'global') {
      return json(await computeGlobalRankings(supabase), 200, cors);
    }

    if (body.type === 'weekly') {
      if (body.weekStart !== undefined) {
        const weekValidation = validateWeekStart(body.weekStart);
        if (!weekValidation.ok) {
          return json({ error: weekValidation.error }, 400, cors);
        }
      }
      return json(await computeWeeklyRankings(supabase, body.weekStart), 200, cors);
    }

    if (body.type === 'user') {
      return json(await computeUserRankings(supabase, body.userId), 200, cors);
    }

    return json({ error: 'Unknown request type' }, 400, cors);
  } catch (error) {
    console.error('compute-rankings error:', error);
    return json({ error: 'Internal server error' }, 500, cors);
  }
}

export function createComputeRankingsHandler(
  deps: ComputeRankingsDependencies = defaultDependencies(),
): (req: Request) => Promise<Response> {
  return (req) => computeRankingsHandler(req, deps);
}

if (import.meta.main) {
  Deno.serve(createComputeRankingsHandler());
}

// =============================================================================
// Global Rankings
// =============================================================================

async function computeGlobalRankings(supabase: SupabaseAnyClient): Promise<GlobalLeaderboard> {
  const totalUsers = await countSnapshotUsers(supabase, 'total_workouts', ALL_TIME);

  const lists = await Promise.all(
    GLOBAL_METRICS.map(({ metric, excludeZero }) =>
      readTopEntries(supabase, metric, ALL_TIME, totalUsers, { excludeZero })
    ),
  );

  const result = {} as GlobalLeaderboard;
  GLOBAL_METRICS.forEach(({ key }, index) => {
    result[key] = lists[index];
  });
  return result;
}

// =============================================================================
// Weekly Rankings
// =============================================================================

async function computeWeeklyRankings(
  supabase: SupabaseAnyClient,
  weekStart?: string
): Promise<WeeklyCompetition> {
  const { start, end } = getWeekBounds(weekStart);

  // Check for special events (prefer most recently started if overlapping)
  const { data: events, error: eventsError } = await supabase
    .from('leaderboard_events')
    .select('id, name, metric, metric_label, start_date, end_date')
    .lte('start_date', end)
    .gte('end_date', start)
    .eq('is_active', true)
    .order('start_date', { ascending: false })
    .limit(1);

  if (eventsError) {
    console.error('Failed to fetch leaderboard events:', eventsError);
    // Non-fatal: fall back to normal metric rotation
  }

  const event = events?.[0];
  const isSpecialEvent = !!event;
  const metricConfig = event
    ? { metric: event.metric, label: event.metric_label }
    : getWeeklyMetric(start);

  // fix(F316/F9): validate the active metric against the metrics this function
  // actually implements. A special event configured with an unsupported metric
  // would otherwise return event metadata with an empty entries list, making the
  // competition look like it has no participants. Surface a config error instead.
  const SUPPORTED_WEEKLY_METRICS = new Set([
    'total_volume_kg',
    'total_workouts',
    'pr_count',
    'current_streak',
  ]);
  if (!SUPPORTED_WEEKLY_METRICS.has(metricConfig.metric)) {
    console.error(
      'Unsupported weekly leaderboard metric configured:',
      metricConfig.metric,
      isSpecialEvent ? `(event ${event?.id})` : '(metric rotation)',
    );
    throw new Error(`Unsupported leaderboard metric: ${metricConfig.metric}`);
  }

  // Weekly snapshots are keyed by the UTC ISO-week Monday. A week the refresh
  // has not computed (future, or older than the 12 weeks kept) has no rows.
  const period = WEEK_PERIOD_METRICS.has(metricConfig.metric) ? start : ALL_TIME;
  const totalUsers = await countSnapshotUsers(supabase, metricConfig.metric, period);
  const entries = totalUsers === 0
    ? []
    : await readTopEntries(supabase, metricConfig.metric, period, totalUsers);

  return {
    id: event?.id ?? `week-${start}`,
    metric: metricConfig.metric,
    metricLabel: metricConfig.label,
    startDate: start,
    endDate: end,
    entries,
    isSpecialEvent,
    eventName: event?.name,
  };
}

// =============================================================================
// User Rankings
// =============================================================================

async function computeUserRankings(
  supabase: SupabaseAnyClient,
  targetUserId: string
): Promise<UserRanking[]> {
  const { data, error } = await supabase
    .from('leaderboard_snapshots')
    .select('metric, value, rank, profiles!inner(leaderboard_participation)')
    .eq('user_id', targetUserId)
    .eq('period', ALL_TIME)
    .eq('profiles.leaderboard_participation', true)
    .range(0, GLOBAL_METRICS.length - 1);

  if (error) {
    console.error('Failed to read user leaderboard snapshot:', error);
    throw new Error('Failed to read leaderboard snapshot');
  }

  const rows = (data ?? []) as unknown as SnapshotRow[];
  // Not a participant (or not in the snapshot yet): no rankings, as before.
  if (rows.length === 0) return [];

  const totalUsers = await countSnapshotUsers(supabase, 'total_workouts', ALL_TIME);
  const byMetric = new Map(rows.map((row) => [row.metric, row]));

  const rankings: UserRanking[] = [];
  for (const { key, metric } of GLOBAL_METRICS) {
    const row = byMetric.get(metric);
    if (!row) continue;
    const rank = Number(row.rank);
    rankings.push({
      metric: key,
      rank,
      value: Number(row.value),
      percentile: calculatePercentile(rank, totalUsers),
      totalUsers,
    });
  }
  return rankings;
}
