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
  onWrite: (method: string) => void,
  terminalResult: { data: unknown; error: unknown; count?: number } = {
    data: [],
    error: null,
    count: 0,
  },
  onProbe: () => void = () => {},
  probeResult: unknown[] = [],
  onChain: (method: string, args: unknown[]) => void = () => {},
  resolveTerminal?: () => { data: unknown; error: unknown; count?: number },
  subscriptionResult: { data: unknown; error: unknown } =
    DEFAULT_SUBSCRIPTION_RESULT,
): Record<string, unknown> {
  const query: Record<string, unknown> = {};
  let ownershipProbe = false;
  const chainMethods = [
    "select",
    "eq",
    "neq",
    "gt",
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
      onChain(method, args);
      if (method === "neq") {
        ownershipProbe = true;
        onProbe();
      }
      if (["insert", "upsert", "update", "delete"].includes(method)) {
        onWrite(method);
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
      ownershipProbe
        ? { data: probeResult, error: null, count: probeResult.length }
        : resolveTerminal
        ? resolveTerminal()
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
  ownershipProbeTables: string[];
  catalogQueries: CatalogQuery[];
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
    foreignOwnedTables?: string[];
    now?: () => number;
    catalogBehavior?: (
      query: CatalogQuery,
    ) => { data: unknown; error: unknown } | undefined;
    subscriptionResult?: { data: unknown; error: unknown };
  } = {},
): PushHarness {
  const authClientAuthorizations: string[] = [];
  const getUserJwts: string[] = [];
  const adminConstructionCount = { value: 0 };
  const adminRpcCalls: Array<{ name: string; args: Record<string, unknown> }> =
    [];
  const adminFromCalls: string[] = [];
  const adminWriteCalls: Array<{ table: string; method: string }> = [];
  const ownershipProbeTables: string[] = [];
  const catalogQueries: CatalogQuery[] = [];
  const loggerCalls: unknown[][] = [];
  const operationEvents: string[] = [];
  const channelCalls: Array<{ topic: string; config?: Record<string, unknown> }> =
    [];
  const broadcastPayloads: unknown[] = [];

  const admin = {
    from(table: string) {
      adminFromCalls.push(table);
      const catalogQuery: CatalogQuery | null = table === "exercise_catalog"
        ? { calls: [] }
        : null;
      if (catalogQuery) catalogQueries.push(catalogQuery);
      return permissiveQuery(table, (method) => {
        adminWriteCalls.push({ table, method });
        operationEvents.push(`write:${table}:${method}`);
      },
        table === "personal_records" ? options.personalRecordsResult : undefined,
        () => ownershipProbeTables.push(table),
        (options.foreignOwnedTables ?? []).includes(table)
          ? [{ id: "foreign-row" }]
          : [],
        (method, args) => catalogQuery?.calls.push({ method, args }),
        catalogQuery && options.catalogBehavior
          ? () =>
            options.catalogBehavior!(catalogQuery) ??
              { data: [], error: null, count: 0 }
          : undefined);
      }, table === "personal_records" ? options.personalRecordsResult : undefined,
        options.subscriptionResult);
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
    ownershipProbeTables,
    catalogQueries,
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
  assertEquals(
    harness.adminFromCalls.filter((table) => table === "cycle_days").length,
    2,
    "cycle_days is only upserted by (cycle_id, day_number) and orphan-pruned, never id-probed",
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
            return { data: { user: { id: fixture.ownerId } }, error: null };
            return { data: { user: { id: fixture.userId } }, error: null };
          },
        },
      };
    },
    createAdminClient() {
      // Real PostgREST and RPCs; the realtime broadcast is stubbed so the
      // test leaves no open WebSocket behind.
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
      return admin;
    },
    logOperationalFailure: () => {},
    now: () => 1_784_167_200_000,
  } as never);
}

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
