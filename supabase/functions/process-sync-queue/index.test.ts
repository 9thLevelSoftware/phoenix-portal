import { assert, assertEquals } from "jsr:@std/assert@1";
import { FakeDb, type Row } from "../_shared/testing/fakeSupabase.ts";
import {
  createProcessSyncQueueHandler,
  type ProcessSyncQueueDependencies,
  tasksPerProvider,
} from "./index.ts";

const SERVICE_ROLE_KEY = "test-service-role-key";
const CRON_SECRET = "test-cron-secret";
const SUPABASE_URL = "http://edge.test";
const USER_ID = "00000000-0000-4000-8000-000000000001";
const TASK_ID = "00000000-0000-4000-8000-0000000000aa";

type ProviderResponder = (body: Record<string, unknown>) => Response;

const ok200: ProviderResponder = () =>
  new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

interface Harness {
  handler: (req: Request) => Promise<Response>;
  db: FakeDb;
  fetchCalls: Array<{ url: string; init?: RequestInit }>;
  clientsCreated: { value: number };
}

function harness(
  env: Record<string, string>,
  tables: Record<string, Row[]> = {},
  respond: ProviderResponder = ok200,
): Harness {
  const db = new FakeDb(tables);
  const fetchCalls: Harness["fetchCalls"] = [];
  const clientsCreated = { value: 0 };
  const deps: ProcessSyncQueueDependencies = {
    env: (key) => env[key],
    createAdminClient: () => {
      clientsCreated.value++;
      // deno-lint-ignore no-explicit-any
      return db as any;
    },
    fetch: (input, init) => {
      fetchCalls.push({ url: String(input), init });
      return Promise.resolve(respond(JSON.parse(String(init?.body ?? "{}"))));
    },
  };
  return {
    handler: createProcessSyncQueueHandler(deps),
    db,
    fetchCalls,
    clientsCreated,
  };
}

const BASE_ENV = {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: SERVICE_ROLE_KEY,
  CRON_SECRET,
};

function cronRequest(headers: Record<string, string> = {}): Request {
  return new Request(`${SUPABASE_URL}/functions/v1/process-sync-queue`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: "{}",
  });
}

Deno.test("process-sync-queue: missing x-cron-secret gives 401 and touches nothing", async () => {
  const h = harness(BASE_ENV);
  const res = await h.handler(cronRequest());
  assertEquals(res.status, 401);
  assertEquals(h.clientsCreated.value, 0);
  assertEquals(h.fetchCalls.length, 0);
});

Deno.test("process-sync-queue: wrong x-cron-secret gives 401", async () => {
  const h = harness(BASE_ENV);
  const res = await h.handler(cronRequest({ "x-cron-secret": "not-the-secret" }));
  assertEquals(res.status, 401);
  assertEquals(h.clientsCreated.value, 0);
});

Deno.test("process-sync-queue: no secret configured rejects even an empty header", async () => {
  const h = harness({ SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: SERVICE_ROLE_KEY });
  const res = await h.handler(cronRequest({ "x-cron-secret": "" }));
  assertEquals(res.status, 401);
});

Deno.test("process-sync-queue: a user JWT that is not the service role gives 401", async () => {
  const h = harness(BASE_ENV);
  const res = await h.handler(cronRequest({ Authorization: "Bearer some-user-jwt" }));
  assertEquals(res.status, 401);
});

Deno.test("process-sync-queue: the legacy PROCESS_SYNC_QUEUE_SECRET name is still accepted", async () => {
  const h = harness({
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: SERVICE_ROLE_KEY,
    PROCESS_SYNC_QUEUE_SECRET: "legacy-secret",
  });
  const res = await h.handler(cronRequest({ "x-cron-secret": "legacy-secret" }));
  assertEquals(res.status, 200);
});

