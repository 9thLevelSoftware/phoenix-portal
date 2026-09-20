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
import { assert, assertEquals } from "jsr:@std/assert@1";
import { createStravaSyncHandler } from "./index.ts";

// Handler tests with in-process doubles: an in-memory Supabase client and a
// fake Strava API that filters by activity START time (`after`/`before`, in
// epoch seconds) the way the real endpoint does. No real provider calls.

const USER_ID = "00000000-0000-4000-8000-0000000000a1";
const SERVICE_ROLE_KEY = "test-service-role-key";
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

interface StoredActivity {
  user_id: string;
  provider: string;
  external_id: string;
  started_at: string;
  [key: string]: unknown;
}

interface DbState {
  lastSyncAt: string | null;
  activities: StoredActivity[];
  upsertCounts: Map<string, number>;
}

function dbState(
  lastSyncAt: string | null,
  activities: StoredActivity[] = [],
): DbState {
  return { lastSyncAt, activities, upsertCounts: new Map() };
}

function createDbDouble(state: DbState) {
  const from = (table: string) => {
    const filters: Array<[string, unknown]> = [];
    let orderAscending: boolean | null = null;
    let pendingUpdate: Record<string, unknown> | null = null;

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
        return {
          data: {
            access_token: "strava-access",
            refresh_token: "strava-refresh",
            token_expires_at: "2099-01-01T00:00:00.000Z",
          },
          error: null,
        };
      }
      if (table === "user_integrations") {
        if (pendingUpdate) {
          if ("last_sync_at" in pendingUpdate) {
            state.lastSyncAt = pendingUpdate.last_sync_at as string;
          }
          return { data: null, error: null };
        }
        return {
          data: { last_sync_at: state.lastSyncAt, status: "connected" },
          error: null,
        };
      }
      if (table === "external_activities") {
        const rows = state.activities
          .filter((row) =>
            filters.every(([column, value]) => row[column] === value)
          )
          .sort((a, b) =>
            Date.parse(a.started_at) - Date.parse(b.started_at)
          );
        if (orderAscending === false) rows.reverse();
        return { data: rows[0] ?? null, error: null };
      }
      return { data: null, error: null };
    };

    const builder: Record<string, unknown> = {};
    for (const method of ["select", "is", "limit", "insert"]) {
      builder[method] = () => builder;
    }
    builder.eq = (column: string, value: unknown) => {
      filters.push([column, value]);
      return builder;
    };
    builder.order = (_column: string, options?: { ascending?: boolean }) => {
      orderAscending = options?.ascending ?? true;
      return builder;
    };
    builder.update = (values: Record<string, unknown>) => {
      pendingUpdate = values;
      return builder;
    };
    builder.upsert = (row: StoredActivity) => {
      if (table === "external_activities") {
        state.upsertCounts.set(
          row.external_id,
          (state.upsertCounts.get(row.external_id) ?? 0) + 1,
        );
        const index = state.activities.findIndex((existing) =>
          existing.user_id === row.user_id &&
          existing.provider === row.provider &&
          existing.external_id === row.external_id
        );
        if (index >= 0) {
          state.activities[index] = { ...state.activities[index], ...row };
        } else state.activities.push(row);
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
  return { from, rpc: () => Promise.resolve({ data: null, error: null }) };
}

interface UpstreamActivity {
  id: number;
  start_date: string;
}

interface FakeStravaOptions {
  /** Return `after` queries newest-first too (the real API is believed to
   * return them oldest-first; A-008). */
  descendingAfter?: boolean;
  /** 1-based request numbers that get a 429. */
  rateLimitRequests?: number[];
  /** Extra response headers per request (1-based). */
  headersFor?: (requestNumber: number) => Record<string, string>;
}

interface FakeStrava {
  requests: URL[];
  firstRequestAt: number | null;
  restore(): void;
}

const FAKE_RESPONSE_DELAY_MS = 5;

function installFakeStrava(
  upstream: UpstreamActivity[],
  options: FakeStravaOptions = {},
): FakeStrava {
  const originalFetch = globalThis.fetch;
  const fake: FakeStrava = {
    requests: [],
    firstRequestAt: null,
    restore: () => {
      globalThis.fetch = originalFetch;
    },
  };
  globalThis.fetch = ((input: string | URL | Request) => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
    );
    if (url.hostname !== "www.strava.com" || url.pathname !== "/api/v3/athlete/activities") {
      throw new Error(`Unexpected fetch in test: ${url.href}`);
    }
    fake.requests.push(url);
    const requestNumber = fake.requests.length;
    fake.firstRequestAt ??= Date.now();
    const headers = {
      "Content-Type": "application/json",
      ...(options.headersFor?.(requestNumber) ?? {}),
    };

    let response: Response;
    if (options.rateLimitRequests?.includes(requestNumber)) {
      response = new Response("rate limited", { status: 429, headers });
    } else {
      const after = url.searchParams.get("after");
      const before = url.searchParams.get("before");
      const perPage = Number(url.searchParams.get("per_page") ?? "30");
      const page = Number(url.searchParams.get("page") ?? "1");
      const ascending = after !== null && !options.descendingAfter;
      const matching = upstream
        .filter((activity) => {
          const startSeconds = Date.parse(activity.start_date) / 1000;
          if (after !== null && !(startSeconds > Number(after))) return false;
          if (before !== null && !(startSeconds < Number(before))) return false;
          return true;
        })
        .sort((a, b) =>
          ascending
            ? Date.parse(a.start_date) - Date.parse(b.start_date)
            : Date.parse(b.start_date) - Date.parse(a.start_date)
        )
        .slice((page - 1) * perPage, page * perPage)
        .map((activity) => ({
          id: activity.id,
          name: `Activity ${activity.id}`,
          sport_type: "Ride",
          start_date: activity.start_date,
          elapsed_time: 3600,
        }));
      response = new Response(JSON.stringify(matching), { status: 200, headers });
    }

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
    const handler = createStravaSyncHandler({
      createAuthClient: () => ({
        auth: { getUser: () => Promise.resolve({ data: { user: null } }) },
      }),
      // deno-lint-ignore no-explicit-any
      createAdminClient: () => db as any,
      sleep: () => Promise.resolve(),
    });
    return await handler(
      new Request("http://localhost/functions/v1/strava-sync", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
          "Content-Type": "application/json",
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
  } finally {
    if (previousKey === undefined) Deno.env.delete("SUPABASE_SERVICE_ROLE_KEY");
    else Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", previousKey);
  }
}

function stored(id: number, startedAt: string): StoredActivity {
  return {
    user_id: USER_ID,
    provider: "strava",
    external_id: String(id),
    started_at: startedAt,
  };
}

function storedIds(state: DbState): string[] {
  return state.activities.map((row) => row.external_id).sort();
}

/** `count` activities one hour apart, the first at `firstStartMs`. */
function hourly(firstId: number, firstStartMs: number, count: number): UpstreamActivity[] {
  return Array.from({ length: count }, (_, i) => ({
    id: firstId + i,
    start_date: new Date(firstStartMs + i * HOUR).toISOString(),
  }));
}

function upstreamOf(state: DbState): UpstreamActivity[] {
  return state.activities.map((row) => ({
    id: Number(row.external_id),
    start_date: row.started_at,
  }));
}

function hasParam(requests: URL[], name: string): boolean {
  return requests.some((url) => url.searchParams.has(name));
}

Deno.test("strava-sync reconnect after a gap fetches activities recorded while disconnected", async () => {
  const now = Date.now();
  const state = dbState(new Date(now - 30 * DAY).toISOString(), [
    stored(1, new Date(now - 60 * DAY).toISOString()),
    stored(2, new Date(now - 31 * DAY).toISOString()),
  ]);
  const upstream: UpstreamActivity[] = [
    ...upstreamOf(state),
    // Recorded while disconnected: after the old last_sync_at, before now.
    { id: 3, start_date: new Date(now - 20 * DAY).toISOString() },
    { id: 4, start_date: new Date(now - 2 * DAY).toISOString() },
    // Older than anything stored: the backward backfill still reaches it.
    { id: 5, start_date: new Date(now - 90 * DAY).toISOString() },
  ];
  const strava = installFakeStrava(upstream);
  try {
    const response = await runSync(state, "initial");
    assertEquals(response.status, 200, await response.clone().text());
    assertEquals(storedIds(state), ["1", "2", "3", "4", "5"]);

    // The forward (gap) pass runs before the backward backfill.
    assert(strava.requests.length >= 2);
    assert(strava.requests[0].searchParams.has("after"));
    assert(strava.requests.at(-1)!.searchParams.has("before"));
  } finally {
    strava.restore();
  }
});

Deno.test("strava-sync imports a late upload that started before the last sync", async () => {
  const now = Date.now();
  const state = dbState(new Date(now - 6 * HOUR).toISOString(), [
    stored(10, new Date(now - 30 * HOUR).toISOString()),
  ]);
  // Started two hours before the last sync, but uploaded only after it.
  const lateUpload = { id: 11, start_date: new Date(now - 8 * HOUR).toISOString() };
  const strava = installFakeStrava([...upstreamOf(state), lateUpload]);
  try {
    const response = await runSync(state, "incremental");
    assertEquals(response.status, 200, await response.clone().text());
    assertEquals(storedIds(state), ["10", "11"]);

    // Window = min(last_sync_at, newest stored start) - 72h.
    const expectedAfter = Math.floor(
      (Date.parse(state.activities[0].started_at) - 72 * HOUR) / 1000,
    );
    assertEquals(strava.requests[0].searchParams.get("after"), String(expectedAfter));
    assertEquals(hasParam(strava.requests, "before"), false);
  } finally {
    strava.restore();
  }
});

Deno.test("strava-sync captures the new watermark before fetching", async () => {
  const state = dbState(new Date(Date.now() - 6 * HOUR).toISOString());
  const strava = installFakeStrava([]);
  try {
    const response = await runSync(state, "incremental");
    assertEquals(response.status, 200, await response.clone().text());
    assert(strava.firstRequestAt !== null);
    assert(
      Date.parse(state.lastSyncAt!) < strava.firstRequestAt! + FAKE_RESPONSE_DELAY_MS,
      `last_sync_at ${state.lastSyncAt} must not be later than the first fetch`,
    );
  } finally {
    strava.restore();
  }
});

Deno.test("strava-sync initial sync with no stored rows does a plain backfill", async () => {
  const now = Date.now();
  const state = dbState(null);
  const strava = installFakeStrava([
    { id: 21, start_date: new Date(now - 400 * DAY).toISOString() },
    { id: 22, start_date: new Date(now - 1 * HOUR).toISOString() },
  ]);
  try {
    const response = await runSync(state, "initial");
    assertEquals(response.status, 200, await response.clone().text());
    assertEquals(storedIds(state), ["21", "22"]);
    assertEquals(strava.requests.length, 1);
    assertEquals(hasParam(strava.requests, "after"), false);
    assertEquals(hasParam(strava.requests, "before"), false);
  } finally {
    strava.restore();
  }
});

Deno.test("strava-sync resumed backfill (no watermark, rows stored) runs forward then backward", async () => {
  const now = Date.now();
  const storedStart = new Date(now - 10 * DAY).toISOString();
  const state = dbState(null, [stored(30, storedStart)]);
  const strava = installFakeStrava([
    ...upstreamOf(state),
    { id: 31, start_date: new Date(now - 20 * DAY).toISOString() },
    { id: 32, start_date: new Date(now - 1 * DAY).toISOString() },
  ]);
  try {
    const response = await runSync(state, "incremental");
    assertEquals(response.status, 200, await response.clone().text());
    assertEquals(storedIds(state), ["30", "31", "32"]);
    const storedEpoch = Date.parse(storedStart) / 1000;
    assertEquals(
      strava.requests[0].searchParams.get("after"),
      String(Math.floor(storedEpoch - 72 * 3600)),
    );
    assertEquals(
      strava.requests.at(-1)!.searchParams.get("before"),
      String(Math.floor(storedEpoch)),
    );
  } finally {
    strava.restore();
  }
});

Deno.test("strava-sync reconnect gap larger than the page ceiling converges across retries", async () => {
  const now = Date.now();
  const oldLastSync = now - 120 * DAY;
  const state = dbState(new Date(oldLastSync).toISOString(), [
    stored(1, new Date(oldLastSync - 10 * DAY).toISOString()),
  ]);
  // 2,500 activities recorded while disconnected: more than 10 pages.
  const gap = hourly(1000, oldLastSync + DAY, 2500);
  const upstream = [...upstreamOf(state), ...gap];
  const strava = installFakeStrava(upstream);
  try {
    const first = await runSync(state, "initial");
    assertEquals(first.status, 502, await first.clone().text());
    assertEquals((await first.json()).partial, true);
    // Forward pass capped below the run ceiling; the backward pass still ran.
    const firstForward = strava.requests.filter((url) => url.searchParams.has("after"));
    assertEquals(firstForward.length, 8);
    assert(hasParam(strava.requests, "before"));
    // Watermark moved to the newest fully read activity (not "now"). The
    // forward window starts 72h before the stored row, so the 1,600 rows read
    // are that stored row plus gap[0..1598].
    assertEquals(state.lastSyncAt, gap[1598].start_date);

    let runs = 1;
    let previousAfter = Number(firstForward[0].searchParams.get("after"));
    let lastStatus = first.status;
    while (lastStatus !== 200 && runs < 5) {
      const requestsBefore = strava.requests.length;
      const retry = await runSync(state, "initial");
      lastStatus = retry.status;
      runs++;
      const after = Number(strava.requests[requestsBefore].searchParams.get("after"));
      assert(after > previousAfter, "each retry must request a strictly later window");
      previousAfter = after;
    }

    assertEquals(lastStatus, 200);
    assertEquals(runs, 2);
    assertEquals(state.activities.length, upstream.length);
    assert(Date.parse(state.lastSyncAt!) >= now);
  } finally {
    strava.restore();
  }
});

Deno.test("strava-sync reconnect with an incomplete backfill still moves the backfill", async () => {
  const now = Date.now();
  const middle = now - 200 * DAY;
  const state = dbState(null, [stored(1, new Date(middle).toISOString())]);
  const newer = hourly(1000, middle + HOUR, 2500);
  const older = hourly(5000, middle - 400 * HOUR, 300);
  const upstream = [...upstreamOf(state), ...newer, ...older];
  const strava = installFakeStrava(upstream);
  try {
    const first = await runSync(state, "initial");
    assertEquals(first.status, 502, await first.clone().text());
    // The backward pass got its reserved pages and read all older activities.
    const backward = strava.requests.filter((url) => url.searchParams.has("before"));
    assertEquals(backward.length, 2);
    for (const activity of older) {
      assert(state.activities.some((row) => row.external_id === String(activity.id)));
    }
    // No watermark yet: last_sync_at stays null so the backfill is not ended.
    assertEquals(state.lastSyncAt, null);

    const second = await runSync(state, "initial");
    assertEquals(second.status, 200, await second.clone().text());
    assertEquals(state.activities.length, upstream.length);
    assert(state.lastSyncAt !== null);
  } finally {
    strava.restore();
  }
});

Deno.test("strava-sync incremental forward pass at the page ceiling advances only to what was read", async () => {
  const now = Date.now();
  const lastSync = now - 200 * DAY;
  const state = dbState(new Date(lastSync).toISOString());
  const upstream = hourly(1000, lastSync + HOUR, 2100);
  const strava = installFakeStrava(upstream);
  try {
    const response = await runSync(state, "incremental");
    assertEquals(response.status, 502, await response.clone().text());
    assertEquals((await response.json()).partial, true);
    assertEquals(strava.requests.length, 10);
    assertEquals(hasParam(strava.requests, "before"), false);
    assertEquals(state.lastSyncAt, upstream[1999].start_date);
  } finally {
    strava.restore();
  }
});

Deno.test("strava-sync does not advance the watermark when the forward pass is not in start order", async () => {
  const now = Date.now();
  const lastSync = new Date(now - 200 * DAY).toISOString();
  const state = dbState(lastSync);
  const strava = installFakeStrava(hourly(1000, Date.parse(lastSync) + HOUR, 2100), {
    descendingAfter: true,
  });
  try {
    const response = await runSync(state, "incremental");
    // Nothing safe to resume from and no rate limit: stop instead of spinning.
    assertEquals(response.status, 500, await response.clone().text());
    assertEquals(state.lastSyncAt, lastSync);
  } finally {
    strava.restore();
  }
});

Deno.test("strava-sync treats a 429 on the first request as retryable", async () => {
  const now = Date.now();
  const lastSync = new Date(now - 30 * DAY).toISOString();
  const state = dbState(lastSync, [stored(1, new Date(now - 31 * DAY).toISOString())]);
  const strava = installFakeStrava(upstreamOf(state), { rateLimitRequests: [1] });
  try {
    const response = await runSync(state, "initial");
    assertEquals(response.status, 502, await response.clone().text());
    assertEquals(strava.requests.length, 1);
    assertEquals(state.lastSyncAt, lastSync);
  } finally {
    strava.restore();
  }
});

Deno.test("strava-sync 429 mid forward pass keeps page-one rows and stops both passes", async () => {
  const now = Date.now();
  const lastSync = now - 200 * DAY;
  const state = dbState(new Date(lastSync).toISOString(), [
    stored(1, new Date(lastSync - DAY).toISOString()),
  ]);
  const gap = hourly(1000, lastSync + HOUR, 500);
  const strava = installFakeStrava([...upstreamOf(state), ...gap], {
    rateLimitRequests: [2],
  });
  try {
    const response = await runSync(state, "initial");
    assertEquals(response.status, 502, await response.clone().text());
    assertEquals(strava.requests.length, 2);
    assertEquals(hasParam(strava.requests, "before"), false);
    // Page one (ascending) was persisted, and the watermark moved only to it.
    const pageOne = strava.requests[0];
    assert(pageOne.searchParams.has("after"));
    assert(state.activities.some((row) => row.external_id === "1000"));
    assertEquals(state.activities.some((row) => row.external_id === "1300"), false);
    assert(Date.parse(state.lastSyncAt!) < now);
  } finally {
    strava.restore();
  }
});

Deno.test("strava-sync checks the read budget before starting the backward pass", async () => {
  const now = Date.now();
  const lastSync = new Date(now - 30 * DAY).toISOString();
  const state = dbState(lastSync, [stored(1, new Date(now - 31 * DAY).toISOString())]);
  const strava = installFakeStrava(
    [...upstreamOf(state), { id: 2, start_date: new Date(now - 2 * DAY).toISOString() }],
    {
      headersFor: () => ({
        "X-ReadRateLimit-Limit": "100,1000",
        "X-ReadRateLimit-Usage": "95,100",
      }),
    },
  );
  try {
    const response = await runSync(state, "initial");
    assertEquals(response.status, 502, await response.clone().text());
    assertEquals(strava.requests.length, 1);
    assertEquals(hasParam(strava.requests, "before"), false);
    assert(state.activities.some((row) => row.external_id === "2"));
  } finally {
    strava.restore();
  }
});

Deno.test("strava-sync upserts an activity returned by both passes once", async () => {
  const now = Date.now();
  // Every stored row is within 72h of the newest, so the forward window
  // (newest - 72h) overlaps the backward window (before oldest).
  const state = dbState(null, [
    stored(1, new Date(now - 30 * HOUR).toISOString()),
    stored(2, new Date(now - 10 * HOUR).toISOString()),
  ]);
  const both = { id: 3, start_date: new Date(now - 40 * HOUR).toISOString() };
  const strava = installFakeStrava([...upstreamOf(state), both]);
  try {
    const response = await runSync(state, "initial");
    assertEquals(response.status, 200, await response.clone().text());
    assert(hasParam(strava.requests, "after") && hasParam(strava.requests, "before"));
    assertEquals(state.upsertCounts.get("3"), 1);
    assertEquals((await response.json()).synced_count, 3);
  } finally {
    strava.restore();
  }
});
