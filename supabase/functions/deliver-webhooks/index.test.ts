import { assert, assertEquals } from "jsr:@std/assert@1";
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { localIntegrationEnvironment } from "../_shared/localIntegrationEnvironment.ts";
import { FakeDb, fakeClient, type Row } from "../_shared/testing/fakeSupabase.ts";
import { testWebhookSecret } from "../_shared/testing/webhookSecrets.ts";
import { assertNoSecretsLogged, captureLogs } from "../_shared/testLogCapture.ts";
import { signWebhook } from "../_shared/webhookSigning.ts";
import type { DnsResolver } from "../_shared/webhookTarget.ts";
import { createDeliverWebhooksHandler, type DeliverWebhooksDependencies } from "./index.ts";

const USER_A = "aaaaaaaa-0000-4000-8000-00000000000a";
const USER_B = "bbbbbbbb-0000-4000-8000-00000000000b";
const ENDPOINT_A = "eeeeeeee-0000-4000-8000-00000000000a";
const ENDPOINT_B = "eeeeeeee-0000-4000-8000-00000000000b";
const SECRET_A = testWebhookSecret("a");
const SECRET_B = testWebhookSecret("b");
const HEADER_VALUE = "Bearer receiver-credential-123";
const CRON_SECRET = "cron-secret-for-tests";
const SERVICE_KEY = "service-role-key-for-tests";
const NOW = new Date("2026-11-06T12:00:00.000Z");

const encrypt = (plain: string) => `enc:test:${btoa(plain)}`;
const decrypt = (stored: string) => Promise.resolve(atob(stored.replace("enc:test:", "")));

function endpoint(id: string, userId: string, host: string, overrides: Row = {}): Row {
  return {
    id,
    user_id: userId,
    url: `https://${host}/in`,
    scopes: ["routines", "workouts"],
    status: "active",
    custom_header_name: null,
    ...overrides,
  };
}

function secrets(endpointId: string, userId: string, secret: string, overrides: Row = {}): Row {
  return {
    endpoint_id: endpointId,
    user_id: userId,
    signing_secret_enc: encrypt(secret),
    previous_signing_secret_enc: null,
    previous_expires_at: null,
    custom_header_value_enc: null,
    ...overrides,
  };
}

function claimed(id: string, endpointId: string, userId: string, entity: string, entityId: string, attempt = 1): Row {
  return {
    delivery_id: id,
    delivery_endpoint_id: endpointId,
    delivery_user_id: userId,
    delivery_entity: entity,
    delivery_entity_id: entityId,
    delivery_attempt: attempt,
  };
}

interface Outbound {
  url: string;
  headers: Record<string, string>;
  body: string;
}

function baseTables(): Record<string, Row[]> {
  return {
    webhook_endpoints: [
      endpoint(ENDPOINT_A, USER_A, "a.example.com"),
      endpoint(ENDPOINT_B, USER_B, "b.example.com"),
    ],
    webhook_endpoint_secrets: [
      secrets(ENDPOINT_A, USER_A, SECRET_A),
      secrets(ENDPOINT_B, USER_B, SECRET_B),
    ],
    routines: [
      { id: "r-a", user_id: USER_A, name: "A routine" },
      { id: "r-b", user_id: USER_B, name: "B routine" },
    ],
    routine_exercises: [
      { id: "re-a", routine_id: "r-a", name: "A press" },
      { id: "re-b", routine_id: "r-b", name: "B press" },
    ],
  };
}

