import { assert, assertEquals, assertThrows } from "jsr:@std/assert@1";
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import {
  parsePreferenceEnvelope,
  parsePreferenceMutation,
  parseRpcMutationRow,
  type PortalProfilePreferenceSectionMutation,
  type PreferenceEnvelope,
  PreferenceInfrastructureError,
  PreferenceValidationError,
  scanJsonArrayElementSpans,
  scanTopLevelJsonObject,
} from "../_shared/profilePreferenceContract.ts";
import { createMobileSyncPullHandler } from "../mobile-sync-pull/index.ts";
import { localIntegrationEnvironment } from "../_shared/localIntegrationEnvironment.ts";
import {
  SYNC_LWW_ENABLED,
  SYNC_LWW_ENABLED as SYNC_LWW_ENABLED_IN_TEST,
} from "../_shared/flags.ts";
import {
  broadcastSyncComplete,
  createMobileSyncPushHandler,
  localProfilesPushChangesRows,
} from "./index.ts";

interface ByteGoldens {
  version: number;
  paddingMarker: string;
  sectionMarker: string;
  sectionRawTemplate: string;
  requestRawTemplate: string;
  sectionTargetBytes: number[];
  requestTargetBytes: number[];
}

type AuthBehavior = (jwt: string) => Promise<unknown>;
type RpcBehavior = (
  name: string,
  args: Record<string, unknown>,
) => Promise<unknown>;

/**
 * The `upsert_<entity>_lww(p_rows jsonb)` RPCs used by the push handler when
 * SYNC_LWW_ENABLED=true (migration 20260419120000_lww_upsert_functions.sql).
 */
const LWW_UPSERT_RPCS = new Set([
  "upsert_workout_session_lww",
  "upsert_routine_lww",
  // Training cycles always go through `merge_training_cycles_from_push`
  // (KD-6), which gates the parent and its days in one call. There is no
  // per-row cycle LWW upsert for this set to model.
  "upsert_rpg_attributes_lww",
  "upsert_gamification_stats_lww",
  "upsert_external_activity_lww",
]);

/**
 * Faithful default double for those RPCs: each one returns exactly one
 * `{id, accepted, server_updated_at}` row per element of `p_rows`. The
 * generic `{ data: [], error: null }` fallback is NOT that contract — the
 * handler correctly reads "no row for this id" as "rejected", so with the
 * generic fallback every flag-on push silently rejects everything and skips
 * all child writes. Accept every row here (the non-conflict case), so a test
 * that is not about stale pushes asserts the same thing under both values of
 * SYNC_LWW_ENABLED. A test that wants a rejection supplies its own
 * `rpcBehavior`.
 */
function lwwUpsertDouble(
  name: string,
  args: Record<string, unknown>,
): { data: unknown; error: unknown } | null {
  if (!LWW_UPSERT_RPCS.has(name)) return null;
  const rows = (args.p_rows ?? []) as Array<Record<string, unknown>>;
  return {
    data: rows.map((row) => ({
      // rpg_attributes / gamification_stats are keyed by user_id.
      id: row.id ?? row.user_id,
      accepted: true,
      server_updated_at: row.updated_at ?? null,
    })),
    error: null,
  };
}

/**
 * Faithful default double for `merge_training_cycles_from_push` (Design K /
 * KD-6): one `{id, accepted, structure_applied, server_updated_at,
 * client_updated_at}` row per element of `p_cycles`. Like `lwwUpsertDouble`,
 * the generic `{ data: [], error: null }` terminal is NOT that contract — the
 * handler reads "no row for this id" as "rejected", so with the generic
 * fallback every cycle push is silently rejected and `acknowledgedCycleIds`
 * stays empty. Accept every row here (the non-conflict case); a test that
 * wants a rejection or a stale structure supplies its own `rpcBehavior`.
 */
function mergeCycleDouble(
  name: string,
  args: Record<string, unknown>,
): { data: unknown; error: unknown } | null {
  if (name !== "merge_training_cycles_from_push") return null;
  const rows = (args.p_cycles ?? []) as Array<Record<string, unknown>>;
  return {
    data: rows.map((row) => ({
      id: row.id,
      accepted: true,
      structure_applied: true,
      server_updated_at: (row.updated_at as string | null) ?? null,
      client_updated_at: (row.updated_at as string | null) ?? null,
    })),
    error: null,
  };
}

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
const EXPECTED_GOLDEN_SHA256 =
  "F5961867530A4AD464AA17D5798B391AB037611C7F95C46E64161BA8BDC5E97D";
const VALID_JWT = "test-jwt";
const VALID_USER_ID = "00000000-0000-4000-8000-000000000001";
const VALID_AUTH_RESULT = {
  data: { user: { id: VALID_USER_ID } },
  error: null,
};

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
  );
  return Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("").toUpperCase();
}

const byteGoldenResponse = await fetch(
  new URL("../_shared/profile-preference-byte-goldens.json", import.meta.url),
);
assert(byteGoldenResponse.ok, "byte golden file URL must load successfully");
const byteGoldenBytes = new Uint8Array(await byteGoldenResponse.arrayBuffer());
assertEquals(byteGoldenBytes.byteLength, 856, "byte golden length");
assertEquals(
  await sha256Hex(byteGoldenBytes),
  EXPECTED_GOLDEN_SHA256,
  "byte golden SHA-256 must match before decoding or parsing",
);
const byteGoldens = JSON.parse(decoder.decode(byteGoldenBytes)) as ByteGoldens;

function validPushBody(): Record<string, unknown> {
  return {
    deviceId: "test-device",
    platform: "android",
    lastSync: 0,
    sessions: [],
    telemetry: [],
    routines: [],
    deletedRoutineIds: [],
    cycles: [],
    deletedCycleIds: [],
    deletedCycles: [],
    rpgAttributes: null,
    badges: [],
    gamificationStats: null,
    phaseStatistics: [],
    exerciseSignatures: [],
    assessments: [],
    customExercises: [],
    personalRecords: [],
  };
}

const SESSION_ID = "00000000-0000-4000-8000-000000000010";
const EXERCISE_ID = "00000000-0000-4000-8000-000000000011";
const SET_ID = "00000000-0000-4000-8000-000000000012";
const REP_SUMMARY_ID = "00000000-0000-4000-8000-000000000013";
const ROUTINE_ID = "00000000-0000-4000-8000-000000000020";
const ROUTINE_EXERCISE_ID = "00000000-0000-4000-8000-000000000021";
const CYCLE_ID = "00000000-0000-4000-8000-000000000030";
const CYCLE_DAY_ID = "00000000-0000-4000-8000-000000000031";
const MISMATCH_ID = "00000000-0000-4000-8000-000000000099";

function validNestedRelationshipBody(): Record<string, unknown> {
  return {
    ...validPushBody(),
    profileId: "default",
    allProfiles: [{ id: "default", name: "Default", colorIndex: 0 }],
    sessions: [{
      id: SESSION_ID,
      userId: VALID_USER_ID,
      name: "Relationship session",
      startedAt: "2026-07-11T12:00:00.000Z",
      exercises: [{
        id: EXERCISE_ID,
        sessionId: SESSION_ID,
        name: "Relationship exercise",
        sets: [{
          id: SET_ID,
          exerciseId: EXERCISE_ID,
          setNumber: 1,
          repSummaries: [{
            id: REP_SUMMARY_ID,
            setId: SET_ID,
            repNumber: 1,
          }],
        }],
      }],
    }],
    routines: [{
      id: ROUTINE_ID,
      userId: VALID_USER_ID,
      name: "Relationship routine",
      exerciseCount: 1,
      exercises: [{
        id: ROUTINE_EXERCISE_ID,
        routineId: ROUTINE_ID,
        name: "Relationship routine exercise",
      }],
    }],
    cycles: [{
      id: CYCLE_ID,
      userId: VALID_USER_ID,
      name: "Relationship cycle",
      days: [{
        id: CYCLE_DAY_ID,
        cycleId: CYCLE_ID,
        dayNumber: 1,
      }],
    }],
  };
}

function validCoreMutation(): Record<string, unknown> {
  return {
    localProfileId: "profile-a",
    section: "CORE",
    documentVersion: 1,
    baseRevision: 0,
    clientModifiedAt: "2026-07-11T12:00:00Z",
    payload: {
      bodyWeightKg: 80,
      weightUnit: "KG",
      weightIncrement: 1,
    },
  };
}

function validRackMutation(): Record<string, unknown> {
  return {
    localProfileId: "profile-a",
    section: "RACK",
    documentVersion: 1,
    baseRevision: 0,
    clientModifiedAt: "2026-07-11T12:00:00Z",
    payload: {
      version: 1,
      items: [{
        id: "rack-a",
        name: "Rack item",
        category: "OTHER",
        weightKg: 0,
        behavior: "DISPLAY_ONLY",
        enabled: true,
        sortOrder: 0,
        createdAt: -1,
        updatedAt: Number.MAX_SAFE_INTEGER,
      }],
    },
  };
}

function validWorkoutMutation(): Record<string, unknown> {
  return {
    localProfileId: "profile-a",
    section: "WORKOUT",
    documentVersion: 1,
    baseRevision: 0,
    clientModifiedAt: "2026-07-11T12:00:00Z",
    payload: {
      version: 1,
      stopAtTop: false,
      beepsEnabled: true,
      stallDetectionEnabled: true,
      audioRepCountEnabled: true,
      repCountTiming: "TOP",
      summaryCountdownSeconds: -1,
      autoStartCountdownSeconds: 2,
      gamificationEnabled: true,
      autoStartRoutine: false,
      countdownBeepsEnabled: true,
      repSoundEnabled: true,
      motionStartEnabled: false,
      weightSuggestionsEnabled: true,
      defaultRoutineExerciseUsePercentOfPR: true,
      defaultRoutineExerciseWeightPercentOfPR: 100,
      voiceStopEnabled: false,
      justLiftDefaults: {
        workoutModeId: 0,
        weightPerCableKg: 0,
        weightChangePerRep: 0,
        eccentricLoadPercentage: 0,
        echoLevelValue: 0,
        stallDetectionEnabled: true,
        repCountTimingName: "BOTTOM",
        restSeconds: 0,
      },
      singleExerciseDefaults: {
        "exercise-a": {
          exerciseId: "exercise-a",
          setReps: [null, 0],
          weightPerCableKg: 0,
          setWeightsPerCableKg: [0],
          progressionKg: 0,
          setRestSeconds: [0, 5],
          workoutModeId: 10,
          eccentricLoadPercentage: 150,
          echoLevelValue: 3,
          duration: 0,
          isAMRAP: false,
          perSetRestTime: true,
          defaultRackItemIds: ["rack-a"],
        },
      },
    },
  };
}

function validLedMutation(): Record<string, unknown> {
  return {
    localProfileId: "profile-a",
    section: "LED",
    documentVersion: 1,
    baseRevision: 0,
    clientModifiedAt: "2026-07-11T12:00:00Z",
    payload: {
      ledColorSchemeId: 0,
      preferences: { version: 1, discoModeUnlocked: true },
    },
  };
}

function validVbtMutation(): Record<string, unknown> {
  return {
    localProfileId: "profile-a",
    section: "VBT",
    documentVersion: 1,
    baseRevision: 0,
    clientModifiedAt: "2026-07-11T12:00:00Z",
    payload: {
      vbtEnabled: true,
      preferences: {
        version: 1,
        velocityLossThresholdPercent: 10,
        autoEndOnVelocityLoss: true,
        defaultScalingBasis: "MAX_WEIGHT_PR",
        verbalEncouragementEnabled: true,
        vulgarModeEnabled: true,
        vulgarTier: "MIX",
        dominatrixModeUnlocked: true,
        dominatrixModeActive: false,
      },
    },
  };
}

function acceptedRpcResult(
  args: Record<string, unknown>,
  overrides: Record<string, unknown> = {},
): { data: unknown; error: unknown } {
  const { canonical_section: canonicalOverrides, ...rowOverrides } = overrides;
  const serverRevision = rowOverrides.server_revision ?? 1;
  const canonicalSection = {
    localProfileId: args.p_local_profile_id,
    section: args.p_section,
    documentVersion: 1,
    serverRevision,
    serverUpdatedAt: "2026-07-11T14:00:01+02:00",
    payload: args.p_payload,
    ...((canonicalOverrides as Record<string, unknown> | undefined) ?? {}),
  };
  return {
    data: [{
      accepted: true,
      rejection_reason: null,
      server_revision: serverRevision,
      canonical_section: canonicalSection,
      ...rowOverrides,
    }],
    error: null,
  };
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function envelopeFromRawElements(elements: string[]): PreferenceEnvelope {
  const ordinary = JSON.stringify(validPushBody());
  const rawBody = `${ordinary.slice(0, -1)},"profilePreferenceSections":[${
    elements.join(",")
  }]}`;
  const topLevel = scanTopLevelJsonObject(rawBody);
  const preferenceSpan = topLevel.valueSpans.get("profilePreferenceSections");
  assert(preferenceSpan);
  const preferenceElementSpans = scanJsonArrayElementSpans(
    rawBody,
    preferenceSpan,
  );
  return parsePreferenceEnvelope(JSON.parse(rawBody), {
    rawBody,
    preferenceElementSpans,
  });
}

function envelopeFromMutations(
  mutations: Record<string, unknown>[],
): PreferenceEnvelope {
  return envelopeFromRawElements(
    mutations.map((mutation) => JSON.stringify(mutation)),
  );
}

function requestFromBody(
  body: unknown,
  authorization: string | null = `Bearer ${VALID_JWT}`,
): Request {
  return rawRequest(encoder.encode(JSON.stringify(body)), authorization);
}

function rawRequest(
  body: Uint8Array,
  authorization: string | null = `Bearer ${VALID_JWT}`,
): Request {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (authorization !== null) headers.set("Authorization", authorization);
  return new Request("http://localhost/functions/v1/mobile-sync-push", {
    method: "POST",
    headers,
    body: body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer,
  });
}

function streamingRawRequest(
  chunks: Uint8Array[],
  options: {
    authorization?: string | null;
    contentLength?: string;
    failAfterChunks?: number;
    onPull?: () => void;
    onCancel?: () => void;
  } = {},
): Request {
  const headers = new Headers({ "Content-Type": "application/json" });
  const authorization = options.authorization === undefined
    ? `Bearer ${VALID_JWT}`
    : options.authorization;
  if (authorization !== null) headers.set("Authorization", authorization);
  if (options.contentLength !== undefined) {
    headers.set("Content-Length", options.contentLength);
  }

  let index = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      options.onPull?.();
      if (
        options.failAfterChunks !== undefined &&
        index >= options.failAfterChunks
      ) {
        controller.error(
          Object.assign(new Error("secret"), { name: "BodyStreamError" }),
        );
        return;
      }
      if (index >= chunks.length) {
        controller.close();
        return;
      }
      controller.enqueue(chunks[index]);
      index += 1;
    },
    cancel() {
      options.onCancel?.();
    },
  }, { highWaterMark: 0 });

  return new Request("http://localhost/functions/v1/mobile-sync-push", {
    method: "POST",
    headers,
    body,
  });
}

type QueryOperation = {
  name: string;
  args: unknown[];
};

/** An operation list that also carries `.eq()` filters as string keys. */
type QueryContext = QueryOperation[] & Record<string, unknown>;
type TerminalResultValue = { data: unknown; error: unknown; count?: number };
type TerminalResult =
  | TerminalResultValue
  | ((context: QueryContext) => TerminalResultValue);
/** Older name for {@link TerminalResult}; kept so either spelling compiles. */
type TableResult = TerminalResult;
type TableResultValue = TerminalResultValue;
const DEFAULT_SUBSCRIPTION_RESULT = {
  data: {
    tier: "EMBER",
    status: "active",
    current_period_end: "2099-01-01T00:00:00.000Z",
  },
  error: null,
};

/**
 * A query builder that accepts any chain and resolves to `terminalResult`.
 * Parameter order is the superset every `from()` call site uses:
 * write hook, terminal, write-error, ownership probe (hook + rows), chain hook,
 * terminal resolver, subscription stub, then the optional per-call hook.
 */
function permissiveQuery(
  table: string,
  onWrite: (method: string, args: unknown[]) => void,
  terminalResult: TerminalResult = {
    data: [],
    error: null,
    count: 0,
  },
  writeError?: (method: string) => unknown,
  onProbe: () => void = () => {},
  probeResult: unknown[] = [],
  onChain: (method: string, args: unknown[]) => void = () => {},
  resolveTerminal?: () => { data: unknown; error: unknown; count?: number },
  subscriptionResult: { data: unknown; error: unknown } =
    DEFAULT_SUBSCRIPTION_RESULT,
  onCall?: (method: string, args: unknown[]) => void,
): Record<string, unknown> {
  const query: Record<string, unknown> = {};
  let ownershipProbe = false;
  let injectedWriteError: unknown = null;
  const chainMethods = [
    "select",
    "eq",
    "neq",
    "gt",
    "gte",
    "in",
    "is",
    "or",
    "not",
    "order",
    "limit",
    "range",
    "insert",
    "upsert",
    "update",
    "delete",
    "returns",
  ];
  const operations = [] as unknown as QueryContext;
  for (const method of chainMethods) {
    query[method] = (...args: unknown[]) => {
      operations.push({ name: method, args });
      onCall?.(method, args);
      onChain(method, args);
      if (method === "neq") {
        ownershipProbe = true;
        onProbe();
      }
      if (method === "eq") operations[String(args[0])] = args[1];
      if (["insert", "upsert", "update", "delete"].includes(method)) {
        onWrite(method, args);
        injectedWriteError = writeError?.(method) ?? injectedWriteError;
      }
      return query;
    };
  }
  query.maybeSingle = () =>
    Promise.resolve(
      table === "subscriptions"
        ? subscriptionResult
        : { data: null, error: null },
    );
  query.single = () => Promise.resolve({ data: null, error: null });
  query.then = (
    resolve: (value: unknown) => unknown,
    reject?: (reason: unknown) => unknown,
  ) =>
    Promise.resolve(
      injectedWriteError
        ? { data: null, error: injectedWriteError }
        : ownershipProbe
        ? { data: probeResult, error: null, count: probeResult.length }
        : resolveTerminal
        ? resolveTerminal()
        : typeof terminalResult === "function"
        ? terminalResult(operations)
        : terminalResult,
    ).then(resolve, reject);
  return query;
}

/** Every chained call made on one `from("exercise_catalog")` query. */
interface CatalogQuery {
  calls: Array<{ method: string; args: unknown[] }>;
}

function catalogEqFilters(query: CatalogQuery): Array<[unknown, unknown]> {
  return query.calls.filter((call) => call.method === "eq").map((call) =>
    [call.args[0], call.args[1]] as [unknown, unknown]
  );
}

function catalogRangeStart(query: CatalogQuery): unknown {
  return query.calls.find((call) => call.method === "range")?.args[0];
}

function isPublicCatalogLookup(query: CatalogQuery): boolean {
  return catalogEqFilters(query).some(([column, value]) =>
    column === "is_custom" && value === false
  );
}

function isCustomCatalogLookup(query: CatalogQuery): boolean {
  return catalogEqFilters(query).some(([column, value]) =>
    column === "is_custom" && value === true
  );
}

interface PushHarness {
  handler: (request: Request) => Promise<Response>;
  authClientAuthorizations: string[];
  getUserJwts: string[];
  adminConstructionCount: { value: number };
  adminRpcCalls: Array<{ name: string; args: Record<string, unknown> }>;
  adminFromCalls: string[];
  adminWriteCalls: Array<{ table: string; method: string }>;
  /** Superset record: tests read either `.args` or `.payload` (`args[0]`). */
  adminWriteArgs: Array<WriteRecord>;
  adminWritePayloads: Array<WriteRecord>;
  adminQueryCalls: Array<WriteRecord>;
  ownershipProbeTables: string[];
  catalogQueries: CatalogQuery[];
  loggerCalls: unknown[][];
  operationEvents: string[];
  channelCalls: Array<{ topic: string; config?: Record<string, unknown> }>;
  broadcastPayloads: unknown[];
  /** Every admin query builder with its chained calls and arguments. */
  adminQueries: AdminQueryRecord[];
  httpSendCalls: Array<{ event: string; payload: unknown; timeout?: number }>;
  setAuthCalls: { value: number };
  subscribeCalls: { value: number };
  removeChannelCalls: { value: number };
}

interface AdminQueryRecord {
  table: string;
  calls: Array<{ method: string; args: unknown[] }>;
}

/** One recorded write/query; `payload` is `args[0]` for the callers that want the body. */
interface WriteRecord {
  table: string;
  method: string;
  args: unknown[];
  payload: unknown;
}

function makeHarness(
  authBehavior: AuthBehavior = async () => VALID_AUTH_RESULT,
  options: {
    channelError?: unknown;
    fromError?: unknown;
    httpSendBehavior?: () => Promise<unknown>;
    rpcBehavior?: RpcBehavior;
    personalRecordsResult?: TerminalResult;
    localProfilesResult?: TerminalResult;
    preferenceProfilesResult?: TerminalResult;
    syncLwwEnabled?: boolean;
    catalogRows?: unknown[];
    /** Terminal result for reads/writes on these tables (e.g. probes); a
     * function receives the chained operations (select/in/... with args). */
    tableResults?: Record<string, TerminalResult>;
    /** Error injected into a write, keyed `table:method` (e.g. `routines:delete`). */
    writeErrors?: Record<string, unknown>;
    foreignOwnedTables?: string[];
    now?: () => number;
    catalogBehavior?: (
      query: CatalogQuery,
    ) => { data: unknown; error: unknown } | undefined;
    subscriptionResult?: { data: unknown; error: unknown };
    /** Real clients for chosen tables (real-SQL tests); others stay mocked. */
    tableClients?: Record<string, { from(table: string): unknown }>;
  } = {},
): PushHarness {
  const authClientAuthorizations: string[] = [];
  const getUserJwts: string[] = [];
  const adminConstructionCount = { value: 0 };
  const adminRpcCalls: Array<{ name: string; args: Record<string, unknown> }> =
    [];
  const adminFromCalls: string[] = [];
  const adminWriteCalls: Array<{ table: string; method: string }> = [];
  const adminWriteArgs: WriteRecord[] = [];
  const adminWritePayloads: WriteRecord[] = [];
  const adminQueryCalls: WriteRecord[] = [];
  const ownershipProbeTables: string[] = [];
  const catalogQueries: CatalogQuery[] = [];
  const loggerCalls: unknown[][] = [];
  const operationEvents: string[] = [];
  const channelCalls: Array<{ topic: string; config?: Record<string, unknown> }> =
    [];
  const broadcastPayloads: unknown[] = [];
  const adminQueries: AdminQueryRecord[] = [];
  const httpSendCalls: Array<{ event: string; payload: unknown; timeout?: number }> =
    [];
  const subscribeCalls = { value: 0 };
  const setAuthCalls = { value: 0 };
  const removeChannelCalls = { value: 0 };

  const admin = {
    realtime: {
      async setAuth() {
        setAuthCalls.value += 1;
        operationEvents.push("realtime:setAuth");
      },
    },
    from(table: string) {
      if (options.fromError !== undefined) throw options.fromError;
      adminFromCalls.push(table);
      const realClient = options.tableClients?.[table];
      if (realClient) return realClient.from(table);
      const record: AdminQueryRecord = { table, calls: [] };
      adminQueries.push(record);
      const catalogQuery: CatalogQuery | null = table === "exercise_catalog"
        ? { calls: [] }
        : null;
      if (catalogQuery) catalogQueries.push(catalogQuery);
      return permissiveQuery(
        table,
        (method, args) => {
          adminWriteCalls.push({ table, method });
          adminWriteArgs.push({ table, method, args, payload: args[0] });
          adminWritePayloads.push({ table, method, args, payload: args[0] });
          operationEvents.push(`write:${table}:${method}`);
        },
        table === "personal_records"
          ? options.personalRecordsResult
          : table === "local_profiles"
          ? options.localProfilesResult
          : table === "local_profile_preferences"
          ? options.preferenceProfilesResult
          : table === "exercise_catalog" && options.catalogRows
          ? { data: options.catalogRows, error: null }
          : options.tableResults?.[table],
        (method) => options.writeErrors?.[`${table}:${method}`],
        () => ownershipProbeTables.push(table),
        (options.foreignOwnedTables ?? []).includes(table)
          ? [{ id: "foreign-row" }]
          : [],
        (method, args) => {
          record.calls.push({ method, args });
          catalogQuery?.calls.push({ method, args });
        },
        catalogQuery && options.catalogBehavior
          ? () =>
            options.catalogBehavior!(catalogQuery) ??
              { data: [], error: null, count: 0 }
          : undefined,
        options.subscriptionResult,
        (method, args) => {
          adminQueryCalls.push({ table, method, args, payload: args[0] });
        },
      );
    },
    async rpc(name: string, args: Record<string, unknown> = {}) {
      adminRpcCalls.push({ name, args });
      operationEvents.push(`rpc:${name}`);
      if (name === "check_rate_limit") {
        return {
          data: { allowed: true, remaining: 9, retry_after_seconds: null },
          error: null,
        };
      }
      if (options.rpcBehavior) {
        // `undefined` means "this stub does not model that RPC" — fall through
        // to the harness defaults below instead of answering with an empty
        // result the real RPC would never return.
        const overridden = await options.rpcBehavior(name, args);
        if (overridden !== undefined) return overridden;
      }
      if (
        name === "get_personal_record_identity_candidates" &&
        options.personalRecordsResult
      ) {
        return options.personalRecordsResult;
      }
      if (name === "upsert_set_derived_personal_records") {
        // Real function returns rows inserted or changed; with an empty store
        // every distinct row is a fresh insert.
        return { data: (args.p_rows as unknown[]).length, error: null };
      }
      const lww = lwwUpsertDouble(name, args);
      if (lww) return lww;
      const merge = mergeCycleDouble(name, args);
      if (merge) return merge;
      if (name === "mutate_local_profile_preference_section") {
        const section = String(args.p_section);
        return {
          data: [{
            accepted: true,
            rejection_reason: null,
            server_revision: 1,
            canonical_section: {
              localProfileId: args.p_local_profile_id,
              section,
              documentVersion: 1,
              serverRevision: 1,
              serverUpdatedAt: "2026-07-11T12:00:01.000Z",
              payload: args.p_payload,
            },
          }],
          error: null,
        };
      }
      return { data: [], error: null };
    },
    channel(topic: string, channelOptions?: { config?: Record<string, unknown> }) {
      if (options.channelError !== undefined) throw options.channelError;
      channelCalls.push({ topic, config: channelOptions?.config });
      return {
        subscribe(callback: (status: string) => void) {
          subscribeCalls.value += 1;
          callback("SUBSCRIBED");
          return {};
        },
        async send(message: { payload?: unknown }) {
          broadcastPayloads.push(message.payload);
          return "ok";
        },
        async httpSend(
          event: string,
          payload: unknown,
          opts?: { timeout?: number },
        ) {
          httpSendCalls.push({ event, payload, timeout: opts?.timeout });
          operationEvents.push("realtime:httpSend");
          broadcastPayloads.push(payload);
          if (options.httpSendBehavior) return await options.httpSendBehavior();
          return { success: true };
        },
      };
    },
    async removeChannel() {
      removeChannelCalls.value += 1;
      return "ok";
    },
  };

  const handler = createMobileSyncPushHandler({
    createAuthClient(authorization: string) {
      authClientAuthorizations.push(authorization);
      return {
        auth: {
          async getUser(jwt: string) {
            getUserJwts.push(jwt);
            return await authBehavior(jwt);
          },
        },
      };
    },
    createAdminClient() {
      adminConstructionCount.value += 1;
      return admin;
    },
    logOperationalFailure: ((...args: unknown[]) => loggerCalls.push(args)),
    syncLwwEnabled: options.syncLwwEnabled,
    now: options.now ?? (() => 1_784_167_200_000),
  } as never);

  return {
    handler,
    authClientAuthorizations,
    getUserJwts,
    adminConstructionCount,
    adminRpcCalls,
    adminFromCalls,
    adminWriteCalls,
    adminWriteArgs,
    adminWritePayloads,
    ownershipProbeTables,
    catalogQueries,
    adminQueryCalls,
    loggerCalls,
    operationEvents,
    channelCalls,
    broadcastPayloads,
    adminQueries,
    httpSendCalls,
    setAuthCalls,
    subscribeCalls,
    removeChannelCalls,
  };
}

/** Queries on `table` whose chain includes the write `method`. */
function writeQueries(
  harness: PushHarness,
  table: string,
  method: string,
): AdminQueryRecord[] {
  return harness.adminQueries.filter((query) =>
    query.table === table && query.calls.some((call) => call.method === method)
  );
}

function callArgs(query: AdminQueryRecord, method: string): unknown[] {
  return query.calls.find((call) => call.method === method)?.args ?? [];
}

async function json(response: Response): Promise<Record<string, unknown>> {
  return await response.json() as Record<string, unknown>;
}

function assertNoPrivilegedActivity(harness: PushHarness): void {
  assertEquals(harness.adminConstructionCount.value, 0);
  assertEquals(harness.adminRpcCalls, []);
  assertEquals(harness.adminFromCalls, []);
  assertEquals(harness.adminWriteCalls, []);
}

function fillAsciiPadding(
  template: string,
  marker: string,
  targetBytes: number,
): string {
  assertEquals(template.split(marker).length - 1, 1, "padding marker count");
  const unpadded = template.replace(marker, "");
  const paddingBytes = targetBytes - encoder.encode(unpadded).byteLength;
  assert(paddingBytes >= 0, "target must fit the unpadded template");
  const filled = template.replace(marker, "x".repeat(paddingBytes));
  assertEquals(encoder.encode(filled).byteLength, targetBytes);
  return filled;
}

function pushBodyWithRawSection(sectionRaw: string): Uint8Array {
  const serialized = JSON.stringify({
    ...validPushBody(),
    profilePreferenceSections: [],
  });
  const marker = '"profilePreferenceSections":[]';
  assert(serialized.includes(marker));
  return encoder.encode(
    serialized.replace(marker, `"profilePreferenceSections":[${sectionRaw}]`),
  );
}

function requestGoldenAt(targetBytes: number): Uint8Array {
  assertEquals(
    byteGoldens.sectionRawTemplate.split(byteGoldens.paddingMarker).length - 1,
    1,
  );
  const onePaddingByteSection = byteGoldens.sectionRawTemplate.replace(
    byteGoldens.paddingMarker,
    "x",
  );
  assertEquals(
    byteGoldens.requestRawTemplate.split(byteGoldens.sectionMarker).length - 1,
    1,
  );
  const requestTemplate = byteGoldens.requestRawTemplate
    .replace(byteGoldens.sectionMarker, onePaddingByteSection)
    // The raw handoff fixture uses a human-readable preference identity, while
    // the existing ordinary push schema permits only "default" or a UUID.
    // Preserve the authoritative file bytes and edge lexemes, but make the
    // generated executable request ordinary-valid before testing byte limits.
    .replace('"profileId":"profile-a"', '"profileId":"default"');
  return encoder.encode(
    fillAsciiPadding(requestTemplate, byteGoldens.paddingMarker, targetBytes),
  );
}

Deno.test("shared profile preference contract module is a required production seam", async () => {
  const moduleName = "../_shared/" + "profilePreferenceContract.ts";
  const contract = await import(new URL(moduleName, import.meta.url).href);
  assert(Object.keys(contract).length > 0);
});

Deno.test("reliability operations commit ownership then deletion and acknowledge exact mutation ids", async () => {
  const transferId = "40000000-0000-4000-8000-000000000001";
  const deletionId = "40000000-0000-4000-8000-000000000002";
  const sessionId = "40000000-0000-4000-8000-000000000003";
  const harness = makeHarness(undefined, {
    rpcBehavior: async (name) => {
      if (name === "transfer_profile_ownership") {
        return { data: [{ mutation_id: transferId }], error: null };
      }
      if (name === "apply_workout_deletions") {
        return { data: [{ mutation_id: deletionId }], error: null };
      }
      return { data: [], error: null };
    },
  });
  const response = await harness.handler(requestFromBody({
    ...validPushBody(),
    profileId: "default",
    allProfiles: [{ id: "default", name: "Default", colorIndex: 0 }],
    ownershipTransfers: [{
      mutationId: transferId,
      sourceProfileId: null,
      targetProfileId: "default",
      workoutSessionIds: [sessionId],
      routineIds: [],
      cycleIds: [],
      personalRecordIds: [],
    }],
    workoutDeletions: [{
      mutationId: deletionId,
      scope: "WORKOUT",
      portalSessionId: sessionId,
      componentSessionId: null,
      deletedAt: "2026-09-20T12:00:00.000Z",
    }],
  }));
  const body = await json(response);

  assertEquals(response.status, 200, JSON.stringify(body));
  assertEquals(body.acknowledgedOwnershipTransferIds, [transferId]);
  assertEquals(body.acknowledgedWorkoutDeletionIds, [deletionId]);
  const transferIndex = harness.operationEvents.indexOf("rpc:transfer_profile_ownership");
  const deletionIndex = harness.operationEvents.indexOf("rpc:apply_workout_deletions");
  assert(transferIndex >= 0);
  assert(deletionIndex > transferIndex);
  const deletionCall = harness.adminRpcCalls.find((call) =>
    call.name === "apply_workout_deletions"
  );
  assertEquals(deletionCall?.args.p_request_profile_id, "default");
});

Deno.test("deleted profile route remains immutable when allProfiles cleanup clears active writes", async () => {
  const deletedProfileId = "40000000-0000-4000-8000-0000000000a1";
  const deletionId = "40000000-0000-4000-8000-0000000000a2";
  const portalSessionId = "40000000-0000-4000-8000-0000000000a3";
  const harness = makeHarness(undefined, {
    rpcBehavior: async (name) => {
      if (name === "apply_workout_deletions") {
        return { data: [{ mutation_id: deletionId }], error: null };
      }
      return { data: [], error: null };
    },
  });
  const response = await harness.handler(requestFromBody({
    ...validPushBody(),
    profileId: deletedProfileId,
    allProfiles: [{ id: "default", name: "Default", colorIndex: 0 }],
    workoutDeletions: [{
      mutationId: deletionId,
      scope: "WORKOUT",
      portalSessionId,
      componentSessionId: null,
      deletedAt: "2026-09-20T12:00:00.000Z",
    }],
  }));

  assertEquals(response.status, 200, JSON.stringify(await json(response)));
  const deletionCall = harness.adminRpcCalls.find((call) =>
    call.name === "apply_workout_deletions"
  );
  assertEquals(deletionCall?.args.p_request_profile_id, deletedProfileId);
});

Deno.test("omitted recovery source preferences survive recovery and the next ordinary sync", async () => {
  const sourceProfileId = "40000000-0000-4000-8000-0000000000b1";
  const harness = makeHarness(undefined, {
    preferenceProfilesResult: {
      data: [{ local_profile_id: sourceProfileId }],
      error: null,
    },
  });
  const base = {
    ...validPushBody(),
    profileId: "default",
    allProfiles: [{ id: "default", name: "Default", colorIndex: 0 }],
  };
  const recovery = await harness.handler(requestFromBody({
    ...base,
    ownershipTransfers: [{
      mutationId: "40000000-0000-4000-8000-0000000000b2",
      sourceProfileId,
      targetProfileId: "default",
      workoutSessionIds: ["40000000-0000-4000-8000-0000000000b3"],
      routineIds: [],
      cycleIds: [],
      personalRecordIds: [],
    }],
  }));
  assertEquals(recovery.status, 200, JSON.stringify(await json(recovery)));

  const ordinary = await harness.handler(requestFromBody(base));
  assertEquals(ordinary.status, 200, JSON.stringify(await json(ordinary)));

  const cleanupFilters = harness.adminQueryCalls.filter((call) =>
    call.table === "local_profiles" && call.method === "not"
  );
  assertEquals(cleanupFilters.length, 2);
  for (const filter of cleanupFilters) {
    assertEquals(filter.args.slice(0, 2), ["id", "in"]);
    assert(String(filter.args[2]).includes('"default"'));
    assert(String(filter.args[2]).includes(`"${sourceProfileId}"`));
  }
});

// Was "cycles always use the LWW parent gate before writing children" against
// the retired `upsert_training_cycles_with_days_lww`. Design K (KD-6) is
// `merge_training_cycles_from_push`, which IS the parent gate and the child
// write in one transaction, so the property carried forward becomes: a
// rejected cycle's days ride only inside that gated merge and are never
// written as a separate `cycle_days` statement that could outlive it.
Deno.test("cycles gate the parent and its days in one merge RPC; a rejected cycle writes no days", async () => {
  const harness = makeHarness(undefined, {
    rpcBehavior: async (name) => {
      if (name === "merge_training_cycles_from_push") {
        return {
          data: [{
            id: CYCLE_ID,
            accepted: false,
            structure_applied: false,
            server_updated_at: "2026-09-20T13:00:00.000Z",
            client_updated_at: "2026-09-20T12:00:00.000Z",
          }],
          error: null,
        };
      }
      return undefined;
    },
  });
  const body = validNestedRelationshipBody();
  body.sessions = [];
  body.routines = [];
  const response = await harness.handler(requestFromBody(body));

  assertEquals(response.status, 200);
  assertEquals((await response.clone().json()).acknowledgedCycleIds, []);
  const mergeCalls = harness.adminRpcCalls.filter((call) =>
    call.name === "merge_training_cycles_from_push"
  );
  assertEquals(mergeCalls.length, 1);
  // Days ride inside the merge row — there is no separate child write that
  // could race the parent gate.
  const rows = mergeCalls[0].args.p_cycles as Array<Record<string, unknown>>;
  assert(Array.isArray(rows[0].days));
  assertEquals(
    harness.adminWriteCalls.filter((call) => call.table === "cycle_days"),
    [],
  );
});

// Was "session parent gate and component replacement use one atomic RPC"
// against `upsert_workout_sessions_with_components` plus a "never
// `replace_session_components`" check. Design K splits that into the LWW
// parent gate (`upsert_workout_session_lww`) and ONE atomic
// `replace_session_children` covering every child table including
// `exercise_progress`. Properties carried forward: a rejected parent gets no
// component replacement at all, and the replacement is never decomposed into
// per-table child writes.
Deno.test("a rejected session parent gets no component replacement and no per-table child writes", async () => {
  const body = validNestedRelationshipBody();
  body.routines = [];
  body.cycles = [];
  const harness = makeHarness(undefined, {
    syncLwwEnabled: true,
    rpcBehavior: async (name) => {
      if (name === "upsert_workout_session_lww") {
        return {
          data: [{
            id: SESSION_ID,
            accepted: false,
            server_updated_at: "2026-09-20T13:00:00.000Z",
          }],
          error: null,
        };
      }
      return undefined;
    },
  });
  const response = await harness.handler(requestFromBody(body));
  const responseBody = await json(response);

  assertEquals(response.status, 200, JSON.stringify(responseBody));
  assertEquals(responseBody.sessionsInserted, 0);
  assertEquals(responseBody.exercisesInserted, 0);
  assertEquals(responseBody.acknowledgedWorkoutSessionIds, []);
  const sessionRejections = (responseBody.rejections as {
    sessions: unknown[];
  }).sessions;
  assertEquals(sessionRejections, [{
    id: SESSION_ID,
    serverUpdatedAt: "2026-09-20T13:00:00.000Z",
  }]);
  // No component replacement for a rejected parent, and never a per-table
  // child write (including exercise_progress) standing in for one.
  assertEquals(
    harness.adminRpcCalls.filter((call) => call.name === "replace_session_children"),
    [],
  );
  assertEquals(
    harness.adminWriteCalls.filter((call) =>
      ["exercises", "sets", "rep_summaries", "rep_telemetry", "exercise_progress"]
        .includes(call.table)
    ),
    [],
  );
});

// Design K (KD-6) carries the cycles, their days and the presence bits on ONE
// `merge_training_cycles_from_push` row per cycle (`p_cycles[i].days`), not the
// retired `upsert_training_cycles_with_days_lww` `p_rows` / `p_days` pair.
Deno.test("accepted workout and cycle parents return exact committed receipts", async () => {
  const body = validNestedRelationshipBody();
  body.routines = [];
  const cycle = (body.cycles as Array<Record<string, unknown>>)[0];
  cycle.progressionSettingsPresent = true;
  delete cycle.progressionSettings;
  cycle.progressStatePresent = true;
  cycle.progressState = {
    currentDayNumber: 2,
    lastCompletedDate: 1_789_948_800_000,
    cycleStartDate: 1_789_862_400_000,
    lastAdvancedAt: 1_789_952_400_000,
    completedDays: [1],
    missedDays: [],
    rotationCount: 3,
  };
  const day = (cycle.days as Array<Record<string, unknown>>)[0];
  day.echoLevelPresent = true;
  day.echoLevel = "HIGH";
  day.eccentricLoadPercentPresent = true;
  day.eccentricLoadPercent = 125;
  const harness = makeHarness();
  const response = await harness.handler(requestFromBody(body));
  const responseBody = await json(response);

  assertEquals(response.status, 200, JSON.stringify(responseBody));
  assertEquals(responseBody.acknowledgedWorkoutSessionIds, [SESSION_ID]);
  assertEquals(responseBody.acknowledgedCycleIds, [CYCLE_ID]);
  const cycleCall = harness.adminRpcCalls.find((call) =>
    call.name === "merge_training_cycles_from_push"
  );
  const parentRows = cycleCall?.args.p_cycles as Array<Record<string, unknown>>;
  const dayRows = parentRows[0].days as Array<Record<string, unknown>>;
  assertEquals(parentRows[0].progression_settings_present, true);
  assertEquals(parentRows[0].progression_settings, null);
  assertEquals(parentRows[0].progress_state_present, true);
  assertEquals(parentRows[0].progress_state, cycle.progressState);
  assertEquals(dayRows[0].echo_level_present, true);
  assertEquals(dayRows[0].echo_level, "HIGH");
  assertEquals(dayRows[0].eccentric_load_percent_present, true);
  assertEquals(dayRows[0].eccentric_load_percent, 125);
});

Deno.test("legacy non-null progression settings remain authoritative without a presence bit", async () => {
  const body = validNestedRelationshipBody();
  body.sessions = [];
  body.routines = [];
  const cycle = (body.cycles as Array<Record<string, unknown>>)[0];
  cycle.progressionSettings = JSON.stringify({ type: "wave", amount: 3 });
  delete cycle.progressionSettingsPresent;

  const harness = makeHarness();
  const response = await harness.handler(requestFromBody(body));
  const responseBody = await json(response);

  assertEquals(response.status, 200, JSON.stringify(responseBody));
  const cycleCall = harness.adminRpcCalls.find((call) =>
    call.name === "merge_training_cycles_from_push"
  );
  const parentRows = cycleCall?.args.p_cycles as Array<Record<string, unknown>>;
  assertEquals(parentRows[0].progression_settings, { type: "wave", amount: 3 });
  assertEquals("progression_settings_present" in parentRows[0], false);

  delete cycle.progressionSettings;
  const missingHarness = makeHarness();
  const missingResponse = await missingHarness.handler(requestFromBody(body));
  const missingResponseBody = await json(missingResponse);
  assertEquals(missingResponse.status, 200, JSON.stringify(missingResponseBody));
  const missingCall = missingHarness.adminRpcCalls.find((call) =>
    call.name === "merge_training_cycles_from_push"
  );
  const missingRows = missingCall?.args.p_cycles as Array<Record<string, unknown>>;
  assertEquals(missingRows[0].progression_settings, null);
  assertEquals("progression_settings_present" in missingRows[0], false);
});

// Was asserting `upsert_workout_sessions_with_components`'s `p_component_ids`.
// Design K filters blocked components out of the rows handed to
// `replace_session_children`, so the property under test (a tombstoned
// component is dropped while its sibling under the same parent survives) is
// that RPC's `p_exercises` / `p_sets`. The probe shape is unchanged.
Deno.test("component tombstone filters only the named exercise under a grouped parent", async () => {
  const body = validNestedRelationshipBody();
  body.routines = [];
  body.cycles = [];
  const session = (body.sessions as Array<{
    id: string;
    exercises: Array<{
      id: string;
      sessionId: string;
      name: string;
      sets: unknown[];
      [key: string]: unknown;
    }>;
  }>)[0];
  const blocked = session.exercises[0];
  const siblingId = "51000000-0000-4000-8000-000000000002";
  session.exercises.push({
    ...blocked,
    id: siblingId,
    sessionId: session.id,
    name: "Sibling component",
    sets: [],
  });
  const harness = makeHarness(undefined, {
    rpcBehavior: async (name) => {
      if (name === "get_blocked_workout_component_ids") {
        return { data: [{ component_id: blocked.id }], error: null };
      }
      return undefined;
    },
  });

  const response = await harness.handler(requestFromBody(body));
  const responseBody = await json(response);
  assertEquals(response.status, 200, JSON.stringify(responseBody));

  const replaceCall = harness.adminRpcCalls.find((call) =>
    call.name === "replace_session_children"
  );
  // The parent session itself is not blocked, so it is still replaced.
  assertEquals(replaceCall?.args.p_session_ids, [session.id]);
  assertEquals(
    (replaceCall?.args.p_exercises as Array<{ id: string }>).map((row) => row.id),
    [siblingId],
  );
  // The blocked exercise's sets never reach the replace either (the sibling
  // carries none of its own).
  assertEquals(replaceCall?.args.p_sets, []);
  const componentProbe = harness.adminRpcCalls.find((call) =>
    call.name === "get_blocked_workout_component_ids"
  );
  assertEquals(componentProbe?.args.p_components, [
    { id: blocked.id, portalSessionId: session.id },
    { id: siblingId, portalSessionId: session.id },
  ]);
});

Deno.test("grouped workout tombstone probes use portalSessionId not the local session id", async () => {
  const localSessionId = "51000000-0000-4000-8000-000000000010";
  const portalSessionId = "51000000-0000-4000-8000-000000000011";
  const body = validNestedRelationshipBody();
  body.routines = [];
  body.cycles = [];
  const session = (body.sessions as Array<{
    id: string;
    routineSessionId?: string | null;
    exercises: Array<{ id: string; sessionId: string }>;
  }>)[0];
  session.id = localSessionId;
  session.routineSessionId = portalSessionId;
  for (const exercise of session.exercises) {
    exercise.sessionId = localSessionId;
  }
  const harness = makeHarness();
  const response = await harness.handler(requestFromBody(body));
  assertEquals(response.status, 200, JSON.stringify(await json(response)));

  const sessionProbe = harness.adminRpcCalls.find((call) =>
    call.name === "get_blocked_workout_session_ids"
  );
  assertEquals(sessionProbe?.args.p_sessions, [
    { id: localSessionId, portalSessionId },
  ]);
  const componentProbe = harness.adminRpcCalls.find((call) =>
    call.name === "get_blocked_workout_component_ids"
  );
  assertEquals(componentProbe?.args.p_components, [
    { id: EXERCISE_ID, portalSessionId },
  ]);
});

// docs/sync-reliability-contract.md: cycle deletions come in two shapes.
// Clocked (`deletedCycles`) carries the deleting device's `updatedAt` and is
// ordered against the stored LWW key. Legacy (`deletedCycleIds`) has no usable
// clock and older store builds still send it. Do not generalise one shape's
// rules onto the other.
Deno.test("clocked cycle deletion that wins is acknowledged and hard-deletes the parent", async () => {
  const deletedId = "30000000-0000-4000-8000-000000000011";
  const harness = makeHarness(undefined, {
    tableResults: {
      training_cycles: {
        data: [{ id: deletedId, client_updated_at: "2026-09-20T12:00:00.000Z" }],
        error: null,
      },
    },
  });
  const response = await harness.handler(requestFromBody({
    ...validPushBody(),
    deletedCycles: [{ id: deletedId, updatedAt: "2026-09-20T13:00:00.000Z" }],
  }));
  const body = await json(response);

  assertEquals(response.status, 200, JSON.stringify(body));
  assertEquals(body.acknowledgedDeletedCycleIds, [deletedId]);
  assertEquals((body.rejections as { cycles: unknown[] }).cycles, []);
  // CASCADE takes cycle_days — there is never a separate cycle_days delete
  // racing the parent.
  const deletes = writeQueries(harness, "training_cycles", "delete");
  assertEquals(deletes.length, 1);
  assertEquals(callArgs(deletes[0]!, "in")[1], [deletedId]);
  assertEquals(callArgs(deletes[0]!, "eq"), ["user_id", VALID_USER_ID]);
  assertEquals(
    harness.adminWriteCalls.filter((call) => call.table === "cycle_days"),
    [],
  );
});

Deno.test("clocked cycle deletion that loses to a newer server row is a rejection and keeps the server copy", async () => {
  const deletedId = "30000000-0000-4000-8000-000000000011";
  const storedClock = "2026-09-20T13:00:00.000Z";
  const harness = makeHarness(undefined, {
    tableResults: {
      training_cycles: {
        data: [{ id: deletedId, client_updated_at: storedClock }],
        error: null,
      },
    },
  });
  const response = await harness.handler(requestFromBody({
    ...validPushBody(),
    deletedCycles: [{ id: deletedId, updatedAt: "2026-09-20T12:00:00.000Z" }],
  }));
  const body = await json(response);

  assertEquals(response.status, 200, JSON.stringify(body));
  assertEquals(body.acknowledgedDeletedCycleIds, []);
  assertEquals((body.rejections as { cycles: unknown[] }).cycles, [
    { id: deletedId, serverUpdatedAt: storedClock },
  ]);
  assertEquals(writeQueries(harness, "training_cycles", "delete"), []);
  assertEquals(writeQueries(harness, "sync_tombstones", "upsert"), []);
});

Deno.test("legacy deletedCycleIds never hard-delete: a present row is a rejection, an absent id is silent", async () => {
  const existingId = "30000000-0000-4000-8000-000000000011";
  const absentId = "30000000-0000-4000-8000-000000000012";
  const storedClock = "2026-09-20T12:00:00.000Z";
  const harness = makeHarness(undefined, {
    tableResults: {
      training_cycles: {
        data: [{ id: existingId, client_updated_at: storedClock }],
        error: null,
      },
    },
  });
  const response = await harness.handler(requestFromBody({
    ...validPushBody(),
    deletedCycleIds: [existingId, absentId],
  }));
  const body = await json(response);

  assertEquals(response.status, 200, JSON.stringify(body));
  assertEquals(body.acknowledgedDeletedCycleIds, []);
  assertEquals((body.rejections as { cycles: unknown[] }).cycles, [
    { id: existingId, serverUpdatedAt: storedClock },
  ]);
  assertEquals(writeQueries(harness, "training_cycles", "delete"), []);
  assertEquals(writeQueries(harness, "sync_tombstones", "upsert"), []);
});

Deno.test("clocked cycle deletion of an already-absent id records a tombstone and is acknowledged", async () => {
  const absentId = "30000000-0000-4000-8000-000000000013";
  const harness = makeHarness();
  const response = await harness.handler(requestFromBody({
    ...validPushBody(),
    deletedCycles: [{ id: absentId, updatedAt: "2026-09-20T13:00:00.000Z" }],
  }));
  const body = await json(response);

  assertEquals(response.status, 200, JSON.stringify(body));
  assertEquals(body.acknowledgedDeletedCycleIds, [absentId]);
  assertEquals((body.rejections as { cycles: unknown[] }).cycles, []);
  // No row to hard-delete; the tombstone is what stops the next stale upload
  // from recreating the cycle.
  assertEquals(writeQueries(harness, "training_cycles", "delete"), []);
  const tombstoneUpserts = writeQueries(harness, "sync_tombstones", "upsert");
  assertEquals(tombstoneUpserts.length, 1);
  assertEquals(callArgs(tombstoneUpserts[0]!, "upsert")[0], [{
    user_id: VALID_USER_ID,
    entity: "cycle",
    entity_id: absentId,
    deleted_at: "2026-07-16T02:00:00.000Z",
  }]);
});

Deno.test("an id named by both a clocked and a legacy delete is handled only by the clocked gate", async () => {
  const deletedId = "30000000-0000-4000-8000-000000000011";
  const harness = makeHarness(undefined, {
    tableResults: {
      training_cycles: {
        data: [{ id: deletedId, client_updated_at: "2026-09-20T12:00:00.000Z" }],
        error: null,
      },
    },
  });
  const response = await harness.handler(requestFromBody({
    ...validPushBody(),
    deletedCycles: [{ id: deletedId, updatedAt: "2026-09-20T13:00:00.000Z" }],
    deletedCycleIds: [deletedId],
  }));
  const body = await json(response);

  assertEquals(response.status, 200, JSON.stringify(body));
  assertEquals(body.acknowledgedDeletedCycleIds, [deletedId]);
  // The legacy list must not also produce a rejection for the same id.
  assertEquals((body.rejections as { cycles: unknown[] }).cycles, []);
  assertEquals(writeQueries(harness, "training_cycles", "delete").length, 1);
});

Deno.test("byte golden metadata and raw lexemes remain exact", () => {
  assertEquals(byteGoldens.version, 1);
  assertEquals(byteGoldens.sectionTargetBytes, [262143, 262144, 262145]);
  assertEquals(byteGoldens.requestTargetBytes, [524287, 524288, 524289]);
  assert(byteGoldens.sectionRawTemplate.includes("20.0"));
  assert(byteGoldens.sectionRawTemplate.includes("-1e3"));
  assert(byteGoldens.sectionRawTemplate.includes('π界🙂\\"\\\\'));
});

Deno.test("byte golden digest guard detects a one-byte corruption", async () => {
  const corrupted = byteGoldenBytes.slice();
  corrupted[corrupted.byteLength - 1] ^= 0x01;
  assert((await sha256Hex(corrupted)) !== EXPECTED_GOLDEN_SHA256);
});

for (
  const [label, authorization] of [
    ["missing header", null],
    ["blank header", ""],
    ["blank bearer suffix", "Bearer "],
    ["whitespace-bearing suffix", "Bearer token value"],
    ["tab-bearing suffix", "Bearer token\tvalue"],
    ["multi-token suffix", "Bearer one two"],
    ["wrong scheme casing", "bearer token"],
    ["malformed scheme", "Basic token"],
  ] as const
) {
  Deno.test(`auth: ${label} is definitive 401 before auth or admin construction`, async () => {
    const harness = makeHarness();
    const response = await harness.handler(
      requestFromBody(validPushBody(), authorization),
    );

    assertEquals(response.status, 401);
    assertEquals(harness.authClientAuthorizations, []);
    assertEquals(harness.getUserJwts, []);
    assertEquals(harness.adminConstructionCount.value, 0);
    assertEquals(harness.loggerCalls, []);
  });
}

for (const status of [400, 401, 403]) {
  Deno.test(`auth: returned ${status} Auth error is definitive 401`, async () => {
    const harness = makeHarness(async () => ({
      data: { user: null },
      error: { name: "AuthApiError", status },
    }));
    const response = await harness.handler(requestFromBody(validPushBody()));

    assertEquals(response.status, 401);
    assertEquals(harness.getUserJwts, [VALID_JWT]);
    assertEquals(harness.adminConstructionCount.value, 0);
    assertEquals(harness.loggerCalls, []);
  });
}

const operationalResults: Array<{
  label: string;
  result: unknown;
  expectedName: string;
}> = [
  ...[429, 500, 503].map((status) => ({
    label: `returned ${status} Auth error`,
    result: { data: { user: null }, error: { name: "AuthApiError", status } },
    expectedName: "AuthApiError",
  })),
  {
    label: "returned error without status",
    result: { data: { user: null }, error: { name: "AuthRetryableError" } },
    expectedName: "AuthRetryableError",
  },
  { label: "null result", result: null, expectedName: "AuthUnexpectedResult" },
  { label: "array result", result: [], expectedName: "AuthUnexpectedResult" },
  {
    label: "primitive result",
    result: "bad",
    expectedName: "AuthUnexpectedResult",
  },
  {
    label: "missing error and data",
    result: {},
    expectedName: "AuthUnexpectedResult",
  },
  {
    label: "missing data",
    result: { error: null },
    expectedName: "AuthUnexpectedResult",
  },
  {
    label: "missing error",
    result: { data: { user: { id: VALID_USER_ID } } },
    expectedName: "AuthUnexpectedResult",
  },
  {
    label: "null success data",
    result: { data: null, error: null },
    expectedName: "AuthUnexpectedResult",
  },
  {
    label: "success without user",
    result: { data: {}, error: null },
    expectedName: "AuthUnexpectedResult",
  },
  {
    label: "success with null user",
    result: { data: { user: null }, error: null },
    expectedName: "AuthUnexpectedResult",
  },
  {
    label: "success with blank user id",
    result: { data: { user: { id: "" } }, error: null },
    expectedName: "AuthUnexpectedResult",
  },
  {
    label: "success with whitespace-only user id",
    result: { data: { user: { id: "   " } }, error: null },
    expectedName: "AuthUnexpectedResult",
  },
];

for (const testCase of operationalResults) {
  Deno.test(`auth outage: ${testCase.label} is generic name-only 503`, async () => {
    const harness = makeHarness(async () => testCase.result);
    const response = await harness.handler(requestFromBody(validPushBody()));

    assertEquals(response.status, 503);
    assertEquals(await json(response), {
      error: "Authentication service unavailable",
    });
    assertEquals(harness.getUserJwts, [VALID_JWT]);
    assertEquals(harness.adminConstructionCount.value, 0);
    assertEquals(harness.loggerCalls, [[{ name: testCase.expectedName }]]);
  });
}

for (
  const [label, thrown, expectedName] of [
    [
      "thrown Error",
      Object.assign(new Error("secret"), { name: "NetworkError" }),
      "NetworkError",
    ],
    [
      "rejected named object",
      { name: "TimeoutError", message: "secret" },
      "TimeoutError",
    ],
    [
      "invalid thrown name",
      Object.assign(new Error("secret"), { name: "bad name!" }),
      "AuthOperationalFailure",
    ],
    [
      "oversized thrown name",
      Object.assign(new Error("secret"), { name: `A${"x".repeat(64)}` }),
      "AuthOperationalFailure",
    ],
  ] as const
) {
  Deno.test(`auth outage: ${label} logs only a safe fixed name`, async () => {
    const harness = makeHarness(async () => {
      throw thrown;
    });
    const response = await harness.handler(requestFromBody(validPushBody()));

    assertEquals(response.status, 503);
    assertEquals(await json(response), {
      error: "Authentication service unavailable",
    });
    assertEquals(harness.adminConstructionCount.value, 0);
    assertEquals(harness.loggerCalls, [[{ name: expectedName }]]);
  });
}

// Subscription gate (F-047): a denied or failed lookup must stop the push
// after the rate limiter and the subscriptions read, before any write, RPC
// or broadcast.
function singleSessionPushBody(
  sessionId = SESSION_ID,
  userId = VALID_USER_ID,
): Record<string, unknown> {
  return {
    ...validPushBody(),
    sessions: [{
      id: sessionId,
      userId,
      name: "Gate session",
      startedAt: "2026-07-11T12:00:00.000Z",
      exercises: [],
    }],
  };
}

function assertStoppedAtSubscriptionGate(harness: PushHarness): void {
  assertEquals(harness.adminConstructionCount.value, 1);
  assertEquals(harness.adminFromCalls, ["subscriptions"]);
  assertEquals(harness.adminRpcCalls.map((call) => call.name), [
    "check_rate_limit",
  ]);
  assertEquals(harness.adminWriteCalls, []);
  assertEquals(harness.channelCalls, []);
  assertEquals(harness.broadcastPayloads, []);
}

for (
  const [label, subscriptionResult] of [
    ["no subscriptions row", { data: null, error: null }],
    ["an active FREE row", {
      data: {
        tier: "FREE",
        status: "active",
        current_period_end: "2099-01-01T00:00:00.000Z",
      },
      error: null,
    }],
  ] as const
) {
  Deno.test(`subscription gate: ${label} is denied with 402 before any write`, async () => {
    const harness = makeHarness(undefined, { subscriptionResult });
    const response = await harness.handler(
      requestFromBody(singleSessionPushBody()),
    );
    const body = await json(response);
    assertEquals(response.status, 402, JSON.stringify(body));
    assertEquals(body.error, "subscription_required");
    assertEquals(body.requiredTier, "EMBER");
    assertEquals(body.currentTier, "FREE");
    assertStoppedAtSubscriptionGate(harness);
  });
}

Deno.test("subscription gate: a lookup error fails closed with 503 before any write", async () => {
  const harness = makeHarness(undefined, {
    subscriptionResult: {
      data: null,
      error: { message: "connection refused", code: "08006" },
    },
  });
  const originalConsoleError = console.error;
  console.error = () => {};
  let response: Response;
  try {
    response = await harness.handler(
      requestFromBody(singleSessionPushBody()),
    );
  } finally {
    console.error = originalConsoleError;
  }
  const body = await json(response);
  assertEquals(response.status, 503, JSON.stringify(body));
  assertEquals(body.error, "subscription_unavailable");
  assertEquals(response.headers.get("Retry-After"), "30");
  assertStoppedAtSubscriptionGate(harness);
});

Deno.test("subscription gate: the same body from an EMBER user is written with 200", async () => {
  // Positive control: the deny tests above use a body that writes when the
  // gate allows it.
  const harness = makeHarness();
  const response = await harness.handler(
    requestFromBody(singleSessionPushBody()),
  );
  const body = await json(response);
  assertEquals(response.status, 200, JSON.stringify(body));
  assertEquals(harness.loggerCalls, []);
  // Design K's write path also probes blocked workout ids (no component
  // probe here: `singleSessionPushBody` sends no exercises), runs the
  // fail-open gamification recompute on every push, and broadcasts once
  // something committed. The earlier list stopped at the child swap.
  // Only the third step is flag-dependent: flag-on routes sessions through
  // `upsert_workout_session_lww`, flag-off through a PostgREST upsert. Both
  // are the same Design K write of the session parent, before the child swap.
  assertEquals(harness.operationEvents, [
    "rpc:check_rate_limit",
    "rpc:get_blocked_workout_session_ids",
    SYNC_LWW_ENABLED
      ? "rpc:upsert_workout_session_lww"
      : "write:workout_sessions:upsert",
    "rpc:replace_session_children",
    "rpc:recompute_gamification_stats",
    "realtime:setAuth",
    "realtime:httpSend",
  ]);
});

Deno.test("malformed final ordinary item is rejected before admin construction", async () => {
  const harness = makeHarness();
  const ordinaryItem = {
    clientId: "custom-a",
    name: "Valid exercise",
    muscleGroup: "General",
    defaultCableConfig: "DOUBLE",
  };
  const body = {
    ...validPushBody(),
    customExercises: [ordinaryItem, {
      ...ordinaryItem,
      clientId: "custom-b",
      name: "   ",
    }],
  };
  const response = await harness.handler(requestFromBody(body));

  assertEquals(response.status, 400);
  assertEquals(harness.getUserJwts, [VALID_JWT]);
  assertEquals(harness.adminConstructionCount.value, 0);
  assertEquals(harness.adminRpcCalls, []);
});

Deno.test("malformed final preference item is rejected before admin construction", async () => {
  const harness = makeHarness();
  const rawPrefix = JSON.stringify({
    ...validPushBody(),
    profilePreferenceSections: [validCoreMutation()],
  }).slice(0, -2);
  const malformed = encoder.encode(`${rawPrefix},{"localProfileId":"broken"`);
  const response = await harness.handler(rawRequest(malformed));

  assertEquals(response.status, 400);
  assertEquals(harness.adminConstructionCount.value, 0);
  assertEquals(harness.adminRpcCalls, []);
});

for (
  const testCase of [
    {
      label: "session/exercise",
      mutate(body: Record<string, unknown>) {
        const session = (body.sessions as Record<string, unknown>[])[0];
        const exercise = (session.exercises as Record<string, unknown>[])[0];
        exercise.sessionId = MISMATCH_ID;
      },
      error:
        `FK mismatch in payload: exercise ${EXERCISE_ID} sessionId must equal parent session ${SESSION_ID}`,
    },
    {
      label: "exercise/set",
      mutate(body: Record<string, unknown>) {
        const session = (body.sessions as Record<string, unknown>[])[0];
        const exercise = (session.exercises as Record<string, unknown>[])[0];
        const set = (exercise.sets as Record<string, unknown>[])[0];
        set.exerciseId = MISMATCH_ID;
      },
      error:
        `FK mismatch in payload: set ${SET_ID} exerciseId must equal parent exercise ${EXERCISE_ID}`,
    },
    {
      label: "set/rep summary",
      mutate(body: Record<string, unknown>) {
        const session = (body.sessions as Record<string, unknown>[])[0];
        const exercise = (session.exercises as Record<string, unknown>[])[0];
        const set = (exercise.sets as Record<string, unknown>[])[0];
        const repSummary = (set.repSummaries as Record<string, unknown>[])[0];
        repSummary.setId = MISMATCH_ID;
      },
      error:
        `FK mismatch in payload: rep_summary ${REP_SUMMARY_ID} setId must equal parent set ${SET_ID}`,
    },
    {
      label: "routine/exercise",
      mutate(body: Record<string, unknown>) {
        const routine = (body.routines as Record<string, unknown>[])[0];
        const exercise = (routine.exercises as Record<string, unknown>[])[0];
        exercise.routineId = MISMATCH_ID;
      },
      error:
        `FK mismatch in payload: routine_exercise ${ROUTINE_EXERCISE_ID} routineId must equal parent routine ${ROUTINE_ID}`,
    },
    {
      label: "cycle/day",
      mutate(body: Record<string, unknown>) {
        const cycle = (body.cycles as Record<string, unknown>[])[0];
        const day = (cycle.days as Record<string, unknown>[])[0];
        day.cycleId = MISMATCH_ID;
      },
      error:
        `FK mismatch in payload: cycle_day ${CYCLE_DAY_ID} cycleId must equal parent cycle ${CYCLE_ID}`,
    },
  ]
) {
  Deno.test(`payload relationship: ${testCase.label} mismatch is rejected before privileges`, async () => {
    const harness = makeHarness();
    const body = validNestedRelationshipBody();
    testCase.mutate(body);

    const response = await harness.handler(requestFromBody(body));

    assertEquals(response.status, 400);
    assertEquals(await json(response), { error: testCase.error });
    assertNoPrivilegedActivity(harness);
  });
}

Deno.test("external activity without a client id is rejected before privileges", async () => {
  const harness = makeHarness();
  const response = await harness.handler(requestFromBody({
    ...validPushBody(),
    profileId: "default",
    allProfiles: [{ id: "default", name: "Default", colorIndex: 0 }],
    externalActivities: [{
      externalId: "external-activity-a",
      provider: "test-provider",
      name: "Missing client id",
      startedAt: "2026-07-11T12:00:00.000Z",
    }],
  }));

  assertEquals(response.status, 400);
  assertEquals(await json(response), {
    error:
      "external_activity.id is required (mobile must mint UUID before send)",
  });
  assertNoPrivilegedActivity(harness);
});

for (
  const [label, bytes] of [
    [
      "leading UTF-8 BOM",
      new Uint8Array([
        0xef,
        0xbb,
        0xbf,
        ...encoder.encode(JSON.stringify(validPushBody())),
      ]),
    ],
    [
      "truncated UTF-8 sequence",
      new Uint8Array([0x7b, 0x22, 0x78, 0x22, 0x3a, 0x22, 0xe2, 0x82]),
    ],
    [
      "overlong UTF-8 sequence",
      new Uint8Array([
        0x7b,
        0x22,
        0x78,
        0x22,
        0x3a,
        0x22,
        0xc0,
        0xaf,
        0x22,
        0x7d,
      ]),
    ],
    [
      "isolated continuation byte",
      new Uint8Array([0x7b, 0x22, 0x78, 0x22, 0x3a, 0x22, 0x80, 0x22, 0x7d]),
    ],
  ] as const
) {
  Deno.test(`raw bytes: ${label} is 400 before admin construction`, async () => {
    const harness = makeHarness();
    const response = await harness.handler(rawRequest(bytes));

    assertEquals(response.status, 400);
    assertEquals(harness.adminConstructionCount.value, 0);
    assertEquals(harness.adminRpcCalls, []);
  });
}

for (const targetBytes of byteGoldens.sectionTargetBytes) {
  Deno.test(`raw section boundary: ${targetBytes} bytes uses the exact element span`, async () => {
    const sectionRaw = fillAsciiPadding(
      byteGoldens.sectionRawTemplate,
      byteGoldens.paddingMarker,
      targetBytes,
    );
    const envelope = envelopeFromRawElements([sectionRaw]);
    if (targetBytes <= 262144) {
      assertEquals(envelope.validatedMutations.length, 1);
      assertEquals(envelope.rejections, []);
    } else {
      assertEquals(envelope.validatedMutations, []);
      assertEquals(envelope.rejections, [{
        localProfileId: "profile-a",
        section: "RACK",
        serverRevision: 0,
        reason: "SECTION_TOO_LARGE",
      }]);
    }
  });
}

for (const targetBytes of byteGoldens.requestTargetBytes) {
  Deno.test(`raw request boundary: ${targetBytes} original bytes is enforced inclusively`, async () => {
    const harness = makeHarness();
    const bytes = requestGoldenAt(targetBytes);
    assertEquals(bytes.byteLength, targetBytes);
    const response = await harness.handler(rawRequest(bytes));

    if (targetBytes <= 524288) {
      assertEquals(response.status, 200);
      assertEquals(harness.adminConstructionCount.value, 1);
      assertEquals(
        harness.adminRpcCalls.filter((call) =>
          call.name === "mutate_local_profile_preference_section"
        ).length,
        1,
      );
    } else {
      assertEquals(response.status, 413);
      assertEquals(harness.adminConstructionCount.value, 0);
      assertEquals(harness.adminRpcCalls, []);
    }
  });
}

Deno.test("raw scanner retains exact element offsets through whitespace, escapes, and nesting", () => {
  const first =
    ` {"localProfileId":"profile-a","section":"CORE","documentVersion":1,"baseRevision":0,"clientModifiedAt":"2026-07-11T12:00:00Z","payload":{"bodyWeightKg":80,"weightUnit":"KG","weightIncrement":1,"note":"quoted \\\" value","nested":[{"value":"π界🙂"}]}} `;
  const second = JSON.stringify({
    ...validLedMutation(),
    localProfileId: "profile-b",
  });
  const rawBody =
    ` \r\n { "deviceId":"scanner", "profilePreferenceSections" : [${first},\n${second}] } \t`;
  const topLevel = scanTopLevelJsonObject(rawBody);
  const preferenceSpan = topLevel.valueSpans.get("profilePreferenceSections");
  assert(preferenceSpan);
  assertEquals(rawBody.slice(preferenceSpan.start, preferenceSpan.end)[0], "[");
  const spans = scanJsonArrayElementSpans(rawBody, preferenceSpan);
  assertEquals(spans.length, 2);
  assertEquals(rawBody.slice(spans[0].start, spans[0].end), first.trim());
  assertEquals(rawBody.slice(spans[1].start, spans[1].end), second);
  assertEquals(JSON.parse(rawBody.slice(spans[1].start, spans[1].end)), {
    ...validLedMutation(),
    localProfileId: "profile-b",
  });
});

Deno.test("raw scanner reports duplicate relevant top-level keys", async () => {
  const harness = makeHarness();
  const ordinary = JSON.stringify(validPushBody());
  const raw = `${ordinary.slice(0, -1)},"deviceId":"duplicate"}`;
  const scan = scanTopLevelJsonObject(raw);
  assertEquals([...scan.duplicateKeys], ["deviceId"]);

  const response = await harness.handler(rawRequest(encoder.encode(raw)));
  assertEquals(response.status, 400);
  assertEquals(harness.adminConstructionCount.value, 0);
});

for (
  const [label, transform] of [
    ["unknown top-level key", (body: Record<string, unknown>) => ({
      ...body,
      userId: "attacker-controlled",
    })],
    ["missing required deviceId", (body: Record<string, unknown>) => {
      const next = { ...body };
      delete next.deviceId;
      return next;
    }],
    ["primitive body", () => 7],
    ["non-array preference field", (body: Record<string, unknown>) => ({
      ...body,
      profilePreferenceSections: {},
    })],
  ] as const
) {
  Deno.test(`strict push body: ${label} is 400 before admin construction`, async () => {
    const harness = makeHarness();
    const response = await harness.handler(
      requestFromBody(transform(validPushBody())),
    );
    assertEquals(response.status, 400);
    assertEquals(harness.adminConstructionCount.value, 0);
    assertEquals(harness.adminRpcCalls, []);
  });
}

Deno.test("all five exact section wrappers validate", () => {
  const envelope = envelopeFromMutations([
    validCoreMutation(),
    { ...validRackMutation(), localProfileId: "profile-b" },
    { ...validWorkoutMutation(), localProfileId: "profile-c" },
    { ...validLedMutation(), localProfileId: "profile-d" },
    { ...validVbtMutation(), localProfileId: "profile-e" },
  ]);
  assertEquals(
    envelope.validatedMutations.map((mutation) => mutation.section),
    ["CORE", "RACK", "WORKOUT", "LED", "VBT"],
  );
  assertEquals(envelope.rejections, []);
});

for (
  const [label, mutation, reason] of [
    [
      "missing wrapper key",
      (() => {
        const value = validCoreMutation();
        delete value.payload;
        return value;
      })(),
      "VALIDATION_FAILED",
    ],
    [
      "unknown wrapper key",
      { ...validCoreMutation(), extra: true },
      "VALIDATION_FAILED",
    ],
    [
      "unsupported section",
      { ...validCoreMutation(), section: "FUTURE" },
      "UNSUPPORTED_SECTION",
    ],
    [
      "unsupported wrapper version",
      { ...validCoreMutation(), documentVersion: 2 },
      "UNSUPPORTED_DOCUMENT_VERSION",
    ],
    [
      "unsupported embedded document version",
      {
        ...validRackMutation(),
        payload: { ...validRackMutation().payload as object, version: 2 },
      },
      "UNSUPPORTED_DOCUMENT_VERSION",
    ],
    [
      "unknown payload key",
      {
        ...validCoreMutation(),
        payload: { ...validCoreMutation().payload as object, extra: true },
      },
      "VALIDATION_FAILED",
    ],
  ] as const
) {
  Deno.test(`strict preference shape: ${label}`, () => {
    const envelope = envelopeFromMutations([
      mutation as Record<string, unknown>,
    ]);
    assertEquals(envelope.validatedMutations, []);
    assertEquals(envelope.rejections.length, 1);
    assertEquals(envelope.rejections[0].reason, reason);
  });
}

Deno.test("rack permits duplicate names and signed safe-integer timestamps", () => {
  const mutation = validRackMutation();
  const payload = mutation.payload as Record<string, unknown>;
  const first = (payload.items as Record<string, unknown>[])[0];
  payload.items = [
    { ...first, createdAt: Number.MIN_SAFE_INTEGER, updatedAt: -1 },
    {
      ...first,
      id: "rack-b",
      createdAt: Number.MAX_SAFE_INTEGER,
      updatedAt: 0,
    },
  ];
  assertEquals(envelopeFromMutations([mutation]).rejections, []);
});

Deno.test("rack rejects duplicate ids", () => {
  const mutation = validRackMutation();
  const payload = mutation.payload as Record<string, unknown>;
  const first = (payload.items as Record<string, unknown>[])[0];
  payload.items = [first, { ...first }];
  assertEquals(
    envelopeFromMutations([mutation]).rejections[0].reason,
    "VALIDATION_FAILED",
  );
});

for (const sortOrder of [-2_147_483_648, 2_147_483_647]) {
  Deno.test(`Kotlin Int32: rack sortOrder accepts ${sortOrder}`, () => {
    const mutation = validRackMutation();
    const item = ((mutation.payload as Record<string, unknown>).items as Record<
      string,
      unknown
    >[])[0];
    item.sortOrder = sortOrder;
    assertEquals(parsePreferenceMutation(mutation).payload, mutation.payload);
  });
}

for (const sortOrder of [-2_147_483_649, 2_147_483_648]) {
  Deno.test(`Kotlin Int32: rack sortOrder rejects ${sortOrder}`, () => {
    const mutation = validRackMutation();
    const item = ((mutation.payload as Record<string, unknown>).items as Record<
      string,
      unknown
    >[])[0];
    item.sortOrder = sortOrder;
    assertThrows(
      () => parsePreferenceMutation(mutation),
      PreferenceValidationError,
    );
  });
}

for (const field of ["setReps", "duration"] as const) {
  Deno.test(`Kotlin Int32: workout ${field} accepts max and applies nonnegative business rule`, () => {
    const accepted = validWorkoutMutation();
    const defaults = ((accepted.payload as Record<string, unknown>)
      .singleExerciseDefaults as Record<string, Record<string, unknown>>)[
        "exercise-a"
      ];
    if (field === "setReps") defaults.setReps = [2_147_483_647];
    else defaults.duration = 2_147_483_647;
    parsePreferenceMutation(accepted);

    const rejected = clone(accepted);
    const rejectedDefaults = ((rejected.payload as Record<string, unknown>)
      .singleExerciseDefaults as Record<string, Record<string, unknown>>)[
        "exercise-a"
      ];
    if (field === "setReps") rejectedDefaults.setReps = [-1];
    else rejectedDefaults.duration = -1;
    assertThrows(
      () => parsePreferenceMutation(rejected),
      PreferenceValidationError,
    );
  });
}

Deno.test("Kotlin Int32: LED color scheme enforces Int32 and nonnegative business bounds", () => {
  const accepted = validLedMutation();
  (accepted.payload as Record<string, unknown>).ledColorSchemeId =
    2_147_483_647;
  parsePreferenceMutation(accepted);
  for (const rejectedValue of [-1, 2_147_483_648]) {
    const rejected = clone(accepted);
    (rejected.payload as Record<string, unknown>).ledColorSchemeId =
      rejectedValue;
    assertThrows(
      () => parsePreferenceMutation(rejected),
      PreferenceValidationError,
    );
  }
});

Deno.test("safe JSON integer bounds apply to revisions", () => {
  const accepted = validCoreMutation();
  accepted.baseRevision = Number.MAX_SAFE_INTEGER;
  parsePreferenceMutation(accepted);
  for (const rejectedValue of [-1, Number.MAX_SAFE_INTEGER + 1, 1.5]) {
    const rejected = clone(accepted);
    rejected.baseRevision = rejectedValue;
    assertThrows(
      () => parsePreferenceMutation(rejected),
      PreferenceValidationError,
    );
  }
});

const FLOAT32_MAX = 3.4028234663852886e38;
const FLOAT32_MIN_POSITIVE = 1.401298464324817e-45;

Deno.test("Kotlin Float32 accepts max and smallest nonzero values where business rules allow", () => {
  for (const value of [FLOAT32_MAX, FLOAT32_MIN_POSITIVE]) {
    const mutation = validCoreMutation();
    (mutation.payload as Record<string, unknown>).weightIncrement = value;
    const parsed = parsePreferenceMutation(mutation);
    assertEquals(
      parsed.payload.weightIncrement,
      Math.fround(value),
    );
  }
});

for (const value of [3.5e38, 1e-46]) {
  Deno.test(`Kotlin Float32 rejects positive overflow/underflow ${value}`, () => {
    const mutation = validCoreMutation();
    (mutation.payload as Record<string, unknown>).weightIncrement = value;
    assertThrows(
      () => parsePreferenceMutation(mutation),
      PreferenceValidationError,
    );
  });
}

for (const value of [-3.5e38, -1e-46]) {
  Deno.test(`Kotlin Float32 rejects negative overflow/underflow ${value}`, () => {
    const mutation = validWorkoutMutation();
    const justLift = (mutation.payload as Record<string, unknown>)
      .justLiftDefaults as Record<string, unknown>;
    justLift.weightChangePerRep = value;
    assertThrows(
      () => parsePreferenceMutation(mutation),
      PreferenceValidationError,
    );
  });
}

for (const value of [20, 300]) {
  Deno.test(`CORE exact business boundary accepts ${value}`, () => {
    const mutation = validCoreMutation();
    (mutation.payload as Record<string, unknown>).bodyWeightKg = value;
    parsePreferenceMutation(mutation);
  });
}

for (const value of [19.9999999, 300.00001]) {
  Deno.test(`CORE original-number business boundary rejects ${value}`, () => {
    assert([20, 300].includes(Math.fround(value)));
    const mutation = validCoreMutation();
    (mutation.payload as Record<string, unknown>).bodyWeightKg = value;
    assertThrows(
      () => parsePreferenceMutation(mutation),
      PreferenceValidationError,
    );
  });
}

Deno.test("RACK nonnegative Float32 checks original and narrowed values", () => {
  for (const value of [0, FLOAT32_MIN_POSITIVE]) {
    const mutation = validRackMutation();
    const item = ((mutation.payload as Record<string, unknown>).items as Record<
      string,
      unknown
    >[])[0];
    item.weightKg = value;
    parsePreferenceMutation(mutation);
  }
  const mutation = validRackMutation();
  const item = ((mutation.payload as Record<string, unknown>).items as Record<
    string,
    unknown
  >[])[0];
  item.weightKg = -1e-46;
  assert(Object.is(Math.fround(-1e-46), -0));
  assertThrows(
    () => parsePreferenceMutation(mutation),
    PreferenceValidationError,
  );
});

for (const mode of [0, 2, 3, 4, 6, 10]) {
  Deno.test(`WORKOUT accepts mode ${mode}`, () => {
    const mutation = validWorkoutMutation();
    const justLift = (mutation.payload as Record<string, unknown>)
      .justLiftDefaults as Record<string, unknown>;
    justLift.workoutModeId = mode;
    parsePreferenceMutation(mutation);
  });
}

Deno.test("WORKOUT rejects an unknown mode and retains the PR-percent key", () => {
  const mutation = validWorkoutMutation();
  const payload = mutation.payload as Record<string, unknown>;
  assertEquals(payload.defaultRoutineExerciseWeightPercentOfPR, 100);
  const justLift = payload.justLiftDefaults as Record<string, unknown>;
  justLift.workoutModeId = 1;
  assertThrows(
    () => parsePreferenceMutation(mutation),
    PreferenceValidationError,
  );
});

Deno.test("LED Disco and VBT Vulgar/Dominatrix flags are required and typed", () => {
  for (const mutation of [validLedMutation(), validVbtMutation()]) {
    parsePreferenceMutation(mutation);
    const rejected = clone(mutation);
    const preferences = (rejected.payload as Record<string, unknown>)
      .preferences as Record<string, unknown>;
    const key = rejected.section === "LED"
      ? "discoModeUnlocked"
      : "dominatrixModeActive";
    preferences[key] = "true";
    assertThrows(
      () => parsePreferenceMutation(rejected),
      PreferenceValidationError,
    );
  }
});

for (
  const [input, normalized] of [
    ["2026-07-11T12:00:00Z", "2026-07-11T12:00:00.000Z"],
    ["2026-07-11T12:00:00.123456789Z", "2026-07-11T12:00:00.123Z"],
    ["2026-07-11T12:00:00+02:30", "2026-07-11T09:30:00.000Z"],
    ["2026-07-11T12:00:00-02:30", "2026-07-11T14:30:00.000Z"],
    ["2024-02-29T23:59:59Z", "2024-02-29T23:59:59.000Z"],
  ] as const
) {
  Deno.test(`RFC3339 accepts and normalizes ${input}`, () => {
    const mutation = validCoreMutation();
    mutation.clientModifiedAt = input;
    assertEquals(
      parsePreferenceMutation(mutation).clientModifiedAt,
      normalized,
    );
  });
}

for (
  const input of [
    0,
    "0",
    "July 11, 2026",
    "2026-07-11",
    "2026-07-11 12:00:00Z",
    "2026-02-30T12:00:00Z",
    "2025-02-29T12:00:00Z",
    "2026-07-11T24:00:00Z",
    "2026-07-11T12:60:00Z",
    "2026-07-11T12:00:60Z",
    "2026-07-11T12:00:00+24:00",
    "2026-07-11T12:00:00+02:60",
    "2026-07-11T12:00:00",
  ]
) {
  Deno.test(`RFC3339 rejects ${JSON.stringify(input)}`, () => {
    const mutation = validCoreMutation();
    mutation.clientModifiedAt = input;
    assertThrows(
      () => parsePreferenceMutation(mutation),
      PreferenceValidationError,
    );
  });
}

for (
  const [label, invalid] of [
    ["raw U+0000 value", "\u0000"],
    ["lone high surrogate value", "\ud800"],
    ["lone low surrogate value", "\udc00"],
  ] as const
) {
  Deno.test(`PostgreSQL text safety rejects ${label} recursively`, () => {
    const mutation = validWorkoutMutation();
    const defaults = ((mutation.payload as Record<string, unknown>)
      .singleExerciseDefaults as Record<string, Record<string, unknown>>)[
        "exercise-a"
      ];
    defaults.defaultRackItemIds = [invalid];
    assertThrows(
      () => parsePreferenceMutation(mutation),
      PreferenceValidationError,
    );
  });
}

Deno.test("PostgreSQL text safety rejects escaped U+0000 and lone-surrogate object keys", () => {
  const escapedNull = JSON.stringify(validWorkoutMutation()).replace(
    '"exercise-a":{',
    '"bad\\u0000key":{',
  ).replace('"exerciseId":"exercise-a"', '"exerciseId":"bad\\u0000key"');
  const nullEnvelope = envelopeFromRawElements([escapedNull]);
  assertEquals(nullEnvelope.rejections[0].reason, "VALIDATION_FAILED");

  for (const key of ["\ud800", "\udc00"]) {
    const mutation = validWorkoutMutation();
    const payload = mutation.payload as Record<string, unknown>;
    const defaults = payload.singleExerciseDefaults as Record<string, unknown>;
    const value = defaults["exercise-a"] as Record<string, unknown>;
    delete defaults["exercise-a"];
    defaults[key] = { ...value, exerciseId: key };
    assertThrows(
      () => parsePreferenceMutation(mutation),
      PreferenceValidationError,
    );
  }
});

Deno.test("PostgreSQL text safety accepts a valid supplementary pair and emoji", () => {
  const mutation = validWorkoutMutation();
  const payload = mutation.payload as Record<string, unknown>;
  const defaults = payload.singleExerciseDefaults as Record<string, unknown>;
  const value = defaults["exercise-a"] as Record<string, unknown>;
  delete defaults["exercise-a"];
  defaults["exercise-🙂"] = {
    ...value,
    exerciseId: "exercise-\ud83d\ude42",
  };
  parsePreferenceMutation(mutation);
});

for (
  const localOnlyKey of [
    "safeword",
    "safe_word",
    "SAFE-WORD",
    "adultsonlyconfirmed",
    "local.generation",
    "legacy_migration_version",
  ]
) {
  Deno.test(`recursive normalized local-only key ${localOnlyKey} is rejected`, () => {
    const mutation = validCoreMutation();
    const payload = mutation.payload as Record<string, unknown>;
    payload.nested = { [localOnlyKey]: true };
    const envelope = envelopeFromMutations([mutation]);
    assertEquals(envelope.validatedMutations, []);
    assertEquals(envelope.rejections[0].reason, "VALIDATION_FAILED");
  });
}

Deno.test("duplicate identities are pre-counted before validation and size with one valid sibling", () => {
  const first = validCoreMutation();
  const invalidDuplicate = {
    localProfileId: "profile-a",
    section: "CORE",
    documentVersion: 999,
    padding: "x".repeat(262_145),
  };
  const sibling = { ...validLedMutation(), localProfileId: "profile-b" };
  const envelope = envelopeFromMutations([first, invalidDuplicate, sibling]);
  assertEquals(envelope.rejections, [{
    localProfileId: "profile-a",
    section: "CORE",
    serverRevision: 0,
    reason: "DUPLICATE_SECTION",
  }]);
  assertEquals(envelope.validatedMutations.length, 1);
  assertEquals(envelope.validatedMutations[0].localProfileId, "profile-b");
  assertEquals(envelope.validatedMutations[0].section, "LED");
});

Deno.test("a locally invalid unique section does not suppress a valid unique sibling", () => {
  const invalid = validWorkoutMutation();
  invalid.localProfileId = "profile-invalid";
  const defaults = ((invalid.payload as Record<string, unknown>)
    .singleExerciseDefaults as Record<string, Record<string, unknown>>)[
      "exercise-a"
    ];
  defaults.defaultRackItemIds = ["\ud800"];
  const valid = { ...validVbtMutation(), localProfileId: "profile-valid" };
  const envelope = envelopeFromMutations([invalid, valid]);
  assertEquals(envelope.rejections, [{
    localProfileId: "profile-invalid",
    section: "WORKOUT",
    serverRevision: 0,
    reason: "VALIDATION_FAILED",
  }]);
  assertEquals(envelope.validatedMutations.length, 1);
  assertEquals(envelope.validatedMutations[0].localProfileId, "profile-valid");
});

Deno.test("raw/parsed element count mismatch is envelope-fatal", () => {
  const rawBody = JSON.stringify({
    ...validPushBody(),
    profilePreferenceSections: [validCoreMutation()],
  });
  const body = JSON.parse(rawBody) as Record<string, unknown>;
  assertThrows(
    () =>
      parsePreferenceEnvelope(body, {
        rawBody,
        preferenceElementSpans: [],
      }),
    PreferenceValidationError,
  );
});

Deno.test("raw/parsed element value mismatch is envelope-fatal", () => {
  const rawBody = JSON.stringify({
    ...validPushBody(),
    profilePreferenceSections: [validCoreMutation()],
  });
  const scan = scanTopLevelJsonObject(rawBody);
  const preferenceSpan = scan.valueSpans.get("profilePreferenceSections");
  assert(preferenceSpan);
  const spans = scanJsonArrayElementSpans(rawBody, preferenceSpan);
  const body = JSON.parse(rawBody) as Record<string, unknown>;
  const mutations = body.profilePreferenceSections as Record<string, unknown>[];
  mutations[0].baseRevision = 1;
  assertThrows(
    () =>
      parsePreferenceEnvelope(body, {
        rawBody,
        preferenceElementSpans: spans,
      }),
    PreferenceValidationError,
  );
});

Deno.test("legitimately encoded U+FFFD is accepted", async () => {
  const harness = makeHarness();
  const response = await harness.handler(
    requestFromBody({
      ...validPushBody(),
      profileName: "Replacement � scalar",
    }),
  );
  assertEquals(response.status, 200);
  assertEquals(harness.adminConstructionCount.value, 1);
});

function ordinaryBodyAt(targetBytes: number): Uint8Array {
  const marker = "__PADDING__";
  const template = JSON.stringify({ ...validPushBody(), profileName: marker });
  return encoder.encode(fillAsciiPadding(template, marker, targetBytes));
}

for (const targetBytes of [9_500_000, 9_500_001]) {
  Deno.test(`ordinary original-byte limit handles ${targetBytes} bytes`, async () => {
    const harness = makeHarness();
    const bytes = ordinaryBodyAt(targetBytes);
    assertEquals(bytes.byteLength, targetBytes);
    const response = await harness.handler(rawRequest(bytes));
    if (targetBytes === 9_500_000) {
      assertEquals(response.status, 200);
      assertEquals(harness.adminConstructionCount.value, 1);
    } else {
      assertEquals(response.status, 413);
      assertEquals(harness.adminConstructionCount.value, 0);
    }
  });
}

Deno.test("valid oversized Content-Length is rejected before reading the body", async () => {
  const harness = makeHarness();
  let pulls = 0;
  const response = await harness.handler(streamingRawRequest(
    [encoder.encode(JSON.stringify(validPushBody()))],
    {
      contentLength: "9500001",
      onPull: () => pulls += 1,
    },
  ));

  assertEquals(response.status, 413);
  assertEquals(await json(response), { error: "Request too large" });
  assertEquals(pulls, 0);
  assertNoPrivilegedActivity(harness);
});

for (
  const [label, contentLength] of [
    ["absent Content-Length", undefined],
    ["lying Content-Length", "1"],
  ] as const
) {
  Deno.test(`bounded body reader stops an oversized ${label} stream`, async () => {
    const harness = makeHarness();
    let pulls = 0;
    let canceled = false;
    const response = await harness.handler(streamingRawRequest(
      [
        new Uint8Array(4_750_000),
        new Uint8Array(4_750_001),
        new Uint8Array([0x7b]),
      ],
      {
        contentLength,
        onPull: () => pulls += 1,
        onCancel: () => canceled = true,
      },
    ));

    assertEquals(response.status, 413);
    assertEquals(await json(response), { error: "Request too large" });
    assertEquals(pulls, 2);
    assert(canceled);
    assertNoPrivilegedActivity(harness);
  });
}

Deno.test("body stream read failures are sanitized before privileged work", async () => {
  const harness = makeHarness();
  const response = await harness.handler(streamingRawRequest(
    [encoder.encode("{")],
    { failAfterChunks: 1 },
  ));

  assertEquals(response.status, 503);
  assertEquals(await json(response), { error: "Request unavailable" });
  assertEquals(harness.loggerCalls, [[{ name: "BodyStreamError" }]]);
  assertNoPrivilegedActivity(harness);
});

Deno.test("ordinary-only request above the preference cap retains legacy capacity", async () => {
  const harness = makeHarness();
  const bytes = ordinaryBodyAt(600_000);
  const response = await harness.handler(rawRequest(bytes));
  assertEquals(response.status, 200);
  assertEquals(harness.adminConstructionCount.value, 1);
});

Deno.test("syncTime uses the injected current time", async () => {
  const harness = makeHarness();
  const response = await harness.handler(requestFromBody(validPushBody()));

  assertEquals(response.status, 200);
  assertEquals((await json(response)).syncTime, "2026-07-16T02:00:00.000Z");
});

/** Records console.warn calls until restore() is called. */
function captureWarnings(): { calls: unknown[][]; restore: () => void } {
  const original = console.warn;
  const calls: unknown[][] = [];
  console.warn = (...args: unknown[]) => {
    calls.push(args);
  };
  return { calls, restore: () => { console.warn = original; } };
}

const STORED_DEFAULT_PROFILE = {
  id: "default",
  name: "Default",
  color_index: 0,
  device_id: "test-device",
};

function profilesOnlyBody(
  profiles: Array<{ id: string; name: string; colorIndex: number }>,
): Record<string, unknown> {
  return { ...validPushBody(), profileId: "default", allProfiles: profiles };
}

Deno.test("unchanged allProfiles push does not broadcast", async () => {
  const harness = makeHarness(undefined, {
    localProfilesResult: { data: [STORED_DEFAULT_PROFILE], error: null },
  });
  const response = await harness.handler(requestFromBody(
    profilesOnlyBody([{ id: "default", name: "Default", colorIndex: 0 }]),
  ));

  assertEquals(response.status, 200);
  assertEquals(harness.httpSendCalls, []);
});

for (
  const [label, profiles] of [
    ["renamed", [{ id: "default", name: "Renamed", colorIndex: 0 }]],
    ["recoloured", [{ id: "default", name: "Default", colorIndex: 3 }]],
    ["added", [
      { id: "default", name: "Default", colorIndex: 0 },
      { id: "00000000-0000-4000-8000-000000000040", name: "Partner", colorIndex: 1 },
    ]],
  ] as const
) {
  Deno.test(`allProfiles push with a ${label} profile broadcasts once`, async () => {
    const harness = makeHarness(undefined, {
      localProfilesResult: { data: [STORED_DEFAULT_PROFILE], error: null },
    });
    const response = await harness.handler(requestFromBody(
      profilesOnlyBody([...profiles]),
    ));

    assertEquals(response.status, 200);
    assertEquals(harness.httpSendCalls.length, 1);
  });
}

Deno.test("allProfiles push broadcasts when stored profiles cannot be read", async () => {
  const harness = makeHarness(undefined, {
    // Only the change-detection SELECT fails; the upsert must still land
    // (a failed upsert is a legitimate 503 — never write sessions
    // profile-unscoped). `localProfilesResult` is the terminal for every
    // `from("local_profiles")` chain, so it has to branch on the chain.
    localProfilesResult: (ops: QueryContext) =>
      (ops as QueryOperation[]).some((op) => op.name === "select")
        ? { data: null, error: { message: "timeout" } }
        : { data: null, error: null },
  });
  const warnings = captureWarnings();
  let response: Response;
  try {
    response = await harness.handler(requestFromBody(
      profilesOnlyBody([{ id: "default", name: "Default", colorIndex: 0 }]),
    ));
  } finally {
    warnings.restore();
  }

  assertEquals(response.status, 200);
  assertEquals(harness.httpSendCalls.length, 1);
});

Deno.test("profile change detection covers edits, additions and device removals", () => {
  const stored = [
    STORED_DEFAULT_PROFILE,
    { id: "other-device", name: "Other", color_index: 2, device_id: "phone-b" },
  ];
  const same = [{ ...STORED_DEFAULT_PROFILE }];
  assertEquals(localProfilesPushChangesRows(stored, same, "test-device"), false);
  assertEquals(
    localProfilesPushChangesRows(stored, [{ ...STORED_DEFAULT_PROFILE, name: "X" }], "test-device"),
    true,
  );
  assertEquals(
    localProfilesPushChangesRows(
      [...stored, { id: "gone", name: "Gone", color_index: 1, device_id: "test-device" }],
      same,
      "test-device",
    ),
    true,
  );
  assertEquals(
    localProfilesPushChangesRows(stored, [{ ...STORED_DEFAULT_PROFILE, device_id: "phone-c" }], "phone-c"),
    true,
  );
});

Deno.test("rejected-only preference push does not broadcast", async () => {
  const harness = makeHarness(undefined, {
    rpcBehavior: async (name, args) => {
      if (name !== "mutate_local_profile_preference_section") {
        return { data: [], error: null };
      }
      return {
        data: [{
          accepted: false,
          rejection_reason: "REVISION_CONFLICT",
          server_revision: 1,
          canonical_section: {
            localProfileId: args.p_local_profile_id,
            section: String(args.p_section),
            documentVersion: 1,
            serverRevision: 1,
            serverUpdatedAt: "2026-07-11T12:00:01.000Z",
            payload: args.p_payload,
          },
        }],
        error: null,
      };
    },
  });
  const response = await harness.handler(requestFromBody({
    ...validPushBody(),
    profilePreferenceSections: [validCoreMutation()],
  }));

  assertEquals(response.status, 200);
  assertEquals(((await json(response)).profilePreferenceRejections as unknown[]).length, 1);
  assertEquals(harness.httpSendCalls, []);
});

for (
  const [label, payloadKey, payload, rpcName, rejectionKey] of [
    [
      "RPG attributes",
      "rpgAttributes",
      {
        userId: VALID_USER_ID,
        strength: 1,
        power: 1,
        stamina: 1,
        consistency: 1,
        mastery: 1,
        characterClass: "WARRIOR",
        level: 1,
        experiencePoints: 10,
      },
      "upsert_rpg_attributes_lww",
      "rpgAttributes",
    ],
    [
      "gamification stats",
      "gamificationStats",
      {
        userId: VALID_USER_ID,
        totalWorkouts: 1,
        totalReps: 10,
        totalVolumeKg: 100,
        longestStreak: 1,
        currentStreak: 1,
        totalTimeSeconds: 60,
      },
      "upsert_gamification_stats_lww",
      "gamificationStats",
    ],
  ] as const
) {
  Deno.test(`rejected-only ${label} LWW push does not broadcast`, async () => {
    const harness = makeHarness(undefined, {
      syncLwwEnabled: true,
      rpcBehavior: async (name) => {
        if (name !== rpcName) return { data: [], error: null };
        return {
          data: [{
            id: VALID_USER_ID,
            accepted: false,
            server_updated_at: "2026-07-16T01:59:59.000Z",
          }],
          error: null,
        };
      },
    });
    const response = await harness.handler(requestFromBody({
      ...validPushBody(),
      [payloadKey]: payload,
    }));

    assertEquals(response.status, 200);
    const body = await json(response);
    assertEquals(
      body.rejections &&
        (body.rejections as Record<string, unknown>)[rejectionKey],
      [{
        id: VALID_USER_ID,
        serverUpdatedAt: "2026-07-16T01:59:59.000Z",
      }],
    );
    assertEquals(harness.httpSendCalls, []);
  });

  Deno.test(`accepted-only ${label} LWW push broadcasts once`, async () => {
    const harness = makeHarness(undefined, {
      syncLwwEnabled: true,
      rpcBehavior: async (name) => {
        if (name !== rpcName) return { data: [], error: null };
        return {
          data: [{
            id: VALID_USER_ID,
            accepted: true,
            server_updated_at: "2026-07-16T02:00:00.000Z",
          }],
          error: null,
        };
      },
    });
    const response = await harness.handler(requestFromBody({
      ...validPushBody(),
      [payloadKey]: payload,
    }));

    assertEquals(response.status, 200);
    assertEquals(harness.httpSendCalls.length, 1);
  });
}

/** Smallest push with a counted write (one badge upsert). */
function badgePushBody(): Record<string, unknown> {
  return {
    ...validPushBody(),
    badges: [{
      userId: VALID_USER_ID,
      badgeId: "first-workout",
      badgeName: "First Workout",
      earnedAt: "2026-07-11T12:00:00.000Z",
    }],
  };
}

// Was "broadcasts private sync_complete with { syncTime } only": the HTTP
// path is a superset of that assertion set (same private channel, same
// one-call count, and httpSendCalls' payload is exactly `{ syncTime }`), so
// the "only" property is covered here and the two titles collapsed.
Deno.test("broadcasts private sync_complete with { syncTime } once over HTTP", async () => {
  const harness = makeHarness();
  const response = await harness.handler(
    requestFromBody(badgePushBody()),
  );

  assertEquals(response.status, 200);
  const body = await json(response);
  assertEquals(body.badgesUpserted, 1);
  assertEquals(harness.channelCalls.length, 1);
  assertEquals(harness.channelCalls[0]?.topic, `sync:${VALID_USER_ID}`);
  assertEquals(harness.channelCalls[0]?.config?.private, true);
  assertEquals(harness.httpSendCalls, [{
    event: "sync_complete",
    payload: { syncTime: "2026-07-16T02:00:00.000Z" },
    timeout: 1500,
  }]);
  assertEquals(harness.broadcastPayloads, [{ syncTime: body.syncTime }]);
  assertEquals(harness.subscribeCalls.value, 0);
  assertEquals(harness.removeChannelCalls.value, 1);
  assertEquals(
    harness.operationEvents.filter((event) => event.startsWith("realtime:")),
    ["realtime:setAuth", "realtime:httpSend"],
  );
});

Deno.test("workout session push broadcasts once", async () => {
  const harness = makeHarness();
  // A plain workout: no PR flags and no profile, so only the session-graph
  // counters (sessions/exercises/sets) can trigger the broadcast.
  const session = makePrSession();
  const set = session.exercises[0].sets[0] as Record<string, unknown>;
  set.isPr = false;
  delete set.prType;
  delete set.prPhase;
  const response = await harness.handler(requestFromBody({
    ...validPushBody(),
    sessions: [session],
  }));

  assertEquals(response.status, 200);
  const body = await json(response);
  assertEquals(body.sessionsInserted, 1);
  assertEquals(body.personalRecordsInserted, 0);
  assertEquals(body.badgesUpserted, 0);
  assertEquals(harness.httpSendCalls.length, 1);
  assertEquals(harness.subscribeCalls.value, 0);
});

Deno.test({
  name: "real client httpSend carries a Bearer token on the private topic",
  // removeChannel/disconnect leave realtime-js-owned timers (deferred
  // disconnect, 10 s disconnect timeout) pending; they are harmless here.
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
  const requests: Array<{ url: string; headers: Headers; body: string }> = [];
  const client = createClient("http://supabase.test", "service-role-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: async (input: string | URL | Request, init?: RequestInit) => {
        const request = new Request(input, init);
        requests.push({
          url: request.url,
          headers: request.headers,
          body: await request.text(),
        });
        return new Response(null, { status: 202 });
      },
    },
  });
  const warnings = captureWarnings();
  try {
    await broadcastSyncComplete(client, VALID_USER_ID, "2026-07-16T02:00:00.000Z");
  } finally {
    warnings.restore();
  }

  assertEquals(warnings.calls, []);
  assertEquals(requests.length, 1);
  const [request] = requests;
  const url = new URL(request.url);
  assertEquals(
    url.pathname,
    `/realtime/v1/api/broadcast/${encodeURIComponent(`sync:${VALID_USER_ID}`)}/events/sync_complete`,
  );
  assertEquals(url.searchParams.get("private"), "true");
  assertEquals(request.headers.get("Authorization"), "Bearer service-role-key");
  assertEquals(request.headers.get("apikey"), "service-role-key");
  assertEquals(JSON.parse(request.body), { syncTime: "2026-07-16T02:00:00.000Z" });
  },
});

Deno.test("empty push writes nothing and does not broadcast", async () => {
  const harness = makeHarness();
  const response = await harness.handler(requestFromBody(validPushBody()));

  assertEquals(response.status, 200);
  assertEquals((await json(response)).syncTime, "2026-07-16T02:00:00.000Z");
  assertEquals(harness.channelCalls, []);
  assertEquals(harness.httpSendCalls, []);
  assertEquals(harness.subscribeCalls.value, 0);
});

for (
  const [label, body] of [
    ["routine tombstone", { deletedRoutineIds: [ROUTINE_ID] }],
    // Clocked: a winning delete of an id the server no longer holds records
    // the tombstone and is acknowledged, so portal data changed and the
    // broadcast fires. A legacy `deletedCycleIds` absent-id is a silent
    // no-op and would not broadcast.
    ["cycle tombstone", {
      deletedCycles: [{ id: CYCLE_ID, updatedAt: "2026-09-20T13:00:00.000Z" }],
    }],
    ["rpg attributes", {
      rpgAttributes: {
        userId: VALID_USER_ID,
        strength: 1,
        power: 1,
        stamina: 1,
        consistency: 1,
        mastery: 1,
        characterClass: "WARRIOR",
        level: 1,
        experiencePoints: 10,
      },
    }],
    ["gamification stats", {
      gamificationStats: {
        userId: VALID_USER_ID,
        totalWorkouts: 1,
        totalReps: 10,
        totalVolumeKg: 100,
        longestStreak: 1,
        currentStreak: 1,
        totalTimeSeconds: 60,
      },
    }],
    ["ownership transfer", {
      ownershipTransfers: [{
        mutationId: "40000000-0000-4000-8000-0000000000c1",
        sourceProfileId: null,
        targetProfileId: "default",
        workoutSessionIds: [SESSION_ID],
        routineIds: [],
        cycleIds: [],
        personalRecordIds: [],
      }],
    }],
    ["workout deletion", {
      workoutDeletions: [{
        mutationId: "40000000-0000-4000-8000-0000000000c2",
        scope: "WORKOUT",
        portalSessionId: SESSION_ID,
        componentSessionId: null,
        deletedAt: "2026-09-20T12:00:00.000Z",
      }],
    }],
  ] as const
) {
  Deno.test(`uncounted ${label} write still broadcasts once`, async () => {
    const harness = makeHarness();
    const response = await harness.handler(
      requestFromBody({ ...validPushBody(), ...body }),
    );

    assertEquals(response.status, 200);
    assertEquals(harness.httpSendCalls.length, 1);
    assertEquals(harness.subscribeCalls.value, 0);
  });
}

Deno.test("accepted preference-only push broadcasts once", async () => {
  const harness = makeHarness();
  const response = await harness.handler(requestFromBody({
    ...validPushBody(),
    profilePreferenceSections: [validCoreMutation()],
  }));

  assertEquals(response.status, 200);
  assertEquals(harness.httpSendCalls.length, 1);
});

for (
  const [label, behavior] of [
    ["rejected", async () => ({ success: false, status: 500, error: "down" })],
    ["thrown", async () => {
      throw new Error("realtime unavailable");
    }],
  ] as const
) {
  Deno.test(`${label} HTTP broadcast is logged and the push still succeeds`, async () => {
    const harness = makeHarness(undefined, { httpSendBehavior: behavior });
    const warnings = captureWarnings();
    let response: Response;
    try {
      response = await harness.handler(requestFromBody(badgePushBody()));
    } finally {
      warnings.restore();
    }

    const broadcastWarnings = warnings.calls.filter((args) =>
      String(args[0]).startsWith("mobile-sync-push broadcast")
    );
    assertEquals(broadcastWarnings.length, 1);
    const logged = broadcastWarnings[0].map(String).join(" ");
    if (label === "rejected") {
      assertEquals(broadcastWarnings[0], ["mobile-sync-push broadcast rejected:", 500]);
    } else {
      assertEquals(broadcastWarnings[0], ["mobile-sync-push broadcast failed:", "Error"]);
    }
    assert(!logged.includes("realtime unavailable"));
    assert(!logged.includes("down"));
    assertEquals(response.status, 200);
    assertEquals((await json(response)).badgesUpserted, 1);
    assertEquals(harness.httpSendCalls.length, 1);
    assertEquals(harness.removeChannelCalls.value, 1);
    assertEquals(harness.loggerCalls, []);
  });
}

Deno.test("channel construction failure is logged and the push still succeeds", async () => {
  const harness = makeHarness(undefined, {
    channelError: new Error("realtime client unavailable"),
  });
  const warnings = captureWarnings();
  let response: Response;
  try {
    response = await harness.handler(requestFromBody(badgePushBody()));
  } finally {
    warnings.restore();
  }

  assertEquals(
    warnings.calls.filter((args) =>
      String(args[0]).startsWith("mobile-sync-push broadcast")
    ),
    [["mobile-sync-push broadcast failed:", "Error"]],
  );
  assertEquals(response.status, 200);
  assertEquals(harness.httpSendCalls, []);
  assertEquals(harness.loggerCalls, []);
});

Deno.test("complete validation precedes every privileged construction and call", async () => {
  const harness = makeHarness();
  const body = {
    ...validPushBody(),
    profilePreferenceSections: [
      validCoreMutation(),
      { ...validLedMutation(), localProfileId: "profile-b", extra: true },
    ],
    customExercises: [{
      clientId: "custom-final",
      name: "   ",
      muscleGroup: "General",
      defaultCableConfig: "DOUBLE",
    }],
  };
  const response = await harness.handler(requestFromBody(body));
  assertEquals(response.status, 400);
  assertEquals(harness.adminConstructionCount.value, 0);
  assertEquals(harness.adminRpcCalls, []);
});

Deno.test("unexpected privileged failure returns generic 500 and logs only a safe name", async () => {
  const harness = makeHarness(
    undefined,
    {
      fromError: Object.assign(new Error("database secret"), {
        name: "NetworkError",
      }),
    },
  );
  const response = await harness.handler(requestFromBody(validPushBody()));
  assertEquals(response.status, 500);
  assertEquals(await json(response), { error: "Internal server error" });
  assertEquals(harness.loggerCalls, [[{ name: "NetworkError" }]]);
});

Deno.test("RPC parser accepts exactly the next revision with semantically equal reordered payload", () => {
  const rawMutation = clone(validCoreMutation());
  rawMutation.baseRevision = 41;
  const mutation = parsePreferenceMutation(
    rawMutation,
  ) as PortalProfilePreferenceSectionMutation;
  const result = acceptedRpcResult({
    p_local_profile_id: mutation.localProfileId,
    p_section: mutation.section,
    p_payload: mutation.payload,
  }, {
    server_revision: "42",
    canonical_section: {
      payload: {
        weightIncrement: 1,
        bodyWeightKg: 80,
        weightUnit: "KG",
      },
    },
  });

  assertEquals(parseRpcMutationRow(result.data, mutation), {
    accepted: true,
    rejectionReason: null,
    serverRevision: 42,
    canonicalSection: {
      localProfileId: "profile-a",
      section: "CORE",
      documentVersion: 1,
      serverRevision: 42,
      serverUpdatedAt: "2026-07-11T12:00:01.000Z",
      payload: {
        weightIncrement: 1,
        bodyWeightKg: 80,
        weightUnit: "KG",
      },
    },
  });
});

Deno.test("RPC parser rejects an accepted revision when base plus one is unsafe", () => {
  const rawMutation = clone(validCoreMutation());
  rawMutation.baseRevision = Number.MAX_SAFE_INTEGER;
  const mutation = parsePreferenceMutation(
    rawMutation,
  ) as PortalProfilePreferenceSectionMutation;
  const result = acceptedRpcResult({
    p_local_profile_id: mutation.localProfileId,
    p_section: mutation.section,
    p_payload: mutation.payload,
  }, { server_revision: Number.MAX_SAFE_INTEGER });

  assertThrows(
    () => parseRpcMutationRow(result.data, mutation),
    PreferenceInfrastructureError,
  );
});

Deno.test("RPC parser preserves array order in accepted payload equality", () => {
  const rawMutation = clone(validRackMutation());
  const items = (rawMutation.payload as Record<string, unknown>).items as Array<
    Record<string, unknown>
  >;
  items.push({ ...items[0], id: "rack-b", sortOrder: 1 });
  const mutation = parsePreferenceMutation(
    rawMutation,
  ) as PortalProfilePreferenceSectionMutation;
  const reversedPayload = clone(mutation.payload);
  (reversedPayload.items as unknown[]).reverse();
  const result = acceptedRpcResult({
    p_local_profile_id: mutation.localProfileId,
    p_section: mutation.section,
    p_payload: mutation.payload,
  }, { canonical_section: { payload: reversedPayload } });

  assertThrows(
    () => parseRpcMutationRow(result.data, mutation),
    PreferenceInfrastructureError,
  );
});

Deno.test("RPC parser accepts both revision-zero conflict forms", () => {
  const rawMutation = clone(validRackMutation());
  rawMutation.baseRevision = 1;
  const mutation = parsePreferenceMutation(
    rawMutation,
  ) as PortalProfilePreferenceSectionMutation;
  const nullCanonical = [{
    accepted: false,
    rejection_reason: "REVISION_CONFLICT",
    server_revision: 0,
    canonical_section: null,
  }];
  assertEquals(parseRpcMutationRow(nullCanonical, mutation), {
    accepted: false,
    rejectionReason: "REVISION_CONFLICT",
    serverRevision: 0,
    canonicalSection: undefined,
  });

  const defaultCanonical = [{
    accepted: false,
    rejection_reason: "REVISION_CONFLICT",
    server_revision: 0,
    canonical_section: {
      localProfileId: mutation.localProfileId,
      section: mutation.section,
      documentVersion: 1,
      serverRevision: 0,
      serverUpdatedAt: "2026-07-11T12:00:01Z",
      payload: { version: 1, items: [] },
    },
  }];
  assertEquals(
    parseRpcMutationRow(defaultCanonical, mutation).canonicalSection,
    {
      localProfileId: "profile-a",
      section: "RACK",
      documentVersion: 1,
      serverRevision: 0,
      serverUpdatedAt: "2026-07-11T12:00:01.000Z",
      payload: { version: 1, items: [] },
    },
  );
});

for (
  const reason of [
    "VALIDATION_FAILED",
    "UNSUPPORTED_SECTION",
    "UNSUPPORTED_DOCUMENT_VERSION",
    "UNKNOWN_PROFILE",
  ]
) {
  Deno.test(`RPC parser accepts strict zero/null ${reason} domain rejection`, () => {
    const mutation = parsePreferenceMutation(
      validCoreMutation(),
    ) as PortalProfilePreferenceSectionMutation;
    assertEquals(
      parseRpcMutationRow([{
        accepted: false,
        rejection_reason: reason,
        server_revision: 0,
        canonical_section: null,
      }], mutation),
      {
        accepted: false,
        rejectionReason: reason,
        serverRevision: 0,
        canonicalSection: undefined,
      },
    );
  });
}

Deno.test("legacy push response keeps ordinary fields and adds empty preference arrays", async () => {
  const harness = makeHarness();
  const response = await harness.handler(requestFromBody(validPushBody()));
  const body = await json(response);

  assertEquals(response.status, 200);
  assertEquals(body.syncTime, "2026-07-16T02:00:00.000Z");
  assertEquals(body.sessionsInserted, 0);
  assertEquals(body.rejections, {
    sessions: [],
    routines: [],
    cycles: [],
    externalActivities: [],
    rpgAttributes: [],
    gamificationStats: [],
  });
  assertEquals(body.canonicalProfilePreferenceSections, []);
  assertEquals(body.profilePreferenceRejections, []);
  assert(!Object.hasOwn(body, "profilePreferencesAccepted"));
  assertEquals(
    harness.adminRpcCalls.filter((call) =>
      call.name === "mutate_local_profile_preference_section"
    ),
    [],
  );
});

// PR 22 (F-024): required sub-step failures fail the push with a retryable
// 503 instead of a 200 that lets mobile advance lastSync and drop the work.
const PARTIAL_WRITE_BODY = {
  error: "Sync temporarily unavailable",
  code: "partial_write_retry",
};
const INJECTED_DB_ERROR = { message: "injected database failure", code: "XX000" };

async function assertPartialWriteRetry(
  harness: PushHarness,
  response: Response,
): Promise<void> {
  assertEquals(response.status, 503);
  assertEquals(await json(response), PARTIAL_WRITE_BODY);
  assertEquals(harness.channelCalls, []);
  assertEquals(harness.broadcastPayloads, []);
  assertEquals(harness.loggerCalls, [[{ name: "PartialWriteRetry" }]]);
}

Deno.test("routine delete failure returns retryable 503 and no sync_complete", async () => {
  const harness = makeHarness(undefined, {
    writeErrors: { "routines:delete": INJECTED_DB_ERROR },
  });
  const response = await harness.handler(requestFromBody({
    ...validPushBody(),
    deletedRoutineIds: [ROUTINE_ID],
  }));
  await assertPartialWriteRetry(harness, response);
});

Deno.test("cycle delete failure returns retryable 503 and no sync_complete", async () => {
  const harness = makeHarness(undefined, {
    writeErrors: { "training_cycles:delete": INJECTED_DB_ERROR },
    tableResults: {
      training_cycles: {
        data: [{ id: CYCLE_ID, client_updated_at: "2026-09-20T12:00:00.000Z" }],
        error: null,
      },
    },
  });
  // Clocked delete of a present row with a stale LWW key: it wins and takes
  // the hard-delete path, which is where the injected failure lands.
  const response = await harness.handler(requestFromBody({
    ...validPushBody(),
    deletedCycles: [{ id: CYCLE_ID, updatedAt: "2026-09-20T13:00:00.000Z" }],
  }));
  await assertPartialWriteRetry(harness, response);
});

Deno.test("session children replace failure returns a retryable 503 partial write", async () => {
  // The parent `workout_sessions` rows are already committed when
  // `replace_session_children` runs, so a failure there IS a cross-step
  // partial write. A bare 500 would let mobile advance `lastSync` and drop
  // the children for good — it must be a retryable 503.
  const harness = makeHarness(undefined, {
    rpcBehavior: async (name) => {
      if (name === "replace_session_children") {
        return { data: null, error: INJECTED_DB_ERROR };
      }
      return undefined;
    },
  });
  const response = await harness.handler(
    requestFromBody(validNestedRelationshipBody()),
  );
  await assertPartialWriteRetry(harness, response);
});

Deno.test("routine exercise orphan cleanup failure returns retryable 503", async () => {
  // Design K cleans orphans with a direct `routine_exercises` delete (index.ts
  // "Remove orphan exercises"), not the retired `cleanup_routine_exercise_orphans`
  // RPC, so the injectable failure is the delete.
  const harness = makeHarness(undefined, {
    writeErrors: { "routine_exercises:delete": INJECTED_DB_ERROR },
  });
  const response = await harness.handler(
    requestFromBody(validNestedRelationshipBody()),
  );
  await assertPartialWriteRetry(harness, response);
});

Deno.test("allProfiles upsert failure returns 503 before any session write", async () => {
  const harness = makeHarness(undefined, {
    writeErrors: { "local_profiles:upsert": INJECTED_DB_ERROR },
  });
  const response = await harness.handler(
    requestFromBody(validNestedRelationshipBody()),
  );
  await assertPartialWriteRetry(harness, response);
  assertEquals(
    harness.adminWriteCalls.filter((call) => call.table !== "local_profiles"),
    [],
  );
});

Deno.test("single-profile upsert failure returns 503 before any session write", async () => {
  const body = validNestedRelationshipBody();
  delete body.allProfiles;
  const harness = makeHarness(undefined, {
    writeErrors: { "local_profiles:upsert": INJECTED_DB_ERROR },
  });
  const response = await harness.handler(requestFromBody(body));
  await assertPartialWriteRetry(harness, response);
  assertEquals(
    harness.adminWriteCalls.filter((call) => call.table !== "local_profiles"),
    [],
  );
});

const CATALOG_EXERCISE_ID = "00000000-0000-4000-8000-000000000050";
const ASSESSMENT_ID = "00000000-0000-4000-8000-000000000051";

function assessmentBody(): Record<string, unknown> {
  return {
    ...validPushBody(),
    assessments: [{
      id: ASSESSMENT_ID,
      exerciseId: CATALOG_EXERCISE_ID,
      estimatedOneRepMaxKg: 100,
      loadVelocityData: "[]",
      createdAt: "2026-07-11T12:00:00.000Z",
    }],
  };
}

const CATALOG_RESULT = {
  data: [{
    id: CATALOG_EXERCISE_ID,
    name: "Bench Press",
    is_custom: false,
    archived: false,
  }],
  error: null,
};

// Was "VBT insert failure…": e0570a79 made the VBT push an idempotent upsert,
// so the write-method-specific failure case is the upsert one.
Deno.test("VBT upsert failure keeps 200 and reports failed.assessments", async () => {
  const harness = makeHarness(undefined, {
    tableResults: { exercise_catalog: CATALOG_RESULT },
    writeErrors: { "vbt_assessments:upsert": INJECTED_DB_ERROR },
  });
  const response = await harness.handler(requestFromBody(assessmentBody()));
  const body = await json(response);

  assertEquals(response.status, 200, JSON.stringify(body));
  assertEquals(body.assessmentsInserted, 0);
  assertEquals(body.failed, {
    phaseStatistics: [],
    exerciseSignatures: [],
    assessments: [ASSESSMENT_ID],
    externalActivities: [],
  });
  assertEquals(harness.broadcastPayloads.length, 1);
});

Deno.test("successful push reports an empty failed map", async () => {
  const harness = makeHarness(undefined, {
    tableResults: {
      exercise_catalog: CATALOG_RESULT,
      // What `.upsert(...).select('id')` returns: the rows actually inserted.
      vbt_assessments: { data: [{ id: "inserted-row" }], error: null },
    },
  });
  const response = await harness.handler(requestFromBody(assessmentBody()));
  const body = await json(response);

  assertEquals(response.status, 200, JSON.stringify(body));
  assertEquals(body.assessmentsInserted, 1);
  assertEquals(body.failed, {
    phaseStatistics: [],
    exerciseSignatures: [],
    assessments: [],
    externalActivities: [],
  });
  // The client id used for failure reporting must never reach PostgREST.
  const upserts = writeQueries(harness, "vbt_assessments", "upsert");
  assertEquals(upserts.length, 1);
  const rows = callArgs(upserts[0]!, "upsert")[0] as Array<
    Record<string, unknown>
  >;
  assertEquals(rows.length, 1);
  assert(!Object.hasOwn(rows[0]!, "clientId"));
  assertEquals(rows[0]!.exercise_id, CATALOG_EXERCISE_ID);
  assertEquals(rows[0]!.estimated_1rm_kg, 100);
  assertEquals(rows[0]!.user_id, VALID_USER_ID);
});

/**
 * In-memory stand-in for vbt_assessments with the PR 23 unique index
 * semantics: rows are keyed by (user_id, exercise_id, timestamptz VALUE of
 * created_at), so "...Z" and "...+00:00" forms of one instant collide.
 * - select: returns the stored rows (the pre-fix handler's existence re-page).
 * - insert: appends blindly (the pre-fix handler relied on its own string
 *   dedupe, so this lets a pre-fix duplicate show up in `rows`).
 * - upsert: only ON CONFLICT (user_id,exercise_id,created_at) DO NOTHING is
 *   modelled; any other options return an error. Same-key rows inside one
 *   batch are skipped like Postgres does. With `.select()` it returns only
 *   the inserted rows, as PostgREST does.
 */
function fakeVbtAssessmentsTable(stored: Array<Record<string, unknown>>) {
  const rows = stored.map((row) => ({ ...row }));
  const key = (row: Record<string, unknown>) =>
    `${row.user_id}|${row.exercise_id}|${Date.parse(String(row.created_at))}`;
  const client = {
    from(_table: string) {
      let op: "select" | "insert" | "upsert" = "select";
      let values: Array<Record<string, unknown>> = [];
      let options: Record<string, unknown> | undefined;
      let returning = false;
      const run = () => {
        if (op === "select") {
          return { data: rows.map((row) => ({ ...row })), error: null };
        }
        if (op === "insert") {
          rows.push(...values.map((value) => ({ id: crypto.randomUUID(), ...value })));
          return { data: null, error: null };
        }
        if (
          options?.onConflict !== "user_id,exercise_id,created_at" ||
          options?.ignoreDuplicates !== true
        ) {
          return {
            data: null,
            error: { message: "fake models only DO NOTHING on vbt_assessments_identity" },
          };
        }
        const seen = new Set(rows.map(key));
        const inserted: Array<Record<string, unknown>> = [];
        for (const value of values) {
          if (seen.has(key(value))) continue;
          seen.add(key(value));
          const row = { id: crypto.randomUUID(), ...value };
          rows.push(row);
          inserted.push(row);
        }
        return {
          data: returning ? inserted.map((row) => ({ id: row.id })) : null,
          error: null,
        };
      };
      const query: Record<string, unknown> = {};
      for (const method of ["eq", "in", "order", "range", "limit", "gt", "neq", "is"]) {
        query[method] = () => query;
      }
      query.select = () => {
        if (op !== "select") returning = true;
        return query;
      };
      query.insert = (next: Array<Record<string, unknown>>) => {
        op = "insert";
        values = next;
        return query;
      };
      query.upsert = (
        next: Array<Record<string, unknown>>,
        nextOptions?: Record<string, unknown>,
      ) => {
        op = "upsert";
        values = next;
        options = nextOptions;
        return query;
      };
      query.then = (
        resolve: (value: unknown) => unknown,
        reject?: (reason: unknown) => unknown,
      ) => Promise.resolve(run()).then(resolve, reject);
      return query;
    },
  };
  return { rows, client };
}

Deno.test("VBT push of a Z timestamp against a stored +00:00 row writes no duplicate", async () => {
  // The stored row reads back from PostgREST as "+00:00"; mobile sends the
  // same instant as "Z". The pre-fix handler re-paged this table and
  // compared strings, missed the match and inserted a copy on every push:
  // the stored row below is what that old select-then-insert path read, and
  // it is why this test fails against the pre-fix handler. The fixed handler
  // never reads it; it hands the row to ON CONFLICT DO NOTHING, which the
  // fake models on the timestamptz value. The real-SQL test below proves the
  // same against Postgres.
  const table = fakeVbtAssessmentsTable([{
    id: "stored-row",
    user_id: VALID_USER_ID,
    exercise_id: CATALOG_EXERCISE_ID,
    estimated_1rm_kg: 100,
    created_at: "2026-07-11T12:00:00+00:00",
  }]);
  for (let attempt = 1; attempt <= 2; attempt++) {
    const harness = makeHarness(undefined, {
      tableResults: { exercise_catalog: CATALOG_RESULT },
      tableClients: { vbt_assessments: table.client },
    });
    const response = await harness.handler(requestFromBody(assessmentBody()));
    const body = await json(response);

    assertEquals(response.status, 200, JSON.stringify(body));
    assertEquals((body.failed as Record<string, unknown>).assessments, []);
    assertEquals(body.assessmentsInserted, 0, `push ${attempt}`);
    assertEquals(table.rows.length, 1, `push ${attempt}`);
    assertEquals(table.rows[0]!.id, "stored-row");
  }
});

Deno.test("VBT push with two same-instant rows in one payload stores one row", async () => {
  // "...Z" and "...+00:00" of one instant pass the string-keyed payload
  // duplicate check but hit one conflict key. DO NOTHING keeps the first;
  // DO UPDATE would have failed the whole statement.
  const table = fakeVbtAssessmentsTable([]);
  const base = assessmentBody();
  const [first] = base.assessments as Array<Record<string, unknown>>;
  const body = {
    ...base,
    assessments: [
      first,
      {
        ...first,
        id: "00000000-0000-4000-8000-000000000053",
        createdAt: "2026-07-11T12:00:00+00:00",
      },
    ],
  };
  const harness = makeHarness(undefined, {
    tableResults: { exercise_catalog: CATALOG_RESULT },
    tableClients: { vbt_assessments: table.client },
  });
  const response = await harness.handler(requestFromBody(body));
  const responseBody = await json(response);

  assertEquals(response.status, 200, JSON.stringify(responseBody));
  assertEquals((responseBody.failed as Record<string, unknown>).assessments, []);
  assertEquals(responseBody.assessmentsInserted, 1);
  assertEquals(table.rows.length, 1);
  assert(!Object.hasOwn(table.rows[0]!, "clientId"));
  assertEquals(table.rows[0]!.user_id, VALID_USER_ID);
});

function manyIds(prefix: string, count: number): string[] {
  return Array.from(
    { length: count },
    (_, i) => `00000000-0000-4000-${prefix}-${i.toString().padStart(12, "0")}`,
  );
}

Deno.test("routine and clocked cycle deletes are chunked at 100 ids", async () => {
  const routineIds = manyIds("8a00", 250);
  const cycleIds = manyIds("8b00", 201);
  const harness = makeHarness(undefined, {
    // Every probed cycle is present with a stale LWW key, so each clocked
    // delete wins and takes the hard-delete path.
    tableResults: {
      training_cycles: {
        data: cycleIds.map((id) => ({
          id,
          client_updated_at: "2026-09-20T12:00:00.000Z",
        })),
        error: null,
      },
    },
  });
  const response = await harness.handler(requestFromBody({
    ...validPushBody(),
    deletedRoutineIds: routineIds,
    deletedCycles: cycleIds.map((id) => ({
      id,
      updatedAt: "2026-09-20T13:00:00.000Z",
    })),
  }));

  assertEquals(response.status, 200);
  assertEquals((await json(response)).acknowledgedDeletedCycleIds, cycleIds);
  const cases: Array<[string, string[], number[]]> = [
    ["routines", routineIds, [100, 100, 50]],
    ["training_cycles", cycleIds, [100, 100, 1]],
  ];
  for (const [table, ids, sizes] of cases) {
    const deletes = writeQueries(harness, table, "delete");
    const chunks = deletes.map((query) => callArgs(query, "in")[1] as string[]);
    assertEquals(chunks.map((chunk) => chunk.length), sizes);
    assertEquals(chunks.flat(), ids);
    for (const query of deletes) {
      assertEquals(callArgs(query, "eq"), ["user_id", VALID_USER_ID]);
    }
  }
  assertEquals(harness.broadcastPayloads.length, 1);
});

Deno.test("clocked deletes of already-absent cycles chunk the tombstone upsert at 100 ids", async () => {
  const cycleIds = manyIds("8b00", 201);
  const harness = makeHarness();
  const response = await harness.handler(requestFromBody({
    ...validPushBody(),
    deletedCycles: cycleIds.map((id) => ({
      id,
      updatedAt: "2026-09-20T13:00:00.000Z",
    })),
  }));
  const body = await json(response);

  assertEquals(response.status, 200, JSON.stringify(body));
  assertEquals(body.acknowledgedDeletedCycleIds, cycleIds);
  // No server row to hard-delete; the tombstone is what stops the next stale
  // upload from recreating the cycle.
  assertEquals(writeQueries(harness, "training_cycles", "delete"), []);
  const upserts = writeQueries(harness, "sync_tombstones", "upsert");
  const chunks = upserts.map((query) =>
    callArgs(query, "upsert")[0] as Array<{ entity_id: string }>
  );
  assertEquals(chunks.map((chunk) => chunk.length), [100, 100, 1]);
  assertEquals(chunks.flat().map((row) => row.entity_id), cycleIds);
  for (const query of upserts) {
    assertEquals(
      callArgs(query, "upsert")[1],
      { onConflict: "user_id,entity,entity_id" },
    );
  }
});

Deno.test("a failed tombstone delete chunk stops at that chunk with a retryable 503", async () => {
  const harness = makeHarness(undefined, {
    writeErrors: { "routines:delete": INJECTED_DB_ERROR },
  });
  const response = await harness.handler(requestFromBody({
    ...validPushBody(),
    deletedRoutineIds: manyIds("8a00", 250),
  }));
  await assertPartialWriteRetry(harness, response);
  assertEquals(writeQueries(harness, "routines", "delete").length, 1);
});

// Was the `cleanup_routine_exercise_orphans` RPC-args assertion (a25a5d87 /
// PR #137). 78120b43 / PR #167 replaced that RPC with a direct delete, and the
// empty-exercise routine takes the delete-all branch (no `not in` filter).
Deno.test("orphan cleanup failure for a routine with no exercises returns retryable 503", async () => {
  const body = validNestedRelationshipBody();
  const routines = body.routines as Array<Record<string, unknown>>;
  routines[0] = { ...routines[0], exerciseCount: 0, exercises: [] };
  const harness = makeHarness(undefined, {
    writeErrors: { "routine_exercises:delete": INJECTED_DB_ERROR },
  });
  const response = await harness.handler(requestFromBody(body));
  await assertPartialWriteRetry(harness, response);
  const deletes = writeQueries(harness, "routine_exercises", "delete");
  assertEquals(deletes.length, 1);
  // The delete-all branch: no `not in` filter.
  assert(!deletes[0]!.calls.some((call) => call.method === "not"));
  assertEquals(callArgs(deletes[0]!, "eq"), ["routine_id", ROUTINE_ID]);
});

// Was "…in the RPC body" asserting `cleanup_routine_exercise_orphans`
// `p_keep_ids`. Design K carries the same keep-set in the delete's `not in`
// filter, so the property under test (a 500-id keep set is not lost) is the
// filter's contents.
Deno.test("orphan cleanup keeps hundreds of exercise ids in the delete filter", async () => {
  const body = validNestedRelationshipBody();
  const routines = body.routines as Array<Record<string, unknown>>;
  const routine = routines[0]!;
  const template = (routine.exercises as Array<Record<string, unknown>>)[0]!;
  const exerciseIds = manyIds("8b00", 500);
  routine.exerciseCount = exerciseIds.length;
  routine.exercises = exerciseIds.map((id) => ({ ...template, id }));

  const harness = makeHarness();
  const response = await harness.handler(requestFromBody(body));
  const responseBody = await json(response);
  assertEquals(response.status, 200, JSON.stringify(responseBody));

  const deletes = writeQueries(harness, "routine_exercises", "delete");
  assertEquals(deletes.length, 1);
  const notArgs = callArgs(deletes[0]!, "not");
  assertEquals(notArgs[0], "id");
  assertEquals(notArgs[1], "in");
  const listed = String(notArgs[2]).replace(/^\(|\)$/g, "").split(",");
  assertEquals(listed, exerciseIds);
});

Deno.test("routine_exercises upsert failure returns the same retryable 503", async () => {
  const harness = makeHarness(undefined, {
    writeErrors: { "routine_exercises:upsert": INJECTED_DB_ERROR },
  });
  const response = await harness.handler(
    requestFromBody(validNestedRelationshipBody()),
  );
  await assertPartialWriteRetry(harness, response);
});

Deno.test("retrying the identical payload after a 503 succeeds and replays the same writes", async () => {
  const deletedRoutineId = "00000000-0000-4000-8000-000000000060";
  const writeErrors: Record<string, unknown> = {
    "routines:delete": INJECTED_DB_ERROR,
  };
  const harness = makeHarness(undefined, { writeErrors });
  const body = {
    ...validNestedRelationshipBody(),
    deletedRoutineIds: [deletedRoutineId],
  };

  const first = await harness.handler(requestFromBody(body));
  assertEquals(first.status, 503);
  assertEquals(harness.broadcastPayloads, []);
  const firstWrites = [...harness.adminWriteCalls];
  const firstRpcCallCount = harness.adminRpcCalls.length;

  delete writeErrors["routines:delete"];
  const second = await harness.handler(requestFromBody(body));
  const secondBody = await json(second);
  assertEquals(second.status, 200, JSON.stringify(secondBody));
  assertEquals(harness.broadcastPayloads.length, 1);

  // The retry re-runs exactly the same writes up to and including the delete
  // (upserts by id; deleting an already-absent row is a no-op), then goes on
  // to the steps the first attempt never reached.
  const secondWrites = harness.adminWriteCalls.slice(firstWrites.length);
  assertEquals(secondWrites.slice(0, firstWrites.length), firstWrites);
  // Cycles go through merge_training_cycles_from_push (Design K / 78120b43),
  // not a direct training_cycles upsert.
  assert(
    harness.adminRpcCalls.slice(firstRpcCallCount).some((call) =>
      call.name === "merge_training_cycles_from_push"
    ),
  );
  // Session-graph writes are id-keyed upserts, never blind inserts.
  assertEquals(
    secondWrites.filter((call) =>
      call.method === "insert" &&
      ["workout_sessions", "exercises", "sets", "rep_summaries"].includes(
        call.table,
      )
    ),
    [],
  );
});

const PHASE_STATS_ID = "00000000-0000-4000-8000-000000000070";

Deno.test("phase statistics upsert failure keeps 200 and reports failed.phaseStatistics", async () => {
  const harness = makeHarness(undefined, {
    writeErrors: { "session_phase_statistics:upsert": INJECTED_DB_ERROR },
  });
  const response = await harness.handler(requestFromBody({
    ...validNestedRelationshipBody(),
    phaseStatistics: [{ id: PHASE_STATS_ID, sessionId: SESSION_ID }],
  }));
  const body = await json(response);

  assertEquals(response.status, 200, JSON.stringify(body));
  assertEquals(body.phaseStatisticsInserted, 0);
  assertEquals(body.failed, {
    phaseStatistics: [PHASE_STATS_ID],
    exerciseSignatures: [],
    assessments: [],
    externalActivities: [],
  });
  assertEquals(harness.broadcastPayloads.length, 1);
});

const SIGNATURE_ID = "00000000-0000-4000-8000-000000000071";
const UNRESOLVED_SIGNATURE_ID = "00000000-0000-4000-8000-000000000072";

Deno.test("signature upsert failure reports only attempted signature ids", async () => {
  const harness = makeHarness(undefined, {
    tableResults: { exercise_catalog: CATALOG_RESULT },
    writeErrors: { "exercise_signatures:upsert": INJECTED_DB_ERROR },
  });
  const response = await harness.handler(requestFromBody({
    ...validPushBody(),
    exerciseSignatures: [
      { id: SIGNATURE_ID, exerciseId: CATALOG_EXERCISE_ID },
      // No catalog match: dropped before the write, so not a failure.
      { id: UNRESOLVED_SIGNATURE_ID, exerciseId: "not-in-catalog" },
    ],
  }));
  const body = await json(response);

  assertEquals(response.status, 200, JSON.stringify(body));
  assertEquals(body.exerciseSignaturesUpserted, 0);
  assertEquals(body.failed, {
    phaseStatistics: [],
    exerciseSignatures: [SIGNATURE_ID],
    assessments: [],
    externalActivities: [],
  });
});

const EXTERNAL_ACTIVITY_ID = "00000000-0000-4000-8000-000000000073";

Deno.test("external activity upsert failure reports failed.externalActivities with no ack", async () => {
  // Flag-off fails the PostgREST upsert; flag-on fails the LWW RPC. Same claim
  // either way: a failed write lands in `failed.externalActivities` and is
  // never acked. (Was: a PostgREST-only `writeErrors` injection, which the
  // flag-on path never reaches — `upsert_external_activity_lww` is an RPC, so
  // the double accepted and the test saw `upserted: 1`.)
  const harness = makeHarness(undefined, SYNC_LWW_ENABLED
    ? {
      rpcBehavior: async (name: string) =>
        name === "upsert_external_activity_lww"
          ? { data: null, error: INJECTED_DB_ERROR }
          : undefined,
    }
    : { writeErrors: { "external_activities:upsert": INJECTED_DB_ERROR } });
  const response = await harness.handler(requestFromBody({
    ...validPushBody(),
    profileId: "default",
    allProfiles: [{ id: "default", name: "Default", colorIndex: 0 }],
    externalActivities: [{
      id: EXTERNAL_ACTIVITY_ID,
      externalId: "external-activity-a",
      provider: "test-provider",
      name: "Upsert fails",
      startedAt: "2026-07-11T12:00:00.000Z",
    }],
  }));
  const body = await json(response);

  assertEquals(response.status, 200, JSON.stringify(body));
  assertEquals(body.externalActivitiesUpserted, 0);
  assertEquals(body.externalActivityKeys, []);
  assertEquals(body.failed, {
    phaseStatistics: [],
    exerciseSignatures: [],
    assessments: [],
    externalActivities: [EXTERNAL_ACTIVITY_ID],
  });
});

Deno.test("external activity synced_at is server time, never the client's syncedAt", async () => {
  const harness = makeHarness();
  const response = await harness.handler(requestFromBody({
    ...validPushBody(),
    externalActivities: [{
      id: "00000000-0000-4000-8000-0000000000e1",
      externalId: "hevy-1",
      provider: "hevy",
      name: "Imported workout",
      activityType: "strength",
      startedAt: "2020-01-01T00:00:00.000Z",
      durationSeconds: 600,
      syncedAt: "2020-01-01T00:05:00.000Z",
    }],
  }));
  const body = await json(response);

  assertEquals(response.status, 200, JSON.stringify(body));
  // This is the success path. The failure-shaped block that used to sit here
  // (`upserted: 0`, `keys: []`, `failed.externalActivities: [EXTERNAL_-
  // ACTIVITY_ID]`) was spliced in from the sibling "upsert failure reports
  // failed.externalActivities with no ack" test, which owns that claim — and
  // whose body id (…073) is not even this test's (…0e1). The claim here is
  // the clock: `synced_at` is server time and `started_at` is preserved.
  assertEquals(body.externalActivitiesUpserted, 1);
  assertEquals(body.failed, {
    phaseStatistics: [],
    exerciseSignatures: [],
    assessments: [],
    externalActivities: [],
  });
  assertEquals(body.syncTime, "2026-07-16T02:00:00.000Z");
  // Flag-off writes through PostgREST; flag-on goes through
  // `upsert_external_activity_lww`. Both carry the same `activityRows`, so
  // both must show the server clock. (Was: a PostgREST-only `upserts.length
  // === 1` assert, which cannot hold on the flag-on write path.)
  const rows = SYNC_LWW_ENABLED
    ? (harness.adminRpcCalls.find((call) =>
      call.name === "upsert_external_activity_lww"
    )!.args.p_rows as Array<Record<string, unknown>>)
    : (harness.adminWritePayloads.filter((call) =>
      call.table === "external_activities" && call.method === "upsert"
    )[0].payload as Array<Record<string, unknown>>);
  assertEquals(rows.length, 1);
  assertEquals(rows[0].synced_at, "2026-07-16T02:00:00.000Z");
  assertEquals(rows[0].started_at, "2020-01-01T00:00:00.000Z");
});

Deno.test("a newer active personal record cannot resurrect a stored tombstone", async () => {
  const personalRecordId = "00000000-0000-4000-8000-000000000040";
  const harness = makeHarness(undefined, {
    personalRecordsResult: {
      data: [{
        id: personalRecordId,
        user_id: VALID_USER_ID,
        local_profile_id: null,
        exercise_id: null,
        exercise_name: "Bench Press",
        achieved_at: "2026-06-01T12:00:00.000Z",
        record_type: "MAX_WEIGHT",
        workout_phase: "COMBINED",
        updated_at: "2026-07-02T12:00:00.000Z",
        deleted_at: "2026-07-02T12:00:00.000Z",
      }],
      error: null,
    },
  });
  const response = await harness.handler(requestFromBody({
    ...validPushBody(),
    personalRecords: [{
      id: personalRecordId,
      exerciseName: "Bench Press",
      recordType: "MAX_WEIGHT",
      value: 105,
      achievedAt: "2026-06-01T12:00:00.000Z",
      updatedAt: "2026-07-03T12:00:00.000Z",
    }],
  }));
  const body = await json(response);

  assertEquals(response.status, 200, JSON.stringify(body));
  assertEquals(body.personalRecordsInserted, 0);
  assertEquals(
    harness.adminWriteCalls.filter((call) =>
      call.table === "personal_records"
    ),
    [],
  );
});

Deno.test("deletedAt is the LWW timestamp when a tombstone omits updatedAt", async () => {
  const personalRecordId = "00000000-0000-4000-8000-000000000041";
  const harness = makeHarness(undefined, {
    personalRecordsResult: {
      data: [{
        id: personalRecordId,
        user_id: VALID_USER_ID,
        local_profile_id: null,
        exercise_id: null,
        exercise_name: "Squat",
        achieved_at: "2026-06-01T12:00:00.000Z",
        record_type: "MAX_WEIGHT",
        workout_phase: "COMBINED",
        updated_at: "2026-07-01T12:00:00.000Z",
        deleted_at: null,
      }],
      error: null,
    },
  });
  const response = await harness.handler(requestFromBody({
    ...validPushBody(),
    personalRecords: [{
      id: personalRecordId,
      exerciseName: "Squat",
      recordType: "MAX_WEIGHT",
      value: 150,
      achievedAt: "2026-06-01T12:00:00.000Z",
      deletedAt: "2026-07-02T12:00:00.000Z",
    }],
  }));
  const body = await json(response);

  assertEquals(response.status, 200, JSON.stringify(body));
  assertEquals(body.personalRecordsInserted, 1);
  assertEquals(
    harness.adminWriteCalls.filter((call) =>
      call.table === "personal_records"
    ),
    [{ table: "personal_records", method: "upsert" }],
  );
});

// PR 57: in-memory stand-in for personal_records behind the two service-role
// RPCs. The identity mirrors uq_personal_records_set_derived_identity
// (20260920005700_personal_records_source_identity.sql).
type StoredPersonalRecord = Record<string, unknown> & { id: string };

function setDerivedSqlIdentity(row: Record<string, unknown>): string {
  return JSON.stringify([
    row.local_profile_id ?? "default",
    // NULLIF(exercise_id, '') IS NOT NULL
    row.exercise_id != null && row.exercise_id !== ""
      ? `id:${row.exercise_id}`
      : `name:${row.exercise_name}`,
    Date.parse(String(row.achieved_at)),
    row.record_type,
    row.workout_phase ?? "COMBINED",
  ]);
}

function personalRecordRpcStore() {
  const rows = new Map<string, StoredPersonalRecord>();
  let nextId = 0x100;
  const rpcBehavior: RpcBehavior = async (name, args) => {
    if (name === "get_personal_record_identity_candidates") {
      // Mirrors the SQL: achieved_at match OR id match, tombstones included.
      const wanted = new Set(
        (args.p_achieved_at as string[]).map((value) => Date.parse(value)),
      );
      const ids = new Set((args.p_ids as string[] | undefined) ?? []);
      const after = args.p_after_id as string | null;
      const page = [...rows.values()]
        .filter((row) =>
          wanted.has(Date.parse(String(row.achieved_at))) || ids.has(row.id)
        )
        .filter((row) => after === null || row.id > after)
        .sort((a, b) => a.id.localeCompare(b.id))
        .slice(0, args.p_limit as number);
      return { data: page, error: null };
    }
    if (name === "upsert_set_derived_personal_records") {
      // Mirrors the SQL: last row per identity in the batch wins (DISTINCT
      // ON), ids are always server-generated, an unchanged conflict is not
      // counted, and the return value is rows inserted or changed.
      const lastByIdentity = new Map<string, Record<string, unknown>>();
      for (const incoming of args.p_rows as Record<string, unknown>[]) {
        lastByIdentity.set(setDerivedSqlIdentity(incoming), incoming);
      }
      let affected = 0;
      for (const [identity, incoming] of lastByIdentity) {
        const existing = [...rows.values()].find((row) =>
          row.source === "set_derived" && row.deleted_at == null &&
          setDerivedSqlIdentity(row) === identity
        );
        if (existing) {
          if (existing.value !== incoming.value) {
            existing.value = incoming.value;
            affected += 1;
          }
        } else {
          const id = `00000000-0000-4000-8000-${(nextId++).toString(16).padStart(12, "0")}`;
          rows.set(id, {
            ...incoming,
            id,
            user_id: args.p_user_id,
            source: "set_derived",
            deleted_at: null,
          });
          affected += 1;
        }
      }
      return { data: affected, error: null };
    }
    return { data: [], error: null };
  };
  return { rows, rpcBehavior };
}

Deno.test("PR 57: two pushes of the same set-derived PR yield one row; a dedicated PR with the same identity is still written (F335)", async () => {
  const store = personalRecordRpcStore();
  const harness = makeHarness(undefined, { rpcBehavior: store.rpcBehavior });
  const setDerivedBody = () => {
    const body = validPushBody();
    (body.sessions as Record<string, unknown>[]).push(makePrSession());
    return body;
  };

  const first = await harness.handler(requestFromBody(setDerivedBody()));
  const firstBody = await json(first);
  assertEquals(first.status, 200, JSON.stringify(firstBody));
  assertEquals(firstBody.personalRecordsInserted, 1);

  const second = await harness.handler(requestFromBody(setDerivedBody()));
  const secondBody = await json(second);
  assertEquals(second.status, 200, JSON.stringify(secondBody));
  assertEquals(secondBody.personalRecordsInserted, 0);

  assertEquals(store.rows.size, 1);
  const [stored] = [...store.rows.values()];
  assertEquals(stored.source, "set_derived");
  const upsertCalls = harness.adminRpcCalls.filter((call) =>
    call.name === "upsert_set_derived_personal_records"
  );
  assertEquals(upsertCalls.length, 1);
  assertEquals(upsertCalls[0].args.p_user_id, VALID_USER_ID);
  const sentRow = (upsertCalls[0].args.p_rows as Record<string, unknown>[])[0];
  assertEquals(sentRow.source, "set_derived");
  assert(!Object.hasOwn(sentRow, "id"));
  // Set-derived rows never use the PostgREST table write (it cannot target
  // the partial unique index).
  assertEquals(
    harness.adminWriteCalls.filter((call) => call.table === "personal_records"),
    [],
  );
  // The probe travels as an RPC body, not a GET `.in('achieved_at', ...)`.
  assert(!harness.adminFromCalls.includes("personal_records"));

  const dedicatedId = "00000000-0000-4000-8000-000000000057";
  const dedicated = await harness.handler(requestFromBody({
    ...validPushBody(),
    personalRecords: [{
      id: dedicatedId,
      exerciseName: stored.exercise_name,
      exerciseId: stored.exercise_id ?? null,
      recordType: stored.record_type,
      workoutPhase: stored.workout_phase,
      value: 82.5,
      weightKg: 82.5,
      reps: 5,
      achievedAt: stored.achieved_at,
      updatedAt: "2026-01-20T11:00:00.000Z",
    }],
  }));
  const dedicatedBody = await json(dedicated);
  assertEquals(dedicated.status, 200, JSON.stringify(dedicatedBody));
  assertEquals(dedicatedBody.personalRecordsInserted, 1);
  const dedicatedWrites = harness.adminWritePayloads.filter((call) =>
    call.table === "personal_records"
  );
  assertEquals(dedicatedWrites.length, 1);
  assertEquals(dedicatedWrites[0].method, "upsert");
  const dedicatedRows = dedicatedWrites[0].payload as Record<string, unknown>[];
  assertEquals(dedicatedRows.length, 1);
  assertEquals(dedicatedRows[0].id, dedicatedId);
  assertEquals(dedicatedRows[0].source, "dedicated");
  assertEquals(
    setDerivedSqlIdentity(dedicatedRows[0]),
    setDerivedSqlIdentity(stored),
  );
  assertEquals(
    harness.adminRpcCalls.filter((call) =>
      call.name === "upsert_set_derived_personal_records"
    ).length,
    1,
  );
});

Deno.test("PR 57: the personal record probe pages by id through the RPC body", async () => {
  const achievedAt = "2026-01-20T10:00:00.000Z";
  const probeCalls: Record<string, unknown>[] = [];
  const fullPage = Array.from({ length: 500 }, (_, index) => ({
    id: `00000000-0000-4000-8000-${(0x1000 + index).toString(16).padStart(12, "0")}`,
    local_profile_id: null,
    exercise_id: null,
    exercise_name: `Other ${index}`,
    achieved_at: achievedAt,
    record_type: "MAX_WEIGHT",
    workout_phase: "COMBINED",
    updated_at: achievedAt,
    deleted_at: null,
  }));
  const harness = makeHarness(undefined, {
    rpcBehavior: async (name, args) => {
      if (name === "get_personal_record_identity_candidates") {
        probeCalls.push(args);
        return { data: probeCalls.length === 1 ? fullPage : [], error: null };
      }
      if (name === "upsert_set_derived_personal_records") {
        return { data: (args.p_rows as unknown[]).length, error: null };
      }
      return { data: [], error: null };
    },
  });
  const body = validPushBody();
  (body.sessions as Record<string, unknown>[]).push(makePrSession());

  const response = await harness.handler(requestFromBody(body));
  const responseBody = await json(response);

  assertEquals(response.status, 200, JSON.stringify(responseBody));
  assertEquals(probeCalls.length, 2);
  assertEquals(probeCalls[0].p_after_id, null);
  assertEquals(probeCalls[0].p_limit, 500);
  assertEquals(probeCalls[0].p_user_id, VALID_USER_ID);
  assertEquals(probeCalls[0].p_achieved_at, [achievedAt]);
  assertEquals(probeCalls[0].p_ids, []);
  assertEquals(probeCalls[1].p_after_id, fullPage[499].id);
  assertEquals(responseBody.personalRecordsInserted, 1);
});

Deno.test("PR 57: a tombstoned set-derived PR stays deleted when the session is re-pushed", async () => {
  const store = personalRecordRpcStore();
  const harness = makeHarness(undefined, { rpcBehavior: store.rpcBehavior });
  const body = () => {
    const pushBody = validPushBody();
    (pushBody.sessions as Record<string, unknown>[]).push(makePrSession());
    return pushBody;
  };

  const first = await harness.handler(requestFromBody(body()));
  assertEquals((await json(first)).personalRecordsInserted, 1);
  const [stored] = [...store.rows.values()];
  stored.deleted_at = "2026-02-01T00:00:00.000Z";

  const again = await harness.handler(requestFromBody(body()));
  const againBody = await json(again);
  assertEquals(again.status, 200, JSON.stringify(againBody));
  assertEquals(againBody.personalRecordsInserted, 0);
  assertEquals(
    [...store.rows.values()].filter((row) => row.deleted_at == null),
    [],
  );
  assertEquals(
    harness.adminRpcCalls.filter((call) =>
      call.name === "upsert_set_derived_personal_records"
    ).length,
    1,
  );
});

Deno.test("PR 57: personalRecordsInserted is the set-derived RPC's own count", async () => {
  // A concurrent push already wrote the same values: the RPC's ON CONFLICT
  // guard changes nothing and returns 0.
  const harness = makeHarness(undefined, {
    rpcBehavior: async (name) =>
      name === "upsert_set_derived_personal_records"
        ? { data: 0, error: null }
        : { data: [], error: null },
  });
  const body = validPushBody();
  (body.sessions as Record<string, unknown>[]).push(makePrSession());

  const response = await harness.handler(requestFromBody(body));
  const responseBody = await json(response);

  assertEquals(response.status, 200, JSON.stringify(responseBody));
  assertEquals(responseBody.personalRecordsInserted, 0);
});

Deno.test("PR 57: a non-numeric set-derived RPC result fails the push loudly", async () => {
  await withEnvironment("development", async () => {
    // Every RPC, including upsert_set_derived_personal_records, answers [].
    const harness = makeHarness(undefined, {
      rpcBehavior: async () => ({ data: [], error: null }),
    });
    const body = validPushBody();
    (body.sessions as Record<string, unknown>[]).push(makePrSession());

    const response = await harness.handler(requestFromBody(body));
    const responseBody = await json(response);

    assertEquals(response.status, 500);
    assertEquals(
      responseBody.error,
      "personal_records set-derived upsert returned an unexpected result",
    );
  });
});

Deno.test("PR 57: an FK violation from the set-derived RPC surfaces (no silent retry drops it)", async () => {
  // Set-derived rows only reference the handler-sanitized profile (upserted
  // or cleared earlier in the push) and payload sessions, so the FK-retry
  // partitions find nothing to null out. A 23503 from the RPC must therefore
  // keep its code through the RPC wrapper and fail the push, not vanish.
  await withEnvironment("development", async () => {
    const harness = makeHarness(undefined, {
      rpcBehavior: async (name) =>
        name === "upsert_set_derived_personal_records"
          ? {
            data: null,
            error: {
              code: "23503",
              message: "insert or update on table \"personal_records\" violates foreign key constraint",
            },
          }
          : { data: [], error: null },
    });
    const body = validPushBody();
    (body.sessions as Record<string, unknown>[]).push(makePrSession());

    const response = await harness.handler(requestFromBody(body));
    const responseBody = await json(response);

    assertEquals(response.status, 500);
    assert(
      String(responseBody.error).startsWith("personal_records insert failed:"),
      String(responseBody.error),
    );
    assertEquals(
      harness.adminRpcCalls.filter((call) =>
        call.name === "upsert_set_derived_personal_records"
      ).length,
      1,
    );
  });
});

Deno.test("PR 57: the probe also looks dedicated ids up, so a moved tombstone cannot be resurrected", async () => {
  const personalRecordId = "00000000-0000-4000-8000-000000000042";
  const probeCalls: Record<string, unknown>[] = [];
  const harness = makeHarness(undefined, {
    rpcBehavior: async (name, args) => {
      if (name === "get_personal_record_identity_candidates") {
        probeCalls.push(args);
        // Stored tombstone has a different achieved_at: only the id matches.
        const ids = args.p_ids as string[];
        return {
          data: ids.includes(personalRecordId)
            ? [{
              id: personalRecordId,
              local_profile_id: null,
              exercise_id: null,
              exercise_name: "Row",
              achieved_at: "2026-05-01T12:00:00.000Z",
              record_type: "MAX_WEIGHT",
              workout_phase: "COMBINED",
              updated_at: "2026-07-02T12:00:00.000Z",
              deleted_at: "2026-07-02T12:00:00.000Z",
            }]
            : [],
          error: null,
        };
      }
      return { data: [], error: null };
    },
  });
  const response = await harness.handler(requestFromBody({
    ...validPushBody(),
    personalRecords: [{
      id: personalRecordId,
      exerciseName: "Row",
      recordType: "MAX_WEIGHT",
      value: 70,
      achievedAt: "2026-06-01T12:00:00.000Z",
      updatedAt: "2026-07-03T12:00:00.000Z",
    }],
  }));
  const body = await json(response);

  assertEquals(response.status, 200, JSON.stringify(body));
  assertEquals(probeCalls[0].p_ids, [personalRecordId]);
  assertEquals(body.personalRecordsInserted, 0);
  assertEquals(
    harness.adminWriteCalls.filter((call) => call.table === "personal_records"),
    [],
  );
});

// ---------------------------------------------------------------------------
// KD-4: routine/cycle tombstones on push (both SYNC_LWW_ENABLED values).
// ---------------------------------------------------------------------------

const TOMB_ROUTINE_ID = "00000000-0000-4000-8000-000000000160";
const TOMB_ROUTINE_EXERCISE_ID = "00000000-0000-4000-8000-000000000161";
const TOMB_CYCLE_ID = "00000000-0000-4000-8000-000000000162";
const TOMB_CYCLE_DAY_ID = "00000000-0000-4000-8000-000000000163";
const TOMB_CYCLE_DAY_2_ID = "00000000-0000-4000-8000-000000000164";
const EXISTING_ROUTINE_ID = "00000000-0000-4000-8000-000000000165";

/**
 * Shape the shipping mobile build sends for a routine it still holds and a
 * cycle whose day references that routine (lastSync 0, routine with a nested
 * exercise, cycle with a nested day).
 */
function oldBuildRoutineAndCycleBody(
  extraDays: Record<string, unknown>[] = [],
): Record<string, unknown> {
  return {
    ...validPushBody(),
    routines: [{
      id: TOMB_ROUTINE_ID,
      userId: VALID_USER_ID,
      name: "Deleted on portal",
      description: "",
      exerciseCount: 1,
      estimatedDuration: 0,
      timesCompleted: 0,
      isFavorite: false,
      exercises: [{
        id: TOMB_ROUTINE_EXERCISE_ID,
        routineId: TOMB_ROUTINE_ID,
        name: "Bench Press",
        muscleGroup: "Chest",
        sets: 3,
        reps: 10,
        weight: 20,
        restSeconds: 90,
        mode: "OLD_SCHOOL",
        orderIndex: 0,
      }],
    }],
    cycles: [{
      id: TOMB_CYCLE_ID,
      userId: VALID_USER_ID,
      name: "Cycle using the routine",
      durationWeeks: 1,
      workoutDays: 1,
      restDays: 0,
      currentWeek: 1,
      status: "active",
      days: [{
        id: TOMB_CYCLE_DAY_ID,
        cycleId: TOMB_CYCLE_ID,
        dayNumber: 1,
        dayType: "workout",
        routineId: TOMB_ROUTINE_ID,
      }, ...extraDays],
    }],
  };
}

function tombstoneRpcBehavior(
  tombstones: Array<{ entity: string; entity_id: string }>,
  tombstoneError: unknown = null,
): RpcBehavior {
  return async (name, args) => {
    if (name === "get_sync_tombstones") {
      if (tombstoneError) return { data: null, error: tombstoneError };
      const ids = new Set(args.p_ids as string[]);
      return {
        data: tombstones
          .filter((row) => ids.has(row.entity_id))
          .map((row) => ({ ...row, deleted_at: "2026-07-15T00:00:00.000Z" })),
        error: null,
      };
    }
    if (name === "upsert_routine_lww") {
      // LWW on: accept every row so children are written.
      return {
        data: (args.p_rows as Array<{ id: string }>).map((row) => ({
          id: row.id,
          accepted: true,
          server_updated_at: null,
        })),
        error: null,
      };
    }
    if (name === "merge_training_cycles_from_push") {
      return {
        data: (args.p_cycles as Array<{ id: string }>).map((row) => ({
          id: row.id,
          accepted: true,
          server_updated_at: "2026-07-16T02:00:00.123456+00:00",
          structure_applied: true,
        })),
        error: null,
      };
    }
    return { data: [], error: null };
  };
}

/** Cycles sent to the merge RPC (both flag paths use it). */
function mergedCycles(harness: PushHarness): Array<Record<string, unknown>> {
  return harness.adminRpcCalls
    .filter((call) => call.name === "merge_training_cycles_from_push")
    .flatMap((call) => call.args.p_cycles as Array<Record<string, unknown>>);
}

/** Ids written to a parent table through either flag path. */
function parentWriteIds(
  harness: PushHarness,
  table: "routines" | "training_cycles",
): string[] {
  const viaUpsert = harness.adminWriteArgs
    .filter((call) => call.table === table && call.method === "upsert")
    .flatMap((call) => (call.args[0] as Array<{ id: string }>).map((r) => r.id));
  if (table === "training_cycles") {
    // KD-6: cycles only go through the merge RPC (never a direct upsert).
    return [...viaUpsert, ...mergedCycles(harness).map((r) => r.id as string)];
  }
  const viaRpc = harness.adminRpcCalls
    .filter((call) => call.name === "upsert_routine_lww")
    .flatMap((call) =>
      (call.args.p_rows as Array<{ id: string }>).map((r) => r.id)
    );
  return [...viaUpsert, ...viaRpc];
}

/**
 * Rows upserted into a table. cycle_days rows travel nested in the merge
 * RPC's p_cycles (KD-6), so they are read from there too.
 */
function upsertedRows(
  harness: PushHarness,
  table: string,
): Array<Record<string, unknown>> {
  if (table === "cycle_days") {
    return [
      ...harness.adminWriteArgs
        .filter((call) => call.table === table && call.method === "upsert")
        .flatMap((call) => call.args[0] as Array<Record<string, unknown>>),
      ...mergedCycles(harness).flatMap((cycle) =>
        cycle.days as Array<Record<string, unknown>>
      ),
    ];
  }
  return harness.adminWriteArgs
    .filter((call) => call.table === table && call.method === "upsert")
    .flatMap((call) => call.args[0] as Array<Record<string, unknown>>);
}

Deno.test(`tombstones (LWW=${SYNC_LWW_ENABLED}): old-build push of a deleted routine is 200, skipped, and the day reference is NULL`, async () => {
  const harness = makeHarness(undefined, {
    rpcBehavior: tombstoneRpcBehavior([
      { entity: "routine", entity_id: TOMB_ROUTINE_ID },
    ]),
  });
  const response = await harness.handler(
    requestFromBody(oldBuildRoutineAndCycleBody()),
  );
  const body = await json(response);

  assertEquals(response.status, 200, JSON.stringify(body));
  assertEquals(body.skippedDeleted, {
    routines: [TOMB_ROUTINE_ID],
    cycles: [],
  });
  assertEquals(body.routinesUpserted, 0);
  // The routine and its exercises are not re-created.
  assertEquals(parentWriteIds(harness, "routines"), []);
  assertEquals(upsertedRows(harness, "routine_exercises"), []);
  // The cycle is still stored, with the day's routine reference cleared.
  assertEquals(parentWriteIds(harness, "training_cycles"), [TOMB_CYCLE_ID]);
  const days = upsertedRows(harness, "cycle_days");
  assertEquals(days.length, 1);
  assertEquals(days[0].cycle_id, TOMB_CYCLE_ID);
  assertEquals(days[0].routine_id, null);
  // One lookup covers both entities.
  const lookups = harness.adminRpcCalls.filter((call) =>
    call.name === "get_sync_tombstones"
  );
  assertEquals(lookups.length, 1);
  assertEquals(lookups[0].args.p_user_id, VALID_USER_ID);
  assertEquals(lookups[0].args.p_entity, null);
  assertEquals(
    [...(lookups[0].args.p_ids as string[])].sort(),
    [TOMB_ROUTINE_ID, TOMB_CYCLE_ID].sort(),
  );
});

Deno.test(`tombstones (LWW=${SYNC_LWW_ENABLED}): a routine created in the same push keeps the cycle day reference`, async () => {
  const harness = makeHarness(undefined, {
    rpcBehavior: tombstoneRpcBehavior([]),
  });
  const response = await harness.handler(
    requestFromBody(oldBuildRoutineAndCycleBody()),
  );
  const body = await json(response);

  assertEquals(response.status, 200, JSON.stringify(body));
  assertEquals(body.skippedDeleted, { routines: [], cycles: [] });
  assertEquals(parentWriteIds(harness, "routines"), [TOMB_ROUTINE_ID]);
  assertEquals(
    upsertedRows(harness, "routine_exercises").map((row) => row.id),
    [TOMB_ROUTINE_EXERCISE_ID],
  );
  const days = upsertedRows(harness, "cycle_days");
  assertEquals(days.length, 1);
  assertEquals(days[0].routine_id, TOMB_ROUTINE_ID);
});

Deno.test(`tombstones (LWW=${SYNC_LWW_ENABLED}): a deleted cycle is skipped with its days`, async () => {
  const harness = makeHarness(undefined, {
    rpcBehavior: tombstoneRpcBehavior([
      { entity: "cycle", entity_id: TOMB_CYCLE_ID },
    ]),
  });
  const response = await harness.handler(
    requestFromBody(oldBuildRoutineAndCycleBody()),
  );
  const body = await json(response);

  assertEquals(response.status, 200, JSON.stringify(body));
  assertEquals(body.skippedDeleted, { routines: [], cycles: [TOMB_CYCLE_ID] });
  assertEquals(body.cyclesUpserted, 0);
  assertEquals(parentWriteIds(harness, "training_cycles"), []);
  assertEquals(
    harness.adminWriteCalls.filter((call) => call.table === "cycle_days"),
    [],
  );
  assertEquals(upsertedRows(harness, "cycle_days"), []);
  // The live routine is still written.
  assertEquals(parentWriteIds(harness, "routines"), [TOMB_ROUTINE_ID]);
});

Deno.test(`tombstones (LWW=${SYNC_LWW_ENABLED}): a day pointing at a routine missing on the server is NULL, an existing one is kept`, async () => {
  const MISSING_ROUTINE_ID = "00000000-0000-4000-8000-000000000166";
  const harness = makeHarness(undefined, {
    rpcBehavior: tombstoneRpcBehavior([]),
    // Parent probe for day routine references outside the payload: only the
    // existing routine is found, owned by the caller.
    tableResults: {
      routines: {
        data: [{ id: EXISTING_ROUTINE_ID, user_id: VALID_USER_ID }],
        error: null,
      },
    },
  });
  const requestBody = oldBuildRoutineAndCycleBody([{
    id: TOMB_CYCLE_DAY_2_ID,
    cycleId: TOMB_CYCLE_ID,
    dayNumber: 2,
    dayType: "workout",
    routineId: EXISTING_ROUTINE_ID,
  }, {
    id: "00000000-0000-4000-8000-000000000167",
    cycleId: TOMB_CYCLE_ID,
    dayNumber: 3,
    dayType: "workout",
    routineId: MISSING_ROUTINE_ID,
  }]);
  // Real-timestamp client: routines ship only as a delta, cycles every time,
  // so day 1 now points at a routine that is in neither the payload nor the
  // server.
  requestBody.lastSync = 1_784_000_000_000;
  requestBody.routines = [];
  const response = await harness.handler(requestFromBody(requestBody));
  const body = await json(response);

  assertEquals(response.status, 200, JSON.stringify(body));
  assertEquals(body.skippedDeleted, { routines: [], cycles: [] });
  const byDay = new Map(
    upsertedRows(harness, "cycle_days").map((row) => [row.day_number, row]),
  );
  assertEquals(byDay.get(1)?.routine_id, null);
  assertEquals(byDay.get(2)?.routine_id, EXISTING_ROUTINE_ID);
  assertEquals(byDay.get(3)?.routine_id, null);
});

Deno.test(`tombstones (LWW=${SYNC_LWW_ENABLED}): a routine deleted in the same push clears the day reference`, async () => {
  const harness = makeHarness(undefined, {
    rpcBehavior: tombstoneRpcBehavior([]),
    tableResults: {
      routines: {
        data: [{ id: EXISTING_ROUTINE_ID, user_id: VALID_USER_ID }],
        error: null,
      },
    },
  });
  const requestBody = oldBuildRoutineAndCycleBody([{
    id: TOMB_CYCLE_DAY_2_ID,
    cycleId: TOMB_CYCLE_ID,
    dayNumber: 2,
    dayType: "workout",
    routineId: EXISTING_ROUTINE_ID,
  }]);
  requestBody.deletedRoutineIds = [EXISTING_ROUTINE_ID];
  const response = await harness.handler(requestFromBody(requestBody));
  const body = await json(response);

  assertEquals(response.status, 200, JSON.stringify(body));
  const byDay = new Map(
    upsertedRows(harness, "cycle_days").map((row) => [row.day_number, row]),
  );
  assertEquals(byDay.get(1)?.routine_id, TOMB_ROUTINE_ID);
  assertEquals(byDay.get(2)?.routine_id, null);
});

const LIVE_ROUTINE_ID = "00000000-0000-4000-8000-000000000168";
const LIVE_ROUTINE_EXERCISE_ID = "00000000-0000-4000-8000-000000000169";
const LIVE_CYCLE_ID = "00000000-0000-4000-8000-00000000016a";
const LIVE_CYCLE_DAY_ID = "00000000-0000-4000-8000-00000000016b";
const OTHER_USER_ID = "00000000-0000-4000-8000-000000000002";

/** Old-build body plus a live routine and a live cycle beside the deleted ones. */
function mixedLiveAndDeletedBody(): Record<string, unknown> {
  const body = oldBuildRoutineAndCycleBody();
  (body.routines as Record<string, unknown>[]).push({
    id: LIVE_ROUTINE_ID,
    userId: VALID_USER_ID,
    name: "Still live",
    exerciseCount: 1,
    exercises: [{
      id: LIVE_ROUTINE_EXERCISE_ID,
      routineId: LIVE_ROUTINE_ID,
      name: "Row",
      muscleGroup: "Back",
      sets: 3,
      reps: 10,
      weight: 20,
      mode: "OLD_SCHOOL",
      orderIndex: 0,
    }],
  });
  (body.cycles as Record<string, unknown>[]).push({
    id: LIVE_CYCLE_ID,
    userId: VALID_USER_ID,
    name: "Live cycle",
    days: [{
      id: LIVE_CYCLE_DAY_ID,
      cycleId: LIVE_CYCLE_ID,
      dayNumber: 1,
      dayType: "workout",
      routineId: LIVE_ROUTINE_ID,
    }],
  });
  return body;
}

Deno.test(`tombstones (LWW=${SYNC_LWW_ENABLED}): a deleted routine beside a live one writes only the live routine's exercises`, async () => {
  const harness = makeHarness(undefined, {
    rpcBehavior: tombstoneRpcBehavior([
      { entity: "routine", entity_id: TOMB_ROUTINE_ID },
    ]),
  });
  const response = await harness.handler(
    requestFromBody(mixedLiveAndDeletedBody()),
  );
  const body = await json(response);

  assertEquals(response.status, 200, JSON.stringify(body));
  assertEquals(body.skippedDeleted, {
    routines: [TOMB_ROUTINE_ID],
    cycles: [],
  });
  assertEquals(parentWriteIds(harness, "routines"), [LIVE_ROUTINE_ID]);
  assertEquals(
    upsertedRows(harness, "routine_exercises").map((row) => row.id),
    [LIVE_ROUTINE_EXERCISE_ID],
  );
  // Orphan-exercise cleanup only touches the live routine.
  assertEquals(
    harness.adminWriteArgs.filter((call) =>
      call.table === "routine_exercises" && call.method === "delete"
    ).length,
    1,
  );
  const dayRefs = new Map(
    upsertedRows(harness, "cycle_days").map((row) => [
      row.cycle_id,
      row.routine_id,
    ]),
  );
  assertEquals(dayRefs.get(TOMB_CYCLE_ID), null);
  assertEquals(dayRefs.get(LIVE_CYCLE_ID), LIVE_ROUTINE_ID);
});

Deno.test(`tombstones (LWW=${SYNC_LWW_ENABLED}): a deleted cycle beside a live one writes only the live cycle and its days`, async () => {
  const harness = makeHarness(undefined, {
    rpcBehavior: tombstoneRpcBehavior([
      { entity: "cycle", entity_id: TOMB_CYCLE_ID },
    ]),
  });
  const response = await harness.handler(
    requestFromBody(mixedLiveAndDeletedBody()),
  );
  const body = await json(response);

  assertEquals(response.status, 200, JSON.stringify(body));
  assertEquals(body.skippedDeleted, { routines: [], cycles: [TOMB_CYCLE_ID] });
  assertEquals(parentWriteIds(harness, "training_cycles"), [LIVE_CYCLE_ID]);
  assertEquals(
    upsertedRows(harness, "cycle_days").map((row) => row.cycle_id),
    [LIVE_CYCLE_ID],
  );
  // Orphan-day cleanup runs inside the merge, which only received the live
  // cycle; nothing touches cycle_days directly.
  assertEquals(
    harness.adminWriteCalls.filter((call) => call.table === "cycle_days"),
    [],
  );
});

Deno.test(`tombstones (LWW=${SYNC_LWW_ENABLED}): a cycle day pointing at another user's routine is still refused`, async () => {
  const harness = makeHarness(undefined, {
    rpcBehavior: tombstoneRpcBehavior([]),
    tableResults: {
      routines: {
        data: [{ id: EXISTING_ROUTINE_ID, user_id: OTHER_USER_ID }],
        error: null,
      },
    },
  });
  const requestBody = oldBuildRoutineAndCycleBody([{
    id: TOMB_CYCLE_DAY_2_ID,
    cycleId: TOMB_CYCLE_ID,
    dayNumber: 2,
    dayType: "workout",
    routineId: EXISTING_ROUTINE_ID,
  }]);
  const response = await harness.handler(requestFromBody(requestBody));
  const body = await json(response);

  assertEquals(response.status, 400);
  assertEquals(
    body.error,
    `Refused: routines parent ${EXISTING_ROUTINE_ID} belongs to another user`,
  );
  assertEquals(parentWriteIds(harness, "routines"), []);
  assertEquals(parentWriteIds(harness, "training_cycles"), []);
  assertEquals(
    harness.adminWriteCalls.filter((call) => call.table === "cycle_days"),
    [],
  );
});

Deno.test(`tombstones (LWW=${SYNC_LWW_ENABLED}): a routine deleted concurrently with the push is deleted again and its day reference cleared`, async () => {
  const harness = makeHarness(undefined, {
    rpcBehavior: tombstoneRpcBehavior([]),
    // The lookup saw no tombstone, but one appears for the routine before the
    // post-write race check.
    tableResults: {
      sync_tombstones: (filters) => ({
        data: filters.entity === "routine"
          ? [{ entity_id: TOMB_ROUTINE_ID }]
          : [],
        error: null,
      }),
    },
  });
  const response = await harness.handler(
    requestFromBody(oldBuildRoutineAndCycleBody()),
  );
  const body = await json(response);

  assertEquals(response.status, 200, JSON.stringify(body));
  assertEquals(body.skippedDeleted, {
    routines: [TOMB_ROUTINE_ID],
    cycles: [],
  });
  assertEquals(body.routinesUpserted, 0);
  const routineDeletes = harness.adminWriteArgs.filter((call) =>
    call.table === "routines" && call.method === "delete"
  );
  assertEquals(routineDeletes.length, 1);
  const days = upsertedRows(harness, "cycle_days");
  assertEquals(days.length, 1);
  assertEquals(days[0].routine_id, null);
  // Cycle kept: no cycle tombstone appeared.
  assertEquals(parentWriteIds(harness, "training_cycles"), [TOMB_CYCLE_ID]);
  assertEquals(
    harness.adminWriteCalls.filter((call) =>
      call.table === "training_cycles" && call.method === "delete"
    ),
    [],
  );
});

Deno.test(`tombstones (LWW=${SYNC_LWW_ENABLED}): a cycle deleted concurrently with the push is deleted again`, async () => {
  const harness = makeHarness(undefined, {
    rpcBehavior: tombstoneRpcBehavior([]),
    tableResults: {
      sync_tombstones: (filters) => ({
        data: filters.entity === "cycle" ? [{ entity_id: TOMB_CYCLE_ID }] : [],
        error: null,
      }),
    },
  });
  const response = await harness.handler(
    requestFromBody(oldBuildRoutineAndCycleBody()),
  );
  const body = await json(response);

  assertEquals(response.status, 200, JSON.stringify(body));
  assertEquals(body.skippedDeleted, { routines: [], cycles: [TOMB_CYCLE_ID] });
  assertEquals(body.cyclesUpserted, 0);
  assertEquals(
    harness.adminWriteCalls.filter((call) =>
      call.table === "training_cycles" && call.method === "delete"
    ).length,
    1,
  );
  // The merge accepted it (structure applied), but the re-deleted cycle must
  // not hand the device a base for a row that no longer exists (review R-11).
  assertEquals(mergedCycles(harness).map((c) => c.id), [TOMB_CYCLE_ID]);
  assertEquals(body.cycleVersions, {});
});

Deno.test("tombstones: a push without routines or cycles makes no tombstone lookup", async () => {
  const harness = makeHarness();
  const response = await harness.handler(requestFromBody(validPushBody()));
  const body = await json(response);

  assertEquals(response.status, 200);
  assertEquals(body.skippedDeleted, { routines: [], cycles: [] });
  assertEquals(
    harness.adminRpcCalls.filter((call) => call.name === "get_sync_tombstones"),
    [],
  );
});

Deno.test("tombstones: a failed lookup fails the push before any routine or cycle write", async () => {
  const harness = makeHarness(undefined, {
    rpcBehavior: tombstoneRpcBehavior([], {
      name: "PostgrestError",
      message: "lookup failed",
    }),
  });
  const response = await harness.handler(
    requestFromBody(oldBuildRoutineAndCycleBody()),
  );

  assertEquals(response.status, 500);
  assertEquals(parentWriteIds(harness, "routines"), []);
  assertEquals(parentWriteIds(harness, "training_cycles"), []);
  assertEquals(upsertedRows(harness, "cycle_days"), []);
});

// ---------------------------------------------------------------------------
// KD-6 (PR 18): cycles go through merge_training_cycles_from_push for both
// SYNC_LWW_ENABLED values. The SQL behaviour is covered by the real-SQL
// "integration: " tests below and supabase/tests/database/cycle_merge.test.sql.
// ---------------------------------------------------------------------------

const MERGE_CYCLE_2_ID = "00000000-0000-4000-8000-000000000180";
const MERGE_CYCLE_3_ID = "00000000-0000-4000-8000-000000000181";

function cycleMergeRpcBehavior(
  rows: (pCycles: Array<{ id: string }>) => unknown[],
  mergeError: unknown = null,
): RpcBehavior {
  const base = tombstoneRpcBehavior([]);
  return async (name, args) => {
    if (name === "merge_training_cycles_from_push") {
      if (mergeError) return { data: null, error: mergeError };
      return { data: rows(args.p_cycles as Array<{ id: string }>), error: null };
    }
    return await base(name, args);
  };
}

Deno.test(`cycle merge (LWW=${SYNC_LWW_ENABLED}): one RPC carries the cycles, their days and the base; no direct cycle writes`, async () => {
  const harness = makeHarness(undefined, {
    rpcBehavior: tombstoneRpcBehavior([]),
  });
  const requestBody = oldBuildRoutineAndCycleBody();
  const cycle = (requestBody.cycles as Record<string, unknown>[])[0];
  cycle.baseUpdatedAt = "2026-07-15T10:00:00.123456+00:00";
  cycle.progressionSettings = '{"frequencyCycles":"2"}';
  const response = await harness.handler(requestFromBody(requestBody));
  const body = await json(response);

  assertEquals(response.status, 200, JSON.stringify(body));
  const calls = harness.adminRpcCalls.filter((call) =>
    call.name === "merge_training_cycles_from_push"
  );
  assertEquals(calls.length, 1);
  assertEquals(calls[0].args.p_user_id, VALID_USER_ID);
  assertEquals(calls[0].args.p_use_lww, SYNC_LWW_ENABLED);
  const [sent] = calls[0].args.p_cycles as Array<Record<string, unknown>>;
  assertEquals(sent.id, TOMB_CYCLE_ID);
  assertEquals(sent.user_id, VALID_USER_ID);
  assertEquals(sent.base_updated_at, "2026-07-15T10:00:00.123456+00:00");
  assertEquals(sent.progression_settings, { frequencyCycles: "2" });
  assertEquals(sent.deload_settings, null);
  assertEquals(sent.days, [{
    cycle_id: TOMB_CYCLE_ID,
    day_number: 1,
    day_type: "workout",
    routine_id: TOMB_ROUTINE_ID,
    weight_adjustment: 0,
    rep_modifier: 0,
    rest_override: undefined,
    rest_type: undefined,
    notes: undefined,
  }]);
  // The old direct writes and the LWW wrapper are gone from the push path.
  assertEquals(
    harness.adminWriteCalls.filter((call) =>
      call.table === "training_cycles" || call.table === "cycle_days"
    ),
    [],
  );
  assertEquals(
    harness.adminRpcCalls.filter((call) =>
      call.name === "upsert_training_cycle_lww"
    ),
    [],
  );
  assertEquals(body.cyclesUpserted, 1);
  assertEquals(body.cycleVersions, {
    [TOMB_CYCLE_ID]: "2026-07-16T02:00:00.123456+00:00",
  });
});

Deno.test(`cycle merge (LWW=${SYNC_LWW_ENABLED}): an older build's cycle is sent without a base`, async () => {
  const harness = makeHarness(undefined, {
    rpcBehavior: tombstoneRpcBehavior([]),
  });
  const response = await harness.handler(
    requestFromBody(oldBuildRoutineAndCycleBody()),
  );
  assertEquals(response.status, 200, JSON.stringify(await json(response)));
  const [sent] = mergedCycles(harness);
  assertEquals(sent.base_updated_at, null);
  // Undated-push rule (R-1/R-7, NF-15): an omitted updatedAt is dated at
  // receipt under BOTH flag values, so the merge never sees null and a NOT
  // NULL updated_at column can never be handed one. Receipt is `pushReceivedAt`.
  // Was: `if (SYNC_LWW_ENABLED) typeof sent.updated_at === "string" else
  // sent.updated_at === null` ("without LWW the merge inserts now()"). That
  // branch is the older era and directly contradicted the rule asserted one
  // statement later; this test is a union splice of the two eras. Keep the
  // newer one, and pin the clock rather than only its type.
  assertEquals(sent.updated_at, "2026-07-16T02:00:00.000Z");
});

Deno.test(`cycle merge (LWW=${SYNC_LWW_ENABLED}): cycleVersions lists only cycles whose structure was applied`, async () => {
  const harness = makeHarness(undefined, {
    rpcBehavior: cycleMergeRpcBehavior(() => [
      {
        id: TOMB_CYCLE_ID,
        accepted: true,
        server_updated_at: "2026-07-16T02:00:00.5+00:00",
        structure_applied: true,
        client_updated_at: "2026-07-16T01:50:00+00:00",
      },
      {
        // Portal edited after the device's base: config merged, structure
        // kept. The device must pull before advancing its base.
        // Was: this object's `client_updated_at` tail was split off into a
        // bare `{ client_updated_at }` element with no `id` and no `accepted`,
        // so the handler read it as `!row.accepted` and pushed a second
        // rejection with `id: undefined`. The tail belongs on this row.
        id: MERGE_CYCLE_2_ID,
        accepted: true,
        server_updated_at: "2026-07-16T02:00:01+00:00",
        structure_applied: false,
        client_updated_at: "2026-07-16T01:50:01+00:00",
      },
      {
        // R-3/R-6: the rejection reports the stored LWW key, never the
        // server-clock cursor that feeds cycleVersions.
        id: MERGE_CYCLE_3_ID,
        accepted: false,
        server_updated_at: "2026-07-16T02:00:02+00:00",
        structure_applied: false,
        client_updated_at: "2026-07-16T01:50:02+00:00",
      },
    ]),
  });
  const requestBody = oldBuildRoutineAndCycleBody();
  const cycles = requestBody.cycles as Record<string, unknown>[];
  for (const id of [MERGE_CYCLE_2_ID, MERGE_CYCLE_3_ID]) {
    cycles.push({ id, userId: VALID_USER_ID, name: "Other", status: "draft", days: [] });
  }
  const response = await harness.handler(requestFromBody(requestBody));
  const body = await json(response);

  assertEquals(response.status, 200, JSON.stringify(body));
  assertEquals(body.cycleVersions, {
    [TOMB_CYCLE_ID]: "2026-07-16T02:00:00.5+00:00",
  });
  assertEquals(body.cyclesUpserted, 2);
  assertEquals((body.rejections as Record<string, unknown>).cycles, [{
    id: MERGE_CYCLE_3_ID,
    serverUpdatedAt: "2026-07-16T01:50:02+00:00",
  }]);
});

Deno.test("cycle merge: a push without cycles reports empty cycleVersions and makes no merge call", async () => {
  const harness = makeHarness();
  const response = await harness.handler(requestFromBody(validPushBody()));
  const body = await json(response);

  assertEquals(response.status, 200);
  assertEquals(body.cycleVersions, {});
  assertEquals(mergedCycles(harness), []);
});

// Was "…is a retryable 500" with `{ error: "Internal server error" }`. PR 22
// made the merge transactional: an RPC error rolls back only the merge and
// leaves earlier writes in place, so it is a partial write and answers 503
// `partial_write_retry` so the device retries rather than treating it as a
// permanent failure.
Deno.test(`cycle merge (LWW=${SYNC_LWW_ENABLED}): a merge RPC error is a retryable 503 partial write`, async () => {
  const harness = makeHarness(undefined, {
    rpcBehavior: cycleMergeRpcBehavior(() => [], {
      name: "PostgrestError",
      message: "merge failed",
    }),
  });
  const response = await harness.handler(
    requestFromBody(oldBuildRoutineAndCycleBody()),
  );

  assertEquals(response.status, 503);
  assertEquals(await json(response), {
    error: "Sync temporarily unavailable",
    code: "partial_write_retry",
  });
  assertEquals(harness.broadcastPayloads, []);
});

Deno.test("cycle merge: a malformed baseUpdatedAt is a 400 before any privileged work", async () => {
  const harness = makeHarness();
  const requestBody = oldBuildRoutineAndCycleBody();
  (requestBody.cycles as Record<string, unknown>[])[0].baseUpdatedAt = "not a date";
  const response = await harness.handler(requestFromBody(requestBody));

  assertEquals(response.status, 400);
  assertEquals(mergedCycles(harness), []);
});

Deno.test("present empty preference field is evaluated without an RPC", async () => {
  const harness = makeHarness();
  const response = await harness.handler(requestFromBody({
    ...validPushBody(),
    profilePreferenceSections: [],
  }));

  assertEquals(response.status, 200);
  assertEquals(await json(response), {
    syncTime: "2026-07-16T02:00:00.000Z",
    sessionsInserted: 0,
    exercisesInserted: 0,
    setsInserted: 0,
    repSummariesInserted: 0,
    telemetryInserted: 0,
    routinesUpserted: 0,
    cyclesUpserted: 0,
    badgesUpserted: 0,
    exerciseProgressInserted: 0,
    personalRecordsInserted: 0,
    phaseStatisticsInserted: 0,
    exerciseSignaturesUpserted: 0,
    assessmentsInserted: 0,
    externalActivitiesUpserted: 0,
    externalActivityIds: [],
    externalActivityKeys: [],
    acknowledgedWorkoutSessionIds: [],
    acknowledgedCycleIds: [],
    acknowledgedWorkoutDeletionIds: [],
    acknowledgedOwnershipTransferIds: [],
    acknowledgedDeletedCycleIds: [],
    rejections: {
      sessions: [],
      routines: [],
      cycles: [],
      externalActivities: [],
      rpgAttributes: [],
      gamificationStats: [],
    },
    skippedDeleted: { routines: [], cycles: [] },
    cycleVersions: {},
    failed: {
      phaseStatistics: [],
      exerciseSignatures: [],
      assessments: [],
      externalActivities: [],
    },
    profilePreferencesAccepted: true,
    canonicalProfilePreferenceSections: [],
    profilePreferenceRejections: [],
  });
});

Deno.test("body userId cannot authorize a preference mutation", async () => {
  const harness = makeHarness();
  const response = await harness.handler(requestFromBody({
    ...validPushBody(),
    userId: "00000000-0000-4000-8000-000000000099",
    profilePreferenceSections: [validCoreMutation()],
  }));

  assertEquals(response.status, 400);
  assertNoPrivilegedActivity(harness);
});

Deno.test("valid unique sections call the authoritative RPC exactly once after ordinary writes", async () => {
  const harness = makeHarness();
  const response = await harness.handler(requestFromBody({
    ...validPushBody(),
    profileId: "default",
    allProfiles: [{ id: "default", name: "Default", colorIndex: 0 }],
    profilePreferenceSections: [validCoreMutation(), validRackMutation()],
  }));
  const responseBody = await json(response);
  const preferenceCalls = harness.adminRpcCalls.filter((call) =>
    call.name === "mutate_local_profile_preference_section"
  );

  assertEquals(response.status, 200);
  assertEquals(preferenceCalls, [{
    name: "mutate_local_profile_preference_section",
    args: {
      p_user_id: VALID_USER_ID,
      p_local_profile_id: "profile-a",
      p_section: "CORE",
      p_document_version: 1,
      p_base_revision: 0,
      p_payload: (validCoreMutation().payload as Record<string, unknown>),
    },
  }, {
    name: "mutate_local_profile_preference_section",
    args: {
      p_user_id: VALID_USER_ID,
      p_local_profile_id: "profile-a",
      p_section: "RACK",
      p_document_version: 1,
      p_base_revision: 0,
      p_payload: (validRackMutation().payload as Record<string, unknown>),
    },
  }]);
  const lastOrdinaryWrite = Math.max(
    ...harness.operationEvents.map((event, index) =>
      event.startsWith("write:") ? index : -1
    ),
  );
  const firstPreferenceRpc = harness.operationEvents.indexOf(
    "rpc:mutate_local_profile_preference_section",
  );
  assert(lastOrdinaryWrite >= 0);
  assert(firstPreferenceRpc > lastOrdinaryWrite);
  assertEquals(responseBody.profilePreferencesAccepted, true);
  assertEquals(
    (responseBody.canonicalProfilePreferenceSections as unknown[]).length,
    2,
  );
});

Deno.test("local and domain rejections coexist with an accepted sibling", async () => {
  const invalidCore = clone(validCoreMutation());
  (invalidCore.payload as Record<string, unknown>).bodyWeightKg = 19;
  const harness = makeHarness(undefined, {
    rpcBehavior: async (_name, args) => {
      if (args.p_section === "RACK") {
        return {
          data: [{
            accepted: false,
            rejection_reason: "UNKNOWN_PROFILE",
            server_revision: 0,
            canonical_section: null,
          }],
          error: null,
        };
      }
      return acceptedRpcResult(args);
    },
  });
  const response = await harness.handler(requestFromBody({
    ...validPushBody(),
    profilePreferenceSections: [
      invalidCore,
      validRackMutation(),
      validVbtMutation(),
    ],
  }));
  const responseBody = await json(response);

  assertEquals(response.status, 200);
  assertEquals(responseBody.profilePreferencesAccepted, true);
  assertEquals(
    harness.adminRpcCalls.filter((call) =>
      call.name === "mutate_local_profile_preference_section"
    ).map((call) => call.args.p_section),
    ["RACK", "VBT"],
  );
  assertEquals(responseBody.profilePreferenceRejections, [{
    localProfileId: "profile-a",
    section: "CORE",
    serverRevision: 0,
    reason: "VALIDATION_FAILED",
  }, {
    localProfileId: "profile-a",
    section: "RACK",
    serverRevision: 0,
    reason: "UNKNOWN_PROFILE",
  }]);
  assertEquals(
    (responseBody.canonicalProfilePreferenceSections as Array<
      Record<string, unknown>
    >)
      .map((canonical) => canonical.section),
    ["VBT"],
  );
});

const malformedRpcCases: Array<{
  label: string;
  behavior: RpcBehavior;
  expectedName: string;
}> = [
  {
    label: "returned RPC transport error",
    behavior: async () => ({
      data: null,
      error: { name: "PostgrestError", message: "must stay private" },
    }),
    expectedName: "PreferenceInfrastructureError",
  },
  {
    label: "null rows",
    behavior: async () => ({ data: null, error: null }),
    expectedName: "PreferenceInfrastructureError",
  },
  {
    label: "empty rows",
    behavior: async () => ({ data: [], error: null }),
    expectedName: "PreferenceInfrastructureError",
  },
  {
    label: "multiple rows",
    behavior: async (_name, args) => ({
      data: [
        (acceptedRpcResult(args).data as unknown[])[0],
        (acceptedRpcResult(args).data as unknown[])[0],
      ],
      error: null,
    }),
    expectedName: "PreferenceInfrastructureError",
  },
  {
    label: "malformed row",
    behavior: async () => ({ data: [null], error: null }),
    expectedName: "PreferenceInfrastructureError",
  },
  {
    label: "row with an unknown key",
    behavior: async (_name, args) => {
      const result = acceptedRpcResult(args);
      (result.data as Array<Record<string, unknown>>)[0].extra = true;
      return result;
    },
    expectedName: "PreferenceInfrastructureError",
  },
  {
    label: "accepted row without canonical",
    behavior: async (_name, args) => {
      const result = acceptedRpcResult(args);
      (result.data as Array<Record<string, unknown>>)[0].canonical_section =
        null;
      return result;
    },
    expectedName: "PreferenceInfrastructureError",
  },
  {
    label: "accepted row with a reason",
    behavior: async (_name, args) => {
      const result = acceptedRpcResult(args);
      (result.data as Array<Record<string, unknown>>)[0].rejection_reason =
        "VALIDATION_FAILED";
      return result;
    },
    expectedName: "PreferenceInfrastructureError",
  },
  {
    label: "negative revision",
    behavior: async (_name, args) =>
      acceptedRpcResult(args, { server_revision: -1 }),
    expectedName: "PreferenceInfrastructureError",
  },
  {
    label: "accepted revision zero",
    behavior: async (_name, args) =>
      acceptedRpcResult(args, { server_revision: 0 }),
    expectedName: "PreferenceInfrastructureError",
  },
  {
    label: "accepted unrelated safe revision",
    behavior: async (_name, args) =>
      acceptedRpcResult(args, { server_revision: 2 }),
    expectedName: "PreferenceInfrastructureError",
  },
  {
    label: "accepted canonical payload differs from submitted payload",
    behavior: async (_name, args) =>
      acceptedRpcResult(args, {
        canonical_section: {
          payload: {
            ...(args.p_payload as Record<string, unknown>),
            bodyWeightKg: 81,
          },
        },
      }),
    expectedName: "PreferenceInfrastructureError",
  },
  {
    label: "canonical revision mismatch",
    behavior: async (_name, args) =>
      acceptedRpcResult(args, {
        server_revision: 2,
        canonical_section: { serverRevision: 1 },
      }),
    expectedName: "PreferenceInfrastructureError",
  },
  {
    label: "canonical identity mismatch",
    behavior: async (_name, args) =>
      acceptedRpcResult(args, {
        canonical_section: { localProfileId: "someone-else" },
      }),
    expectedName: "PreferenceInfrastructureError",
  },
  {
    label: "canonical timestamp without timezone",
    behavior: async (_name, args) =>
      acceptedRpcResult(args, {
        canonical_section: { serverUpdatedAt: "2026-07-11T12:00:01" },
      }),
    expectedName: "PreferenceInfrastructureError",
  },
  {
    label: "canonical payload with an unknown key",
    behavior: async (_name, args) =>
      acceptedRpcResult(args, {
        canonical_section: {
          payload: {
            ...(args.p_payload as Record<string, unknown>),
            extra: true,
          },
        },
      }),
    expectedName: "PreferenceInfrastructureError",
  },
  {
    label: "unknown domain reason",
    behavior: async () => ({
      data: [{
        accepted: false,
        rejection_reason: "NOT_A_REASON",
        server_revision: 0,
        canonical_section: null,
      }],
      error: null,
    }),
    expectedName: "PreferenceInfrastructureError",
  },
  {
    label: "non-conflict domain rejection with nonzero revision",
    behavior: async () => ({
      data: [{
        accepted: false,
        rejection_reason: "VALIDATION_FAILED",
        server_revision: 1,
        canonical_section: null,
      }],
      error: null,
    }),
    expectedName: "PreferenceInfrastructureError",
  },
  {
    label: "non-conflict domain rejection with canonical",
    behavior: async (_name, args) => {
      const result = acceptedRpcResult(args);
      const row = (result.data as Array<Record<string, unknown>>)[0];
      row.accepted = false;
      row.rejection_reason = "UNKNOWN_PROFILE";
      row.server_revision = 0;
      (row.canonical_section as Record<string, unknown>).serverRevision = 0;
      return result;
    },
    expectedName: "PreferenceInfrastructureError",
  },
  {
    label: "nonzero revision conflict without canonical",
    behavior: async () => ({
      data: [{
        accepted: false,
        rejection_reason: "REVISION_CONFLICT",
        server_revision: 1,
        canonical_section: null,
      }],
      error: null,
    }),
    expectedName: "PreferenceInfrastructureError",
  },
  {
    label: "thrown safe RPC error name",
    behavior: async () => {
      throw Object.assign(new Error("private transport message"), {
        name: "NetworkError",
      });
    },
    expectedName: "NetworkError",
  },
  {
    label: "thrown invalid RPC error name",
    behavior: async () => {
      throw Object.assign(new Error("private transport message"), {
        name:
          "invalid error name with spaces and a very long private suffix 1234567890",
      });
    },
    expectedName: "PreferenceInfrastructureFailure",
  },
];

for (const testCase of malformedRpcCases) {
  Deno.test(`preference infrastructure: ${testCase.label} is one name-only 503`, async () => {
    const harness = makeHarness(undefined, { rpcBehavior: testCase.behavior });
    const response = await harness.handler(requestFromBody({
      ...validPushBody(),
      profilePreferenceSections: [validCoreMutation()],
    }));

    assertEquals(response.status, 503);
    assertEquals(await json(response), {
      error: "Sync temporarily unavailable",
    });
    assertEquals(harness.loggerCalls, [[{ name: testCase.expectedName }]]);
  });
}

const DEVICE_STATS = {
  userId: VALID_USER_ID,
  // A crafted device claim for every server-derived counter.
  totalWorkouts: 10_000,
  totalReps: 999_999,
  totalVolumeKg: 8_888_888,
  totalTimeSeconds: 777_777,
  longestStreak: 7,
  currentStreak: 3,
};

const DEVICE_RPG = {
  userId: VALID_USER_ID,
  strength: 11,
  power: 12,
  stamina: 13,
  consistency: 14,
  mastery: 15,
  characterClass: "FORGE",
  level: 4,
  experiencePoints: 1234,
};

Deno.test("stats push sends only device-owned columns through the LWW RPCs", async () => {
  const harness = makeHarness();
  const body = validPushBody();
  body.profileId = "default";
  body.allProfiles = [{ id: "default", name: "Default", colorIndex: 0 }];
  // Two workouts: the newest one is the last-workout date the write carries.
  body.sessions = [
    {
      id: SESSION_ID,
      userId: VALID_USER_ID,
      name: "Older workout",
      startedAt: "2026-07-09T08:00:00.000Z",
    },
    {
      id: MISMATCH_ID,
      userId: VALID_USER_ID,
      name: "Newest workout",
      startedAt: "2026-07-11T12:00:00.000Z",
    },
  ];
  body.gamificationStats = DEVICE_STATS;
  body.rpgAttributes = DEVICE_RPG;

  const response = await harness.handler(requestFromBody(body));

  assertEquals(response.status, 200, JSON.stringify(await json(response)));
  const lastWorkoutAt = "2026-07-11T12:00:00.000Z";
  assertEquals(
    harness.adminRpcCalls.filter((call) =>
      call.name === "upsert_gamification_stats_lww"
    ).map((call) => call.args.p_rows),
    [[{
      user_id: VALID_USER_ID,
      // The device's own numbers go to the SHADOW columns, which
      // mobile-sync-pull serves straight back to it. No derived counter and
      // no streak is on the wire to the RPC (R-10).
      device_total_workouts: 10_000,
      device_total_reps: 999_999,
      device_total_volume_kg: 8_888_888,
      device_total_time_seconds: 777_777,
      device_longest_streak: 7,
      device_current_streak: 3,
      last_workout_at: lastWorkoutAt,
    }]],
  );
  assertEquals(
    harness.adminRpcCalls.filter((call) =>
      call.name === "upsert_rpg_attributes_lww"
    ).map((call) => call.args.p_rows),
    [[{
      user_id: VALID_USER_ID,
      strength: 11,
      power: 12,
      stamina: 13,
      consistency: 14,
      mastery: 15,
      character_class: "FORGE",
      level: 4,
      experience_points: 1234,
      last_workout_at: lastWorkoutAt,
    }]],
  );
  // Both flag paths use the RPC; nothing writes these tables directly any
  // more, so no server `new Date()` stamp reaches them either (F-070).
  assertEquals(
    harness.adminWriteCalls.filter((call) =>
      call.table === "gamification_stats" || call.table === "rpg_attributes"
    ),
    [],
  );
});

Deno.test("every push recomputes the server-derived counters, even without stats", async () => {
  const harness = makeHarness();

  const response = await harness.handler(requestFromBody(validPushBody()));

  assertEquals(response.status, 200);
  assertEquals(
    harness.adminRpcCalls.filter((call) =>
      call.name === "recompute_gamification_stats"
    ),
    [{
      name: "recompute_gamification_stats",
      args: { p_user_id: VALID_USER_ID },
    }],
  );
});

Deno.test("a stats-only push carries no last-workout date", async () => {
  const harness = makeHarness();
  const body = validPushBody();
  body.gamificationStats = DEVICE_STATS;

  const response = await harness.handler(requestFromBody(body));

  assertEquals(response.status, 200);
  assertEquals(
    harness.adminRpcCalls.find((call) =>
      call.name === "upsert_gamification_stats_lww"
    )?.args.p_rows,
    [{
      user_id: VALID_USER_ID,
      device_total_workouts: 10_000,
      device_total_reps: 999_999,
      device_total_volume_kg: 8_888_888,
      device_total_time_seconds: 777_777,
      device_longest_streak: 7,
      device_current_streak: 3,
      last_workout_at: null,
    }],
  );
});

Deno.test("a future-dated startedAt is clamped to the server clock", async () => {
  // R-2 / R-11 / R-24: startedAt is only checked for parseability, so a
  // skewed phone clock or a crafted payload could otherwise park the
  // conflict key in 2099 and freeze every device-reported column against
  // every later honest push, with no path back down.
  const harness = makeHarness();
  const body = validPushBody();
  body.profileId = "default";
  body.allProfiles = [{ id: "default", name: "Default", colorIndex: 0 }];
  body.sessions = [{
    id: SESSION_ID,
    userId: VALID_USER_ID,
    name: "Clock-skewed workout",
    startedAt: "2099-01-01T00:00:00.000Z",
  }];
  body.gamificationStats = DEVICE_STATS;
  body.rpgAttributes = DEVICE_RPG;

  const response = await harness.handler(requestFromBody(body));

  assertEquals(response.status, 200, JSON.stringify(await json(response)));
  const keys = harness.adminRpcCalls
    .filter((call) =>
      call.name === "upsert_gamification_stats_lww" ||
      call.name === "upsert_rpg_attributes_lww"
    )
    .map((call) =>
      ((call.args.p_rows as Array<Record<string, unknown>>)[0]).last_workout_at
    );
  // The harness clock is 2026-07-16T02:00:00.000Z.
  assertEquals(keys, [
    "2026-07-16T02:00:00.000Z",
    "2026-07-16T02:00:00.000Z",
  ]);
});

Deno.test("a failed recompute FAILS OPEN: the push still succeeds and broadcasts", async () => {
  // Review round 1 (R-1) deliberately reverses the previous expectation
  // ("a failed recompute fails the push"). The recompute runs in its own
  // transaction AFTER every write has committed, so throwing returned 500
  // for a push whose data all landed, suppressed the sync_complete
  // broadcast, and made the device retry the whole payload — re-running the
  // same full-history recompute on every batch of a multi-batch import. On a
  // large history that meets a statement_timeout that is a permanent
  // sync-failure loop. The counters are self-healing, so a stale counter
  // beats a wedged sync.
  const harness = makeHarness(undefined, {
    rpcBehavior: async (name) =>
      name === "recompute_gamification_stats"
        ? { data: null, error: { message: "recompute boom" } }
        : { data: [], error: null },
  });

  const response = await harness.handler(requestFromBody(validPushBody()));

  assertEquals(response.status, 200, JSON.stringify(await json(response)));
  assertEquals(harness.loggerCalls, [[{ name: "GamificationRecomputeFailure" }]]);
  // Step 15 still runs, so the portal is told to refresh.
  assertEquals(harness.broadcastPayloads.length, 1);
});

Deno.test("flag-off keeps the rejection response contract for stats and rpg", async () => {
  // R-18: both flag paths now call the RPCs, so the `if (SYNC_LWW_ENABLED)`
  // guard is the only thing keeping `rejections` empty when the flag is off.
  // Nothing exercised it before, because the default rpcBehavior never
  // returns accepted: false.
  const harness = makeHarness(undefined, {
    rpcBehavior: async (name) =>
      name === "upsert_gamification_stats_lww" ||
        name === "upsert_rpg_attributes_lww"
        ? {
          data: [{
            id: VALID_USER_ID,
            accepted: false,
            server_updated_at: "2026-07-10T00:00:00.000Z",
          }],
          error: null,
        }
        : { data: [], error: null },
  });
  const body = validPushBody();
  body.gamificationStats = DEVICE_STATS;
  body.rpgAttributes = DEVICE_RPG;

  const response = await harness.handler(requestFromBody(body));

  assertEquals(response.status, 200);
  const payload = await json(response) as {
    rejections?: {
      gamificationStats?: unknown[];
      rpgAttributes?: unknown[];
    };
  };
  const expected = SYNC_LWW_ENABLED_IN_TEST
    ? [{ id: VALID_USER_ID, serverUpdatedAt: "2026-07-10T00:00:00.000Z" }]
    : [];
  assertEquals(payload.rejections?.gamificationStats ?? [], expected);
  assertEquals(payload.rejections?.rpgAttributes ?? [], expected);
});

interface LocalIntegrationFixture {
  admin: SupabaseClient;
  ownerId: string;
  otherUserId: string;
  profileId: string;
}

async function deleteLocalIntegrationUsers(
  admin: SupabaseClient,
  userIds: string[],
): Promise<void> {
  if (userIds.length === 0) return;
  const preferenceDelete = await admin.from("local_profile_preferences")
    .delete()
    .in("user_id", userIds);
  if (preferenceDelete.error) {
    throw new Error("preference fixture cleanup failed");
  }
  const profileDelete = await admin.from("local_profiles")
    .delete()
    .in("user_id", userIds);
  if (profileDelete.error) throw new Error("profile fixture cleanup failed");
  for (const userId of userIds) {
    const deleted = await admin.auth.admin.deleteUser(userId);
    if (deleted.error) throw new Error("auth fixture cleanup failed");
  }
}

async function createLocalIntegrationFixture(): Promise<
  LocalIntegrationFixture
> {
  assert(localIntegrationEnvironment);
  const admin = createClient(
    localIntegrationEnvironment.url,
    localIntegrationEnvironment.serviceRoleKey,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const createdUserIds: string[] = [];
  try {
    const suffix = crypto.randomUUID();
    const owner = await admin.auth.admin.createUser({
      email: `task7-owner-${suffix}@example.invalid`,
      email_confirm: true,
    });
    if (owner.error || !owner.data.user) {
      throw new Error("owner fixture creation failed");
    }
    createdUserIds.push(owner.data.user.id);
    const other = await admin.auth.admin.createUser({
      email: `task7-other-${suffix}@example.invalid`,
      email_confirm: true,
    });
    if (other.error || !other.data.user) {
      throw new Error("other fixture creation failed");
    }
    createdUserIds.push(other.data.user.id);
    const profileId = crypto.randomUUID();
    const profile = await admin.from("local_profiles").insert({
      user_id: owner.data.user.id,
      id: profileId,
      name: "Task 7 integration profile",
      color_index: 0,
      device_id: `task7-${suffix}`,
    });
    if (profile.error) throw new Error("profile fixture creation failed");
    return {
      admin,
      ownerId: owner.data.user.id,
      otherUserId: other.data.user.id,
      profileId,
    };
  } catch (error) {
    await deleteLocalIntegrationUsers(admin, createdUserIds);
    throw error;
  }
}

async function cleanupLocalIntegrationFixture(
  fixture: LocalIntegrationFixture,
): Promise<void> {
  await deleteLocalIntegrationUsers(
    fixture.admin,
    [fixture.ownerId, fixture.otherUserId],
  );
}

async function realPreferenceRpc(
  fixture: LocalIntegrationFixture,
  section: string,
  payload: Record<string, unknown>,
  baseRevision = 0,
  userId = fixture.ownerId,
): Promise<Record<string, unknown>> {
  const result = await fixture.admin.rpc(
    "mutate_local_profile_preference_section",
    {
      p_user_id: userId,
      p_local_profile_id: fixture.profileId,
      p_section: section,
      p_document_version: 1,
      p_base_revision: baseRevision,
      p_payload: payload,
    },
  );
  if (result.error) throw new Error("real preference RPC failed");
  assert(Array.isArray(result.data));
  assertEquals(result.data.length, 1);
  return result.data[0] as Record<string, unknown>;
}

Deno.test({
  name:
    "integration: same-section concurrent first writes accept one and converge one conflict",
  ignore: localIntegrationEnvironment === null,
  fn: async () => {
    const fixture = await createLocalIntegrationFixture();
    try {
      const firstPayload = {
        bodyWeightKg: 80,
        weightUnit: "KG",
        weightIncrement: 1,
      };
      const secondPayload = {
        bodyWeightKg: 90,
        weightUnit: "LB",
        weightIncrement: 2,
      };
      const rows = await Promise.all([
        realPreferenceRpc(fixture, "CORE", firstPayload),
        realPreferenceRpc(fixture, "CORE", secondPayload),
      ]);
      const accepted = rows.filter((row) => row.accepted === true);
      const conflicts = rows.filter((row) =>
        row.accepted === false && row.rejection_reason === "REVISION_CONFLICT"
      );

      assertEquals(accepted.length, 1);
      assertEquals(conflicts.length, 1);
      assertEquals(accepted[0].server_revision, 1);
      assertEquals(conflicts[0].server_revision, 1);
      assertEquals(
        conflicts[0].canonical_section,
        accepted[0].canonical_section,
      );
      const stored = await fixture.admin.from("local_profile_preferences")
        .select("core_revision,body_weight_kg,weight_unit,weight_increment")
        .eq("user_id", fixture.ownerId)
        .eq("local_profile_id", fixture.profileId)
        .single();
      if (stored.error) {
        throw new Error("same-section verification query failed");
      }
      const winningPayload =
        (accepted[0].canonical_section as Record<string, unknown>)
          .payload;
      assertEquals(stored.data.core_revision, 1);
      assertEquals(
        stored.data.body_weight_kg,
        (winningPayload as Record<string, unknown>).bodyWeightKg,
      );
      assertEquals(
        stored.data.weight_unit,
        (winningPayload as Record<string, unknown>).weightUnit,
      );
      assertEquals(
        stored.data.weight_increment,
        (winningPayload as Record<string, unknown>).weightIncrement,
      );
    } finally {
      await cleanupLocalIntegrationFixture(fixture);
    }
  },
});

Deno.test({
  name:
    "integration: different-section concurrent first writes both preserve revision-one siblings",
  ignore: localIntegrationEnvironment === null,
  fn: async () => {
    const fixture = await createLocalIntegrationFixture();
    try {
      const corePayload = validCoreMutation().payload as Record<
        string,
        unknown
      >;
      const rackPayload = validRackMutation().payload as Record<
        string,
        unknown
      >;
      const rows = await Promise.all([
        realPreferenceRpc(fixture, "CORE", corePayload),
        realPreferenceRpc(fixture, "RACK", rackPayload),
      ]);

      assertEquals(rows.map((row) => row.accepted), [true, true]);
      assertEquals(rows.map((row) => row.server_revision), [1, 1]);
      const stored = await fixture.admin.from("local_profile_preferences")
        .select("core_revision,rack_revision,body_weight_kg,equipment_rack")
        .eq("user_id", fixture.ownerId)
        .eq("local_profile_id", fixture.profileId)
        .single();
      if (stored.error) {
        throw new Error("different-section verification query failed");
      }
      assertEquals(stored.data.core_revision, 1);
      assertEquals(stored.data.rack_revision, 1);
      assertEquals(stored.data.body_weight_kg, corePayload.bodyWeightKg);
      assertEquals(stored.data.equipment_rack, rackPayload);
    } finally {
      await cleanupLocalIntegrationFixture(fixture);
    }
  },
});

Deno.test({
  name:
    "integration: handler lost-ack retry converges committed and failed siblings",
  ignore: localIntegrationEnvironment === null,
  fn: async () => {
    const fixture = await createLocalIntegrationFixture();
    try {
      const coreMutation = clone(validCoreMutation());
      coreMutation.localProfileId = fixture.profileId;
      const rackMutation = clone(validRackMutation());
      rackMutation.localProfileId = fixture.profileId;
      const requestBody = {
        ...validPushBody(),
        profilePreferenceSections: [coreMutation, rackMutation],
      };
      const authBehavior: AuthBehavior = async () => ({
        data: { user: { id: fixture.ownerId } },
        error: null,
      });
      const firstAttempt = makeHarness(authBehavior, {
        rpcBehavior: async (name, args) => {
          if (args.p_section === "CORE") {
            return await fixture.admin.rpc(name, args);
          }
          return {
            data: null,
            error: {
              name: "InjectedPreferenceFailure",
              message: "must never be logged",
            },
          };
        },
      });
      const failedResponse = await firstAttempt.handler(
        requestFromBody(requestBody),
      );
      const failedBody = await json(failedResponse);

      assertEquals(failedResponse.status, 503);
      assertEquals(failedBody, { error: "Sync temporarily unavailable" });
      assert(!Object.hasOwn(failedBody, "canonicalProfilePreferenceSections"));
      assert(!Object.hasOwn(failedBody, "profilePreferenceRejections"));
      assertEquals(firstAttempt.loggerCalls, [[{
        name: "PreferenceInfrastructureError",
      }]]);
      assertEquals(
        firstAttempt.adminRpcCalls.filter((call) =>
          call.name === "mutate_local_profile_preference_section"
        ).map((call) => ({
          userId: call.args.p_user_id,
          section: call.args.p_section,
        })),
        [
          { userId: fixture.ownerId, section: "CORE" },
          { userId: fixture.ownerId, section: "RACK" },
        ],
      );
      const afterFailure = await fixture.admin.from(
        "local_profile_preferences",
      )
        .select("core_revision,rack_revision,body_weight_kg,equipment_rack")
        .eq("user_id", fixture.ownerId)
        .eq("local_profile_id", fixture.profileId)
        .single();
      if (afterFailure.error) {
        throw new Error("lost-ack first-attempt verification query failed");
      }
      assertEquals(afterFailure.data.core_revision, 1);
      assertEquals(afterFailure.data.rack_revision, 0);
      assertEquals(
        afterFailure.data.body_weight_kg,
        (coreMutation.payload as Record<string, unknown>).bodyWeightKg,
      );

      const retry = makeHarness(authBehavior, {
        rpcBehavior: async (name, args) => await fixture.admin.rpc(name, args),
      });
      const retryResponse = await retry.handler(requestFromBody(requestBody));
      const retryBody = await json(retryResponse);

      assertEquals(retryResponse.status, 200);
      assertEquals(retry.loggerCalls, []);
      assertEquals(retryBody.profilePreferencesAccepted, true);
      assertEquals(retryBody.canonicalProfilePreferenceSections, [{
        localProfileId: fixture.profileId,
        section: "RACK",
        documentVersion: 1,
        serverRevision: 1,
        serverUpdatedAt: (retryBody.canonicalProfilePreferenceSections as Array<
          Record<string, unknown>
        >)[0].serverUpdatedAt,
        payload: rackMutation.payload,
      }]);
      const retryRejections = retryBody.profilePreferenceRejections as Array<
        Record<string, unknown>
      >;
      assertEquals(retryRejections.length, 1);
      assertEquals({
        localProfileId: retryRejections[0].localProfileId,
        section: retryRejections[0].section,
        serverRevision: retryRejections[0].serverRevision,
        reason: retryRejections[0].reason,
      }, {
        localProfileId: fixture.profileId,
        section: "CORE",
        serverRevision: 1,
        reason: "REVISION_CONFLICT",
      });
      assertEquals(
        (retryRejections[0].canonicalSection as Record<string, unknown>)
          .payload,
        coreMutation.payload,
      );
      const otherOwner = await realPreferenceRpc(
        fixture,
        "CORE",
        coreMutation.payload as Record<string, unknown>,
        0,
        fixture.otherUserId,
      );
      assertEquals(otherOwner, {
        accepted: false,
        rejection_reason: "UNKNOWN_PROFILE",
        server_revision: 0,
        canonical_section: null,
      });
      const stored = await fixture.admin.from("local_profile_preferences")
        .select("core_revision,rack_revision,body_weight_kg,equipment_rack")
        .eq("user_id", fixture.ownerId)
        .eq("local_profile_id", fixture.profileId)
        .single();
      if (stored.error) throw new Error("lost-ack verification query failed");
      assertEquals(stored.data.core_revision, 1);
      assertEquals(stored.data.rack_revision, 1);
      assertEquals(
        stored.data.body_weight_kg,
        (coreMutation.payload as Record<string, unknown>).bodyWeightKg,
      );
      assertEquals(stored.data.equipment_rack, rackMutation.payload);
    } finally {
      await cleanupLocalIntegrationFixture(fixture);
    }
  },
});

Deno.test({
  name:
    "integration: set-derived PR concurrent and repeated pushes converge to one row, stay deleted once tombstoned, and a dedicated twin stays distinct",
  ignore: localIntegrationEnvironment === null,
  fn: async () => {
    const fixture = await createLocalIntegrationFixture();
    let authenticatedUserId: string | null = null;
    try {
      const sessionId = crypto.randomUUID();
      const session = await fixture.admin.from("workout_sessions").insert({
        id: sessionId,
        user_id: fixture.ownerId,
        started_at: "2026-01-20T10:00:00.000Z",
      });
      if (session.error) throw new Error("session fixture creation failed");

      const prSession = {
        ...makePrSession(),
        id: sessionId,
        userId: fixture.ownerId,
      };
      prSession.exercises = prSession.exercises.map((exercise) => ({
        ...exercise,
        sessionId,
      }));
      const pushBody = () => ({ ...validPushBody(), sessions: [prSession] });
      const realPrRpcs = new Set([
        "get_personal_record_identity_candidates",
        "upsert_set_derived_personal_records",
      ]);
      const harness = makeHarness(async () => ({
        data: { user: { id: fixture.ownerId } },
        error: null,
      }), {
        rpcBehavior: async (name, args) =>
          realPrRpcs.has(name)
            ? await fixture.admin.rpc(name, args)
            : { data: [], error: null },
      });

      // Two concurrent pushes: both TS probes may see an empty table; the
      // partial unique index + ON CONFLICT must still leave one row, and both
      // pushes succeed. Exactly one of them reports the insert.
      const concurrent = await Promise.all([
        harness.handler(requestFromBody(pushBody())),
        harness.handler(requestFromBody(pushBody())),
      ]);
      const concurrentBodies = await Promise.all(concurrent.map(json));
      assertEquals(
        concurrent.map((response) => response.status),
        [200, 200],
        JSON.stringify(concurrentBodies),
      );
      assertEquals(
        concurrentBodies.map((body) => body.personalRecordsInserted as number)
          .reduce((sum, value) => sum + value, 0),
        1,
      );
      // A later sequential re-push is filtered by the probe.
      const repush = await harness.handler(requestFromBody(pushBody()));
      const repushBody = await json(repush);
      assertEquals(repush.status, 200, JSON.stringify(repushBody));
      assertEquals(repushBody.personalRecordsInserted, 0);

      const afterPushes = await fixture.admin.from("personal_records")
        .select("id,source,session_id,exercise_name,exercise_id,achieved_at,record_type,workout_phase,local_profile_id,value")
        .eq("user_id", fixture.ownerId);
      if (afterPushes.error) throw new Error("post-push verification failed");
      assertEquals(afterPushes.data.length, 1);
      const stored = afterPushes.data[0];
      assertEquals(stored.source, "set_derived");
      assertEquals(stored.session_id, sessionId);

      // The actual RPC path twice more, each call carrying a different
      // caller-supplied id (which the RPC ignores): still one row, no error,
      // and the stored id is kept.
      const identity = {
        local_profile_id: stored.local_profile_id,
        exercise_name: stored.exercise_name,
        exercise_id: stored.exercise_id,
        record_type: stored.record_type,
        workout_phase: stored.workout_phase,
        // A different textual form of the same instant.
        achieved_at: "2026-01-20T10:00:00+00:00",
        weight_kg: 80,
        reps: 10,
        session_id: sessionId,
      };
      for (const value of [90, 95]) {
        const rpc = await fixture.admin.rpc(
          "upsert_set_derived_personal_records",
          {
            p_user_id: fixture.ownerId,
            p_rows: [{ ...identity, id: crypto.randomUUID(), value }],
          },
        );
        if (rpc.error) throw new Error(`set-derived RPC failed: ${rpc.error.message}`);
        assertEquals(rpc.data, 1);
      }
      const unchanged = await fixture.admin.rpc(
        "upsert_set_derived_personal_records",
        {
          p_user_id: fixture.ownerId,
          p_rows: [
            { ...identity, id: crypto.randomUUID(), value: 94 },
            { ...identity, id: crypto.randomUUID(), value: 95 },
          ],
        },
      );
      if (unchanged.error) {
        throw new Error(`duplicate-in-batch RPC failed: ${unchanged.error.message}`);
      }
      // Same identity twice in one batch: last wins, and it equals the stored
      // value, so nothing is rewritten.
      assertEquals(unchanged.data, 0);

      const afterRpc = await fixture.admin.from("personal_records")
        .select("id,value,source")
        .eq("user_id", fixture.ownerId);
      if (afterRpc.error) throw new Error("post-RPC verification failed");
      assertEquals(afterRpc.data.length, 1);
      assertEquals(afterRpc.data[0].id, stored.id);
      assertEquals(Number(afterRpc.data[0].value), 95);

      // JS Date.parse and the handler identity key have millisecond precision.
      // The SQL identity uses the same resolution, so a timestamp differing
      // only by PostgreSQL microseconds updates the same logical record.
      const submillisecond = await fixture.admin.rpc(
        "upsert_set_derived_personal_records",
        {
          p_user_id: fixture.ownerId,
          p_rows: [{
            ...identity,
            achieved_at: "2026-01-20T10:00:00.000999Z",
            value: 97,
          }],
        },
      );
      if (submillisecond.error) {
        throw new Error(`submillisecond RPC failed: ${submillisecond.error.message}`);
      }
      assertEquals(submillisecond.data, 1);
      const afterSubmillisecond = await fixture.admin.from("personal_records")
        .select("id,value,achieved_at")
        .eq("user_id", fixture.ownerId);
      if (afterSubmillisecond.error) {
        throw new Error("submillisecond verification failed");
      }
      assertEquals(afterSubmillisecond.data.length, 1);
      assertEquals(afterSubmillisecond.data[0].id, stored.id);
      assertEquals(Number(afterSubmillisecond.data[0].value), 97);
      assertEquals(afterSubmillisecond.data[0].achieved_at, "2026-01-20T10:00:00+00:00");

      // A deleted set-derived PR stays deleted when the old phone re-pushes
      // the session: the partial index ignores tombstones, so only the probe
      // (which returns tombstones) stops the resurrection.
      const tombstone = await fixture.admin.from("personal_records")
        .update({ deleted_at: "2026-02-01T00:00:00.000Z" })
        .eq("id", stored.id);
      if (tombstone.error) throw new Error("tombstone fixture failed");
      const afterDelete = await harness.handler(requestFromBody(pushBody()));
      const afterDeleteBody = await json(afterDelete);
      assertEquals(afterDelete.status, 200, JSON.stringify(afterDeleteBody));
      assertEquals(afterDeleteBody.personalRecordsInserted, 0);
      const live = await fixture.admin.from("personal_records")
        .select("id")
        .eq("user_id", fixture.ownerId)
        .is("deleted_at", null);
      if (live.error) throw new Error("live-row verification failed");
      assertEquals(live.data, []);

      // F335: a dedicated PR with the same derived identity and its own id
      // is a distinct row; the partial index does not constrain it.
      const dedicatedId = crypto.randomUUID();
      const dedicated = await fixture.admin.from("personal_records")
        .upsert({
          ...identity,
          id: dedicatedId,
          user_id: fixture.ownerId,
          value: 100,
          muscle_group: "Chest",
          unit: "kg",
          source: "dedicated",
        }, { onConflict: "id" });
      if (dedicated.error) {
        throw new Error(`dedicated upsert failed: ${dedicated.error.message}`);
      }
      const probe = await fixture.admin.rpc(
        "get_personal_record_identity_candidates",
        {
          p_user_id: fixture.ownerId,
          p_achieved_at: ["2026-01-20T10:00:00.000Z"],
          p_after_id: null,
          p_limit: 1,
        },
      );
      if (probe.error) throw new Error(`probe RPC failed: ${probe.error.message}`);
      assertEquals(probe.data.length, 1);
      const probeNext = await fixture.admin.rpc(
        "get_personal_record_identity_candidates",
        {
          p_user_id: fixture.ownerId,
          p_achieved_at: ["2026-01-20T10:00:00.000Z"],
          p_after_id: probe.data[0].id,
          p_limit: 1,
        },
      );
      if (probeNext.error) {
        throw new Error(`probe RPC page 2 failed: ${probeNext.error.message}`);
      }
      assertEquals(probeNext.data.length, 1);
      assertEquals(
        new Set([probe.data[0].id, probeNext.data[0].id]),
        new Set([stored.id, dedicatedId]),
      );

      // Another user's write never touches the owner's row.
      const other = await fixture.admin.rpc(
        "upsert_set_derived_personal_records",
        {
          p_user_id: fixture.otherUserId,
          p_rows: [{ ...identity, session_id: null, value: 1 }],
        },
      );
      if (other.error) throw new Error(`other-user RPC failed: ${other.error.message}`);
      const ownerRows = await fixture.admin.from("personal_records")
        .select("id,value,source")
        .eq("user_id", fixture.ownerId)
        .order("source");
      if (ownerRows.error) throw new Error("final verification failed");
      assertEquals(
        ownerRows.data.map((row) => [row.source, Number(row.value)]),
        [["dedicated", 100], ["set_derived", 97]],
      );

      // A set-derived PR whose session row does not exist: the RPC raises the
      // FK violation and the push fails loudly instead of dropping the PR or
      // writing a partial row (the handler's FK retry has nothing to null
      // out for set-derived rows; see the unit test).
      const orphanSessionId = crypto.randomUUID();
      const orphanSession = {
        ...prSession,
        id: orphanSessionId,
        startedAt: "2026-03-01T10:00:00.000Z",
        exercises: prSession.exercises.map((exercise) => {
          const exerciseRowId = crypto.randomUUID();
          return {
            ...exercise,
            id: exerciseRowId,
            sessionId: orphanSessionId,
            sets: exercise.sets.map((set) => ({
              ...set,
              id: crypto.randomUUID(),
              exerciseId: exerciseRowId,
            })),
          };
        }),
      };
      const orphan = await harness.handler(requestFromBody({
        ...validPushBody(),
        sessions: [orphanSession],
      }));
      const orphanBody = await json(orphan);
      assertEquals(orphan.status, 500, JSON.stringify(orphanBody));
      const orphanRows = await fixture.admin.from("personal_records")
        .select("id")
        .eq("user_id", fixture.ownerId)
        .eq("achieved_at", "2026-03-01T10:00:00.000Z");
      if (orphanRows.error) throw new Error("orphan verification failed");
      assertEquals(orphanRows.data, []);

      // Both RPCs are service_role-only: anon and a signed-in user (who could
      // otherwise pass someone else's p_user_id to a SECURITY INVOKER
      // function limited only by RLS) are both refused.
      const anon = createClient(
        localIntegrationEnvironment!.url,
        localIntegrationEnvironment!.anonKey,
        { auth: { persistSession: false, autoRefreshToken: false } },
      );
      const password = `pw-${crypto.randomUUID()}`;
      const signedInEmail = `pr57-auth-${crypto.randomUUID()}@example.invalid`;
      const signedInUser = await fixture.admin.auth.admin.createUser({
        email: signedInEmail,
        password,
        email_confirm: true,
      });
      if (signedInUser.error || !signedInUser.data.user) {
        throw new Error("authenticated fixture creation failed");
      }
      authenticatedUserId = signedInUser.data.user.id;
      const authenticated = createClient(
        localIntegrationEnvironment!.url,
        localIntegrationEnvironment!.anonKey,
        { auth: { persistSession: false, autoRefreshToken: false } },
      );
      const signIn = await authenticated.auth.signInWithPassword({
        email: signedInEmail,
        password,
      });
      if (signIn.error || !signIn.data.session) {
        throw new Error("authenticated sign-in failed");
      }
      for (const [role, client] of [["anon", anon], ["authenticated", authenticated]] as const) {
        for (const [name, args] of [
          ["upsert_set_derived_personal_records", {
            p_user_id: fixture.ownerId,
            p_rows: [{ ...identity, session_id: null, value: 1 }],
          }],
          ["get_personal_record_identity_candidates", {
            p_user_id: fixture.ownerId,
            p_achieved_at: ["2026-01-20T10:00:00.000Z"],
          }],
        ] as const) {
          const denied = await client.rpc(name, args);
          assert(denied.error, `${name} must not be executable by ${role}`);
          assertEquals(denied.error.code, "42501", `${role} ${name}`);
        }
      }
    } finally {
      if (authenticatedUserId) {
        await fixture.admin.auth.admin.deleteUser(authenticatedUserId);
      }
      await fixture.admin.from("personal_records")
        .delete()
        .in("user_id", [fixture.ownerId, fixture.otherUserId]);
      await cleanupLocalIntegrationFixture(fixture);
    }
  },
});
// ---------------------------------------------------------------------------
// PR 20 (F-009): replace_session_children keeps stored telemetry when a
// session is re-pushed without it. Real SQL against the local stack.
// Key rule: tier 1 = stable exercise row id + set_number; tier 2 (only for
// exercise ids absent on the other side) = identity + order_index +
// set_number; both unique on old and new side.
// Current mobile wire shape (PortalSyncAdapter.kt): one set per exercise with
// set_number 1, exercise id = stable mobile session id, fresh set ids per push.
// ---------------------------------------------------------------------------

interface ChildPushExercise {
  /** Exercise row id; stable across pushes on current mobile. */
  id: string;
  catalogId: string | null;
  name: string;
  orderIndex: number;
  /** One entry per set: set_number and how many telemetry samples to send. */
  sets: Array<{ setNumber: number; telemetry: number }>;
}

interface ChildPushResult {
  /** setIds[exerciseIndex][setIndex] */
  setIds: string[][];
  preserved: number;
}

async function createTelemetrySession(
  fixture: LocalIntegrationFixture,
): Promise<string> {
  const sessionId = crypto.randomUUID();
  const inserted = await fixture.admin.from("workout_sessions").insert({
    id: sessionId,
    user_id: fixture.ownerId,
    started_at: new Date().toISOString(),
  });
  if (inserted.error) throw new Error("session fixture creation failed");
  return sessionId;
}

async function pushSessionChildren(
  fixture: LocalIntegrationFixture,
  sessionId: string,
  exercises: ChildPushExercise[],
): Promise<ChildPushResult> {
  const exerciseRows: Record<string, unknown>[] = [];
  const setRows: Record<string, unknown>[] = [];
  const telemetryRows: Record<string, unknown>[] = [];
  const setIds: string[][] = [];
  for (const exercise of exercises) {
    exerciseRows.push({
      id: exercise.id,
      session_id: sessionId,
      user_id: fixture.ownerId,
      name: exercise.name,
      exercise_id: exercise.catalogId,
      muscle_group: "General",
      order_index: exercise.orderIndex,
    });
    const ids: string[] = [];
    for (const set of exercise.sets) {
      const setId = crypto.randomUUID();
      ids.push(setId);
      setRows.push({
        id: setId,
        exercise_id: exercise.id,
        user_id: fixture.ownerId,
        set_number: set.setNumber,
        target_reps: 10,
        actual_reps: 10,
        weight_kg: 20,
        rpe: null,
        is_pr: false,
        notes: null,
        workout_mode: "OLD_SCHOOL",
      });
      for (let i = 0; i < set.telemetry; i++) {
        telemetryRows.push({
          id: crypto.randomUUID(),
          set_id: setId,
          user_id: fixture.ownerId,
          timestamp_ms: i * 10,
          force_n: 100 + i,
          velocity_mps: 0.5,
          position_mm: 250,
          cable: "A",
        });
      }
    }
    setIds.push(ids);
  }
  const result = await fixture.admin.rpc("replace_session_children", {
    p_user_id: fixture.ownerId,
    p_session_ids: [sessionId],
    p_exercises: exerciseRows,
    p_sets: setRows,
    p_rep_summaries: [],
    p_rep_telemetry: telemetryRows,
  });
  if (result.error) {
    throw new Error(`replace_session_children failed: ${result.error.message}`);
  }
  const data = result.data as Record<string, unknown>;
  return { setIds, preserved: Number(data.rep_telemetry_preserved) };
}

/** Sorted telemetry ids per set id, for the given set ids. */
async function telemetryIdsBySet(
  fixture: LocalIntegrationFixture,
  setIds: string[],
): Promise<Record<string, string[]>> {
  const rows = await fixture.admin.from("rep_telemetry")
    .select("id,set_id")
    .in("set_id", setIds);
  if (rows.error) throw new Error("telemetry verification query failed");
  const bySet: Record<string, string[]> = {};
  for (const setId of setIds) bySet[setId] = [];
  for (const row of rows.data as Array<{ id: string; set_id: string }>) {
    bySet[row.set_id].push(row.id);
  }
  for (const setId of setIds) bySet[setId].sort();
  return bySet;
}

/** Telemetry rows owned by the fixture user (one session per test). */
async function telemetryCount(
  fixture: LocalIntegrationFixture,
): Promise<number> {
  const rows = await fixture.admin.from("rep_telemetry")
    .select("id", { count: "exact", head: true })
    .eq("user_id", fixture.ownerId);
  if (rows.error || rows.count === null) {
    throw new Error("telemetry count query failed");
  }
  return rows.count;
}

Deno.test({
  name:
    "integration: mobile-shaped re-push without telemetry keeps each repeated set's telemetry; new telemetry replaces; removed set loses only its own",
  ignore: localIntegrationEnvironment === null,
  fn: async () => {
    const fixture = await createLocalIntegrationFixture();
    try {
      const sessionId = await createTelemetrySession(fixture);
      // Three sets of the same catalog exercise = three portal exercises with
      // stable ids, one set each numbered 1.
      const exerciseIds = [
        crypto.randomUUID(),
        crypto.randomUUID(),
        crypto.randomUUID(),
      ];
      const routine = (
        telemetry: number[],
        keep = [0, 1, 2],
      ): ChildPushExercise[] =>
        keep.map((index, orderIndex) => ({
          id: exerciseIds[index],
          catalogId: null,
          name: "Bench Press",
          orderIndex,
          sets: [{ setNumber: 1, telemetry: telemetry[index] }],
        }));

      const first = await pushSessionChildren(
        fixture,
        sessionId,
        routine([2, 1, 3]),
      );
      const firstBySet = await telemetryIdsBySet(fixture, first.setIds.flat());
      assertEquals(await telemetryCount(fixture), 6);

      // Re-push without telemetry: count unchanged, each set keeps its own.
      const second = await pushSessionChildren(
        fixture,
        sessionId,
        routine([0, 0, 0]),
      );
      assertEquals(second.preserved, 6);
      assertEquals(await telemetryCount(fixture), 6);
      const secondBySet = await telemetryIdsBySet(
        fixture,
        second.setIds.flat(),
      );
      for (let i = 0; i < 3; i++) {
        assertEquals(
          secondBySet[second.setIds[i][0]],
          firstBySet[first.setIds[i][0]],
        );
      }

      // New telemetry for the middle set replaces only its curve.
      const third = await pushSessionChildren(
        fixture,
        sessionId,
        routine([0, 4, 0]),
      );
      const thirdBySet = await telemetryIdsBySet(fixture, third.setIds.flat());
      assertEquals(thirdBySet[third.setIds[1][0]].length, 4);
      assertEquals(
        thirdBySet[third.setIds[0][0]],
        firstBySet[first.setIds[0][0]],
      );
      assertEquals(
        thirdBySet[third.setIds[2][0]],
        firstBySet[first.setIds[2][0]],
      );
      assertEquals(await telemetryCount(fixture), 9);

      // Middle set deleted on mobile: the third exercise moves to
      // order_index 1 and still keeps its curve by stable id.
      const fourth = await pushSessionChildren(
        fixture,
        sessionId,
        routine([0, 0, 0], [0, 2]),
      );
      const fourthBySet = await telemetryIdsBySet(
        fixture,
        fourth.setIds.flat(),
      );
      assertEquals(
        fourthBySet[fourth.setIds[0][0]],
        firstBySet[first.setIds[0][0]],
      );
      assertEquals(
        fourthBySet[fourth.setIds[1][0]],
        firstBySet[first.setIds[2][0]],
      );
      assertEquals(await telemetryCount(fixture), 5);
    } finally {
      await cleanupLocalIntegrationFixture(fixture);
    }
  },
});

Deno.test({
  name:
    "integration: legacy regenerated exercise ids re-link only on a unique identity and position",
  ignore: localIntegrationEnvironment === null,
  fn: async () => {
    const fixture = await createLocalIntegrationFixture();
    try {
      const sessionId = await createTelemetrySession(fixture);
      const legacy = (telemetry: number): ChildPushExercise[] => [
        // Same exercise twice, both defaulted to order_index 0: ambiguous.
        {
          id: crypto.randomUUID(),
          catalogId: null,
          name: "Bench Press",
          orderIndex: 0,
          sets: [{ setNumber: 1, telemetry }],
        },
        {
          id: crypto.randomUUID(),
          catalogId: null,
          name: "bench press ",
          orderIndex: 0,
          sets: [{ setNumber: 1, telemetry }],
        },
        // Unique identity + position: re-linked.
        {
          id: crypto.randomUUID(),
          catalogId: null,
          name: "Cable Row",
          orderIndex: 1,
          sets: [{ setNumber: 1, telemetry }],
        },
      ];
      const first = await pushSessionChildren(fixture, sessionId, legacy(2));
      const firstBySet = await telemetryIdsBySet(fixture, first.setIds.flat());
      assertEquals(await telemetryCount(fixture), 6);

      const repush = await pushSessionChildren(fixture, sessionId, legacy(0));
      assertEquals(repush.preserved, 2);
      assertEquals(await telemetryCount(fixture), 2);
      const repushBySet = await telemetryIdsBySet(
        fixture,
        repush.setIds.flat(),
      );
      assertEquals(
        repushBySet[repush.setIds[2][0]],
        firstBySet[first.setIds[2][0]],
      );
    } finally {
      await cleanupLocalIntegrationFixture(fixture);
    }
  },
});

/**
 * The real push handler wired to the local stack: every table read/write and
 * RPC goes to real SQL through the service-role client; only auth (fixed to
 * the fixture owner) and the realtime broadcast are stubbed.
 */
function makeRealSqlPushHandler(
  fixture: LocalIntegrationFixture,
): (req: Request) => Promise<Response> {
  const admin = {
    from: (table: string) => fixture.admin.from(table),
    rpc: (name: string, args: Record<string, unknown> = {}) =>
      fixture.admin.rpc(name, args),
    channel() {
      return {
        subscribe(callback: (status: string) => void) {
          callback("SUBSCRIBED");
          return {};
        },
        async send() {
          return "ok";
        },
      };
    },
    async removeChannel() {
      return "ok";
    },
  };
  return createMobileSyncPushHandler({
    createAuthClient() {
      return {
        auth: {
          async getUser() {
            return { data: { user: { id: fixture.ownerId } }, error: null };
          },
        },
      };
    },
    createAdminClient() {
      return admin;
    },
    logOperationalFailure: () => {},
    now: () => Date.now(),
  } as never);
}

Deno.test({
  name:
    "integration: handler re-push with regenerated set ids and no telemetry keeps stored telemetry",
  ignore: localIntegrationEnvironment === null,
  fn: async () => {
    const fixture = await createLocalIntegrationFixture();
    try {
      const subscription = await fixture.admin.from("subscriptions").insert({
        user_id: fixture.ownerId,
        tier: "INFERNO",
        status: "active",
        current_period_end: new Date(Date.now() + 86_400_000).toISOString(),
      });
      if (subscription.error) {
        throw new Error("subscription fixture creation failed");
      }
      const catalog = await fixture.admin.from("exercise_catalog")
        .select("id,name")
        .eq("is_custom", false)
        .limit(1)
        .single();
      if (catalog.error) throw new Error("catalog lookup failed");
      const catalogName = (catalog.data as { name: string }).name;
      const catalogId = (catalog.data as { id: string }).id;

      // Mobile shape: routine session, one set per exercise numbered 1,
      // stable exercise ids; the catalog exercise is repeated and resolved by
      // name on the server, the custom one stays name-only.
      const sessionId = crypto.randomUUID();
      const exercises = [
        { id: crypto.randomUUID(), name: catalogName },
        { id: crypto.randomUUID(), name: catalogName },
        { id: crypto.randomUUID(), name: "PR20 Custom Pulldown" },
      ];
      const buildBody = (withTelemetry: boolean) => {
        const setIds = exercises.map(() => crypto.randomUUID());
        const telemetry = withTelemetry
          ? setIds.flatMap((setId, index) =>
            Array.from({ length: index + 1 }, (_, sample) => ({
              id: crypto.randomUUID(),
              setId,
              timestampMs: sample * 10,
              forceN: 100 + sample,
              velocityMps: 0.5,
              positionMm: 250,
              cable: "A",
            }))
          )
          : [];
        return {
          setIds,
          body: {
            ...validPushBody(),
            profileId: fixture.profileId,
            sessions: [{
              id: sessionId,
              userId: fixture.ownerId,
              name: "PR20 routine",
              startedAt: "2026-09-18T10:00:00.000Z",
              updatedAt: new Date().toISOString(),
              exercises: exercises.map((exercise, index) => ({
                id: exercise.id,
                sessionId,
                exerciseId: null,
                name: exercise.name,
                orderIndex: index,
                sets: [{
                  id: setIds[index],
                  exerciseId: exercise.id,
                  setNumber: 1,
                  targetReps: 10,
                  actualReps: 10,
                  weightKg: 20,
                  workoutMode: "OLD_SCHOOL",
                  repSummaries: [],
                }],
              })),
            }],
            telemetry,
          },
        };
      };

      const handler = makeRealSqlPushHandler(fixture);
      const first = buildBody(true);
      const firstResponse = await handler(requestFromBody(first.body));
      assertEquals(firstResponse.status, 200, await firstResponse.text());
      const firstBySet = await telemetryIdsBySet(fixture, first.setIds);
      assertEquals(
        first.setIds.map((setId) => firstBySet[setId].length),
        [1, 2, 3],
      );
      const stored = await fixture.admin.from("exercises")
        .select("id,exercise_id")
        .eq("session_id", sessionId);
      if (stored.error) throw new Error("exercise verification failed");
      const storedCatalogIds = new Map(
        (stored.data as Array<{ id: string; exercise_id: string | null }>)
          .map((row) => [row.id, row.exercise_id]),
      );
      assertEquals(storedCatalogIds.get(exercises[0].id), catalogId);
      assertEquals(storedCatalogIds.get(exercises[1].id), catalogId);
      assertEquals(storedCatalogIds.get(exercises[2].id), null);

      const second = buildBody(false);
      const secondResponse = await handler(requestFromBody(second.body));
      assertEquals(secondResponse.status, 200, await secondResponse.text());
      assertEquals(await telemetryCount(fixture), 6);
      const secondBySet = await telemetryIdsBySet(fixture, second.setIds);
      for (let i = 0; i < exercises.length; i++) {
        assertEquals(
          secondBySet[second.setIds[i]],
          firstBySet[first.setIds[i]],
        );
      }
    } finally {
      await cleanupLocalIntegrationFixture(fixture);
    }
  },
});

Deno.test({
  name:
    "integration: pushed external activity stores server synced_at so a later pull cursor still sees it",
  ignore: localIntegrationEnvironment === null,
  fn: async () => {
    const fixture = await createLocalIntegrationFixture();
    const activityId = crypto.randomUUID();
    try {
      const subscription = await fixture.admin.from("subscriptions").insert({
        user_id: fixture.ownerId,
        tier: "EMBER",
        status: "active",
        current_period_end: "2099-01-01T00:00:00.000Z",
      });
      if (subscription.error) {
        throw new Error(
          `subscription fixture failed: ${subscription.error.code} ${subscription.error.message}`,
        );
      }
      // A device's last pull cursor, taken from the server clock just
      // before another device pushes an activity with an older client
      // syncedAt. The pull filters `synced_at > lastSync`.
      const otherDeviceLastSync = Date.now() - 1_000;
      const handler = createMobileSyncPushHandler({
        createAuthClient() {
          return {
            auth: {
              async getUser() {
                return { data: { user: { id: fixture.ownerId } }, error: null };
              },
            },
          };
        },
        createAdminClient() {
          // Real SQL for every read/write; only the Realtime broadcast is
          // stubbed so the test leaks no websocket or timer.
          const broadcastStub = {
            channel() {
              return {
                subscribe(callback: (status: string) => void) {
                  callback("SUBSCRIBED");
                  return {};
                },
                async send() {
                  return "ok";
                },
              };
            },
            async removeChannel() {
              return "ok";
            },
          };
          return new Proxy(fixture.admin, {
            get(target, property, receiver) {
              if (property === "channel" || property === "removeChannel") {
                return broadcastStub[property];
              }
              const value = Reflect.get(target, property, receiver);
              return typeof value === "function" ? value.bind(target) : value;
            },
          });
        },
        logOperationalFailure() {},
        now: () => Date.now(),
      } as never);
      const response = await handler(requestFromBody({
        ...validPushBody(),
        externalActivities: [{
          id: activityId,
          externalId: `pr72-${activityId}`,
          provider: "hevy",
          name: "Imported workout",
          activityType: "strength",
          startedAt: "2020-01-01T00:00:00.000Z",
          durationSeconds: 600,
          syncedAt: "2020-01-01T00:05:00.000Z",
        }],
      }));
      const body = await json(response);
      assertEquals(response.status, 200, JSON.stringify(body));

      const stored = await fixture.admin.from("external_activities")
        .select("synced_at")
        .eq("user_id", fixture.ownerId)
        .eq("external_id", `pr72-${activityId}`)
        .single();
      if (stored.error) {
        throw new Error(
          `external activity read failed: ${stored.error.code} ${stored.error.message}`,
        );
      }
      const storedSyncedAt = Date.parse(stored.data.synced_at as string);
      assert(
        storedSyncedAt > otherDeviceLastSync,
        `synced_at ${stored.data.synced_at} must be server time, not the client value`,
      );
      assert(storedSyncedAt <= Date.parse(body.syncTime as string));

      const visible = await fixture.admin.from("external_activities")
        .select("id", { count: "exact", head: true })
        .eq("user_id", fixture.ownerId)
        .gt("synced_at", new Date(otherDeviceLastSync).toISOString());
      if (visible.error) {
        throw new Error(
          `pull-cursor query failed: ${visible.error.code} ${visible.error.message}`,
        );
      }
      assertEquals(visible.count, 1);
    } finally {
      const activities = await fixture.admin.from("external_activities")
        .delete()
        .eq("user_id", fixture.ownerId);
      const subscriptions = await fixture.admin.from("subscriptions")
        .delete()
        .eq("user_id", fixture.ownerId);
      const rateLimits = await fixture.admin.from("rate_limit_tracking")
        .delete()
        .eq("user_id", fixture.ownerId);
      await cleanupLocalIntegrationFixture(fixture);
      for (
        const [label, result] of [
          ["external_activities", activities],
          ["subscriptions", subscriptions],
          ["rate_limit_tracking", rateLimits],
        ] as const
      ) {
        if (result.error) {
          throw new Error(
            `${label} cleanup failed: ${result.error.code} ${result.error.message}`,
          );
        }
      }
    }
  },
});

// ---------------------------------------------------------------------------
// PR 24 (F-069): an edited or re-pushed session refreshes its
// exercise_progress rows inside replace_session_children (p_progress).
// ---------------------------------------------------------------------------

interface ProgressRowSnapshot {
  exercise_name: string;
  max_weight_kg: number;
  estimated_1rm_kg: number;
  total_volume_kg: number;
  local_profile_id: string | null;
}

async function progressRowsForSession(
  fixture: LocalIntegrationFixture,
  sessionId: string,
): Promise<ProgressRowSnapshot[]> {
  const rows = await fixture.admin.from("exercise_progress")
    .select(
      "exercise_name,max_weight_kg,estimated_1rm_kg,total_volume_kg,local_profile_id",
    )
    .eq("session_id", sessionId)
    .order("exercise_name");
  if (rows.error) throw new Error("progress verification query failed");
  return (rows.data as Array<Record<string, unknown>>).map((row) => ({
    exercise_name: String(row.exercise_name),
    max_weight_kg: Number(row.max_weight_kg),
    estimated_1rm_kg: Number(row.estimated_1rm_kg),
    total_volume_kg: Number(row.total_volume_kg),
    local_profile_id: row.local_profile_id as string | null,
  }));
}

Deno.test({
  name:
    "integration: handler re-push refreshes exercise_progress after a weight edit and drops a removed exercise's row",
  ignore: localIntegrationEnvironment === null,
  fn: async () => {
    const fixture = await createLocalIntegrationFixture();
    try {
      const subscription = await fixture.admin.from("subscriptions").insert({
        user_id: fixture.ownerId,
        tier: "INFERNO",
        status: "active",
        current_period_end: new Date(Date.now() + 86_400_000).toISOString(),
      });
      if (subscription.error) {
        throw new Error("subscription fixture creation failed");
      }

      // Custom (name-only) exercises: A has no mobile estimate, so the
      // hybrid fallback runs; B ships estimatedOneRepMaxKg, stored verbatim.
      const sessionId = crypto.randomUUID();
      const exerciseA = crypto.randomUUID();
      const exerciseB = crypto.randomUUID();
      const buildBody = (
        exercises: Array<{
          id: string;
          name: string;
          weightKg: number;
          estimate?: number;
        }>,
      ) => ({
        ...validPushBody(),
        profileId: fixture.profileId,
        sessions: [{
          id: sessionId,
          userId: fixture.ownerId,
          name: "PR24 session",
          startedAt: "2026-09-18T10:00:00.000Z",
          updatedAt: new Date().toISOString(),
          exercises: exercises.map((exercise, index) => ({
            id: exercise.id,
            sessionId,
            exerciseId: null,
            name: exercise.name,
            orderIndex: index,
            ...(exercise.estimate === undefined
              ? {}
              : { estimatedOneRepMaxKg: exercise.estimate }),
            sets: [{
              id: crypto.randomUUID(),
              exerciseId: exercise.id,
              setNumber: 1,
              targetReps: 10,
              actualReps: 10,
              weightKg: exercise.weightKg,
              workoutMode: "OLD_SCHOOL",
              repSummaries: [],
            }],
          })),
        }],
      });

      const handler = makeRealSqlPushHandler(fixture);
      const first = await handler(requestFromBody(buildBody([
        { id: exerciseA, name: "PR24 Custom Row A", weightKg: 20 },
        { id: exerciseB, name: "PR24 Custom Row B", weightKg: 40, estimate: 50 },
      ])));
      assertEquals(first.status, 200, await first.text());
      assertEquals(await progressRowsForSession(fixture, sessionId), [
        {
          exercise_name: "PR24 Custom Row A",
          max_weight_kg: 20,
          estimated_1rm_kg: 26.67,
          total_volume_kg: 200,
          local_profile_id: fixture.profileId,
        },
        {
          exercise_name: "PR24 Custom Row B",
          max_weight_kg: 40,
          estimated_1rm_kg: 50,
          total_volume_kg: 400,
          local_profile_id: fixture.profileId,
        },
      ]);

      // Edit: A's weight 20 -> 30 (fallback 1RM 40), B's mobile estimate
      // 50 -> 55. Before PR 24 the stale first-push rows were kept.
      const edited = await handler(requestFromBody(buildBody([
        { id: exerciseA, name: "PR24 Custom Row A", weightKg: 30 },
        { id: exerciseB, name: "PR24 Custom Row B", weightKg: 44, estimate: 55 },
      ])));
      const editedBody = await json(edited);
      assertEquals(edited.status, 200, JSON.stringify(editedBody));
      assertEquals(editedBody.exerciseProgressInserted, 2);
      assertEquals(await progressRowsForSession(fixture, sessionId), [
        {
          exercise_name: "PR24 Custom Row A",
          max_weight_kg: 30,
          estimated_1rm_kg: 40,
          total_volume_kg: 300,
          local_profile_id: fixture.profileId,
        },
        {
          exercise_name: "PR24 Custom Row B",
          max_weight_kg: 44,
          estimated_1rm_kg: 55,
          total_volume_kg: 440,
          local_profile_id: fixture.profileId,
        },
      ]);

      // Remove exercise B: its progress row goes, A's stays.
      const removed = await handler(requestFromBody(buildBody([
        { id: exerciseA, name: "PR24 Custom Row A", weightKg: 30 },
      ])));
      assertEquals(removed.status, 200, await removed.text());
      assertEquals(await progressRowsForSession(fixture, sessionId), [
        {
          exercise_name: "PR24 Custom Row A",
          max_weight_kg: 30,
          estimated_1rm_kg: 40,
          total_volume_kg: 300,
          local_profile_id: fixture.profileId,
        },
      ]);
    } finally {
      await cleanupLocalIntegrationFixture(fixture);
    }
  },
});

Deno.test({
  name:
    "integration: the old 6-named-argument replace_session_children call still resolves and leaves exercise_progress untouched",
  ignore: localIntegrationEnvironment === null,
  fn: async () => {
    const fixture = await createLocalIntegrationFixture();
    try {
      const sessionId = await createTelemetrySession(fixture);
      const stored = await fixture.admin.from("exercise_progress").insert({
        user_id: fixture.ownerId,
        exercise_name: "PR24 Stored Progress",
        session_id: sessionId,
        max_weight_kg: 25,
        estimated_1rm_kg: 33.33,
      });
      if (stored.error) throw new Error("progress fixture creation failed");

      // Exactly today's shipping call shape (six named arguments, no
      // p_progress): must not be ambiguous (PGRST203) after the migration.
      const exerciseId = crypto.randomUUID();
      const oldCall = await fixture.admin.rpc("replace_session_children", {
        p_user_id: fixture.ownerId,
        p_session_ids: [sessionId],
        p_exercises: [{
          id: exerciseId,
          session_id: sessionId,
          user_id: fixture.ownerId,
          name: "PR24 Stored Progress",
          exercise_id: null,
          muscle_group: "General",
          order_index: 0,
        }],
        p_sets: [],
        p_rep_summaries: [],
        p_rep_telemetry: [],
      });
      assertEquals(oldCall.error, null);
      assertEquals((oldCall.data as Record<string, unknown>).exercises, 1);
      assertEquals(
        (await progressRowsForSession(fixture, sessionId)).map((row) =>
          row.max_weight_kg
        ),
        [25],
      );

      // With p_progress = [] the session's progress is cleared.
      const newCall = await fixture.admin.rpc("replace_session_children", {
        p_user_id: fixture.ownerId,
        p_session_ids: [sessionId],
        p_exercises: [],
        p_sets: [],
        p_rep_summaries: [],
        p_rep_telemetry: [],
        p_progress: [],
      });
      assertEquals(newCall.error, null);
      assertEquals(await progressRowsForSession(fixture, sessionId), []);
    } finally {
      await cleanupLocalIntegrationFixture(fixture);
    }
  },
});

// Issue #99 regression: top-level catch surfaces underlying error in
// known non-production environments and returns opaque message otherwise.
// Helper: builds the pushed session object shared by every ENVIRONMENT case.
function makePrSession() {
  return {
    id: SESSION_ID,
    userId: VALID_USER_ID,
    startedAt: "2026-01-20T10:00:00.000Z",
    updatedAt: "2026-01-20T10:30:00.000Z",
    workoutMode: "OLD_SCHOOL",
    exercises: [{
      id: EXERCISE_ID,
      sessionId: SESSION_ID,
      name: "Bench Press",
      exerciseId: "bench-press-id",
      muscleGroup: "Chest",
      sets: [{
        id: SET_ID,
        exerciseId: EXERCISE_ID,
        setNumber: 1,
        targetReps: 10,
        actualReps: 10,
        weightKg: 80,
        isPr: true,
        prType: "MAX_WEIGHT",
        prPhase: "COMBINED",
      }],
    }],
  };
}

// Helper: temporarily set ENVIRONMENT, restore it on scope exit.
function withEnvironment<T>(value: string, body: () => Promise<T>): Promise<T> {
  const savedEnv = Deno.env.get("ENVIRONMENT");
  Deno.env.set("ENVIRONMENT", value);
  return (async () => {
    try {
      return await body();
    } finally {
      if (savedEnv !== undefined) {
        Deno.env.set("ENVIRONMENT", savedEnv);
      } else {
        Deno.env.delete("ENVIRONMENT");
      }
    }
  })();
}

const ENV_CASES = [
  { name: "known verbose (development)", env: "development", expectedError: "Batch 2/3 failed: FK violation on personal_records" },
  { name: "production", env: "production", expectedError: "Internal server error" },
  { name: "unknown value (custom-staging)", env: "custom-staging", expectedError: "Internal server error" },
];

for (const tc of ENV_CASES) {
  Deno.test(`Issue #99: top-level catch [${tc.name}] returns ${tc.expectedError}`, async () => {
    const errorMessage = "Batch 2/3 failed: FK violation on personal_records";
    await withEnvironment(tc.env, async () => {
      const harness = makeHarness(async () => VALID_AUTH_RESULT, {
        rpcBehavior: async () => {
          throw new Error(errorMessage);
        },
      });

      const body = validPushBody();
      (body.sessions as Record<string, unknown>[]).push(makePrSession());

      const response = await harness.handler(requestFromBody(body));
      const responseBody = await json(response);

      assertEquals(response.status, 500);
      assertEquals(responseBody.error, tc.expectedError);
    });
  });
}

Deno.test("Issue #99: three-batch epoch-zero Old School history is digested", async () => {
  const sessionId = (index: number) =>
    `00000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`;
  const makeSession = (index: number, epochZero: boolean) => {
    const id = sessionId(index);
    const exerciseId = sessionId(10_000 + index);
    const setId = sessionId(20_000 + index);
    return {
      id,
      userId: VALID_USER_ID,
      name: epochZero ? "Epoch zero workout" : `Workout ${index}`,
      startedAt: epochZero
        ? "1970-01-01T00:00:00.000Z"
        : "2026-01-20T10:00:00.000Z",
      updatedAt: "2026-01-20T10:30:00.000Z",
      workoutMode: "OLD_SCHOOL",
      exercises: [{
        id: exerciseId,
        sessionId: id,
        name: `Bench Press ${index}`,
        exerciseId: `bench-press-${index}`,
        muscleGroup: "Chest",
        sets: [{
          id: setId,
          exerciseId,
          setNumber: 1,
          targetReps: 10,
          actualReps: 10,
          weightKg: 80,
          isPr: epochZero,
          prType: epochZero ? "MAX_WEIGHT" : null,
          prPhase: epochZero ? "COMBINED" : null,
        }],
      }],
    };
  };

  const allSessions = Array.from({ length: 729 }, (_, index) =>
    makeSession(index + 1, index >= 293 && index < 296)
  );
  const batchSizes = [243, 243, 243];
  let offset = 0;
  const harness = makeHarness();

  for (const size of batchSizes) {
    const body = validPushBody();
    body.profileId = "default";
    body.sessions = allSessions.slice(offset, offset + size);
    const response = await harness.handler(requestFromBody(body));
    const responseBody = await json(response);

    assertEquals(response.status, 200);
    assertEquals(responseBody.sessionsInserted, size);
    if (offset === 243) {
      assertEquals(responseBody.personalRecordsInserted, 3);
    }
    offset += size;
  }

  assertEquals(offset, 729);
  // Design K: one `replace_session_children` per batch; its `p_exercises`
  // carries the same per-batch component ids the retired
  // `upsert_workout_sessions_with_components` `p_component_ids` did.
  const replaceCalls = harness.adminRpcCalls.filter((call) =>
    call.name === "replace_session_children"
  );
  assertEquals(replaceCalls.length, 3);
  assertEquals(
    (replaceCalls[0].args.p_exercises as Array<{ id: string }>).map((row) => row.id),
    allSessions.slice(0, 243).flatMap((session) => session.exercises.map((exercise) => exercise.id)),
  );
  const secondBatchExercises = replaceCalls[1].args.p_exercises as Array<Record<string, unknown>>;
  assertEquals(secondBatchExercises.length, 243);
  assertEquals(
    secondBatchExercises.filter((row) =>
      [allSessions[293].id, allSessions[294].id, allSessions[295].id]
        .includes(row.session_id as string)
    ).length,
    3,
  );
});



// PR 58 (F-073, F-039): each client-supplied primary key is probed for
// ownership exactly once, in the up-front directOwnerChecks pass.
const DIRECT_OWNERSHIP_TABLES = [
  "workout_sessions",
  "exercises",
  "sets",
  "rep_summaries",
  "routines",
  "training_cycles",
];

Deno.test("push probes each ownership table exactly once for a nested payload", async () => {
  const harness = makeHarness();
  const response = await harness.handler(
    requestFromBody(validNestedRelationshipBody()),
  );

  assertEquals(response.status, 200);
  for (const table of DIRECT_OWNERSHIP_TABLES) {
    assertEquals(
      harness.ownershipProbeTables.filter((probed) => probed === table).length,
      1,
      `${table} ownership probes`,
    );
  }
  // Design K (KD-6) sends days nested on the merge row (`p_cycles[i].days`):
  // `merge_training_cycles_from_push` upserts them by (cycle_id, day_number)
  // and orphan-prunes in one transaction, so the handler never opens
  // `cycle_days` itself. The claim under test is unchanged — cycle_days is
  // never id-probed — only the mechanism moved into the RPC.
  // Was: `adminFromCalls.filter(... === "cycle_days").length === 2` (the
  // handler-side upsert + orphan prune of the retired Design R path).
  assertEquals(
    harness.adminFromCalls.filter((table) => table === "cycle_days").length,
    0,
    "cycle_days is only upserted by (cycle_id, day_number) and orphan-pruned inside the merge RPC, never id-probed",
  );
  assert(
    harness.adminRpcCalls.some((call) => call.name === "merge_training_cycles_from_push"),
    "the nested days ride on merge_training_cycles_from_push",
  );
});

for (const table of DIRECT_OWNERSHIP_TABLES) {
  Deno.test(`push refuses a ${table} id owned by another user before any write`, async () => {
    const harness = makeHarness(async () => VALID_AUTH_RESULT, {
      foreignOwnedTables: [table],
    });
    const response = await harness.handler(
      requestFromBody(validNestedRelationshipBody()),
    );

    assertEquals(response.status, 400);
    assertEquals(await json(response), {
      error: `Refused: existing ${table} row belongs to another user`,
    });
    assertEquals(
      harness.adminWriteCalls.filter((call) =>
        DIRECT_OWNERSHIP_TABLES.includes(call.table)
      ),
      [],
    );
    assertEquals(
      harness.adminRpcCalls.filter((call) =>
        call.name === "replace_session_children"
      ),
      [],
    );
  });
}

Deno.test("public exercise catalog is fetched once per isolate within the TTL", async () => {
  let nowMs = 1_784_167_200_000;
  const harness = makeHarness(async () => VALID_AUTH_RESULT, {
    now: () => nowMs,
  });
  const push = async () => {
    const body = validPushBody();
    body.profileId = "default";
    body.sessions = [makePrSession()];
    const response = await harness.handler(requestFromBody(body));
    assertEquals(response.status, 200);
  };
  const lookups = () =>
    harness.catalogQueries.map((query) =>
      isPublicCatalogLookup(query)
        ? "public"
        : isCustomCatalogLookup(query)
        ? "custom"
        : "other"
    );

  await push();
  // First push: one public-catalog fetch plus the caller's custom rows.
  assertEquals(lookups(), ["public", "custom"]);

  nowMs += 9 * 60 * 1000;
  await push();
  // Second push in the same isolate: only the caller's custom rows.
  assertEquals(lookups(), ["public", "custom", "custom"]);

  nowMs += 2 * 60 * 1000;
  await push();
  // After the 10-minute TTL the public catalog is fetched again.
  assertEquals(lookups(), ["public", "custom", "custom", "public", "custom"]);
});

Deno.test("catalog lookups filter public rows and the caller's own custom rows", async () => {
  const harness = makeHarness();
  const body = validPushBody();
  body.profileId = "default";
  body.sessions = [makePrSession()];
  const response = await harness.handler(requestFromBody(body));

  assertEquals(response.status, 200);
  const [publicLookup, customLookup] = harness.catalogQueries;
  assertEquals(catalogEqFilters(publicLookup), [["is_custom", false]]);
  assertEquals(catalogEqFilters(customLookup), [
    ["is_custom", true],
    ["user_id", VALID_USER_ID],
  ]);
  for (const lookup of [publicLookup, customLookup]) {
    assert(!lookup.calls.some((call) => call.method === "or"));
    assertEquals(catalogRangeStart(lookup), 0);
  }
});

Deno.test("a library row wins a name tie with the caller's custom row", async () => {
  const harness = makeHarness(async () => VALID_AUTH_RESULT, {
    catalogBehavior: (query) => {
      if (isPublicCatalogLookup(query)) {
        return {
          data: [{ id: "zz-library-bench", name: "Bench Press", is_custom: false }],
          error: null,
        };
      }
      if (isCustomCatalogLookup(query)) {
        // Sorts before the library id, so id order alone would pick it.
        return {
          data: [{
            id: "aa-custom-bench",
            name: "Bench Press",
            is_custom: true,
            user_id: VALID_USER_ID,
          }],
          error: null,
        };
      }
      return undefined;
    },
  });
  const body = validPushBody();
  body.profileId = "default";
  const session = makePrSession();
  session.exercises[0].exerciseId = "unknown-stale-id";
  body.sessions = [session];

  const response = await harness.handler(requestFromBody(body));

  assertEquals(response.status, 200);

  const replace = harness.adminRpcCalls.find((call) =>
    call.name === "replace_session_children"
  );
  assert(replace);
  assertEquals(
    (replace.args.p_exercises as Array<Record<string, unknown>>)[0].exercise_id,
    "zz-library-bench",
  );
});




Deno.test("a failed public catalog fetch is not cached", async () => {
  let failPublic = true;
  const harness = makeHarness(async () => VALID_AUTH_RESULT, {
    catalogBehavior: (query) =>
      isPublicCatalogLookup(query) && failPublic
        ? { data: null, error: { message: "injected catalog failure" } }
        : undefined,
  });
  const push = async () => {
    const body = validPushBody();
    body.profileId = "default";
    body.sessions = [makePrSession()];
    return await harness.handler(requestFromBody(body));
  };

  assertEquals((await push()).status, 500);
  failPublic = false;
  assertEquals((await push()).status, 200);
  assertEquals(
    harness.catalogQueries.filter(isPublicCatalogLookup).length,
    2,
  );
});

Deno.test("a page-2 public catalog failure does not cache page 1", async () => {
  let failPageTwo = true;
  const pageOne = Array.from({ length: 1000 }, (_, index) => ({
    id: `library-${index.toString().padStart(4, "0")}`,
    name: `Library exercise ${index}`,
    is_custom: false,
  }));
  const harness = makeHarness(async () => VALID_AUTH_RESULT, {
    catalogBehavior: (query) => {
      if (!isPublicCatalogLookup(query)) return undefined;
      if (catalogRangeStart(query) === 0) return { data: pageOne, error: null };
      return failPageTwo
        ? { data: null, error: { message: "injected page-2 failure" } }
        : { data: [], error: null };
    },
  });
  const push = async () => {
    const body = validPushBody();
    body.profileId = "default";
    body.sessions = [makePrSession()];
    return await harness.handler(requestFromBody(body));
  };

  assertEquals((await push()).status, 500);
  failPageTwo = false;
  assertEquals((await push()).status, 200);
  assertEquals(
    harness.catalogQueries.filter(isPublicCatalogLookup).map(catalogRangeStart),
    [0, 1000, 0, 1000],
  );
});

Deno.test("a clock that moves backwards treats the public catalog as stale", async () => {
  let nowMs = 1_784_167_200_000;
  const harness = makeHarness(async () => VALID_AUTH_RESULT, {
    now: () => nowMs,
  });
  const push = async () => {
    const body = validPushBody();
    body.profileId = "default";
    body.sessions = [makePrSession()];
    assertEquals((await harness.handler(requestFromBody(body))).status, 200);
  };

  await push();
  nowMs -= 1;
  await push();
  assertEquals(
    harness.catalogQueries.filter(isPublicCatalogLookup).length,
    2,
  );
});

// ---------------------------------------------------------------------------
// PR 58 real-SQL coverage: split catalog filters, isolate cache, and the
// removed cycle_days id probe, against a real PostgREST and Postgres.
// ---------------------------------------------------------------------------

interface CatalogIntegrationFixture {
  admin: SupabaseClient;
  ownerId: string;
  otherUserId: string;
  suffix: string;
}

async function createCatalogIntegrationFixture(): Promise<
  CatalogIntegrationFixture
> {
  assert(localIntegrationEnvironment);
  const admin = createClient(
    localIntegrationEnvironment.url,
    localIntegrationEnvironment.serviceRoleKey,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const suffix = crypto.randomUUID();
  const createdUserIds: string[] = [];
  try {
    for (const role of ["owner", "other"]) {
      const created = await admin.auth.admin.createUser({
        email: `pr58-${role}-${suffix}@example.invalid`,
        email_confirm: true,
      });
      if (created.error || !created.data.user) {
        throw new Error(`${role} fixture creation failed`);
      }
      createdUserIds.push(created.data.user.id);
    }
    const subscription = await admin.from("subscriptions").insert({
      user_id: createdUserIds[0],
      tier: "EMBER",
      status: "active",
      current_period_end: "2099-01-01T00:00:00.000Z",
    });
    if (subscription.error) {
      throw new Error(`subscription fixture failed: ${subscription.error.message}`);
    }
    return {
      admin,
      ownerId: createdUserIds[0],
      otherUserId: createdUserIds[1],
      suffix,
    };
  } catch (error) {
    for (const userId of createdUserIds) {
      await admin.auth.admin.deleteUser(userId);
    }
    throw error;
  }
}
// ---------------------------------------------------------------------------
// KD-4 real-SQL: routine/cycle tombstones through the real push handler.
// Every table write goes to the local stack (no query doubles); only the
// realtime broadcast is stubbed so the test leaves no socket open.
// ---------------------------------------------------------------------------

interface TombstonePushFixture {
  admin: SupabaseClient;
  ownerId: string;
  email: string;
  password: string;
}

const TOMBSTONE_FIXTURE_TABLES = [
  "local_profiles",
  "subscriptions",
  "rate_limit_tracking",
  "sync_tombstones",
];

async function deleteTombstonePushFixture(
  admin: SupabaseClient,
  userIds: string[],
): Promise<void> {
  if (userIds.length === 0) return;
  for (const userId of userIds) {
    // Cascades routines, cycles and their children. The tombstone trigger
    // records nothing for a user whose auth row is gone.
    const deleted = await admin.auth.admin.deleteUser(userId);
    if (deleted.error) throw new Error("auth fixture cleanup failed");
  }
  for (const table of TOMBSTONE_FIXTURE_TABLES) {
    const deleted = await admin.from(table).delete().in("user_id", userIds);
    if (deleted.error) throw new Error(`${table} fixture cleanup failed`);
  }
  for (const table of [...TOMBSTONE_FIXTURE_TABLES, "routines", "training_cycles"]) {
    const audit = await admin.from(table)
      .select("user_id", { count: "exact", head: true })
      .in("user_id", userIds);
    if (audit.error) throw new Error(`${table} cleanup audit failed`);
    assertEquals(audit.count, 0, table);
  }
}

async function createTombstonePushFixture(): Promise<TombstonePushFixture> {
  assert(localIntegrationEnvironment);
  const admin = createClient(
    localIntegrationEnvironment.url,
    localIntegrationEnvironment.serviceRoleKey,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const suffix = crypto.randomUUID();
  const email = `pr16-owner-${suffix}@example.invalid`;
  const password = `pw-${suffix}`;
  const owner = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (owner.error || !owner.data.user) {
    throw new Error("owner fixture creation failed");
  }
  const ownerId = owner.data.user.id;
  try {
    const subscription = await admin.from("subscriptions").insert({
      user_id: ownerId,
      tier: "EMBER",
      status: "active",
      current_period_end: "2099-01-01T00:00:00.000Z",
    });
    if (subscription.error) throw new Error("subscription fixture failed");
    return { admin, ownerId, email, password };
  } catch (error) {
    await deleteTombstonePushFixture(admin, [ownerId]);
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Real-SQL subscription gate (replaces the deleted live FREE-user sync tests):
// the real `subscriptions` table, service-role grants and RLS decide 402 vs
// the write path.
// ---------------------------------------------------------------------------

interface GateFixture {
  admin: SupabaseClient;
  userId: string;
}

async function deleteGateFixture(
  admin: SupabaseClient,
  userId: string,
): Promise<void> {
  for (
    const table of [
      "workout_sessions",
      "local_profiles",
      "subscriptions",
      "rate_limit_tracking",
    ]
  ) {
    const deleted = await admin.from(table).delete().eq("user_id", userId);
    if (deleted.error) throw new Error(`${table} gate fixture cleanup failed`);
  }
  const deleted = await admin.auth.admin.deleteUser(userId);
  if (deleted.error) throw new Error("auth gate fixture cleanup failed");
}

async function createGateFixture(
  subscription: Record<string, unknown> | null,
): Promise<GateFixture> {
  assert(localIntegrationEnvironment);
  const admin = createClient(
    localIntegrationEnvironment.url,
    localIntegrationEnvironment.serviceRoleKey,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const created = await admin.auth.admin.createUser({
    email: `pr6-gate-${crypto.randomUUID()}@example.invalid`,
    email_confirm: true,
  });
  if (created.error || !created.data.user) {
    throw new Error("gate fixture user creation failed");
  }
  const userId = created.data.user.id;
  try {
    if (subscription !== null) {
      const inserted = await admin.from("subscriptions").insert({
        user_id: userId,
        ...subscription,
      });
      if (inserted.error) throw new Error("gate fixture subscription failed");
    }
    return { admin, userId };
  } catch (error) {
    await deleteGateFixture(admin, userId);
    throw error;
  }
}

async function cleanupCatalogIntegrationFixture(
  fixture: CatalogIntegrationFixture,
): Promise<void> {
  // Every pushed row and custom catalog row cascades from auth.users.
  for (const userId of [fixture.ownerId, fixture.otherUserId]) {
    const deleted = await fixture.admin.auth.admin.deleteUser(userId);
    if (deleted.error) throw new Error("auth fixture cleanup failed");
  }
}

function realPushHandler(
  fixture: CatalogIntegrationFixture,
  now: () => number = () => Date.now(),
): (request: Request) => Promise<Response> {
  return createMobileSyncPushHandler({
    createAuthClient() {
      return {
        auth: {
          async getUser() {
            return { data: { user: { id: fixture.ownerId } }, error: null };
          },
        },
      };
    },
    createAdminClient() {
      const admin = Object.create(fixture.admin) as SupabaseClient;
      Object.assign(admin, {
        channel() {
          return {
            subscribe(callback: (status: string) => void) {
              callback("SUBSCRIBED");
              return {};
            },
            async send() {
              return "ok";
            },
          };
        },
        async removeChannel() {
          return "ok";
        },
      });
      return admin;
    },
    logOperationalFailure() {},
    now,
  });
}

function realTombstonePushHandler(
  fixture: TombstonePushFixture,
): (request: Request) => Promise<Response> {
  const admin = fixture.admin;
  const client = {
    from: (table: string) => admin.from(table),
    rpc: (name: string, args?: Record<string, unknown>) => admin.rpc(name, args),
    channel() {
      return {
        subscribe(callback: (status: string) => void) {
          callback("SUBSCRIBED");
          return {};
        },
        async send() {
          return "ok";
        },
      };
    },
    async removeChannel() {
      return "ok";
    },
  };
  return createMobileSyncPushHandler({
    createAuthClient() {
      return {
        auth: {
          async getUser() {
            return { data: { user: { id: fixture.ownerId } }, error: null };
          },
        },
      };
    },
    createAdminClient() {
      return client;
    },
    logOperationalFailure: () => {},
    now: () => Date.now(),
  } as never);
}
// Real-SQL gamification derivation (PR 25). These run the handler against the
// local Supabase stack, so the counters come out of the migrations and not a
// double. The flag is read at module load, so both SYNC_LWW_ENABLED values are
// covered by running the suite once per value.
// ---------------------------------------------------------------------------

/** The handler with the real service-role client; only realtime is stubbed. */
function makeRealSqlHandler(
  fixture: LocalIntegrationFixture,
): (request: Request) => Promise<Response> {
  const admin = {
    from: (table: string) => fixture.admin.from(table),
    rpc: (name: string, args?: Record<string, unknown>) =>
      fixture.admin.rpc(name, args),
    channel: () => ({
      subscribe(callback: (status: string) => void) {
        callback("SUBSCRIBED");
        return {};
      },
      async send() {
        return "ok";
      },
    }),
    async removeChannel() {
      return "ok";
    },
  };
  return createMobileSyncPushHandler({
    createAuthClient() {
      return {
        auth: {
          async getUser() {
            return { data: { user: { id: fixture.ownerId } }, error: null };
          },
        },
      };
    },
    createAdminClient() {
      return admin;
    },
    logOperationalFailure(value: { name: string }) {
      console.error(value);
    },
    now: () => Date.now(),
  } as never);
}

// Real SQL, but the realtime broadcast is recorded instead of opening a
// websocket (which would leak past the test).
function realGatePushHandler(
  fixture: GateFixture,
  broadcastTopics: string[] = [],
): (request: Request) => Promise<Response> {
  const admin = new Proxy(fixture.admin, {
    get(target, property, receiver) {
      if (property === "channel") {
        return (topic: string) => ({
          subscribe(callback: (status: string) => void) {
            callback("SUBSCRIBED");
            return {};
          },
          async send() {
            broadcastTopics.push(topic);
            return "ok";
          },
        });
      }
      if (property === "removeChannel") return async () => "ok";
      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return createMobileSyncPushHandler({
    createAuthClient() {
      return {
        auth: {
          async getUser() {
            return { data: { user: { id: fixture.userId } }, error: null };
          },
        },
      };
    },
    createAdminClient() {
      return admin;
    },
    logOperationalFailure: () => {},
    now: () => 1_784_167_200_000,
  } as never);
}

/** Delete a routine the way the portal does: PostgREST as the signed-in user. */
async function portalDeleteRoutine(
  fixture: TombstonePushFixture,
  routineId: string,
): Promise<void> {
  assert(localIntegrationEnvironment);
  const browser = createClient(
    localIntegrationEnvironment.url,
    localIntegrationEnvironment.anonKey,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const signIn = await browser.auth.signInWithPassword({
    email: fixture.email,
    password: fixture.password,
  });
  if (signIn.error) throw new Error("portal sign-in failed");
  try {
    const deleted = await browser.from("routines")
      .delete({ count: "exact" })
      .eq("id", routineId);
    if (deleted.error) throw new Error("portal routine delete failed");
    assertEquals(deleted.count, 1, "portal delete removed the routine");
  } finally {
    await browser.auth.signOut();
  }
}

/** The shape the shipping mobile build pushes (profile, lastSync, nesting). */
function tombstoneMobilePushBody(
  ids: { routineId: string; exerciseId: string; cycleId: string; dayId: string },
  options: { includeRoutine: boolean; lastSync?: number },
): Record<string, unknown> {
  return {
    ...validPushBody(),
    lastSync: options.lastSync ?? 0,
    profileId: "default",
    profileName: "Default",
    allProfiles: [{ id: "default", name: "Default", colorIndex: 0 }],
    routines: options.includeRoutine
      ? [{
        id: ids.routineId,
        userId: "mobile-local-user",
        name: "Push day",
        description: "",
        exerciseCount: 1,
        estimatedDuration: 1800,
        timesCompleted: 2,
        isFavorite: false,
        exercises: [{
          id: ids.exerciseId,
          routineId: ids.routineId,
          name: "PR16 integration press",
          muscleGroup: "Chest",
          sets: 3,
          reps: 10,
          weight: 20,
          restSeconds: 90,
          mode: "OLD_SCHOOL",
          orderIndex: 0,
        }],
      }]
      : [],
    cycles: [{
      id: ids.cycleId,
      userId: "mobile-local-user",
      name: "PR16 cycle",
      durationWeeks: 1,
      workoutDays: 1,
      restDays: 0,
      currentWeek: 1,
      status: "active",
      days: [{
        id: ids.dayId,
        cycleId: ids.cycleId,
        dayNumber: 1,
        dayType: "workout",
        routineId: ids.routineId,
      }],
    }],
  };
}

/** Rows the account already holds on the server before the scenario. */
async function seedRoutineAndCycle(
  fixture: TombstonePushFixture,
  ids: { routineId: string; cycleId: string },
): Promise<void> {
  const routine = await fixture.admin.from("routines").insert({
    id: ids.routineId,
    user_id: fixture.ownerId,
    name: "Push day",
  });
  if (routine.error) throw new Error("routine seed failed");
  const cycle = await fixture.admin.from("training_cycles").insert({
    id: ids.cycleId,
    user_id: fixture.ownerId,
    name: "PR16 cycle",
  });
  if (cycle.error) throw new Error("cycle seed failed");
  const day = await fixture.admin.from("cycle_days").insert({
    cycle_id: ids.cycleId,
    day_number: 1,
    routine_id: ids.routineId,
  });
  if (day.error) throw new Error("cycle day seed failed");
}

function freshTombstoneIds() {
  return {
    routineId: crypto.randomUUID(),
    exerciseId: crypto.randomUUID(),
    cycleId: crypto.randomUUID(),
    dayId: crypto.randomUUID(),
  };
}

async function storedCycleDayRoutineId(
  fixture: TombstonePushFixture,
  cycleId: string,
): Promise<string | null> {
  const day = await fixture.admin.from("cycle_days")
    .select("routine_id")
    .eq("cycle_id", cycleId)
    .eq("day_number", 1)
    .single();
  if (day.error) throw new Error("cycle day lookup failed");
  return day.data.routine_id as string | null;
}

async function routineCount(
  fixture: TombstonePushFixture,
  routineId: string,
): Promise<number> {
  const audit = await fixture.admin.from("routines")
    .select("id", { count: "exact", head: true })
    .eq("id", routineId);
  if (audit.error) throw new Error("routine audit failed");
  return audit.count ?? -1;
}

Deno.test({
  name:
    `integration: tombstones (LWW=${SYNC_LWW_ENABLED}) old-build push of a portal-deleted routine is 200, skipped, not re-created, day NULL`,
  ignore: localIntegrationEnvironment === null,
  fn: async () => {
    const fixture = await createTombstonePushFixture();
    try {
      const handler = realTombstonePushHandler(fixture);
      const ids = freshTombstoneIds();

      // The account holds a routine and a cycle whose day uses it.
      await seedRoutineAndCycle(fixture, ids);
      assertEquals(await routineCount(fixture, ids.routineId), 1);
      assertEquals(
        await storedCycleDayRoutineId(fixture, ids.cycleId),
        ids.routineId,
      );

      // The user deletes the routine on the portal; the trigger records it.
      await portalDeleteRoutine(fixture, ids.routineId);
      const tombstone = await fixture.admin.from("sync_tombstones")
        .select("entity, entity_id")
        .eq("user_id", fixture.ownerId);
      if (tombstone.error) throw new Error("tombstone lookup failed");
      assertEquals(tombstone.data, [{
        entity: "routine",
        entity_id: ids.routineId,
      }]);

      // An older build that never learned of the delete re-pushes the
      // routine, its exercise and the cycle day that references it.
      const repushed = await handler(requestFromBody(
        tombstoneMobilePushBody(ids, { includeRoutine: true }),
      ));
      const repushedBody = await json(repushed);
      assertEquals(repushed.status, 200, JSON.stringify(repushedBody));
      assertEquals(repushedBody.skippedDeleted, {
        routines: [ids.routineId],
        cycles: [],
      });
      assertEquals(await routineCount(fixture, ids.routineId), 0);
      const exercises = await fixture.admin.from("routine_exercises")
        .select("id", { count: "exact", head: true })
        .eq("id", ids.exerciseId);
      if (exercises.error) throw new Error("exercise audit failed");
      assertEquals(exercises.count, 0);
      assertEquals(await storedCycleDayRoutineId(fixture, ids.cycleId), null);
    } finally {
      await deleteTombstonePushFixture(fixture.admin, [fixture.ownerId]);
    }
  },
});

Deno.test({
  name:
    `integration: tombstones (LWW=${SYNC_LWW_ENABLED}) one push creating routine R and a cycle day on R keeps the reference`,
  ignore: localIntegrationEnvironment === null,
  fn: async () => {
    const fixture = await createTombstonePushFixture();
    try {
      const handler = realTombstonePushHandler(fixture);
      const ids = freshTombstoneIds();
      const response = await handler(requestFromBody(
        tombstoneMobilePushBody(ids, { includeRoutine: true }),
      ));
      const body = await json(response);
      assertEquals(response.status, 200, JSON.stringify(body));
      assertEquals(body.skippedDeleted, { routines: [], cycles: [] });
      assertEquals(await routineCount(fixture, ids.routineId), 1);
      assertEquals(
        await storedCycleDayRoutineId(fixture, ids.cycleId),
        ids.routineId,
      );
    } finally {
      await deleteTombstonePushFixture(fixture.admin, [fixture.ownerId]);
    }
  },
});

Deno.test({
  name:
    `integration: tombstones (LWW=${SYNC_LWW_ENABLED}) real-lastSync push of a cycle whose routine was portal-deleted is 200 with day NULL`,
  ignore: localIntegrationEnvironment === null,
  fn: async () => {
    const fixture = await createTombstonePushFixture();
    try {
      const handler = realTombstonePushHandler(fixture);
      const ids = freshTombstoneIds();
      await seedRoutineAndCycle(fixture, ids);
      await portalDeleteRoutine(fixture, ids.routineId);

      // Routines ship only as a delta; cycles ship every sync.
      const response = await handler(requestFromBody(
        tombstoneMobilePushBody(ids, {
          includeRoutine: false,
          lastSync: Date.now() - 60_000,
        }),
      ));
      const body = await json(response);
      assertEquals(response.status, 200, JSON.stringify(body));
      assertEquals(body.skippedDeleted, { routines: [], cycles: [] });
      assertEquals(await routineCount(fixture, ids.routineId), 0);
      assertEquals(await storedCycleDayRoutineId(fixture, ids.cycleId), null);
    } finally {
      await deleteTombstonePushFixture(fixture.admin, [fixture.ownerId]);
    }
  },
});

Deno.test({
  name:
    `integration: tombstones (LWW=${SYNC_LWW_ENABLED}) a mobile-pushed delete is recorded and a later re-push of that cycle is skipped`,
  ignore: localIntegrationEnvironment === null,
  fn: async () => {
    const fixture = await createTombstonePushFixture();
    try {
      const handler = realTombstonePushHandler(fixture);
      const ids = freshTombstoneIds();
      await seedRoutineAndCycle(fixture, ids);

      // Clocked delete: the legacy `deletedCycleIds` form never writes a
      // tombstone, so the anti-resurrection path it must exercise needs the
      // clocked form.
      const deleteBody = {
        ...validPushBody(),
        deletedCycles: [{
          id: ids.cycleId,
          updatedAt: new Date().toISOString(),
        }],
      };
      const deleted = await handler(requestFromBody(deleteBody));
      const deletedPayload = await json(deleted);
      assertEquals(deleted.status, 200, JSON.stringify(deletedPayload));
      assertEquals(deletedPayload.acknowledgedDeletedCycleIds, [ids.cycleId]);
      const tombstone = await fixture.admin.from("sync_tombstones")
        .select("entity, entity_id")
        .eq("user_id", fixture.ownerId);
      if (tombstone.error) throw new Error("tombstone lookup failed");
      assertEquals(tombstone.data, [{ entity: "cycle", entity_id: ids.cycleId }]);

      // Another device still holds the cycle and pushes it again (its
      // routine is unchanged, so only the cycle ships).
      const repushed = await handler(requestFromBody(
        tombstoneMobilePushBody(ids, { includeRoutine: false }),
      ));
      const repushedBody = await json(repushed);
      assertEquals(repushed.status, 200, JSON.stringify(repushedBody));
      assertEquals(repushedBody.skippedDeleted, {
        routines: [],
        cycles: [ids.cycleId],
      });
      const cycles = await fixture.admin.from("training_cycles")
        .select("id", { count: "exact", head: true })
        .eq("id", ids.cycleId);
      if (cycles.error) throw new Error("cycle audit failed");
      assertEquals(cycles.count, 0);
    } finally {
      await deleteTombstonePushFixture(fixture.admin, [fixture.ownerId]);
    }
  },
});

Deno.test({
  name:
    `integration: tombstones (LWW=${SYNC_LWW_ENABLED}) a deleted routine pushed beside a live routine writes only the live one's exercises`,
  ignore: localIntegrationEnvironment === null,
  fn: async () => {
    const fixture = await createTombstonePushFixture();
    try {
      const handler = realTombstonePushHandler(fixture);
      const deleted = freshTombstoneIds();
      const live = freshTombstoneIds();
      await seedRoutineAndCycle(fixture, deleted);
      await portalDeleteRoutine(fixture, deleted.routineId);

      const deletedBody = tombstoneMobilePushBody(deleted, {
        includeRoutine: true,
      });
      const liveBody = tombstoneMobilePushBody(live, { includeRoutine: true });
      const requestBody = {
        ...deletedBody,
        routines: [
          ...(deletedBody.routines as unknown[]),
          ...(liveBody.routines as unknown[]),
        ],
        cycles: [
          ...(deletedBody.cycles as unknown[]),
          // Only one active cycle is allowed per user.
          ...(liveBody.cycles as Record<string, unknown>[]).map((cycle) => ({
            ...cycle,
            status: "draft",
          })),
        ],
      };
      const response = await handler(requestFromBody(requestBody));
      const body = await json(response);
      assertEquals(response.status, 200, JSON.stringify(body));
      assertEquals(body.skippedDeleted, {
        routines: [deleted.routineId],
        cycles: [],
      });
      assertEquals(await routineCount(fixture, deleted.routineId), 0);
      assertEquals(await routineCount(fixture, live.routineId), 1);
      const exercises = await fixture.admin.from("routine_exercises")
        .select("id")
        .in("id", [deleted.exerciseId, live.exerciseId]);
      if (exercises.error) throw new Error("exercise audit failed");
      assertEquals(exercises.data, [{ id: live.exerciseId }]);
      assertEquals(await storedCycleDayRoutineId(fixture, deleted.cycleId), null);
      assertEquals(
        await storedCycleDayRoutineId(fixture, live.cycleId),
        live.routineId,
      );
    } finally {
      await deleteTombstonePushFixture(fixture.admin, [fixture.ownerId]);
    }
  },
});

// ---------------------------------------------------------------------------
// KD-6 (PR 18): real-SQL cycle merge through the push handler, under the
// SYNC_LWW_ENABLED value of the run (CI runs both). Portal edits go through
// PostgREST as the signed-in user, so the portal_edited_at triggers fire as
// they do in production; the push uses the service role.
// ---------------------------------------------------------------------------

type CycleRow = Record<string, unknown>;

/** Run `body` with a PostgREST client signed in as the fixture owner. */
async function asPortalUser<T>(
  fixture: TombstonePushFixture,
  body: (browser: SupabaseClient) => Promise<T>,
): Promise<T> {
  assert(localIntegrationEnvironment);
  const browser = createClient(
    localIntegrationEnvironment.url,
    localIntegrationEnvironment.anonKey,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const signIn = await browser.auth.signInWithPassword({
    email: fixture.email,
    password: fixture.password,
  });
  if (signIn.error) throw new Error("portal sign-in failed");
  try {
    return await body(browser);
  } finally {
    await browser.auth.signOut();
  }
}

async function storedCycle(
  fixture: TombstonePushFixture,
  cycleId: string,
): Promise<CycleRow> {
  const cycle = await fixture.admin.from("training_cycles")
    .select("*")
    .eq("id", cycleId)
    .single();
  if (cycle.error) throw new Error(`cycle lookup failed: ${cycle.error.message}`);
  return cycle.data as CycleRow;
}

async function storedDays(
  fixture: TombstonePushFixture,
  cycleId: string,
): Promise<CycleRow[]> {
  const days = await fixture.admin.from("cycle_days")
    .select("day_number, day_type, routine_id, weight_adjustment, rep_modifier, rest_override, rest_type, notes")
    .eq("cycle_id", cycleId)
    .order("day_number", { ascending: true });
  if (days.error) throw new Error("cycle days lookup failed");
  return days.data as CycleRow[];
}

async function seedRoutines(
  fixture: TombstonePushFixture,
  count: number,
): Promise<string[]> {
  const ids = Array.from({ length: count }, () => crypto.randomUUID());
  const inserted = await fixture.admin.from("routines").insert(
    ids.map((id, index) => ({ id, user_id: fixture.ownerId, name: `R${index + 1}` })),
  );
  if (inserted.error) throw new Error("routine seed failed");
  return ids;
}

/** Service-role seed of a 4-day cycle, day N using routines[N-1]. */
async function seedFourDayCycle(
  fixture: TombstonePushFixture,
  cycleId: string,
  routineIds: string[],
): Promise<void> {
  const cycle = await fixture.admin.from("training_cycles").insert({
    id: cycleId,
    user_id: fixture.ownerId,
    name: "Seeded cycle",
    description: "",
    duration_weeks: 1,
    workout_days: 4,
    rest_days: 0,
    status: "draft",
  });
  if (cycle.error) throw new Error("cycle seed failed");
  const days = await fixture.admin.from("cycle_days").insert(
    [1, 2, 3, 4].map((n) => ({
      cycle_id: cycleId,
      day_number: n,
      routine_id: routineIds[n - 1],
    })),
  );
  if (days.error) throw new Error("cycle day seed failed");
}

/**
 * The shape the shipping mobile adapter pushes for a cycle
 * (PortalSyncAdapter.toPortalTrainingCycle): derived durationWeeks, null
 * deload, stringly progression, null restType. updatedAt is set ahead of the
 * server clock so the LWW gate (flag on) accepts it.
 */
function mobileCyclePush(
  cycleId: string,
  name: string,
  days: Array<{ dayNumber: number; routineId: string | null }>,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    ...validPushBody(),
    lastSync: Date.now() - 60_000,
    profileId: "default",
    profileName: "Default",
    allProfiles: [{ id: "default", name: "Default", colorIndex: 0 }],
    routines: [],
    cycles: [{
      id: cycleId,
      userId: "mobile-local-user",
      name,
      description: "",
      templateId: null,
      durationWeeks: days.length === 0 ? 1 : Math.ceil(days.length / 7),
      workoutDays: days.length,
      restDays: 0,
      currentWeek: 1,
      status: "draft",
      updatedAt: new Date(Date.now() + 60_000).toISOString(),
      progressionSettings: null,
      deloadSettings: null,
      days: days.map((day) => ({
        id: crypto.randomUUID(),
        cycleId,
        dayNumber: day.dayNumber,
        dayType: "workout",
        routineId: day.routineId,
        weightAdjustment: 0,
        repModifier: 0,
        restOverride: null,
        restType: null,
        notes: null,
      })),
      ...extra,
    }],
  };
}

async function pushOk(
  handler: (request: Request) => Promise<Response>,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const response = await handler(requestFromBody(body));
  const responseBody = await json(response);
  assertEquals(response.status, 200, JSON.stringify(responseBody));
  return responseBody;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

Deno.test({
  name:
    `integration: cycle merge (LWW=${SYNC_LWW_ENABLED}) a mobile push keeps portal deload, progression keys, rest_type and duration`,
  ignore: localIntegrationEnvironment === null,
  fn: async () => {
    const fixture = await createTombstonePushFixture();
    try {
      const handler = realTombstonePushHandler(fixture);
      const cycleId = crypto.randomUUID();
      const routineIds = await seedRoutines(fixture, 4);

      // Authored on the portal: 8 weeks, deload, a portal-only progression
      // key, and a rest_type on day 2.
      await asPortalUser(fixture, async (browser) => {
        const cycle = await browser.from("training_cycles").insert({
          id: cycleId,
          user_id: fixture.ownerId,
          name: "Portal block",
          description: "",
          duration_weeks: 8,
          workout_days: 4,
          rest_days: 0,
          status: "draft",
          deload_settings: { week: 4, volumePercent: 60 },
          progression_settings: { frequencyCycles: "1", portalAutoRegulate: true },
        });
        if (cycle.error) throw new Error(`portal cycle insert failed: ${cycle.error.message}`);
        const days = await browser.from("cycle_days").insert(
          [1, 2, 3, 4].map((n) => ({
            cycle_id: cycleId,
            day_number: n,
            routine_id: routineIds[n - 1],
            rest_type: n === 2 ? "active_recovery" : null,
          })),
        );
        if (days.error) throw new Error(`portal day insert failed: ${days.error.message}`);
      });
      const portalAuthored = await storedCycle(fixture, cycleId);
      assert(portalAuthored.portal_edited_at !== null, "portal insert stamps portal_edited_at");

      // The phone pushes it back (legacy build: no base) with its derived
      // defaults and a changed mobile progression key.
      const body = mobileCyclePush(
        cycleId,
        "Portal block",
        [1, 2, 3, 4].map((n) => ({ dayNumber: n, routineId: routineIds[n - 1] })),
        { progressionSettings: '{"frequencyCycles":"3"}' },
      );
      const response = await pushOk(handler, body);
      assertEquals(response.cyclesUpserted, 1);

      const merged = await storedCycle(fixture, cycleId);
      assertEquals(merged.duration_weeks, 8);
      assertEquals(merged.deload_settings, { week: 4, volumePercent: 60 });
      // The portal-only key survives; the PR 19 normalize trigger stores
      // every value as a string for mobile's Map<String, String> decode.
      assertEquals(merged.progression_settings, {
        frequencyCycles: "3",
        portalAutoRegulate: "true",
      });
      assertEquals(merged.portal_edited_at, portalAuthored.portal_edited_at);
      const days = await storedDays(fixture, cycleId);
      assertEquals(days.map((d) => d.rest_type), [null, "active_recovery", null, null]);
      assertEquals(days.map((d) => d.routine_id), routineIds);

      // A non-derived duration from the phone is still applied.
      await pushOk(handler, mobileCyclePush(
        cycleId,
        "Portal block",
        [1, 2, 3, 4].map((n) => ({ dayNumber: n, routineId: routineIds[n - 1] })),
        { durationWeeks: 6 },
      ));
      assertEquals((await storedCycle(fixture, cycleId)).duration_weeks, 6);
    } finally {
      await deleteTombstonePushFixture(fixture.admin, [fixture.ownerId]);
    }
  },
});

Deno.test({
  name:
    `integration: cycle merge (LWW=${SYNC_LWW_ENABLED}) a current-base push deletes a removed middle day; a legacy push keeps it`,
  ignore: localIntegrationEnvironment === null,
  fn: async () => {
    const fixture = await createTombstonePushFixture();
    try {
      const handler = realTombstonePushHandler(fixture);
      const routineIds = await seedRoutines(fixture, 4);
      const withoutDay3 = [1, 2, 4].map((n) => ({
        dayNumber: n,
        routineId: routineIds[n - 1],
      }));

      // Legacy build (no baseUpdatedAt): only days above the payload max go.
      const legacyCycleId = crypto.randomUUID();
      await seedFourDayCycle(fixture, legacyCycleId, routineIds);
      const legacy = await pushOk(handler, mobileCyclePush(legacyCycleId, "Seeded cycle", withoutDay3));
      assertEquals(
        (await storedDays(fixture, legacyCycleId)).map((d) => d.day_number),
        [1, 2, 3, 4],
      );
      assert(
        typeof (legacy.cycleVersions as Record<string, unknown>)[legacyCycleId] === "string",
        "a legacy push still reports the version",
      );

      // Current base (the device's last pulled updatedAt).
      const currentCycleId = crypto.randomUUID();
      await seedFourDayCycle(fixture, currentCycleId, routineIds);
      const base = String((await storedCycle(fixture, currentCycleId)).updated_at);
      await pushOk(handler, mobileCyclePush(currentCycleId, "Seeded cycle", withoutDay3, {
        baseUpdatedAt: base,
      }));
      assertEquals(
        (await storedDays(fixture, currentCycleId)).map((d) => d.day_number),
        [1, 2, 4],
      );
    } finally {
      await deleteTombstonePushFixture(fixture.admin, [fixture.ownerId]);
    }
  },
});

Deno.test({
  name:
    `integration: cycle merge (LWW=${SYNC_LWW_ENABLED}) a portal edit after the device's base survives a stale push`,
  ignore: localIntegrationEnvironment === null,
  fn: async () => {
    const fixture = await createTombstonePushFixture();
    try {
      const handler = realTombstonePushHandler(fixture);
      const routineIds = await seedRoutines(fixture, 5);
      const cycleId = crypto.randomUUID();
      await seedFourDayCycle(fixture, cycleId, routineIds);
      // The device pulled this version.
      const deviceBase = String((await storedCycle(fixture, cycleId)).updated_at);
      await sleep(20);

      // Portal: rename, reassign day 2, add day 5.
      await asPortalUser(fixture, async (browser) => {
        const renamed = await browser.from("training_cycles")
          .update({ name: "Renamed on portal" })
          .eq("id", cycleId);
        if (renamed.error) throw new Error("portal rename failed");
        const reassigned = await browser.from("cycle_days")
          .update({ routine_id: routineIds[4] })
          .eq("cycle_id", cycleId)
          .eq("day_number", 2);
        if (reassigned.error) throw new Error("portal reassign failed");
        const added = await browser.from("cycle_days").insert({
          cycle_id: cycleId,
          day_number: 5,
          routine_id: routineIds[4],
        });
        if (added.error) throw new Error("portal day insert failed");
      });
      const afterPortal = await storedCycle(fixture, cycleId);

      // The phone pushes its old structure with the old base, plus a
      // progression change. Stale, so progression is left alone too
      // (PR 19 R-10: a stale push must not revert portal progression).
      const response = await pushOk(handler, mobileCyclePush(
        cycleId,
        "Seeded cycle",
        [1, 2, 3, 4].map((n) => ({ dayNumber: n, routineId: routineIds[n - 1] })),
        { baseUpdatedAt: deviceBase, progressionSettings: '{"frequencyCycles":"2"}' },
      ));
      assertEquals(response.cyclesUpserted, 1);
      // Structure not applied: no version, so the device pulls first.
      assertEquals(response.cycleVersions, {});

      const merged = await storedCycle(fixture, cycleId);
      assertEquals(merged.name, "Renamed on portal");
      assertEquals(merged.progression_settings, afterPortal.progression_settings);
      assertEquals(merged.portal_edited_at, afterPortal.portal_edited_at);
      const days = await storedDays(fixture, cycleId);
      assertEquals(days.map((d) => d.day_number), [1, 2, 3, 4, 5]);
      assertEquals(days[1].routine_id, routineIds[4]);
      assertEquals(days[4].routine_id, routineIds[4]);
    } finally {
      await deleteTombstonePushFixture(fixture.admin, [fixture.ownerId]);
    }
  },
});

Deno.test({
  name:
    `integration: cycle merge (LWW=${SYNC_LWW_ENABLED}) a base truncated to milliseconds that equals the stored version is current`,
  ignore: localIntegrationEnvironment === null,
  fn: async () => {
    const fixture = await createTombstonePushFixture();
    try {
      const handler = realTombstonePushHandler(fixture);
      const routineIds = await seedRoutines(fixture, 4);
      const cycleId = crypto.randomUUID();
      await seedFourDayCycle(fixture, cycleId, routineIds);
      await asPortalUser(fixture, async (browser) => {
        const renamed = await browser.from("training_cycles")
          .update({ name: "Portal name" })
          .eq("id", cycleId);
        if (renamed.error) throw new Error("portal rename failed");
      });
      const stored = await storedCycle(fixture, cycleId);
      // portal_edited_at and updated_at come from the same now().
      assertEquals(stored.portal_edited_at, stored.updated_at);
      // A client that keeps only milliseconds (JS Date / epoch ms).
      const msBase = new Date(String(stored.updated_at)).toISOString();

      const response = await pushOk(handler, mobileCyclePush(
        cycleId,
        "Phone name",
        [1, 2, 3].map((n) => ({ dayNumber: n, routineId: routineIds[n - 1] })),
        { baseUpdatedAt: msBase },
      ));
      const merged = await storedCycle(fixture, cycleId);
      assertEquals(merged.name, "Phone name");
      assertEquals(
        (await storedDays(fixture, cycleId)).map((d) => d.day_number),
        [1, 2, 3],
      );
      assertEquals(response.cycleVersions, { [cycleId]: merged.updated_at });
    } finally {
      await deleteTombstonePushFixture(fixture.admin, [fixture.ownerId]);
    }
  },
});

Deno.test({
  name:
    `integration: cycle merge (LWW=${SYNC_LWW_ENABLED}) an unchanged push leaves updated_at alone and reports the stored version`,
  ignore: localIntegrationEnvironment === null,
  fn: async () => {
    const fixture = await createTombstonePushFixture();
    try {
      const handler = realTombstonePushHandler(fixture);
      const routineIds = await seedRoutines(fixture, 2);
      const cycleId = crypto.randomUUID();
      const body = mobileCyclePush(
        cycleId,
        "Phone cycle",
        [1, 2].map((n) => ({ dayNumber: n, routineId: routineIds[n - 1] })),
        { progressionSettings: '{"frequencyCycles":"1"}' },
      );
      const first = await pushOk(handler, body);
      const afterFirst = await storedCycle(fixture, cycleId);
      assertEquals(first.cycleVersions, { [cycleId]: afterFirst.updated_at });

      await sleep(20);
      const second = await pushOk(handler, body);
      const afterSecond = await storedCycle(fixture, cycleId);
      assertEquals(afterSecond.updated_at, afterFirst.updated_at);
      assertEquals(second.cycleVersions, { [cycleId]: afterFirst.updated_at });

      // A day-only change does advance the pull cursor.
      await sleep(20);
      await pushOk(handler, mobileCyclePush(
        cycleId,
        "Phone cycle",
        [{ dayNumber: 1, routineId: routineIds[1] }, { dayNumber: 2, routineId: routineIds[1] }],
        { progressionSettings: '{"frequencyCycles":"1"}' },
      ));
      const afterDayEdit = await storedCycle(fixture, cycleId);
      assert(
        String(afterDayEdit.updated_at) !== String(afterFirst.updated_at),
        "a day-only change moves updated_at",
      );
      // Service-role writes never stamp the portal clock.
      assertEquals(afterDayEdit.portal_edited_at, null);
    } finally {
      await deleteTombstonePushFixture(fixture.admin, [fixture.ownerId]);
    }
  },
});

Deno.test({
  name:
    `integration: cycle merge (LWW=${SYNC_LWW_ENABLED}) a second phone edit pushed with the old base still applies (R-202)`,
  ignore: localIntegrationEnvironment === null,
  fn: async () => {
    const fixture = await createTombstonePushFixture();
    try {
      const handler = realTombstonePushHandler(fixture);
      const routineIds = await seedRoutines(fixture, 4);
      const cycleId = crypto.randomUUID();
      await seedFourDayCycle(fixture, cycleId, routineIds);
      // A portal edit happened before the device's pull.
      await asPortalUser(fixture, async (browser) => {
        const renamed = await browser.from("training_cycles")
          .update({ name: "Portal name" })
          .eq("id", cycleId);
        if (renamed.error) throw new Error("portal rename failed");
      });
      await sleep(20);
      const pulledBase = String((await storedCycle(fixture, cycleId)).updated_at);

      await pushOk(handler, mobileCyclePush(
        cycleId,
        "Phone edit 1",
        [1, 2, 3, 4].map((n) => ({ dayNumber: n, routineId: routineIds[n - 1] })),
        { baseUpdatedAt: pulledBase },
      ));
      await sleep(20);
      // No pull in between: the same old base.
      const second = await pushOk(handler, mobileCyclePush(
        cycleId,
        "Phone edit 2",
        [1, 2, 3].map((n) => ({ dayNumber: n, routineId: routineIds[n - 1] })),
        { baseUpdatedAt: pulledBase },
      ));
      const merged = await storedCycle(fixture, cycleId);
      assertEquals(merged.name, "Phone edit 2");
      assertEquals(
        (await storedDays(fixture, cycleId)).map((d) => d.day_number),
        [1, 2, 3],
      );
      assertEquals(second.cycleVersions, { [cycleId]: merged.updated_at });
    } finally {
      await deleteTombstonePushFixture(fixture.admin, [fixture.ownerId]);
    }
  },
});

Deno.test({
  name:
    `integration: cycle merge (LWW=${SYNC_LWW_ENABLED}) the shipping build's first push stores the same rows as before`,
  ignore: localIntegrationEnvironment === null,
  fn: async () => {
    const fixture = await createTombstonePushFixture();
    try {
      const handler = realTombstonePushHandler(fixture);
      const ids = freshTombstoneIds();
      // Pre-change fixture (routine + cycle with one day), verbatim shape.
      const body = tombstoneMobilePushBody(ids, { includeRoutine: true });
      const cycle = (body.cycles as Record<string, unknown>[])[0];
      cycle.description = "Mobile description";
      cycle.startedAt = "2026-07-01T08:00:00.000Z";
      cycle.progressionSettings = '{"frequencyCycles":"2"}';
      cycle.templateId = "template_18";
      cycle.updatedAt = "2026-07-02T09:30:00.000Z";
      (cycle.days as Record<string, unknown>[])[0].weightAdjustment = 2.5;
      (cycle.days as Record<string, unknown>[])[0].restType = "full";
      (cycle.days as Record<string, unknown>[])[0].notes = "Heavy";
      await pushOk(handler, body);

      const stored = await storedCycle(fixture, ids.cycleId);
      assertEquals({
        user_id: stored.user_id,
        local_profile_id: stored.local_profile_id,
        name: stored.name,
        description: stored.description,
        duration_weeks: stored.duration_weeks,
        workout_days: stored.workout_days,
        rest_days: stored.rest_days,
        current_week: stored.current_week,
        status: stored.status,
        started_at: new Date(String(stored.started_at)).toISOString(),
        last_used_at: stored.last_used_at,
        progression_settings: stored.progression_settings,
        deload_settings: stored.deload_settings,
        template_id: stored.template_id,
        // PR 21: the pushed updatedAt is the LWW key; updated_at (pull
        // cursor) is the server clock (NF-12).
        client_updated_at: new Date(String(stored.client_updated_at)).toISOString(),
        portal_edited_at: stored.portal_edited_at,
      }, {
        user_id: fixture.ownerId,
        local_profile_id: "default",
        name: "PR16 cycle",
        description: "Mobile description",
        duration_weeks: 1,
        workout_days: 1,
        rest_days: 0,
        current_week: 1,
        status: "active",
        started_at: "2026-07-01T08:00:00.000Z",
        last_used_at: null,
        progression_settings: { frequencyCycles: "2" },
        deload_settings: null,
        template_id: "template_18",
        client_updated_at: "2026-07-02T09:30:00.000Z",
        portal_edited_at: null,
      });
      assert(
        Date.parse(String(stored.updated_at)) > Date.parse("2026-07-02T09:30:00.000Z"),
        "updated_at is the server write time, not the pushed updatedAt",
      );
      assertEquals(await storedDays(fixture, ids.cycleId), [{
        day_number: 1,
        day_type: "workout",
        routine_id: ids.routineId,
        weight_adjustment: 2.5,
        rep_modifier: 0,
        rest_override: null,
        rest_type: "full",
        notes: "Heavy",
      }]);
    } finally {
      await deleteTombstonePushFixture(fixture.admin, [fixture.ownerId]);
    }
  },
});

// ---------------------------------------------------------------------------
// KD-5 (PR 21): real-SQL LWW clock. client_updated_at is the LWW key (the
// device's updatedAt, or now() for a portal edit); updated_at stays the
// server-owned pull cursor. Runs under the SYNC_LWW_ENABLED value of the run
// (CI runs both).
// ---------------------------------------------------------------------------

/** A mobile push of one session and one routine stamped `updatedAt`. */
function lwwClockPush(
  ids: { sessionId: string; routineId: string },
  version: string,
  updatedAt: string,
): Record<string, unknown> {
  return {
    ...validPushBody(),
    lastSync: Date.now() - 60_000,
    profileId: "default",
    profileName: "Default",
    allProfiles: [{ id: "default", name: "Default", colorIndex: 0 }],
    sessions: [{
      id: ids.sessionId,
      userId: "mobile-local-user",
      name: `Session ${version}`,
      startedAt: "2026-07-01T08:00:00.000Z",
      notes: null,
      updatedAt,
      exercises: [],
    }],
    routines: [{
      id: ids.routineId,
      userId: "mobile-local-user",
      name: `Routine ${version}`,
      description: "",
      exerciseCount: 0,
      estimatedDuration: 0,
      timesCompleted: 0,
      isFavorite: false,
      updatedAt,
      exercises: [],
    }],
  };
}
async function entitleLocalIntegrationFixture(
  fixture: LocalIntegrationFixture,
): Promise<void> {
  const subscription = await fixture.admin.from("subscriptions").upsert({
    user_id: fixture.ownerId,
    tier: "EMBER",
    status: "active",
    current_period_end: "2099-01-01T00:00:00.000Z",
  }, { onConflict: "user_id" });
  if (subscription.error) throw new Error("subscription fixture creation failed");
}

function derivedSessionBody(
  fixture: LocalIntegrationFixture,
  sessions: Array<{ id: string; startedAt: string }>,
  stats: Record<string, unknown> | null,
): Record<string, unknown> {
  return {
    ...validPushBody(),
    profileId: fixture.profileId,
    allProfiles: [{
      id: fixture.profileId,
      name: "Task 7 integration profile",
      colorIndex: 0,
    }],
    sessions: sessions.map((session, index) => {
      const exerciseId = crypto.randomUUID();
      return {
        id: session.id,
        userId: fixture.ownerId,
        name: `Derived session ${index}`,
        startedAt: session.startedAt,
        durationSeconds: 60,
        // Stored per cable and never doubled (KD-8).
        totalVolume: 25,
        setCount: 1,
        exerciseCount: 1,
        exercises: [{
          id: exerciseId,
          sessionId: session.id,
          name: "Bench Press",
          muscleGroup: "Chest",
          sets: [{
            id: crypto.randomUUID(),
            exerciseId,
            setNumber: 1,
            targetReps: 10,
            actualReps: 10,
            weightKg: 25,
          }],
        }],
      };
    }),
    gamificationStats: stats,
  };
}

async function storedStats(
  fixture: LocalIntegrationFixture,
): Promise<Record<string, unknown>> {
  const stored = await fixture.admin.from("gamification_stats")
    .select(
      "total_workouts,total_volume_kg,total_reps,total_time_seconds,pr_count,current_streak,longest_streak,best_streak,device_total_workouts,device_total_volume_kg,device_current_streak,device_longest_streak",
    )
    .eq("user_id", fixture.ownerId)
    .single();
  if (stored.error) throw new Error("stats verification query failed");
  return stored.data as Record<string, unknown>;
}

Deno.test({
  name:
    "integration: VBT push is idempotent on the timestamptz value and the unique index exists",
  ignore: localIntegrationEnvironment === null,
  fn: async () => {
    const fixture = await createLocalIntegrationFixture();
    try {
      const authBehavior: AuthBehavior = async () => ({
        data: { user: { id: fixture.ownerId } },
        error: null,
      });
      const vbtCount = async (): Promise<number> => {
        const result = await fixture.admin.from("vbt_assessments")
          .select("id", { count: "exact", head: true })
          .eq("user_id", fixture.ownerId);
        if (result.error) throw new Error("vbt count query failed");
        return result.count ?? -1;
      };
      const push = async (
        body: Record<string, unknown>,
        expectedInserted: number,
      ) => {
        const harness = makeHarness(authBehavior, {
          tableResults: { exercise_catalog: CATALOG_RESULT },
          tableClients: { vbt_assessments: fixture.admin },
        });
        const response = await harness.handler(requestFromBody(body));
        const responseBody = await json(response);
        assertEquals(response.status, 200, JSON.stringify(responseBody));
        assertEquals(
          (responseBody.failed as Record<string, unknown>).assessments,
          [],
        );
        assertEquals(responseBody.assessmentsInserted, expectedInserted);
      };

      // A row stored earlier with a numeric offset. PostgREST reads it back
      // as "+00:00"; the wire value is the same instant written with "Z".
      const stored = await fixture.admin.from("vbt_assessments").insert({
        user_id: fixture.ownerId,
        exercise_id: CATALOG_EXERCISE_ID,
        estimated_1rm_kg: 100,
        load_velocity_data: [],
        created_at: "2026-07-11T12:00:00+00:00",
      });
      if (stored.error) throw new Error("vbt fixture insert failed");
      assertEquals(await vbtCount(), 1);

      // "Z" payload against the stored "+00:00" row: no new row.
      await push(assessmentBody(), 0);
      assertEquals(await vbtCount(), 1);
      // Second identical push: still a no-op.
      await push(assessmentBody(), 0);
      assertEquals(await vbtCount(), 1);

      // A new assessment (different instant) is inserted exactly once.
      const withNew = {
        ...assessmentBody(),
        assessments: [
          ...(assessmentBody().assessments as unknown[]),
          {
            id: "00000000-0000-4000-8000-000000000052",
            exerciseId: CATALOG_EXERCISE_ID,
            estimatedOneRepMaxKg: 105,
            loadVelocityData: "[]",
            createdAt: "2026-07-12T12:00:00.000Z",
          },
        ],
      };
      await push(withNew, 1);
      await push(withNew, 0);
      assertEquals(await vbtCount(), 2);

      // One payload carrying the same instant twice ("Z" and "+00:00"): it
      // passes the string-keyed payload check, and DO NOTHING stores one row
      // instead of failing the statement.
      const sameKeyTwice = {
        ...assessmentBody(),
        assessments: [
          {
            id: "00000000-0000-4000-8000-000000000054",
            exerciseId: CATALOG_EXERCISE_ID,
            estimatedOneRepMaxKg: 110,
            loadVelocityData: "[]",
            createdAt: "2026-07-13T12:00:00.000Z",
          },
          {
            id: "00000000-0000-4000-8000-000000000055",
            exerciseId: CATALOG_EXERCISE_ID,
            estimatedOneRepMaxKg: 110,
            loadVelocityData: "[]",
            createdAt: "2026-07-13T12:00:00+00:00",
          },
        ],
      };
      await push(sameKeyTwice, 1);
      assertEquals(await vbtCount(), 3);

      // The unique index exists: a plain duplicate insert (same instant,
      // different text form) is rejected with unique_violation.
      const duplicate = await fixture.admin.from("vbt_assessments").insert({
        user_id: fixture.ownerId,
        exercise_id: CATALOG_EXERCISE_ID,
        estimated_1rm_kg: 100,
        created_at: "2026-07-11T12:00:00.000Z",
      });
      assertEquals(duplicate.error?.code, "23505");
      assertEquals(await vbtCount(), 3);
    } finally {
      await cleanupLocalIntegrationFixture(fixture);
    }
  },
});

Deno.test({
  name:
    "integration: derived counters follow the stored sessions while the device keeps its own",
  ignore: localIntegrationEnvironment === null,
  fn: async () => {
    const fixture = await createLocalIntegrationFixture();
    try {
      await entitleLocalIntegrationFixture(fixture);
      const handler = makeRealSqlHandler(fixture);
      const sessionIds = [
        crypto.randomUUID(),
        crypto.randomUUID(),
        crypto.randomUUID(),
      ];
      const deviceASessions = [
        { id: sessionIds[0], startedAt: "2026-07-01T10:00:00.000Z" },
        { id: sessionIds[1], startedAt: "2026-07-05T10:00:00.000Z" },
        { id: sessionIds[2], startedAt: "2026-07-09T10:00:00.000Z" },
      ];
      // Three non-consecutive UTC days, none of them today, so every derived
      // streak is 1 and the current streak is 0.
      const deviceAStats = {
        total_workouts: 3,
        total_volume_kg: 75,
        total_reps: 30,
        total_time_seconds: 180,
        pr_count: 0,
        current_streak: 0,
        longest_streak: 1,
        best_streak: 1,
        device_total_workouts: 3,
        device_total_volume_kg: 75,
        device_current_streak: 5,
        device_longest_streak: 20,
      };

      const deviceA = await handler(requestFromBody(derivedSessionBody(
        fixture,
        deviceASessions,
        {
          userId: fixture.ownerId,
          totalWorkouts: 3,
          totalReps: 30,
          totalVolumeKg: 75,
          totalTimeSeconds: 180,
          currentStreak: 5,
          longestStreak: 20,
        },
      )));

      assertEquals(deviceA.status, 200);
      assertEquals(await storedStats(fixture), deviceAStats);

      // Stale device B: fewer workouts, an older last workout, worse streaks.
      // Its key loses the compare, so nothing of its own lands either.
      const deviceB = await handler(requestFromBody(derivedSessionBody(
        fixture,
        deviceASessions.slice(0, 2),
        {
          userId: fixture.ownerId,
          totalWorkouts: 2,
          totalReps: 20,
          totalVolumeKg: 50,
          totalTimeSeconds: 120,
          currentStreak: 1,
          longestStreak: 2,
        },
      )));

      assertEquals(deviceB.status, 200);
      assertEquals(await storedStats(fixture), deviceAStats);

      // A crafted push with no sessions. R-3/R-11: the null key must NOT be
      // read as consent, so even the device-reported shadow columns are left
      // alone â€” and nothing it claims reaches a derived counter.
      const crafted = await handler(requestFromBody(derivedSessionBody(
        fixture,
        [],
        {
          userId: fixture.ownerId,
          totalWorkouts: 10_000,
          totalReps: 100_000,
          totalVolumeKg: 9_999_999,
          totalTimeSeconds: 999_999,
          currentStreak: 3,
          longestStreak: 4,
        },
      )));

      assertEquals(crafted.status, 200);
      assertEquals(await storedStats(fixture), deviceAStats);

      // Deleting a session lowers the derived totals, with no push involved,
      // and still does not touch what the device reported.
      const deleted = await fixture.admin.from("workout_sessions")
        .delete()
        .eq("id", sessionIds[0]);
      if (deleted.error) throw new Error("session delete failed");
      const afterDelete = await storedStats(fixture);
      assertEquals(afterDelete.total_workouts, 2);
      assertEquals(afterDelete.total_volume_kg, 50);
      assertEquals(afterDelete.total_reps, 20);
      assertEquals(afterDelete.total_time_seconds, 120);
      assertEquals(afterDelete.device_total_workouts, 3);
      assertEquals(afterDelete.device_current_streak, 5);
      assertEquals(afterDelete.device_longest_streak, 20);
    } finally {
      await cleanupLocalIntegrationFixture(fixture);
    }
  },
});
// ─── routine exercise durationSeconds (KD-2: nested, optional) ───────────────

const TIMED_ROUTINE_EXERCISE_ID = "00000000-0000-4000-8000-000000000022";

/**
 * A routine exercise exactly as the shipping mobile build serializes
 * PortalRoutineExerciseSyncDto (Project-Phoenix-MP PortalSyncDtos.kt:213-249,
 * PortalWireJson encodeDefaults=true / explicitNulls=false, values from
 * PortalSyncAdapter.kt:570-620). It has no durationSeconds key.
 */
function currentMobileRoutineExercise(id: string): Record<string, unknown> {
  return {
    id,
    routineId: ROUTINE_ID,
    exerciseId: "Plank",
    name: "Plank",
    displayName: "Plank",
    muscleGroup: "Core",
    exerciseEquipment: "",
    sets: 3,
    reps: 10,
    weight: 0.0,
    restSeconds: 60,
    mode: "ECHO",
    orderIndex: 0,
    perSetWeights: "[0.0,0.0,0.0]",
    perSetRest: "[60,60,60]",
    isAmrap: false,
    isBodyweight: true,
    repCountTiming: "TOP",
    stopAtPosition: "TOP",
    stallDetection: true,
    eccentricLoad: "LOAD_100",
    echoLevel: "HARDER",
    perSetEchoLevels: '["HARDER","HARDER","HARDER"]',
    warmupSets: "[]",
    rackBehaviorOverrides: "{}",
    dropSetEnabled: false,
  };
}

function routinePushBody(
  exercises: Record<string, unknown>[],
): Record<string, unknown> {
  return {
    ...validPushBody(),
    profileId: "default",
    allProfiles: [{ id: "default", name: "Default", colorIndex: 0 }],
    routines: [{
      id: ROUTINE_ID,
      userId: VALID_USER_ID,
      name: "Timed routine",
      description: "",
      exerciseCount: exercises.length,
      estimatedDuration: 0,
      timesCompleted: 0,
      isFavorite: false,
      exercises,
    }],
  };
}

async function storedLwwRow(
  fixture: TombstonePushFixture,
  table: "workout_sessions" | "routines",
  id: string,
): Promise<Record<string, unknown>> {
  const columns = table === "workout_sessions"
    ? "name, notes, updated_at, client_updated_at"
    : "name, updated_at, client_updated_at";
  const row = await fixture.admin.from(table).select(columns).eq("id", id).single();
  if (row.error) throw new Error(`${table} lookup failed: ${row.error.message}`);
  return row.data as unknown as Record<string, unknown>;
}

const epochMs = (value: unknown) => Date.parse(String(value));

type RejectionLists = Record<string, Array<Record<string, unknown>>>;

Deno.test({
  name:
    `integration: lww clock (LWW=${SYNC_LWW_ENABLED}) a device clock 10 minutes behind the server keeps updating; an older write loses only under LWW`,
  ignore: localIntegrationEnvironment === null,
  fn: async () => {
    const fixture = await createTombstonePushFixture();
    try {
      const handler = realTombstonePushHandler(fixture);
      const ids = { sessionId: crypto.randomUUID(), routineId: crypto.randomUUID() };
      const deviceClock = (minutesAgo: number) =>
        new Date(Date.now() - minutesAgo * 60_000).toISOString();

      // v1 creates, v2 updates (the server trigger moves updated_at to its
      // own clock), v3 is the device's next edit, still behind the server.
      // Before PR 21 the LWW gate compared v3 with updated_at and rejected it.
      await pushOk(handler, lwwClockPush(ids, "v1", deviceClock(30)));
      await pushOk(handler, lwwClockPush(ids, "v2", deviceClock(20)));
      const v3Stamp = deviceClock(10);
      const v3 = await pushOk(handler, lwwClockPush(ids, "v3", v3Stamp));
      const v3Rejections = v3.rejections as RejectionLists;
      assertEquals(v3Rejections.sessions, []);
      assertEquals(v3Rejections.routines, []);
      for (const table of ["workout_sessions", "routines"] as const) {
        const id = table === "workout_sessions" ? ids.sessionId : ids.routineId;
        const row = await storedLwwRow(fixture, table, id);
        assertEquals(row.name, table === "workout_sessions" ? "Session v3" : "Routine v3");
        assertEquals(epochMs(row.client_updated_at), epochMs(v3Stamp), `${table} stores the device key`);
        assert(
          epochMs(row.updated_at) > epochMs(v3Stamp),
          `${table} updated_at is the server write clock`,
        );
      }

      // A second device's older write, stamped before v3. This pins the
      // `RETURNING ... / FOUND` decision (the pre-check SELECT is gone), but
      // it is a sequential call, not two interleaved transactions — the
      // acceptance wording deliberately no longer says "concurrent" (R-11).
      const olderStamp = deviceClock(15);
      const older = await pushOk(handler, lwwClockPush(ids, "older", olderStamp));
      const rejections = older.rejections as RejectionLists;
      const session = await storedLwwRow(fixture, "workout_sessions", ids.sessionId);
      const routine = await storedLwwRow(fixture, "routines", ids.routineId);
      if (SYNC_LWW_ENABLED) {
        assertEquals(rejections.sessions.map((r) => r.id), [ids.sessionId]);
        assertEquals(rejections.routines.map((r) => r.id), [ids.routineId]);
        // server_updated_at is the stored key, not the server write time.
        assertEquals(
          epochMs(rejections.sessions[0].serverUpdatedAt),
          epochMs(session.client_updated_at),
        );
        assertEquals(
          epochMs(rejections.routines[0].serverUpdatedAt),
          epochMs(routine.client_updated_at),
        );
        assertEquals(epochMs(session.client_updated_at), epochMs(v3Stamp));
        assertEquals(session.name, "Session v3");
        assertEquals(routine.name, "Routine v3");
      } else {
        // Last push wins; the key follows it, so it is right when LWW is on.
        assertEquals(rejections.sessions, []);
        assertEquals(rejections.routines, []);
        assertEquals(session.name, "Session older");
        assertEquals(routine.name, "Routine older");
        assertEquals(epochMs(session.client_updated_at), epochMs(olderStamp));
        assertEquals(epochMs(routine.client_updated_at), epochMs(olderStamp));
      }
    } finally {
      await deleteTombstonePushFixture(fixture.admin, [fixture.ownerId]);
    }
  },
});

Deno.test({
  name:
    `integration: lww clock (LWW=${SYNC_LWW_ENABLED}) portal notes and routine edits advance the key, reach pull, and survive an earlier-stamped push under LWW`,
  ignore: localIntegrationEnvironment === null,
  fn: async () => {
    const fixture = await createTombstonePushFixture();
    try {
      const handler = realTombstonePushHandler(fixture);
      const ids = { sessionId: crypto.randomUUID(), routineId: crypto.randomUUID() };

      // The device's last version, stamped T1 by its clock.
      const t1 = new Date(Date.now() - 5 * 60_000).toISOString();
      await pushOk(handler, lwwClockPush(ids, "phone", t1));
      const beforePortal = await storedLwwRow(fixture, "workout_sessions", ids.sessionId);

      // Portal edits at T2 > T1, through PostgREST as the signed-in user.
      await asPortalUser(fixture, async (browser) => {
        const notes = await browser.from("workout_sessions")
          .update({ notes: "Portal note" }, { count: "exact" })
          .eq("id", ids.sessionId);
        if (notes.error) throw new Error(`portal notes edit failed: ${notes.error.message}`);
        assertEquals(notes.count, 1);
        const rename = await browser.from("routines")
          .update({ name: "Portal routine" }, { count: "exact" })
          .eq("id", ids.routineId);
        if (rename.error) throw new Error(`portal routine edit failed: ${rename.error.message}`);
        assertEquals(rename.count, 1);
      });
      const session = await storedLwwRow(fixture, "workout_sessions", ids.sessionId);
      const routine = await storedLwwRow(fixture, "routines", ids.routineId);
      assert(epochMs(session.client_updated_at) > epochMs(t1), "portal edit advances the session key");
      assert(epochMs(routine.client_updated_at) > epochMs(t1), "portal edit advances the routine key");
      assertEquals(session.client_updated_at, session.updated_at);

      // #116: an incremental pull that already knows the session returns it.
      const pulled = await fixture.admin.rpc("get_sessions_excluding_ids", {
        p_user_id: fixture.ownerId,
        p_known_ids: [ids.sessionId],
        p_last_sync_at: beforePortal.updated_at,
      });
      if (pulled.error) throw new Error(`sessions pull RPC failed: ${pulled.error.message}`);
      const pulledRows = pulled.data as Array<Record<string, unknown>>;
      assertEquals(pulledRows.map((r) => [r.id, r.notes]), [[ids.sessionId, "Portal note"]]);

      // The device re-pushes its unchanged T1 version, then an edit stamped
      // T1 + 1 s (still before the portal edit).
      const t1b = new Date(Date.parse(t1) + 1_000).toISOString();
      for (const [version, stamp] of [["phone", t1], ["phone edit", t1b]] as const) {
        const response = await pushOk(handler, lwwClockPush(ids, version, stamp));
        const rejections = response.rejections as RejectionLists;
        const storedSession = await storedLwwRow(fixture, "workout_sessions", ids.sessionId);
        const storedRoutine = await storedLwwRow(fixture, "routines", ids.routineId);
        if (SYNC_LWW_ENABLED) {
          assertEquals(rejections.sessions.map((r) => r.id), [ids.sessionId], version);
          assertEquals(rejections.routines.map((r) => r.id), [ids.routineId], version);
          assertEquals(storedSession.notes, "Portal note", `${version}: portal notes survive`);
          assertEquals(storedRoutine.name, "Portal routine", `${version}: portal rename survives`);
          assertEquals(storedSession.client_updated_at, session.client_updated_at);
        } else {
          // Documented LWW-off behaviour: the push overwrites (last push
          // wins) and stores its own key.
          assertEquals(rejections.sessions, [], version);
          assertEquals(storedSession.notes, null, version);
          assertEquals(storedRoutine.name, `Routine ${version}`);
          assertEquals(epochMs(storedSession.client_updated_at), epochMs(stamp));
        }
      }
    } finally {
      await deleteTombstonePushFixture(fixture.admin, [fixture.ownerId]);
    }
  },
});

/** Real pull handler for the fixture owner (another device of the account). */
function realPullHandlerFor(
  fixture: TombstonePushFixture,
): (request: Request) => Promise<Response> {
  return createMobileSyncPullHandler({
    createAuthClient() {
      return {
        auth: {
          async getUser() {
            return { data: { user: { id: fixture.ownerId } }, error: null };
          },
        },
      };
    },
    createAdminClient() {
      return fixture.admin;
    },
    logOperationalFailure: () => {},
    now: () => 1_784_167_200_000,
  } as never);
}

function catalogProbeSession(
  sessionId: string,
  userId: string,
  refs: Array<{ exerciseId: string; name: string }>,
): Record<string, unknown> {
  return {
    id: sessionId,
    userId,
    startedAt: "2026-01-20T10:00:00.000Z",
    updatedAt: "2026-01-20T10:30:00.000Z",
    workoutMode: "OLD_SCHOOL",
    exercises: refs.map((ref, index) => {
      const exerciseRowId = crypto.randomUUID();
      return {
        id: exerciseRowId,
        sessionId,
        name: ref.name,
        exerciseId: ref.exerciseId,
        muscleGroup: "Chest",
        orderIndex: index,
        sets: [{
          id: crypto.randomUUID(),
          exerciseId: exerciseRowId,
          setNumber: 1,
          targetReps: 10,
          actualReps: 10,
          weightKg: 20,
          workoutMode: "OLD_SCHOOL",
          repSummaries: [],
          isPr: false,
        }],
      };
    }),
  };
}

async function pushSession(
  handler: (request: Request) => Promise<Response>,
  fixture: CatalogIntegrationFixture,
  refs: Array<{ exerciseId: string; name: string }>,
  extra: Record<string, unknown> = {},
): Promise<Array<string | null>> {
  const sessionId = crypto.randomUUID();
  const body = validPushBody();
  body.profileId = "default";
  body.sessions = [catalogProbeSession(sessionId, fixture.ownerId, refs)];
  Object.assign(body, extra);
  const response = await handler(requestFromBody(body));
  const responseBody = await json(response);
  assertEquals(response.status, 200, JSON.stringify(responseBody));
  const stored = await fixture.admin.from("exercises")
    .select("order_index, exercise_id")
    .eq("session_id", sessionId)
    .order("order_index", { ascending: true });
  if (stored.error) throw new Error("exercise verification query failed");
  assertEquals(stored.data.length, refs.length);
  return stored.data.map((row) => row.exercise_id as string | null);
}

async function insertCustomCatalogRow(
  fixture: CatalogIntegrationFixture,
  id: string,
  name: string,
  userId: string,
): Promise<void> {
  const inserted = await fixture.admin.from("exercise_catalog").insert({
    id,
    name,
    display_name: name,
    muscle_group: "Chest",
    is_custom: true,
    user_id: userId,
  });
  if (inserted.error) {
    throw new Error(`custom catalog fixture failed: ${inserted.error.message}`);
  }
}

Deno.test({
  name:
    `integration: lww clock (LWW=${SYNC_LWW_ENABLED}) rows created by a device 10 minutes behind reach another device's delta pull (NF-12)`,
  ignore: localIntegrationEnvironment === null,
  fn: async () => {
    const fixture = await createTombstonePushFixture();
    try {
      const push = realTombstonePushHandler(fixture);
      const pull = realPullHandlerFor(fixture);
      const ids = { sessionId: crypto.randomUUID(), routineId: crypto.randomUUID() };

      // Device B last synced just before device A's push.
      const lastSyncB = Date.now() - 1_000;
      const slowStamp = new Date(Date.now() - 10 * 60_000).toISOString();
      await pushOk(push, lwwClockPush(ids, "slow", slowStamp));

      for (const table of ["workout_sessions", "routines"] as const) {
        const id = table === "workout_sessions" ? ids.sessionId : ids.routineId;
        const row = await storedLwwRow(fixture, table, id);
        assertEquals(epochMs(row.client_updated_at), epochMs(slowStamp), `${table} key is the device time`);
        assert(
          epochMs(row.updated_at) > lastSyncB,
          `${table} pull cursor is the server clock, not the slow device clock`,
        );
      }

      // Device B: timestamp delta pull (lastSync > 0, no parity lists; no
      // profile filter, see the PR 21 summary for the legacy 'default'
      // profile filter gap).
      const response = await pull(requestFromBody({
        deviceId: "device-b",
        lastSync: lastSyncB,
        pageSize: 75,
      }));
      const body = await json(response);
      assertEquals(response.status, 200, JSON.stringify(body));
      const sessions = body.sessions as Array<Record<string, unknown>>;
      const routines = body.routines as Array<Record<string, unknown>>;
      assertEquals(sessions.map((s) => s.id), [ids.sessionId]);
      assertEquals(routines.map((r) => r.id), [ids.routineId]);
      // R-4, legacy timestamp-mode branch (lastSync > 0, no parity lists, so
      // the pull uses `select('*')` rather than get_sessions_excluding_ids):
      // the reported updatedAt is the device's own LWW key here too.
      assertEquals(
        epochMs(sessions[0].updatedAt),
        epochMs(slowStamp),
        "timestamp-mode pull reports the device stamp, not the server write clock",
      );
    } finally {
      await deleteTombstonePushFixture(fixture.admin, [fixture.ownerId]);
    }
  },
});

/** A push whose session/routine/cycle DTOs carry no `updatedAt` at all. */
function undatedPush(
  ids: { sessionId: string; routineId: string; cycleId: string },
): Record<string, unknown> {
  return {
    ...validPushBody(),
    lastSync: Date.now() - 60_000,
    profileId: "default",
    profileName: "Default",
    allProfiles: [{ id: "default", name: "Default", colorIndex: 0 }],
    sessions: [{
      id: ids.sessionId,
      userId: "mobile-local-user",
      name: "Undated session",
      startedAt: "2026-07-01T08:00:00.000Z",
      notes: null,
      exercises: [],
    }],
    routines: [{
      id: ids.routineId,
      userId: "mobile-local-user",
      name: "Undated routine",
      description: "",
      exerciseCount: 0,
      estimatedDuration: 0,
      timesCompleted: 0,
      isFavorite: false,
      exercises: [],
    }],
    cycles: [{
      id: ids.cycleId,
      userId: "mobile-local-user",
      name: "Undated cycle",
      durationWeeks: 1,
      workoutDays: 1,
      restDays: 0,
      currentWeek: 1,
      status: "active",
      days: [],
    }],
  };
}

async function storedClocks(
  fixture: TombstonePushFixture,
  table: "workout_sessions" | "routines" | "training_cycles",
  id: string,
): Promise<{ updated_at: unknown; client_updated_at: unknown }> {
  const row = await fixture.admin
    .from(table)
    .select("updated_at, client_updated_at")
    .eq("id", id)
    .single();
  if (row.error) throw new Error(`${table} clock lookup failed: ${row.error.message}`);
  return row.data as unknown as { updated_at: unknown; client_updated_at: unknown };
}

Deno.test({
  name:
    "integration: push resolves paged public rows and the caller's own custom rows, never another user's",
  ignore: localIntegrationEnvironment === null,
  fn: async () => {
    const fixture = await createCatalogIntegrationFixture();
    try {
      const publicIds = await fixture.admin.from("exercise_catalog")
        .select("id")
        .eq("is_custom", false)
        .order("id", { ascending: true })
        .range(1000, 1999);
      if (publicIds.error) throw new Error("public catalog query failed");
      // The seeded library spans more than one 1000-row page.
      assert(publicIds.data.length > 0, "public catalog must exceed one page");
      const pageTwoId = publicIds.data[publicIds.data.length - 1].id as string;

      const ownId = `pr58-own-${fixture.suffix}`;
      const ownName = `Pr58 Own Press ${fixture.suffix}`;
      const otherId = `pr58-other-${fixture.suffix}`;
      const otherName = `Pr58 Other Press ${fixture.suffix}`;
      const pushedId = `pr58-pushed-${fixture.suffix}`;
      const pushedName = `Pr58 Pushed Press ${fixture.suffix}`;
      await insertCustomCatalogRow(fixture, ownId, ownName, fixture.ownerId);
      await insertCustomCatalogRow(
        fixture,
        otherId,
        otherName,
        fixture.otherUserId,
      );

      const resolved = await pushSession(realPushHandler(fixture), fixture, [
        { exerciseId: pageTwoId, name: "Page two library row" },
        { exerciseId: ownId, name: "Renamed on device" },
        { exerciseId: "pr58-stale-own", name: ownName },
        { exerciseId: otherId, name: "Other user id" },
        { exerciseId: "pr58-stale-other", name: otherName },
        { exerciseId: pushedId, name: pushedName },
        { exerciseId: "pr58-stale-pushed", name: pushedName },
      ], {
        customExercises: [{
          clientId: pushedId,
          name: pushedName,
          muscleGroup: "Chest",
          defaultCableConfig: "DOUBLE",
        }],
      });

      assertEquals(resolved, [
        pageTwoId,
        ownId,
        ownId,
        null,
        null,
        pushedId,
        pushedId,
      ]);
    } finally {
      await cleanupCatalogIntegrationFixture(fixture);
    }
  },
});

Deno.test({
  name:
    `integration: lww clock (LWW=${SYNC_LWW_ENABLED}) a push that omits updatedAt is dated at receipt and never stores a null clock (NF-15 / R-1)`,
  ignore: localIntegrationEnvironment === null,
  fn: async () => {
    const fixture = await createTombstonePushFixture();
    try {
      const handler = realTombstonePushHandler(fixture);
      const ids = {
        sessionId: crypto.randomUUID(),
        routineId: crypto.randomUUID(),
        cycleId: crypto.randomUUID(),
      };
      const tables = [
        ["workout_sessions", ids.sessionId],
        ["routines", ids.routineId],
        ["training_cycles", ids.cycleId],
      ] as const;

      const beforeFirst = Date.now() - 2_000;
      await pushOk(handler, undatedPush(ids));
      for (const [table, id] of tables) {
        const row = await storedClocks(fixture, table, id);
        // routines.updated_at / training_cycles.updated_at are NOT NULL in
        // production; a row built as `updatedAt ?? null` fails 23502 there,
        // and a BEFORE UPDATE trigger cannot rescue it (PostgreSQL checks
        // NOT NULL against the proposed tuple).
        assert(row.updated_at !== null, `${table}.updated_at must never be written null`);
        assert(
          row.client_updated_at !== null,
          `${table}.client_updated_at must never be written null`,
        );
        assert(
          epochMs(row.client_updated_at) >= beforeFirst,
          `${table}: an undated push is dated at receipt`,
        );
      }

      // A portal edit now owns the LWW key. The LWW-off PostgREST upsert used
      // to overwrite it with NULL on the next undated push (R-1), which would
      // silently hand the row back to the server write clock the day the flag
      // flips.
      await asPortalUser(fixture, async (browser) => {
        const notes = await browser.from("workout_sessions")
          .update({ notes: "Portal note" }, { count: "exact" })
          .eq("id", ids.sessionId);
        if (notes.error) throw new Error(`portal notes edit failed: ${notes.error.message}`);
        const routine = await browser.from("routines")
          .update({ description: "Portal description" }, { count: "exact" })
          .eq("id", ids.routineId);
        if (routine.error) throw new Error(`portal routine edit failed: ${routine.error.message}`);
        const cycle = await browser.from("training_cycles")
          .update({ description: "Portal description" }, { count: "exact" })
          .eq("id", ids.cycleId);
        if (cycle.error) throw new Error(`portal cycle edit failed: ${cycle.error.message}`);
      });
      const portalKeys = new Map<string, number>();
      for (const [table, id] of tables) {
        const row = await storedClocks(fixture, table, id);
        portalKeys.set(table, epochMs(row.client_updated_at));
      }

      const beforeSecond = Date.now() - 2_000;
      await pushOk(handler, undatedPush(ids));
      for (const [table, id] of tables) {
        const row = await storedClocks(fixture, table, id);
        assert(row.updated_at !== null, `${table}.updated_at must never be written null`);
        assert(
          row.client_updated_at !== null,
          `${table}: an undated push must not erase the stored portal stamp`,
        );
        // Documented consequence (R-7): with no device date to go on the
        // server dates the push at receipt, so it beats the earlier portal
        // edit under both flag values.
        assert(
          epochMs(row.client_updated_at) >= beforeSecond,
          `${table}: the undated push is re-dated at receipt`,
        );
        assert(
          epochMs(row.client_updated_at) >= (portalKeys.get(table) ?? 0),
          `${table}: the LWW key never moves backwards`,
        );
      }
    } finally {
      await deleteTombstonePushFixture(fixture.admin, [fixture.ownerId]);
    }
  },
});

Deno.test({
  name:
    `integration: lww clock (LWW=${SYNC_LWW_ENABLED}) the same-sync pull reports a just-pushed session's device stamp while the cursor stays server-clock (R-4)`,
  ignore: localIntegrationEnvironment === null,
  fn: async () => {
    const fixture = await createTombstonePushFixture();
    try {
      const push = realTombstonePushHandler(fixture);
      const pull = realPullHandlerFor(fixture);
      const first = { sessionId: crypto.randomUUID(), routineId: crypto.randomUUID() };
      const second = { sessionId: crypto.randomUUID(), routineId: crypto.randomUUID() };

      // The device's clock trails the DB by 10 minutes - more than the
      // push-to-stamp latency mobile relies on. SyncManager stamps each
      // pushed session with its own currentTimeMillis() and mergeSessionsLww
      // then accepts an incoming row when incomingTs >= existingTs, so
      // reporting the server write clock here made the device overwrite its
      // own freshly recorded session with the lossy pull projection
      // (warmupReps 0, averaged duration, lossy mode map, constructor
      // defaults for progressionKg / isJustLift / routineId, ...).
      const firstStamp = new Date(Date.now() - 10 * 60_000).toISOString();
      const secondStamp = new Date(Date.now() - 9 * 60_000).toISOString();
      await pushOk(push, lwwClockPush(first, "slow one", firstStamp));
      await pushOk(push, lwwClockPush(second, "slow two", secondStamp));

      const storedFirst = await storedLwwRow(fixture, "workout_sessions", first.sessionId);
      assert(
        epochMs(storedFirst.updated_at) > epochMs(firstStamp),
        "the server write clock is ahead of the slow device",
      );

      const response = await pull(requestFromBody({
        deviceId: "device-a",
        lastSync: 0,
        pageSize: 75,
      }));
      const body = await json(response);
      assertEquals(response.status, 200, JSON.stringify(body));
      const sessions = body.sessions as Array<Record<string, unknown>>;
      const byId = new Map(sessions.map((s) => [s.id as string, s]));
      assertEquals(
        epochMs(byId.get(first.sessionId)?.updatedAt),
        epochMs(firstStamp),
        "the pull reports the device's own stamp for its just-pushed session",
      );
      assertEquals(
        epochMs(byId.get(second.sessionId)?.updatedAt),
        epochMs(secondStamp),
        "...for every session in the page",
      );
      assert(
        epochMs(byId.get(first.sessionId)?.updatedAt) <= epochMs(storedFirst.updated_at),
        "the reported stamp never exceeds what the device pushed",
      );

      // The pagination cursor must stay on the server write clock, otherwise
      // pages would be ordered by one clock and filtered by another.
      const paged = await pull(requestFromBody({
        deviceId: "device-a",
        lastSync: 0,
        pageSize: 1,
      }));
      const pagedBody = await json(paged);
      assertEquals(paged.status, 200, JSON.stringify(pagedBody));
      assertEquals(pagedBody.hasMore, true);
      const cursor = JSON.parse(atob(String(pagedBody.nextCursor))) as {
        type: string;
        updatedAt: string;
        id: string;
      };
      assertEquals(cursor.type, "sessions");
      assertEquals(cursor.id, first.sessionId);
      assertEquals(
        epochMs(cursor.updatedAt),
        epochMs(storedFirst.updated_at),
        "the next-page cursor is the server write clock, not the device stamp",
      );
    } finally {
      await deleteTombstonePushFixture(fixture.admin, [fixture.ownerId]);
    }
  },
});

Deno.test({
  name:
    "integration: public catalog rows are cached for 10 minutes per handler",
  ignore: localIntegrationEnvironment === null,
  fn: async () => {
    const fixture = await createCatalogIntegrationFixture();
    const lateId = `pr58-late-public-${fixture.suffix}`;
    try {
      let nowMs = Date.now();
      const handler = realPushHandler(fixture, () => nowMs);
      const ref = { exerciseId: lateId, name: `Pr58 Late ${fixture.suffix}` };

      assertEquals(await pushSession(handler, fixture, [ref]), [null]);
      const inserted = await fixture.admin.from("exercise_catalog").insert({
        id: lateId,
        name: ref.name,
        display_name: ref.name,
        muscle_group: "Chest",
        is_custom: false,
      });
      if (inserted.error) throw new Error("late public row insert failed");

      nowMs += 9 * 60 * 1000;
      assertEquals(await pushSession(handler, fixture, [ref]), [null]);

      nowMs += 2 * 60 * 1000;
      assertEquals(await pushSession(handler, fixture, [ref]), [lateId]);
    } finally {
      await cleanupCatalogIntegrationFixture(fixture);
      await fixture.admin.from("exercise_catalog").delete().eq("id", lateId);
    }
  },
});

Deno.test({
  name:
    "integration: a foreign cycle_days id in a push leaves the victim row untouched",
  ignore: localIntegrationEnvironment === null,
  fn: async () => {
    const fixture = await createCatalogIntegrationFixture();
    try {
      const victimCycleId = crypto.randomUUID();
      const victimDayId = crypto.randomUUID();
      const victimCycle = await fixture.admin.from("training_cycles").insert({
        id: victimCycleId,
        user_id: fixture.otherUserId,
        name: "Victim cycle",
      });
      if (victimCycle.error) throw new Error("victim cycle insert failed");
      const victimDay = await fixture.admin.from("cycle_days").insert({
        id: victimDayId,
        cycle_id: victimCycleId,
        day_number: 1,
        notes: "victim",
      });
      if (victimDay.error) throw new Error("victim day insert failed");

      const ownCycleId = crypto.randomUUID();
      const body = validPushBody();
      body.profileId = "default";
      body.cycles = [{
        id: ownCycleId,
        userId: fixture.ownerId,
        name: "Owner cycle",
        days: [{
          id: victimDayId,
          cycleId: ownCycleId,
          dayNumber: 1,
          notes: "attacker",
        }],
      }];
      const response = await realPushHandler(fixture)(requestFromBody(body));
      assertEquals(response.status, 200, JSON.stringify(await json(response)));

      const victim = await fixture.admin.from("cycle_days")
        .select("cycle_id, day_number, notes")
        .eq("id", victimDayId)
        .single();
      if (victim.error) throw new Error("victim day verification failed");
      assertEquals(victim.data, {
        cycle_id: victimCycleId,
        day_number: 1,
        notes: "victim",
      });
      const own = await fixture.admin.from("cycle_days")
        .select("id, notes")
        .eq("cycle_id", ownCycleId);
      if (own.error) throw new Error("owner day verification failed");
      assertEquals(own.data.length, 1);
      assert(own.data[0].id !== victimDayId);
      assertEquals(own.data[0].notes, "attacker");
    } finally {
      await cleanupCatalogIntegrationFixture(fixture);
    }
  },
});

async function countGateSessions(
  fixture: GateFixture,
  sessionId: string,
): Promise<number> {
  const audit = await fixture.admin.from("workout_sessions")
    .select("id", { count: "exact", head: true })
    .eq("id", sessionId);
  if (audit.error) throw new Error("gate session audit failed");
  return audit.count ?? -1;
}

for (
  const [label, subscription] of [
    ["no subscriptions row", null],
    ["an active FREE row", {
      tier: "FREE",
      status: "active",
      current_period_end: "2099-01-01T00:00:00.000Z",
    }],
  ] as const
) {
  Deno.test({
    name:
      `integration: push subscription gate denies ${label} with 402 and writes nothing`,
    ignore: localIntegrationEnvironment === null,
    fn: async () => {
      const fixture = await createGateFixture(subscription);
      try {
        const sessionId = crypto.randomUUID();
        const broadcastTopics: string[] = [];
        const response = await realGatePushHandler(fixture, broadcastTopics)(
          requestFromBody(singleSessionPushBody(sessionId, fixture.userId)),
        );
        const body = await json(response);
        assertEquals(response.status, 402, JSON.stringify(body));
        assertEquals(body.error, "subscription_required");
        assertEquals(body.currentTier, "FREE");
        assertEquals(await countGateSessions(fixture, sessionId), 0);
        assertEquals(broadcastTopics, []);
      } finally {
        await deleteGateFixture(fixture.admin, fixture.userId);
      }
    },
  });
}

Deno.test({
  name: "integration: push subscription gate lets an active EMBER row write",
  ignore: localIntegrationEnvironment === null,
  fn: async () => {
    const fixture = await createGateFixture({
      tier: "EMBER",
      status: "active",
      current_period_end: "2099-01-01T00:00:00.000Z",
    });
    try {
      const sessionId = crypto.randomUUID();
      const broadcastTopics: string[] = [];
      const response = await realGatePushHandler(fixture, broadcastTopics)(
        requestFromBody(singleSessionPushBody(sessionId, fixture.userId)),
      );
      const body = await json(response);
      assertEquals(response.status, 200, JSON.stringify(body));
      assertEquals(await countGateSessions(fixture, sessionId), 1);
      assertEquals(broadcastTopics, [`sync:${fixture.userId}`]);
    } finally {
      await deleteGateFixture(fixture.admin, fixture.userId);
    }
  },
});
Deno.test({
  name:
    `integration: lww clock (LWW=${SYNC_LWW_ENABLED}) the flag-off PostgREST upsert cannot move a row to another owner (R-13)`,
  ignore: localIntegrationEnvironment === null,
  fn: async () => {
    const fixture = await createTombstonePushFixture();
    let attackerId: string | null = null;
    try {
      const push = realTombstonePushHandler(fixture);
      const ids = { sessionId: crypto.randomUUID(), routineId: crypto.randomUUID() };
      await pushOk(
        push,
        lwwClockPush(ids, "victim", new Date(Date.now() - 60_000).toISOString()),
      );

      const suffix = crypto.randomUUID();
      const attacker = await fixture.admin.auth.admin.createUser({
        email: `pr21-attacker-${suffix}@example.invalid`,
        password: `pw-${suffix}`,
        email_confirm: true,
      });
      if (attacker.error || !attacker.data.user) throw new Error("attacker fixture failed");
      attackerId = attacker.data.user.id;

      // SYNC_LWW_ENABLED defaults to false, so the SHIPPING push path is the
      // service-role PostgREST upsert at mobile-sync-push/index.ts:1786-1789,
      // which never reaches the guarded LWW RPCs. It writes user_id along
      // with the content, so a victim id landing in the TOCTOU window after
      // assertRowsOwnedByUser changes the row's OWNER outright. This is that
      // exact write, issued the way the handler issues it. Without the
      // owner-immutable trigger it succeeds.
      const takeover = await fixture.admin
        .from("workout_sessions")
        .upsert(
          {
            id: ids.sessionId,
            user_id: attackerId,
            name: "takeover",
            started_at: "2026-07-01T08:00:00.000Z",
            client_updated_at: new Date(Date.now() + 86_400_000).toISOString(),
          },
          { onConflict: "id" },
        );
      assert(takeover.error !== null, "the cross-user session upsert must be refused");
      assertEquals(takeover.error?.code, "42501", JSON.stringify(takeover.error));

      const routineTakeover = await fixture.admin
        .from("routines")
        .upsert(
          {
            id: ids.routineId,
            user_id: attackerId,
            name: "takeover",
            client_updated_at: new Date(Date.now() + 86_400_000).toISOString(),
          },
          { onConflict: "id" },
        );
      assert(routineTakeover.error !== null, "the cross-user routine upsert must be refused");
      assertEquals(routineTakeover.error?.code, "42501", JSON.stringify(routineTakeover.error));

      const session = await storedLwwRow(fixture, "workout_sessions", ids.sessionId);
      const routine = await storedLwwRow(fixture, "routines", ids.routineId);
      assertEquals(session.name, "Session victim", "the victim's session is untouched");
      assertEquals(routine.name, "Routine victim", "the victim's routine is untouched");
      const owners = await fixture.admin
        .from("workout_sessions")
        .select("user_id")
        .eq("id", ids.sessionId)
        .single();
      if (owners.error) throw new Error(`owner lookup failed: ${owners.error.message}`);
      assertEquals(
        (owners.data as unknown as { user_id: string }).user_id,
        fixture.ownerId,
        "the row still belongs to the victim",
      );
    } finally {
      const toDelete = attackerId === null
        ? [fixture.ownerId]
        : [fixture.ownerId, attackerId];
      await deleteTombstonePushFixture(fixture.admin, toDelete);
    }
  },
});

Deno.test("PR 24: exercise_progress rows ride in replace_session_children as p_progress, with no separate progress read or write", async () => {
  const harness = makeHarness(undefined, {
    catalogRows: [{
      id: "pr24-lat-pulldown",
      name: "Lat Pulldown",
      display_name: "Lat Pulldown",
      aliases: [],
      user_id: null,
      is_custom: false,
      archived: false,
    }],
    // Only `replace_session_children` is modelled here; everything else (the
    // LWW upserts in particular) falls through to the harness defaults, so
    // this test asserts the same thing under both values of SYNC_LWW_ENABLED.
    rpcBehavior: async (name) =>
      name === "replace_session_children"
        ? { data: { exercise_progress: 2 }, error: null }
        : undefined,
  });
  const exercise = (
    id: string,
    setId: string,
    name: string,
    weightKg: number,
    extra: Record<string, unknown> = {},
  ) => ({
    id,
    sessionId: SESSION_ID,
    name,
    exerciseId: null,
    muscleGroup: "Back",
    ...extra,
    sets: [{
      id: setId,
      exerciseId: id,
      setNumber: 1,
      targetReps: 10,
      actualReps: 10,
      weightKg,
    }],
  });
  const body = validPushBody();
  body.sessions = [{
    id: SESSION_ID,
    userId: VALID_USER_ID,
    startedAt: "2026-01-20T10:00:00.000Z",
    updatedAt: "2026-01-20T10:30:00.000Z",
    workoutMode: "OLD_SCHOOL",
    exercises: [
      exercise(
        "00000000-0000-4000-8000-000000002401",
        "00000000-0000-4000-8000-000000002501",
        "PR24 Custom A",
        30,
      ),
      exercise(
        "00000000-0000-4000-8000-000000002402",
        "00000000-0000-4000-8000-000000002502",
        "PR24 Custom B",
        40,
        { estimatedOneRepMaxKg: 55.555 },
      ),
      // Same identity as A in the same session: the first row wins, as before.
      exercise(
        "00000000-0000-4000-8000-000000002403",
        "00000000-0000-4000-8000-000000002503",
        "PR24 Custom A",
        90,
      ),
      // Catalog branch: same catalog id under two different names is one
      // identity (id:<catalog id>); the first row wins.
      exercise(
        "00000000-0000-4000-8000-000000002404",
        "00000000-0000-4000-8000-000000002504",
        "Lat Pulldown (wide)",
        50,
        { exerciseId: "pr24-lat-pulldown" },
      ),
      exercise(
        "00000000-0000-4000-8000-000000002405",
        "00000000-0000-4000-8000-000000002505",
        "Lat Pulldown (close)",
        70,
        { exerciseId: "pr24-lat-pulldown" },
      ),
    ],
  }];

  const response = await harness.handler(requestFromBody(body));
  const responseBody = await json(response);

  assertEquals(response.status, 200, JSON.stringify(responseBody));
  const replaceCalls = harness.adminRpcCalls.filter((call) =>
    call.name === "replace_session_children"
  );
  assertEquals(replaceCalls.length, 1);
  assertEquals(replaceCalls[0].args.p_session_ids, [SESSION_ID]);
  const progress = replaceCalls[0].args.p_progress as Array<
    Record<string, unknown>
  >;
  assertEquals(
    progress.map((row) => ({
      session_id: row.session_id,
      user_id: row.user_id,
      exercise_name: row.exercise_name,
      exercise_id: row.exercise_id,
      max_weight_kg: row.max_weight_kg,
      estimated_1rm_kg: row.estimated_1rm_kg,
    })),
    [
      {
        session_id: SESSION_ID,
        user_id: VALID_USER_ID,
        exercise_name: "PR24 Custom A",
        exercise_id: null,
        max_weight_kg: 30,
        // Hybrid fallback (Brzycki at 10 reps), rounded to 2dp.
        estimated_1rm_kg: 40,
      },
      {
        session_id: SESSION_ID,
        user_id: VALID_USER_ID,
        exercise_name: "PR24 Custom B",
        exercise_id: null,
        max_weight_kg: 40,
        // Mobile estimate stored verbatim, never rounded.
        estimated_1rm_kg: 55.555,
      },
      {
        session_id: SESSION_ID,
        user_id: VALID_USER_ID,
        exercise_name: "Lat Pulldown (wide)",
        exercise_id: "pr24-lat-pulldown",
        max_weight_kg: 50,
        estimated_1rm_kg: 66.67,
      },
    ],
  );
  // The response reports the count the RPC returns, not the rows sent (3):
  // the stub returns 2 to prove the value comes from the RPC result.
  assertEquals(responseBody.exerciseProgressInserted, 2);
  assertEquals(
    harness.adminFromCalls.filter((table) => table === "exercise_progress"),
    [],
  );
});

Deno.test("PR 24: an accepted session with no progress rows still sends p_progress as an empty array", async () => {
  const harness = makeHarness();
  const body = validPushBody();
  body.sessions = [{
    id: SESSION_ID,
    userId: VALID_USER_ID,
    startedAt: "2026-01-20T10:00:00.000Z",
    updatedAt: "2026-01-20T10:30:00.000Z",
    workoutMode: "OLD_SCHOOL",
    exercises: [],
  }];

  const response = await harness.handler(requestFromBody(body));

  assertEquals(response.status, 200);
  const replaceCalls = harness.adminRpcCalls.filter((call) =>
    call.name === "replace_session_children"
  );
  assertEquals(replaceCalls.length, 1);
  assertEquals(replaceCalls[0].args.p_progress, []);
});

Deno.test("PR 24: with LWW on, a rejected session is in neither p_session_ids nor p_progress, so its stored progress is kept", async () => {
  const acceptedId = "00000000-0000-4000-8000-000000002610";
  const rejectedId = "00000000-0000-4000-8000-000000002620";
  const harness = makeHarness(undefined, {
    syncLwwEnabled: true,
    rpcBehavior: async (name) => {
      if (name === "upsert_workout_session_lww") {
        return {
          data: [
            { id: acceptedId, accepted: true, server_updated_at: null },
            {
              id: rejectedId,
              accepted: false,
              server_updated_at: "2026-01-21T00:00:00.000Z",
            },
          ],
          error: null,
        };
      }
      if (name === "replace_session_children") {
        return { data: { exercise_progress: 1 }, error: null };
      }
      return { data: [], error: null };
    },
  });
  const session = (id: string, suffix: string) => ({
    id,
    userId: VALID_USER_ID,
    startedAt: "2026-01-20T10:00:00.000Z",
    updatedAt: "2026-01-20T10:30:00.000Z",
    workoutMode: "OLD_SCHOOL",
    exercises: [{
      id: `00000000-0000-4000-8000-0000000027${suffix}`,
      sessionId: id,
      name: `PR24 LWW ${suffix}`,
      exerciseId: null,
      muscleGroup: "Back",
      sets: [{
        id: `00000000-0000-4000-8000-0000000028${suffix}`,
        exerciseId: `00000000-0000-4000-8000-0000000027${suffix}`,
        setNumber: 1,
        targetReps: 10,
        actualReps: 10,
        weightKg: 30,
      }],
    }],
  });
  const body = validPushBody();
  body.sessions = [session(acceptedId, "10"), session(rejectedId, "20")];

  const response = await harness.handler(requestFromBody(body));
  const responseBody = await json(response);

  assertEquals(response.status, 200, JSON.stringify(responseBody));
  assertEquals(
    (responseBody.rejections as Record<string, unknown>).sessions,
    [{ id: rejectedId, serverUpdatedAt: "2026-01-21T00:00:00.000Z" }],
  );
  const replaceCalls = harness.adminRpcCalls.filter((call) =>
    call.name === "replace_session_children"
  );
  assertEquals(replaceCalls.length, 1);
  assertEquals(replaceCalls[0].args.p_session_ids, [acceptedId]);
  assertEquals(
    (replaceCalls[0].args.p_progress as Array<Record<string, unknown>>).map(
      (row) => row.session_id,
    ),
    [acceptedId],
  );
  assertEquals(responseBody.exerciseProgressInserted, 1);
});

// ---------------------------------------------------------------------------
// PR 28 (FP-4): per-exercise cable count rides in p_exercises as cable_count.
// Optional and nested (KD-2): today's mobile shape sends nothing -> NULL.
// ---------------------------------------------------------------------------

function cableCountSession(
  sessionId: string,
  exercises: Array<{ suffix: string; extra?: Record<string, unknown> }>,
) {
  return {
    id: sessionId,
    userId: VALID_USER_ID,
    startedAt: "2026-01-20T10:00:00.000Z",
    updatedAt: "2026-01-20T10:30:00.000Z",
    workoutMode: "OLD_SCHOOL",
    exercises: exercises.map(({ suffix, extra }, index) => ({
      id: `00000000-0000-4000-8000-0000000029${suffix}`,
      sessionId,
      name: `PR28 Custom ${suffix}`,
      exerciseId: null,
      muscleGroup: "Back",
      orderIndex: index,
      ...(extra ?? {}),
      sets: [{
        id: `00000000-0000-4000-8000-0000000030${suffix}`,
        exerciseId: `00000000-0000-4000-8000-0000000029${suffix}`,
        setNumber: 1,
        targetReps: 10,
        actualReps: 10,
        weightKg: 30,
      }],
    })),
  };
}

for (const syncLwwEnabled of [false, true]) {
  Deno.test(`PR 28: cableCount is sent to replace_session_children as cable_count; absent or null is NULL (LWW ${syncLwwEnabled ? "on" : "off"})`, async () => {
    const harness = makeHarness(undefined, {
      syncLwwEnabled,
      rpcBehavior: async (name) => {
        if (name === "upsert_workout_session_lww") {
          return {
            data: [{ id: SESSION_ID, accepted: true, server_updated_at: null }],
            error: null,
          };
        }
        return { data: [], error: null };
      },
    });
    const body = validPushBody();
    body.sessions = [cableCountSession(SESSION_ID, [
      { suffix: "01", extra: { cableCount: 1 } },
      { suffix: "02", extra: { cableCount: 2 } },
      // Today's mobile shape: no cableCount key at all.
      { suffix: "03" },
      { suffix: "04", extra: { cableCount: null } },
    ])];

    const response = await harness.handler(requestFromBody(body));

    assertEquals(response.status, 200, await response.text());
    const replaceCalls = harness.adminRpcCalls.filter((call) =>
      call.name === "replace_session_children"
    );
    assertEquals(replaceCalls.length, 1);
    assertEquals(
      (replaceCalls[0].args.p_exercises as Array<Record<string, unknown>>).map(
        (row) => [row.name, row.cable_count],
      ),
      [
        ["PR28 Custom 01", 1],
        ["PR28 Custom 02", 2],
        ["PR28 Custom 03", null],
        ["PR28 Custom 04", null],
      ],
    );
  });
}

for (const bad of [0, 3, 1.5, "2", true]) {
  Deno.test(`PR 28: cableCount ${JSON.stringify(bad)} is a 400 before any privileged write`, async () => {
    const harness = makeHarness();
    const body = validPushBody();
    body.sessions = [cableCountSession(SESSION_ID, [
      { suffix: "11", extra: { cableCount: bad } },
    ])];

    const response = await harness.handler(requestFromBody(body));

    assertEquals(response.status, 400);
    assertEquals(harness.adminConstructionCount.value, 0);
    assertEquals(harness.adminRpcCalls, []);
  });
}

Deno.test({
  name:
    "integration: handler push stores exercises.cable_count and pull returns cableCount (1 stays 1, absent stays null)",
  ignore: localIntegrationEnvironment === null,
  fn: async () => {
    const fixture = await createLocalIntegrationFixture();
    try {
      const subscription = await fixture.admin.from("subscriptions").insert({
        user_id: fixture.ownerId,
        tier: "INFERNO",
        status: "active",
        current_period_end: new Date(Date.now() + 86_400_000).toISOString(),
      });
      if (subscription.error) {
        throw new Error("subscription fixture creation failed");
      }

      const sessionId = crypto.randomUUID();
      const singleCable = crypto.randomUUID();
      const unknownCable = crypto.randomUUID();
      const exercise = (
        id: string,
        name: string,
        orderIndex: number,
        extra: Record<string, unknown>,
      ) => ({
        id,
        sessionId,
        exerciseId: null,
        name,
        orderIndex,
        ...extra,
        sets: [{
          id: crypto.randomUUID(),
          exerciseId: id,
          setNumber: 1,
          targetReps: 10,
          actualReps: 10,
          weightKg: 20,
          workoutMode: "OLD_SCHOOL",
          repSummaries: [],
        }],
      });
      const body = {
        ...validPushBody(),
        profileId: fixture.profileId,
        sessions: [{
          id: sessionId,
          userId: fixture.ownerId,
          name: "PR28 session",
          startedAt: "2026-09-18T10:00:00.000Z",
          updatedAt: new Date().toISOString(),
          exercises: [
            exercise(singleCable, "PR28 Single Cable Row", 0, { cableCount: 1 }),
            // Today's mobile shape: no cableCount key.
            exercise(unknownCable, "PR28 Unknown Cable Row", 1, {}),
          ],
        }],
      };

      const pushed = await makeRealSqlPushHandler(fixture)(
        requestFromBody(body),
      );
      assertEquals(pushed.status, 200, await pushed.text());

      const stored = await fixture.admin.from("exercises")
        .select("id,cable_count")
        .eq("session_id", sessionId);
      if (stored.error) throw new Error("exercise verification failed");
      const storedById = new Map(
        (stored.data as Array<{ id: string; cable_count: number | null }>)
          .map((row) => [row.id, row.cable_count]),
      );
      assertEquals(storedById.get(singleCable), 1);
      assertEquals(storedById.get(unknownCable), null);

      const pull = createMobileSyncPullHandler({
        createAuthClient() {
          return {
            auth: {
              async getUser() {
                return { data: { user: { id: fixture.ownerId } }, error: null };
              },
            },
          };
        },
        createAdminClient() {
          return fixture.admin;
        },
        logOperationalFailure: () => {},
        now: () => Date.now(),
      } as never);
      const pulled = await pull(requestFromBody({
        deviceId: "pr28-device",
        lastSync: 0,
        profileId: fixture.profileId,
        pageSize: 75,
        knownEntityIds: {
          sessionIds: [],
          routineIds: [],
          cycleIds: [],
          badgeIds: [],
          personalRecordIds: [],
        },
      }));
      const pulledBody = await json(pulled);
      assertEquals(pulled.status, 200, JSON.stringify(pulledBody));
      const session = (pulledBody.sessions as Array<Record<string, unknown>>)
        .find((row) => row.id === sessionId);
      assert(session, "pushed session is pulled back");
      assertEquals(
        (session.exercises as Array<Record<string, unknown>>).map((row) => [
          row.id,
          row.cableCount,
        ]),
        [[singleCable, 1], [unknownCable, null]],
      );
    } finally {
      await cleanupLocalIntegrationFixture(fixture);
    }
  },
});
function routineExerciseUpsertRows(
  harness: PushHarness,
): Array<Record<string, unknown>> {
  const upserts = harness.adminWriteArgs.filter((call) =>
    call.table === "routine_exercises" && call.method === "upsert"
  );
  assertEquals(upserts.length, 1);
  return upserts[0].args[0] as Array<Record<string, unknown>>;
}

Deno.test("current mobile routine exercise shape (no durationSeconds) is 200 and leaves duration untouched", async () => {
  const harness = makeHarness();
  const response = await harness.handler(
    requestFromBody(routinePushBody([
      currentMobileRoutineExercise(ROUTINE_EXERCISE_ID),
    ])),
  );

  assertEquals(response.status, 200);
  const [row] = routineExerciseUpsertRows(harness);
  assertEquals(row.id, ROUTINE_EXERCISE_ID);
  assertEquals(row.eccentric_load, "LOAD_100");
  // The column is not in the upsert at all, so a stored duration survives.
  assertEquals("duration_seconds" in row, false);
});

/**
 * A routine_exercises stand-in that honours the probe's `.select(columns)`
 * and `.in("id", ids)`: it returns only the requested rows, projected to the
 * requested columns. Writes resolve empty.
 */
function storedRoutineExercises(
  stored: Array<Record<string, unknown>>,
): TerminalResult {
  return (operations) => {
    const select = operations.find((op) => op.name === "select");
    const inIds = operations.find((op) => op.name === "in");
    if (!select || !inIds) return { data: [], error: null };
    const columns = String(select.args[0]).split(",").map((c) => c.trim());
    const ids = inIds.args[1] as string[];
    return {
      data: stored
        .filter((row) => ids.includes(row.id as string))
        .map((row) =>
          Object.fromEntries(
            columns.filter((c) => c in row).map((c) => [c, row[c]]),
          )
        ),
      error: null,
    };
  };
}

for (
  const omitter of [
    {
      label: "current mobile shape (drop-set fields omitted)",
      fields: {},
    },
    {
      // needsDropSetExistingRow(e) is false here, so only the duration
      // predicate decides whether this row is probed.
      label: "explicit drop-set fields",
      fields: { dropSetEnabled: false, dropSetMinWeightKg: null },
    },
  ]
) {
  Deno.test(`routine exercise without durationSeconds keeps its stored duration in a mixed batch: ${omitter.label}`, async () => {
    const harness = makeHarness(async () => VALID_AUTH_RESULT, {
      tableResults: {
        routine_exercises: storedRoutineExercises([{
          id: ROUTINE_EXERCISE_ID,
          drop_set_enabled: false,
          drop_set_min_weight_kg: null,
          duration_seconds: 45,
        }]),
      },
    });
    const timed = {
      ...currentMobileRoutineExercise(TIMED_ROUTINE_EXERCISE_ID),
      orderIndex: 1,
      durationSeconds: 30,
      dropSetEnabled: false,
      dropSetMinWeightKg: null,
    };
    const response = await harness.handler(
      requestFromBody(routinePushBody([
        { ...currentMobileRoutineExercise(ROUTINE_EXERCISE_ID), ...omitter.fields },
        timed,
      ])),
    );

    assertEquals(response.status, 200);
    const rows = routineExerciseUpsertRows(harness);
    const byId = new Map(rows.map((row) => [row.id, row]));
    // Omitted: filled from the stored row, never NULLed by the batch key union.
    assertEquals(byId.get(ROUTINE_EXERCISE_ID)?.duration_seconds, 45);
    // Sent: stored as given.
    assertEquals(byId.get(TIMED_ROUTINE_EXERCISE_ID)?.duration_seconds, 30);
  });
}

Deno.test("routine exercise durationSeconds null clears the duration", async () => {
  const harness = makeHarness();
  const response = await harness.handler(
    requestFromBody(routinePushBody([{
      ...currentMobileRoutineExercise(ROUTINE_EXERCISE_ID),
      durationSeconds: null,
    }])),
  );

  assertEquals(response.status, 200);
  const [row] = routineExerciseUpsertRows(harness);
  assertEquals(row.duration_seconds, null);
});

for (const bad of [-1, 1.5, "45", 2_147_483_648]) {
  Deno.test(`routine exercise durationSeconds ${JSON.stringify(bad)} is rejected before privileges`, async () => {
    const harness = makeHarness();
    const response = await harness.handler(
      requestFromBody(routinePushBody([{
        ...currentMobileRoutineExercise(ROUTINE_EXERCISE_ID),
        durationSeconds: bad,
      }])),
    );

    assertEquals(response.status, 400);
    assertNoPrivilegedActivity(harness);
  });
}
