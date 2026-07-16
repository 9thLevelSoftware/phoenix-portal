import { assert, assertEquals, assertThrows } from "jsr:@std/assert@1";
import {
  parsePreferenceEnvelope,
  parsePreferenceMutation,
  type PreferenceEnvelope,
  PreferenceValidationError,
  scanJsonArrayElementSpans,
  scanTopLevelJsonObject,
} from "../_shared/profilePreferenceContract.ts";
import { createMobileSyncPushHandler } from "./index.ts";

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

function permissiveQuery(
  table: string,
): Record<string, unknown> {
  const defaultResult = { data: [], error: null, count: 0 };
  const query: Record<string, unknown> = {};
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
    query[method] = (..._args: unknown[]) => query;
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
  ) => Promise.resolve(defaultResult).then(resolve, reject);
  return query;
}

interface PushHarness {
  handler: (request: Request) => Promise<Response>;
  authClientAuthorizations: string[];
  getUserJwts: string[];
  adminConstructionCount: { value: number };
  adminRpcCalls: Array<{ name: string; args: Record<string, unknown> }>;
  loggerCalls: unknown[][];
}

function makeHarness(
  authBehavior: AuthBehavior = async () => VALID_AUTH_RESULT,
  options: { channelError?: unknown } = {},
): PushHarness {
  const authClientAuthorizations: string[] = [];
  const getUserJwts: string[] = [];
  const adminConstructionCount = { value: 0 };
  const adminRpcCalls: Array<{ name: string; args: Record<string, unknown> }> =
    [];
  const loggerCalls: unknown[][] = [];

  const admin = {
    from(table: string) {
      return permissiveQuery(table);
    },
    async rpc(name: string, args: Record<string, unknown> = {}) {
      adminRpcCalls.push({ name, args });
      if (name === "check_rate_limit") {
        return {
          data: { allowed: true, remaining: 9, retry_after_seconds: null },
          error: null,
        };
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
    channel() {
      if (options.channelError !== undefined) throw options.channelError;
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
    loggerCalls,
  };
}

async function json(response: Response): Promise<Record<string, unknown>> {
  return await response.json() as Record<string, unknown>;
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
        harness.adminRpcCalls.some((call) =>
          call.name === "mutate_local_profile_preference_section"
        ),
        false,
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

Deno.test("ordinary-only request above the preference cap retains legacy capacity", async () => {
  const harness = makeHarness();
  const bytes = ordinaryBodyAt(600_000);
  const response = await harness.handler(rawRequest(bytes));
  assertEquals(response.status, 200);
  assertEquals(harness.adminConstructionCount.value, 1);
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