function harness(options: {
  tables?: Record<string, Row[]>;
  batches?: Row[][];
  status?: (url: string) => number;
  claimError?: boolean;
  completeResult?: (args: Row) => unknown;
} = {}) {
  const db = new FakeDb(options.tables ?? baseTables());
  const batches = [...(options.batches ?? [])];
  const completions: Row[] = [];
  db.rpcHandlers.claim_webhook_deliveries = () => {
    if (options.claimError) return { data: null, error: { code: "XX000", message: "claim exploded" } };
    return { data: batches.shift() ?? [], error: null };
  };
  db.rpcHandlers.complete_webhook_delivery = (args) => {
    completions.push(args);
    const result = options.completeResult ? options.completeResult(args) : args.p_outcome;
    return { data: result, error: null };
  };
  const outbound: Outbound[] = [];
  const resolveDns: DnsResolver = (_hostname, recordType) =>
    Promise.resolve(recordType === "A" ? ["93.184.216.34"] : []);
  const deps: DeliverWebhooksDependencies = {
    createAdminClient: () => fakeClient(db, null, () => NOW) as unknown as SupabaseClient,
    fetch: ((input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      outbound.push({ url, headers: (init?.headers ?? {}) as Record<string, string>, body: String(init?.body) });
      return Promise.resolve(new Response(null, { status: options.status?.(url) ?? 200 }));
    }) as typeof fetch,
    resolveDns,
    env: (name) =>
      ({
        CRON_SECRET,
        SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
        SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co",
      } as Record<string, string>)[name],
    now: () => NOW,
    decrypt,
  };
  const handler = createDeliverWebhooksHandler(deps);
  const run = (headers: Record<string, string> = { "x-cron-secret": CRON_SECRET }, method = "POST") =>
    handler(new Request("http://localhost/functions/v1/deliver-webhooks", { method, headers, body: method === "POST" ? "{}" : undefined }));
  return { db, run, outbound, completions };
}

Deno.test("deliver-webhooks: a caller without the cron secret or the service-role key is refused", async () => {
  const { run, db } = harness({ batches: [[claimed("d-1", ENDPOINT_A, USER_A, "routine", "r-a")]] });

  for (const headers of [
    {},
    { "x-cron-secret": "wrong" },
    { Authorization: "Bearer some-user-jwt" },
    { Authorization: `Bearer ${SERVICE_KEY}x` },
  ] as Record<string, string>[]) {
    assertEquals((await run(headers)).status, 401, JSON.stringify(headers));
  }
  assertEquals((await run({ "x-cron-secret": CRON_SECRET }, "GET")).status, 405);
  assertEquals(db.rpcCallNames(), []);
});

Deno.test("deliver-webhooks: the service-role bearer is accepted as well as the cron secret", async () => {
  const { run } = harness();

  assertEquals((await run({ Authorization: `Bearer ${SERVICE_KEY}` })).status, 200);
  assertEquals((await run({ "x-cron-secret": CRON_SECRET })).status, 200);
});

Deno.test("deliver-webhooks: each endpoint receives only its own owner's data, signed with its own secret", async () => {
  // Arrange: one change for each of two users, claimed in the same batch.
  const { run, outbound, completions } = harness({
    batches: [[
      claimed("d-a", ENDPOINT_A, USER_A, "routine", "r-a"),
      claimed("d-b", ENDPOINT_B, USER_B, "routine", "r-b"),
    ]],
  });

  // Act
  const response = await run();

  // Assert
  assertEquals(response.status, 200);
  assertEquals(await response.json(), { claimed: 2, delivered: 2, failed: 0, gone: 0, skipped: 0, lost: 0 });
  assertEquals(outbound.length, 2);
  const toA = outbound.find((call) => call.url === "https://a.example.com/in")!;
  const toB = outbound.find((call) => call.url === "https://b.example.com/in")!;
  const bodyA = JSON.parse(toA.body);
  const bodyB = JSON.parse(toB.body);
  assertEquals(bodyA.type, "routine.updated");
  assertEquals(bodyA.data.record.name, "A routine");
  assertEquals(bodyA.data.children.routine_exercises.map((row: Row) => row.name), ["A press"]);
  assertEquals(bodyB.data.record.name, "B routine");
  assert(!toA.body.includes("B routine") && !toA.body.includes("B press") && !toA.body.includes(USER_B));
  assert(!toB.body.includes("A routine") && !toB.body.includes("A press") && !toB.body.includes(USER_A));
  const timestamp = Math.floor(NOW.getTime() / 1000);
  assertEquals(toA.headers["webhook-id"], "d-a");
  assertEquals(toA.headers["webhook-signature"], await signWebhook(SECRET_A, "d-a", timestamp, toA.body));
  assertEquals(toB.headers["webhook-signature"], await signWebhook(SECRET_B, "d-b", timestamp, toB.body));
  assertEquals(
    completions.map((args) => [args.p_delivery_id, args.p_attempt, args.p_outcome, args.p_event_type, args.p_status_code]).sort(),
    [["d-a", 1, "delivered", "routine.updated", 200], ["d-b", 1, "delivered", "routine.updated", 200]],
  );
});

