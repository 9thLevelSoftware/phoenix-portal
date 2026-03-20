import { createClient } from 'jsr:@supabase/supabase-js@2';
import { getCorsHeaders } from '../_shared/cors.ts';
import { checkRateLimit } from '../_shared/rateLimit.ts';
import { requireSubscription } from '../_shared/requireSubscription.ts';

// =============================================================================
// TypeScript interfaces matching mobile DTO wire format (camelCase)
// =============================================================================

interface RepTelemetryDto {
  id: string;
  setId: string;
  timestampMs: number;
  forceN: number | null;
  velocityMps: number | null;
  positionMm: number | null;
  cable: string | null;
}

interface PhaseStatisticsDto {
  id: string;
  sessionId: string;
  concentricKgAvg: number;
  concentricKgMax: number;
  concentricVelAvg: number;
  concentricVelMax: number;
  concentricWattAvg: number;
  concentricWattMax: number;
  eccentricKgAvg: number;
  eccentricKgMax: number;
  eccentricVelAvg: number;
  eccentricVelMax: number;
  eccentricWattAvg: number;
  eccentricWattMax: number;
}

interface ExerciseSignatureDto {
  id: string;
  exerciseId: string;
  romMm: number;
  durationMs: number;
  symmetryRatio: number;
  velocityProfile: string;
  cableConfig: string;
  sampleCount: number;
  confidence: number;
  updatedAt: string | null;
}

interface AssessmentResultDto {
  id: string;
  exerciseId: string;
  estimatedOneRepMaxKg: number;
  loadVelocityData: string;
  assessmentSessionId: string | null;
  userOverrideKg: number | null;
  createdAt: string;
}

interface PushPayload {
  deviceId: string;
  platform: string;
  lastSync: string | null;
  sessions: SessionDto[];
  telemetry: RepTelemetryDto[];
  routines: RoutineDto[];
  cycles: CycleDto[];
  rpgAttributes: RpgAttributesDto | null;
  badges: BadgeDto[];
  gamificationStats: GamificationStatsDto | null;
  phaseStatistics: PhaseStatisticsDto[];
  exerciseSignatures: ExerciseSignatureDto[];
  assessments: AssessmentResultDto[];
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
  // Session enrichment (GAPs 3-6)
  avgVelocityMps: number | null;
  avgAsymmetryPct: number | null;
  velocityLossPct: number | null;
  dominantSide: string | null;
  strengthProfile: string | null;
  formScore: number | null;
  deloadWarnings: number | null;
  romViolations: number | null;
  spotterActivations: number | null;
  peakForceN: number | null;
  estimatedCalories: number | null;
  heaviestLiftKg: number | null;
  eccentricLoad: number | null;
  echoLevel: number | null;
  warmupReps: number | null;
  workingReps: number | null;
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
  prType: string | null; // "MAX_WEIGHT" or "MAX_VOLUME"
  prPhase: string | null; // "COMBINED", "CONCENTRIC", "ECCENTRIC"
  prVolume: number | null;
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

interface CycleDto {
  id: string;
  userId: string;
  name: string;
  description: string | null;
  durationWeeks: number;
  workoutDays: number;
  restDays: number;
  currentWeek: number;
  status: string;
  startedAt: string | null;
  lastUsedAt: string | null;
  progressionSettings: string | null;
  deloadSettings: string | null;
  days: CycleDayDto[];
}

interface CycleDayDto {
  id: string;
  cycleId: string;
  dayNumber: number;
  dayType: string;
  routineId: string | null;
  weightAdjustment: number;
  repModifier: number;
  restOverride: number | null;
  restType: string | null;
  notes: string | null;
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
    // 2b. Rate limit: 10 requests per minute per user
    // =========================================================================
    const rateCheck = await checkRateLimit(supabase, {
      key: 'mobile-sync-push',
      userId,
      maxRequests: 10,
      windowSeconds: 60,
    }, cors);
    if (!rateCheck.allowed) return rateCheck.response!;

    // =========================================================================
    // 2c. Subscription gate — EMBER or higher required
    // =========================================================================
    const gate = await requireSubscription(supabase, userId, 'EMBER', cors);
    if (!gate.allowed) return gate.response;

    // =========================================================================
    // 3. Parse request body
    // =========================================================================
    let payload: PushPayload;
    try {
      payload = await req.json();
    } catch {
      return new Response(
        JSON.stringify({ error: 'Invalid JSON body' }),
        { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } }
      );
    }

