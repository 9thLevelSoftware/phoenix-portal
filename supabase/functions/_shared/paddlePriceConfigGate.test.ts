import { assertEquals } from "jsr:@std/assert@1";
import { PADDLE_PRICE_IDS_NOT_CONFIGURED_FATAL } from "./paddlePriceIds.ts";
import {
  PADDLE_CROSS_TIER_DUPLICATE_PRICE_IDS_FATAL,
  paddlePriceConfigGateResponse,
} from "./paddlePriceConfigGate.ts";

const HEADERS = {
  "Content-Type": "application/json",
  "X-Test-Header": "kept",
};

function env(values: Record<string, string>): { get(key: string): string | undefined } {
  return { get: (key) => values[key] };
}

async function captureError<T>(run: () => T): Promise<{ result: T; calls: unknown[][] }> {
  const calls: unknown[][] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => {
    calls.push(args);
  };
  try {
    return { result: await run(), calls };
  } finally {
    console.error = original;
  }
}

Deno.test("paddle price-config gate: no paid price id is 500 incomplete and logs the fatal line", async () => {
  const { result, calls } = await captureError(() =>
    paddlePriceConfigGateResponse(env({ PADDLE_EMBER_PRICE_IDS: "  , " }), HEADERS)
  );

  assertEquals(result?.status, 500);
  assertEquals(await result?.text(), '{"error":"Billing configuration incomplete"}');
  assertEquals(result?.headers.get("Content-Type"), "application/json");
  assertEquals(result?.headers.get("X-Test-Header"), "kept");
  assertEquals(calls, [[PADDLE_PRICE_IDS_NOT_CONFIGURED_FATAL]]);
});

Deno.test("paddle price-config gate: a cross-tier price id is 500 invalid and logs the id list", async () => {
  const { result, calls } = await captureError(() =>
    paddlePriceConfigGateResponse(
      env({
        PADDLE_EMBER_PRICE_IDS: "pri_shared",
        PADDLE_FLAME_PRICE_IDS: "pri_shared,pri_other",
        PADDLE_INFERNO_PRICE_IDS: "pri_other",
      }),
      HEADERS,
    )
  );

  assertEquals(result?.status, 500);
  assertEquals(await result?.text(), '{"error":"Billing configuration invalid"}');
  assertEquals(result?.headers.get("Content-Type"), "application/json");
  assertEquals(calls, [[
    PADDLE_CROSS_TIER_DUPLICATE_PRICE_IDS_FATAL,
    ["pri_shared", "pri_other"],
  ]]);
});

Deno.test("paddle price-config gate: one paid id, including a single monthly secret, passes", async () => {
  const { result, calls } = await captureError(() =>
    paddlePriceConfigGateResponse(
      env({ PADDLE_EMBER_MONTHLY_PRICE_ID: "pri_ember_monthly" }),
      HEADERS,
    )
  );

  assertEquals(result, null);
  assertEquals(calls, []);
});
