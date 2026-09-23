import { assert, assertEquals } from "jsr:@std/assert@1";
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { localIntegrationEnvironment } from "../_shared/localIntegrationEnvironment.ts";
import {
  EXCLUDED,
  getUserDataTable,
  NON_TABLE_SOURCES,
  USER_DATA_MANIFEST,
  USER_DATA_PAGE_SIZE,
  type UserDataTable,
} from "../_shared/userDataManifest.ts";
import {
  buildKeysetOrFilter,
  createExportUserDataHandler,
  type ExportCursor,
  EXPORT_RATE_LIMIT,
  parseExportRequest,
  readExportPage,
} from "./index.ts";

const USER_ID = "00000000-0000-4000-8000-00000000aaaa";
const ROUTINE_COLUMNS = getUserDataTable("routines")!.columns;
const ROUTINE_OPTIONAL = getUserDataTable("routines")!.optionalColumns ?? [];

function request(
  body: unknown,
  {
    method = "POST",
    authorization = "Bearer test-jwt" as string | null,
    rawBody = undefined as string | undefined,
  } = {},
): Request {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (authorization !== null) headers.set("Authorization", authorization);
  return new Request("http://localhost/functions/v1/export-user-data", {
    method,
    headers,
    body: method === "GET" ? undefined : rawBody ?? JSON.stringify(body),
  });
}

type QueryResult = { data: unknown; error: unknown; count?: number | null };

interface Recorded {
  from: string[];
  ops: Array<[string, unknown[]]>;
  rpc: Array<[string, Record<string, unknown>]>;
  storage: Array<[string, unknown[]]>;
}

interface DoubleOptions {
  userId?: string | null;
  user?: Record<string, unknown>;
  authResult?: unknown;
  authThrows?: boolean;
  rateAllowed?: boolean;
  rateError?: boolean;
  storageResult?: { data: unknown; error: unknown };
}

function adminDouble(
  recorded: Recorded,
  results: QueryResult[],
  options: DoubleOptions,
): SupabaseClient {
  let queryIndex = 0;
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
  ) => {
    const result = results[Math.min(queryIndex++, results.length - 1)];
    return Promise.resolve(result).then(onFulfilled, onRejected);
  };
  return {
    from(table: string) {
      recorded.from.push(table);
      return builder;
    },
    rpc(name: string, args: Record<string, unknown>) {
      recorded.rpc.push([name, args]);
      if (options.rateError) {
        return Promise.resolve({ data: null, error: { code: "XX000", message: "down" } });
      }
      const allowed = options.rateAllowed ?? true;
      return Promise.resolve({
        data: {
          allowed,
          remaining: allowed ? 599 : 0,
          retry_after_seconds: allowed ? null : 60,
        },
        error: null,
      });
    },
    storage: {
      from(bucket: string) {
        return {
          list(...args: unknown[]) {
            recorded.storage.push([bucket, args]);
            return Promise.resolve(options.storageResult ?? { data: [], error: null });
          },
        };
      },
    },
  } as unknown as SupabaseClient;
}

