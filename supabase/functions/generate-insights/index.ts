import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { getCorsHeaders } from '../_shared/cors.ts';
import { type EnvReader, hasValidCronSecret } from '../_shared/cronSecret.ts';
import {
  formatPersonalRecordName,
  generateInsights,
  type InsightInput,
  normalizeWeightUnit,
  type TrainingInsight,
  type WeightUnit,
} from '../_shared/insightRules.ts';
import { checkRateLimit } from '../_shared/rateLimit.ts';
import { requireSubscription } from '../_shared/requireSubscription.ts';

/**
 * generate-insights has exactly TWO authentication modes (KD-14):
 *
 *  1. Scheduled batch — `POST {mode:'batch', cursor?}` with the shared
 *     `x-cron-secret` header and no user JWT. pg_cron calls it every 15
 *     minutes through `private.invoke_edge_function` (PR 31 / KD-10). It
 *     refreshes cached insights for active FLAME/INFERNO users, 25 per pass,
 *     keyset-paged by user_id.
 *  2. User request — a user JWT, gated at FLAME by `requireSubscription`
 *     (F-010). The user id comes from the JWT only; a body-supplied id is
 *     ignored.
 *
 * `verify_jwt = false` in config.toml because mode 1 carries no JWT; mode 2
 * still verifies in the handler via `auth.getUser()`. A user JWT can never
 * reach the batch path, and the cron secret can never reach the user path.
 *
 * The rule engine itself is `_shared/insightRules.ts`, shared verbatim with
 * the browser fallback (src/lib/insights.ts) so the two can never contradict
 * each other.
 */

/** Loose client type: `ReturnType<typeof createClient>` collapses to `never`. */
// deno-lint-ignore no-explicit-any
type DbClient = SupabaseClient<any, any, any>;

/** Users refreshed per scheduled pass. */
export const BATCH_SIZE = 25;

/** The only period the scheduled pass computes. */
export const BATCH_PERIOD = '30d';

const PERIOD_DAYS: Record<string, number> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
  '1y': 365,
  'all': 3650,
};

// ── RTL calculator (duplicate of src/lib/training-load.ts) ──────────────────

function calculateRTL(
  sessions: Array<{ totalVolume: number; setCount: number }>,
): number {
  if (sessions.length === 0) return 0;

  const totalVolume = sessions.reduce((sum, s) => sum + s.totalVolume, 0);
  const totalSets = sessions.reduce((sum, s) => sum + s.setCount, 0);

  const volumeScore = Math.min(33, (totalVolume / 20000) * 33);
  const avgVolumePerSet = totalSets > 0 ? totalVolume / totalSets : 0;
  const intensityScore = Math.min(33, (avgVolumePerSet / 400) * 33);
  const frequencyScore = Math.min(34, (sessions.length / 5) * 34);

  return Math.min(100, Math.round(volumeScore + intensityScore + frequencyScore));
}

// ── Dependencies ─────────────────────────────────────────────────────────────

export interface GenerateInsightsDependencies {
  /** Environment lookup (Deno.env.get in production). */
  env: EnvReader;
  /** Service-role client factory. */
  createAdminClient: (url: string, serviceRoleKey: string) => DbClient;
  /** Anon client carrying the caller's Authorization header. */
  createUserClient: (
    url: string,
    anonKey: string,
    authHeader: string,
  ) => DbClient;
  /** Clock, so tests can pin the period windows. */
  now: () => Date;
}

function defaultDependencies(): GenerateInsightsDependencies {
  return {
    env: (key) => Deno.env.get(key),
    createAdminClient: (url, key) => createClient(url, key),
    createUserClient: (url, anonKey, authHeader) =>
      createClient(url, anonKey, {
        global: { headers: { Authorization: authHeader } },
      }),
    now: () => new Date(),
  };
}

// ── Insight computation for one user ─────────────────────────────────────────

/** Everything the rules need, gathered with the service role for one user. */
async function buildInsightsForUser(
  supabaseAdmin: DbClient,
  userId: string,
  period: string,
  now: Date,
): Promise<
  | { ok: true; insights: TrainingInsight[] }
  | { ok: false; reason: string }
