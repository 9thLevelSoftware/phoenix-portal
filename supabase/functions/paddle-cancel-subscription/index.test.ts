import { assertEquals } from "jsr:@std/assert@1";
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { createPaddleCancelSubscriptionHandler } from "./index.ts";

const USER_ID = "00000000-0000-4000-8000-000000000001";
const NOW = new Date("2026-05-17T12:00:00Z");

const ENV: Record<string, string> = {
  PADDLE_API_KEY: "pdl_test_key",
  PADDLE_ENVIRONMENT: "sandbox",
};

interface PaddleCall {
  url: string;
  method: string;
  body: Record<string, unknown> | null;
}

interface SubscriptionRow {
  paddle_subscription_id: string | null;
  status: string;
  tier?: string | null;
  price_id?: string | null;
  current_period_end?: string | null;
  cancel_at_period_end?: boolean | null;
}

interface FakeDb {
  row: SubscriptionRow | null;
  /** `last_event_occurred_at` currently stored on the row. */
  clock: string | null;
  rpcCalls: Record<string, unknown>[];
}

/** The ordering half of `public.apply_subscription_event`. */
function applySubscriptionEventFake(
  db: FakeDb,
  args: Record<string, unknown>,
): boolean {
  const occurredAt = (args.p_last_event_occurred_at as string | null) ?? null;
  if (db.clock !== null && occurredAt !== null && occurredAt <= db.clock) {
    return false;
  }
  if (db.row) {
    db.row = {
      ...db.row,
      paddle_subscription_id:
        (args.p_paddle_subscription_id as string | null) ?? null,
      status: args.p_status as string,
      tier: args.p_tier as string,
      price_id: (args.p_price_id as string | null) ?? null,
      current_period_end: (args.p_current_period_end as string | null) ?? null,
      cancel_at_period_end: Boolean(args.p_cancel_at_period_end),
    };
  }
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
          data: { allowed: true, remaining: 2, retry_after_seconds: null },
          error: null,
        });
      }
      if (name === "apply_subscription_event") {
        db.rpcCalls.push(args);
        return Promise.resolve({
          data: applySubscriptionEventFake(db, args),
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    },
  } as unknown as SupabaseClient;
}

/** Paddle's response to POST /subscriptions/{id}/cancel. */
function canceledSubscriptionBody(
  overrides: {
    id?: string;
    status?: string;
    updatedAt?: string;
    scheduledCancel?: boolean;
  } = {},
) {
  return {
    data: {
      id: overrides.id ?? "sub_1",
      customer_id: "ctm_1",
      status: overrides.status ?? "canceled",
      updated_at: overrides.updatedAt ?? "2026-05-17T11:59:00Z",
      items: [{ price: { id: "pri_flame_monthly" }, quantity: 1 }],
      current_billing_period: {
        starts_at: "2026-05-01T00:00:00Z",
        ends_at: "2026-06-01T00:00:00Z",
      },
      scheduled_change: overrides.scheduledCancel
        ? { action: "cancel", effective_at: "2026-06-01T00:00:00Z" }
        : null,
    },
  };
}

function buildHandler(
  db: FakeDb,
  calls: PaddleCall[],
  cancelResponse?: () => Response,
) {
  return createPaddleCancelSubscriptionHandler({
    createAuthClient: () => ({
      auth: {
        getUser: () => Promise.resolve({ data: { user: { id: USER_ID } }, error: null }),
      },
    } as unknown as Pick<SupabaseClient, "auth">),
    createAdminClient: () => fakeAdminClient(db),
    fetch: (input: URL | Request | string, init?: RequestInit) => {
      calls.push({
        url: typeof input === "string" ? input : input.toString(),
        method: init?.method ?? "GET",
        body: typeof init?.body === "string" ? JSON.parse(init.body) : null,
      });
      return Promise.resolve(
        cancelResponse?.() ??
          new Response(JSON.stringify(canceledSubscriptionBody()), { status: 200 }),
      );
    },
    env: { get: (key: string) => ENV[key] },
    now: () => NOW,
  });
}

function cancelRequest() {
  return new Request("https://edge.test/paddle-cancel-subscription", {
    method: "POST",
    headers: { Authorization: "Bearer jwt" },
  });
}

