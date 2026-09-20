import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import { readLocalIntegrationEnvironment } from "./localIntegrationEnvironment.ts";

function envOf(values: Record<string, string>) {
  return (name: string) => values[name];
}

const localCredentials = {
  SUPABASE_URL: "http://127.0.0.1:54321",
  SUPABASE_ANON_KEY: "anon",
  SUPABASE_SERVICE_ROLE_KEY: "service",
};

Deno.test("local integration env is null when credentials are absent", () => {
  assertEquals(readLocalIntegrationEnvironment(envOf({})), null);
  assertEquals(
    readLocalIntegrationEnvironment(
      envOf({ SUPABASE_URL: "http://127.0.0.1:54321" }),
    ),
    null,
  );
});

Deno.test("local integration env is returned for a local stack", () => {
  for (const url of ["http://127.0.0.1:54321", "http://localhost:54321"]) {
    assertEquals(
      readLocalIntegrationEnvironment(
        envOf({ ...localCredentials, SUPABASE_URL: url }),
      ),
      { url, anonKey: "anon", serviceRoleKey: "service" },
    );
  }
});

Deno.test("local integration env refuses a non-local SUPABASE_URL", () => {
  assertThrows(
    () =>
      readLocalIntegrationEnvironment(
        envOf({ ...localCredentials, SUPABASE_URL: "https://abc.supabase.co" }),
      ),
    Error,
    "non-local",
  );
});

Deno.test("local integration env throws when required but missing", () => {
  assertThrows(
    () =>
      readLocalIntegrationEnvironment(
        envOf({ EDGE_INTEGRATION_REQUIRED: "1" }),
      ),
    Error,
    "EDGE_INTEGRATION_REQUIRED",
  );
});
