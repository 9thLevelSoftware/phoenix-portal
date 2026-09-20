import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import {
  createInitiateOAuthHandler,
  UNAVAILABLE_OAUTH_PROVIDERS,
} from "./index.ts";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const VALID_JWT = "test-jwt";
const CALLER_ID = "00000000-0000-4000-8000-000000000001";
const STATE_TOKEN = "11111111-2222-4333-8444-555555555555";
const NOW_MS = Date.parse("2026-09-20T12:00:00.000Z");
const SUPABASE_URL = "https://project.supabase.co";

const ENV: Record<string, string> = {
  STRAVA_CLIENT_ID: "strava-client-id",
  SUPABASE_URL,
};

function requestFor(
  body: unknown,
  authorization: string | null = `Bearer ${VALID_JWT}`,
): Request {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (authorization !== null) headers.set("Authorization", authorization);
  return new Request("http://localhost/functions/v1/initiate-oauth", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------------
// Admin-client double
// ---------------------------------------------------------------------------

interface HarnessOptions {
  user?: { id: string } | null;
  tier?: string;
  env?: Record<string, string>;
  insertError?: { code: string; message: string };
  /** Successive `check_rate_limit` verdicts; the last one repeats. */
  rateLimitAllows?: boolean[];
  /** Return a shape `normalizeRateLimitRpcResult` rejects. */
  rateLimitMalformed?: boolean;
}

interface Harness {
  handler: (request: Request) => Promise<Response>;
  inserts: Array<{ table: string; values: Record<string, unknown> }>;
  rpcCalls: Array<{ name: string; args: Record<string, unknown> }>;
  /** Every table touched, in order, so ordering can be asserted. */
  reads: string[];
}

function makeHarness(options: HarnessOptions = {}): Harness {
  const inserts: Array<{ table: string; values: Record<string, unknown> }> = [];
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const reads: string[] = [];
  const verdicts = [...(options.rateLimitAllows ?? [true])];

  const from = (table: string) => {
    const builder: Record<string, unknown> = {
      select() {
        return builder;
      },
      delete() {
        return builder;
      },
      insert(values: Record<string, unknown>) {
        inserts.push({ table, values });
        return Promise.resolve({
          data: null,
          error: options.insertError ?? null,
        });
      },
      eq() {
        return builder;
      },
      lt() {
        return builder;
      },
      maybeSingle: () => Promise.resolve(readResult()),
      single: () => Promise.resolve(readResult()),
      then(
        onFulfilled?: (value: unknown) => unknown,
        onRejected?: (reason: unknown) => unknown,
      ) {
        return Promise.resolve(readResult()).then(onFulfilled, onRejected);
      },
    };

    function readResult() {
      reads.push(table);
      if (table === "subscriptions") {
        return {
          data: {
            tier: options.tier ?? "FLAME",
            status: "active",
            current_period_end: "2099-01-01T00:00:00.000Z",
          },
          error: null,
        };
      }
      return { data: null, error: null };
    }

    return builder;
  };

  const handler = createInitiateOAuthHandler({
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
          if (name !== "check_rate_limit") {
            return Promise.resolve({ data: null, error: null });
          }
          if (options.rateLimitMalformed) {
            return Promise.resolve({ data: { unexpected: true }, error: null });
          }
          const allowed = verdicts.length > 1
            ? verdicts.shift() as boolean
            : verdicts[0] ?? true;
          return Promise.resolve({
            data: {
              allowed,
              remaining: allowed ? 9 : 0,
              retry_after_seconds: allowed ? null : 1800,
            },
            error: null,
          });
        },
      } as never;
    },
    env: (name: string) => (options.env ?? ENV)[name],
    newStateToken: () => STATE_TOKEN,
    now: () => NOW_MS,
  });

  return { handler, inserts, rpcCalls, reads };
}

async function json(response: Response): Promise<Record<string, unknown>> {
  return await response.json() as Record<string, unknown>;
}

function stateInserts(harness: Harness) {
  return harness.inserts.filter((row) => row.table === "oauth_states");
}

// ---------------------------------------------------------------------------
// Happy path + forced consent
// ---------------------------------------------------------------------------

