import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { getCorsHeaders } from '../_shared/cors.ts';

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
  { metric: 'total_volume_kg', label: 'Total Volume (kg)' },
  { metric: 'total_workouts', label: 'Workouts Completed' },
  { metric: 'pr_count', label: 'Personal Records' },
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

function getWeekBounds(weekStart?: string): { start: string; end: string } {
  const startDate = weekStart ? new Date(weekStart) : getMonday(new Date());
  const endDate = new Date(startDate);
  endDate.setDate(endDate.getDate() + 6);
  endDate.setHours(23, 59, 59, 999);

  return {
    start: startDate.toISOString().split('T')[0],
    end: endDate.toISOString().split('T')[0],
  };
}

function getMonday(date: Date): Date {
  const day = date.getDay();
  const diff = date.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(date.setDate(diff));
}

// =============================================================================
// Helper Functions
// =============================================================================

function calculatePercentile(rank: number, total: number): number {
  if (total <= 1) return 100;
  return Math.round(((total - rank) / (total - 1)) * 100);
}

// =============================================================================
// Handler
// =============================================================================

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);

  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors });
  }

  // POST only
  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({ error: 'Method not allowed' }),
      { status: 405, headers: { ...cors, 'Content-Type': 'application/json' } }
    );
  }

  try {
    // =========================================================================
    // 1. Verify JWT auth for all ranking requests
    // =========================================================================
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Missing Authorization header' }),
        { status: 401, headers: { ...cors, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceKey) {
      throw new Error('Missing required environment variables: SUPABASE_URL, SUPABASE_ANON_KEY, or SUPABASE_SERVICE_ROLE_KEY');
    }

    const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data, error: authError } = await supabaseAuth.auth.getUser();
    const user = data?.user;

    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'Not authenticated' }),
        { status: 401, headers: { ...cors, 'Content-Type': 'application/json' } }
      );
    }

    // =========================================================================
    // 2. Parse request body
    // =========================================================================
    let body: RankingRequest;
    try {
      body = await req.json();
    } catch {
      return new Response(
        JSON.stringify({ error: 'Invalid JSON body' }),
        { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } }
      );
    }

    if (!body.type || !['global', 'weekly', 'user'].includes(body.type)) {
      return new Response(
        JSON.stringify({ error: 'Invalid request type. Must be "global", "weekly", or "user".' }),
        { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } }
      );
    }

    // =========================================================================
    // 3. Service-role client for DB operations (bypasses RLS)
    // =========================================================================
    const supabase = createClient(supabaseUrl, supabaseServiceKey) as SupabaseAnyClient;

    // =========================================================================
    // 4. Handle each request type
    // =========================================================================
    if (body.type === 'global') {
      const result = await computeGlobalRankings(supabase);
      return new Response(
        JSON.stringify(result),
        { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } }
      );
    }

    if (body.type === 'weekly') {
      const result = await computeWeeklyRankings(supabase, body.weekStart);
      return new Response(
        JSON.stringify(result),
        { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } }
      );
    }

    if (body.type === 'user') {
      if (!body.userId) {
        return new Response(
          JSON.stringify({ error: 'userId is required for user rankings' }),
          { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } }
        );
      }

      if (body.userId !== user.id) {
        return new Response(
          JSON.stringify({ error: 'Forbidden: cannot access rankings for another user' }),
          { status: 403, headers: { ...cors, 'Content-Type': 'application/json' } }
        );
      }

      const result = await computeUserRankings(supabase, body.userId);
      return new Response(
        JSON.stringify(result),
        { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ error: 'Unknown request type' }),
      { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('compute-rankings error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } }
    );
  }
});

// =============================================================================
// Global Rankings
// =============================================================================

