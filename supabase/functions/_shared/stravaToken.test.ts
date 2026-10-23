import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";
import {
  refreshStravaAccessToken,
  StravaRefreshError,
  type StravaRefreshedTokens,
} from "./stravaToken.ts";

const TOKEN_URL = "https://www.strava.com/oauth/token";
const CLIENT_ID = "client-id";
const CLIENT_SECRET = "client-secret-value-should-not-leak";
const REFRESH_TOKEN = "refresh-token-value-should-not-leak";

function credentials(
  fetchImpl: typeof fetch,
  signal?: AbortSignal,
  overrides: { clientId?: string; clientSecret?: string } = {},
) {
  return {
    fetch: fetchImpl,
    clientId: overrides.clientId === undefined ? CLIENT_ID : overrides.clientId,
    clientSecret: overrides.clientSecret === undefined ? CLIENT_SECRET : overrides.clientSecret,
    signal,
  };
}

Deno.test("StravaRefreshError keeps the prefixed message and defaults details to empty", () => {
  const err = new StravaRefreshError(401, "HTTP 401");
  assertEquals(err.name, "StravaRefreshError");
  assertEquals(err.status, 401);
  assertEquals(err.reason, "HTTP 401");
  assertEquals(err.message, "Token refresh failed: HTTP 401");
  assertEquals(err.details, []);
  assertEquals(err.isRevokedGrant(), false);
  assert(err instanceof Error);
});

Deno.test("refreshStravaAccessToken returns the rotated pair and falls back when refresh_token is omitted", async () => {
  const seen: { url?: string; init?: RequestInit } = {};
  const signal = new AbortController().signal;
  const fetchImpl: typeof fetch = (input, init) => {
    seen.url = String(input);
    seen.init = init;
    const body = JSON.parse(String(init?.body)) as { refresh_token?: string };
    const refreshToken = body.refresh_token === REFRESH_TOKEN ? "rotated-refresh" : undefined;
    const payload: Partial<StravaRefreshedTokens> = {
      access_token: "access-token",
      expires_at: 1_700_000_000,
    };
    if (refreshToken) payload.refresh_token = refreshToken;
    return Promise.resolve(new Response(JSON.stringify(payload), { status: 200 }));
  };

  const refreshed = await refreshStravaAccessToken(REFRESH_TOKEN, credentials(fetchImpl, signal));
  assertEquals(seen.url, TOKEN_URL);
  assertEquals(seen.init?.method, "POST");
  assertEquals(seen.init?.signal, signal);
  assertEquals(JSON.parse(String(seen.init?.body)), {
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    grant_type: "refresh_token",
    refresh_token: REFRESH_TOKEN,
  });
  assertEquals(refreshed, {
    access_token: "access-token",
    refresh_token: "rotated-refresh",
    expires_at: 1_700_000_000,
  });

  const fallbackFetch: typeof fetch = () =>
    Promise.resolve(new Response(JSON.stringify({
      access_token: "access-token",
      expires_at: 10,
    }), { status: 200 }));
  const fallback = await refreshStravaAccessToken(REFRESH_TOKEN, credentials(fallbackFetch));
  assertEquals(fallback.refresh_token, REFRESH_TOKEN);
});

Deno.test("refreshStravaAccessToken reports a missing client without calling Strava", async () => {
  let called = false;
  const fetchImpl: typeof fetch = () => {
    called = true;
    return Promise.resolve(new Response("nope", { status: 500 }));
  };
  const cases: Array<{ clientId: string | undefined; clientSecret: string | undefined }> = [
    { clientId: "", clientSecret: CLIENT_SECRET },
    { clientId: undefined, clientSecret: CLIENT_SECRET },
    { clientId: CLIENT_ID, clientSecret: "" },
    { clientId: CLIENT_ID, clientSecret: undefined },
  ];
  for (const item of cases) {
    const err = await assertRejects(
      () => refreshStravaAccessToken(REFRESH_TOKEN, { fetch: fetchImpl, ...item }),
      StravaRefreshError,
    );
    assertEquals(err.status, null);
    assertEquals(err.reason, "client not configured");
    assertEquals(err.message, "Token refresh failed: client not configured");
    assertEquals(err.details, []);
    assertEquals(err.isRevokedGrant(), false);
  }
  assertEquals(called, false);
});

