import { assertEquals } from "jsr:@std/assert@1";
import { createLiftosaurSyncHandler } from "./index.ts";
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
  provider: "liftosaur",
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
    oauth_tokens: [{ user_id: USER_ID, provider: "liftosaur", api_key: "plain-api-key" }],
    user_integrations: [
      { user_id: USER_ID, provider: "liftosaur", status: "connected", last_sync_at: null },
    ],
    external_activities: [],
    sync_queue: syncQueue,
  };
}

/** GET /history: `count` records, 200 per page, cursor-paged. */
function fakeLiftosaur(count: number) {
  return (input: string | URL | Request): Promise<Response> => {
    const url = new URL(String(input));
    const cursor = Number(url.searchParams.get("cursor") ?? 0);
    const records = Array.from({ length: count }, (_, i) => ({
      id: i + 1,
      text: `2026-03-0${(i % 9) + 1}T10:00:00Z / program: "5/3/1" / duration: 3600s`,
    })).slice(cursor, cursor + 200);
    const nextCursor = cursor + records.length;
    return Promise.resolve(
      new Response(
        JSON.stringify({
          data: { records, hasMore: nextCursor < count, nextCursor },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
  };
}

function harness(db: FakeDb, recordCount: number, jwtUserId: string | null = null) {
  const handler = createLiftosaurSyncHandler({
    env: (key) =>
      ({
        SUPABASE_URL: "http://edge.test",
        SUPABASE_ANON_KEY: "anon",
        SUPABASE_SERVICE_ROLE_KEY: SERVICE_ROLE_KEY,
      } as Record<string, string>)[key],
    // deno-lint-ignore no-explicit-any
    createClient: () => fakeClient(db, jwtUserId) as any,
    fetch: fakeLiftosaur(recordCount) as typeof fetch,
    now: () => new Date(NOW),
  });
  return (body: Record<string, unknown>) =>
    handler(
      new Request("http://edge.test/functions/v1/liftosaur-sync", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: jwtUserId ? "Bearer user-jwt" : `Bearer ${SERVICE_ROLE_KEY}`,
        },
        body: JSON.stringify({ user_id: USER_ID, ...body }),
      }),
    );
}

/** Counts heartbeats (`started_at` with no status) on sync_queue. */
function countHeartbeats(db: FakeDb): { value: number } {
  const counter = { value: 0 };
  const from = db.from.bind(db);
  db.from = (table: string) => {
    const query = from(table);
    if (table === "sync_queue") {
      const update = query.update.bind(query);
      query.update = (patch: Row) => {
        if (patch.started_at && !patch.status) counter.value++;
        return update(patch);
      };
    }
    return query;
  };
  return counter;
}

Deno.test("liftosaur-sync: completing the dispatched task leaves the user's second pending task pending", async () => {
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
  // Previously every pending liftosaur row was marked completed here.
  assertEquals(second.status, "pending");
  assertEquals(second.completed_at, null);
  assertEquals(db.rows("external_activities").length, 3);
});

Deno.test("liftosaur-sync: the queue lease is renewed on entry, per page and per 100 records", async () => {
  const db = new FakeDb(tables([queueRow(QUEUE_ID, "initial", "processing", CLAIMED_AT)]));
  const heartbeats = countHeartbeats(db);

  // 250 records: 2 pages, so 1 entry + 2 page + 2 per-100-record heartbeats.
  const res = await harness(db, 250)({ sync_type: "initial", queue_id: QUEUE_ID });
  assertEquals(res.status, 200, await res.clone().text());
  assertEquals(heartbeats.value, 1 + 2 + 2);
  assertEquals(db.rows("external_activities").length, 250);
  const [row] = db.rows("sync_queue");
  assertEquals(row.status, "completed");
  assertEquals(row.started_at, new Date(NOW).toISOString());
});

Deno.test("liftosaur-sync: a run without queue_id holds no lease", async () => {
  const db = new FakeDb(tables([queueRow(QUEUE_ID, "initial", "processing", CLAIMED_AT)]));
  const heartbeats = countHeartbeats(db);

  const res = await harness(db, 2)({ sync_type: "initial" });
  assertEquals(res.status, 200, await res.clone().text());
  assertEquals(heartbeats.value, 0);
  assertEquals(db.rows("sync_queue")[0].status, "processing");
  assertEquals(db.rows("sync_queue")[0].started_at, CLAIMED_AT);
});

Deno.test("liftosaur-sync: a manual sync with no queue_id creates its row; a concurrent one gets 409", async () => {
  // With migration 20260920005200's `sync_queue_one_active` in force.
  const db = new FakeDb(tables([]), [syncQueueOneActiveIndex]);
  const call = harness(db, 2, USER_ID);
  const heartbeats = countHeartbeats(db);

  const [a, b] = await Promise.all([
    call({ sync_type: "manual" }),
    call({ sync_type: "manual" }),
  ]);

  assertEquals([a.status, b.status].sort(), [200, 409]);
  const conflict = a.status === 409 ? a : b;
  assertEquals((await conflict.json()).code, "sync_already_queued");
  assertEquals(db.rows("sync_queue").length, 1);
  const [created] = db.rows("sync_queue");
  assertEquals(created.provider, "liftosaur");
  assertEquals(created.status, "completed");
  // A browser-owned row is leased and heartbeats like a dispatched one.
  assertEquals(heartbeats.value > 0, true);
});

Deno.test("liftosaur-sync: a run that names another user's queue row completes nothing", async () => {
  const foreign = {
    ...queueRow(QUEUE_ID, "initial", "processing", CLAIMED_AT),
    user_id: "00000000-0000-4000-8000-000000000002",
  };
  const db = new FakeDb(tables([foreign]));

  const res = await harness(db, 1)({ sync_type: "initial", queue_id: QUEUE_ID });
  assertEquals(res.status, 200);
  assertEquals(db.rows("sync_queue")[0].status, "processing");
  assertEquals(db.rows("sync_queue")[0].started_at, CLAIMED_AT);
});
