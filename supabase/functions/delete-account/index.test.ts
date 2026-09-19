import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import {
  EXPLICIT_PURGE_TARGETS,
  purgeUser,
  type PurgeUserDependencies,
} from "../_shared/accountPurge.ts";
import { localIntegrationEnvironment } from "../_shared/localIntegrationEnvironment.ts";
import { createDeleteAccountHandler } from "./index.ts";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_USER_ID = "22222222-2222-4222-8222-222222222222";
const SUBSCRIPTION_ID = "sub_01purgetest";
const CUSTOMER_ID = "ctm_01purgetest";
const PAST = "2020-01-01T00:00:00.000Z";
const FUTURE = "2999-01-01T00:00:00.000Z";

// ---------------------------------------------------------------------------
// In-process doubles
// ---------------------------------------------------------------------------

type Call =
  | { kind: "select"; table: string; filters: [string, unknown][] }
  | { kind: "delete"; table: string; filters: [string, unknown][] }
  | { kind: "update"; table: string; values: Record<string, unknown>; filters: [string, unknown][] }
  | { kind: "rpc"; name: string; args: unknown }
  | { kind: "deleteUser"; userId: string }
  | { kind: "storage.list"; prefix: string }
  | { kind: "storage.remove"; paths: string[] };

interface FakeError {
  code?: string;
  message: string;
}

interface FakeRequest {
  id: string;
  scheduled_for: string;
  status: string;
  executed_at?: string | null;
}

interface FakeState {
  calls: Call[];
  deletionRequest: FakeRequest | null;
  subscription: {
    paddle_subscription_id: string | null;
    paddle_customer_id?: string | null;
    status?: string;
  } | null;
  /** Error returned by the subscriptions lookup. */
  subscriptionError: FakeError | null;
  avatars: string[];
  /** false: the limiter always refuses. */
  rateLimitAllowed: boolean;
  /** The single delete-account slot is taken (cleared by deleting the row). */
  rateLimitUsed: boolean;
  /** Delete errors keyed by `table` or `table:column` (first filter column). */
  deleteErrors: Record<string, FakeError>;
  /** Update errors keyed by table. */
  updateErrors: Record<string, FakeError>;
  deleteUserError: { status?: number; message: string } | null;
  /** The request stops being pending between the read and the claim. */
  claimRace: boolean;
  /** Other users' subscriptions rows referencing a Paddle subscription id. */
  otherSubscriptionRefs: Record<string, number>;
  /** Error returned by the shared-subscription check. */
  sharedCheckError: FakeError | null;
}

function fakeState(overrides: Partial<FakeState> = {}): FakeState {
  return {
    calls: [],
    deletionRequest: { id: "req-1", scheduled_for: PAST, status: "pending", executed_at: null },
    subscription: null,
    subscriptionError: null,
    avatars: ["avatar.png"],
    rateLimitAllowed: true,
    rateLimitUsed: false,
    deleteErrors: {},
    updateErrors: {},
    deleteUserError: null,
    claimRace: false,
    otherSubscriptionRefs: {},
    sharedCheckError: null,
    ...overrides,
  };
}

/** A user-side "cancel deletion": RLS only lets it touch a pending row. */
function userCancelsDeletion(state: FakeState): boolean {
  if (state.deletionRequest?.status !== "pending") return false;
  state.deletionRequest.status = "cancelled";
  return true;
}

class FakeQuery {
  private filters: [string, unknown][] = [];
  private returnRows = false;
  constructor(
    private state: FakeState,
    private table: string,
    private op: "select" | "delete" | "update",
    private values: Record<string, unknown> = {},
  ) {}

  eq(column: string, value: unknown) {
    this.filters.push([column, value]);
    return this;
  }

  neq(column: string, value: unknown) {
    this.filters.push([`${column}!=`, value]);
    return this;
  }

  select(_columns?: string) {
    this.returnRows = true;
    return this;
  }

  private record() {
    if (this.op === "update") {
      this.state.calls.push({
        kind: "update",
        table: this.table,
        values: this.values,
        filters: this.filters,
      });
    } else {
      this.state.calls.push({ kind: this.op, table: this.table, filters: this.filters });
    }
  }

  private row(): unknown {
    if (this.table === "deletion_requests") {
      const request = this.state.deletionRequest;
      const wantsPending = this.filters.some(([c, v]) => c === "status" && v === "pending");
      if (!request || (wantsPending && request.status !== "pending")) return null;
      return request;
    }
    if (this.table === "subscriptions") return this.state.subscription;
    return null;
  }

  single() {
    this.record();
    const data = this.row();
    return Promise.resolve(
      data ? { data, error: null } : { data: null, error: { code: "PGRST116", message: "no rows" } },
    );
  }

  maybeSingle() {
    this.record();
    if (this.table === "subscriptions" && this.state.subscriptionError) {
      return Promise.resolve({ data: null, error: this.state.subscriptionError });
    }
    return Promise.resolve({ data: this.row(), error: null });
  }

  private resolveUpdate(): { data: unknown; error: unknown } {
    const error = this.state.updateErrors[this.table] ?? null;
    if (error) return { data: null, error };
    if (this.table !== "deletion_requests") return { data: this.returnRows ? [] : null, error: null };
    const request = this.state.deletionRequest;
    const isClaim = this.values.status === "executed";
    const matches = request !== null &&
      !(isClaim && this.state.claimRace) &&
      this.filters.every(([column, value]) =>
        (request as unknown as Record<string, unknown>)[column] === value
      );
    if (matches) Object.assign(request, this.values);
    return { data: this.returnRows ? (matches ? [{ id: request!.id }] : []) : null, error: null };
  }

  /** Head/count selects: only the shared-subscription check uses them. */
  private resolveCount(): { data: null; error: unknown; count?: number } {
    const subscriptionId = this.filters.find(([c]) => c === "paddle_subscription_id")?.[1];
    const excludesSelf = this.filters.some(([c, v]) => c === "user_id!=" && v === USER_ID);
    if (this.table !== "subscriptions" || typeof subscriptionId !== "string" || !excludesSelf) {
      return { data: null, error: null, count: 0 };
    }
    if (this.state.sharedCheckError) return { data: null, error: this.state.sharedCheckError };
    return { data: null, error: null, count: this.state.otherSubscriptionRefs[subscriptionId] ?? 0 };
  }

