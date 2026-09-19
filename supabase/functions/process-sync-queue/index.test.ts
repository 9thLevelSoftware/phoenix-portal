import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  createProcessSyncQueueHandler,
  type ProcessSyncQueueDependencies,
} from "./index.ts";

type Row = Record<string, unknown>;
type Filter = (row: Row) => boolean;

const SERVICE_ROLE_KEY = "test-service-role-key";
const CRON_SECRET = "test-cron-secret";
const SUPABASE_URL = "http://edge.test";
const USER_ID = "00000000-0000-4000-8000-000000000001";
const TASK_ID = "00000000-0000-4000-8000-0000000000aa";

/**
 * Minimal in-memory stand-in for the service-role client: enough of the
 * PostgREST builder (select/update/insert, eq/is/lt, order/limit,
 * maybeSingle, await) for process-sync-queue.
 */
class FakeDb {
  tables: Record<string, Row[]>;
  constructor(tables: Record<string, Row[]>) {
    this.tables = tables;
  }
  from(table: string) {
    this.tables[table] ??= [];
    return new FakeQuery(this.tables[table]);
  }
}

class FakeQuery implements PromiseLike<{ data: unknown; error: null }> {
  private filters: Filter[] = [];
  private patch: Row | null = null;
  private insertRow: Row | null = null;
  private single = false;
  private orderBy: { col: string; asc: boolean } | null = null;
  private max: number | null = null;

  constructor(private rows: Row[]) {}

  select(_cols?: string) {
    return this;
  }
  update(patch: Row) {
    this.patch = patch;
    return this;
  }
  insert(row: Row) {
    this.insertRow = row;
    return this;
  }
  eq(col: string, value: unknown) {
    this.filters.push((r) => r[col] === value);
    return this;
  }
  is(col: string, value: unknown) {
    this.filters.push((r) => (r[col] ?? null) === value);
    return this;
  }
  lt(col: string, value: string) {
    this.filters.push((r) => typeof r[col] === "string" && (r[col] as string) < value);
    return this;
  }
  order(col: string, opts: { ascending: boolean }) {
    this.orderBy = { col, asc: opts.ascending };
    return this;
  }
  limit(n: number) {
    this.max = n;
    return this;
  }
  maybeSingle() {
    this.single = true;
    return this;
  }

  private run(): { data: unknown; error: null } {
    if (this.insertRow) {
      this.rows.push({ ...this.insertRow });
      return { data: null, error: null };
    }
    let matched = this.rows.filter((r) => this.filters.every((f) => f(r)));
    if (this.patch) {
      for (const r of matched) Object.assign(r, this.patch);
    }
    if (this.orderBy) {
      const { col, asc } = this.orderBy;
      matched = [...matched].sort((a, b) =>
        String(a[col]).localeCompare(String(b[col])) * (asc ? 1 : -1)
      );
    }
    if (this.max !== null) matched = matched.slice(0, this.max);
    const copies = matched.map((r) => ({ ...r }));
    return { data: this.single ? copies[0] ?? null : copies, error: null };
  }

  then<T1 = { data: unknown; error: null }, T2 = never>(
    onfulfilled?: ((v: { data: unknown; error: null }) => T1 | PromiseLike<T1>) | null,
    onrejected?: ((reason: unknown) => T2 | PromiseLike<T2>) | null,
  ): PromiseLike<T1 | T2> {
    return Promise.resolve(this.run()).then(onfulfilled, onrejected);
  }
}

interface Harness {
  handler: (req: Request) => Promise<Response>;
  db: FakeDb;
  fetchCalls: Array<{ url: string; init?: RequestInit }>;
  clientsCreated: { value: number };
}

function harness(
  env: Record<string, string>,
  tables: Record<string, Row[]> = {},
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
      return Promise.resolve(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
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
