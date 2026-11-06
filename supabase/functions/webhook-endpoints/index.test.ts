import { assert, assertEquals, assertNotEquals } from "jsr:@std/assert@1";
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { FakeDb, fakeClient, type Row } from "../_shared/testing/fakeSupabase.ts";
import { assertNoSecretsLogged, captureLogs } from "../_shared/testLogCapture.ts";
import { signWebhook } from "../_shared/webhookSigning.ts";
import type { DnsResolver } from "../_shared/webhookTarget.ts";
import {
  createWebhookEndpointsHandler,
  WEBHOOK_OUTBOUND_RATE_LIMIT,
  type WebhookEndpointsDependencies,
} from "./index.ts";

const USER_A = "aaaaaaaa-0000-4000-8000-00000000000a";
const USER_B = "bbbbbbbb-0000-4000-8000-00000000000b";
const NOW = new Date("2026-11-06T12:00:00.000Z");
const SECRET_1 = "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw";
const SECRET_2 = "whsec_C2FVsBQIhrscChlQIMV+b5sSYspob7oD";
const HEADER_VALUE = "Bearer receiver-credential-123";
const ENDPOINT_A = "eeeeeeee-0000-4000-8000-00000000000a";

const encrypt = (plain: string) => Promise.resolve(`enc:test:${btoa(plain)}`);
const decrypt = (stored: string) => Promise.resolve(atob(stored.replace("enc:test:", "")));

function subscription(userId: string, tier: string): Row {
  return {
    user_id: userId,
    tier,
    status: "active",
    current_period_end: "2027-01-01T00:00:00.000Z",
    cancel_at_period_end: false,
  };
}

function endpointRow(overrides: Row = {}): Row {
  return {
    id: ENDPOINT_A,
    user_id: USER_A,
    label: "A main",
    url: "https://hooks.example.com/in",
    scopes: ["workouts"],
    status: "active",
    disabled_reason: null,
    custom_header_name: null,
    signing_key_hint: "LaSw",
    consecutive_failures: 0,
    last_success_at: null,
    last_failure_at: null,
    created_at: NOW.toISOString(),
    updated_at: NOW.toISOString(),
    ...overrides,
  };
}

async function secretRow(overrides: Row = {}): Promise<Row> {
  return {
    endpoint_id: ENDPOINT_A,
    user_id: USER_A,
    signing_secret_enc: await encrypt(SECRET_1),
    previous_signing_secret_enc: null,
    previous_expires_at: null,
    custom_header_value_enc: null,
    ...overrides,
  };
}

/** In-memory versions of the migration's RPCs, with the same ownership rules. */
function registerRpcs(db: FakeDb, ids: string[]) {
  db.rpcHandlers.create_webhook_endpoint = (args) => {
    const owned = db.rows("webhook_endpoints").filter((row) => row.user_id === args.p_user_id);
    if (owned.length >= 3) {
      return { data: null, error: { code: "P0001", message: "webhook_endpoint_limit" } };
    }
    const id = ids.shift() ?? crypto.randomUUID();
    db.rows("webhook_endpoints").push(endpointRow({
      id,
      user_id: args.p_user_id,
      label: args.p_label,
      url: args.p_url,
      scopes: args.p_scopes,
      signing_key_hint: args.p_signing_key_hint,
      custom_header_name: args.p_custom_header_name,
    }));
    db.rows("webhook_endpoint_secrets").push({
      endpoint_id: id,
      user_id: args.p_user_id,
      signing_secret_enc: args.p_signing_secret_enc,
      previous_signing_secret_enc: null,
      previous_expires_at: null,
      custom_header_value_enc: args.p_custom_header_value_enc,
    });
    return { data: id, error: null };
  };
  db.rpcHandlers.rotate_webhook_signing_secret = (args) => {
    const row = db.rows("webhook_endpoint_secrets").find((secret) =>
      secret.endpoint_id === args.p_endpoint_id && secret.user_id === args.p_user_id
    );
    if (!row) return { data: false, error: null };
    row.previous_signing_secret_enc = row.signing_secret_enc;
    row.previous_expires_at = new Date(NOW.getTime() + 86_400_000).toISOString();
    row.signing_secret_enc = args.p_signing_secret_enc;
    const endpoint = db.rows("webhook_endpoints").find((entry) => entry.id === args.p_endpoint_id);
    if (endpoint) endpoint.signing_key_hint = args.p_signing_key_hint;
    return { data: true, error: null };
  };
  db.rpcHandlers.set_webhook_endpoint_header = (args) => {
    const endpoint = db.rows("webhook_endpoints").find((entry) =>
      entry.id === args.p_endpoint_id && entry.user_id === args.p_user_id
    );
    if (!endpoint) return { data: false, error: null };
    endpoint.custom_header_name = args.p_custom_header_name;
    const secret = db.rows("webhook_endpoint_secrets").find((entry) => entry.endpoint_id === args.p_endpoint_id);
    if (secret) secret.custom_header_value_enc = args.p_custom_header_value_enc;
    return { data: true, error: null };
  };
  db.rpcHandlers.enqueue_webhook_backfill = (args) => {
    const endpoint = db.rows("webhook_endpoints").find((entry) =>
      entry.id === args.p_endpoint_id && entry.user_id === args.p_user_id && entry.status === "active"
    );
    return { data: endpoint ? 7 : 0, error: null };
  };
}

