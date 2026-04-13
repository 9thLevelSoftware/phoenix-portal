import { createClient } from 'jsr:@supabase/supabase-js@2';
import { getCorsHeaders } from '../_shared/cors.ts';
import { requireSubscription } from '../_shared/requireSubscription.ts';

// UUID validation regex for input sanitization
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Mobile Sync Pull — returns portal data modified since the client's last sync.
 *
 * POST /functions/v1/mobile-sync-pull
 * Authorization: Bearer <GoTrue JWT>
 * Body: {
 *   deviceId: string,
 *   lastSync: number,
 *   profileId?: string,
 *   cursor?: string,     // Optional: pagination cursor from previous response
 *   pageSize?: number    // Optional: entities per page (default 100, max 500)
 * }
 *
 * Pagination:
 *   - When cursor is absent, starts from the beginning
 *   - When cursor is present, resumes from that position
 *   - Entity types are paged in order: sessions → routines → cycles → badges → stats
 *   - Response includes nextCursor and hasMore for client to loop
 *   - Client should loop until hasMore: false before updating lastSyncTimestamp
 *
 * Backward Compatibility:
 *   - cursor and pageSize are optional with sensible defaults
 *   - Existing clients without pagination continue to work
 *
 * Returns:
 *   {
 *     syncTime: number,
 *     nextCursor?: string,  // Present if hasMore is true
 *     hasMore: boolean,     // True if more pages remain
 *     sessions: [...],      // Nested: exercises → sets → repSummaries
 *     routines: [...],      // Nested: exercises
 *     cycles: [...],        // Nested: days
 *     personalRecords: [...],
 *     rpgAttributes: {...} | null,
 *     badges: [...],
 *     gamificationStats: {...} | null,
 *     localProfiles: [...],
 *     externalActivities: [...]
 *   }
 */

interface PullRequest {
  deviceId: string;
  lastSync: number;
  profileId?: string;
  /** Optional cursor for pagination. If absent, starts from beginning. */
  cursor?: string;
  /** Optional page size. Defaults to 100. */
  pageSize?: number;
}

// ─── Pagination Configuration ───────────────────────────────────────

const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 500;

// Entity types in pagination order
type EntityType = 'sessions' | 'routines' | 'cycles' | 'badges' | 'stats';
const ENTITY_ORDER: EntityType[] = ['sessions', 'routines', 'cycles', 'badges', 'stats'];

interface DecodedCursor {
  type: EntityType;
  updatedAt: number; // epoch ms
  id: string;
}

/**
 * Encodes pagination state into an opaque cursor string.
 * Format: base64(JSON({type, updatedAt, id}))
 */
function encodeCursor(type: EntityType, updatedAt: number, id: string): string {
  const payload = JSON.stringify({ type, updatedAt, id });
  // Use btoa for base64 encoding (available in Deno)
  return btoa(payload);
}

/**
 * Decodes a cursor string back to pagination state.
 * Returns null if cursor is invalid or malformed.
 */