Deno.test("deliver-webhooks: a delivery whose user id is not the endpoint owner's sends nothing", async () => {
  // A row that names A's endpoint but B's user id cannot exist (composite FK);
  // if one ever did, the endpoint read is scoped by both and finds nothing.
  const { run, outbound, completions } = harness({
    batches: [[claimed("d-x", ENDPOINT_A, USER_B, "routine", "r-b")]],
  });

  await run();

  assertEquals(outbound.length, 0);
  assertEquals([completions[0].p_outcome, completions[0].p_error_code], ["skipped", "endpoint_inactive"]);
});

Deno.test("deliver-webhooks: a deleted entity is sent as a deleted event with the id only", async () => {
  const { run, outbound, completions } = harness({
    batches: [[claimed("d-gone", ENDPOINT_A, USER_A, "routine", "r-gone")]],
  });

  await run();

  assertEquals(JSON.parse(outbound[0].body).type, "routine.deleted");
  assertEquals(JSON.parse(outbound[0].body).data, {
    apiVersion: "2026-11-01",
    endpointId: ENDPOINT_A,
    entity: "routine",
    id: "r-gone",
  });
  assertEquals(completions[0].p_event_type, "routine.deleted");
});

Deno.test("deliver-webhooks: a receiver failure is recorded with its status, and 410 as gone", async () => {
  const { run, completions } = harness({
    batches: [[
      claimed("d-a", ENDPOINT_A, USER_A, "routine", "r-a", 3),
      claimed("d-b", ENDPOINT_B, USER_B, "routine", "r-b"),
    ]],
    status: (url) => (url.includes("a.example.com") ? 503 : 410),
  });

  const response = await run();

  assertEquals(await response.json(), { claimed: 2, delivered: 0, failed: 1, gone: 1, skipped: 0, lost: 0 });
  const a = completions.find((args) => args.p_delivery_id === "d-a")!;
  const b = completions.find((args) => args.p_delivery_id === "d-b")!;
  assertEquals([a.p_attempt, a.p_outcome, a.p_status_code, a.p_error_code], [3, "failed", 503, "http_error"]);
  assertEquals([b.p_outcome, b.p_status_code], ["gone", 410]);
});

Deno.test("deliver-webhooks: a scope removed after capture is not delivered", async () => {
  const tables = baseTables();
  tables.webhook_endpoints[0].scopes = ["workouts"];
  const { run, outbound, completions } = harness({
    tables,
    batches: [[claimed("d-a", ENDPOINT_A, USER_A, "routine", "r-a")]],
  });

  await run();

  assertEquals(outbound.length, 0);
  assertEquals([completions[0].p_outcome, completions[0].p_error_code], ["skipped", "scope_removed"]);
});

Deno.test("deliver-webhooks: a paused, disabled or deleted endpoint is not delivered to", async () => {
  for (const mutate of [
    (rows: Row[]) => { rows[0].status = "paused"; },
    (rows: Row[]) => { rows[0].status = "disabled"; },
    (rows: Row[]) => { rows.splice(0, 1); },
  ]) {
    const tables = baseTables();
    mutate(tables.webhook_endpoints);
    const { run, outbound, completions } = harness({
      tables,
      batches: [[claimed("d-a", ENDPOINT_A, USER_A, "routine", "r-a")]],
    });

    await run();

    assertEquals(outbound.length, 0);
    assertEquals([completions[0].p_outcome, completions[0].p_error_code], ["skipped", "endpoint_inactive"]);
  }
});

Deno.test("deliver-webhooks: an entity that may not be shared is skipped, never sent", async () => {
  const tables = baseTables();
  tables.webhook_endpoints[0].scopes = ["external_activities"];
  tables.external_activities = [{ id: "x-1", user_id: USER_A, provider: "strava", name: "Ride" }];
  const { run, outbound, completions } = harness({
    tables,
    batches: [[
      claimed("d-1", ENDPOINT_A, USER_A, "external_activity", "x-1"),
      claimed("d-2", ENDPOINT_A, USER_A, "vbt_assessment", "v-1"),
    ]],
  });

  await run();

  assertEquals(outbound.length, 0);
  assertEquals(
    completions.map((args) => [args.p_delivery_id, args.p_outcome, args.p_error_code]).sort(),
    [["d-1", "skipped", "not_shareable"], ["d-2", "skipped", "unknown_entity"]],
  );
});

