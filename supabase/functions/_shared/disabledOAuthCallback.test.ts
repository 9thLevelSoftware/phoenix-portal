import { assertEquals } from "jsr:@std/assert@1";
import { handler as fitbitHandler } from "../fitbit-oauth/index.ts";
import { handler as garminHandler } from "../garmin-oauth/index.ts";

// NF-46: both dormant callbacks are verify_jwt = false, so the handler itself
// must do nothing: 410 for every method and query, no env read, no fetch.
const REQUESTS: Array<[string, RequestInit]> = [
  ["https://example.test/functions/v1/cb?code=abc&state=xyz", { method: "GET" }],
  ["https://example.test/functions/v1/cb?oauth_token=t&oauth_verifier=v", { method: "GET" }],
  ["https://example.test/functions/v1/cb", { method: "POST", body: "code=abc" }],
  ["https://example.test/functions/v1/cb", { method: "OPTIONS" }],
];

for (const [provider, handler] of [["fitbit", fitbitHandler], ["garmin", garminHandler]] as const) {
  Deno.test(`${provider}-oauth answers 410 and touches no secret or provider`, async () => {
    const realGet = Deno.env.get;
    const realFetch = globalThis.fetch;
    const envReads: string[] = [];
    let fetched = false;
    Deno.env.get = (key: string) => {
      envReads.push(key);
      return undefined;
    };
    globalThis.fetch = () => {
      fetched = true;
      return Promise.reject(new Error("no provider call expected"));
    };
    try {
      for (const [url, init] of REQUESTS) {
        const response = await handler(new Request(url, init));
        assertEquals(response.status, 410);
        assertEquals(await response.json(), { error: "provider_unavailable", provider });
      }
    } finally {
      Deno.env.get = realGet;
      globalThis.fetch = realFetch;
    }
    assertEquals(envReads, []);
    assertEquals(fetched, false);
  });
}
