import { assert, assertEquals } from "jsr:@std/assert@1";
import { createFitbitSyncHandler } from "./index.ts";
import { FakeDb, fakeClient, type Row } from "../_shared/testing/fakeSupabase.ts";

// F-053: handler tests for the not-yet-launched Fitbit sync. In-process DB
// double and a fake Fitbit API; no real provider calls.

const SERVICE_ROLE_KEY = "test-service-role-key";
const USER_ID = "00000000-0000-4000-8000-0000000000f1";
const QUEUE_ID = "00000000-0000-4000-8000-0000000000fa";
const FAR_FUTURE = "2099-01-01T00:00:00.000Z";

function db(overrides: { tokenExpiresAt?: string; status?: string; lastSyncAt?: string | null } = {}): FakeDb {
  return new FakeDb({
    subscriptions: [{ user_id: USER_ID, tier: "FLAME", status: "active", current_period_end: FAR_FUTURE }],
    oauth_tokens: [{
      user_id: USER_ID,
      provider: "fitbit",
      access_token: "access-1",
      refresh_token: "refresh-1",
      token_expires_at: overrides.tokenExpiresAt ?? FAR_FUTURE,
    }],
    user_integrations: [{
      user_id: USER_ID,
      provider: "fitbit",
      status: overrides.status ?? "connected",
      last_sync_at: overrides.lastSyncAt ?? "2026-09-01T00:00:00.000Z",
    }],
    external_activities: [],
    sync_queue: [{
      id: QUEUE_ID,
      user_id: USER_ID,
      provider: "fitbit",
      sync_type: "incremental",
      status: "processing",
      started_at: new Date().toISOString(),
      completed_at: null,
    }],
  });
}

interface FakeFitbit {
  fetch: typeof fetch;
  calls: Array<{ url: string; auth: string | null }>;
}

/** Fitbit API: `pages` of activity lists (100 per page), then an empty page. */
function fitbit(pages: Row[][], options: { status?: number } = {}): FakeFitbit {
  const calls: FakeFitbit["calls"] = [];
  const fake = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    const auth = new Headers(init?.headers).get("Authorization");
    calls.push({ url: url.href, auth });
    if (url.pathname === "/oauth2/token") {
      return Promise.resolve(Response.json({
        access_token: "access-2",
        refresh_token: "refresh-2",
        expires_in: 28_800,
      }));
    }
    if (options.status) return Promise.resolve(new Response("nope", { status: options.status }));
    const page = Number(url.searchParams.get("offset")) / 100;
    return Promise.resolve(Response.json({ activities: pages[page] ?? [] }));
  };
  return { fetch: fake as typeof fetch, calls };
}

const fitbitActivity = (logId: number): Row => ({
  logId,
  activityName: "Walk",
  activityTypeId: 90001,
  startTime: "2026-09-10T08:00:00.000Z",
  duration: 1_800_000,
  distance: 2.5,
  calories: 150,
});

function handler(state: FakeDb, api: FakeFitbit, jwtUserId: string | null = null) {
  return createFitbitSyncHandler({
    env: (key) =>
      ({
        SUPABASE_URL: "http://edge.test",
        SUPABASE_ANON_KEY: "anon",
        SUPABASE_SERVICE_ROLE_KEY: SERVICE_ROLE_KEY,
        FITBIT_CLIENT_ID: "client-id",
        FITBIT_CLIENT_SECRET: "client-secret",
      } as Record<string, string>)[key],
    // deno-lint-ignore no-explicit-any
    createClient: () => fakeClient(state, jwtUserId, () => new Date()) as any,
    fetch: api.fetch,
  });
}

function request(body: Row, authorization: string | null = `Bearer ${SERVICE_ROLE_KEY}`): Request {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (authorization) headers.Authorization = authorization;
  return new Request("http://edge.test/functions/v1/fitbit-sync", {
    method: "POST",
    headers,
    body: JSON.stringify({ user_id: USER_ID, ...body }),
  });
}

async function silenced<T>(run: () => Promise<T>): Promise<T> {
  const original = { log: console.log, warn: console.warn, error: console.error };
  console.log = () => {};
  console.warn = () => {};
  console.error = () => {};
  try {
    return await run();
  } finally {
    Object.assign(console, original);
  }
}

Deno.test("fitbit-sync: no Authorization, or a wrong service key, is 401 before any read", async () => {
  const state = db();
  const api = fitbit([]);
  assertEquals((await handler(state, api)(request({}, null))).status, 401);
  assertEquals((await handler(state, api)(request({}, "Bearer not-the-key"))).status, 401);
  assertEquals(api.calls, []);
});

Deno.test("fitbit-sync: a dispatched sync pages through Fitbit, stores every activity and completes its own row", async () => {
  const state = db();
  const api = fitbit([
    Array.from({ length: 100 }, (_, i) => fitbitActivity(i + 1)),
    [fitbitActivity(101), fitbitActivity(102)],
  ]);
  const res = await silenced(() => handler(state, api)(request({ sync_type: "incremental", queue_id: QUEUE_ID })));
  assertEquals(res.status, 200, await res.clone().text());
  assertEquals(await res.json(), { success: true, synced: 102 });
  assertEquals(state.rows("external_activities").length, 102);
  const [row] = state.rows("external_activities");
  // Fitbit gives ms and km; stored as seconds and metres.
  assertEquals([row.duration_seconds, row.distance_meters, row.activity_type], [1800, 2500, "walking"]);
  assertEquals(state.rows("sync_queue")[0].status, "completed");
  assert(api.calls.every((call) => call.auth === "Bearer access-1"));
});

Deno.test("fitbit-sync: an integration that is not connected is 404 and calls no provider", async () => {
  const state = db({ status: "error" });
  const api = fitbit([]);
  const res = await silenced(() => handler(state, api)(request({ queue_id: QUEUE_ID })));
  assertEquals(res.status, 404);
  assertEquals(api.calls, []);
});

Deno.test("fitbit-sync: a Fitbit 429 marks this user's hourly window full and returns 429", async () => {
  const state = db();
  const api = fitbit([], { status: 429 });
  const res = await silenced(() => handler(state, api)(request({ queue_id: QUEUE_ID })));
  assertEquals(res.status, 429);
  const [limit] = state.rows("rate_limit_tracking");
  assertEquals([limit.key, limit.user_id, limit.requests_this_window], ["fitbit", USER_ID, 150]);
  // Anchored to the top of the hour, when Fitbit actually resets.
  assertEquals(new Date(limit.window_started_at as string).getUTCMinutes(), 0);
  assertEquals(state.rows("sync_queue")[0].status, "processing", "left for the queue to retry");
});

Deno.test("fitbit-sync: an expiring token is refreshed with Basic client auth and the rotated tokens are stored", async () => {
  const state = db({ tokenExpiresAt: new Date(Date.now() + 60_000).toISOString() });
  const api = fitbit([[fitbitActivity(1)]]);
  const res = await silenced(() => handler(state, api)(request({ queue_id: QUEUE_ID })));
  assertEquals(res.status, 200, await res.clone().text());
  const refresh = api.calls.find((call) => call.url.endsWith("/oauth2/token"));
  assertEquals(refresh?.auth, `Basic ${btoa("client-id:client-secret")}`);
  // The list call used the refreshed token, and the rotated pair was persisted.
  assertEquals(api.calls.at(-1)?.auth, "Bearer access-2");
  const [token] = state.rows("oauth_tokens");
  assert(token.access_token !== "access-1" && token.refresh_token !== "refresh-1");
});
