import { createClient } from 'jsr:@supabase/supabase-js@2';
import { getCorsHeaders } from '../_shared/cors.ts';
import { checkRateLimit } from '../_shared/rateLimit.ts';
import { requireSubscription } from '../_shared/requireSubscription.ts';
import { SYNC_LWW_ENABLED } from '../_shared/flags.ts';

/**
 * Per-row rejection record returned to the mobile client when an LWW RPC
 * declines an incoming row because the server already has a newer copy.
 * Mobile logs these and repairs convergence on the next pull. See audit
 * item #1 resolution in phoenix-portal/docs/dto-drift-matrix.md.
 */
interface EntityRejection {
  id: string;
  serverUpdatedAt: string | null;
}

/** Row shape returned by every `upsert_<entity>_lww` function (Phase 3.1). */
interface LwwUpsertRow {
  id: string;
  accepted: boolean;
  server_updated_at: string | null;
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Prevent cross-user takeover when upserting by primary key only.
 *
 * For tables with a direct `user_id` column, this checks that any existing
 * rows with the supplied ids are either absent or owned by `userId`.
 * Returns a 400 Response on violation, or null when safe to proceed.
 */
async function assertRowsOwnedByUser(
  supabase: ReturnType<typeof createClient>,
  table: string,
  ids: string[],
  userId: string,
  cors: Record<string, string>,
): Promise<Response | null> {
  const unique = [...new Set(ids)].filter(Boolean);
  const chunkSize = 100;
  for (let i = 0; i < unique.length; i += chunkSize) {
    const chunk = unique.slice(i, i + chunkSize);
    const { data: rows, error } = await supabase
      .from(table)
      .select('id')
      .in('id', chunk)
      .neq('user_id', userId);
    if (error) {
      // Fail closed — if the ownership probe itself errors (e.g. missing
      // column), we must not proceed with an upsert that could overwrite a
      // victim row. Surface as 500 so the caller retries / we notice.
      throw new Error(`Ownership check on ${table} failed: ${error.message}`);
    }
    if (rows && rows.length > 0) {
      return new Response(
        JSON.stringify({ error: `Refused: existing ${table} row belongs to another user` }),
        { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } },
      );
    }
  }
  return null;
}

/**
 * Prevent cross-user takeover for child tables whose ownership flows through
 * a parent FK (the child has no direct `user_id` column). Resolves the parent
 * ids for any existing child rows and checks ownership against the parent
 * table's `user_id` column.
 */
async function assertChildRowsOwnedViaParent(
  supabase: ReturnType<typeof createClient>,
  childTable: string,
  childFkColumn: string,
  parentTable: string,
  ids: string[],
  userId: string,
  cors: Record<string, string>,
): Promise<Response | null> {
  const unique = [...new Set(ids)].filter(Boolean);
  if (unique.length === 0) return null;
  const chunkSize = 100;
  for (let i = 0; i < unique.length; i += chunkSize) {
    const chunk = unique.slice(i, i + chunkSize);
    const { data: childRows, error: childErr } = await supabase
      .from(childTable)
      .select(`id, ${childFkColumn}`)
      .in('id', chunk);
    if (childErr) {
      throw new Error(`Ownership check on ${childTable} failed: ${childErr.message}`);
    }
    if (!childRows || childRows.length === 0) continue;
    const parentIds = [
      ...new Set(
        childRows
          .map((r) => (r as Record<string, unknown>)[childFkColumn])
          .filter((v): v is string => typeof v === 'string' && v.length > 0),
      ),
    ];
    if (parentIds.length === 0) continue;
    const { data: foreignParents, error: parentErr } = await supabase
      .from(parentTable)
      .select('id')
      .in('id', parentIds)
      .neq('user_id', userId);
    if (parentErr) {
      throw new Error(`Ownership check on ${parentTable} failed: ${parentErr.message}`);
    }
    if (foreignParents && foreignParents.length > 0) {
      return new Response(
        JSON.stringify({
          error: `Refused: existing ${childTable} row belongs to another user`,
        }),
        { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } },
      );
    }
  }
  return null;
}

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

interface LocalProfileDto {
  id: string;
  name: string;
  colorIndex: number;
}

interface ExternalActivityDto {
  id?: string;
  externalId: string;
  provider: string;
  name: string;
  activityType: string;
  startedAt: string;
  durationSeconds: number;
  distanceMeters?: number | null;
  calories?: number | null;
  avgHeartRate?: number | null;
  maxHeartRate?: number | null;
  elevationGainMeters?: number | null;
  rawData?: string | null;
  syncedAt?: string;
}