Deno.test("process-sync-queue: a pending initial task is dispatched and completed", async () => {
  const h = harness(BASE_ENV, {
    sync_queue: [
      {
        id: TASK_ID,
        user_id: USER_ID,
        provider: "strava",
        sync_type: "initial",
        status: "pending",
        created_at: "2026-09-19T00:00:00.000Z",
        retry_count: 0,
        error_message: null,
        started_at: null,
        completed_at: null,
      },
    ],
    subscriptions: [
      {
        user_id: USER_ID,
        tier: "FLAME",
        status: "active",
        current_period_end: "2099-01-01T00:00:00.000Z",
      },
    ],
    rate_limit_tracking: [],
  });

  const res = await h.handler(cronRequest({ "x-cron-secret": CRON_SECRET }));
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { processed: 1, failed: 0, skipped: 0 });

  assertEquals(h.fetchCalls.length, 1);
  const call = h.fetchCalls[0];
  assertEquals(call.url, `${SUPABASE_URL}/functions/v1/strava-sync`);
  const headers = new Headers(call.init?.headers);
  assertEquals(headers.get("Authorization"), `Bearer ${SERVICE_ROLE_KEY}`);
  assertEquals(JSON.parse(String(call.init?.body)), {
    user_id: USER_ID,
    sync_type: "initial",
    queue_id: TASK_ID,
  });

  const task = h.db.tables.sync_queue[0];
  assertEquals(task.status, "completed");
  assert(typeof task.started_at === "string");
  assert(typeof task.completed_at === "string");

  // The request is charged against Strava's app-wide bucket.
  const bucket = h.db.tables.rate_limit_tracking.find((r) => r.key === "strava");
  assertEquals(bucket?.user_id, null);
  assertEquals(bucket?.requests_this_window, 1);
});

Deno.test("process-sync-queue: an initial and a newer incremental for one user are both dispatched, initial first", async () => {
  const INCREMENTAL_ID = "00000000-0000-4000-8000-0000000000bb";
  const pending = (id: string, syncType: string, createdAt: string): Row => ({
    id,
    user_id: USER_ID,
    provider: "strava",
    sync_type: syncType,
    status: "pending",
    created_at: createdAt,
    retry_count: 0,
    error_message: null,
    started_at: null,
    completed_at: null,
  });
  const h = harness(BASE_ENV, {
    // Inserted newest-first to prove the processor orders by created_at.
    sync_queue: [
      pending(INCREMENTAL_ID, "incremental", "2026-09-19T00:00:00.000Z"),
      pending(TASK_ID, "initial", "2026-09-14T00:00:00.000Z"),
    ],
    subscriptions: [
      {
        user_id: USER_ID,
        tier: "FLAME",
        status: "active",
        current_period_end: "2099-01-01T00:00:00.000Z",
      },
    ],
    rate_limit_tracking: [],
  });

  const res = await h.handler(cronRequest({ "x-cron-secret": CRON_SECRET }));
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { processed: 2, failed: 0, skipped: 0 });

  assertEquals(
    h.fetchCalls.map((c) => JSON.parse(String(c.init?.body)).sync_type),
    ["initial", "incremental"],
  );
  assertEquals(
    h.db.tables.sync_queue.map((r) => r.status),
    ["completed", "completed"],
  );
});

function pendingRow(id: string, syncType: string, createdAt: string, extra: Row = {}): Row {
  return {
    id,
    user_id: USER_ID,
    provider: "strava",
    sync_type: syncType,
    status: "pending",
    created_at: createdAt,
    retry_count: 0,
    error_message: null,
    started_at: null,
    completed_at: null,
    ...extra,
  };
}

const FLAME_SUBSCRIPTION: Row = {
  user_id: USER_ID,
  tier: "FLAME",
  status: "active",
  current_period_end: "2099-01-01T00:00:00.000Z",
};

Deno.test("process-sync-queue: a retryable initial failure keeps the same user's newer row pending in that pass", async () => {
  const INCREMENTAL_ID = "00000000-0000-4000-8000-0000000000bb";
  const h = harness(
    BASE_ENV,
    {
      sync_queue: [
        pendingRow(TASK_ID, "initial", "2026-09-14T00:00:00.000Z"),
        pendingRow(INCREMENTAL_ID, "incremental", "2026-09-19T00:00:00.000Z"),
      ],
      subscriptions: [FLAME_SUBSCRIPTION],
      rate_limit_tracking: [],
    },
    (body) =>
      body.sync_type === "initial"
        ? new Response("partial backfill", { status: 502 })
        : ok200(body),
  );

  const res = await h.handler(cronRequest({ "x-cron-secret": CRON_SECRET }));
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { processed: 0, failed: 1, skipped: 1 });

  // Only the initial was dispatched (3 backOff attempts), never the incremental.
  assertEquals(
    h.fetchCalls.map((c) => JSON.parse(String(c.init?.body)).sync_type),
    ["initial", "initial", "initial"],
  );
  const [initial, incremental] = h.db.tables.sync_queue;
  assertEquals(initial.status, "pending");
  assertEquals(initial.retry_count, 1);
  assertEquals(incremental.status, "pending");
  assertEquals(incremental.started_at, null);
});