> {
  const periodDays = PERIOD_DAYS[period];
  const currentStart = new Date(now.getTime() - periodDays * 86400_000);
  const previousStart = new Date(currentStart.getTime() - periodDays * 86400_000);

  const { data: profile, error: profileError } = await supabaseAdmin
    .from('profiles')
    .select('weight_unit')
    .eq('user_id', userId)
    .maybeSingle();

  if (profileError) {
    console.warn('Failed to fetch profile weight unit; defaulting to kg:', profileError);
  }

  const weightUnit: WeightUnit = normalizeWeightUnit(profile?.weight_unit);

  // ── 1. Workout sessions (current + previous period) ───────────────────────
  const { data: allSessions, error: sessionsError } = await supabaseAdmin
    .from('workout_sessions')
    .select('id, started_at, total_volume, set_count')
    .eq('user_id', userId)
    .gte('started_at', previousStart.toISOString())
    .order('started_at', { ascending: true });

  if (sessionsError) {
    console.error('Failed to fetch workout sessions:', sessionsError);
    return { ok: false, reason: 'workout_sessions' };
  }

  const sessions = allSessions ?? [];
  const currentSessions = sessions.filter(
    (s: Record<string, string>) => new Date(s.started_at) >= currentStart,
  );
  const previousSessions = sessions.filter(
    (s: Record<string, string>) =>
      new Date(s.started_at) >= previousStart &&
      new Date(s.started_at) < currentStart,
  );

  const currentVolume = currentSessions.reduce(
    (sum: number, s: Record<string, number>) => sum + (s.total_volume ?? 0),
    0,
  );
  const previousVolume = previousSessions.reduce(
    (sum: number, s: Record<string, number>) => sum + (s.total_volume ?? 0),
    0,
  );

  const avgSessionsPerWeek =
    periodDays > 0 ? (currentSessions.length / periodDays) * 7 : 0;

  // ── 2. Muscle group distribution ──────────────────────────────────────────
  // Chunk session IDs into batches of 200 to stay within PostgREST URL limits
  // (~8 KB). A single unbounded .in() call on thousands of IDs exceeds the
  // limit for users with long 'all'-period histories (M-21).
  const MUSCLE_GROUP_CHUNK_SIZE = 200;
  const currentSessionIds = currentSessions.map(
    (s: Record<string, string>) => s.id,
  );
  const muscleGroups: Record<string, number> = {};

  if (currentSessionIds.length > 0) {
    const allExerciseRows: Array<{ muscle_group: string | null }> = [];

    for (let i = 0; i < currentSessionIds.length; i += MUSCLE_GROUP_CHUNK_SIZE) {
      const chunk = currentSessionIds.slice(i, i + MUSCLE_GROUP_CHUNK_SIZE);
      const { data: chunkRows, error: chunkError } = await supabaseAdmin
        .from('exercises')
        .select('muscle_group')
        .in('session_id', chunk);

      if (chunkError) {
        console.error('Failed to fetch exercise rows:', chunkError);
        return { ok: false, reason: 'exercises' };
      }

      if (chunkRows) {
        allExerciseRows.push(...chunkRows);
      }
    }

    if (allExerciseRows.length > 0) {
      const groupCounts: Record<string, number> = {};
      for (const row of allExerciseRows) {
        const group = row.muscle_group ?? 'General';
        groupCounts[group] = (groupCounts[group] ?? 0) + 1;
      }
      const total = allExerciseRows.length;
      for (const [group, count] of Object.entries(groupCounts)) {
        muscleGroups[group] = Math.round((count / total) * 100);
      }
    }
  }

  // ── 3. Recent personal records ────────────────────────────────────────────
  const { data: prRows, error: prRowsError } = await supabaseAdmin
    .from('personal_records')
    .select('exercise_name, record_type, workout_phase, value, previous_value')
    .eq('user_id', userId)
    .is('deleted_at', null)
    .gte('achieved_at', currentStart.toISOString())
    .order('achieved_at', { ascending: false });

  if (prRowsError) {
    console.error('Failed to fetch personal records:', prRowsError);
    return { ok: false, reason: 'personal_records' };
  }

  const recentPRs = (prRows ?? []).map((r) => ({
    exercise: r.exercise_name as string,
    displayName: formatPersonalRecordName(
      r.exercise_name,
      r.record_type,
      r.workout_phase,
    ),
    recordType: r.record_type as string | null,
    // PR values are stored per-cable (raw DB values); the display layer
    // applies the 2x cable multiplier. Do NOT multiply here (M-22).
    value: r.value as number,
    previousValue:
      r.previous_value !== null && r.previous_value !== undefined
        ? (r.previous_value as number)
        : undefined,
  }));

  // ── 4. Plateau detection (exercise_progress: 1RM flat for 3+ weeks) ───────
  const threeWeeksAgo = new Date(now.getTime() - 21 * 86400_000);
  const { data: progressRows, error: progressRowsError } = await supabaseAdmin
    .from('exercise_progress')
    .select('exercise_name, estimated_1rm_kg, recorded_at')
    .eq('user_id', userId)
    .gte('recorded_at', threeWeeksAgo.toISOString())
    .order('recorded_at', { ascending: true });

  if (progressRowsError) {
    console.error('Failed to fetch exercise progress:', progressRowsError);
    return { ok: false, reason: 'exercise_progress' };
  }

  const plateauExercises: string[] = [];
  if (progressRows && progressRows.length > 0) {
    // Group by exercise name
    const byExercise: Record<
      string,
      Array<{ estimated_1rm_kg: number; recorded_at: string }>
    > = {};
    for (const row of progressRows) {
      const name = row.exercise_name;
      if (!byExercise[name]) byExercise[name] = [];
      byExercise[name].push(row);
    }

    for (const [exerciseName, entries] of Object.entries(byExercise)) {
      if (entries.length < 3) continue;

      // Check if all entries span at least 3 distinct weeks with no 1RM improvement
      const weeks = new Set(
        entries.map((e) => {
          const d = new Date(e.recorded_at);
          // ISO week approximation: floor to Monday of that week
          const day = d.getDay(); // 0=Sun
          const diff = (day === 0 ? -6 : 1) - day;
          const monday = new Date(d);
          monday.setDate(d.getDate() + diff);
          return monday.toISOString().slice(0, 10);
        }),
      );

      if (weeks.size < 3) continue;

      const maxRM = Math.max(...entries.map((e) => e.estimated_1rm_kg));
      const minRM = Math.min(...entries.map((e) => e.estimated_1rm_kg));
      // Plateau = less than 1% variance across 3+ weeks
      const variance = maxRM > 0 ? (maxRM - minRM) / maxRM : 0;
      if (variance < 0.01) {
        plateauExercises.push(exerciseName);
      }
    }
  }

  // ── 5. Streak calculation ─────────────────────────────────────────────────
  // Pull all distinct workout days in the last 90 days, sorted descending
  const ninetyDaysAgo = new Date(now.getTime() - 90 * 86400_000);
  const { data: streakSessions, error: streakSessionsError } = await supabaseAdmin
    .from('workout_sessions')
    .select('started_at')
    .eq('user_id', userId)
    .gte('started_at', ninetyDaysAgo.toISOString())
    .order('started_at', { ascending: false });

  if (streakSessionsError) {
    console.error('Failed to fetch streak sessions:', streakSessionsError);
    return { ok: false, reason: 'streak_sessions' };
  }

  let currentStreak = 0;
  let bestStreak = 0;

  if (streakSessions && streakSessions.length > 0) {
    // Build a Set of unique date strings (YYYY-MM-DD)
    const workoutDays = new Set<string>(
      streakSessions.map((s: Record<string, string>) => s.started_at.slice(0, 10)),
    );

    // Current streak: count backwards from today
    let streak = 0;
    const cursor = new Date(now);
    while (true) {
      const dateKey = cursor.toISOString().slice(0, 10);
      if (workoutDays.has(dateKey)) {
        streak++;
        cursor.setDate(cursor.getDate() - 1);
      } else {
        break;
      }
    }
    currentStreak = streak;

    // Best streak within the window
    const sortedDays = [...workoutDays].sort();
    let runStreak = 0;
    let prevDate: Date | null = null;
    for (const dateStr of sortedDays) {
      const d = new Date(dateStr);
      if (prevDate !== null) {
        const diff = (d.getTime() - prevDate.getTime()) / 86400_000;
        if (Math.round(diff) === 1) {
          runStreak++;
        } else {
          runStreak = 1;
        }
      } else {
        runStreak = 1;
      }
      bestStreak = Math.max(bestStreak, runStreak);
      prevDate = d;
    }
  }

  // ── 6. Training load score (RTL) ──────────────────────────────────────────
  const trainingLoadScore = calculateRTL(
    currentSessions.map((s: Record<string, number>) => ({
      totalVolume: s.total_volume ?? 0,
      setCount: s.set_count ?? 0,
    })),
  );

  // ── 7. Assemble InsightInput and apply the shared rules ───────────────────
  const insightInput: InsightInput = {
    currentVolume,
    previousVolume,
    muscleGroups,
    avgSessionsPerWeek,
    currentStreak,
    bestStreak,
    recentPRs,
    plateauExercises,
    trainingLoadScore,
  };

  return { ok: true, insights: generateInsights(insightInput, weightUnit) };
}

