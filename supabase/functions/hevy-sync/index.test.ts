import { assertEquals } from "jsr:@std/assert@1";
import { createHevySyncHandler } from "./index.ts";
import {
  FakeDb,
  fakeClient,
  type Row,
  syncQueueOneActiveIndex,
} from "../_shared/testing/fakeSupabase.ts";

const SERVICE_ROLE_KEY = "test-service-role-key";
const USER_ID = "00000000-0000-4000-8000-000000000001";
const QUEUE_ID = "00000000-0000-4000-8000-0000000000aa";
const OTHER_QUEUE_ID = "00000000-0000-4000-8000-0000000000bb";
const NOW = Date.parse("2026-09-19T12:00:00.000Z");
const CLAIMED_AT = new Date(NOW - 4 * 60 * 1000).toISOString();

const queueRow = (id: string, syncType: string, status: string, startedAt: string | null): Row => ({
  id,
  user_id: USER_ID,
  provider: "hevy",
  sync_type: syncType,
  status,
  created_at: "2026-09-18T00:00:00.000Z",
  started_at: startedAt,
  completed_at: null,
  error_message: null,
  retry_count: 0,
});

/**
 * save_sync_state_if_queue_owned (20260924150000): write the listed state
 * keys only while the queue row is still this run's processing claim.
 * A null queue id always saves.
 */
function installQueueOwnedStateSave(db: FakeDb): void {
  if (db.rpcHandlers.save_sync_state_if_queue_owned) return;
  const stateKeys = [
    "status",
    "error_message",
    "last_sync_at",
    "backfill_before",
    "backfill_after",
    "backfill_started_at",
  ] as const;
  db.rpcHandlers.save_sync_state_if_queue_owned = (args: Row) => {
    if (args.p_queue_id != null) {
      const owned = db.rows("sync_queue").some((row) =>
        row.id === args.p_queue_id &&
        row.user_id === args.p_user_id &&
        row.provider === args.p_provider &&
        row.status === "processing" &&
        (args.p_attempt == null || Number(row.retry_count ?? 0) === args.p_attempt)
      );
      if (!owned) return { data: false, error: null };
    }
    const patch = args.p_state;
    if (!patch || typeof patch !== "object") {
      return { data: null, error: { message: "state object required" } };
    }
    const state = patch as Row;
    for (const row of db.rows("user_integrations")) {
      if (row.user_id !== args.p_user_id || row.provider !== args.p_provider) continue;
      for (const key of stateKeys) {
        if (Object.hasOwn(state, key)) row[key] = state[key];
      }
    }
    return { data: true, error: null };
  };
}

/**
 * A database with migration 20260920005200's `sync_queue_one_active` in force,
 * so a duplicate sync is rejected here exactly as Postgres rejects it.
 */
function queueDb(syncQueue: Row[]): FakeDb {
  return new FakeDb(tables(syncQueue), [syncQueueOneActiveIndex]);
}

function tables(syncQueue: Row[]): Record<string, Row[]> {
  return {
    subscriptions: [
      {
        user_id: USER_ID,
        tier: "FLAME",
        status: "active",
        current_period_end: "2099-01-01T00:00:00.000Z",
      },
    ],
    oauth_tokens: [{ user_id: USER_ID, provider: "hevy", api_key: "plain-api-key" }],
    user_integrations: [
      { user_id: USER_ID, provider: "hevy", status: "connected", last_sync_at: null },
    ],
    external_activities: [],
    sync_queue: syncQueue,
  };
}