Deno.test("deliver-webhooks: missing secrets fail the attempt as ours and send nothing unsigned", async () => {
  const tables = baseTables();
  tables.webhook_endpoint_secrets = [];
  const { run, outbound, completions } = harness({
    tables,
    batches: [[claimed("d-a", ENDPOINT_A, USER_A, "routine", "r-a")]],
  });

  await run();

  assertEquals(outbound.length, 0);
  assertEquals([completions[0].p_outcome, completions[0].p_error_code], ["failed", "internal_error"]);
});

Deno.test("deliver-webhooks: the custom header and a live previous secret are applied; an expired one is not", async () => {
  const tables = baseTables();
  tables.webhook_endpoints[0].custom_header_name = "Authorization";
  tables.webhook_endpoint_secrets[0] = secrets(ENDPOINT_A, USER_A, SECRET_A, {
    custom_header_value_enc: encrypt(HEADER_VALUE),
    previous_signing_secret_enc: encrypt(SECRET_B),
    previous_expires_at: "2026-11-07T00:00:00.000Z",
  });
  tables.webhook_endpoint_secrets[1] = secrets(ENDPOINT_B, USER_B, SECRET_B, {
    previous_signing_secret_enc: encrypt(SECRET_A),
    previous_expires_at: "2026-11-05T00:00:00.000Z",
  });
  const { run, outbound } = harness({
    tables,
    batches: [[
      claimed("d-a", ENDPOINT_A, USER_A, "routine", "r-a"),
      claimed("d-b", ENDPOINT_B, USER_B, "routine", "r-b"),
    ]],
  });

  await run();

  const toA = outbound.find((call) => call.url.includes("a.example.com"))!;
  const toB = outbound.find((call) => call.url.includes("b.example.com"))!;
  assertEquals(toA.headers.Authorization, HEADER_VALUE);
  assertEquals(toA.headers["webhook-signature"].split(" ").length, 2);
  assertEquals("Authorization" in toB.headers, false);
  assertEquals(toB.headers["webhook-signature"].split(" ").length, 1);
});

Deno.test("deliver-webhooks: batches are claimed until the queue is empty", async () => {
  const { run, db, outbound } = harness({
    batches: [
      [claimed("d-1", ENDPOINT_A, USER_A, "routine", "r-a")],
      [claimed("d-2", ENDPOINT_B, USER_B, "routine", "r-b")],
    ],
  });

  const response = await run();

  assertEquals((await response.json()).claimed, 2);
  assertEquals(outbound.length, 2);
  // Two batches with work, then the empty one that ends the pass.
  assertEquals(db.rpcCallNames().filter((name) => name === "claim_webhook_deliveries").length, 3);
});

Deno.test("deliver-webhooks: a claim that was lost to another worker is counted as lost, not delivered", async () => {
  const { run } = harness({
    batches: [[claimed("d-a", ENDPOINT_A, USER_A, "routine", "r-a")]],
    completeResult: () => null,
  });

  const response = await run();

  assertEquals(await response.json(), { claimed: 1, delivered: 0, failed: 0, gone: 0, skipped: 0, lost: 1 });
});

Deno.test("deliver-webhooks: a claim error is a 503 and nothing is sent", async () => {
  const { run, outbound } = harness({ claimError: true });

  const response = await run();

  assertEquals(response.status, 503);
  assertEquals(outbound.length, 0);
});

