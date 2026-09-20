import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { localIntegrationEnvironment } from "../_shared/localIntegrationEnvironment.ts";
import type { ProviderRevokeDependencies } from "../_shared/providerRevoke.ts";
import { assertNoSecretsLogged, captureLogs } from "../_shared/testLogCapture.ts";
import { createDisconnectIntegrationHandler } from "./index.ts";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const STRAVA_ACCESS = "strava-access-secret-value";
const STRAVA_REFRESH = "strava-refresh-secret-value";
const STRAVA_NEW_ACCESS = "strava-new-access-secret-value";
const STRAVA_NEW_REFRESH = "strava-new-refresh-secret-value";
const FITBIT_ACCESS = "fitbit-access-secret-value";
const FITBIT_REFRESH = "fitbit-refresh-secret-value";
const GARMIN_TOKEN = "garmin-token-secret-value";
const GARMIN_TOKEN_SECRET = "garmin-token-secret-secret-value";
const SECRETS = [
  STRAVA_ACCESS,
  STRAVA_REFRESH,
  STRAVA_NEW_ACCESS,
  STRAVA_NEW_REFRESH,
  FITBIT_ACCESS,
  FITBIT_REFRESH,
  GARMIN_TOKEN,
  GARMIN_TOKEN_SECRET,
  "strava-client-secret",
  "fitbit-secret",
  "garmin-consumer-secret",
];
const FUTURE = "2999-01-01T00:00:00.000Z";
const PAST = "2020-01-01T00:00:00.000Z";

const STRAVA_TOKEN_URL = "https://www.strava.com/oauth/token";
const STRAVA_DEAUTHORIZE_URL = "https://www.strava.com/oauth/deauthorize";
const FITBIT_REVOKE_URL = "https://api.fitbit.com/oauth2/revoke";
const GARMIN_DEREGISTRATION_URL = "https://apis.garmin.com/wellness-api/rest/user/registration";

type Call =
  | { kind: "read"; table: string; filters: [string, unknown][] }
  | { kind: "write"; table: string; op: string; values?: Record<string, unknown> }
  | { kind: "rpc"; name: string; args: Record<string, unknown> }
  | {
    kind: "http";
    url: string;
    method: string;
    body: string;
    authorization: string | null;
  };

interface FakeError {
  code?: string;
  message: string;
}

interface StoredToken {
  access_token: string | null;
  refresh_token: string | null;
  token_expires_at: string | null;
}

interface State {
  calls: Call[];
  tokens: Record<string, StoredToken>;
  tokenReadError: FakeError | null;
  tokenPersistError: FakeError | null;
  disconnectError: FakeError | null;
  /** Status of every provider revoke/deregister endpoint. */
  revokeStatus: number;
  revokeThrows: boolean;
  /** Status of the Strava token refresh endpoint. */
  refreshStatus: number;
}

function fakeState(overrides: Partial<State> = {}): State {
  return {
    calls: [],
    tokens: {},
    tokenReadError: null,
    tokenPersistError: null,
    disconnectError: null,
    revokeStatus: 200,
    revokeThrows: false,
    refreshStatus: 200,
    ...overrides,
  };
}