Deno.test("paddle-cancel-subscription: active cancels at the end of the billing period", async () => {
  const calls: PaddleCall[] = [];
  const db: FakeDb = {
    row: {
      paddle_subscription_id: "sub_1",
      status: "active",
      tier: "FLAME",
      price_id: "pri_flame_monthly",
      current_period_end: "2026-06-01T00:00:00Z",
      cancel_at_period_end: false,
    },
    clock: "2026-05-01T00:00:00Z",
    rpcCalls: [],
  };
  const handler = buildHandler(
    db,
    calls,
    () =>
      new Response(
        JSON.stringify(
          canceledSubscriptionBody({ status: "active", scheduledCancel: true }),
        ),
        { status: 200 },
      ),
  );

  const response = await handler(cancelRequest());

  assertEquals(response.status, 200);
  assertEquals(await response.json(), {
    success: true,
    cancelAtPeriodEnd: true,
    canceledImmediately: false,
  });
  assertEquals(calls[0]?.url, "https://sandbox-api.paddle.com/subscriptions/sub_1/cancel");
  assertEquals(calls[0]?.body, { effective_from: "next_billing_period" });

  // The local write goes through the ordered writer, carries Paddle's own
  // clock, and keeps the plan the row already had.
  assertEquals(db.rpcCalls.length, 1);
  assertEquals(db.rpcCalls[0].p_cancel_at_period_end, true);
  assertEquals(db.rpcCalls[0].p_status, "active");
  assertEquals(db.rpcCalls[0].p_tier, "FLAME");
  assertEquals(db.rpcCalls[0].p_price_id, "pri_flame_monthly");
  assertEquals(db.rpcCalls[0].p_last_event_occurred_at, "2026-05-17T11:59:00Z");
  assertEquals(db.rpcCalls[0].p_last_event_id, "cancel:sub_1:2026-05-17T11:59:00Z");
  assertEquals(db.row?.cancel_at_period_end, true);
});

Deno.test("paddle-cancel-subscription: past_due cancels immediately", async () => {
  const calls: PaddleCall[] = [];
  const db: FakeDb = {
    row: {
      paddle_subscription_id: "sub_1",
      status: "past_due",
      tier: "FLAME",
      price_id: "pri_flame_monthly",
      current_period_end: "2026-06-01T00:00:00Z",
      cancel_at_period_end: false,
    },
    clock: "2026-05-01T00:00:00Z",
    rpcCalls: [],
  };
  const handler = buildHandler(db, calls);

  const response = await handler(cancelRequest());

  assertEquals(response.status, 200);
  assertEquals(await response.json(), {
    success: true,
    cancelAtPeriodEnd: false,
    canceledImmediately: true,
  });
  assertEquals(calls[0]?.body, { effective_from: "immediately" });
  assertEquals(db.rpcCalls.length, 1);
  assertEquals(db.rpcCalls[0].p_status, "canceled");
  assertEquals(db.rpcCalls[0].p_cancel_at_period_end, false);
  assertEquals(db.rpcCalls[0].p_current_period_end, null);
  assertEquals(db.row?.status, "canceled");
});

Deno.test("paddle-cancel-subscription: a newer stored event is not regressed by the cancel write", async () => {
  const calls: PaddleCall[] = [];
  const db: FakeDb = {
    row: {
      paddle_subscription_id: "sub_1",
      status: "active",
      tier: "FLAME",
      price_id: "pri_flame_monthly",
      // A renewal webhook landed after Paddle stamped the cancel response.
      current_period_end: "2026-07-01T00:00:00Z",
      cancel_at_period_end: false,
    },
    clock: "2026-06-01T00:00:10Z",
    rpcCalls: [],
  };
  const handler = buildHandler(
    db,
    calls,
    () =>
      new Response(
        JSON.stringify(
          canceledSubscriptionBody({
            status: "active",
            scheduledCancel: true,
            updatedAt: "2026-05-02T00:00:00Z",
          }),
        ),
        { status: 200 },
      ),
  );

  const response = await handler(cancelRequest());

  // Paddle accepted the cancellation, so the call still succeeds…
  assertEquals(response.status, 200);
  assertEquals((await response.json()).success, true);
  // …but the older state never touches the row.
  assertEquals(db.rpcCalls.length, 1);
  assertEquals(db.row?.current_period_end, "2026-07-01T00:00:00Z");
  assertEquals(db.row?.cancel_at_period_end, false);
  assertEquals(db.clock, "2026-06-01T00:00:10Z");
});

Deno.test("paddle-cancel-subscription: a cancel response for another subscription is not stored", async () => {
  const calls: PaddleCall[] = [];
  const db: FakeDb = {
    row: {
      paddle_subscription_id: "sub_1",
      status: "active",
      tier: "FLAME",
      price_id: "pri_flame_monthly",
      current_period_end: "2026-06-01T00:00:00Z",
      cancel_at_period_end: false,
    },
    clock: "2026-05-01T00:00:00Z",
    rpcCalls: [],
  };
  const handler = buildHandler(
    db,
    calls,
    () =>
      new Response(JSON.stringify(canceledSubscriptionBody({ id: "sub_other" })), {
        status: 200,
      }),
  );

  const response = await handler(cancelRequest());

  assertEquals(response.status, 200);
  assertEquals((await response.json()).success, true);
  assertEquals(db.rpcCalls.length, 0);
  assertEquals(db.row?.cancel_at_period_end, false);
});

Deno.test("paddle-cancel-subscription: nothing to cancel for canceled or missing rows", async () => {
  for (
    const row of [
      { paddle_subscription_id: "sub_1", status: "canceled" },
      { paddle_subscription_id: null, status: "active" },
      null,
    ]
  ) {
    const calls: PaddleCall[] = [];
    const db: FakeDb = { row, clock: null, rpcCalls: [] };
    const handler = buildHandler(db, calls);

    const response = await handler(cancelRequest());

    assertEquals(response.status, 400);
    assertEquals(await response.json(), { error: "No active subscription found" });
    assertEquals(calls.length, 0);
    assertEquals(db.rpcCalls.length, 0);
  }
});
