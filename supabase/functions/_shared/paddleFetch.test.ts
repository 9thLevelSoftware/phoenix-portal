import { assertEquals } from "jsr:@std/assert@1";
import { PADDLE_API_TIMEOUT_MS, fetchPaddle, paddleApiBase } from "./paddleFetch.ts";

const FUNCTIONS_DIR = new URL("../", import.meta.url);

Deno.test("fetchPaddle forwards the request and always applies the shared timeout", async () => {
  const caller = new AbortController().signal;
  let seen: RequestInit | undefined;
  const fetchImpl: typeof fetch = (_input, init) => {
    seen = init;
    return Promise.resolve(new Response(null, { status: 204 }));
  };

  const response = await fetchPaddle(fetchImpl, "https://api.paddle.com/subscriptions/sub_1", {
    method: "PATCH",
    headers: { Authorization: "Bearer test", "Content-Type": "application/json" },
    body: '{"items":[]}',
    signal: caller,
  });

  assertEquals(response.status, 204);
  assertEquals(seen?.method, "PATCH");
  assertEquals(seen?.body, '{"items":[]}');
  assertEquals(new Headers(seen?.headers).get("Authorization"), "Bearer test");
  assertEquals(seen?.signal instanceof AbortSignal, true);
  assertEquals(seen?.signal === caller, false);
  assertEquals(seen?.signal?.aborted, false);
});

Deno.test("fetchPaddle asks AbortSignal.timeout for the shared 10s bound", async () => {
  const original = AbortSignal.timeout;
  const seen: number[] = [];
  Object.defineProperty(AbortSignal, "timeout", {
    configurable: true,
    writable: true,
    value: (milliseconds: number) => {
      seen.push(milliseconds);
      return original.call(AbortSignal, milliseconds);
    },
  });
  try {
    const fetchImpl: typeof fetch = () => Promise.resolve(new Response(null, { status: 204 }));
    await fetchPaddle(fetchImpl, "https://api.paddle.com/subscriptions/sub_1", { method: "GET" });
    assertEquals(seen, [PADDLE_API_TIMEOUT_MS]);
    assertEquals(PADDLE_API_TIMEOUT_MS, 10_000);
  } finally {
    Object.defineProperty(AbortSignal, "timeout", {
      configurable: true,
      writable: true,
      value: original,
    });
  }
});

Deno.test("fetchPaddle surfaces a timeout rejection unchanged", async () => {
  const timeout = new DOMException("The operation was aborted due to timeout", "TimeoutError");
  const fetchImpl: typeof fetch = () => Promise.reject(timeout);
  try {
    await fetchPaddle(fetchImpl, "https://api.paddle.com/subscriptions/sub_1");
    throw new Error("expected the timeout rejection to propagate");
  } catch (error) {
    assertEquals(error, timeout);
  }
});

async function productionSources(dir: URL): Promise<string[]> {
  const files: string[] = [];
  for await (const entry of Deno.readDir(dir)) {
    const url = new URL(entry.name, dir);
    if (entry.isDirectory) {
      if (entry.name === "node_modules") continue;
      files.push(...await productionSources(new URL(`${entry.name}/`, dir)));
    } else if (entry.isFile && entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
      files.push(url.pathname);
    }
  }
  return files;
}

function isPaddleClient(path: string, source: string): boolean {
  return path.includes("/paddle-") ||
    path.includes("/paddle") ||
    path.endsWith("/accountPurge.ts") ||
    source.includes("api.paddle.com") ||
    source.includes("sandbox-api.paddle.com");
}

function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/** Direct Paddle fetches left after the shared helper and the dependency default are removed. */
function rawPaddleFetches(source: string): string[] {
  const code = withoutComments(source);
  const withoutHelper = code.replace(
    /fetchPaddle\s*\(\s*(deps\.fetch|fetchImpl)\b/g,
    "WRAPPED_FETCH",
  );
  const withoutDefaults = withoutHelper.replace(
    /fetch:\s*\(input,\s*init\)\s*=>\s*fetch\(input,\s*init\)/g,
    "DEFAULT_FETCH",
  );
  const violations: string[] = [];
  if (withoutDefaults.includes("AbortSignal.timeout")) violations.push("inline AbortSignal.timeout");
  if (/\b(?:deps\.fetch|fetchImpl)\s*\(/.test(withoutDefaults)) {
    violations.push("unwrapped deps.fetch or fetchImpl");
  }
  if (/\bfetch\s*\(/.test(withoutDefaults)) violations.push("direct fetch()");
  return violations;
}

Deno.test("paddleApiBase selects sandbox only for the exact environment string", () => {
  assertEquals(paddleApiBase("sandbox"), "https://sandbox-api.paddle.com");
  assertEquals(paddleApiBase("production"), "https://api.paddle.com");
  assertEquals(paddleApiBase(undefined), "https://api.paddle.com");
  assertEquals(paddleApiBase(""), "https://api.paddle.com");
  assertEquals(paddleApiBase("Sandbox"), "https://api.paddle.com");
});

Deno.test("the Paddle API base URL is chosen only in paddleFetch", async () => {
  const owners: string[] = [];
  for (const path of await productionSources(FUNCTIONS_DIR)) {
    const source = withoutComments(await Deno.readTextFile(path));
    if (source.includes("https://sandbox-api.paddle.com") || source.includes("https://api.paddle.com")) {
      owners.push(path);
    }
  }
  assertEquals(owners.map((path) => path.split("/").pop()), ["paddleFetch.ts"]);
});

Deno.test("every Paddle Billing fetch goes through fetchPaddle", async () => {
  const violations: string[] = [];
  for (const path of await productionSources(FUNCTIONS_DIR)) {
    if (path.endsWith("/paddleFetch.ts")) continue;
    const source = await Deno.readTextFile(path);
    if (!isPaddleClient(path, source)) continue;
    for (const violation of rawPaddleFetches(source)) violations.push(`${path}: ${violation}`);
  }
  assertEquals(violations, []);
});