async function computeGlobalRankings(supabase: SupabaseAnyClient): Promise<GlobalLeaderboard> {
  const LIMIT = 100;

  // Get eligible users (leaderboard_participation = true)
  const { data: eligibleProfiles, error: profilesError } = await supabase
    .from('profiles')
    .select('id, display_name, avatar_url, user_id')
    .eq('leaderboard_participation', true);

  if (profilesError) {
    console.error('Failed to fetch profiles:', profilesError);
    throw new Error('Failed to fetch leaderboard profiles');
  }

  const eligibleUserIds = (eligibleProfiles ?? []).map(p => p.user_id).filter(Boolean) as string[];
  const profilesByUserId = new Map(
    (eligibleProfiles ?? []).map(p => [p.user_id, p])
  );

  if (eligibleUserIds.length === 0) {
    return {
      totalVolume: [],
      workoutCount: [],
      longestStreak: [],
      currentStreak: [],
      prCount: [],
      exerciseMastery: [],
    };
  }

  // Query gamification_stats for volume, workouts, streaks
  const { data: stats, error: statsError } = await supabase
    .from('gamification_stats')
    .select('user_id, total_volume_kg, total_workouts, longest_streak, current_streak')
    .in('user_id', eligibleUserIds);

  if (statsError) {
    console.error('Failed to fetch gamification stats:', statsError);
    throw new Error('Failed to fetch leaderboard stats');
  }

  const statsMap = new Map((stats ?? []).map(s => [s.user_id, s]));

  // Query PR counts via database function
  const { data: prRankings, error: prError } = await supabase.rpc('get_pr_count_rankings', {
    result_limit: LIMIT,
  });

  if (prError) {
    console.error('Failed to fetch PR rankings:', prError);
    throw new Error('Failed to compute PR rankings');
  }

  // Query exercise mastery via database function
  const { data: masteryRankings, error: masteryError } = await supabase.rpc('get_exercise_mastery_rankings', {
    result_limit: LIMIT,
  });

  if (masteryError) {
    console.error('Failed to fetch mastery rankings:', masteryError);
    throw new Error('Failed to compute mastery rankings');
  }

  // Build total volume rankings
  const volumeRanked = buildRankings(
    eligibleUserIds,
    (userId) => statsMap.get(userId)?.total_volume_kg ?? 0,
    profilesByUserId,
    LIMIT
  );

  // Build workout count rankings
  const workoutRanked = buildRankings(
    eligibleUserIds,
    (userId) => statsMap.get(userId)?.total_workouts ?? 0,
    profilesByUserId,
    LIMIT
  );

  // Build longest streak rankings
  const longestStreakRanked = buildRankings(
    eligibleUserIds,
    (userId) => statsMap.get(userId)?.longest_streak ?? 0,
    profilesByUserId,
    LIMIT
  );

  // Build current streak rankings
  const currentStreakRanked = buildRankings(
    eligibleUserIds,
    (userId) => statsMap.get(userId)?.current_streak ?? 0,
    profilesByUserId,
    LIMIT
  );

  // Build PR count rankings from RPC result
  const prCountRanked = buildRankingsFromRpc(
    prRankings ?? [],
    profilesByUserId,
    eligibleUserIds.length
  );

  // Build exercise mastery rankings from RPC result
  const exerciseMasteryRanked = buildRankingsFromRpc(
    masteryRankings ?? [],
    profilesByUserId,
    eligibleUserIds.length
  );

  return {
    totalVolume: volumeRanked,
    workoutCount: workoutRanked,
    longestStreak: longestStreakRanked,
    currentStreak: currentStreakRanked,
    prCount: prCountRanked,
    exerciseMastery: exerciseMasteryRanked,
  };
}

// =============================================================================
// Weekly Rankings
// =============================================================================

