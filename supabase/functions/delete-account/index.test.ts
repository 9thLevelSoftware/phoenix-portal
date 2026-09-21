import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import {
  EXPLICIT_PURGE_TARGETS,
  purgeUser,
  type PurgeUserDependencies,
} from "../_shared/accountPurge.ts";
import { localIntegrationEnvironment } from "../_shared/localIntegrationEnvironment.ts";
import { assertNoSecretsLogged, captureLogs } from "../_shared/testLogCapture.ts";
import { createDeleteAccountHandler } from "./index.ts";
import {
  createDeleteAccountHandler,
  PROCESS_DUE_BATCH_SIZE,
  STUCK_CLAIM_MINUTES,
} from "./index.ts";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_USER_ID = "22222222-2222-4222-8222-222222222222";
const SUBSCRIPTION_ID = "sub_01purgetest";
const CUSTOMER_ID = "ctm_01purgetest";
const THIRD_USER_ID = "33333333-3333-4333-8333-333333333333";
const CRON_SECRET = "test-cron-secret";
const PAST = "2020-01-01T00:00:00.000Z";
const FUTURE = "2999-01-01T00:00:00.000Z";
const STRAVA_TOKEN_URL = "https://www.strava.com/oauth/token";
const REFRESHED_STRAVA_ACCESS = "refreshed-strava-access-secret";
const REFRESHED_STRAVA_REFRESH = "refreshed-strava-refresh-secret";

// ---------------------------------------------------------------------------
// In-process doubles
// ---------------------------------------------------------------------------

type Call =
  | { kind: "select"; table: string; filters: [string, unknown][] }
  | { kind: "delete"; table: string; filters: [string, unknown][] }
  | { kind: "update"; table: string; values: Record<string, unknown>; filters: [string, unknown][] }
  | { kind: "rpc"; name: string; args: unknown }
  | { kind: "revoke"; url: string }
  | { kind: "deleteUser"; userId: string }
  | { kind: "storage.list"; prefix: string }
  | { kind: "storage.remove"; paths: string[] };

interface FakeError {
  code?: string;
  message: string;
}

interface FakeRequest {
  id: string;
  /** Defaults to USER_ID. */
  user_id?: string;
  scheduled_for: string;
  status: string;
  executed_at?: string | null;
  claimed_at?: string | null;
  needs_support_reason?: string | null;
  last_attempt_at?: string | null;
}

interface FakeSubscription {
  paddle_subscription_id: string | null;
  paddle_customer_id?: string | null;
  status?: string;
}

interface FakeState {
  calls: Call[];
  /** Every deletion_requests row (a deleted user's rows cascade away). */
  deletionRequests: FakeRequest[];
  /** USER_ID's request (accessor over `deletionRequests`). */
  deletionRequest: FakeRequest | null;
  /** subscriptions rows by user id. */
  subscriptions: Record<string, FakeSubscription | null>;
  /** USER_ID's subscription (accessor over `subscriptions`). */
  subscription: FakeSubscription | null;
  /** Error returned by the subscriptions lookup. */
  subscriptionError: FakeError | null;
  /** Avatar object names by folder key (`<uid>` or `<uid>/<prefix>`). */
  avatarFolders: Record<string, string[]>;
  /** true: storage.remove reports success but deletes nothing. */
  avatarRemoveNoop: boolean;
  /** USER_ID's avatar files (accessor over `avatarFolders`). */
  avatars: string[];
  /** Users removed by auth.admin.deleteUser. */
  deletedUsers: string[];
  /** What public.sweep_deleted_account_residue returns. */
  sweepResult: {
    deleted: Record<string, number>;
    skipped: string[];
    orphan_avatar_folders: string[];
  };
  sweepError: FakeError | null;
  /** Awaited before a deletion_requests list select resolves. */
  beforeListSelect?: (filters: [string, unknown][]) => Promise<void> | void;
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
  /** Stored provider tokens (plaintext: no encryption key in tests). */
  oauthTokens: {
    provider: string;
    access_token: string | null;
    refresh_token: string | null;
    token_expires_at?: string | null;
  }[];
  /** Error returned by the step-1b provider-list read of oauth_tokens. */
  tokenListError: FakeError | null;
  /** Error returned by the per-provider token read (maybeSingle). */
  tokenReadError: FakeError | null;
  /** Error returned by rpc('disconnect_integration'). */
  disconnectRpcError: FakeError | null;
}

function fakeState(overrides: Partial<FakeState> = {}): FakeState {
  const state = {
    calls: [],
    deletionRequests: [],
    subscriptions: {},
    avatarFolders: {},
    avatarRemoveNoop: false,
    deletedUsers: [],
    sweepResult: { deleted: {}, skipped: [], orphan_avatar_folders: [] },
    sweepError: null,
    subscriptionError: null,
    rateLimitAllowed: true,
    rateLimitUsed: false,
    deleteErrors: {},
    updateErrors: {},
    deleteUserError: null,
    claimRace: false,
    otherSubscriptionRefs: {},
    sharedCheckError: null,
    oauthTokens: [],
    tokenListError: null,
    tokenReadError: null,
    disconnectRpcError: null,
    ...overrides,
  } as unknown as FakeState;
  Object.defineProperties(state, {
    deletionRequest: {
      enumerable: true,
      get: () => state.deletionRequests.find((r) => (r.user_id ?? USER_ID) === USER_ID) ?? null,
      set: (row: FakeRequest | null) => {
        state.deletionRequests = state.deletionRequests.filter(
          (r) => (r.user_id ?? USER_ID) !== USER_ID,
        );
        if (row) {
          row.user_id = USER_ID;
          state.deletionRequests.push(row);
        }
      },
    },
    subscription: {
      enumerable: true,
      get: () => state.subscriptions[USER_ID] ?? null,
      set: (row: FakeSubscription | null) => {
        state.subscriptions[USER_ID] = row;
      },
    },
    avatars: {
      enumerable: true,
      get: () => state.avatarFolders[USER_ID] ?? [],
      set: (names: string[]) => {
        state.avatarFolders[USER_ID] = names;
      },
    },
  });
  state.deletionRequest = {
    id: "req-1",
    scheduled_for: PAST,
    status: "pending",
    executed_at: null,
    claimed_at: null,
    needs_support_reason: null,
    last_attempt_at: null,
  };
  state.subscription = null;
  state.avatars = ["avatar.png"];
  Object.assign(state, overrides);
  return state;
}

/** A user-side "cancel deletion": RLS only lets it touch a pending row. */
function userCancelsDeletion(state: FakeState, userId = USER_ID): boolean {
  const row = state.deletionRequests.find((r) => (r.user_id ?? USER_ID) === userId);
  if (row?.status !== "pending") return false;
  row.status = "cancelled";
  return true;
}

/** A pending (or other) deletion request for `userId`. */
function requestFor(userId: string, overrides: Partial<FakeRequest> = {}): FakeRequest {
  return {
    id: `req-${userId.slice(0, 8)}`,
    user_id: userId,
    scheduled_for: PAST,
    status: "pending",
    executed_at: null,
    claimed_at: null,
    needs_support_reason: null,
    last_attempt_at: null,
    ...overrides,
  };
}

/** The `.or("a.is.null,b.lt.x")` disjunction, stored as one filter entry. */
const OR_FILTER = "__or";

function matchesTerm(row: Record<string, unknown>, key: string, value: unknown): boolean {
  const [, column, op] = key.match(/^(.+?)( in| is|!=|<=|<)?$/) ?? [];
  const actual = row[column] ?? null;
  switch (op) {
    case "!=":
      return actual !== value;
    case "<":
      return actual !== null && String(actual) < String(value);
    case "<=":
      return actual !== null && String(actual) <= String(value);
    case " in":
      return (value as unknown[]).includes(actual);
    case " is":
      return actual === value;
    default:
      return actual === value;
  }
}