function decodeCursor(cursor: string): DecodedCursor | null {
  try {
    const decoded = atob(cursor);
    const parsed = JSON.parse(decoded);
    // Validate structure
    if (
      typeof parsed.type !== 'string' ||
      !ENTITY_ORDER.includes(parsed.type as EntityType) ||
      typeof parsed.updatedAt !== 'number' ||
      typeof parsed.id !== 'string'
    ) {
      return null;
    }
    // Validate cursor ID is a valid UUID to prevent injection
    if (parsed.id && !UUID_REGEX.test(parsed.id)) {
      return null;
    }
    return parsed as DecodedCursor;
  } catch {
    return null;
  }
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
    // SECURITY: Using service role key bypasses Row Level Security.
    // ALL queries MUST include .eq('user_id', userId) for user isolation.
    // Review any new query additions for this requirement.
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // =========================================================================
    // 3. Parse request body with pagination parameters
    // =========================================================================
    const body: PullRequest = await req.json();
    const profileId: string | null = body.profileId ?? null;

    // Validate profileId format to prevent injection attacks
    // Allow "default" as a special case for legacy mobile clients without multi-profile
    if (profileId && profileId !== 'default' && !UUID_REGEX.test(profileId)) {
      return new Response(
        JSON.stringify({ error: 'Invalid profileId format' }),
        { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } }
      );
    }

    const lastSyncISO = new Date(body.lastSync ?? 0).toISOString();
    const syncTime = Date.now();

    // Pagination: parse cursor and pageSize with defaults
    const pageSize = Math.min(body.pageSize ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
    const cursor = body.cursor ? decodeCursor(body.cursor) : null;

    // If cursor is provided but invalid, start fresh (stale cursor handling)
    const startType: EntityType = cursor?.type ?? 'sessions';
    const startTypeIndex = ENTITY_ORDER.indexOf(startType);

    // Track pagination state for response
    let nextCursor: string | null = null;
    let hasMore = false;
    let remainingPageSize = pageSize;

    // Initialize result containers (will be populated as we page through entity types)
    let sessionDtos: Record<string, unknown>[] = [];
    let routineDtos: Record<string, unknown>[] = [];
    let cycleDtos: Record<string, unknown>[] = [];
    let badgeDtos: Record<string, unknown>[] = [];
    let gamificationDto: Record<string, unknown> | null = null;
    let rpgDto: Record<string, unknown> | null = null;
    let personalRecordDtos: Record<string, unknown>[] = [];
    let localProfiles: Record<string, unknown>[] = [];
    let externalActivityDtos: Record<string, unknown>[] = [];

    // =========================================================================
    // 4. Paginated fetch of entities in order: sessions → routines → cycles → badges → stats
    //    We fetch pageSize+1 to detect hasMore, then trim to pageSize.
    // =========================================================================

    // Helper to build cursor condition for stable ordering (updated_at ASC, id ASC)
    function buildCursorCondition(cursorData: DecodedCursor | null, entityType: EntityType): {
      cursorUpdatedAt: string | null;
      cursorId: string | null;
    } {
      if (!cursorData || cursorData.type !== entityType) {
        return { cursorUpdatedAt: null, cursorId: null };
      }
      return {
        cursorUpdatedAt: new Date(cursorData.updatedAt).toISOString(),
        cursorId: cursorData.id,
      };
    }

    // ─── SESSIONS ───────────────────────────────────────────────────────────
    if (startTypeIndex <= ENTITY_ORDER.indexOf('sessions') && remainingPageSize > 0) {
      const { cursorUpdatedAt, cursorId } = buildCursorCondition(cursor, 'sessions');

      // Build base query with stable ordering
      let sessionsQuery = supabase
        .from('workout_sessions')
        .select('*')
        .eq('user_id', userId)
        .or(`updated_at.gt.${lastSyncISO},started_at.gt.${lastSyncISO}`)
        .order('updated_at', { ascending: true })
        .order('id', { ascending: true })
        .limit(remainingPageSize + 1); // +1 to detect hasMore

      if (profileId) {
        sessionsQuery = sessionsQuery.or(`local_profile_id.eq.${profileId},local_profile_id.is.null`);
      }

      // Apply cursor condition if resuming within sessions
      if (cursorUpdatedAt && cursorId) {
        // Composite cursor: (updated_at, id) > (cursorUpdatedAt, cursorId)
        sessionsQuery = sessionsQuery.or(
          `updated_at.gt.${cursorUpdatedAt},and(updated_at.eq.${cursorUpdatedAt},id.gt.${cursorId})`
        );
      }

      const { data: sessions, error: sessionsError } = await sessionsQuery;

      if (sessionsError) {
        console.error('Error fetching sessions:', sessionsError);
        return new Response(
          JSON.stringify({ error: 'Failed to fetch workout sessions' }),
          { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } }
        );
      }

      const sessionsRaw = sessions ?? [];

      // Check if there are more sessions
      if (sessionsRaw.length > remainingPageSize) {
        hasMore = true;
        const lastSession = sessionsRaw[remainingPageSize - 1];
        const updatedAtRaw = lastSession.updated_at ?? lastSession.started_at;
        const updatedAtMs = updatedAtRaw ? new Date(updatedAtRaw as string).getTime() : Date.now();
        nextCursor = encodeCursor('sessions', updatedAtMs, lastSession.id as string);
        sessionsRaw.splice(remainingPageSize); // Trim to pageSize
      }

      // Fetch child records for sessions in this page
      const sessionIds = sessionsRaw.map((s: Record<string, unknown>) => s.id as string);
      let exercisesRaw: Record<string, unknown>[] = [];
      let setsRaw: Record<string, unknown>[] = [];
      let repSummariesRaw: Record<string, unknown>[] = [];

      if (sessionIds.length > 0) {
        const { data: exercises } = await supabase
          .from('exercises')
          .select('*')
          .in('session_id', sessionIds);
        exercisesRaw = exercises ?? [];

        const exerciseIds = exercisesRaw.map((e) => e.id as string);

        if (exerciseIds.length > 0) {
          const { data: sets } = await supabase
            .from('sets')
            .select('*')
            .in('exercise_id', exerciseIds);
          setsRaw = sets ?? [];

          const setIds = setsRaw.map((s) => s.id as string);

          if (setIds.length > 0) {
            const { data: repSums } = await supabase
              .from('rep_summaries')
              .select('*')
              .in('set_id', setIds);
            repSummariesRaw = repSums ?? [];
          }
        }
      }

      // Assemble nested session hierarchy
      const repSummariesBySetId = new Map<string, Record<string, unknown>[]>();
      for (const rs of repSummariesRaw) {
        const setId = rs.set_id as string;
        if (!repSummariesBySetId.has(setId)) {
          repSummariesBySetId.set(setId, []);
        }
        repSummariesBySetId.get(setId)!.push(rs);
      }

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

      sessionDtos = sessionsRaw.map((ws: Record<string, unknown>) => {
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

      remainingPageSize -= sessionDtos.length;
    }

    // ─── ROUTINES ───────────────────────────────────────────────────────────
    if (!hasMore && startTypeIndex <= ENTITY_ORDER.indexOf('routines') && remainingPageSize > 0) {
      const { cursorUpdatedAt, cursorId } = buildCursorCondition(cursor, 'routines');

      let routinesQuery = supabase
        .from('routines')
        .select('*')
        .eq('user_id', userId)
        .gt('updated_at', lastSyncISO)
        .order('updated_at', { ascending: true })
        .order('id', { ascending: true })
        .limit(remainingPageSize + 1);

      if (profileId) {
        routinesQuery = routinesQuery.or(`local_profile_id.eq.${profileId},local_profile_id.is.null`);
      }

      if (cursorUpdatedAt && cursorId) {
        routinesQuery = routinesQuery.or(
          `updated_at.gt.${cursorUpdatedAt},and(updated_at.eq.${cursorUpdatedAt},id.gt.${cursorId})`
        );
      }

      const { data: routinesRaw, error: routinesError } = await routinesQuery;
      if (routinesError) {
        console.error('Error fetching routines:', routinesError);
      }

      const routinesData = routinesRaw ?? [];

      if (routinesData.length > remainingPageSize) {
        hasMore = true;
        const lastRoutine = routinesData[remainingPageSize - 1];
        const updatedAtMs = new Date(lastRoutine.updated_at as string).getTime();
        nextCursor = encodeCursor('routines', updatedAtMs, lastRoutine.id as string);
        routinesData.splice(remainingPageSize);
      }

      // Fetch routine exercises
      const routineIds = routinesData.map((r: Record<string, unknown>) => r.id as string);
      let routineExercisesRaw: Record<string, unknown>[] = [];
      if (routineIds.length > 0) {
        const { data: re } = await supabase
          .from('routine_exercises')
          .select('*')
          .in('routine_id', routineIds);
        routineExercisesRaw = re ?? [];
      }

      const reByRoutineId = new Map<string, Record<string, unknown>[]>();
      for (const re of routineExercisesRaw) {
        const routineId = re.routine_id as string;
        if (!reByRoutineId.has(routineId)) {
          reByRoutineId.set(routineId, []);
        }
        reByRoutineId.get(routineId)!.push(re);
      }

      routineDtos = routinesData.map((r: Record<string, unknown>) => {
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

      remainingPageSize -= routineDtos.length;
    }

    // ─── CYCLES ─────────────────────────────────────────────────────────────
    if (!hasMore && startTypeIndex <= ENTITY_ORDER.indexOf('cycles') && remainingPageSize > 0) {
      const { cursorUpdatedAt, cursorId } = buildCursorCondition(cursor, 'cycles');

      let cyclesQuery = supabase
        .from('training_cycles')
        .select('*')
        .eq('user_id', userId)
        .gt('updated_at', lastSyncISO)
        .order('updated_at', { ascending: true })
        .order('id', { ascending: true })
        .limit(remainingPageSize + 1);

      if (profileId) {
        cyclesQuery = cyclesQuery.or(`local_profile_id.eq.${profileId},local_profile_id.is.null`);
      }

      if (cursorUpdatedAt && cursorId) {
        cyclesQuery = cyclesQuery.or(
          `updated_at.gt.${cursorUpdatedAt},and(updated_at.eq.${cursorUpdatedAt},id.gt.${cursorId})`
        );
      }

      const { data: cyclesRaw, error: cyclesError } = await cyclesQuery;
      if (cyclesError) {
        console.error('Error fetching cycles:', cyclesError);
      }

      const cyclesData = cyclesRaw ?? [];

      if (cyclesData.length > remainingPageSize) {
        hasMore = true;
        const lastCycle = cyclesData[remainingPageSize - 1];
        const updatedAtMs = new Date(lastCycle.updated_at as string).getTime();
        nextCursor = encodeCursor('cycles', updatedAtMs, lastCycle.id as string);
        cyclesData.splice(remainingPageSize);
      }

      // Fetch cycle days
      const cycleIds = cyclesData.map((c: Record<string, unknown>) => c.id as string);
      let cycleDaysRaw: Record<string, unknown>[] = [];
      if (cycleIds.length > 0) {
        const { data: cd } = await supabase
          .from('cycle_days')
          .select('*')
          .in('cycle_id', cycleIds);
        cycleDaysRaw = cd ?? [];
      }

      const daysByCycleId = new Map<string, Record<string, unknown>[]>();
      for (const d of cycleDaysRaw) {
        const cycleId = d.cycle_id as string;
        if (!daysByCycleId.has(cycleId)) {
          daysByCycleId.set(cycleId, []);
        }
        daysByCycleId.get(cycleId)!.push(d);
      }

      cycleDtos = cyclesData.map((c: Record<string, unknown>) => {
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

      remainingPageSize -= cycleDtos.length;
    }

    // ─── BADGES ─────────────────────────────────────────────────────────────
    if (!hasMore && startTypeIndex <= ENTITY_ORDER.indexOf('badges') && remainingPageSize > 0) {
      const { cursorUpdatedAt, cursorId } = buildCursorCondition(cursor, 'badges');

      let badgesQuery = supabase
        .from('earned_badges')
        .select('*')
        .eq('user_id', userId)
        .gt('earned_at', lastSyncISO)
        .order('earned_at', { ascending: true })
        .order('id', { ascending: true })
        .limit(remainingPageSize + 1);

      if (cursorUpdatedAt && cursorId) {
        badgesQuery = badgesQuery.or(
          `earned_at.gt.${cursorUpdatedAt},and(earned_at.eq.${cursorUpdatedAt},id.gt.${cursorId})`
        );
      }

      const { data: badges } = await badgesQuery;
      const badgesData = badges ?? [];

      if (badgesData.length > remainingPageSize) {
        hasMore = true;
        const lastBadge = badgesData[remainingPageSize - 1];
        const earnedAtMs = new Date(lastBadge.earned_at as string).getTime();
        nextCursor = encodeCursor('badges', earnedAtMs, lastBadge.id as string);
        badgesData.splice(remainingPageSize);
      }

      badgeDtos = badgesData.map((b: Record<string, unknown>) => ({
        id: b.id,
        userId: b.user_id,
        badgeId: b.badge_id,
        badgeName: b.badge_name,
        badgeDescription: b.badge_description,
        badgeTier: b.badge_tier,
        earnedAt: b.earned_at,
      }));

      remainingPageSize -= badgeDtos.length;
    }

    // ─── STATS (RPG + Gamification) ─────────────────────────────────────────
    // Stats are singleton records per user, so we fetch them on the final page
    if (!hasMore && startTypeIndex <= ENTITY_ORDER.indexOf('stats')) {
      // RPG attributes (delta sync)
      const { data: rpgAttributes } = await supabase
        .from('rpg_attributes')
        .select('*')
        .eq('user_id', userId)
        .gt('updated_at', lastSyncISO)
        .maybeSingle();

      rpgDto = rpgAttributes
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

      // Gamification stats (delta sync)
      const { data: gamificationStats } = await supabase
        .from('gamification_stats')
        .select('*')
        .eq('user_id', userId)
        .gt('updated_at', lastSyncISO)
        .maybeSingle();

      gamificationDto = gamificationStats
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

      // Personal records (always fetched on final page)
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

      personalRecordDtos = (personalRecords ?? []).map((pr: Record<string, unknown>) => ({
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

      // Local profiles (always included on final page)
      const { data: profilesData } = await supabase
        .from('local_profiles')
        .select('id, name, color_index, device_id, created_at, updated_at')
        .eq('user_id', userId);
      // Transform to camelCase for mobile DTO compatibility
      localProfiles = (profilesData ?? []).map((p: Record<string, unknown>) => ({
        id: p.id,
        name: p.name,
        colorIndex: p.color_index,
      }));

      // External activities (paid users only, final page)
      const subGate = await requireSubscription(supabase, userId, 'EMBER', cors);
      if (subGate.allowed) {
        const { data: externalActivitiesRaw } = await supabase
          .from('external_activities')
          .select('*')
          .eq('user_id', userId)
          .gt('synced_at', lastSyncISO);

        externalActivityDtos = (externalActivitiesRaw ?? []).map((a: Record<string, unknown>) => ({
          id: a.id,
          externalId: a.external_id,
          provider: a.provider,
          name: a.name,
          activityType: a.activity_type,
          startedAt: a.started_at,
          durationSeconds: a.duration_seconds,
          distanceMeters: a.distance_meters,
          calories: a.calories,
          avgHeartRate: a.avg_heart_rate,
          maxHeartRate: a.max_heart_rate,
          elevationGainMeters: a.elevation_gain_meters,
          rawData: a.raw_data != null ? JSON.stringify(a.raw_data) : null,
        }));
      }
    }

    // =========================================================================
    // 6. Return paginated response with cursor metadata
    // =========================================================================
    const response = {
      syncTime,
      // Pagination metadata (optional for backward compatibility)
      nextCursor: nextCursor ?? undefined,
      hasMore,
      // Entity data
      sessions: sessionDtos,
      routines: routineDtos,
      cycles: cycleDtos,
      personalRecords: personalRecordDtos,
      rpgAttributes: rpgDto,
      badges: badgeDtos,
      gamificationStats: gamificationDto,
      localProfiles: localProfiles,
      externalActivities: externalActivityDtos,
    };

    return new Response(JSON.stringify(response), {
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('mobile-sync-pull error:', err);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } }
    );
  }
});
