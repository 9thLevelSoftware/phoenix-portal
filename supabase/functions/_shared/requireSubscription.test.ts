import { assert, assertEquals } from "jsr:@std/assert@1";
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { requireSubscription, type SubscriptionTier } from "./requireSubscription.ts";

// Pins the deny and fail-closed paths of the shared tier gate (F-047).
//
// past_due: the user decision (R-33) is that past_due KEEPS access during
// Paddle's retry window. The entitlement predicate on this branch does not
// implement that yet; PR 8 changes it. The `past_due -> allowed` assertion is
// added with PR 8. Do not pin `past_due -> denied` here.

const USER_ID = "00000000-0000-4000-8000-000000000001";
const CORS = { "Access-Control-Allow-Origin": "https://portal.test" };
const FUTURE = "2099-01-01T00:00:00.000Z";
// Far past: expired well beyond any renewal grace window (PR 8 adds 48h).
const LONG_EXPIRED = "2020-01-01T00:00:00.000Z";

interface LookupRecord {
  table: string;
  select?: string;
  eq?: [string, unknown];
}

function fakeClient(
  result: { data: unknown; error: unknown },
  lookups: LookupRecord[] = [],
): SupabaseClient {
  return {
    from(table: string) {
      const record: LookupRecord = { table };
      lookups.push(record);
      const query = {
        select(columns: string) {
          record.select = columns;
          return query;
        },
        eq(column: string, value: unknown) {
          record.eq = [column, value];
          return query;
        },
        maybeSingle() {
          return Promise.resolve(result);
        },
      };
      return query;
    },
  } as unknown as SupabaseClient;
}

function row(tier: string, status: string, currentPeriodEnd: string | null = FUTURE) {
  return {
    data: { tier, status, current_period_end: currentPeriodEnd },
    error: null,
  };
}

async function gate(
  result: { data: unknown; error: unknown },
  minimumTier: SubscriptionTier = "EMBER",
) {
  return await requireSubscription(fakeClient(result), USER_ID, minimumTier, CORS);
}

async function assertDenied402(
  result: { data: unknown; error: unknown },
  minimumTier: SubscriptionTier,
  expectedCurrentTier: SubscriptionTier,
): Promise<void> {
  const outcome = await gate(result, minimumTier);
  assertEquals(outcome.allowed, false);
  if (outcome.allowed) return;
  assertEquals(outcome.tier, expectedCurrentTier);
  assertEquals(outcome.response.status, 402);
  assertEquals(outcome.response.headers.get("Content-Type"), "application/json");
  assertEquals(
    outcome.response.headers.get("Access-Control-Allow-Origin"),
    CORS["Access-Control-Allow-Origin"],
  );
  const body = await outcome.response.json();
  assertEquals(body.error, "subscription_required");
  assertEquals(body.requiredTier, minimumTier);
  assertEquals(body.currentTier, expectedCurrentTier);
  assert(typeof body.message === "string" && body.message.length > 0);
}

async function assertUnavailable503(
  result: { data: unknown; error: unknown },
): Promise<void> {
  const outcome = await gate(result, "EMBER");
  assertEquals(outcome.allowed, false);
  if (outcome.allowed) return;
  assertEquals(outcome.tier, "FREE");
  assertEquals(outcome.response.status, 503);
  assertEquals(outcome.response.headers.get("Retry-After"), "30");
  assertEquals(
    outcome.response.headers.get("Access-Control-Allow-Origin"),
    CORS["Access-Control-Allow-Origin"],
  );
  const body = await outcome.response.json();
  assertEquals(body.error, "subscription_unavailable");
}

function silenceConsoleError(): () => void {
  const original = console.error;
  console.error = () => {};
  return () => {
    console.error = original;
  };
}

Deno.test("requireSubscription looks up the caller's own subscriptions row", async () => {
  const lookups: LookupRecord[] = [];
  await requireSubscription(fakeClient(row("EMBER", "active"), lookups), USER_ID, "EMBER", CORS);
  assertEquals(lookups, [{
    table: "subscriptions",
    select: "tier, status, current_period_end",
    eq: ["user_id", USER_ID],
  }]);
});

Deno.test("requireSubscription denies a user with no subscriptions row with 402", async () => {
  await assertDenied402({ data: null, error: null }, "EMBER", "FREE");
});

Deno.test("requireSubscription denies an active FREE row with 402", async () => {
  await assertDenied402(row("FREE", "active"), "EMBER", "FREE");
});

Deno.test("requireSubscription denies an active paid row whose period ended long ago", async () => {
  await assertDenied402(row("INFERNO", "active", LONG_EXPIRED), "EMBER", "FREE");
});

Deno.test("requireSubscription denies an active paid row with no period end", async () => {
  await assertDenied402(row("INFERNO", "active", null), "EMBER", "FREE");
});

Deno.test("requireSubscription denies a canceled paid row even with a future period end", async () => {
  await assertDenied402(row("INFERNO", "canceled", FUTURE), "EMBER", "FREE");
});

Deno.test("requireSubscription fails closed with 503 when the lookup errors", async () => {
  const restore = silenceConsoleError();
  try {
    await assertUnavailable503({
      data: null,
      error: { message: "connection refused", code: "08006" },
    });
    // An error alongside a paid-looking row must still fail closed.
    await assertUnavailable503({
      data: { tier: "INFERNO", status: "active", current_period_end: FUTURE },
      error: { message: "multiple rows returned", code: "PGRST116" },
    });
  } finally {
    restore();
  }
});

Deno.test("requireSubscription fails closed with 503 on an unknown tier", async () => {
  const restore = silenceConsoleError();
  try {
    await assertUnavailable503(row("ELITE", "active"));
  } finally {
    restore();
  }
});

Deno.test("requireSubscription fails closed with 503 on an unknown status", async () => {
  const restore = silenceConsoleError();
  try {
    await assertUnavailable503(row("INFERNO", "paused"));
  } finally {
    restore();
  }
});

const ORDERING_CASES: Array<{
  userTier: SubscriptionTier;
  minimumTier: SubscriptionTier;
  allowed: boolean;
}> = [
  { userTier: "EMBER", minimumTier: "EMBER", allowed: true },
  { userTier: "EMBER", minimumTier: "FLAME", allowed: false },
  { userTier: "EMBER", minimumTier: "INFERNO", allowed: false },
  { userTier: "FLAME", minimumTier: "EMBER", allowed: true },
  { userTier: "FLAME", minimumTier: "FLAME", allowed: true },
  { userTier: "FLAME", minimumTier: "INFERNO", allowed: false },
  { userTier: "INFERNO", minimumTier: "EMBER", allowed: true },
  { userTier: "INFERNO", minimumTier: "FLAME", allowed: true },
  { userTier: "INFERNO", minimumTier: "INFERNO", allowed: true },
];

for (const { userTier, minimumTier, allowed } of ORDERING_CASES) {
  Deno.test(
    `requireSubscription ordering: active ${userTier} vs ${minimumTier} required is ${allowed ? "allowed" : "denied"}`,
    async () => {
      if (allowed) {
        const outcome = await gate(row(userTier, "active"), minimumTier);
        assertEquals(outcome, { allowed: true, tier: userTier });
      } else {
        await assertDenied402(row(userTier, "active"), minimumTier, userTier);
      }
    },
  );
}

Deno.test("requireSubscription allows an entitled trialing row at its tier", async () => {
  const outcome = await gate(row("FLAME", "trialing"), "FLAME");
  assertEquals(outcome, { allowed: true, tier: "FLAME" });
});