Deno.test("process-sync-queue: a pending row is not claimed while the pair has a live processing row", async () => {
  const LIVE_ID = "00000000-0000-4000-8000-0000000000cc";
  const h = harness(BASE_ENV, {
    sync_queue: [
      pendingRow(LIVE_ID, "initial", "2026-09-14T00:00:00.000Z", {
        status: "processing",
        // Heartbeat well inside Strava's 5-minute lease.
        started_at: new Date(Date.now() - 2 * 60 * 1000).toISOString(),
        // Well inside the 30-minute lease.
        started_at: new Date(Date.now() - 6 * 60 * 1000).toISOString(),
      }),
      pendingRow(TASK_ID, "manual", "2026-09-19T00:00:00.000Z"),
    ],
    subscriptions: [FLAME_SUBSCRIPTION],
    rate_limit_tracking: [],
  });

  const res = await h.handler(cronRequest({ "x-cron-secret": CRON_SECRET }));
  assertEquals(await res.json(), { processed: 0, failed: 0, skipped: 1 });
  assertEquals(h.fetchCalls.length, 0);
  assertEquals(h.db.tables.sync_queue.map((r) => r.status), ["processing", "pending"]);
});

Deno.test("process-sync-queue: the exact service-role bearer (no cron secret) is accepted", async () => {
  const h = harness(BASE_ENV);
  const res = await h.handler(cronRequest({ Authorization: `Bearer ${SERVICE_ROLE_KEY}` }));
  assertEquals(res.status, 200);
  assertEquals(h.clientsCreated.value, 1);
});

Deno.test("process-sync-queue: a near-miss service-role bearer gives 401", async () => {
  for (const authorization of [
    `Bearer ${SERVICE_ROLE_KEY}x`,
    `bearer ${SERVICE_ROLE_KEY}`,
    SERVICE_ROLE_KEY,
    `Bearer ${SERVICE_ROLE_KEY.slice(0, -1)}`,
  ]) {
    const h = harness(BASE_ENV);
    const res = await h.handler(cronRequest({ Authorization: authorization }));
    assertEquals(res.status, 401, authorization);
    assertEquals(h.clientsCreated.value, 0);
  }
});

const minutesAgo = (minutes: number) =>
  new Date(Date.now() - minutes * 60 * 1000).toISOString();

function leaseHarness(provider: string, startedAt: string) {
  return harness(BASE_ENV, {
    sync_queue: [
      pendingRow(TASK_ID, "initial", "2026-09-14T00:00:00.000Z", {
        provider,
        status: "processing",
        started_at: startedAt,
      }),
    ],
    subscriptions: [FLAME_SUBSCRIPTION],
    rate_limit_tracking: [],
  });
}

// strava, hevy and liftosaur heartbeat while they run (heartbeatSyncQueueEntry
// in _shared/syncQueue.ts), so a 5-minute silence means the worker is gone.
for (const provider of ["strava", "hevy", "liftosaur"]) {
  Deno.test(`process-sync-queue: a ${provider} row whose heartbeat is older than 5 minutes is reclaimed`, async () => {
    const h = leaseHarness(provider, minutesAgo(6));

    const res = await h.handler(cronRequest({ "x-cron-secret": CRON_SECRET }));
    assertEquals(await res.json(), { processed: 1, failed: 0, skipped: 0 });
    // Reclaimed (one retry charged) and re-dispatched in the same pass.
    assertEquals(h.fetchCalls.length, 1);
    assertEquals(h.fetchCalls[0].url, `${SUPABASE_URL}/functions/v1/${provider}-sync`);
    const [task] = h.db.tables.sync_queue;
    assertEquals(task.retry_count, 1);
    assertEquals(task.status, "completed");
  });

  Deno.test(`process-sync-queue: a ${provider} row that heartbeated 4.5 minutes ago keeps its lease`, async () => {
    const h = leaseHarness(provider, minutesAgo(4.5));

    const res = await h.handler(cronRequest({ "x-cron-secret": CRON_SECRET }));
    assertEquals(await res.json(), { processed: 0, failed: 0, skipped: 0 });
    assertEquals(h.fetchCalls.length, 0);
    assertEquals(h.db.tables.sync_queue[0].status, "processing");
    assertEquals(h.db.tables.sync_queue[0].retry_count, 0);
  });
}

