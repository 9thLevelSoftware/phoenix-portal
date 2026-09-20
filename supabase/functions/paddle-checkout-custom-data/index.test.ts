import { assertEquals, assertNotEquals } from "jsr:@std/assert@1";
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { billingAction } from "../_shared/billingAction.ts";
import { hmacSha256Hex } from "../_shared/hmac.ts";
import { createPaddleCheckoutCustomDataHandler } from "./index.ts";

const USER_ID = "00000000-0000-4000-8000-000000000001";
const SECRET = "cdsec_test_only";
const NOW = new Date("2026-05-17T12:00:00Z");

interface SubscriptionRow {
  paddle_subscription_id: string | null;
  status: string;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
}

function buildHandler(
  row: SubscriptionRow | null,
  options: { selectError?: unknown; user?: { id: string } | null } = {},
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
      return { from: () => query } as unknown as SupabaseClient;
    },
    env: { get: (key: string) => (key === "PADDLE_CUSTOM_DATA_SECRET" ? SECRET : undefined) },
    now: () => NOW,
  });
}

function signRequest() {
  return new Request("https://edge.test/paddle-checkout-custom-data", {
    method: "POST",
    headers: { Authorization: "Bearer jwt" },
  });
}

const liveRow: SubscriptionRow = {
  paddle_subscription_id: "sub_1",
  status: "active",
  current_period_end: "2026-06-01T00:00:00Z",
  cancel_at_period_end: false,
};

Deno.test("paddle-checkout-custom-data: signs for a user with no subscription", async () => {
  const response = await buildHandler(null)(signRequest());

  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(body.custom_data.user_id, USER_ID);
  assertEquals(body.custom_data.cd_sig, await hmacSha256Hex(SECRET, USER_ID));
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
  // The invariant the two handlers share (R-11): whatever the stored row,
  // exactly one of "open a checkout" and "manage what you have" is offered.
  for (
    const row of [
      null,
      liveRow,
      { ...liveRow, status: "canceled" },
      { ...liveRow, status: "past_due", current_period_end: "2026-05-07T12:00:00Z" },
      { ...liveRow, current_period_end: "2026-05-01T00:00:00Z" },
      { ...liveRow, paddle_subscription_id: null },
      { ...liveRow, status: "incomplete" },
    ]
  ) {
    const response = await buildHandler(row)(signRequest());
    const updateSaysCheckoutRequired = billingAction(row, NOW).action === "checkout";
    assertEquals(
      response.status === 200,
      updateSaysCheckoutRequired,
      `signing must succeed exactly when update says checkout_required: ${
        JSON.stringify(row)
      }`,
    );
    await response.body?.cancel();
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
