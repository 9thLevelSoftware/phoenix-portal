import { assert, assertEquals } from "jsr:@std/assert@1";
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { localIntegrationEnvironment } from "../_shared/localIntegrationEnvironment.ts";
import type { ProviderRevokeDependencies } from "../_shared/providerRevoke.ts";
import { createDisconnectIntegrationHandler } from "./index.ts";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const STRAVA_ACCESS = "strava-access-secret-value";
const FITBIT_REFRESH = "fitbit-refresh-secret-value";

type Call =
  | { kind: "read"; table: string; filters: [string, unknown][] }
  | { kind: "write"; table: string; op: string }
  | { kind: "rpc"; name: string; args: Record<string, unknown> }
  | { kind: "revoke"; url: string; body: string; authorization: string | null };

interface FakeError {
  code?: string;
  message: string;
}

interface State {
  calls: Call[];
  tokens: Record<string, { access_token: string | null; refresh_token: string | null }>;
  tokenReadError: FakeError | null;
  disconnectError: FakeError | null;
  revokeStatus: number;
  revokeThrows: boolean;
}

function fakeState(overrides: Partial<State> = {}): State {
  return {
    calls: [],
    tokens: {},
    tokenReadError: null,
    disconnectError: null,
    revokeStatus: 200,
    revokeThrows: false,
    ...overrides,
  };
}

