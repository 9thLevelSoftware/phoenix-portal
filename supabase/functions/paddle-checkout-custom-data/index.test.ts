import { assertEquals, assertNotEquals } from "jsr:@std/assert@1";
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { billingAction } from "../_shared/billingAction.ts";
import { verifyCheckoutBinding } from "../_shared/paddleCheckoutBinding.ts";
import { createPaddleUpdateSubscriptionHandler } from "../paddle-update-subscription/index.ts";
import { createPaddleCheckoutCustomDataHandler } from "./index.ts";

const USER_ID = "00000000-0000-4000-8000-000000000001";
const SECRET = "cdsec_test_only";
const NOW = new Date("2026-05-17T12:00:00Z");

interface SubscriptionRow {
  paddle_subscription_id: string | null;
  tier: string;
  status: string;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
}

function buildHandler(
  row: SubscriptionRow | null,
  options: { selectError?: unknown; user?: { id: string } | null; reservation?: Record<string, unknown>; calls?: string[]; rpc?: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>; fetch?: typeof fetch } = {},
) {
  const user = options.user === undefined ? { id: USER_ID } : options.user;
  return createPaddleCheckoutCustomDataHandler({
    createAuthClient: () =>
      ({
        auth: {
          getUser: () => Promise.resolve({ data: { user }, error: null }),
        },
      }) as unknown as Pick<SupabaseClient, "auth">,
    createAdminClient: () => {
      const query = {
        select: () => query,
        eq: () => query,
        maybeSingle: () =>
          Promise.resolve(
            options.selectError
              ? { data: null, error: options.selectError }
              : { data: row, error: null },
          ),
      };
      return { from: () => query, rpc: options.rpc ?? ((name: string, args: Record<string, unknown>) => Promise.resolve({ data: name === "reserve_paddle_checkout"
        ? options.reservation ?? { action: "create", nonce: args.p_nonce, expires_at: args.p_expires_at } : true, error: null })) } as unknown as SupabaseClient;
    },
    env: { get: (key: string) => ({ PADDLE_CUSTOM_DATA_SECRET: SECRET, PADDLE_API_KEY: "test", PADDLE_EMBER_PRICE_IDS: "pri_ember_monthly" } as Record<string, string>)[key] },
    now: () => NOW,
    fetch: options.fetch ?? ((input, init) => { options.calls?.push(`${init?.method} ${String(input)}`); return Promise.resolve(new Response(JSON.stringify({ data: String(input).includes("/subscriptions/")
      ? { id: row?.paddle_subscription_id, status: "canceled" } : { id: "txn_checkout" } }))); }),
  });
}

function signRequest() {
  return new Request("https://edge.test/paddle-checkout-custom-data", {
    method: "POST",
    headers: { Authorization: "Bearer jwt" },
    body: JSON.stringify({ price_id: "pri_ember_monthly" }),
  });
}

/**
 * The real paddle-update-subscription handler over the same stored row, so
 * the "exactly one route" invariant is checked between two handlers rather
 * than against the predicate they are both built from.
 */
function buildUpdateHandler(row: SubscriptionRow | null) {
  const UPDATE_ENV: Record<string, string> = {
    PADDLE_EMBER_PRICE_IDS: "pri_ember_monthly",
    PADDLE_FLAME_PRICE_IDS: "pri_flame_monthly",
    PADDLE_INFERNO_PRICE_IDS: "pri_inferno_monthly",
    PADDLE_EMBER_MONTHLY_PRICE_ID: "pri_ember_monthly",
    PADDLE_API_KEY: "pdl_test_key",
    PADDLE_ENVIRONMENT: "sandbox",
  };
  const subscriptions = {
    select: () => subscriptions,
    eq: () => subscriptions,
    maybeSingle: () =>
      Promise.resolve({
        data: row === null ? null : { ...row, price_id: "pri_flame_monthly" },
        error: null,
      }),
    upsert: () => Promise.resolve({ error: null }),
  };
  return createPaddleUpdateSubscriptionHandler({
    createAuthClient: () =>
      ({
        auth: {
          getUser: () => Promise.resolve({ data: { user: { id: USER_ID } }, error: null }),
        },
      }) as unknown as Pick<SupabaseClient, "auth">,
    createAdminClient: () =>
      ({
        from: () => subscriptions,
        rpc: (name: string) =>
          Promise.resolve(
            name === "check_rate_limit"
              ? {
                data: { allowed: true, remaining: 2, retry_after_seconds: null },
                error: null,
              }
              : { data: null, error: null },
          ),
      }) as unknown as SupabaseClient,
    // Any Paddle call this path makes (the update-payment transaction) is
    // irrelevant to the invariant; answer it plausibly.
    fetch: () =>
      Promise.resolve(
        new Response(JSON.stringify({ data: { id: "txn_x" } }), { status: 200 }),
      ),
    env: { get: (key: string) => UPDATE_ENV[key] },
    now: () => NOW,
  });
}

