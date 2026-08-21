import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { getCorsHeaders } from '../_shared/cors.ts';
import { checkRateLimit } from '../_shared/rateLimit.ts';
import { requireSubscription } from '../_shared/requireSubscription.ts';
import { SYNC_LWW_ENABLED } from '../_shared/flags.ts';
import { describeSyncPlatformInput } from '../_shared/syncPlatform.ts';
import {
  buildLocalProfileRepairRowsForDedicatedRecords,
  buildPersonalRecordRowsForPush,
  chunkLocalProfileIdsForRepair,
  collectDedicatedRecordLocalProfileIds,
  hydratePersonalRecordExerciseNamesFromCatalog,
  hydratePersonalRecordExerciseNamesFromSessionExercises,
  isPostgresForeignKeyViolation,
  partitionPersonalRecordRowsByExerciseCatalogValidity,
  partitionPersonalRecordRowsByLocalProfileValidity,
  partitionPersonalRecordRowsBySessionValidity,
  personalRecordDerivedIdentityKey,
  personalRecordIdentityKey,
  shouldRepairDedicatedRecordLocalProfilesForPush,
  shouldValidatePersonalRecordProfileIdsForPush,
} from '../_shared/personalRecordRow.ts';
import {
  findPushPayloadDuplicateConflictKeys,
  findPushPayloadIncompleteRoutines,
  formatPushPayloadDuplicateError,
  formatPushPayloadIncompleteRoutinesError,
  pushPayloadSchema,
  type PushPayloadParsed,
} from '../_shared/pushPayloadSchema.ts';
import { buildExerciseProgressRows } from '../_shared/exerciseProgressRows.ts';
import {
  failPreferenceValidation,
  type JsonRecord,
  MAX_MOBILE_SYNC_REQUEST_BYTES,
  MAX_PROFILE_PREFERENCE_REQUEST_BYTES,
  parsePreferenceEnvelope,
  parseRpcMutationRow,
  type PortalProfilePreferenceSectionCanonical,
  type ProfilePreferenceSectionRejection,
  PreferenceInfrastructureError,
  PreferenceValidationError,
  PUSH_BODY_KEYS,
  requireKnownKeys,
  requireRecord,
  returnedAuthStatus,
  safeErrorName,
  scanJsonArrayElementSpans,
  scanTopLevelJsonObject,
} from '../_shared/profilePreferenceContract.ts';

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
 * Defense-in-depth: deduplicate rows by a key field before upserting.
 * PostgreSQL rejects an INSERT ... ON CONFLICT DO UPDATE when two rows in the
 * same statement hit the same conflict target. The pre-flight
 * `findPushPayloadDuplicateConflictKeys` check should prevent this, but UUID
 * case differences (iOS NSUUID = uppercase, Android = lowercase) or edge-case
 * data corruption can slip through. Last-wins semantics: if duplicates exist,
 * the later row in the array survives.
 */
function deduplicateByKey<T>(rows: T[], keyFn: (row: T) => string): T[] {
  const seen = new Map<string, number>();
  for (let i = 0; i < rows.length; i++) {
    // Normalize to lowercase for case-insensitive UUID comparison
    seen.set(keyFn(rows[i]).toLowerCase(), i);
  }
  // Preserve original order, keep only the last occurrence of each key
  return rows.filter((_, i) => {
    const key = keyFn(rows[i]).toLowerCase();
    return seen.get(key) === i;
  });
}

/**
 * Prevent cross-user takeover when upserting by primary key only.
 *
 * For tables with a direct `user_id` column, this checks that any existing
 * rows with the supplied ids are either absent or owned by `userId`.
 * Returns a 400 Response on violation, or null when safe to proceed.
 */
async function assertRowsOwnedByUser(
  supabase: SupabaseClient,
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
 * Parent-reference variant of `assertRowsOwnedByUser`. Unlike
 * `assertRowsOwnedByUser` (used for primary-key upsert checks where
 * absent rows are allowed because the upsert may be inserting them), this
 * helper is used to probe IDs that the caller asserts MUST already
 * exist (e.g. cross-payload parent FKs). Any id that is missing OR owned
 * by another user is a 400. The set of ids that exist AND are owned by
 * `userId` is returned so the caller can reuse it for downstream FK
 * partitions (Issue #532: personal_records.session_id retry).
 */
async function assertParentRowsExistAndOwnedByUser(
  supabase: SupabaseClient,
  table: string,
  ids: string[],
  userId: string,
  cors: Record<string, string>,
  options: { allowMissing?: boolean } = {},
): Promise<{ response: Response | null; validIds: Set<string> }> {
  const unique = [...new Set(ids)].filter(Boolean);
  const validIds = new Set<string>();
  if (unique.length === 0) return { response: null, validIds };
  const chunkSize = 100;
  for (let i = 0; i < unique.length; i += chunkSize) {
    const chunk = unique.slice(i, i + chunkSize);
    const { data: rows, error } = await supabase
      .from(table)
      .select('id, user_id')
      .in('id', chunk);
    if (error) {
      throw new Error(`Parent reference check on ${table} failed: ${error.message}`);
    }
    const seen = new Set<string>();
    for (const row of rows ?? []) {
      const id = (row as { id?: unknown }).id;
      if (typeof id !== 'string' || seen.has(id)) continue;
      seen.add(id);
      if ((row as { user_id?: unknown }).user_id === userId) {
        validIds.add(id);
      } else {
        return {
          response: new Response(
            JSON.stringify({
              error: `Refused: ${table} parent ${id} belongs to another user`,
            }),
            { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } },
          ),
          validIds,
        };
      }
    }
    for (const id of chunk) {
      if (!seen.has(id)) {
        if (options.allowMissing) continue;
        return {
          response: new Response(
            JSON.stringify({
              error: `Refused: ${table} parent ${id} does not exist`,
            }),
            { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } },
          ),
          validIds,
        };
      }
    }
  }
  return { response: null, validIds };
}

/**
 * Prevent cross-user takeover for child tables whose ownership flows through
 * a parent FK (the child has no direct `user_id` column). Resolves the parent
 * ids for any existing child rows and checks ownership against the parent
 * table's `user_id` column.
 */
