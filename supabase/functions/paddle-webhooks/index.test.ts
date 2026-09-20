import { assert, assertEquals } from "jsr:@std/assert@1";
import { hmacSha256Hex } from "../_shared/hmac.ts";
import {
  createPaddleWebhooksHandler,
  type PaddleWebhooksDbClient,
  type SubscriptionEventsTableQuery,
  type SubscriptionsTableQuery,
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
  status?: string | null;
  current_period_end?: string | null;
  cancel_at_period_end?: boolean | null;
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
  subscriptionEventInserts: Array<Record<string, unknown>> = [];
  /** Error returned by the subscriptions lookup. */
  selectError: unknown = null;
  /** Error returned by apply_subscription_event. */
  rpcError: unknown = null;
  /** Simulates losing the write-time ordering race to a concurrent delivery. */
  forceNotApplied = false;
  /** 1-based index of the first rpc call that must fail (null: none). */
  failRpcFrom: number | null = null;

  constructor(row: StoredRow | null = null) {
    this.row = row;
  }

  from(table: "subscriptions"): SubscriptionsTableQuery;
  from(table: "subscription_events"): SubscriptionEventsTableQuery;
  from(
    table: "subscriptions" | "subscription_events",
  ): SubscriptionsTableQuery | SubscriptionEventsTableQuery {
    if (table === "subscription_events") {
      return {
        insert: (values: Record<string, unknown>) => {
          this.subscriptionEventInserts.push(values);
          return Promise.resolve({ error: null });
        },
      };
    }
    this.fromCalls += 1;
    return {
      select: (_columns: string) => ({
        eq: (_column: "user_id", _value: string) => ({
          maybeSingle: () =>
            Promise.resolve(
              this.selectError
                ? { data: null, error: this.selectError }
                : { data: this.row ? { ...this.row } : null, error: null },
            ),
        }),
      }),
    };
  }

  rpc(_fn: "apply_subscription_event", args: Record<string, unknown>) {
    this.rpcCalls.push(args);
    if (this.failRpcFrom !== null && this.rpcCalls.length >= this.failRpcFrom) {
      return Promise.resolve({ data: null, error: { message: "deadlock detected" } });
    }
    if (this.rpcError) return Promise.resolve({ data: null, error: this.rpcError });
    if (this.forceNotApplied) return Promise.resolve({ data: false, error: null });
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
      status: (args.p_status as string | null) ?? null,
      current_period_end: (args.p_current_period_end as string | null) ?? null,
      cancel_at_period_end: Boolean(args.p_cancel_at_period_end),
    };
    return Promise.resolve({ data: true, error: null });
  }
}

interface PaddleCall {
  url: string;
  method: string;
}

function makeHandler(
  db: FakeDb,
  envOverrides: Record<string, string> = {},
  paddle: {
    calls?: PaddleCall[];
    listResponse?: () => Response;
  } = {},
) {
  const env = new Map(Object.entries({ ...BASE_ENV, ...envOverrides }));
  return createPaddleWebhooksHandler({
    env: { get: (key) => env.get(key) },
    createAdminClient: () => db,
    now: () => NOW_MS,
    fetch: (input: URL | Request | string, init?: RequestInit) => {
      paddle.calls?.push({
        url: typeof input === "string" ? input : input.toString(),
        method: init?.method ?? "GET",
      });
      return Promise.resolve(
        paddle.listResponse?.() ??
          new Response(JSON.stringify({ data: [] }), { status: 200 }),
      );
    },
  });
}

