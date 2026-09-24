/**
 * Test-only gate for real-SQL Edge integration tests (imported by *.test.ts
 * files only; never by a function entrypoint).
 *
 * Contract for every real-SQL test (run in CI by
 * `.github/workflows/edge-integration.yml` via `npm run test:edge:integration`):
 *   1. Name it with the `INTEGRATION_TEST_PREFIX` prefix: "integration: ...".
 *   2. Gate it with `ignore: localIntegrationEnvironment === null`, importing
 *      `localIntegrationEnvironment` from this module.
 * `scripts/test-edge-functions.mjs` fails if a file has more such gates than
 * "integration: " names, and fails the integration run if any selected test
 * is ignored or none ran.
 *
 * The environment is non-null only when SUPABASE_URL, SUPABASE_ANON_KEY and
 * SUPABASE_SERVICE_ROLE_KEY are all set. The fixtures create and delete auth
 * users with the service-role key, so a non-local SUPABASE_URL throws at import
 * time instead of running (this also covers direct `deno test` / editor runs
 * that bypass the npm script). When EDGE_INTEGRATION_REQUIRED=1 (set by
 * `test:edge:integration`), missing credentials throw instead of silently
 * ignoring the tests.
 */

export const INTEGRATION_TEST_PREFIX = "integration: ";

export interface LocalIntegrationEnvironment {
  url: string;
  anonKey: string;
  serviceRoleKey: string;
  /**
   * The local stack's Postgres URL (SUPABASE_DB_URL), for the tests that open
   * a direct connection (the single-transaction push). Optional: only those
   * tests require it, and they fail loudly without it.
   */
  dbUrl?: string;
}

const LOCAL_HOSTNAMES = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

export function readLocalIntegrationEnvironment(
  get: (name: string) => string | undefined = (name) => Deno.env.get(name),
): LocalIntegrationEnvironment | null {
  const url = get("SUPABASE_URL");
  const anonKey = get("SUPABASE_ANON_KEY");
  const serviceRoleKey = get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anonKey || !serviceRoleKey) {
    if (get("EDGE_INTEGRATION_REQUIRED") === "1") {
      throw new Error(
        "EDGE_INTEGRATION_REQUIRED=1 but SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY are not all set",
      );
    }
    return null;
  }
  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    throw new Error("SUPABASE_URL is not a valid URL");
  }
  if (!LOCAL_HOSTNAMES.has(hostname)) {
    throw new Error(
      `Refusing real-SQL integration tests against non-local SUPABASE_URL host "${hostname}"`,
    );
  }
  const dbUrl = get("SUPABASE_DB_URL");
  if (dbUrl) {
    let dbHost: string;
    try {
      dbHost = new URL(dbUrl).hostname;
    } catch {
      throw new Error("SUPABASE_DB_URL is not a valid URL");
    }
    if (!LOCAL_HOSTNAMES.has(dbHost)) {
      throw new Error(
        `Refusing real-SQL integration tests against non-local SUPABASE_DB_URL host "${dbHost}"`,
      );
    }
  }
  return { url, anonKey, serviceRoleKey, ...(dbUrl ? { dbUrl } : {}) };
}

export const localIntegrationEnvironment: LocalIntegrationEnvironment | null =
  readLocalIntegrationEnvironment();
