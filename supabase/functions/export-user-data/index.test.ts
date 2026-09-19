import { assert, assertEquals } from "jsr:@std/assert@1";
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { localIntegrationEnvironment } from "../_shared/localIntegrationEnvironment.ts";
import {
  EXCLUDED,
  USER_DATA_MANIFEST,
  USER_DATA_PAGE_SIZE,
} from "../_shared/userDataManifest.ts";
import {
  buildKeysetOrFilter,
  createExportUserDataHandler,
  EXPORT_RATE_LIMIT,
  parseExportRequest,
} from "./index.ts";

const USER_ID = "00000000-0000-4000-8000-00000000aaaa";

function request(
  body: unknown,
  { method = "POST", authorization = "Bearer test-jwt" as string | null } = {},
): Request {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (authorization !== null) headers.set("Authorization", authorization);
  return new Request("http://localhost/functions/v1/export-user-data", {
    method,
    headers,
    body: method === "GET" ? undefined : JSON.stringify(body),
  });
}

interface Recorded {
  from: string[];
  ops: Array<[string, unknown[]]>;
  rpc: Array<[string, Record<string, unknown>]>;
}

function adminDouble(
  recorded: Recorded,
  result: { data: unknown; error: unknown },
  rateAllowed = true,
): SupabaseClient {
  const builder: Record<string, unknown> = {};
  for (const name of ["select", "eq", "gt", "or", "order", "limit"]) {
    builder[name] = (...args: unknown[]) => {
      recorded.ops.push([name, args]);
      return builder;
    };
  }
  builder.then = (
    onFulfilled?: (value: unknown) => unknown,
    onRejected?: (reason: unknown) => unknown,
  ) => Promise.resolve(result).then(onFulfilled, onRejected);
  return {
    from(table: string) {
      recorded.from.push(table);
      return builder;
    },
    rpc(name: string, args: Record<string, unknown>) {
      recorded.rpc.push([name, args]);
      return Promise.resolve({
        data: {
          allowed: rateAllowed,
          remaining: rateAllowed ? 599 : 0,
          retry_after_seconds: rateAllowed ? null : 60,
        },
        error: null,
      });
    },
  } as unknown as SupabaseClient;
}

function doubleHandler(
  result: { data: unknown; error: unknown } = { data: [], error: null },
  options: { userId?: string | null; rateAllowed?: boolean } = {},
) {
  const recorded: Recorded = { from: [], ops: [], rpc: [] };
  const userId = options.userId === undefined ? USER_ID : options.userId;
  const handler = createExportUserDataHandler({
    createAuthClient() {
      return {
        auth: {
          getUser() {
            return Promise.resolve(
              userId
                ? { data: { user: { id: userId } }, error: null }
                : { data: { user: null }, error: { status: 401 } },
            );
          },
        },
      };
    },
    createAdminClient() {
      return adminDouble(recorded, result, options.rateAllowed ?? true);
    },
  });
  return { handler, recorded };
}

Deno.test("rejects non-POST methods with 405", async () => {
  const { handler, recorded } = doubleHandler();
  const response = await handler(request(null, { method: "GET" }));
  assertEquals(response.status, 405);
  assertEquals(recorded.from, []);
});

Deno.test("requires a bearer token and a verified user", async () => {
  const missing = doubleHandler();
  assertEquals(
    (await missing.handler(request({ table: "routines" }, { authorization: null })))
      .status,
    401,
  );
  const invalid = doubleHandler(undefined, { userId: null });
  assertEquals((await invalid.handler(request({ table: "routines" }))).status, 401);
  assertEquals(invalid.recorded.from, []);
});

Deno.test("unknown and excluded tables give 400 without querying or charging the rate limit", async () => {
  for (const table of ["auth.users", "not_a_table", ...EXCLUDED.map((e) => e.table)]) {
    const { handler, recorded } = doubleHandler();
    const response = await handler(request({ table }));
    assertEquals(response.status, 400, table);
    assertEquals(recorded.from, [], table);
    assertEquals(recorded.rpc, [], table);
  }
});

Deno.test("malformed cursors give 400", () => {
  const bad: unknown[] = [
    "abc",
    [],
    {},
    { id: "" },
    { id: null },
    { id: "a", extra: "b" },
    { id: "x".repeat(513) },
  ];
  for (const cursor of bad) {
    assertEquals(parseExportRequest({ table: "routines", cursor }).ok, false);
  }
  assertEquals(
    parseExportRequest({ table: "sync_tombstones", cursor: { entity: "routine" } }).ok,
    false,
  );
  assert(parseExportRequest({ table: "routines", cursor: { id: "abc" } }).ok);
});

