import { assertEquals } from "jsr:@std/assert@1";
import { createStravaSyncHandler } from "./index.ts";
import { FakeDb, fakeClient, type Row } from "../_shared/testing/fakeSupabase.ts";

const SERVICE_ROLE_KEY = "test-service-role-key";
const USER_ID = "00000000-0000-4000-8000-000000000001";
const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-09-19T12:00:00.000Z");
const at = (daysAgo: number) => new Date(NOW - daysAgo * DAY).toISOString();

interface StravaActivity {
  id: number;
  name: string;
  sport_type: string;
  start_date: string;
  elapsed_time: number;
}

const activity = (id: number, daysAgo: number): StravaActivity => ({
  id,
  name: `Run ${id}`,
  sport_type: "Run",
  start_date: at(daysAgo),
  elapsed_time: 1800,
});

/** Strava's /athlete/activities: `after` ascending, otherwise newest first. */
function fakeStrava(activities: StravaActivity[], calls: URLSearchParams[]) {
  return (input: string | URL | Request): Promise<Response> => {
    const url = new URL(String(input));
    calls.push(url.searchParams);
    const after = url.searchParams.get("after");
    const before = url.searchParams.get("before");
    const perPage = Number(url.searchParams.get("per_page") ?? 30);
    const page = Number(url.searchParams.get("page") ?? 1);
    let list = activities.filter((a) => {
      const t = Date.parse(a.start_date) / 1000;
      return (after === null || t > Number(after)) && (before === null || t < Number(before));
    });
    list = list.sort((a, b) =>
      after !== null
        ? Date.parse(a.start_date) - Date.parse(b.start_date)
        : Date.parse(b.start_date) - Date.parse(a.start_date)
    );
    const body = list.slice((page - 1) * perPage, page * perPage);
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
  };
}

function baseTables(lastSyncAt: string | null, stored: StravaActivity[]): Record<string, Row[]> {
  return {
    subscriptions: [
      {
        user_id: USER_ID,
        tier: "FLAME",
        status: "active",
        current_period_end: "2099-01-01T00:00:00.000Z",
      },
    ],
    oauth_tokens: [
      {
        user_id: USER_ID,
        provider: "strava",
        access_token: "plain-access-token",
        refresh_token: "plain-refresh-token",
        token_expires_at: "2099-01-01T00:00:00.000Z",
      },
    ],
    user_integrations: [
      { user_id: USER_ID, provider: "strava", status: "connected", last_sync_at: lastSyncAt },
    ],
    external_activities: stored.map((a) => ({
      user_id: USER_ID,
      provider: "strava",
      external_id: String(a.id),
      started_at: a.start_date,
    })),
    sync_queue: [],
    rate_limit_tracking: [],
  };
}

function harness(tables: Record<string, Row[]>, activities: StravaActivity[]) {
  const db = new FakeDb(tables);
  const stravaCalls: URLSearchParams[] = [];
  let clock = NOW;
  const handler = createStravaSyncHandler({
    env: (key) =>
      ({
        SUPABASE_URL: "http://edge.test",
        SUPABASE_ANON_KEY: "anon",
        SUPABASE_SERVICE_ROLE_KEY: SERVICE_ROLE_KEY,
      } as Record<string, string>)[key],
    // deno-lint-ignore no-explicit-any
    createClient: () => fakeClient(db) as any,
    fetch: fakeStrava(activities, stravaCalls) as typeof fetch,
    now: () => new Date(clock),
  });
  const run = async (syncType: string) => {
    clock += 60_000;
    const res = await handler(
      new Request("http://edge.test/functions/v1/strava-sync", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        },
        body: JSON.stringify({ user_id: USER_ID, sync_type: syncType }),
      }),
    );
    assertEquals(res.status, 200, await res.clone().text());
    return res;
  };
  const storedIds = () =>
    db.rows("external_activities").map((r) => r.external_id as string).sort();
  const watermark = () => db.rows("user_integrations")[0].last_sync_at as string | null;
  return { run, storedIds, watermark, stravaCalls };
}

// The user connected, never had their queued `initial` drained, and ran a
// manual sync at T0 (7 days ago) that stored A1/A2 and set last_sync_at=T0.
// A3..A5 happened since. The stale `initial` and a newer `incremental` are
// both dispatched now, in either order: nothing may be skipped.
const T0 = at(7);
const HISTORY = [activity(1, 10), activity(2, 8)];
const SINCE_T0 = [activity(3, 6), activity(4, 4), activity(5, 2)];
const ALL_IDS = ["1", "2", "3", "4", "5"];

for (const order of [["initial", "incremental"], ["incremental", "initial"]]) {
  Deno.test(`strava-sync: after a manual sync, stale initial + incremental (${order.join(" then ")}) leave no gap`, async () => {
    const h = harness(baseTables(T0, HISTORY), [...HISTORY, ...SINCE_T0]);
    for (const syncType of order) await h.run(syncType);
    assertEquals(h.storedIds(), ALL_IDS);
    // The watermark is where the incremental run started, never later.
    assertEquals(Date.parse(h.watermark()!) <= NOW + 2 * 60_000, true);
    assertEquals(Date.parse(h.watermark()!) > Date.parse(T0), true);
  });
}