function insightRows(insights: TrainingInsight[]) {
  return insights.map((insight) => ({
    insight_type: insight.type,
    title: insight.title,
    description: insight.description,
    recommendation: insight.recommendation ?? null,
    metric_name: insight.metric?.name ?? null,
    metric_value: insight.metric?.value ?? null,
    metric_unit: insight.metric?.unit ?? null,
    metric_delta: insight.metric?.delta ?? null,
  }));
}

/**
 * Persist through the atomic RPC (F303/F311). `replace_user_insights` also
 * stamps `expires_at = now() + 36h`, which is what the portal's precedence
 * rule reads: a stale batch expires into the browser fallback rather than
 * being shown as if it were fresh.
 */
async function persistInsights(
  supabaseAdmin: DbClient,
  userId: string,
  period: string,
  insights: TrainingInsight[],
): Promise<{ message: string } | null> {
  const { error } = await supabaseAdmin.rpc('replace_user_insights', {
    p_user_id: userId,
    p_period: period,
    p_rows: insightRows(insights),
  });
  return error ? { message: error.message ?? String(error) } : null;
}

// ── Handler ──────────────────────────────────────────────────────────────────

export function createGenerateInsightsHandler(
  dependencies: GenerateInsightsDependencies = defaultDependencies(),
): (req: Request) => Promise<Response> {
  return (req) => handle(req, dependencies);
}

