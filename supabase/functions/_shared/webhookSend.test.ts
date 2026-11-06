import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  sendWebhook,
  WEBHOOK_API_VERSION,
  WEBHOOK_MAX_BODY_BYTES,
  WEBHOOK_USER_AGENT,
  webhookEnvelope,
  type WebhookSendDependencies,
} from "./webhookSend.ts";
import { signWebhook } from "./webhookSigning.ts";
import type { DnsResolver } from "./webhookTarget.ts";

const SECRET = "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw";
const OLD_SECRET = "whsec_C2FVsBQIhrscChlQIMV+b5sSYspob7oD";
const NOW = new Date("2026-11-06T12:00:00.000Z");
const URL_OK = "https://hooks.example.com/in";

interface Seen {
  url: string;
  init: RequestInit;
}

function harness(
  respond: (seen: Seen) => Response | Promise<Response>,
  dns: Record<string, string[]> = { "hooks.example.com/A": ["93.184.216.34"] },
) {
  const calls: Seen[] = [];
  const lookups: string[] = [];
  const resolveDns: DnsResolver = (hostname, recordType) => {
    lookups.push(`${hostname}/${recordType}`);
    return Promise.resolve(dns[`${hostname}/${recordType}`] ?? []);
  };
  const deps: WebhookSendDependencies = {
    fetch: ((input: string | URL | Request, init?: RequestInit) => {
      const seen = { url: String(input), init: init ?? {} };
      calls.push(seen);
      return Promise.resolve(respond(seen));
    }) as typeof fetch,
    resolveDns,
    ownHosts: ["abcdefghijklmnopqrst.supabase.co"],
    now: () => NOW,
  };
  return { deps, calls, lookups };
}

function input(overrides: Partial<Parameters<typeof sendWebhook>[1]> = {}) {
  return {
    url: URL_OK,
    deliveryId: "11111111-1111-4111-8111-111111111111",
    secrets: [SECRET],
    customHeader: null,
    body: '{"type":"ping"}',
    ...overrides,
  };
}

Deno.test("webhookSend: a 2xx answer is delivered and the request is signed over the exact body", async () => {
  const { deps, calls } = harness(() => new Response("ignored", { status: 200 }));

  const result = await sendWebhook(deps, input());

  assertEquals(result.outcome, "delivered");
  assertEquals(result.statusCode, 200);
  assertEquals(result.errorCode, null);
  assertEquals(calls.length, 1);
  assertEquals(calls[0].url, URL_OK);
  const headers = calls[0].init.headers as Record<string, string>;
  const timestamp = Math.floor(NOW.getTime() / 1000);
  assertEquals(headers["webhook-id"], "11111111-1111-4111-8111-111111111111");
  assertEquals(headers["webhook-timestamp"], String(timestamp));
  assertEquals(
    headers["webhook-signature"],
    await signWebhook(SECRET, "11111111-1111-4111-8111-111111111111", timestamp, '{"type":"ping"}'),
  );
  assertEquals(calls[0].init.body, '{"type":"ping"}');
});

Deno.test("webhookSend: the request carries no Supabase credential, only the fixed headers and the user's one header", async () => {
  // Arrange: an environment full of things that must not leak into a request.
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "service-role-key-must-not-leave");
  Deno.env.set("SUPABASE_ANON_KEY", "anon-key-must-not-leave");
  const { deps, calls } = harness(() => new Response(null, { status: 204 }));

  try {
    // Act
    await sendWebhook(deps, input());
    await sendWebhook(deps, input({ customHeader: { name: "X-Api-Key", value: "receiver-key" } }));
  } finally {
    Deno.env.delete("SUPABASE_SERVICE_ROLE_KEY");
    Deno.env.delete("SUPABASE_ANON_KEY");
  }

  // Assert: exactly the fixed set, nothing else.
  const plain = calls[0].init.headers as Record<string, string>;
  assertEquals(Object.keys(plain).sort(), [
    "content-type",
    "user-agent",
    "webhook-id",
    "webhook-signature",
    "webhook-timestamp",
  ]);
  assertEquals(plain["user-agent"], WEBHOOK_USER_AGENT);
  assertEquals(plain["content-type"], "application/json");
  const withHeader = calls[1].init.headers as Record<string, string>;
  assertEquals(Object.keys(withHeader).sort(), [
    "X-Api-Key",
    "content-type",
    "user-agent",
    "webhook-id",
    "webhook-signature",
    "webhook-timestamp",
  ]);
  assertEquals(withHeader["X-Api-Key"], "receiver-key");
  for (const call of calls) {
    const sent = JSON.stringify(call.init.headers) + String(call.init.body) + call.url;
    assert(!sent.includes("service-role-key-must-not-leave"));
    assert(!sent.includes("anon-key-must-not-leave"));
    assert(!/apikey|authorization/i.test(Object.keys(call.init.headers as Record<string, string>).join(",")));
  }
});

Deno.test("webhookSend: during a rotation overlap both secrets sign, current first", async () => {
  const { deps, calls } = harness(() => new Response(null, { status: 200 }));

  await sendWebhook(deps, input({ secrets: [SECRET, OLD_SECRET] }));

  const headers = calls[0].init.headers as Record<string, string>;
  const timestamp = Math.floor(NOW.getTime() / 1000);
  assertEquals(headers["webhook-signature"].split(" "), [
    await signWebhook(SECRET, "11111111-1111-4111-8111-111111111111", timestamp, '{"type":"ping"}'),
    await signWebhook(OLD_SECRET, "11111111-1111-4111-8111-111111111111", timestamp, '{"type":"ping"}'),
  ]);
});