function updateRequest() {
  return new Request("https://edge.test/paddle-update-subscription", {
    method: "POST",
    headers: { Authorization: "Bearer jwt", "Content-Type": "application/json" },
    body: JSON.stringify({ tier: "EMBER", billing_interval: "monthly" }),
  });
}

const liveRow: SubscriptionRow = {
  paddle_subscription_id: "sub_1",
  tier: "FLAME",
  status: "active",
  current_period_end: "2026-06-01T00:00:00Z",
  cancel_at_period_end: false,
};

Deno.test("paddle-checkout-custom-data: signs for a user with no subscription", async () => {
  const response = await buildHandler(null)(signRequest());

  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(body.custom_data.user_id, USER_ID);
  assertEquals(await verifyCheckoutBinding(body.custom_data, SECRET), true);
  assertEquals(body.custom_data.cd_transaction_id, "txn_checkout");
  assertEquals(body.transaction_id, "txn_checkout");
});

Deno.test("paddle-checkout-custom-data: signs after a cancellation", async () => {
  const response = await buildHandler({ ...liveRow, status: "canceled" })(
    signRequest(),
  );

  assertEquals(response.status, 200);
  assertNotEquals((await response.json()).custom_data.cd_sig, undefined);
});

Deno.test("paddle-checkout-custom-data: refuses a past_due user with 409 existing_subscription", async () => {
  const response = await buildHandler({
    ...liveRow,
    status: "past_due",
    // 10 days past the period end: still entitled, still paying.
    current_period_end: "2026-05-07T12:00:00Z",
  })(signRequest());

  assertEquals(response.status, 409);
  const body = await response.json();
  assertEquals(body.code, "existing_subscription");
  assertEquals(body.action, "manage");
  assertEquals(body.reason, "payment_past_due");
  assertEquals(body.custom_data, undefined);
});

Deno.test("paddle-checkout-custom-data: refuses an entitled or lapsed live subscription", async () => {
  for (
    const row of [
      liveRow,
      // active, past the 48h renewal grace — the renewal webhook is late.
      { ...liveRow, current_period_end: "2026-05-01T00:00:00Z" },
      { ...liveRow, status: "trialing" },
    ]
  ) {
    const response = await buildHandler(row)(signRequest());
    assertEquals(response.status, 409, `${row.status} ${row.current_period_end}`);
    assertEquals((await response.json()).code, "existing_subscription");
  }
});

