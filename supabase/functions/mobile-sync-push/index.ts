// Exact pin: sync_complete relies on RealtimeChannel.httpSend (realtime-js 2.107).
import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2.107.0';
import { getCorsHeaders } from '../_shared/cors.ts';
import { redactTokenShapedJson } from '../_shared/garminIdentity.ts';
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
import {
  coerceDropSetMinWeightKg,
  needsDropSetExistingRow,
  resolveDropSetUpsertFields,
} from '../_shared/dropSetUpsert.ts';
import { buildExerciseProgressRows } from '../_shared/exerciseProgressRows.ts';
import { fetchAllByParentIds } from '../_shared/pagedByParent.ts';
import { syncBroadcastTopic } from '../_shared/syncBroadcast.ts';
import {
  catalogLookupFromUnknown,
  resolveCatalogExerciseId,
  resolveCatalogExerciseIds,
  buildCatalogIndexes,
  type CatalogLookupRow,
} from '../_shared/catalogExerciseIds.ts';
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
 *
 * KD-5 (review R-3/R-6): `serverUpdatedAt` means ONE thing for every entity —
 * the stored LWW key (`client_updated_at`) of the row that beat the push,
 * i.e. the pushing device's own clock for a mobile-authored version and the
 * server's now() for a portal edit. It is NOT the pull cursor and NOT
 * comparable with `cycleVersions` / `baseUpdatedAt`, which stay on the
 * server-owned `updated_at` (KD-6). It is null when the server has no row to
 * report (deleted concurrently, or owned by somebody else).
 */
interface EntityRejection {
  id: string;
  serverUpdatedAt: string | null;
}

/**
 * Row shape returned by every `upsert_<entity>_lww` function (Phase 3.1).
 * Since 20260920002100, `server_updated_at` from the session/routine RPCs is
 * the stored LWW key, not the server write clock.
 */
interface LwwUpsertRow {
  id: string;
  accepted: boolean;
  server_updated_at: string | null;
}

/** Look-back for the post-write tombstone race check (Edge/DB clock skew). */
const TOMBSTONE_RACE_MARGIN_MS = 5_000;

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
 * A required push sub-step (profile upsert, routine/cycle delete, routine
 * exercise upsert or orphan cleanup) failed after earlier steps may already have
 * written. The whole push is idempotent (upserts by id, deletes of absent
 * rows are no-ops), so the handler answers a retryable 503 instead of a 200:
 * mobile then keeps its dirty rows and does not advance lastSync, and the
 * next sync re-sends the same batch (F-024).
 */
class PartialWriteRetryError extends Error {
  constructor(step: string, cause: { message?: string } | null) {
    // The DB message goes to the function log only, never to the response.
    super(`${step} failed: ${cause?.message ?? 'unknown error'}`);
    this.name = 'PartialWriteRetry';
  }
}

/**
 * Hard-delete the caller's rows by id in chunks of 100, like the ownership
 * probe. One `.in()` with every tombstone id (up to 10,000 by schema) can
 * exceed the PostgREST URL limit, which would fail identically on every
 * retry and wedge sync behind a permanent 503. Deletes are idempotent, so a
 * failure after some chunks committed is still safe to retry.
 */