// fitbit never heartbeats and garmin is never dispatched, so both keep the
// long lease: a 5-minute one would reclaim live fitbit runs.
for (const provider of ["fitbit", "garmin"]) {
  Deno.test(`process-sync-queue: a ${provider} row keeps the 30-minute lease`, async () => {
    const h = leaseHarness(provider, minutesAgo(6));

    const res = await h.handler(cronRequest({ "x-cron-secret": CRON_SECRET }));
    assertEquals(await res.json(), { processed: 0, failed: 0, skipped: 0 });
    assertEquals(h.fetchCalls.length, 0);
    assertEquals(h.db.tables.sync_queue[0].status, "processing");
    assertEquals(h.db.tables.sync_queue[0].retry_count, 0);
  });

  Deno.test(`process-sync-queue: a ${provider} row idle for 31 minutes is still reclaimed`, async () => {
    const h = leaseHarness(provider, minutesAgo(31));

    const res = await h.handler(cronRequest({ "x-cron-secret": CRON_SECRET }));
    // garmin is rejected by callSyncFunction (webhook-driven), so it fails
    // after being reclaimed (a second retry charged); fitbit is dispatched.
    assertEquals(h.db.tables.sync_queue[0].retry_count, provider === "garmin" ? 2 : 1);
    assertEquals(
      h.db.tables.sync_queue[0].status,
      provider === "garmin" ? "failed" : "completed",
    );
    await res.body?.cancel();
  });
}

// ---------------------------------------------------------------------------
// Dispatch budget derived from the provider quotas (PR 52)
// ---------------------------------------------------------------------------

Deno.test("process-sync-queue: the per-pass budget comes from each provider's quota", () => {
  // Strava: 800 reads/day over 288 five-minute passes = 2 (its 15-minute
  // window would allow 26; the tightest window wins).
  assertEquals(tasksPerProvider("strava"), 2);
  // Garmin: 40/hour app-wide = 3 per pass.
  assertEquals(tasksPerProvider("garmin"), 3);
  // User-scoped quotas say nothing about how many users may run per pass.
  assertEquals(tasksPerProvider("fitbit"), 5);
  assertEquals(tasksPerProvider("hevy"), 5);
  assertEquals(tasksPerProvider("liftosaur"), 5);
  // An unknown provider falls back to the wall-clock ceiling.
  assertEquals(tasksPerProvider("nordic-track"), 5);
});

Deno.test("process-sync-queue: a pass dispatches no more strava tasks than the quota allows", async () => {
  const users = [
    "00000000-0000-4000-8000-00000000000a",
    "00000000-0000-4000-8000-00000000000b",
    "00000000-0000-4000-8000-00000000000c",
  ];
  const h = harness(BASE_ENV, {
    sync_queue: users.map((user, i) => ({
      ...pendingRow(
        `00000000-0000-4000-8000-00000000001${i}`,
        "incremental",
        `2026-09-1${i + 1}T00:00:00.000Z`,
      ),
      user_id: user,
    })),
    subscriptions: users.map((user) => ({ ...FLAME_SUBSCRIPTION, user_id: user })),
    rate_limit_tracking: [],
  });

  const res = await h.handler(cronRequest({ "x-cron-secret": CRON_SECRET }));
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { processed: 2, failed: 0, skipped: 0 });
  assertEquals(h.fetchCalls.length, 2);
  // Oldest first; the third waits for the next pass.
  assertEquals(
    h.db.tables.sync_queue.map((r) => r.status),
    ["completed", "completed", "pending"],
  );
});

Deno.test("process-sync-queue: a row that left `processing` mid-run is not overwritten (R-7)", async () => {
  for (const outcome of ["success", "failure"]) {
    let db: FakeDb | null = null;
    const h = harness(
      BASE_ENV,
      {
        sync_queue: [pendingRow(TASK_ID, "incremental", "2026-09-19T00:00:00.000Z")],
        subscriptions: [FLAME_SUBSCRIPTION],
        rate_limit_tracking: [],
      },
      () => {
        // While the provider sync runs, the row leaves `processing`: another
        // pass reclaimed its expired lease, or a disconnect cancelled it.
        db!.tables.sync_queue[0].status = "cancelled";
        return new Response(
          JSON.stringify(outcome === "success" ? { ok: true } : { error: "nope" }),
          { status: outcome === "success" ? 200 : 500 },
        );
      },
    );
    db = h.db;

    const res = await h.handler(cronRequest({ "x-cron-secret": CRON_SECRET }));
    await res.body?.cancel();
    assertEquals(h.db.tables.sync_queue[0].status, "cancelled", outcome);
    assertEquals(h.db.tables.sync_queue[0].completed_at, null, outcome);
  }
});