  private resolveDelete(): { data: null; error: unknown } {
    const column = this.filters[0]?.[0];
    const error = this.state.deleteErrors[`${this.table}:${column}`] ??
      this.state.deleteErrors[this.table] ?? null;
    if (!error && this.table === "rate_limit_tracking") this.state.rateLimitUsed = false;
    return { data: null, error };
  }

  then<T>(resolve: (value: { data: unknown; error: unknown }) => T) {
    this.record();
    const result = this.op === "update"
      ? this.resolveUpdate()
      : this.op === "delete"
      ? this.resolveDelete()
      : this.resolveCount();
    return Promise.resolve(result).then(resolve);
  }
}

function fakeAdmin(state: FakeState): SupabaseClient {
  const client = {
    from(table: string) {
      return {
        select: () => new FakeQuery(state, table, "select"),
        delete: () => new FakeQuery(state, table, "delete"),
        update: (values: Record<string, unknown>) => new FakeQuery(state, table, "update", values),
      };
    },
    rpc(name: string, args: unknown) {
      state.calls.push({ kind: "rpc", name, args });
      const allowed = state.rateLimitAllowed && !state.rateLimitUsed;
      if (allowed) state.rateLimitUsed = true;
      return Promise.resolve({
        data: [{ allowed, remaining: 0, retry_after_seconds: allowed ? null : 3600 }],
        error: null,
      });
    },
    auth: {
      admin: {
        deleteUser(userId: string) {
          state.calls.push({ kind: "deleteUser", userId });
          return Promise.resolve({ data: {}, error: state.deleteUserError });
        },
      },
    },
    storage: {
      from(_bucket: string) {
        return {
          list(prefix: string) {
            state.calls.push({ kind: "storage.list", prefix });
            return Promise.resolve({
              data: state.avatars.map((name) => ({ name })),
              error: null,
            });
          },
          remove(paths: string[]) {
            state.calls.push({ kind: "storage.remove", paths });
            state.avatars = [];
            return Promise.resolve({ data: [], error: null });
          },
        };
      },
    },
  };
  return client as unknown as SupabaseClient;
}

interface PaddleCall {
  method: string;
  path: string;
  body: unknown;
}

function fakePaddle(options: {
  status?: string;
  getStatus?: number;
  cancelStatus?: number;
  /** Runs when the live status is fetched (mid-purge). */
  onGet?: () => void;
}): { deps: PurgeUserDependencies; calls: PaddleCall[] } {
  const calls: PaddleCall[] = [];
  const fetchImpl = (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    calls.push({
      method,
      path: url.pathname,
      body: init?.body ? JSON.parse(String(init.body)) : null,
    });
    if (method === "GET") {
      options.onGet?.();
      return Promise.resolve(
        new Response(
          JSON.stringify({ data: { id: SUBSCRIPTION_ID, status: options.status ?? "active" } }),
          { status: options.getStatus ?? 200 },
        ),
      );
    }
    return Promise.resolve(
      new Response(JSON.stringify({ data: { status: "canceled" } }), {
        status: options.cancelStatus ?? 200,
      }),
    );
  };
  return {
    calls,
    deps: {
      fetch: fetchImpl as typeof fetch,
      paddleApiKey: "test-paddle-key",
      paddleEnvironment: "sandbox",
    },
  };
}

function handlerFor(
  state: FakeState,
  paddle: PurgeUserDependencies,
  jwtUserId: string | null = USER_ID,
) {
  return createDeleteAccountHandler({
    createAuthClient: () => ({
      auth: {
        getUser: () => Promise.resolve({ data: { user: jwtUserId ? { id: jwtUserId } : null } }),
      },
    }),
    createAdminClient: () => fakeAdmin(state),
    purge: (admin, userId) => purgeUser(admin, userId, paddle),
  });
}