interface Outbound {
  url: string;
  headers: Record<string, string>;
  body: string;
  redirect: string | undefined;
}

interface HarnessOptions {
  userId?: string | null;
  tier?: string;
  tables?: Record<string, Row[]>;
  dns?: Record<string, string[]>;
  receiverStatus?: number;
  secrets?: string[];
}

function harness(options: HarnessOptions = {}) {
  const userId = options.userId === undefined ? USER_A : options.userId;
  const db = new FakeDb({
    subscriptions: [subscription(USER_A, options.tier ?? "FLAME"), subscription(USER_B, "FLAME")],
    ...(options.tables ?? {}),
  });
  registerRpcs(db, [ENDPOINT_A]);
  const outbound: Outbound[] = [];
  const lookups: string[] = [];
  const dns = options.dns ?? { "hooks.example.com/A": ["93.184.216.34"] };
  const resolveDns: DnsResolver = (hostname, recordType) => {
    lookups.push(`${hostname}/${recordType}`);
    return Promise.resolve(dns[`${hostname}/${recordType}`] ?? []);
  };
  const secrets = [...(options.secrets ?? [SECRET_1, SECRET_2])];
  let nextId = 0;
  const deps: WebhookEndpointsDependencies = {
    createAuthClient: () => fakeClient(db, userId),
    createAdminClient: () => fakeClient(db, null, () => NOW) as unknown as SupabaseClient,
    fetch: ((input: string | URL | Request, init?: RequestInit) => {
      outbound.push({
        url: String(input),
        headers: (init?.headers ?? {}) as Record<string, string>,
        body: String(init?.body),
        redirect: init?.redirect,
      });
      return Promise.resolve(new Response("receiver body", { status: options.receiverStatus ?? 200 }));
    }) as typeof fetch,
    resolveDns,
    env: (name) =>
      ({
        SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co",
        APP_URL: "https://phoenix-portal.com",
      } as Record<string, string>)[name],
    now: () => NOW,
    encrypt,
    decrypt,
    generateSecret: () => secrets.shift() ?? SECRET_2,
    newId: () => `dddddddd-0000-4000-8000-${String(++nextId).padStart(12, "0")}`,
  };
  const handler = createWebhookEndpointsHandler(deps);
  const call = (body: unknown, init: { authorization?: string | null; raw?: string } = {}) => {
    const headers = new Headers({ "Content-Type": "application/json" });
    if (init.authorization !== null) headers.set("Authorization", init.authorization ?? "Bearer test-jwt");
    return handler(
      new Request("http://localhost/functions/v1/webhook-endpoints", {
        method: "POST",
        headers,
        body: init.raw ?? JSON.stringify(body),
      }),
    );
  };
  return { db, call, outbound, lookups, handler };
}

const CREATE = {
  action: "create",
  label: "  Home lab  ",
  url: "https://hooks.example.com/in#ignored",
  scopes: ["workouts", "personal_records", "workouts"],
};