async function computeWeeklyRankings(
  supabase: SupabaseAnyClient,
  weekStart?: string
): Promise<WeeklyCompetition> {
  const LIMIT = 100;
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

  // Get eligible users
  const { data: eligibleProfiles } = await supabase
    .from('profiles')
    .select('id, display_name, avatar_url, user_id')
    .eq('leaderboard_participation', true);

  const eligibleUserIds = (eligibleProfiles ?? []).map(p => p.user_id).filter(Boolean) as string[];
  const profilesByUserId = new Map(
    (eligibleProfiles ?? []).map(p => [p.user_id, p])
  );

  if (eligibleUserIds.length === 0) {
    return {
      id: `week-${start}`,
      metric: metricConfig.metric,
      metricLabel: metricConfig.label,
      startDate: start,
      endDate: end,
      entries: [],
      isSpecialEvent,
      eventName: event?.name,
    };
  }

  let entries: LeaderboardEntry[] = [];

  // Compute weekly values based on metric
  if (metricConfig.metric === 'total_volume_kg' || metricConfig.metric === 'total_workouts') {
    // Aggregate from workout_sessions within the week
    const { data: sessions } = await supabase
      .from('workout_sessions')
      .select('user_id, total_volume, started_at')
      .in('user_id', eligibleUserIds)
      .gte('started_at', `${start}T00:00:00Z`)
      .lte('started_at', `${end}T23:59:59Z`);

    const weeklyStats = new Map<string, { volume: number; count: number }>();
    for (const session of sessions ?? []) {
      const existing = weeklyStats.get(session.user_id) ?? { volume: 0, count: 0 };
      weeklyStats.set(session.user_id, {
        volume: existing.volume + (session.total_volume ?? 0),
        count: existing.count + 1,
      });
    }

    const valueGetter = metricConfig.metric === 'total_volume_kg'
      ? (userId: string) => weeklyStats.get(userId)?.volume ?? 0
      : (userId: string) => weeklyStats.get(userId)?.count ?? 0;

    entries = buildRankings(eligibleUserIds, valueGetter, profilesByUserId, LIMIT);
  } else if (metricConfig.metric === 'pr_count') {
    // Count PRs achieved during the week
    const { data: prs } = await supabase
      .from('personal_records')
      .select('user_id')
      .in('user_id', eligibleUserIds)
      .gte('achieved_at', `${start}T00:00:00Z`)
      .lte('achieved_at', `${end}T23:59:59Z`);

    const prCounts = new Map<string, number>();
    for (const pr of prs ?? []) {
      prCounts.set(pr.user_id, (prCounts.get(pr.user_id) ?? 0) + 1);
    }

    entries = buildRankings(
      eligibleUserIds,
      (userId) => prCounts.get(userId) ?? 0,
      profilesByUserId,
      LIMIT
    );
  } else if (metricConfig.metric === 'current_streak') {
    // Use current gamification_stats streak values
    const { data: stats } = await supabase
      .from('gamification_stats')
      .select('user_id, current_streak')
      .in('user_id', eligibleUserIds);

    const statsMap = new Map((stats ?? []).map(s => [s.user_id, s]));
    entries = buildRankings(
      eligibleUserIds,
      (userId) => statsMap.get(userId)?.current_streak ?? 0,
      profilesByUserId,
      LIMIT
    );
  }

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
  // Get all eligible users
  const { data: eligibleProfiles } = await supabase
    .from('profiles')
    .select('user_id')
    .eq('leaderboard_participation', true);

  const eligibleUserIds = (eligibleProfiles ?? []).map(p => p.user_id).filter(Boolean) as string[];
  const totalUsers = eligibleUserIds.length;

  if (totalUsers === 0 || !eligibleUserIds.includes(targetUserId)) {
    return [];
  }

  // Get gamification stats for all eligible users
  const { data: stats } = await supabase
    .from('gamification_stats')
    .select('user_id, total_volume_kg, total_workouts, longest_streak, current_streak')
    .in('user_id', eligibleUserIds);

  const statsMap = new Map((stats ?? []).map(s => [s.user_id, s]));
  const userStats = statsMap.get(targetUserId);

  const rankings: UserRanking[] = [];

  // Total Volume ranking
  const volumeValues = eligibleUserIds.map(id => statsMap.get(id)?.total_volume_kg ?? 0);
  const volumeRank = calculateRank(userStats?.total_volume_kg ?? 0, volumeValues);
  rankings.push({
    metric: 'totalVolume',
    rank: volumeRank,
    value: userStats?.total_volume_kg ?? 0,
    percentile: calculatePercentile(volumeRank, totalUsers),
    totalUsers,
  });

  // Workout Count ranking
  const workoutValues = eligibleUserIds.map(id => statsMap.get(id)?.total_workouts ?? 0);
  const workoutRank = calculateRank(userStats?.total_workouts ?? 0, workoutValues);
  rankings.push({
    metric: 'workoutCount',
    rank: workoutRank,
    value: userStats?.total_workouts ?? 0,
    percentile: calculatePercentile(workoutRank, totalUsers),
    totalUsers,
  });

  // Longest Streak ranking
  const longestStreakValues = eligibleUserIds.map(id => statsMap.get(id)?.longest_streak ?? 0);
  const longestStreakRank = calculateRank(userStats?.longest_streak ?? 0, longestStreakValues);
  rankings.push({
    metric: 'longestStreak',
    rank: longestStreakRank,
    value: userStats?.longest_streak ?? 0,
    percentile: calculatePercentile(longestStreakRank, totalUsers),
    totalUsers,
  });

  // Current Streak ranking
  const currentStreakValues = eligibleUserIds.map(id => statsMap.get(id)?.current_streak ?? 0);
  const currentStreakRank = calculateRank(userStats?.current_streak ?? 0, currentStreakValues);
  rankings.push({
    metric: 'currentStreak',
    rank: currentStreakRank,
    value: userStats?.current_streak ?? 0,
    percentile: calculatePercentile(currentStreakRank, totalUsers),
    totalUsers,
  });

  // PR Count ranking (via RPC)
  const { data: prRank } = await supabase.rpc('get_user_pr_rank', {
    target_user_id: targetUserId,
  });

  if (prRank && prRank.length > 0) {
    const pr = prRank[0];
    rankings.push({
      metric: 'prCount',
      rank: pr.rank,
      value: pr.pr_count,
      percentile: calculatePercentile(pr.rank, totalUsers),
      totalUsers,
    });
  } else {
    // User has 0 PRs. Get count of users with >0 PRs from RPC (already called for global rankings)
    const { data: allPrUsers } = await supabase.rpc('get_pr_count_rankings', {
      result_limit: totalUsers,
    });
    // All 0-PR users are tied at rank = (users with PRs) + 1
    const usersWithPRs = (allPrUsers ?? []).length;
    const zeroRank = usersWithPRs + 1;

    rankings.push({
      metric: 'prCount',
      rank: zeroRank,
      value: 0,
      percentile: calculatePercentile(zeroRank, totalUsers),
      totalUsers,
    });
  }

  // Exercise Mastery ranking
  // Count distinct exercises with 10+ sessions for the user
  // Must match RPC logic: COUNT(DISTINCT session_id) >= 10
  const { data: masteryData, error: masteryQueryError } = await supabase
    .from('exercises')
    .select('name, session_id')
    .eq('user_id', targetUserId);

  if (masteryQueryError) {
    console.error('Failed to fetch user exercise data:', masteryQueryError);
  }

  // Group by exercise name, count distinct sessions
  const exerciseSessionMap = new Map<string, Set<string>>();
  for (const ex of masteryData ?? []) {
    if (!exerciseSessionMap.has(ex.name)) {
      exerciseSessionMap.set(ex.name, new Set());
    }
    exerciseSessionMap.get(ex.name)!.add(ex.session_id);
  }
  const masteredCount = [...exerciseSessionMap.values()].filter(sessions => sessions.size >= 10).length;

  // Get all users' mastery for ranking
  const { data: allMasteryData } = await supabase.rpc('get_exercise_mastery_rankings', {
    result_limit: totalUsers,
  });

  const masteryValues = (allMasteryData ?? []).map((m: { mastered_count: number }) => m.mastered_count);
  // Users with 0 mastery rank after all users with positive mastery
  const usersWithMastery = masteryValues.length;
  const masteryRank = masteredCount > 0
    ? calculateRank(masteredCount, masteryValues)
    : usersWithMastery + 1;

  rankings.push({
    metric: 'exerciseMastery',
    rank: masteryRank,
    value: masteredCount,
    percentile: calculatePercentile(masteryRank, totalUsers),
    totalUsers,
  });

  return rankings;
}