Deno.test("strava-sync: an initial against an existing watermark never moves it", async () => {
  const h = harness(baseTables(T0, HISTORY), [...HISTORY, ...SINCE_T0]);
  await h.run("initial");
  assertEquals(h.watermark(), T0);
  // It only reached into the past (before the oldest stored activity).
  assertEquals(h.stravaCalls[0].has("before"), true);
  assertEquals(h.stravaCalls[0].has("after"), false);
  // The next incremental still fetches from T0.
  await h.run("incremental");
  assertEquals(h.stravaCalls[1].get("after"), String(Math.floor(Date.parse(T0) / 1000)));
  assertEquals(h.storedIds(), ALL_IDS);
});

Deno.test("strava-sync: a first backfill sets the watermark to the newest stored activity, not the clock", async () => {
  const h = harness(baseTables(null, []), [...HISTORY, ...SINCE_T0]);
  await h.run("initial");
  assertEquals(h.storedIds(), ALL_IDS);
  assertEquals(h.watermark(), at(2));
});

Deno.test("strava-sync: an incremental advances the watermark to its own start time", async () => {
  const h = harness(baseTables(T0, HISTORY), [...HISTORY, ...SINCE_T0]);
  await h.run("incremental");
  assertEquals(h.watermark(), new Date(NOW + 60_000).toISOString());
});

// ---------------------------------------------------------------------------
// Queue completion by queue_id, refresh failures, chunked upserts
// ---------------------------------------------------------------------------

const QUEUE_ID = "00000000-0000-4000-8000-0000000000aa";
const OTHER_QUEUE_ID = "00000000-0000-4000-8000-0000000000bb";
const CLAIMED_AT = new Date(NOW - 4 * 60 * 1000).toISOString();

const queueRow = (id: string, syncType: string, status: string, startedAt: string | null): Row => ({
  id,
  user_id: USER_ID,
  provider: "strava",
  sync_type: syncType,
  status,
  created_at: at(1),
  started_at: startedAt,
  completed_at: null,
  error_message: null,
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

/** Synchronous /athlete/activities router (`after` ascending, paged). */
function stravaActivitiesResponse(activities: StravaActivity[], url: URL): Response {
  const after = url.searchParams.get("after");
  const perPage = Number(url.searchParams.get("per_page") ?? 30);
  const page = Number(url.searchParams.get("page") ?? 1);
  const list = activities
    .filter((a) => after === null || Date.parse(a.start_date) / 1000 > Number(after))
    .sort((a, b) => Date.parse(a.start_date) - Date.parse(b.start_date));
  return json(list.slice((page - 1) * perPage, page * perPage));
}

/**
 * Service-role handler whose client records upsert batch sizes and lease
 * heartbeats, and whose fetch is routed per request.
 */
function queueHarness(tables: Record<string, Row[]>, route: (url: URL) => Response) {
  const db = new FakeDb(tables);
  const upserts: Array<{ table: string; rows: number }> = [];
  const heartbeats: string[] = [];
  const fetchUrls: string[] = [];
  const client = {
    ...fakeClient(db),
    from: (table: string) => {
      const query = db.from(table);
      const upsert = query.upsert.bind(query);
      query.upsert = (row: Row | Row[], opts?: { onConflict?: string }) => {
        upserts.push({ table, rows: Array.isArray(row) ? row.length : 1 });
        return upsert(row, opts);
      };
      const update = query.update.bind(query);
      query.update = (patch: Row) => {
        if (table === "sync_queue" && patch.started_at && !patch.status) {
          heartbeats.push(patch.started_at as string);
        }
        return update(patch);
      };
      return query;
    },
  };
  const handler = createStravaSyncHandler({
    env: (key) =>
      ({
        SUPABASE_URL: "http://edge.test",
        SUPABASE_ANON_KEY: "anon",
        SUPABASE_SERVICE_ROLE_KEY: SERVICE_ROLE_KEY,
        STRAVA_CLIENT_ID: "client-id",
        STRAVA_CLIENT_SECRET: "client-secret",
      } as Record<string, string>)[key],
    // deno-lint-ignore no-explicit-any
    createClient: () => client as any,
    fetch: ((input: string | URL | Request) => {
      const url = new URL(String(input));
      fetchUrls.push(url.toString());
      return Promise.resolve(route(url));
    }) as typeof fetch,
    now: () => new Date(NOW),
  });
  const call = (body: Record<string, unknown>) =>
    handler(
      new Request("http://edge.test/functions/v1/strava-sync", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        },
        body: JSON.stringify({ user_id: USER_ID, ...body }),
      }),
    );
  return { db, upserts, heartbeats, fetchUrls, call };
}

function expiredTokenTables(): Record<string, Row[]> {
  const tables = baseTables(T0, HISTORY);
  tables.oauth_tokens[0].token_expires_at = at(1);
  return tables;
}