Deno.test("refreshStravaAccessToken classifies Strava's enumerated error body and keeps the prefixed message", async () => {
  const cases: Array<{
    label: string;
    status: number;
    body: unknown;
    details: StravaRefreshError["details"];
    revoked: boolean;
  }> = [
    {
      label: "refresh token",
      status: 400,
      body: {
        message: "Bad Request",
        errors: [{ resource: "RefreshToken", field: "refresh_token", code: "invalid" }],
      },
      details: [{ resource: "RefreshToken", field: "refresh_token", code: "invalid" }],
      revoked: true,
    },
    {
      label: "field only",
      status: 401,
      body: { errors: [{ resource: "Athlete", field: "refresh_token", code: "invalid" }] },
      details: [{ resource: "Athlete", field: "refresh_token", code: "invalid" }],
      revoked: true,
    },
    {
      label: "application",
      status: 400,
      body: { errors: [{ resource: "Application", field: "client_secret", code: "invalid" }] },
      details: [{ resource: "Application", field: "client_secret", code: "invalid" }],
      revoked: false,
    },
    {
      label: "no errors array",
      status: 400,
      body: { message: REFRESH_TOKEN },
      details: [],
      revoked: false,
    },
    {
      label: "free text is dropped",
      status: 401,
      body: {
        message: CLIENT_SECRET,
        errors: [{
          resource: "not an identifier",
          field: "refresh token",
          code: "leak.token.value",
        }],
      },
      details: [{ resource: null, field: null, code: null }],
      revoked: false,
    },
    {
      label: "token-shaped value is dropped",
      status: 400,
      body: {
        errors: [{
          resource: "RefreshToken",
          field: "refresh_token",
          code: "0123456789abcdef0123456789abcdef01234567",
        }],
      },
      details: [{ resource: "RefreshToken", field: "refresh_token", code: null }],
      revoked: true,
    },
    {
      label: "sixth entry is dropped",
      status: 400,
      body: {
        errors: [
          { resource: "Application", field: "client_id", code: "invalid" },
          { resource: "Application", field: "client_id", code: "invalid" },
          { resource: "Application", field: "client_id", code: "invalid" },
          { resource: "Application", field: "client_id", code: "invalid" },
          { resource: "Application", field: "client_id", code: "invalid" },
          { resource: "RefreshToken", field: "refresh_token", code: "invalid" },
        ],
      },
      details: Array.from({ length: 5 }, () => ({
        resource: "Application",
        field: "client_id",
        code: "invalid",
      })),
      revoked: false,
    },
    {
      label: "rate limit naming the token is still transient",
      status: 429,
      body: { errors: [{ resource: "RefreshToken", field: "refresh_token", code: "invalid" }] },
      details: [{ resource: "RefreshToken", field: "refresh_token", code: "invalid" }],
      revoked: false,
    },
  ];

  for (const item of cases) {
    const fetchImpl: typeof fetch = () =>
      Promise.resolve(new Response(
        typeof item.body === "string" ? item.body : JSON.stringify(item.body),
        { status: item.status },
      ));
    const err = await assertRejects(
      () => refreshStravaAccessToken(REFRESH_TOKEN, credentials(fetchImpl)),
      StravaRefreshError,
    );
    assertEquals(err.status, item.status, item.label);
    assertEquals(err.reason, `HTTP ${item.status}`, item.label);
    assertEquals(err.message, `Token refresh failed: HTTP ${item.status}`, item.label);
    assertEquals(err.details, item.details, item.label);
    assertEquals(err.isRevokedGrant(), item.revoked, item.label);
    const rendered = `${err.message} ${err.reason} ${JSON.stringify(err.details)}`;
    assert(!rendered.includes(REFRESH_TOKEN), item.label);
    assert(!rendered.includes(CLIENT_SECRET), item.label);
    assert(!rendered.includes("leak.token.value"), item.label);
  }
});

Deno.test("refreshStravaAccessToken treats a non-JSON error body as an HTTP failure with no details", async () => {
  const fetchImpl: typeof fetch = () =>
    Promise.resolve(new Response("<html>nope</html>", { status: 503 }));
  const err = await assertRejects(
    () => refreshStravaAccessToken(REFRESH_TOKEN, credentials(fetchImpl)),
    StravaRefreshError,
  );
  assertEquals(err.status, 503);
  assertEquals(err.reason, "HTTP 503");
  assertEquals(err.message, "Token refresh failed: HTTP 503");
  assertEquals(err.details, []);
  assertEquals(err.isRevokedGrant(), false);
  assert(!err.message.includes("nope"));
});

Deno.test("refreshStravaAccessToken rejects a malformed 200 without echoing the body", async () => {
  const bodies = [
    "not-json",
    JSON.stringify(null),
    JSON.stringify({ access_token: "access-token" }),
    JSON.stringify({ access_token: "access-token", expires_at: "1700000000" }),
    JSON.stringify({ expires_at: 10 }),
  ];
  for (const body of bodies) {
    const fetchImpl: typeof fetch = () => Promise.resolve(new Response(body, { status: 200 }));
    const err = await assertRejects(
      () => refreshStravaAccessToken(REFRESH_TOKEN, credentials(fetchImpl)),
      StravaRefreshError,
    );
    assertEquals(err.status, 200, body);
    assertEquals(err.reason, "malformed response");
    assertEquals(err.message, "Token refresh failed: malformed response");
    assertEquals(err.details, []);
    assertEquals(err.isRevokedGrant(), false);
    assert(!err.message.includes("not-json"));
    assert(!err.message.includes(REFRESH_TOKEN));
  }
});

Deno.test("refreshStravaAccessToken forwards an abort and does not wrap a rejected fetch", async () => {
  const signal = AbortSignal.abort();
  let seen: AbortSignal | undefined;
  const fetchImpl: typeof fetch = (_input, init) => {
    seen = init?.signal ?? undefined;
    return Promise.reject(signal.reason);
  };
  const failure = await refreshStravaAccessToken(
    REFRESH_TOKEN,
    credentials(fetchImpl, signal),
  ).then(
    () => null,
    (err: unknown) => err,
  );
  assertEquals(seen, signal);
  assertEquals(failure instanceof StravaRefreshError, false);
  assertEquals(failure, signal.reason);
});
