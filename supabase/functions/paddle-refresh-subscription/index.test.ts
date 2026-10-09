import { assertEquals, assertNotEquals } from "jsr:@std/assert@1";
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { hmacSha256Hex } from "../_shared/hmac.ts";
import { type CheckoutBinding, signCheckoutBinding } from "../_shared/paddleCheckoutBinding.ts";
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
  boundSubscriptions?: string[];
  issued?: CheckoutBinding & { state: string; created_at: string };
  bindingCalls?: Record<string, unknown>[];
  bindingError?: { code: string; message: string };
  ledgerExpiresAt?: string;
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
    from: (table: string) => {
      if (table !== "paddle_checkout_authorizations") return subscriptions;
      const filters: Record<string, unknown> = {};
      const ledger = {
        select: () => ledger,
        eq: (key: string, value: unknown) => { filters[key] = value; return ledger; },
        maybeSingle: () => Promise.resolve({ data: db.issued && filters.user_id === USER_ID &&
          filters.nonce === db.issued.cd_nonce && filters.transaction_id === db.issued.cd_transaction_id
          ? { state: db.issued.state, price_id: db.issued.cd_price_id, environment: db.issued.cd_environment, expires_at: db.ledgerExpiresAt ?? db.issued.cd_expires_at } : null,
          error: null }),
      };
      return ledger;
    },
    rpc: (name: string, args: Record<string, unknown>) => {
      if (name === "check_rate_limit") {
        return Promise.resolve({
          data: { allowed: true, remaining: 9, retry_after_seconds: null },
          error: null,
        });
      }
      if (name === "is_paddle_subscription_bound") {
        return Promise.resolve({ data: db.boundSubscriptions?.includes(args.p_subscription_id as string) ?? false, error: null });
      }
      if (name === "bind_paddle_checkout") {
        (db.bindingCalls ??= []).push(args);
        if (db.bindingError) return Promise.resolve({ data: null, error: db.bindingError });
        const issued = db.issued;
        const valid = !!issued && ["ready", "closing"].includes(issued.state) && args.p_user_id === USER_ID &&
          args.p_nonce === issued.cd_nonce && args.p_transaction_id === issued.cd_transaction_id &&
          args.p_price_id === issued.cd_price_id && args.p_environment === issued.cd_environment &&
          Date.parse(args.p_completed_at as string) >= Date.parse(issued.created_at) &&
          Date.parse(args.p_completed_at as string) <= Date.parse(issued.cd_expires_at);
        if (valid) (db.boundSubscriptions ??= []).push(args.p_subscription_id as string);
        return Promise.resolve({ data: valid, error: null });
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
    boundSubscriptions: ["sub_2"],
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
              customer_id: "ctm_1",
              status: "completed",
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

const TRANSACTION_ID = "txn_abcdefghijklmnopqrstuvwxyz";

async function checkoutProof(overrides: Partial<Omit<CheckoutBinding, "cd_sig">> = {}) {
  return await signCheckoutBinding({ user_id: USER_ID, cd_version: 2, cd_nonce: crypto.randomUUID(),
    cd_transaction_id: TRANSACTION_ID, cd_price_id: "pri_flame_monthly", cd_environment: "sandbox",
    cd_expires_at: "2026-05-17T12:30:00Z", ...overrides }, CUSTOM_DATA_SECRET);
}

function checkoutResponder(customData: Record<string, unknown>, overrides: Record<string, unknown> = {}) {
  return (url: string) => url.includes("/transactions/") ? new Response(JSON.stringify({ data: {
    id: TRANSACTION_ID, subscription_id: "sub_1", customer_id: "ctm_1", status: "completed",
    billed_at: "2026-05-17T11:59:00Z", custom_data: customData,
    items: [{ price: { id: "pri_flame_monthly" }, quantity: 1 }], ...overrides,
  } })) : new Response(JSON.stringify(paddleSubscriptionBody()));
}

Deno.test("paddle-refresh-subscription: fresh issued v2 checkout binds before the ordered refresh", async () => {
  const proof = await checkoutProof();
  const db: FakeDb = { row: null, clock: null, rpcCalls: [],
    issued: { ...proof, state: "ready", created_at: "2026-05-17T11:00:00Z" } };
  const response = await buildHandler(db, { calls: [], respond: checkoutResponder({ ...proof }) })(
    refreshRequest({ transaction_id: TRANSACTION_ID }),
  );
  assertEquals(response.status, 200);
  assertEquals((await response.json()).subscription.tier, "FLAME");
  assertEquals(db.bindingCalls?.length, 1);
  assertEquals(db.bindingCalls?.[0].p_transaction_id, TRANSACTION_ID);
  assertEquals(db.boundSubscriptions, ["sub_1"]);
  assertEquals(db.rpcCalls.length, 1);
  assertEquals(db.rpcCalls[0].p_last_event_occurred_at, "2026-05-17T11:59:00Z");
});

Deno.test("paddle-refresh-subscription: an established v2 checkout remains refreshable after expiry", async () => {
  const proof = await checkoutProof({ cd_expires_at: "2026-05-01T12:30:00Z" });
  const db: FakeDb = { row: storedRow(), clock: null, rpcCalls: [], boundSubscriptions: ["sub_1"] };
  const response = await buildHandler(db, { calls: [], respond: checkoutResponder({ ...proof }) })(
    refreshRequest({ transaction_id: TRANSACTION_ID }),
  );
  assertEquals(response.status, 200);
  assertEquals(db.bindingCalls, undefined);
  assertEquals(db.rpcCalls.length, 1);
});

Deno.test("paddle-refresh-subscription: expired replay, unissued checkout and wrong v2 context cannot adopt", async () => {
  for (const scenario of ["expired", "unissued", "price", "environment", "transaction", "customer", "subscription"]) {
    const proof = await checkoutProof({
      ...(scenario === "expired" ? { cd_expires_at: "2026-05-17T11:50:00Z" } : {}),
      ...(scenario === "price" ? { cd_price_id: "pri_ember_monthly" } : {}),
      ...(scenario === "environment" ? { cd_environment: "production" } : {}),
      ...(scenario === "transaction" ? { cd_transaction_id: "txn_zyxwvutsrqponmlkjihgfedcba" } : {}),
    });
    const db: FakeDb = { row: null, clock: null, rpcCalls: [],
      ...(scenario === "unissued" ? {} : { issued: { ...proof, state: "ready", created_at: "2026-05-17T11:00:00Z" } }) };
    const respond = checkoutResponder({ ...proof }, scenario === "customer" ? { customer_id: "ctm_foreign" } : {});
    const response = await buildHandler(db, { calls: [], respond: (url) => scenario === "subscription" && !url.includes("/transactions/")
      ? new Response(JSON.stringify(paddleSubscriptionBody({ id: "sub_foreign" }))) : respond(url) })(
      refreshRequest({ transaction_id: TRANSACTION_ID }),
    );
    assertEquals(response.status, scenario === "subscription" ? 502 : 403, scenario);
    assertEquals(db.row, null, scenario);
    assertEquals(db.rpcCalls.length, 0, scenario);
  }
});

Deno.test("paddle-refresh-subscription: legacy signature refreshes only tracked or established subscriptions", async () => {
  const proof = { user_id: USER_ID, cd_sig: await hmacSha256Hex(CUSTOM_DATA_SECRET, USER_ID) };
  for (const scenario of ["tracked", "established", "untrusted"]) {
    const db: FakeDb = { row: scenario === "tracked" ? storedRow() : null, clock: null, rpcCalls: [],
      ...(scenario === "established" ? { boundSubscriptions: ["sub_1"] } : {}) };
    const response = await buildHandler(db, { calls: [], respond: checkoutResponder(proof) })(
      refreshRequest({ transaction_id: TRANSACTION_ID }),
    );
    assertEquals(response.status, scenario === "untrusted" ? 403 : 200, scenario);
    assertEquals(db.rpcCalls.length, scenario === "untrusted" ? 0 : 1, scenario);
    assertEquals(db.bindingCalls, undefined, scenario);
  }
});

Deno.test("paddle-refresh-subscription: issued v2 transaction stays pending without adopting incomplete provider state", async () => {
  const proof = await checkoutProof();
  for (const subscriptionId of [null, "sub_1"]) {
    const db: FakeDb = { row: null, clock: null, rpcCalls: [],
      issued: { ...proof, state: "ready", created_at: "2026-05-17T11:00:00Z" } };
    const calls: PaddleCall[] = [];
    const response = await buildHandler(db, { calls, respond: checkoutResponder({ ...proof }, { status: "ready", subscription_id: subscriptionId }) })(
      refreshRequest({ transaction_id: TRANSACTION_ID }),
    );
    assertEquals(response.status, 200);
    assertEquals(await response.json(), { status: "no_subscription", reason: "transaction_pending" });
    assertEquals(calls.length, 1);
    assertEquals(db.rpcCalls.length, 0);
    assertEquals(db.bindingCalls, undefined);
  }
});

Deno.test("paddle-refresh-subscription: original transaction after a legitimate plan change refreshes only an established subscription", async () => {
  const proof = await checkoutProof();
  const transaction = checkoutResponder({ ...proof });
  for (const established of [true, false]) {
    const db: FakeDb = { row: established ? storedRow({ price_id: "pri_ember_monthly", tier: "EMBER" }) : null,
      clock: null, rpcCalls: [], issued: { ...proof, state: "ready", created_at: "2026-05-17T11:00:00Z" },
      ...(established ? { boundSubscriptions: ["sub_1"] } : {}) };
    const response = await buildHandler(db, { calls: [], respond: (url) => url.includes("/transactions/") ? transaction(url)
      : new Response(JSON.stringify(paddleSubscriptionBody({ priceId: "pri_ember_monthly" }))) })(
      refreshRequest({ transaction_id: TRANSACTION_ID }),
    );
    assertEquals(response.status, established ? 200 : 403);
    assertEquals(db.rpcCalls.length, established ? 1 : 0);
    if (established) assertEquals((await response.json()).subscription.tier, "EMBER");
  }
});

Deno.test("paddle-refresh-subscription: pending uses normalized finite expiry instants", async () => {
  const proof = await checkoutProof();
  for (const expiry of ["2026-05-17T12:30:00+00:00", "not-a-timestamp", "2026-05-17T12:31:00Z"]) {
    const db: FakeDb = { row: null, clock: null, rpcCalls: [], ledgerExpiresAt: expiry,
      issued: { ...proof, state: "ready", created_at: "2026-05-17T11:00:00Z" } };
    const response = await buildHandler(db, { calls: [], respond: checkoutResponder({ ...proof }, { status: "ready", subscription_id: null }) })(
      refreshRequest({ transaction_id: TRANSACTION_ID }),
    );
    assertEquals(response.status, expiry.endsWith("+00:00") ? 200 : 403, expiry);
    assertEquals(db.rpcCalls.length, 0);
  }
});

Deno.test("paddle-refresh-subscription: a v2 signature alone cannot report an unissued pending transaction", async () => {
  const proof = await checkoutProof();
  const db: FakeDb = { row: null, clock: null, rpcCalls: [] };
  const response = await buildHandler(db, { calls: [], respond: checkoutResponder({ ...proof }, { subscription_id: null, status: "ready" }) })(
    refreshRequest({ transaction_id: TRANSACTION_ID }),
  );
  assertEquals(response.status, 403);
  assertEquals(db.rpcCalls.length, 0);
});

Deno.test("paddle-refresh-subscription: checkout binding uniqueness conflict keeps its actionable 409", async () => {
  const proof = await checkoutProof();
  const db: FakeDb = { row: null, clock: null, rpcCalls: [], bindingError: { code: "23505", message: "subscription already bound" } };
  const response = await buildHandler(db, { calls: [], respond: checkoutResponder({ ...proof }) })(
    refreshRequest({ transaction_id: TRANSACTION_ID }),
  );
  assertEquals(response.status, 409);
  assertEquals((await response.json()).code, "subscription_already_bound");
  assertEquals(db.rpcCalls.length, 0);
});

Deno.test("paddle-refresh-subscription: missing requested sibling cannot clear a tracked subscription", async () => {
  const proof = await checkoutProof();
  const db: FakeDb = { row: storedRow({ paddle_subscription_id: "sub_existing" }), clock: null, rpcCalls: [] };
  const transaction = checkoutResponder({ ...proof });
  const response = await buildHandler(db, { calls: [], respond: (url) => url.includes("/transactions/")
    ? transaction(url) : new Response("not found", { status: 404 }) })(refreshRequest({ transaction_id: TRANSACTION_ID }));
  assertEquals(response.status, 502);
  assertEquals(db.row?.paddle_subscription_id, "sub_existing");
  assertEquals(db.rpcCalls.length, 0);
});
