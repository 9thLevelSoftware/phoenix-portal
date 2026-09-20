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
import { createMobileSyncPushHandler } from "./index.ts";
import { localIntegrationEnvironment } from "../_shared/localIntegrationEnvironment.ts";
import { SYNC_LWW_ENABLED } from "../_shared/flags.ts";

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
  const digest = await crypto.subtle.digest("SHA-256", bytes);
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
    body,
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

const DEFAULT_SUBSCRIPTION_RESULT = {
  data: {
    tier: "EMBER",
    status: "active",
    current_period_end: "2099-01-01T00:00:00.000Z",
  },
  error: null,
};

function permissiveQuery(
  table: string,
  onWrite: (method: string, args: unknown[]) => void,
  terminalResult: TerminalResult = {
    data: [],
    error: null,
    count: 0,
  },
  subscriptionResult: { data: unknown; error: unknown } =
    DEFAULT_SUBSCRIPTION_RESULT,
  writeError?: (method: string) => unknown,
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
  const operations = [] as unknown as QueryOperations;
  for (const method of chainMethods) {
    query[method] = (...args: unknown[]) => {
      onCall?.(method, args);
      operations.push({ name: method, args });
      if (method === "neq") ownershipProbe = true;
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
        ? { data: [], error: null, count: 0 }
        : typeof terminalResult === "function"
        ? terminalResult(operations)
        : terminalResult,
    ).then(resolve, reject);
  return query;
}

interface QueryOperation {
  name: string;
  args: unknown[];
}

type QueryOperations = QueryOperation[] & Record<string, unknown>;

type TerminalResult =
  | { data: unknown; error: unknown; count?: number }
  | ((operations: QueryOperations) => { data: unknown; error: unknown });

interface PushHarness {
  handler: (request: Request) => Promise<Response>;
  authClientAuthorizations: string[];
  getUserJwts: string[];
  adminConstructionCount: { value: number };
  adminRpcCalls: Array<{ name: string; args: Record<string, unknown> }>;
  adminFromCalls: string[];
  adminWriteCalls: Array<{ table: string; method: string }>;
  adminWriteArgs: Array<{ table: string; method: string; args: unknown[] }>;
  loggerCalls: unknown[][];
  operationEvents: string[];
  channelCalls: Array<{ topic: string; config?: Record<string, unknown> }>;
  broadcastPayloads: unknown[];
  /** Every admin query builder with its chained calls and arguments. */
  adminQueries: AdminQueryRecord[];
}

interface AdminQueryRecord {
  table: string;
  calls: Array<{ method: string; args: unknown[] }>;
}

function makeHarness(
  authBehavior: AuthBehavior = async () => VALID_AUTH_RESULT,
  options: {
    channelError?: unknown;
    rpcBehavior?: RpcBehavior;
    personalRecordsResult?: { data: unknown; error: unknown };
    subscriptionResult?: { data: unknown; error: unknown };
    /** Error injected into a write, keyed `table:method` (e.g. `routines:delete`). */
    writeErrors?: Record<string, unknown>;
    /** Real clients for chosen tables (real-SQL tests); others stay mocked. */
    tableClients?: Record<string, { from(table: string): unknown }>;
    /**
     * Terminal result for reads/writes on these tables (e.g. probes); a
     * function receives the chained operations (select/in/... with args).
     */
    tableResults?: Record<string, TerminalResult>;
  } = {},
): PushHarness {
  const authClientAuthorizations: string[] = [];
  const getUserJwts: string[] = [];
  const adminConstructionCount = { value: 0 };
  const adminRpcCalls: Array<{ name: string; args: Record<string, unknown> }> =
    [];
  const adminFromCalls: string[] = [];
  const adminWriteCalls: Array<{ table: string; method: string }> = [];
  const adminWriteArgs: Array<{ table: string; method: string; args: unknown[] }> =
    [];
  const loggerCalls: unknown[][] = [];
  const operationEvents: string[] = [];
  const channelCalls: Array<{ topic: string; config?: Record<string, unknown> }> =
    [];
  const broadcastPayloads: unknown[] = [];
  const adminQueries: AdminQueryRecord[] = [];

  const admin = {
    from(table: string) {
      adminFromCalls.push(table);
      const realClient = options.tableClients?.[table];
      if (realClient) return realClient.from(table);
      const record: AdminQueryRecord = { table, calls: [] };
      adminQueries.push(record);
      return permissiveQuery(
        table,
        (method, args) => {
          adminWriteCalls.push({ table, method });
          adminWriteArgs.push({ table, method, args });
          operationEvents.push(`write:${table}:${method}`);
        },
        table === "personal_records"
          ? options.personalRecordsResult
          : options.tableResults?.[table],
        options.subscriptionResult,
        (method) => options.writeErrors?.[`${table}:${method}`],
        (method, args) => record.calls.push({ method, args }),
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
      if (options.rpcBehavior) return await options.rpcBehavior(name, args);
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
          callback("SUBSCRIBED");
          return {};
        },
        async send(message: { payload?: unknown }) {
          broadcastPayloads.push(message.payload);
          return "ok";
        },
      };
    },
    async removeChannel() {
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
    now: () => 1_784_167_200_000,
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
    loggerCalls,
    operationEvents,
    channelCalls,
    broadcastPayloads,
    adminQueries,
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
  assertEquals(harness.operationEvents, [
    "rpc:check_rate_limit",
    "write:workout_sessions:upsert",
    "rpc:replace_session_children",
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

Deno.test("broadcasts private sync_complete with { syncTime } only", async () => {
  const harness = makeHarness();
  const response = await harness.handler(requestFromBody(validPushBody()));

  assertEquals(response.status, 200);
  assertEquals(harness.channelCalls.length, 1);
  assertEquals(harness.channelCalls[0]?.topic, `sync:${VALID_USER_ID}`);
  assertEquals(harness.channelCalls[0]?.config?.private, true);
  assertEquals(harness.broadcastPayloads, [{
    syncTime: "2026-07-16T02:00:00.000Z",
  }]);
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
      channelError: Object.assign(new Error("database secret"), {
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
  });
  const response = await harness.handler(requestFromBody({
    ...validPushBody(),
    deletedCycleIds: [CYCLE_ID],
  }));
  await assertPartialWriteRetry(harness, response);
});

Deno.test("routine exercise orphan cleanup failure returns retryable 503", async () => {
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

Deno.test("routine and cycle tombstone deletes are chunked at 100 ids", async () => {
  const routineIds = manyIds("8a00", 250);
  const cycleIds = manyIds("8b00", 201);
  const harness = makeHarness();
  const response = await harness.handler(requestFromBody({
    ...validPushBody(),
    deletedRoutineIds: routineIds,
    deletedCycleIds: cycleIds,
  }));

  assertEquals(response.status, 200);
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
  assert(
    secondWrites.slice(firstWrites.length).some((call) =>
      call.table === "training_cycles" && call.method === "upsert"
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
  const harness = makeHarness(undefined, {
    writeErrors: { "external_activities:upsert": INJECTED_DB_ERROR },
  });
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

Deno.test("an uppercase personal record UUID cannot bypass a lowercase stored tombstone", async () => {
  const personalRecordId = "abcdefab-cdef-4abc-8abc-abcdefabcdef";
  const uppercasePersonalRecordId = personalRecordId.toUpperCase();
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
      id: uppercasePersonalRecordId,
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

Deno.test("personal record UUID casing is one payload identity", async () => {
  const personalRecordId = "abcdefab-cdef-4abc-8abc-abcdefabcdea";
  const baseRecord = {
    exerciseName: "Bench Press",
    recordType: "MAX_WEIGHT",
    value: 105,
    achievedAt: "2026-06-01T12:00:00.000Z",
    updatedAt: "2026-07-03T12:00:00.000Z",
  };
  const harness = makeHarness();
  const response = await harness.handler(requestFromBody({
    ...validPushBody(),
    personalRecords: [
      { ...baseRecord, id: personalRecordId },
      { ...baseRecord, id: personalRecordId.toUpperCase(), value: 110 },
    ],
  }));
  const body = await json(response);

  assertEquals(response.status, 200, JSON.stringify(body));
  assertEquals(body.personalRecordsInserted, 1);
  const written = upsertedRows(harness, "personal_records");
  assertEquals(written.length, 1);
  assertEquals(written[0].id, personalRecordId.toUpperCase());
  assertEquals(written[0].value, 110);
});

Deno.test("an uppercase routine exercise UUID preserves lowercase stored drop-set fields", async () => {
  const lowercaseExerciseId = ROUTINE_EXERCISE_ID;
  const uppercaseExerciseId = lowercaseExerciseId.toUpperCase();
  const body = validNestedRelationshipBody();
  const routine = (body.routines as Record<string, unknown>[])[0];
  const exercise = (routine.exercises as Record<string, unknown>[])[0];
  exercise.id = uppercaseExerciseId;
  delete exercise.dropSetEnabled;
  delete exercise.dropSetMinWeightKg;

  const harness = makeHarness(undefined, {
    tableResults: {
      routine_exercises: {
        data: [{
          id: lowercaseExerciseId,
          drop_set_enabled: true,
          drop_set_min_weight_kg: 42.5,
        }],
        error: null,
      },
    },
  });
  const response = await harness.handler(requestFromBody(body));
  const responseBody = await json(response);

  assertEquals(response.status, 200, JSON.stringify(responseBody));
  const written = upsertedRows(harness, "routine_exercises");
  assertEquals(written.length, 1);
  assertEquals(written[0].id, uppercaseExerciseId);
  assertEquals(written[0].drop_set_enabled, true);
  assertEquals(written[0].drop_set_min_weight_kg, 42.5);
});

Deno.test("an uppercase cycle UUID preserves a lowercase row's template_id", async () => {
  const lowercaseCycleId = CYCLE_ID;
  const uppercaseCycleId = lowercaseCycleId.toUpperCase();
  const body = validNestedRelationshipBody();
  const cycle = (body.cycles as Record<string, unknown>[])[0];
  const day = (cycle.days as Record<string, unknown>[])[0];
  cycle.id = uppercaseCycleId;
  day.cycleId = uppercaseCycleId;
  delete cycle.templateId;

  const harness = makeHarness(undefined, {
    tableResults: {
      training_cycles: {
        data: [{ id: lowercaseCycleId, template_id: "template_149" }],
        error: null,
      },
    },
  });
  const response = await harness.handler(requestFromBody(body));
  const responseBody = await json(response);

  assertEquals(response.status, 200, JSON.stringify(responseBody));
  const written = upsertedRows(harness, "training_cycles");
  assertEquals(written.length, 1);
  assertEquals(written[0].id, uppercaseCycleId);
  assertEquals(written[0].template_id, "template_149");
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
      // UUID columns are serialized in lowercase by PostgreSQL even when a
      // mobile client supplied uppercase hexadecimal characters.
      const ids = new Set(
        (args.p_ids as string[]).map((id) => id.toLowerCase()),
      );
      return {
        data: tombstones
          .filter((row) => ids.has(row.entity_id.toLowerCase()))
          .map((row) => ({ ...row, deleted_at: "2026-07-15T00:00:00.000Z" })),
        error: null,
      };
    }
    if (
      name === "upsert_routine_lww" || name === "upsert_training_cycle_lww"
    ) {
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
    return { data: [], error: null };
  };
}

function uppercaseRoutineIdBody(): Record<string, unknown> {
  const body = oldBuildRoutineAndCycleBody();
  const uppercaseId = "abcdefab-cdef-4abc-8abc-abcdefabcdef".toUpperCase();
  const routine = (body.routines as Record<string, unknown>[])[0];
  routine.id = uppercaseId;
  const exercise = (routine.exercises as Record<string, unknown>[])[0];
  exercise.routineId = uppercaseId;
  const cycle = (body.cycles as Record<string, unknown>[])[0];
  const day = (cycle.days as Record<string, unknown>[])[0];
  day.routineId = uppercaseId;
  return body;
}

/** Ids written to a parent table through either flag path. */
function parentWriteIds(
  harness: PushHarness,
  table: "routines" | "training_cycles",
): string[] {
  const rpcName = table === "routines"
    ? "upsert_routine_lww"
    : "upsert_training_cycle_lww";
  const viaUpsert = harness.adminWriteArgs
    .filter((call) => call.table === table && call.method === "upsert")
    .flatMap((call) => (call.args[0] as Array<{ id: string }>).map((r) => r.id));
  const viaRpc = harness.adminRpcCalls
    .filter((call) => call.name === rpcName)
    .flatMap((call) =>
      (call.args.p_rows as Array<{ id: string }>).map((r) => r.id)
    );
  return [...viaUpsert, ...viaRpc];
}

function upsertedRows(
  harness: PushHarness,
  table: string,
): Array<Record<string, unknown>> {
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

Deno.test(`tombstones (LWW=${SYNC_LWW_ENABLED}): uppercase mobile UUID matches the lowercase database tombstone`, async () => {
  const lowercaseId = "abcdefab-cdef-4abc-8abc-abcdefabcdef";
  const uppercaseId = lowercaseId.toUpperCase();
  const harness = makeHarness(undefined, {
    rpcBehavior: tombstoneRpcBehavior([
      { entity: "routine", entity_id: lowercaseId },
    ]),
  });
  const response = await harness.handler(
    requestFromBody(uppercaseRoutineIdBody()),
  );
  const body = await json(response);

  assertEquals(response.status, 200, JSON.stringify(body));
  assertEquals(body.skippedDeleted, { routines: [uppercaseId], cycles: [] });
  assertEquals(parentWriteIds(harness, "routines"), []);
  assertEquals(upsertedRows(harness, "routine_exercises"), []);
  assertEquals(upsertedRows(harness, "cycle_days")[0].routine_id, null);
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
  // Orphan-day cleanup only touches the live cycle.
  assertEquals(
    harness.adminWriteArgs.filter((call) =>
      call.table === "cycle_days" && call.method === "delete"
    ).length,
    1,
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

Deno.test(`tombstones (LWW=${SYNC_LWW_ENABLED}): a lowercase race tombstone re-deletes an uppercase mobile UUID`, async () => {
  const lowercaseId = "abcdefab-cdef-4abc-8abc-abcdefabcdef";
  const harness = makeHarness(undefined, {
    rpcBehavior: tombstoneRpcBehavior([]),
    tableResults: {
      sync_tombstones: (filters) => ({
        data: filters.entity === "routine" ? [{ entity_id: lowercaseId }] : [],
        error: null,
      }),
    },
  });
  const response = await harness.handler(
    requestFromBody(uppercaseRoutineIdBody()),
  );
  const body = await json(response);

  assertEquals(response.status, 200, JSON.stringify(body));
  assertEquals(body.skippedDeleted, { routines: [lowercaseId], cycles: [] });
  assertEquals(body.routinesUpserted, 0);
  assertEquals(
    harness.adminWriteArgs.filter((call) =>
      call.table === "routines" && call.method === "delete"
    ).length,
    1,
  );
  assertEquals(upsertedRows(harness, "cycle_days")[0].routine_id, null);
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
    rejections: {
      sessions: [],
      routines: [],
      cycles: [],
      externalActivities: [],
      rpgAttributes: [],
      gamificationStats: [],
    },
    skippedDeleted: { routines: [], cycles: [] },
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
  const replaceCalls = harness.adminRpcCalls.filter((call) =>
    call.name === "replace_session_children"
  );
  assertEquals(replaceCalls.length, 3);
  assertEquals(
    replaceCalls[0].args.p_session_ids,
    allSessions.slice(0, 243).map((session) => session.id),
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

/** Real admin client for every query; only the broadcast is stubbed. */
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

      const deleteBody = { ...validPushBody(), deletedCycleIds: [ids.cycleId] };
      const deleted = await handler(requestFromBody(deleteBody));
      assertEquals(deleted.status, 200, JSON.stringify(await json(deleted)));
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
