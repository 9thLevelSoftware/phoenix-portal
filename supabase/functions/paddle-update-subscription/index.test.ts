import { assertEquals } from "jsr:@std/assert@1";
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { createPaddleUpdateSubscriptionHandler } from "./index.ts";

const USER_ID = "00000000-0000-4000-8000-000000000001";
const NOW = new Date("2026-05-17T12:00:00Z");

const ENV: Record<string, string> = {
  PADDLE_EMBER_PRICE_IDS: "pri_ember_monthly,pri_ember_annual",
  PADDLE_FLAME_PRICE_IDS: "pri_flame_monthly,pri_flame_annual",
  PADDLE_INFERNO_PRICE_IDS: "pri_inferno_monthly,pri_inferno_annual",
  PADDLE_EMBER_MONTHLY_PRICE_ID: "pri_ember_monthly",
  PADDLE_FLAME_MONTHLY_PRICE_ID: "pri_flame_monthly",
  PADDLE_API_KEY: "pdl_test_key",
  PADDLE_ENVIRONMENT: "sandbox",
};

interface SubscriptionRow {
  paddle_subscription_id: string | null;
  price_id: string | null;
  tier: string;
  status: string;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
}

interface PaddleCall {
  url: string;
  method: string;
  body: Record<string, unknown> | null;
}

function fakeAdminClient(row: SubscriptionRow | null, upserts: unknown[]) {
  const subscriptions = {
    select: () => subscriptions,
    eq: () => subscriptions,
    maybeSingle: () => Promise.resolve({ data: row, error: null }),
    upsert: (values: unknown) => {
      upserts.push(values);
      return Promise.resolve({ error: null });
    },
  };
  return {
    from: () => subscriptions,
    rpc: (name: string) =>
      Promise.resolve(
        name === "check_rate_limit"
          ? { data: { allowed: true, remaining: 2, retry_after_seconds: null }, error: null }
          : { data: null, error: null },
      ),
  } as unknown as SupabaseClient;
}

function paddleSubscriptionBody(priceId: string, cancelScheduled = false) {
  return {
    data: {
      id: "sub_1",
      customer_id: "ctm_1",
      status: "active",
      items: [{ price: { id: priceId }, quantity: 1 }],
      current_billing_period: {
        starts_at: "2026-05-01T00:00:00Z",
        ends_at: "2026-06-01T00:00:00Z",
      },
      scheduled_change: cancelScheduled
        ? { action: "cancel", effective_at: "2026-06-01T00:00:00Z" }
        : null,
    },
  };
}

function buildHandler(
  row: SubscriptionRow | null,
  options: {
    calls: PaddleCall[];
    upserts: unknown[];
    getResponse?: () => Response;
    patchResponse?: () => Response;
  },
) {
  return createPaddleUpdateSubscriptionHandler({
    createAuthClient: () => ({
      auth: {
        getUser: () => Promise.resolve({ data: { user: { id: USER_ID } }, error: null }),
      },
    } as unknown as Pick<SupabaseClient, "auth">),
    createAdminClient: () => fakeAdminClient(row, options.upserts),
    fetch: (input: URL | Request | string, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      options.calls.push({
        url,
        method,
        body: typeof init?.body === "string" ? JSON.parse(init.body) : null,
      });
      if (method === "GET") {
        return Promise.resolve(
          options.getResponse?.() ??
            new Response(JSON.stringify(paddleSubscriptionBody(row?.price_id ?? "")), {
              status: 200,
            }),
        );
      }
      return Promise.resolve(
        options.patchResponse?.() ??
          new Response(JSON.stringify(paddleSubscriptionBody("pri_ember_monthly")), {
            status: 200,
          }),
      );
    },
    env: { get: (key: string) => ENV[key] },
    now: () => NOW,
  });
}

