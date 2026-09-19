import { assert, assertEquals } from "jsr:@std/assert@1";
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { CHILD_PAGE_SIZE } from "../_shared/pagedByParent.ts";
import { createMobileSyncPullHandler, STALE_OVERLAP_MS } from "./index.ts";
import { localIntegrationEnvironment } from "../_shared/localIntegrationEnvironment.ts";

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
  rpcResults?: Record<string, { data: unknown; error: unknown }>;
  rpcImpl?: (
    name: string,
    args: Record<string, unknown>,
  ) => { data: unknown; error: unknown } | undefined;
  fromPages?: Record<string, Array<{ data: unknown; error: unknown }>>;
}

function createAdminDouble(
  calls: AdminCall[],
  options: AdminOptions,
): Record<string, unknown> {
  const fromPageIndex: Record<string, number> = {};
  const rpc = (name: string, args: Record<string, unknown>) => {
    calls.push({ kind: "rpc", name, args });
    const implResult = options.rpcImpl?.(name, args);
    if (implResult) {
      return Promise.resolve(implResult);
    }
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
      const result = options.rpcResults?.[name] ?? { data: [], error: null };
      const builder: Record<string, unknown> = {};
      for (const method of ["order", "limit", "or"]) {
        builder[method] = () => builder;
      }
      builder.then = (
        onFulfilled?: (value: unknown) => unknown,
        onRejected?: (reason: unknown) => unknown,
      ) =>
        Promise.resolve(result).then(
          onFulfilled,
          onRejected,
        );
      return builder;
    }
    if (name === "get_personal_record_tombstones") {
      return Promise.resolve(
        options.rpcResults?.[name] ?? { data: [], error: null },
      );
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
      const pages = options.fromPages?.[name];
      if (pages) {
        const index = fromPageIndex[name] ?? 0;
        fromPageIndex[name] = index + 1;
        return pages[index] ?? { data: [], error: null };
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
        "range",
        "in",
        "is",
        "not",
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

Deno.test("known personal record tombstones use the bounded RPC and remain tombstones", async () => {
  const personalRecordId = "00000000-0000-4000-8000-000000000010";
  const deletedAt = "2026-07-02T12:00:00.000Z";
  const harness = makeHarness(undefined, {
    rpcResults: {
      get_personal_records_excluding_ids: { data: [], error: null },
      get_personal_record_tombstones: {
        data: [{
          id: personalRecordId,
          user_id: VALID_USER_ID,
          local_profile_id: VALID_PROFILE_ID,
          exercise_id: null,
          exercise_name: "Bench Press",
          muscle_group: "Chest",
          record_type: "MAX_WEIGHT",
          value: 100,
          weight_kg: 100,
          reps: 1,
          workout_phase: "COMBINED",
          session_id: null,
          achieved_at: "2026-06-01T12:00:00.000Z",
          updated_at: deletedAt,
          deleted_at: deletedAt,
        }],
        error: null,
      },
    },
  });
  const response = await harness.handler(requestFromBody({
    ...validPullBody(),
    lastSync: Date.parse("2026-07-01T00:00:00.000Z"),
    knownEntityIds: {
      ...validPullBody().knownEntityIds as Record<string, unknown>,
      personalRecordIds: [personalRecordId],
    },
  }));
  const body = await json(response);

  assertEquals(response.status, 200, JSON.stringify(body));
  const tombstoneCall = harness.adminCalls.find((call) =>
    call.kind === "rpc" && call.name === "get_personal_record_tombstones"
  );
  assert(tombstoneCall);
  assertEquals(tombstoneCall.args?.p_known_ids, [personalRecordId]);
  // Tombstones-since query gets the same commit-time overlap (lastSync - 2 min).
  assertEquals(tombstoneCall.args?.p_last_sync_at, "2026-06-30T23:58:00.000Z");
  assertEquals(tombstoneCall.args?.p_profile_id, VALID_PROFILE_ID);
  assertEquals(tombstoneCall.args?.p_limit, 76);
  assertEquals(
    harness.adminCalls.find((call) =>
      call.kind === "from" && call.name === "personal_records" &&
      call.operations?.some((operation) =>
        operation.name === "in" && operation.args[0] === "id"
      )
    ),
    undefined,
  );
  const personalRecords = body.personalRecords as Record<string, unknown>[];
  assertEquals(personalRecords.length, 1);
  assertEquals(personalRecords[0].id, personalRecordId);
  assertEquals(personalRecords[0].deletedAt, deletedAt);
});

const PARITY_RPCS = [
  "get_sessions_excluding_ids",
  "get_routines_excluding_ids",
  "get_cycles_excluding_ids",
] as const;

Deno.test("parity RPCs get lastSync minus the commit-time overlap when lastSync > 0", async () => {
  const lastSyncISO = "2026-07-01T00:00:00.000Z";
  const knownSessionId = "00000000-0000-4000-8000-0000000000aa";
  const harness = makeHarness();
  const response = await harness.handler(requestFromBody({
    ...validPullBody(),
    lastSync: Date.parse(lastSyncISO),
    knownEntityIds: {
      ...validPullBody().knownEntityIds as Record<string, unknown>,
      sessionIds: [knownSessionId],
    },
  }));
  const body = await json(response);

  assertEquals(response.status, 200, JSON.stringify(body));
  assertEquals(STALE_OVERLAP_MS, 120_000);
  const expected = new Date(Date.parse(lastSyncISO) - STALE_OVERLAP_MS)
    .toISOString();
  for (const name of PARITY_RPCS) {
    const call = harness.adminCalls.find((c) =>
      c.kind === "rpc" && c.name === name
    );
    assert(call, name);
    assertEquals(call.args?.p_last_sync_at, expected, name);
    assertEquals(call.args?.p_profile_id, VALID_PROFILE_ID, name);
    assertEquals(call.args?.p_limit, 76, name);
  }
  const sessionCall = harness.adminCalls.find((call) =>
    call.kind === "rpc" && call.name === "get_sessions_excluding_ids"
  );
  assertEquals(sessionCall?.args?.p_known_ids, [knownSessionId]);
  // The legacy direct-table reads are gone.
  for (const table of ["workout_sessions", "routines", "training_cycles"]) {
    assertEquals(
      harness.adminCalls.some((c) => c.kind === "from" && c.name === table),
      false,
      table,
    );
  }
});

Deno.test("lastSync 0 keeps the epoch stale bound (no negative overlap)", async () => {
  const harness = makeHarness();
  const response = await harness.handler(requestFromBody(validPullBody()));
  assertEquals(response.status, 200);
  for (const name of PARITY_RPCS) {
    const call = harness.adminCalls.find((c) =>
      c.kind === "rpc" && c.name === name
    );
    assert(call, name);
    assertEquals(call.args?.p_last_sync_at, "1970-01-01T00:00:00.000Z", name);
  }
});

Deno.test("real lastSync with empty known ids still uses the parity RPCs", async () => {
  const harness = makeHarness();
  const response = await harness.handler(requestFromBody({
    ...validPullBody(),
    lastSync: Date.parse("2026-07-01T00:00:00.000Z"),
  }));
  assertEquals(response.status, 200);
  for (const name of PARITY_RPCS) {
    const call = harness.adminCalls.find((c) =>
      c.kind === "rpc" && c.name === name
    );
    assert(call, name);
    assertEquals(call.args?.p_known_ids, [], name);
  }
  for (const table of ["workout_sessions", "routines", "training_cycles"]) {
    assertEquals(
      harness.adminCalls.some((c) => c.kind === "from" && c.name === table),
      false,
      table,
    );
  }
});

const DB_ERROR = {
  code: "42P01",
  message: 'relation "secret_internal_table" does not exist',
  hint: "internal schema hint",
};

for (const name of PARITY_RPCS) {
  Deno.test(`${name} failure returns only the error code, never DB text`, async () => {
    const harness = makeHarness(async () => VALID_AUTH_RESULT, {
      rpcImpl: (rpcName) =>
        rpcName === name ? { data: null, error: DB_ERROR } : undefined,
    });
    const response = await harness.handler(requestFromBody(validPullBody()));
    assert(response.status === 500 || response.status === 503);
    const text = await response.text();
    const body = JSON.parse(text) as Record<string, unknown>;
    assertEquals(body.code, "42P01");
    assert(!Object.hasOwn(body, "details"), text);
    assert(!text.includes("secret_internal_table"), text);
    assert(!text.includes("internal schema hint"), text);
  });
}

// Issue #97 follow-up: 200 PRs sharing one microsecond timestamp must still
// produce distinct page cursors. JS Date truncates µs → ms, which makes
// `updated_at > cursor` match the entire cluster and replay page 1.
function timestampSortKey(value: string): string {
  const millis = Date.parse(value);
  const frac = (value.match(/\.(\d+)/)?.[1] ?? "").padEnd(6, "0").slice(0, 6);
  return `${Number.isFinite(millis) ? millis : 0}:${frac}`;
}

function applyPersonalRecordCursor(
  rows: Array<Record<string, unknown>>,
  args: Record<string, unknown>,
): Array<Record<string, unknown>> {
  const cursorAt = typeof args.p_cursor_updated_at === "string"
    ? args.p_cursor_updated_at
    : null;
  const cursorId = typeof args.p_cursor_id === "string" ? args.p_cursor_id : null;
  const limit = typeof args.p_limit === "number" ? args.p_limit : 76;
  const sorted = [...rows].sort((left, right) => {
    const timeCmp = timestampSortKey(String(left.updated_at)).localeCompare(
      timestampSortKey(String(right.updated_at)),
    );
    return timeCmp || String(left.id).localeCompare(String(right.id));
  });
  const filtered = cursorAt
    ? sorted.filter((row) => {
      const rowKey = timestampSortKey(String(row.updated_at));
      const cursorKey = timestampSortKey(cursorAt);
      return rowKey > cursorKey ||
        (rowKey === cursorKey && String(row.id) > String(cursorId ?? ""));
    })
    : sorted;
  return filtered.slice(0, limit);
}

Deno.test("identical-microsecond personal records produce a distinct nextCursor", async () => {
  const sharedUpdatedAt = "2026-07-08T14:24:09.648091+00:00";
  const dataset = Array.from({ length: 200 }, (_, index) => ({
    id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    user_id: VALID_USER_ID,
    local_profile_id: VALID_PROFILE_ID,
    exercise_id: null,
    exercise_name: `Lift ${index}`,
    muscle_group: "Chest",
    record_type: "MAX_WEIGHT",
    value: 100,
    weight_kg: 100,
    reps: 1,
    workout_phase: "COMBINED",
    session_id: null,
    achieved_at: sharedUpdatedAt,
    updated_at: sharedUpdatedAt,
    deleted_at: null,
  }));

  const harness = makeHarness(undefined, {
    rpcImpl: (name, args) => {
      if (name !== "get_personal_records_excluding_ids") return undefined;
      return {
        data: applyPersonalRecordCursor(dataset, args),
        error: null,
      };
    },
  });

  const pageSize = 75;
  const first = await harness.handler(requestFromBody({
    ...validPullBody(),
    pageSize,
  }));
  const firstBody = await json(first);
  assertEquals(first.status, 200, JSON.stringify(firstBody));
  assertEquals(firstBody.hasMore, true);
  const firstCursor = firstBody.nextCursor;
  assert(typeof firstCursor === "string" && firstCursor.length > 0);
  const firstIds = (firstBody.personalRecords as Array<{ id: string }>).map((row) => row.id);
  assertEquals(firstIds.length, pageSize);

  const second = await harness.handler(requestFromBody({
    ...validPullBody(),
    pageSize,
    cursor: firstCursor,
  }));
  const secondBody = await json(second);
  assertEquals(second.status, 200, JSON.stringify(secondBody));
  const secondIds = (secondBody.personalRecords as Array<{ id: string }>).map((row) => row.id);
  assertEquals(secondIds.length, pageSize);
  assertEquals(
    firstIds.filter((id) => secondIds.includes(id)),
    [],
    "second page must not replay first-page personal records",
  );
  assert(
    secondBody.nextCursor !== firstCursor,
    "nextCursor must advance when more identical-timestamp PRs remain",
  );
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
    "externalActivitiesHasMore",
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
      "workout_sessions",
      "routines",
      "training_cycles",
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
      "workout_sessions",
      "routines",
      "training_cycles",
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

// ─── lastSync request shapes against real SQL (PR 26) ──────────────────────
// Every body below is the verbatim wire shape of the mobile client's
// PortalSyncPullRequest (PortalApiClient.pullPortalPayload): kotlinx
// encodeDefaults=true keeps lastSync and the five known-id lists,
// explicitNulls=false drops a null cursor, and SyncManager pages at 100.

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

type ParityTable = "workout_sessions" | "routines" | "training_cycles";
const PARITY_TABLES: ParityTable[] = [
  "workout_sessions",
  "routines",
  "training_cycles",
];
const RESPONSE_KEY: Record<ParityTable, string> = {
  workout_sessions: "sessions",
  routines: "routines",
  training_cycles: "cycles",
};

function emptyKnown(): Record<ParityTable, string[]> {
  return { workout_sessions: [], routines: [], training_cycles: [] };
}

function mobilePullBody(
  lastSync: number,
  profileId: string,
  known: Record<ParityTable, string[]>,
): Record<string, unknown> {
  return {
    deviceId: "pr26-contract-device",
    lastSync,
    profileId,
    pageSize: 100,
    knownEntityIds: {
      sessionIds: known.workout_sessions,
      routineIds: known.routines,
      cycleIds: known.training_cycles,
      badgeIds: [],
      personalRecordIds: [],
    },
  };
}

async function insertParityRow(
  fixture: LocalPullFixture,
  table: ParityTable,
  options: {
    userId?: string;
    localProfileId: string | null;
    updatedAtMs: number;
  },
): Promise<string> {
  const id = crypto.randomUUID();
  const updatedAt = new Date(options.updatedAtMs).toISOString();
  const row: Record<string, unknown> = {
    id,
    user_id: options.userId ?? fixture.ownerId,
    name: `pr26 ${table}`,
    updated_at: updatedAt,
    local_profile_id: options.localProfileId,
  };
  // Keep the sessions started_at arm from leaking rows the test expects absent.
  if (table === "workout_sessions") row.started_at = updatedAt;
  const inserted = await fixture.admin.from(table).insert(row);
  if (inserted.error) {
    throw new Error(`${table} fixture insert failed: ${inserted.error.message}`);
  }
  return id;
}

/** A portal edit: a plain UPDATE, so the BEFORE UPDATE trigger stamps now(). */
async function portalEdit(
  fixture: LocalPullFixture,
  table: ParityTable,
  id: string,
): Promise<void> {
  const patch = table === "workout_sessions"
    ? { notes: "edited on portal" }
    : { description: "edited on portal" };
  const updated = await fixture.admin.from(table).update(patch).eq("id", id);
  if (updated.error) {
    throw new Error(`${table} portal edit failed: ${updated.error.message}`);
  }
}

async function ensureDefaultProfile(
  fixture: LocalPullFixture,
  userId: string,
): Promise<void> {
  const result = await fixture.admin.from("local_profiles").upsert({
    user_id: userId,
    id: "default",
    name: "Default",
    device_id: "server",
  }, { onConflict: "user_id,id", ignoreDuplicates: true });
  if (result.error) throw new Error("default profile fixture failed");
}

function returnedIds(
  body: Record<string, unknown>,
  table: ParityTable,
): string[] {
  const rows = body[RESPONSE_KEY[table]] as Array<{ id: string }>;
  assert(Array.isArray(rows), RESPONSE_KEY[table]);
  return rows.map((row) => row.id).sort();
}

async function pullOnce(
  fixture: LocalPullFixture,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const logs: unknown[][] = [];
  const response = await realPullHandler(fixture, fixture.ownerId, logs)(
    requestFromBody(body),
  );
  const parsed = await json(response);
  assertEquals(response.status, 200, JSON.stringify(parsed));
  assertEquals(parsed.hasMore, false);
  assertEquals(logs, []);
  return parsed;
}

Deno.test({
  name:
    "integration: shipping build shape (lastSync 0 + full known ids) returns every row",
  ignore: localIntegrationEnvironment === null,
  fn: async () => {
    const fixture = await createLocalPullFixture();
    try {
      const now = Date.now();
      const known = emptyKnown();
      for (const table of PARITY_TABLES) {
        known[table] = [
          await insertParityRow(fixture, table, {
            localProfileId: fixture.ownerProfileId,
            updatedAtMs: now - 30 * DAY_MS,
          }),
          await insertParityRow(fixture, table, {
            localProfileId: fixture.ownerProfileId,
            updatedAtMs: now - HOUR_MS,
          }),
        ].sort();
      }

      // Today's behaviour, kept on purpose: with lastSync 0 every row is
      // "stale", so even known rows come back (keeps #116 note edits flowing).
      const body = await pullOnce(
        fixture,
        mobilePullBody(0, fixture.ownerProfileId, known),
      );
      for (const table of PARITY_TABLES) {
        assertEquals(returnedIds(body, table), known[table], table);
      }
    } finally {
      await deleteLocalPullFixtureRows(
        fixture.admin,
        [fixture.ownerId, fixture.otherId],
      );
      await assertLocalPullFixtureClean(fixture);
    }
  },
});

Deno.test({
  name:
    "integration: real lastSync + known ids returns only new, portal-edited and overlap-window rows",
  ignore: localIntegrationEnvironment === null,
  fn: async () => {
    const fixture = await createLocalPullFixture();
    try {
      const lastSync = Date.now() - HOUR_MS;
      const profile = fixture.ownerProfileId;
      const known = emptyKnown();
      const expected = emptyKnown();
      for (const table of PARITY_TABLES) {
        const unchanged = await insertParityRow(fixture, table, {
          localProfileId: profile,
          updatedAtMs: lastSync - DAY_MS,
        });
        const justOutsideOverlap = await insertParityRow(fixture, table, {
          localProfileId: profile,
          updatedAtMs: lastSync - 3 * MINUTE_MS,
        });
        const insideOverlap = await insertParityRow(fixture, table, {
          localProfileId: profile,
          updatedAtMs: lastSync - MINUTE_MS,
        });
        const portalEdited = await insertParityRow(fixture, table, {
          localProfileId: profile,
          updatedAtMs: lastSync - DAY_MS,
        });
        await portalEdit(fixture, table, portalEdited);
        const unknown = await insertParityRow(fixture, table, {
          localProfileId: profile,
          updatedAtMs: lastSync - DAY_MS,
        });
        known[table] = [
          unchanged,
          justOutsideOverlap,
          insideOverlap,
          portalEdited,
        ];
        expected[table] = [insideOverlap, portalEdited, unknown].sort();
      }

      const body = await pullOnce(
        fixture,
        mobilePullBody(lastSync, profile, known),
      );
      for (const table of PARITY_TABLES) {
        assertEquals(returnedIds(body, table), expected[table], table);
      }
    } finally {
      await deleteLocalPullFixtureRows(
        fixture.admin,
        [fixture.ownerId, fixture.otherId],
      );
      await assertLocalPullFixtureClean(fixture);
    }
  },
});

Deno.test({
  name:
    "integration: real lastSync + empty known ids returns the whole default profile and nothing else",
  ignore: localIntegrationEnvironment === null,
  fn: async () => {
    const fixture = await createLocalPullFixture();
    try {
      await ensureDefaultProfile(fixture, fixture.ownerId);
      const lastSync = Date.now() - HOUR_MS;
      const expected = emptyKnown();
      for (const table of PARITY_TABLES) {
        const nullSinceLastSync = await insertParityRow(fixture, table, {
          localProfileId: null,
          updatedAtMs: lastSync + 10 * MINUTE_MS,
        });
        const defaultSinceLastSync = await insertParityRow(fixture, table, {
          localProfileId: "default",
          updatedAtMs: lastSync + 10 * MINUTE_MS,
        });
        // A device holding no ids must receive its whole profile, not only
        // rows since lastSync, or older rows would never reach it.
        const defaultOld = await insertParityRow(fixture, table, {
          localProfileId: "default",
          updatedAtMs: lastSync - DAY_MS,
        });
        // Must never appear under "default": another local profile's row, and
        // another user's NULL-profile row.
        await insertParityRow(fixture, table, {
          localProfileId: fixture.ownerProfileId,
          updatedAtMs: lastSync + 10 * MINUTE_MS,
        });
        await insertParityRow(fixture, table, {
          userId: fixture.otherId,
          localProfileId: null,
          updatedAtMs: lastSync + 10 * MINUTE_MS,
        });
        expected[table] = [nullSinceLastSync, defaultSinceLastSync, defaultOld]
          .sort();
      }

      const body = await pullOnce(
        fixture,
        mobilePullBody(lastSync, "default", emptyKnown()),
      );
      for (const table of PARITY_TABLES) {
        assertEquals(returnedIds(body, table), expected[table], table);
      }
    } finally {
      await deleteLocalPullFixtureRows(
        fixture.admin,
        [fixture.ownerId, fixture.otherId],
      );
      await assertLocalPullFixtureClean(fixture);
    }
  },
});

const OVERFLOW_SESSION_ID = "00000000-0000-4000-8000-0000000000aa";

function sessionRpcRow(): Record<string, unknown> {
  return {
    id: OVERFLOW_SESSION_ID,
    user_id: VALID_USER_ID,
    name: "Paged",
    started_at: "2026-08-01T00:00:00.000Z",
    updated_at: "2026-08-01T00:00:00.000Z",
    duration_seconds: 60,
    total_volume: 0,
    set_count: 0,
    exercise_count: 1,
    pr_count: 0,
  };
}

function exerciseRows(count: number): Record<string, unknown>[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
    session_id: OVERFLOW_SESSION_ID,
    name: `Ex ${i}`,
    muscle_group: "Chest",
    order_index: i,
  }));
}

Deno.test("child paging: exact PAGE for one parent is HTTP 200", async () => {
  const harness = makeHarness(async () => VALID_AUTH_RESULT, {
    rpcImpl: (name) => {
      if (name === "get_sessions_excluding_ids") {
        return { data: [sessionRpcRow()], error: null };
      }
      return undefined;
    },
    fromPages: {
      exercises: [{ data: exerciseRows(CHILD_PAGE_SIZE), error: null }],
    },
  });
  const response = await harness.handler(requestFromBody(validPullBody()));
  assertEquals(response.status, 200);
  const body = await json(response);
  assertEquals((body.sessions as unknown[]).length, 1);
  assertEquals(
    ((body.sessions as Array<{ exercises: unknown[] }>)[0].exercises).length,
    CHILD_PAGE_SIZE,
  );
});

Deno.test("child paging: one parent PAGE+1 then Range refused is HTTP 503", async () => {
  const harness = makeHarness(async () => VALID_AUTH_RESULT, {
    rpcImpl: (name) => {
      if (name === "get_sessions_excluding_ids") {
        return { data: [sessionRpcRow()], error: null };
      }
      return undefined;
    },
    fromPages: {
      exercises: [
        { data: exerciseRows(CHILD_PAGE_SIZE + 1), error: null },
        {
          data: null,
          error: { message: "Requested range not satisfiable", code: "PGRST103" },
        },
      ],
    },
  });
  const response = await harness.handler(requestFromBody(validPullBody()));
  assertEquals(response.status, 503);
  const body = await json(response);
  assertEquals(body.code, "CHILD_OVERFLOW");
  assert(!Object.hasOwn(body, "details"));
});

Deno.test("child paging: PAGE+1 then a non-Range error is generic 503", async () => {
  const harness = makeHarness(async () => VALID_AUTH_RESULT, {
    rpcImpl: (name) => {
      if (name === "get_sessions_excluding_ids") {
        return { data: [sessionRpcRow()], error: null };
      }
      return undefined;
    },
    fromPages: {
      exercises: [
        { data: exerciseRows(CHILD_PAGE_SIZE + 1), error: null },
        {
          data: null,
          error: { message: "connection reset", code: "57014" },
        },
      ],
    },
  });
  const response = await harness.handler(requestFromBody(validPullBody()));
  assertEquals(response.status, 503);
  const body = await json(response);
  assertEquals(body.code, "57014");
  assert(!Object.hasOwn(body, "details"));
  assert(!JSON.stringify(body).includes("connection reset"));
});

Deno.test("external_activities hasMore is true when the 500-row cap is hit", async () => {
  const activities = Array.from({ length: 500 }, (_, i) => ({
    id: `act-${i}`,
    external_id: `ext-${i}`,
    provider: "strava",
    name: "Run",
    activity_type: "Run",
    started_at: "2026-08-01T00:00:00.000Z",
    duration_seconds: 60,
    distance_meters: 1000,
    calories: 10,
    avg_heart_rate: null,
    max_heart_rate: null,
    elevation_gain_meters: null,
    raw_data: null,
  }));
  const harness = makeHarness(async () => VALID_AUTH_RESULT, {
    fromPages: {
      external_activities: [{ data: activities, error: null }],
    },
  });
  const response = await harness.handler(requestFromBody(validPullBody()));
  assertEquals(response.status, 200);
  const body = await json(response);
  assertEquals(body.externalActivitiesHasMore, true);
  assertEquals((body.externalActivities as unknown[]).length, 500);
});

