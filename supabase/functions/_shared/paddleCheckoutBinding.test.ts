import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import { bindCheckoutSubscription, listPaddleCustomerSubscriptions, signCheckoutBinding, verifyCheckoutBinding } from "./paddleCheckoutBinding.ts";
import { hmacSha256Hex } from "./hmac.ts";
import { verifyPaddleSignature } from "./paddleWebhookSecurity.ts";

Deno.test("checkout binding authenticates nonce, transaction, price, environment and expiry", async () => {
  const binding = await signCheckoutBinding({ user_id: "owner", cd_version: 2, cd_nonce: crypto.randomUUID(), cd_transaction_id: "txn_owned", cd_price_id: "pri_allowed", cd_environment: "sandbox", cd_expires_at: "2026-10-09T12:30:00Z" }, "test-secret");
  assertEquals(await verifyCheckoutBinding(binding, "test-secret"), true);
  for (const key of ["user_id", "cd_nonce", "cd_transaction_id", "cd_price_id", "cd_environment", "cd_expires_at"] as const) {
    assertEquals(await verifyCheckoutBinding({ ...binding, [key]: "different" }, "test-secret"), false, key);
  }
});

Deno.test("Paddle signature authenticates exact bytes including BOM and invalid UTF8", async () => {
  const bytes = new Uint8Array([0xef, 0xbb, 0xbf, 0xff, 0x7b, 0x7d]);
  const prefix = new TextEncoder().encode("1000:");
  const message = new Uint8Array(prefix.length + bytes.length);
  message.set(prefix); message.set(bytes, prefix.length);
  const h1 = await hmacSha256Hex("test", message);
  assertEquals(await verifyPaddleSignature(bytes, `ts=1000;h1=${h1}`, "test", { now: () => 1000000 }), true);
  assertEquals(await verifyPaddleSignature(new TextDecoder().decode(bytes), `ts=1000;h1=${h1}`, "test", { now: () => 1000000 }), false);
});

Deno.test("Paddle listing follows all pages and refuses foreign continuation origins", async () => {
  const calls: string[] = [];
  const fetchImpl: typeof fetch = (input) => {
    calls.push(String(input));
    const first = calls.length === 1;
    return Promise.resolve(new Response(JSON.stringify({ data: [{ id: first ? "sub_a" : "sub_b", customer_id: "ctm_owner", status: first ? "active" : "paused" }], meta: { pagination: { has_more: first, next: first ? "https://api.paddle.com/subscriptions?customer_id=ctm_owner&after=sub_a" : null } } })));
  };
  const rows = await listPaddleCustomerSubscriptions(fetchImpl, "test", "production", "ctm_owner");
  assertEquals(rows.map((row) => row.id), ["sub_a", "sub_b"]);
  assertEquals(calls.length, 2);
  await assertRejects(() => listPaddleCustomerSubscriptions(() => Promise.resolve(new Response(JSON.stringify({ data: [], meta: { pagination: { has_more: true, next: "https://foreign.example/subscriptions?customer_id=ctm_owner" } } }))), "test", "production", "ctm_owner"));
});

Deno.test("checkout attribution pending completion retries instead of canceling a legitimate subscription", async () => {
  const data = await signCheckoutBinding({ user_id: "owner", cd_version: 2, cd_nonce: crypto.randomUUID(), cd_transaction_id: "txn_owned", cd_price_id: "pri_allowed", cd_environment: "sandbox", cd_expires_at: "2026-10-09T12:30:00Z" }, "test-secret");
  await assertRejects(() => bindCheckoutSubscription({ data, userId: "owner", subscriptionId: "sub_owned", customerId: "ctm_owned", priceId: "pri_allowed", environment: "sandbox", secret: "test-secret", apiKey: "test",
    db: { rpc: () => Promise.resolve({ data: false, error: null }) }, fetchImpl: () => Promise.resolve(new Response(JSON.stringify({ data: { id: "txn_owned", status: "paid", subscription_id: null } }))) }), Error, "not yet completed");
});
