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