Deno.test("webhook-endpoints: a request without a bearer token is refused with 401", async () => {
  const { call, db } = harness();

  const response = await call(CREATE, { authorization: null });

  assertEquals(response.status, 401);
  assertEquals(db.rpcCallNames(), []);
});

Deno.test("webhook-endpoints: a token the auth service does not recognise is refused with 401", async () => {
  const { call, db } = harness({ userId: null });

  const response = await call(CREATE);

  assertEquals(response.status, 401);
  assertEquals(db.rows("webhook_endpoints").length, 0);
});

Deno.test("webhook-endpoints: create stores the endpoint for the JWT user and returns the secret once", async () => {
  const { call, db } = harness();

  const response = await call({ ...CREATE, user_id: USER_B, userId: USER_B });
  const body = await response.json();

  assertEquals(response.status, 201);
  assertEquals(body.signingSecret, SECRET_1);
  // The owner is the verified user, whatever the body claims.
  const stored = db.rows("webhook_endpoints")[0];
  assertEquals(stored.user_id, USER_A);
  assertEquals(stored.label, "Home lab");
  assertEquals(stored.url, "https://hooks.example.com/in");
  assertEquals(stored.scopes, ["workouts", "personal_records"]);
  assertEquals(stored.signing_key_hint, "LaSw");
  // At rest the secret is ciphertext, never the plaintext.
  const secret = db.rows("webhook_endpoint_secrets")[0];
  assertEquals(secret.user_id, USER_A);
  assertNotEquals(secret.signing_secret_enc, SECRET_1);
  assertEquals(await decrypt(secret.signing_secret_enc as string), SECRET_1);
  // The endpoint object carries metadata only.
  assertEquals(body.endpoint.id, ENDPOINT_A);
  assert(!JSON.stringify(body.endpoint).includes("whsec_"));
  assertEquals("user_id" in body.endpoint, false);
});

Deno.test("webhook-endpoints: create encrypts the custom header value and stores only its name in the endpoint", async () => {
  const { call, db } = harness();

  const response = await call({ ...CREATE, customHeader: { name: "Authorization", value: HEADER_VALUE } });
  const text = await response.text();

  assertEquals(response.status, 201);
  assertEquals(db.rows("webhook_endpoints")[0].custom_header_name, "Authorization");
  const stored = db.rows("webhook_endpoint_secrets")[0].custom_header_value_enc as string;
  assertNotEquals(stored, HEADER_VALUE);
  assertEquals(await decrypt(stored), HEADER_VALUE);
  // The value is write-only: it never comes back.
  assert(!text.includes(HEADER_VALUE));
});

Deno.test("webhook-endpoints: an EMBER user cannot create an endpoint and nothing is resolved or stored", async () => {
  const { call, db, lookups } = harness({ tier: "EMBER" });

  const response = await call(CREATE);
  const body = await response.json();

  assertEquals(response.status, 402);
  assertEquals(body.requiredTier, "FLAME");
  assertEquals(db.rows("webhook_endpoints").length, 0);
  assertEquals(lookups, []);
});

Deno.test("webhook-endpoints: create refuses URLs that are not public https targets", async () => {
  const cases: Array<[string, string, Record<string, string[]> | undefined]> = [
    ["http://hooks.example.com/in", "url_not_https", undefined],
    ["https://localhost/in", "url_host_not_allowed", undefined],
    ["https://169.254.169.254/latest/meta-data/", "url_host_not_allowed", undefined],
    ["https://abcdefghijklmnopqrst.supabase.co/functions/v1/delete-account", "url_host_not_allowed", undefined],
    ["https://phoenix-portal.com/in", "url_host_not_allowed", undefined],
    ["https://user:pw@hooks.example.com/in", "url_has_credentials", undefined],
    ["https://hooks.example.com:22/in", "url_port_not_allowed", undefined],
    ["https://hooks.example.com/in", "url_resolves_to_private_address", { "hooks.example.com/A": ["10.0.0.5"] }],
    ["https://hooks.example.com/in", "dns_failed", {}],
  ];
  for (const [url, code, dns] of cases) {
    const { call, db } = harness({ dns });

    const response = await call({ ...CREATE, url });
    const body = await response.json();

    assertEquals(response.status, 400, url);
    assertEquals(body.error, code, url);
    assertEquals(db.rows("webhook_endpoints").length, 0, url);
  }
});