Deno.test("paddle-checkout-custom-data: signing is refused exactly when update does not say checkout_required", async () => {
  // The invariant the two handlers share (R-11). Both REAL handlers are
  // driven here — asserting the two against the predicate they are both
  // built from would be a tautology (general-2 review R-11). Whatever the
  // stored row, exactly one of "open a checkout" and "manage what you have"
  // is offered, so nobody is told to check out and then refused, and nobody
  // is left with neither route.
  for (
    const row of [
      null,
      liveRow,
      { ...liveRow, status: "canceled" },
      { ...liveRow, status: "past_due", current_period_end: "2026-05-07T12:00:00Z" },
      { ...liveRow, current_period_end: "2026-05-01T00:00:00Z" },
      { ...liveRow, paddle_subscription_id: null },
      { ...liveRow, status: "incomplete" },
      { ...liveRow, status: "trialing" },
      { ...liveRow, tier: "FREE" },
      { ...liveRow, cancel_at_period_end: true, current_period_end: "2026-05-17T11:59:59Z" },
    ]
  ) {
    const signingResponse = await buildHandler(row)(signRequest());
    const signingSucceeded = signingResponse.status === 200;
    await signingResponse.body?.cancel();

    const updateResponse = await buildUpdateHandler(row)(updateRequest());
    const updateBody = await updateResponse.json();
    const updateSaysCheckoutRequired = updateBody.code === "checkout_required";

    assertEquals(
      signingSucceeded,
      updateSaysCheckoutRequired,
      `the two handlers disagree for ${JSON.stringify(row)}: ` +
        `signing=${signingResponse.status}, update=${JSON.stringify(updateBody)}`,
    );
  }
});

Deno.test("paddle-checkout-custom-data: a live row whose tier grants nothing may still buy", async () => {
  // A row with a live subscription id but a tier that grants no access would
  // otherwise be `manage`: no access AND a 409 refusing the only route to
  // buy any (general-2 review R-5). It must resolve to `refresh` instead, so
  // the portal asks Paddle rather than stranding the user.
  for (const tier of ["FREE", "PHOENIX", ""]) {
    const row = { ...liveRow, tier };
    assertEquals(
      billingAction(row, NOW).action,
      "refresh",
      `${tier || "(empty)"}: a tier that grants nothing must not be manage`,
    );
    const response = await buildHandler(row)(signRequest());
    // Still 409 (there IS a live subscription — a new checkout would double
    // bill), but the action tells the SPA to refresh rather than manage.
    assertEquals(response.status, 409);
    assertEquals((await response.json()).action, "refresh");
  }
});

Deno.test("paddle-checkout-custom-data: a subscription lookup failure fails closed", async () => {
  const original = console.error;
  console.error = () => {};
  try {
    const response = await buildHandler(null, {
      selectError: { message: "connection reset" },
    })(signRequest());

    assertEquals(response.status, 500);
    assertEquals((await response.json()).code, "subscription_lookup_failed");
  } finally {
    console.error = original;
  }
});

Deno.test("paddle-checkout-custom-data: an unauthenticated request never reaches the database", async () => {
  const response = await buildHandler(null, { user: null })(signRequest());

  assertEquals(response.status, 401);
  assertEquals((await response.json()).error, "Unauthorized");
});

Deno.test("paddle-checkout-custom-data: reuses one reserved transaction without another Paddle create", async () => {
  const calls: string[] = [];
  const response = await buildHandler(null, { calls, reservation: { action: "reuse", nonce: crypto.randomUUID(), transaction_id: "txn_existing", expires_at: new Date(NOW.getTime() + 60000).toISOString() } })(signRequest());
  assertEquals(response.status, 200);
  assertEquals((await response.json()).transaction_id, "txn_existing");
  assertEquals(calls, []);
});

Deno.test("paddle-checkout-custom-data: pending creation or deletion reservation cannot create a second transaction", async () => {
  for (const action of ["busy", "blocked"]) {
    const calls: string[] = [];
    const response = await buildHandler(null, { calls, reservation: { action } })(signRequest());
    assertEquals(response.status, 409);
    assertEquals(calls, []);
  }
});

Deno.test("paddle-checkout-custom-data: old client cannot obtain a timeless fallback", async () => {
  const calls: string[] = [];
  const response = await buildHandler(null, { calls })(new Request("https://edge.test", { method: "POST", headers: { Authorization: "Bearer jwt" } }));
  assertEquals(response.status, 400);
  assertEquals(calls, []);
});

