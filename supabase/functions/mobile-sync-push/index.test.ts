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

function permissiveQuery(
  table: string,
  onWrite: (method: string, payload: unknown) => void,
  terminalResult: { data: unknown; error: unknown; count?: number } = {
    data: [],
    error: null,
    count: 0,
  },
): Record<string, unknown> {
  const query: Record<string, unknown> = {};
  let ownershipProbe = false;
  const chainMethods = [
    "select",
    "eq",
    "neq",
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
      if (["insert", "upsert", "update", "delete"].includes(method)) {
        onWrite(method, args[0]);
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
      ownershipProbe ? { data: [], error: null, count: 0 } : terminalResult,
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
  adminWritePayloads: Array<{ table: string; method: string; payload: unknown }>;
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
    /** Result of the get_personal_record_identity_candidates probe RPC. */
    personalRecordsResult?: { data: unknown; error: unknown };
  } = {},
): PushHarness {
  const authClientAuthorizations: string[] = [];
  const getUserJwts: string[] = [];
  const adminConstructionCount = { value: 0 };
  const adminRpcCalls: Array<{ name: string; args: Record<string, unknown> }> =
    [];
  const adminFromCalls: string[] = [];
  const adminWriteCalls: Array<{ table: string; method: string }> = [];
  const adminWritePayloads: Array<
    { table: string; method: string; payload: unknown }
  > = [];
  const loggerCalls: unknown[][] = [];
  const operationEvents: string[] = [];
  const channelCalls: Array<{ topic: string; config?: Record<string, unknown> }> =
    [];
  const broadcastPayloads: unknown[] = [];

  const admin = {
    from(table: string) {
      adminFromCalls.push(table);
      return permissiveQuery(table, (method, payload) => {
        adminWriteCalls.push({ table, method });
        adminWritePayloads.push({ table, method, payload });
        operationEvents.push(`write:${table}:${method}`);
      });
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
      if (
        name === "get_personal_record_identity_candidates" &&
        options.personalRecordsResult
      ) {
        return options.personalRecordsResult;
      }
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
    adminWritePayloads,
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

// PR 57: in-memory stand-in for personal_records behind the two service-role
// RPCs. The identity mirrors uq_personal_records_set_derived_identity
// (20260920005700_personal_records_source_identity.sql).
type StoredPersonalRecord = Record<string, unknown> & { id: string };

function setDerivedSqlIdentity(row: Record<string, unknown>): string {
  return JSON.stringify([
    row.local_profile_id ?? "default",
    row.exercise_id ? `id:${row.exercise_id}` : `name:${row.exercise_name}`,
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
      const wanted = new Set(
        (args.p_achieved_at as string[]).map((value) => Date.parse(value)),
      );
      const after = args.p_after_id as string | null;
      const page = [...rows.values()]
        .filter((row) => wanted.has(Date.parse(String(row.achieved_at))))
        .filter((row) => after === null || row.id > after)
        .sort((a, b) => a.id.localeCompare(b.id))
        .slice(0, args.p_limit as number);
      return { data: page, error: null };
    }
    if (name === "upsert_set_derived_personal_records") {
      let affected = 0;
      for (const incoming of args.p_rows as Record<string, unknown>[]) {
        const identity = setDerivedSqlIdentity(incoming);
        const existing = [...rows.values()].find((row) =>
          row.source === "set_derived" && row.deleted_at == null &&
          setDerivedSqlIdentity(row) === identity
        );
        if (existing) {
          Object.assign(existing, { value: incoming.value });
        } else {
          const id = `00000000-0000-4000-8000-${(nextId++).toString(16).padStart(12, "0")}`;
          rows.set(id, {
            ...incoming,
            id,
            user_id: args.p_user_id,
            source: "set_derived",
            deleted_at: null,
          });
        }
        affected += 1;
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
  assertEquals(probeCalls[1].p_after_id, fullPage[499].id);
  assertEquals(responseBody.personalRecordsInserted, 1);
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

Deno.test({
  name:
    "integration: set-derived PR re-pushes and a same-identity RPC write under a new id converge to one row; a dedicated twin stays distinct",
  ignore: localIntegrationEnvironment === null,
  fn: async () => {
    const fixture = await createLocalIntegrationFixture();
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

      for (const expectedInserted of [1, 0]) {
        const response = await harness.handler(requestFromBody(pushBody()));
        const body = await json(response);
        assertEquals(response.status, 200, JSON.stringify(body));
        assertEquals(body.personalRecordsInserted, expectedInserted);
      }

      const afterPushes = await fixture.admin.from("personal_records")
        .select("id,source,session_id,exercise_name,exercise_id,achieved_at,record_type,workout_phase,local_profile_id,value")
        .eq("user_id", fixture.ownerId);
      if (afterPushes.error) throw new Error("post-push verification failed");
      assertEquals(afterPushes.data.length, 1);
      const stored = afterPushes.data[0];
      assertEquals(stored.source, "set_derived");
      assertEquals(stored.session_id, sessionId);

      // The actual RPC path twice more under explicit, different ids (the
      // concurrent-push case the TS probe cannot see): still one row, no
      // error, and the stored id is kept.
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
        [["dedicated", 100], ["set_derived", 95]],
      );

      // Both RPCs are service_role-only.
      const anon = createClient(
        localIntegrationEnvironment!.url,
        localIntegrationEnvironment!.anonKey,
        { auth: { persistSession: false, autoRefreshToken: false } },
      );
      for (const [name, args] of [
        ["upsert_set_derived_personal_records", {
          p_user_id: fixture.ownerId,
          p_rows: [],
        }],
        ["get_personal_record_identity_candidates", {
          p_user_id: fixture.ownerId,
          p_achieved_at: [],
        }],
      ] as const) {
        const denied = await anon.rpc(name, args);
        assert(denied.error, `${name} must not be executable by anon`);
      }
    } finally {
      await fixture.admin.from("personal_records")
        .delete()
        .in("user_id", [fixture.ownerId, fixture.otherUserId]);
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
