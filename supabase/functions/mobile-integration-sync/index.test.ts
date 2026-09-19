import { assert, assertEquals } from "jsr:@std/assert@1";
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { createMobileIntegrationSyncHandler } from "./index.ts";

const USER_ID = "11111111-1111-4111-8111-111111111111";

type Call =
  | { kind: "from"; table: string; op: string }
  | { kind: "rpc"; name: string; args: Record<string, unknown> }
  | { kind: "fetch"; url: string };

interface State {
  calls: Call[];
  disconnectError: { code?: string; message: string } | null;
}

function fakeAdmin(state: State): SupabaseClient {
  const client = {
    from(table: string) {
      const chain = (op: string) => () => {
        state.calls.push({ kind: "from", table, op });
        const query = {
          eq: () => query,
          select: () => query,
          maybeSingle: () => Promise.resolve({ data: null, error: null }),
          single: () => Promise.resolve({ data: null, error: null }),
          then: (resolve: (v: { data: null; error: null }) => unknown) =>
            Promise.resolve({ data: null, error: null }).then(resolve),
        };
        return query;
      };
      return {
        select: chain("select"),
        delete: chain("delete"),
        update: chain("update"),
        upsert: chain("upsert"),
        insert: chain("insert"),
      };
    },
    rpc(name: string, args: Record<string, unknown>) {
      state.calls.push({ kind: "rpc", name, args });
      if (name === "disconnect_integration") {
        return Promise.resolve({ data: null, error: state.disconnectError });
      }
      return Promise.resolve({
        data: [{ allowed: true, remaining: 4, retry_after_seconds: null }],
        error: null,
      });
    },
  };
  return client as unknown as SupabaseClient;
}

function handlerFor(state: State) {
  return createMobileIntegrationSyncHandler({
    createAuthClient: () => ({
      auth: { getUser: () => Promise.resolve({ data: { user: { id: USER_ID } } }) },
    }),
    createAdminClient: () => fakeAdmin(state),
    revoke: {
      fetch: ((input: string | URL | Request) => {
        state.calls.push({ kind: "fetch", url: String(input) });
        return Promise.resolve(new Response("{}", { status: 200 }));
      }) as typeof fetch,
      fitbitClientId: undefined,
      fitbitClientSecret: undefined,
    },
  });
}

function post(body: unknown): Request {
  return new Request("http://localhost/functions/v1/mobile-integration-sync", {
    method: "POST",
    headers: { Authorization: "Bearer user-jwt", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

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

const isDisconnectRpc = (call: Call) => call.kind === "rpc" && call.name === "disconnect_integration";

Deno.test("mobile-integration-sync: disconnect calls disconnect_integration and writes no table directly", async () => {
  for (const provider of ["hevy", "liftosaur"]) {
    const state: State = { calls: [], disconnectError: null };
    const res = await silenced(() => handlerFor(state)(post({ provider, action: "disconnect" })));
    assertEquals(res.status, 200, provider);
    assertEquals(await res.json(), { status: "disconnected" });

    const rpc = state.calls.find(isDisconnectRpc) as Extract<Call, { kind: "rpc" }> | undefined;
    assert(rpc, `${provider}: disconnect_integration called`);
    assertEquals(rpc.args.p_user_id, USER_ID);
    assertEquals(rpc.args.p_provider, provider);
    // The old non-atomic Promise.all wrote oauth_tokens and user_integrations
    // directly; now the RPC does both in one transaction.
    assertEquals(state.calls.filter((c) => c.kind === "from"), [], `${provider}: no direct table access`);
    // API-key providers have no server-side grant to revoke.
    assertEquals(state.calls.filter((c) => c.kind === "fetch"), []);
  }
});

Deno.test("mobile-integration-sync: a disconnect RPC error returns 500, not 'disconnected'", async () => {
  const state: State = { calls: [], disconnectError: { code: "XX000", message: "internal db detail" } };
  const res = await silenced(() => handlerFor(state)(post({ provider: "hevy", action: "disconnect" })));
  assertEquals(res.status, 500);
  const body = await res.json();
  assertEquals(body.status, "error");
  assert(!JSON.stringify(body).includes("internal db detail"), "DB detail not echoed");
  assert(state.calls.some(isDisconnectRpc));
});

Deno.test("mobile-integration-sync: disconnect is not subscription gated", async () => {
  const state: State = { calls: [], disconnectError: null };
  const res = await silenced(() => handlerFor(state)(post({ provider: "hevy", action: "disconnect" })));
  assertEquals(res.status, 200);
  assertEquals(state.calls.filter((c) => c.kind === "from" && c.table === "subscriptions"), []);
});