async function deleteOwnedRowsInChunks(
  supabase: SupabaseClient,
  table: string,
  ids: string[],
  userId: string,
  step: string,
): Promise<void> {
  const unique = [...new Set(ids)].filter(Boolean);
  const chunkSize = 100;
  for (let i = 0; i < unique.length; i += chunkSize) {
    const chunk = unique.slice(i, i + chunkSize);
    const { error } = await supabase
      .from(table)
      .delete()
      .in('id', chunk)
      .eq('user_id', userId);
    if (error) throw new PartialWriteRetryError(step, error);
  }
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

/** Row shape returned by get_personal_record_identity_candidates. */
interface PersonalRecordIdentityCandidate {
  id: string;
  local_profile_id: string | null;
  exercise_id: string | null;
  exercise_name: string;
  achieved_at: string;
  record_type: string;
  workout_phase: string | null;
  updated_at: string | null;
  deleted_at: string | null;
}

/** Keyset page size for the PR probe; must stay <= PostgREST max_rows (1000). */
const PERSONAL_RECORD_PROBE_PAGE_SIZE = 500;

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

/**
 * The portal-side workout session id a grouped mobile session belongs to.
 * A tombstone on the portal session blocks the whole group; the local session
 * id is the mobile component's own id and is gated separately.
 */
function portalSessionIdOf(session: {
  id: string;
  routineSessionId?: string | null;
}): string {
  return session.routineSessionId ?? session.id;
}

interface ExerciseDto {
  id: string;
  sessionId: string;
  exerciseId?: string | null;
  name: string;
  muscleGroup: string;
  orderIndex: number;
  /** 1 or 2; absent/null = unknown (pre-PR 29 mobile builds). Never assume 2. */
  cableCount?: number | null;
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
  dropSetEnabled?: boolean | null;
  dropSetMinWeightKg?: number | null;
  /** Absent = keep the stored duration (shipping builds never send it). */
  durationSeconds?: number | null;
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
  durationWeeks: number | null;
  workoutDays: number;
  restDays: number;
  currentWeek: number;
  status: string | null;
  startedAt: string | null;
  lastUsedAt: string | null;
  /** ISO 8601 last-write timestamp for LWW gate. Optional for backward compat. */
  updatedAt?: string | null;
  /**
   * KD-6: the server `updatedAt` this device last received for the cycle
   * (from a pull or a push response's `cycleVersions`). Absent on older
   * builds, which keep the legacy structure rules.
   */
  baseUpdatedAt?: string | null;
  progressionSettings: string | null;
  /**
   * R-12 presence bits: how a client distinguishes "authoritative NULL"
   * from "absent -> keep stored". Absent bits are omitted from the row,
   * never sent as `false`.
   */
  progressionSettingsPresent?: boolean;
  deloadSettings: string | null;
  templateId?: string | null;
  progressStatePresent?: boolean;
  progressState?: CycleProgressStateDto | null;
  days: CycleDayDto[];
}

/** One row of merge_training_cycles_from_push. */
interface CycleMergeRow extends LwwUpsertRow {
  structure_applied: boolean;
  /**
   * KD-5 (R-3/R-6): the stored LWW key. `server_updated_at` stays the stored
   * server-clock `updated_at` because it feeds `cycleVersions`, which the
   * device sends back as `baseUpdatedAt` and the merge compares with
   * `portal_edited_at`. Rejections report this column instead, so
   * `rejections[].serverUpdatedAt` is the LWW key for every entity.
   */
  client_updated_at: string | null;
}

interface CycleProgressStateDto {
  currentDayNumber: number;
  lastCompletedDate?: number | null;
  cycleStartDate: number;
  lastAdvancedAt?: number | null;
  completedDays: number[];
  missedDays: number[];
  rotationCount: number;
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
  /** Day-level presence bits (R-12). Absent bits are omitted, never `false`. */
  echoLevelPresent?: boolean;
  echoLevel?: string | null;
  eccentricLoadPercentPresent?: boolean;
  eccentricLoadPercent?: number | null;
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
  /**
   * Test seam for the LWW gate. Omitted in production, where the
   * SYNC_LWW_ENABLED cold-start flag applies.
   */
  syncLwwEnabled?: boolean;
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

const CATALOG_LOOKUP_COLUMNS = 'id, name, display_name, aliases, user_id, is_custom, archived';
const PUBLIC_CATALOG_TTL_MS = 10 * 60 * 1000;

/** Isolate-memory cache of the public (is_custom = false) exercise catalog. */
interface PublicCatalogCache {
  rows: CatalogLookupRow[] | null;
  fetchedAt: number;
}

async function fetchCatalogLookupPages(
  fetchPage: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: unknown; error: { message: string } | null }>,
): Promise<CatalogLookupRow[]> {
  const pageSize = 1000;
  const rows: CatalogLookupRow[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await fetchPage(from, from + pageSize - 1);
    if (error) {
      throw new Error(`exercise_catalog lookup failed: ${error.message}`);
    }
    const batch = catalogLookupFromUnknown(data);
    rows.push(...batch);
    if (batch.length < pageSize) break;
  }
  return rows;
}

async function getPublicCatalogRows(
  supabase: SupabaseClient,
  cache: PublicCatalogCache,
  nowMs: number,
): Promise<CatalogLookupRow[]> {
  const age = nowMs - cache.fetchedAt;
  if (cache.rows !== null && age >= 0 && age < PUBLIC_CATALOG_TTL_MS) {
    return cache.rows;
  }
  // Only a complete, successful fetch is cached; errors propagate uncached.
  const rows = await fetchCatalogLookupPages((from, to) =>
    supabase
      .from('exercise_catalog')
      .select(CATALOG_LOOKUP_COLUMNS)
      .eq('is_custom', false)
      .order('id', { ascending: true })
      .range(from, to)
  );
  cache.rows = rows;
  cache.fetchedAt = nowMs;
  return rows;
}

async function mobileSyncPushHandler(
  req: Request,
  dependencies: MobileSyncPushHandlerDependencies,
  publicCatalogCache: PublicCatalogCache,
): Promise<Response> {
  const cors = getCorsHeaders(req);
  const syncLwwEnabled = dependencies.syncLwwEnabled ?? SYNC_LWW_ENABLED;

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

    // Public library rows are cached per isolate (PUBLIC_CATALOG_TTL_MS); the
    // caller's custom rows are read on every push, after the upsert above.
    // Public rows precede custom rows, so a public name wins a name collision.
    const catalogIndexes = buildCatalogIndexes(
      [
        ...(await getPublicCatalogRows(supabase, publicCatalogCache, dependencies.now())),
        ...(await fetchCatalogLookupPages((from, to) =>
          supabase
            .from('exercise_catalog')
            .select(CATALOG_LOOKUP_COLUMNS)
            .eq('is_custom', true)
            .eq('user_id', userId)
            .order('id', { ascending: true })
            .range(from, to)
        )),
      ],
      userId,
    );
    const catalogResolution = resolveCatalogExerciseIds(catalogIndexes, [
      ...(payload.sessions ?? []).flatMap((session) =>
        (session.exercises ?? []).map((exercise) => ({
          id: exercise.exerciseId,
          name: exercise.name,
        })),
      ),
      ...(payload.routines ?? []).flatMap((routine) =>
        (routine.exercises ?? []).map((exercise) => ({
          id: exercise.exerciseId,
          name: exercise.name,
        })),
      ),
      ...(payload.exerciseSignatures ?? []).map((signature) => ({
        id: signature.exerciseId,
      })),
      ...(payload.assessments ?? []).map((assessment) => ({
        id: assessment.exerciseId,
      })),
      ...(payload.personalRecords ?? []).map((record) => ({
        id: record.exerciseId,
        name: record.exerciseName,
      })),
    ]);
    console.log(
      'catalog exercise_id resolution',
      JSON.stringify({
        matched: catalogResolution.matched,
        nameMatched: catalogResolution.nameMatched,
        unmatched: catalogResolution.unmatched,
      }),
    );
    const catalogId = (id?: string | null, name?: string | null) =>
      resolveCatalogExerciseId(catalogIndexes, id, name);

    // =========================================================================
    // 3a. Sync local profiles
    //
    // IMPORTANT: local_profile_id on workout_sessions/routines/cycles has a
    // composite FK → local_profiles(user_id, id).  The profile row MUST exist
    // before any session insert, otherwise the FK fires.  If the upsert fails
    // the push answers a retryable 503 before any session write (PR 22); it
    // never stores this push's rows profile-unscoped (NULL).
    // =========================================================================
    // `let`: cleared to null when the id is absent from allProfiles. The
    // deletion route keeps `requestProfileId`: deletion routing is immutable
    // operation metadata and must never be rebound when profile sync later
    // clears the active id.
    const requestProfileId: string | null = payload.profileId ?? null;
    let localProfileId: string | null = requestProfileId;
    const allProfiles: LocalProfileDto[] | null = payload.allProfiles ?? null;
    // Populated after the allProfiles upsert; consumed by the deferred
    // stale-registration cleanup below (reliability contract).
    let profileIdsForDeferredCleanup: string[] | null = null;
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
    // Whether this push changes a local_profiles row the portal shows. Every
    // push re-upserts the device's profiles, so a write alone is not a change;
    // compare against the stored rows instead. If they cannot be read, assume
    // a change so the portal is still told to refresh.
    let localProfilesChanged = false;
    const storedLocalProfiles = async (): Promise<StoredLocalProfile[] | null> => {
      const { data, error } = await supabase
        .from('local_profiles')
        .select('id, name, color_index, device_id')
        .eq('user_id', userId)
        .returns<StoredLocalProfile[]>();
      if (error) {
        console.warn('Failed to read local profiles for change detection:', error.message);
        return null;
      }
      return data ?? [];
    };

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

      const storedProfiles = await storedLocalProfiles();
      localProfilesChanged = storedProfiles === null ||
        localProfilesPushChangesRows(storedProfiles, profileRows, payload.deviceId);

      const { error: upsertError } = await supabase
        .from('local_profiles')
        .upsert(profileRows, { onConflict: 'user_id,id' });

      if (upsertError) {
        // Fail the push before any session write rather than storing rows
        // profile-unscoped (NULL): unscoped rows leak across local profiles
        // and are never re-scoped. Mobile retries the idempotent push.
        throw new PartialWriteRetryError('local_profiles upsert', upsertError);
      } else {
        const activeIds = allProfiles.map((p) => p.id);
        for (const id of activeIds) validLocalProfileIdsForPush.add(id);
        if (localProfileId && !validLocalProfileIdsForPush.has(localProfileId)) {
          console.warn('Clearing localProfileId because it is absent from allProfiles');
          localProfileId = null;
        }

        // Cleanup is deferred until ownership transfers have validated their
        // source profile. Removing the source registration first would make a
        // valid account-bound repair impossible to distinguish from a forged
        // transfer. The actual delete runs after those RPCs commit.
        profileIdsForDeferredCleanup = activeIds;
      }
    } else if (localProfileId) {
      // Upsert the active profile. Uses profileName when present; falls back to
      // a safe placeholder for clients that send profileId without profileName
      // (older builds pre-allProfiles field, or missing optional field).
      // Without this branch those clients hit a FK violation on session insert
      // because the local_profiles row doesn't exist yet (issue #376).
      const profileName =
        payload.profileName ?? (localProfileId === 'default' ? 'Default' : 'Profile');
      const activeProfileId = localProfileId;
      const storedProfiles = await storedLocalProfiles();
      const storedActive = storedProfiles?.find((row) => row.id === activeProfileId);
      localProfilesChanged = storedProfiles === null ||
        storedActive === undefined ||
        storedActive.name !== profileName ||
        storedActive.device_id !== payload.deviceId;
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
        // Same as above: never write this push's sessions unscoped.
        throw new PartialWriteRetryError('local_profiles upsert', profileError);
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
            // Repair only inserts ids that were missing, so any row is new.
            if ((repairedProfiles ?? []).length > 0) localProfilesChanged = true;
          }
        }
      }
    }

    // Account-bound repair operations are ordered before deletion and before
    // ordinary entity writes. The RPCs are transactional and return rows only
    // after commit, so their exact mutation ids are safe acknowledgements.
    let acknowledgedOwnershipTransferIds: string[] = [];
    if (payload.ownershipTransfers.length > 0) {
      const { data, error } = await supabase.rpc('transfer_profile_ownership', {
        p_user_id: userId,
        p_transfers: payload.ownershipTransfers,
      });
      if (error) throw new Error(`profile ownership transfer failed: ${error.message}`);
      acknowledgedOwnershipTransferIds = ((data ?? []) as Array<{ mutation_id?: unknown }>)
        .map((row) => row.mutation_id)
        .filter((id): id is string => typeof id === 'string');
    }

    let acknowledgedWorkoutDeletionIds: string[] = [];
    if (payload.workoutDeletions.length > 0) {
      const { data, error } = await supabase.rpc('apply_workout_deletions', {
        p_user_id: userId,
        // Deletion routing is immutable operation metadata. Profile sync above
        // may clear localProfileId when the original profile was deleted and
        // omitted from allProfiles; never rebind or erase the deletion route.
        p_request_profile_id: requestProfileId,
        p_deletions: payload.workoutDeletions,
      });
      if (error) throw new Error(`workout deletion failed: ${error.message}`);
      acknowledgedWorkoutDeletionIds = ((data ?? []) as Array<{ mutation_id?: unknown }>)
        .map((row) => row.mutation_id)
        .filter((id): id is string => typeof id === 'string');
    }

    // Populated only with ids accepted by the clocked deletion gate (7b).
    // Legacy clockless `deletedCycleIds` never appear here.
    let acknowledgedDeletedCycleIds: string[] = [];

    if (profileIdsForDeferredCleanup) {
      // allProfiles omission predates durable recovery and is ambiguous: it can
      // mean an intentional local delete or an orphaned cloud registration the
      // recovering device never knew about. Never cascade-delete an omitted
      // registration while it still owns cloud preference sections. Profile
      // preference transfer/merge is intentionally outside this contract.
      const { data: preferenceOwners, error: preferenceOwnerError } = await supabase
        .from('local_profile_preferences')
        .select('local_profile_id')
        .eq('user_id', userId)
        .returns<Array<{ local_profile_id: string }>>();
      if (preferenceOwnerError) {
        // Conservative failure mode: a preference lookup outage must not turn
        // profile registration cleanup into irreversible preference loss.
        console.warn('Skipping stale profile cleanup after preference lookup failure:', preferenceOwnerError.message);
      } else {
        const retainedProfileIds = new Set(profileIdsForDeferredCleanup);
        for (const row of preferenceOwners ?? []) retainedProfileIds.add(row.local_profile_id);
        const { error: deleteError } = await supabase
          .from('local_profiles')
          .delete()
          .eq('user_id', userId)
          .eq('device_id', payload.deviceId)
          .not(
            'id',
            'in',
            `${[...retainedProfileIds].map((id) => `"${id}"`).join(',')}`,
          );
        if (deleteError) console.warn('Failed to clean stale profiles:', deleteError.message);
      }
    }

    // Query permanent account+target tombstones before active hierarchy writes.
    // A portal session is the grouped workout parent; a mobile component is its
    // stable exercises.id child. They are gated separately so deleting one
    // component never suppresses or erases its siblings.
    let blockedWorkoutSessionIds = new Set<string>();
    let blockedWorkoutComponentIds = new Set<string>();
    if (payload.sessions.length > 0) {
      const { data, error } = await supabase.rpc('get_blocked_workout_session_ids', {
        p_user_id: userId,
        p_sessions: payload.sessions.map((session) => ({
          id: session.id,
          portalSessionId: portalSessionIdOf(session),
        })),
      });
      if (error) throw new Error(`workout tombstone lookup failed: ${error.message}`);
      blockedWorkoutSessionIds = new Set(
        ((data ?? []) as Array<{ session_id?: unknown }>)
          .map((row) => row.session_id)
          .filter((id): id is string => typeof id === 'string'),
      );

      const components = payload.sessions.flatMap((session) =>
        session.exercises.map((exercise) => ({
          id: exercise.id,
          portalSessionId: portalSessionIdOf(session),
        }))
      );
      if (components.length > 0) {
        const { data: componentData, error: componentError } = await supabase.rpc(
          'get_blocked_workout_component_ids',
          { p_user_id: userId, p_components: components },
        );
        if (componentError) {
          throw new Error(`workout component tombstone lookup failed: ${componentError.message}`);
        }
        blockedWorkoutComponentIds = new Set(
          ((componentData ?? []) as Array<{ component_id?: unknown }>)
            .map((row) => row.component_id)
            .filter((id): id is string => typeof id === 'string'),
        );
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
    // Rows the LWW RPC actually accepted for the device-owned stats tables.
    // `Boolean(payload.rpgAttributes)` is NOT a change signal: a push whose
    // only row was rejected writes nothing, and must not wake the portal.
    let rpgAttributesAccepted = 0;
    let gamificationStatsAccepted = 0;

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

    // cycle_days ids are not probed: the day upsert never writes `id` (it
    // conflicts on (cycle_id, day_number)), and every day's cycleId must equal
    // its payload parent cycle, whose id is covered by directOwnerChecks.

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
    // KD-4 / R-24: a missing routine is one that was deleted (on the portal or
    // another device). Mobile pushes every cycle on every sync but routines
    // only as a delta, so an old build keeps sending a day that points at the
    // deleted routine. Rejecting that with 400 would stall its sync forever;
    // the reference is written as NULL instead (the FK's ON DELETE SET NULL
    // semantics), see step 7c. Another user's routine is still refused.
    const dayRoutineProbe = await assertParentRowsExistAndOwnedByUser(
      supabase,
      'routines',
      dayRoutineIdsToVerify,
      userId,
      cors,
      { allowMissing: true },
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
    const validPersonalRecordSessionIds = new Set<string>(
      [...sessionIdSet].filter((id) => !blockedWorkoutSessionIds.has(id)),
    );
    for (const id of personalRecordSessionProbe.validIds) {
      validPersonalRecordSessionIds.add(id);
    }

    // =========================================================================
    // LWW reject tracking. When SYNC_LWW_ENABLED is false, these remain empty
    // and no filtering is applied (exception: `cycles` also lists a cycle the
    // merge RPC refused as another user's or concurrently deleted). When
    // true, the push handler routes each shared-edit entity upsert through
    // its `upsert_<entity>_lww` RPC (cycles: merge_training_cycles_from_push)
    // and uses the accepted-id sets to filter child-table upserts so orphan
    // child rows are not created under rejected parents.
    // =========================================================================
    const rejections = {
      sessions: [] as EntityRejection[],
      routines: [] as EntityRejection[],
      cycles: [] as EntityRejection[],
      externalActivities: [] as EntityRejection[],
      rpgAttributes: [] as EntityRejection[],
      gamificationStats: [] as EntityRejection[],
    };
    // Optional GAP tables whose write failed. The push still answers 200
    // (these rows are non-critical and old mobile would otherwise retry the
    // whole batch forever); the ids are the mobile DTO ids so a mobile
    // follow-up can keep exactly those rows dirty. Old mobile ignores the key.
    const failed = {
      phaseStatistics: [] as string[],
      exerciseSignatures: [] as string[],
      assessments: [] as string[],
      externalActivities: [] as string[],
    };
    // null = flag OFF (accept-all semantics). Set = flag ON (only listed IDs
    // cleared the LWW gate).
    let acceptedSessionIds: Set<string> | null = null;
    let acceptedCycleIds = new Set<string>();
    let acceptedRoutineIds: Set<string> | null = null;
    // Cycles: the merge RPC applies the LWW gate to cycle_days itself (KD-6).

    const childAllowed = <T>(parentSet: Set<string> | null, parentId: string): boolean =>
      parentSet === null || parentSet.has(parentId);

    // =========================================================================
    // KD-4: refuse to resurrect deleted routines and cycles.
    //
    // A routine or cycle deleted on the portal (or by another device) has a
    // row in sync_tombstones. Older builds never learn of the delete and keep
    // pushing it; re-creating it would undo the user's delete. Tombstoned ids
    // are dropped here together with their nested routine_exercises /
    // cycle_days and reported under `skippedDeleted`. The push still succeeds,
    // so those builds never get stuck in a failing retry loop.
    // Runs for both SYNC_LWW_ENABLED values, before any routine/cycle write.
    // =========================================================================
    const skippedDeleted = { routines: [] as string[], cycles: [] as string[] };
    // KD-6: stored updated_at of each cycle whose pushed structure was
    // applied. The device keeps it as the cycle's next baseUpdatedAt.
    const cycleVersions: Record<string, string> = {};
    // Race guard (R-4): a portal delete that lands between this lookup and
    // the upsert below would be undone by the upsert, and
    // get_sync_tombstones hides tombstones of rows that are live again, so
    // the delete would be lost for good. After the writes, any written id
    // that gained a tombstone since just before the lookup is deleted again
    // (the trigger refreshes its tombstone). The margin absorbs Edge/DB clock
    // skew; it could only misfire for a same-user delete + re-create of the
    // same id inside that margin.
    const tombstoneRaceSince = new Date(Date.now() - TOMBSTONE_RACE_MARGIN_MS).toISOString();
    // KD-5 undated-push rule (review R-1/R-7): one receipt timestamp for the
    // whole request, substituted for any session/routine/cycle DTO that
    // carries no `updatedAt`. Used under BOTH SYNC_LWW_ENABLED values so the
    // stored LWW key is identical whichever way the flag is set.
    const pushReceivedAt = new Date(dependencies.now()).toISOString();
    const reDeleteRacedTombstones = async (
      entity: 'routine' | 'cycle',
      table: 'routines' | 'training_cycles',
      ids: string[],
    ): Promise<string[]> => {
      const unique = [...new Set(ids)];
      const raced = new Set<string>();
      const chunkSize = 100;
      for (let i = 0; i < unique.length; i += chunkSize) {
        const chunk = unique.slice(i, i + chunkSize);
        const { data, error } = await supabase
          .from('sync_tombstones')
          .select('entity_id')
          .eq('user_id', userId)
          .eq('entity', entity)
          .gte('deleted_at', tombstoneRaceSince)
          .in('entity_id', chunk);
        if (error) throw new Error(`sync tombstone race check failed: ${error.message}`);
        for (const row of (data ?? []) as Array<{ entity_id?: unknown }>) {
          if (typeof row.entity_id === 'string') raced.add(row.entity_id);
        }
      }
      if (raced.size === 0) return [];
      const racedIds = [...raced];
      const { error: delErr } = await supabase
        .from(table)
        .delete()
        .eq('user_id', userId)
        .in('id', racedIds);
      if (delErr) throw new Error(`${table} race re-delete failed: ${delErr.message}`);
      console.warn(
        `Re-deleted ${racedIds.length} ${table} row(s) deleted concurrently with this push`,
      );
      return racedIds;
    };
    let liveRoutines = payload.routines ?? [];
    let liveCycles = payload.cycles ?? [];
    if (allRoutineIds.length > 0 || allCycleIds.length > 0) {
      const { data: tombstoneRows, error: tombstoneErr } = await supabase.rpc(
        'get_sync_tombstones',
        {
          p_user_id: userId,
          p_entity: null,
          p_ids: [...new Set([...allRoutineIds, ...allCycleIds])],
          p_since: null,
        },
      );
      if (tombstoneErr) throw new Error(`sync tombstone lookup failed: ${tombstoneErr.message}`);
      const tombstonedRoutineIds = new Set<string>();
      const tombstonedCycleIds = new Set<string>();
      for (const row of (Array.isArray(tombstoneRows) ? tombstoneRows : []) as Array<{
        entity?: unknown;
        entity_id?: unknown;
      }>) {
        if (typeof row.entity_id !== 'string') continue;
        if (row.entity === 'routine') tombstonedRoutineIds.add(row.entity_id);
        else if (row.entity === 'cycle') tombstonedCycleIds.add(row.entity_id);
      }
      liveRoutines = liveRoutines.filter((r) => !tombstonedRoutineIds.has(r.id));
      liveCycles = liveCycles.filter((c) => !tombstonedCycleIds.has(c.id));
      skippedDeleted.routines = [...new Set(allRoutineIds.filter((id) => tombstonedRoutineIds.has(id)))];
      skippedDeleted.cycles = [...new Set(allCycleIds.filter((id) => tombstonedCycleIds.has(id)))];
      if (skippedDeleted.routines.length > 0 || skippedDeleted.cycles.length > 0) {
        console.log(
          `Skipped ${skippedDeleted.routines.length} deleted routine(s) and ` +
            `${skippedDeleted.cycles.length} deleted cycle(s) from push`,
        );
      }
    }

    // =========================================================================
    // 4. Insert workout hierarchy in FK order
    // =========================================================================
    if (payload.sessions && payload.sessions.length > 0) {
      // --- 4a. Upsert workout_sessions ---
      const sessionRows = payload.sessions
        .filter((s) => !blockedWorkoutSessionIds.has(s.id))
        .map((s) => ({
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
        // KD-5: the LWW key, written under both SYNC_LWW_ENABLED values.
        // updated_at (the pull cursor) is never sent: the server sets it to
        // now() on INSERT (column default) and UPDATE (trigger), so a slow
        // device clock cannot hide the row from delta pulls (NF-12).
        //
        // Undated-push rule (review R-1/R-7), identical under both flag
        // values and for all three entities: a DTO without `updatedAt` is
        // dated at the moment this request is served. It therefore never
        // erases a stored key (a NULL here would wipe a portal edit's stamp
        // on the LWW-off UPDATE path), and it wins against a portal edit
        // made earlier, because arrival time is the only date the server
        // has. "A portal edit beats an earlier mobile version" consequently
        // holds only for builds that send `updatedAt`; rejecting undated
        // pushes instead would strand such a build's edits entirely.
        client_updated_at: s.updatedAt ?? pushReceivedAt,
      }));

      // Ownership of every session id was verified once in directOwnerChecks.

      if (syncLwwEnabled) {
        // Phase 3.2: route through the LWW RPC so the server rejects stale
        // rows instead of overwriting with older data. Accepted ids are used
        // to filter the exercises/sets/rep_summaries child upserts below.
        // The rows already carry the LWW key (`pushReceivedAt` when the DTO
        // omitted `updatedAt`), identically to the LWW-off branch.
        const { data: lwwData, error: lwwErr } = await supabase.rpc(
          'upsert_workout_session_lww',
          { p_rows: sessionRows },
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
        // Flag-off has no LWW gate, so every row that reached this upsert is
        // committed. Name them for the receipt list: `null` still means
        // "accept-all" for child filtering below, but `acknowledgedWorkout-
        // SessionIds` must report what was written under BOTH flag values
        // (reliability contract at the response). sessionRows is exactly the
        // non-blocked payload sessions, so childAllowed is unchanged.
        acceptedSessionIds = new Set(sessionRows.map((row) => row.id));
      }

      // --- 4b-pre. Atomic delete + re-insert of session children (issue #33, F343) ---
      // Current mobile keeps the exercise id stable (its session id, issue
      // #33) but generates new set/rep/telemetry UUIDs each sync push (older
      // clients regenerated exercise ids too), so upsert-by-id never matches
      // the old child rows and duplicates pile up. We therefore delete the
      // existing exercises for the affected sessions (CASCADE removes their
      // sets, rep_summaries and rep_telemetry) and re-insert the new rows.
      // Stored telemetry of a set the payload re-sends WITHOUT telemetry is
      // re-linked to the new set id when the match is unambiguous (see
      // 20260920002000_replace_session_children_preserve_telemetry.sql for
      // the key rule). The sessions' exercise_progress rows are replaced in
      // the same call (20260920002400_progress_refresh_and_indexes.sql).
      // That delete + re-insert is performed in ONE
      // transaction by the replace_session_children RPC below: previously the
      // delete and each upsert were separate statements, so a failure after the
      // delete permanently destroyed the user's data. The child rows are built
      // and ownership-checked here; the single RPC call near the end of this
      // block does the atomic swap.
      const affectedSessionIds = payload.sessions
        .filter((s) => childAllowed(acceptedSessionIds, s.id))
        .filter((s) => !blockedWorkoutSessionIds.has(s.id))
        .map((s) => s.id);

      // --- 4b. Build exercise rows ---
      // When LWW is enabled, only accept exercises whose parent session was
      // accepted by the LWW gate. Rejecting the parent but inserting the
      // children would leave orphan rows referencing a stale session.
      const exerciseRows = payload.sessions
        .filter((s) => childAllowed(acceptedSessionIds, s.id))
        .filter((s) => !blockedWorkoutSessionIds.has(s.id))
        .flatMap((s) =>
          s.exercises.filter((e) => !blockedWorkoutComponentIds.has(e.id)).map((e) => ({
            id: e.id,
            session_id: e.sessionId,
            user_id: userId,
            name: e.name,
            exercise_id: catalogId(e.exerciseId, e.name),
            muscle_group: e.muscleGroup ?? 'General',
            order_index: e.orderIndex ?? 0,
            // PR 28: NULL = unknown (older builds send nothing).
            cable_count: e.cableCount ?? null,
          }))
        );

      // Defense-in-depth: deduplicate by id before upsert. The pre-flight
      // duplicate check should prevent this, but case-insensitive UUID
      // collisions (iOS uppercase vs Android lowercase) can slip past the
      // case-sensitive JS Set check while PostgreSQL treats them as equal.
      const dedupedExerciseRows = deduplicateByKey(exerciseRows, (r) => r.id);

      // Ownership of these ids (a subset of allExerciseIds) was verified once
      // in directOwnerChecks, before the replace_session_children RPC below.

      // --- 4c. Build set rows ---
      // NOTE: `prType`, `prPhase`, `prVolume` are intentionally NOT in this row
      // projection. They are send-only derivation hints consumed by the
      // personal_records insert path below; the `sets` table has no columns
      // for them. See PortalSetDto doc comment in mobile for the contract.
      // Resolves audit item #3 (2026-04-19).
      const setRows = payload.sessions
        .filter((s) => childAllowed(acceptedSessionIds, s.id))
        .filter((s) => !blockedWorkoutSessionIds.has(s.id))
        .flatMap((s) =>
          s.exercises.filter((e) => !blockedWorkoutComponentIds.has(e.id)).flatMap((e) =>
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

      // Ownership (subset of allSetIds) was verified once in directOwnerChecks.

      // --- 4d. Build rep_summary rows ---
      const repRows = payload.sessions
        .filter((s) => childAllowed(acceptedSessionIds, s.id))
        .filter((s) => !blockedWorkoutSessionIds.has(s.id))
        .flatMap((s) =>
          s.exercises.filter((e) => !blockedWorkoutComponentIds.has(e.id)).flatMap((e) =>
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

      // Ownership (subset of allRepSummaryIds) was verified once in
      // directOwnerChecks.

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

      // --- 4f-pre. Compute exercise_progress (mobile-provided 1RM, hybrid
      // fallback; PARITY-CRITICAL, see _shared/exerciseProgressRows.ts) for
      // every accepted session, new or edited. Filtered through childAllowed
      // like every other child path so LWW-rejected sessions keep the
      // server's newer progress (Issue #99 RCA layer 3). One row per
      // (session, catalog id or name): the first wins, as before.
      // The rows are passed to replace_session_children as p_progress, which
      // replaces the sessions' stored progress in the same transaction, so an
      // edited weight refreshes max_weight_kg / estimated_1rm_kg and a removed
      // exercise loses its row (F-069; migration
      // 20260920002400_progress_refresh_and_indexes.sql). Always an array, so
      // an accepted session that now has no progress rows is cleared too.
      const acceptedSessions = payload.sessions
        .filter((s) => childAllowed(acceptedSessionIds, s.id))
        .filter((s) => !blockedWorkoutSessionIds.has(s.id));
      const progressIdentityKey = (row: {
        session_id: string;
        exercise_id: string | null;
        exercise_name: string;
      }) =>
        row.exercise_id !== null && row.exercise_id.length > 0
          ? `${row.session_id}:id:${row.exercise_id}`
          : `${row.session_id}:name:${row.exercise_name}`;
      const seenProgressKeys = new Set<string>();
      const progressRows = buildExerciseProgressRows(
        acceptedSessions,
        userId,
        localProfileId,
      )
        .map((row) => ({
          ...row,
          exercise_id: catalogId(row.exercise_id, row.exercise_name),
        }))
        .filter((row) => {
          const key = progressIdentityKey(row);
          if (seenProgressKeys.has(key)) return false;
          seenProgressKeys.add(key);
          return true;
        });

      // --- 4f. Atomic swap: delete affected sessions' children + re-insert all
      // child rows (and refresh their exercise_progress) in a single
      // transaction (F343). A failure anywhere rolls that transaction's delete
      // back, so the children cannot be left half-written. The parent
      // `workout_sessions` rows are already committed by 4a, though, so an RPC
      // failure here IS a cross-step partial write and must answer 503
      // `partial_write_retry` — a bare 500 would let mobile advance `lastSync`
      // and drop the children for good.
      if (
        affectedSessionIds.length > 0 ||
        dedupedExerciseRows.length > 0 ||
        dedupedTelemetryRows.length > 0
      ) {
        const { data: replaceData, error: replaceErr } = await supabase.rpc('replace_session_children', {
          p_user_id: userId,
          p_session_ids: affectedSessionIds,
          p_exercises: dedupedExerciseRows,
          p_sets: dedupedSetRows,
          p_rep_summaries: dedupedRepRows,
          p_rep_telemetry: dedupedTelemetryRows,
          p_progress: progressRows,
        });
        if (replaceErr) {
          throw new PartialWriteRetryError('session children replace', replaceErr);
        }
        exercisesInserted = dedupedExerciseRows.length;
        setsInserted = dedupedSetRows.length;
        repSummariesInserted = dedupedRepRows.length;
        telemetryInserted = dedupedTelemetryRows.length;
        // Rows the RPC actually wrote (step 7 ignores rows outside
        // p_session_ids / p_user_id), not rows sent.
        const writtenProgress = (replaceData as { exercise_progress?: unknown } | null)
          ?.exercise_progress;
        exerciseProgressInserted = typeof writtenProgress === 'number' ? writtenProgress : 0;
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
      prRows = prRows.map((row) => ({
        ...row,
        exercise_id: catalogId(row.exercise_id, row.exercise_name),
      }));

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
      // Dedicated ids too, so a stored row whose achieved_at was edited is
      // still found by id for the LWW / tombstone guard below.
      const probeIds = [
        ...new Set(
          prRows
            .map((row) => row.id)
            .filter((id): id is string => typeof id === 'string' && UUID_REGEX.test(id)),
        ),
      ];
      // Existing-row probe via RPC: the timestamps travel in the POST body
      // (no GET `.in()` URL wall) and results are keyset-paged by id, so
      // PostgREST max_rows can never silently truncate the de-dup lookup.
      const existingPrs: PersonalRecordIdentityCandidate[] = [];
      let existingPrCursor: string | null = null;
      for (;;) {
        const { data: page, error: existingPrErr } = await supabase.rpc(
          'get_personal_record_identity_candidates',
          {
            p_user_id: userId,
            p_achieved_at: achievedAtValues,
            p_ids: probeIds,
            p_after_id: existingPrCursor,
            p_limit: PERSONAL_RECORD_PROBE_PAGE_SIZE,
          },
        );
        if (existingPrErr) {
          throw new Error(`personal_records lookup failed: ${existingPrErr.message}`);
        }
        const rows = (page ?? []) as PersonalRecordIdentityCandidate[];
        existingPrs.push(...rows);
        const lastId = rows.length > 0 ? rows[rows.length - 1].id : null;
        if (
          rows.length < PERSONAL_RECORD_PROBE_PAGE_SIZE ||
          typeof lastId !== 'string' ||
          lastId === existingPrCursor
        ) {
          break;
        }
        existingPrCursor = lastId;
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
        // Dedicated rows keep the id-keyed upsert (F335: same derived
        // identity with a different id is a distinct record). Set-derived
        // rows go through SQL so ON CONFLICT can target the partial unique
        // index on their derived identity (R-3): a re-push or a concurrent
        // push of the same PR updates one row instead of inserting another.
        const writePersonalRecords = (rows: typeof prRowsToWrite) => dedicatedPrsPresent
          ? supabase
              .from('personal_records')
              .upsert(rows, { onConflict: 'id' })
          : supabase.rpc('upsert_set_derived_personal_records', {
              p_user_id: userId,
              p_rows: rows,
            });
        // The set-derived RPC returns how many rows it actually inserted or
        // changed (0 when a concurrent push already wrote the same values).
        // The dedicated PostgREST upsert reports nothing, so it counts rows
        // submitted, as before.
        const countWritten = (data: unknown, submitted: number): number => {
          if (dedicatedPrsPresent) return submitted;
          if (typeof data !== 'number' || !Number.isInteger(data) || data < 0) {
            throw new Error('personal_records set-derived upsert returned an unexpected result');
          }
          return data;
        };

        const { data: prData, error: prErr } = await writePersonalRecords(prRowsToWrite);
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

          const { data: retryData, error: retryErr } = await writePersonalRecords(
            sessionPartition.rowsWithInvalidSessionsNulled,
          );
          if (retryErr) throw new Error(`personal_records retry after FK fix failed: ${retryErr.message}`);
          personalRecordsInserted = countWritten(
            retryData,
            sessionPartition.rowsWithInvalidSessionsNulled.length,
          );
        } else if (prErr) {
          throw new Error(`personal_records ${dedicatedPrsPresent ? 'upsert' : 'insert'} failed: ${prErr.message}`);
        } else {
          personalRecordsInserted = countWritten(prData, prRowsToWrite.length);
        }
      }
    }

    // =========================================================================
    // 7. Upsert routines + upsert routine_exercises (safe replace pattern)
    //    Uses upsert-by-PK instead of delete+insert to prevent data loss if
    //    the insert step fails after a successful delete. Orphan exercises
    //    (removed from routine on mobile) are cleaned up after upsert succeeds.
    // =========================================================================
    if (liveRoutines.length > 0) {
      const routineRows = liveRoutines.map((r) => ({
        id: r.id,
        user_id: userId,
        local_profile_id: localProfileId,
        name: r.name,
        description: r.description ?? '',
        exercise_count: r.exerciseCount ?? 0,
        estimated_duration: Math.round(r.estimatedDuration ?? 0),
        times_completed: r.timesCompleted ?? 0,
        is_favorite: r.isFavorite ?? false,
        // KD-5: the LWW key, written under both SYNC_LWW_ENABLED values.
        // updated_at (pull cursor) is server-owned (NF-12). An undated DTO
        // is dated at receipt — see the session mapping above (R-1/R-7).
        client_updated_at: r.updatedAt ?? pushReceivedAt,
      }));

      // Ownership of every routine id was verified once in directOwnerChecks.

      if (syncLwwEnabled) {
        const { data: lwwData, error: lwwErr } = await supabase.rpc(
          'upsert_routine_lww',
          { p_rows: routineRows },
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
      const reSource = liveRoutines
        .filter((r) => childAllowed(acceptedRoutineIds, r.id))
        .flatMap((r) => r.exercises);

      // Merge drop-set columns per row. Omission/`null` must not write a null
      // floor over an existing enabled row, and every upsert object needs both
      // keys so defaultToNull cannot NULL a sibling row's omitted flag.
      //
      // duration_seconds follows the same rule: a row that omits
      // durationSeconds keeps its stored value. When no row in the batch
      // carries the field (every shipping mobile build), the column is left
      // out of the upsert entirely, so it is never touched. When some rows
      // carry it, the rows that don't are filled from the existing row.
      const anyDurationSent = reSource.some((e) => e.durationSeconds !== undefined);
      const dropSetProbeIds = [...new Set(
        reSource
          .filter((e) =>
            needsDropSetExistingRow(e) ||
            (anyDurationSent && e.durationSeconds === undefined)
          )
          .map((e) => e.id),
      )];
      const existingDropSets = new Map<string, {
        drop_set_enabled: boolean;
        drop_set_min_weight_kg: number | null;
      }>();
      const existingDurations = new Map<string, number | null>();
      if (dropSetProbeIds.length > 0) {
        const chunkSize = 100;
        for (let i = 0; i < dropSetProbeIds.length; i += chunkSize) {
          const chunk = dropSetProbeIds.slice(i, i + chunkSize);
          const { data: existingExercises, error: existingDropSetErr } = await supabase
            .from('routine_exercises')
            .select('id, drop_set_enabled, drop_set_min_weight_kg, duration_seconds')
            .in('id', chunk);
          if (existingDropSetErr) {
            throw new Error(
              `routine_exercises drop-set probe failed: ${existingDropSetErr.message}`,
            );
          }
          for (const row of existingExercises ?? []) {
            if (typeof row.id !== 'string') continue;
            existingDropSets.set(row.id, {
              drop_set_enabled: row.drop_set_enabled === true,
              drop_set_min_weight_kg: coerceDropSetMinWeightKg(
                row.drop_set_min_weight_kg,
              ),
            });
            existingDurations.set(
              row.id,
              typeof row.duration_seconds === 'number' ? row.duration_seconds : null,
            );
          }
        }
      }

      const reRows = reSource.map((e) => ({
        id: e.id,
        routine_id: e.routineId,
        name: e.name,
        exercise_id: catalogId(e.exerciseId, e.name),
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
        ...resolveDropSetUpsertFields(
          {
            dropSetEnabled: e.dropSetEnabled,
            dropSetMinWeightKg: e.dropSetMinWeightKg,
          },
          existingDropSets.get(e.id) ?? null,
        ),
        ...(anyDurationSent
          ? {
            duration_seconds: e.durationSeconds !== undefined
              ? e.durationSeconds
              : existingDurations.get(e.id) ?? null,
          }
          : {}),
      }));

      if (reRows.length > 0) {
        const { error: reErr } = await supabase
          .from('routine_exercises')
          .upsert(reRows, { onConflict: 'id' });
        // Same retryable contract as the orphan cleanup that follows (R-5).
        if (reErr) throw new PartialWriteRetryError('routine_exercises upsert', reErr);
      }

      // Remove orphan exercises: rows belonging to synced routines whose IDs
      // are not in the current payload. This handles exercises deleted on mobile.
      const syncedExerciseIds = reRows.map((r) => r.id);
      const routineIds = liveRoutines
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
          if (orphanErr) throw new PartialWriteRetryError('routine_exercises orphan cleanup', orphanErr);
        } else {
          // Routine has zero exercises now -- delete all
          const { error: orphanErr } = await supabase
            .from('routine_exercises')
            .delete()
            .eq('routine_id', routineId);
          if (orphanErr) throw new PartialWriteRetryError('routine_exercises orphan cleanup', orphanErr);
        }
      }

      // R-4 race guard: undo a re-create of a routine deleted meanwhile.
      const racedRoutineIds = await reDeleteRacedTombstones(
        'routine',
        'routines',
        liveRoutines.map((r) => r.id),
      );
      if (racedRoutineIds.length > 0) {
        const raced = new Set(racedRoutineIds);
        liveRoutines = liveRoutines.filter((r) => !raced.has(r.id));
        skippedDeleted.routines.push(...racedRoutineIds);
        routinesUpserted = Math.max(0, routinesUpserted - racedRoutineIds.length);
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

      await deleteOwnedRowsInChunks(
        supabase,
        'routines',
        payload.deletedRoutineIds,
        userId,
        'routine delete',
      );
      console.log(`Deleted ${payload.deletedRoutineIds.length} routine(s) from server`);
    }

    // =========================================================================
    // 7b. Cycle deletions (docs/sync-reliability-contract.md).
    //
    //     Clocked (`deletedCycles`): the device's delete carries `updatedAt`,
    //     so it can be ordered against the stored LWW key. A delete that loses
    //     that order is a structured cycle rejection and the server keeps its
    //     copy. A winning delete hard-deletes the row (CASCADE takes
    //     cycle_days; the AFTER DELETE trigger records a tombstone so a later
    //     stale upload cannot recreate it) and is acknowledged in
    //     `acknowledgedDeletedCycleIds`. A winning delete of an id the server
    //     no longer holds records the tombstone anyway — that is the point of
    //     sending a clock at all.
    //
    //     Legacy (`deletedCycleIds`) has no usable clock and older store
    //     builds still send it. It NEVER hard-deletes and NEVER writes a cycle
    //     tombstone: an existing server row becomes a structured cycle
    //     rejection so the sender keeps the server copy, and an id with no
    //     server row is a silent no-op (neither acknowledged nor rejected).
    //     Ids already covered by a clocked entry are left to that gate.
    // =========================================================================
    const clockedDeleteById = new Map<string, string>();
    for (const deletion of payload.deletedCycles ?? []) {
      const previous = clockedDeleteById.get(deletion.id);
      if (!previous || deletion.updatedAt > previous) {
        clockedDeleteById.set(deletion.id, deletion.updatedAt);
      }
    }
    const legacyDeleteIds = [...new Set(payload.deletedCycleIds ?? [])].filter(
      (id) => Boolean(id) && !clockedDeleteById.has(id),
    );
    const cycleDeleteProbeIds = [
      ...new Set([...clockedDeleteById.keys(), ...legacyDeleteIds]),
    ].filter(Boolean);

    if (cycleDeleteProbeIds.length > 0) {
      // Ownership: a crafted id that belongs to somebody else is still a 400,
      // whichever delete form named it.
      const cycleDelOwnershipResp = await assertRowsOwnedByUser(
        supabase,
        'training_cycles',
        cycleDeleteProbeIds,
        userId,
        cors,
      );
      if (cycleDelOwnershipResp) return cycleDelOwnershipResp;

      // One probe for both forms. The stored LWW key orders a clocked delete
      // and is what a rejection reports as `serverUpdatedAt` (KD-5).
      const storedLwwById = new Map<string, string | null>();
      for (let i = 0; i < cycleDeleteProbeIds.length; i += 100) {
        const chunk = cycleDeleteProbeIds.slice(i, i + 100);
        const { data: rows, error } = await supabase
          .from('training_cycles')
          .select('id, client_updated_at')
          .in('id', chunk)
          .eq('user_id', userId);
        if (error) throw new PartialWriteRetryError('cycle delete probe', error);
        for (const row of (rows ?? []) as Array<{
          id: string;
          client_updated_at: string | null;
        }>) {
          storedLwwById.set(row.id, row.client_updated_at ?? null);
        }
      }

      // --- 7b-i. Clocked deletes (the authoritative form) ---
      const winningDeleteIds: string[] = [];
      for (const [id, deleteClock] of clockedDeleteById) {
        const hasRow = storedLwwById.has(id);
        const stored = storedLwwById.get(id) ?? null;
        const storedMs = stored ? Date.parse(stored) : Number.NaN;
        const deleteMs = Date.parse(deleteClock);
        // A usable incoming timestamp may delete only when it is at least the
        // stored LWW key. A row whose stored key is strictly newer survives.
        // A row with no usable stored key loses to a usable delete clock.
        if (
          hasRow &&
          Number.isFinite(storedMs) &&
          Number.isFinite(deleteMs) &&
          storedMs > deleteMs
        ) {
          rejections.cycles.push({ id, serverUpdatedAt: stored });
          continue;
        }
        winningDeleteIds.push(id);
      }

      if (winningDeleteIds.length > 0) {
        const presentIds = winningDeleteIds.filter((id) => storedLwwById.has(id));
        const absentIds = winningDeleteIds.filter((id) => !storedLwwById.has(id));
        if (presentIds.length > 0) {
          await deleteOwnedRowsInChunks(
            supabase,
            'training_cycles',
            presentIds,
            userId,
            'cycle delete',
          );
        }
        // An id the server no longer holds still needs the tombstone, or the
        // next stale upload from the deleting device recreates the cycle.
        for (let i = 0; i < absentIds.length; i += 100) {
          const chunk = absentIds.slice(i, i + 100);
          const { error } = await supabase.from('sync_tombstones').upsert(
            chunk.map((id) => ({
              user_id: userId,
              entity: 'cycle' as const,
              entity_id: id,
              deleted_at: new Date(dependencies.now()).toISOString(),
            })),
            { onConflict: 'user_id,entity,entity_id' },
          );
          if (error) throw new PartialWriteRetryError('cycle tombstone insert', error);
        }
        acknowledgedDeletedCycleIds.push(...winningDeleteIds);
        console.log(
          `Deleted ${presentIds.length} cycle(s) from server; ` +
            `tombstoned ${absentIds.length} already-absent cycle(s)`,
        );
      }

      // --- 7b-ii. Legacy clockless ids: never hard-delete, never tombstone. ---
      for (const id of legacyDeleteIds) {
        if (!storedLwwById.has(id)) continue; // silent no-op
        rejections.cycles.push({ id, serverUpdatedAt: storedLwwById.get(id) ?? null });
      }
    }

    // =========================================================================
    // 7c. Merge training_cycles + cycle_days in SQL (KD-6)
    //     One service-role RPC upserts the cycles and their days and removes
    //     orphan days, for both SYNC_LWW_ENABLED values. It keeps portal
    //     config the phone doesn't know about (deload, progression keys,
    //     rest_type, duration), ignores a stale structure (portal edited the
    //     cycle after the device's baseUpdatedAt), and skips no-op writes.
    // =========================================================================
    if (liveCycles.length > 0) {
      // Ownership of every cycle id was verified once in directOwnerChecks.

      // KD-4 / R-24: decided here, after this push's own routine writes (7)
      // and deletes (7a). A day keeps its routine only when that routine
      // exists now: it was in this push and not tombstoned (a routine
      // created earlier in the same push counts; an LWW-rejected one still
      // exists on the server), or it already existed for this user at the 3b
      // probe. A tombstoned, missing or just-deleted routine becomes NULL,
      // matching the FK's ON DELETE SET NULL, so the write cannot fail.
      const deletedInThisPush = new Set(payload.deletedRoutineIds ?? []);
      const keepableDayRoutineIds = new Set<string>([
        ...liveRoutines.map((r) => r.id),
        ...dayRoutineProbe.validIds,
      ]);
      const skippedRoutineIds = new Set(skippedDeleted.routines);
      // Cleared references are logged, never dropped silently (R-3).
      const clearedDeletedRefs = new Set<string>();
      const clearedMissingRefs = new Set<string>();
      const dayRoutineId = (routineId: string | null | undefined): string | null => {
        if (!routineId) return null;
        if (keepableDayRoutineIds.has(routineId) && !deletedInThisPush.has(routineId)) {
          return routineId;
        }
        if (skippedRoutineIds.has(routineId) || deletedInThisPush.has(routineId)) {
          clearedDeletedRefs.add(routineId);
        } else {
          // Not in this push and not on the server for this user (deleted
          // before tombstones existed, or never pushed from the device).
          clearedMissingRefs.add(routineId);
        }
        return null;
      };

      const cycleRows = liveCycles.map((c) => ({
        id: c.id,
        user_id: userId,
        local_profile_id: localProfileId,
        name: c.name,
        // Absent/null description, duration and status pass through as NULL:
        // the merge keeps the stored value, and its INSERT applies defaults.
        description: c.description ?? null,
        duration_weeks: c.durationWeeks ?? null,
        workout_days: c.workoutDays ?? 0,
        rest_days: c.restDays ?? 0,
        current_week: c.currentWeek ?? 1,
        status: c.status ?? null,
        started_at: c.startedAt,
        last_used_at: c.lastUsedAt,
        progression_settings: safeJsonParse(c.progressionSettings),
        // R-12 presence bits ride on the merge row so "authoritative NULL" can
        // be told from "absent -> keep stored". The merge reads the mobile
        // progression keys itself and ignores these; when the DTO omits the
        // bit the key is absent, never `false`.
        ...(c.progressionSettingsPresent
          ? { progression_settings_present: true }
          : {}),
        deload_settings: safeJsonParse(c.deloadSettings),
        template_id: c.templateId ?? null,
        ...(c.progressStatePresent
          ? { progress_state_present: true, progress_state: c.progressState ?? null }
          : {}),
        // The cycle merge reads this as the incoming LWW key (and compares
        // it under LWW-on). Undated-push rule (R-1/R-7, NF-15): an omitted
        // `updatedAt` is dated at receipt under BOTH flag values, so the
        // stored key never depends on the flag and a NOT NULL `updated_at`
        // can never be handed a null.
        updated_at: c.updatedAt ?? pushReceivedAt,
        base_updated_at: c.baseUpdatedAt ?? null,
        days: c.days.map((d) => ({
          // No id: the conflict target is (cycle_id, day_number). A client
          // reusing an id across day rows would otherwise hit cycle_days_pkey.
          cycle_id: d.cycleId,
          day_number: d.dayNumber,
          day_type: d.dayType ?? 'workout',
          routine_id: dayRoutineId(d.routineId),
          weight_adjustment: d.weightAdjustment ?? 0,
          rep_modifier: d.repModifier ?? 0,
          rest_override: d.restOverride,
          rest_type: d.restType,
          notes: d.notes,
          // Day-level presence bits (R-12); absent when the DTO omits them.
          ...(d.echoLevelPresent
            ? { echo_level_present: true, echo_level: d.echoLevel ?? null }
            : {}),
          ...(d.eccentricLoadPercentPresent
            ? {
                eccentric_load_percent_present: true,
                eccentric_load_percent: d.eccentricLoadPercent ?? null,
              }
            : {}),
        })),
      }));
      if (clearedDeletedRefs.size > 0 || clearedMissingRefs.size > 0) {
        console.warn(
          `cycle_days routine references set to NULL: ${clearedDeletedRefs.size} deleted ` +
            `routine(s), ${clearedMissingRefs.size} missing routine(s)` +
            (clearedMissingRefs.size > 0
              ? ` (missing: ${[...clearedMissingRefs].slice(0, 5).join(', ')})`
              : ''),
        );
      }

      // PR 22: the merge is transactional, so an RPC error rolls its own
      // writes back but leaves this push's earlier writes in place — a
      // partial write. Answer 503 partial_write_retry so the device retries.
      const { data: mergeData, error: mergeErr } = await supabase.rpc(
        'merge_training_cycles_from_push',
        { p_user_id: userId, p_cycles: cycleRows, p_use_lww: syncLwwEnabled },
      );
      if (mergeErr) throw new PartialWriteRetryError('training_cycles merge RPC', mergeErr);
      acceptedCycleIds = new Set<string>();
      for (const row of (Array.isArray(mergeData) ? mergeData : []) as CycleMergeRow[]) {
        if (row.accepted) {
          acceptedCycleIds.add(row.id);
          // A stale structure was not applied: the device must pull the
          // portal version before it may use this version as its base.
          if (row.structure_applied && row.server_updated_at) {
            cycleVersions[row.id] = row.server_updated_at;
          }
        } else {
          // R-3/R-6: report the stored LWW key, like sessions and routines.
          // `server_updated_at` (the pull cursor) is reserved for
          // cycleVersions above, which mobile compares with portal_edited_at.
          rejections.cycles.push({ id: row.id, serverUpdatedAt: row.client_updated_at ?? null });
        }
      }
      cyclesUpserted = acceptedCycleIds.size;

      // R-4 race guard: undo a re-create of a cycle deleted meanwhile.
      const racedCycleIds = await reDeleteRacedTombstones(
        'cycle',
        'training_cycles',
        liveCycles.map((c) => c.id),
      );
      if (racedCycleIds.length > 0) {
        skippedDeleted.cycles.push(...racedCycleIds);
        cyclesUpserted = Math.max(0, cyclesUpserted - racedCycleIds.length);
        for (const racedId of racedCycleIds) {
          delete cycleVersions[racedId];
          acceptedCycleIds.delete(racedId);
        }
      }
    }

    // =========================================================================
    // 8. Upsert rpg_attributes
    // =========================================================================
    // Conflict key for the device-reported stats columns (F-070). The server
    // stamp used to decide this, which made every push win against itself, so
    // the write now carries the last workout it knows about: the newest
    // session in this push.
    //
    // CLAMPED to the server's clock (review round 1, R-2/R-11/R-24):
    // `sessionSchema.startedAt` is only checked for parseability, so a skewed
    // phone clock or a crafted payload could otherwise park the key in 2099
    // and freeze every device-owned column against all later honest pushes,
    // with no path back down. The RPCs clamp again (LEAST(key, now())) for any
    // other service-role caller.
    //
    // A push without sessions (older app versions, a stats-only push, a
    // non-final history batch) carries null. Null is NOT consent: the RPCs
    // accept it only when no key is stored yet, because a stale device sends
    // exactly that shape (R-3/R-11).
    const deviceLastWorkoutAt = ((): string | null => {
      let newest = Number.NEGATIVE_INFINITY;
      for (const session of payload.sessions) {
        const startedAt = Date.parse(session.startedAt);
        if (Number.isFinite(startedAt) && startedAt > newest) newest = startedAt;
      }
      if (!Number.isFinite(newest)) return null;
      return new Date(Math.min(newest, dependencies.now())).toISOString();
    })();

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
        // No `updated_at`: the RPC stamps the server clock, and the conflict
        // compare runs on last_workout_at instead (F-070).
        last_workout_at: deviceLastWorkoutAt,
      };

      // Both flag paths go through the RPC: it is the only writer that knows
      // which columns are device-owned.
      const { data: lwwData, error: lwwErr } = await supabase.rpc(
        'upsert_rpg_attributes_lww',
        { p_rows: [rpgRow] },
      );
      if (lwwErr) throw new Error(`rpg_attributes LWW RPC failed: ${lwwErr.message}`);
      for (const rr of (lwwData ?? []) as LwwUpsertRow[]) {
        if (rr.accepted) {
          rpgAttributesAccepted += 1;
          continue;
        }
        if (syncLwwEnabled) {
          rejections.rpgAttributes.push({ id: rr.id, serverUpdatedAt: rr.server_updated_at });
        } else {
          console.warn('rpg_attributes write rejected (SYNC_LWW_ENABLED off, not reported)');
        }
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
      // The device's own numbers go into the device_* SHADOW columns, which
      // mobile-sync-pull serves straight back to the phone. They are NOT what
      // the portal or the leaderboards read: total_workouts, total_reps,
      // total_volume_kg, total_time_seconds, pr_count and all three streaks
      // are server-derived (recompute_gamification_stats below), so a device
      // claiming 10,000 workouts changes nothing anyone else sees.
      //
      // Why a shadow copy rather than serving the derived value (R-10): the
      // installed app merges a pulled stats row with an unconditional
      // server-wins INSERT OR REPLACE, and the two sides do not mean the same
      // thing — the server counts grouped portal sessions, stored volume is
      // per cable — so handing it derived numbers would halve lifetime volume
      // for dual-cable users and shift badge progress on every phone in the
      // fleet. There is no app-version field in the payload to gate on.
      const gsRow = {
        user_id: userId,
        device_total_workouts: gs.totalWorkouts ?? 0,
        device_total_reps: gs.totalReps ?? 0,
        device_total_volume_kg: gs.totalVolumeKg ?? 0,
        device_total_time_seconds: gs.totalTimeSeconds ?? 0,
        device_longest_streak: gs.longestStreak ?? 0,
        device_current_streak: gs.currentStreak ?? 0,
        last_workout_at: deviceLastWorkoutAt,
      };

      const { data: lwwData, error: lwwErr } = await supabase.rpc(
        'upsert_gamification_stats_lww',
        { p_rows: [gsRow] },
      );
      if (lwwErr) throw new Error(`gamification_stats LWW RPC failed: ${lwwErr.message}`);
      for (const rr of (lwwData ?? []) as LwwUpsertRow[]) {
        if (rr.accepted) {
          gamificationStatsAccepted += 1;
          continue;
        }
        if (syncLwwEnabled) {
          rejections.gamificationStats.push({ id: rr.id, serverUpdatedAt: rr.server_updated_at });
        } else {
          // Flag-off keeps the pre-LWW response contract (rejections stay
          // empty), but both flag paths now run the same compare, so a
          // discarded write would otherwise be invisible (R-15).
          console.warn('gamification_stats write rejected (SYNC_LWW_ENABLED off, not reported)');
        }
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
      if (psErr) {
        console.warn('phase_statistics upsert warning:', psErr.message);
        failed.phaseStatistics.push(...payload.phaseStatistics.map((ps) => ps.id));
      } else phaseStatisticsInserted = phaseRows.length;
    }

    // =========================================================================
    // 12. Exercise signatures (GAP 8)
    // =========================================================================
    if (payload.exerciseSignatures && payload.exerciseSignatures.length > 0) {
      const sigIds: string[] = [];
      const sigRows = payload.exerciseSignatures.flatMap((es) => {
        const exerciseId = catalogId(es.exerciseId);
        if (!exerciseId) return [];
        sigIds.push(es.id);
        return [{
        user_id: userId,
        exercise_id: exerciseId,
        rom_mm: es.romMm,
        duration_ms: es.durationMs,
        symmetry_ratio: es.symmetryRatio,
        velocity_profile: es.velocityProfile,
        cable_config: es.cableConfig,
        sample_count: es.sampleCount,
        confidence: es.confidence,
        updated_at: es.updatedAt ?? new Date().toISOString(),
        }];
      });

      const { error: sigErr } = await supabase
        .from('exercise_signatures')
        .upsert(sigRows, { onConflict: 'user_id,exercise_id' });
      if (sigErr) {
        console.warn('exercise_signatures upsert warning:', sigErr.message);
        failed.exerciseSignatures.push(...sigIds);
      } else exerciseSignaturesUpserted = sigRows.length;
    }

    // =========================================================================
    // 13. VBT assessment results (GAP 9)
    // =========================================================================
    if (payload.assessments && payload.assessments.length > 0) {
      const assessRows = payload.assessments.flatMap((a) => {
        const exerciseId = catalogId(a.exerciseId);
        if (!exerciseId) return [];
        return [{
        clientId: a.id,
        user_id: userId,
        exercise_id: exerciseId,
        estimated_1rm_kg: a.estimatedOneRepMaxKg,
        load_velocity_data: safeJsonParse(a.loadVelocityData),
        assessment_session_id: a.assessmentSessionId,
        user_override_kg: a.userOverrideKg,
        created_at: a.createdAt,
        }];
      });

      // Idempotent on the natural key (PR 23). ON CONFLICT compares the
      // timestamptz VALUE, so mobile's "...Z" and a stored row that reads
      // back as "...+00:00" are the same assessment (the old string compare
      // missed this and duplicated every assessment on every push). DO
      // NOTHING (ignoreDuplicates) also tolerates two payload rows that hit
      // one key, e.g. different mobile exercise ids resolving to one catalog
      // id, which DO UPDATE would reject. Assessments are immutable on
      // mobile, so there is nothing to update. Needs the
      // vbt_assessments_identity unique index (migration 20260920002300).
      // `.select('id')` returns only the rows actually inserted (PostgREST
      // omits rows skipped by DO NOTHING), so assessmentsInserted stays a
      // true new-row count. clientId is stripped before the write and kept
      // for `failed` reporting (PR 22).
      if (assessRows.length > 0) {
        const { data: insertedAssess, error: aErr } = await supabase
          .from('vbt_assessments')
          .upsert(
            assessRows.map(({ clientId: _clientId, ...row }) => row),
            { onConflict: 'user_id,exercise_id,created_at', ignoreDuplicates: true },
          )
          .select('id');
        if (aErr) {
          console.warn('vbt_assessments upsert warning:', aErr.message);
          failed.assessments.push(...assessRows.map((r) => r.clientId));
        } else assessmentsInserted = insertedAssess?.length ?? 0;
      }
    }

    // =========================================================================
    // 14. External activities (mobile integrations — Hevy, Liftosaur, health)
    // =========================================================================
    let externalActivityIds: string[] = [];
    let externalActivityKeys: ExternalActivityAckDto[] = [];
    if (externalActivities.length > 0) {
      // NF-10: synced_at is the pull's delta cursor (`synced_at > lastSync`,
      // where lastSync is a server syncTime), so it must be server time.
      // The client's `syncedAt` is ignored: a device clock or an older
      // local timestamp would hide the activity from other devices' pulls.
      const serverSyncedAt = new Date(dependencies.now()).toISOString();
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
        raw_data: a.rawData
          ? redactTokenShapedJson(safeJsonParse(a.rawData))
          : null,
        synced_at: serverSyncedAt,
        updated_at: new Date().toISOString(),
      }));

      if (syncLwwEnabled) {
        // Phase 3.2: route through LWW RPC so a stale webhook push does not
        // overwrite a newer mobile-captured row (or vice versa). The RPC
        // returns the canonical server id which we surface in the ack list.
        const { data: lwwData, error: lwwErr } = await supabase.rpc(
          'upsert_external_activity_lww',
          { p_rows: activityRows },
        );
        if (lwwErr) {
          console.warn('external_activities LWW RPC warning:', lwwErr.message);
          failed.externalActivities.push(...activityRows.map((r) => r.id));
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
          failed.externalActivities.push(...activityRows.map((r) => r.id));
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
    // 14a. Recompute the server-derived gamification counters
    // =========================================================================
    // Runs on every push (both flag paths) whether or not this payload carried
    // gamificationStats: sessions and personal_records that landed above are
    // the source of the counters, so the totals follow the stored rows and
    // never a device claim. Deletes are covered by the triggers in
    // 20260920002500.
    //
    // FAIL OPEN (review round 1, R-1 — this deliberately reverses the first
    // draft, which threw). This runs in its own transaction AFTER every
    // session/exercise/set/PR/preference write has committed, so throwing
    // would return 500 for a push whose data all landed, skip the
    // `sync_complete` broadcast, and make the device retry the whole payload
    // — re-running the same recompute, which re-scans the user's entire
    // session and set history on every batch of a multi-batch import. On a
    // large history that meets a statement_timeout the failure is
    // deterministic, i.e. a permanent sync-failure loop for that account.
    // The counters are self-healing (the next push and the delete triggers
    // reconcile them), so a stale counter is strictly better than a wedged
    // sync. index.test.ts pins this direction.
    const { error: recomputeErr } = await supabase.rpc(
      'recompute_gamification_stats',
      { p_user_id: userId },
    );
    const recomputeFailed = Boolean(recomputeErr);
    if (recomputeErr) {
      console.warn('gamification_stats recompute failed (counters stale until next push)');
      dependencies.logOperationalFailure({ name: 'GamificationRecomputeFailure' });
    }

    // =========================================================================
    // 15. Return sync result
    // =========================================================================
    const syncTime = new Date(dependencies.now()).toISOString();
    // Tell the portal to refetch, but only when this push changed something it
    // shows. local_profiles count only when a row was added, removed or edited
    // (see localProfilesChanged). Ownership transfers and workout deletions
    // also count: the portal refetches workouts and cycles on sync_complete.
    // Custom exercise catalog upserts never count.
    // Fail-open gaps (R-1): a maintenance recompute or an optional-table write
    // that failed leaves portal-visible state stale or missing while this push
    // still answers 200, so the portal is told to refresh. A cleanly
    // LWW-rejected row is NOT one of these — nothing was attempted that could
    // be stale, so a rejected-only push stays silent.
    const optionalWriteFailed =
      failed.phaseStatistics.length > 0 ||
      failed.exerciseSignatures.length > 0 ||
      failed.assessments.length > 0 ||
      failed.externalActivities.length > 0;
    const pushChangedPortalData =
      sessionsInserted + exercisesInserted + setsInserted + repSummariesInserted +
          telemetryInserted + routinesUpserted + cyclesUpserted + badgesUpserted +
          exerciseProgressInserted + personalRecordsInserted +
          phaseStatisticsInserted + exerciseSignaturesUpserted +
          assessmentsInserted + externalActivitiesUpserted > 0 ||
      (payload.deletedRoutineIds?.length ?? 0) > 0 ||
      // Cycle deletes change portal data only when the clocked gate accepts
      // them. Legacy clockless ids are rejections or silent no-ops.
      acknowledgedDeletedCycleIds.length > 0 ||
      payload.ownershipTransfers.length > 0 ||
      payload.workoutDeletions.length > 0 ||
      rpgAttributesAccepted > 0 ||
      gamificationStatsAccepted > 0 ||
      localProfilesChanged ||
      canonicalProfilePreferenceSections.length > 0 ||
      optionalWriteFailed ||
      recomputeFailed;
    if (pushChangedPortalData) {
      await broadcastSyncComplete(supabase, userId, syncTime);
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
        // PR 22: optional-table writes that failed (push still 200).
        failed,
        // KD-4: routine/cycle ids in this push that were deleted on the
        // server (tombstoned) and therefore not re-created. New response key;
        // older builds ignore it.
        skippedDeleted,
        // KD-6: {cycleId: stored updated_at} for cycles whose pushed
        // structure was applied. A cycle missing here (stale structure,
        // LWW-rejected, deleted) must be pulled before its base advances.
        // New response key; older builds ignore it.
        cycleVersions,
        // Reliability contract: exact committed receipts. An id appears here
        // only after its write committed — never for a rejected or rolled-back
        // row. Older builds ignore the keys.
        acknowledgedWorkoutSessionIds: [...(acceptedSessionIds ?? [])],
        acknowledgedCycleIds: [...acceptedCycleIds],
        acknowledgedWorkoutDeletionIds,
        acknowledgedOwnershipTransferIds,
        acknowledgedDeletedCycleIds,
        ...(preferenceEnvelope.present ? { profilePreferencesAccepted: true } : {}),
        canonicalProfilePreferenceSections,
        profilePreferenceRejections,
      }),
      { headers: { ...cors, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    if (err instanceof PartialWriteRetryError) {
      console.warn('mobile-sync-push partial write, answering 503:', err.message);
      dependencies.logOperationalFailure({ name: err.name });
      return new Response(
        JSON.stringify({
          error: 'Sync temporarily unavailable',
          code: 'partial_write_retry',
        }),
        { status: 503, headers: { ...cors, 'Content-Type': 'application/json' } },
      );
    }
    dependencies.logOperationalFailure({
      name: safeErrorName(err, 'MobileSyncPushFailure'),
    });
    // Surface the underlying error only in known non-production environments
    // so future occurrences of this class are actionable (Issue #99 RCA layer 1).
    // Kilo review: opt-in to verbose errors via allowlist; unknown values default to opaque.
    const VERBOSE_ENVIRONMENTS = ['development', 'staging', 'preview', 'local'];
    const isVerbose = VERBOSE_ENVIRONMENTS.includes(Deno.env.get('ENVIRONMENT') ?? '');
    const errorBody: Record<string, unknown> = {
      error: isVerbose ? (err instanceof Error ? err.message : String(err)) : 'Internal server error',
    };
    if (isVerbose && err && typeof err === 'object' && 'code' in err) {
      errorBody.code = (err as { code: unknown }).code;
    }
    return new Response(
      JSON.stringify(errorBody),
      { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } }
    );
  }
}

/** Stored local_profiles columns the push can change. */
interface StoredLocalProfile {
  id: string;
  name: string | null;
  color_index: number | null;
  device_id: string | null;
}

/**
 * True when upserting `incoming` (the device's full profile list) and deleting
 * this device's profiles absent from it would add, edit or remove a row.
 */
export function localProfilesPushChangesRows(
  stored: StoredLocalProfile[],
  incoming: StoredLocalProfile[],
  deviceId: string,
): boolean {
  const storedById = new Map(stored.map((row) => [row.id, row]));
  const incomingIds = new Set(incoming.map((row) => row.id));
  const upsertChanges = incoming.some((row) => {
    const existing = storedById.get(row.id);
    return existing === undefined ||
      existing.name !== row.name ||
      (existing.color_index ?? null) !== (row.color_index ?? null) ||
      existing.device_id !== row.device_id;
  });
  const deleteChanges = stored.some(
    (row) => row.device_id === deviceId && !incomingIds.has(row.id),
  );
  return upsertChanges || deleteChanges;
}

/** Upper bound on the broadcast POST so a Realtime outage cannot stall pushes. */
const SYNC_BROADCAST_TIMEOUT_MS = 1500;

/**
 * Broadcasts `sync_complete` on the private `sync:{userId}` topic through the
 * Realtime REST endpoint (`httpSend`): one POST, no WebSocket join. Delivery
 * is best-effort — a failure is logged and never fails the push, because the
 * rows are already committed and the portal also refetches on reconnect.
 */
export async function broadcastSyncComplete(
  supabase: SupabaseClient,
  userId: string,
  syncTime: string,
): Promise<void> {
  let channel: ReturnType<SupabaseClient['channel']> | null = null;
  try {
    // Load the client's access token into Realtime so httpSend carries an
    // explicit `Authorization: Bearer` for the private topic. Without a
    // session this resolves to the service-role key.
    await supabase.realtime.setAuth();
    channel = supabase.channel(syncBroadcastTopic(userId), {
      config: { private: true },
    });
    const result = await channel.httpSend(
      'sync_complete',
      { syncTime },
      { timeout: SYNC_BROADCAST_TIMEOUT_MS },
    );
    if (!result.success) {
      console.warn('mobile-sync-push broadcast rejected:', result.status);
    }
  } catch (broadcastErr) {
    console.warn(
      'mobile-sync-push broadcast failed:',
      safeErrorName(broadcastErr, 'BroadcastFailure'),
    );
  } finally {
    if (channel) {
      try {
        await supabase.removeChannel(channel);
      } catch (cleanupErr) {
        console.warn(
          'mobile-sync-push channel cleanup warning:',
          safeErrorName(cleanupErr, 'ChannelCleanupFailure'),
        );
      }
    }
  }
}

export function createMobileSyncPushHandler(
  dependencies: MobileSyncPushHandlerDependencies = defaultMobileSyncPushDependencies(),
): (req: Request) => Promise<Response> {
  // One handler per isolate in production, so this is isolate memory.
  const publicCatalogCache: PublicCatalogCache = { rows: null, fetchedAt: 0 };
  return (req) => mobileSyncPushHandler(req, dependencies, publicCatalogCache);
}

if (import.meta.main) {
  Deno.serve(createMobileSyncPushHandler());
}