Deno.test("webhook-endpoints: create refuses a reserved or malformed custom header", async () => {
  for (const [name, value, code] of [
    ["Host", "evil.example.com", "header_name_reserved"],
    ["webhook-signature", "v1,forged", "header_name_reserved"],
    ["Authorization", "a\r\nX-Injected: 1", "header_value_invalid"],
    ["bad name", "v", "header_name_invalid"],
  ]) {
    const { call, db } = harness();

    const response = await call({ ...CREATE, customHeader: { name, value } });

    assertEquals(response.status, 400, name);
    assertEquals((await response.json()).error, code, name);
    assertEquals(db.rows("webhook_endpoints").length, 0, name);
  }
});

Deno.test("webhook-endpoints: create refuses unknown scopes, an empty scope list and a bad label", async () => {
  for (const patch of [
    { scopes: ["workouts", "telemetry"] },
    { scopes: [] },
    { scopes: "workouts" },
    { label: "   " },
    { label: "x".repeat(81) },
  ]) {
    const { call, db } = harness();

    const response = await call({ ...CREATE, ...patch });

    assertEquals(response.status, 400, JSON.stringify(patch));
    assertEquals(db.rows("webhook_endpoints").length, 0);
  }
});

Deno.test("webhook-endpoints: a fourth endpoint is refused with 409", async () => {
  const { call } = harness({
    tables: {
      webhook_endpoints: [
        endpointRow({ id: "eeeeeeee-0000-4000-8000-000000000001" }),
        endpointRow({ id: "eeeeeeee-0000-4000-8000-000000000002" }),
        endpointRow({ id: "eeeeeeee-0000-4000-8000-000000000003" }),
      ],
    },
  });

  const response = await call(CREATE);

  assertEquals(response.status, 409);
  assertEquals((await response.json()).error, "endpoint_limit");
});

Deno.test("webhook-endpoints: another user's endpoint is a 404 for every action and is left untouched", async () => {
  for (const action of [
    { action: "update", label: "hijacked" },
    { action: "update", status: "paused" },
    { action: "update", url: "https://hooks.example.com/attacker" },
    { action: "update", customHeader: { name: "X-Api-Key", value: "attacker" } },
    { action: "rotate_secret" },
    { action: "test" },
    { action: "resend_all" },
    { action: "delete" },
  ]) {
    // Arrange: the endpoint belongs to A; the caller is B.
    const before = endpointRow();
    const secretBefore = await secretRow();
    const { call, db, outbound } = harness({
      userId: USER_B,
      tables: { webhook_endpoints: [{ ...before }], webhook_endpoint_secrets: [{ ...secretBefore }] },
    });

    // Act
    const response = await call({ ...action, endpointId: ENDPOINT_A });

    // Assert
    assertEquals(response.status, 404, JSON.stringify(action));
    assertEquals(db.rows("webhook_endpoints"), [before], JSON.stringify(action));
    assertEquals(db.rows("webhook_endpoint_secrets"), [secretBefore], JSON.stringify(action));
    assertEquals(outbound.length, 0, JSON.stringify(action));
    assertEquals(db.rows("webhook_deliveries").length, 0, JSON.stringify(action));
  }
});

