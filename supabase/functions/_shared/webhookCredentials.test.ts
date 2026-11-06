import { assertEquals } from "jsr:@std/assert@1";
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { FakeDb, fakeClient, type Row } from "./testing/fakeSupabase.ts";
import { testWebhookSecret } from "./testing/webhookSecrets.ts";
import { loadWebhookCredentials } from "./webhookCredentials.ts";

const USER_A = "aaaaaaaa-0000-4000-8000-00000000000a";
const USER_B = "bbbbbbbb-0000-4000-8000-00000000000b";
const ENDPOINT = "eeeeeeee-0000-4000-8000-00000000000a";
const NOW = new Date("2026-11-06T12:00:00.000Z");
const CURRENT = testWebhookSecret("a");
const PREVIOUS = testWebhookSecret("b");

const encrypt = (plain: string) => `enc:test:${btoa(plain)}`;
const decrypt = (stored: string) => {
  if (stored === "enc:test:unreadable") return Promise.reject(new Error("oauth_token_decrypt_failed"));
  return Promise.resolve(atob(stored.replace("enc:test:", "")));
};

function load(row: Row | null, overrides: { userId?: string; customHeaderName?: string | null } = {}) {
  const db = new FakeDb({ webhook_endpoint_secrets: row ? [row] : [] });
  return loadWebhookCredentials(
    fakeClient(db) as unknown as SupabaseClient,
    {
      userId: overrides.userId ?? USER_A,
      endpointId: ENDPOINT,
      customHeaderName: overrides.customHeaderName ?? null,
      now: NOW,
    },
    decrypt,
  );
}

function secretRow(overrides: Row = {}): Row {
  return {
    endpoint_id: ENDPOINT,
    user_id: USER_A,
    signing_secret_enc: encrypt(CURRENT),
    previous_signing_secret_enc: null,
    previous_expires_at: null,
    custom_header_value_enc: null,
    ...overrides,
  };
}

Deno.test("webhookCredentials: the current secret alone is returned when there is no rotation in progress", async () => {
  const result = await load(secretRow());

  assertEquals(result, { ok: true, credentials: { secrets: [CURRENT], customHeader: null } });
});

Deno.test("webhookCredentials: a previous secret inside its overlap is returned after the current one", async () => {
  const result = await load(secretRow({
    previous_signing_secret_enc: encrypt(PREVIOUS),
    previous_expires_at: "2026-11-07T00:00:00.000Z",
  }));

  assertEquals(result.ok && result.credentials.secrets, [CURRENT, PREVIOUS]);
});

Deno.test("webhookCredentials: a previous secret past its overlap is not used", async () => {
  const result = await load(secretRow({
    previous_signing_secret_enc: encrypt(PREVIOUS),
    previous_expires_at: "2026-11-06T11:59:59.000Z",
  }));

  assertEquals(result.ok && result.credentials.secrets, [CURRENT]);
});

Deno.test("webhookCredentials: an unreadable previous secret does not stop signing with the current one", async () => {
  const result = await load(secretRow({
    previous_signing_secret_enc: "enc:test:unreadable",
    previous_expires_at: "2026-11-07T00:00:00.000Z",
  }));

  assertEquals(result, { ok: true, credentials: { secrets: [CURRENT], customHeader: null } });
});

Deno.test("webhookCredentials: an unreadable current secret is a failure, never an unsigned delivery", async () => {
  const result = await load(secretRow({ signing_secret_enc: "enc:test:unreadable" }));

  assertEquals(result, { ok: false, reason: "decrypt_failed" });
});

Deno.test("webhookCredentials: the header value is returned only with the name the endpoint carries", async () => {
  const row = secretRow({ custom_header_value_enc: encrypt("Bearer receiver") });

  const named = await load(row, { customHeaderName: "Authorization" });
  const unnamed = await load(row, { customHeaderName: null });

  assertEquals(named.ok && named.credentials.customHeader, { name: "Authorization", value: "Bearer receiver" });
  assertEquals(unnamed.ok && unnamed.credentials.customHeader, null);
});

Deno.test("webhookCredentials: an unreadable header value is a failure, not a delivery without the header", async () => {
  const result = await load(secretRow({ custom_header_value_enc: "enc:test:unreadable" }), {
    customHeaderName: "Authorization",
  });

  assertEquals(result, { ok: false, reason: "decrypt_failed" });
});

Deno.test("webhookCredentials: another user's id finds nothing", async () => {
  const result = await load(secretRow(), { userId: USER_B });

  assertEquals(result, { ok: false, reason: "not_found" });
});
