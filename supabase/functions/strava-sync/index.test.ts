import { assert, assertEquals } from "jsr:@std/assert@1";
import { createStravaSyncHandler } from "./index.ts";
import { FakeDb, fakeClient, type Row } from "../_shared/testing/fakeSupabase.ts";

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


// ===========================================================================
// PR 31: watermark rule for queued/manual runs (own fixtures below)
// ===========================================================================

const Q_SERVICE_ROLE_KEY = "test-service-role-key";
const Q_USER_ID = "00000000-0000-4000-8000-000000000001";
const Q_DAY = 24 * 60 * 60 * 1000;
const Q_NOW = Date.parse("2026-09-19T12:00:00.000Z");
const at = (daysAgo: number) => new Date(Q_NOW - daysAgo * Q_DAY).toISOString();

interface QStravaActivity {
  id: number;
  name: string;
  sport_type: string;
  start_date: string;
  elapsed_time: number;
}

const qActivity = (id: number, daysAgo: number): QStravaActivity => ({
  id,
  name: `Run ${id}`,
  sport_type: "Run",
  start_date: at(daysAgo),
  elapsed_time: 1800,
});

/** Strava's /athlete/activities: `after` ascending, otherwise newest first. */
function qFakeStrava(activities: QStravaActivity[], calls: URLSearchParams[]) {
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

function qBaseTables(lastSyncAt: string | null, stored: QStravaActivity[]): Record<string, Row[]> {
  return {
    subscriptions: [
      {
        user_id: Q_USER_ID,
        tier: "FLAME",
        status: "active",
        current_period_end: "2099-01-01T00:00:00.000Z",
      },
    ],
    oauth_tokens: [
      {
        user_id: Q_USER_ID,
        provider: "strava",
        access_token: "plain-access-token",
        refresh_token: "plain-refresh-token",
        token_expires_at: "2099-01-01T00:00:00.000Z",
      },
    ],
    user_integrations: [
      { user_id: Q_USER_ID, provider: "strava", status: "connected", last_sync_at: lastSyncAt },
    ],
    external_activities: stored.map((a) => ({
      user_id: Q_USER_ID,
      provider: "strava",
      external_id: String(a.id),
      started_at: a.start_date,
    })),
    sync_queue: [],
    rate_limit_tracking: [],
  };
}

function qHarness(tables: Record<string, Row[]>, activities: QStravaActivity[]) {
  const db = new FakeDb(tables);
  const stravaCalls: URLSearchParams[] = [];
  let clock = Q_NOW;
  const handler = createStravaSyncHandler({
    env: (key) =>
      ({
        SUPABASE_URL: "http://edge.test",
        SUPABASE_ANON_KEY: "anon",
        SUPABASE_SERVICE_ROLE_KEY: Q_SERVICE_ROLE_KEY,
      } as Record<string, string>)[key],
    // deno-lint-ignore no-explicit-any
    createClient: () => fakeClient(db) as any,
    fetch: qFakeStrava(activities, stravaCalls) as typeof fetch,
    now: () => new Date(clock),
  });
  const run = async (syncType: string) => {
    clock += 60_000;
    const res = await handler(
      new Request("http://edge.test/functions/v1/strava-sync", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${Q_SERVICE_ROLE_KEY}`,
        },
        body: JSON.stringify({ user_id: Q_USER_ID, sync_type: syncType }),
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
const HISTORY = [qActivity(1, 10), qActivity(2, 8)];
const SINCE_T0 = [qActivity(3, 6), qActivity(4, 4), qActivity(5, 2)];
const ALL_IDS = ["1", "2", "3", "4", "5"];

for (const order of [["initial", "incremental"], ["incremental", "initial"]]) {
  Deno.test(`strava-sync: after a manual sync, stale initial + incremental (${order.join(" then ")}) leave no gap`, async () => {
    const h = qHarness(qBaseTables(T0, HISTORY), [...HISTORY, ...SINCE_T0]);
    for (const syncType of order) await h.run(syncType);
    assertEquals(h.storedIds(), ALL_IDS);
    // The watermark is where the incremental run started, never later.
    assertEquals(Date.parse(h.watermark()!) <= Q_NOW + 2 * 60_000, true);
    assertEquals(Date.parse(h.watermark()!) > Date.parse(T0), true);
  });
}

Deno.test("strava-sync: an initial against an existing watermark never moves it", async () => {
  const h = qHarness(qBaseTables(T0, HISTORY), [...HISTORY, ...SINCE_T0]);
  await h.run("initial");
  assertEquals(h.watermark(), T0);
  // It only reached into the past (before the oldest stored qActivity).
  assertEquals(h.stravaCalls[0].has("before"), true);
  assertEquals(h.stravaCalls[0].has("after"), false);
  // The next incremental still fetches from T0.
  await h.run("incremental");
  assertEquals(h.stravaCalls[1].get("after"), String(Math.floor(Date.parse(T0) / 1000)));
  assertEquals(h.storedIds(), ALL_IDS);
});

Deno.test("strava-sync: a first backfill sets the watermark to the newest stored activity, not the clock", async () => {
  const h = qHarness(qBaseTables(null, []), [...HISTORY, ...SINCE_T0]);
  await h.run("initial");
  assertEquals(h.storedIds(), ALL_IDS);
  assertEquals(h.watermark(), at(2));
});

Deno.test("strava-sync: an incremental advances the watermark to its own start time", async () => {
  const h = qHarness(qBaseTables(T0, HISTORY), [...HISTORY, ...SINCE_T0]);
  await h.run("incremental");
  assertEquals(h.watermark(), new Date(Q_NOW + 60_000).toISOString());
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
  const db = new FakeDb(tables);
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

Deno.test("strava-sync: a browser (JWT) run holds no lease and cannot complete a processing row", async () => {
  const tables = baseTables(T0, HISTORY);
  tables.sync_queue = [
    queueRow(QUEUE_ID, "manual", "processing", CLAIMED_AT),
    queueRow(OTHER_QUEUE_ID, "manual", "pending", null),
  ];
  const h = queueHarness(tables, (url) => stravaActivitiesResponse(SINCE_T0, url), {
    jwtUserId: USER_ID,
  });

  // The JWT user sends a queue_id and someone else's user_id; both are ignored
  // in favour of the JWT identity, and the browser path holds no lease.
  const res = await h.call({
    sync_type: "manual",
    queue_id: QUEUE_ID,
    user_id: "00000000-0000-4000-8000-000000000002",
  });
  assertEquals(res.status, 200, await res.clone().text());
  assertEquals(h.heartbeats, []);
  const [processing, pending] = h.db.rows("sync_queue");
  // The named row is `processing`, which a browser run does not own, so
  // nothing is completed — not even its own pending row.
  assertEquals(processing.status, "processing");
  assertEquals(processing.started_at, CLAIMED_AT);
  assertEquals(pending.status, "pending");

  // Without a queue_id the same run completes its own newest pending row of
  // that sync_type, and still never touches the processing row.
  const withoutQueueId = await h.call({ sync_type: "manual" });
  assertEquals(withoutQueueId.status, 200);
  assertEquals(h.db.rows("sync_queue")[0].status, "processing");
  assertEquals(h.db.rows("sync_queue")[1].status, "completed");
  assertEquals(h.heartbeats, []);
});
