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
import { createMobileSyncPullHandler } from "../mobile-sync-pull/index.ts";
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

type TableResultValue = { data: unknown; error: unknown; count?: number };
/** A fixed result, or one chosen from the query's `.eq()` filters. */
type TableResult =
  | TableResultValue
  | ((eqFilters: Record<string, unknown>) => TableResultValue);

function permissiveQuery(
  table: string,
  onWrite: (method: string, args: unknown[]) => void,
  terminalResult: TableResult = {
    data: [],
    error: null,
    count: 0,
  },
): Record<string, unknown> {
  const query: Record<string, unknown> = {};
  let ownershipProbe = false;
  const eqFilters: Record<string, unknown> = {};
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
  for (const method of chainMethods) {
    query[method] = (...args: unknown[]) => {
      if (method === "neq") ownershipProbe = true;
      if (method === "eq") eqFilters[String(args[0])] = args[1];
      if (["insert", "upsert", "update", "delete"].includes(method)) {
        onWrite(method, args);
      }
      return query;
    };
  }
  query.maybeSingle = () =>
    Promise.resolve(
      table === "subscriptions"
        ? {
          data: {
            tier: "EMBER",
            status: "active",
            current_period_end: "2099-01-01T00:00:00.000Z",
          },
          error: null,
        }
        : { data: null, error: null },
    );
  query.single = () => Promise.resolve({ data: null, error: null });
  query.then = (
    resolve: (value: unknown) => unknown,
    reject?: (reason: unknown) => unknown,
  ) =>
    Promise.resolve(
      ownershipProbe
        ? { data: [], error: null, count: 0 }
        : typeof terminalResult === "function"
        ? terminalResult(eqFilters)
        : terminalResult,
    ).then(resolve, reject);
  return query;
}

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
}

function makeHarness(
  authBehavior: AuthBehavior = async () => VALID_AUTH_RESULT,
  options: {
    channelError?: unknown;
    rpcBehavior?: RpcBehavior;
    personalRecordsResult?: { data: unknown; error: unknown };
    tableResults?: Record<string, TableResult>;
  } = {},
): PushHarness {
  const authClientAuthorizations: string[] = [];
  const getUserJwts: string[] = [];
  const adminConstructionCount = { value: 0 };
  const adminRpcCalls: Array<{ name: string; args: Record<string, unknown> }> =
    [];
  const adminFromCalls: string[] = [];
  const adminWriteCalls: Array<{ table: string; method: string }> = [];
  const adminWriteArgs: Array<
    { table: string; method: string; args: unknown[] }
  > = [];
  const loggerCalls: unknown[][] = [];
  const operationEvents: string[] = [];
  const channelCalls: Array<{ topic: string; config?: Record<string, unknown> }> =
    [];
  const broadcastPayloads: unknown[] = [];

  const admin = {
    from(table: string) {
      adminFromCalls.push(table);
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
  };
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
  // NULL updated_at column can never be handed one.
  assertEquals(typeof sent.updated_at, "string");
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

Deno.test(`cycle merge (LWW=${SYNC_LWW_ENABLED}): a merge RPC error is a retryable 500`, async () => {
  const harness = makeHarness(undefined, {
    rpcBehavior: cycleMergeRpcBehavior(() => [], {
      name: "PostgrestError",
      message: "merge failed",
    }),
  });
  const response = await harness.handler(
    requestFromBody(oldBuildRoutineAndCycleBody()),
  );

  assertEquals(response.status, 500);
  assertEquals(await json(response), { error: "Internal server error" });
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
    now: () => Date.now(),
  } as never);
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
