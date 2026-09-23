import { assert, assertEquals } from "jsr:@std/assert@1";
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { createMobileIntegrationSyncHandler } from "./index.ts";
import { FakeDb, fakeClient } from "../_shared/testing/fakeSupabase.ts";

const USER_ID = "11111111-1111-4111-8111-111111111111";

type Call =
  | { kind: "from"; table: string; op: string }
  | { kind: "rpc"; name: string; args: Record<string, unknown> }
  | { kind: "fetch"; url: string };

interface State {
  calls: Call[];
  disconnectError: { code?: string; message: string } | null;
}

function fakeAdmin(state: State): SupabaseClient {
  const client = {
    from(table: string) {
      const chain = (op: string) => () => {
        state.calls.push({ kind: "from", table, op });
        const query = {
          eq: () => query,
          select: () => query,
          maybeSingle: () => Promise.resolve({ data: null, error: null }),
          single: () => Promise.resolve({ data: null, error: null }),
          then: (resolve: (v: { data: null; error: null }) => unknown) =>
            Promise.resolve({ data: null, error: null }).then(resolve),
        };
        return query;
      };
      return {
        select: chain("select"),
        delete: chain("delete"),
        update: chain("update"),
        upsert: chain("upsert"),
        insert: chain("insert"),
      };
    },
    rpc(name: string, args: Record<string, unknown>) {
      state.calls.push({ kind: "rpc", name, args });
      if (name === "disconnect_integration") {
        return Promise.resolve({ data: null, error: state.disconnectError });
      }
      return Promise.resolve({
        data: [{ allowed: true, remaining: 4, retry_after_seconds: null }],
        error: null,
      });
    },
  };
  return client as unknown as SupabaseClient;
}

function handlerFor(state: State) {
  return createMobileIntegrationSyncHandler({
    createAuthClient: () => ({
      auth: { getUser: () => Promise.resolve({ data: { user: { id: USER_ID } } }) },
    }),
    createAdminClient: () => fakeAdmin(state),
    revoke: {
      fetch: ((input: string | URL | Request) => {
        state.calls.push({ kind: "fetch", url: String(input) });
        return Promise.resolve(new Response("{}", { status: 200 }));
      }) as typeof fetch,
      fitbitClientId: undefined,
      fitbitClientSecret: undefined,
      stravaClientId: undefined,
      stravaClientSecret: undefined,
      garminConsumerKey: undefined,
      garminConsumerSecret: undefined,
    },
  });
}