/** PostgREST-style filter keys: `col` (eq), `col!=`, `col<`, `col<=`, `col in`, `col is`. */
function rowMatches(row: Record<string, unknown>, filters: [string, unknown][]): boolean {
  return filters.every(([key, value]) => {
    if (key !== OR_FILTER) return matchesTerm(row, key, value);
    // `col.op.value` terms, any of which may match.
    return String(value).split(",").some((term) => {
      const [column, op, ...rest] = term.split(".");
      const raw = rest.join(".");
      if (op === "is") return matchesTerm(row, `${column} is`, raw === "null" ? null : raw);
      if (op === "lt") return matchesTerm(row, `${column}<`, raw);
      if (op === "eq") return matchesTerm(row, column, raw);
      throw new Error(`fake: unsupported or() operator ${op}`);
    });
  });
}

class FakeQuery {
  private filters: [string, unknown][] = [];
  private returnRows = false;
  private headCount = false;
  private orderBy: { column: string; ascending: boolean; nullsFirst: boolean }[] = [];
  private maxRows: number | null = null;
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

  lt(column: string, value: unknown) {
    this.filters.push([`${column}<`, value]);
    return this;
  }

  lte(column: string, value: unknown) {
    this.filters.push([`${column}<=`, value]);
    return this;
  }

  in(column: string, values: unknown[]) {
    this.filters.push([`${column} in`, values]);
    return this;
  }

  is(column: string, value: unknown) {
    this.filters.push([`${column} is`, value]);
    return this;
  }

  or(expression: string) {
    this.filters.push([OR_FILTER, expression]);
    return this;
  }

  order(column: string, options: { ascending?: boolean; nullsFirst?: boolean } = {}) {
    this.orderBy.push({
      column,
      ascending: options.ascending ?? true,
      // PostgREST/Postgres default: NULLs last on ASC.
      nullsFirst: options.nullsFirst ?? false,
    });
    return this;
  }

  limit(n: number) {
    this.maxRows = n;
    return this;
  }

  select(_columns?: string, options: { head?: boolean } = {}) {
    this.returnRows = true;
    this.headCount = options.head === true;
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

  private matchingRequests(): FakeRequest[] {
    return this.state.deletionRequests.filter((r) =>
      rowMatches({ ...r, user_id: r.user_id ?? USER_ID }, this.filters)
    );
  }

  private row(): unknown {
    if (this.table === "deletion_requests") return this.matchingRequests()[0] ?? null;
    if (this.table === "subscriptions") {
      const userId = this.filters.find(([c]) => c === "user_id")?.[1];
      return this.state.subscriptions[String(userId)] ?? null;
    }
    if (this.table === "subscriptions") return this.state.subscription;
    if (this.table === "oauth_tokens") {
      const provider = this.filters.find(([c]) => c === "provider")?.[1];
      return this.state.oauthTokens.find((t) => t.provider === provider) ?? null;
    }
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
    if (this.table === "oauth_tokens" && this.state.tokenReadError) {
      return Promise.resolve({ data: null, error: this.state.tokenReadError });
    }
    return Promise.resolve({ data: this.row(), error: null });
  }

  private resolveUpdate(): { data: unknown; error: unknown } {
    const error = this.state.updateErrors[this.table] ?? null;
    if (error) return { data: null, error };
    if (this.table !== "deletion_requests") return { data: this.returnRows ? [] : null, error: null };
    const isClaim = this.values.status === "executing";
    const matched = isClaim && this.state.claimRace ? [] : this.matchingRequests();
    for (const request of matched) Object.assign(request, this.values);
    return {
      data: this.returnRows
        ? matched.map((r) => ({
          id: r.id,
          user_id: r.user_id ?? USER_ID,
          claimed_at: r.claimed_at ?? null,
        }))
        : null,
      error: null,
    };
  }

  private async resolveList(): Promise<{ data: unknown; error: unknown }> {
    let rows = this.matchingRequests().map((r) => ({ ...r, user_id: r.user_id ?? USER_ID }));
    if (this.orderBy.length > 0) {
      rows = rows.sort((a, b) => {
        for (const { column, ascending, nullsFirst } of this.orderBy) {
          const x = (a as Record<string, unknown>)[column] ?? null;
          const y = (b as Record<string, unknown>)[column] ?? null;
          if (x === null && y === null) continue;
          if (x === null) return nullsFirst ? -1 : 1;
          if (y === null) return nullsFirst ? 1 : -1;
          const cmp = String(x) < String(y) ? -1 : String(x) > String(y) ? 1 : 0;
          if (cmp !== 0) return cmp * (ascending ? 1 : -1);
        }
        return 0;
      });
    }
    if (this.maxRows !== null) rows = rows.slice(0, this.maxRows);
    await this.state.beforeListSelect?.(this.filters);
    return { data: rows, error: null };
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
    if (this.op === "select" && this.table === "deletion_requests" && !this.headCount) {
      return this.resolveList().then(resolve);
    }
    const result = this.op === "update"
      ? this.resolveUpdate()
      : this.op === "delete"
      ? this.resolveDelete()
      : this.table === "oauth_tokens"
      ? this.state.tokenListError
        ? { data: null, error: this.state.tokenListError }
        : { data: this.state.oauthTokens.map((t) => ({ provider: t.provider })), error: null }
      : this.resolveCount();
    return Promise.resolve(result).then(resolve);
  }
}

function fakeAdmin(state: FakeState): SupabaseClient {
  const client = {
    from(table: string) {
      return {
        select: (columns?: string, options?: { head?: boolean }) =>
          new FakeQuery(state, table, "select").select(columns, options),
        delete: () => new FakeQuery(state, table, "delete"),
        update: (values: Record<string, unknown>) => new FakeQuery(state, table, "update", values),
      };
    },
    rpc(name: string, args: unknown) {
      state.calls.push({ kind: "rpc", name, args });
      if (name === "disconnect_integration") {
        const error = state.disconnectRpcError;
        if (!error) {
          const provider = (args as { p_provider: string }).p_provider;
          state.oauthTokens = state.oauthTokens.filter((t) => t.provider !== provider);
        }
        return Promise.resolve({ data: null, error });
      if (name === "sweep_deleted_account_residue") {
        return Promise.resolve(
          state.sweepError
            ? { data: null, error: state.sweepError }
            : { data: state.sweepResult, error: null },
        );
      }
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
          if (!state.deleteUserError) {
            // ON DELETE CASCADE: the user's deletion request goes too.
            state.deletedUsers.push(userId);
            state.deletionRequests = state.deletionRequests.filter(
              (r) => (r.user_id ?? USER_ID) !== userId,
            );
          }
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
              // Supabase reports a nested prefix as a placeholder with a null
              // id; a real object carries one.
              data: (state.avatarFolders[prefix] ?? [])
                .filter((name) =>
                  // An emptied prefix stops being listed, as in Storage.
                  state.avatarFolders[`${prefix}/${name}`] === undefined ||
                  state.avatarFolders[`${prefix}/${name}`].length > 0
                )
                .map((name) => ({
                  name,
                  id: state.avatarFolders[`${prefix}/${name}`] === undefined
                    ? `obj-${prefix}/${name}`
                    : null,
                })),
              error: null,
            });
          },
          remove(paths: string[]) {
            state.calls.push({ kind: "storage.remove", paths });
            if (state.avatarRemoveNoop) return Promise.resolve({ data: [], error: null });
            for (const path of paths) {
              const cut = path.lastIndexOf("/");
              const folder = path.slice(0, cut);
              const name = path.slice(cut + 1);
              state.avatarFolders[folder] = (state.avatarFolders[folder] ?? []).filter(
                (file) => file !== name,
              );
            }
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
  /** Also records provider revoke calls into this state's call log. */
  state?: FakeState;
  /** HTTP status the provider revoke endpoint answers with. */
  revokeStatus?: number;
}): {
  deps: PurgeUserDependencies;
  calls: PaddleCall[];
  revokeCalls: { url: string; body: string }[];
  refreshCalls: { body: string }[];
} {
  const calls: PaddleCall[] = [];
  const revokeCalls: { url: string; body: string }[] = [];
  const refreshCalls: { body: string }[] = [];
  // Never reach a real provider, in unit or integration tests.
  const revokeFetch = (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url === STRAVA_TOKEN_URL) {
      refreshCalls.push({ body: String(init?.body ?? "") });
      return Promise.resolve(
        new Response(
          JSON.stringify({
            access_token: REFRESHED_STRAVA_ACCESS,
            refresh_token: REFRESHED_STRAVA_REFRESH,
            expires_at: Math.floor(Date.now() / 1000) + 21600,
          }),
          { status: 200 },
        ),
      );
    }
    revokeCalls.push({ url, body: String(init?.body ?? "") });
    options.state?.calls.push({ kind: "revoke", url });
    return Promise.resolve(new Response("{}", { status: options.revokeStatus ?? 200 }));
  };
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
    revokeCalls,
    refreshCalls,
    deps: {
      fetch: fetchImpl as typeof fetch,
      paddleApiKey: "test-paddle-key",
      paddleEnvironment: "sandbox",
      providerRevoke: {
        fetch: revokeFetch as typeof fetch,
        fitbitClientId: "fitbit-client",
        fitbitClientSecret: "fitbit-secret",
        stravaClientId: "strava-client",
        stravaClientSecret: "strava-client-secret",
        garminConsumerKey: "garmin-consumer",
        garminConsumerSecret: "garmin-consumer-secret",
      },
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
    env: (key) => (key === "CRON_SECRET" ? CRON_SECRET : undefined),
  });
}