function fakeAdmin(state: State): SupabaseClient {
  const client = {
    from(table: string) {
      const filters: [string, unknown][] = [];
      const query = {
        select: () => query,
        eq(column: string, value: unknown) {
          filters.push([column, value]);
          return query;
        },
        maybeSingle() {
          state.calls.push({ kind: "read", table, filters });
          if (state.tokenReadError) return Promise.resolve({ data: null, error: state.tokenReadError });
          const provider = filters.find(([c]) => c === "provider")?.[1] as string;
          return Promise.resolve({ data: state.tokens[provider] ?? null, error: null });
        },
      };
      const write = (op: string) => () => {
        state.calls.push({ kind: "write", table, op });
        return query;
      };
      return { ...query, delete: write("delete"), update: write("update"), upsert: write("upsert") };
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

function revokeDeps(state: State): ProviderRevokeDependencies {
  const fetchImpl = (input: string | URL | Request, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    state.calls.push({
      kind: "revoke",
      url: String(input),
      body: String(init?.body ?? ""),
      authorization: headers.get("Authorization"),
    });
    if (state.revokeThrows) return Promise.reject(new Error("network down"));
    // Strava's real deauthorize response echoes the access token.
    return Promise.resolve(
      new Response(JSON.stringify({ access_token: STRAVA_ACCESS }), { status: state.revokeStatus }),
    );
  };
  return {
    fetch: fetchImpl as typeof fetch,
    fitbitClientId: "fitbit-client",
    fitbitClientSecret: "fitbit-secret",
  };
}

function handlerFor(state: State, userId: string | null = USER_ID) {
  return createDisconnectIntegrationHandler({
    createAuthClient: () => ({
      auth: { getUser: () => Promise.resolve({ data: { user: userId ? { id: userId } : null } }) },
    }),
    createAdminClient: () => fakeAdmin(state),
    revoke: revokeDeps(state),
  });
}

function post(body: unknown): Request {
  return new Request("http://localhost/functions/v1/disconnect-integration", {
    method: "POST",
    headers: { Authorization: "Bearer user-jwt", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** Runs `run` with console output captured instead of printed. */
async function captured<T>(run: () => Promise<T>): Promise<{ result: T; logs: string }> {
  const original = { log: console.log, warn: console.warn, error: console.error };
  const lines: string[] = [];
  const capture = (...args: unknown[]) => {
    lines.push(args.map((a) => typeof a === "string" ? a : JSON.stringify(a)).join(" "));
  };
  console.log = capture;
  console.warn = capture;
  console.error = capture;
  try {
    return { result: await run(), logs: lines.join("\n") };
  } finally {
    Object.assign(console, original);
  }
}

const indexOf = (state: State, predicate: (call: Call) => boolean) => state.calls.findIndex(predicate);
const isRevoke = (call: Call) => call.kind === "revoke";
const isDisconnectRpc = (call: Call) => call.kind === "rpc" && call.name === "disconnect_integration";

Deno.test("disconnect-integration: strava is read, revoked, then disconnected through the RPC", async () => {
  const state = fakeState({ tokens: { strava: { access_token: STRAVA_ACCESS, refresh_token: "r" } } });
  const { result: res, logs } = await captured(() => handlerFor(state)(post({ provider: "strava" })));
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { success: true });

  const readAt = indexOf(state, (c) => c.kind === "read" && c.table === "oauth_tokens");
  const revokeAt = indexOf(state, isRevoke);
  const rpcAt = indexOf(state, isDisconnectRpc);
  assert(readAt >= 0 && readAt < revokeAt && revokeAt < rpcAt, JSON.stringify(state.calls));

  const revoke = state.calls[revokeAt] as Extract<Call, { kind: "revoke" }>;
  assertEquals(revoke.url, "https://www.strava.com/oauth/deauthorize");
  assertEquals(new URLSearchParams(revoke.body).get("access_token"), STRAVA_ACCESS);

  const rpc = state.calls[rpcAt] as Extract<Call, { kind: "rpc" }>;
  assertEquals(rpc.args.p_user_id, USER_ID);
  assertEquals(rpc.args.p_provider, "strava");
  assertEquals(state.calls.filter((c) => c.kind === "write").length, 0, "no direct table writes");
  assert(!logs.includes(STRAVA_ACCESS), "token never logged");
});

Deno.test("disconnect-integration: fitbit revokes the refresh token with client Basic auth", async () => {
  const state = fakeState({ tokens: { fitbit: { access_token: "fb-access", refresh_token: FITBIT_REFRESH } } });
  const { result: res } = await captured(() => handlerFor(state)(post({ provider: "fitbit" })));
  assertEquals(res.status, 200);
  const revoke = state.calls.find(isRevoke) as Extract<Call, { kind: "revoke" }>;
  assertEquals(revoke.url, "https://api.fitbit.com/oauth2/revoke");
  assertEquals(new URLSearchParams(revoke.body).get("token"), FITBIT_REFRESH);
  assertEquals(revoke.authorization, `Basic ${btoa("fitbit-client:fitbit-secret")}`);
  assert(indexOf(state, isRevoke) < indexOf(state, isDisconnectRpc));
});

Deno.test("disconnect-integration: an RPC error returns 500, never success", async () => {
  const state = fakeState({
    tokens: { strava: { access_token: STRAVA_ACCESS, refresh_token: null } },
    disconnectError: { code: "XX000", message: "db down" },
  });
  const { result: res, logs } = await captured(() => handlerFor(state)(post({ provider: "strava" })));
  assertEquals(res.status, 500);
  const body = await res.json();
  assertEquals(body.success, undefined);
  assert(typeof body.error === "string");
  assert(!logs.includes(STRAVA_ACCESS));
});

Deno.test("disconnect-integration: a failed or unreachable provider revoke still deletes the local token, without logging it", async () => {
  for (const failure of [{ revokeStatus: 401 }, { revokeThrows: true }]) {
    const state = fakeState({
      tokens: { strava: { access_token: STRAVA_ACCESS, refresh_token: null } },
      ...failure,
    });
    const { result: res, logs } = await captured(() => handlerFor(state)(post({ provider: "strava" })));
    assertEquals(res.status, 200, JSON.stringify(failure));
    assert(indexOf(state, isRevoke) < indexOf(state, isDisconnectRpc));
    assert(logs.includes("provider revoke failed"), logs);
    assert(!logs.includes(STRAVA_ACCESS), "token never logged");
  }
});

Deno.test("disconnect-integration: an undecryptable token skips the revoke and still disconnects", async () => {
  const state = fakeState({
    tokens: { strava: { access_token: "enc:v1:not-valid-ciphertext", refresh_token: null } },
  });
  const { result: res, logs } = await captured(() => handlerFor(state)(post({ provider: "strava" })));
  assertEquals(res.status, 200);
  assertEquals(indexOf(state, isRevoke), -1);
  assert(indexOf(state, isDisconnectRpc) >= 0);
  assert(!logs.includes("not-valid-ciphertext"));
});

Deno.test("disconnect-integration: a token read error returns 500 and disconnects nothing", async () => {
  const state = fakeState({ tokenReadError: { code: "XX000", message: "read failed" } });
  const { result: res } = await captured(() => handlerFor(state)(post({ provider: "strava" })));
  assertEquals(res.status, 500);
  assertEquals(indexOf(state, isRevoke), -1);
  assertEquals(indexOf(state, isDisconnectRpc), -1);
});

Deno.test("disconnect-integration: providers without a server-side grant skip the revoke and still call the RPC", async () => {
  for (const provider of ["garmin", "hevy", "liftosaur", "apple_health"]) {
    const state = fakeState({ tokens: { [provider]: { access_token: "x", refresh_token: "y" } } });
    const { result: res } = await captured(() => handlerFor(state)(post({ provider })));
    assertEquals(res.status, 200, provider);
    assertEquals(indexOf(state, isRevoke), -1, provider);
    assert(indexOf(state, isDisconnectRpc) >= 0, provider);
  }
});

Deno.test("disconnect-integration: no stored token still disconnects", async () => {
  const state = fakeState();
  const { result: res } = await captured(() => handlerFor(state)(post({ provider: "strava" })));
  assertEquals(res.status, 200);
  assertEquals(indexOf(state, isRevoke), -1);
  assert(indexOf(state, isDisconnectRpc) >= 0);
});

Deno.test("disconnect-integration: unauthenticated or unsupported requests do nothing", async () => {
  const anon = fakeState();
  const { result: unauth } = await captured(() => handlerFor(anon, null)(post({ provider: "strava" })));
  assertEquals(unauth.status, 401);
  assertEquals(anon.calls.length, 0);

  const bad = fakeState();
  const { result: unsupported } = await captured(() => handlerFor(bad)(post({ provider: "myspace" })));
  assertEquals(unsupported.status, 400);
  assertEquals(indexOf(bad, isDisconnectRpc), -1);
});

// ---------------------------------------------------------------------------
// Real SQL (local stack only)
// ---------------------------------------------------------------------------

Deno.test({
  name: "integration: disconnect revokes the stored Strava grant, then disconnect_integration deletes the token and resets the integration",
  ignore: localIntegrationEnvironment === null,
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    assert(localIntegrationEnvironment);
    const admin = createClient(
      localIntegrationEnvironment.url,
      localIntegrationEnvironment.serviceRoleKey,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const created = await admin.auth.admin.createUser({
      email: `disconnect-${crypto.randomUUID()}@example.invalid`,
      password: `pw-${crypto.randomUUID()}`,
      email_confirm: true,
    });
    if (created.error || !created.data.user) throw new Error("auth fixture failed");
    const userId = created.data.user.id;
    try {
      const token = await admin.from("oauth_tokens").insert({
        user_id: userId,
        provider: "strava",
        access_token: STRAVA_ACCESS,
        refresh_token: "strava-refresh",
      });
      if (token.error) throw new Error(`token seed failed: ${JSON.stringify(token.error)}`);
      const integration = await admin.from("user_integrations").insert({
        user_id: userId,
        provider: "strava",
        provider_user_id: "athlete-1",
        status: "connected",
      });
      if (integration.error) {
        throw new Error(`integration seed failed: ${JSON.stringify(integration.error)}`);
      }

      const state = fakeState();
      const handler = createDisconnectIntegrationHandler({
        createAuthClient: () => ({
          auth: { getUser: () => Promise.resolve({ data: { user: { id: userId } } }) },
        }),
        createAdminClient: () => admin,
        revoke: revokeDeps(state),
      });
      const { result: res, logs } = await captured(() => handler(post({ provider: "strava" })));
      assertEquals(res.status, 200, logs);
      assertEquals(await res.json(), { success: true });

      const revoke = state.calls.find(isRevoke) as Extract<Call, { kind: "revoke" }> | undefined;
      assert(revoke, "revoke called");
      assertEquals(new URLSearchParams(revoke.body).get("access_token"), STRAVA_ACCESS);

      const tokens = await admin.from("oauth_tokens").select("provider").eq("user_id", userId);
      assertEquals(tokens.error, null);
      assertEquals(tokens.data, []);
      const row = await admin
        .from("user_integrations")
        .select("status, connected_at, provider_user_id")
        .eq("user_id", userId)
        .eq("provider", "strava")
        .single();
      assertEquals(row.error, null);
      assertEquals(row.data, { status: "disconnected", connected_at: null, provider_user_id: null });
    } finally {
      await admin.from("rate_limit_tracking").delete().eq("user_id", userId);
      await admin.auth.admin.deleteUser(userId);
    }
  },
});
