import { assert, assertEquals } from "jsr:@std/assert@1";
import { createStravaSyncHandler } from "./index.ts";

// Handler tests with in-process doubles: an in-memory Supabase client and a
// fake Strava API that filters by activity START time (`after`/`before`, in
// epoch seconds) the way the real endpoint does. No real provider calls.

const USER_ID = "00000000-0000-4000-8000-0000000000a1";
const SERVICE_ROLE_KEY = "test-service-role-key";
const HOUR = 60 * 60 * 1000;

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
  integrationUpdates: Record<string, unknown>[];
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
          state.integrationUpdates.push(pendingUpdate);
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
    for (const method of ["select", "is", "limit"]) {
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
    builder.insert = () => builder;
    builder.upsert = (row: StoredActivity) => {
      if (table === "external_activities") {
        const index = state.activities.findIndex((existing) =>
          existing.user_id === row.user_id &&
          existing.provider === row.provider &&
          existing.external_id === row.external_id
        );
        if (index >= 0) state.activities[index] = row;
        else state.activities.push(row);
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

interface FakeStrava {
  requests: URL[];
  firstRequestAt: number | null;
  restore(): void;
}

function installFakeStrava(upstream: UpstreamActivity[]): FakeStrava {
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
    fake.firstRequestAt ??= Date.now();
    const after = url.searchParams.get("after");
    const before = url.searchParams.get("before");
    const perPage = Number(url.searchParams.get("per_page") ?? "30");
    const page = Number(url.searchParams.get("page") ?? "1");
    const matching = upstream
      .filter((activity) => {
        const startSeconds = Date.parse(activity.start_date) / 1000;
        if (after !== null && !(startSeconds > Number(after))) return false;
        if (before !== null && !(startSeconds < Number(before))) return false;
        return true;
      })
      .sort((a, b) => Date.parse(b.start_date) - Date.parse(a.start_date))
      .slice((page - 1) * perPage, page * perPage)
      .map((activity) => ({
        id: activity.id,
        name: `Activity ${activity.id}`,
        sport_type: "Ride",
        start_date: activity.start_date,
        elapsed_time: 3600,
      }));
    // A small delay so "before the fetch" and "after the fetch" are
    // distinguishable timestamps.
    return new Promise<Response>((resolve) =>
      setTimeout(
        () =>
          resolve(
            new Response(JSON.stringify(matching), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }),
          ),
        5,
      )
    );
  }) as typeof fetch;
  return fake;
}

async function runSync(state: DbState, syncType: string): Promise<Response> {
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", SERVICE_ROLE_KEY);
  const db = createDbDouble(state);
  const handler = createStravaSyncHandler({
    createAuthClient: () => ({
      auth: { getUser: () => Promise.resolve({ data: { user: null } }) },
    }),
    // deno-lint-ignore no-explicit-any
    createAdminClient: () => db as any,
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

Deno.test("strava-sync reconnect after a gap fetches activities recorded while disconnected", async () => {
  const now = Date.now();
  const oldLastSync = new Date(now - 30 * 24 * HOUR).toISOString();
  const state: DbState = {
    lastSyncAt: oldLastSync,
    activities: [
      stored(1, new Date(now - 60 * 24 * HOUR).toISOString()),
      stored(2, new Date(now - 31 * 24 * HOUR).toISOString()),
    ],
    integrationUpdates: [],
  };
  const upstream: UpstreamActivity[] = [
    { id: 1, start_date: state.activities[0].started_at },
    { id: 2, start_date: state.activities[1].started_at },
    // Recorded while disconnected: after the old last_sync_at, before now.
    { id: 3, start_date: new Date(now - 20 * 24 * HOUR).toISOString() },
    { id: 4, start_date: new Date(now - 2 * 24 * HOUR).toISOString() },
    // Older than anything stored: the backward backfill still reaches it.
    { id: 5, start_date: new Date(now - 90 * 24 * HOUR).toISOString() },
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
  const lastSync = new Date(now - 6 * HOUR).toISOString();
  const state: DbState = {
    lastSyncAt: lastSync,
    activities: [stored(10, new Date(now - 30 * HOUR).toISOString())],
    integrationUpdates: [],
  };
  // Started two hours before the last sync, but uploaded only after it.
  const lateUpload = { id: 11, start_date: new Date(now - 8 * HOUR).toISOString() };
  const strava = installFakeStrava([
    { id: 10, start_date: state.activities[0].started_at },
    lateUpload,
  ]);
  try {
    const response = await runSync(state, "incremental");
    assertEquals(response.status, 200, await response.clone().text());
    assertEquals(storedIds(state), ["10", "11"]);

    // Window = min(last_sync_at, newest stored start) - 72h.
    const expectedAfter = Math.floor(
      (Date.parse(state.activities[0].started_at) - 72 * HOUR) / 1000,
    );
    assertEquals(strava.requests[0].searchParams.get("after"), String(expectedAfter));
    assertEquals(strava.requests[0].searchParams.has("before"), false);
  } finally {
    strava.restore();
  }
});

Deno.test("strava-sync captures the new watermark before fetching", async () => {
  const now = Date.now();
  const state: DbState = {
    lastSyncAt: new Date(now - 6 * HOUR).toISOString(),
    activities: [],
    integrationUpdates: [],
  };
  const strava = installFakeStrava([]);
  try {
    const response = await runSync(state, "incremental");
    assertEquals(response.status, 200, await response.clone().text());
    assert(strava.firstRequestAt !== null);
    assert(
      Date.parse(state.lastSyncAt!) < strava.firstRequestAt! + 5,
      `last_sync_at ${state.lastSyncAt} must not be later than the first fetch`,
    );
  } finally {
    strava.restore();
  }
});

Deno.test("strava-sync initial sync with no stored rows does a plain backfill", async () => {
  const now = Date.now();
  const state: DbState = { lastSyncAt: null, activities: [], integrationUpdates: [] };
  const strava = installFakeStrava([
    { id: 21, start_date: new Date(now - 400 * 24 * HOUR).toISOString() },
    { id: 22, start_date: new Date(now - 1 * HOUR).toISOString() },
  ]);
  try {
    const response = await runSync(state, "initial");
    assertEquals(response.status, 200, await response.clone().text());
    assertEquals(storedIds(state), ["21", "22"]);
    assertEquals(strava.requests.length, 1);
    assertEquals(strava.requests[0].searchParams.has("after"), false);
    assertEquals(strava.requests[0].searchParams.has("before"), false);
  } finally {
    strava.restore();
  }
});