function post(body?: unknown): Request {
  return new Request("http://localhost/functions/v1/delete-account", {
    method: "POST",
    headers: { Authorization: "Bearer user-jwt", "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** The pg_cron call: {mode:'process_due'} with x-cron-secret and no JWT. */
function cronPost(secret: string | null = CRON_SECRET, extraHeaders: Record<string, string> = {}): Request {
  return new Request("http://localhost/functions/v1/delete-account", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(secret === null ? {} : { "x-cron-secret": secret }),
      ...extraHeaders,
    },
    body: JSON.stringify({ mode: "process_due" }),
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
  return (await captured(run)).result;
}

/** Runs `run` with console output captured (first argument of each call). */
async function captured<T>(run: () => Promise<T>): Promise<{ result: T; lines: string[] }> {
  const original = { log: console.log, warn: console.warn, error: console.error };
  const lines: string[] = [];
  const capture = (...args: unknown[]) => {
    lines.push(String(args[0]));
  };
  console.log = capture;
  console.warn = capture;
  console.error = capture;
  try {
    return { result: await run(), lines };
  } finally {
    Object.assign(console, original);
  }
}

/** The purge never ran past billing: nothing deleted, user and avatar intact. */
function assertUntouched(state: FakeState) {
  assertEquals(state.deletionRequest?.status, "pending");
  assertEquals(state.deletionRequest?.claimed_at ?? null, null);
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
  assertEquals(requestUpdates.map((c) => c.kind === "update" && c.values.status), ["executing", "pending"]);
  assertEquals(state.deletionRequest?.needs_support_reason ?? null, null, "a transient failure is retried");
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
    assertEquals(
      state.deletionRequest?.needs_support_reason,
      "billing_subscription_not_found",
      "marked for support so process_due stops retrying",
    );
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
  let statusDuringPurge: string | undefined;
  const paddle = fakePaddle({
    onGet: () => {
      statusDuringPurge = state.deletionRequest?.status;
      cancelAccepted = userCancelsDeletion(state);
    },
  });

  const res = await silenced(() => handlerFor(state, paddle.deps)(post()));

  assertEquals(res.status, 200);
  assertEquals(statusDuringPurge, "executing");
  assertEquals(cancelAccepted, false);
  assertEquals(state.deletedUsers, [USER_ID]);
  assertEquals(state.deletionRequest, null, "the request cascaded away with the user");
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

const isRevoke = (call: Call) => call.kind === "revoke";
const isDisconnectRpc = (provider: string) => (call: Call) =>
  call.kind === "rpc" && call.name === "disconnect_integration" &&
  (call.args as { p_provider?: string }).p_provider === provider;

Deno.test("purgeUser: each connected provider is revoked, then disconnected, after billing and before any row delete (PR 54)", async () => {
  const state = withSubscription({
    oauthTokens: [
      // Expired (no expiry recorded): refreshed before the deauthorize.
      { provider: "strava", access_token: "strava-access-secret", refresh_token: "strava-refresh-secret" },
      { provider: "hevy", access_token: null, refresh_token: null },
    ],
  });
  const paddle = fakePaddle({ status: "active", state });
  const { result, logs } = await captureLogs(() => purgeUser(fakeAdmin(state), USER_ID, paddle.deps));
  assertEquals(result.ok, true);

  assertEquals(paddle.refreshCalls.length, 1, "expired strava token refreshed");
  assertEquals(JSON.parse(paddle.refreshCalls[0].body).refresh_token, "strava-refresh-secret");
  assertEquals(paddle.revokeCalls.length, 1, "only strava has a revocable grant");
  assertEquals(paddle.revokeCalls[0].url, "https://www.strava.com/oauth/deauthorize");
  assertEquals(
    new URLSearchParams(paddle.revokeCalls[0].body).get("access_token"),
    REFRESHED_STRAVA_ACCESS,
  );
  assertNoSecretsLogged(logs, [
    "strava-access-secret",
    "strava-refresh-secret",
    REFRESHED_STRAVA_ACCESS,
    REFRESHED_STRAVA_REFRESH,
  ]);

  const revokeAt = indexOfCall(state, isRevoke);
  const stravaRpcAt = indexOfCall(state, isDisconnectRpc("strava"));
  const hevyRpcAt = indexOfCall(state, isDisconnectRpc("hevy"));
  const firstRowDelete = indexOfCall(state, isRowDelete);
  assert(revokeAt >= 0 && revokeAt < stravaRpcAt, "revoke before disconnect_integration");
  assert(hevyRpcAt >= 0, "hevy disconnected too");
  assert(Math.max(stravaRpcAt, hevyRpcAt) < firstRowDelete, "disconnects before the pre-pass");
  assert(paddle.calls.length > 0 && indexOfCall(state, isDeleteUser) > firstRowDelete);
});

Deno.test("purgeUser: a failed provider revoke still disconnects and deletes the account (PR 54)", async () => {
  const state = fakeState({
    oauthTokens: [{ provider: "fitbit", access_token: "fb-access-secret", refresh_token: "fb-refresh-secret" }],
  });
  const paddle = fakePaddle({ state, revokeStatus: 503 });
  const { result, logs } = await captureLogs(() => purgeUser(fakeAdmin(state), USER_ID, paddle.deps));
  assertEquals(result.ok, true);
  assertEquals(new URLSearchParams(paddle.revokeCalls[0].body).get("token"), "fb-refresh-secret");
  assert(indexOfCall(state, isDisconnectRpc("fitbit")) > indexOfCall(state, isRevoke));
  assert(indexOfCall(state, isDeleteUser) >= 0);
  assertStringIncludes(logs, "provider revoke failed");
  assertNoSecretsLogged(logs, ["fb-access-secret", "fb-refresh-secret", "fitbit-secret"]);
});

Deno.test("purgeUser: a skipped revoke (fitbit client not configured) logs the reason, never the token (PR 54)", async () => {
  const state = fakeState({
    oauthTokens: [{ provider: "fitbit", access_token: "fb-access-secret", refresh_token: "fb-refresh-secret" }],
  });
  const paddle = fakePaddle({ state });
  const deps = {
    ...paddle.deps,
    providerRevoke: { ...paddle.deps.providerRevoke!, fitbitClientId: undefined, fitbitClientSecret: undefined },
  };
  const { result, logs } = await captureLogs(() => purgeUser(fakeAdmin(state), USER_ID, deps));
  assertEquals(result.ok, true);
  assertEquals(paddle.revokeCalls, []);
  assert(indexOfCall(state, isDisconnectRpc("fitbit")) >= 0);
  assertStringIncludes(logs, "fitbit_client_not_configured");
  assertNoSecretsLogged(logs, ["fb-access-secret", "fb-refresh-secret"]);
});

Deno.test("delete-account: a disconnect_integration error aborts the purge with the user intact (PR 54)", async () => {
  const state = fakeState({
    oauthTokens: [{ provider: "strava", access_token: "strava-access", refresh_token: null, token_expires_at: FUTURE }],
    disconnectRpcError: { code: "XX000", message: "boom" },
  });
  const res = await silenced(() => handlerFor(state, fakePaddle({ state }).deps)(post()));
  assertEquals(res.status, 500);
  assertUntouched(state);
});

Deno.test("purgeUser: a provider-list read error aborts step 1b with nothing revoked or deleted (R-10)", async () => {
  const state = fakeState({
    oauthTokens: [{ provider: "strava", access_token: "strava-access", refresh_token: null, token_expires_at: FUTURE }],
    tokenListError: { code: "57014", message: "canceling statement due to statement timeout" },
  });
  const paddle = fakePaddle({ state });
  const result = await silenced(() => purgeUser(fakeAdmin(state), USER_ID, paddle.deps));
  assertEquals(result.ok, false);
  assertEquals(result.ok === false && result.stage, "provider_disconnect");
  assertEquals(indexOfCall(state, isDeleteUser), -1);
  assertEquals(paddle.revokeCalls, []);
  assertEquals(indexOfCall(state, isDisconnectRpc("strava")), -1);

  const handlerState = fakeState({
    oauthTokens: state.oauthTokens,
    tokenListError: state.tokenListError,
  });
  const res = await silenced(() => handlerFor(handlerState, fakePaddle({ state: handlerState }).deps)(post()));
  assertEquals(res.status, 500);
  assertUntouched(handlerState);
});

Deno.test("purgeUser: a per-provider token read error aborts step 1b with nothing revoked or deleted (R-10)", async () => {
  const state = fakeState({
    oauthTokens: [{ provider: "strava", access_token: "strava-access", refresh_token: null, token_expires_at: FUTURE }],
    tokenReadError: { code: "57014", message: "canceling statement due to statement timeout" },
  });
  const paddle = fakePaddle({ state });
  const result = await silenced(() => purgeUser(fakeAdmin(state), USER_ID, paddle.deps));
  assertEquals(result.ok, false);
  assertEquals(result.ok === false && result.stage, "provider_disconnect");
  assertEquals(indexOfCall(state, isDeleteUser), -1);
  assertEquals(paddle.revokeCalls, []);
  assertEquals(indexOfCall(state, isDisconnectRpc("strava")), -1);

  const handlerState = fakeState({
    oauthTokens: state.oauthTokens,
    tokenReadError: state.tokenReadError,
  });
  const res = await silenced(() => handlerFor(handlerState, fakePaddle({ state: handlerState }).deps)(post()));
  assertEquals(res.status, 500);
  assertUntouched(handlerState);
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
// process_due: the hourly executor (KD-11, PR 35)
// ---------------------------------------------------------------------------

function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

function processDueState(overrides: Partial<FakeState> = {}): FakeState {
  // No avatars by default so each test states what it needs.
  return fakeState({ avatars: [], ...overrides });
}

const isPendingSelect = (filters: [string, unknown][]) =>
  filters.some(([c, v]) => c === "status" && v === "pending");

const isExecutingSelect = (filters: [string, unknown][]) =>
  filters.some(([c, v]) => c === "status" && v === "executing");

function requestUpdates(state: FakeState): { values: Record<string, unknown>; filters: [string, unknown][] }[] {
  return state.calls.flatMap((c) =>
    c.kind === "update" && c.table === "deletion_requests"
      ? [{ values: c.values, filters: c.filters }]
      : []
  );
}

Deno.test("process_due: a missing or wrong cron secret is refused with 401 and no side effect", async () => {
  const state = processDueState();
  const paddle = fakePaddle({});
  const handler = handlerFor(state, paddle.deps);

  // The wrong secret is the same length as CRON_SECRET, so a comparison that
  // only checks length cannot pass this on its own (R-22).
  const wrongSecret: string = "test-cron-secres";
  assertEquals(wrongSecret.length, CRON_SECRET.length);
  assert(wrongSecret !== CRON_SECRET);

  for (const req of [
    cronPost(null),
    cronPost(""),
    cronPost(wrongSecret),
    // A user JWT never authorises the batch mode.
    cronPost(null, { Authorization: "Bearer user-jwt" }),
  ]) {
    const res = await silenced(() => handler(req));
    assertEquals(res.status, 401);
  }

  // CRON_SECRET unset: even a header cannot match.
  const unconfigured = createDeleteAccountHandler({
    createAuthClient: () => ({ auth: { getUser: () => Promise.resolve({ data: { user: null } }) } }),
    createAdminClient: () => fakeAdmin(state),
    purge: (admin, userId) => purgeUser(admin, userId, paddle.deps),
    env: () => undefined,
  });
  assertEquals((await silenced(() => unconfigured(cronPost()))).status, 401);

  assertEquals(state.calls.length, 0);
  assertEquals(paddle.calls.length, 0);
  assertEquals(state.deletionRequest?.status, "pending");
});

Deno.test("process_due: two due requests are purged oldest first; a request not yet due is untouched", async () => {
  for (const liveStatus of ["active", "paused"]) {
    const state = processDueState();
    state.deletionRequests = [
      requestFor(OTHER_USER_ID, { scheduled_for: "2021-06-01T00:00:00.000Z" }),
      requestFor(USER_ID, { scheduled_for: PAST }),
      requestFor(THIRD_USER_ID, { scheduled_for: FUTURE }),
    ];
    state.subscriptions[USER_ID] = {
      paddle_subscription_id: SUBSCRIPTION_ID,
      paddle_customer_id: CUSTOMER_ID,
      status: "active",
    };
    const paddle = fakePaddle({ status: liveStatus });

    const res = await silenced(() => handlerFor(state, paddle.deps)(cronPost()));

    assertEquals(res.status, 200, liveStatus);
    const body = await res.json();
    // Counts only: pg_net stores this body, so no purged user id is in it.
    assertEquals(body.purged, 2, liveStatus);
    assertEquals(body.failed, 0);
    assertEquals(body.failed_by_stage, {});
    assertEquals(body.needs_support, 0);
    assertEquals(JSON.stringify(body).includes(USER_ID), false, "no user id in the body");
    assertEquals(state.deletedUsers, [USER_ID, OTHER_USER_ID]);
    // One immediate cancel for the subscriber, mirrored before deleteUser.
    const cancels = paddle.calls.filter((c) => c.method === "POST");
    assertEquals(cancels.length, 1, liveStatus);
    assertEquals(cancels[0].path, `/subscriptions/${SUBSCRIPTION_ID}/cancel`);
    assertEquals(cancels[0].body, { effective_from: "immediately" });
    const mirror = indexOfCall(state, (c) => c.kind === "update" && c.table === "subscriptions");
    const deleteSubscriber = indexOfCall(
      state,
      (c) => c.kind === "deleteUser" && c.userId === USER_ID,
    );
    assert(mirror >= 0 && mirror < deleteSubscriber, "cancel mirrored before deleteUser");
    // Not yet due: untouched.
    assertEquals(state.deletionRequests, [requestFor(THIRD_USER_ID, { scheduled_for: FUTURE })]);
    // The batch mode never charges the per-user rate limiter.
    assertEquals(indexOfCall(state, isRateLimit), -1);
  }
});

Deno.test("process_due: the claim stamps claimed_at, and the release clears it and stamps last_attempt_at (R-16)", async () => {
  const state = processDueState({
    subscription: { paddle_subscription_id: SUBSCRIPTION_ID, status: "active" },
  });
  let claimedAtDuringPurge: string | null | undefined;
  const paddle = fakePaddle({
    cancelStatus: 500,
    onGet: () => {
      claimedAtDuringPurge = state.deletionRequest?.claimed_at ?? null;
    },
  });

  await silenced(() => handlerFor(state, paddle.deps)(cronPost()));

  assert(
    typeof claimedAtDuringPurge === "string" && claimedAtDuringPurge.length > 0,
    `the claim must stamp claimed_at, got ${JSON.stringify(claimedAtDuringPurge)}`,
  );
  const claim = requestUpdates(state).find((u) => u.values.status === "executing");
  assertEquals(claim?.values.claimed_at, claimedAtDuringPurge);
  // Released for the next run: the stamp is cleared and the attempt recorded.
  assertEquals(state.deletionRequest?.status, "pending");
  assertEquals(state.deletionRequest?.claimed_at, null);
  assert(state.deletionRequest?.last_attempt_at, "the failed attempt is stamped");
});

Deno.test("process_due: a release is fenced on the claim it took, so it cannot flip a row another run holds (R-13)", async () => {
  const state = processDueState({
    subscription: { paddle_subscription_id: SUBSCRIPTION_ID, status: "active" },
  });
  // Mid-purge another run reclaims the row (a new claimed_at).
  const otherRunClaim = "2030-01-01T00:00:00.000Z";
  const paddle = fakePaddle({
    cancelStatus: 500,
    onGet: () => {
      const row = state.deletionRequest;
      if (row) row.claimed_at = otherRunClaim;
    },
  });

  const res = await silenced(() => handlerFor(state, paddle.deps)(cronPost()));

  assertEquals((await res.json()).failed, 1);
  assertEquals(state.deletionRequest?.status, "executing", "the other run's claim survives");
  assertEquals(state.deletionRequest?.claimed_at, otherRunClaim);
});

Deno.test("process_due: a Paddle failure leaves the request pending for the next hourly run", async () => {
  const state = processDueState({
    subscription: { paddle_subscription_id: SUBSCRIPTION_ID, status: "active" },
    avatars: ["avatar.png"],
  });

  const first = await silenced(() => handlerFor(state, fakePaddle({ cancelStatus: 500 }).deps)(cronPost()));
  assertEquals(first.status, 200);
  const report = await first.json();
  assertEquals(report.purged, 0);
  assertEquals(report.failed, 1);
  assertEquals(report.failed_by_stage, { billing_cancel: 1 });
  assertUntouched(state);
  assertEquals(state.deletionRequest?.needs_support_reason ?? null, null);

  // The next run retries it.
  const paddle = fakePaddle({});
  const second = await silenced(() => handlerFor(state, paddle.deps)(cronPost()));
  assertEquals((await second.json()).purged, 1);
  assertEquals(paddle.calls.map((c) => c.method), ["GET", "POST"]);
  assertEquals(state.deletedUsers, [USER_ID]);
});

Deno.test("process_due: billing_subscription_not_found is marked for support, alerted, and not retried hourly", async () => {
  const state = processDueState({
    subscription: { paddle_subscription_id: SUBSCRIPTION_ID, status: "active" },
  });

  const first = await captured(() =>
    handlerFor(state, fakePaddle({ getStatus: 404 }).deps)(cronPost())
  );
  const report = await first.result.json();
  assertEquals(report.needs_support, 1);
  assertEquals(state.deletionRequest?.status, "pending", "the user can still cancel");
  assertEquals(state.deletionRequest?.needs_support_reason, "billing_subscription_not_found");
  assert(
    first.lines.includes(`[DELETION_ALERT] needs_support billing_subscription_not_found user=${USER_ID}`),
    first.lines.join("\n"),
  );

  const paddle = fakePaddle({});
  const second = await silenced(() => handlerFor(state, paddle.deps)(cronPost()));
  assertEquals((await second.json()).purged, 0);
  assertEquals(paddle.calls.length, 0, "not retried");
  assertEquals(state.deletedUsers, []);
  assertEquals(state.deletionRequest?.status, "pending");
});

Deno.test("process_due: a cancel that lands before the claim leaves the account untouched", async () => {
  const state = processDueState({
    subscription: { paddle_subscription_id: SUBSCRIPTION_ID, status: "active" },
    avatars: ["avatar.png"],
  });
  state.beforeListSelect = (filters) => {
    if (isPendingSelect(filters)) userCancelsDeletion(state);
  };
  const paddle = fakePaddle({});

  const res = await silenced(() => handlerFor(state, paddle.deps)(cronPost()));

  assertEquals(res.status, 200);
  assertEquals((await res.json()).purged, 0);
  assertEquals(state.deletionRequest?.status, "cancelled");
  assertEquals(paddle.calls.length, 0);
  assertEquals(state.deletedUsers, []);
  assertEquals(state.avatars, ["avatar.png"]);
  assertEquals(state.calls.filter(isRowDelete).length, 0);
});

Deno.test("process_due: two concurrent runs purge a due request once", async () => {
  const state = processDueState({
    subscription: { paddle_subscription_id: SUBSCRIPTION_ID, status: "active" },
  });
  // Both runs read the due request before either claims it.
  let arrived = 0;
  let release!: () => void;
  const bothSelected = new Promise<void>((resolve) => (release = resolve));
  state.beforeListSelect = async (filters) => {
    if (!isPendingSelect(filters)) return;
    arrived++;
    if (arrived === 2) release();
    await bothSelected;
  };
  const paddle = fakePaddle({});

  const [a, b] = await silenced(() =>
    Promise.all([
      handlerFor(state, paddle.deps)(cronPost()),
      handlerFor(state, paddle.deps)(cronPost()),
    ])
  );

  assertEquals(arrived, 2);
  assertEquals((await a.json()).purged + (await b.json()).purged, 1);
  assertEquals(state.deletedUsers, [USER_ID]);
  assertEquals(paddle.calls.filter((c) => c.method === "POST").length, 1);
});

Deno.test("process_due: two concurrent runs reclaim and re-purge a stuck claim once (R-17)", async () => {
  const state = processDueState({
    subscription: { paddle_subscription_id: SUBSCRIPTION_ID, status: "active" },
  });
  state.deletionRequest = requestFor(USER_ID, {
    status: "executing",
    claimed_at: minutesAgo(STUCK_CLAIM_MINUTES + 1),
  });
  // Both runs read the stuck row before either re-stamps it.
  let arrived = 0;
  let release!: () => void;
  const bothSelected = new Promise<void>((resolve) => (release = resolve));
  state.beforeListSelect = async (filters) => {
    if (!isExecutingSelect(filters)) return;
    arrived++;
    if (arrived === 2) release();
    await bothSelected;
  };
  const paddle = fakePaddle({});

  const [a, b] = await silenced(() =>
    Promise.all([
      handlerFor(state, paddle.deps)(cronPost()),
      handlerFor(state, paddle.deps)(cronPost()),
    ])
  );

  assertEquals(arrived, 2);
  const reports = [await a.json(), await b.json()];
  assertEquals(reports[0].reclaimed + reports[1].reclaimed, 1, "only one run re-takes the claim");
  assertEquals(reports[0].purged + reports[1].purged, 1);
  assertEquals(state.deletedUsers, [USER_ID]);
  assertEquals(paddle.calls.filter((c) => c.method === "POST").length, 1);
});

Deno.test("process_due: a claim stuck past STUCK_CLAIM_MINUTES is reclaimed and purged; a fresher one is left alone", async () => {
  const state = processDueState();
  const recentClaim = minutesAgo(STUCK_CLAIM_MINUTES - 1);
  state.deletionRequests = [
    requestFor(USER_ID, { status: "executing", claimed_at: minutesAgo(STUCK_CLAIM_MINUTES + 1) }),
    requestFor(OTHER_USER_ID, { status: "executing", claimed_at: recentClaim }),
  ];

  const { result: res, lines } = await captured(() =>
    handlerFor(state, fakePaddle({}).deps)(cronPost())
  );

  const report = await res.json();
  assertEquals(report.reclaimed, 1);
  assertEquals(report.purged, 1);
  assertEquals(state.deletedUsers, [USER_ID]);
  assert(lines.includes(`[DELETION_ALERT] reclaimed_stuck_claim user=${USER_ID}`), lines.join("\n"));
  assert(!lines.some((l) => l.includes(`reclaimed_stuck_claim user=${OTHER_USER_ID}`)));
  assertEquals(state.deletionRequests, [
    requestFor(OTHER_USER_ID, { status: "executing", claimed_at: recentClaim }),
  ]);
  // The select itself is narrowed to stuck claims, not just the UPDATE.
  const executingSelect = state.calls.find((c) =>
    c.kind === "select" && c.table === "deletion_requests" && isExecutingSelect(c.filters)
  );
  assert(
    executingSelect?.kind === "select" &&
      executingSelect.filters.some(([key]) => key === OR_FILTER),
    "the stuck-claim select carries the claimed_at cutoff",
  );
});

Deno.test("process_due: an executing row with no claimed_at is reclaimed, not stranded (R-10)", async () => {
  const state = processDueState();
  state.deletionRequest = requestFor(USER_ID, { status: "executing", claimed_at: null });

  const { result: res, lines } = await captured(() =>
    handlerFor(state, fakePaddle({}).deps)(cronPost())
  );

  const report = await res.json();
  assertEquals(report.reclaimed, 1);
  assertEquals(report.purged, 1);
  assertEquals(state.deletedUsers, [USER_ID]);
  assert(lines.includes(`[DELETION_ALERT] reclaimed_stuck_claim user=${USER_ID}`), lines.join("\n"));
});

Deno.test("process_due: a reclaimed request whose purge fails again is released to pending", async () => {
  const state = processDueState({
    subscription: { paddle_subscription_id: SUBSCRIPTION_ID, status: "active" },
  });
  state.deletionRequest = requestFor(USER_ID, {
    status: "executing",
    claimed_at: minutesAgo(STUCK_CLAIM_MINUTES * 2),
  });

  const res = await silenced(() => handlerFor(state, fakePaddle({ cancelStatus: 503 }).deps)(cronPost()));

  const report = await res.json();
  assertEquals(report.failed, 1);
  assertEquals(report.failed_by_stage, { billing_cancel: 1 });
  assertEquals(state.deletionRequest?.status, "pending");
  assertEquals(state.deletionRequest?.claimed_at, null);
  assertEquals(state.deletedUsers, []);
});

Deno.test("process_due: a request that survives a successful purge is parked for support, never closed as executed (R-1)", async () => {
  // deletion_requests.user_id is ON DELETE CASCADE, so a surviving row means
  // the auth user survived too: deleteUser answered 404 for a live account.
  const state = processDueState({ deleteUserError: { status: 404, message: "User not found" } });
  state.deletionRequest = requestFor(USER_ID, {
    status: "executing",
    claimed_at: minutesAgo(STUCK_CLAIM_MINUTES + 1),
  });

  const { result: res, lines } = await captured(() =>
    handlerFor(state, fakePaddle({}).deps)(cronPost())
  );

  const report = await res.json();
  assertEquals(report.purged, 0, "an account that still exists was not purged");
  assertEquals(report.needs_support, 1);
  assertEquals(state.deletionRequest?.status, "pending", "still visible and cancellable");
  assertEquals(state.deletionRequest?.needs_support_reason, "request_survived_purge");
  assertEquals(state.deletionRequest?.claimed_at, null);
  assert(lines.includes(`[DELETION_ALERT] request_survived_purge user=${USER_ID}`), lines.join("\n"));

  // The hourly batch skips it (no reclaim loop, no silent re-purge), but it
  // is still surfaced by the needs-support alert instead of going quiet.
  const again = await silenced(() => handlerFor(state, fakePaddle({}).deps)(cronPost()));
  const second = await again.json();
  assertEquals(second.reclaimed, 0);
  assertEquals(second.purged, 0);
  assertEquals(state.deletionRequest?.status, "pending");

  // The user can still cancel it.
  assertEquals(userCancelsDeletion(state), true);
});

Deno.test("delete-account: a surviving request on the user path is reported as a failure, never as success (R-1)", async () => {
  const state = fakeState({ deleteUserError: { status: 404, message: "User not found" } });

  const { result: res, lines } = await captured(() =>
    handlerFor(state, fakePaddle({}).deps)(post())
  );

  assertEquals(res.status, 500);
  const body = await res.json();
  assertEquals(body.code, "request_survived_purge");
  assertEquals(body.success, undefined, "the SPA must not sign out a live account");
  assertEquals(state.deletionRequest?.status, "pending");
  assertEquals(state.deletionRequest?.needs_support_reason, "request_survived_purge");
  assert(lines.includes(`[DELETION_ALERT] request_survived_purge user=${USER_ID}`), lines.join("\n"));
});

Deno.test("delete-account: a purge that throws on the user path releases the claim (R-2)", async () => {
  const state = fakeState();
  const handler = createDeleteAccountHandler({
    createAuthClient: () => ({
      auth: { getUser: () => Promise.resolve({ data: { user: { id: USER_ID } } }) },
    }),
    createAdminClient: () => fakeAdmin(state),
    purge: () => {
      throw new Error("purge exploded");
    },
    env: (key) => (key === "CRON_SECRET" ? CRON_SECRET : undefined),
  });

  const res = await silenced(() => handler(post()));

  assertEquals(res.status, 500);
  assertEquals(state.deletionRequest?.status, "pending", "not left executing until the cron reclaim");
  assertEquals(state.deletionRequest?.claimed_at, null);
  assert(state.deletionRequest?.last_attempt_at);
});

Deno.test("process_due: at most 10 requests are executed per run, oldest first", async () => {
  const state = processDueState();
  const ids = Array.from({ length: 12 }, (_, i) =>
    `aaaaaaaa-aaaa-4aaa-8aaa-${String(i).padStart(12, "0")}`
  );
  state.deletionRequests = ids.map((id, i) =>
    requestFor(id, { id: `req-${i}`, scheduled_for: `2020-01-${String(i + 1).padStart(2, "0")}T00:00:00.000Z` })
  ).reverse();

  const res = await silenced(() => handlerFor(state, fakePaddle({}).deps)(cronPost()));

  assertEquals((await res.json()).purged, PROCESS_DUE_BATCH_SIZE);
  assertEquals(state.deletedUsers, ids.slice(0, 10));
  assertEquals(state.deletionRequests.map((r) => r.user_id).sort(), ids.slice(10));
});

Deno.test("process_due: rows that keep failing never starve a never-attempted request (R-9)", async () => {
  const state = processDueState({ deletionRequest: null });
  // A full batch of rows that have already failed, all scheduled earlier than
  // the fresh one, so plain scheduled_for ordering would shut it out for ever.
  const poisoned = Array.from({ length: PROCESS_DUE_BATCH_SIZE }, (_, i) =>
    requestFor(`bbbbbbbb-bbbb-4bbb-8bbb-${String(i).padStart(12, "0")}`, {
      id: `poison-${i}`,
      scheduled_for: `2020-01-${String(i + 1).padStart(2, "0")}T00:00:00.000Z`,
      last_attempt_at: minutesAgo(90),
    }));
  const fresh = requestFor(USER_ID, { id: "fresh", scheduled_for: "2021-01-01T00:00:00.000Z" });
  state.deletionRequests = [...poisoned, fresh];

  const res = await silenced(() => handlerFor(state, fakePaddle({}).deps)(cronPost()));

  assertEquals((await res.json()).purged, PROCESS_DUE_BATCH_SIZE);
  assert(
    state.deletedUsers.includes(USER_ID),
    `the never-attempted request must get a slot: ${state.deletedUsers.join(", ")}`,
  );
  assertEquals(state.deletedUsers[0], USER_ID, "never-attempted rows go first");
});

Deno.test("process_due: overdue rows alert; a row parked for support alerts under its own tag (R-12)", async () => {
  const state = processDueState();
  state.deletionRequests = [
    requestFor(USER_ID, { needs_support_reason: "billing_subscription_not_found" }),
    requestFor(THIRD_USER_ID, { scheduled_for: PAST }),
    requestFor(OTHER_USER_ID, { scheduled_for: minutesAgo(60 * 24) }),
  ];
  // The last one is due but not overdue; make every purge fail so rows stay.
  state.subscriptions[THIRD_USER_ID] = { paddle_subscription_id: SUBSCRIPTION_ID, status: "active" };
  state.subscriptions[OTHER_USER_ID] = { paddle_subscription_id: SUBSCRIPTION_ID, status: "active" };

  const { result: res, lines } = await captured(() =>
    handlerFor(state, fakePaddle({ cancelStatus: 500 }).deps)(cronPost())
  );

  const report = await res.json();
  assertEquals(report.overdue, 1, "only the row with no support reason");
  assertEquals(report.needs_support_overdue, 1);
  assert(lines.includes(`[DELETION_ALERT] overdue user=${THIRD_USER_ID}`), lines.join("\n"));
  assert(
    lines.includes(
      `[DELETION_ALERT] needs_support_overdue billing_subscription_not_found user=${USER_ID}`,
    ),
    lines.join("\n"),
  );
  assert(!lines.some((l) => l.startsWith(`[DELETION_ALERT] overdue user=${USER_ID}`)));
  assert(!lines.some((l) => l.includes(`overdue user=${OTHER_USER_ID}`)));
});

Deno.test("process_due: the residue sweep removes deleted users' avatar folders; a sweep failure is an alert, not a 5xx", async () => {
  const deadUser = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  const state = processDueState({ deletionRequest: null });
  state.sweepResult = {
    deleted: { sync_tombstones: 2 },
    skipped: [],
    orphan_avatar_folders: [deadUser],
  };
  state.avatarFolders[deadUser] = ["avatar.png", "old.png"];
  state.avatarFolders[OTHER_USER_ID] = ["avatar.png"];

  const res = await silenced(() => handlerFor(state, fakePaddle({}).deps)(cronPost()));

  assertEquals(res.status, 200);
  const report = await res.json();
  assertEquals(report.residue, {
    deleted: { sync_tombstones: 2 },
    skipped: [],
    avatar_folders_removed: 1,
    failed: false,
  });
  const sweep = state.calls.find((c) => c.kind === "rpc" && c.name === "sweep_deleted_account_residue");
  assertEquals(sweep && sweep.kind === "rpc" && sweep.args, { p_avatar_limit: 100 });
  assertEquals(state.avatarFolders[deadUser], []);
  assertEquals(state.avatarFolders[OTHER_USER_ID], ["avatar.png"], "live users' avatars untouched");

  const failing = processDueState({ deletionRequest: null, sweepError: { code: "57014", message: "timeout" } });
  const { result, lines } = await captured(() => handlerFor(failing, fakePaddle({}).deps)(cronPost()));
  assertEquals(result.status, 200);
  assertEquals((await result.json()).residue.failed, true);
  assert(lines.includes("[DELETION_ALERT] residue_sweep_failed"), lines.join("\n"));
});

Deno.test("process_due: a table the sweep had to skip is reported and alerted, not counted as clean (R-23)", async () => {
  const state = processDueState({ deletionRequest: null });
  state.sweepResult = {
    deleted: { sync_tombstones: 1 },
    skipped: ["paddle_webhook_events:42703"],
    orphan_avatar_folders: [],
  };

  const { result, lines } = await captured(() => handlerFor(state, fakePaddle({}).deps)(cronPost()));

  const report = await result.json();
  assertEquals(report.residue.skipped, ["paddle_webhook_events:42703"]);
  assertEquals(report.residue.failed, true, "a skipped table is residue that survived");
  assertEquals(report.residue.deleted, { sync_tombstones: 1 }, "the other tables were still swept");
  assert(lines.includes("[DELETION_ALERT] residue_sweep_skipped_tables"), lines.join("\n"));
});

Deno.test("process_due: an orphan avatar folder with a nested prefix is emptied recursively (R-25)", async () => {
  const deadUser = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
  const state = processDueState({ deletionRequest: null });
  state.sweepResult = { deleted: {}, skipped: [], orphan_avatar_folders: [deadUser] };
  // The avatars storage policy allows any key under `<uid>/%`, so a nested
  // prefix is reachable; the bucket is public, so a leftover stays fetchable.
  state.avatarFolders[deadUser] = ["avatar.png", "thumbs"];
  state.avatarFolders[`${deadUser}/thumbs`] = ["small.png"];

  const res = await silenced(() => handlerFor(state, fakePaddle({}).deps)(cronPost()));

  const report = await res.json();
  assertEquals(report.residue.avatar_folders_removed, 1);
  assertEquals(report.residue.failed, false);
  assertEquals(state.avatarFolders[deadUser], ["thumbs"], "only the prefix placeholder is left");
  assertEquals(state.avatarFolders[`${deadUser}/thumbs`], [], "the nested object is gone");
  const removed = state.calls.flatMap((c) => (c.kind === "storage.remove" ? c.paths : []));
  assert(removed.includes(`${deadUser}/thumbs/small.png`), removed.join(", "));
  assert(!removed.includes(`${deadUser}/thumbs`), "a prefix is never removed as if it were a file");
});

Deno.test("process_due: a folder that still holds objects after the removal is not counted as cleaned (R-25)", async () => {
  const deadUser = "ffffffff-ffff-4fff-8fff-ffffffffffff";
  const state = processDueState({ deletionRequest: null, avatarRemoveNoop: true });
  state.sweepResult = { deleted: {}, skipped: [], orphan_avatar_folders: [deadUser] };
  state.avatarFolders[deadUser] = ["avatar.png"];

  const { result, lines } = await captured(() => handlerFor(state, fakePaddle({}).deps)(cronPost()));

  const report = await result.json();
  assertEquals(report.residue.avatar_folders_removed, 0);
  assertEquals(report.residue.failed, true);
  assertEquals(state.avatarFolders[deadUser], ["avatar.png"]);
  assert(lines.includes("[DELETION_ALERT] avatar_cleanup_failed"), lines.join("\n"));
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
    refresh_token: "fixture-refresh-token",
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
      // PR 54: the fixture's Strava token has no expiry, so it was refreshed
      // (the rotated pair persisted to the real row) and the grant revoked
      // with the refreshed access token.
      assertEquals(paddle.refreshCalls.length, 1);
      assertEquals(paddle.revokeCalls.map((c) => c.url), ["https://www.strava.com/oauth/deauthorize"]);
      assertEquals(
        new URLSearchParams(paddle.revokeCalls[0].body).get("access_token"),
        REFRESHED_STRAVA_ACCESS,
      );
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

      // The claim writes the handler issues (the grace trigger and the
      // status CHECK accept them). The handler's extra `scheduled_for <= now`
      // filter is left out: the grace trigger refuses to seed a due request.
      const claimWrite = () =>
        admin.from("deletion_requests")
          .update({ status: "executing", claimed_at: new Date().toISOString() })
          .eq("id", requestId).eq("status", "pending").select("id, user_id, claimed_at");
      const claim = await must("claim", claimWrite());
      assertEquals(claim.data?.length, 1);
      const claimedAt = (claim.data?.[0] as { claimed_at: string }).claimed_at;
      assert(claimedAt, "the claim returns its stamp");
      const reclaim = await must("second claim", claimWrite());
      assertEquals(reclaim.data?.length, 0, "a claimed request cannot be claimed twice");

      // The fence the handler puts on every later write: the timestamp
      // PostgREST hands back must compare equal when sent straight back
      // (it is rendered +00:00, not Z, and compared as an instant).
      const fenced = await must(
        "fenced no-op",
        admin.from("deletion_requests")
          .update({ claimed_at: claimedAt })
          .eq("id", requestId).eq("status", "executing").eq("claimed_at", claimedAt)
          .select("id"),
      );
      assertEquals(fenced.data?.length, 1, "the claimed_at fence matches the claim it took");
      const stale = await must(
        "stale fence",
        admin.from("deletion_requests")
          .update({ status: "pending" })
          .eq("id", requestId).eq("status", "executing")
          .eq("claimed_at", "2000-01-01T00:00:00.000Z")
          .select("id"),
      );
      assertEquals(stale.data?.length, 0, "a run that lost its claim cannot release the row");

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

      // The release the handler issues after an aborted purge (here the
      // needs-support variant).
      const revert = await must(
        "revert",
        admin.from("deletion_requests")
          .update({
            status: "pending",
            claimed_at: null,
            last_attempt_at: new Date().toISOString(),
            needs_support_reason: "billing_subscription_not_found",
          })
          .eq("id", requestId).eq("status", "executing").eq("claimed_at", claimedAt)
          .select("id"),
      );
      assertEquals(revert.data?.length, 1, "the fenced revert releases the claim it took");
      const reverted = await must(
        "read",
        admin.from("deletion_requests")
          .select("status, claimed_at, needs_support_reason")
          .eq("id", requestId).single(),
      );
      assertEquals(reverted.data, {
        status: "pending",
        claimed_at: null,
        needs_support_reason: "billing_subscription_not_found",
      });

      // A request waiting on support stays cancellable by the user.
      const cancelAfter = await userClient.from("deletion_requests")
        .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
        .eq("id", requestId).select("id");
      assertEquals(cancelAfter.error, null);
      assertEquals(cancelAfter.data?.length, 1, "cancel accepted once released");
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

/** The handler wired to the local stack (service role, fake Paddle). */
function integrationHandler(paddle: PurgeUserDependencies) {
  return createDeleteAccountHandler({
    createAuthClient: () => ({ auth: { getUser: () => Promise.resolve({ data: { user: null } }) } }),
    createAdminClient: () => integrationAdmin(),
    purge: (admin, userId) => purgeUser(admin, userId, paddle),
    env: (key) => (key === "CRON_SECRET" ? CRON_SECRET : undefined),
  });
}

Deno.test({
  name: "integration: process_due reclaims a stuck claim and purges the account; a request not yet due is untouched",
  ignore: localIntegrationEnvironment === null,
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const admin = integrationAdmin();
    const user = await createAuthUser(admin, "due");
    const nullClaim = await createAuthUser(admin, "null-claim");
    const waiting = await createAuthUser(admin, "waiting");
    try {
      await seedPurgeFixture(admin, user, SUBSCRIPTION_ID);
      await seedPurgeFixture(admin, nullClaim, null);
      await seedPurgeFixture(admin, waiting, null);
      // A due request cannot be seeded (grace trigger), but a claim left
      // behind by a crashed run can: the reclaim path runs the full purge.
      await must(
        "stuck claim",
        admin.from("deletion_requests")
          .update({
            status: "executing",
            claimed_at: new Date(Date.now() - (STUCK_CLAIM_MINUTES + 5) * 60_000).toISOString(),
          })
          .eq("user_id", user.id),
      );
      // An `executing` row with no claim stamp at all (a support fix or a
      // partial write): real PostgREST must parse the `.or()` that catches
      // it, or the row is invisible to both the reclaim and the due query.
      await must(
        "claimless executing row",
        admin.from("deletion_requests")
          .update({ status: "executing", claimed_at: null })
          .eq("user_id", nullClaim.id),
      );

      const paddle = fakePaddle({ status: "active" });
      const { result: res, lines } = await captured(() =>
        integrationHandler(paddle.deps)(cronPost())
      );

      assertEquals(res.status, 200);
      const report = await res.json();
      assertEquals(report.reclaimed, 2);
      assertEquals(report.purged, 2);
      assert(lines.includes(`[DELETION_ALERT] reclaimed_stuck_claim user=${user.id}`));
      assert(lines.includes(`[DELETION_ALERT] reclaimed_stuck_claim user=${nullClaim.id}`));
      assertEquals(paddle.calls.map((c) => c.method), ["GET", "POST"]);
      for (const purged of [user, nullClaim]) {
        const gone = await admin.auth.admin.getUserById(purged.id);
        assert(gone.error || !gone.data.user, `auth user ${purged.id} deleted`);
        assertEquals(await avatarNames(admin, purged.id), []);
      }
      assertEquals(await rowsReferencing(admin, user.id, { subscriptionId: SUBSCRIPTION_ID }), []);

      // Not yet due: untouched.
      const other = await must(
        "waiting request",
        admin.from("deletion_requests").select("status, claimed_at").eq("user_id", waiting.id).single(),
      );
      assertEquals(other.data, { status: "pending", claimed_at: null });
      assertEquals(await avatarNames(admin, waiting.id), ["avatar.png"]);
    } finally {
      await cleanupUsers(admin, [user.id, nullClaim.id, waiting.id]);
    }
  },
});

Deno.test({
  name: "integration: the residue sweep removes FK-less rows and avatar folders of deleted users only",
  ignore: localIntegrationEnvironment === null,
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const admin = integrationAdmin();
    const gone = await createAuthUser(admin, "residue-gone");
    const alive = await createAuthUser(admin, "residue-alive");
    const tag = crypto.randomUUID().slice(0, 8);
    try {
      await seedPurgeFixture(admin, gone, null);
      await seedPurgeFixture(admin, alive, null);
      // App-wide limiter rows have a NULL user_id and must survive.
      const appWideKey = `sweep-test-${tag}`;
      await must(
        "app-wide limiter",
        admin.from("rate_limit_tracking").insert({ provider: appWideKey, key: appWideKey, user_id: null }),
      );
      // Delete the auth user directly, leaving the FK-less residue and the
      // avatar a failed post-delete sweep would leave.
      await must("delete user", admin.auth.admin.deleteUser(gone.id));
      const residue = await rowsReferencing(admin, gone.id);
      // (rate_limit_tracking.user_id cascades in the migrations; prod may
      // lack the FK, which is what the sweep covers there.)
      assert(residue.some((r) => r.startsWith("sync_tombstones.")), residue.join());
      assertEquals(await avatarNames(admin, gone.id), ["avatar.png"]);

      const res = await silenced(() => integrationHandler(fakePaddle({}).deps)(cronPost()));
      assertEquals(res.status, 200);
      const report = await res.json();
      assertEquals(report.residue.failed, false);
      assertEquals(report.residue.skipped, [], JSON.stringify(report.residue));
      assert(report.residue.deleted.sync_tombstones >= 1, JSON.stringify(report.residue));
      assert(report.residue.avatar_folders_removed >= 1, JSON.stringify(report.residue));

      // Everything keyed by a user_id column is gone. A webhook row whose only
      // link is the client-supplied checkout custom data is deliberately kept
      // (R-5): an event naming a user that no longer — or never — existed is
      // what support and fraud review need, and the sweep is unbounded, unlike
      // purgeUser's payload match which is scoped to one named user.
      const leftBehind = await rowsReferencing(admin, gone.id);
      assertEquals(
        leftBehind.filter((row) => !row.startsWith("paddle_webhook_events.payload")),
        [],
        leftBehind.join(", "),
      );
      const payloadRows = await admin.from("paddle_webhook_events")
        .select("id", { count: "exact", head: true })
        .eq("payload->data->custom_data->>user_id", gone.id);
      if (!payloadRows.error) {
        assertEquals(payloadRows.count, 1, "the payload-only webhook row is kept");
      }
      assertEquals(await avatarNames(admin, gone.id), []);

      // The live user and the app-wide limiter are untouched.
      const aliveRows = await rowsReferencing(admin, alive.id);
      assert(aliveRows.some((r) => r.startsWith("sync_tombstones.")), aliveRows.join());
      assert(aliveRows.some((r) => r.startsWith("rate_limit_tracking.")), aliveRows.join());
      assertEquals(await avatarNames(admin, alive.id), ["avatar.png"]);
      const appWide = await must(
        "app-wide read",
        admin.from("rate_limit_tracking").select("key", { count: "exact", head: true })
          .eq("key", appWideKey).is("user_id", null),
      );
      assertEquals(appWide.count, 1);
      await admin.from("rate_limit_tracking").delete().eq("key", appWideKey);

      // The sweep is service_role only.
      assert(localIntegrationEnvironment);
      const anon = createClient(localIntegrationEnvironment.url, localIntegrationEnvironment.anonKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const denied = await anon.rpc("sweep_deleted_account_residue", {});
      assert(denied.error, "anon cannot run the sweep");
    } finally {
      await cleanupUsers(admin, [gone.id, alive.id]);
    }
  },
});