Deno.test("webhook-endpoints: a lapsed user can still pause and delete, but not edit or resume", async () => {
  const tables = async () => ({
    webhook_endpoints: [endpointRow()],
    webhook_endpoint_secrets: [await secretRow()],
  });

  const paused = harness({ tier: "FREE", tables: await tables() });
  const pauseResponse = await paused.call({ action: "update", endpointId: ENDPOINT_A, status: "paused" });
  assertEquals(pauseResponse.status, 200);
  assertEquals(paused.db.rows("webhook_endpoints")[0].status, "paused");
  assertEquals(paused.db.rows("webhook_endpoints")[0].disabled_reason, "user_paused");

  const deleted = harness({ tier: "FREE", tables: await tables() });
  const deleteResponse = await deleted.call({ action: "delete", endpointId: ENDPOINT_A });
  assertEquals(deleteResponse.status, 200);
  assertEquals(deleted.db.rows("webhook_endpoints").length, 0);

  // A pause smuggled together with an edit is an edit: it needs the tier.
  const edited = harness({ tier: "FREE", tables: await tables() });
  const editResponse = await edited.call({
    action: "update",
    endpointId: ENDPOINT_A,
    status: "paused",
    url: "https://hooks.example.com/elsewhere",
  });
  assertEquals(editResponse.status, 402);
  assertEquals(edited.db.rows("webhook_endpoints")[0].url, "https://hooks.example.com/in");

  const resumed = harness({
    tier: "FREE",
    tables: {
      webhook_endpoints: [endpointRow({ status: "paused", disabled_reason: "subscription_lapsed" })],
      webhook_endpoint_secrets: [await secretRow()],
    },
  });
  const resumeResponse = await resumed.call({ action: "update", endpointId: ENDPOINT_A, status: "active" });
  assertEquals(resumeResponse.status, 402);
  assertEquals(resumed.db.rows("webhook_endpoints")[0].status, "paused");
  assertEquals(resumed.outbound.length, 0);
});

Deno.test("webhook-endpoints: pausing a disabled endpoint keeps the reason it was switched off for", async () => {
  const { call, db } = harness({
    tables: {
      webhook_endpoints: [endpointRow({ status: "disabled", disabled_reason: "too_many_failures" })],
      webhook_endpoint_secrets: [await secretRow()],
    },
  });

  const response = await call({ action: "update", endpointId: ENDPOINT_A, status: "paused" });

  assertEquals(response.status, 200);
  assertEquals(db.rows("webhook_endpoints")[0].status, "disabled");
  assertEquals(db.rows("webhook_endpoints")[0].disabled_reason, "too_many_failures");
});

Deno.test("webhook-endpoints: resume needs a passing test delivery and clears the reason in the same write", async () => {
  const tables = async () => ({
    webhook_endpoints: [endpointRow({ status: "disabled", disabled_reason: "too_many_failures", consecutive_failures: 9 })],
    webhook_endpoint_secrets: [await secretRow()],
  });

  const failing = harness({ receiverStatus: 500, tables: await tables() });
  const refused = await failing.call({ action: "update", endpointId: ENDPOINT_A, status: "active" });
  const refusedBody = await refused.json();
  assertEquals(refused.status, 409);
  assertEquals(refusedBody.error, "test_delivery_failed");
  assertEquals(refusedBody.statusCode, 500);
  assertEquals(failing.db.rows("webhook_endpoints")[0].status, "disabled");
  assertEquals(failing.db.rows("webhook_endpoints")[0].disabled_reason, "too_many_failures");

  const passing = harness({ receiverStatus: 202, tables: await tables() });
  const accepted = await passing.call({ action: "update", endpointId: ENDPOINT_A, status: "active" });
  assertEquals(accepted.status, 200);
  const row = passing.db.rows("webhook_endpoints")[0];
  assertEquals([row.status, row.disabled_reason, row.consecutive_failures], ["active", null, 0]);
  assertEquals((await accepted.json()).endpoint.status, "active");
  assertEquals(passing.outbound.length, 1);
});

Deno.test("webhook-endpoints: update validates a new URL, sets the header through the RPC and can clear it", async () => {
  const { call, db } = harness({
    tables: { webhook_endpoints: [endpointRow()], webhook_endpoint_secrets: [await secretRow()] },
  });

  const bad = await call({ action: "update", endpointId: ENDPOINT_A, url: "https://10.0.0.1/in" });
  assertEquals(bad.status, 400);
  assertEquals(db.rows("webhook_endpoints")[0].url, "https://hooks.example.com/in");

  const set = await call({
    action: "update",
    endpointId: ENDPOINT_A,
    label: "Renamed",
    scopes: ["routines"],
    customHeader: { name: "X-Api-Key", value: HEADER_VALUE },
  });
  assertEquals(set.status, 200);
  assertEquals(db.rows("webhook_endpoints")[0].label, "Renamed");
  assertEquals(db.rows("webhook_endpoints")[0].scopes, ["routines"]);
  assertEquals(db.rows("webhook_endpoints")[0].custom_header_name, "X-Api-Key");
  assertEquals(await decrypt(db.rows("webhook_endpoint_secrets")[0].custom_header_value_enc as string), HEADER_VALUE);

  const cleared = await call({ action: "update", endpointId: ENDPOINT_A, customHeader: null });
  assertEquals(cleared.status, 200);
  assertEquals(db.rows("webhook_endpoints")[0].custom_header_name, null);
  assertEquals(db.rows("webhook_endpoint_secrets")[0].custom_header_value_enc, null);
});

