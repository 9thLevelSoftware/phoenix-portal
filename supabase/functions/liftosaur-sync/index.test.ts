import { assert, assertEquals } from "jsr:@std/assert@1";
import { createLiftosaurSyncHandler } from "./index.ts";

// Handler tests with in-process doubles: an in-memory Supabase client and a
// fake Liftosaur API whose `startDate` filters on workout date. No real
// provider calls.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { localIntegrationEnvironment } from "../_shared/localIntegrationEnvironment.ts";
import { createLiftosaurSyncHandler } from "./index.ts";

// Handler tests with in-process doubles: an in-memory Supabase client and a
// fake Liftosaur API that, like the real one, returns /history newest-first,
// filters `startDate`/`endDate` on workout date, and pages with an opaque
// cursor. No real provider calls.

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
    let inFilter: unknown[] | null = null;

    const resolve = () => {
const DAY = 24 * HOUR;

interface QueueRow {
  user_id: string;
  provider: string;
  sync_type: string;
  status: string;
}

interface DbState {
  lastSyncAt: string | null;
  backfillBefore?: string | null;
  backfillAfter?: string | null;
  backfillStartedAt?: string | null;
  activities: Array<Record<string, unknown>>;
  status?: string;
  errorMessage?: string | null;
  queue?: QueueRow[];
  failQueueInsert?: boolean;
}

function createDbDouble(state: DbState) {
  state.queue ??= [];
  const from = (table: string) => {
    let pendingUpdate: Record<string, unknown> | null = null;
    const filters: Record<string, unknown> = {};

    const resolve = () => {
      if (table === "external_activities" && pendingUpdate) {
        const row = state.activities.find((existing) =>
          existing.external_id === filters.external_id &&
          existing.user_id === filters.user_id
        );
        if (row) Object.assign(row, pendingUpdate);
        return { data: null, error: null };
      }
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
      if (table === "external_activities" && inFilter) {
        const ids = inFilter;
        return {
          data: state.activities
            .filter((row) => ids.includes(row.external_id))
            .map((row) => ({ external_id: row.external_id })),
          const u = pendingUpdate;
          if ("last_sync_at" in u) state.lastSyncAt = u.last_sync_at as string;
          if ("backfill_before" in u) state.backfillBefore = u.backfill_before as string | null;
          if ("backfill_after" in u) state.backfillAfter = u.backfill_after as string | null;
          if ("backfill_started_at" in u) {
            state.backfillStartedAt = u.backfill_started_at as string | null;
          }
          if ("status" in u) state.status = u.status as string;
          if ("error_message" in u) state.errorMessage = u.error_message as string | null;
          return { data: null, error: null };
        }
        return {
          data: {
            last_sync_at: state.lastSyncAt,
            backfill_before: state.backfillBefore ?? null,
            backfill_after: state.backfillAfter ?? null,
            backfill_started_at: state.backfillStartedAt ?? null,
          },
          error: null,
        };
      }
      if (table === "sync_queue") {
        if (pendingUpdate) {
          // The handler's blanket completion of pending tasks.
          for (const row of state.queue!) {
            if (row.status === "pending") row.status = pendingUpdate.status as string;
          }
          return { data: null, error: null };
        }
        return {
          data: state.queue!.filter((row) => row.status === "pending").map(() => ({ id: "q" })),
          error: null,
        };
      }
      return { data: null, error: null };
    };

    const builder: Record<string, unknown> = {};
    for (const method of ["select", "eq", "order", "limit"]) {
      builder[method] = () => builder;
    }
    builder.in = (_column: string, values: unknown[]) => {
      inFilter = values;
    for (const method of ["select", "order", "limit"]) {
      builder[method] = () => builder;
    }
    builder.eq = (column: string, value: unknown) => {
      filters[column] = value;
      return builder;
    };
    builder.update = (values: Record<string, unknown>) => {
      pendingUpdate = values;
      return builder;
    };
    builder.upsert = (row: Record<string, unknown>) => {
      if (table === "external_activities") {
        const index = state.activities.findIndex((existing) =>
          existing.external_id === row.external_id
        );
        // ON CONFLICT DO UPDATE only sets the columns that were sent.
    builder.insert = (row: QueueRow) => {
      if (table === "sync_queue") {
        if (state.failQueueInsert) {
          return Promise.resolve({ data: null, error: { message: "insert failed" } });
        }
        state.queue!.push(row);
      }
      return Promise.resolve({ data: null, error: null });
    };
    builder.upsert = (
      row: Record<string, unknown>,
      options?: { ignoreDuplicates?: boolean },
    ) => {
      if (table === "external_activities") {
        // Like Postgres: NOT NULL is checked on the proposed INSERT row before
        // ON CONFLICT, so an upsert without started_at fails even when the
        // row already exists.
        if (!("started_at" in row)) {
          return Promise.resolve({
            data: null,
            error: { code: "23502", message: "null value in column started_at" },
          });
        }
        const index = state.activities.findIndex((existing) =>
          existing.external_id === row.external_id
        );
        // ignoreDuplicates = ON CONFLICT DO NOTHING: the stored row is kept.
        // Otherwise ON CONFLICT DO UPDATE only sets the columns that were sent.
        if (index >= 0 && options?.ignoreDuplicates) {
          return Promise.resolve({ data: null, error: null });
        }
        if (index >= 0) {
          state.activities[index] = { ...state.activities[index], ...row };
        } else {
          if (!("started_at" in row)) {
            return Promise.resolve({
              data: null,
              error: { message: "null value in column started_at" },
            });
          }
          state.activities.push(row);
        }
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
  /** Omitted for a record whose Liftoscript text has no timestamp. */
  date?: string;
  /** Overrides the default Liftoscript tail. */
  body?: string;
}

const FAKE_RESPONSE_DELAY_MS = 5;

function installFakeLiftosaur(upstream: UpstreamRecord[]) {
interface FakeOptions {
  /** Default "desc": newest first, as the real API returns /history. */
  order?: "desc" | "asc";
  /** Make every call return this HTTP status / raw body instead. */
  failWith?: { status: number; body: string };
}

function installFakeLiftosaur(upstream: UpstreamRecord[], options: FakeOptions = {}) {
  const originalFetch = globalThis.fetch;
  const fake = {
    requests: [] as URL[],
    firstRequestAt: null as number | null,
    restore: () => {
      globalThis.fetch = originalFetch;
    },
  };
  globalThis.fetch = ((input: string | URL | Request) => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
    );
    if (url.hostname !== "www.liftosaur.com" || url.pathname !== "/api/v1/history") {
      throw new Error(`Unexpected fetch in test: ${url.href}`);
    }
    fake.requests.push(url);
    fake.firstRequestAt ??= Date.now();
    const startDate = url.searchParams.get("startDate");
    const records = upstream
      .filter((record) =>
        startDate === null || record.date === undefined ||
        Date.parse(record.date) >= Date.parse(startDate)
      )
      .map((record) => ({
        id: record.id,
        text: `${record.date ? `${record.date} / ` : ""}program: "Test" / dayName: "Day ${record.id}" / duration: 3600s`,
      }));
    const response = new Response(
      JSON.stringify({ data: { records, hasMore: false, nextCursor: null } }),
    if (options.failWith) {
      return Promise.resolve(
        new Response(options.failWith.body, { status: options.failWith.status }),
      );
    }
    const startDate = url.searchParams.get("startDate");
    const endDate = url.searchParams.get("endDate");
    const dated = upstream.filter((record) => record.date !== undefined);
    const undated = upstream.filter((record) => record.date === undefined);
    const direction = options.order === "asc" ? 1 : -1;
    const matching = [
      ...dated
        .filter((record) =>
          (startDate === null || Date.parse(record.date!) >= Date.parse(startDate)) &&
          (endDate === null || Date.parse(record.date!) <= Date.parse(endDate))
        )
        .sort((a, b) => direction * (Date.parse(a.date!) - Date.parse(b.date!))),
      ...undated,
    ].map((record) => ({
      id: record.id,
      text: `${record.date ? `${record.date} / ` : ""}${
        record.body ?? `program: "Test" / dayName: "Day ${record.id}" / duration: 3600s`
      }`,
    }));
    // Pages of `limit`; the cursor is an offset.
    const limit = Number(url.searchParams.get("limit") ?? "200");
    const offset = Number(url.searchParams.get("cursor") ?? "0");
    const records = matching.slice(offset, offset + limit);
    const hasMore = offset + limit < matching.length;
    const response = new Response(
      JSON.stringify({
        data: { records, hasMore, nextCursor: hasMore ? offset + limit : null },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
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
  } finally {
    if (previousKey === undefined) Deno.env.delete("SUPABASE_SERVICE_ROLE_KEY");
    else Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", previousKey);
  }
}

function isoSeconds(ms: number): string {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** `count` records dated `stepMs` apart starting at `firstMs`. */
function datedRecords(count: number, firstMs: number, stepMs: number): UpstreamRecord[] {
  return Array.from({ length: count }, (_, i) => ({
    id: 1000 + i,
    date: isoSeconds(firstMs + i * stepMs),
  }));
}

const pendingFollowUps = (state: DbState) =>
  (state.queue ?? []).filter((row) => row.status === "pending").length;

Deno.test("liftosaur-sync imports a workout logged late with a date before the last sync", async () => {
  const now = Date.now();
  const lastSync = new Date(now - 6 * HOUR).toISOString();
  const state: DbState = { lastSyncAt: lastSync, activities: [] };
  // Performed three hours before the last sync, but logged only after it.
  const lateWorkout = {
    id: 7,
    date: new Date(now - 9 * HOUR).toISOString().replace(/\.\d{3}Z$/, "Z"),
  };
  const lateWorkout = { id: 7, date: isoSeconds(now - 9 * HOUR) };
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

Deno.test("liftosaur-sync captures the new watermark before fetching", async () => {
  const state: DbState = {
    lastSyncAt: new Date(Date.now() - 6 * HOUR).toISOString(),
    activities: [],
  };
  const liftosaur = installFakeLiftosaur([]);
  try {
    const response = await runSync(state, "incremental");
    assertEquals(response.status, 200, await response.clone().text());
    assert(liftosaur.firstRequestAt !== null);
    assert(
      Date.parse(state.lastSyncAt!) < liftosaur.firstRequestAt! + FAKE_RESPONSE_DELAY_MS,
      `last_sync_at ${state.lastSyncAt} must not be later than the first fetch`,
    );
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
    assertEquals(liftosaur.requests[0].searchParams.has("endDate"), false);
  } finally {
    liftosaur.restore();
  }
});

Deno.test("liftosaur-sync keeps the stored date of an undated record re-fetched in the overlap", async () => {
  const state: DbState = {
    lastSyncAt: new Date(Date.now() - 6 * HOUR).toISOString(),
    activities: [],
  };
  const liftosaur = installFakeLiftosaur([{ id: 8 }]);
  try {
    const first = await runSync(state, "incremental");
    assertEquals(first.status, 200, await first.clone().text());
    const firstStartedAt = state.activities[0].started_at;
    assert(typeof firstStartedAt === "string");

    // Let the clock move so a re-stamp would be observable.
    await new Promise((resolve) => setTimeout(resolve, 10));
    const second = await runSync(state, "incremental");
    assertEquals(second.status, 200, await second.clone().text());
    assertEquals(state.activities.length, 1);
    assertEquals(state.activities[0].started_at, firstStartedAt);
  } finally {
    liftosaur.restore();
  }
});

Deno.test("liftosaur-sync: 11 newest-first pages -> backfill continues downward; watermark not advanced until the end", async () => {
  const now = Date.now();
  const lastSync = new Date(now - 200 * DAY).toISOString();
  const state: DbState = { lastSyncAt: lastSync, activities: [] };
  // 2,200 records = 11 pages of 200; one run reads 10.
  const upstream = datedRecords(2200, now - 199 * DAY, HOUR);
  const liftosaur = installFakeLiftosaur(upstream);
  try {
    const first = await runSync(state, "incremental");
    const body = await first.json();
    assertEquals(first.status, 200, JSON.stringify(body));
    assertEquals(body.truncated, true);
    assertEquals(body.continuing, true);
    assertEquals(body.reason, "page_budget");
    assertEquals(liftosaur.requests.length, 10);
    assertEquals(state.activities.length, 2000);

    // The watermark is NOT advanced (neither to syncStartedAt nor anywhere).
    assertEquals(state.lastSyncAt, lastSync);
    // The 2,000 newest were read; the next run asks for records up to the
    // oldest of them (+1s).
    const oldestRead = Date.parse(upstream[200].date!);
    assertEquals(state.backfillBefore, new Date(oldestRead + 1000).toISOString());
    assert(Date.parse(state.backfillStartedAt!) <= liftosaur.firstRequestAt!);
    const chainStartedAt = state.backfillStartedAt;
    assertEquals(state.status, "connected");
    assert(String(state.errorMessage).includes("Importing Liftosaur history"));
    // A follow-up run is queued so the import finishes without user action.
    assertEquals(pendingFollowUps(state), 1);

    const backfillBefore = state.backfillBefore;
    const second = await runSync(state, "incremental");
    assertEquals(second.status, 200, await second.clone().text());
    const secondRequest = liftosaur.requests[10];
    assertEquals(secondRequest.searchParams.get("endDate"), backfillBefore);
    assertEquals(
      secondRequest.searchParams.get("startDate"),
      new Date(Date.parse(lastSync) - 72 * HOUR).toISOString(),
    );
    assertEquals(state.activities.length, 2200);
    assertEquals(state.lastSyncAt, chainStartedAt);
    assertEquals(state.backfillBefore, null);
    assertEquals(state.backfillStartedAt, null);
    assertEquals(state.errorMessage, null);
  } finally {
    liftosaur.restore();
  }
});

Deno.test("liftosaur-sync: a 4,500-record initial import finishes over successive runs", async () => {
  const now = Date.now();
  const state: DbState = { lastSyncAt: null, activities: [] };
  const upstream = datedRecords(4500, now - 400 * DAY, 2 * HOUR);
  const liftosaur = installFakeLiftosaur(upstream);
  try {
    let runs = 0;
    for (; runs < 10; runs++) {
      // The first run is the connect's `initial`; the queued follow-ups
      // that continue the chain are `incremental`.
      const response = await runSync(state, runs === 0 ? "initial" : "incremental");
      const body = await response.json();
      assertEquals(response.status, 200, JSON.stringify(body));
      if (!body.continuing) break;
      assert(state.backfillBefore !== null);
      assertEquals(state.lastSyncAt, null);
    }
    assertEquals(runs, 2); // runs 0,1 continue; run 2 completes
    assertEquals(state.activities.length, 4500);
    assertEquals(state.backfillBefore, null);
    assert(state.lastSyncAt !== null);
  } finally {
    liftosaur.restore();
  }
});

Deno.test("liftosaur-sync: continuing backfill falls back to a retryable 502 when no follow-up can be queued", async () => {
  const now = Date.now();
  const lastSync = new Date(now - 200 * DAY).toISOString();
  const state: DbState = { lastSyncAt: lastSync, activities: [], failQueueInsert: true };
  const liftosaur = installFakeLiftosaur(datedRecords(2200, now - 199 * DAY, HOUR));
  try {
    const response = await runSync(state, "incremental");
    assertEquals(response.status, 502, await response.clone().text());
    assertEquals(state.lastSyncAt, lastSync);
    assert(state.backfillBefore !== null);
  } finally {
    liftosaur.restore();
  }
});

Deno.test("liftosaur-sync: 11 pages sharing one date -> 500, watermark unchanged (no safe resume point)", async () => {
  const now = Date.now();
  const lastSync = new Date(now - 200 * DAY).toISOString();
  const state: DbState = { lastSyncAt: lastSync, activities: [] };
  const sameDate = isoSeconds(now - 100 * DAY);
  const upstream = Array.from({ length: 2200 }, (_, i) => ({ id: 1000 + i, date: sameDate }));
  const liftosaur = installFakeLiftosaur(upstream);
  try {
    const response = await runSync(state, "incremental");
    const body = await response.json();
    assertEquals(response.status, 500, JSON.stringify(body));
    assertEquals(body.truncated, true);
    assertEquals(body.resume_at, null);
    assertEquals(state.lastSyncAt, lastSync);
    assertEquals(state.backfillBefore ?? null, null);
    assertEquals(state.status, "error");
    assert(String(state.errorMessage).includes("fewer than two distinct dates"));
  } finally {
    liftosaur.restore();
  }
});

Deno.test("liftosaur-sync: one dated record among undated ones is not a resume point", async () => {
  const now = Date.now();
  const lastSync = new Date(now - 200 * DAY).toISOString();
  const state: DbState = { lastSyncAt: lastSync, activities: [] };
  const upstream: UpstreamRecord[] = [
    { id: 1, date: isoSeconds(now - 10 * DAY) },
    ...Array.from({ length: 2199 }, (_, i) => ({ id: 2 + i })),
  ];
  const liftosaur = installFakeLiftosaur(upstream);
  try {
    const response = await runSync(state, "incremental");
    assertEquals(response.status, 500, await response.clone().text());
    assertEquals(state.lastSyncAt, lastSync);
    assertEquals(state.backfillBefore ?? null, null);
  } finally {
    liftosaur.restore();
  }
});

Deno.test("liftosaur-sync: a backfill that cannot move below its endDate fails terminally", async () => {
  const now = Date.now();
  const lastSync = new Date(now - 200 * DAY).toISOString();
  const floor = Math.floor((now - 100 * DAY) / 1000) * 1000;
  const previousBefore = new Date(floor + 1000).toISOString();
  const state: DbState = {
    lastSyncAt: lastSync,
    backfillBefore: previousBefore,
    backfillStartedAt: new Date(now - HOUR).toISOString(),
    activities: [],
  };
  // 2,200 records inside one second: newest-first, but the oldest read + 1s
  // is not below the current endDate, so another run cannot get further.
  const upstream: UpstreamRecord[] = Array.from({ length: 2200 }, (_, i) => ({
    id: 1000 + i,
    date: new Date(floor + (i < 1100 ? 500 : 0)).toISOString(),
  }));
  const liftosaur = installFakeLiftosaur(upstream);
  try {
    const response = await runSync(state, "incremental");
    const body = await response.json();
    assertEquals(response.status, 500, JSON.stringify(body));
    assert(String(state.errorMessage).includes("more records share one date"));
    assertEquals(state.backfillBefore, previousBefore);
    assertEquals(state.lastSyncAt, lastSync);
  } finally {
    liftosaur.restore();
  }
});

Deno.test("liftosaur-sync: oldest-first fallback resumes from the newest record read (502)", async () => {
  const now = Date.now();
  const lastSync = new Date(now - 200 * DAY).toISOString();
  const state: DbState = { lastSyncAt: lastSync, activities: [] };
  const upstream = datedRecords(2200, now - 199 * DAY, HOUR);
  const liftosaur = installFakeLiftosaur(upstream, { order: "asc" });
  try {
    const response = await runSync(state, "incremental");
    assertEquals(response.status, 502, await response.clone().text());
    assertEquals(state.lastSyncAt, new Date(Date.parse(upstream[1999].date!)).toISOString());
    assert(Date.parse(state.lastSyncAt!) < liftosaur.firstRequestAt!);
  } finally {
    liftosaur.restore();
  }
});

Deno.test("liftosaur-sync: oldest-first records denser than the window -> 500, watermark unchanged", async () => {
  const now = Date.now();
  const lastSync = new Date(now - 6 * HOUR).toISOString();
  const state: DbState = { lastSyncAt: lastSync, activities: [] };
  // 2,200 records a minute apart, all after lastSync - 72h: resuming from the
  // newest one read would give a window that starts no later than this one.
  const upstream = datedRecords(2200, now - 70 * HOUR, 60 * 1000);
  const liftosaur = installFakeLiftosaur(upstream, { order: "asc" });
  try {
    const response = await runSync(state, "incremental");
    const body = await response.json();
    assertEquals(response.status, 500, JSON.stringify(body));
    assertEquals(body.truncated, true);
    assertEquals(body.resume_at, null);
    assertEquals(state.status, "error");
    assert(String(state.errorMessage).includes("more records share this window"));
    assertEquals(state.lastSyncAt, lastSync);
  } finally {
    liftosaur.restore();
  }
});

Deno.test("liftosaur-sync: re-sync of an undated record keeps its stored date but applies edits", async () => {
  const storedAt = "2020-01-01T00:00:00.000Z";
  const state: DbState = {
    lastSyncAt: new Date(Date.now() - 6 * HOUR).toISOString(),
    activities: [{
      user_id: USER_ID,
      provider: "liftosaur",
      external_id: "liftosaur-9",
      name: "old",
      duration_seconds: 60,
      started_at: storedAt,
    }],
  };
  const liftosaur = installFakeLiftosaur([
    { id: 9, body: 'program: "Edited" / dayName: "Renamed" / duration: 1800s' },
  ]);
  try {
    const response = await runSync(state, "incremental");
    assertEquals(response.status, 200, await response.clone().text());
    assertEquals(state.activities.length, 1);
    assertEquals(state.activities[0].started_at, storedAt);
    assertEquals(state.activities[0].name, "Edited — Renamed");
    assertEquals(state.activities[0].duration_seconds, 1800);
  } finally {
    liftosaur.restore();
  }
});

Deno.test("liftosaur-sync: provider error text never reaches the card or the caller", async () => {
  const state: DbState = {
    lastSyncAt: new Date(Date.now() - 6 * HOUR).toISOString(),
    activities: [],
  };
  const liftosaur = installFakeLiftosaur([], {
    failWith: { status: 200, body: "<html>internal proxy page SECRET-ish</html>" },
  });
  try {
    const response = await runSync(state, "incremental");
    const text = await response.text();
    assertEquals(response.status, 502, text);
    assert(!text.includes("html"), text);
    assert(text.includes("LIFTOSAUR_FETCH"));
    assert(!String(state.errorMessage).includes("html"));
    assert(String(state.errorMessage).includes("LIFTOSAUR_FETCH"));
  } finally {
    liftosaur.restore();
  }
});

Deno.test("liftosaur-sync: an initial sync (reconnect) starts a fresh import instead of resuming a stuck backfill", async () => {
  const now = Date.now();
  const state: DbState = {
    lastSyncAt: null,
    backfillBefore: new Date(now - 300 * DAY).toISOString(),
    backfillStartedAt: new Date(now - 30 * DAY).toISOString(),
    activities: [],
  };
  const liftosaur = installFakeLiftosaur(datedRecords(3, now - 10 * DAY, HOUR));
  try {
    const response = await runSync(state, "initial");
    assertEquals(response.status, 200, await response.clone().text());
    assertEquals(liftosaur.requests[0].searchParams.has("endDate"), false);
    assertEquals(state.activities.length, 3);
    assertEquals(state.backfillBefore, null);
    assert(Date.parse(state.lastSyncAt!) > now - 60_000);
  } finally {
    liftosaur.restore();
  }
});

Deno.test("liftosaur-sync: a reconnect with an old watermark imports history older than the watermark", async () => {
  const now = Date.now();
  // Truncated before this PR: the watermark is recent, the old history was never read.
  const oldWatermark = new Date(now - 5 * DAY).toISOString();
  const state: DbState = { lastSyncAt: oldWatermark, activities: [] };
  const upstream = datedRecords(2200, now - 150 * DAY, HOUR);
  const liftosaur = installFakeLiftosaur(upstream);
  try {
    const first = await runSync(state, "initial");
    const firstBody = await first.json();
    assertEquals(first.status, 200, JSON.stringify(firstBody));
    assertEquals(firstBody.continuing, true);
    assertEquals(state.backfillAfter ?? null, null); // full-history chain
    assertEquals(state.lastSyncAt, oldWatermark);

    // The queued follow-up is `incremental`; it must still reach below the watermark.
    const second = await runSync(state, "incremental");
    assertEquals(second.status, 200, await second.clone().text());
    assertEquals(liftosaur.requests[10].searchParams.has("startDate"), false);
    assertEquals(state.activities.length, 2200);
    const oldest = Math.min(...state.activities.map((row) => Date.parse(row.started_at as string)));
    assert(oldest < Date.parse(oldWatermark) - 72 * HOUR);
    assertEquals(state.backfillBefore, null);
    assert(Date.parse(state.lastSyncAt!) > Date.parse(oldWatermark));
  } finally {
    liftosaur.restore();
  }
});

Deno.test("liftosaur-sync: an incremental chain keeps its own lower bound across runs", async () => {
  const now = Date.now();
  const lastSync = new Date(now - 200 * DAY).toISOString();
  const state: DbState = { lastSyncAt: lastSync, activities: [] };
  const liftosaur = installFakeLiftosaur(datedRecords(2200, now - 199 * DAY, HOUR));
  try {
    await runSync(state, "incremental");
    const expectedAfter = new Date(Date.parse(lastSync) - 72 * HOUR).toISOString();
    assertEquals(state.backfillAfter, expectedAfter);
    await runSync(state, "incremental");
    assertEquals(liftosaur.requests[10].searchParams.get("startDate"), expectedAfter);
    assertEquals(state.backfillAfter, null);
  } finally {
    liftosaur.restore();
  }
});
// ---------------------------------------------------------------------------
// Real-SQL (local stack only; run by `npm run test:edge:integration`).
// ---------------------------------------------------------------------------

/**
 * The real service-role client, with only the subscription lookup stubbed to
 * an active FLAME plan: the SQL under test is external_activities /
 * user_integrations, not billing.
 */
// deno-lint-ignore no-explicit-any
function withActiveFlameSubscription(admin: any) {
  return {
    from: (table: string) =>
      table === "subscriptions"
        ? {
          select: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: {
                    tier: "FLAME",
                    status: "active",
                    current_period_end: "2099-01-01T00:00:00.000Z",
                  },
                  error: null,
                }),
            }),
          }),
        }
        : admin.from(table),
    rpc: (...args: unknown[]) => admin.rpc(...args),
  };
}

Deno.test({
  name:
    "integration: liftosaur-sync re-sync of an undated record applies the edit and keeps the stored date",
  ignore: localIntegrationEnvironment === null,
  fn: async () => {
    const env = localIntegrationEnvironment!;
    const admin = createClient(env.url, env.serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const created = await admin.auth.admin.createUser({
      email: `pr50-liftosaur-${crypto.randomUUID()}@example.invalid`,
      email_confirm: true,
    });
    if (created.error || !created.data.user) throw new Error("user fixture failed");
    const userId = created.data.user.id;

    const originalFetch = globalThis.fetch;
    let dayName = "Before";
    globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
      );
      if (url.hostname === "www.liftosaur.com") {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              data: {
                records: [{ id: 777, text: `program: "Test" / dayName: "${dayName}"` }],
                hasMore: false,
                nextCursor: null,
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        );
      }
      return originalFetch(input, init);
    }) as typeof fetch;

    try {
      const token = await admin.from("oauth_tokens").insert({
        user_id: userId,
        provider: "liftosaur",
        api_key: "liftosaur-key",
      });
      if (token.error) throw new Error(`token fixture failed: ${token.error.message}`);
      const integration = await admin.from("user_integrations").insert({
        user_id: userId,
        provider: "liftosaur",
        status: "connected",
      });
      if (integration.error) {
        throw new Error(`integration fixture failed: ${integration.error.message}`);
      }

      const handler = createLiftosaurSyncHandler({
        createAuthClient: () => ({
          auth: { getUser: () => Promise.resolve({ data: { user: { id: userId } } }) },
        }),
        // deno-lint-ignore no-explicit-any
        createAdminClient: () => withActiveFlameSubscription(admin) as any,
      });
      const sync = () =>
        handler(
          new Request("http://localhost/functions/v1/liftosaur-sync", {
            method: "POST",
            headers: { Authorization: "Bearer user-jwt", "Content-Type": "application/json" },
            body: JSON.stringify({ sync_type: "incremental" }),
          }),
        );
      const readRow = async () => {
        const row = await admin.from("external_activities")
          .select("name, started_at")
          .eq("user_id", userId)
          .eq("provider", "liftosaur")
          .eq("external_id", "liftosaur-777")
          .single();
        if (row.error) throw new Error(`row read failed: ${row.error.message}`);
        return row.data as { name: string; started_at: string };
      };

      const first = await sync();
      assertEquals(first.status, 200, await first.clone().text());
      const stored = await readRow();
      assertEquals(stored.name, "Test — Before");

      await new Promise((resolve) => setTimeout(resolve, 20));
      dayName = "After";
      const second = await sync();
      assertEquals(second.status, 200, await second.clone().text());
      const updated = await readRow();
      assertEquals(updated.name, "Test — After");
      assertEquals(updated.started_at, stored.started_at);
    } finally {
      globalThis.fetch = originalFetch;
      const deleted = await admin.auth.admin.deleteUser(userId);
      // Log rather than throw: a throw in finally would mask the test's own failure.
      if (deleted.error) console.error("user fixture cleanup failed:", deleted.error.message);
    }
  },
});
