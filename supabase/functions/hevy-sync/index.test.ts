import { assertEquals } from "jsr:@std/assert@1";
import { createHevySyncHandler } from "./index.ts";
import { FakeDb, fakeClient, type Row } from "../_shared/testing/fakeSupabase.ts";

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
});

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

function harness(db: FakeDb, workoutCount: number, jwtUserId: string | null = null) {
  const handler = createHevySyncHandler({
    env: (key) =>
      ({
        SUPABASE_URL: "http://edge.test",
        SUPABASE_ANON_KEY: "anon",
        SUPABASE_SERVICE_ROLE_KEY: SERVICE_ROLE_KEY,
      } as Record<string, string>)[key],
    // deno-lint-ignore no-explicit-any
    createClient: () => fakeClient(db, jwtUserId) as any,
    fetch: fakeHevy(workoutCount) as typeof fetch,
    now: () => new Date(NOW),
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

Deno.test("hevy-sync: a JWT caller cannot touch another user's rows", async () => {
  const OTHER_USER_ID = "00000000-0000-4000-8000-000000000002";
  const foreignRow: Row = {
    ...queueRow(QUEUE_ID, "manual", "pending", null),
    user_id: OTHER_USER_ID,
  };
  const db = new FakeDb(tables([foreignRow]));
  // A live row of the JWT user's own, which a browser run must not lease.
  db.rows("sync_queue").push(queueRow(OTHER_QUEUE_ID, "manual", "processing", CLAIMED_AT));

  // The JWT identity wins over body.user_id, and queue_id names a foreign row.
  const res = await harness(db, 2, USER_ID)({
    sync_type: "manual",
    user_id: OTHER_USER_ID,
    queue_id: QUEUE_ID,
  });
  assertEquals(res.status, 200, await res.clone().text());

  const [foreign, own] = db.rows("sync_queue");
  assertEquals(foreign.status, "pending");
  assertEquals(foreign.completed_at, null);
  assertEquals(own.status, "processing");
  assertEquals(own.started_at, CLAIMED_AT);
  // The workouts were written for the JWT user, not for body.user_id.
  assertEquals(
    new Set(db.rows("external_activities").map((r) => r.user_id)),
    new Set([USER_ID]),
  );
});

Deno.test("hevy-sync: a run that names another user's queue row completes nothing", async () => {
  const foreign = { ...queueRow(QUEUE_ID, "initial", "processing", CLAIMED_AT), user_id: "someone-else" };
  const db = new FakeDb(tables([foreign]));
  const res = await harness(db, 1)({ sync_type: "initial", queue_id: QUEUE_ID });
  assertEquals(res.status, 200);
  assertEquals(db.rows("sync_queue")[0].status, "processing");
  assertEquals(db.rows("sync_queue")[0].started_at, CLAIMED_AT);
});