function doubleHandler(
  results: QueryResult | QueryResult[] = { data: [], error: null, count: 0 },
  options: DoubleOptions = {},
) {
  const recorded: Recorded = { from: [], ops: [], rpc: [], storage: [] };
  const userId = options.userId === undefined ? USER_ID : options.userId;
  const handler = createExportUserDataHandler({
    createAuthClient() {
      return {
        auth: {
          getUser() {
            if (options.authThrows) return Promise.reject(new Error("network"));
            if (options.authResult !== undefined) return Promise.resolve(options.authResult);
            return Promise.resolve(
              userId
                ? { data: { user: { id: userId, ...options.user } }, error: null }
                : { data: { user: null }, error: { status: 401 } },
            );
          },
        },
      };
    },
    createAdminClient() {
      return adminDouble(
        recorded,
        Array.isArray(results) ? results : [results],
        options,
      );
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

Deno.test("requires a Bearer token and a verified user", async () => {
  const missing = doubleHandler();
  assertEquals(
    (await missing.handler(request({ table: "routines" }, { authorization: null })))
      .status,
    401,
  );
  const basic = doubleHandler();
  assertEquals(
    (await basic.handler(request({ table: "routines" }, { authorization: "Basic abc" })))
      .status,
    401,
  );
  const invalid = doubleHandler(undefined, { userId: null });
  assertEquals((await invalid.handler(request({ table: "routines" }))).status, 401);
  assertEquals(invalid.recorded.from, []);
  assertEquals(invalid.recorded.rpc, []);
});

Deno.test("auth service failures give 503, not 401", async () => {
  for (
    const options of [
      { authThrows: true },
      { authResult: { data: { user: null }, error: { status: 500 } } },
      { authResult: { data: { user: null }, error: { message: "fetch failed" } } },
    ] as DoubleOptions[]
  ) {
    const { handler, recorded } = doubleHandler(undefined, options);
    const response = await handler(request({ table: "routines" }));
    assertEquals(response.status, 503, JSON.stringify(options));
    assertEquals(recorded.from, []);
  }
});

Deno.test("an unparseable JSON body gives 400 without charging the rate limit", async () => {
  const { handler, recorded } = doubleHandler();
  const response = await handler(request(null, { rawBody: "{not json" }));
  assertEquals(response.status, 400);
  assertEquals(recorded.rpc, []);
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
    { id: true },
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
  assertEquals(
    parseExportRequest({ table: "auth_account", cursor: { id: "x" } }).ok,
    false,
  );
  assert(parseExportRequest({ table: "routines", cursor: { id: "abc" } }).ok);
});

Deno.test("a cursor value of the wrong type for the column gives 400, not 500", async () => {
  const { handler } = doubleHandler({
    data: null,
    error: { code: "22P02", message: 'invalid input syntax for type uuid: "abc"' },
  });
  const response = await handler(request({ table: "routines", cursor: { id: "abc" } }));
  assertEquals(response.status, 400);
  assertEquals((await response.json()).error, "cursor is invalid");
});

Deno.test("scopes by the JWT user id, selects explicit columns, and charges 600/hour", async () => {
  const { handler, recorded } = doubleHandler();
  const response = await handler(request({
    table: "routines",
    user_id: "00000000-0000-4000-8000-00000000bbbb",
    cursor: { id: "00000000-0000-4000-8000-000000000001" },
  }));
  assertEquals(response.status, 200);
  assertEquals(recorded.from, ["routines"]);
  assertEquals(recorded.ops, [
    ["select", [[...ROUTINE_COLUMNS, ...ROUTINE_OPTIONAL].join(",")]],
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

// Was two earlier shapes of this claim, unioned in the merge: one asserted the
// drop against `routines.created_at`, the other moved it to `user_goals`
// ("routines has no optional columns any more (PR 16's migration added
// `created_at`, so it is a migrated column). The drop-on-42703 retry needs a
// table that still carries prod-only drift columns."). Under the manifest
// oracle a migrated column must sit in `columns`, never `optionalColumns`, and
// `database.types.ts` is generated from the migrated schema — so no real entry
// can carry a prod-only drift column on this branch. The retry is still real
// machinery in `readExportPage`, so it is exercised here with a synthetic
// entry that has one.
Deno.test("prod-only optional columns are dropped when the database lacks them", async () => {
  const entry: UserDataTable = {
    table: "routines",
    ownership: { kind: "column", column: "user_id" },
    keyColumns: ["id"],
    columns: ["id", "user_id", "name"],
    // Stands in for a column that exists in prod but not in this database.
    optionalColumns: ["drift_only"],
    purge: "cascade",
  };
  const recorded: Recorded = { from: [], ops: [], rpc: [], storage: [] };
  const admin = adminDouble(recorded, [
    { data: null, error: { code: "42703", message: "column routines.drift_only does not exist" } },
    { data: [{ id: "r1" }], error: null },
    // One-row probe past the page's last key (PR 37 R-8).
    { data: [], error: null },
  ], {});
  const page = await readExportPage(admin, entry, USER_ID, null);
  assert(page.ok, JSON.stringify(page));
  assertEquals(page.ok && page.rows, [{ id: "r1" }]);
  assertEquals(page.ok && page.nextCursor, null);
  const selects = recorded.ops.filter(([name]) => name === "select").map(([, args]) => args[0]);
  assertEquals(selects, [
    // First attempt: columns plus the prod-only drift column.
    [...entry.columns, ...entry.optionalColumns!].join(","),
    // Retry: migrated columns only — the drift column is dropped.
    entry.columns.join(","),
    // The probe selects only the key columns.
    entry.keyColumns.join(","),
  ]);
});

Deno.test("rate-limited requests get 429 and no query", async () => {
  const { handler, recorded } = doubleHandler(undefined, { rateAllowed: false });
  const response = await handler(request({ table: "routines" }));
  assertEquals(response.status, 429);
  assertEquals(recorded.from, []);
  // Browsers can read the wait: in the body, and via the exposed header.
  assertEquals(response.headers.get("Access-Control-Expose-Headers"), "Retry-After");
  assertEquals(response.headers.get("Retry-After"), "60");
  assertEquals((await response.json()).retryAfterSeconds, 60);
});

Deno.test("a rate-limit RPC failure fails closed with 503", async () => {
  const { handler, recorded } = doubleHandler(undefined, { rateError: true });
  const response = await handler(request({ table: "routines" }));
  assertEquals(response.status, 503);
  assertEquals(recorded.from, []);
});

Deno.test("parent-owned tables scope through an inner join on the parent owner", async () => {
  const { handler, recorded } = doubleHandler([
    { data: [{ id: "r1", routine_id: "p1", routines: { user_id: USER_ID } }], error: null },
    // Empty probe: nothing after this page's last key.
    { data: [], error: null },
  ]);
  const response = await handler(request({ table: "routine_exercises" }));
  assertEquals(response.status, 200);
  const columns = getUserDataTable("routine_exercises")!.columns.join(",");
  assertEquals(recorded.ops.slice(0, 2), [
    ["select", [`${columns},routines!routine_id!inner(user_id)`]],
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
    ["select", ["user_id,entity,entity_id,deleted_at,client_deleted_at"]],
    ["eq", ["user_id", USER_ID]],
    ["or", ['entity.gt."cycle",and(entity.eq."cycle",entity_id.gt."e1")']],
    ["order", ["entity", { ascending: true }]],
    ["order", ["entity_id", { ascending: true }]],
    ["limit", [USER_DATA_PAGE_SIZE]],
  ]);
});

function idRows(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: `id-${String(i).padStart(4, "0")}`,
    user_id: USER_ID,
  }));
}

// Was "nextCursor comes from the remaining-row count, not the page length":
// PR 37 R-8 replaced the per-page exact count with a one-row probe past the
// page's last key, so the cursor is driven by whether that probe finds a row
// rather than by `count` or by the page length. The claim ("not the page
// length") is kept; the mechanism is the probe.
Deno.test("nextCursor comes from the one-row probe, not the page length", async () => {
  // The probe finds a row after the page: cursor is the last key.
  const more = doubleHandler([
    { data: idRows(1000), error: null },
    { data: [{ id: "id-1000", user_id: USER_ID }], error: null },
  ]);
  const moreBody = await (await more.handler(request({ table: "routines" }))).json();
  assertEquals(moreBody.nextCursor, { id: "id-0999" });

  // Probe empty after exactly 1000 rows: no trailing empty page.
  const exact = doubleHandler([
    { data: idRows(1000), error: null },
    { data: [], error: null },
  ]);
  const exactBody = await (await exact.handler(request({ table: "routines" }))).json();
  assertEquals(exactBody.rows.length, 1000);
  assertEquals(exactBody.nextCursor, null);
  // The follow-up is a one-row probe past the page's last key over the key
  // columns only — never a second full page.
  assertEquals(exact.recorded.ops.slice(4), [
    ["select", [getUserDataTable("routines")!.keyColumns.join(",")]],
    ["eq", ["user_id", USER_ID]],
    ["gt", ["id", "id-0999"]],
    ["order", ["id", { ascending: true }]],
    ["limit", [1]],
  ]);

  // max_rows below the requested limit (e.g. 500): still pages on when the
  // probe sees a row, even though the page itself is short.
  const capped = doubleHandler([
    { data: idRows(500), error: null },
    { data: [{ id: "id-0500", user_id: USER_ID }], error: null },
  ]);
  const cappedBody = await (await capped.handler(request({ table: "routines" }))).json();
  assertEquals(cappedBody.nextCursor, { id: "id-0499" });

  // Empty table: the empty page ends the export without a probe.
  const empty = doubleHandler([{ data: [], error: null }]);
  assertEquals((await (await empty.handler(request({ table: "routines" }))).json()).nextCursor, null);
});

Deno.test("a mayBeAbsent table missing from the database is reported with tableMissing", async () => {
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

Deno.test("any other missing table is a 500, never a silent empty table", async () => {
  const { handler } = doubleHandler({
    data: null,
    error: { code: "PGRST205", message: "Could not find the table" },
  });
  assertEquals((await handler(request({ table: "routines" }))).status, 500);
});

Deno.test("other query errors give 500", async () => {
  const { handler } = doubleHandler({ data: null, error: { code: "XX000", message: "boom" } });
  assertEquals((await handler(request({ table: "routines" }))).status, 500);
});

Deno.test("auth_account returns the verified user's account fields only", async () => {
  const { handler, recorded } = doubleHandler(undefined, {
    user: {
      email: "a@example.invalid",
      phone: "",
      created_at: "2026-01-01T00:00:00Z",
      last_sign_in_at: "2026-09-01T00:00:00Z",
      email_confirmed_at: "2026-01-01T00:00:01Z",
      identities: [{ provider: "google", identity_data: { secret: "x" } }, { provider: "email" }],
      app_metadata: { providers: ["email", "google"] },
      user_metadata: { anything: true },
    },
  });
  const response = await handler(request({ table: "auth_account" }));
  assertEquals(response.status, 200);
  assertEquals(await response.json(), {
    table: "auth_account",
    rows: [{
      id: USER_ID,
      email: "a@example.invalid",
      phone: null,
      created_at: "2026-01-01T00:00:00Z",
      last_sign_in_at: "2026-09-01T00:00:00Z",
      email_confirmed_at: "2026-01-01T00:00:01Z",
      identity_providers: ["email", "google"],
    }],
    nextCursor: null,
  });
  assertEquals(recorded.from, []);
  assertEquals(recorded.rpc.length, 1);
});

Deno.test("storage_avatars lists only the user's avatars folder", async () => {
  const { handler, recorded } = doubleHandler(undefined, {
    storageResult: {
      data: [
        {
          id: "o1",
          name: "a.png",
          updated_at: "2026-09-01T00:00:00Z",
          metadata: { size: 12, mimetype: "image/png" },
        },
        { id: null, name: "nested", metadata: null },
      ],
      error: null,
    },
  });
  const body = await (await handler(request({ table: "storage_avatars" }))).json();
  assertEquals(recorded.storage[0][0], "avatars");
  assertEquals(recorded.storage[0][1][0], USER_ID);
  assertEquals(body.rows, [{
    bucket: "avatars",
    path: `${USER_ID}/a.png`,
    size: 12,
    mimetype: "image/png",
    updated_at: "2026-09-01T00:00:00Z",
  }]);
});

Deno.test("every manifest entry has key columns and no table is both exported and excluded", () => {
  const excluded = new Set(EXCLUDED.map((e) => e.table));
  const sources = new Set(NON_TABLE_SOURCES.map((s) => s.source));
  for (const entry of USER_DATA_MANIFEST) {
    assert(entry.keyColumns.length > 0, entry.table);
    assert(entry.keyColumns.every((c) => entry.columns.includes(c)), entry.table);
    assert(!excluded.has(entry.table), entry.table);
    assert(!sources.has(entry.table), entry.table);
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

function realHandler(
  fixture: ExportFixture,
  verifiedUserId: string,
  user: Record<string, unknown> = {},
) {
  return createExportUserDataHandler({
    createAuthClient() {
      return {
        auth: {
          getUser() {
            return Promise.resolve({
              data: { user: { ...user, id: verifiedUserId } },
              error: null,
            });
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
        // Terminal: only one pending/processing row per user/provider (PR 52).
        status: "completed",
      }));
      const otherRows = Array.from({ length: 30 }, () => ({
        id: crypto.randomUUID(),
        user_id: fixture.otherId,
        provider: "fitbit",
        status: "completed",
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
      assertEquals(
        Object.keys(exported[0]).sort(),
        [...getUserDataTable("sync_queue")!.columns].sort(),
      );

      const otherPages = await exportAll(realHandler(fixture, fixture.otherId), "sync_queue");
      assertEquals(otherPages.map((page) => page.length), [30]);
      assert(otherPages.flat().every((row) => row.user_id === fixture.otherId));

      // Exactly one full page: no trailing empty page.
      const trimmed = await fixture.admin.from("sync_queue").delete()
        .eq("user_id", fixture.ownerId)
        .gt("id", ids[999]);
      if (trimmed.error) throw new Error(`trim failed: ${trimmed.error.message}`);
      const exactPages = await exportAll(realHandler(fixture, fixture.ownerId), "sync_queue");
      assertEquals(exactPages.map((page) => page.length), [1000]);
    } finally {
      await destroyExportFixture(fixture);
    }
  },
});

Deno.test({
  name:
    "integration: parent-owned, non-id-keyed, drift-column and non-table sources export only the caller's data",
  ignore: localIntegrationEnvironment === null,
  fn: async () => {
    const fixture = await createExportFixture();
    const avatarPaths: string[] = [];
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

      // routines has a prod-only optional column (created_at) that the
      // local schema lacks: the export falls back to the migrated columns.
      const routines = (await exportAll(owner, "routines")).flat();
      assertEquals(routines.map((row) => row.id), [ownerRoutine]);

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
      assertEquals(
        cursorBody.rows.map((row: Record<string, unknown>) => row.local_profile_id),
        ["p-b"],
      );

      // A uuid key with a non-uuid cursor is a client error.
      const badCursor = await owner(request({ table: "routines", cursor: { id: "abc" } }));
      assertEquals(badCursor.status, 400);

      // Every manifest table with DDL is selectable with its explicit columns.
      for (const entry of USER_DATA_MANIFEST) {
        const response = await owner(request({ table: entry.table }));
        assertEquals(response.status, 200, entry.table);
        const body = await response.json();
        if (!entry.mayBeAbsent) assertEquals(body.tableMissing, undefined, entry.table);
      }

      assertEquals((await owner(request({ table: "oauth_tokens" }))).status, 400);

      // Non-table sources: the real auth user and a real avatar upload.
      const realUser = await fixture.admin.auth.admin.getUserById(fixture.ownerId);
      assert(realUser.data.user);
      const account = await (await realHandler(
        fixture,
        fixture.ownerId,
        realUser.data.user as unknown as Record<string, unknown>,
      )(request({ table: "auth_account" }))).json();
      assertEquals(account.rows.length, 1);
      assertEquals(account.rows[0].id, fixture.ownerId);
      assertEquals(account.rows[0].email, realUser.data.user.email);
      assertEquals(account.rows[0].identity_providers, ["email"]);

      const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      for (const userId of [fixture.ownerId, fixture.otherId]) {
        const path = `${userId}/avatar.png`;
        const upload = await fixture.admin.storage.from("avatars").upload(path, png, {
          contentType: "image/png",
          upsert: true,
        });
        if (upload.error) throw new Error(`avatar upload failed: ${upload.error.message}`);
        avatarPaths.push(path);
      }
      const avatars = await (await owner(request({ table: "storage_avatars" }))).json();
      assertEquals(
        avatars.rows.map((row: Record<string, unknown>) => row.path),
        [`${fixture.ownerId}/avatar.png`],
      );
    } finally {
      if (avatarPaths.length > 0) {
        await fixture.admin.storage.from("avatars").remove(avatarPaths);
      }
      await destroyExportFixture(fixture);
    }
  },
});

Deno.test({
  name:
    "integration: composite keyset (provider, id) pages 2,500 rows through the real or() filter",
  ignore: localIntegrationEnvironment === null,
  fn: async () => {
    const fixture = await createExportFixture();
    try {
      // Two providers with quote/comma/paren/backslash characters so the
      // quoted row-value filter is parsed by real PostgREST.
      const providers = ['a"b,c', "z(x)\\y"];
      const ownerRows = Array.from({ length: 2500 }, (_, i) => ({
        id: crypto.randomUUID(),
        user_id: fixture.ownerId,
        provider: providers[i % 2],
        // Terminal: only one pending/processing row per user/provider (PR 52).
        status: "completed",
      }));
      await insertOrThrow(fixture.admin, "sync_queue", [
        ...ownerRows,
        ...Array.from({ length: 20 }, () => ({
          id: crypto.randomUUID(),
          user_id: fixture.otherId,
          provider: providers[0],
          status: "completed",
        })),
      ]);
      // Synthetic composite-keyed entry: no composite-keyed manifest table
      // (sync_tombstones, PR 16) has DDL on this branch.
      const entry: UserDataTable = {
        table: "sync_queue",
        ownership: { kind: "column", column: "user_id" },
        keyColumns: ["provider", "id"],
        columns: ["id", "user_id", "provider"],
        purge: "cascade",
      };
      const pages: Array<Record<string, unknown>[]> = [];
      let cursor: ExportCursor | null = null;
      for (let guard = 0; guard < 10; guard++) {
        const page = await readExportPage(fixture.admin, entry, fixture.ownerId, cursor);
        if (!page.ok) throw new Error(`page failed: ${JSON.stringify(page.error)}`);
        pages.push(page.rows);
        cursor = page.nextCursor;
        if (cursor === null) break;
      }
      assertEquals(pages.map((page) => page.length), [1000, 1000, 500]);
      const rows = pages.flat();
      assertEquals(
        new Set(rows.map((row) => row.id)),
        new Set(ownerRows.map((row) => row.id)),
      );
      assert(rows.every((row) => row.user_id === fixture.ownerId));
      for (let i = 1; i < rows.length; i++) {
        const prev = [rows[i - 1].provider as string, rows[i - 1].id as string];
        const cur = [rows[i].provider as string, rows[i].id as string];
        assert(
          prev[0] < cur[0] || (prev[0] === cur[0] && prev[1] < cur[1]),
          `row ${i} out of (provider, id) order`,
        );
      }
    } finally {
      await destroyExportFixture(fixture);
    }
  },
});
