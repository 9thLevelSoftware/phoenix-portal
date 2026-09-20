import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import {
  type CompletableProvider,
  createCompleteOAuthHandler,
  type ExchangeOutcome,
} from "./index.ts";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const VALID_JWT = "test-jwt";
const CALLER_ID = "00000000-0000-4000-8000-000000000001";
const OTHER_USER_ID = "00000000-0000-4000-8000-000000000002";
const STATE_TOKEN = "state-token-1";
const AUTH_CODE = "auth-code-1";
const NOW_MS = Date.parse("2026-09-20T12:00:00.000Z");
const FUTURE_ISO = new Date(NOW_MS + 5 * 60 * 1000).toISOString();
const PAST_ISO = new Date(NOW_MS - 60 * 1000).toISOString();

const ACCESS_TOKEN = "raw-access-token";
const REFRESH_TOKEN = "raw-refresh-token";

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
    user_id: CALLER_ID,
    provider: "strava",
    expires_at: FUTURE_ISO,
  }];
}

function requestFor(
  body: unknown,
  authorization: string | null = `Bearer ${VALID_JWT}`,
): Request {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (authorization !== null) headers.set("Authorization", authorization);
  return new Request("http://localhost/functions/v1/complete-oauth", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

function validBody(provider: CompletableProvider = "strava") {
  return { provider, code: AUTH_CODE, state: STATE_TOKEN };
}

// ---------------------------------------------------------------------------
// Stateful admin-client double
//
// `oauth_states` is a real in-memory array that DELETE actually mutates, so
// replay and single-use assertions mean something.
// ---------------------------------------------------------------------------

interface RpcCall {
  name: string;
  args: Record<string, unknown>;
}

interface HarnessOptions {
  stateRows?: StateRow[];
  user?: { id: string } | null;
  tier?: string;
  subscriptionError?: { code: string; message: string } | null;
  /** Force the consuming DELETE to report zero rows (concurrency race). */
  consumeDeletesNothing?: boolean;
  /** Make the expiry sweep a no-op, so the post-SELECT expiry re-check fires. */
  sweepDeletesNothing?: boolean;
  consumeError?: { code: string; message: string };
  exchange?: ExchangeOutcome;
  bindError?: { code: string; message: string };
}

interface Harness {
  handler: (request: Request) => Promise<Response>;
  stateRows: StateRow[];
  rpcCalls: RpcCall[];
  inserts: Array<{ table: string; values: unknown }>;
  exchangeCalls: Array<{ provider: string; code: string }>;
}

interface Filter {
  column: string;
  op: "eq" | "lt" | "gt";
  value: string;
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
  const rpcCalls: RpcCall[] = [];
  const inserts: Array<{ table: string; values: unknown }> = [];
  const exchangeCalls: Array<{ provider: string; code: string }> = [];

  const from = (table: string) => {
    const filters: Filter[] = [];
    let mode: "select" | "delete" | "insert" = "select";
    let returnsRepresentation = false;

    const readResult = () => {
      if (table === "subscriptions") {
        if (options.subscriptionError) {
          return { data: null, error: options.subscriptionError };
        }
        return {
          data: {
            tier: options.tier ?? "FLAME",
            status: "active",
            current_period_end: "2099-01-01T00:00:00.000Z",
          },
          error: null,
        };
      }
      if (table === "oauth_states") {
        const found = stateRows.filter((row) => matches(row, filters));
        return { data: found[0] ?? null, error: null };
      }
      return { data: null, error: null };
    };

    const deleteResult = () => {
      if (table !== "oauth_states") return { data: [], error: null };
      if (options.consumeError && filters.some((f) => f.column === "user_id")) {
        return { data: null, error: options.consumeError };
      }
      const isSweep = filters.length === 1 && filters[0].column === "expires_at";
      const isConsume = filters.some((f) => f.column === "user_id");
      const doomed = stateRows.filter((row) => matches(row, filters));
      const removed = (options.consumeDeletesNothing && isConsume) ||
          (options.sweepDeletesNothing && isSweep)
        ? []
        : doomed;
      for (const row of removed) {
        stateRows.splice(stateRows.indexOf(row), 1);
      }
      return {
        data: returnsRepresentation ? removed.map((row) => ({ id: row.id })) : null,
        error: null,
      };
    };

    const settle = () =>
      Promise.resolve(mode === "delete" ? deleteResult() : readResult());

    const builder: Record<string, unknown> = {
      select(...args: unknown[]) {
        if (mode !== "delete") mode = "select";
        else if (args.length > 0) returnsRepresentation = true;
        return builder;
      },
      delete() {
        mode = "delete";
        return builder;
      },
      insert(values: unknown) {
        mode = "insert";
        inserts.push({ table, values });
        return Promise.resolve({ data: null, error: null });
      },
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

  const handler = createCompleteOAuthHandler({
    createAuthClient() {
      return {
        auth: {
          getUser: () =>
            Promise.resolve({
              data: {
                user: options.user === undefined ? { id: CALLER_ID } : options.user,
              },
            }),
        },
      };
    },
    createAdminClient() {
      return {
        from,
        rpc(name: string, args: Record<string, unknown>) {
          rpcCalls.push({ name, args });
          return Promise.resolve({
            data: null,
            error: options.bindError ?? null,
          });
        },
      } as never;
    },
    exchangeCode(provider: CompletableProvider, code: string) {
      exchangeCalls.push({ provider, code });
      return Promise.resolve(
        options.exchange ?? {
          ok: true,
          tokens: {
            providerUserId: "athlete-1",
            accessToken: ACCESS_TOKEN,
            refreshToken: REFRESH_TOKEN,
            tokenExpiresAt: "2026-09-21T12:00:00.000Z",
          },
        },
      );
    },
    encryptSecret(value: string) {
      return Promise.resolve(`enc:test:${value}`);
    },
    now: () => NOW_MS,
  });

  return { handler, stateRows, rpcCalls, inserts, exchangeCalls };
}

async function json(response: Response): Promise<Record<string, unknown>> {
  return await response.json() as Record<string, unknown>;
}

function bindCalls(harness: Harness): RpcCall[] {
  return harness.rpcCalls.filter((call) => call.name === "bind_integration_tokens");
}

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

Deno.test("complete-oauth binds the provider account for the calling session", async () => {
  const harness = makeHarness();

  const response = await harness.handler(requestFor(validBody()));

  assertEquals(response.status, 200);
  assertEquals((await json(response)).connected, "strava");
  assertEquals(harness.exchangeCalls, [{ provider: "strava", code: AUTH_CODE }]);

  const calls = bindCalls(harness);
  assertEquals(calls.length, 1);
  assertEquals(calls[0].args.p_user_id, CALLER_ID);
  assertEquals(calls[0].args.p_provider, "strava");
  assertEquals(calls[0].args.p_provider_user_id, "athlete-1");

  // The RPC must receive ciphertext, never the raw provider tokens.
  assertEquals(calls[0].args.p_access_token, `enc:test:${ACCESS_TOKEN}`);
  assertEquals(calls[0].args.p_refresh_token, `enc:test:${REFRESH_TOKEN}`);

  // Single-use: the state row is gone.
  assertEquals(harness.stateRows.length, 0);

  // The initial sync is queued, as the provider callbacks do today.
  assertEquals(harness.inserts.length, 1);
  assertEquals(harness.inserts[0].table, "sync_queue");
});

// ---------------------------------------------------------------------------
// Negative security cases (F-046) — prove each refusal writes nothing
// ---------------------------------------------------------------------------

Deno.test("complete-oauth refuses a state belonging to another user and keeps it", async () => {
  const harness = makeHarness({
    stateRows: [{
      id: "state-row-1",
      state_token: STATE_TOKEN,
      user_id: OTHER_USER_ID,
      provider: "strava",
      expires_at: FUTURE_ISO,
    }],
  });

  const response = await harness.handler(requestFor(validBody()));

  assertEquals(response.status, 403);
  assertEquals((await json(response)).error, "state_mismatch");
  assertEquals(harness.exchangeCalls.length, 0);
  assertEquals(bindCalls(harness).length, 0);
  assertEquals(harness.inserts.length, 0);
  // Not deleted: a leaked state token must not let anyone cancel its owner's
  // in-flight connection.
  assertEquals(harness.stateRows.length, 1);
});

Deno.test("complete-oauth sweeps an expired state and refuses it", async () => {
  const harness = makeHarness({
    stateRows: [{
      id: "state-row-1",
      state_token: STATE_TOKEN,
      user_id: CALLER_ID,
      provider: "strava",
      expires_at: PAST_ISO,
    }],
  });

  const response = await harness.handler(requestFor(validBody()));

  assertEquals(response.status, 403);
  assertEquals((await json(response)).error, "invalid_state");
  assertEquals(harness.exchangeCalls.length, 0);
  assertEquals(bindCalls(harness).length, 0);
  assertEquals(harness.stateRows.length, 0);
});

Deno.test("complete-oauth re-checks expires_at even when the sweep misses the row", async () => {
  // The sweep's failure is ignored by design, so the per-row expiry check is
  // what actually hard-caps the state's lifetime.
  const harness = makeHarness({
    sweepDeletesNothing: true,
    stateRows: [{
      id: "state-row-1",
      state_token: STATE_TOKEN,
      user_id: CALLER_ID,
      provider: "strava",
      expires_at: PAST_ISO,
    }],
  });

  const response = await harness.handler(requestFor(validBody()));

  assertEquals(response.status, 403);
  assertEquals((await json(response)).error, "state_expired");
  assertEquals(harness.exchangeCalls.length, 0);
  assertEquals(bindCalls(harness).length, 0);
  // Refused AND removed: an expired state is never usable again.
  assertEquals(harness.stateRows.length, 0);
});

Deno.test("complete-oauth refuses a replayed state", async () => {
  const harness = makeHarness();

  const first = await harness.handler(requestFor(validBody()));
  assertEquals(first.status, 200);

  const second = await harness.handler(requestFor(validBody()));
  assertEquals(second.status, 403);
  assertEquals((await json(second)).error, "invalid_state");

  // Exactly one exchange and one binding across both attempts.
  assertEquals(harness.exchangeCalls.length, 1);
  assertEquals(bindCalls(harness).length, 1);
});

Deno.test("complete-oauth refuses when the consuming delete removes no row", async () => {
  // The row is visible to the SELECT but a concurrent request wins the DELETE.
  // Only the atomic consume can catch this; a "row exists" check cannot.
  const harness = makeHarness({ consumeDeletesNothing: true });

  const response = await harness.handler(requestFor(validBody()));

  assertEquals(response.status, 403);
  assertEquals((await json(response)).error, "state_consumed");
  assertEquals(harness.exchangeCalls.length, 0);
  assertEquals(bindCalls(harness).length, 0);
});

Deno.test("complete-oauth fails closed when consuming the state errors", async () => {
  const harness = makeHarness({
    consumeError: { code: "57014", message: "canceling statement" },
  });

  const response = await harness.handler(requestFor(validBody()));

  assertEquals(response.status, 503);
  assertEquals(harness.exchangeCalls.length, 0);
  assertEquals(bindCalls(harness).length, 0);
});

Deno.test("complete-oauth refuses an unknown state", async () => {
  const harness = makeHarness({ stateRows: [] });

  const response = await harness.handler(requestFor(validBody()));

  assertEquals(response.status, 403);
  assertEquals((await json(response)).error, "invalid_state");
  assertEquals(harness.exchangeCalls.length, 0);
  assertEquals(bindCalls(harness).length, 0);
});

Deno.test("complete-oauth refuses a state minted for another provider", async () => {
  const harness = makeHarness({
    stateRows: [{
      id: "state-row-1",
      state_token: STATE_TOKEN,
      user_id: CALLER_ID,
      provider: "fitbit",
      expires_at: FUTURE_ISO,
    }],
  });

  const response = await harness.handler(requestFor(validBody("strava")));

  assertEquals(response.status, 403);
  assertEquals((await json(response)).error, "provider_mismatch");
  assertEquals(harness.exchangeCalls.length, 0);
  assertEquals(bindCalls(harness).length, 0);
  assertEquals(harness.stateRows.length, 1);
});

// ---------------------------------------------------------------------------
// Identity binding (F-067)
// ---------------------------------------------------------------------------

Deno.test("complete-oauth reports already_linked as 409 and stores nothing", async () => {
  const harness = makeHarness({
    bindError: { code: "P0001", message: "already_linked" },
  });

  const response = await harness.handler(requestFor(validBody()));

  assertEquals(response.status, 409);
  assertEquals((await json(response)).error, "already_linked");
  // The RPC is the only write path; it raised before writing either row.
  assertEquals(bindCalls(harness).length, 1);
  assertEquals(harness.inserts.length, 0);
});

Deno.test("complete-oauth maps a unique-index race (23505) to already_linked", async () => {
  const harness = makeHarness({
    bindError: {
      code: "23505",
      message: "duplicate key value violates unique constraint",
    },
  });

  const response = await harness.handler(requestFor(validBody()));

  assertEquals(response.status, 409);
  assertEquals((await json(response)).error, "already_linked");
  assertEquals(harness.inserts.length, 0);
});

Deno.test("complete-oauth reports an unrelated binding failure as 500", async () => {
  const harness = makeHarness({
    bindError: { code: "42501", message: "forbidden" },
  });

  const response = await harness.handler(requestFor(validBody()));

  assertEquals(response.status, 500);
  assertEquals((await json(response)).error, "save_failed");
  assertEquals(harness.inserts.length, 0);
});

// ---------------------------------------------------------------------------
// Tier gate (PR 9) — this endpoint re-checks instead of inheriting the
// provider callbacks' exemption
// ---------------------------------------------------------------------------

Deno.test("complete-oauth denies below FLAME before touching the state row", async () => {
  const harness = makeHarness({ tier: "EMBER" });

  const response = await harness.handler(requestFor(validBody()));

  assertEquals(response.status, 402);
  assertEquals((await json(response)).error, "subscription_required");
  assertEquals(harness.exchangeCalls.length, 0);
  assertEquals(bindCalls(harness).length, 0);
  // The flow stays resumable after the user upgrades.
  assertEquals(harness.stateRows.length, 1);
});

Deno.test("complete-oauth fails closed when the subscription lookup errors", async () => {
  const harness = makeHarness({
    subscriptionError: { code: "PGRST000", message: "boom" },
  });

  const response = await harness.handler(requestFor(validBody()));

  assertEquals(response.status, 503);
  assertEquals(harness.exchangeCalls.length, 0);
  assertEquals(harness.stateRows.length, 1);
});

// ---------------------------------------------------------------------------
// Request shape
// ---------------------------------------------------------------------------

Deno.test("complete-oauth requires an Authorization header", async () => {
  const harness = makeHarness();
  const response = await harness.handler(requestFor(validBody(), null));
  assertEquals(response.status, 401);
  assertEquals(harness.stateRows.length, 1);
});

Deno.test("complete-oauth rejects an unusable JWT", async () => {
  const harness = makeHarness({ user: null });
  const response = await harness.handler(requestFor(validBody()));
  assertEquals(response.status, 401);
  assertEquals(harness.exchangeCalls.length, 0);
});

Deno.test("complete-oauth rejects GET", async () => {
  const harness = makeHarness();
  const response = await harness.handler(
    new Request("http://localhost/functions/v1/complete-oauth", {
      method: "GET",
      headers: { Authorization: `Bearer ${VALID_JWT}` },
    }),
  );
  assertEquals(response.status, 405);
});

Deno.test("complete-oauth rejects garmin, which has no authorization code", async () => {
  const harness = makeHarness();
  const response = await harness.handler(
    requestFor({ provider: "garmin", code: AUTH_CODE, state: STATE_TOKEN }),
  );
  assertEquals(response.status, 400);
  assertEquals((await json(response)).error, "provider_unsupported");
  assertEquals(harness.stateRows.length, 1);
});

Deno.test("complete-oauth rejects an unknown provider", async () => {
  const harness = makeHarness();
  const response = await harness.handler(
    requestFor({ provider: "hevy", code: AUTH_CODE, state: STATE_TOKEN }),
  );
  assertEquals(response.status, 400);
  assertEquals((await json(response)).error, "invalid_provider");
});

Deno.test("complete-oauth rejects a missing code or state", async () => {
  const harness = makeHarness();
  const noCode = await harness.handler(
    requestFor({ provider: "strava", state: STATE_TOKEN }),
  );
  assertEquals(noCode.status, 400);
  const noState = await harness.handler(
    requestFor({ provider: "strava", code: AUTH_CODE }),
  );
  assertEquals(noState.status, 400);
  assertEquals(harness.exchangeCalls.length, 0);
});

// ---------------------------------------------------------------------------
// Provider failure
// ---------------------------------------------------------------------------

Deno.test("complete-oauth reports a failed exchange without storing anything", async () => {
  const harness = makeHarness({ exchange: { ok: false, error: "auth_failed" } });

  const response = await harness.handler(requestFor(validBody()));

  assertEquals(response.status, 502);
  assertEquals((await json(response)).error, "auth_failed");
  assertEquals(bindCalls(harness).length, 0);
  assertEquals(harness.inserts.length, 0);
});

// ---------------------------------------------------------------------------
// Nothing echoes the secrets back (PR 63)
// ---------------------------------------------------------------------------

Deno.test("complete-oauth never echoes the code, state or a token in a response body", async () => {
  const cases: Array<Promise<Response>> = [
    makeHarness({ stateRows: [] }).handler(requestFor(validBody())),
    makeHarness({ tier: "FREE" }).handler(requestFor(validBody())),
    makeHarness({ exchange: { ok: false, error: "auth_failed" } })
      .handler(requestFor(validBody())),
    makeHarness({ bindError: { code: "23505", message: "duplicate key" } })
      .handler(requestFor(validBody())),
  ];

  for (const pending of cases) {
    const body = await (await pending).text();
    assertEquals(body.includes(AUTH_CODE), false, body);
    assertEquals(body.includes(STATE_TOKEN), false, body);
    assertEquals(body.includes(ACCESS_TOKEN), false, body);
    assertEquals(body.includes(REFRESH_TOKEN), false, body);
    // Sanity: the bodies really are the JSON error envelope.
    assertStringIncludes(body, '"error"');
  }
});