function post(body: unknown): Request {
  return new Request("http://localhost/functions/v1/mobile-integration-sync", {
    method: "POST",
    headers: { Authorization: "Bearer user-jwt", "Content-Type": "application/json" },
    body: JSON.stringify(body),
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

const isDisconnectRpc = (call: Call) => call.kind === "rpc" && call.name === "disconnect_integration";

Deno.test("mobile-integration-sync: disconnect calls disconnect_integration and writes no table directly", async () => {
  for (const provider of ["hevy", "liftosaur"]) {
    const state: State = { calls: [], disconnectError: null };
    const res = await silenced(() => handlerFor(state)(post({ provider, action: "disconnect" })));
    assertEquals(res.status, 200, provider);
    assertEquals(await res.json(), { status: "disconnected" });

    const rpc = state.calls.find(isDisconnectRpc) as Extract<Call, { kind: "rpc" }> | undefined;
    assert(rpc, `${provider}: disconnect_integration called`);
    assertEquals(rpc.args.p_user_id, USER_ID);
    assertEquals(rpc.args.p_provider, provider);
    // The old non-atomic Promise.all wrote oauth_tokens and user_integrations
    // directly; now the RPC does both in one transaction.
    assertEquals(state.calls.filter((c) => c.kind === "from"), [], `${provider}: no direct table access`);
    // API-key providers have no server-side grant to revoke.
    assertEquals(state.calls.filter((c) => c.kind === "fetch"), []);
  }
});

Deno.test("mobile-integration-sync: a disconnect RPC error returns 500, not 'disconnected'", async () => {
  const state: State = { calls: [], disconnectError: { code: "XX000", message: "internal db detail" } };
  const res = await silenced(() => handlerFor(state)(post({ provider: "hevy", action: "disconnect" })));
  assertEquals(res.status, 500);
  const body = await res.json();
  assertEquals(body.status, "error");
  assert(!JSON.stringify(body).includes("internal db detail"), "DB detail not echoed");
  assert(state.calls.some(isDisconnectRpc));
});

Deno.test("mobile-integration-sync: disconnect is not subscription gated", async () => {
  const state: State = { calls: [], disconnectError: null };
  const res = await silenced(() => handlerFor(state)(post({ provider: "hevy", action: "disconnect" })));
  assertEquals(res.status, 200);
  assertEquals(state.calls.filter((c) => c.kind === "from" && c.table === "subscriptions"), []);
});

// ---------------------------------------------------------------------------
// Imports (F-020 / #204): shared Liftosaur fetcher + resumable backfill, and a
// Hevy backfill that never truncates silently. In-process DB double, fake
// providers; no real provider calls.
// ---------------------------------------------------------------------------

const NOW_MS = Date.parse("2026-09-19T12:00:00.000Z");

function importDb(provider: string, lastSyncAt: string | null = null): FakeDb {
  return new FakeDb({
    subscriptions: [{
      user_id: USER_ID,
      tier: "FLAME",
      status: "active",
      current_period_end: "2099-01-01T00:00:00.000Z",
    }],
    oauth_tokens: [{ user_id: USER_ID, provider, api_key: "plain-api-key" }],
    user_integrations: [{ user_id: USER_ID, provider, status: "connected", last_sync_at: lastSyncAt }],
    external_activities: [],
  });
}

function importHandler(db: FakeDb, fetchImpl: typeof fetch, now: () => Date = () => new Date(NOW_MS)) {
  return createMobileIntegrationSyncHandler({
    createAuthClient: () => ({
      auth: { getUser: () => Promise.resolve({ data: { user: { id: USER_ID } } }) },
    }),
    // deno-lint-ignore no-explicit-any
    createAdminClient: () => fakeClient(db, null, now) as any,
    revoke: {
      fetch: (() => Promise.reject(new Error("no revoke expected"))) as typeof fetch,
      fitbitClientId: undefined,
      fitbitClientSecret: undefined,
      stravaClientId: undefined,
      stravaClientSecret: undefined,
      garminConsumerKey: undefined,
      garminConsumerSecret: undefined,
    },
    fetch: fetchImpl,
    now,
  });
}

/** Liftosaur /history, newest first, honouring endDate (exclusive) and cursor. */
function liftosaurApi(records: Array<{ id: number; at: number | null }>): typeof fetch {
  return ((input: string | URL | Request) => {
    const url = new URL(String(input));
    const end = url.searchParams.get("endDate");
    const window = records.filter((r) => end === null || (r.at !== null && r.at < Date.parse(end)));
    const cursor = Number(url.searchParams.get("cursor") ?? 0);
    const page = window.slice(cursor, cursor + 200).map((r) => ({
      id: r.id,
      text: `${r.at === null ? "" : `${new Date(r.at).toISOString()} / `}program: "P" / duration: 60s`,
    }));
    const next = cursor + page.length;
    return Promise.resolve(Response.json({
      data: { records: page, hasMore: next < window.length, nextCursor: next },
    }));
  }) as typeof fetch;
}

Deno.test("mobile-integration-sync: a Liftosaur history over one run's budget continues on the next sync, never silently truncated", async () => {
  const db = importDb("liftosaur");
  const newest = Date.parse("2026-09-01T00:00:00.000Z");
  const api = liftosaurApi(Array.from({ length: 2500 }, (_, i) => ({ id: i + 1, at: newest - i * 60_000 })));
  const handler = importHandler(db, api);

  const first = await silenced(() => handler(post({ provider: "liftosaur", action: "sync" })));
  assertEquals(first.status, 200, await first.clone().text());
  const firstBody = await first.json();
  assertEquals([firstBody.status, firstBody.truncated, firstBody.continuing], ["synced", true, true]);
  assertEquals(firstBody.activities.length, 2000);
  let [integration] = db.rows("user_integrations");
  assertEquals(integration.last_sync_at, null, "the watermark waits for the whole chain");
  assertEquals(typeof integration.backfill_before, "string");

  const second = await silenced(() => handler(post({ provider: "liftosaur", action: "sync" })));
  assertEquals(second.status, 200, await second.clone().text());
  const secondBody = await second.json();
  assertEquals([secondBody.status, secondBody.truncated], ["synced", undefined]);
  assertEquals(db.rows("external_activities").length, 2500);
  [integration] = db.rows("user_integrations");
  assertEquals(integration.last_sync_at, new Date(NOW_MS).toISOString());
  assertEquals(integration.backfill_before, null);
  // external_activities.synced_at is the server's pull cursor (NF-10).
  assert(db.rows("external_activities").every((row) => typeof row.synced_at === "string"));
});

Deno.test("mobile-integration-sync: an undated Liftosaur record keeps and reports one stored date across syncs", async () => {
  const db = importDb("liftosaur");
  const api = liftosaurApi([{ id: 7, at: null }]);
  let clock = NOW_MS;
  const handler = importHandler(db, api, () => new Date(clock));

  const first = await silenced(() => handler(post({ provider: "liftosaur", action: "sync" })));
  assertEquals(first.status, 200, await first.clone().text());
  const firstStart = (await first.json()).activities[0].startedAt;
  assertEquals(firstStart, new Date(NOW_MS).toISOString());

  clock += 3 * 60 * 60 * 1000;
  const second = await silenced(() => handler(post({ provider: "liftosaur", action: "sync" })));
  assertEquals(second.status, 200, await second.clone().text());
  assertEquals((await second.json()).activities[0].startedAt, firstStart, "never re-dated to now");
  assertEquals(db.rows("external_activities")[0].started_at, firstStart);
});

Deno.test("mobile-integration-sync: a failed stored-date lookup fails the sync instead of reporting a new date", async () => {
  const db = importDb("liftosaur");
  // Every read of stored dates fails: the batched refresh falls back to
  // per-row updates, and the DTO lookup cannot report the stored date.
  const from = db.from.bind(db);
  db.from = (table: string) => {
    const query = from(table);
    if (table === "external_activities") {
      const select = query.select.bind(query);
      query.select = (columns?: string) => {
        if (columns !== "external_id, started_at") return select(columns);
        const failed = {
          eq: () => failed,
          in: () => failed,
          then: (resolve: (value: unknown) => unknown) =>
            Promise.resolve({ data: null, error: { message: "read failed" } }).then(resolve),
        };
        // deno-lint-ignore no-explicit-any
        return failed as any;
      };
    }
    return query;
  };
  const handler = importHandler(db, liftosaurApi([{ id: 7, at: null }]));

  const res = await silenced(() => handler(post({ provider: "liftosaur", action: "sync" })));
  assertEquals(res.status, 500, await res.clone().text());
  assertEquals(db.rows("external_activities").length, 1, "the row itself is stored");
  const [integration] = db.rows("user_integrations");
  assertEquals(integration.last_sync_at, null, "nothing advances");
});

Deno.test("mobile-integration-sync: a Hevy backfill past its page budget is stored, reported, and never advances the watermark", async () => {
  const db = importDb("hevy", "2026-09-01T00:00:00.000Z");
  const hevy = ((input: string | URL | Request) => {
    const url = new URL(String(input));
    const page = Number(url.searchParams.get("page"));
    const workouts = Array.from({ length: 10 }, (_, i) => ({
      id: `w-${page}-${i}`,
      title: "Workout",
      start_time: "2026-08-01T10:00:00Z",
      end_time: "2026-08-01T11:00:00Z",
      exercises: [],
    }));
    return Promise.resolve(Response.json({ page, page_count: 101, workouts }));
  }) as typeof fetch;

  const res = await silenced(() => importHandler(db, hevy)(post({ provider: "hevy", action: "sync" })));
  assertEquals(res.status, 500);
  const body = await res.json();
  assertEquals([body.code, body.truncated, body.imported], ["history_truncated", true, 1000]);
  assertEquals(db.rows("external_activities").length, 1000);
  const [integration] = db.rows("user_integrations");
  assertEquals(integration.last_sync_at, "2026-09-01T00:00:00.000Z");
  assertEquals(integration.status, "error");
});