Deno.test("webhook-endpoints: rotate returns a new secret once and keeps the old one for the overlap", async () => {
  const { call, db } = harness({
    secrets: [SECRET_2],
    tables: { webhook_endpoints: [endpointRow()], webhook_endpoint_secrets: [await secretRow()] },
  });

  const response = await call({ action: "rotate_secret", endpointId: ENDPOINT_A });
  const body = await response.json();

  assertEquals(response.status, 200);
  assertEquals(body.signingSecret, SECRET_2);
  assertEquals(body.endpoint.signing_key_hint, "b7oD");
  const stored = db.rows("webhook_endpoint_secrets")[0];
  assertEquals(await decrypt(stored.signing_secret_enc as string), SECRET_2);
  assertEquals(await decrypt(stored.previous_signing_secret_enc as string), SECRET_1);
});

Deno.test("webhook-endpoints: test sends one signed ping to the stored URL and logs it", async () => {
  const { call, db, outbound } = harness({
    tables: {
      webhook_endpoints: [endpointRow({ custom_header_name: "Authorization" })],
      webhook_endpoint_secrets: [await secretRow({ custom_header_value_enc: await encrypt(HEADER_VALUE) })],
    },
  });

  const response = await call({ action: "test", endpointId: ENDPOINT_A });
  const body = await response.json();

  assertEquals(response.status, 200);
  assertEquals(body, { delivered: true, statusCode: 200, errorCode: null, durationMs: 0 });
  assertEquals(outbound.length, 1);
  const sent = outbound[0];
  assertEquals(sent.url, "https://hooks.example.com/in");
  assertEquals(sent.redirect, "manual");
  assertEquals(JSON.parse(sent.body), {
    type: "ping",
    timestamp: NOW.toISOString(),
    data: { apiVersion: "2026-11-01", endpointId: ENDPOINT_A },
  });
  const deliveryId = "dddddddd-0000-4000-8000-000000000001";
  assertEquals(sent.headers["webhook-id"], deliveryId);
  assertEquals(
    sent.headers["webhook-signature"],
    await signWebhook(SECRET_1, deliveryId, Math.floor(NOW.getTime() / 1000), sent.body),
  );
  // The user's own header is the only Authorization that may appear.
  assertEquals(sent.headers.Authorization, HEADER_VALUE);
  assertEquals("apikey" in sent.headers, false);
  // Nothing the receiver answered reaches the caller.
  assert(!JSON.stringify(body).includes("receiver body"));
  const logged = db.rows("webhook_deliveries");
  assertEquals(logged.length, 1);
  assertEquals(
    [logged[0].id, logged[0].endpoint_id, logged[0].user_id, logged[0].entity, logged[0].status, logged[0].last_status_code],
    [deliveryId, ENDPOINT_A, USER_A, "ping", "delivered", 200],
  );
});

Deno.test("webhook-endpoints: a failed test delivery reports a fixed code and never switches the endpoint off", async () => {
  const { call, db } = harness({
    receiverStatus: 301,
    tables: { webhook_endpoints: [endpointRow()], webhook_endpoint_secrets: [await secretRow()] },
  });

  const response = await call({ action: "test", endpointId: ENDPOINT_A });
  const body = await response.json();

  assertEquals(response.status, 200);
  assertEquals([body.delivered, body.statusCode, body.errorCode], [false, 301, "redirect_not_followed"]);
  assertEquals(db.rows("webhook_endpoints")[0].status, "active");
  assertEquals(db.rows("webhook_deliveries")[0].status, "dead");
});

