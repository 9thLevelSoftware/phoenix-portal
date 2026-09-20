import { assertEquals } from "jsr:@std/assert@1";
import { createStravaSyncHandler } from "./index.ts";
import {
  FakeDb,
  fakeClient,
  type Row,
  syncQueueOneActiveIndex,
} from "../_shared/testing/fakeSupabase.ts";

const SERVICE_ROLE_KEY = "test-service-role-key";
const USER_ID = "00000000-0000-4000-8000-000000000001";
const OTHER_USER_ID = "00000000-0000-4000-8000-000000000002";
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

interface QueueHarnessOptions {
  /** Drive the browser (JWT) path as this user instead of the service role. */
  jwtUserId?: string;
  /** Share one database between two harnesses (concurrency tests). */
  db?: FakeDb;
  /** 0-based index of an external_activities chunk whose upsert must fail. */
  failChunk?: number;
  /** Environment overrides (e.g. a missing STRAVA_CLIENT_SECRET). */
  env?: Record<string, string>;
}

/**
 * Handler whose client records upsert batch sizes and lease heartbeats, and
 * whose fetch is routed per request.
 *
 * The external_activities upsert double rejects a batch that repeats a
 * conflict key, the way Postgres does ("ON CONFLICT DO UPDATE command cannot
 * affect row a second time").
 */
