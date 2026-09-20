import { assertEquals, assertNotEquals } from "jsr:@std/assert@1";
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { hmacSha256Hex } from "../_shared/hmac.ts";
import { createPaddleRefreshSubscriptionHandler } from "./index.ts";

const USER_ID = "00000000-0000-4000-8000-000000000001";
const NOW = new Date("2026-05-17T12:00:00Z");
const CUSTOM_DATA_SECRET = "custom-data-secret";

const ENV: Record<string, string> = {
  PADDLE_EMBER_PRICE_IDS: "pri_ember_monthly,pri_ember_annual",
  PADDLE_FLAME_PRICE_IDS: "pri_flame_monthly,pri_flame_annual",
  PADDLE_INFERNO_PRICE_IDS: "pri_inferno_monthly,pri_inferno_annual",
  PADDLE_API_KEY: "pdl_test_key",
  PADDLE_ENVIRONMENT: "sandbox",
  PADDLE_CUSTOM_DATA_SECRET: CUSTOM_DATA_SECRET,
};

interface SubscriptionRow {
  paddle_subscription_id: string | null;
  paddle_customer_id: string | null;
  tier: string | null;
  status: string | null;
  price_id: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean | null;
}

/** Portal statuses that keep a user entitled — the SQL guard's own set. */
const ENTITLEMENT_KEEPING = new Set(["active", "trialing", "past_due"]);

interface FakeDb {
  row: SubscriptionRow | null;
  /** `last_event_occurred_at` currently stored on the row. */
  clock: string | null;
  rpcCalls: Record<string, unknown>[];
  rpcError?: { code?: string; message: string } | null;
}

/**
 * Stands in for `public.apply_subscription_event`: the untracked-subscription
 * guard, then the strictly-newer ordering predicate. Only a write that passes
 * both mutates the row, so a test that expects "the row was not regressed" is
 * really asserting the RPC's contract rather than the handler's optimism.
 */
function applySubscriptionEventFake(
  db: FakeDb,
  args: Record<string, unknown>,
): boolean {
  const storedId = db.row?.paddle_subscription_id ?? null;
  const incomingId = (args.p_paddle_subscription_id as string | null) ?? null;
  const status = args.p_status as string;
  if (
    storedId && incomingId && storedId !== incomingId &&
    !ENTITLEMENT_KEEPING.has(status)
  ) {
    return false;
  }

  const occurredAt = (args.p_last_event_occurred_at as string | null) ?? null;
  if (db.clock !== null && occurredAt !== null && occurredAt <= db.clock) {
    return false;
  }

  db.row = {
    paddle_subscription_id: incomingId,
    paddle_customer_id: (args.p_paddle_customer_id as string | null) ?? null,
    tier: args.p_tier as string,
    status,
    price_id: (args.p_price_id as string | null) ?? null,
    current_period_end: (args.p_current_period_end as string | null) ?? null,
    cancel_at_period_end: Boolean(args.p_cancel_at_period_end),
  };
  db.clock = occurredAt;
  return true;
}