Deno.test("webhook-endpoints: requests to a user-chosen host are rate limited on their own tight key", async () => {
  const { call, outbound } = harness({
    tables: { webhook_endpoints: [endpointRow()], webhook_endpoint_secrets: [await secretRow()] },
  });

  for (let i = 0; i < WEBHOOK_OUTBOUND_RATE_LIMIT.maxRequests; i += 1) {
    assertEquals((await call({ action: "test", endpointId: ENDPOINT_A })).status, 200);
  }
  const limited = await call({ action: "test", endpointId: ENDPOINT_A });
  // A label edit makes no outbound request and is not caught by that key.
  const edit = await call({ action: "update", endpointId: ENDPOINT_A, label: "Still allowed" });

  assertEquals(limited.status, 429);
  assertEquals(outbound.length, WEBHOOK_OUTBOUND_RATE_LIMIT.maxRequests);
  assertEquals(edit.status, 200);
});

Deno.test("webhook-endpoints: resend_all enqueues for the caller's active endpoint only", async () => {
  const active = harness({
    tables: { webhook_endpoints: [endpointRow()], webhook_endpoint_secrets: [await secretRow()] },
  });
  const enqueued = await active.call({ action: "resend_all", endpointId: ENDPOINT_A });
  assertEquals(enqueued.status, 200);
  assertEquals(await enqueued.json(), { enqueued: 7 });
  assertEquals(active.db.rpcCalls.at(-1), {
    name: "enqueue_webhook_backfill",
    args: { p_user_id: USER_A, p_endpoint_id: ENDPOINT_A },
  });

  const paused = harness({
    tables: {
      webhook_endpoints: [endpointRow({ status: "paused", disabled_reason: "user_paused" })],
      webhook_endpoint_secrets: [await secretRow()],
    },
  });
  const refused = await paused.call({ action: "resend_all", endpointId: ENDPOINT_A });
  assertEquals(refused.status, 409);
  assertEquals(paused.db.rpcCallNames().includes("enqueue_webhook_backfill"), false);
});

Deno.test("webhook-endpoints: malformed requests are refused before anything is read or written", async () => {
  const { call, db, handler } = harness();

  assertEquals((await call({ action: "explode" })).status, 400);
  assertEquals((await call({})).status, 400);
  assertEquals((await call(null, { raw: "{not json" })).status, 400);
  assertEquals((await call({ action: "delete", endpointId: "not-a-uuid" })).status, 400);
  assertEquals((await call({ action: "test" })).status, 400);
  assertEquals((await call(null, { raw: JSON.stringify({ action: "create", label: "x".repeat(20_000) }) })).status, 413);
  const get = await handler(new Request("http://localhost/functions/v1/webhook-endpoints", { method: "GET" }));
  assertEquals(get.status, 405);
  assertEquals(db.rows("webhook_endpoints").length, 0);
  assertEquals(db.rpcCallNames(), []);
});

Deno.test("webhook-endpoints: no secret, header value or URL path is ever logged", async () => {
  const { call } = harness({
    receiverStatus: 500,
    tables: {
      webhook_endpoints: [endpointRow({
        url: "https://hooks.example.com/in/private-path-token",
        custom_header_name: "Authorization",
      })],
      webhook_endpoint_secrets: [await secretRow({ custom_header_value_enc: await encrypt(HEADER_VALUE) })],
    },
  });

  const { logs } = await captureLogs(async () => {
    await call({ ...CREATE, customHeader: { name: "X-Api-Key", value: "second-header-value" } });
    await call({ action: "rotate_secret", endpointId: ENDPOINT_A });
    await call({ action: "test", endpointId: ENDPOINT_A });
    await call({ action: "update", endpointId: ENDPOINT_A, status: "paused" });
    await call({ action: "update", endpointId: ENDPOINT_A, status: "active" });
    await call({ action: "delete", endpointId: ENDPOINT_A });
  });

  assertNoSecretsLogged(logs, [
    SECRET_1,
    SECRET_2,
    HEADER_VALUE,
    "second-header-value",
    "private-path-token",
    "test-jwt",
  ]);
});