/**
 * Acknowledgement returned to mobile after an external_activity upsert so the
 * client can reconcile server-assigned metadata (e.g. updated_at) back onto
 * its local row. `localId` and `serverId` are both the same mobile-minted
 * UUID in steady state; they are kept as separate fields to allow for any
 * future server-side id remapping without another wire break.
 *
 * Resolves audit items #5 and #10 (2026-04-19).
 */
interface ExternalActivityAckDto {
  localId: string;
  serverId: string;
  externalId: string;
  provider: string;
  updatedAt: string;
}

interface PushPayload {
  deviceId: string;
  platform: string;
  lastSync: number;
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
  externalActivities?: ExternalActivityDto[] | null;
  profileId?: string | null;
  profileName?: string | null;
  allProfiles?: LocalProfileDto[] | null;
}

interface SessionDto {
  id: string;
  userId: string;
  name: string | null;
  startedAt: string;
  /**
   * Client-canonical last-write timestamp (ISO 8601). Consumed by the LWW
   * RPC when SYNC_LWW_ENABLED=true. Optional for backward compat with
   * pre-LWW mobile builds — server falls back to NOW() when missing.
   * Resolves audit item #1.
   */
  updatedAt?: string | null;
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
  /** ISO 8601 last-write timestamp for LWW gate. Optional for backward compat. */
  updatedAt?: string | null;
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
  isBodyweight: boolean;
  prPercentage: number | null;
  repCountTiming: string | null;
  stopAtPosition: string | null;
  stallDetection: boolean;
  eccentricLoad: string | null;
  echoLevel: string | null;
  perSetEchoLevels: string | null;
  warmupSets: string | null;
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
  /** ISO 8601 last-write timestamp for LWW gate. Optional for backward compat. */
  updatedAt?: string | null;
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
    // 3. Parse request body with size validation
    // =========================================================================
    // Validate payload size (max 10MB to prevent abuse)
    const contentLength = req.headers.get('content-length');
    if (contentLength && parseInt(contentLength) > 10 * 1024 * 1024) {
      return new Response(
        JSON.stringify({ error: 'Payload too large. Maximum size is 10MB.' }),
        { status: 413, headers: { ...cors, 'Content-Type': 'application/json' } }
      );
    }

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