function fakeAdmin(state: State): SupabaseClient {
  const client = {
    from(table: string) {
      const filters: [string, unknown][] = [];
      let values: Record<string, unknown> | null = null;
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
        then<T>(resolve: (value: { data: null; error: FakeError | null }) => T) {
          state.calls.push({ kind: "write", table, op: "update", values: values ?? {} });
          const error = state.tokenPersistError;
          const provider = filters.find(([c]) => c === "provider")?.[1] as string;
          if (!error && values && state.tokens[provider]) {
            Object.assign(state.tokens[provider], values);
          }
          return Promise.resolve({ data: null, error }).then(resolve);
        },
      };
      return {
        select: () => query,
        update(v: Record<string, unknown>) {
          values = v;
          return query;
        },
        delete() {
          state.calls.push({ kind: "write", table, op: "delete" });
          return query;
        },
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

function revokeDeps(
  state: State,
  overrides: Partial<ProviderRevokeDependencies> = {},
): ProviderRevokeDependencies {
  const fetchImpl = (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    state.calls.push({
      kind: "http",
      url,
      method: init?.method ?? "GET",
      body: String(init?.body ?? ""),
      authorization: new Headers(init?.headers).get("Authorization"),
    });
    if (url === STRAVA_TOKEN_URL) {
      if (state.refreshStatus !== 200) {
        // Error bodies can echo request fields; the code must not log them.
        return Promise.resolve(
          new Response(JSON.stringify({ message: "Bad Request", refresh_token: STRAVA_REFRESH }), {
            status: state.refreshStatus,
          }),
        );
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({
            access_token: STRAVA_NEW_ACCESS,
            refresh_token: STRAVA_NEW_REFRESH,
            expires_at: Math.floor(Date.now() / 1000) + 21600,
          }),
          { status: 200 },
        ),
      );
    }
    if (state.revokeThrows) {
      return Promise.reject(new Error(`network down ${String(init?.body ?? "")}`));
    }
    // Strava's real deauthorize response echoes the access token.
    return Promise.resolve(
      new Response(JSON.stringify({ access_token: STRAVA_ACCESS }), { status: state.revokeStatus }),
    );
  };
  return {
    fetch: fetchImpl as typeof fetch,
    fitbitClientId: "fitbit-client",
    fitbitClientSecret: "fitbit-secret",
    stravaClientId: "strava-client",
    stravaClientSecret: "strava-client-secret",
    garminConsumerKey: "garmin-consumer",
    garminConsumerSecret: "garmin-consumer-secret",
    ...overrides,
  };
}

function handlerFor(
  state: State,
  userId: string | null = USER_ID,
  deps: Partial<ProviderRevokeDependencies> = {},
) {
  return createDisconnectIntegrationHandler({
    createAuthClient: () => ({
      auth: { getUser: () => Promise.resolve({ data: { user: userId ? { id: userId } : null } }) },
    }),
    createAdminClient: () => fakeAdmin(state),
    revoke: revokeDeps(state, deps),
  });
}

function post(body: unknown): Request {
  return new Request("http://localhost/functions/v1/disconnect-integration", {
    method: "POST",
    headers: { Authorization: "Bearer user-jwt", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** Deep-inspecting console capture (review R-8). */
const captured = captureLogs;

function assertNoSecrets(logs: string) {
  assertNoSecretsLogged(logs, SECRETS);
}

const indexOf = (state: State, predicate: (call: Call) => boolean) => state.calls.findIndex(predicate);
const isHttp = (url: string) => (call: Call) => call.kind === "http" && call.url === url;
const isRevoke = (call: Call) =>
  call.kind === "http" &&
  [STRAVA_DEAUTHORIZE_URL, FITBIT_REVOKE_URL, GARMIN_DEREGISTRATION_URL].includes(call.url);
const isDisconnectRpc = (call: Call) => call.kind === "rpc" && call.name === "disconnect_integration";
const httpCall = (state: State, predicate: (call: Call) => boolean) =>
  state.calls.find(predicate) as Extract<Call, { kind: "http" }>;

Deno.test("log capture renders URLSearchParams and Error contents, so the leak check sees them", async () => {
  const { logs } = await captured(() => {
    console.error("x", new URLSearchParams({ access_token: STRAVA_ACCESS }));
    console.warn({ err: new Error(`failed for ${FITBIT_REFRESH}`) });
    return Promise.resolve();
  });
  assertStringIncludes(logs, STRAVA_ACCESS);
  assertStringIncludes(logs, FITBIT_REFRESH);
});

Deno.test("disconnect-integration: a valid strava token is read, revoked, then disconnected through the RPC", async () => {
  const state = fakeState({
    tokens: { strava: { access_token: STRAVA_ACCESS, refresh_token: STRAVA_REFRESH, token_expires_at: FUTURE } },
  });
  const { result: res, logs } = await captured(() => handlerFor(state)(post({ provider: "strava" })));
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { success: true });

  const readAt = indexOf(state, (c) => c.kind === "read" && c.table === "oauth_tokens");
  const revokeAt = indexOf(state, isRevoke);
  const rpcAt = indexOf(state, isDisconnectRpc);
  assert(readAt >= 0 && readAt < revokeAt && revokeAt < rpcAt, JSON.stringify(state.calls));
  assertEquals(indexOf(state, isHttp(STRAVA_TOKEN_URL)), -1, "no refresh for a valid token");

  const revoke = state.calls[revokeAt] as Extract<Call, { kind: "http" }>;
  assertEquals(revoke.url, STRAVA_DEAUTHORIZE_URL);
  assertEquals(new URLSearchParams(revoke.body).get("access_token"), STRAVA_ACCESS);

  const rpc = state.calls[rpcAt] as Extract<Call, { kind: "rpc" }>;
  assertEquals(rpc.args.p_user_id, USER_ID);
  assertEquals(rpc.args.p_provider, "strava");
  assertEquals(state.calls.filter((c) => c.kind === "write").length, 0, "no direct table writes");
  assertNoSecrets(logs);
});

Deno.test("disconnect-integration: an expired strava token is refreshed, persisted, then revoked with the new token", async () => {
  for (const expiry of [PAST, null, new Date(Date.now() + 30_000).toISOString()]) {
    const state = fakeState({
      tokens: { strava: { access_token: STRAVA_ACCESS, refresh_token: STRAVA_REFRESH, token_expires_at: expiry } },
    });
    const { result: res, logs } = await captured(() => handlerFor(state)(post({ provider: "strava" })));
    assertEquals(res.status, 200, String(expiry));

    const refreshAt = indexOf(state, isHttp(STRAVA_TOKEN_URL));
    const persistAt = indexOf(state, (c) => c.kind === "write" && c.table === "oauth_tokens" && c.op === "update");
    const revokeAt = indexOf(state, isRevoke);
    const rpcAt = indexOf(state, isDisconnectRpc);
    assert(refreshAt >= 0 && refreshAt < persistAt && persistAt < revokeAt && revokeAt < rpcAt, JSON.stringify(state.calls));

    const refresh = httpCall(state, isHttp(STRAVA_TOKEN_URL));
    const refreshBody = JSON.parse(refresh.body);
    assertEquals(refreshBody.grant_type, "refresh_token");
    assertEquals(refreshBody.refresh_token, STRAVA_REFRESH);
    assertEquals(refreshBody.client_id, "strava-client");

    const revoke = httpCall(state, isRevoke);
    assertEquals(new URLSearchParams(revoke.body).get("access_token"), STRAVA_NEW_ACCESS);

    // The rotated pair is persisted (so an RPC failure leaves a retryable row).
    assertEquals(state.tokens.strava.access_token, STRAVA_NEW_ACCESS);
    assertEquals(state.tokens.strava.refresh_token, STRAVA_NEW_REFRESH);
    assertNoSecrets(logs);
  }
});

Deno.test("disconnect-integration: a failed strava refresh still disconnects, without logging tokens", async () => {
  for (const variant of [
    { refreshStatus: 400 },
    { refreshStatus: 200, noClient: true },
  ]) {
    const state = fakeState({
      tokens: { strava: { access_token: STRAVA_ACCESS, refresh_token: STRAVA_REFRESH, token_expires_at: PAST } },
      refreshStatus: variant.refreshStatus,
    });
    const deps = variant.noClient ? { stravaClientSecret: undefined } : {};
    const { result: res, logs } = await captured(() => handlerFor(state, USER_ID, deps)(post({ provider: "strava" })));
    assertEquals(res.status, 200, JSON.stringify(variant));
    assertEquals(indexOf(state, isRevoke), -1, "no deauthorize with an expired token");
    assert(indexOf(state, isDisconnectRpc) >= 0);
    assertStringIncludes(logs, "strava token refresh failed");
    assertNoSecrets(logs);
  }
});

Deno.test("disconnect-integration: an expired strava token with no refresh token is still tried as stored", async () => {
  const state = fakeState({
    tokens: { strava: { access_token: STRAVA_ACCESS, refresh_token: null, token_expires_at: PAST } },
  });
  const { result: res, logs } = await captured(() => handlerFor(state)(post({ provider: "strava" })));
  assertEquals(res.status, 200);
  assertEquals(indexOf(state, isHttp(STRAVA_TOKEN_URL)), -1);
  assertEquals(new URLSearchParams(httpCall(state, isRevoke).body).get("access_token"), STRAVA_ACCESS);
  assert(indexOf(state, isRevoke) < indexOf(state, isDisconnectRpc));
  assertNoSecrets(logs);
});

Deno.test("disconnect-integration: a failed persist of the refreshed strava pair still revokes and disconnects", async () => {
  const state = fakeState({
    tokens: { strava: { access_token: STRAVA_ACCESS, refresh_token: STRAVA_REFRESH, token_expires_at: PAST } },
    tokenPersistError: { code: "XX000", message: "update failed" },
  });
  const { result: res, logs } = await captured(() => handlerFor(state)(post({ provider: "strava" })));
  assertEquals(res.status, 200);
  assertEquals(new URLSearchParams(httpCall(state, isRevoke).body).get("access_token"), STRAVA_NEW_ACCESS);
  assert(indexOf(state, isDisconnectRpc) > indexOf(state, isRevoke));
  assertStringIncludes(logs, "not persisted");
  assertNoSecrets(logs);
});

Deno.test("disconnect-integration: fitbit revokes the refresh token with client Basic auth", async () => {
  const state = fakeState({
    tokens: { fitbit: { access_token: FITBIT_ACCESS, refresh_token: FITBIT_REFRESH, token_expires_at: null } },
  });
  const { result: res, logs } = await captured(() => handlerFor(state)(post({ provider: "fitbit" })));
  assertEquals(res.status, 200);
  const revoke = httpCall(state, isRevoke);
  assertEquals(revoke.url, FITBIT_REVOKE_URL);
  assertEquals(new URLSearchParams(revoke.body).get("token"), FITBIT_REFRESH);
  assertEquals(revoke.authorization, `Basic ${btoa("fitbit-client:fitbit-secret")}`);
  assert(indexOf(state, isRevoke) < indexOf(state, isDisconnectRpc));
  assertNoSecrets(logs);
});

Deno.test("disconnect-integration: fitbit without client credentials skips the revoke, logs the reason, still disconnects", async () => {
  const state = fakeState({
    tokens: { fitbit: { access_token: FITBIT_ACCESS, refresh_token: FITBIT_REFRESH, token_expires_at: null } },
  });
  const { result: res, logs } = await captured(() =>
    handlerFor(state, USER_ID, { fitbitClientId: undefined, fitbitClientSecret: undefined })(
      post({ provider: "fitbit" }),
    )
  );
  assertEquals(res.status, 200);
  assertEquals(state.calls.filter((c) => c.kind === "http"), []);
  assert(indexOf(state, isDisconnectRpc) >= 0);
  assertStringIncludes(logs, "fitbit_client_not_configured");
  assertNoSecrets(logs);
});

Deno.test("disconnect-integration: garmin deregisters with a signed OAuth 1.0a DELETE before the RPC", async () => {
  const state = fakeState({
    tokens: { garmin: { access_token: GARMIN_TOKEN, refresh_token: GARMIN_TOKEN_SECRET, token_expires_at: null } },
  });
  const { result: res, logs } = await captured(() => handlerFor(state)(post({ provider: "garmin" })));
  assertEquals(res.status, 200);
  const revoke = httpCall(state, isRevoke);
  assertEquals(revoke.url, GARMIN_DEREGISTRATION_URL);
  assertEquals(revoke.method, "DELETE");
  const auth = revoke.authorization ?? "";
  assert(auth.startsWith("OAuth "), auth);
  assertStringIncludes(auth, 'oauth_consumer_key="garmin-consumer"');
  assertStringIncludes(auth, `oauth_token="${GARMIN_TOKEN}"`);
  assertStringIncludes(auth, 'oauth_signature_method="HMAC-SHA1"');
  assertStringIncludes(auth, "oauth_signature=");
  assert(!auth.includes(GARMIN_TOKEN_SECRET), "token secret only signs, never sent");
  assert(!auth.includes("garmin-consumer-secret"), "consumer secret only signs, never sent");
  assert(indexOf(state, isRevoke) < indexOf(state, isDisconnectRpc));
  assertNoSecrets(logs);
});

Deno.test("disconnect-integration: a garmin pending request token or missing consumer credentials skip deregistration", async () => {
  const pending = fakeState({
    tokens: { garmin: { access_token: GARMIN_TOKEN, refresh_token: GARMIN_TOKEN_SECRET, token_expires_at: FUTURE } },
  });
  const { result: pendingRes, logs: pendingLogs } = await captured(() => handlerFor(pending)(post({ provider: "garmin" })));
  assertEquals(pendingRes.status, 200);
  assertEquals(indexOf(pending, isRevoke), -1);
  assert(indexOf(pending, isDisconnectRpc) >= 0);
  assertStringIncludes(pendingLogs, "garmin_pending_request_token");
  assertNoSecrets(pendingLogs);

  const unconfigured = fakeState({
    tokens: { garmin: { access_token: GARMIN_TOKEN, refresh_token: GARMIN_TOKEN_SECRET, token_expires_at: null } },
  });
  const { result: res, logs } = await captured(() =>
    handlerFor(unconfigured, USER_ID, { garminConsumerSecret: undefined })(post({ provider: "garmin" }))
  );
  assertEquals(res.status, 200);
  assertEquals(indexOf(unconfigured, isRevoke), -1);
  assertStringIncludes(logs, "garmin_client_not_configured");
  assertNoSecrets(logs);
});

Deno.test("disconnect-integration: an RPC error returns 500, never success", async () => {
  const state = fakeState({
    tokens: { strava: { access_token: STRAVA_ACCESS, refresh_token: null, token_expires_at: FUTURE } },
    disconnectError: { code: "XX000", message: "db down" },
  });
  const { result: res, logs } = await captured(() => handlerFor(state)(post({ provider: "strava" })));
  assertEquals(res.status, 500);
  const body = await res.json();
  assertEquals(body.success, undefined);
  assert(typeof body.error === "string");
  assertNoSecrets(logs);
});

Deno.test("disconnect-integration: a failed or unreachable provider revoke still deletes the local token, without logging it", async () => {
  for (const provider of ["strava", "fitbit", "garmin"]) {
    for (const failure of [{ revokeStatus: 401 }, { revokeThrows: true }]) {
      const state = fakeState({
        tokens: {
          strava: { access_token: STRAVA_ACCESS, refresh_token: STRAVA_REFRESH, token_expires_at: FUTURE },
          fitbit: { access_token: FITBIT_ACCESS, refresh_token: FITBIT_REFRESH, token_expires_at: null },
          garmin: { access_token: GARMIN_TOKEN, refresh_token: GARMIN_TOKEN_SECRET, token_expires_at: null },
        },
        ...failure,
      });
      const { result: res, logs } = await captured(() => handlerFor(state)(post({ provider })));
      const label = `${provider} ${JSON.stringify(failure)}`;
      assertEquals(res.status, 200, label);
      assert(indexOf(state, isRevoke) >= 0 && indexOf(state, isRevoke) < indexOf(state, isDisconnectRpc), label);
      assertStringIncludes(logs, "provider revoke failed");
      assertNoSecrets(logs);
    }
  }
});

Deno.test("disconnect-integration: an undecryptable token skips the revoke and still disconnects", async () => {
  const state = fakeState({
    tokens: { strava: { access_token: "enc:v1:not-valid-ciphertext", refresh_token: null, token_expires_at: FUTURE } },
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
  for (const provider of ["hevy", "liftosaur", "apple_health", "google_health"]) {
    const state = fakeState({ tokens: { [provider]: { access_token: "x", refresh_token: "y", token_expires_at: null } } });
    const { result: res } = await captured(() => handlerFor(state)(post({ provider })));
    assertEquals(res.status, 200, provider);
    assertEquals(state.calls.filter((c) => c.kind === "http"), [], provider);
    assertEquals(indexOf(state, (c) => c.kind === "read"), -1, `${provider}: no token read`);
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
  name: "integration: disconnect refreshes and revokes an expired Strava grant, then disconnect_integration deletes the token and resets the integration",
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
        refresh_token: STRAVA_REFRESH,
        token_expires_at: PAST,
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
      assertNoSecrets(logs);

      assert(indexOf(state, isHttp(STRAVA_TOKEN_URL)) >= 0, "expired token refreshed");
      const revoke = httpCall(state, isRevoke);
      assert(revoke, "revoke called");
      assertEquals(new URLSearchParams(revoke.body).get("access_token"), STRAVA_NEW_ACCESS);

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
