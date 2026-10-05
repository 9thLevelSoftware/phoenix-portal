import { assertEquals } from "jsr:@std/assert@1";
import { getCorsHeaders } from "./cors.ts";

Deno.test("CORS Allow-Methods is POST, GET, OPTIONS", () => {
  const headers = getCorsHeaders(
    new Request("https://example.test/functions/v1/x", {
      method: "OPTIONS",
      headers: { origin: "https://evil.example" },
    }),
  );

  assertEquals(headers["Access-Control-Allow-Methods"], "POST, GET, OPTIONS");
});

const EXISTING_EDGE_CSP =
  "default-src 'self'; connect-src 'self' https://*.paddle.com https://*.supabase.co https://api.phoenix-portal.com wss://api.phoenix-portal.com; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'";

Deno.test("Edge CSP appends base-uri, object-src, and frame-ancestors without loosening existing directives", () => {
  const headers = getCorsHeaders(
    new Request("https://example.test/functions/v1/x", {
      method: "GET",
    }),
  );

  assertEquals(
    headers["Content-Security-Policy"],
    `${EXISTING_EDGE_CSP}; base-uri 'none'; object-src 'none'; frame-ancestors 'none'`,
  );
});
