// Canonical rules live in src/lib/insights.ts — keep in sync.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { getCorsHeaders } from '../_shared/cors.ts';
import { checkRateLimit } from '../_shared/rateLimit.ts';

// ── Types (mirrored from src/lib/insights.ts) ────────────────────────────────

interface TrainingInsight {
  id: string;
  type: 'success' | 'warning' | 'info' | 'achievement';
  title: string;
  description: string;
  recommendation?: string;
  metric?: { name: string; value: number; unit: string; delta?: number };
}

interface InsightInput {
  currentVolume: number;
  previousVolume: number;
  muscleGroups: Record<string, number>; // name → percentage of total
  avgSessionsPerWeek: number;
  currentStreak: number;
  bestStreak: number;
  recentPRs: Array<{
    exercise: string;
    displayName: string;
    recordType: string | null;
    value: number;
    previousValue?: number;
  }>;
  plateauExercises: string[];
  trainingLoadScore: number;
}

// ── Insight rule engine (duplicate of src/lib/insights.ts) ───────────────────

const STREAK_MILESTONES = [7, 14, 21, 30];
const KG_TO_LBS = 2.20462;
const WEIGHT_MULTIPLIER = 2;

type WeightUnit = 'kg' | 'lbs';

function normalizeWeightUnit(unit: unknown): WeightUnit {
  return unit === 'lbs' ? 'lbs' : 'kg';
}

function convertWeight(valueKg: number, unit: WeightUnit): number {
  return unit === 'lbs' ? valueKg * KG_TO_LBS : valueKg;
}

function formatWeight(valueKg: number, unit: WeightUnit): string {
  const converted = convertWeight(valueKg, unit);
  return unit === 'lbs'
    ? `${converted.toFixed(1)} lbs`
    : `${Math.round(converted)} kg`;
}

function formatVolume(valueKg: number, unit: WeightUnit): string {
  const converted = convertWeight(valueKg, unit);
  const absValue = Math.abs(converted);

  if (absValue >= 1_000_000) {
    return `${(converted / 1_000_000).toFixed(1)}M ${unit}`;
  }
  if (absValue >= 1_000) {
    return `${(converted / 1_000).toFixed(1)}K ${unit}`;
  }
  return unit === 'lbs'
    ? `${converted.toFixed(1)} lbs`
    : `${Math.round(converted)} kg`;
}

function roundWeightMetric(valueKg: number, unit: WeightUnit): number {
  const converted = convertWeight(valueKg, unit);
  return Number(converted.toFixed(unit === 'lbs' ? 1 : 0));
}

function formatWorkoutPhase(phase: string | null | undefined): string {
  switch ((phase ?? 'COMBINED').toUpperCase()) {
    case 'CONCENTRIC':
      return 'Concentric';
    case 'ECCENTRIC':
      return 'Eccentric';
    default:
      return 'Combined';
  }
}

function formatRecordType(recordType: string | null | undefined): string {
  switch ((recordType ?? '').toUpperCase()) {
    case 'MAX_WEIGHT':
      return 'Max Weight';
    case 'MAX_VOLUME':
      return 'Max Volume';
    case '1RM':
      return '1RM';
    default:
      return 'PR';
  }
}

function formatPersonalRecordName(
  exercise: string,
  recordType: string | null | undefined,
  phase: string | null | undefined
): string {
  const formattedType = formatRecordType(recordType);
  const formattedPhase = formatWorkoutPhase(phase);
  return formattedPhase === 'Combined'
    ? `${exercise} ${formattedType}`
    : `${exercise} ${formattedPhase} ${formattedType}`;
}

