import { createClient } from 'jsr:@supabase/supabase-js@2';
import { getCorsHeaders } from '../_shared/cors.ts';

// =============================================================================
// TypeScript interfaces matching mobile DTO wire format (camelCase)
// =============================================================================

interface PushPayload {
  deviceId: string;
  platform: string;
  lastSync: string | null;
  sessions: SessionDto[];
  routines: RoutineDto[];
  rpgAttributes: RpgAttributesDto | null;
  badges: BadgeDto[];
  gamificationStats: GamificationStatsDto | null;
}

interface SessionDto {
  id: string;
  userId: string;
  name: string | null;
  startedAt: string;
  durationSeconds: number;
  totalVolume: number;
  setCount: number;
  exerciseCount: number;
  prCount: number;
  routineName: string | null;
  workoutMode: string | null;
  routineSessionId: string | null;
  notes: string | null;
  exercises: ExerciseDto[];
}

interface ExerciseDto {
  id: string;
  sessionId: string;
  name: string;
  muscleGroup: string;
  orderIndex: number;
  sets: SetDto[];
}

interface SetDto {
  id: string;
  exerciseId: string;
  setNumber: number;
  targetReps: number | null;
  actualReps: number;
  weightKg: number;
  rpe: number | null;
  isPr: boolean;
  notes: string | null;
  workoutMode: string | null;
  repSummaries: RepSummaryDto[];
}

interface RepSummaryDto {
  id: string;
  setId: string;
  repNumber: number;
  meanVelocityMps: number | null;
  peakVelocityMps: number | null;
  meanForceN: number | null;
  peakForceN: number | null;
  powerWatts: number | null;
  romMm: number | null;
  tutMs: number | null;
  leftForceAvg: number | null;
  rightForceAvg: number | null;
  asymmetryPct: number | null;
  vbtZone: string | null;
}

interface RoutineDto {
  id: string;
  userId: string;
  name: string;
  description: string;
  exerciseCount: number;
  estimatedDuration: number;
  timesCompleted: number;
  isFavorite: boolean;
  exercises: RoutineExerciseDto[];
}

interface RoutineExerciseDto {
  id: string;
  routineId: string;
  name: string;
  muscleGroup: string;
  sets: number;
  reps: number;
  weight: number;
  restSeconds: number;
  mode: string;
  orderIndex: number;
  // Advanced fields
  supersetId: string | null;
  supersetColor: string | null;
  supersetOrder: number | null;
  perSetWeights: string | null;
  perSetRest: string | null;
  isAmrap: boolean;
  prPercentage: number | null;
  repCountTiming: string | null;
  stopAtPosition: string | null;
  stallDetection: boolean;
  eccentricLoad: string | null;
  echoLevel: string | null;
}

interface RpgAttributesDto {
  userId: string;
  strength: number;
  power: number;
  stamina: number;
  consistency: number;
  mastery: number;
  characterClass: string | null;
  level: number;
  experiencePoints: number;
}

interface BadgeDto {
  userId: string;
  badgeId: string;
  badgeName: string;
  badgeDescription: string | null;
  badgeTier: string;
  earnedAt: string;
}

interface GamificationStatsDto {
  userId: string;
  totalWorkouts: number;
  totalReps: number;
  totalVolumeKg: number;
  longestStreak: number;
  currentStreak: number;
  totalTimeSeconds: number;
}

// =============================================================================
// Helper
// =============================================================================

