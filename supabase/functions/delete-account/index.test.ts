import { assert, assertEquals } from "jsr:@std/assert@1";
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
const PAST = "2020-01-01T00:00:00.000Z";
const FUTURE = "2999-01-01T00:00:00.000Z";

// ---------------------------------------------------------------------------
// In-process doubles
// ---------------------------------------------------------------------------

type Call =
  | { kind: "select"; table: string; filters: [string, unknown][] }
  | { kind: "delete"; table: string; filters: [string, unknown][] }
  | { kind: "update"; table: string; values: unknown; filters: [string, unknown][] }
  | { kind: "rpc"; name: string; args: unknown }
  | { kind: "deleteUser"; userId: string }
  | { kind: "storage.list"; prefix: string }
  | { kind: "storage.remove"; paths: string[] };

interface FakeState {
  calls: Call[];
  deletionRequest: { id: string; scheduled_for: string; status: string } | null;
  subscription: { paddle_subscription_id: string | null } | null;
  avatars: string[];
  rateLimitAllowed: boolean;
  /** Tables whose delete fails with this error. */
  deleteErrors: Record<string, { code?: string; message: string }>;
  deleteUserError: { status?: number; message: string } | null;
}

function fakeState(overrides: Partial<FakeState> = {}): FakeState {
  return {
    calls: [],
    deletionRequest: { id: "req-1", scheduled_for: PAST, status: "pending" },
    subscription: null,
    avatars: ["avatar.png"],
    rateLimitAllowed: true,
    deleteErrors: {},
    deleteUserError: null,
    ...overrides,
  };
}

class FakeQuery {
  private filters: [string, unknown][] = [];
  constructor(
    private state: FakeState,
    private table: string,
    private op: "select" | "delete" | "update",
    private values?: unknown,
  ) {}

  eq(column: string, value: unknown) {
    this.filters.push([column, value]);
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
    return Promise.resolve({ data: this.row(), error: null });
  }

  then<T>(resolve: (value: { data: null; error: unknown }) => T) {
    this.record();
    const error = this.op === "delete" ? this.state.deleteErrors[this.table] ?? null : null;
    return Promise.resolve({ data: null, error }).then(resolve);
  }
}