Deno.test("deliver-webhooks: no secret, header value, URL or payload is logged", async () => {
  const tables = baseTables();
  tables.webhook_endpoints[0].custom_header_name = "Authorization";
  tables.webhook_endpoints[0].url = "https://a.example.com/in/private-path-token";
  tables.webhook_endpoint_secrets[0] = secrets(ENDPOINT_A, USER_A, SECRET_A, {
    custom_header_value_enc: encrypt(HEADER_VALUE),
  });
  tables.webhook_endpoint_secrets.splice(1, 1);
  const { run } = harness({
    tables,
    batches: [[
      claimed("d-a", ENDPOINT_A, USER_A, "routine", "r-a"),
      claimed("d-b", ENDPOINT_B, USER_B, "routine", "r-b"),
    ]],
    status: () => 500,
  });

  const { logs } = await captureLogs(() => run());

  assertNoSecretsLogged(logs, [
    SECRET_A,
    SECRET_B,
    HEADER_VALUE,
    "private-path-token",
    "A routine",
    CRON_SECRET,
    SERVICE_KEY,
  ]);
});

// ---------------------------------------------------------------------------
// Real SQL (local stack only): the triggers, the claim and the worker together.
// ---------------------------------------------------------------------------

Deno.test({
  name: "integration: two users' changes reach only their own endpoints, and a lapsed owner's endpoint is paused instead",
  ignore: localIntegrationEnvironment === null,
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    assert(localIntegrationEnvironment);
    const admin = createClient(
      localIntegrationEnvironment.url,
      localIntegrationEnvironment.serviceRoleKey,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const run = crypto.randomUUID().slice(0, 8);
    const userIds: string[] = [];
    const createUser = async (label: string) => {
      const created = await admin.auth.admin.createUser({
        email: `webhook-${label}-${crypto.randomUUID()}@example.invalid`,
        password: `pw-${crypto.randomUUID()}`,
        email_confirm: true,
      });
      if (created.error || !created.data.user) throw new Error("auth fixture failed");
      userIds.push(created.data.user.id);
      return created.data.user.id;
    };

    try {
      // Arrange: A and B are FLAME, C has no subscription.
      const userA = await createUser("a");
      const userB = await createUser("b");
      const userC = await createUser("c");
      for (const userId of [userA, userB]) {
        const subscription = await admin.from("subscriptions").upsert({
          user_id: userId,
          tier: "FLAME",
          status: "active",
          current_period_end: new Date(Date.now() + 30 * 86_400_000).toISOString(),
        }, { onConflict: "user_id" });
        if (subscription.error) throw new Error(`subscription seed failed: ${JSON.stringify(subscription.error)}`);
      }
      const hosts: Record<string, string> = {
        [userA]: `a-${run}.example.com`,
        [userB]: `b-${run}.example.com`,
        [userC]: `c-${run}.example.com`,
      };
      const endpointIds: Record<string, string> = {};
      for (const userId of [userA, userB, userC]) {
        const created = await admin.rpc("create_webhook_endpoint", {
          p_user_id: userId,
          p_label: "integration",
          p_url: `https://${hosts[userId]}/in`,
          p_scopes: ["routines"],
          p_signing_secret_enc: encrypt(userId === userB ? SECRET_B : SECRET_A),
          p_signing_key_hint: "test",
        });
        if (created.error) throw new Error(`endpoint seed failed: ${JSON.stringify(created.error)}`);
        endpointIds[userId] = created.data as string;
      }

      // Act 1: each user's routine is written; the capture trigger enqueues it.
      const routineIds: Record<string, string> = {};
      for (const userId of [userA, userB, userC]) {
        const routine = await admin.from("routines")
          .insert({ user_id: userId, name: `routine of ${userId}` })
          .select("id")
          .single();
        if (routine.error) throw new Error(`routine seed failed: ${JSON.stringify(routine.error)}`);
        routineIds[userId] = routine.data.id as string;
      }
      const due = await admin.from("webhook_deliveries")
        .update({ next_attempt_at: new Date(Date.now() - 1000).toISOString() })
        .in("user_id", [userA, userB, userC])
        .eq("status", "pending");
      assertEquals(due.error, null);

      // Act 2: one worker pass against the real claim and completion RPCs.
      const outbound: Outbound[] = [];
      const handler = createDeliverWebhooksHandler({
        createAdminClient: () => admin,
        fetch: ((input: string | URL | Request, init?: RequestInit) => {
          outbound.push({
            url: String(input),
            headers: (init?.headers ?? {}) as Record<string, string>,
            body: String(init?.body),
          });
          return Promise.resolve(new Response(null, { status: 200 }));
        }) as typeof fetch,
        resolveDns: (_hostname, recordType) => Promise.resolve(recordType === "A" ? ["93.184.216.34"] : []),
        env: (name) => ({ CRON_SECRET } as Record<string, string>)[name],
        now: () => new Date(),
        decrypt,
      });
      const response = await handler(
        new Request("http://localhost/functions/v1/deliver-webhooks", {
          method: "POST",
          headers: { "x-cron-secret": CRON_SECRET },
          body: "{}",
        }),
      );
      assertEquals(response.status, 200);

      // Assert: A's and B's receivers each got exactly their own routine.
      const mine = outbound.filter((call) => Object.values(hosts).some((host) => call.url.includes(host)));
      const toA = mine.filter((call) => call.url.includes(hosts[userA]));
      const toB = mine.filter((call) => call.url.includes(hosts[userB]));
      const toC = mine.filter((call) => call.url.includes(hosts[userC]));
      assertEquals(toA.length, 1);
      assertEquals(toB.length, 1);
      assertEquals(JSON.parse(toA[0].body).data.id, routineIds[userA]);
      assertEquals(JSON.parse(toA[0].body).data.record.name, `routine of ${userA}`);
      assertEquals(JSON.parse(toB[0].body).data.id, routineIds[userB]);
      assert(!toA[0].body.includes(routineIds[userB]) && !toA[0].body.includes(userB));
      assert(!toB[0].body.includes(routineIds[userA]) && !toB[0].body.includes(userA));
      const timestamp = Number(toA[0].headers["webhook-timestamp"]);
      assertEquals(
        toA[0].headers["webhook-signature"],
        await signWebhook(SECRET_A, toA[0].headers["webhook-id"], timestamp, toA[0].body),
      );

      // ...and both are recorded as delivered, with the event type resolved.
      const delivered = await admin.from("webhook_deliveries")
        .select("user_id, status, event_type, attempt_count, last_status_code")
        .in("user_id", [userA, userB]);
      assertEquals(delivered.error, null);
      assertEquals(
        (delivered.data ?? []).map((row) => [row.status, row.event_type, row.attempt_count, row.last_status_code]),
        [["delivered", "routine.updated", 1, 200], ["delivered", "routine.updated", 1, 200]],
      );

      // C is below FLAME: nothing was sent, the endpoint is paused with a
      // reason, the waiting row is closed, and a further write enqueues nothing.
      assertEquals(toC.length, 0);
      const endpointC = await admin.from("webhook_endpoints")
        .select("status, disabled_reason")
        .eq("id", endpointIds[userC])
        .single();
      assertEquals(endpointC.data, { status: "paused", disabled_reason: "subscription_lapsed" });
      const rename = await admin.from("routines").update({ name: "renamed" }).eq("id", routineIds[userC]);
      assertEquals(rename.error, null);
      const deliveriesC = await admin.from("webhook_deliveries")
        .select("status, last_error_code")
        .eq("user_id", userC);
      assertEquals(deliveriesC.data, [{ status: "skipped", last_error_code: "subscription_lapsed" }]);

      // A hard delete is delivered as a deleted event with the id only.
      const removed = await admin.from("routines").delete().eq("id", routineIds[userA]);
      assertEquals(removed.error, null);
      await admin.from("webhook_deliveries")
        .update({ next_attempt_at: new Date(Date.now() - 1000).toISOString() })
        .eq("user_id", userA)
        .eq("status", "pending");
      outbound.length = 0;
      await handler(
        new Request("http://localhost/functions/v1/deliver-webhooks", {
          method: "POST",
          headers: { "x-cron-secret": CRON_SECRET },
          body: "{}",
        }),
      );
      const deletion = outbound.filter((call) => call.url.includes(hosts[userA]));
      assertEquals(deletion.length, 1);
      assertEquals(JSON.parse(deletion[0].body).type, "routine.deleted");
      assertEquals(JSON.parse(deletion[0].body).data.id, routineIds[userA]);
      assertEquals("record" in JSON.parse(deletion[0].body).data, false);
    } finally {
      // Endpoints, secrets and deliveries cascade from the user.
      for (const userId of userIds) await admin.auth.admin.deleteUser(userId);
    }
  },
});