function queueHarness(
  tables: Record<string, Row[]>,
  route: (url: URL) => Response,
  options: QueueHarnessOptions = {},
) {
  // With migration 20260920005200's `sync_queue_one_active` in force, so a
  // duplicate browser sync is rejected here exactly as Postgres rejects it.
  const db = options.db ?? new FakeDb(tables, [syncQueueOneActiveIndex]);
  const upserts: Array<{ table: string; rows: number }> = [];
  const heartbeats: string[] = [];
  const fetchUrls: string[] = [];
  let activityChunk = 0;
  const client = {
    ...fakeClient(db, options.jwtUserId ?? null),
    from: (table: string) => {
      const query = db.from(table);
      const upsert = query.upsert.bind(query);
      query.upsert = (row: Row | Row[], opts?: { onConflict?: string }) => {
        const rows = Array.isArray(row) ? row : [row];
        upserts.push({ table, rows: rows.length });
        if (table === "external_activities") {
          const failThisChunk = activityChunk++ === options.failChunk;
          const keys = rows.map((r) => `${r.user_id}/${r.provider}/${r.external_id}`);
          const repeated = keys.length !== new Set(keys).size;
          if (failThisChunk || repeated) {
            const message = repeated
              ? "ON CONFLICT DO UPDATE command cannot affect row a second time"
              : "upsert failed";
            const rejection = {
              then: (resolve: (v: unknown) => unknown) =>
                Promise.resolve(resolve({ data: null, error: { message } })),
            };
            // deno-lint-ignore no-explicit-any
            return rejection as any;
          }
        }
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
        ...(options.env ?? {}),
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
          Authorization: options.jwtUserId
            ? "Bearer user-jwt"
            : `Bearer ${SERVICE_ROLE_KEY}`,
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

/** Strava's error body for a revoked/invalid refresh token. */
const REVOKED_GRANT_BODY = {
  message: "Bad Request",
  errors: [{ resource: "RefreshToken", field: "refresh_token", code: "invalid" }],
};
/** Strava's error body for a wrong client_id / client_secret. */
const BAD_CLIENT_BODY = {
  message: "Bad Request",
  errors: [{ resource: "Application", field: "client_secret", code: "invalid" }],
};

const tokenRoute = (response: () => Response) => (url: URL) =>
  url.pathname === "/oauth/token" ? response() : json([]);

const integrationOf = (h: { db: FakeDb }) => h.db.rows("user_integrations")[0];

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
  assertEquals(second.started_at, null);
});

Deno.test("strava-sync: a refresh that names the refresh token marks the integration token_expired", async () => {
  for (const status of [400, 401]) {
    const tables = expiredTokenTables();
    tables.sync_queue = [queueRow(QUEUE_ID, "incremental", "processing", CLAIMED_AT)];
    const h = queueHarness(tables, tokenRoute(() => json(REVOKED_GRANT_BODY, status)));

    const res = await h.call({ sync_type: "incremental", queue_id: QUEUE_ID });
    // 401 is outside process-sync-queue's retryable statuses (429/502/503/504).
    assertEquals(res.status, 401, String(status));
    assertEquals((await res.json()).code, "token_expired");

    assertEquals(integrationOf(h).status, "token_expired");
    assertEquals(typeof integrationOf(h).error_message, "string");
    assertEquals(integrationOf(h).last_sync_at, T0);
    // No activity request was made with the dead token, and the provider did
    // not complete the task (the processor records the failure).
    assertEquals(h.fetchUrls.filter((u) => u.includes("/athlete/activities")), []);
    assertEquals(h.db.rows("sync_queue")[0].status, "processing");
  }
});

Deno.test("strava-sync: a 400/401 naming the Application (wrong client secret) keeps every user connected", async () => {
  for (const status of [400, 401]) {
    const h = queueHarness(expiredTokenTables(), tokenRoute(() => json(BAD_CLIENT_BODY, status)));
    const res = await h.call({ sync_type: "incremental" });
    // Retryable: correcting the secret then fixes everyone, with no reconnects.
    assertEquals(res.status, 502, String(status));
    assertEquals((await res.json()).code, "refresh_failed");
    assertEquals(integrationOf(h).status, "connected");
    assertEquals(integrationOf(h).error_message, "Strava token refresh failed; will retry");
  }
});

Deno.test("strava-sync: an unrecognised or unparseable refresh error body is retryable, not a disconnect", async () => {
  const bodies: Array<[string, () => Response]> = [
    ["no errors array", () => json({ message: "Bad Request" }, 400)],
    ["unknown resource", () =>
      json({ errors: [{ resource: "Athlete", field: "id", code: "invalid" }] }, 400)],
    ["not JSON", () => new Response("<html>nope</html>", { status: 400 })],
  ];
  for (const [label, response] of bodies) {
    const h = queueHarness(expiredTokenTables(), tokenRoute(response));
    const res = await h.call({ sync_type: "incremental" });
    assertEquals(res.status, 502, label);
    assertEquals(integrationOf(h).status, "connected", label);
  }
});

Deno.test("strava-sync: a refresh 429, 5xx or network error is retryable and keeps the integration connected", async () => {
  const cases: Array<[string, () => Response]> = [
    ["429", () => new Response("rate limited", { status: 429 })],
    ["503", () => new Response("upstream down", { status: 503 })],
  ];
  for (const [label, response] of cases) {
    const h = queueHarness(expiredTokenTables(), tokenRoute(response));
    const res = await h.call({ sync_type: "incremental" });
    assertEquals(res.status, 502, label);
    const body = await res.json();
    // Only a fixed message reaches the caller, never Strava's response body.
    assertEquals(body.error, "Strava token refresh failed", label);
    assertEquals(String(body.error).includes("upstream down"), false, label);
    assertEquals(integrationOf(h).status, "connected", label);
    assertEquals(integrationOf(h).error_message, "Strava token refresh failed; will retry", label);
    assertEquals(integrationOf(h).last_sync_at, T0, label);
  }

  // A fetch that throws (DNS failure, aborted request) is the same class.
  const thrown = queueHarness(expiredTokenTables(), () => {
    throw new TypeError("error sending request to https://www.strava.com/oauth/token");
  });
  const res = await thrown.call({ sync_type: "incremental" });
  assertEquals(res.status, 502);
  assertEquals((await res.json()).error, "Strava token refresh failed");
  assertEquals(integrationOf(thrown).status, "connected");
});

Deno.test("strava-sync: a missing client secret never disconnects the user and never calls Strava", async () => {
  const h = queueHarness(
    expiredTokenTables(),
    tokenRoute(() => json(REVOKED_GRANT_BODY, 400)),
    { env: { STRAVA_CLIENT_SECRET: "" } },
  );
  const res = await h.call({ sync_type: "incremental" });
  assertEquals(res.status, 502);
  assertEquals(integrationOf(h).status, "connected");
  assertEquals(h.fetchUrls, []);
});

Deno.test("strava-sync: losing a token rotation race does not disconnect the winner's grant", async () => {
  const tables = expiredTokenTables();
  const h = queueHarness(tables, (url) => {
    if (url.pathname !== "/oauth/token") return json([]);
    // A concurrent run rotated (and thereby revoked) the token this run read.
    tables.oauth_tokens[0].refresh_token = "rotated-by-the-other-run";
    return json(REVOKED_GRANT_BODY, 400);
  });

  const res = await h.call({ sync_type: "incremental" });
  assertEquals(res.status, 502);
  assertEquals((await res.json()).code, "refresh_failed");
  assertEquals(integrationOf(h).status, "connected");
});

Deno.test("strava-sync: 250 activities are written in 3 upsert calls, heartbeating the queue lease", async () => {
  const many: StravaActivity[] = Array.from({ length: 250 }, (_, i) => ({
    ...activity(1000 + i, 6),
    start_date: new Date(Date.parse(T0) + (i + 1) * 60_000).toISOString(),
  }));
  const tables = baseTables(T0, HISTORY);
  tables.sync_queue = [
    queueRow(QUEUE_ID, "incremental", "processing", CLAIMED_AT),
    // Another provider's live row for the same user: it must not be renewed.
    { ...queueRow(OTHER_QUEUE_ID, "incremental", "processing", CLAIMED_AT), provider: "hevy" },
  ];
  const h = queueHarness(tables, (url) => stravaActivitiesResponse(many, url));

  const res = await h.call({ sync_type: "incremental", queue_id: QUEUE_ID });
  assertEquals(res.status, 200, await res.clone().text());
  assertEquals((await res.json()).synced_count, 250);

  const activityUpserts = h.upserts.filter((u) => u.table === "external_activities");
  assertEquals(activityUpserts.map((u) => u.rows), [100, 100, 50]);
  assertEquals(h.db.rows("external_activities").length, HISTORY.length + 250);
  // One heartbeat on entry, one per fetched page (250 of 200 per page = 2),
  // one per upsert chunk.
  assertEquals(h.heartbeats, Array(1 + 2 + 3).fill(new Date(NOW).toISOString()));
  const [stravaRow, hevyRow] = h.db.rows("sync_queue");
  assertEquals(stravaRow.status, "completed");
  // The lease was renewed on the target row only (completion leaves it alone).
  assertEquals(stravaRow.started_at, new Date(NOW).toISOString());
  assertEquals(hevyRow.started_at, CLAIMED_AT);
  assertEquals(hevyRow.status, "processing");
});

Deno.test("strava-sync: an activity repeated across pages does not fail its chunk", async () => {
  // Offset paging: an upload during the run shifts the boundary, so the last
  // activity of page 1 appears again as the first of page 2.
  const page1 = Array.from({ length: 200 }, (_, i) => ({
    ...activity(2000 + i, 6),
    start_date: new Date(Date.parse(T0) + (i + 1) * 60_000).toISOString(),
  }));
  const page2 = [page1[199], {
    ...activity(2500, 6),
    start_date: new Date(Date.parse(T0) + 400 * 60_000).toISOString(),
  }];
  const h = queueHarness(baseTables(T0, HISTORY), (url) => {
    const page = Number(url.searchParams.get("page") ?? 1);
    return json(page === 1 ? page1 : page === 2 ? page2 : []);
  });

  const res = await h.call({ sync_type: "incremental" });
  assertEquals(res.status, 200, await res.clone().text());
  // 202 fetched, 201 distinct: chunks of 100/100/1, none rejected.
  assertEquals((await res.json()).synced_count, 201);
  assertEquals(
    h.upserts.filter((u) => u.table === "external_activities").map((u) => u.rows),
    [100, 100, 1],
  );
  assertEquals(h.db.rows("external_activities").length, HISTORY.length + 201);
});

Deno.test("strava-sync: a failed chunk counts its rows, withholds the watermark and leaves the task open", async () => {
  const many: StravaActivity[] = Array.from({ length: 250 }, (_, i) => ({
    ...activity(3000 + i, 6),
    start_date: new Date(Date.parse(T0) + (i + 1) * 60_000).toISOString(),
  }));
  const tables = baseTables(T0, HISTORY);
  tables.sync_queue = [queueRow(QUEUE_ID, "incremental", "processing", CLAIMED_AT)];
  const h = queueHarness(tables, (url) => stravaActivitiesResponse(many, url), { failChunk: 1 });

  const res = await h.call({ sync_type: "incremental", queue_id: QUEUE_ID });
  assertEquals(res.status, 502);
  const body = await res.json();
  assertEquals(body.error, "Failed to persist 100 of 250 activities");
  assertEquals(body.synced_count, 150);
  assertEquals(integrationOf(h).last_sync_at, T0);
  assertEquals(integrationOf(h).status, "connected");
  assertEquals(h.db.rows("sync_queue")[0].status, "processing");
});

Deno.test("strava-sync: a run without queue_id neither heartbeats nor completes a queue row", async () => {
  const tables = baseTables(T0, HISTORY);
  // Same sync_type and status the fallback would otherwise have guessed at.
  tables.sync_queue = [queueRow(QUEUE_ID, "incremental", "processing", CLAIMED_AT)];
  const h = queueHarness(tables, (url) => stravaActivitiesResponse(SINCE_T0, url));
  const res = await h.call({ sync_type: "incremental" });
  assertEquals(res.status, 200);
  assertEquals(h.heartbeats, []);
  assertEquals(h.db.rows("sync_queue")[0].status, "processing");
  assertEquals(h.db.rows("sync_queue")[0].started_at, CLAIMED_AT);
});

Deno.test("strava-sync: a browser (JWT) run creates, leases and completes a queue row of its own", async () => {
  const tables = baseTables(T0, HISTORY);
  // A kept `initial` of the user's own (the other class) and a foreign row:
  // neither is this run's, and neither may be touched or block it.
  tables.sync_queue = [
    queueRow(QUEUE_ID, "initial", "pending", null),
    { ...queueRow(OTHER_QUEUE_ID, "manual", "processing", CLAIMED_AT), user_id: OTHER_USER_ID },
  ];
  const h = queueHarness(tables, (url) => stravaActivitiesResponse(SINCE_T0, url), {
    jwtUserId: USER_ID,
  });

  // The JWT user sends a queue_id and someone else's user_id; both are ignored
  // in favour of the JWT identity and of the row this run creates.
  const res = await h.call({
    sync_type: "manual",
    queue_id: OTHER_QUEUE_ID,
    user_id: OTHER_USER_ID,
  });
  assertEquals(res.status, 200, await res.clone().text());

  const [ownInitial, foreign, created] = h.db.rows("sync_queue");
  assertEquals(ownInitial.status, "pending");
  assertEquals(foreign.status, "processing");
  assertEquals(foreign.started_at, CLAIMED_AT);
  // Created for the JWT user, in `processing`, then completed by id.
  assertEquals(created.user_id, USER_ID);
  assertEquals(created.provider, "strava");
  assertEquals(created.sync_type, "manual");
  assertEquals(created.status, "completed");
  // A browser-owned row heartbeats while it runs, like a dispatched one.
  assertEquals(h.heartbeats.length > 0, true);
  assertEquals(new Set(h.heartbeats), new Set([new Date(NOW).toISOString()]));
});

Deno.test("strava-sync: two concurrent browser syncs create one row; the loser gets 409", async () => {
  const tables = baseTables(T0, HISTORY);
  tables.sync_queue = [];
  const db = new FakeDb(tables, [syncQueueOneActiveIndex]);
  const first = queueHarness(tables, (url) => stravaActivitiesResponse(SINCE_T0, url), {
    jwtUserId: USER_ID,
    db,
  });
  const second = queueHarness(tables, (url) => stravaActivitiesResponse(SINCE_T0, url), {
    jwtUserId: USER_ID,
    db,
  });

  const [a, b] = await Promise.all([
    first.call({ sync_type: "manual" }),
    second.call({ sync_type: "manual" }),
  ]);

  const statuses = [a.status, b.status].sort();
  assertEquals(statuses, [200, 409]);
  const conflict = a.status === 409 ? a : b;
  const body = await conflict.json();
  assertEquals(body.code, "sync_already_queued");
  // Exactly one row, and the winner completed it.
  assertEquals(db.rows("sync_queue").length, 1);
  assertEquals(db.rows("sync_queue")[0].status, "completed");
});

Deno.test("strava-sync: a browser sync while a queued task is live is refused with 409", async () => {
  const tables = baseTables(T0, HISTORY);
  // process-sync-queue is running this user's incremental right now.
  tables.sync_queue = [queueRow(QUEUE_ID, "incremental", "processing", CLAIMED_AT)];
  const h = queueHarness(tables, (url) => stravaActivitiesResponse(SINCE_T0, url), {
    jwtUserId: USER_ID,
  });

  const res = await h.call({ sync_type: "manual" });
  assertEquals(res.status, 409);
  assertEquals((await res.json()).code, "sync_already_queued");
  assertEquals(h.db.rows("sync_queue").length, 1);
  // The live row keeps its lease and its status: the refused run owns nothing.
  assertEquals(h.db.rows("sync_queue")[0].status, "processing");
  assertEquals(h.db.rows("sync_queue")[0].started_at, CLAIMED_AT);
  assertEquals(h.fetchUrls, []);
});

Deno.test("strava-sync: a failed browser run hands its own row back instead of holding the lease", async () => {
  const many: StravaActivity[] = Array.from({ length: 250 }, (_, i) => ({
    ...activity(4000 + i, 6),
    start_date: new Date(Date.parse(T0) + (i + 1) * 60_000).toISOString(),
  }));
  const tables = baseTables(T0, HISTORY);
  tables.sync_queue = [];
  const h = queueHarness(tables, (url) => stravaActivitiesResponse(many, url), {
    jwtUserId: USER_ID,
    failChunk: 1,
  });

  const res = await h.call({ sync_type: "manual" });
  assertEquals(res.status, 502);
  const [created] = h.db.rows("sync_queue");
  // `failed`, not left `processing`: the next manual sync must not be 409'd
  // for the length of the lease. A dispatched row would stay `processing`.
  assertEquals(created.status, "failed");
  assertEquals(created.error_message, "Sync run failed");
});