function fakeAdmin(state: FakeState): SupabaseClient {
  const client = {
    from(table: string) {
      return {
        select: () => new FakeQuery(state, table, "select"),
        delete: () => new FakeQuery(state, table, "delete"),
        update: (values: unknown) => new FakeQuery(state, table, "update", values),
      };
    },
    rpc(name: string, args: unknown) {
      state.calls.push({ kind: "rpc", name, args });
      return Promise.resolve({
        data: [{
          allowed: state.rateLimitAllowed,
          remaining: 0,
          retry_after_seconds: state.rateLimitAllowed ? null : 3600,
        }],
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

// ---------------------------------------------------------------------------
// Handler tests
// ---------------------------------------------------------------------------

Deno.test("delete-account: a Paddle cancel failure returns 5xx, keeps the request pending and the avatar intact", async () => {
  const state = fakeState({ subscription: { paddle_subscription_id: SUBSCRIPTION_ID } });
  const paddle = fakePaddle({ status: "active", cancelStatus: 500 });

  const res = await silenced(() => handlerFor(state, paddle.deps)(post()));

  assertEquals(res.status, 502);
  assertEquals(state.deletionRequest?.status, "pending");
  assertEquals(state.avatars, ["avatar.png"]);
  assertEquals(indexOfCall(state, isAvatarRemove), -1);
  assertEquals(indexOfCall(state, isDeleteUser), -1);
  assertEquals(state.calls.filter((c) => c.kind === "delete").length, 0, "no row deleted");
  assert(
    !state.calls.some((c) => c.kind === "update" && c.table === "deletion_requests"),
    "the request status is never touched",
  );
});

Deno.test("delete-account: a Paddle status lookup failure aborts before anything is deleted", async () => {
  const state = fakeState({ subscription: { paddle_subscription_id: SUBSCRIPTION_ID } });
  const paddle = fakePaddle({ getStatus: 503 });

  const res = await silenced(() => handlerFor(state, paddle.deps)(post()));

  assertEquals(res.status, 502);
  assertEquals(paddle.calls.filter((c) => c.method === "POST").length, 0);
  assertEquals(indexOfCall(state, isDeleteUser), -1);
  assertEquals(state.avatars, ["avatar.png"]);
});

Deno.test("delete-account: a missing PADDLE_API_KEY aborts when the user has a subscription id", async () => {
  const state = fakeState({ subscription: { paddle_subscription_id: SUBSCRIPTION_ID } });
  const paddle = fakePaddle({});
  paddle.deps.paddleApiKey = undefined;

  const res = await silenced(() => handlerFor(state, paddle.deps)(post()));

  assertEquals(res.status, 502);
  assertEquals(paddle.calls.length, 0);
  assertEquals(indexOfCall(state, isDeleteUser), -1);
});

Deno.test("delete-account: a paused subscription is cancelled immediately before the user is deleted", async () => {
  const state = fakeState({ subscription: { paddle_subscription_id: SUBSCRIPTION_ID } });
  const paddle = fakePaddle({ status: "paused" });

  const res = await silenced(() => handlerFor(state, paddle.deps)(post()));

  assertEquals(res.status, 200);
  assertEquals(paddle.calls.map((c) => `${c.method} ${c.path}`), [
    `GET /subscriptions/${SUBSCRIPTION_ID}`,
    `POST /subscriptions/${SUBSCRIPTION_ID}/cancel`,
  ]);
  assertEquals(paddle.calls[1].body, { effective_from: "immediately" });
  assert(indexOfCall(state, isDeleteUser) >= 0);
});

Deno.test("delete-account: every non-canceled live status is cancelled; canceled makes no cancel call", async () => {
  for (const status of ["active", "trialing", "past_due", "paused", "some_future_status"]) {
    const state = fakeState({ subscription: { paddle_subscription_id: SUBSCRIPTION_ID } });
    const paddle = fakePaddle({ status });
    const res = await silenced(() => handlerFor(state, paddle.deps)(post()));
    assertEquals(res.status, 200, status);
    assertEquals(paddle.calls.filter((c) => c.method === "POST").length, 1, status);
  }
  const state = fakeState({ subscription: { paddle_subscription_id: SUBSCRIPTION_ID } });
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
  const state = fakeState({
    subscription: { paddle_subscription_id: SUBSCRIPTION_ID },
    rateLimitAllowed: false,
  });
  const paddle = fakePaddle({});
  const res = await silenced(() => handlerFor(state, paddle.deps)(post()));
  assertEquals(res.status, 429);
  assertEquals(paddle.calls.length, 0);
  assertEquals(indexOfCall(state, isDeleteUser), -1);
  assertEquals(state.avatars, ["avatar.png"]);
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
  const state = fakeState({ subscription: { paddle_subscription_id: SUBSCRIPTION_ID } });
  const res = await silenced(() => handlerFor(state, fakePaddle({ status: "active" }).deps)(post()));
  assertEquals(res.status, 200);

  const deleteUserAt = indexOfCall(state, isDeleteUser);
  assert(deleteUserAt > 0);
  // Local mirror of the cancel happens first.
  const mirrorAt = indexOfCall(
    state,
    (c) => c.kind === "update" && c.table === "subscriptions",
  );
  assert(mirrorAt >= 0 && mirrorAt < deleteUserAt);
  for (const target of EXPLICIT_PURGE_TARGETS) {
    const first = indexOfCall(state, deletesTable(target.table));
    const last = lastIndexOfCall(state, deletesTable(target.table));
    assert(first >= 0 && first < deleteUserAt, `${target.table} purged before deleteUser`);
    assert(last > deleteUserAt, `${target.table} swept again after deleteUser`);
  }
  // Tables the cascade writes into are cleaned after the user is gone.
  assert(lastIndexOfCall(state, deletesTable("sync_tombstones")) > deleteUserAt);
  assert(lastIndexOfCall(state, deletesTable("subscription_events")) > deleteUserAt);
  assert(indexOfCall(state, isAvatarRemove) > deleteUserAt);
  assertEquals(state.avatars, []);
});

Deno.test("delete-account: a table that does not exist here is skipped, any other delete error aborts", async () => {
  const missing = fakeState({
    deleteErrors: {
      goal_snapshots: { code: "PGRST205", message: "Could not find the table 'public.goal_snapshots'" },
      telemetry_analysis: { code: "42P01", message: 'relation "telemetry_analysis" does not exist' },
    },
  });
  const res1 = await silenced(() => handlerFor(missing, fakePaddle({}).deps)(post()));
  assertEquals(res1.status, 200);
  assert(indexOfCall(missing, isDeleteUser) >= 0);

  const broken = fakeState({
    deleteErrors: { oauth_tokens: { code: "57014", message: "canceling statement due to statement timeout" } },
  });
  const res2 = await silenced(() => handlerFor(broken, fakePaddle({}).deps)(post()));
  assertEquals(res2.status, 500);
  assertEquals(indexOfCall(broken, isDeleteUser), -1);
  assertEquals(broken.avatars, ["avatar.png"]);
});

Deno.test("delete-account: deleteUser failing after a Paddle cancel reports the partial failure", async () => {
  const state = fakeState({
    subscription: { paddle_subscription_id: SUBSCRIPTION_ID },
    deleteUserError: { status: 500, message: "Database error deleting user" },
  });
  const res = await silenced(() => handlerFor(state, fakePaddle({ status: "active" }).deps)(post()));
  assertEquals(res.status, 500);
  assertEquals((await res.json()).code, "billing_canceled_account_delete_failed");
  assertEquals(state.deletionRequest?.status, "pending");
  assertEquals(state.avatars, ["avatar.png"]);
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
    ...(paddleSubscriptionId ? { paddle_subscription_id: paddleSubscriptionId } : {}),
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
  // Prod-only table: seeded (one row by user_id, one naming the user only in
  // the payload) when the local stack has it.
  const webhooks = await admin.from("paddle_webhook_events").insert([
    { user_id: user.id, event_type: "subscription.updated", payload: { data: {} } },
    {
      event_type: "transaction.completed",
      payload: { data: { custom_data: { user_id: user.id } } },
    },
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

async function rowsReferencing(admin: SupabaseClient, userId: string): Promise<string[]> {
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
  // paddle_webhook_events rows naming the user only in the payload.
  const payload = await admin
    .from("paddle_webhook_events")
    .select("*", { count: "exact", head: true })
    .eq("payload->data->custom_data->>user_id", userId);
  if (!payload.error && (payload.count ?? 0) > 0) {
    found.push(`paddle_webhook_events.payload=${payload.count}`);
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
      const before = await rowsReferencing(admin, user.id);
      assert(before.length >= 6, `fixture seeded rows: ${before.join(", ")}`);
      assertEquals(await avatarNames(admin, user.id), ["avatar.png"]);

      const paddle = fakePaddle({ status: "paused" });
      const result = await silenced(() => purgeUser(admin, user.id, paddle.deps));

      assertEquals(result, { ok: true, billingCancelled: true, residualTables: [] });
      assertEquals(paddle.calls.map((c) => c.method), ["GET", "POST"]);
      const gone = await admin.auth.admin.getUserById(user.id);
      assert(gone.error || !gone.data.user, "auth user deleted");
      assertEquals(await rowsReferencing(admin, user.id), []);
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