function post(body?: unknown): Request {
  return new Request("http://localhost/functions/v1/delete-account", {
    method: "POST",
    headers: { Authorization: "Bearer user-jwt", "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function indexOfCall(state: FakeState, predicate: (call: Call) => boolean): number {
  return state.calls.findIndex(predicate);
}

function lastIndexOfCall(state: FakeState, predicate: (call: Call) => boolean): number {
  for (let i = state.calls.length - 1; i >= 0; i--) {
    if (predicate(state.calls[i])) return i;
  }
  return -1;
}

const isDeleteUser = (call: Call) => call.kind === "deleteUser";
const isRateLimit = (call: Call) => call.kind === "rpc" && call.name === "check_rate_limit";
const isAvatarRemove = (call: Call) => call.kind === "storage.remove";
const deletesTable = (table: string) => (call: Call) =>
  call.kind === "delete" && call.table === table;
const isRowDelete = (call: Call) => call.kind === "delete";

function withSubscription(overrides: Partial<FakeState> = {}): FakeState {
  return fakeState({
    subscription: {
      paddle_subscription_id: SUBSCRIPTION_ID,
      paddle_customer_id: CUSTOMER_ID,
      status: "active",
    },
    ...overrides,
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

/** The purge never ran past billing: nothing deleted, user and avatar intact. */
function assertUntouched(state: FakeState) {
  assertEquals(state.deletionRequest?.status, "pending");
  assertEquals(state.deletionRequest?.executed_at ?? null, null);
  assertEquals(state.avatars, ["avatar.png"]);
  assertEquals(indexOfCall(state, isAvatarRemove), -1);
  assertEquals(indexOfCall(state, isDeleteUser), -1);
  assertEquals(state.calls.filter(isRowDelete).length, 0, "no row deleted");
}

// ---------------------------------------------------------------------------
// Handler tests
// ---------------------------------------------------------------------------

Deno.test("delete-account: a Paddle cancel failure returns 5xx with the real retry time, request pending, avatar intact", async () => {
  const state = withSubscription();
  const paddle = fakePaddle({ status: "active", cancelStatus: 500 });

  const res = await silenced(() => handlerFor(state, paddle.deps)(post()));

  assertEquals(res.status, 502);
  assertEquals(res.headers.get("Retry-After"), "3600");
  const body = await res.json();
  assertEquals(body.code, "billing_cancel_failed");
  assertStringIncludes(body.error, "about an hour");
  assertUntouched(state);
  // Claimed, then put back.
  const requestUpdates = state.calls.filter((c) => c.kind === "update" && c.table === "deletion_requests");
  assertEquals(requestUpdates.map((c) => c.kind === "update" && c.values.status), ["executed", "pending"]);
});

Deno.test("delete-account: a billing abort keeps the rate limit, so an immediate retry is refused", async () => {
  const state = withSubscription();
  const first = await silenced(() => handlerFor(state, fakePaddle({ cancelStatus: 500 }).deps)(post()));
  assertEquals(first.status, 502);
  const second = await silenced(() => handlerFor(state, fakePaddle({}).deps)(post()));
  assertEquals(second.status, 429);
  assertEquals(state.calls.filter(isDeleteUser).length, 0);
});

Deno.test("delete-account: a deleteUser failure keeps the rate limit (R-15), so an immediate retry is refused", async () => {
  const state = fakeState({ deleteUserError: { status: 500, message: "Database error deleting user" } });
  const first = await silenced(() => handlerFor(state, fakePaddle({}).deps)(post()));
  assertEquals(first.status, 500);
  assertEquals(first.headers.get("Retry-After"), "3600");
  assertEquals(state.deletionRequest?.status, "pending");
  assertEquals(indexOfCall(state, deletesTable("rate_limit_tracking")), -1);
  const second = await silenced(() => handlerFor(state, fakePaddle({}).deps)(post()));
  assertEquals(second.status, 429);
  assertEquals(state.calls.filter(isDeleteUser).length, 1);
});

Deno.test("delete-account: a Paddle status lookup failure aborts before anything is deleted", async () => {
  const state = withSubscription();
  const paddle = fakePaddle({ getStatus: 503 });

  const res = await silenced(() => handlerFor(state, paddle.deps)(post()));

  assertEquals(res.status, 502);
  assertEquals(paddle.calls.filter((c) => c.method === "POST").length, 0);
  assertUntouched(state);
});

Deno.test("delete-account: a DB error on the subscription lookup aborts with no Paddle call (R-11)", async () => {
  const state = withSubscription({
    subscriptionError: { code: "57014", message: "canceling statement due to statement timeout" },
  });
  const paddle = fakePaddle({});

  const res = await silenced(() => handlerFor(state, paddle.deps)(post()));

  assertEquals(res.status, 502);
  assertEquals(paddle.calls.length, 0);
  assertUntouched(state);
});

Deno.test("delete-account: a Paddle 404 continues only when the local subscription is already terminal (R-1, R-10)", async () => {
  for (const status of ["canceled", "expired"]) {
    const state = withSubscription();
    state.subscription!.status = status;
    const paddle = fakePaddle({ getStatus: 404 });
    const res = await silenced(() => handlerFor(state, paddle.deps)(post()));
    assertEquals(res.status, 200, status);
    assertEquals(paddle.calls.map((c) => c.method), ["GET"], status);
    assertEquals(state.calls.filter(isDeleteUser).length, 1, status);
  }

  for (const status of ["active", "past_due", "trialing", "incomplete", "none"]) {
    const state = withSubscription();
    state.subscription!.status = status;
    const paddle = fakePaddle({ getStatus: 404 });
    const res = await silenced(() => handlerFor(state, paddle.deps)(post()));
    assertEquals(res.status, 502, status);
    const body = await res.json();
    assertEquals(body.code, "billing_subscription_not_found", status);
    assertStringIncludes(body.error, "contact support");
    assertEquals(paddle.calls.map((c) => c.method), ["GET"], status);
    assertUntouched(state);
  }
});

Deno.test("delete-account: a missing PADDLE_API_KEY aborts when the user has a subscription id", async () => {
  const state = withSubscription();
  const paddle = fakePaddle({});
  paddle.deps.paddleApiKey = undefined;

  const res = await silenced(() => handlerFor(state, paddle.deps)(post()));

  assertEquals(res.status, 502);
  assertEquals(paddle.calls.length, 0);
  assertUntouched(state);
});

Deno.test("delete-account: a paused subscription is cancelled immediately and mirrored locally before the user is deleted", async () => {
  const state = withSubscription();
  const paddle = fakePaddle({ status: "paused" });

  const res = await silenced(() => handlerFor(state, paddle.deps)(post()));

  assertEquals(res.status, 200);
  assertEquals(paddle.calls.map((c) => `${c.method} ${c.path}`), [
    `GET /subscriptions/${SUBSCRIPTION_ID}`,
    `POST /subscriptions/${SUBSCRIPTION_ID}/cancel`,
  ]);
  assertEquals(paddle.calls[1].body, { effective_from: "immediately" });
  const mirror = state.calls.find((c) => c.kind === "update" && c.table === "subscriptions");
  assert(mirror && mirror.kind === "update");
  assertEquals(mirror.values.status, "canceled");
  assertEquals(mirror.values.cancel_at_period_end, false);
  assertEquals(mirror.filters, [["user_id", USER_ID]]);
  assert(indexOfCall(state, isDeleteUser) > state.calls.indexOf(mirror));
});

Deno.test("delete-account: a failed local mirror after a Paddle cancel does not stop the purge (R-14)", async () => {
  const state = withSubscription({ updateErrors: { subscriptions: { message: "mirror failed" } } });
  const res = await silenced(() => handlerFor(state, fakePaddle({ status: "active" }).deps)(post()));
  assertEquals(res.status, 200);
  assertEquals(state.calls.filter(isDeleteUser).length, 1);
});

Deno.test("delete-account: every non-canceled live status is cancelled; canceled makes no cancel call", async () => {
  for (const status of ["active", "trialing", "past_due", "paused", "some_future_status"]) {
    const state = withSubscription();
    const paddle = fakePaddle({ status });
    const res = await silenced(() => handlerFor(state, paddle.deps)(post()));
    assertEquals(res.status, 200, status);
    assertEquals(paddle.calls.filter((c) => c.method === "POST").length, 1, status);
  }
  const state = withSubscription();
  const paddle = fakePaddle({ status: "canceled" });
  const res = await silenced(() => handlerFor(state, paddle.deps)(post()));
  assertEquals(res.status, 200);
  assertEquals(paddle.calls.map((c) => c.method), ["GET"]);
});

Deno.test("delete-account: validation failures do not consume the rate limit", async () => {
  const noRequest = fakeState({ deletionRequest: null });
  const res1 = await silenced(() => handlerFor(noRequest, fakePaddle({}).deps)(post()));
  assertEquals(res1.status, 400);
  assertEquals(indexOfCall(noRequest, isRateLimit), -1);

  const notDue = fakeState({
    deletionRequest: { id: "req-1", scheduled_for: FUTURE, status: "pending" },
  });
  const res2 = await silenced(() => handlerFor(notDue, fakePaddle({}).deps)(post()));
  assertEquals(res2.status, 400);
  assertEquals(indexOfCall(notDue, isRateLimit), -1);
  assertEquals(indexOfCall(notDue, isDeleteUser), -1);

  const cancelled = fakeState({
    deletionRequest: { id: "req-1", scheduled_for: PAST, status: "cancelled" },
  });
  const res3 = await silenced(() => handlerFor(cancelled, fakePaddle({}).deps)(post()));
  assertEquals(res3.status, 400);
  assertEquals(indexOfCall(cancelled, isRateLimit), -1);
});

Deno.test("delete-account: a valid request is rate limited before any side effect", async () => {
  const state = withSubscription({ rateLimitAllowed: false });
  const paddle = fakePaddle({});
  const res = await silenced(() => handlerFor(state, paddle.deps)(post()));
  assertEquals(res.status, 429);
  assertEquals(paddle.calls.length, 0);
  assertUntouched(state);
  assertEquals(state.calls.filter((c) => c.kind === "update").length, 0, "not claimed");
});

Deno.test("delete-account: a user cancel issued mid-purge is refused because the request is claimed (R-6)", async () => {
  const state = withSubscription();
  let cancelAccepted: boolean | null = null;
  const paddle = fakePaddle({ onGet: () => (cancelAccepted = userCancelsDeletion(state)) });

  const res = await silenced(() => handlerFor(state, paddle.deps)(post()));

  assertEquals(res.status, 200);
  assertEquals(cancelAccepted, false);
  assertEquals(state.deletionRequest?.status, "executed");
});

Deno.test("delete-account: a request that stops being pending before the claim is not purged", async () => {
  const state = withSubscription({ claimRace: true });
  const paddle = fakePaddle({});
  const res = await silenced(() => handlerFor(state, paddle.deps)(post()));
  assertEquals(res.status, 409);
  assertEquals(paddle.calls.length, 0);
  assertEquals(indexOfCall(state, isDeleteUser), -1);
});

Deno.test("delete-account: deleteUser is called with the JWT user only, whatever the body says", async () => {
  const state = fakeState();
  const res = await silenced(() =>
    handlerFor(state, fakePaddle({}).deps)(
      post({ userId: OTHER_USER_ID, user_id: OTHER_USER_ID }),
    )
  );
  assertEquals(res.status, 200);
  const deleteUserCalls = state.calls.filter((c) => c.kind === "deleteUser");
  assertEquals(deleteUserCalls, [{ kind: "deleteUser", userId: USER_ID }]);
  for (const call of state.calls) {
    if (call.kind === "delete" || call.kind === "select" || call.kind === "update") {
      for (const [, value] of call.filters) assert(value !== OTHER_USER_ID);
    }
  }
  assert(
    state.calls.every((c) => c.kind !== "storage.list" || c.prefix === USER_ID),
  );
});

Deno.test("delete-account: unauthenticated and non-POST requests do nothing", async () => {
  const state = fakeState();
  const res = await silenced(() => handlerFor(state, fakePaddle({}).deps, null)(post()));
  assertEquals(res.status, 401);
  const get = await handlerFor(state, fakePaddle({}).deps)(
    new Request("http://localhost/functions/v1/delete-account", { method: "GET" }),
  );
  assertEquals(get.status, 405);
  assertEquals(state.calls.length, 0);
});

Deno.test("delete-account: order is billing, explicit rows, deleteUser, post-delete sweep, avatars", async () => {
  const state = withSubscription();
  const res = await silenced(() => handlerFor(state, fakePaddle({ status: "active" }).deps)(post()));
  assertEquals(res.status, 200);

  const deleteUserAt = indexOfCall(state, isDeleteUser);
  assert(deleteUserAt > 0);
  for (const target of EXPLICIT_PURGE_TARGETS) {
    const first = indexOfCall(state, deletesTable(target.table));
    const last = lastIndexOfCall(state, deletesTable(target.table));
    if (target.postOnly) {
      assert(first > deleteUserAt, `${target.table} untouched until deleteUser succeeded`);
    } else {
      assert(first >= 0 && first < deleteUserAt, `${target.table} purged before deleteUser`);
    }
    assert(last > deleteUserAt, `${target.table} swept again after deleteUser`);
  }
  for (const table of ["sync_tombstones", "subscription_events", "rate_limit_tracking"]) {
    assert(EXPLICIT_PURGE_TARGETS.some((t) => t.table === table && t.postOnly), table);
  }
  assert(indexOfCall(state, isAvatarRemove) > deleteUserAt);
  assertEquals(state.avatars, []);
});

function webhookDeleteFilters(state: FakeState): [string, unknown][][] {
  return state.calls
    .filter(deletesTable("paddle_webhook_events"))
    .map((c) => c.kind === "delete" ? c.filters : []);
}

Deno.test("purgeUser: paddle_webhook_events is matched by user id, payload and an unshared subscription id, never by customer id (R-7, R-13, R-21)", async () => {
  const state = withSubscription();
  const result = await silenced(() => purgeUser(fakeAdmin(state), USER_ID, fakePaddle({ status: "canceled" }).deps));
  assertEquals(result.ok, true);
  const expected: [string, unknown][][] = [
    [["user_id", USER_ID]],
    [["payload->data->custom_data->>user_id", USER_ID]],
    [["paddle_subscription_id", SUBSCRIPTION_ID]],
  ];
  // Once in the pre-pass and once in the post-pass.
  assertEquals(webhookDeleteFilters(state), [...expected, ...expected]);
  // The sharing check ran before each pass, scoped away from this user.
  const checks = state.calls.filter((c) =>
    c.kind === "select" && c.table === "subscriptions" &&
    c.filters.some(([column]) => column === "user_id!=")
  );
  assertEquals(checks.length, 2);
  assertEquals(checks[0].kind === "select" && checks[0].filters, [
    ["paddle_subscription_id", SUBSCRIPTION_ID],
    ["user_id!=", USER_ID],
  ]);
  // No delete anywhere is ever filtered by a customer id.
  assert(
    state.calls.every((c) =>
      c.kind !== "delete" || c.filters.every(([column, value]) => column !== "paddle_customer_id" && value !== CUSTOMER_ID)
    ),
  );
});

Deno.test("purgeUser: a subscription id another user's row references is never used as a match (R-21)", async () => {
  const shared = withSubscription({ otherSubscriptionRefs: { [SUBSCRIPTION_ID]: 1 } });
  const result = await silenced(() => purgeUser(fakeAdmin(shared), USER_ID, fakePaddle({ status: "canceled" }).deps));
  assertEquals(result, { ok: true, billingCancelled: false, residualTables: [] });
  const onlyUserScoped: [string, unknown][][] = [
    [["user_id", USER_ID]],
    [["payload->data->custom_data->>user_id", USER_ID]],
  ];
  assertEquals(webhookDeleteFilters(shared), [...onlyUserScoped, ...onlyUserScoped]);

  // A failed sharing check is treated as shared (skip), not as a purge failure.
  const unknown = withSubscription({ sharedCheckError: { message: "timeout" } });
  const result2 = await silenced(() => purgeUser(fakeAdmin(unknown), USER_ID, fakePaddle({ status: "canceled" }).deps));
  assertEquals(result2.ok, true);
  assertEquals(webhookDeleteFilters(unknown), [...onlyUserScoped, ...onlyUserScoped]);
});

Deno.test("purgeUser: a missing paddle_webhook_events.user_id column falls back to the payload match (R-13)", async () => {
  const state = fakeState({
    deleteErrors: {
      "paddle_webhook_events:user_id": { code: "42703", message: 'column "user_id" does not exist' },
    },
  });
  const result = await silenced(() => purgeUser(fakeAdmin(state), USER_ID, fakePaddle({}).deps));
  assertEquals(result, { ok: true, billingCancelled: false, residualTables: [] });
  const columns = state.calls
    .filter(deletesTable("paddle_webhook_events"))
    .map((c) => c.kind === "delete" ? c.filters[0][0] : "");
  assertEquals(columns.slice(0, 3), [
    "user_id",
    "payload->data->custom_data->>user_id",
    "payload->data->custom_data->>user_id",
  ]);
});

Deno.test("purgeUser: only mayBeAbsent tables may be missing; a missing required table fails (R-8, R-18)", async () => {
  const missingOptional = fakeState({
    deleteErrors: {
      paddle_webhook_events: {
        code: "PGRST205",
        message: "Could not find the table 'public.paddle_webhook_events'",
      },
      telemetry_analysis: { code: "42P01", message: 'relation "telemetry_analysis" does not exist' },
    },
  });
  const ok = await silenced(() => purgeUser(fakeAdmin(missingOptional), USER_ID, fakePaddle({}).deps));
  assertEquals(ok, { ok: true, billingCancelled: false, residualTables: [] });

  const missingRequiredPre = fakeState({
    deleteErrors: { oauth_tokens: { code: "PGRST205", message: "Could not find the table 'public.oauth_tokens'" } },
  });
  const pre = await silenced(() => purgeUser(fakeAdmin(missingRequiredPre), USER_ID, fakePaddle({}).deps));
  assertEquals(pre.ok, false);
  assertEquals(!pre.ok && pre.stage, "explicit_rows");
  assertEquals(indexOfCall(missingRequiredPre, isDeleteUser), -1);

  const missingRequiredPost = fakeState({
    deleteErrors: { sync_tombstones: { code: "PGRST205", message: "Could not find the table 'public.sync_tombstones'" } },
  });
  const post = await silenced(() => purgeUser(fakeAdmin(missingRequiredPost), USER_ID, fakePaddle({}).deps));
  assertEquals(post, { ok: true, billingCancelled: false, residualTables: ["sync_tombstones"] });
});

Deno.test("delete-account: any other pre-pass delete error aborts with the user intact", async () => {
  const broken = fakeState({
    deleteErrors: { oauth_tokens: { code: "57014", message: "canceling statement due to statement timeout" } },
  });
  const res = await silenced(() => handlerFor(broken, fakePaddle({}).deps)(post()));
  assertEquals(res.status, 500);
  assertEquals(res.headers.get("Retry-After"), "3600");
  assertEquals(indexOfCall(broken, isDeleteUser), -1);
  assertEquals(broken.avatars, ["avatar.png"]);
  assertEquals(broken.deletionRequest?.status, "pending");
});

Deno.test("delete-account: a failed post-delete sweep still reports success and names the residual table (R-12)", async () => {
  const state = fakeState({
    deleteErrors: { sync_tombstones: { code: "57014", message: "canceling statement due to statement timeout" } },
  });
  const res = await silenced(() => handlerFor(state, fakePaddle({}).deps)(post()));
  assertEquals(res.status, 200);
  assertEquals(state.calls.filter(isDeleteUser).length, 1);

  const direct = fakeState({
    deleteErrors: { sync_tombstones: { code: "57014", message: "canceling statement due to statement timeout" } },
  });
  const result = await silenced(() => purgeUser(fakeAdmin(direct), USER_ID, fakePaddle({}).deps));
  assertEquals(result, { ok: true, billingCancelled: false, residualTables: ["sync_tombstones"] });
});

Deno.test("delete-account: deleteUser failing after a Paddle cancel reports the partial failure", async () => {
  const state = withSubscription({
    deleteUserError: { status: 500, message: "Database error deleting user" },
  });
  const res = await silenced(() => handlerFor(state, fakePaddle({ status: "active" }).deps)(post()));
  assertEquals(res.status, 500);
  assertEquals(res.headers.get("Retry-After"), "3600");
  assertEquals((await res.json()).code, "billing_canceled_account_delete_failed");
  assertEquals(state.deletionRequest?.status, "pending");
  assertEquals(state.avatars, ["avatar.png"]);
  // The surviving user keeps their tombstones, billing audit and prod data.
  for (const target of EXPLICIT_PURGE_TARGETS.filter((t) => t.postOnly)) {
    assertEquals(indexOfCall(state, deletesTable(target.table)), -1, target.table);
  }
});

Deno.test("purgeUser: a user that is already gone counts as deleted (idempotent re-run)", async () => {
  const state = fakeState({ deleteUserError: { status: 404, message: "User not found" } });
  const result = await silenced(() => purgeUser(fakeAdmin(state), USER_ID, fakePaddle({}).deps));
  assertEquals(result.ok, true);
});

// ---------------------------------------------------------------------------
// Real-SQL integration (PR 5 harness)
// ---------------------------------------------------------------------------

/**
 * Column-owned tables of the PR 36 user-data manifest (USER_DATA_MANIFEST and
 * EXCLUDED), with the column that holds the user id. Parent-owned tables
 * (routine_exercises, cycle_days) are checked through their parents.
 * Tables that do not exist on the local stack are skipped.
 *
 * INTEGRATION POINT (PR 36): this is a hand copy of the manifest. When PR 36
 * lands, derive it from `USER_DATA_MANIFEST` / `EXCLUDED` so a table added to
 * the manifest is checked here too.
 */
const MANIFEST_USER_COLUMNS: readonly [string, string][] = [
  ["profiles", "id"],
  ["subscriptions", "user_id"],
  ["subscription_events", "user_id"],
  ["deletion_requests", "user_id"],
  ["user_onboarding", "user_id"],
  ["local_profiles", "user_id"],
  ["local_profile_preferences", "user_id"],
  ["workout_sessions", "user_id"],
  ["exercises", "user_id"],
  ["sets", "user_id"],
  ["rep_summaries", "user_id"],
  ["rep_telemetry", "user_id"],
  ["personal_records", "user_id"],
  ["exercise_progress", "user_id"],
  ["session_phase_statistics", "user_id"],
  ["exercise_signatures", "user_id"],
  ["vbt_assessments", "user_id"],
  ["exercise_catalog", "user_id"],
  ["routines", "user_id"],
  ["training_cycles", "user_id"],
  ["sync_tombstones", "user_id"],
  ["user_goals", "user_id"],
  ["goal_snapshots", "user_id"],
  ["overload_suggestions", "user_id"],
  ["telemetry_analysis", "user_id"],
  ["wearable_daily_summaries", "user_id"],
  ["earned_badges", "user_id"],
  ["gamification_stats", "user_id"],
  ["rpg_attributes", "user_id"],
  ["user_insights", "user_id"],
  ["shared_routines", "user_id"],
  ["shared_cycles", "user_id"],
  ["community_comments", "user_id"],
  ["community_votes", "user_id"],
  ["saved_community_items", "user_id"],
  ["challenge_participants", "user_id"],
  ["creator_follows", "follower_id"],
  ["creator_follows", "followed_id"],
  ["user_blocks", "blocker_id"],
  ["user_blocks", "blocked_id"],
  ["content_reports", "reporter_id"],
  ["user_integrations", "user_id"],
  ["external_activities", "user_id"],
  ["sync_queue", "user_id"],
  ["oauth_tokens", "user_id"],
  ["oauth_states", "user_id"],
  ["rate_limit_tracking", "user_id"],
  ["paddle_webhook_events", "user_id"],
];

function integrationAdmin(): SupabaseClient {
  assert(localIntegrationEnvironment);
  return createClient(
    localIntegrationEnvironment.url,
    localIntegrationEnvironment.serviceRoleKey,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

async function createAuthUser(admin: SupabaseClient, label: string) {
  const email = `purge-${label}-${crypto.randomUUID()}@example.invalid`;
  const password = `pw-${crypto.randomUUID()}`;
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error || !created.data.user) throw new Error(`${label} auth fixture failed`);
  return { id: created.data.user.id, email, password };
}

async function must<T extends { error: unknown }>(label: string, op: PromiseLike<T>): Promise<T> {
  const result = await op;
  if (result.error) {
    throw new Error(`${label} failed: ${JSON.stringify(result.error)}`);
  }
  return result;
}

function isMissingRelation(error: { code?: string; message?: string }): boolean {
  return error.code === "42P01" || error.code === "PGRST205" ||
    /could not find the table/i.test(error.message ?? "");
}

function isMissingColumn(error: { code?: string; message?: string }): boolean {
  return error.code === "42703" || /column .* does not exist/i.test(error.message ?? "");
}

/** Seeds rows the purge must remove, plus an avatar uploaded as the user. */
async function seedPurgeFixture(
  admin: SupabaseClient,
  user: { id: string; email: string; password: string },
  paddleSubscriptionId: string | null,
) {
  assert(localIntegrationEnvironment);
  await must("subscription", admin.from("subscriptions").insert({
    user_id: user.id,
    tier: "EMBER",
    status: "active",
    current_period_end: "2099-01-01T00:00:00.000Z",
    ...(paddleSubscriptionId
      ? { paddle_subscription_id: paddleSubscriptionId, paddle_customer_id: CUSTOMER_ID }
      : {}),
  }));
  // The grace-period trigger refuses a request that is already due, even for
  // service_role, so the fixture's request is a fresh (not yet due) one.
  await must("deletion request", admin.from("deletion_requests").insert({
    user_id: user.id,
  }));
  await must("routine", admin.from("routines").insert({
    id: crypto.randomUUID(),
    user_id: user.id,
    name: "Purge fixture routine",
  }));
  // A tombstone written directly: the safety net must remove it even though
  // the trigger guard means the cascade itself records none.
  await must("tombstone", admin.from("sync_tombstones").insert({
    user_id: user.id,
    entity: "routine",
    entity_id: crypto.randomUUID(),
  }));
  await must("oauth token", admin.from("oauth_tokens").insert({
    user_id: user.id,
    provider: "strava",
    access_token: "fixture-token",
  }));
  // Prod-only table (no migration until PR 2 captures it; it cannot be
  // created through PostgREST): seeded when the local stack has it. One row
  // by user_id, one naming the user only in the payload, and rows keyed only
  // by the user's Paddle subscription / customer id.
  const webhooks = await admin.from("paddle_webhook_events").insert([
    { user_id: user.id, event_type: "subscription.updated", payload: { data: {} } },
    {
      event_type: "transaction.completed",
      payload: { data: { custom_data: { user_id: user.id } } },
    },
    ...(paddleSubscriptionId
      ? [
        { event_type: "subscription.paused", paddle_subscription_id: paddleSubscriptionId, payload: { data: {} } },
      ]
      : []),
  ]);
  if (webhooks.error && !isMissingRelation(webhooks.error)) {
    throw new Error(`paddle_webhook_events seed failed: ${JSON.stringify(webhooks.error)}`);
  }
  await must("rate limit", admin.rpc("check_rate_limit", {
    p_key: "delete-account",
    p_user_id: user.id,
    p_max_requests: 5,
    p_window_seconds: 3600,
  }));

  // Upload the avatar as the user (owner set), as the SPA does.
  const userClient = createClient(
    localIntegrationEnvironment.url,
    localIntegrationEnvironment.anonKey,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  await must(
    "sign in",
    userClient.auth.signInWithPassword({ email: user.email, password: user.password }),
  );
  await must(
    "avatar upload",
    userClient.storage.from("avatars").upload(
      `${user.id}/avatar.png`,
      new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" }),
      { upsert: false },
    ),
  );
}

async function rowsReferencing(
  admin: SupabaseClient,
  userId: string,
  paddleIds?: { subscriptionId: string },
): Promise<string[]> {
  const found: string[] = [];
  for (const [table, column] of MANIFEST_USER_COLUMNS) {
    const { count, error } = await admin
      .from(table)
      .select("*", { count: "exact", head: true })
      .eq(column, userId);
    if (error) {
      if (isMissingRelation(error) || isMissingColumn(error)) continue;
      throw new Error(`${table} check failed: ${JSON.stringify(error)}`);
    }
    if ((count ?? 0) > 0) found.push(`${table}.${column}=${count}`);
  }
  // paddle_webhook_events rows naming the user only in the payload, or keyed
  // by the user's own (unshared) Paddle subscription id.
  const extra: [string, string][] = [["payload->data->custom_data->>user_id", userId]];
  if (paddleIds) extra.push(["paddle_subscription_id", paddleIds.subscriptionId]);
  for (const [column, value] of extra) {
    const { count, error } = await admin
      .from("paddle_webhook_events")
      .select("*", { count: "exact", head: true })
      .eq(column, value);
    if (error) {
      if (isMissingRelation(error)) break;
      throw new Error(`paddle_webhook_events.${column} check failed: ${JSON.stringify(error)}`);
    }
    if ((count ?? 0) > 0) found.push(`paddle_webhook_events.${column}=${count}`);
  }
  return found;
}

async function avatarNames(admin: SupabaseClient, userId: string): Promise<string[]> {
  const { data, error } = await admin.storage.from("avatars").list(userId);
  if (error) throw new Error(`avatar list failed: ${error.message}`);
  return (data ?? []).map((file) => file.name);
}

async function cleanupUsers(admin: SupabaseClient, userIds: string[]) {
  for (const userId of userIds) {
    await admin.storage.from("avatars").remove([`${userId}/avatar.png`]);
    await admin.from("sync_tombstones").delete().eq("user_id", userId);
    await admin.from("rate_limit_tracking").delete().eq("user_id", userId);
    await admin.auth.admin.deleteUser(userId);
    // FK-less tables (the last two exist only where prod-only DDL is applied).
    for (const table of ["sync_tombstones", "subscription_events", "paddle_webhook_events"]) {
      await admin.from(table).delete().eq("user_id", userId);
    }
    await admin.from("paddle_webhook_events").delete().eq(
      "payload->data->custom_data->>user_id",
      userId,
    );
  }
  await admin.from("paddle_webhook_events").delete().eq("paddle_subscription_id", SUBSCRIPTION_ID);
  await admin.from("paddle_webhook_events").delete().eq("paddle_customer_id", CUSTOMER_ID);
}

Deno.test({
  name: "integration: purgeUser cancels a paused subscription and leaves no manifest or tombstone row for the user",
  ignore: localIntegrationEnvironment === null,
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const admin = integrationAdmin();
    const user = await createAuthUser(admin, "target");
    const bystander = await createAuthUser(admin, "bystander");
    try {
      await seedPurgeFixture(admin, user, SUBSCRIPTION_ID);
      await seedPurgeFixture(admin, bystander, null);
      const paddleIds = { subscriptionId: SUBSCRIPTION_ID };
      const before = await rowsReferencing(admin, user.id, paddleIds);
      assert(before.length >= 6, `fixture seeded rows: ${before.join(", ")}`);
      assertEquals(await avatarNames(admin, user.id), ["avatar.png"]);

      const paddle = fakePaddle({ status: "paused" });
      const result = await silenced(() => purgeUser(admin, user.id, paddle.deps));

      assertEquals(result, { ok: true, billingCancelled: true, residualTables: [] });
      assertEquals(paddle.calls.map((c) => c.method), ["GET", "POST"]);
      const gone = await admin.auth.admin.getUserById(user.id);
      assert(gone.error || !gone.data.user, "auth user deleted");
      assertEquals(await rowsReferencing(admin, user.id, paddleIds), []);
      assertEquals(await avatarNames(admin, user.id), []);

      // The bystander is untouched.
      const bystanderRows = await rowsReferencing(admin, bystander.id);
      assert(bystanderRows.some((r) => r.startsWith("sync_tombstones.")), bystanderRows.join());
      assert(bystanderRows.some((r) => r.startsWith("rate_limit_tracking.")), bystanderRows.join());
      assertEquals(await avatarNames(admin, bystander.id), ["avatar.png"]);

      // Idempotent: a second run on the deleted user succeeds without Paddle.
      const again = await silenced(() => purgeUser(admin, user.id, fakePaddle({}).deps));
      assertEquals(again.ok, true);
    } finally {
      await cleanupUsers(admin, [user.id, bystander.id]);
    }
  },
});

Deno.test({
  name: "integration: a failing Paddle cancel leaves the user, pending request, rows and avatar intact",
  ignore: localIntegrationEnvironment === null,
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const admin = integrationAdmin();
    const user = await createAuthUser(admin, "abort");
    try {
      await seedPurgeFixture(admin, user, SUBSCRIPTION_ID);
      const before = await rowsReferencing(admin, user.id);
      const paddle = fakePaddle({ status: "paused", cancelStatus: 500 });

      const result = await silenced(() => purgeUser(admin, user.id, paddle.deps));

      assertEquals(result.ok, false);
      assertEquals(!result.ok && result.stage, "billing_cancel");
      assertEquals(await rowsReferencing(admin, user.id), before, "no row deleted");

      const stillThere = await admin.auth.admin.getUserById(user.id);
      assertEquals(stillThere.data.user?.id, user.id);
      const request = await must(
        "request read",
        admin.from("deletion_requests").select("status").eq("user_id", user.id).single(),
      );
      assertEquals(request.data?.status, "pending");
      assertEquals(await avatarNames(admin, user.id), ["avatar.png"]);
      const tokens = await must(
        "tokens read",
        admin.from("oauth_tokens").select("id", { count: "exact", head: true }).eq(
          "user_id",
          user.id,
        ),
      );
      assertEquals(tokens.count, 1, "no row deleted before the billing step succeeded");
    } finally {
      await cleanupUsers(admin, [user.id]);
    }
  },
});

Deno.test({
  name: "integration: the handler's claim and revert writes are accepted and block the user's own cancel (R-6)",
  ignore: localIntegrationEnvironment === null,
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    assert(localIntegrationEnvironment);
    const admin = integrationAdmin();
    const user = await createAuthUser(admin, "claim");
    try {
      const inserted = await must(
        "request",
        admin.from("deletion_requests").insert({ user_id: user.id }).select("id").single(),
      );
      const requestId = (inserted.data as { id: string }).id;

      // The same claim the handler issues (the grace trigger and CHECK allow it).
      const claim = await must(
        "claim",
        admin.from("deletion_requests")
          .update({ status: "executed", executed_at: new Date().toISOString() })
          .eq("id", requestId).eq("status", "pending").select("id"),
      );
      assertEquals(claim.data?.length, 1);
      const reclaim = await must(
        "second claim",
        admin.from("deletion_requests")
          .update({ status: "executed", executed_at: new Date().toISOString() })
          .eq("id", requestId).eq("status", "pending").select("id"),
      );
      assertEquals(reclaim.data?.length, 0, "a claimed request cannot be claimed twice");

      // While claimed, the user's own cancel (RLS: status = 'pending') is refused.
      const userClient = createClient(
        localIntegrationEnvironment.url,
        localIntegrationEnvironment.anonKey,
        { auth: { persistSession: false, autoRefreshToken: false } },
      );
      await must(
        "sign in",
        userClient.auth.signInWithPassword({ email: user.email, password: user.password }),
      );
      const cancel = await userClient.from("deletion_requests")
        .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
        .eq("id", requestId).select("id");
      assertEquals(cancel.data?.length ?? 0, 0, "cancel refused while claimed");

      // The revert the handler issues after an aborted purge.
      await must(
        "revert",
        admin.from("deletion_requests")
          .update({ status: "pending", executed_at: null })
          .eq("id", requestId).eq("status", "executed"),
      );
      const reverted = await must(
        "read",
        admin.from("deletion_requests").select("status, executed_at").eq("id", requestId).single(),
      );
      assertEquals(reverted.data, { status: "pending", executed_at: null });
    } finally {
      await cleanupUsers(admin, [user.id]);
    }
  },
});

Deno.test({
  name: "integration: purging one account never deletes another account's webhook rows via a shared customer or subscription id (R-21)",
  ignore: localIntegrationEnvironment === null,
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const admin = integrationAdmin();
    const a = await createAuthUser(admin, "shared-a");
    const b = await createAuthUser(admin, "shared-b");
    const tag = crypto.randomUUID().slice(0, 8);
    const sharedCustomer = `ctm_shared_${tag}`;
    const subA = `sub_a_${tag}`;
    const subB = `sub_b_${tag}`;
    const subShared = `sub_shared_${tag}`;
    const webhookIds: string[] = [];
    const subscriptionRow = (userId: string, subscriptionId: string) => ({
      user_id: userId,
      tier: "EMBER",
      status: "canceled",
      current_period_end: "2099-01-01T00:00:00.000Z",
      paddle_customer_id: sharedCustomer,
      paddle_subscription_id: subscriptionId,
    });
    try {
      await must("subscriptions", admin.from("subscriptions").insert([
        subscriptionRow(a.id, subA),
        subscriptionRow(b.id, subB),
      ]));

      const rows = [
        // A's own rows: must go.
        { event_type: "a-user", user_id: a.id, payload: { data: {} } },
        { event_type: "a-sub", paddle_subscription_id: subA, payload: { data: {} } },
        // B's rows, incl. ones keyed only by the shared customer id: must stay.
        { event_type: "b-user", user_id: b.id, paddle_customer_id: sharedCustomer, payload: { data: {} } },
        { event_type: "b-customer", paddle_customer_id: sharedCustomer, payload: { data: {} } },
        { event_type: "b-sub", paddle_subscription_id: subB, paddle_customer_id: sharedCustomer, payload: { data: {} } },
      ];
      const seeded = await admin.from("paddle_webhook_events").insert(rows).select("id");
      if (seeded.error) {
        if (isMissingRelation(seeded.error)) {
          // Prod-only table (a migration arrives with PR 2): nothing to exercise here.
          console.warn("paddle_webhook_events absent: R-21 real-SQL check skipped on this stack");
          return;
        }
        throw new Error(`seed failed: ${JSON.stringify(seeded.error)}`);
      }
      webhookIds.push(...(seeded.data ?? []).map((r) => (r as { id: string }).id));

      const eventTypes = async () => {
        const { data, error } = await admin.from("paddle_webhook_events")
          .select("event_type").in("id", webhookIds);
        if (error) throw new Error(JSON.stringify(error));
        return (data ?? []).map((r) => (r as { event_type: string }).event_type).sort();
      };

      // Case 1: shared customer id, distinct subscription ids.
      const first = await silenced(() => purgeUser(admin, a.id, fakePaddle({ status: "canceled" }).deps));
      assertEquals(first.ok, true);
      assertEquals(await eventTypes(), ["b-customer", "b-sub", "b-user"]);

      // Case 2: a subscription id referenced by two users' rows is skipped.
      const c = await createAuthUser(admin, "shared-c");
      try {
        await must(
          "b shares subscription",
          admin.from("subscriptions").update({ paddle_subscription_id: subShared }).eq("user_id", b.id),
        );
        await must("c shares subscription", admin.from("subscriptions").insert(subscriptionRow(c.id, subShared)));
        const sharedRow = await must(
          "shared webhook",
          admin.from("paddle_webhook_events")
            .insert({ event_type: "shared-sub", paddle_subscription_id: subShared, payload: { data: {} } })
            .select("id").single(),
        );
        webhookIds.push((sharedRow.data as { id: string }).id);

        const second = await silenced(() => purgeUser(admin, c.id, fakePaddle({ status: "canceled" }).deps));
        assertEquals(second.ok, true);
        assertEquals(await eventTypes(), ["b-customer", "b-sub", "b-user", "shared-sub"]);
      } finally {
        await cleanupUsers(admin, [c.id]);
      }
    } finally {
      if (webhookIds.length > 0) {
        await admin.from("paddle_webhook_events").delete().in("id", webhookIds);
      }
      await cleanupUsers(admin, [a.id, b.id]);
    }
  },
});
