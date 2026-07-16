import { assert, assertEquals } from "jsr:@std/assert@1";
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { createMobileSyncPullHandler } from "./index.ts";

type AuthBehavior = (jwt: string) => Promise<unknown>;

const VALID_JWT = "test-jwt";
const VALID_USER_ID = "00000000-0000-4000-8000-000000000001";
const VALID_PROFILE_ID = "00000000-0000-4000-8000-000000000002";
const VALID_AUTH_RESULT = {
  data: { user: { id: VALID_USER_ID } },
  error: null,
};

function validPullBody(): Record<string, unknown> {
  return {
    deviceId: "test-device",
    lastSync: 0,
    profileId: VALID_PROFILE_ID,
    pageSize: 75,
    knownEntityIds: {
      sessionIds: [],
      routineIds: [],
      cycleIds: [],
      badgeIds: [],
      personalRecordIds: [],
    },
  };
}

function requestFromBody(
  body: unknown,
  authorization: string | null = `Bearer ${VALID_JWT}`,
): Request {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (authorization !== null) headers.set("Authorization", authorization);
  return new Request("http://localhost/functions/v1/mobile-sync-pull", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

interface PullHarness {
  handler: (request: Request) => Promise<Response>;
  authClientAuthorizations: string[];
  getUserJwts: string[];
  adminConstructionCount: { value: number };
  adminCalls: AdminCall[];
  loggerCalls: unknown[][];
}

interface AdminCall {
  kind: "rpc" | "from";
  name: string;
  args?: Record<string, unknown>;
  operations?: Array<{ name: string; args: unknown[] }>;
}

interface AdminOptions {
  preferenceResult?: { data: unknown; error: unknown };
  preferenceThrow?: unknown;
}

function createAdminDouble(
  calls: AdminCall[],
  options: AdminOptions,
): Record<string, unknown> {
  const rpc = (name: string, args: Record<string, unknown>) => {
    calls.push({ kind: "rpc", name, args });
    if (name === "check_rate_limit") {
      return Promise.resolve({
        data: {
          allowed: true,
          remaining: 19,
          retry_after_seconds: null,
        },
        error: null,
      });
    }
    if (name === "get_personal_records_excluding_ids") {
      const builder: Record<string, unknown> = {};
      for (const method of ["order", "limit", "or"]) {
        builder[method] = () => builder;
      }
      builder.then = (
        onFulfilled?: (value: unknown) => unknown,
        onRejected?: (reason: unknown) => unknown,
      ) =>
        Promise.resolve({ data: [], error: null }).then(
          onFulfilled,
          onRejected,
        );
      return builder;
    }
    return Promise.resolve({ data: [], error: null });
  };

  const from = (name: string) => {
    const operations: Array<{ name: string; args: unknown[] }> = [];
    calls.push({ kind: "from", name, operations });
    const result = async () => {
      if (name === "subscriptions") {
        return {
          data: {
            tier: "EMBER",
            status: "active",
            current_period_end: "2099-01-01T00:00:00.000Z",
          },
          error: null,
        };
      }
      if (name === "local_profile_preferences") {
        if (options.preferenceThrow !== undefined) {
          throw options.preferenceThrow;
        }
        return options.preferenceResult ?? { data: null, error: null };
      }
      return { data: [], error: null };
    };
    const builder: Record<string, unknown> = {};
    for (
      const method of [
        "select",
        "eq",
        "or",
        "gt",
        "gte",
        "lt",
        "lte",
        "order",
        "limit",
        "in",
        "is",
      ]
    ) {
      builder[method] = (...args: unknown[]) => {
        operations.push({ name: method, args });
        return builder;
      };
    }
    for (const terminal of ["maybeSingle", "single"]) {
      builder[terminal] = (...args: unknown[]) => {
        operations.push({ name: terminal, args });
        return result();
      };
    }
    builder.then = (
      onFulfilled?: (value: unknown) => unknown,
      onRejected?: (reason: unknown) => unknown,
    ) => result().then(onFulfilled, onRejected);
    return builder;
  };

  return { rpc, from };
}

function makeHarness(
  authBehavior: AuthBehavior = async () => VALID_AUTH_RESULT,
  options: AdminOptions = {},
): PullHarness {
  const authClientAuthorizations: string[] = [];
  const getUserJwts: string[] = [];
  const adminConstructionCount = { value: 0 };
  const adminCalls: AdminCall[] = [];
  const loggerCalls: unknown[][] = [];

  const handler = createMobileSyncPullHandler({
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
      return createAdminDouble(adminCalls, options);
    },
    logOperationalFailure: ((...args: unknown[]) => loggerCalls.push(args)),
    now: () => 1_784_167_200_000,
  } as never);

  return {
    handler,
    authClientAuthorizations,
    getUserJwts,
    adminConstructionCount,
    adminCalls,
    loggerCalls,
  };
}

async function json(response: Response): Promise<Record<string, unknown>> {
  return await response.json() as Record<string, unknown>;
}

const RACK_PAYLOAD = {
  version: 1,
  items: [{
    id: "rack-1",
    name: "Weighted vest 🙂",
    category: "WEIGHTED_VEST",
    weightKg: 12.5,
    behavior: "ADDED_RESISTANCE",
    enabled: true,
    sortOrder: 0,
    createdAt: -1,
    updatedAt: 1,
  }],
};

const WORKOUT_PAYLOAD = {
  version: 1,
  stopAtTop: true,
  beepsEnabled: true,
  stallDetectionEnabled: true,
  audioRepCountEnabled: true,
  repCountTiming: "TOP",
  summaryCountdownSeconds: 5,
  autoStartCountdownSeconds: 3,
  gamificationEnabled: true,
  autoStartRoutine: false,
  countdownBeepsEnabled: true,
  repSoundEnabled: true,
  motionStartEnabled: true,
  weightSuggestionsEnabled: true,
  defaultRoutineExerciseUsePercentOfPR: false,
  defaultRoutineExerciseWeightPercentOfPR: 80,
  voiceStopEnabled: true,
  justLiftDefaults: {
    workoutModeId: 0,
    weightPerCableKg: 20,
    weightChangePerRep: 1,
    eccentricLoadPercentage: 100,
    echoLevelValue: 1,
    stallDetectionEnabled: true,
    repCountTimingName: "TOP",
    restSeconds: 30,
  },
  singleExerciseDefaults: {},
};

const LED_PREFERENCES = {
  version: 1,
  discoModeUnlocked: true,
};

const VBT_PREFERENCES = {
  version: 1,
  velocityLossThresholdPercent: 20,
  autoEndOnVelocityLoss: true,
  defaultScalingBasis: "ESTIMATED_1RM",
  verbalEncouragementEnabled: true,
  vulgarModeEnabled: false,
  vulgarTier: "MILD",
  dominatrixModeUnlocked: false,
  dominatrixModeActive: false,
};

function validPreferenceRow(): Record<string, unknown> {
  return {
    local_profile_id: VALID_PROFILE_ID,
    body_weight_kg: 82.5,
    weight_unit: "KG",
    weight_increment: 1.25,
    core_revision: "1",
    core_updated_at: "2026-07-15T12:34:56+02:30",
    equipment_rack: structuredClone(RACK_PAYLOAD),
    rack_revision: 2,
    rack_updated_at: "2026-07-15T10:04:57.123456Z",
    workout_preferences: structuredClone(WORKOUT_PAYLOAD),
    workout_revision: 3,
    workout_updated_at: "2026-07-15T05:04:58-05:00",
    led_color_scheme_id: 4,
    led_preferences: structuredClone(LED_PREFERENCES),
    led_revision: 4,
    led_updated_at: "2026-07-15T10:04:59Z",
    vbt_enabled: true,
    vbt_preferences: structuredClone(VBT_PREFERENCES),
    vbt_revision: 5,
    vbt_updated_at: "2026-07-15T10:05:00.9Z",
  };
}

function validLaterCursor(): string {
  return btoa(JSON.stringify({
    type: "sessions",
    updatedAt: 1_784_167_200_000,
    id: "00000000-0000-4000-8000-000000000010",
  }));
}

Deno.test("shared profile preference contract module is required by pull too", async () => {
  const moduleName = "../_shared/" + "profilePreferenceContract.ts";
  const contract = await import(new URL(moduleName, import.meta.url).href);
  assert(Object.keys(contract).length > 0);
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
      requestFromBody(validPullBody(), authorization),
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
    const response = await harness.handler(requestFromBody(validPullBody()));

    assertEquals(response.status, 401);
    assertEquals(harness.authClientAuthorizations, [`Bearer ${VALID_JWT}`]);
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
    result: 7,
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
    const response = await harness.handler(requestFromBody(validPullBody()));

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
    const response = await harness.handler(requestFromBody(validPullBody()));

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
  const validId = "00000000-0000-4000-8000-000000000010";
  const response = await harness.handler(requestFromBody({
    ...validPullBody(),
    knownEntityIds: {
      sessionIds: [validId, "malformed-final-id"],
      routineIds: [],
      cycleIds: [],
      badgeIds: [],
      personalRecordIds: [],
    },
  }));

  assertEquals(response.status, 400);
  assertEquals(harness.getUserJwts, [VALID_JWT]);
  assertEquals(harness.adminConstructionCount.value, 0);
});

for (
  const [label, body] of [
    ["missing deviceId", { ...validPullBody(), deviceId: undefined }],
    ["unknown top-level key", { ...validPullBody(), unexpected: true }],
    ["preference mutation key on pull", {
      ...validPullBody(),
      profilePreferenceSections: [{ localProfileId: VALID_PROFILE_ID }],
    }],
    ["non-object body", []],
  ] as const
) {
  Deno.test(`strict pull body: ${label} is rejected before admin construction`, async () => {
    const harness = makeHarness();
    const response = await harness.handler(requestFromBody(body));

    assertEquals(response.status, 400);
    assertEquals(harness.adminConstructionCount.value, 0);
  });
}

for (
  const [label, body] of [
    ["blank deviceId", { ...validPullBody(), deviceId: "   " }],
    ["non-string deviceId", { ...validPullBody(), deviceId: 7 }],
    ["non-string profileId", { ...validPullBody(), profileId: 7 }],
    ["invalid profileId", { ...validPullBody(), profileId: "bad,id" }],
    ["unknown knownEntityIds key", {
      ...validPullBody(),
      knownEntityIds: {
        ...(validPullBody().knownEntityIds as Record<string, unknown>),
        unknownIds: [],
      },
    }],
    ["non-object knownEntityIds", {
      ...validPullBody(),
      knownEntityIds: [],
    }],
    ["non-array sessionIds", {
      ...validPullBody(),
      knownEntityIds: { sessionIds: "not-an-array" },
    }],
    ["non-array badgeIds", {
      ...validPullBody(),
      knownEntityIds: { badgeIds: {} },
    }],
    ["non-number lastSync", { ...validPullBody(), lastSync: "0" }],
    ["non-finite lastSync", { ...validPullBody(), lastSync: null }],
    ["out-of-range lastSync", {
      ...validPullBody(),
      lastSync: 8_640_000_000_000_001,
    }],
    ["non-number pageSize", { ...validPullBody(), pageSize: "75" }],
    ["zero pageSize", { ...validPullBody(), pageSize: 0 }],
    ["non-string cursor", { ...validPullBody(), cursor: 7 }],
    ["blank cursor", { ...validPullBody(), cursor: "" }],
    ["malformed cursor", { ...validPullBody(), cursor: "not-base64" }],
    ["cursor with invalid timestamp", {
      ...validPullBody(),
      cursor: btoa(JSON.stringify({
        type: "sessions",
        updatedAt: Number.MAX_SAFE_INTEGER,
        id: "00000000-0000-4000-8000-000000000010",
      })),
    }],
  ] as const
) {
  Deno.test(`strict pull parser: ${label} is rejected before privilege`, async () => {
    const harness = makeHarness();
    const response = await harness.handler(requestFromBody(body));

    assertEquals(response.status, 400);
    assertEquals(harness.getUserJwts, [VALID_JWT]);
    assertEquals(harness.adminConstructionCount.value, 0);
    assertEquals(harness.adminCalls, []);
  });
}

Deno.test("strict pull parser rejects malformed JSON before privilege", async () => {
  const harness = makeHarness();
  const response = await harness.handler(
    new Request(
      "http://localhost/functions/v1/mobile-sync-pull",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${VALID_JWT}`,
          "Content-Type": "application/json",
        },
        body: '{"deviceId":"test",',
      },
    ),
  );

  assertEquals(response.status, 400);
  assertEquals(harness.adminConstructionCount.value, 0);
});

Deno.test("strict pull parser rejects every oversize parity list before privilege", async () => {
  const validId = "00000000-0000-4000-8000-000000000010";
  for (
    const field of [
      "sessionIds",
      "routineIds",
      "cycleIds",
      "badgeIds",
      "personalRecordIds",
    ]
  ) {
    const harness = makeHarness();
    const response = await harness.handler(requestFromBody({
      ...validPullBody(),
      knownEntityIds: { [field]: Array(10_001).fill(validId) },
    }));

    assertEquals(response.status, 413, field);
    assertEquals(harness.adminConstructionCount.value, 0, field);
    assertEquals(harness.adminCalls, [], field);
  }
});

Deno.test("first-page pull queries exact owner and profile and maps all five canonicals", async () => {
  const harness = makeHarness(undefined, {
    preferenceResult: { data: validPreferenceRow(), error: null },
  });
  const response = await harness.handler(requestFromBody(validPullBody()));
  const body = await json(response);

  assertEquals(response.status, 200);
  assertEquals(harness.adminConstructionCount.value, 1);
  assertEquals(body.syncTime, 1_784_167_200_000);
  assertEquals(body.profilePreferenceSections, [
    {
      localProfileId: VALID_PROFILE_ID,
      section: "CORE",
      documentVersion: 1,
      serverRevision: 1,
      serverUpdatedAt: "2026-07-15T10:04:56.000Z",
      payload: {
        bodyWeightKg: 82.5,
        weightUnit: "KG",
        weightIncrement: 1.25,
      },
    },
    {
      localProfileId: VALID_PROFILE_ID,
      section: "RACK",
      documentVersion: 1,
      serverRevision: 2,
      serverUpdatedAt: "2026-07-15T10:04:57.123Z",
      payload: RACK_PAYLOAD,
    },
    {
      localProfileId: VALID_PROFILE_ID,
      section: "WORKOUT",
      documentVersion: 1,
      serverRevision: 3,
      serverUpdatedAt: "2026-07-15T10:04:58.000Z",
      payload: WORKOUT_PAYLOAD,
    },
    {
      localProfileId: VALID_PROFILE_ID,
      section: "LED",
      documentVersion: 1,
      serverRevision: 4,
      serverUpdatedAt: "2026-07-15T10:04:59.000Z",
      payload: {
        ledColorSchemeId: 4,
        preferences: LED_PREFERENCES,
      },
    },
    {
      localProfileId: VALID_PROFILE_ID,
      section: "VBT",
      documentVersion: 1,
      serverRevision: 5,
      serverUpdatedAt: "2026-07-15T10:05:00.900Z",
      payload: {
        vbtEnabled: true,
        preferences: VBT_PREFERENCES,
      },
    },
  ]);
  const query = harness.adminCalls.find((call) =>
    call.kind === "from" && call.name === "local_profile_preferences"
  );
  assert(query);
  assertEquals(query.operations, [
    {
      name: "select",
      args: [
        "local_profile_id,body_weight_kg,weight_unit,weight_increment," +
        "core_revision,core_updated_at,equipment_rack,rack_revision,rack_updated_at," +
        "workout_preferences,workout_revision,workout_updated_at," +
        "led_color_scheme_id,led_preferences,led_revision,led_updated_at," +
        "vbt_enabled,vbt_preferences,vbt_revision,vbt_updated_at",
      ],
    },
    { name: "eq", args: ["user_id", VALID_USER_ID] },
    { name: "eq", args: ["local_profile_id", VALID_PROFILE_ID] },
    { name: "maybeSingle", args: [] },
  ]);
});

Deno.test("absent preference row omits the field and never creates a row", async () => {
  const harness = makeHarness();
  const response = await harness.handler(requestFromBody(validPullBody()));
  const body = await json(response);

  assertEquals(response.status, 200);
  assert(!Object.hasOwn(body, "profilePreferenceSections"));
  assertEquals(
    harness.adminCalls.filter((call) =>
      call.name === "local_profile_preferences"
    )
      .length,
    1,
  );
  assertEquals(
    harness.adminCalls.filter((call) =>
      call.operations?.some((operation) =>
        ["insert", "upsert", "update"].includes(operation.name)
      )
    ),
    [],
  );
});

Deno.test("later page omits preferences and preserves pagination and injected syncTime", async () => {
  const harness = makeHarness(undefined, {
    preferenceResult: { data: validPreferenceRow(), error: null },
  });
  const response = await harness.handler(requestFromBody({
    ...validPullBody(),
    cursor: validLaterCursor(),
  }));
  const body = await json(response);

  assertEquals(response.status, 200);
  assertEquals(body.syncTime, 1_784_167_200_000);
  assertEquals(body.hasMore, false);
  assert(!Object.hasOwn(body, "profilePreferenceSections"));
  assertEquals(
    harness.adminCalls.filter((call) =>
      call.name === "local_profile_preferences"
    ),
    [],
  );
});

Deno.test("ordinary pull response fields remain unchanged when preferences are added", async () => {
  const harness = makeHarness(undefined, {
    preferenceResult: { data: validPreferenceRow(), error: null },
  });
  const response = await harness.handler(requestFromBody(validPullBody()));
  const body = await json(response);

  assertEquals(Object.keys(body).sort(), [
    "badges",
    "customExercises",
    "cycles",
    "externalActivities",
    "gamificationStats",
    "hasMore",
    "localProfiles",
    "personalRecords",
    "profilePreferenceSections",
    "routines",
    "rpgAttributes",
    "sessions",
    "syncTime",
  ]);
  assertEquals(body.sessions, []);
  assertEquals(body.routines, []);
  assertEquals(body.cycles, []);
  assertEquals(body.personalRecords, []);
  assertEquals(body.rpgAttributes, {
    level: 1,
    experiencePoints: 0,
    strength: 0,
    stamina: 0,
    consistency: 0,
    power: 0,
    mastery: 0,
  });
  assertEquals(body.badges, []);
  assertEquals(body.gamificationStats, {});
  assertEquals(body.localProfiles, []);
  assertEquals(body.externalActivities, []);
  assertEquals(body.customExercises, []);
});

for (
  const [label, mutate] of [
    ["malformed timestamp", (row: Record<string, unknown>) => {
      row.core_updated_at = "February 30, 2026";
    }],
    ["negative revision", (row: Record<string, unknown>) => {
      row.rack_revision = -1;
    }],
    ["malformed nested string Unicode", (row: Record<string, unknown>) => {
      (row.equipment_rack as Record<string, unknown>).items = [{
        ...(RACK_PAYLOAD.items[0] as Record<string, unknown>),
        name: "bad\u0000text",
      }];
    }],
    ["malformed object-key Unicode", (row: Record<string, unknown>) => {
      row.vbt_preferences = {
        ...VBT_PREFERENCES,
        ["bad\u0000key"]: true,
      };
    }],
  ] as const
) {
  Deno.test(`preference pull infrastructure: ${label} is one name-only generic 503`, async () => {
    const row = validPreferenceRow();
    mutate(row);
    const harness = makeHarness(undefined, {
      preferenceResult: { data: row, error: null },
    });
    const response = await harness.handler(requestFromBody(validPullBody()));

    assertEquals(response.status, 503);
    assertEquals(await json(response), {
      error: "Sync temporarily unavailable",
    });
    assertEquals(harness.loggerCalls, [[{
      name: "PreferenceInfrastructureError",
    }]]);
  });
}

for (
  const [label, options, expectedName] of [
    [
      "returned query error",
      {
        preferenceResult: {
          data: null,
          error: { name: "PostgrestError", message: "private profile id" },
        },
      },
      "PreferenceInfrastructureError",
    ],
    [
      "thrown safe query error",
      {
        preferenceThrow: Object.assign(new Error("private"), {
          name: "NetworkError",
        }),
      },
      "NetworkError",
    ],
    [
      "thrown unsafe query error",
      {
        preferenceThrow: Object.assign(new Error("private"), {
          name: "bad unsafe name!",
        }),
      },
      "PreferenceInfrastructureFailure",
    ],
  ] as const
) {
  Deno.test(`preference pull infrastructure: ${label} is sanitized`, async () => {
    const harness = makeHarness(undefined, options);
    const response = await harness.handler(requestFromBody(validPullBody()));

    assertEquals(response.status, 503);
    assertEquals(await json(response), {
      error: "Sync temporarily unavailable",
    });
    assertEquals(harness.loggerCalls, [[{ name: expectedName }]]);
  });
}

interface LocalIntegrationEnvironment {
  url: string;
  anonKey: string;
  serviceRoleKey: string;
}

const localIntegrationEnvironment: LocalIntegrationEnvironment | null = (() => {
  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  return url && anonKey && serviceRoleKey
    ? { url, anonKey, serviceRoleKey }
    : null;
})();

interface LocalPullFixture {
  admin: SupabaseClient;
  ownerId: string;
  otherId: string;
  ownerProfileId: string;
  otherProfileId: string;
}

async function deleteLocalPullFixtureRows(
  admin: SupabaseClient,
  userIds: string[],
): Promise<void> {
  if (userIds.length === 0) return;
  for (
    const table of [
      "local_profile_preferences",
      "local_profiles",
      "subscriptions",
      "rate_limit_tracking",
    ]
  ) {
    const deleted = await admin.from(table).delete().in("user_id", userIds);
    if (deleted.error) throw new Error(`${table} fixture cleanup failed`);
  }
  for (const userId of userIds) {
    const deleted = await admin.auth.admin.deleteUser(userId);
    if (deleted.error) throw new Error("Auth fixture cleanup failed");
  }
}

async function createLocalPullFixture(): Promise<LocalPullFixture> {
  assert(localIntegrationEnvironment);
  const admin = createClient(
    localIntegrationEnvironment.url,
    localIntegrationEnvironment.serviceRoleKey,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const userIds: string[] = [];
  try {
    const suffix = crypto.randomUUID();
    const owner = await admin.auth.admin.createUser({
      email: `task8-owner-${suffix}@example.invalid`,
      email_confirm: true,
    });
    if (owner.error || !owner.data.user) {
      throw new Error("owner Auth fixture creation failed");
    }
    userIds.push(owner.data.user.id);
    const other = await admin.auth.admin.createUser({
      email: `task8-other-${suffix}@example.invalid`,
      email_confirm: true,
    });
    if (other.error || !other.data.user) {
      throw new Error("other Auth fixture creation failed");
    }
    userIds.push(other.data.user.id);
    const ownerProfileId = crypto.randomUUID();
    const otherProfileId = crypto.randomUUID();
    const profiles = await admin.from("local_profiles").insert([{
      user_id: owner.data.user.id,
      id: ownerProfileId,
      name: "Task 8 owner profile",
      color_index: 0,
      device_id: `task8-owner-${suffix}`,
    }, {
      user_id: other.data.user.id,
      id: otherProfileId,
      name: "Task 8 other profile",
      color_index: 1,
      device_id: `task8-other-${suffix}`,
    }]);
    if (profiles.error) throw new Error("profile fixture creation failed");
    const subscriptions = await admin.from("subscriptions").insert([{
      user_id: owner.data.user.id,
      tier: "EMBER",
      status: "active",
      current_period_end: "2099-01-01T00:00:00.000Z",
    }, {
      user_id: other.data.user.id,
      tier: "EMBER",
      status: "active",
      current_period_end: "2099-01-01T00:00:00.000Z",
    }]);
    if (subscriptions.error) {
      throw new Error("subscription fixture creation failed");
    }
    return {
      admin,
      ownerId: owner.data.user.id,
      otherId: other.data.user.id,
      ownerProfileId,
      otherProfileId,
    };
  } catch (error) {
    await deleteLocalPullFixtureRows(admin, userIds);
    throw error;
  }
}

async function mutateRealPreference(
  fixture: LocalPullFixture,
  section: string,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const result = await fixture.admin.rpc(
    "mutate_local_profile_preference_section",
    {
      p_user_id: fixture.ownerId,
      p_local_profile_id: fixture.ownerProfileId,
      p_section: section,
      p_document_version: 1,
      p_base_revision: 0,
      p_payload: payload,
    },
  );
  if (result.error) throw new Error("real preference mutation RPC failed");
  assert(Array.isArray(result.data));
  assertEquals(result.data.length, 1);
  const row = result.data[0] as Record<string, unknown>;
  assertEquals(row.accepted, true);
  return row.canonical_section as Record<string, unknown>;
}

function realPullHandler(
  fixture: LocalPullFixture,
  verifiedUserId: string,
  loggerCalls: unknown[][],
): (request: Request) => Promise<Response> {
  return createMobileSyncPullHandler({
    createAuthClient() {
      return {
        auth: {
          async getUser() {
            return {
              data: { user: { id: verifiedUserId } },
              error: null,
            };
          },
        },
      };
    },
    createAdminClient() {
      return fixture.admin;
    },
    logOperationalFailure: ((...args: unknown[]) => loggerCalls.push(args)),
    now: () => 1_784_167_200_000,
  });
}

async function assertLocalPullFixtureClean(
  fixture: LocalPullFixture,
): Promise<void> {
  const userIds = [fixture.ownerId, fixture.otherId];
  for (
    const table of [
      "local_profile_preferences",
      "local_profiles",
      "subscriptions",
      "rate_limit_tracking",
    ]
  ) {
    const audit = await fixture.admin.from(table)
      .select("user_id", { count: "exact", head: true })
      .in("user_id", userIds);
    if (audit.error) throw new Error(`${table} cleanup audit failed`);
    assertEquals(audit.count, 0, table);
  }
  for (const userId of userIds) {
    const audit = await fixture.admin.auth.admin.getUserById(userId);
    assert(audit.error);
    assertEquals(audit.data.user, null);
  }
}

Deno.test({
  name:
    "integration: real mutation canonicals equal isolated first-page pull and absence never creates",
  ignore: localIntegrationEnvironment === null,
  fn: async () => {
    const fixture = await createLocalPullFixture();
    try {
      const canonicalSections = await Promise.all([
        mutateRealPreference(fixture, "CORE", {
          bodyWeightKg: 82.5,
          weightUnit: "KG",
          weightIncrement: 1.25,
        }),
        mutateRealPreference(fixture, "RACK", structuredClone(RACK_PAYLOAD)),
        mutateRealPreference(
          fixture,
          "WORKOUT",
          structuredClone(WORKOUT_PAYLOAD),
        ),
        mutateRealPreference(fixture, "LED", {
          ledColorSchemeId: 4,
          preferences: structuredClone(LED_PREFERENCES),
        }),
        mutateRealPreference(fixture, "VBT", {
          vbtEnabled: true,
          preferences: structuredClone(VBT_PREFERENCES),
        }),
      ]);
      const ownerLogs: unknown[][] = [];
      const ownerHandler = realPullHandler(fixture, fixture.ownerId, ownerLogs);
      const ownerResponse = await ownerHandler(requestFromBody({
        ...validPullBody(),
        profileId: fixture.ownerProfileId,
      }));
      const ownerBody = await json(ownerResponse);

      assertEquals(ownerResponse.status, 200);
      assertEquals(ownerLogs, []);
      assertEquals(ownerBody.profilePreferenceSections, canonicalSections);

      const otherLogs: unknown[][] = [];
      const otherHandler = realPullHandler(fixture, fixture.otherId, otherLogs);
      const crossOwnerResponse = await otherHandler(requestFromBody({
        ...validPullBody(),
        profileId: fixture.ownerProfileId,
      }));
      const crossOwnerBody = await json(crossOwnerResponse);
      assertEquals(crossOwnerResponse.status, 200);
      assert(!Object.hasOwn(crossOwnerBody, "profilePreferenceSections"));

      const beforeAbsent = await fixture.admin.from("local_profile_preferences")
        .select("user_id", { count: "exact", head: true })
        .eq("user_id", fixture.otherId)
        .eq("local_profile_id", fixture.otherProfileId);
      if (beforeAbsent.error) throw new Error("absence pre-audit failed");
      assertEquals(beforeAbsent.count, 0);
      const absentResponse = await otherHandler(requestFromBody({
        ...validPullBody(),
        profileId: fixture.otherProfileId,
      }));
      const absentBody = await json(absentResponse);
      assertEquals(absentResponse.status, 200);
      assert(!Object.hasOwn(absentBody, "profilePreferenceSections"));
      const afterAbsent = await fixture.admin.from("local_profile_preferences")
        .select("user_id", { count: "exact", head: true })
        .eq("user_id", fixture.otherId)
        .eq("local_profile_id", fixture.otherProfileId);
      if (afterAbsent.error) throw new Error("absence post-audit failed");
      assertEquals(afterAbsent.count, 0);

      const laterResponse = await ownerHandler(requestFromBody({
        ...validPullBody(),
        profileId: fixture.ownerProfileId,
        cursor: validLaterCursor(),
      }));
      const laterBody = await json(laterResponse);
      assertEquals(laterResponse.status, 200);
      assertEquals(laterBody.syncTime, 1_784_167_200_000);
      assertEquals(laterBody.hasMore, false);
      assert(!Object.hasOwn(laterBody, "profilePreferenceSections"));
      assertEquals(otherLogs, []);
    } finally {
      await deleteLocalPullFixtureRows(
        fixture.admin,
        [fixture.ownerId, fixture.otherId],
      );
      await assertLocalPullFixtureClean(fixture);
    }
  },
});