// =============================================================================
// Utility Functions
// =============================================================================

function buildRankings(
  userIds: string[],
  valueGetter: (userId: string) => number,
  profilesMap: Map<string, { id: string; display_name: string | null; avatar_url: string | null; user_id: string | null }>,
  limit: number
): LeaderboardEntry[] {
  const entries = userIds.map(userId => ({
    userId,
    value: valueGetter(userId),
    profile: profilesMap.get(userId),
  }));

  // Sort by value descending
  entries.sort((a, b) => b.value - a.value);

  const total = entries.length;
  const limitedEntries = entries.slice(0, limit);

  // Calculate ranks with tie handling (like SQL RANK())
  let currentRank = 1;
  let previousValue: number | null = null;

  return limitedEntries.map((entry, index) => {
    // If this value differs from the previous, update rank to current position + 1
    if (previousValue !== null && entry.value !== previousValue) {
      currentRank = index + 1;
    }
    previousValue = entry.value;

    return {
      userId: entry.userId,
      displayName: entry.profile?.display_name ?? 'Anonymous',
      avatarUrl: entry.profile?.avatar_url ?? null,
      rank: currentRank,
      value: entry.value,
      percentile: calculatePercentile(currentRank, total),
    };
  });
}

function buildRankingsFromRpc(
  rpcResults: Array<{ user_id: string; rank?: number; [key: string]: unknown }>,
  profilesMap: Map<string, { id: string; display_name: string | null; avatar_url: string | null; user_id: string | null }>,
  totalEligible: number
): LeaderboardEntry[] {
  // RPC results are already ordered and limited
  // Get the value field (pr_count or mastered_count)
  return rpcResults.map((result) => {
    const profile = profilesMap.get(result.user_id);
    const value = (result.pr_count ?? result.mastered_count ?? 0) as number;
    // Use SQL RANK() from RPC, preserving ties
    const rank = (result.rank as number) ?? 1;
    return {
      userId: result.user_id,
      displayName: profile?.display_name ?? 'Anonymous',
      avatarUrl: profile?.avatar_url ?? null,
      rank,
      value,
      percentile: calculatePercentile(rank, totalEligible),
    };
  });
}

function calculateRank(value: number, allValues: number[]): number {
  // Count how many values are greater than the target value
  const higher = allValues.filter(v => v > value).length;
  return higher + 1;
}
