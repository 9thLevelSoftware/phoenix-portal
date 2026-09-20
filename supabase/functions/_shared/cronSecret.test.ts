import { assertEquals } from "jsr:@std/assert@1";
import { hasValidCronSecret } from "./cronSecret.ts";

function req(secret?: string): Request {
  const headers = new Headers();
  if (secret !== undefined) headers.set("x-cron-secret", secret);
  return new Request("http://edge.test/functions/v1/x", { method: "POST", headers });
}

Deno.test("cronSecret: CRON_SECRET matches, wrong or missing header does not", () => {
  const env = (k: string) => ({ CRON_SECRET: "s1" } as Record<string, string>)[k];
  assertEquals(hasValidCronSecret(req("s1"), env), true);
  assertEquals(hasValidCronSecret(req("s2"), env), false);
  assertEquals(hasValidCronSecret(req(), env), false);
});

Deno.test("cronSecret: unset or blank secret never matches, even an empty header", () => {
  assertEquals(hasValidCronSecret(req(""), () => undefined), false);
  assertEquals(hasValidCronSecret(req(""), () => "   "), false);
});

Deno.test("cronSecret: CRON_SECRET wins over legacy names; legacy used only when it is unset", () => {
  const both = (k: string) => ({ CRON_SECRET: "new", LEGACY: "old" } as Record<string, string>)[k];
  assertEquals(hasValidCronSecret(req("old"), both, ["LEGACY"]), false);
  assertEquals(hasValidCronSecret(req("new"), both, ["LEGACY"]), true);
  const legacyOnly = (k: string) => ({ LEGACY: "old" } as Record<string, string>)[k];
  assertEquals(hasValidCronSecret(req("old"), legacyOnly, ["LEGACY"]), true);
});