async function assertChildRowsOwnedViaParent(
  supabase: SupabaseClient,
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
      .in('id', chunk)
      .returns<Record<string, unknown>[]>();
    if (childErr) {
      throw new Error(`Ownership check on ${childTable} failed: ${childErr.message}`);
    }
    if (!childRows || childRows.length === 0) continue;
    const parentIds = [
      ...new Set(
        childRows
          .map((r) => r[childFkColumn])
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

interface PersonalRecordDto {
  id?: string | null;
  userId?: string | null;
  exerciseName: string;
  exerciseId?: string | null;
  muscleGroup?: string | null;
  recordType?: string | null;
  value?: number | null;
  volume?: number | null;
  weightKg?: number | null;
  reps?: number | null;
  workoutPhase?: string | null;
  sessionId?: string | null;
  achievedAt?: string | null;
  updatedAt?: string | null;
  localProfileId?: string | null;
  workoutMode?: string | null;
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
  personalRecords: PersonalRecordDto[];
  customExercises?: CustomExerciseDto[];
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
  exerciseId?: string | null;
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
  exerciseId?: string | null;
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
  perSetReps: string | null;
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

interface CustomExerciseDto {
  clientId: string;
  name: string;
  displayName?: string | null;
  muscleGroup: string;
  equipment?: string | null;
  defaultCableConfig: string;
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
  templateId?: string | null;
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

export interface MobileSyncAuthClient {
  auth: {
    getUser(jwt: string): Promise<unknown>;
  };
}

export interface MobileSyncPushHandlerDependencies {
  createAuthClient(authorization: string): MobileSyncAuthClient;
  createAdminClient(): SupabaseClient;
  logOperationalFailure(value: { name: string }): void;
  now(): number;
}

function defaultMobileSyncPushDependencies(): MobileSyncPushHandlerDependencies {
  return {
    createAuthClient(authorization: string) {
      return createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_ANON_KEY')!,
        {
          global: { headers: { Authorization: authorization } },
          auth: { persistSession: false, autoRefreshToken: false },
        },
      );
    },
    createAdminClient() {
      return createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
        { auth: { persistSession: false, autoRefreshToken: false } },
      );
    },
    logOperationalFailure(value: { name: string }) {
      console.error(value);
    },
    now() {
      return Date.now();
    },
  };
}

export function validateExistingMobileSyncPushBody(
  body: JsonRecord,
): PushPayloadParsed {
  requireKnownKeys(body, PUSH_BODY_KEYS, 'body');
  const ordinaryBody = Object.fromEntries(
    Object.entries(body).filter(([key]) => key !== 'profilePreferenceSections'),
  );
  const parseResult = pushPayloadSchema.strict().safeParse(ordinaryBody);
  if (!parseResult.success) failPreferenceValidation('body');
  return parseResult.data as PushPayloadParsed;
}

type BoundedBodyReadResult =
  | { kind: 'ok'; bytes: Uint8Array }
  | { kind: 'too_large' }
  | { kind: 'read_failure'; error: unknown };

function declaredBodyExceedsLimit(req: Request, limit: number): boolean {
  const contentLength = req.headers.get('content-length');
  if (contentLength === null || !/^[0-9]+$/.test(contentLength)) return false;
  return Number(contentLength) > limit;
}

async function readBoundedRequestBody(
  req: Request,
  limit: number,
): Promise<BoundedBodyReadResult> {
  if (declaredBodyExceedsLimit(req, limit)) return { kind: 'too_large' };
  if (req.body === null) return { kind: 'ok', bytes: new Uint8Array() };

  let reader: ReadableStreamDefaultReader<Uint8Array>;
  try {
    reader = req.body.getReader();
  } catch (error) {
    return { kind: 'read_failure', error };
  }
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (byteLength + value.byteLength > limit) {
        try {
          await reader.cancel();
        } catch {
          // The size decision is already final; cancellation is best-effort.
        }
        return { kind: 'too_large' };
      }
      chunks.push(value);
      byteLength += value.byteLength;
    }
  } catch (error) {
    return { kind: 'read_failure', error };
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // A completed/cancelled reader may already have released its lock.
    }
  }

  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { kind: 'ok', bytes };
}

