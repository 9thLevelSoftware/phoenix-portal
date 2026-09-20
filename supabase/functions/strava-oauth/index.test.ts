import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { createStravaOAuthHandler } from "./index.ts";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const APP_URL = "https://portal.example.test";
const STATE_TOKEN = "state-token-1";
const AUTH_CODE = "auth-code-1";
const NOW_MS = Date.parse("2026-09-20T12:00:00.000Z");
const FUTURE_ISO = new Date(NOW_MS + 5 * 60 * 1000).toISOString();
const PAST_ISO = new Date(NOW_MS - 60 * 1000).toISOString();

interface StateRow {
  id: string;
  state_token: string;
  user_id: string;
  provider: string;
  expires_at: string;
}

function defaultStateRows(): StateRow[] {
  return [{
    id: "state-row-1",
    state_token: STATE_TOKEN,
    user_id: "00000000-0000-4000-8000-000000000001",
    provider: "strava",
    expires_at: FUTURE_ISO,
  }];
}

function callbackRequest(query: Record<string, string>): Request {
  const url = new URL("https://project.supabase.co/functions/v1/strava-oauth");
  for (const [key, value] of Object.entries(query)) {
    url.searchParams.set(key, value);
  }
  return new Request(url.toString(), { method: "GET" });
}

// ---------------------------------------------------------------------------
// Stateful admin-client double.
//
// `oauth_states` is a real array that DELETE mutates, so "the state survives"
// assertions mean something. Any write to a table other than `oauth_states` is
// recorded so the tests can prove this function stores nothing at all.
// ---------------------------------------------------------------------------

interface Filter {
  column: string;
  op: "eq" | "lt" | "gt";
  value: string;
}

interface Write {
  table: string;
  op: "insert" | "upsert" | "update" | "delete";
  filters: Filter[];
}

interface HarnessOptions {
  stateRows?: StateRow[];
  selectError?: { code: string; message: string };
  /** Make the whole admin client throw, to exercise the catch arm. */
  clientThrows?: boolean;
}

interface Harness {
  handler: (request: Request) => Promise<Response>;
  stateRows: StateRow[];
  writes: Write[];
}

function matches(row: StateRow, filters: Filter[]): boolean {
  return filters.every((filter) => {
    const value = (row as unknown as Record<string, string>)[filter.column];
    if (filter.op === "eq") return value === filter.value;
    if (filter.op === "lt") return value < filter.value;
    return value > filter.value;
  });
}

function makeHarness(options: HarnessOptions = {}): Harness {
  const stateRows = options.stateRows ?? defaultStateRows();
  const writes: Write[] = [];

  const from = (table: string) => {
    const filters: Filter[] = [];
    let mode: "select" | "delete" = "select";

    const settle = () => {
      if (mode === "delete") {
        writes.push({ table, op: "delete", filters: [...filters] });
        if (table !== "oauth_states") return Promise.resolve({ data: null, error: null });
        for (const row of stateRows.filter((row) => matches(row, filters))) {
          stateRows.splice(stateRows.indexOf(row), 1);
        }
        return Promise.resolve({ data: null, error: null });
      }
      if (table !== "oauth_states") {
        return Promise.resolve({ data: null, error: null });
      }
      if (options.selectError) {
        return Promise.resolve({ data: null, error: options.selectError });
      }
      const found = stateRows.filter((row) => matches(row, filters));
      return Promise.resolve({ data: found[0] ?? null, error: null });
    };

    const record = (op: Write["op"]) => {
      writes.push({ table, op, filters: [...filters] });
      return Promise.resolve({ data: null, error: null });
    };

    const builder: Record<string, unknown> = {
      select() {
        return builder;
      },
      delete() {
        mode = "delete";
        return builder;
      },
      insert: () => record("insert"),
      upsert: () => record("upsert"),
      update: () => record("update"),
      eq(column: string, value: string) {
        filters.push({ column, op: "eq", value });
        return builder;
      },
      lt(column: string, value: string) {
        filters.push({ column, op: "lt", value });
        return builder;
      },
      gt(column: string, value: string) {
        filters.push({ column, op: "gt", value });
        return builder;
      },
      maybeSingle: () => settle(),
      single: () => settle(),
      then(
        onFulfilled?: (value: unknown) => unknown,
        onRejected?: (reason: unknown) => unknown,
      ) {
        return settle().then(onFulfilled, onRejected);
      },
    };

    return builder;
  };

  const handler = createStravaOAuthHandler({
    createAdminClient() {
      if (options.clientThrows) throw new Error("boom");
      return { from } as never;
    },
    appUrl: () => APP_URL,
    now: () => NOW_MS,
  });

  return { handler, stateRows, writes };
}

function location(response: Response): URL {
  const header = response.headers.get("Location");
  if (!header) throw new Error("expected a Location header");
  return new URL(header);
}