    // Validate array sizes to prevent memory exhaustion
    const MAX_ARRAY_SIZE = 10000;
    if (payload.sessions && payload.sessions.length > MAX_ARRAY_SIZE) {
      return new Response(
        JSON.stringify({ error: `Too many sessions. Maximum is ${MAX_ARRAY_SIZE}.` }),
        { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } }
      );
    }
    if (payload.telemetry && payload.telemetry.length > MAX_ARRAY_SIZE) {
      return new Response(
        JSON.stringify({ error: `Too many telemetry items. Maximum is ${MAX_ARRAY_SIZE}.` }),
        { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } }
      );
    }
    if (payload.routines && payload.routines.length > MAX_ARRAY_SIZE) {
      return new Response(
        JSON.stringify({ error: `Too many routines. Maximum is ${MAX_ARRAY_SIZE}.` }),
        { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } }
      );
    }
    // fix(audit #6): align cycles cap with sessions/routines/telemetry (10000).
    // Prior 1000 cap was a silent cliff for users with large cycle histories.
    if (payload.cycles && payload.cycles.length > MAX_ARRAY_SIZE) {
      return new Response(
        JSON.stringify({ error: `Too many cycles. Maximum is ${MAX_ARRAY_SIZE}.` }),
        { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } }
      );
    }

    // =========================================================================
    // 3b. Sync local profiles
    // =========================================================================
    const localProfileId: string | null = payload.profileId ?? null;
    const allProfiles: LocalProfileDto[] | null = payload.allProfiles ?? null;

    if (allProfiles && allProfiles.length > 0) {
      for (const p of allProfiles) {
        if (!UUID_REGEX.test(p.id)) {
          return new Response(
            JSON.stringify({ error: 'Invalid local profile id' }),
            { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } },
          );
        }
      }
      // Upsert all profiles from the device
      const profileRows = allProfiles.map((p) => ({
        user_id: userId,
        id: p.id,
        name: p.name,
        color_index: p.colorIndex,
        device_id: payload.deviceId,
        updated_at: new Date().toISOString(),
      }));

      const { error: upsertError } = await supabase
        .from('local_profiles')
        .upsert(profileRows, { onConflict: 'user_id,id' });

      if (upsertError) {
        console.warn('Failed to upsert local profiles:', upsertError.message);
      }

      // Delete profiles that no longer exist on the device (from this device only)
      const activeIds = allProfiles.map((p) => p.id);
      const { error: deleteError } = await supabase
        .from('local_profiles')
        .delete()
        .eq('user_id', userId)
        .eq('device_id', payload.deviceId)
        .not(
          'id',
          'in',
          `(${activeIds.map((id) => `"${id}"`).join(',')})`,
        );

      if (deleteError) {
        console.warn('Failed to clean stale profiles:', deleteError.message);
      }
    } else if (localProfileId && payload.profileName) {
      // Fallback for older clients: upsert just the active profile
      const { error: profileError } = await supabase
        .from('local_profiles')
        .upsert(
          {
            user_id: userId,
            id: localProfileId,
            name: payload.profileName,
            device_id: payload.deviceId,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'user_id,id' }
        );

      if (profileError) {
        console.warn('Failed to upsert local profile:', profileError.message);
      }
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
    let externalActivitiesUpserted = 0;

    // =========================================================================
    // 3c. Cross-user takeover protection
    //
    // The service-role client used below bypasses RLS, so we must verify
    // up-front that every client-supplied primary key either doesn't exist
    // yet or is already owned by the authenticated user. Also enforce that
    // child rows reference parents from this same payload — otherwise an
    // attacker could attach their rows to a victim's parent row.
    // =========================================================================
    const allSessionIds = (payload.sessions ?? []).map((s) => s.id);
    const allExerciseIds = (payload.sessions ?? []).flatMap((s) =>
      s.exercises.map((e) => e.id),
    );
    const allSetIds = (payload.sessions ?? []).flatMap((s) =>
      s.exercises.flatMap((e) => e.sets.map((st) => st.id)),
    );
    const allRepSummaryIds = (payload.sessions ?? []).flatMap((s) =>
      s.exercises.flatMap((e) => e.sets.flatMap((st) => st.repSummaries.map((r) => r.id))),
    );
    const allTelemetryIds = (payload.telemetry ?? []).map((t) => t.id);
    const allRoutineIds = (payload.routines ?? []).map((r) => r.id);
    const allRoutineExerciseIds = (payload.routines ?? []).flatMap((r) =>
      r.exercises.map((e) => e.id),
    );
    const allCycleIds = (payload.cycles ?? []).map((c) => c.id);
    const allCycleDayIds = (payload.cycles ?? []).flatMap((c) => c.days.map((d) => d.id));
    const sessionIdSet = new Set(allSessionIds);
    const exerciseIdSet = new Set(allExerciseIds);
    const setIdSet = new Set(allSetIds);
    const routineIdSet = new Set(allRoutineIds);
    const cycleIdSet = new Set(allCycleIds);

    const fkMismatchResponse = (msg: string): Response =>
      new Response(
        JSON.stringify({ error: `FK mismatch in payload: ${msg}` }),
        { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } },
      );

    for (const s of payload.sessions ?? []) {
      for (const e of s.exercises) {
        if (e.sessionId !== s.id) {
          return fkMismatchResponse(`exercise ${e.id} sessionId must equal parent session ${s.id}`);
        }
        for (const st of e.sets) {
          if (st.exerciseId !== e.id) {
            return fkMismatchResponse(`set ${st.id} exerciseId must equal parent exercise ${e.id}`);
          }
          for (const r of st.repSummaries) {
            if (r.setId !== st.id) {
              return fkMismatchResponse(`rep_summary ${r.id} setId must equal parent set ${st.id}`);
            }
          }
        }
      }
    }
    for (const r of payload.routines ?? []) {
      for (const e of r.exercises) {
        if (e.routineId !== r.id) {
          return fkMismatchResponse(
            `routine_exercise ${e.id} routineId must equal parent routine ${r.id}`,
          );
        }
      }
    }
    for (const c of payload.cycles ?? []) {
      for (const d of c.days) {
        if (d.cycleId !== c.id) {
          return fkMismatchResponse(
            `cycle_day ${d.id} cycleId must equal parent cycle ${c.id}`,
          );
        }
      }
    }

    // Direct-id ownership checks against tables with a user_id column
    const directOwnerChecks: Array<[string, string[]]> = [
      ['workout_sessions', allSessionIds],
      ['exercises', allExerciseIds],
      ['sets', allSetIds],
      ['rep_summaries', allRepSummaryIds],
      ['rep_telemetry', allTelemetryIds],
      ['routines', allRoutineIds],
      ['training_cycles', allCycleIds],
    ];
    for (const [table, ids] of directOwnerChecks) {
      const blocked = await assertRowsOwnedByUser(supabase, table, ids, userId, cors);
      if (blocked) return blocked;
    }

    // Parent-FK ownership checks for tables without a user_id column
    const reBlocked = await assertChildRowsOwnedViaParent(
      supabase,
      'routine_exercises',
      'routine_id',
      'routines',
      allRoutineExerciseIds,
      userId,
      cors,
    );
    if (reBlocked) return reBlocked;

    const cdBlocked = await assertChildRowsOwnedViaParent(
      supabase,
      'cycle_days',
      'cycle_id',
      'training_cycles',
      allCycleDayIds,
      userId,
      cors,
    );
    if (cdBlocked) return cdBlocked;

    // Telemetry, phase stats, signatures and assessments may reference parent
    // rows from previous pushes, not this payload. Validate those cross-payload
    // parent references against the authoritative user_id column on each parent.
    const telemetrySetIdsToVerify = (payload.telemetry ?? [])
      .map((t) => t.setId)
      .filter((sid) => !setIdSet.has(sid));
    const telParentBlocked = await assertRowsOwnedByUser(
      supabase,
      'sets',
      telemetrySetIdsToVerify,
      userId,
      cors,
    );
    if (telParentBlocked) return telParentBlocked;

    const phaseSessionIdsToVerify = (payload.phaseStatistics ?? [])
      .map((p) => p.sessionId)
      .filter((sid) => !sessionIdSet.has(sid));
    const phaseParentBlocked = await assertRowsOwnedByUser(
      supabase,
      'workout_sessions',
      phaseSessionIdsToVerify,
      userId,
      cors,
    );
    if (phaseParentBlocked) return phaseParentBlocked;

    const sigExerciseIdsToVerify = (payload.exerciseSignatures ?? [])
      .map((es) => es.exerciseId)
      .filter((eid) => !exerciseIdSet.has(eid));
    const sigParentBlocked = await assertRowsOwnedByUser(
      supabase,
      'exercises',
      sigExerciseIdsToVerify,
      userId,
      cors,
    );
    if (sigParentBlocked) return sigParentBlocked;

    const assessExerciseIdsToVerify = (payload.assessments ?? [])
      .map((a) => a.exerciseId)
      .filter((eid) => !exerciseIdSet.has(eid));
    const assessParentBlocked = await assertRowsOwnedByUser(
      supabase,
      'exercises',
      assessExerciseIdsToVerify,
      userId,
      cors,
    );
    if (assessParentBlocked) return assessParentBlocked;

    const dayRoutineIdsToVerify = (payload.cycles ?? [])
      .flatMap((c) => c.days.map((d) => d.routineId))
      .filter((rid): rid is string => typeof rid === 'string' && rid.length > 0 && !routineIdSet.has(rid));
    const dayRoutineBlocked = await assertRowsOwnedByUser(
      supabase,
      'routines',
      dayRoutineIdsToVerify,
      userId,
      cors,
    );
    if (dayRoutineBlocked) return dayRoutineBlocked;

    const sessionRoutineIdsToVerify = (payload.sessions ?? [])
      .map((s) => s.routineSessionId)
      .filter((rid): rid is string => typeof rid === 'string' && rid.length > 0 && !routineIdSet.has(rid));
    const sessionRoutineBlocked = await assertRowsOwnedByUser(
      supabase,
      'routines',
      sessionRoutineIdsToVerify,
      userId,
      cors,
    );
    if (sessionRoutineBlocked) return sessionRoutineBlocked;

    // =========================================================================
    // LWW reject tracking. When SYNC_LWW_ENABLED is false, these remain empty
    // and no filtering is applied. When true, the push handler routes each
    // shared-edit entity upsert through its `upsert_<entity>_lww` RPC and
    // uses the accepted-id sets to filter child-table upserts so orphan child
    // rows are not created under rejected parents.
    // =========================================================================
    const rejections = {
      sessions: [] as EntityRejection[],
      routines: [] as EntityRejection[],
      cycles: [] as EntityRejection[],
      externalActivities: [] as EntityRejection[],
      rpgAttributes: [] as EntityRejection[],
      gamificationStats: [] as EntityRejection[],
    };
    // null = flag OFF (accept-all semantics). Set = flag ON (only listed IDs
    // cleared the LWW gate).
    let acceptedSessionIds: Set<string> | null = null;
    let acceptedRoutineIds: Set<string> | null = null;
    let acceptedCycleIds: Set<string> | null = null;

    const childAllowed = <T>(parentSet: Set<string> | null, parentId: string): boolean =>
      parentSet === null || parentSet.has(parentId);

    // =========================================================================
    // 4. Insert workout hierarchy in FK order
    // =========================================================================
    if (payload.sessions && payload.sessions.length > 0) {
      // --- 4a. Upsert workout_sessions ---
      const sessionRows = payload.sessions.map((s) => ({
        id: s.id,
        user_id: userId,
        local_profile_id: localProfileId,
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
        updated_at: s.updatedAt ?? null,
      }));

      if (SYNC_LWW_ENABLED) {
        // Phase 3.2: route through the LWW RPC so the server rejects stale
        // rows instead of overwriting with older data. Accepted ids are used
        // to filter the exercises/sets/rep_summaries child upserts below.
        // Fallback to NOW() when the client DTO omits updated_at (older
        // mobile builds pre-Phase-3.2).
        const sessionRowsWithUpdatedAt = sessionRows.map((r) => ({
          ...r,
          updated_at: r.updated_at ?? new Date().toISOString(),
        }));
        const { data: lwwData, error: lwwErr } = await supabase.rpc(
          'upsert_workout_session_lww',
          { p_rows: sessionRowsWithUpdatedAt },
        );
        if (lwwErr) throw new Error(`workout_sessions LWW RPC failed: ${lwwErr.message}`);
        acceptedSessionIds = new Set<string>();
        for (const r of (lwwData ?? []) as LwwUpsertRow[]) {
          if (r.accepted) acceptedSessionIds.add(r.id);
          else rejections.sessions.push({ id: r.id, serverUpdatedAt: r.server_updated_at });
        }
        sessionsInserted = acceptedSessionIds.size;
      } else {
        const { error: sessErr } = await supabase
          .from('workout_sessions')
          .upsert(sessionRows, { onConflict: 'id' });
        if (sessErr) throw new Error(`workout_sessions upsert failed: ${sessErr.message}`);
        sessionsInserted = sessionRows.length;
      }

      // --- 4b. Batch upsert exercises ---
      // When LWW is enabled, only accept exercises whose parent session was
      // accepted by the LWW gate. Rejecting the parent but inserting the
      // children would leave orphan rows referencing a stale session.
      const exerciseRows = payload.sessions
        .filter((s) => childAllowed(acceptedSessionIds, s.id))
        .flatMap((s) =>
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
      // NOTE: `prType`, `prPhase`, `prVolume` are intentionally NOT in this row
      // projection. They are send-only derivation hints consumed by the
      // personal_records insert path below; the `sets` table has no columns
      // for them. See PortalSetDto doc comment in mobile for the contract.
      // Resolves audit item #3 (2026-04-19).
      const setRows = payload.sessions
        .filter((s) => childAllowed(acceptedSessionIds, s.id))
        .flatMap((s) =>
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
      const repRows = payload.sessions
        .filter((s) => childAllowed(acceptedSessionIds, s.id))
        .flatMap((s) =>
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
            // cable stored canonically as "A" | "B" from BLE. Do not translate
            // here; UI uses `cableDisplayName()` from src/lib/telemetry-display.ts
            // when a human-readable label is needed. Audit item #4 (2026-04-19).
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
            local_profile_id: localProfileId,
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
                local_profile_id: localProfileId,
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

        const profileTag = localProfileId ?? '__no_profile__';
        const existingPrKeys = new Set(
          (existingPrs ?? []).map((row) => `${profileTag}:${row.exercise_name}:${row.achieved_at}:${row.value}:${row.record_type}:${row.workout_phase ?? 'COMBINED'}`)
        );
        const dedupedPrRows = prRows.filter((row) => {
          const key = `${profileTag}:${row.exercise_name}:${row.achieved_at}:${row.value}:${row.record_type}:${row.workout_phase}`;
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
    // 7. Upsert routines + upsert routine_exercises (safe replace pattern)
    //    Uses upsert-by-PK instead of delete+insert to prevent data loss if
    //    the insert step fails after a successful delete. Orphan exercises
    //    (removed from routine on mobile) are cleaned up after upsert succeeds.
    // =========================================================================
    if (payload.routines && payload.routines.length > 0) {
      const routineRows = payload.routines.map((r) => ({
        id: r.id,
        user_id: userId,
        local_profile_id: localProfileId,
        name: r.name,
        description: r.description,
        exercise_count: r.exerciseCount,
        estimated_duration: Math.round(r.estimatedDuration),
        times_completed: r.timesCompleted,
        is_favorite: r.isFavorite,
        updated_at: r.updatedAt ?? null,
      }));

      if (SYNC_LWW_ENABLED) {
        const rows = routineRows.map((r) => ({
          ...r,
          updated_at: r.updated_at ?? new Date().toISOString(),
        }));
        const { data: lwwData, error: lwwErr } = await supabase.rpc(
          'upsert_routine_lww',
          { p_rows: rows },
        );
        if (lwwErr) throw new Error(`routines LWW RPC failed: ${lwwErr.message}`);
        acceptedRoutineIds = new Set<string>();
        for (const rr of (lwwData ?? []) as LwwUpsertRow[]) {
          if (rr.accepted) acceptedRoutineIds.add(rr.id);
          else rejections.routines.push({ id: rr.id, serverUpdatedAt: rr.server_updated_at });
        }
        routinesUpserted = acceptedRoutineIds.size;
      } else {
        const { error: routErr } = await supabase
          .from('routines')
          .upsert(routineRows, { onConflict: 'id' });
        if (routErr) throw new Error(`routines upsert failed: ${routErr.message}`);
        routinesUpserted = routineRows.length;
      }

      // Upsert exercises by primary key (id). Each exercise has a stable UUID
      // generated on mobile, so onConflict: 'id' safely updates existing rows.
      // When LWW is enabled, skip children of routines whose parent was
      // rejected to avoid orphan FK rows.
      const reRows = payload.routines
        .filter((r) => childAllowed(acceptedRoutineIds, r.id))
        .flatMap((r) =>
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
          is_bodyweight: e.isBodyweight,
          pr_percentage: e.prPercentage,
          rep_count_timing: e.repCountTiming,
          stop_at_position: e.stopAtPosition,
          stall_detection: e.stallDetection,
          eccentric_load: e.eccentricLoad,
          echo_level: e.echoLevel,
          per_set_echo_levels: e.perSetEchoLevels ?? null,
          warmup_sets: e.warmupSets ?? null,
        }))
      );

      if (reRows.length > 0) {
        const { error: reErr } = await supabase
          .from('routine_exercises')
          .upsert(reRows, { onConflict: 'id' });
        if (reErr) throw new Error(`routine_exercises upsert failed: ${reErr.message}`);
      }

      // Remove orphan exercises: rows belonging to synced routines whose IDs
      // are not in the current payload. This handles exercises deleted on mobile.
      const syncedExerciseIds = reRows.map((r) => r.id);
      const routineIds = payload.routines.map((r) => r.id);
      for (const routineId of routineIds) {
        const idsForRoutine = syncedExerciseIds.length > 0
          ? reRows.filter((r) => r.routine_id === routineId).map((r) => r.id)
          : [];

        if (idsForRoutine.length > 0) {
          // Delete exercises in this routine that are NOT in the payload
          const { error: orphanErr } = await supabase
            .from('routine_exercises')
            .delete()
            .eq('routine_id', routineId)
            .not('id', 'in', `(${idsForRoutine.join(',')})`);
          if (orphanErr) console.warn(`routine_exercises orphan cleanup warning for ${routineId}:`, orphanErr.message);
        } else {
          // Routine has zero exercises now -- delete all
          const { error: orphanErr } = await supabase
            .from('routine_exercises')
            .delete()
            .eq('routine_id', routineId);
          if (orphanErr) console.warn(`routine_exercises orphan cleanup warning for ${routineId}:`, orphanErr.message);
        }
      }
    }

    // =========================================================================
    // 7b. Upsert training_cycles + upsert cycle_days (safe replace pattern)
    //     cycle_days has UNIQUE(cycle_id, day_number), so upsert on that
    //     constraint instead of delete+insert.
    // =========================================================================
    if (payload.cycles && payload.cycles.length > 0) {
      const cycleRows = payload.cycles.map((c) => ({
        id: c.id,
        user_id: userId,
        local_profile_id: localProfileId,
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
        updated_at: c.updatedAt ?? null,
      }));

      if (SYNC_LWW_ENABLED) {
        const rows = cycleRows.map((r) => ({
          ...r,
          updated_at: r.updated_at ?? new Date().toISOString(),
        }));
        const { data: lwwData, error: lwwErr } = await supabase.rpc(
          'upsert_training_cycle_lww',
          { p_rows: rows },
        );
        if (lwwErr) throw new Error(`training_cycles LWW RPC failed: ${lwwErr.message}`);
        acceptedCycleIds = new Set<string>();
        for (const rr of (lwwData ?? []) as LwwUpsertRow[]) {
          if (rr.accepted) acceptedCycleIds.add(rr.id);
          else rejections.cycles.push({ id: rr.id, serverUpdatedAt: rr.server_updated_at });
        }
        cyclesUpserted = acceptedCycleIds.size;
      } else {
        const { error: cycErr } = await supabase
          .from('training_cycles')
          .upsert(cycleRows, { onConflict: 'id' });
        if (cycErr) throw new Error(`training_cycles upsert failed: ${cycErr.message}`);
        cyclesUpserted = cycleRows.length;
      }

      // Upsert days using the UNIQUE(cycle_id, day_number) constraint.
      // When LWW is enabled, skip days whose parent cycle was rejected.
      const dayRows = payload.cycles
        .filter((c) => childAllowed(acceptedCycleIds, c.id))
        .flatMap((c) =>
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
          .upsert(dayRows, { onConflict: 'cycle_id,day_number' });
        if (dayErr) throw new Error(`cycle_days upsert failed: ${dayErr.message}`);
      }

      // Remove orphan days: day_numbers beyond the cycle's current day count
      for (const cycle of payload.cycles) {
        const maxDayNumber = cycle.days.length > 0
          ? Math.max(...cycle.days.map((d) => d.dayNumber))
          : -1;
        const { error: orphanErr } = await supabase
          .from('cycle_days')
          .delete()
          .eq('cycle_id', cycle.id)
          .gt('day_number', maxDayNumber);
        if (orphanErr) console.warn(`cycle_days orphan cleanup warning for ${cycle.id}:`, orphanErr.message);
      }
    }

    // =========================================================================
    // 8. Upsert rpg_attributes
    // =========================================================================
    if (payload.rpgAttributes) {
      const rpg = payload.rpgAttributes;
      // fix(audit #8): defensively coerce to Int before DB write. Mobile sends
      // Int per the Kotlin DTO, but any buggy producer (e.g. analytics pipeline)
      // that feeds a float here would break the round-trip on pull. See
      // _shared/rpgSchema.ts.
      const rpgInt = (v: unknown, fallback: number) =>
        Number.isFinite(Number(v)) ? Math.round(Number(v)) : fallback;
      const rpgRow = {
        user_id: userId,
        strength: rpgInt(rpg.strength, 0),
        power: rpgInt(rpg.power, 0),
        stamina: rpgInt(rpg.stamina, 0),
        consistency: rpgInt(rpg.consistency, 0),
        mastery: rpgInt(rpg.mastery, 0),
        character_class: rpg.characterClass,
        level: rpgInt(rpg.level, 1),
        experience_points: rpgInt(rpg.experiencePoints, 0),
        updated_at: new Date().toISOString(),
      };

      if (SYNC_LWW_ENABLED) {
        const { data: lwwData, error: lwwErr } = await supabase.rpc(
          'upsert_rpg_attributes_lww',
          { p_rows: [rpgRow] },
        );
        if (lwwErr) throw new Error(`rpg_attributes LWW RPC failed: ${lwwErr.message}`);
        for (const rr of (lwwData ?? []) as LwwUpsertRow[]) {
          if (!rr.accepted) rejections.rpgAttributes.push({ id: rr.id, serverUpdatedAt: rr.server_updated_at });
        }
      } else {
        const { error: rpgErr } = await supabase
          .from('rpg_attributes')
          .upsert(rpgRow, { onConflict: 'user_id' });
        if (rpgErr) throw new Error(`rpg_attributes upsert failed: ${rpgErr.message}`);
      }
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
      const gsRow = {
        user_id: userId,
        total_workouts: gs.totalWorkouts,
        total_reps: gs.totalReps,
        total_volume_kg: gs.totalVolumeKg,
        longest_streak: gs.longestStreak,
        current_streak: gs.currentStreak,
        total_time_seconds: gs.totalTimeSeconds,
        updated_at: new Date().toISOString(),
      };

      if (SYNC_LWW_ENABLED) {
        const { data: lwwData, error: lwwErr } = await supabase.rpc(
          'upsert_gamification_stats_lww',
          { p_rows: [gsRow] },
        );
        if (lwwErr) throw new Error(`gamification_stats LWW RPC failed: ${lwwErr.message}`);
        for (const rr of (lwwData ?? []) as LwwUpsertRow[]) {
          if (!rr.accepted) rejections.gamificationStats.push({ id: rr.id, serverUpdatedAt: rr.server_updated_at });
        }
      } else {
        const { error: gsErr } = await supabase
          .from('gamification_stats')
          .upsert(gsRow, { onConflict: 'user_id' });
        if (gsErr) throw new Error(`gamification_stats upsert failed: ${gsErr.message}`);
      }
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
    // 14. External activities (mobile integrations — Hevy, Liftosaur, health)
    // =========================================================================
    let externalActivityIds: string[] = [];
    let externalActivityKeys: ExternalActivityAckDto[] = [];
    if (payload.externalActivities && payload.externalActivities.length > 0) {
      // fix(audit #5): require client-minted id. Mobile already mints via
      // ExternalActivity.id = generateUUID() default, so any payload missing
      // it indicates a buggy producer. Rejecting up-front prevents the server
      // from generating a UUID the client will never learn about.
      for (const a of payload.externalActivities) {
        if (!a.id) {
          return new Response(
            JSON.stringify({
              error: 'external_activity.id is required (mobile must mint UUID before send)',
            }),
            { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } }
          );
        }
      }

      const activityRows = payload.externalActivities.map((a) => ({
        id: a.id,
        user_id: userId,
        external_id: a.externalId,
        provider: a.provider,
        name: a.name,
        activity_type: a.activityType,
        started_at: a.startedAt,
        duration_seconds: a.durationSeconds > 0 ? a.durationSeconds : null,
        distance_meters: a.distanceMeters ?? null,
        calories: a.calories ?? null,
        avg_heart_rate: a.avgHeartRate ?? null,
        max_heart_rate: a.maxHeartRate ?? null,
        elevation_gain_meters: a.elevationGainMeters ?? null,
        raw_data: a.rawData ? safeJsonParse(a.rawData) : null,
        synced_at: a.syncedAt ?? new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }));

      if (SYNC_LWW_ENABLED) {
        // Phase 3.2: route through LWW RPC so a stale webhook push does not
        // overwrite a newer mobile-captured row (or vice versa). The RPC
        // returns the canonical server id which we surface in the ack list.
        const { data: lwwData, error: lwwErr } = await supabase.rpc(
          'upsert_external_activity_lww',
          { p_rows: activityRows },
        );
        if (lwwErr) {
          console.warn('external_activities LWW RPC warning:', lwwErr.message);
          externalActivityIds = [];
          externalActivityKeys = [];
        } else {
          const acceptedRows = (lwwData ?? []) as LwwUpsertRow[];
          // Preserve compound-key metadata by matching back against activityRows.
          const byIdx = new Map<string, { externalId: string; provider: string }>();
          for (const r of activityRows) {
            byIdx.set(r.id, { externalId: r.external_id, provider: r.provider });
          }
          externalActivityKeys = acceptedRows
            .filter((r) => r.accepted)
            .map((r) => {
              const meta = byIdx.get(r.id) ?? { externalId: '', provider: '' };
              return {
                localId: r.id,
                serverId: r.id,
                externalId: meta.externalId,
                provider: meta.provider,
                updatedAt: r.server_updated_at ?? new Date().toISOString(),
              };
            });
          for (const r of acceptedRows) {
            if (!r.accepted) {
              rejections.externalActivities.push({
                id: r.id,
                serverUpdatedAt: r.server_updated_at,
              });
            }
          }
          externalActivityIds = externalActivityKeys.map((k) => k.externalId);
          externalActivitiesUpserted = externalActivityKeys.length;
        }
      } else {
        // fix(audit #10): .select() after upsert so we can return the
        // server-canonical row metadata (including updated_at) to the client.
        const { data: extData, error: extErr } = await supabase
          .from('external_activities')
          .upsert(activityRows, { onConflict: 'user_id,provider,external_id' })
          .select('id, external_id, provider, updated_at');
        if (extErr) {
          console.warn('external_activities upsert warning:', extErr.message);
          externalActivityIds = [];
          externalActivityKeys = [];
        } else {
          externalActivitiesUpserted = activityRows.length;
          externalActivityKeys = (extData ?? []).map((r: Record<string, unknown>) => ({
            localId: String(r.id),
            serverId: String(r.id),
            externalId: String(r.external_id),
            provider: String(r.provider),
            updatedAt: String(r.updated_at),
          }));
          // Backward-compat alias for clients that read externalActivityIds only.
          externalActivityIds = externalActivityKeys.map((k) => k.externalId);
        }
      }
    }

    // =========================================================================
    // 15. Return sync result
    // =========================================================================
    const syncTime = new Date().toISOString();
    try {
      const channel = supabase.channel(`sync:${userId}`);
      const { error: broadcastError } = await channel.send({
        type: 'broadcast',
        event: 'sync_complete',
        payload: {
          syncTime,
          deviceId: payload.deviceId,
          platform: payload.platform,
          profileId: localProfileId,
          profileName: payload.profileName ?? null,
          sessionsInserted,
          routinesUpserted,
          cyclesUpserted,
          badgesUpserted,
        },
      });
      if (broadcastError) {
        console.warn('mobile-sync-push broadcast warning:', broadcastError);
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
        externalActivitiesUpserted,
        externalActivityIds,
        externalActivityKeys,
        // Phase 3.2: per-entity LWW rejection lists. Empty when SYNC_LWW_ENABLED
        // is false or when every incoming row cleared the LWW gate. Mobile
        // logs these and repairs convergence via the next pull.
        rejections,
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
