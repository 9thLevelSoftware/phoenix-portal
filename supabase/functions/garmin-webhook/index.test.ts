import { assert, assertEquals } from "jsr:@std/assert@1";
import { createGarminWebhookHandler } from "./index.ts";
import { hmacSha256Hex } from "../_shared/hmac.ts";
import { FakeDb, fakeClient, type Row } from "../_shared/testing/fakeSupabase.ts";

// F-053: handler tests for the not-yet-launched Garmin webhook. In-process DB
// double; no Garmin or Supabase calls.

const SECRET = "test-webhook-secret";
const USER_ID = "00000000-0000-4000-8000-0000000000c1";

function db(tier = "FLAME"): FakeDb {
  return new FakeDb({
    subscriptions: [{
      user_id: USER_ID,
      tier,
      status: "active",
      current_period_end: "2099-01-01T00:00:00.000Z",
    }],
    user_integrations: [
      { user_id: USER_ID, provider: "garmin", status: "connected", provider_user_id: "garmin-1", last_sync_at: null },
    ],
    oauth_tokens: [{ user_id: USER_ID, provider: "garmin", access_token: "user-token" }],
    external_activities: [],
  });
}

function handler(state: FakeDb, env: Record<string, string> = { GARMIN_WEBHOOK_SECRET: SECRET }) {
  return createGarminWebhookHandler({
    env: (key) => env[key],
    // deno-lint-ignore no-explicit-any
    createAdminClient: () => fakeClient(state, null, () => new Date()) as any,
  });
}

async function signed(body: string, signature?: string): Promise<Request> {
  return new Request("http://edge.test/functions/v1/garmin-webhook", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-garmin-signature": signature ?? await hmacSha256Hex(SECRET, body),
    },
    body,
  });
}

const activity = (overrides: Row = {}) => ({
  userId: "garmin-1",
  userAccessToken: "user-token",
  activityId: 42,
  activityName: "Morning Run",
  activityType: "RUNNING",
  startTimeInSeconds: 1_780_000_000,
  startTimeOffsetInSeconds: -14_400,
  durationInSeconds: 1800,
  distanceInMeters: 5000,
  ...overrides,
});

async function silenced<T>(run: () => Promise<T>): Promise<T> {
  const original = { log: console.log, warn: console.warn, error: console.error };
  console.log = () => {};
  console.warn = () => {};
  console.error = () => {};
  try {
    return await run();
  } finally {
    Object.assign(console, original);
  }
}

Deno.test("garmin-webhook: a GET verification ping answers 200", async () => {
  const res = await handler(db())(new Request("http://edge.test/functions/v1/garmin-webhook"));
  assertEquals(res.status, 200);
});

Deno.test("garmin-webhook: without GARMIN_WEBHOOK_SECRET every POST is 503 and nothing is read", async () => {
  const state = db();
  const res = await silenced(async () => handler(state, {})(await signed("{}")));
  assertEquals(res.status, 503);
  assertEquals(state.rows("external_activities"), []);
});

Deno.test("garmin-webhook: a missing or wrong signature is 401 and writes nothing", async () => {
  const state = db();
  const body = JSON.stringify({ activities: [activity()] });
  for (const signature of ["", "0".repeat(64), "short"]) {
    const req = await signed(body, signature);
    if (signature === "") req.headers.delete("x-garmin-signature");
    const res = await handler(state)(req);
    assertEquals(res.status, 401, `signature ${JSON.stringify(signature)}`);
  }
  assertEquals(state.rows("external_activities"), []);
});

Deno.test("garmin-webhook: a verified activity for a FLAME user is stored at its absolute start time", async () => {
  const state = db();
  const res = await handler(state)(await signed(JSON.stringify({ activities: [activity()] })));
  assertEquals(res.status, 200, await res.clone().text());
  assertEquals(await res.json(), { received: true, processed: 1, errors: 0 });
  const [row] = state.rows("external_activities");
  assertEquals([row.user_id, row.provider, row.external_id], [USER_ID, "garmin", "42"]);
  // The local offset is not added to the epoch.
  assertEquals(row.started_at, new Date(1_780_000_000 * 1000).toISOString());
  assert(typeof state.rows("user_integrations")[0].last_sync_at === "string");
});

Deno.test("garmin-webhook: an activity whose token matches no connected user is counted, not stored", async () => {
  const state = db();
  const res = await silenced(async () =>
    handler(state)(await signed(JSON.stringify({ activities: [activity({ userAccessToken: "someone-else" })] })))
  );
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { received: true, processed: 0, errors: 1 });
  assertEquals(state.rows("external_activities"), []);
});

Deno.test("garmin-webhook: an unentitled user's activity is not stored", async () => {
  const state = db("FREE");
  const res = await silenced(async () => handler(state)(await signed(JSON.stringify({ activities: [activity()] }))));
  assertEquals(res.status, 200);
  assertEquals((await res.json()).processed, 0);
  assertEquals(state.rows("external_activities"), []);
});

Deno.test("garmin-webhook: an unparseable signed body is a 500 with a stable code, not the parser's message", async () => {
  const res = await silenced(async () => handler(db())(await signed("{not json")));
  assertEquals(res.status, 500);
  const body = await res.json();
  assertEquals(body, { received: false, error: "Processing error", code: "internal_error" });
});