Deno.test("initiate-oauth mints a strava state and returns the authorize URL", async () => {
  const harness = makeHarness();

  const response = await harness.handler(requestFor({ provider: "strava" }));

  assertEquals(response.status, 200);
  const url = new URL((await json(response)).url as string);
  assertEquals(url.origin, "https://www.strava.com");
  assertEquals(url.pathname, "/oauth/authorize");
  assertEquals(url.searchParams.get("client_id"), "strava-client-id");
  assertEquals(url.searchParams.get("response_type"), "code");
  assertEquals(url.searchParams.get("scope"), "activity:read_all");
  assertEquals(url.searchParams.get("state"), STATE_TOKEN);
  assertEquals(
    url.searchParams.get("redirect_uri"),
    `${SUPABASE_URL}/functions/v1/strava-oauth`,
  );

  assertEquals(stateInserts(harness).length, 1);
  assertEquals(stateInserts(harness)[0].values.user_id, CALLER_ID);
  assertEquals(stateInserts(harness)[0].values.provider, "strava");
});

Deno.test("initiate-oauth forces the consent screen", async () => {
  const harness = makeHarness();

  const response = await harness.handler(requestFor({ provider: "strava" }));

  const url = new URL((await json(response)).url as string);
  // `auto` lets Strava silently re-issue a previous grant, so a reconnect after
  // a revoke or a scope change never shows the user what they are approving.
  assertEquals(url.searchParams.get("approval_prompt"), "force");
});

Deno.test("initiate-oauth prefers SUPABASE_PUBLIC_URL for the redirect_uri", async () => {
  const harness = makeHarness({
    env: { ...ENV, SUPABASE_PUBLIC_URL: "https://api.phoenix.example" },
  });

  const response = await harness.handler(requestFor({ provider: "strava" }));

  const url = new URL((await json(response)).url as string);
  assertEquals(
    url.searchParams.get("redirect_uri"),
    "https://api.phoenix.example/functions/v1/strava-oauth",
  );
});

// ---------------------------------------------------------------------------
// Unlaunched providers (F-046): refuse before any state exists
// ---------------------------------------------------------------------------

for (const provider of UNAVAILABLE_OAUTH_PROVIDERS) {
  Deno.test(`initiate-oauth refuses ${provider} while it is coming soon`, async () => {
    const harness = makeHarness();

    const response = await harness.handler(requestFor({ provider }));

    assertEquals(response.status, 400);
    assertEquals((await json(response)).error, "provider_unavailable");
    // No state row, so the provider's own verify_jwt=false callback has
    // nothing it can ever validate.
    assertEquals(harness.inserts, []);
    // Refused before the database is touched at all.
    assertEquals(harness.rpcCalls, []);
  });
}

Deno.test("initiate-oauth still refuses an entirely unknown provider", async () => {
  const harness = makeHarness();

  const response = await harness.handler(requestFor({ provider: "hevy" }));

  assertEquals(response.status, 400);
  assertEquals((await json(response)).error, "Invalid provider");
  assertEquals(harness.inserts, []);
});

// ---------------------------------------------------------------------------
// Rate limit
// ---------------------------------------------------------------------------

Deno.test("initiate-oauth rate-limits state minting per user", async () => {
  const harness = makeHarness({ rateLimitAllows: [true, false] });

  const first = await harness.handler(requestFor({ provider: "strava" }));
  assertEquals(first.status, 200);

  const second = await harness.handler(requestFor({ provider: "strava" }));
  assertEquals(second.status, 429);
  assertEquals((await json(second)).error, "rate_limit_exceeded");

  // Only the allowed request minted a state.
  assertEquals(stateInserts(harness).length, 1);
});

Deno.test("initiate-oauth caps state minting at 10 per hour per user", async () => {
  const harness = makeHarness();

  await harness.handler(requestFor({ provider: "strava" }));

  const call = harness.rpcCalls.find((c) => c.name === "check_rate_limit");
  assertEquals(call?.args.p_key, "initiate-oauth");
  assertEquals(call?.args.p_user_id, CALLER_ID);
  assertEquals(call?.args.p_max_requests, 10);
  assertEquals(call?.args.p_window_seconds, 3600);
});