if (import.meta.main) {
  Deno.serve(createGenerateInsightsHandler());
}

async function handle(
  req: Request,
  deps: GenerateInsightsDependencies,
): Promise<Response> {
  const { env } = deps;
  const cors = getCorsHeaders(req);

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors });
  }

  // POST only — this endpoint deletes and reinserts cached user_insights, so it
  // is state-changing. Reject other methods before auth/parsing so an
  // authenticated GET/HEAD or proxy retry cannot trigger regeneration. (F308)
  if (req.method !== 'POST') {
    return json(cors, 405, { error: 'Method not allowed' });
  }

  try {
    // An empty body is allowed (defaults apply); malformed JSON is rejected
    // with a 400 instead of being silently replaced with {}. (F309)
    const rawBody = await req.text();
    let body: { period?: string; mode?: string; cursor?: string | null };
    if (rawBody.trim().length === 0) {
      body = {};
    } else {
      try {
        body = JSON.parse(rawBody);
      } catch {
        return json(cors, 400, { error: 'Invalid JSON body' });
      }
    }

    const supabaseAdmin = deps.createAdminClient(
      env('SUPABASE_URL') ?? '',
      env('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    if (body.mode === 'batch') {
      return await runScheduledBatch(req, deps, supabaseAdmin, cors, body.cursor);
    }

    return await runUserRequest(req, deps, supabaseAdmin, cors, body.period);
  } catch (err) {
    console.error('Unexpected error in generate-insights:', err);
    return json(cors, 500, { error: 'Internal server error' });
  }
}

/**
 * Mode 1. Authenticated ONLY by the shared cron secret — a user JWT, however
 * valid or highly tiered, can never take this branch.
 */