Deno.test("scopes by the JWT user id, never a body-supplied user id, and charges 600/hour", async () => {
  const { handler, recorded } = doubleHandler();
  const response = await handler(request({
    table: "routines",
    user_id: "00000000-0000-4000-8000-00000000bbbb",
    cursor: { id: "00000000-0000-4000-8000-000000000001" },
  }));
  assertEquals(response.status, 200);
  assertEquals(recorded.from, ["routines"]);
  assertEquals(recorded.ops, [
    ["select", ["*"]],
    ["eq", ["user_id", USER_ID]],
    ["gt", ["id", "00000000-0000-4000-8000-000000000001"]],
    ["order", ["id", { ascending: true }]],
    ["limit", [USER_DATA_PAGE_SIZE]],
  ]);
  assertEquals(recorded.rpc, [[
    "check_rate_limit",
    {
      p_key: "export-user-data",
      p_user_id: USER_ID,
      p_max_requests: EXPORT_RATE_LIMIT.maxRequests,
      p_window_seconds: EXPORT_RATE_LIMIT.windowSeconds,
    },
  ]]);
  assertEquals(EXPORT_RATE_LIMIT, { maxRequests: 600, windowSeconds: 3600 });
});

Deno.test("rate-limited requests get 429 and no query", async () => {
  const { handler, recorded } = doubleHandler(undefined, { rateAllowed: false });
  const response = await handler(request({ table: "routines" }));
  assertEquals(response.status, 429);
  assertEquals(recorded.from, []);
});

Deno.test("parent-owned tables scope through an inner join on the parent owner", async () => {
  const { handler, recorded } = doubleHandler({
    data: [{ id: "r1", routine_id: "p1", routines: { user_id: USER_ID } }],
    error: null,
  });
  const response = await handler(request({ table: "routine_exercises" }));
  assertEquals(response.status, 200);
  assertEquals(recorded.ops.slice(0, 2), [
    ["select", ["*, routines!routine_id!inner(user_id)"]],
    ["eq", ["routines.user_id", USER_ID]],
  ]);
  const body = await response.json();
  assertEquals(body.rows, [{ id: "r1", routine_id: "p1" }]);
  assertEquals(body.nextCursor, null);
});

Deno.test("composite keys page with a quoted row-value comparison", async () => {
  assertEquals(
    buildKeysetOrFilter(["entity", "entity_id"], {
      entity: "routine",
      entity_id: 'a,b)"\\',
    }),
    'entity.gt."routine",and(entity.eq."routine",entity_id.gt."a,b)\\"\\\\")',
  );
  const { handler, recorded } = doubleHandler();
  await handler(request({
    table: "sync_tombstones",
    cursor: { entity: "cycle", entity_id: "e1" },
  }));
  assertEquals(recorded.ops, [
    ["select", ["*"]],
    ["eq", ["user_id", USER_ID]],
    ["or", ['entity.gt."cycle",and(entity.eq."cycle",entity_id.gt."e1")']],
    ["order", ["entity", { ascending: true }]],
    ["order", ["entity_id", { ascending: true }]],
    ["limit", [USER_DATA_PAGE_SIZE]],
  ]);
});

Deno.test("full pages return the last row's key as nextCursor; short pages end paging", async () => {
  const rows = Array.from({ length: USER_DATA_PAGE_SIZE }, (_, i) => ({
    id: `id-${String(i).padStart(4, "0")}`,
    user_id: USER_ID,
  }));
  const full = doubleHandler({ data: rows, error: null });
  const fullBody = await (await full.handler(request({ table: "routines" }))).json();
  assertEquals(fullBody.rows.length, USER_DATA_PAGE_SIZE);
  assertEquals(fullBody.nextCursor, { id: "id-0999" });

  const short = doubleHandler({ data: rows.slice(0, 999), error: null });
  const shortBody = await (await short.handler(request({ table: "routines" }))).json();
  assertEquals(shortBody.rows.length, 999);
  assertEquals(shortBody.nextCursor, null);
});

Deno.test("a table absent from this database is reported, not a 500", async () => {
  const { handler } = doubleHandler({
    data: null,
    error: { code: "PGRST205", message: "Could not find the table" },
  });
  const response = await handler(request({ table: "sync_tombstones" }));
  assertEquals(response.status, 200);
  assertEquals(await response.json(), {
    table: "sync_tombstones",
    rows: [],
    nextCursor: null,
    tableMissing: true,
  });
});

