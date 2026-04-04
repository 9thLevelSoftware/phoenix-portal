import { createClient } from 'jsr:@supabase/supabase-js@2';
import { getCorsHeaders } from '../_shared/cors.ts';

/**
 * Mobile Sync Pull — returns all portal data modified since the client's last sync.
 *
 * POST /functions/v1/mobile-sync-pull
 * Authorization: Bearer <GoTrue JWT>
 * Body: { deviceId: string, lastSync: number, profileId?: string }
 *   lastSync  = Unix ms, 0 for first sync
 *   profileId = optional local profile UUID; when set, profile-scoped tables
 *               (workout_sessions, routines, training_cycles, personal_records)
 *               are filtered by local_profile_id
 *
 * Returns nested hierarchy:
 *   sessions -> exercises -> sets -> repSummaries
 *   routines -> exercises
 *   personalRecords, rpgAttributes, badges, gamificationStats, localProfiles,
 *   externalActivities
 */

interface PullRequest {
  deviceId: string;
  lastSync: number;
  profileId?: string;
}

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
    // 2. Service-role client for DB queries (bypasses RLS)
    // =========================================================================
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // =========================================================================
    // 3. Parse request body
    // =========================================================================
    const body: PullRequest = await req.json();
    const profileId: string | null = body.profileId ?? null;
    const lastSyncISO = new Date(body.lastSync ?? 0).toISOString();
    const syncTime = Date.now();

    // =========================================================================
    // 4. Fetch workout sessions modified since lastSync
    //    Uses updated_at for proper delta sync (covers upserts from any device).
    //    Falls back to started_at if updated_at isn't populated yet.
    // =========================================================================
    let sessionsQuery = supabase
      .from('workout_sessions')
      .select('*')
      .eq('user_id', userId)
      .or(`updated_at.gt.${lastSyncISO},started_at.gt.${lastSyncISO}`);
    if (profileId) {
      sessionsQuery = sessionsQuery.or(`local_profile_id.eq.${profileId},local_profile_id.is.null`);
    }
    const { data: sessions, error: sessionsError } = await sessionsQuery;

    if (sessionsError) {
      console.error('Error fetching sessions:', sessionsError);
      return new Response(
        JSON.stringify({ error: 'Failed to fetch workout sessions' }),
        { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } }
      );
    }

    // =========================================================================
    // 5. Fetch child records for matching sessions
    // =========================================================================
    const sessionIds = (sessions ?? []).map((s: Record<string, unknown>) => s.id as string);

    let exercisesRaw: Record<string, unknown>[] = [];
    let setsRaw: Record<string, unknown>[] = [];
    let repSummariesRaw: Record<string, unknown>[] = [];

    if (sessionIds.length > 0) {
      // Exercises for these sessions
      const { data: exercises } = await supabase
        .from('exercises')
        .select('*')
        .in('session_id', sessionIds);
      exercisesRaw = exercises ?? [];

      const exerciseIds = exercisesRaw.map((e) => e.id as string);

      if (exerciseIds.length > 0) {
        // Sets for these exercises
        const { data: sets } = await supabase
          .from('sets')
          .select('*')
          .in('exercise_id', exerciseIds);
        setsRaw = sets ?? [];

        const setIds = setsRaw.map((s) => s.id as string);

        if (setIds.length > 0) {
          // Rep summaries for these sets
          const { data: repSums } = await supabase
            .from('rep_summaries')
            .select('*')
            .in('set_id', setIds);
          repSummariesRaw = repSums ?? [];
        }
      }
    }

    // =========================================================================
    // 6. Assemble nested session hierarchy
    // =========================================================================

    // Group rep summaries by set_id
    const repSummariesBySetId = new Map<string, Record<string, unknown>[]>();
    for (const rs of repSummariesRaw) {
      const setId = rs.set_id as string;
      if (!repSummariesBySetId.has(setId)) {
        repSummariesBySetId.set(setId, []);
      }
      repSummariesBySetId.get(setId)!.push(rs);
    }

    // Group sets by exercise_id, attach repSummaries
    const setsByExerciseId = new Map<string, Record<string, unknown>[]>();
    for (const s of setsRaw) {
      const exerciseId = s.exercise_id as string;
      if (!setsByExerciseId.has(exerciseId)) {
        setsByExerciseId.set(exerciseId, []);
      }
      const setRepSummaries = repSummariesBySetId.get(s.id as string) ?? [];
      setsByExerciseId.get(exerciseId)!.push({
        ...s,
        _repSummaries: setRepSummaries,
      });
    }

    // Group exercises by session_id, attach sets
    const exercisesBySessionId = new Map<string, Record<string, unknown>[]>();
    for (const e of exercisesRaw) {
      const sessionId = e.session_id as string;
      if (!exercisesBySessionId.has(sessionId)) {
        exercisesBySessionId.set(sessionId, []);
      }
      const exerciseSets = setsByExerciseId.get(e.id as string) ?? [];
      exercisesBySessionId.get(sessionId)!.push({
        ...e,
        _sets: exerciseSets,
      });
    }

    // Map sessions with nested children → camelCase DTOs
    const sessionDtos = (sessions ?? []).map((ws: Record<string, unknown>) => {
      const wsExercises = exercisesBySessionId.get(ws.id as string) ?? [];
      return {
        id: ws.id,
        userId: ws.user_id,
        name: ws.name,
        startedAt: ws.started_at,
        durationSeconds: ws.duration_seconds,
        totalVolume: ws.total_volume,
        setCount: ws.set_count,
        exerciseCount: ws.exercise_count,
        prCount: ws.pr_count,
        routineName: ws.routine_name,
        workoutMode: ws.workout_mode,
        routineSessionId: ws.routine_session_id,
        // Session enrichment (GAPs 3-6)
        avgVelocityMps: ws.avg_velocity_mps,
        avgAsymmetryPct: ws.avg_asymmetry_pct,
        velocityLossPct: ws.velocity_loss_pct,
        dominantSide: ws.dominant_side,
        strengthProfile: ws.strength_profile,
        formScore: ws.form_score,
        deloadWarnings: ws.deload_warnings,
        romViolations: ws.rom_violations,
        spotterActivations: ws.spotter_activations,
        peakForceN: ws.peak_force_n,
        estimatedCalories: ws.estimated_calories,
        heaviestLiftKg: ws.heaviest_lift_kg,
        eccentricLoad: ws.eccentric_load,
        echoLevel: ws.echo_level,
        warmupReps: ws.warmup_reps,
        workingReps: ws.working_reps,
        exercises: wsExercises.map((ex) => ({
          id: ex.id,
          sessionId: ex.session_id,
          name: ex.name,
          muscleGroup: ex.muscle_group,
          orderIndex: ex.order_index,
          sets: ((ex._sets as Record<string, unknown>[]) ?? []).map((st) => ({
            id: st.id,
            exerciseId: st.exercise_id,
            setNumber: st.set_number,
            targetReps: st.target_reps,
            actualReps: st.actual_reps,
            weightKg: st.weight_kg,
            rpe: st.rpe,
            isPr: st.is_pr,
            notes: st.notes,
            workoutMode: st.workout_mode,
            repSummaries: ((st._repSummaries as Record<string, unknown>[]) ?? []).map((rs) => ({
              id: rs.id,
              setId: rs.set_id,
              repNumber: rs.rep_number,
              meanVelocityMps: rs.mean_velocity_mps,
              peakVelocityMps: rs.peak_velocity_mps,
              meanForceN: rs.mean_force_n,
              peakForceN: rs.peak_force_n,
              powerWatts: rs.power_watts,
              romMm: rs.rom_mm,
              tutMs: rs.tut_ms,
              leftForceAvg: rs.left_force_avg,
              rightForceAvg: rs.right_force_avg,
              asymmetryPct: rs.asymmetry_pct,
              vbtZone: rs.vbt_zone,
            })),
          })),
        })),
      };
    });

    // =========================================================================
    // 7. Fetch routines — delta sync via updated_at (GAP 11 fix)
    // =========================================================================
    let routinesQuery = supabase
      .from('routines')
      .select('*')
      .eq('user_id', userId)
      .gt('updated_at', lastSyncISO);
    if (profileId) {
      routinesQuery = routinesQuery.or(`local_profile_id.eq.${profileId},local_profile_id.is.null`);
    }
    const { data: routinesRaw, error: routinesError } = await routinesQuery;
    if (routinesError) {
      console.error('Error fetching routines:', routinesError);
    }

    const routineIds = (routinesRaw ?? []).map((r: Record<string, unknown>) => r.id as string);

    let routineExercisesRaw: Record<string, unknown>[] = [];
    if (routineIds.length > 0) {
      const { data: re } = await supabase
        .from('routine_exercises')
        .select('*')
        .in('routine_id', routineIds);
      routineExercisesRaw = re ?? [];
    }

    // Group routine exercises by routine_id
    const reByRoutineId = new Map<string, Record<string, unknown>[]>();
    for (const re of routineExercisesRaw) {
      const routineId = re.routine_id as string;
      if (!reByRoutineId.has(routineId)) {
        reByRoutineId.set(routineId, []);
      }
      reByRoutineId.get(routineId)!.push(re);
    }

    const routineDtos = (routinesRaw ?? []).map((r: Record<string, unknown>) => {
      const rExercises = reByRoutineId.get(r.id as string) ?? [];
      return {
        id: r.id,
        userId: r.user_id,
        name: r.name,
        description: r.description,
        exerciseCount: r.exercise_count,
        estimatedDuration: r.estimated_duration,
        timesCompleted: r.times_completed,
        isFavorite: r.is_favorite,
        exercises: rExercises.map((re) => ({
          id: re.id,
          routineId: re.routine_id,
          name: re.name,
          muscleGroup: re.muscle_group,
          sets: re.sets,
          reps: re.reps,
          weight: re.weight,
          restSeconds: re.rest_seconds,
          mode: re.mode,
          orderIndex: re.order_index,
          supersetId: re.superset_id,
          supersetColor: re.superset_color,
          supersetOrder: re.superset_order,
          perSetWeights: re.per_set_weights != null ? JSON.stringify(re.per_set_weights) : null,
          perSetRest: re.per_set_rest != null ? JSON.stringify(re.per_set_rest) : null,
          isAmrap: re.is_amrap,
          prPercentage: re.pr_percentage,
          repCountTiming: re.rep_count_timing,
          stopAtPosition: re.stop_at_position,
          stallDetection: re.stall_detection,
          eccentricLoad: re.eccentric_load,
          echoLevel: re.echo_level,
          perSetEchoLevels: re.per_set_echo_levels ?? null,
          warmupSets: re.warmup_sets ?? null,
        })),
      };
    });

    // =========================================================================
    // 7b. Fetch training cycles — delta sync via updated_at (GAP 11 fix)
    // =========================================================================
    let cyclesQuery = supabase
      .from('training_cycles')
      .select('*')
      .eq('user_id', userId)
      .gt('updated_at', lastSyncISO);
    if (profileId) {
      cyclesQuery = cyclesQuery.or(`local_profile_id.eq.${profileId},local_profile_id.is.null`);
    }
    const { data: cyclesRaw, error: cyclesError } = await cyclesQuery;
    if (cyclesError) {
      console.error('Error fetching cycles:', cyclesError);
    }

    const cycleIds = (cyclesRaw ?? []).map((c: Record<string, unknown>) => c.id as string);

    let cycleDaysRaw: Record<string, unknown>[] = [];
    if (cycleIds.length > 0) {
      const { data: cd } = await supabase
        .from('cycle_days')
        .select('*')
        .in('cycle_id', cycleIds);
      cycleDaysRaw = cd ?? [];
    }

    // Group cycle days by cycle_id
    const daysByCycleId = new Map<string, Record<string, unknown>[]>();
    for (const d of cycleDaysRaw) {
      const cycleId = d.cycle_id as string;
      if (!daysByCycleId.has(cycleId)) {
        daysByCycleId.set(cycleId, []);
      }
      daysByCycleId.get(cycleId)!.push(d);
    }

    const cycleDtos = (cyclesRaw ?? []).map((c: Record<string, unknown>) => {
      const cDays = daysByCycleId.get(c.id as string) ?? [];
      return {
        id: c.id,
        userId: c.user_id,
        name: c.name,
        description: c.description,
        durationWeeks: c.duration_weeks,
        workoutDays: c.workout_days,
        restDays: c.rest_days,
        currentWeek: c.current_week,
        status: c.status,
        startedAt: c.started_at,
        lastUsedAt: c.last_used_at,
        progressionSettings: c.progression_settings != null ? JSON.stringify(c.progression_settings) : null,
        deloadSettings: c.deload_settings != null ? JSON.stringify(c.deload_settings) : null,
        days: cDays.map((d) => ({
          id: d.id,
          cycleId: d.cycle_id,
          dayNumber: d.day_number,
          dayType: d.day_type,
          routineId: d.routine_id,
          weightAdjustment: d.weight_adjustment,
          repModifier: d.rep_modifier,
          restOverride: d.rest_override,
          restType: d.rest_type,
          notes: d.notes,
        })),
      };
    });

    // =========================================================================
    // 7c. Fetch personal records — delta sync with optional profile filter
    // =========================================================================
    let personalRecordsQuery = supabase
      .from('personal_records')
      .select('*')
      .eq('user_id', userId)
      .gt('updated_at', lastSyncISO);
    if (profileId) {
      personalRecordsQuery = personalRecordsQuery.or(`local_profile_id.eq.${profileId},local_profile_id.is.null`);
    }
    const { data: personalRecords, error: personalRecordsError } = await personalRecordsQuery;
    if (personalRecordsError) {
      console.error('Error fetching personal records:', personalRecordsError);
    }

    const personalRecordDtos = (personalRecords ?? []).map((pr: Record<string, unknown>) => ({
      id: pr.id,
      userId: pr.user_id,
      exerciseName: pr.exercise_name,
      muscleGroup: pr.muscle_group,
      recordType: pr.record_type,
      value: pr.value,
      weightKg: pr.weight_kg,
      reps: pr.reps,
      workoutPhase: pr.workout_phase,
      sessionId: pr.session_id,
      achievedAt: pr.achieved_at,
      updatedAt: pr.updated_at,
    }));

    // =========================================================================
    // 8. RPG attributes (delta sync)
    // =========================================================================
    const { data: rpgAttributes } = await supabase
      .from('rpg_attributes')
      .select('*')
      .eq('user_id', userId)
      .gt('updated_at', lastSyncISO)
      .maybeSingle();

    const rpgDto = rpgAttributes
      ? {
          id: rpgAttributes.id,
          userId: rpgAttributes.user_id,
          strength: rpgAttributes.strength,
          power: rpgAttributes.power,
          stamina: rpgAttributes.stamina,
          consistency: rpgAttributes.consistency,
          mastery: rpgAttributes.mastery,
          characterClass: rpgAttributes.character_class,
          level: rpgAttributes.level,
          experiencePoints: rpgAttributes.experience_points,
          updatedAt: rpgAttributes.updated_at,
        }
      : null;

    // =========================================================================
    // 9. Earned badges (delta sync)
    // =========================================================================
    const { data: badges } = await supabase
      .from('earned_badges')
      .select('*')
      .eq('user_id', userId)
      .gt('earned_at', lastSyncISO);

    const badgeDtos = (badges ?? []).map((b: Record<string, unknown>) => ({
      id: b.id,
      userId: b.user_id,
      badgeId: b.badge_id,
      badgeName: b.badge_name,
      badgeDescription: b.badge_description,
      badgeTier: b.badge_tier,
      earnedAt: b.earned_at,
    }));

    // =========================================================================
    // 10. Gamification stats (delta sync)
    // =========================================================================
    const { data: gamificationStats } = await supabase
      .from('gamification_stats')
      .select('*')
      .eq('user_id', userId)
      .gt('updated_at', lastSyncISO)
      .maybeSingle();

    const gamificationDto = gamificationStats
      ? {
          id: gamificationStats.id,
          userId: gamificationStats.user_id,
          totalWorkouts: gamificationStats.total_workouts,
          totalReps: gamificationStats.total_reps,
          totalVolumeKg: gamificationStats.total_volume_kg,
          longestStreak: gamificationStats.longest_streak,
          currentStreak: gamificationStats.current_streak,
          totalTimeSeconds: gamificationStats.total_time_seconds,
          updatedAt: gamificationStats.updated_at,
        }
      : null;

    // =========================================================================
    // 11. Fetch local profiles for the user
    // =========================================================================
    const { data: localProfiles } = await supabase
      .from('local_profiles')
      .select('id, name, color_index, device_id, created_at, updated_at')
      .eq('user_id', userId);

    // =========================================================================
    // 12. Fetch external activities — delta sync via synced_at
    // =========================================================================
    const { data: externalActivities, error: eaError } = await supabase
      .from('external_activities')
      .select('*')
      .eq('user_id', userId)
      .gt('synced_at', lastSyncISO);

    if (eaError) {
      console.error('Error fetching external activities:', eaError);
    }

    const externalActivityDtos = (externalActivities ?? []).map((ea: Record<string, unknown>) => ({
      id: ea.id,
      externalId: ea.external_id,
      provider: ea.provider,
      name: ea.name,
      activityType: ea.activity_type ?? 'strength',
      startedAt: ea.started_at,
      durationSeconds: ea.duration_seconds ?? 0,
      distanceMeters: ea.distance_meters ?? null,
      calories: ea.calories ?? null,
      avgHeartRate: ea.avg_heart_rate ?? null,
      maxHeartRate: ea.max_heart_rate ?? null,
      elevationGainMeters: ea.elevation_gain_meters ?? null,
      rawData: ea.raw_data ? JSON.stringify(ea.raw_data) : null,
      syncedAt: ea.synced_at ?? new Date().toISOString(),
    }));

    // =========================================================================
    // 13. Return assembled response
    // =========================================================================
    const response = {
      syncTime,
      sessions: sessionDtos,
      routines: routineDtos,
      cycles: cycleDtos,
      personalRecords: personalRecordDtos,
      rpgAttributes: rpgDto,
      badges: badgeDtos,
      gamificationStats: gamificationDto,
      localProfiles: localProfiles ?? [],
      externalActivities: externalActivityDtos,
    };

    return new Response(JSON.stringify(response), {
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('Unexpected error in mobile-sync-pull:', err);
    return new Response(
      JSON.stringify({ error: (err as Error).message ?? 'Internal server error' }),
      { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } }
    );
  }
});
