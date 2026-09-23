import { assert, assertEquals } from "jsr:@std/assert@1";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { localIntegrationEnvironment } from "../_shared/localIntegrationEnvironment.ts";
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

/**
 * GET /history: `count` records dated one minute apart, NEWEST FIRST (the
 * documented order), honouring `endDate` (exclusive) and `startDate`, 200 per
 * page. `hasMoreWithoutCursor` makes the first page claim more with no cursor.
 */
function descendingLiftosaur(count: number, opts: { hasMoreWithoutCursor?: boolean } = {}) {
  const newest = Date.parse("2026-09-01T00:00:00.000Z");
  const all = Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    at: newest - i * 60_000,
  }));
  const requests: URL[] = [];
  const fake = (input: string | URL | Request): Promise<Response> => {
    const url = new URL(String(input));
    requests.push(url);
    const end = url.searchParams.get("endDate");
    const start = url.searchParams.get("startDate");
    const window = all.filter((r) =>
      (end === null || r.at < Date.parse(end)) &&
      (start === null || r.at >= Date.parse(start))
    );
    const cursor = Number(url.searchParams.get("cursor") ?? 0);
    const records = window.slice(cursor, cursor + 200).map((r) => ({
      id: r.id,
      text: `${new Date(r.at).toISOString()} / program: "5/3/1" / duration: 3600s`,
    }));
    const nextCursor = cursor + records.length;
    const hasMore = nextCursor < window.length;
    return Promise.resolve(
      new Response(
        JSON.stringify({
          data: {
            records,
            hasMore,
            nextCursor: opts.hasMoreWithoutCursor ? null : nextCursor,
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
  };
  return { fetch: fake, requests };
}

function harness(
  db: FakeDb,
  recordCount: number | ((input: string | URL | Request) => Promise<Response>),
  jwtUserId: string | null = null,
) {
  const now = () => new Date(NOW);
  const handler = createLiftosaurSyncHandler({
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
    fetch: (typeof recordCount === "number" ? fakeLiftosaur(recordCount) : recordCount) as typeof fetch,
    now,
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

/**
 * Make the `user_integrations` update whose patch carries `column` resolve
 * `{ error }`, the way supabase-js reports a failed write (it does not throw).
 */
function failIntegrationUpdate(db: FakeDb, column: string): void {
  const from = db.from.bind(db);
  db.from = (table: string) => {
    const query = from(table);
    if (table === "user_integrations") {
      const update = query.update.bind(query);
      query.update = (patch: Row) => {
        if (!(column in patch)) return update(patch);
        const failed = {
          eq: () => failed,
          then: (resolve: (value: unknown) => unknown) =>
            Promise.resolve({ data: null, error: { message: "write failed" } }).then(resolve),
        };
        // deno-lint-ignore no-explicit-any
        return failed as any;
      };
    }
    return query;
  };
}

Deno.test("liftosaur-sync: a 200 that is not a history page is a provider failure; nothing advances", async () => {
  const db = new FakeDb(tables([queueRow(QUEUE_ID, "incremental", "processing", CLAIMED_AT)]));
  const [before] = db.rows("user_integrations");
  const watermark = before.last_sync_at;
  const res = await harness(db, () =>
    Promise.resolve(
      new Response(JSON.stringify({ error: "temporarily unavailable" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ))({ sync_type: "incremental", queue_id: QUEUE_ID });
  assertEquals(res.status, 502);
  assertEquals((await res.json()).code, "provider_fetch_failed");
  const [integration] = db.rows("user_integrations");
  assertEquals(integration.last_sync_at, watermark, "the watermark must not move");
  assertEquals(integration.status, "error");
  assertEquals(db.rows("external_activities").length, 0);
  assertEquals(db.rows("sync_queue").map((r) => r.status), ["processing"]);
});

Deno.test("liftosaur-sync: a failed cursor save fails the run; the row stays processing and no follow-up is queued", async () => {
  const db = new FakeDb(
    tables([queueRow(QUEUE_ID, "initial", "processing", CLAIMED_AT)]),
    [syncQueueOneActiveIndex],
  );
  failIntegrationUpdate(db, "backfill_before");
  const res = await harness(db, descendingLiftosaur(4500).fetch)({ sync_type: "initial", queue_id: QUEUE_ID });
  assertEquals(res.status, 502, "retryable, so the processor re-queues the still-processing row");
  assertEquals((await res.json()).code, "cursor_save_failed");
  assertEquals(db.rows("sync_queue").map((r) => [r.sync_type, r.status]), [["initial", "processing"]]);
  const [integration] = db.rows("user_integrations");
  assertEquals(integration.last_sync_at, null);
  assertEquals(integration.status, "error");
});

Deno.test("liftosaur-sync: a failed watermark save fails the run and does not complete the row", async () => {
  const db = new FakeDb(tables([queueRow(QUEUE_ID, "incremental", "processing", CLAIMED_AT)]));
  const [before] = db.rows("user_integrations");
  const watermark = before.last_sync_at;
  failIntegrationUpdate(db, "last_sync_at");
  const res = await harness(db, 3)({ sync_type: "incremental", queue_id: QUEUE_ID });
  assertEquals(res.status, 502);
  assertEquals((await res.json()).code, "watermark_save_failed");
  assertEquals(db.rows("sync_queue").map((r) => r.status), ["processing"]);
  assertEquals(db.rows("user_integrations")[0].last_sync_at, watermark);
});

/** What process-sync-queue does before dispatching: claim the pending row. */
function claim(db: FakeDb, index: number, id: string): void {
  const row = db.rows("sync_queue")[index];
  assertEquals(row.status, "pending");
  row.id = id;
  row.status = "processing";
  row.started_at = CLAIMED_AT;
}

Deno.test("liftosaur-sync: a failed queue completion is retried, never reported as a queued follow-up", async () => {
  const db = new FakeDb(
    tables([queueRow(QUEUE_ID, "initial", "processing", CLAIMED_AT)]),
    [syncQueueOneActiveIndex],
  );
  const from = db.from.bind(db);
  db.from = (table: string) => {
    const query = from(table);
    if (table === "sync_queue") {
      const update = query.update.bind(query);
      query.update = (patch: Row) => {
        if (patch.status !== "completed") return update(patch);
        const failed = {
          eq: () => failed,
          select: () => failed,
          then: (resolve: (value: unknown) => unknown) =>
            Promise.resolve({ data: null, error: { message: "write failed" } }).then(resolve),
        };
        // deno-lint-ignore no-explicit-any
        return failed as any;
      };
    }
    return query;
  };
  const res = await harness(db, descendingLiftosaur(4500).fetch)({ sync_type: "initial", queue_id: QUEUE_ID });
  assertEquals(res.status, 502, await res.clone().text());
  assertEquals((await res.json()).code, "queue_complete_failed");
  assertEquals(db.rows("sync_queue").map((r) => r.status), ["processing"], "no follow-up, row still processing");
  assertEquals(typeof db.rows("user_integrations")[0].backfill_before, "string", "the cursor is saved for the retry");
});

Deno.test("liftosaur-sync: a run whose row a disconnect cancelled writes no final state", async () => {
  const db = new FakeDb(tables([queueRow(QUEUE_ID, "manual", "processing", CLAIMED_AT)]));
  const upstream = descendingLiftosaur(5);
  const fetchAndCancel = (input: string | URL | Request) => {
    const row = db.rows("sync_queue")[0];
    if (row) row.status = "cancelled";
    const integration = db.rows("user_integrations")[0];
    if (integration) integration.status = "disconnected";
    return upstream.fetch(input);
  };
  const res = await harness(db, fetchAndCancel)({ sync_type: "manual", queue_id: QUEUE_ID });
  assertEquals(res.status, 409, await res.clone().text());
  const [integration] = db.rows("user_integrations");
  assertEquals([integration.status, integration.last_sync_at], ["disconnected", null]);
});

Deno.test("liftosaur-sync: a failed follow-up insert reopens this run's row as the follow-up", async () => {
  const db = new FakeDb(
    tables([queueRow(QUEUE_ID, "initial", "processing", CLAIMED_AT)]),
    [syncQueueOneActiveIndex],
  );
  const from = db.from.bind(db);
  db.from = (table: string) => {
    const query = from(table);
    if (table === "sync_queue") {
      query.insert = () => {
        const failed = {
          then: (resolve: (value: unknown) => unknown) =>
            Promise.resolve({ data: null, error: { code: "57014", message: "canceling statement" } }).then(resolve),
        };
        // deno-lint-ignore no-explicit-any
        return failed as any;
      };
    }
    return query;
  };
  const res = await harness(db, descendingLiftosaur(4500).fetch)({ sync_type: "initial", queue_id: QUEUE_ID });
  assertEquals(res.status, 200, await res.clone().text());
  assertEquals((await res.json()).follow_up_queued, true);
  assertEquals(db.rows("sync_queue").map((r) => [r.id, r.status, r.sync_type]), [[QUEUE_ID, "pending", "incremental"]]);
});

Deno.test("liftosaur-sync: a history larger than one run is imported over resumable runs (#204)", async () => {
  // PR 52's unique index is in force: a follow-up must never collide with the
  // row that is still running.
  const db = new FakeDb(
    tables([queueRow(QUEUE_ID, "initial", "processing", CLAIMED_AT)]),
    [syncQueueOneActiveIndex],
  );
  const upstream = descendingLiftosaur(4500);
  const call = harness(db, upstream.fetch);

  // Run 1 (initial): ten pages, stored, cursor recorded, follow-up queued.
  const first = await call({ sync_type: "initial", queue_id: QUEUE_ID });
  assertEquals(first.status, 200, await first.clone().text());
  const firstBody = await first.json();
  assertEquals([firstBody.continuing, firstBody.truncated, firstBody.follow_up_queued], [true, true, true]);
  assertEquals(db.rows("external_activities").length, 2000);
  let [integration] = db.rows("user_integrations");
  assertEquals(integration.last_sync_at, null, "the watermark waits for the whole chain");
  assertEquals(integration.backfill_started_at, new Date(NOW).toISOString());
  assertEquals(integration.backfill_after, null, "an initial chain reads the full history");
  assertEquals(typeof integration.backfill_before, "string");
  let queue = db.rows("sync_queue");
  assertEquals(queue.map((r) => [r.sync_type, r.status]), [["initial", "completed"], ["incremental", "pending"]]);

  // Run 2 (the queued incremental follow-up): continues BELOW the cursor and
  // truncates again, so its own row must complete before the next follow-up.
  claim(db, 1, "second");
  const second = await call({ sync_type: "incremental", queue_id: "second" });
  assertEquals(second.status, 200, await second.clone().text());
  assertEquals((await second.json()).follow_up_queued, true);
  assertEquals(upstream.requests.at(-1)!.searchParams.has("endDate"), true);
  // The +1s boundary re-reads run 1's oldest record (idempotent), which uses
  // one of this run's 2,000 slots: 1,999 new rows.
  assertEquals(db.rows("external_activities").length, 3999);
  [integration] = db.rows("user_integrations");
  assertEquals(integration.last_sync_at, null);
  queue = db.rows("sync_queue");
  assertEquals(queue.map((r) => r.status), ["completed", "completed", "pending"]);

  // Run 3: the rest of the history; the chain ends and the watermark lands on
  // the chain's START, so nothing written during the chain is skipped.
  claim(db, 2, "third");
  const third = await call({ sync_type: "incremental", queue_id: "third" });
  assertEquals(third.status, 200, await third.clone().text());
  assertEquals((await third.json()).success, true);
  assertEquals(db.rows("external_activities").length, 4500);
  [integration] = db.rows("user_integrations");
  assertEquals(integration.last_sync_at, new Date(NOW).toISOString());
  assertEquals(
    [integration.backfill_before, integration.backfill_after, integration.backfill_started_at],
    [null, null, null],
  );
  assertEquals(db.rows("sync_queue").map((r) => r.status), ["completed", "completed", "completed"]);
});

Deno.test("liftosaur-sync: a truncated history with no clear date order stores what it read and fails without advancing", async () => {
  const db = new FakeDb(tables([queueRow(QUEUE_ID, "initial", "processing", CLAIMED_AT)]));
  const heartbeats = countHeartbeats(db);

  // Eleven pages whose dates cycle (no order), so no resume point is safe.
  const res = await harness(db, 2001)({ sync_type: "initial", queue_id: QUEUE_ID });
  assertEquals(res.status, 500);
  const body = await res.json();
  assertEquals([body.truncated, body.code, body.resume_at], [true, "history_cannot_resume", null]);
  assertEquals(heartbeats.value, 1 + 10 + 20);
  // Stored rows are idempotent; the watermark and the queue row stay put.
  assertEquals(db.rows("external_activities").length, 2000);
  const [queue] = db.rows("sync_queue");
  assertEquals(queue.status, "processing");
  const [integration] = db.rows("user_integrations");
  assertEquals(integration.last_sync_at, null);
  assertEquals(integration.status, "error");
});

Deno.test("liftosaur-sync: a page that claims more history without a cursor is reported, not mistaken for the end", async () => {
  const db = new FakeDb(tables([queueRow(QUEUE_ID, "manual", "processing", CLAIMED_AT)]));
  const upstream = descendingLiftosaur(300, { hasMoreWithoutCursor: true });

  const res = await harness(db, upstream.fetch)({ sync_type: "manual", queue_id: QUEUE_ID });
  // Newest-first, so the run can still continue downward from what it read.
  assertEquals(res.status, 200, await res.clone().text());
  const body = await res.json();
  assertEquals([body.truncated, body.reason, body.continuing], [true, "missing_cursor", true]);
  assertEquals(upstream.requests.length, 1, "page 1 is never re-requested");
  assertEquals(db.rows("user_integrations")[0].last_sync_at, null);
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
  assertEquals(res.status, 409, "not this run's row: no final state is written");
  assertEquals(db.rows("sync_queue")[0].status, "processing");
  assertEquals(db.rows("sync_queue")[0].started_at, CLAIMED_AT);
});

Deno.test("liftosaur-sync: a browser sync is capped at 3 per 15 minutes", async () => {
  const db = new FakeDb(tables([]));
  const call = harness(db, 1, USER_ID);

  for (const attempt of [1, 2, 3]) {
    const res = await call({ sync_type: "manual" });
    assertEquals(res.status, 200, `attempt ${attempt}: ${await res.clone().text()}`);
  }
  // The key literal is per-provider: a wrong one would silently share or split
  // a bucket and stay invisible until someone read rate_limit_tracking.
  assertEquals(db.rows("rate_limit_tracking").length, 1);
  assertEquals(db.rows("rate_limit_tracking")[0].key, "liftosaur-sync");
  assertEquals(db.rows("rate_limit_tracking")[0].requests_this_window, 3);

  const limited = await call({ sync_type: "manual" });
  assertEquals(limited.status, 429);
  assertEquals(limited.headers.get("Retry-After"), "900");
});

Deno.test("liftosaur-sync: a new API key starts a fresh full read, not the old key's backfill window", async () => {
  // Disconnected mid-backfill, then connected a different account: the stale
  // cursor and watermark belong to the old account.
  const db = new FakeDb({
    ...tables([]),
    user_integrations: [{
      user_id: USER_ID,
      provider: "liftosaur",
      status: "connected",
      last_sync_at: "2025-06-01T00:00:00.000Z",
      backfill_before: "2025-01-01T00:00:00.000Z",
      backfill_after: null,
      backfill_started_at: "2025-01-01T00:00:00.000Z",
    }],
  });
  const upstream = descendingLiftosaur(5);
  const call = harness(db, upstream.fetch, USER_ID);

  const res = await call({ api_key: "new-account-key" });
  assertEquals(res.status, 200, await res.clone().text());
  // Its own queue row is initial too, so a process-sync-queue retry of it
  // (which sends the row's sync_type and no key) is still a full read.
  assertEquals(db.rows("sync_queue").map((r) => r.sync_type), ["initial"]);
  assertEquals(upstream.requests[0].searchParams.has("endDate"), false);
  assertEquals(upstream.requests[0].searchParams.has("startDate"), false);
  assertEquals(db.rows("external_activities").length, 5);
  const [integration] = db.rows("user_integrations");
  assertEquals(
    [integration.backfill_before, integration.backfill_after, integration.backfill_started_at],
    [null, null, null],
  );
  assertEquals(integration.last_sync_at, new Date(NOW).toISOString());
});

Deno.test("liftosaur-sync: a new key clears the old cursor even when its first fetch fails", async () => {
  const db = new FakeDb({
    ...tables([]),
    user_integrations: [{
      user_id: USER_ID, provider: "liftosaur", status: "connected",
      last_sync_at: "2025-06-01T00:00:00.000Z",
      backfill_before: "2025-01-01T00:00:00.000Z", backfill_after: null,
      backfill_started_at: "2025-01-01T00:00:00.000Z",
    }],
  });
  const down = () => Promise.resolve(new Response("unavailable", { status: 503 }));
  const res = await harness(db, down, USER_ID)({ api_key: "new-account-key" });
  assert(res.status >= 500, await res.clone().text());
  const [integration] = db.rows("user_integrations");
  assertEquals(
    [integration.last_sync_at, integration.backfill_before, integration.backfill_after, integration.backfill_started_at],
    [null, null, null, null],
  );
});

Deno.test("liftosaur-sync: a new key whose state reset fails is not read against the old cursor", async () => {
  const db = new FakeDb({
    ...tables([]),
    user_integrations: [{
      user_id: USER_ID, provider: "liftosaur", status: "connected",
      last_sync_at: "2025-06-01T00:00:00.000Z",
      backfill_before: "2025-01-01T00:00:00.000Z", backfill_after: null,
      backfill_started_at: "2025-01-01T00:00:00.000Z",
    }],
  });
  const from = db.from.bind(db);
  db.from = (table: string) => {
    const query = from(table);
    if (table === "user_integrations") {
      query.update = () => {
        const failed = {
          eq: () => failed,
          then: (resolve: (value: unknown) => unknown) =>
            Promise.resolve({ data: null, error: { message: "write failed" } }).then(resolve),
        };
        // deno-lint-ignore no-explicit-any
        return failed as any;
      };
    }
    return query;
  };
  const upstream = descendingLiftosaur(5);
  const res = await harness(db, upstream.fetch, USER_ID)({ api_key: "new-account-key" });
  assertEquals(res.status, 502, await res.clone().text());
  assertEquals(upstream.requests.length, 0, "no provider read");
  assertEquals(db.rows("oauth_tokens")[0].api_key, "plain-api-key", "the old key is kept");
});

Deno.test("liftosaur-sync: a queue row no longer processing is not completed and nothing follows", async () => {
  // A disconnect cancelled the row while this run was reading.
  const db = new FakeDb(
    tables([queueRow(QUEUE_ID, "initial", "processing", CLAIMED_AT)]),
    [syncQueueOneActiveIndex],
  );
  const upstream = descendingLiftosaur(4500);
  const fetchAndCancel = (input: string | URL | Request) => {
    const row = db.rows("sync_queue")[0];
    if (row) row.status = "cancelled";
    return upstream.fetch(input);
  };
  const res = await harness(db, fetchAndCancel)({ sync_type: "initial", queue_id: QUEUE_ID });
  assertEquals(res.status, 502, await res.clone().text());
  assertEquals(db.rows("sync_queue").map((r) => r.status), ["cancelled"], "no follow-up queued");
});

Deno.test("liftosaur-sync: API-key saves spend only the credential budget, so a fourth key still saves (NF-27)", async () => {
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
    [["liftosaur-sync-connect", 4]],
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
    [["liftosaur-sync", 1], ["liftosaur-sync-connect", 10]],
  );
});

// ---------------------------------------------------------------------------
// Watermark suite: incremental windows, stable undated-record dates, and the
// pre-fetch watermark. In-process Supabase double + a fake Liftosaur API whose
// startDate filters on workout date. No real provider calls.
// ---------------------------------------------------------------------------

const SYNC_USER_ID = "00000000-0000-4000-8000-0000000000b1";
const HOUR = 60 * 60 * 1000;

interface DbState {
  lastSyncAt: string | null;
  activities: Array<Record<string, unknown>>;
}

function createDbDouble(state: DbState) {
  const from = (table: string) => {
    let pendingUpdate: Record<string, unknown> | null = null;
    let inFilter: unknown[] | null = null;

    const resolve = () => {
      if (table === "subscriptions") {
        return {
          data: {
            tier: "FLAME",
            status: "active",
            current_period_end: "2099-01-01T00:00:00.000Z",
          },
          error: null,
        };
      }
      if (table === "oauth_tokens") {
        return { data: { api_key: "liftosaur-key" }, error: null };
      }
      if (table === "user_integrations") {
        if (pendingUpdate) {
          if ("last_sync_at" in pendingUpdate) {
            state.lastSyncAt = pendingUpdate.last_sync_at as string;
          }
          return { data: null, error: null };
        }
        return { data: { last_sync_at: state.lastSyncAt }, error: null };
      }
      if (table === "external_activities" && inFilter) {
        const ids = inFilter;
        return {
          data: state.activities
            .filter((row) => ids.includes(row.external_id))
            .map((row) => ({ external_id: row.external_id })),
          error: null,
        };
      }
      return { data: null, error: null };
    };

    const builder: Record<string, unknown> = {};
    for (const method of ["select", "eq", "order", "limit"]) {
      builder[method] = () => builder;
    }
    builder.in = (_column: string, values: unknown[]) => {
      inFilter = values;
      return builder;
    };
    builder.update = (values: Record<string, unknown>) => {
      pendingUpdate = values;
      return builder;
    };
    builder.upsert = (
      row: Record<string, unknown>,
      options?: { ignoreDuplicates?: boolean },
    ) => {
      if (table === "external_activities") {
        const index = state.activities.findIndex((existing) =>
          existing.external_id === row.external_id
        );
        // ON CONFLICT DO UPDATE only sets the columns that were sent;
        // ON CONFLICT DO NOTHING (ignoreDuplicates) leaves the row alone.
        if (index >= 0) {
          if (!options?.ignoreDuplicates) {
            state.activities[index] = { ...state.activities[index], ...row };
          }
        } else {
          if (!("started_at" in row)) {
            return Promise.resolve({
              data: null,
              error: { message: "null value in column started_at" },
            });
          }
          state.activities.push(row);
        }
      }
      return Promise.resolve({ data: null, error: null });
    };
    builder.single = () => Promise.resolve(resolve());
    builder.maybeSingle = () => Promise.resolve(resolve());
    builder.then = (
      onFulfilled?: (value: unknown) => unknown,
      onRejected?: (reason: unknown) => unknown,
    ) => Promise.resolve(resolve()).then(onFulfilled, onRejected);
    return builder;
  };
  return { from };
}

interface UpstreamRecord {
  id: number;
  /** Omitted for a record whose Liftoscript text has no timestamp. */
  date?: string;
}

const FAKE_RESPONSE_DELAY_MS = 5;

function installFakeLiftosaur(upstream: UpstreamRecord[]) {
  const originalFetch = globalThis.fetch;
  const fake = {
    requests: [] as URL[],
    firstRequestAt: null as number | null,
    restore: () => {
      globalThis.fetch = originalFetch;
    },
  };
  globalThis.fetch = ((input: string | URL | Request) => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
    );
    if (url.hostname !== "www.liftosaur.com" || url.pathname !== "/api/v1/history") {
      throw new Error(`Unexpected fetch in test: ${url.href}`);
    }
    fake.requests.push(url);
    fake.firstRequestAt ??= Date.now();
    const startDate = url.searchParams.get("startDate");
    const records = upstream
      .filter((record) =>
        startDate === null || record.date === undefined ||
        Date.parse(record.date) >= Date.parse(startDate)
      )
      .map((record) => ({
        id: record.id,
        text: `${record.date ? `${record.date} / ` : ""}program: "Test" / dayName: "Day ${record.id}" / duration: 3600s`,
      }));
    const response = new Response(
      JSON.stringify({ data: { records, hasMore: false, nextCursor: null } }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
    // A small delay so "before the fetch" and "after the fetch" are
    // distinguishable timestamps.
    return new Promise<Response>((resolve) =>
      setTimeout(() => resolve(response), FAKE_RESPONSE_DELAY_MS)
    );
  }) as typeof fetch;
  return fake;
}

async function runSync(state: DbState, syncType: string): Promise<Response> {
  const previousKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", SERVICE_ROLE_KEY);
  try {
    const db = createDbDouble(state);
    const handler = createLiftosaurSyncHandler({
      createAuthClient: () => ({
        auth: { getUser: () => Promise.resolve({ data: { user: null } }) },
      }),
      // deno-lint-ignore no-explicit-any
      createAdminClient: () => db as any,
    });
    return await handler(
      new Request("http://localhost/functions/v1/liftosaur-sync", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ user_id: SYNC_USER_ID, sync_type: syncType }),
      }),
    );
  } finally {
    if (previousKey === undefined) Deno.env.delete("SUPABASE_SERVICE_ROLE_KEY");
    else Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", previousKey);
  }
}

Deno.test("liftosaur-sync imports a workout logged late with a date before the last sync", async () => {
  const now = Date.now();
  const lastSync = new Date(now - 6 * HOUR).toISOString();
  const state: DbState = { lastSyncAt: lastSync, activities: [] };
  // Performed three hours before the last sync, but logged only after it.
  const lateWorkout = {
    id: 7,
    date: new Date(now - 9 * HOUR).toISOString().replace(/\.\d{3}Z$/, "Z"),
  };
  const liftosaur = installFakeLiftosaur([lateWorkout]);
  try {
    const response = await runSync(state, "incremental");
    assertEquals(response.status, 200, await response.clone().text());
    assertEquals(
      state.activities.map((row) => row.external_id),
      ["liftosaur-7"],
    );
    assertEquals(
      liftosaur.requests[0].searchParams.get("startDate"),
      new Date(Date.parse(lastSync) - 72 * HOUR).toISOString(),
    );
  } finally {
    liftosaur.restore();
  }
});

Deno.test("liftosaur-sync captures the new watermark before fetching", async () => {
  const state: DbState = {
    lastSyncAt: new Date(Date.now() - 6 * HOUR).toISOString(),
    activities: [],
  };
  const liftosaur = installFakeLiftosaur([]);
  try {
    const response = await runSync(state, "incremental");
    assertEquals(response.status, 200, await response.clone().text());
    assert(liftosaur.firstRequestAt !== null);
    assert(
      Date.parse(state.lastSyncAt!) < liftosaur.firstRequestAt! + FAKE_RESPONSE_DELAY_MS,
      `last_sync_at ${state.lastSyncAt} must not be later than the first fetch`,
    );
  } finally {
    liftosaur.restore();
  }
});

Deno.test("liftosaur-sync initial sync requests full history", async () => {
  const state: DbState = {
    lastSyncAt: new Date(Date.now() - 6 * HOUR).toISOString(),
    activities: [],
  };
  const liftosaur = installFakeLiftosaur([]);
  try {
    const response = await runSync(state, "initial");
    assertEquals(response.status, 200, await response.clone().text());
    assertEquals(liftosaur.requests[0].searchParams.has("startDate"), false);
  } finally {
    liftosaur.restore();
  }
});

Deno.test("liftosaur-sync keeps the stored date of an undated record re-fetched in the overlap", async () => {
  const state: DbState = {
    lastSyncAt: new Date(Date.now() - 6 * HOUR).toISOString(),
    activities: [],
  };
  const liftosaur = installFakeLiftosaur([{ id: 8 }]);
  try {
    const first = await runSync(state, "incremental");
    assertEquals(first.status, 200, await first.clone().text());
    const firstStartedAt = state.activities[0].started_at;
    assert(typeof firstStartedAt === "string");

    // Let the clock move so a re-stamp would be observable.
    await new Promise((resolve) => setTimeout(resolve, 10));
    const second = await runSync(state, "incremental");
    assertEquals(second.status, 200, await second.clone().text());
    assertEquals(state.activities.length, 1);
    assertEquals(state.activities[0].started_at, firstStartedAt);
  } finally {
    liftosaur.restore();
  }
});

// ---------------------------------------------------------------------------
// Real SQL (#204): the backfill_* cursor round-trips through the migrated
// schema and PostgREST, and the queued follow-up passes sync_queue_one_active
// and the client-insert guard. Only Liftosaur itself is faked.
// ---------------------------------------------------------------------------

Deno.test({
  name: "integration: a Liftosaur backfill persists its cursor, queues a follow-up and completes on the next run",
  ignore: localIntegrationEnvironment === null,
  fn: async () => {
    assert(localIntegrationEnvironment);
    const env = localIntegrationEnvironment;
    const admin = createClient(env.url, env.serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const created = await admin.auth.admin.createUser({
      email: `c6-liftosaur-${crypto.randomUUID()}@example.invalid`,
      email_confirm: true,
    });
    if (created.error || !created.data.user) throw new Error("fixture user creation failed");
    const userId = created.data.user.id;
    const must = async (label: string, op: PromiseLike<{ error: unknown }>) => {
      const { error } = await op;
      if (error) throw new Error(`${label} failed: ${JSON.stringify(error)}`);
    };
    try {
      await must("subscription", admin.from("subscriptions").insert({
        user_id: userId, tier: "FLAME", status: "active", current_period_end: "2099-01-01T00:00:00Z",
      }));
      await must("api key", admin.from("oauth_tokens").insert({
        user_id: userId, provider: "liftosaur", api_key: "plain-api-key",
      }));
      await must("integration", admin.from("user_integrations").insert({
        user_id: userId, provider: "liftosaur", status: "connected",
      }));

      const upstream = descendingLiftosaur(2300);
      const handler = createLiftosaurSyncHandler({
        env: (key) =>
          ({
            SUPABASE_URL: env.url,
            SUPABASE_ANON_KEY: env.anonKey,
            SUPABASE_SERVICE_ROLE_KEY: env.serviceRoleKey,
          } as Record<string, string>)[key],
        fetch: upstream.fetch as typeof fetch,
      });
      const run = (syncType: string) =>
        handler(new Request("http://edge.test/functions/v1/liftosaur-sync", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.serviceRoleKey}` },
          body: JSON.stringify({ user_id: userId, sync_type: syncType }),
        }));
      const integration = async () => {
        const { data, error } = await admin.from("user_integrations")
          .select("last_sync_at, backfill_before, backfill_after, backfill_started_at")
          .eq("user_id", userId).eq("provider", "liftosaur").single();
        if (error) throw new Error(`integration read failed: ${error.message}`);
        return data as Record<string, string | null>;
      };

      const first = await run("initial");
      assertEquals(first.status, 200, await first.clone().text());
      assertEquals((await first.json()).follow_up_queued, true);
      let state = await integration();
      assertEquals(state.last_sync_at, null, "the watermark waits for the whole chain");
      assert(state.backfill_before !== null && state.backfill_started_at !== null);
      const queued = await admin.from("sync_queue").select("sync_type, status")
        .eq("user_id", userId).eq("provider", "liftosaur");
      assertEquals(queued.data, [{ sync_type: "incremental", status: "pending" }]);

      const second = await run("incremental");
      assertEquals(second.status, 200, await second.clone().text());
      state = await integration();
      assertEquals(
        [state.backfill_before, state.backfill_after, state.backfill_started_at],
        [null, null, null],
      );
      assert(state.last_sync_at !== null, "the completed chain sets the watermark");
      const stored = await admin.from("external_activities")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId).eq("provider", "liftosaur");
      assertEquals(stored.count, 2300);
    } finally {
      for (const table of ["external_activities", "sync_queue", "user_integrations", "oauth_tokens", "subscriptions"]) {
        await admin.from(table).delete().eq("user_id", userId);
      }
      await admin.auth.admin.deleteUser(userId);
    }
  },
});