function safeJsonParse(value: string | null | undefined): unknown {
  if (value == null) return null;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
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
    // 1. JWT verification — authenticate the mobile user
    // =========================================================================
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Missing Authorization header' }),
        { status: 401, headers: { ...cors, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseAuth = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const {
      data: { user },
    } = await supabaseAuth.auth.getUser();

    if (!user) {
      return new Response(
        JSON.stringify({ error: 'Not authenticated' }),
        { status: 401, headers: { ...cors, 'Content-Type': 'application/json' } }
      );
    }

    const userId = user.id;

    // =========================================================================
    // 2. Service-role client for DB operations (bypasses RLS)
    // =========================================================================
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // =========================================================================
    // 3. Parse request body
    // =========================================================================
    const payload: PushPayload = await req.json();

    // Counters for response
    let sessionsInserted = 0;
    let exercisesInserted = 0;
    let setsInserted = 0;
    let repSummariesInserted = 0;
    let routinesUpserted = 0;
    let badgesUpserted = 0;
    let exerciseProgressInserted = 0;
    let personalRecordsInserted = 0;

    // =========================================================================
    // 4. Insert workout hierarchy in FK order
    // =========================================================================
    if (payload.sessions && payload.sessions.length > 0) {
      // --- 4a. Upsert workout_sessions ---
      const sessionRows = payload.sessions.map((s) => ({
        id: s.id,
        user_id: userId,
        name: s.name,
        started_at: s.startedAt,
        duration_seconds: s.durationSeconds,
        total_volume: s.totalVolume,
        set_count: s.setCount,
        exercise_count: s.exerciseCount,
        pr_count: s.prCount,
        routine_name: s.routineName,
        workout_mode: s.workoutMode,
        routine_session_id: s.routineSessionId,
        notes: s.notes,
      }));

      const { error: sessErr } = await supabase
        .from('workout_sessions')
        .upsert(sessionRows, { onConflict: 'id' });
      if (sessErr) throw new Error(`workout_sessions upsert failed: ${sessErr.message}`);
      sessionsInserted = sessionRows.length;

      // --- 4b. Batch upsert exercises ---
      const exerciseRows = payload.sessions.flatMap((s) =>
        s.exercises.map((e) => ({
          id: e.id,
          session_id: e.sessionId,
          user_id: userId,
          name: e.name,
          muscle_group: e.muscleGroup,
          order_index: e.orderIndex,
        }))
      );

      if (exerciseRows.length > 0) {
        const { error: exErr } = await supabase
          .from('exercises')
          .upsert(exerciseRows, { onConflict: 'id' });
        if (exErr) throw new Error(`exercises upsert failed: ${exErr.message}`);
        exercisesInserted = exerciseRows.length;
      }

      // --- 4c. Batch upsert sets ---
      const setRows = payload.sessions.flatMap((s) =>
        s.exercises.flatMap((e) =>
          e.sets.map((st) => ({
            id: st.id,
            exercise_id: st.exerciseId,
            user_id: userId,
            set_number: st.setNumber,
            target_reps: st.targetReps,
            actual_reps: st.actualReps,
            weight_kg: st.weightKg,
            rpe: st.rpe,
            is_pr: st.isPr,
            notes: st.notes,
            workout_mode: st.workoutMode,
          }))
        )
      );

      if (setRows.length > 0) {
        const { error: setErr } = await supabase
          .from('sets')
          .upsert(setRows, { onConflict: 'id' });
        if (setErr) throw new Error(`sets upsert failed: ${setErr.message}`);
        setsInserted = setRows.length;
      }

      // --- 4d. Batch upsert rep_summaries ---
      const repRows = payload.sessions.flatMap((s) =>
        s.exercises.flatMap((e) =>
          e.sets.flatMap((st) =>
            st.repSummaries.map((r) => ({
              id: r.id,
              set_id: r.setId,
              user_id: userId,
              rep_number: r.repNumber,
              mean_velocity_mps: r.meanVelocityMps,
              peak_velocity_mps: r.peakVelocityMps,
              mean_force_n: r.meanForceN,
              peak_force_n: r.peakForceN,
              power_watts: r.powerWatts,
              rom_mm: r.romMm,
              tut_ms: r.tutMs,
              left_force_avg: r.leftForceAvg,
              right_force_avg: r.rightForceAvg,
              asymmetry_pct: r.asymmetryPct,
              vbt_zone: r.vbtZone,
            }))
          )
        )
      );

      if (repRows.length > 0) {
        const { error: repErr } = await supabase
          .from('rep_summaries')
          .upsert(repRows, { onConflict: 'id' });
        if (repErr) throw new Error(`rep_summaries upsert failed: ${repErr.message}`);
        repSummariesInserted = repRows.length;
      }

      // =====================================================================
      // 5. Compute exercise_progress from sets (Brzycki 1RM for reps 1-12)
      // =====================================================================
      const progressRows: Record<string, unknown>[] = [];

      for (const session of payload.sessions) {
        for (const exercise of session.exercises) {
          if (exercise.sets.length === 0) continue;

          const maxWeight = Math.max(...exercise.sets.map((s) => s.weightKg));
          const totalVolume = exercise.sets.reduce(
            (sum, s) => sum + s.weightKg * s.actualReps,
            0
          );
          const maxReps = Math.max(...exercise.sets.map((s) => s.actualReps));
          const setCount = exercise.sets.length;

          // Brzycki 1RM: weight * (36 / (37 - reps)), best set with reps 1-12 and weight > 0
          let estimated1rm = 0;
          for (const s of exercise.sets) {
            if (s.weightKg > 0 && s.actualReps >= 1 && s.actualReps <= 12) {
              const e1rm = s.weightKg * (36 / (37 - s.actualReps));
              if (e1rm > estimated1rm) estimated1rm = e1rm;
            }
          }

          progressRows.push({
            user_id: userId,
            exercise_name: exercise.name,
            session_id: session.id,
            recorded_at: session.startedAt,
            max_weight_kg: maxWeight,
            total_volume_kg: totalVolume,
            estimated_1rm_kg: Math.round(estimated1rm * 100) / 100,
            max_reps: maxReps,
            set_count: setCount,
          });
        }
      }

      if (progressRows.length > 0) {
        const sessionIds = [...new Set(payload.sessions.map((session) => session.id))];
        const { data: existingProgress, error: existingProgressErr } = await supabase
          .from('exercise_progress')
          .select('session_id, exercise_name')
          .in('session_id', sessionIds);
        if (existingProgressErr) {
          throw new Error(`exercise_progress lookup failed: ${existingProgressErr.message}`);
        }

        const existingProgressKeys = new Set(
          (existingProgress ?? []).map((row) => `${row.session_id}:${row.exercise_name}`)
        );
        const dedupedProgressRows = progressRows.filter((row) => {
          const key = `${row.session_id}:${row.exercise_name}`;
          if (existingProgressKeys.has(key)) return false;
          existingProgressKeys.add(key);
          return true;
        });

        if (dedupedProgressRows.length > 0) {
          const { error: progErr } = await supabase
            .from('exercise_progress')
            .insert(dedupedProgressRows);
          if (progErr) throw new Error(`exercise_progress insert failed: ${progErr.message}`);
          exerciseProgressInserted = dedupedProgressRows.length;
        }
      }

      // =====================================================================
      // 6. Extract personal_records from is_pr sets
      // =====================================================================
      const prRows: Record<string, unknown>[] = [];

      for (const session of payload.sessions) {
        for (const exercise of session.exercises) {
          for (const set of exercise.sets) {
            if (set.isPr) {
              prRows.push({
                user_id: userId,
                exercise_name: exercise.name,
                muscle_group: exercise.muscleGroup ?? 'General',
                record_type: '1RM',
                value: set.weightKg,
                unit: 'kg',
                achieved_at: session.startedAt,
              });
            }
          }
        }
      }

      if (prRows.length > 0) {
        const achievedAtValues = [...new Set(prRows.map((row) => row.achieved_at as string))];
        const { data: existingPrs, error: existingPrErr } = await supabase
          .from('personal_records')
          .select('exercise_name, achieved_at, value, record_type')
          .eq('user_id', userId)
          .in('achieved_at', achievedAtValues);
        if (existingPrErr) {
          throw new Error(`personal_records lookup failed: ${existingPrErr.message}`);
        }

        const existingPrKeys = new Set(
          (existingPrs ?? []).map((row) => `${row.exercise_name}:${row.achieved_at}:${row.value}:${row.record_type}`)
        );
        const dedupedPrRows = prRows.filter((row) => {
          const key = `${row.exercise_name}:${row.achieved_at}:${row.value}:${row.record_type}`;
          if (existingPrKeys.has(key)) return false;
          existingPrKeys.add(key);
          return true;
        });

        if (dedupedPrRows.length > 0) {
          const { error: prErr } = await supabase
            .from('personal_records')
            .insert(dedupedPrRows);
          if (prErr) throw new Error(`personal_records insert failed: ${prErr.message}`);
          personalRecordsInserted = dedupedPrRows.length;
        }
      }
    }

    // =========================================================================
    // 7. Upsert routines + delete/reinsert routine_exercises
    // =========================================================================
    if (payload.routines && payload.routines.length > 0) {
      const routineRows = payload.routines.map((r) => ({
        id: r.id,
        user_id: userId,
        name: r.name,
        description: r.description,
        exercise_count: r.exerciseCount,
        estimated_duration: r.estimatedDuration,
        times_completed: r.timesCompleted,
        is_favorite: r.isFavorite,
      }));

      const { error: routErr } = await supabase
        .from('routines')
        .upsert(routineRows, { onConflict: 'id' });
      if (routErr) throw new Error(`routines upsert failed: ${routErr.message}`);
      routinesUpserted = routineRows.length;

      // Delete existing routine_exercises for these routines, then reinsert
      const routineIds = payload.routines.map((r) => r.id);
      const { error: delErr } = await supabase
        .from('routine_exercises')
        .delete()
        .in('routine_id', routineIds);
      if (delErr) throw new Error(`routine_exercises delete failed: ${delErr.message}`);

      const reRows = payload.routines.flatMap((r) =>
        r.exercises.map((e) => ({
          id: e.id,
          routine_id: e.routineId,
          name: e.name,
          muscle_group: e.muscleGroup,
          sets: e.sets,
          reps: e.reps,
          weight: e.weight,
          rest_seconds: e.restSeconds,
          mode: e.mode,
          order_index: e.orderIndex,
          superset_id: e.supersetId,
          superset_color: e.supersetColor,
          superset_order: e.supersetOrder,
          per_set_weights: safeJsonParse(e.perSetWeights),
          per_set_rest: safeJsonParse(e.perSetRest),
          is_amrap: e.isAmrap,
          pr_percentage: e.prPercentage,
          rep_count_timing: e.repCountTiming,
          stop_at_position: e.stopAtPosition,
          stall_detection: e.stallDetection,
          eccentric_load: e.eccentricLoad,
          echo_level: e.echoLevel,
        }))
      );

      if (reRows.length > 0) {
        const { error: reErr } = await supabase
          .from('routine_exercises')
          .insert(reRows);
        if (reErr) throw new Error(`routine_exercises insert failed: ${reErr.message}`);
      }
    }

    // =========================================================================
    // 8. Upsert rpg_attributes
    // =========================================================================
    if (payload.rpgAttributes) {
      const rpg = payload.rpgAttributes;
      const { error: rpgErr } = await supabase
        .from('rpg_attributes')
        .upsert(
          {
            user_id: userId,
            strength: rpg.strength,
            power: rpg.power,
            stamina: rpg.stamina,
            consistency: rpg.consistency,
            mastery: rpg.mastery,
            character_class: rpg.characterClass,
            level: rpg.level,
            experience_points: rpg.experiencePoints,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'user_id' }
        );
      if (rpgErr) throw new Error(`rpg_attributes upsert failed: ${rpgErr.message}`);
    }

    // =========================================================================
    // 9. Upsert earned_badges
    // =========================================================================
    if (payload.badges && payload.badges.length > 0) {
      const badgeRows = payload.badges.map((b) => ({
        user_id: userId,
        badge_id: b.badgeId,
        badge_name: b.badgeName,
        badge_description: b.badgeDescription,
        badge_tier: b.badgeTier,
        earned_at: b.earnedAt,
      }));

      const { error: badgeErr } = await supabase
        .from('earned_badges')
        .upsert(badgeRows, { onConflict: 'user_id,badge_id' });
      if (badgeErr) throw new Error(`earned_badges upsert failed: ${badgeErr.message}`);
      badgesUpserted = badgeRows.length;
    }

    // =========================================================================
    // 10. Upsert gamification_stats
    // =========================================================================
    if (payload.gamificationStats) {
      const gs = payload.gamificationStats;
      const { error: gsErr } = await supabase
        .from('gamification_stats')
        .upsert(
          {
            user_id: userId,
            total_workouts: gs.totalWorkouts,
            total_reps: gs.totalReps,
            total_volume_kg: gs.totalVolumeKg,
            longest_streak: gs.longestStreak,
            current_streak: gs.currentStreak,
            total_time_seconds: gs.totalTimeSeconds,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'user_id' }
        );
      if (gsErr) throw new Error(`gamification_stats upsert failed: ${gsErr.message}`);
    }

    // =========================================================================
    // 11. Return sync result
    // =========================================================================
    const syncTime = new Date().toISOString();
    try {
      const broadcastResult = await supabase
        .channel(`sync:${userId}`)
        .httpSend('sync_complete', {
          syncTime,
          deviceId: payload.deviceId,
          platform: payload.platform,
          sessionsInserted,
          routinesUpserted,
          badgesUpserted,
        });

      if (!broadcastResult.success) {
        console.warn('mobile-sync-push broadcast warning:', broadcastResult);
      }
    } catch (broadcastErr) {
      console.warn('mobile-sync-push broadcast failed:', broadcastErr);
    }

    return new Response(
      JSON.stringify({
        syncTime,
        sessionsInserted,
        exercisesInserted,
        setsInserted,
        repSummariesInserted,
        routinesUpserted,
        badgesUpserted,
        exerciseProgressInserted,
        personalRecordsInserted,
      }),
      { headers: { ...cors, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    console.error('mobile-sync-push error:', err);
    const message = err instanceof Error ? err.message : 'Internal server error';
    const status = message.includes('upsert failed') || message.includes('insert failed')
      ? 400
      : 500;
    return new Response(
      JSON.stringify({ error: message }),
      { status, headers: { ...cors, 'Content-Type': 'application/json' } }
    );
  }
});