function planChangeRequest(
  body: Record<string, unknown> = { tier: "EMBER", billing_interval: "monthly" },
) {
  return new Request("https://edge.test/paddle-update-subscription", {
    method: "POST",
    headers: { Authorization: "Bearer jwt", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const activeRow: SubscriptionRow = {
  paddle_subscription_id: "sub_1",
  price_id: "pri_flame_monthly",
  tier: "FLAME",
  status: "active",
  current_period_end: "2026-06-01T00:00:00Z",
  cancel_at_period_end: false,
};

Deno.test("paddle-update-subscription: past_due is refused with 409 payment_past_due and never calls Paddle", async () => {
  const calls: PaddleCall[] = [];
  const upserts: unknown[] = [];
  const handler = buildHandler(
    {
      ...activeRow,
      status: "past_due",
      // 10 days past the period end: still entitled, still cannot change plan.
      current_period_end: "2026-05-07T12:00:00Z",
    },
    { calls, upserts },
  );

  const response = await handler(planChangeRequest());

  assertEquals(response.status, 409);
  assertEquals(await response.json(), {
    error: "payment_past_due",
    code: "payment_past_due",
    message:
      "Your last payment failed. Update your payment method before changing your plan.",
  });
  assertEquals(calls.length, 0);
  assertEquals(upserts.length, 0);
});

Deno.test("paddle-update-subscription: active plan switch PATCHes with on_payment_failure prevent_change", async () => {
  const calls: PaddleCall[] = [];
  const upserts: unknown[] = [];
  const handler = buildHandler(activeRow, { calls, upserts });

  const response = await handler(planChangeRequest());
  const body = await response.json();

  assertEquals(response.status, 200);
  assertEquals(body.success, true);
  assertEquals(body.action, "switch");

  const patch = calls.find((call) => call.method === "PATCH");
  assertEquals(patch?.url, "https://sandbox-api.paddle.com/subscriptions/sub_1");
  assertEquals(patch?.body?.on_payment_failure, "prevent_change");
  assertEquals(patch?.body?.proration_billing_mode, "prorated_immediately");
  assertEquals(patch?.body?.items, [{ price_id: "pri_ember_monthly", quantity: 1 }]);
  assertEquals(upserts.length, 1);
});

Deno.test("paddle-update-subscription: a scheduled cancellation clears scheduled_change on the same PATCH", async () => {
  const calls: PaddleCall[] = [];
  const upserts: unknown[] = [];
  const handler = buildHandler(
    { ...activeRow, cancel_at_period_end: true },
    { calls, upserts },
  );

  const response = await handler(planChangeRequest());
  assertEquals(response.status, 200);

  const patch = calls.find((call) => call.method === "PATCH");
  assertEquals(patch?.body?.scheduled_change, null);
  assertEquals(patch?.body?.on_payment_failure, "prevent_change");
});

Deno.test("paddle-update-subscription: uncancel keeps the plan and prevents an unpaid change", async () => {
  const calls: PaddleCall[] = [];
  const upserts: unknown[] = [];
  const handler = buildHandler(
    {
      ...activeRow,
      price_id: "pri_ember_monthly",
      tier: "EMBER",
      cancel_at_period_end: true,
    },
    {
      calls,
      upserts,
      getResponse: () =>
        new Response(JSON.stringify(paddleSubscriptionBody("pri_ember_monthly", true)), {
          status: 200,
        }),
    },
  );

  const response = await handler(planChangeRequest());
  const body = await response.json();

  assertEquals(response.status, 200);
  assertEquals(body.action, "uncancel");
  const patch = calls.find((call) => call.method === "PATCH");
  assertEquals(patch?.body, {
    scheduled_change: null,
    on_payment_failure: "prevent_change",
  });
});

Deno.test("paddle-update-subscription: a canceled or expired row gets the checkout-required path", async () => {
  for (
    const row of [
      { ...activeRow, status: "canceled" },
      // active, but past the 48h renewal grace.
      { ...activeRow, current_period_end: "2026-05-01T00:00:00Z" },
      // active, scheduled to cancel, period ended: no grace.
      {
        ...activeRow,
        cancel_at_period_end: true,
        current_period_end: "2026-05-17T11:59:59Z",
      },
    ]
  ) {
    const calls: PaddleCall[] = [];
    const upserts: unknown[] = [];
    const handler = buildHandler(row, { calls, upserts });

    const response = await handler(planChangeRequest());
    const body = await response.json();

    assertEquals(response.status, 200);
    assertEquals(body.code, "checkout_required");
    assertEquals(body.reason, "inactive_or_expired_subscription");
    assertEquals(calls.length, 0);
    assertEquals(upserts.length, 0);
  }
});

Deno.test("paddle-update-subscription: a missing row or missing Paddle id gets checkout_required", async () => {
  for (const row of [null, { ...activeRow, paddle_subscription_id: null }]) {
    const calls: PaddleCall[] = [];
    const upserts: unknown[] = [];
    const handler = buildHandler(row, { calls, upserts });

    const response = await handler(planChangeRequest());
    const body = await response.json();

    assertEquals(response.status, 200);
    assertEquals(body.code, "checkout_required");
    assertEquals(body.reason, "missing_subscription");
    assertEquals(calls.length, 0);
  }
});