Deno.test("strava-sync: completing a queued task leaves the user's second pending task pending", async () => {
  const tables = baseTables(T0, HISTORY);
  tables.sync_queue = [
    queueRow(QUEUE_ID, "incremental", "processing", CLAIMED_AT),
    queueRow(OTHER_QUEUE_ID, "incremental", "pending", null),
  ];
  const h = queueHarness(tables, (url) => stravaActivitiesResponse(SINCE_T0, url));

  const res = await h.call({ sync_type: "incremental", queue_id: QUEUE_ID });
  assertEquals(res.status, 200, await res.clone().text());

  const [first, second] = h.db.rows("sync_queue");
  assertEquals(first.status, "completed");
  assertEquals(typeof first.completed_at, "string");
  assertEquals(second.status, "pending");
  assertEquals(second.completed_at, null);
});

Deno.test("strava-sync: a refresh 401 marks the integration token_expired and fails without retry", async () => {
  const tables = expiredTokenTables();
  tables.sync_queue = [queueRow(QUEUE_ID, "incremental", "processing", CLAIMED_AT)];
  const h = queueHarness(tables, (url) =>
    url.pathname === "/oauth/token"
      ? json({ message: "Authorization Error" }, 401)
      : json([])
  );

  const res = await h.call({ sync_type: "incremental", queue_id: QUEUE_ID });
  // 401 is outside process-sync-queue's retryable statuses (429/502/503/504).
  assertEquals(res.status, 401);
  assertEquals((await res.json()).code, "token_expired");

  const integration = h.db.rows("user_integrations")[0];
  assertEquals(integration.status, "token_expired");
  assertEquals(typeof integration.error_message, "string");
  assertEquals(integration.last_sync_at, T0);
  // No activity request was made with the dead token, and the provider did
  // not complete the task (the processor records the failure).
  assertEquals(h.fetchUrls.filter((u) => u.includes("/athlete/activities")), []);
  assertEquals(h.db.rows("sync_queue")[0].status, "processing");
});

Deno.test("strava-sync: a refresh 400 (revoked refresh token) is also token_expired", async () => {
  const h = queueHarness(expiredTokenTables(), (url) =>
    url.pathname === "/oauth/token" ? json({ message: "Bad Request" }, 400) : json([])
  );
  const res = await h.call({ sync_type: "incremental" });
  assertEquals(res.status, 401);
  assertEquals(h.db.rows("user_integrations")[0].status, "token_expired");
});

Deno.test("strava-sync: a refresh 5xx returns retryable 502 and keeps the integration connected", async () => {
  const h = queueHarness(expiredTokenTables(), (url) =>
    url.pathname === "/oauth/token" ? new Response("upstream down", { status: 503 }) : json([])
  );
  const res = await h.call({ sync_type: "incremental" });
  assertEquals(res.status, 502);
  // Only the status reaches the caller, never Strava's response body.
  assertEquals(String((await res.json()).error).includes("upstream down"), false);
  const integration = h.db.rows("user_integrations")[0];
  assertEquals(integration.status, "connected");
  assertEquals(integration.last_sync_at, T0);
});

Deno.test("strava-sync: 250 activities are written in 3 upsert calls, heartbeating the queue lease", async () => {
  const many: StravaActivity[] = Array.from({ length: 250 }, (_, i) => ({
    ...activity(1000 + i, 6),
    start_date: new Date(Date.parse(T0) + (i + 1) * 60_000).toISOString(),
  }));
  const tables = baseTables(T0, HISTORY);
  tables.sync_queue = [queueRow(QUEUE_ID, "incremental", "processing", CLAIMED_AT)];
  const h = queueHarness(tables, (url) => stravaActivitiesResponse(many, url));

  const res = await h.call({ sync_type: "incremental", queue_id: QUEUE_ID });
  assertEquals(res.status, 200, await res.clone().text());
  assertEquals((await res.json()).synced_count, 250);

  const activityUpserts = h.upserts.filter((u) => u.table === "external_activities");
  assertEquals(activityUpserts.map((u) => u.rows), [100, 100, 50]);
  assertEquals(h.db.rows("external_activities").length, HISTORY.length + 250);
  // One heartbeat per chunk, each renewing the lease to "now".
  assertEquals(h.heartbeats, Array(3).fill(new Date(NOW).toISOString()));
  assertEquals(h.db.rows("sync_queue")[0].status, "completed");
});

Deno.test("strava-sync: a run without queue_id neither heartbeats nor completes a queue row", async () => {
  const tables = baseTables(T0, HISTORY);
  tables.sync_queue = [queueRow(QUEUE_ID, "initial", "processing", CLAIMED_AT)];
  const h = queueHarness(tables, (url) => stravaActivitiesResponse(SINCE_T0, url));
  const res = await h.call({ sync_type: "incremental" });
  assertEquals(res.status, 200);
  assertEquals(h.heartbeats, []);
  assertEquals(h.db.rows("sync_queue")[0].status, "processing");
  assertEquals(h.db.rows("sync_queue")[0].started_at, CLAIMED_AT);
});