async function mobileSyncPushHandler(
  req: Request,
  dependencies: MobileSyncPushHandlerDependencies,
): Promise<Response> {
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
    const authorization = req.headers.get('Authorization');
    const bearerMatch = authorization === null
      ? null
      : /^Bearer ([^\s]+)$/.exec(authorization);
    if (!bearerMatch) {
      return new Response(
        JSON.stringify({ error: 'Missing bearer token' }),
        { status: 401, headers: { ...cors, 'Content-Type': 'application/json' } }
      );
    }
    const userJwt = bearerMatch[1];

    const authOperationalFailure = (error: unknown): Response => {
      dependencies.logOperationalFailure({
        name: safeErrorName(error, 'AuthOperationalFailure'),
      });
      return new Response(
        JSON.stringify({ error: 'Authentication service unavailable' }),
        { status: 503, headers: { ...cors, 'Content-Type': 'application/json' } }
      );
    };

    const authClient = dependencies.createAuthClient(authorization!);
    let authResult: unknown;
    try {
      authResult = await authClient.auth.getUser(userJwt);
    } catch (error) {
      return authOperationalFailure(error);
    }
    if (typeof authResult !== 'object' || authResult === null || Array.isArray(authResult)) {
      return authOperationalFailure({ name: 'AuthUnexpectedResult' });
    }
    const authRecord = authResult as JsonRecord;
    if (!Object.hasOwn(authRecord, 'error') || !Object.hasOwn(authRecord, 'data')) {
      return authOperationalFailure({ name: 'AuthUnexpectedResult' });
    }
    const userError = authRecord.error;
    if (userError !== null) {
      const status = returnedAuthStatus(userError);
      if (status === 400 || status === 401 || status === 403) {
        return new Response(
          JSON.stringify({ error: 'Invalid bearer token' }),
          { status: 401, headers: { ...cors, 'Content-Type': 'application/json' } },
        );
      }
      return authOperationalFailure(userError);
    }
    const userData = authRecord.data;
    if (typeof userData !== 'object' || userData === null || Array.isArray(userData)) {
      return authOperationalFailure({ name: 'AuthUnexpectedResult' });
    }
    const verifiedUser = (userData as JsonRecord).user;
    if (
      typeof verifiedUser !== 'object' || verifiedUser === null || Array.isArray(verifiedUser) ||
      typeof (verifiedUser as JsonRecord).id !== 'string' ||
      ((verifiedUser as JsonRecord).id as string).trim().length === 0
    ) {
      return authOperationalFailure({ name: 'AuthUnexpectedResult' });
    }
    const verifiedUserId = (verifiedUser as JsonRecord).id as string;
    const userId = verifiedUserId;

    const bodyRead = await readBoundedRequestBody(
      req,
      MAX_MOBILE_SYNC_REQUEST_BYTES,
    );
    if (bodyRead.kind === 'read_failure') {
      dependencies.logOperationalFailure({
        name: safeErrorName(bodyRead.error, 'RequestBodyReadFailure'),
      });
      return new Response(
        JSON.stringify({ error: 'Request unavailable' }),
        { status: 503, headers: { ...cors, 'Content-Type': 'application/json' } },
      );
    }
    if (bodyRead.kind === 'too_large') {
      return new Response(
        JSON.stringify({ error: 'Request too large' }),
        { status: 413, headers: { ...cors, 'Content-Type': 'application/json' } },
      );
    }
    const originalBodyBytes = bodyRead.bytes;
    const rawBodyBytes = originalBodyBytes.byteLength;
    const hasLeadingUtf8Bom =
      originalBodyBytes.length >= 3 &&
      originalBodyBytes[0] === 0xef &&
      originalBodyBytes[1] === 0xbb &&
      originalBodyBytes[2] === 0xbf;
    if (hasLeadingUtf8Bom) {
      return new Response(
        JSON.stringify({ error: 'Invalid sync request' }),
        { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } },
      );
    }
    let rawBody: string;
    try {
      rawBody = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })
        .decode(originalBodyBytes);
    } catch {
      return new Response(
        JSON.stringify({ error: 'Invalid sync request' }),
        { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } },
      );
    }
    if (rawBody.startsWith('\uFEFF')) {
      return new Response(
        JSON.stringify({ error: 'Invalid sync request' }),
        { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } },
      );
    }

    let topLevelScan;
    try {
      topLevelScan = scanTopLevelJsonObject(rawBody);
      for (const duplicateKey of topLevelScan.duplicateKeys) {
        if (PUSH_BODY_KEYS.has(duplicateKey)) {
          failPreferenceValidation('body.' + duplicateKey);
        }
      }
    } catch (error) {
      if (!(error instanceof PreferenceValidationError) && !(error instanceof SyntaxError)) {
        throw error;
      }
      return new Response(
        JSON.stringify({ error: 'Invalid sync request' }),
        { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } },
      );
    }
    const preferenceValueSpan = topLevelScan.valueSpans.get('profilePreferenceSections');
    if (
      preferenceValueSpan !== undefined &&
      rawBodyBytes > MAX_PROFILE_PREFERENCE_REQUEST_BYTES
    ) {
      return new Response(
        JSON.stringify({ error: 'Request too large' }),
        { status: 413, headers: { ...cors, 'Content-Type': 'application/json' } },
      );
    }

    let body: JsonRecord;
    let payload: PushPayloadParsed;
    let preferenceEnvelope;
    try {
      const preferenceElementSpans = preferenceValueSpan === undefined
        ? []
        : scanJsonArrayElementSpans(rawBody, preferenceValueSpan);
      body = requireRecord(JSON.parse(rawBody) as unknown, 'body');
      preferenceEnvelope = parsePreferenceEnvelope(body, {
        rawBody,
        preferenceElementSpans,
      });
      payload = validateExistingMobileSyncPushBody(body);
    } catch (error) {
      if (!(error instanceof PreferenceValidationError) && !(error instanceof SyntaxError)) {
        throw error;
      }
      return new Response(
        JSON.stringify({ error: 'Invalid sync request' }),
        { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } },
      );
    }
    const rawPlatformInput = body.platform;
    const normalizedPlatform = payload.platform;
    if (normalizedPlatform === 'unknown') {
      console.warn(
        'mobile-sync-push received missing/invalid platform; defaulting to unknown',
        describeSyncPlatformInput(rawPlatformInput),
      );
    }

    // Validate array sizes to prevent memory exhaustion. Telemetry has its
    // own (higher) cap because it scales with BLE sample rate per rep, not
    // with user activity volume.
    // See https://github.com/9thLevelSoftware/Project-Phoenix-MP/issues/381
    const MAX_ENTITIES_PER_TYPE = 10_000;
    const MAX_TELEMETRY_POINTS = 50_000;
    if (payload.sessions && payload.sessions.length > MAX_ENTITIES_PER_TYPE) {
      return new Response(
        JSON.stringify({ error: `Too many sessions. Maximum is ${MAX_ENTITIES_PER_TYPE}.` }),
        { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } }
      );
    }
    if (payload.telemetry && payload.telemetry.length > MAX_TELEMETRY_POINTS) {
      return new Response(
        JSON.stringify({ error: `Too many telemetry items. Maximum is ${MAX_TELEMETRY_POINTS}.` }),
        { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } }
      );
    }
    if (payload.routines && payload.routines.length > MAX_ENTITIES_PER_TYPE) {
      return new Response(
        JSON.stringify({ error: `Too many routines. Maximum is ${MAX_ENTITIES_PER_TYPE}.` }),
        { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } }
      );
    }
    if (payload.personalRecords && payload.personalRecords.length > MAX_ENTITIES_PER_TYPE) {
      return new Response(
        JSON.stringify({ error: `Too many personalRecords. Maximum is ${MAX_ENTITIES_PER_TYPE}.` }),
        { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } }
      );
    }
    // fix(audit #6): align cycles cap with sessions/routines (10000).
    // Prior 1000 cap was a silent cliff for users with large cycle histories.
    if (payload.cycles && payload.cycles.length > MAX_ENTITIES_PER_TYPE) {
      return new Response(
        JSON.stringify({ error: `Too many cycles. Maximum is ${MAX_ENTITIES_PER_TYPE}.` }),
        { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } }
      );
    }

    const duplicateConflictKeys = findPushPayloadDuplicateConflictKeys(payload);
    if (duplicateConflictKeys.length > 0) {
      return new Response(
        JSON.stringify(formatPushPayloadDuplicateError(duplicateConflictKeys)),
        { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } }
      );
    }

    const incompleteRoutineIds = findPushPayloadIncompleteRoutines(payload);
    if (incompleteRoutineIds.length > 0) {
      return new Response(
        JSON.stringify(formatPushPayloadIncompleteRoutinesError(incompleteRoutineIds)),
        { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } }
      );
    }

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
    const allPersonalRecordIds = (payload.personalRecords ?? [])
      .map((pr) => pr.id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0);
    const sessionIdSet = new Set(allSessionIds);
    const setIdSet = new Set(allSetIds);
    const routineIdSet = new Set(allRoutineIds);

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

    const externalActivities = payload.externalActivities ?? [];
    // Mobile mints every external activity id. Validate this payload-only
    // invariant before any privileged gate or ordinary write.
    type ExternalActivityWithId = typeof externalActivities[number] & {
      id: string;
    };
    const activitiesWithIds = externalActivities.filter(
      (activity): activity is ExternalActivityWithId =>
        typeof activity.id === 'string' && activity.id.length > 0,
    );
    if (activitiesWithIds.length !== externalActivities.length) {
      return new Response(
        JSON.stringify({
          error: 'external_activity.id is required (mobile must mint UUID before send)',
        }),
        { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } }
      );
    }

    // Complete payload-only validation is now finished. Only this boundary may
    // construct a service-role-backed client. Any 400 below this point depends
    // on authoritative server state (ownership, parent existence, or catalog
    // conflicts) and therefore cannot be resolved before admin queries.
    const supabase = dependencies.createAdminClient();

    const rateCheck = await checkRateLimit(supabase, {
      key: 'mobile-sync-push',
      userId,
      maxRequests: 10,
      windowSeconds: 60,
    }, cors);
    if (!rateCheck.allowed) return rateCheck.response!;

    const gate = await requireSubscription(supabase, userId, 'EMBER', cors);
    if (!gate.allowed) return gate.response;

    // Upsert custom catalog rows before any session/routine child rows that may
    // reference those catalog IDs through FK columns.
    if (payload.customExercises.length > 0) {
      const catalogRows = payload.customExercises.map((ce) => {
        const name = ce.name.trim();
        const muscleGroup = ce.muscleGroup || 'General';
        return {
          id: ce.clientId,
          name,
          display_name: ce.displayName?.trim() || name,
          muscle_group: muscleGroup,
          muscle_groups: [muscleGroup],
          equipment: ce.equipment
            ? ce.equipment.split(',').map((e) => e.trim()).filter(Boolean)
            : [],
          default_cable_config: ce.defaultCableConfig || 'DOUBLE',
          is_custom: true,
          user_id: userId,
          archived: false,
          popularity: 0,
        };
      });

      const catalogIds = catalogRows.map((row) => row.id);
      const { data: existingCatalogRows, error: existingCatalogError } = await supabase
        .from('exercise_catalog')
        .select('id, is_custom, user_id')
        .in('id', catalogIds);

      if (existingCatalogError) {
        throw new Error(`custom exercise catalog ownership lookup failed: ${existingCatalogError.message}`);
      }

      const conflictingCatalogRow = (existingCatalogRows ?? []).find(
        (row) => row.is_custom !== true || row.user_id !== userId
      );
      if (conflictingCatalogRow) {
        return new Response(
          JSON.stringify({ error: 'Custom exercise id conflicts with an existing catalog exercise.' }),
          { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } }
        );
      }

      const { error: catalogError } = await supabase
        .from('exercise_catalog')
        .upsert(catalogRows, { onConflict: 'id' });

      if (catalogError) {
        throw new Error(`custom exercise catalog upsert failed: ${catalogError.message}`);
      }
    }

    // =========================================================================
    // 3a. Sync local profiles
    //
    // IMPORTANT: local_profile_id on workout_sessions/routines/cycles has a
    // composite FK → local_profiles(user_id, id).  The profile row MUST exist
    // before any session insert, otherwise the FK fires.  If the upsert fails
    // for any reason we null out localProfileId so downstream inserts store
    // rows as profile-unscoped (NULL) rather than crashing with a FK violation.
    // =========================================================================
    // Use `let` so we can clear it to null if the profile upsert fails.
    let localProfileId: string | null = payload.profileId ?? null;
    const allProfiles: LocalProfileDto[] | null = payload.allProfiles ?? null;
    const dedicatedRecordLocalProfileIds = collectDedicatedRecordLocalProfileIds(
      payload.personalRecords ?? [],
    );
    // Tracks profile IDs that are safe to reference in FK-protected rows for
    // this push. Dedicated personalRecords can carry their own localProfileId;
    // validating against this set prevents stale per-record IDs from bypassing
    // the sanitized handler-level fallback (Issue #507).
    const shouldValidatePersonalRecordProfileIds =
      shouldValidatePersonalRecordProfileIdsForPush({
        allProfiles,
        localProfileId,
        personalRecords: payload.personalRecords ?? [],
      });
    const validLocalProfileIdsForPush = new Set<string>();

    if (allProfiles && allProfiles.length > 0) {
      // Schema already validated each allProfiles[].id is "default" or a UUID
      // (see pushPayloadSchema.ts → localProfileSchema). No per-row recheck here.
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
        // Null out localProfileId so subsequent session/routine/cycle inserts
        // store rows as profile-unscoped (NULL) instead of hitting the FK.
        console.warn('Failed to upsert local profiles:', upsertError.message);
        if (localProfileId) {
          console.warn('Clearing localProfileId to avoid FK violation on session insert');
          localProfileId = null;
        }
      } else {
        const activeIds = allProfiles.map((p) => p.id);
        for (const id of activeIds) validLocalProfileIdsForPush.add(id);
        if (localProfileId && !validLocalProfileIdsForPush.has(localProfileId)) {
          console.warn('Clearing localProfileId because it is absent from allProfiles');
          localProfileId = null;
        }

        // Delete profiles that no longer exist on the device (from this device only)
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
      }
    } else if (localProfileId) {
      // Upsert the active profile. Uses profileName when present; falls back to
      // a safe placeholder for clients that send profileId without profileName
      // (older builds pre-allProfiles field, or missing optional field).
      // Without this branch those clients hit a FK violation on session insert
      // because the local_profiles row doesn't exist yet (issue #376).
      const profileName =
        payload.profileName ?? (localProfileId === 'default' ? 'Default' : 'Profile');
      const { error: profileError } = await supabase
        .from('local_profiles')
        .upsert(
          {
            user_id: userId,
            id: localProfileId,
            name: profileName,
            device_id: payload.deviceId,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'user_id,id' }
        );

      if (profileError) {
        // Null out so sessions are stored unscoped rather than failing the FK.
        console.warn('Failed to upsert local profile:', profileError.message);
        console.warn('Clearing localProfileId to avoid FK violation on session insert');
        localProfileId = null;
      } else if (localProfileId) {
        validLocalProfileIdsForPush.add(localProfileId);
      }
    }

    if (
      (!allProfiles || allProfiles.length === 0) &&
      dedicatedRecordLocalProfileIds.length > 0
    ) {
      const candidateIds = dedicatedRecordLocalProfileIds.filter(
        (id) => !validLocalProfileIdsForPush.has(id),
      );

      if (candidateIds.length > 0) {
        for (const chunk of chunkLocalProfileIdsForRepair(candidateIds)) {
          const { data: existingProfiles, error: lookupError } = await supabase
            .from('local_profiles')
            .select('id')
            .eq('user_id', userId)
            .in('id', chunk)
            .returns<Array<{ id: string }>>();

          if (lookupError) {
            console.warn(
              'Failed to look up local profiles for dedicated personal records:',
              lookupError.message,
            );
          } else {
            for (const profile of existingProfiles ?? []) {
              validLocalProfileIdsForPush.add(profile.id);
            }
          }
        }
      }

      const missingIds = candidateIds.filter(
        (id) => !validLocalProfileIdsForPush.has(id),
      );
      if (
        shouldRepairDedicatedRecordLocalProfilesForPush({
          allProfiles,
          localProfileId,
          validLocalProfileIds: validLocalProfileIdsForPush,
          missingLocalProfileIds: missingIds,
        })
      ) {
        const repairUpdatedAt = new Date().toISOString();
        for (const chunk of chunkLocalProfileIdsForRepair(missingIds)) {
          const repairRows = buildLocalProfileRepairRowsForDedicatedRecords(
            chunk,
            userId,
            payload.deviceId,
            repairUpdatedAt,
          );
          const { data: repairedProfiles, error: repairError } = await supabase
            .from('local_profiles')
            .upsert(repairRows, { onConflict: 'user_id,id' })
            .select('id')
            .returns<Array<{ id: string }>>();

          if (repairError) {
            console.warn(
              'Failed to repair local profiles for dedicated personal records:',
              repairError.message,
            );
          } else {
            for (const profile of repairedProfiles ?? []) {
              validLocalProfileIdsForPush.add(profile.id);
            }
          }
        }
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
    // 3b. Cross-user takeover protection
    //
    // The service-role client used below bypasses RLS, so we must verify
    // up-front that every client-supplied primary key either doesn't exist
    // yet or is already owned by the authenticated user. Also enforce that
    // child rows reference parents from this same payload — otherwise an
    // attacker could attach their rows to a victim's parent row.
    // =========================================================================
    // Direct-id ownership checks against tables with a user_id column
    const directOwnerChecks: Array<[string, string[]]> = [
      ['workout_sessions', allSessionIds],
      ['exercises', allExerciseIds],
      ['sets', allSetIds],
      ['rep_summaries', allRepSummaryIds],
      ['rep_telemetry', allTelemetryIds],
      ['routines', allRoutineIds],
      ['training_cycles', allCycleIds],
      ['personal_records', allPersonalRecordIds],
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

    // Telemetry, phase stats and cycle days may reference parent rows from
    // previous pushes, not this payload. Validate those cross-payload parent
    // references against the authoritative user_id column on each parent.
    // Issue #532: previously these probes used `assertRowsOwnedByUser`, which
    // silently allowed absent rows and would only catch cross-user references.
    // A missing parent then surfaced as a Postgres FK violation at insert time.
    // Use the strict parent-reference variant (missing → 400) for all of these.
    const telemetrySetIdsToVerify = (payload.telemetry ?? [])
      .map((t) => t.setId)
      .filter((sid) => !setIdSet.has(sid));
    const telParentProbe = await assertParentRowsExistAndOwnedByUser(
      supabase,
      'sets',
      telemetrySetIdsToVerify,
      userId,
      cors,
    );
    if (telParentProbe.response) return telParentProbe.response;

    const phaseSessionIdsToVerify = (payload.phaseStatistics ?? [])
      .map((p) => p.sessionId)
      .filter((sid) => !sessionIdSet.has(sid));
    const phaseParentProbe = await assertParentRowsExistAndOwnedByUser(
      supabase,
      'workout_sessions',
      phaseSessionIdsToVerify,
      userId,
      cors,
    );
    if (phaseParentProbe.response) return phaseParentProbe.response;

    // exercise_signatures.exercise_id and vbt_assessments.exercise_id are
    // domain identifiers stored as TEXT/unique-by-user, not FKs to workout
    // exercises rows. Do not parent-probe them against the exercises table:
    // catalog/custom identifiers can be valid without a workout exercise row.

    const dayRoutineIdsToVerify = (payload.cycles ?? [])
      .flatMap((c) => c.days.map((d) => d.routineId))
      .filter((rid): rid is string => typeof rid === 'string' && rid.length > 0 && !routineIdSet.has(rid));
    const dayRoutineProbe = await assertParentRowsExistAndOwnedByUser(
      supabase,
      'routines',
      dayRoutineIdsToVerify,
      userId,
      cors,
    );
    if (dayRoutineProbe.response) return dayRoutineProbe.response;

    // workout_sessions.routine_session_id is an informational TEXT field from
    // the mobile DTO, not a routines FK. Do not strict-probe it against
    // routines: mobile-generated routine-session identifiers are valid to store
    // even when no routines row exists on the portal.

    // Personal records reference workout_sessions. Sessions present in the
    // current payload are inserted in step 4a, so they don't need probing
    // here. Sessions NOT in the current payload are probed for ownership; a
    // foreign-user row is rejected, while a missing row is intentionally left
    // out of the valid set so the personal_records FK retry below can null
    // stale session_id references instead of throwing the FK error (Issue #532).
    const personalRecordSessionIdsToVerify = [
      ...new Set(
        (payload.personalRecords ?? [])
          .map((pr) => pr.sessionId)
          .filter((sid): sid is string => typeof sid === 'string' && sid.length > 0 && !sessionIdSet.has(sid)),
      ),
    ];
    const personalRecordSessionProbe = await assertParentRowsExistAndOwnedByUser(
      supabase,
      'workout_sessions',
      personalRecordSessionIdsToVerify,
      userId,
      cors,
      { allowMissing: true },
    );
    if (personalRecordSessionProbe.response) return personalRecordSessionProbe.response;
    // Sessions present in the current payload are also "valid" — they get
    // upserted just above, before the personal_records write, so by the time
    // the FK retry runs they exist on the server.
    const validPersonalRecordSessionIds = new Set<string>(sessionIdSet);
    for (const id of personalRecordSessionProbe.validIds) {
      validPersonalRecordSessionIds.add(id);
    }

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
        // NOT NULL DEFAULT columns: coerce client-supplied nulls/undefined to
        // the DB default. Postgres only applies DEFAULT when a column is
        // OMITTED from the INSERT column list — an explicit NULL bypasses it.
        started_at: s.startedAt ?? new Date().toISOString(),
        duration_seconds: s.durationSeconds ?? 0,
        total_volume: s.totalVolume ?? 0,
        set_count: s.setCount ?? 0,
        exercise_count: s.exerciseCount ?? 0,
        pr_count: s.prCount ?? 0,
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

      // Cross-user takeover defense (from main beta audit hardening): always
      // verify every primary key is either absent or owned by the caller
      // before the service-role upsert touches it.
      const sessionOwnershipResp = await assertRowsOwnedByUser(
        supabase,
        'workout_sessions',
        sessionRows.map((r) => r.id),
        userId,
        cors,
      );
      if (sessionOwnershipResp) return sessionOwnershipResp;

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
        // LWW-rejected workout_sessions still exist on the server with newer
        // timestamps, so they remain valid personal_records.session_id FK
        // parents. Keep every payload session id in validPersonalRecordSessionIds;
        // acceptedSessionIds only gates child-row rewrites below.
      } else {
        const { error: sessErr } = await supabase
          .from('workout_sessions')
          .upsert(sessionRows, { onConflict: 'id' });
        if (sessErr) throw new Error(`workout_sessions upsert failed: ${sessErr.message}`);
        sessionsInserted = sessionRows.length;
      }

      // --- 4b-pre. Atomic delete + re-insert of session children (issue #33, F343) ---
      // Mobile generates new random exercise/set/rep UUIDs each sync push, so
      // upsert-by-id never matches the old rows and duplicates pile up. We
      // therefore delete the existing exercises for the affected sessions
      // (CASCADE removes their sets, rep_summaries and rep_telemetry) and
      // re-insert the new rows. That delete + re-insert is performed in ONE
      // transaction by the replace_session_children RPC below: previously the
      // delete and each upsert were separate statements, so a failure after the
      // delete permanently destroyed the user's data. The child rows are built
      // and ownership-checked here; the single RPC call near the end of this
      // block does the atomic swap.
      const affectedSessionIds = payload.sessions
        .filter((s) => childAllowed(acceptedSessionIds, s.id))
        .map((s) => s.id);

      // --- 4b. Build exercise rows ---
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
            exercise_id: e.exerciseId ?? null,
            muscle_group: e.muscleGroup ?? 'General',
            order_index: e.orderIndex ?? 0,
          }))
        );

      // Defense-in-depth: deduplicate by id before upsert. The pre-flight
      // duplicate check should prevent this, but case-insensitive UUID
      // collisions (iOS uppercase vs Android lowercase) can slip past the
      // case-sensitive JS Set check while PostgreSQL treats them as equal.
      const dedupedExerciseRows = deduplicateByKey(exerciseRows, (r) => r.id);

      // Ownership pre-check: reject any incoming id already owned by a different
      // user before the atomic replace deletes/re-inserts. The actual write
      // happens in the replace_session_children RPC below.
      if (dedupedExerciseRows.length > 0) {
        const exerciseOwnershipResp = await assertRowsOwnedByUser(
          supabase,
          'exercises',
          dedupedExerciseRows.map((r) => r.id),
          userId,
          cors,
        );
        if (exerciseOwnershipResp) return exerciseOwnershipResp;
      }

      // --- 4c. Build set rows ---
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
              actual_reps: st.actualReps ?? 0,
              weight_kg: st.weightKg ?? 0,
              rpe: st.rpe,
              is_pr: st.isPr ?? false,
              notes: st.notes,
              workout_mode: st.workoutMode,
            }))
          )
        );

      const dedupedSetRows = deduplicateByKey(setRows, (r) => r.id);

      if (dedupedSetRows.length > 0) {
        const setOwnershipResp = await assertRowsOwnedByUser(
          supabase,
          'sets',
          dedupedSetRows.map((r) => r.id),
          userId,
          cors,
        );
        if (setOwnershipResp) return setOwnershipResp;
      }

      // --- 4d. Build rep_summary rows ---
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

      const dedupedRepRows = deduplicateByKey(repRows, (r) => r.id);

      if (dedupedRepRows.length > 0) {
        const repOwnershipResp = await assertRowsOwnedByUser(
          supabase,
          'rep_summaries',
          dedupedRepRows.map((r) => r.id),
          userId,
          cors,
        );
        if (repOwnershipResp) return repOwnershipResp;
      }

      // --- 4e. Build rep_telemetry rows (GAP 1: force curves) ---
      // NOTE: ownership for rep_telemetry.id is already verified in the
      // directOwnerChecks loop above (see `allTelemetryIds`). Re-checking
      // here would double the serial SELECTs on a chunked probe — at
      // MAX_TELEMETRY_POINTS=50_000 that's an extra ~500 roundtrips before
      // any insert. Keep the single upstream check and proceed directly.
      //
      // Gate telemetry to the sets being written this push, mirroring how
      // exercises/sets/rep_summaries are gated by the LWW acceptance filter.
      // Mobile regenerates set UUIDs on every push, so a set_id only ever
      // refers to a set in THIS payload; if its parent session was LWW-rejected
      // that set is not (re-)inserted, so its telemetry would reference a
      // non-existent row. Before this gate the whole replace_session_children
      // transaction (now atomic) would roll back on that FK violation, blocking
      // every other session's data in the same push. Drop the stale telemetry
      // instead — we are keeping the server's newer version of that session.
      const acceptedSetIds = new Set(dedupedSetRows.map((r) => r.id));
      const telemetryRows = (payload.telemetry ?? [])
        .filter((t) => acceptedSetIds.has(t.setId))
        .map((t) => ({
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
      const dedupedTelemetryRows = deduplicateByKey(telemetryRows, (r) => r.id);

      // --- 4f. Atomic swap: delete affected sessions' children + re-insert all
      // child rows in a single transaction (F343). A failure anywhere rolls the
      // delete back, so partial-write data loss is impossible.
      if (
        affectedSessionIds.length > 0 ||
        dedupedExerciseRows.length > 0 ||
        dedupedTelemetryRows.length > 0
      ) {
        const { error: replaceErr } = await supabase.rpc('replace_session_children', {
          p_user_id: userId,
          p_session_ids: affectedSessionIds,
          p_exercises: dedupedExerciseRows,
          p_sets: dedupedSetRows,
          p_rep_summaries: dedupedRepRows,
          p_rep_telemetry: dedupedTelemetryRows,
        });
        if (replaceErr) {
          throw new Error(`session children replace failed: ${replaceErr.message}`);
        }
        exercisesInserted = dedupedExerciseRows.length;
        setsInserted = dedupedSetRows.length;
        repSummariesInserted = dedupedRepRows.length;
        telemetryInserted = dedupedTelemetryRows.length;
      }

      // =====================================================================
      // 5. Compute exercise_progress (mobile-provided 1RM, hybrid fallback)
      // Defense-in-depth: filter sessions through childAllowed like every
      // other child path (exercises/sets/rep_summaries/rep_telemetry) so
      // progress rows for LWW-rejected sessions are never inserted.
      // (Issue #99 RCA layer 3)
      // =====================================================================
      const acceptedSessions = payload.sessions
        .filter((s) => childAllowed(acceptedSessionIds, s.id));
      const progressRows = buildExerciseProgressRows(
        acceptedSessions,
        userId,
        localProfileId,
      );

      if (progressRows.length > 0) {
        const sessionIds = [...new Set(acceptedSessions.map((session) => session.id))];
        const { data: existingProgress, error: existingProgressErr } = await supabase
          .from('exercise_progress')
          .select('session_id, exercise_id, exercise_name')
          .in('session_id', sessionIds);
        if (existingProgressErr) {
          throw new Error(`exercise_progress lookup failed: ${existingProgressErr.message}`);
        }

        const progressIdentityKey = (row: {
          session_id?: unknown;
          exercise_id?: unknown;
          exercise_name?: unknown;
        }) => {
          const exerciseKey =
            typeof row.exercise_id === 'string' && row.exercise_id.length > 0
              ? `id:${row.exercise_id}`
              : `name:${String(row.exercise_name ?? '')}`;
          return `${String(row.session_id ?? '')}:${exerciseKey}`;
        };
        const existingProgressKeys = new Set(
          (existingProgress ?? []).map((row) => progressIdentityKey(row))
        );
        const dedupedProgressRows = progressRows.filter((row) => {
          const key = progressIdentityKey(row);
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

    }

    // =========================================================================
    // 6. Persist personal_records.
    //
    // Dedicated top-level personalRecords are authoritative for current mobile
    // clients. Set-derived rows remain the fallback for old clients that only
    // send isPr/prType/prPhase/prVolume on sets.
    // =========================================================================
    let prRows = buildPersonalRecordRowsForPush(
      payload.sessions ?? [],
      payload.personalRecords ?? [],
      userId,
      localProfileId,
      shouldValidatePersonalRecordProfileIds ? validLocalProfileIdsForPush : null,
    );

    if (prRows.length > 0) {
      prRows = hydratePersonalRecordExerciseNamesFromSessionExercises(
        prRows,
        (payload.sessions ?? []).flatMap((session) =>
          (session.exercises ?? []).map((exercise) => ({
            id: exercise.id,
            session_id: session.id,
            name: exercise.name,
            exercise_id: exercise.exerciseId ?? null,
          }))
        ),
      );

      const personalRecordExerciseCatalogIdsToLookup = [
        ...new Set(
          prRows.flatMap((row) => {
            const candidates: string[] = [];
            if (typeof row.exercise_id === 'string' && row.exercise_id.length > 0) {
              candidates.push(row.exercise_id);
            }
            const exerciseName = row.exercise_name.trim();
            if (exerciseName.length > 0 && !/\s/.test(exerciseName)) {
              candidates.push(exerciseName);
            }
            return candidates;
          }),
        ),
      ];

      if (personalRecordExerciseCatalogIdsToLookup.length > 0) {
        const validPersonalRecordExerciseIds = new Set<string>();
        const personalRecordCatalogRows: {
          id: string;
          name?: string | null;
          display_name?: string | null;
        }[] = [];
        const chunkSize = 100;
        for (let i = 0; i < personalRecordExerciseCatalogIdsToLookup.length; i += chunkSize) {
          const chunk = personalRecordExerciseCatalogIdsToLookup.slice(i, i + chunkSize);
          const { data: catalogRows, error: catalogLookupErr } = await supabase
            .from('exercise_catalog')
            .select('id, user_id, name, display_name')
            .in('id', chunk);
          if (catalogLookupErr) {
            throw new Error(`personal_records exercise catalog lookup failed: ${catalogLookupErr.message}`);
          }
          for (const row of catalogRows ?? []) {
            const id = (row as { id?: unknown }).id;
            const ownerId = (row as { user_id?: unknown }).user_id;
            const name = (row as { name?: unknown }).name;
            const displayName = (row as { display_name?: unknown }).display_name;
            if (
              typeof id === 'string' &&
              (ownerId === null || ownerId === undefined || ownerId === userId)
            ) {
              validPersonalRecordExerciseIds.add(id);
              personalRecordCatalogRows.push({
                id,
                name: typeof name === 'string' ? name : null,
                display_name: typeof displayName === 'string' ? displayName : null,
              });
            }
          }
        }

        const exercisePartition = partitionPersonalRecordRowsByExerciseCatalogValidity(
          prRows,
          validPersonalRecordExerciseIds,
        );
        if (exercisePartition.invalidExerciseRows.length > 0) {
          const invalidExerciseIds = [
            ...new Set(
              exercisePartition.invalidExerciseRows
                .map((row) => row.exercise_id)
                .filter((id): id is string => typeof id === 'string' && id.length > 0),
            ),
          ];
          console.warn(
            'personal_records exercise_id references missing or inaccessible exercise_catalog rows — storing PRs by exercise_name:',
            invalidExerciseIds,
          );
          prRows = exercisePartition.rowsWithInvalidExercisesNulled;
        }

        prRows = hydratePersonalRecordExerciseNamesFromCatalog(
          prRows,
          personalRecordCatalogRows,
        );
      }

      const dedicatedPrsPresent = (payload.personalRecords ?? []).length > 0;
      const achievedAtValues = [...new Set(prRows.map((row) => row.achieved_at as string))];
      const { data: existingPrs, error: existingPrErr } = await supabase
        .from('personal_records')
        .select('id, local_profile_id, exercise_id, exercise_name, achieved_at, record_type, workout_phase, updated_at, deleted_at')
        .eq('user_id', userId)
        .in('achieved_at', achievedAtValues);
      if (existingPrErr) {
        throw new Error(`personal_records lookup failed: ${existingPrErr.message}`);
      }

      // Index existing rows under BOTH their id-key and their derived-identity
      // key. Dedicated payload rows (with id) match on the id-key; legacy
      // set-derived rows (no id) match on the derived key — without the latter
      // they would never match an existing row and the insert path would create
      // duplicate PRs on every re-sync.
      const existingPrIdsByIdentity = new Map<string, string | null>();
      for (const row of existingPrs ?? []) {
        const existingId = typeof row.id === 'string' ? row.id : null;
        existingPrIdsByIdentity.set(personalRecordIdentityKey(row), existingId);
        existingPrIdsByIdentity.set(
          personalRecordDerivedIdentityKey(row),
          existingId,
        );
      }

      const latestPayloadRowsByIdentity = new Map<string, typeof prRows[number]>();
      for (const row of prRows) {
        latestPayloadRowsByIdentity.set(personalRecordIdentityKey(row), row);
      }

      const dedupedPrRows = [...latestPayloadRowsByIdentity.values()].filter((row) => {
        const key = personalRecordIdentityKey(row);
        const existingId = existingPrIdsByIdentity.get(key);
        if (existingId && (!row.id || row.id !== existingId)) return false;
        existingPrIdsByIdentity.set(key, row.id ?? existingId ?? null);
        return true;
      });

      // Dedicated records have stable UUIDs, so enforce the tombstone-aware
      // last-write-wins rule before the ordinary Supabase upsert. An equal-time
      // tombstone wins to make a delete monotonic rather than resurrectable.
      const existingPrsById = new Map(
        (existingPrs ?? [])
          .filter((row) => typeof row.id === 'string')
          .map((row) => [row.id as string, row]),
      );
      const prRowsToWrite = dedupedPrRows.filter((row) => {
        if (!dedicatedPrsPresent || !row.id) return true;
        const existing = existingPrsById.get(row.id);
        if (!existing) return true;
        // Once a UUID has been tombstoned, active writes cannot resurrect it,
        // even if a stale client assigns the write a later timestamp.
        if (existing.deleted_at != null && row.deleted_at == null) return false;
        const incomingUpdatedAt = Date.parse(
          row.updated_at ?? row.deleted_at ?? row.achieved_at,
        );
        const storedUpdatedAt = Date.parse(
          String(existing.updated_at ?? existing.achieved_at),
        );
        if (Number.isNaN(incomingUpdatedAt) || Number.isNaN(storedUpdatedAt)) {
          return false;
        }
        if (incomingUpdatedAt !== storedUpdatedAt) {
          return incomingUpdatedAt > storedUpdatedAt;
        }
        return row.deleted_at != null && existing.deleted_at == null;
      });

      if (prRowsToWrite.length > 0) {
        const writePersonalRecords = (rows: typeof prRowsToWrite) => dedicatedPrsPresent
          ? supabase
              .from('personal_records')
              .upsert(rows, { onConflict: 'id' })
          : supabase
              .from('personal_records')
              .insert(rows);

        const { error: prErr } = await writePersonalRecords(prRowsToWrite);
        if (prErr && isPostgresForeignKeyViolation(prErr)) {
          // Issue #99 RCA layer 2: always partition by local_profile_id
          // validity when the valid set is populated, even for derived PR
          // rows (sessions[].sets[].isPr). The dedicated-records path
          // already covers this via buildDedicatedPersonalRecordRows, but
          // the derived path uses the handler-level localProfileId which
          // can reference a profile not in validLocalProfileIdsForPush
          // when allProfiles is empty in non-final batches.
          const profilePartition = (shouldValidatePersonalRecordProfileIds || validLocalProfileIdsForPush.size > 0)
            ? partitionPersonalRecordRowsByLocalProfileValidity(
                prRowsToWrite,
                validLocalProfileIdsForPush,
              )
            : {
                invalidProfileRows: [],
                rowsWithInvalidProfilesNulled: prRowsToWrite,
              };

          // Issue #532: if the local_profile_id partition is a no-op (no
          // invalid profile IDs to null out), the FK violation must be on
          // a different column — most likely session_id. Run a session_id
          // partition on the same input set so the retry can null out
          // stale session_id references instead of bubbling the FK error.
          const sessionPartition = partitionPersonalRecordRowsBySessionValidity(
            profilePartition.rowsWithInvalidProfilesNulled,
            validPersonalRecordSessionIds,
          );

          if (
            profilePartition.invalidProfileRows.length === 0 &&
            sessionPartition.invalidSessionRows.length === 0
          ) {
            throw new Error(`personal_records ${dedicatedPrsPresent ? 'upsert' : 'insert'} failed: ${prErr.message}`);
          }

          if (profilePartition.invalidProfileRows.length > 0) {
            const invalidLocalProfileIds = [
              ...new Set(
                profilePartition.invalidProfileRows
                  .map((row) => row.local_profile_id)
                  .filter((id): id is string => id !== null),
              ),
            ];
            console.warn(
              'FK violation on personal_records local_profile_id — retrying only invalid profile references with NULL profile scope:',
              invalidLocalProfileIds,
            );
          }
          if (sessionPartition.invalidSessionRows.length > 0) {
            const invalidSessionIds = [
              ...new Set(
                sessionPartition.invalidSessionRows
                  .map((row) => row.session_id)
                  .filter((id): id is string => typeof id === 'string' && id.length > 0),
              ),
            ];
            console.warn(
              'FK violation on personal_records session_id — retrying only invalid session references with NULL session_id:',
              invalidSessionIds,
            );
          }

          const { error: retryErr } = await writePersonalRecords(
            sessionPartition.rowsWithInvalidSessionsNulled,
          );
          if (retryErr) throw new Error(`personal_records retry after FK fix failed: ${retryErr.message}`);
          personalRecordsInserted = sessionPartition.rowsWithInvalidSessionsNulled.length;
        } else if (prErr) {
          throw new Error(`personal_records ${dedicatedPrsPresent ? 'upsert' : 'insert'} failed: ${prErr.message}`);
        } else {
          personalRecordsInserted = prRowsToWrite.length;
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
        description: r.description ?? '',
        exercise_count: r.exerciseCount ?? 0,
        estimated_duration: Math.round(r.estimatedDuration ?? 0),
        times_completed: r.timesCompleted ?? 0,
        is_favorite: r.isFavorite ?? false,
        updated_at: r.updatedAt ?? null,
      }));

      const routineOwnershipResp = await assertRowsOwnedByUser(
        supabase,
        'routines',
        routineRows.map((r) => r.id),
        userId,
        cors,
      );
      if (routineOwnershipResp) return routineOwnershipResp;

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
          exercise_id: e.exerciseId ?? null,
          muscle_group: e.muscleGroup ?? 'General',
          sets: e.sets ?? 3,
          reps: e.reps ?? 10,
          weight: e.weight ?? 0,
          rest_seconds: e.restSeconds ?? 90,
          mode: e.mode ?? 'OLD_SCHOOL',
          order_index: e.orderIndex ?? 0,
          superset_id: e.supersetId,
          superset_color: e.supersetColor,
          superset_order: e.supersetOrder,
          per_set_weights: safeJsonParse(e.perSetWeights),
          per_set_rest: safeJsonParse(e.perSetRest),
          per_set_reps: safeJsonParse(e.perSetReps),
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
      const routineIds = payload.routines
        .filter((r) => childAllowed(acceptedRoutineIds, r.id))
        .map((r) => r.id);
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
    // 7a. Delete routines that mobile soft-deleted (tombstone propagation).
    //     Hard-delete on server — CASCADE removes routine_exercises automatically.
    //     Ownership check prevents cross-user deletion via crafted IDs.
    // =========================================================================
    if (payload.deletedRoutineIds && payload.deletedRoutineIds.length > 0) {
      const ownershipResp = await assertRowsOwnedByUser(
        supabase,
        'routines',
        payload.deletedRoutineIds,
        userId,
        cors,
      );
      if (ownershipResp) return ownershipResp;

      const { error: delErr } = await supabase
        .from('routines')
        .delete()
        .in('id', payload.deletedRoutineIds)
        .eq('user_id', userId);
      if (delErr) {
        console.warn('routine deletion warning:', delErr.message);
      } else {
        console.log(`Deleted ${payload.deletedRoutineIds.length} routine(s) from server`);
      }
    }

    // =========================================================================
    // 7b. Delete cycles that mobile soft-deleted (tombstone propagation).
    //     Hard-delete on server — CASCADE removes cycle_days automatically.
    //     Ownership check prevents cross-user deletion via crafted IDs.
    // =========================================================================
    if (payload.deletedCycleIds && payload.deletedCycleIds.length > 0) {
      const cycleDelOwnershipResp = await assertRowsOwnedByUser(
        supabase,
        'training_cycles',
        payload.deletedCycleIds,
        userId,
        cors,
      );
      if (cycleDelOwnershipResp) return cycleDelOwnershipResp;

      const { error: cycleDelErr } = await supabase
        .from('training_cycles')
        .delete()
        .in('id', payload.deletedCycleIds)
        .eq('user_id', userId);
      if (cycleDelErr) {
        console.warn('cycle deletion warning:', cycleDelErr.message);
      } else {
        console.log(`Deleted ${payload.deletedCycleIds.length} cycle(s) from server`);
      }
    }

    // =========================================================================
    // 7c. Upsert training_cycles + upsert cycle_days (safe replace pattern)
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
        duration_weeks: c.durationWeeks ?? 4,
        workout_days: c.workoutDays ?? 0,
        rest_days: c.restDays ?? 0,
        current_week: c.currentWeek ?? 1,
        status: c.status ?? 'draft',
        started_at: c.startedAt,
        last_used_at: c.lastUsedAt,
        progression_settings: safeJsonParse(c.progressionSettings),
        deload_settings: safeJsonParse(c.deloadSettings),
        template_id: c.templateId ?? null,
        updated_at: c.updatedAt ?? null,
      }));

      const cycleOwnershipResp = await assertRowsOwnedByUser(
        supabase,
        'training_cycles',
        cycleRows.map((r) => r.id),
        userId,
        cors,
      );
      if (cycleOwnershipResp) return cycleOwnershipResp;

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
        // Legacy server-wins upsert still needs to preserve an existing
        // template_id when older mobile builds omit or null the field.
        const cycleIdsMissingTemplateId = cycleRows
          .filter((row) => row.template_id == null)
          .map((row) => row.id);
        if (cycleIdsMissingTemplateId.length > 0) {
          const existingTemplateIds = new Map<string, string>();
          const chunkSize = 100;
          for (let i = 0; i < cycleIdsMissingTemplateId.length; i += chunkSize) {
            const chunk = cycleIdsMissingTemplateId.slice(i, i + chunkSize);
            const { data: existingCycles, error: existingCyclesErr } = await supabase
              .from('training_cycles')
              .select('id, template_id')
              .eq('user_id', userId)
              .in('id', chunk);
            if (existingCyclesErr) {
              throw new Error(`training_cycles template_id probe failed: ${existingCyclesErr.message}`);
            }
            for (const row of existingCycles ?? []) {
              if (typeof row.id === 'string' && typeof row.template_id === 'string') {
                existingTemplateIds.set(row.id, row.template_id);
              }
            }
          }
          for (const row of cycleRows) {
            if (row.template_id == null) {
              row.template_id = existingTemplateIds.get(row.id) ?? null;
            }
          }
        }

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
            // Do not upsert id when conflict target is (cycle_id, day_number).
            // If a client reuses an id across different day rows, Postgres can
            // still raise duplicate key on cycle_days_pkey before conflict
            // resolution for the composite unique key.
            cycle_id: d.cycleId,
            day_number: d.dayNumber,
            day_type: d.dayType ?? 'workout',
            routine_id: d.routineId,
            weight_adjustment: d.weightAdjustment ?? 0,
            rep_modifier: d.repModifier ?? 0,
            rest_override: d.restOverride,
            rest_type: d.restType,
            notes: d.notes,
          })),
        );

      if (dayRows.length > 0) {
        const { error: dayErr } = await supabase
          .from('cycle_days')
          .upsert(dayRows, { onConflict: 'cycle_id,day_number' });
        if (dayErr) throw new Error(`cycle_days upsert failed: ${dayErr.message}`);
      }

      // Remove orphan days: day_numbers beyond the cycle's current day count
      for (const cycle of payload.cycles.filter(c => childAllowed(acceptedCycleIds, c.id))) {
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
        badge_tier: b.badgeTier ?? 'bronze',
        earned_at: b.earnedAt ?? new Date().toISOString(),
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
        total_workouts: gs.totalWorkouts ?? 0,
        total_reps: gs.totalReps ?? 0,
        total_volume_kg: gs.totalVolumeKg ?? 0,
        longest_streak: gs.longestStreak ?? 0,
        current_streak: gs.currentStreak ?? 0,
        total_time_seconds: gs.totalTimeSeconds ?? 0,
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
    if (externalActivities.length > 0) {
      const activityRows = activitiesWithIds.map((a) => ({
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

    const canonicalProfilePreferenceSections: PortalProfilePreferenceSectionCanonical[] = [];
    const profilePreferenceRejections: ProfilePreferenceSectionRejection[] = [
      ...preferenceEnvelope.rejections,
    ];
    try {
      for (const mutation of preferenceEnvelope.validatedMutations) {
        const { data, error } = await supabase.rpc(
          'mutate_local_profile_preference_section',
          {
            p_user_id: verifiedUserId,
            p_local_profile_id: mutation.localProfileId,
            p_section: mutation.section,
            p_document_version: mutation.documentVersion,
            p_base_revision: mutation.baseRevision,
            p_payload: mutation.payload,
          },
        );
        if (error) throw new PreferenceInfrastructureError('mutation RPC');
        const result = parseRpcMutationRow(data, mutation);
        if (result.accepted) {
          canonicalProfilePreferenceSections.push(result.canonicalSection!);
        } else {
          profilePreferenceRejections.push({
            localProfileId: mutation.localProfileId,
            section: mutation.section,
            serverRevision: result.serverRevision,
            reason: result.rejectionReason as ProfilePreferenceSectionRejection['reason'],
            ...(result.canonicalSection
              ? { canonicalSection: result.canonicalSection }
              : {}),
          });
        }
      }
    } catch (error) {
      dependencies.logOperationalFailure({
        name: safeErrorName(error, 'PreferenceInfrastructureFailure'),
      });
      return new Response(
        JSON.stringify({ error: 'Sync temporarily unavailable' }),
        { status: 503, headers: { ...cors, 'Content-Type': 'application/json' } },
      );
    }

    // =========================================================================
    // 15. Return sync result
    // =========================================================================
    const syncTime = new Date(dependencies.now()).toISOString();
    // Use HTTP broadcast so the edge function doesn't need an active WebSocket
    // subscription. `channel.send()` on an unsubscribed channel silently no-ops.
    const channel = supabase.channel(`sync:${userId}`, {
      config: { broadcast: { self: false } },
    });
    try {
      await new Promise<void>((resolve) => {
        const subscription = channel.subscribe((status) => {
          if (
            status === 'SUBSCRIBED' ||
            status === 'CHANNEL_ERROR' ||
            status === 'TIMED_OUT' ||
            status === 'CLOSED'
          ) {
            resolve();
            // Avoid unused-binding warning on `subscription`.
            void subscription;
          }
        });
        // Safety timeout — don't block the response waiting for realtime.
        setTimeout(resolve, 1500);
      });

      const broadcastStatus = await channel.send({
        type: 'broadcast',
        event: 'sync_complete',
        payload: {
          syncTime,
          deviceId: payload.deviceId,
          platform: normalizedPlatform,
          profileId: localProfileId,
          profileName: payload.profileName ?? null,
          sessionsInserted,
          routinesUpserted,
          cyclesUpserted,
          badgesUpserted,
        },
      });
      if (broadcastStatus !== 'ok') {
        console.warn('mobile-sync-push broadcast warning:', broadcastStatus);
      }
    } catch (broadcastErr) {
      console.warn('mobile-sync-push broadcast failed:', broadcastErr);
    } finally {
      try {
        await supabase.removeChannel(channel);
      } catch (cleanupErr) {
        console.warn('mobile-sync-push channel cleanup warning:', cleanupErr);
      }
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
        ...(preferenceEnvelope.present ? { profilePreferencesAccepted: true } : {}),
        canonicalProfilePreferenceSections,
        profilePreferenceRejections,
      }),
      { headers: { ...cors, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    dependencies.logOperationalFailure({
      name: safeErrorName(err, 'MobileSyncPushFailure'),
    });
    // TEMPORARY DIAGNOSTIC (Issue #99): surface application error messages
    // in ALL environments. Our own thrown errors always contain ' failed';
    // anything else stays opaque to prevent leaking sensitive details.
    const rawMessage = err instanceof Error ? err.message : String(err);
    const isApplicationError = rawMessage.includes(' failed');
    const errorBody: Record<string, unknown> = {
      error: isApplicationError ? rawMessage : 'Internal server error',
    };
    if (err && typeof err === 'object' && 'code' in err) {
      errorBody.code = (err as { code: unknown }).code;
    }
    return new Response(
      JSON.stringify(errorBody),
      { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } }
    );
  }
}

export function createMobileSyncPushHandler(
  dependencies: MobileSyncPushHandlerDependencies = defaultMobileSyncPushDependencies(),
): (req: Request) => Promise<Response> {
  return (req) => mobileSyncPushHandler(req, dependencies);
}

if (import.meta.main) {
  Deno.serve(createMobileSyncPushHandler());
}