async function subscriptionEvent(overrides: {
  eventId?: string;
  eventType?: string;
  occurredAt?: string;
  priceId?: string;
  subscriptionId?: string;
  status?: string;
  /** `null` omits cd_sig; a string replaces the valid signature. */
  cdSig?: string | null;
} = {}): Promise<string> {
  const cdSig = overrides.cdSig === undefined
    ? await hmacSha256Hex(CUSTOM_DATA_SECRET, USER_ID)
    : overrides.cdSig;
  return JSON.stringify({
    event_id: overrides.eventId ?? "evt_01",
    event_type: overrides.eventType ?? "subscription.updated",
    occurred_at: overrides.occurredAt ?? "2026-09-18T11:59:00.000Z",
    data: {
      id: overrides.subscriptionId ?? "sub_01",
      customer_id: "ctm_01",
      status: overrides.status ?? "active",
      items: [{ price: { id: overrides.priceId ?? EMBER_PRICE }, quantity: 1 }],
      custom_data: {
        user_id: USER_ID,
        ...(cdSig === null ? {} : { cd_sig: cdSig }),
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
  { ts = NOW_SECONDS, secret = WEBHOOK_SECRET }: { ts?: number | string; secret?: string } = {},
): Promise<Request> {
  const h1 = await hmacSha256Hex(secret, `${ts}:${body}`);
  return new Request("http://localhost/paddle-webhooks", {
    method: "POST",
    headers: { "Paddle-Signature": `ts=${ts};h1=${h1}` },
    body,
  });
}

async function captureConsole<T>(
  method: "error" | "warn",
  fn: () => Promise<T>,
): Promise<{ result: T; lines: string[] }> {
  const original = console[method];
  const lines: string[] = [];
  console[method] = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
  try {
    return { result: await fn(), lines };
  } finally {
    console[method] = original;
  }
}

function captureConsoleError<T>(fn: () => Promise<T>) {
  return captureConsole("error", fn);
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

Deno.test("paddle-webhooks: a correctly signed header with a non-digit ts is 401 and logs no header value", async () => {
  for (const ts of [`${NOW_SECONDS}.0`, `+${NOW_SECONDS}`, `${NOW_SECONDS}e0`]) {
    const db = new FakeDb();
    const request = await signedRequest(await subscriptionEvent(), { ts });
    const h1 = request.headers.get("Paddle-Signature")!.split("h1=")[1]!;
    const { result: response, lines } = await captureConsole("warn", () => makeHandler(db)(request));

    assertEquals(response.status, 401, `ts=${ts}`);
    assertEquals(db.fromCalls, 0);
    assertEquals(db.rpcCalls.length, 0);
    assert(
      lines.some((line) => line.includes("Malformed Paddle-Signature header")),
      `expected a malformed-header log for ts=${ts}, got: ${JSON.stringify(lines)}`,
    );
    assert(!lines.some((line) => line.includes(h1) || line.includes(ts)), "header values must not be logged");
  }
});

Deno.test("paddle-webhooks: PADDLE_WEBHOOK_SECRET with surrounding whitespace still verifies", async () => {
  const db = new FakeDb();
  const response = await makeHandler(db, { PADDLE_WEBHOOK_SECRET: `  ${WEBHOOK_SECRET}\n` })(
    await signedRequest(await subscriptionEvent()),
  );

  assertEquals(response.status, 200);
  assertEquals(db.rpcCalls.length, 1);
});

Deno.test("paddle-webhooks: a whitespace-only PADDLE_WEBHOOK_SECRET is 401 with no DB call", async () => {
  const db = new FakeDb();
  const response = await makeHandler(db, { PADDLE_WEBHOOK_SECRET: "   " })(
    await signedRequest(await subscriptionEvent(), { secret: "   " }),
  );

  assertEquals(response.status, 401);
  assertEquals(await response.json(), { error: "Unauthorized" });
  assertEquals(db.fromCalls, 0);
  assertEquals(db.rpcCalls.length, 0);
});

Deno.test("paddle-webhooks: a missing or forged cd_sig with no stored subscription is 401 with no RPC", async () => {
  for (const cdSig of [null, await hmacSha256Hex(randomSecret("cdsec_forged"), USER_ID)]) {
    const db = new FakeDb();
    const request = await signedRequest(await subscriptionEvent({ cdSig }));
    const { result: response } = await captureConsoleError(() => makeHandler(db)(request));

    assertEquals(response.status, 401);
    assertEquals(await response.json(), { error: "Invalid cd_sig" });
    assertEquals(db.rpcCalls.length, 0);
  }
});

Deno.test("paddle-webhooks: an unsigned event for a different stored subscription is 401 with no RPC", async () => {
  const db = new FakeDb({
    last_event_id: "evt_prev",
    last_event_occurred_at: "2026-09-18T11:00:00.000Z",
    tier: "EMBER",
    paddle_subscription_id: "sub_someone_else",
  });
  const request = await signedRequest(await subscriptionEvent({ cdSig: null }));
  const { result: response } = await captureConsoleError(() => makeHandler(db)(request));

  assertEquals(response.status, 401);
  assertEquals(await response.json(), { error: "Invalid cd_sig" });
  assertEquals(db.rpcCalls.length, 0);
  assertEquals(db.row?.last_event_id, "evt_prev");
});

Deno.test("paddle-webhooks: an unsigned legacy event matching the stored subscription is applied", async () => {
  const db = new FakeDb({
    last_event_id: "evt_prev",
    last_event_occurred_at: "2026-09-18T11:00:00.000Z",
    tier: "EMBER",
    paddle_subscription_id: "sub_01",
  });
  const response = await makeHandler(db)(await signedRequest(await subscriptionEvent({ cdSig: null })));

  assertEquals(response.status, 200);
  assertEquals(await response.json(), { received: true });
  assertEquals(db.rpcCalls.length, 1);
});

Deno.test("paddle-webhooks: a subscription lookup error is 500 and never treated as no row", async () => {
  const db = new FakeDb();
  db.selectError = { message: "connection reset" };
  const request = await signedRequest(await subscriptionEvent());
  const { result: response } = await captureConsoleError(() => makeHandler(db)(request));

  assertEquals(response.status, 500);
  assertEquals(await response.json(), { error: "Failed to load subscription state" });
  assertEquals(db.rpcCalls.length, 0);
});

Deno.test("paddle-webhooks: an apply_subscription_event error is 500 so Paddle retries", async () => {
  const db = new FakeDb();
  db.rpcError = { message: "deadlock detected" };
  const request = await signedRequest(await subscriptionEvent());
  const { result: response } = await captureConsoleError(() => makeHandler(db)(request));

  assertEquals(response.status, 500);
  assertEquals(await response.json(), { error: "Database upsert failed" });
  assertEquals(db.rpcCalls.length, 1);
});

Deno.test("paddle-webhooks: losing the write-time ordering race is acknowledged as stale", async () => {
  const db = new FakeDb();
  db.forceNotApplied = true;
  const response = await makeHandler(db)(await signedRequest(await subscriptionEvent()));

  assertEquals(response.status, 200);
  assertEquals(await response.json(), { received: true, stale: true });
  assertEquals(db.rpcCalls.length, 1);
});

Deno.test("paddle-webhooks: an unknown price keeps the stored paid tier", async () => {
  const db = new FakeDb({
    last_event_id: "evt_prev",
    last_event_occurred_at: "2026-09-18T11:00:00.000Z",
    tier: "FLAME",
    paddle_subscription_id: "sub_01",
  });
  const request = await signedRequest(await subscriptionEvent({ priceId: "pri_unknown" }));
  const { result: response } = await captureConsole("warn", () => makeHandler(db)(request));

  assertEquals(response.status, 200);
  assertEquals(db.rpcCalls.length, 1);
  assertEquals(db.rpcCalls[0]!.p_tier, "FLAME");
});

// ─── Untracked subscriptions (F-022, R-34) ──────────────────────────────────

/** A row tracking `sub_new`, entitled until 2026-10-01. */
function trackingNewSubscription(): FakeDb {
  return new FakeDb({
    last_event_id: "evt_new_active",
    last_event_occurred_at: "2026-09-18T11:00:00.000Z",
    tier: "EMBER",
    paddle_subscription_id: "sub_new",
    status: "active",
    current_period_end: "2026-10-01T00:00:00.000Z",
    cancel_at_period_end: false,
  });
}

Deno.test("paddle-webhooks: an old subscription's cancellation leaves the new one active", async () => {
  const db = trackingNewSubscription();
  const request = await signedRequest(
    await subscriptionEvent({
      eventId: "evt_old_canceled",
      eventType: "subscription.canceled",
      subscriptionId: "sub_old",
      status: "canceled",
      occurredAt: "2026-09-18T11:58:00.000Z",
    }),
  );
  const { result: response, lines } = await captureConsoleError(() =>
    makeHandler(db)(request)
  );

  assertEquals(response.status, 200);
  assertEquals(await response.json(), {
    received: true,
    ignored: "untracked_subscription",
  });
  // The row is untouched: still the new subscription, still entitled.
  assertEquals(db.rpcCalls.length, 0);
  assertEquals(db.row?.paddle_subscription_id, "sub_new");
  assertEquals(db.row?.status, "active");
  assert(
    lines.some((line) => line.includes("foreign_subscription_event_ignored")),
    "expected a [BILLING_ALERT] foreign_subscription_event_ignored line",
  );
  // Audited for PR 68's manual double-subscription resolution.
  assertEquals(db.subscriptionEventInserts.length, 1);
  assertEquals(db.subscriptionEventInserts[0]!.note, "untracked_subscription");
  assertEquals(
    db.subscriptionEventInserts[0]!.paddle_subscription_id,
    "sub_old",
  );
  assertEquals(db.subscriptionEventInserts[0]!.status, "canceled");
});

Deno.test("paddle-webhooks: a second live subscription cannot steal an entitled row", async () => {
  const db = trackingNewSubscription();
  const request = await signedRequest(
    await subscriptionEvent({
      eventId: "evt_other_active",
      subscriptionId: "sub_other",
      status: "active",
    }),
  );
  const { result: response } = await captureConsoleError(() => makeHandler(db)(request));

  assertEquals(response.status, 200);
  assertEquals(db.rpcCalls.length, 0);
  assertEquals(db.row?.paddle_subscription_id, "sub_new");
});

Deno.test("paddle-webhooks: a resubscribe under a new id is adopted when the stored row is dead", async () => {
  const db = new FakeDb({
    last_event_id: "evt_old_canceled",
    last_event_occurred_at: "2026-09-18T11:00:00.000Z",
    tier: "EMBER",
    paddle_subscription_id: "sub_old",
    status: "canceled",
    current_period_end: "2026-10-01T00:00:00.000Z",
    cancel_at_period_end: false,
  });
  const response = await makeHandler(db)(
    await signedRequest(
      await subscriptionEvent({
        eventId: "evt_new_active",
        subscriptionId: "sub_new",
        status: "active",
      }),
    ),
  );

  assertEquals(response.status, 200);
  assertEquals(await response.json(), { received: true });
  assertEquals(db.rpcCalls.length, 1);
  assertEquals(db.row?.paddle_subscription_id, "sub_new");
  assertEquals(db.subscriptionEventInserts.length, 0);
});

Deno.test("paddle-webhooks: two tabs — A then B active, then A canceled, the row follows B", async () => {
  // Tab A subscribes first and is tracked.
  const db = new FakeDb();
  await makeHandler(db)(
    await signedRequest(
      await subscriptionEvent({
        eventId: "evt_a_active",
        subscriptionId: "sub_a",
        status: "active",
        occurredAt: "2026-09-18T11:50:00.000Z",
      }),
    ),
  );
  assertEquals(db.row?.paddle_subscription_id, "sub_a");

  // Tab B's checkout completes: an untracked subscription, so it is ignored
  // while A is still entitled.
  const { result: bResponse } = await captureConsoleError(async () =>
    await makeHandler(db)(
      await signedRequest(
        await subscriptionEvent({
          eventId: "evt_b_active",
          subscriptionId: "sub_b",
          status: "active",
          occurredAt: "2026-09-18T11:55:00.000Z",
        }),
      ),
    )
  );
  assertEquals(bResponse.status, 200);
  assertEquals(db.row?.paddle_subscription_id, "sub_a");

  // A is cancelled. B is still live in Paddle, so the row follows B instead
  // of downgrading the user (R-34).
  const calls: PaddleCall[] = [];
  const { result: cancelResponse, lines } = await captureConsoleError(async () =>
    await makeHandler(db, {
      PADDLE_API_KEY: "pdl_test_key",
      PADDLE_ENVIRONMENT: "sandbox",
    }, {
      calls,
      listResponse: () =>
        new Response(
          JSON.stringify({
            data: [
              {
                id: "sub_b",
                customer_id: "ctm_01",
                status: "active",
                updated_at: "2026-09-18T11:55:00.000Z",
                items: [{ price: { id: EMBER_PRICE }, quantity: 1 }],
                current_billing_period: {
                  starts_at: "2026-09-18T00:00:00.000Z",
                  ends_at: "2026-10-18T00:00:00.000Z",
                },
                scheduled_change: null,
              },
            ],
          }),
          { status: 200 },
        ),
    })(
      await signedRequest(
        await subscriptionEvent({
          eventId: "evt_a_canceled",
          eventType: "subscription.canceled",
          subscriptionId: "sub_a",
          status: "canceled",
          occurredAt: "2026-09-18T11:58:00.000Z",
        }),
      ),
    )
  );

  assertEquals(cancelResponse.status, 200);
  assertEquals(await cancelResponse.json(), {
    received: true,
    switchedToUntrackedSubscription: true,
  });
  assertEquals(
    calls[0]?.url,
    "https://sandbox-api.paddle.com/subscriptions?customer_id=ctm_01&status=active,trialing,past_due",
  );
  // Three writes in all: A active, then the cancellation and the adoption.
  // (B's own event wrote nothing — it was ignored.)
  assertEquals(db.rpcCalls.length, 3);
  assertEquals(db.rpcCalls[1]!.p_paddle_subscription_id, "sub_a");
  assertEquals(db.rpcCalls[1]!.p_status, "canceled");
  // The cancellation is recorded under a synthetic id so a redelivery after a
  // failed adoption is not dismissed as a duplicate.
  assertEquals(
    db.rpcCalls[1]!.p_last_event_id,
    "cancel:sub_a:2026-09-18T11:58:00.000Z",
  );
  assertEquals(db.rpcCalls[2]!.p_paddle_subscription_id, "sub_b");
  assertEquals(db.rpcCalls[2]!.p_status, "active");
  assertEquals(db.rpcCalls[2]!.p_last_event_id, "evt_a_canceled");
  // The user is left entitled on B.
  assertEquals(db.row?.paddle_subscription_id, "sub_b");
  assertEquals(db.row?.status, "active");
  assert(
    lines.some((line) => line.includes("switched_to_untracked_subscription")),
    "expected a [BILLING_ALERT] switched_to_untracked_subscription line",
  );
});

Deno.test("paddle-webhooks: a cancellation with no other live subscription still downgrades", async () => {
  const db = new FakeDb({
    last_event_id: "evt_prev",
    last_event_occurred_at: "2026-09-18T11:00:00.000Z",
    tier: "EMBER",
    paddle_subscription_id: "sub_01",
    status: "active",
    current_period_end: "2026-10-01T00:00:00.000Z",
    cancel_at_period_end: false,
  });
  const calls: PaddleCall[] = [];
  const response = await makeHandler(db, { PADDLE_API_KEY: "pdl_test_key" }, {
    calls,
  })(
    await signedRequest(
      await subscriptionEvent({
        eventId: "evt_canceled",
        eventType: "subscription.canceled",
        status: "canceled",
        occurredAt: "2026-09-18T11:58:00.000Z",
      }),
    ),
  );

  assertEquals(response.status, 200);
  assertEquals(await response.json(), { received: true });
  assertEquals(calls.length, 1);
  assertEquals(db.rpcCalls.length, 1);
  assertEquals(db.rpcCalls[0]!.p_last_event_id, "evt_canceled");
  assertEquals(db.row?.status, "canceled");
});

Deno.test("paddle-webhooks: a failed adoption is 500, and the redelivery is stale rather than a retry", async () => {
  const db = new FakeDb({
    last_event_id: "evt_prev",
    last_event_occurred_at: "2026-09-18T11:00:00.000Z",
    tier: "EMBER",
    paddle_subscription_id: "sub_a",
    status: "active",
    current_period_end: "2026-10-01T00:00:00.000Z",
    cancel_at_period_end: false,
  });
  const liveB = () =>
    new Response(
      JSON.stringify({
        data: [
          {
            id: "sub_b",
            customer_id: "ctm_01",
            status: "active",
            updated_at: "2026-09-18T11:55:00.000Z",
            items: [{ price: { id: EMBER_PRICE }, quantity: 1 }],
            current_billing_period: {
              starts_at: "2026-09-18T00:00:00.000Z",
              ends_at: "2026-10-18T00:00:00.000Z",
            },
            scheduled_change: null,
          },
        ],
      }),
      { status: 200 },
    );
  const cancelEvent = await subscriptionEvent({
    eventId: "evt_a_canceled",
    eventType: "subscription.canceled",
    subscriptionId: "sub_a",
    status: "canceled",
    occurredAt: "2026-09-18T11:58:00.000Z",
  });

  // The adoption write fails after the cancellation has already been applied.
  db.failRpcFrom = 2;
  const { result: failed } = await captureConsoleError(async () =>
    await makeHandler(db, {
      PADDLE_API_KEY: "pdl_test_key",
      PADDLE_ENVIRONMENT: "sandbox",
    }, { listResponse: liveB })(await signedRequest(cancelEvent))
  );

  assertEquals(failed.status, 500);
  assertEquals(await failed.json(), { error: "Failed to adopt live subscription" });
  assertEquals(db.row?.status, "canceled");
  assertEquals(db.row?.last_event_id, "cancel:sub_a:2026-09-18T11:58:00.000Z");

  // Paddle redelivers. The cancellation already advanced
  // last_event_occurred_at to this event's occurred_at, so the delivery is
  // stale: the switch is NOT retried. Recovery is the adopted subscription's
  // own next event (or paddle-refresh-subscription), not this redelivery.
  db.failRpcFrom = null;
  const rpcCallsBeforeRedelivery = db.rpcCalls.length;
  const { result: redelivered } = await captureConsole(
    "warn",
    async () =>
      await makeHandler(db, {
        PADDLE_API_KEY: "pdl_test_key",
        PADDLE_ENVIRONMENT: "sandbox",
      }, { listResponse: liveB })(await signedRequest(cancelEvent)),
  );

  assertEquals(redelivered.status, 200);
  assertEquals(await redelivered.json(), { received: true, stale: true });
  assertEquals(db.rpcCalls.length, rpcCallsBeforeRedelivery);
  assertEquals(db.row?.paddle_subscription_id, "sub_a");
  assertEquals(db.row?.status, "canceled");

  // The documented recovery: sub_b's own next event is adopted, because the
  // stored row is no longer entitled.
  const recovered = await makeHandler(db)(
    await signedRequest(
      await subscriptionEvent({
        eventId: "evt_b_renewed",
        subscriptionId: "sub_b",
        status: "active",
        occurredAt: "2026-09-18T12:05:00.000Z",
      }),
    ),
  );
  assertEquals(recovered.status, 200);
  assertEquals(db.row?.paddle_subscription_id, "sub_b");
  assertEquals(db.row?.status, "active");
});