Deno.test("paddle-checkout-custom-data: configuration failure retries the recorded transaction without creating again", async () => {
  let state = "create";
  let nonce: unknown;
  let creates = 0;
  let patches = 0;
  const handler = buildHandler(null, {
    rpc: (name, args) => {
      if (name === "reserve_paddle_checkout") {
        nonce ??= args.p_nonce;
        return Promise.resolve({ data: { action: state, nonce, price_id: "pri_ember_monthly", environment: "production", expires_at: new Date(NOW.getTime() + 60000).toISOString(), transaction_id: state === "configure" ? "txn_once" : null }, error: null });
      }
      if (name === "record_paddle_checkout_transaction") state = "configure";
      return Promise.resolve({ data: true, error: null });
    },
    fetch: (_input, init) => {
      if (init?.method === "POST") { creates++; return Promise.resolve(new Response(JSON.stringify({ data: { id: "txn_once" } }))); }
      patches++;
      if (patches === 1) return Promise.reject(new Error("temporary Paddle outage"));
      return Promise.resolve(new Response(JSON.stringify({ data: { id: "txn_once" } })));
    },
  });
  const original = console.error; console.error = () => {};
  try {
    assertEquals((await handler(signRequest())).status, 500);
    assertEquals((await handler(signRequest())).status, 200);
    assertEquals(creates, 1);
  } finally { console.error = original; }
});

Deno.test("paddle-checkout-custom-data: paid closing transaction is restored without cancellation", async () => {
  const calls: string[] = [];
  const rpcCalls: string[] = [];
  const handler = buildHandler(null, {
    rpc: (name) => { rpcCalls.push(name); return Promise.resolve({ data: name === "reserve_paddle_checkout" ? { action: "close", nonce: crypto.randomUUID(), transaction_id: "txn_paid" } : true, error: null }); },
    fetch: (_input, init) => { calls.push(init?.method ?? "GET"); return Promise.resolve(new Response(JSON.stringify({ data: { id: "txn_paid", status: "completed" } }))); },
  });
  assertEquals((await handler(signRequest())).status, 409);
  assertEquals(calls, ["GET"]);
  assertEquals(rpcCalls, ["reserve_paddle_checkout", "finish_paddle_checkout"]);
});

Deno.test("paddle-checkout-custom-data: definitive POST rejection releases creation for a healthy retry", async () => {
  let attempts = 0;
  let released = false;
  const handler = buildHandler(null, {
    rpc: (name, args) => {
      if (name === "reserve_paddle_checkout") return Promise.resolve({ data: { action: "create", nonce: args.p_nonce, expires_at: args.p_expires_at }, error: null });
      if (name === "finish_paddle_checkout" && args.p_canceled) {
        assertEquals(args.p_transaction_id, null); released = true;
      }
      return Promise.resolve({ data: true, error: null });
    },
    fetch: (_input, init) => {
      if (init?.method === "POST" && attempts++ === 0) return Promise.resolve(new Response("{}", { status: 400 }));
      return Promise.resolve(new Response(JSON.stringify({ data: { id: "txn_retried" } })));
    },
  });
  const original = console.error; console.error = () => {};
  try {
    assertEquals((await handler(signRequest())).status, 500);
    assertEquals(released, true);
    assertEquals((await handler(signRequest())).status, 200);
  } finally { console.error = original; }
});

Deno.test("paddle-checkout-custom-data: a locally canceled but live paused contract refuses checkout before reservation", async () => {
  let reservations = 0;
  const methods: string[] = [];
  const handler = buildHandler({ ...liveRow, status: "canceled" }, {
    rpc: () => { reservations++; return Promise.resolve({ data: true, error: null }); },
    fetch: (_input, init) => { methods.push(init?.method ?? "GET"); return Promise.resolve(new Response(JSON.stringify({ data: { id: "sub_1", status: "paused" } }))); },
  });
  const response = await handler(signRequest());
  assertEquals(response.status, 409);
  const body = await response.json();
  assertEquals(body.code, "existing_subscription");
  assertEquals(body.action, "manage");
  assertEquals(reservations, 0);
  assertEquals(methods, ["GET"]);
});

Deno.test("paddle-checkout-custom-data: a confirmed canceled prior contract permits a new transaction", async () => {
  const calls: string[] = [];
  const response = await buildHandler({ ...liveRow, status: "canceled" }, { calls })(signRequest());
  assertEquals(response.status, 200);
  assertEquals(calls.map((call) => call.split(" ")[0]), ["GET", "POST", "PATCH"]);
});