/** GET /v1/workouts backfill: `count` workouts, 10 per page. */
function fakeHevy(count: number) {
  return (input: string | URL | Request): Promise<Response> => {
    const url = new URL(String(input));
    const page = Number(url.searchParams.get("page") ?? 1);
    const pageSize = Number(url.searchParams.get("pageSize") ?? 10);
    const workouts = Array.from({ length: count }, (_, i) => ({
      id: `w${i}`,
      title: `Workout ${i}`,
      start_time: new Date(NOW - (i + 1) * 3_600_000).toISOString(),
      end_time: new Date(NOW - (i + 1) * 3_600_000 + 1_800_000).toISOString(),
    })).slice((page - 1) * pageSize, page * pageSize);
    return Promise.resolve(
      new Response(
        JSON.stringify({ page, page_count: Math.max(1, Math.ceil(count / pageSize)), workouts }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
  };
}

function harness(
  db: FakeDb,
  workoutCount: number,
  jwtUserId: string | null = null,
  fetchImpl?: typeof fetch,
) {
  installQueueOwnedStateSave(db);
  const now = () => new Date(NOW);
  const handler = createHevySyncHandler({
    env: (key) =>
      ({
        SUPABASE_URL: "http://edge.test",
        SUPABASE_ANON_KEY: "anon",
        SUPABASE_SERVICE_ROLE_KEY: SERVICE_ROLE_KEY,
      } as Record<string, string>)[key],
    // The rate-limit RPC double runs on the handler's clock, not the wall
    // clock, so window arithmetic is deterministic.
    // deno-lint-ignore no-explicit-any
    createClient: () => fakeClient(db, jwtUserId, now) as any,
    fetch: (fetchImpl ?? fakeHevy(workoutCount)) as typeof fetch,
    now,
  });
  return (body: Record<string, unknown>) =>
    handler(
      new Request("http://edge.test/functions/v1/hevy-sync", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: jwtUserId ? "Bearer user-jwt" : `Bearer ${SERVICE_ROLE_KEY}`,
        },
        body: JSON.stringify({ user_id: USER_ID, ...body }),
      }),
    );
}

Deno.test("hevy-sync: completing the dispatched task leaves the user's second pending task pending", async () => {
  const db = new FakeDb(
    tables([
      queueRow(QUEUE_ID, "initial", "processing", CLAIMED_AT),
      queueRow(OTHER_QUEUE_ID, "manual", "pending", null),
    ]),
  );
  const res = await harness(db, 3)({ sync_type: "initial", queue_id: QUEUE_ID });
  assertEquals(res.status, 200, await res.clone().text());

  const [first, second] = db.rows("sync_queue");
  assertEquals(first.status, "completed");
  assertEquals(typeof first.completed_at, "string");
  // Previously every pending hevy row was marked completed here.
  assertEquals(second.status, "pending");
  assertEquals(second.completed_at, null);
  assertEquals(db.rows("external_activities").length, 3);
  const save = db.rpcCalls.find((call) => call.name === "save_sync_state_if_queue_owned");
  assertEquals(save?.args.p_queue_id, QUEUE_ID);
  assertEquals(save?.args.p_attempt, 0);
  assertEquals(save?.args.p_provider, "hevy");
});

Deno.test("hevy-sync: the queue lease is renewed while a backfill runs", async () => {
  const db = new FakeDb(tables([queueRow(QUEUE_ID, "initial", "processing", CLAIMED_AT)]));
  let heartbeats = 0;
  const from = db.from.bind(db);
  db.from = (table: string) => {
    const query = from(table);
    if (table === "sync_queue") {
      const update = query.update.bind(query);
      query.update = (patch: Row) => {
        if (patch.started_at && !patch.status) heartbeats++;
        return update(patch);
      };
    }
    return query;
  };

  // 250 workouts at 10 per page: 1 entry + 25 page + 3 chunk heartbeats.
  const res = await harness(db, 250)({ sync_type: "initial", queue_id: QUEUE_ID });
  assertEquals(res.status, 200, await res.clone().text());
  assertEquals(heartbeats, 1 + 25 + 3);
  assertEquals(db.rows("external_activities").length, 250);
  assertEquals(db.rows("sync_queue")[0].status, "completed");
  // The lease landed on this row, at the injected clock (completion keeps it).
  assertEquals(db.rows("sync_queue")[0].started_at, new Date(NOW).toISOString());
});

Deno.test("hevy-sync: a JWT caller works on its own new row and cannot touch another user's", async () => {
  const OTHER_USER_ID = "00000000-0000-4000-8000-000000000002";
  const foreignRow: Row = {
    ...queueRow(QUEUE_ID, "manual", "pending", null),
    user_id: OTHER_USER_ID,
  };
  const db = queueDb([foreignRow]);
  // A kept `initial` of the JWT user's own (the other class): a browser
  // `manual` run neither leases nor completes it.
  db.rows("sync_queue").push(queueRow(OTHER_QUEUE_ID, "initial", "pending", null));

  // The JWT identity wins over body.user_id, and queue_id names a foreign row.
  const res = await harness(db, 2, USER_ID)({
    sync_type: "manual",
    user_id: OTHER_USER_ID,
    queue_id: QUEUE_ID,
  });
  assertEquals(res.status, 200, await res.clone().text());

  const [foreign, ownInitial, created] = db.rows("sync_queue");
  assertEquals(foreign.status, "pending");
  assertEquals(foreign.completed_at, null);
  assertEquals(ownInitial.status, "pending");
  assertEquals(ownInitial.completed_at, null);
  // Its own row, created for the JWT user and completed by id.
  assertEquals(created.user_id, USER_ID);
  assertEquals(created.sync_type, "manual");
  assertEquals(created.status, "completed");
  // The workouts were written for the JWT user, not for body.user_id.
  assertEquals(
    new Set(db.rows("external_activities").map((r) => r.user_id)),
    new Set([USER_ID]),
  );
});

Deno.test("hevy-sync: a manual sync with no queue_id creates its row; a concurrent one gets 409", async () => {
  const db = queueDb([]);
  const call = harness(db, 2, USER_ID);

  const [a, b] = await Promise.all([
    call({ sync_type: "manual" }),
    call({ sync_type: "manual" }),
  ]);

  assertEquals([a.status, b.status].sort(), [200, 409]);
  const conflict = a.status === 409 ? a : b;
  assertEquals((await conflict.json()).code, "sync_already_queued");
  // One row only, owned and completed by the winner.
  assertEquals(db.rows("sync_queue").length, 1);
  const [created] = db.rows("sync_queue");
  assertEquals(created.provider, "hevy");
  assertEquals(created.sync_type, "manual");
  assertEquals(created.status, "completed");
  assertEquals(created.created_at, new Date(NOW).toISOString());
});

Deno.test("hevy-sync: a browser run fails closed when its ownership row cannot be created", async () => {
  const db = queueDb([]);
  const from = db.from.bind(db);
  db.from = (table: string) => {
    const query = from(table);
    if (table === "sync_queue") {
      query.insert = () => ({
        select: () => ({
          maybeSingle: () => Promise.resolve({
            data: null,
            error: { code: "08006", message: "connection failure" },
          }),
        }),
      }) as never;
    }
    return query;
  };

  const res = await harness(db, 1, USER_ID)({ sync_type: "manual" });

  assertEquals(res.status, 503);
  assertEquals(await res.json(), {
    error: "Unable to start sync right now. Please retry.",
    code: "sync_queue_unavailable",
  });
  assertEquals(db.rows("external_activities"), []);
  assertEquals(db.rows("sync_queue"), []);
});

Deno.test("hevy-sync: saving an API key with no sync_type still takes a queue row", async () => {
  const db = queueDb([]);
  const res = await harness(db, 1, USER_ID)({ api_key: "new-key" });
  assertEquals(res.status, 200, await res.clone().text());

  const [created] = db.rows("sync_queue");
  // The connect call sends no sync_type: it is a manual, non-`initial` run, so
  // it never collides with an `initial` row queued elsewhere.
  assertEquals(created.sync_type, "manual");
  assertEquals(created.status, "completed");
});

Deno.test("hevy-sync: a failed browser run hands its own row back", async () => {
  const db = queueDb([]);
  // No stored API key and none supplied: the run 400s before fetching.
  db.tables.oauth_tokens = [];
  const res = await harness(db, 1, USER_ID)({ sync_type: "manual" });
  assertEquals(res.status, 400);

  const [created] = db.rows("sync_queue");
  assertEquals(created.status, "failed");
  assertEquals(created.error_message, "Sync run failed");
});

Deno.test("hevy-sync: a run that names another user's queue row completes nothing", async () => {
  const foreign = { ...queueRow(QUEUE_ID, "initial", "processing", CLAIMED_AT), user_id: "someone-else" };
  const db = new FakeDb(tables([foreign]));
  const before = { ...db.rows("user_integrations")[0] };
  const res = await harness(db, 1)({ sync_type: "initial", queue_id: QUEUE_ID });
  assertEquals(res.status, 409, await res.clone().text());
  assertEquals((await res.json()).code, "queue_not_owned");
  assertEquals(db.rows("user_integrations")[0], before);
  assertEquals(db.rows("sync_queue")[0].status, "processing");
  assertEquals(db.rows("sync_queue")[0].started_at, CLAIMED_AT);
  assertEquals(db.rows("sync_queue")[0].completed_at, null);
});

Deno.test("hevy-sync: a run that no longer owns its queue row writes no integration state and stops", async () => {
  const db = new FakeDb(tables([
    { ...queueRow(QUEUE_ID, "initial", "processing", CLAIMED_AT), retry_count: 1 },
  ]));
  const before = { ...db.rows("user_integrations")[0] };

  const res = await harness(db, 3)({
    sync_type: "initial",
    queue_id: QUEUE_ID,
    claim_generation: 0,
  });

  assertEquals(res.status, 409, await res.clone().text());
  assertEquals(await res.json(), {
    error: "Sync queue entry is no longer this run's",
    code: "queue_not_owned",
  });
  assertEquals(db.rows("user_integrations")[0], before);
  const [row] = db.rows("sync_queue");
  assertEquals(row.status, "processing");
  assertEquals(row.retry_count, 1);
  assertEquals(row.completed_at, null);
  const saves = db.rpcCalls.filter((call) => call.name === "save_sync_state_if_queue_owned");
  assertEquals(saves.length, 1);
  assertEquals(saves[0].args.p_queue_id, QUEUE_ID);
  assertEquals(saves[0].args.p_attempt, 0);
  assertEquals(saves[0].args.p_user_id, USER_ID);
});

Deno.test("hevy-sync: a cancelled queue row is not marked error after a provider auth failure", async () => {
  const db = new FakeDb(tables([queueRow(QUEUE_ID, "initial", "processing", CLAIMED_AT)]));
  const before = { ...db.rows("user_integrations")[0] };
  const res = await harness(db, 1, null, () => {
    // Disconnect cancelled the row while this run was still at Hevy.
    db.rows("sync_queue")[0].status = "cancelled";
    return Promise.resolve(new Response("nope", { status: 403 }));
  })({
    sync_type: "initial",
    queue_id: QUEUE_ID,
    claim_generation: 0,
  });

  assertEquals(res.status, 409, await res.clone().text());
  assertEquals((await res.json()).code, "queue_not_owned");
  assertEquals(db.rows("user_integrations")[0], before);
  assertEquals(db.rows("sync_queue")[0].status, "cancelled");
  assertEquals(db.rows("sync_queue")[0].completed_at, null);
});

Deno.test("hevy-sync: a dispatch with no queue row still writes integration state", async () => {
  const db = new FakeDb(tables([]));
  const res = await harness(db, 1)({ sync_type: "initial" });
  assertEquals(res.status, 200, await res.clone().text());

  const integration = db.rows("user_integrations")[0];
  assertEquals(integration.status, "connected");
  assertEquals(integration.last_sync_at, new Date(NOW).toISOString());
  assertEquals(integration.error_message, null);
  const save = db.rpcCalls.find((call) => call.name === "save_sync_state_if_queue_owned");
  assertEquals(save?.args.p_queue_id, null);
  assertEquals(save?.args.p_attempt, null);
  assertEquals(db.rows("sync_queue"), []);
});

Deno.test("hevy-sync: a browser sync is capped at 3 per 15 minutes", async () => {
  const db = new FakeDb(tables([]));
  const call = harness(db, 1, USER_ID);

  for (const attempt of [1, 2, 3]) {
    const res = await call({ sync_type: "manual" });
    assertEquals(res.status, 200, `attempt ${attempt}: ${await res.clone().text()}`);
  }
  // The key literal is per-provider: a wrong one would silently share or split
  // a bucket and stay invisible until someone read rate_limit_tracking.
  assertEquals(db.rows("rate_limit_tracking").length, 1);
  assertEquals(db.rows("rate_limit_tracking")[0].key, "hevy-sync");
  assertEquals(db.rows("rate_limit_tracking")[0].requests_this_window, 3);

  const limited = await call({ sync_type: "manual" });
  assertEquals(limited.status, 429);
  assertEquals(limited.headers.get("Retry-After"), "900");
});

Deno.test("hevy-sync: API-key saves spend only the credential budget, so a fourth key still saves (NF-27)", async () => {
  const db = new FakeDb(tables([]));
  const call = harness(db, 1, USER_ID);

  // Three saves (say, mistyped keys), then the corrected one: previously the
  // 3-per-15-minute sync bucket refused the fourth.
  for (const attempt of [1, 2, 3, 4]) {
    const res = await call({ api_key: `key-attempt-${attempt}` });
    assertEquals(res.status, 200, `attempt ${attempt}: ${await res.clone().text()}`);
  }
  assertEquals(
    db.rows("rate_limit_tracking").map((row) => [row.key, row.requests_this_window]),
    [["hevy-sync-connect", 4]],
  );

  // The credential bucket still bounds key churn (10 per 15 minutes).
  for (const attempt of [5, 6, 7, 8, 9, 10]) {
    const res = await call({ api_key: `key-attempt-${attempt}` });
    assertEquals(res.status, 200, `attempt ${attempt}: ${await res.clone().text()}`);
  }
  const limited = await call({ api_key: "one-too-many" });
  assertEquals(limited.status, 429);

  // Ordinary syncs keep their own full budget.
  const sync = await call({ sync_type: "manual" });
  assertEquals(sync.status, 200, await sync.clone().text());
  assertEquals(
    db.rows("rate_limit_tracking").map((row) => [row.key, row.requests_this_window]).sort(),
    [["hevy-sync", 1], ["hevy-sync-connect", 10]],
  );
});