function generateInsights(
  input: InsightInput,
  unit: WeightUnit = 'kg'
): TrainingInsight[] {
  const insights: TrainingInsight[] = [];

  // ── Volume Trend ────────────────────────────────────────────────────────────
  if (input.previousVolume > 0) {
    const volumeDelta =
      (input.currentVolume - input.previousVolume) / input.previousVolume;

    if (volumeDelta > 0.1) {
      const pct = Math.round(volumeDelta * 100);
      insights.push({
        id: 'volume-up',
        type: 'success',
        title: 'Volume Trending Up',
        description: `Your training volume increased by ${pct}% compared to the previous period.`,
        recommendation: 'Maintain this trajectory while monitoring recovery.',
        metric: {
          name: 'Volume Change',
          value: pct,
          unit: '%',
          delta: input.currentVolume - input.previousVolume,
        },
      });
    } else if (volumeDelta < -0.15) {
      const pct = Math.round(Math.abs(volumeDelta) * 100);
      insights.push({
        id: 'volume-down',
        type: 'warning',
        title: 'Volume Trending Down',
        description: `Your training volume dropped by ${pct}% compared to the previous period.`,
        recommendation:
          'Check for schedule disruptions or signs of overtraining. Consider a structured deload.',
        metric: {
          name: 'Volume Change',
          value: -pct,
          unit: '%',
          delta: input.currentVolume - input.previousVolume,
        },
      });
    }
  }

  // ── Muscle Group Imbalance ──────────────────────────────────────────────────
  const groupEntries = Object.entries(input.muscleGroups);
  if (groupEntries.length >= 2) {
    const values = groupEntries.map(([, v]) => v);
    const maxValue = Math.max(...values);
    const minValue = Math.min(...values);

    if (maxValue > minValue * 3) {
      const [dominantGroup] = groupEntries.find(([, v]) => v === maxValue) ?? [
        'Unknown',
      ];
      const weakGroups = groupEntries
        .filter(([, v]) => v * 3 < maxValue)
        .map(([name]) => name);

      for (const weakGroup of weakGroups) {
        insights.push({
          id: `muscle-imbalance-${weakGroup}`,
          type: 'warning',
          title: `${weakGroup} Training Imbalance`,
          description: `${dominantGroup} training (${maxValue}%) dominates your programme — ${weakGroup} is under-represented at ${input.muscleGroups[weakGroup]}%.`,
          recommendation: `Add dedicated ${weakGroup} work to balance your programme and reduce injury risk.`,
          metric: {
            name: `${weakGroup} Volume Share`,
            value: input.muscleGroups[weakGroup],
            unit: '%',
          },
        });
      }
    }
  }

  // ── Consistency ─────────────────────────────────────────────────────────────
  if (input.avgSessionsPerWeek > 0 && input.avgSessionsPerWeek < 3) {
    insights.push({
      id: 'low-consistency',
      type: 'warning',
      title: 'Consistency Could Improve',
      description: `You're averaging ${input.avgSessionsPerWeek.toFixed(1)} sessions per week. Consistent training frequency is key to long-term progress.`,
      recommendation: 'Aim for at least 3 sessions per week for meaningful adaptation.',
      metric: {
        name: 'Avg Sessions / Week',
        value: input.avgSessionsPerWeek,
        unit: 'sessions',
      },
    });
  }

  // ── PR Achievements ─────────────────────────────────────────────────────────
  for (const pr of input.recentPRs) {
    const delta =
      pr.previousValue !== undefined ? pr.value - pr.previousValue : undefined;
    const isVolumeRecord = (pr.recordType ?? '').toUpperCase() === 'MAX_VOLUME';
    const formattedValue = isVolumeRecord
      ? formatVolume(pr.value, unit)
      : formatWeight(pr.value, unit);
    const formattedDelta = delta !== undefined
      ? isVolumeRecord
        ? formatVolume(delta, unit)
        : formatWeight(delta, unit)
      : undefined;
    const formattedPrevious = pr.previousValue !== undefined
      ? isVolumeRecord
        ? formatVolume(pr.previousValue, unit)
        : formatWeight(pr.previousValue, unit)
      : undefined;
    insights.push({
      id: `pr-${pr.displayName.toLowerCase().replace(/\s+/g, '-')}`,
      type: 'achievement',
      title: `New PR: ${pr.displayName}`,
      description:
        delta !== undefined && formattedDelta && formattedPrevious
          ? `You set a personal record on ${pr.displayName} — ${formattedValue} (up ${formattedDelta} from ${formattedPrevious}).`
          : `You set a personal record on ${pr.displayName} — ${formattedValue}.`,
      metric: {
        name: pr.displayName,
        value: roundWeightMetric(pr.value, unit),
        unit,
        delta: delta !== undefined ? roundWeightMetric(delta, unit) : undefined,
      },
    });
  }

  // ── Plateau Detection ───────────────────────────────────────────────────────
  for (const exercise of input.plateauExercises) {
    insights.push({
      id: `plateau-${exercise.toLowerCase().replace(/\s+/g, '-')}`,
      type: 'warning',
      title: `Plateau Detected: ${exercise}`,
      description: `Your ${exercise} performance has stalled over recent sessions.`,
      recommendation:
        'Try varying rep ranges, adding a deload week, or introducing a variation movement.',
    });
  }

  // ── Streak Milestones ───────────────────────────────────────────────────────
  if (STREAK_MILESTONES.includes(input.currentStreak)) {
    insights.push({
      id: `streak-${input.currentStreak}`,
      type: 'achievement',
      title: `${input.currentStreak}-Day Streak!`,
      description: `You've trained consistently for ${input.currentStreak} days in a row — keep the momentum going.`,
      metric: {
        name: 'Current Streak',
        value: input.currentStreak,
        unit: 'days',
      },
    });
  }

  // ── Training Load ───────────────────────────────────────────────────────────
  if (input.trainingLoadScore >= 75) {
    insights.push({
      id: 'high-training-load',
      type: 'warning',
      title: 'High Training Load',
      description: `Your training load score is ${input.trainingLoadScore} — above the recommended threshold.`,
      recommendation:
        'Consider scheduling a deload week or reducing intensity to prevent overtraining and injury.',
      metric: {
        name: 'Training Load Score',
        value: input.trainingLoadScore,
        unit: 'pts',
      },
    });
  }

  return insights;
}