/** Every write except the time-based expiry sweep on `oauth_states`. */
function nonSweepWrites(harness: Harness): Write[] {
  return harness.writes.filter((write) =>
    !(write.table === "oauth_states" && write.op === "delete" &&
      write.filters.length === 1 && write.filters[0].column === "expires_at")
  );
}

// ---------------------------------------------------------------------------
// Happy path — relay, do not exchange
// ---------------------------------------------------------------------------

Deno.test("strava-oauth relays the provider response to the portal callback", async () => {
  const harness = makeHarness();

  const response = await harness.handler(
    callbackRequest({ code: AUTH_CODE, state: STATE_TOKEN, scope: "activity:read_all" }),
  );

  assertEquals(response.status, 302);
  const target = location(response);
  assertEquals(target.origin, APP_URL);
  assertEquals(target.pathname, "/integrations/callback");
  assertEquals(target.searchParams.get("provider"), "strava");
  assertEquals(target.searchParams.get("code"), AUTH_CODE);
  assertEquals(target.searchParams.get("state"), STATE_TOKEN);
});

Deno.test("strava-oauth writes no tokens, integration or sync queue row", async () => {
  const harness = makeHarness();

  await harness.handler(
    callbackRequest({ code: AUTH_CODE, state: STATE_TOKEN }),
  );

  // The only write is the time-based expiry sweep. Nothing is stored anywhere.
  assertEquals(nonSweepWrites(harness), []);
  const tables = harness.writes.map((write) => write.table);
  assertEquals(tables.includes("oauth_tokens"), false);
  assertEquals(tables.includes("user_integrations"), false);
  assertEquals(tables.includes("sync_queue"), false);
});

Deno.test("strava-oauth does not consume the state — complete-oauth owns that", async () => {
  const harness = makeHarness();

  const response = await harness.handler(
    callbackRequest({ code: AUTH_CODE, state: STATE_TOKEN }),
  );

  assertEquals(response.status, 302);
  // Still there for the portal POST that follows.
  assertEquals(harness.stateRows.length, 1);
});

Deno.test("strava-oauth sweeps expired rows by time, never by the supplied state", async () => {
  const harness = makeHarness();

  await harness.handler(callbackRequest({ code: AUTH_CODE, state: STATE_TOKEN }));

  const deletes = harness.writes.filter((write) => write.op === "delete");
  assertEquals(deletes.length, 1);
  assertEquals(deletes[0].table, "oauth_states");
  assertEquals(deletes[0].filters, [{
    column: "expires_at",
    op: "lt",
    value: new Date(NOW_MS).toISOString(),
  }]);
});

// ---------------------------------------------------------------------------
// Refusals — each must leave the state row alone and leak nothing
// ---------------------------------------------------------------------------

Deno.test("strava-oauth refuses an unknown state", async () => {
  const harness = makeHarness({ stateRows: [] });

  const response = await harness.handler(
    callbackRequest({ code: AUTH_CODE, state: "not-a-real-state" }),
  );

  assertEquals(response.status, 302);
  const target = location(response);
  assertEquals(target.pathname, "/integrations");
  assertEquals(target.searchParams.get("error"), "invalid_state");
  assertEquals(nonSweepWrites(harness), []);
});

Deno.test("strava-oauth refuses an expired state and does NOT delete it", async () => {
  // The sweep runs first, so reaching this branch means the row was inserted
  // between the sweep and the select. Deleting a row keyed by an
  // attacker-supplied state on an unauthenticated endpoint would let a leaked
  // token cancel its owner's in-flight connection, so the refusal is silent.
  const harness = makeHarness({
    stateRows: [{
      id: "state-row-1",
      state_token: STATE_TOKEN,
      user_id: "00000000-0000-4000-8000-000000000001",
      provider: "strava",
      // Not matched by the `lt` sweep, but not in the future either.
      expires_at: new Date(NOW_MS).toISOString(),
    }],
  });

  const response = await harness.handler(
    callbackRequest({ code: AUTH_CODE, state: STATE_TOKEN }),
  );

  assertEquals(location(response).searchParams.get("error"), "state_expired");
  assertEquals(harness.stateRows.length, 1);
  assertEquals(nonSweepWrites(harness), []);
});

Deno.test("strava-oauth refuses a state minted for another provider and keeps it", async () => {
  const harness = makeHarness({
    stateRows: [{
      id: "state-row-1",
      state_token: STATE_TOKEN,
      user_id: "00000000-0000-4000-8000-000000000001",
      provider: "fitbit",
      expires_at: FUTURE_ISO,
    }],
  });

  const response = await harness.handler(
    callbackRequest({ code: AUTH_CODE, state: STATE_TOKEN }),
  );

  assertEquals(location(response).searchParams.get("error"), "provider_mismatch");
  assertEquals(harness.stateRows.length, 1);
  assertEquals(nonSweepWrites(harness), []);
});