Deno.test("webhookSend: a redirect is a failure and is never followed", async () => {
  const { deps, calls } = harness(() =>
    new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data/" } })
  );

  const result = await sendWebhook(deps, input());

  assertEquals(result.outcome, "failed");
  assertEquals(result.statusCode, 302);
  assertEquals(result.errorCode, "redirect_not_followed");
  assertEquals(calls.length, 1);
  assertEquals(calls[0].init.redirect, "manual");
});

Deno.test("webhookSend: the response body is cancelled, never read", async () => {
  let pulled = 0;
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      pulled += 1;
      controller.enqueue(new TextEncoder().encode("internal data"));
    },
    cancel() {
      cancelled = true;
    },
  }, { highWaterMark: 0 });
  const { deps } = harness(() => new Response(body, { status: 500 }));

  const result = await sendWebhook(deps, input());

  assertEquals(result.outcome, "failed");
  assertEquals(result.errorCode, "http_error");
  assertEquals(cancelled, true);
  assertEquals(pulled, 0);
  // The result has nowhere to carry a body.
  assertEquals(Object.keys(result).sort(), ["durationMs", "errorCode", "outcome", "retryAfterSeconds", "statusCode"]);
});

Deno.test("webhookSend: 410 is gone, other non-2xx are failed, and Retry-After is read on 429 and 503", async () => {
  const gone = await sendWebhook(harness(() => new Response(null, { status: 410 })).deps, input());
  const notFound = await sendWebhook(harness(() => new Response(null, { status: 404 })).deps, input());
  const throttled = await sendWebhook(
    harness(() => new Response(null, { status: 429, headers: { "retry-after": "120" } })).deps,
    input(),
  );
  const busy = await sendWebhook(
    harness(() => new Response(null, { status: 503, headers: { "retry-after": "7" } })).deps,
    input(),
  );
  const serverError = await sendWebhook(
    harness(() => new Response(null, { status: 500, headers: { "retry-after": "9" } })).deps,
    input(),
  );

  assertEquals([gone.outcome, gone.statusCode], ["gone", 410]);
  assertEquals([notFound.outcome, notFound.errorCode, notFound.retryAfterSeconds], ["failed", "http_error", null]);
  assertEquals([throttled.outcome, throttled.retryAfterSeconds], ["failed", 120]);
  assertEquals(busy.retryAfterSeconds, 7);
  assertEquals(serverError.retryAfterSeconds, null);
});

Deno.test("webhookSend: every failure before an HTTP status is one code, and a timeout is its own", async () => {
  const codes: string[] = [];
  for (const error of [
    new TypeError("error sending request: connection refused 10.0.0.5:8443"),
    new TypeError("invalid peer certificate: UnknownIssuer"),
    new Error("connection reset"),
  ]) {
    const result = await sendWebhook(harness(() => Promise.reject(error)).deps, input());
    assertEquals(result.outcome, "failed");
    assertEquals(result.statusCode, null);
    codes.push(String(result.errorCode));
  }
  const timeout = await sendWebhook(
    harness(() => Promise.reject(new DOMException("signal timed out", "TimeoutError"))).deps,
    input(),
  );

  // Refused, bad certificate and reset are indistinguishable to the caller.
  assertEquals(codes, ["connection_failed", "connection_failed", "connection_failed"]);
  assertEquals(timeout.errorCode, "timeout");
});

Deno.test("webhookSend: DNS is re-checked on every send and a private answer stops the request", async () => {
  const rebound = harness(() => new Response(null, { status: 200 }), { "hooks.example.com/A": ["10.0.0.5"] });
  const unresolved = harness(() => new Response(null, { status: 200 }), {});

  const privateResult = await sendWebhook(rebound.deps, input());
  const unresolvedResult = await sendWebhook(unresolved.deps, input());

  assertEquals([privateResult.outcome, privateResult.errorCode], ["failed", "target_not_allowed"]);
  assertEquals(rebound.calls.length, 0);
  assertEquals(rebound.lookups.sort(), ["hooks.example.com/A", "hooks.example.com/AAAA"]);
  assertEquals([unresolvedResult.outcome, unresolvedResult.errorCode], ["failed", "dns_failed"]);
  assertEquals(unresolved.calls.length, 0);
});

Deno.test("webhookSend: a stored URL that is no longer allowed is not requested", async () => {
  for (const url of [
    "http://hooks.example.com/in",
    "https://127.0.0.1/in",
    "https://abcdefghijklmnopqrst.supabase.co/functions/v1/delete-account",
  ]) {
    const { deps, calls } = harness(() => new Response(null, { status: 200 }));

    const result = await sendWebhook(deps, input({ url }));

    assertEquals([result.outcome, result.errorCode], ["failed", "target_not_allowed"], url);
    assertEquals(calls.length, 0, url);
  }
});

Deno.test("webhookSend: an oversized payload is skipped without a request", async () => {
  const { deps, calls, lookups } = harness(() => new Response(null, { status: 200 }));

  const result = await sendWebhook(deps, input({ body: "x".repeat(WEBHOOK_MAX_BODY_BYTES + 1) }));

  assertEquals([result.outcome, result.errorCode], ["skipped", "payload_too_large"]);
  assertEquals(calls.length, 0);
  assertEquals(lookups.length, 0);
});

Deno.test("webhookSend: the envelope carries the type, an ISO timestamp and the API version", () => {
  const body = JSON.parse(webhookEnvelope("workout.updated", NOW, { endpointId: "e", id: "w" }));

  assertEquals(body, {
    type: "workout.updated",
    timestamp: "2026-11-06T12:00:00.000Z",
    data: { apiVersion: WEBHOOK_API_VERSION, endpointId: "e", id: "w" },
  });
});
