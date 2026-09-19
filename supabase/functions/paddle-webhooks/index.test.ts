import { assert, assertEquals } from "jsr:@std/assert@1";
import { hmacSha256Hex } from "../_shared/hmac.ts";
import {
  createPaddleWebhooksHandler,
  type PaddleWebhooksDbClient,
} from "./index.ts";

// Handler tests with an in-process database double. Secrets are generated per
// run; nothing here talks to Paddle or Supabase.

function randomSecret(prefix: string): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return `${prefix}_${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

const WEBHOOK_SECRET = randomSecret("whsec_test");
const CUSTOM_DATA_SECRET = randomSecret("cdsec_test");
const NOW_MS = Date.UTC(2026, 8, 18, 12, 0, 0);
const NOW_SECONDS = Math.floor(NOW_MS / 1000);
const USER_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const EMBER_PRICE = "pri_ember_monthly_test";

const BASE_ENV: Record<string, string> = {
  PADDLE_WEBHOOK_SECRET: WEBHOOK_SECRET,
  PADDLE_CUSTOM_DATA_SECRET: CUSTOM_DATA_SECRET,
  PADDLE_EMBER_PRICE_IDS: EMBER_PRICE,
  PADDLE_FLAME_PRICE_IDS: "pri_flame_monthly_test",
  PADDLE_INFERNO_PRICE_IDS: "pri_inferno_monthly_test",
};

interface StoredRow {
  last_event_id: string | null;
  last_event_occurred_at: string | null;
  tier: string | null;
  paddle_subscription_id: string | null;
}

/**
 * Stateful double for the two calls the handler makes. `apply_subscription_event`
 * enforces the same strictly-newer guard as the SQL function so a replay
 * through the double behaves like the real write path.
 */
class FakeDb implements PaddleWebhooksDbClient {
  row: StoredRow | null;
  fromCalls = 0;
  rpcCalls: Array<Record<string, unknown>> = [];

  constructor(row: StoredRow | null = null) {
    this.row = row;
  }

  from(_table: "subscriptions") {
    this.fromCalls += 1;
    return {
      select: (_columns: string) => ({
        eq: (_column: "user_id", _value: string) => ({
          maybeSingle: () => Promise.resolve({ data: this.row ? { ...this.row } : null, error: null }),
        }),
      }),
    };
  }

  rpc(_fn: "apply_subscription_event", args: Record<string, unknown>) {
    this.rpcCalls.push(args);
    const incoming = Date.parse(String(args.p_last_event_occurred_at));
    const stored = this.row?.last_event_occurred_at ? Date.parse(this.row.last_event_occurred_at) : null;
    if (stored !== null && incoming <= stored) {
      return Promise.resolve({ data: false, error: null });
    }
    this.row = {
      last_event_id: String(args.p_last_event_id),
      last_event_occurred_at: String(args.p_last_event_occurred_at),
      tier: String(args.p_tier),
      paddle_subscription_id: (args.p_paddle_subscription_id as string | null) ?? null,
    };
    return Promise.resolve({ data: true, error: null });
  }
}

function makeHandler(db: FakeDb, envOverrides: Record<string, string> = {}) {
  const env = new Map(Object.entries({ ...BASE_ENV, ...envOverrides }));
  return createPaddleWebhooksHandler({
    env: { get: (key) => env.get(key) },
    createAdminClient: () => db,
    now: () => NOW_MS,
  });
}

async function subscriptionEvent(overrides: {
  eventId?: string;
  occurredAt?: string;
  priceId?: string;
} = {}): Promise<string> {
  return JSON.stringify({
    event_id: overrides.eventId ?? "evt_01",
    event_type: "subscription.updated",
    occurred_at: overrides.occurredAt ?? "2026-09-18T11:59:00.000Z",
    data: {
      id: "sub_01",
      customer_id: "ctm_01",
      status: "active",
      items: [{ price: { id: overrides.priceId ?? EMBER_PRICE }, quantity: 1 }],
      custom_data: {
        user_id: USER_ID,
        cd_sig: await hmacSha256Hex(CUSTOM_DATA_SECRET, USER_ID),
      },
      current_billing_period: {
        starts_at: "2026-09-01T00:00:00.000Z",
        ends_at: "2026-10-01T00:00:00.000Z",
      },
      scheduled_change: null,
    },
  });
}

async function signedRequest(
  body: string,
  { ts = NOW_SECONDS, secret = WEBHOOK_SECRET }: { ts?: number; secret?: string } = {},
): Promise<Request> {
  const h1 = await hmacSha256Hex(secret, `${ts}:${body}`);
  return new Request("http://localhost/paddle-webhooks", {
    method: "POST",
    headers: { "Paddle-Signature": `ts=${ts};h1=${h1}` },
    body,
  });
}

async function captureConsoleError<T>(fn: () => Promise<T>): Promise<{ result: T; lines: string[] }> {
  const original = console.error;
  const lines: string[] = [];
  console.error = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
  try {
    return { result: await fn(), lines };
  } finally {
    console.error = original;
  }
}

Deno.test("paddle-webhooks: a valid signed event is applied through one RPC", async () => {
  const db = new FakeDb();
  const response = await makeHandler(db)(await signedRequest(await subscriptionEvent()));

  assertEquals(response.status, 200);
  assertEquals(await response.json(), { received: true });
  assertEquals(db.rpcCalls.length, 1);
  assertEquals(db.rpcCalls[0]!.p_user_id, USER_ID);
  assertEquals(db.rpcCalls[0]!.p_tier, "EMBER");
  assertEquals(db.rpcCalls[0]!.p_last_event_id, "evt_01");
});

Deno.test("paddle-webhooks: signature from the wrong secret is 401 with no DB call", async () => {
  const db = new FakeDb();
  const request = await signedRequest(await subscriptionEvent(), {
    secret: randomSecret("whsec_other"),
  });
  const response = await makeHandler(db)(request);

  assertEquals(response.status, 401);
  assertEquals(await response.json(), { error: "Invalid signature" });
  assertEquals(db.fromCalls, 0);
  assertEquals(db.rpcCalls.length, 0);
});

Deno.test("paddle-webhooks: a tampered body is 401 with no DB call", async () => {
  const db = new FakeDb();
  const signed = await signedRequest(await subscriptionEvent());
  const tampered = new Request(signed.url, {
    method: "POST",
    headers: signed.headers,
    body: await subscriptionEvent({ priceId: "pri_inferno_monthly_test" }),
  });
  const response = await makeHandler(db)(tampered);

  assertEquals(response.status, 401);
  assertEquals(db.fromCalls, 0);
  assertEquals(db.rpcCalls.length, 0);
});

Deno.test("paddle-webhooks: a stale ts outside the replay window is 401 with no DB call", async () => {
  const db = new FakeDb();
  const response = await makeHandler(db)(
    await signedRequest(await subscriptionEvent(), { ts: NOW_SECONDS - 301 }),
  );

  assertEquals(response.status, 401);
  assertEquals(db.fromCalls, 0);
  assertEquals(db.rpcCalls.length, 0);
});

Deno.test("paddle-webhooks: a future ts beyond the replay window is 401 with no DB call", async () => {
  const db = new FakeDb();
  const response = await makeHandler(db)(
    await signedRequest(await subscriptionEvent(), { ts: NOW_SECONDS + 301 }),
  );

  assertEquals(response.status, 401);
  assertEquals(db.fromCalls, 0);
  assertEquals(db.rpcCalls.length, 0);
});

Deno.test("paddle-webhooks: ts at the edge of the replay window is accepted", async () => {
  const db = new FakeDb();
  const response = await makeHandler(db)(
    await signedRequest(await subscriptionEvent(), { ts: NOW_SECONDS - 300 }),
  );

  assertEquals(response.status, 200);
  assertEquals(db.rpcCalls.length, 1);
});

Deno.test("paddle-webhooks: a missing Paddle-Signature header is 401 with no DB call", async () => {
  const db = new FakeDb();
  const response = await makeHandler(db)(
    new Request("http://localhost/paddle-webhooks", {
      method: "POST",
      body: await subscriptionEvent(),
    }),
  );

  assertEquals(response.status, 401);
  assertEquals(db.fromCalls, 0);
  assertEquals(db.rpcCalls.length, 0);
});

Deno.test("paddle-webhooks: a replayed event id is acknowledged idempotently (one RPC call)", async () => {
  const db = new FakeDb();
  const handler = makeHandler(db);
  const body = await subscriptionEvent({ eventId: "evt_dup" });

  const first = await handler(await signedRequest(body));
  const second = await handler(await signedRequest(body));

  assertEquals(first.status, 200);
  assertEquals(second.status, 200);
  assertEquals(await second.json(), { received: true, duplicate: true });
  assertEquals(db.rpcCalls.length, 1);
});

Deno.test("paddle-webhooks: an older occurred_at is acknowledged without an update", async () => {
  const db = new FakeDb({
    last_event_id: "evt_newer",
    last_event_occurred_at: "2026-09-18T11:59:30.000Z",
    tier: "FLAME",
    paddle_subscription_id: "sub_01",
  });
  const response = await makeHandler(db)(
    await signedRequest(
      await subscriptionEvent({ eventId: "evt_older", occurredAt: "2026-09-18T11:59:00.000Z" }),
    ),
  );

  assertEquals(response.status, 200);
  assertEquals(await response.json(), { received: true, stale: true });
  assertEquals(db.rpcCalls.length, 0);
  assertEquals(db.row?.last_event_id, "evt_newer");
  assertEquals(db.row?.tier, "FLAME");
});

Deno.test("paddle-webhooks: an unknown price with no paid tier to keep is 500 with [BILLING_ALERT]", async () => {
  const db = new FakeDb();
  const request = await signedRequest(await subscriptionEvent({ priceId: "pri_unknown" }));
  const { result: response, lines } = await captureConsoleError(() => makeHandler(db)(request));

  assertEquals(response.status, 500);
  assertEquals(await response.json(), { error: "Unknown price_id — configuration error" });
  assertEquals(db.rpcCalls.length, 0);
  assert(
    lines.some((line) => line.includes("[BILLING_ALERT]") && line.includes("pri_unknown")),
    `expected a [BILLING_ALERT] naming the price, got: ${JSON.stringify(lines)}`,
  );
});

Deno.test("paddle-webhooks: a price id configured under two tiers is 500 before any DB call", async () => {
  const db = new FakeDb();
  const request = await signedRequest(await subscriptionEvent());
  const { result: response } = await captureConsoleError(() =>
    makeHandler(db, { PADDLE_FLAME_PRICE_IDS: `pri_flame_monthly_test,${EMBER_PRICE}` })(request)
  );

  assertEquals(response.status, 500);
  assertEquals(await response.json(), { error: "Billing configuration invalid" });
  assertEquals(db.fromCalls, 0);
  assertEquals(db.rpcCalls.length, 0);
});

Deno.test("paddle-webhooks: a validly signed event without user_id is ignored with 200 and no DB call", async () => {
  const db = new FakeDb();
  const body = JSON.stringify({
    event_id: "evt_missing_user",
    event_type: "subscription.updated",
    occurred_at: "2026-09-18T11:59:00.000Z",
    data: { id: "sub_01", customer_id: "ctm_01", status: "active", custom_data: {} },
  });
  const response = await makeHandler(db)(await signedRequest(body));

  assertEquals(response.status, 200);
  assertEquals(await response.json(), { ignored: true });
  assertEquals(db.fromCalls, 0);
  assertEquals(db.rpcCalls.length, 0);
});

Deno.test("paddle-webhooks: a validly signed event with a malformed user_id is 400 with no DB call", async () => {
  const db = new FakeDb();
  const body = JSON.stringify({
    event_id: "evt_bad_user",
    event_type: "subscription.updated",
    occurred_at: "2026-09-18T11:59:00.000Z",
    data: { id: "sub_01", customer_id: "ctm_01", status: "active", custom_data: { user_id: "not-a-uuid" } },
  });
  const request = await signedRequest(body);
  const { result: response } = await captureConsoleError(() => makeHandler(db)(request));

  assertEquals(response.status, 400);
  assertEquals(db.fromCalls, 0);
  assertEquals(db.rpcCalls.length, 0);
});