Deno.test("other query errors give 500", async () => {
  const { handler } = doubleHandler({ data: null, error: { code: "XX000", message: "boom" } });
  assertEquals((await handler(request({ table: "routines" }))).status, 500);
});

Deno.test("every manifest entry has key columns and no table is both exported and excluded", () => {
  const excluded = new Set(EXCLUDED.map((e) => e.table));
  for (const entry of USER_DATA_MANIFEST) {
    assert(entry.keyColumns.length > 0, entry.table);
    assert(!excluded.has(entry.table), entry.table);
  }
});

// ---------------------------------------------------------------------------
// Real-SQL tests against the local stack (PR 5 harness).
// ---------------------------------------------------------------------------

interface ExportFixture {
  admin: SupabaseClient;
  ownerId: string;
  otherId: string;
}

async function createExportFixture(): Promise<ExportFixture> {
  assert(localIntegrationEnvironment);
  const admin = createClient(
    localIntegrationEnvironment.url,
    localIntegrationEnvironment.serviceRoleKey,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const suffix = crypto.randomUUID();
  const ids: string[] = [];
  try {
    for (const role of ["owner", "other"]) {
      const created = await admin.auth.admin.createUser({
        email: `pr36-${role}-${suffix}@example.invalid`,
        email_confirm: true,
      });
      if (created.error || !created.data.user) throw new Error(`${role} user creation failed`);
      ids.push(created.data.user.id);
    }
  } catch (error) {
    for (const id of ids) await admin.auth.admin.deleteUser(id);
    throw error;
  }
  return { admin, ownerId: ids[0], otherId: ids[1] };
}

async function destroyExportFixture(fixture: ExportFixture): Promise<void> {
  const userIds = [fixture.ownerId, fixture.otherId];
  await fixture.admin.from("rate_limit_tracking").delete().in("user_id", userIds);
  for (const id of userIds) await fixture.admin.auth.admin.deleteUser(id);
  for (const table of ["sync_queue", "routines", "training_cycles", "rate_limit_tracking"]) {
    const audit = await fixture.admin.from(table)
      .select("id", { count: "exact", head: true })
      .in("user_id", userIds);
    if (audit.error) throw new Error(`${table} cleanup audit failed`);
    assertEquals(audit.count, 0, table);
  }
}

function realHandler(fixture: ExportFixture, verifiedUserId: string) {
  return createExportUserDataHandler({
    createAuthClient() {
      return {
        auth: {
          getUser() {
            return Promise.resolve({ data: { user: { id: verifiedUserId } }, error: null });
          },
        },
      };
    },
    createAdminClient() {
      return fixture.admin;
    },
  });
}

async function exportAll(
  handler: (req: Request) => Promise<Response>,
  table: string,
): Promise<Array<Array<Record<string, unknown>>>> {
  const pages: Array<Array<Record<string, unknown>>> = [];
  let cursor: unknown = null;
  for (let guard = 0; guard < 20; guard++) {
    const response = await handler(request({ table, cursor }));
    assertEquals(response.status, 200, `${table} page ${pages.length}`);
    const body = await response.json();
    assertEquals(body.tableMissing, undefined, table);
    pages.push(body.rows);
    if (body.nextCursor === null) return pages;
    cursor = body.nextCursor;
  }
  throw new Error(`${table}: paging did not terminate`);
}

async function insertOrThrow(
  admin: SupabaseClient,
  table: string,
  rows: Record<string, unknown>[],
): Promise<void> {
  for (let i = 0; i < rows.length; i += 1000) {
    const { error } = await admin.from(table).insert(rows.slice(i, i + 1000));
    if (error) throw new Error(`${table} insert failed: ${error.message}`);
  }
}

Deno.test({
  name:
    "integration: 2,500 rows export in 3 keyset pages with no duplicates and never another user's rows",
  ignore: localIntegrationEnvironment === null,
  fn: async () => {
    const fixture = await createExportFixture();
    try {
      const ownerRows = Array.from({ length: 2500 }, () => ({
        id: crypto.randomUUID(),
        user_id: fixture.ownerId,
        provider: "strava",
      }));
      const otherRows = Array.from({ length: 30 }, () => ({
        id: crypto.randomUUID(),
        user_id: fixture.otherId,
        provider: "fitbit",
      }));
      await insertOrThrow(fixture.admin, "sync_queue", [...ownerRows, ...otherRows]);

      const pages = await exportAll(realHandler(fixture, fixture.ownerId), "sync_queue");
      assertEquals(pages.map((page) => page.length), [1000, 1000, 500]);
      const exported = pages.flat();
      const ids = exported.map((row) => row.id as string);
      assertEquals(new Set(ids).size, 2500);
      assertEquals(new Set(ids), new Set(ownerRows.map((row) => row.id)));
      assert(exported.every((row) => row.user_id === fixture.ownerId));
      assertEquals([...ids].sort(), ids, "pages are ordered by id");

      const otherPages = await exportAll(realHandler(fixture, fixture.otherId), "sync_queue");
      assertEquals(otherPages.map((page) => page.length), [30]);
      assert(otherPages.flat().every((row) => row.user_id === fixture.otherId));
    } finally {
      await destroyExportFixture(fixture);
    }
  },
});

Deno.test({
  name:
    "integration: parent-owned and non-id-keyed tables export only the caller's rows",
  ignore: localIntegrationEnvironment === null,
  fn: async () => {
    const fixture = await createExportFixture();
    try {
      const ownerRoutine = crypto.randomUUID();
      const otherRoutine = crypto.randomUUID();
      await insertOrThrow(fixture.admin, "routines", [
        { id: ownerRoutine, user_id: fixture.ownerId, name: "Owner routine" },
        { id: otherRoutine, user_id: fixture.otherId, name: "Other routine" },
      ]);
      const ownerExerciseIds = Array.from({ length: 3 }, () => crypto.randomUUID());
      await insertOrThrow(fixture.admin, "routine_exercises", [
        ...ownerExerciseIds.map((id, i) => ({
          id,
          routine_id: ownerRoutine,
          name: `Owner ${i}`,
          order_index: i,
        })),
        {
          id: crypto.randomUUID(),
          routine_id: otherRoutine,
          name: "Other",
          order_index: 0,
        },
      ]);
      const ownerCycle = crypto.randomUUID();
      const otherCycle = crypto.randomUUID();
      await insertOrThrow(fixture.admin, "training_cycles", [
        { id: ownerCycle, user_id: fixture.ownerId, name: "Owner cycle" },
        { id: otherCycle, user_id: fixture.otherId, name: "Other cycle" },
      ]);
      const ownerDay = crypto.randomUUID();
      await insertOrThrow(fixture.admin, "cycle_days", [
        { id: ownerDay, cycle_id: ownerCycle, day_number: 1 },
        { id: crypto.randomUUID(), cycle_id: otherCycle, day_number: 1 },
      ]);
      await insertOrThrow(fixture.admin, "local_profiles", [
        { user_id: fixture.ownerId, id: "p-b", name: "B", color_index: 0, device_id: "d1" },
        { user_id: fixture.ownerId, id: "p-a", name: "A", color_index: 1, device_id: "d1" },
        { user_id: fixture.otherId, id: "p-a", name: "X", color_index: 0, device_id: "d2" },
      ]);
      await insertOrThrow(fixture.admin, "local_profile_preferences", [
        { user_id: fixture.ownerId, local_profile_id: "p-b" },
        { user_id: fixture.ownerId, local_profile_id: "p-a" },
        { user_id: fixture.otherId, local_profile_id: "p-a" },
      ]);

      const owner = realHandler(fixture, fixture.ownerId);
      const exercises = (await exportAll(owner, "routine_exercises")).flat();
      assertEquals(new Set(exercises.map((row) => row.id)), new Set(ownerExerciseIds));
      assert(exercises.every((row) => row.routine_id === ownerRoutine && !("routines" in row)));

      const days = (await exportAll(owner, "cycle_days")).flat();
      assertEquals(days.map((row) => row.id), [ownerDay]);
      assert(!("training_cycles" in days[0]));

      const preferences = (await exportAll(owner, "local_profile_preferences")).flat();
      assertEquals(preferences.map((row) => row.local_profile_id), ["p-a", "p-b"]);
      assert(preferences.every((row) => row.user_id === fixture.ownerId));

      const cursorResponse = await owner(request({
        table: "local_profile_preferences",
        cursor: { local_profile_id: "p-a" },
      }));
      const cursorBody = await cursorResponse.json();
      assertEquals(cursorBody.rows.map((row: Record<string, unknown>) => row.local_profile_id), ["p-b"]);

      const unknown = await owner(request({ table: "oauth_tokens" }));
      assertEquals(unknown.status, 400);
    } finally {
      await destroyExportFixture(fixture);
    }
  },
});
