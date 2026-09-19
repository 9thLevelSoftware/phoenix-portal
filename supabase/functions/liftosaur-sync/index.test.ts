import { assert, assertEquals } from "jsr:@std/assert@1";
import { createLiftosaurSyncHandler } from "./index.ts";

// Handler tests with in-process doubles: an in-memory Supabase client and a
// fake Liftosaur API whose `startDate` filters on workout date. No real
// provider calls.

const USER_ID = "00000000-0000-4000-8000-0000000000b1";
const SERVICE_ROLE_KEY = "test-service-role-key";
const HOUR = 60 * 60 * 1000;

interface DbState {
  lastSyncAt: string | null;
  activities: Array<Record<string, unknown>>;
}

function createDbDouble(state: DbState) {
  const from = (table: string) => {
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
      return { data: null, error: null };
    };

    const builder: Record<string, unknown> = {};
    for (const method of ["select", "eq", "order", "limit"]) {
      builder[method] = () => builder;
    }
    builder.update = (values: Record<string, unknown>) => {
      pendingUpdate = values;
      return builder;
    };
    builder.upsert = (row: Record<string, unknown>) => {
      if (table === "external_activities") {
        const index = state.activities.findIndex((existing) =>
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
  return { from };
}

interface UpstreamRecord {
  id: number;
  date: string;
}

function installFakeLiftosaur(upstream: UpstreamRecord[]) {
  const originalFetch = globalThis.fetch;
  const requests: URL[] = [];
  globalThis.fetch = ((input: string | URL | Request) => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
    );
    if (url.hostname !== "www.liftosaur.com" || url.pathname !== "/api/v1/history") {
      throw new Error(`Unexpected fetch in test: ${url.href}`);
    }
    requests.push(url);
    const startDate = url.searchParams.get("startDate");
    const records = upstream
      .filter((record) =>
        startDate === null || Date.parse(record.date) >= Date.parse(startDate)
      )
      .map((record) => ({
        id: record.id,
        text: `${record.date} / program: "Test" / dayName: "Day ${record.id}" / duration: 3600s`,
      }));
    return Promise.resolve(
      new Response(
        JSON.stringify({ data: { records, hasMore: false, nextCursor: null } }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
  }) as typeof fetch;
  return { requests, restore: () => (globalThis.fetch = originalFetch) };
}

async function runSync(state: DbState, syncType: string): Promise<Response> {
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", SERVICE_ROLE_KEY);
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
      body: JSON.stringify({ user_id: USER_ID, sync_type: syncType }),
    }),
  );
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

Deno.test("liftosaur-sync advances the watermark to the pre-fetch time", async () => {
  const before = Date.now();
  const state: DbState = {
    lastSyncAt: new Date(before - 6 * HOUR).toISOString(),
    activities: [],
  };
  const liftosaur = installFakeLiftosaur([]);
  try {
    const response = await runSync(state, "incremental");
    assertEquals(response.status, 200, await response.clone().text());
    const written = Date.parse(state.lastSyncAt!);
    assert(written >= before && written <= Date.now());
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