function fakeAdminClient(db: FakeDb) {
  const rejectDirectWrite = () => {
    throw new Error(
      "direct subscriptions write: every write must go through apply_subscription_event",
    );
  };
  const subscriptions = {
    select: () => subscriptions,
    eq: () => subscriptions,
    maybeSingle: () => Promise.resolve({ data: db.row, error: null }),
    update: rejectDirectWrite,
    upsert: rejectDirectWrite,
    insert: rejectDirectWrite,
  };
  return {
    from: () => subscriptions,
    rpc: (name: string, args: Record<string, unknown>) => {
      if (name === "check_rate_limit") {
        return Promise.resolve({
          data: { allowed: true, remaining: 9, retry_after_seconds: null },
          error: null,
        });
      }
      if (name === "apply_subscription_event") {
        db.rpcCalls.push(args);
        if (db.rpcError) {
          return Promise.resolve({ data: null, error: db.rpcError });
        }
        return Promise.resolve({
          data: applySubscriptionEventFake(db, args),
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    },
  } as unknown as SupabaseClient;
}

interface PaddleCall {
  url: string;
  method: string;
}

function paddleSubscriptionBody(
  overrides: {
    id?: string;
    status?: string;
    priceId?: string;
    updatedAt?: string;
    endsAt?: string;
  } = {},
) {
  return {
    data: {
      id: overrides.id ?? "sub_1",
      customer_id: "ctm_1",
      status: overrides.status ?? "active",
      updated_at: overrides.updatedAt ?? "2026-05-17T11:59:00Z",
      items: [{ price: { id: overrides.priceId ?? "pri_flame_monthly" }, quantity: 1 }],
      current_billing_period: {
        starts_at: "2026-05-01T00:00:00Z",
        ends_at: overrides.endsAt ?? "2026-06-01T00:00:00Z",
      },
      scheduled_change: null,
    },
  };
}

function buildHandler(
  db: FakeDb,
  options: {
    calls: PaddleCall[];
    respond?: (url: string) => Response | undefined;
  },
) {
  return createPaddleRefreshSubscriptionHandler({
    createAuthClient: () => ({
      auth: {
        getUser: () => Promise.resolve({ data: { user: { id: USER_ID } }, error: null }),
      },
    } as unknown as Pick<SupabaseClient, "auth">),
    createAdminClient: () => fakeAdminClient(db),
    fetch: (input: URL | Request | string, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      options.calls.push({ url, method: init?.method ?? "GET" });
      const response = options.respond?.(url);
      if (response) return Promise.resolve(response);
      return Promise.resolve(
        new Response(JSON.stringify(paddleSubscriptionBody()), { status: 200 }),
      );
    },
    env: { get: (key: string) => ENV[key] },
    now: () => NOW,
  });
}

function refreshRequest(body?: Record<string, unknown>) {
  return new Request("https://edge.test/paddle-refresh-subscription", {
    method: "POST",
    headers: { Authorization: "Bearer jwt" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

function storedRow(overrides: Partial<SubscriptionRow> = {}): SubscriptionRow {
  return {
    paddle_subscription_id: "sub_1",
    paddle_customer_id: "ctm_1",
    tier: "FLAME",
    status: "active",
    price_id: "pri_flame_monthly",
    current_period_end: "2026-06-01T00:00:00Z",
    cancel_at_period_end: false,
    ...overrides,
  };
}

Deno.test("paddle-refresh-subscription: a newer Paddle updated_at applies through the ordered writer", async () => {
  const db: FakeDb = {
    row: storedRow({ tier: "EMBER", price_id: "pri_ember_monthly" }),
    clock: "2026-05-01T00:00:00Z",
    rpcCalls: [],
  };
  const calls: PaddleCall[] = [];
  const handler = buildHandler(db, { calls });

  const response = await handler(refreshRequest());

  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(body.status, "refreshed");
  assertEquals(body.applied, undefined);
  assertEquals(body.subscription.tier, "FLAME");
  assertEquals(body.subscription.status, "active");

  // One write, and it went through the RPC with Paddle's own clock.
  assertEquals(db.rpcCalls.length, 1);
  assertEquals(db.rpcCalls[0].p_last_event_occurred_at, "2026-05-17T11:59:00Z");
  assertEquals(db.rpcCalls[0].p_last_event_id, "refresh:sub_1:2026-05-17T11:59:00Z");
  assertEquals(db.rpcCalls[0].p_paddle_subscription_id, "sub_1");
  assertEquals(db.row?.tier, "FLAME");
  assertEquals(db.clock, "2026-05-17T11:59:00Z");
});

Deno.test("paddle-refresh-subscription: an older Paddle updated_at does not regress the row", async () => {
  const db: FakeDb = {
    // A renewal webhook has already stored the new period, at a clock newer
    // than the subscription state this refresh is about to read.
    row: storedRow({ current_period_end: "2026-07-01T00:00:00Z" }),
    clock: "2026-06-01T00:00:10Z",
    rpcCalls: [],
  };
  const calls: PaddleCall[] = [];
  const handler = buildHandler(db, {
    calls,
    respond: () =>
      new Response(
        JSON.stringify(
          paddleSubscriptionBody({
            updatedAt: "2026-05-02T00:00:00Z",
            endsAt: "2026-06-01T00:00:00Z",
          }),
        ),
        { status: 200 },
      ),
  });

  const response = await handler(refreshRequest());

  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(body.applied, false);
  assertEquals(body.reason, "stale");
  // The row is untouched, and the client is told what the row really holds —
  // not the older state we just fetched from Paddle.
  assertEquals(db.row?.current_period_end, "2026-07-01T00:00:00Z");
  assertEquals(db.clock, "2026-06-01T00:00:10Z");
  assertEquals(body.subscription.currentPeriodEnd, "2026-07-01T00:00:00Z");
  assertEquals(body.subscription.current_period_end, "2026-07-01T00:00:00Z");
  assertNotEquals(body.subscription.currentPeriodEnd, "2026-06-01T00:00:00Z");
});

Deno.test("paddle-refresh-subscription: a Paddle 404 clears the subscription id through the ordered writer", async () => {
  const db: FakeDb = {
    row: storedRow(),
    clock: "2026-05-01T00:00:00Z",
    rpcCalls: [],
  };
  const calls: PaddleCall[] = [];
  const handler = buildHandler(db, {
    calls,
    respond: () => new Response("not found", { status: 404 }),
  });

  const response = await handler(refreshRequest());

  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(body.status, "refreshed");
  assertEquals(body.subscription.status, "canceled");
  assertEquals(body.subscription.tier, "FLAME");

  assertEquals(db.rpcCalls.length, 1);
  // The row's own stored id is NOT written back: the whole point of this path
  // is to clear it. The customer id is carried forward.
  assertEquals(db.rpcCalls[0].p_paddle_subscription_id, null);
  assertEquals(db.rpcCalls[0].p_paddle_customer_id, "ctm_1");
  assertEquals(db.rpcCalls[0].p_status, "canceled");
  assertEquals(db.rpcCalls[0].p_price_id, null);
  assertEquals(db.rpcCalls[0].p_tier, "FLAME");
  // No Paddle state to order by, so the local clock orders the write.
  assertEquals(db.rpcCalls[0].p_last_event_occurred_at, NOW.toISOString());
  assertEquals(
    db.rpcCalls[0].p_last_event_id,
    `refresh:sub_1:${NOW.toISOString()}`,
  );
  assertEquals(db.row?.paddle_subscription_id, null);
  assertEquals(db.row?.paddle_customer_id, "ctm_1");
});

Deno.test("paddle-refresh-subscription: a 404 newer event already stored keeps the row", async () => {
  const db: FakeDb = {
    row: storedRow(),
    // Clock already ahead of the handler's `now()`.
    clock: "2026-05-18T00:00:00Z",
    rpcCalls: [],
  };
  const calls: PaddleCall[] = [];
  const handler = buildHandler(db, {
    calls,
    respond: () => new Response("not found", { status: 404 }),
  });

  const response = await handler(refreshRequest());

  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(body.applied, false);
  assertEquals(body.reason, "stale");
  assertEquals(db.row?.paddle_subscription_id, "sub_1");
  assertEquals(body.subscription.status, "active");
});

Deno.test("paddle-refresh-subscription: the guard's refusal is reported, not passed off as a refresh", async () => {
  const db: FakeDb = {
    row: storedRow(),
    clock: "2026-05-01T00:00:00Z",
    rpcCalls: [],
  };
  const calls: PaddleCall[] = [];
  const cdSig = await hmacSha256Hex(CUSTOM_DATA_SECRET, USER_ID);
  const transactionId = "txn_abcdefghijklmnopqrstuvwxyz";
  const handler = buildHandler(db, {
    calls,
    respond: (url) => {
      if (url.includes("/transactions/")) {
        return new Response(
          JSON.stringify({
            data: {
              id: transactionId,
              subscription_id: "sub_2",
              custom_data: { user_id: USER_ID, cd_sig: cdSig },
            },
          }),
          { status: 200 },
        );
      }
      // The freshly bought subscription is already dead in Paddle: writing it
      // over an entitled row is exactly what the guard exists to refuse.
      return new Response(
        JSON.stringify(
          paddleSubscriptionBody({ id: "sub_2", status: "canceled" }),
        ),
        { status: 200 },
      );
    },
  });

  const response = await handler(refreshRequest({ transaction_id: transactionId }));

  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(body.applied, false);
  assertEquals(body.reason, "untracked_subscription");
  // The tracked, entitled subscription survives.
  assertEquals(db.row?.paddle_subscription_id, "sub_1");
  assertEquals(db.row?.status, "active");
  assertEquals(body.subscription.status, "active");
});

Deno.test("paddle-refresh-subscription: a duplicate binding is a 409, not an opaque 500", async () => {
  const db: FakeDb = {
    row: storedRow(),
    clock: "2026-05-01T00:00:00Z",
    rpcCalls: [],
    rpcError: {
      code: "23505",
      message:
        'duplicate key value violates unique constraint "subscriptions_paddle_subscription_id_key"',
    },
  };
  const calls: PaddleCall[] = [];
  const handler = buildHandler(db, { calls });

  const response = await handler(refreshRequest());

  assertEquals(response.status, 409);
  assertEquals((await response.json()).code, "subscription_already_bound");
});

Deno.test("paddle-refresh-subscription: no stored subscription is reported, not written", async () => {
  const db: FakeDb = {
    row: storedRow({ paddle_subscription_id: null }),
    clock: null,
    rpcCalls: [],
  };
  const calls: PaddleCall[] = [];
  const handler = buildHandler(db, { calls });

  const response = await handler(refreshRequest());

  assertEquals(response.status, 200);
  assertEquals(await response.json(), { status: "no_subscription" });
  assertEquals(calls.length, 0);
  assertEquals(db.rpcCalls.length, 0);
});