Deno.test("strava-oauth sweeps a plainly expired state before looking it up", async () => {
  const harness = makeHarness({
    stateRows: [{
      id: "state-row-1",
      state_token: STATE_TOKEN,
      user_id: "00000000-0000-4000-8000-000000000001",
      provider: "strava",
      expires_at: PAST_ISO,
    }],
  });

  const response = await harness.handler(
    callbackRequest({ code: AUTH_CODE, state: STATE_TOKEN }),
  );

  assertEquals(location(response).searchParams.get("error"), "invalid_state");
  assertEquals(harness.stateRows.length, 0);
});

Deno.test("strava-oauth reports a provider denial without forwarding anything", async () => {
  const harness = makeHarness();

  const response = await harness.handler(
    callbackRequest({ error: "access_denied", state: STATE_TOKEN }),
  );

  const target = location(response);
  assertEquals(target.pathname, "/integrations");
  assertEquals(target.searchParams.get("error"), "access_denied");
  // Not even looked up: the state stays for its natural expiry.
  assertEquals(harness.writes, []);
  assertEquals(harness.stateRows.length, 1);
});

Deno.test("strava-oauth refuses a callback missing the code or the state", async () => {
  const noCode = makeHarness();
  const first = await noCode.handler(callbackRequest({ state: STATE_TOKEN }));
  assertEquals(location(first).searchParams.get("error"), "missing_params");
  assertEquals(noCode.writes, []);

  const noState = makeHarness();
  const second = await noState.handler(callbackRequest({ code: AUTH_CODE }));
  assertEquals(location(second).searchParams.get("error"), "missing_params");
  assertEquals(noState.writes, []);
});

Deno.test("strava-oauth fails to an error page when the state lookup errors", async () => {
  const harness = makeHarness({
    selectError: { code: "PGRST000", message: "boom" },
  });

  const response = await harness.handler(
    callbackRequest({ code: AUTH_CODE, state: STATE_TOKEN }),
  );

  assertEquals(location(response).searchParams.get("error"), "invalid_state");
  assertEquals(nonSweepWrites(harness), []);
});

Deno.test("strava-oauth turns an unexpected throw into an error redirect", async () => {
  const harness = makeHarness({ clientThrows: true });

  const response = await harness.handler(
    callbackRequest({ code: AUTH_CODE, state: STATE_TOKEN }),
  );

  assertEquals(response.status, 302);
  assertEquals(location(response).searchParams.get("error"), "auth_failed");
});

// ---------------------------------------------------------------------------
// PR 63 — only the designed hand-off carries the secrets
// ---------------------------------------------------------------------------

Deno.test("strava-oauth never puts the code or state in an error redirect", async () => {
  const cases: Array<Promise<Response>> = [
    makeHarness({ stateRows: [] }).handler(
      callbackRequest({ code: AUTH_CODE, state: STATE_TOKEN }),
    ),
    makeHarness({
      stateRows: [{
        id: "state-row-1",
        state_token: STATE_TOKEN,
        user_id: "u",
        provider: "fitbit",
        expires_at: FUTURE_ISO,
      }],
    }).handler(callbackRequest({ code: AUTH_CODE, state: STATE_TOKEN })),
    makeHarness({ clientThrows: true }).handler(
      callbackRequest({ code: AUTH_CODE, state: STATE_TOKEN }),
    ),
    makeHarness().handler(
      callbackRequest({ error: "access_denied", state: STATE_TOKEN }),
    ),
  ];

  for (const pending of cases) {
    const response = await pending;
    const header = response.headers.get("Location") ?? "";
    assertEquals(header.includes(AUTH_CODE), false, header);
    assertEquals(header.includes(STATE_TOKEN), false, header);
    assertStringIncludes(header, "/integrations?error=");
    // The body of a 302 is empty — nothing can leak through it.
    assertEquals(await response.text(), "");
  }
});

// ---------------------------------------------------------------------------
// Redirect construction
// ---------------------------------------------------------------------------

Deno.test("strava-oauth encodes forwarded params instead of interpolating them", async () => {
  // A code containing `&` must not graft a second parameter onto the redirect.
  const hostile = "abc&admin=1#frag";
  const harness = makeHarness();

  const response = await harness.handler(
    callbackRequest({ code: hostile, state: STATE_TOKEN }),
  );

  const target = location(response);
  assertEquals(target.searchParams.get("code"), hostile);
  assertEquals(target.searchParams.get("admin"), null);
  assertEquals(target.hash, "");
  assertEquals([...target.searchParams.keys()].sort(), ["code", "provider", "state"]);
});

Deno.test("strava-oauth falls back to the local portal when APP_URL is unusable", async () => {
  const handler = createStravaOAuthHandler({
    createAdminClient() {
      return { from: () => ({}) } as never;
    },
    appUrl: () => "not-a-url",
    now: () => NOW_MS,
  });

  const response = await handler(callbackRequest({}));

  assertEquals(response.status, 302);
  assertStringIncludes(
    response.headers.get("Location") ?? "",
    "http://localhost:5173/integrations?error=missing_params",
  );
});