    if (!payload.deviceId || typeof payload.deviceId !== 'string') {
      return new Response(
        JSON.stringify({ error: 'Missing or invalid deviceId' }),
        { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } }
      );
    }
    if (!payload.platform || typeof payload.platform !== 'string') {
      return new Response(
        JSON.stringify({ error: 'Missing or invalid platform' }),
        { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } }
      );
    }

    // Counters for response
    let sessionsInserted = 0;
    let exercisesInserted = 0;
    let setsInserted = 0;
    let repSummariesInserted = 0;
    let telemetryInserted = 0;
    let routinesUpserted = 0;
    let badgesUpserted = 0;
    let exerciseProgressInserted = 0;
    let personalRecordsInserted = 0;
    let cyclesUpserted = 0;
    let phaseStatisticsInserted = 0;
    let exerciseSignaturesUpserted = 0;
    let assessmentsInserted = 0;

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
        // Session enrichment (GAPs 3-6) — null-safe for older mobile clients
        avg_velocity_mps: s.avgVelocityMps ?? null,
        avg_asymmetry_pct: s.avgAsymmetryPct ?? null,
        velocity_loss_pct: s.velocityLossPct ?? null,
        dominant_side: s.dominantSide ?? null,
        strength_profile: s.strengthProfile ?? null,
        form_score: s.formScore ?? null,
        deload_warnings: s.deloadWarnings ?? null,
        rom_violations: s.romViolations ?? null,
        spotter_activations: s.spotterActivations ?? null,
        peak_force_n: s.peakForceN ?? null,
        estimated_calories: s.estimatedCalories ?? null,
        heaviest_lift_kg: s.heaviestLiftKg ?? null,
        eccentric_load: s.eccentricLoad ?? null,
        echo_level: s.echoLevel ?? null,
        warmup_reps: s.warmupReps ?? null,
        working_reps: s.workingReps ?? null,
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

      // --- 4e. Batch insert rep_telemetry (GAP 1: force curves) ---
      if (payload.telemetry && payload.telemetry.length > 0) {
        // Insert in batches of 500 to avoid payload limits
        const TELEMETRY_BATCH = 500;
        for (let i = 0; i < payload.telemetry.length; i += TELEMETRY_BATCH) {
          const batch = payload.telemetry.slice(i, i + TELEMETRY_BATCH).map((t) => ({
            id: t.id,
            set_id: t.setId,
            user_id: userId,
            timestamp_ms: t.timestampMs,
            force_n: t.forceN,
            velocity_mps: t.velocityMps,
            position_mm: t.positionMm,
            cable: t.cable,
          }));

          const { error: telErr } = await supabase
            .from('rep_telemetry')
            .upsert(batch, { onConflict: 'id' });
          if (telErr) throw new Error(`rep_telemetry upsert failed: ${telErr.message}`);
          telemetryInserted += batch.length;
        }
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
              // GAP 2 fix: Use actual PR type/phase from mobile instead of hardcoded '1RM'
              const recordType = set.prType ?? '1RM';
              const value = recordType === 'MAX_VOLUME'
                ? (set.prVolume ?? set.weightKg * set.actualReps)
                : set.weightKg;
              prRows.push({
                user_id: userId,
                exercise_name: exercise.name,
                muscle_group: exercise.muscleGroup ?? 'General',
                record_type: recordType,
                value,
                unit: recordType === 'MAX_VOLUME' ? 'kg×reps' : 'kg',
                achieved_at: session.startedAt,
                workout_phase: set.prPhase ?? 'COMBINED',
              });
            }
          }
        }
      }

      if (prRows.length > 0) {
        const achievedAtValues = [...new Set(prRows.map((row) => row.achieved_at as string))];
        const { data: existingPrs, error: existingPrErr } = await supabase
          .from('personal_records')
          .select('exercise_name, achieved_at, value, record_type, workout_phase')
          .eq('user_id', userId)
          .in('achieved_at', achievedAtValues);
        if (existingPrErr) {
          throw new Error(`personal_records lookup failed: ${existingPrErr.message}`);
        }

        const existingPrKeys = new Set(
          (existingPrs ?? []).map((row) => `${row.exercise_name}:${row.achieved_at}:${row.value}:${row.record_type}:${row.workout_phase ?? 'COMBINED'}`)
        );
        const dedupedPrRows = prRows.filter((row) => {
          const key = `${row.exercise_name}:${row.achieved_at}:${row.value}:${row.record_type}:${row.workout_phase}`;
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
        estimated_duration: Math.round(r.estimatedDuration / 60),
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
    // 7b. Upsert training_cycles + delete/reinsert cycle_days
    // =========================================================================
    if (payload.cycles && payload.cycles.length > 0) {
      const cycleRows = payload.cycles.map((c) => ({
        id: c.id,
        user_id: userId,
        name: c.name,
        description: c.description ?? '',
        duration_weeks: c.durationWeeks,
        workout_days: c.workoutDays,
        rest_days: c.restDays,
        current_week: c.currentWeek,
        status: c.status,
        started_at: c.startedAt,
        last_used_at: c.lastUsedAt,
        progression_settings: safeJsonParse(c.progressionSettings),
        deload_settings: safeJsonParse(c.deloadSettings),
      }));

      const { error: cycErr } = await supabase
        .from('training_cycles')
        .upsert(cycleRows, { onConflict: 'id' });
      if (cycErr) throw new Error(`training_cycles upsert failed: ${cycErr.message}`);
      cyclesUpserted = cycleRows.length;

      // Delete existing cycle_days for these cycles, then reinsert
      const cycleIds = payload.cycles.map((c) => c.id);
      const { error: delCdErr } = await supabase
        .from('cycle_days')
        .delete()
        .in('cycle_id', cycleIds);
      if (delCdErr) throw new Error(`cycle_days delete failed: ${delCdErr.message}`);

      const dayRows = payload.cycles.flatMap((c) =>
        c.days.map((d) => ({
          id: d.id,
          cycle_id: d.cycleId,
          day_number: d.dayNumber,
          day_type: d.dayType,
          routine_id: d.routineId,
          weight_adjustment: d.weightAdjustment,
          rep_modifier: d.repModifier,
          rest_override: d.restOverride,
          rest_type: d.restType,
          notes: d.notes,
        }))
      );

      if (dayRows.length > 0) {
        const { error: dayErr } = await supabase
          .from('cycle_days')
          .insert(dayRows);
        if (dayErr) throw new Error(`cycle_days insert failed: ${dayErr.message}`);
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
    // 11. Phase statistics (GAP 7)
    // =========================================================================
    if (payload.phaseStatistics && payload.phaseStatistics.length > 0) {
      const phaseRows = payload.phaseStatistics.map((ps) => ({
        session_id: ps.sessionId,
        user_id: userId,
        concentric_kg_avg: ps.concentricKgAvg,
        concentric_kg_max: ps.concentricKgMax,
        concentric_vel_avg: ps.concentricVelAvg,
        concentric_vel_max: ps.concentricVelMax,
        concentric_watt_avg: ps.concentricWattAvg,
        concentric_watt_max: ps.concentricWattMax,
        eccentric_kg_avg: ps.eccentricKgAvg,
        eccentric_kg_max: ps.eccentricKgMax,
        eccentric_vel_avg: ps.eccentricVelAvg,
        eccentric_vel_max: ps.eccentricVelMax,
        eccentric_watt_avg: ps.eccentricWattAvg,
        eccentric_watt_max: ps.eccentricWattMax,
      }));

      const { error: psErr } = await supabase
        .from('session_phase_statistics')
        .upsert(phaseRows, { onConflict: 'session_id' });
      if (psErr) console.warn('phase_statistics upsert warning:', psErr.message);
      else phaseStatisticsInserted = phaseRows.length;
    }

    // =========================================================================
    // 12. Exercise signatures (GAP 8)
    // =========================================================================
    if (payload.exerciseSignatures && payload.exerciseSignatures.length > 0) {
      const sigRows = payload.exerciseSignatures.map((es) => ({
        user_id: userId,
        exercise_id: es.exerciseId,
        rom_mm: es.romMm,
        duration_ms: es.durationMs,
        symmetry_ratio: es.symmetryRatio,
        velocity_profile: es.velocityProfile,
        cable_config: es.cableConfig,
        sample_count: es.sampleCount,
        confidence: es.confidence,
        updated_at: es.updatedAt ?? new Date().toISOString(),
      }));

      const { error: sigErr } = await supabase
        .from('exercise_signatures')
        .upsert(sigRows, { onConflict: 'user_id,exercise_id' });
      if (sigErr) console.warn('exercise_signatures upsert warning:', sigErr.message);
      else exerciseSignaturesUpserted = sigRows.length;
    }

    // =========================================================================
    // 13. VBT assessment results (GAP 9)
    // =========================================================================
    if (payload.assessments && payload.assessments.length > 0) {
      const assessRows = payload.assessments.map((a) => ({
        user_id: userId,
        exercise_id: a.exerciseId,
        estimated_1rm_kg: a.estimatedOneRepMaxKg,
        load_velocity_data: safeJsonParse(a.loadVelocityData),
        assessment_session_id: a.assessmentSessionId,
        user_override_kg: a.userOverrideKg,
        created_at: a.createdAt,
      }));

      // Dedup by exercise_id + created_at
      const { data: existingAssess } = await supabase
        .from('vbt_assessments')
        .select('exercise_id, created_at')
        .eq('user_id', userId);

      const existingKeys = new Set(
        (existingAssess ?? []).map((r: Record<string, unknown>) => `${r.exercise_id}:${r.created_at}`)
      );
      const newAssess = assessRows.filter((r) => {
        const key = `${r.exercise_id}:${r.created_at}`;
        return !existingKeys.has(key);
      });

      if (newAssess.length > 0) {
        const { error: aErr } = await supabase
          .from('vbt_assessments')
          .insert(newAssess);
        if (aErr) console.warn('vbt_assessments insert warning:', aErr.message);
        else assessmentsInserted = newAssess.length;
      }
    }

    // =========================================================================
    // 14. Return sync result
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
          cyclesUpserted,
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
        telemetryInserted,
        routinesUpserted,
        cyclesUpserted,
        badgesUpserted,
        exerciseProgressInserted,
        personalRecordsInserted,
        phaseStatisticsInserted,
        exerciseSignaturesUpserted,
        assessmentsInserted,
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