Deno.test("initiate-oauth rate-limits before the subscription gate runs", async () => {
  // A limited request must not be able to hammer the subscriptions table either.
  const harness = makeHarness({ rateLimitAllows: [false] });

  const response = await harness.handler(requestFor({ provider: "strava" }));

  assertEquals(response.status, 429);
  assertEquals(harness.inserts, []);
  assertEquals(harness.reads.includes("subscriptions"), false);
  assertEquals(harness.reads.includes("oauth_states"), false);
});

Deno.test("initiate-oauth mints nothing when the rate limiter itself fails", async () => {
  // Fail closed: an unreadable limiter verdict must not become an open door to
  // state minting.
  const harness = makeHarness({ rateLimitMalformed: true });

  const response = await harness.handler(requestFor({ provider: "strava" }));

  assertEquals(response.status, 503);
  assertEquals((await json(response)).error, "rate_limit_unavailable");
  assertEquals(harness.inserts, []);
  assertEquals(harness.reads.includes("subscriptions"), false);
});

// ---------------------------------------------------------------------------
// Tier gate and auth (unchanged behaviour, re-asserted after the refactor)
// ---------------------------------------------------------------------------

Deno.test("initiate-oauth denies below FLAME and mints nothing", async () => {
  const harness = makeHarness({ tier: "EMBER" });

  const response = await harness.handler(requestFor({ provider: "strava" }));

  assertEquals(response.status, 402);
  assertEquals((await json(response)).error, "subscription_required");
  assertEquals(harness.inserts, []);
});

Deno.test("initiate-oauth requires an Authorization header", async () => {
  const harness = makeHarness();
  const response = await harness.handler(
    requestFor({ provider: "strava" }, null),
  );
  assertEquals(response.status, 401);
  assertEquals(harness.inserts, []);
});

Deno.test("initiate-oauth rejects an unusable JWT", async () => {
  const harness = makeHarness({ user: null });
  const response = await harness.handler(requestFor({ provider: "strava" }));
  assertEquals(response.status, 401);
  assertEquals(harness.inserts, []);
});

Deno.test("initiate-oauth rejects a non-JSON body", async () => {
  const harness = makeHarness();
  const response = await harness.handler(
    new Request("http://localhost/functions/v1/initiate-oauth", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${VALID_JWT}`,
        "Content-Type": "application/json",
      },
      body: "{oops",
    }),
  );
  assertEquals(response.status, 400);
  assertEquals(harness.inserts, []);
});

Deno.test("initiate-oauth answers the CORS preflight", async () => {
  const harness = makeHarness();
  const response = await harness.handler(
    new Request("http://localhost/functions/v1/initiate-oauth", {
      method: "OPTIONS",
    }),
  );
  assertEquals(response.status, 200);
});

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

Deno.test("initiate-oauth refuses to mint state when STRAVA_CLIENT_ID is unset", async () => {
  const harness = makeHarness({ env: { SUPABASE_URL } });

  const response = await harness.handler(requestFor({ provider: "strava" }));

  assertEquals(response.status, 503);
  // The state insert must not happen before the config check, or the user gets
  // a live state row and a doomed authorize URL.
  assertEquals(harness.inserts, []);
});

Deno.test("initiate-oauth reports a failed state insert instead of a doomed URL", async () => {
  const harness = makeHarness({
    insertError: { code: "23505", message: "duplicate key" },
  });

  const response = await harness.handler(requestFor({ provider: "strava" }));

  assertEquals(response.status, 500);
  assertEquals((await json(response)).error, "Failed to start OAuth flow");
});

// ---------------------------------------------------------------------------
// PR 63 — the minted state is in the authorize URL by design, and nowhere else
// ---------------------------------------------------------------------------

Deno.test("initiate-oauth never echoes the state in a refusal body", async () => {
  const cases: Array<Promise<Response>> = [
    makeHarness({ tier: "FREE" }).handler(requestFor({ provider: "strava" })),
    makeHarness().handler(requestFor({ provider: "fitbit" })),
    makeHarness({ rateLimitAllows: [false] }).handler(
      requestFor({ provider: "strava" }),
    ),
    makeHarness({ env: { SUPABASE_URL } }).handler(
      requestFor({ provider: "strava" }),
    ),
  ];

  for (const pending of cases) {
    const body = await (await pending).text();
    assertEquals(body.includes(STATE_TOKEN), false, body);
    assertStringIncludes(body, '"error"');
  }
});
