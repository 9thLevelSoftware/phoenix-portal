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

function fakeAdminClient(
  row: { paddle_subscription_id: string | null; status: string } | null,
  updates: unknown[],
) {
  const subscriptions = {
    select: () => subscriptions,
    eq: (..._args: unknown[]) => subscriptions,
    maybeSingle: () => Promise.resolve({ data: row, error: null }),
    update: (values: unknown) => {
      updates.push(values);
      return subscriptions;
    },
    then: undefined,
  };
  // `.update(...).eq(...)` is awaited: make the final eq() thenable.
  const updateChain = {
    ...subscriptions,
    eq: () => Promise.resolve({ error: null }),
  };
  return {
    from: () => ({
      ...subscriptions,
      update: (values: unknown) => {
        updates.push(values);
        return updateChain;
      },
    }),
    rpc: (name: string) =>
      Promise.resolve(
        name === "check_rate_limit"
          ? { data: { allowed: true, remaining: 2, retry_after_seconds: null }, error: null }
          : { data: null, error: null },
      ),
  } as unknown as SupabaseClient;
}

function buildHandler(
  row: { paddle_subscription_id: string | null; status: string } | null,
  calls: PaddleCall[],
  updates: unknown[],
) {
  return createPaddleCancelSubscriptionHandler({
    createAuthClient: () => ({
      auth: {
        getUser: () => Promise.resolve({ data: { user: { id: USER_ID } }, error: null }),
      },
    } as unknown as Pick<SupabaseClient, "auth">),
    createAdminClient: () => fakeAdminClient(row, updates),
    fetch: (input: URL | Request | string, init?: RequestInit) => {
      calls.push({
        url: typeof input === "string" ? input : input.toString(),
        method: init?.method ?? "GET",
        body: typeof init?.body === "string" ? JSON.parse(init.body) : null,
      });
      return Promise.resolve(new Response(JSON.stringify({ data: {} }), { status: 200 }));
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
  const updates: unknown[] = [];
  const handler = buildHandler(
    { paddle_subscription_id: "sub_1", status: "active" },
    calls,
    updates,
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
  assertEquals(updates, [
    { cancel_at_period_end: true, updated_at: NOW.toISOString() },
  ]);
});

Deno.test("paddle-cancel-subscription: past_due cancels immediately", async () => {
  const calls: PaddleCall[] = [];
  const updates: unknown[] = [];
  const handler = buildHandler(
    { paddle_subscription_id: "sub_1", status: "past_due" },
    calls,
    updates,
  );

  const response = await handler(cancelRequest());

  assertEquals(response.status, 200);
  assertEquals(await response.json(), {
    success: true,
    cancelAtPeriodEnd: false,
    canceledImmediately: true,
  });
  assertEquals(calls[0]?.body, { effective_from: "immediately" });
  assertEquals(updates, [
    { status: "canceled", cancel_at_period_end: false, updated_at: NOW.toISOString() },
  ]);
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
    const updates: unknown[] = [];
    const handler = buildHandler(row, calls, updates);

    const response = await handler(cancelRequest());

    assertEquals(response.status, 400);
    assertEquals(await response.json(), { error: "No active subscription found" });
    assertEquals(calls.length, 0);
    assertEquals(updates.length, 0);
  }
});