async function runScheduledBatch(
  req: Request,
  deps: GenerateInsightsDependencies,
  supabaseAdmin: DbClient,
  cors: Record<string, string>,
  cursor: string | null | undefined,
): Promise<Response> {
  if (!hasValidCronSecret(req, deps.env)) {
    return json(cors, 401, { error: 'Unauthorized' });
  }

  // Eligibility (activity window AND FLAME+) is decided in SQL by
  // public.insights_batch_candidates, which uses PR 8's
  // subscription_tier_for(user_id). user_subscription_tier() reads auth.uid(),
  // which is NULL under the service role, so it cannot be used here (R-19).
  const { data: candidates, error: candidatesError } = await supabaseAdmin.rpc(
    'insights_batch_candidates',
    { p_cursor: cursor ?? null, p_limit: BATCH_SIZE },
  );

  if (candidatesError) {
    console.error('[generate-insights] candidate lookup failed:', candidatesError);
    return json(cors, 500, { error: 'Failed to select batch candidates' });
  }

  const userIds: string[] = (candidates ?? [])
    .map((row: { user_id?: string }) => row?.user_id)
    .filter((id: string | undefined): id is string => typeof id === 'string');

  const now = deps.now();
  let processed = 0;
  const failed: string[] = [];

  for (const userId of userIds) {
    // One user's failure must not abort the pass, or a single corrupt row
    // would freeze the cursor and starve everybody behind it.
    try {
      const built = await buildInsightsForUser(
        supabaseAdmin,
        userId,
        BATCH_PERIOD,
        now,
      );
      if (!built.ok) {
        failed.push(userId);
        console.error(`[generate-insights] batch user failed (${built.reason})`);
        continue;
      }
      const persistError = await persistInsights(
        supabaseAdmin,
        userId,
        BATCH_PERIOD,
        built.insights,
      );
      if (persistError) {
        failed.push(userId);
        console.error('[generate-insights] batch persist failed:', persistError.message);
        continue;
      }
      processed++;
    } catch (err) {
      failed.push(userId);
      console.error('[generate-insights] batch user threw:', err);
    }
  }

  // A short page means the pass reached the end of the eligible set: wrap the
  // cursor to NULL so the next pass starts over.
  const nextCursor =
    userIds.length === BATCH_SIZE ? userIds[userIds.length - 1] : null;

  const { error: cursorError } = await supabaseAdmin.rpc(
    'set_insights_batch_cursor',
    { p_cursor: nextCursor },
  );
  if (cursorError) {
    // Fail loudly: a silently unadvanced cursor means the same 25 users are
    // refreshed every 15 minutes for ever and nobody else is.
    console.error('[generate-insights] cursor write failed:', cursorError);
    return json(cors, 500, {
      error: 'Failed to advance batch cursor',
      processed,
      failed: failed.length,
    });
  }

  return json(cors, 200, {
    success: true,
    processed,
    failed: failed.length,
    nextCursor,
  });
}

/** Mode 2. User JWT only, gated at FLAME (F-010). */
async function runUserRequest(
  req: Request,
  deps: GenerateInsightsDependencies,
  supabaseAdmin: DbClient,
  cors: Record<string, string>,
  requestedPeriod: string | undefined,
): Promise<Response> {
  const { env } = deps;
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return json(cors, 401, { error: 'Missing Authorization header' });
  }

  const supabase = deps.createUserClient(
    env('SUPABASE_URL') ?? '',
    env('SUPABASE_ANON_KEY') ?? '',
    authHeader,
  );
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return json(cors, 401, { error: 'Not authenticated' });
  }

  // Rate limit: 5 requests per minute per user
  const rateCheck = await checkRateLimit(
    supabaseAdmin,
    {
      key: 'generate-insights',
      userId: user.id,
      maxRequests: 5,
      windowSeconds: 60,
    },
    cors,
  );
  if (!rateCheck.allowed) return rateCheck.response!;

  // Server-generated insights are a paid feature (KD-14). The batch only ever
  // computes them for FLAME+, so the on-demand path must match or an EMBER
  // user could mint the same rows by calling the function directly.
  const gate = await requireSubscription(supabaseAdmin, user.id, 'FLAME', cors);
  if (!gate.allowed) return gate.response;

  // body.userId was accepted previously but the guard always coerced it back
  // to the authenticated user's id. Use user.id directly.
  const userId = user.id;
  const period: string = requestedPeriod ?? BATCH_PERIOD;

  if (!PERIOD_DAYS[period]) {
    return json(cors, 400, {
      error: 'Invalid period. Accepted values: 7d, 30d, 90d, 1y, all',
    });
  }

  const built = await buildInsightsForUser(
    supabaseAdmin,
    userId,
    period,
    deps.now(),
  );
  if (!built.ok) {
    return json(cors, 500, { error: 'Failed to fetch workout data' });
  }

  const persistError = await persistInsights(
    supabaseAdmin,
    userId,
    period,
    built.insights,
  );
  if (persistError) {
    console.error('Failed to persist insights:', persistError.message);
    return json(cors, 500, { error: 'Failed to save insights' });
  }

  return json(cors, 200, { success: true, data: built.insights });
}

function json(
  cors: Record<string, string>,
  status: number,
  payload: unknown,
): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}