// ── RTL calculator (duplicate of src/lib/training-load.ts) ──────────────────

function calculateRTL(
  sessions: Array<{ totalVolume: number; setCount: number }>
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

// ── Period mapping ────────────────────────────────────────────────────────────

const PERIOD_DAYS: Record<string, number> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
  '1y': 365,
  'all': 3650,
};

// ── Service-role client ───────────────────────────────────────────────────────

const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

// ── Handler ───────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors });
  }

  try {
    // ── Auth ──────────────────────────────────────────────────────────────────
    const authHeader = req.headers.get('Authorization')!;
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return new Response(
        JSON.stringify({ error: 'Not authenticated' }),
        { status: 401, headers: { ...cors, 'Content-Type': 'application/json' } }
      );
    }

    // Rate limit: 5 requests per minute per user
    const rateCheck = await checkRateLimit(supabaseAdmin, {
      key: 'generate-insights',
      userId: user.id,
      maxRequests: 5,
      windowSeconds: 60,
    }, cors);
    if (!rateCheck.allowed) return rateCheck.response!;

    // ── Parse request ─────────────────────────────────────────────────────────
    const body = await req.json().catch(() => ({}));
    const userId: string = body.userId ?? user.id;
    const period: string = body.period ?? '30d';

    // Guard: requesting user can only fetch their own insights
    if (userId !== user.id) {
      return new Response(
        JSON.stringify({ error: 'Forbidden' }),
        { status: 403, headers: { ...cors, 'Content-Type': 'application/json' } }
      );
    }

    // Validate period is one of the known values
    if (!PERIOD_DAYS[period]) {
      return new Response(
        JSON.stringify({ error: 'Invalid period. Accepted values: 7d, 30d, 90d, 1y, all' }),
        { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } }
      );
    }

    const periodDays = PERIOD_DAYS[period];
    const now = new Date();
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

    const weightUnit = normalizeWeightUnit(profile?.weight_unit);

    // ── 1. Fetch workout sessions (current + previous period) ─────────────────
    const { data: allSessions, error: sessionsError } = await supabaseAdmin
      .from('workout_sessions')
      .select('id, started_at, total_volume, set_count')
      .eq('user_id', userId)
      .gte('started_at', previousStart.toISOString())
      .order('started_at', { ascending: true });

    if (sessionsError) {
      console.error('Failed to fetch workout sessions:', sessionsError);
      return new Response(
        JSON.stringify({ error: 'Failed to fetch workout data' }),
        { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } }
      );
    }

    const sessions = allSessions ?? [];
    const currentSessions = sessions.filter(
      (s) => new Date(s.started_at) >= currentStart
    );
    const previousSessions = sessions.filter(
      (s) =>
        new Date(s.started_at) >= previousStart &&
        new Date(s.started_at) < currentStart
    );

    const currentVolume = currentSessions.reduce(
      (sum, s) => sum + (s.total_volume ?? 0),
      0
    );
    const previousVolume = previousSessions.reduce(
      (sum, s) => sum + (s.total_volume ?? 0),
      0
    );

    const avgSessionsPerWeek =
      periodDays > 0
        ? (currentSessions.length / periodDays) * 7
        : 0;

    // ── 2. Muscle group distribution ──────────────────────────────────────────
    // Join exercises to current sessions to compute distribution by muscle group
    const currentSessionIds = currentSessions.map((s) => s.id);
    let muscleGroups: Record<string, number> = {};

    if (currentSessionIds.length > 0) {
      const { data: exerciseRows } = await supabaseAdmin
        .from('exercises')
        .select('muscle_group')
        .in('session_id', currentSessionIds);

      if (exerciseRows && exerciseRows.length > 0) {
        const groupCounts: Record<string, number> = {};
        for (const row of exerciseRows) {
          const group = row.muscle_group ?? 'General';
          groupCounts[group] = (groupCounts[group] ?? 0) + 1;
        }
        const total = exerciseRows.length;
        for (const [group, count] of Object.entries(groupCounts)) {
          muscleGroups[group] = Math.round((count / total) * 100);
        }
      }
    }

    // ── 3. Recent personal records ────────────────────────────────────────────
    const { data: prRows } = await supabaseAdmin
      .from('personal_records')
      .select('exercise_name, record_type, workout_phase, value, previous_value')
      .eq('user_id', userId)
      .gte('achieved_at', currentStart.toISOString())
      .order('achieved_at', { ascending: false });

    const recentPRs = (prRows ?? []).map((r) => ({
      exercise: r.exercise_name,
      displayName: formatPersonalRecordName(
        r.exercise_name,
        r.record_type,
        r.workout_phase
      ),
      recordType: r.record_type,
      value: r.value * WEIGHT_MULTIPLIER,
      previousValue:
        r.previous_value !== null && r.previous_value !== undefined
          ? r.previous_value * WEIGHT_MULTIPLIER
          : undefined,
    }));

    // ── 4. Plateau detection (exercise_progress: 1RM flat for 3+ weeks) ───────
    const threeWeeksAgo = new Date(now.getTime() - 21 * 86400_000);
    const { data: progressRows } = await supabaseAdmin
      .from('exercise_progress')
      .select('exercise_name, estimated_1rm_kg, recorded_at')
      .eq('user_id', userId)
      .gte('recorded_at', threeWeeksAgo.toISOString())
      .order('recorded_at', { ascending: true });

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
          })
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
    const { data: streakSessions } = await supabaseAdmin
      .from('workout_sessions')
      .select('started_at')
      .eq('user_id', userId)
      .gte('started_at', ninetyDaysAgo.toISOString())
      .order('started_at', { ascending: false });

    let currentStreak = 0;
    let bestStreak = 0;

    if (streakSessions && streakSessions.length > 0) {
      // Build a Set of unique date strings (YYYY-MM-DD)
      const workoutDays = new Set(
        streakSessions.map((s) => s.started_at.slice(0, 10))
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
          const diff =
            (d.getTime() - prevDate.getTime()) / 86400_000;
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
      currentSessions.map((s) => ({
        totalVolume: s.total_volume ?? 0,
        setCount: s.set_count ?? 0,
      }))
    );

    // ── 7. Assemble InsightInput and generate insights ────────────────────────
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

    const insights = generateInsights(insightInput, weightUnit);

    // ── 8. Persist: delete old, insert new ────────────────────────────────────
    const { error: deleteError } = await supabaseAdmin
      .from('user_insights')
      .delete()
      .eq('user_id', userId)
      .eq('period', period);

    if (deleteError) {
      console.error('Failed to delete old insights:', deleteError);
      return new Response(
        JSON.stringify({ error: 'Failed to clear old insights' }),
        { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } }
      );
    }

    const rows = insights.map((insight) => ({
      user_id: userId,
      insight_type: insight.type,
      title: insight.title,
      description: insight.description,
      recommendation: insight.recommendation ?? null,
      metric_name: insight.metric?.name ?? null,
      metric_value: insight.metric?.value ?? null,
      metric_unit: insight.metric?.unit ?? null,
      metric_delta: insight.metric?.delta ?? null,
      period,
    }));

    if (rows.length > 0) {
      const { error: insertError } = await supabaseAdmin
        .from('user_insights')
        .insert(rows);

      if (insertError) {
        console.error('Failed to insert insights:', insertError);
        return new Response(
          JSON.stringify({ error: 'Failed to save insights' }),
          { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } }
        );
      }
    }

    return new Response(
      JSON.stringify({ success: true, data: insights }),
      { headers: { ...cors, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    console.error('Unexpected error in generate-insights:', err);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } }
    );
  }
});
