import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  type DnsResolver,
  fetchWebhookTarget,
  isPublicIpAddress,
  ownHostsFromEnv,
  parseWebhookUrl,
  resolveWebhookTarget,
  validateCustomHeader,
  WEBHOOK_REQUEST_TIMEOUT_MS,
  WEBHOOK_URL_MAX_LENGTH,
} from "./webhookTarget.ts";

const OWN_HOSTS = ["abcdefghijklmnopqrst.supabase.co", "phoenix-portal.com"];

function resolver(answers: Record<string, string[]>): DnsResolver {
  return (hostname, recordType) => Promise.resolve(answers[`${hostname}/${recordType}`] ?? []);
}

function codeOf(raw: unknown, ownHosts: readonly string[] = OWN_HOSTS): string {
  const parsed = parseWebhookUrl(raw, ownHosts);
  return parsed.ok ? "ok" : parsed.code;
}

Deno.test("webhookTarget: a public https URL is accepted and its fragment dropped", () => {
  const parsed = parseWebhookUrl("https://hooks.example.com:8443/in?x=1#frag", OWN_HOSTS);

  assert(parsed.ok);
  assertEquals(parsed.normalized, "https://hooks.example.com:8443/in?x=1");
  assertEquals(parsed.hostname, "hooks.example.com");
  assertEquals(parsed.ipLiteral, false);
});

Deno.test("webhookTarget: non-https schemes are refused", () => {
  for (const raw of ["http://hooks.example.com/in", "ftp://hooks.example.com/", "file:///etc/passwd", "javascript:alert(1)"]) {
    assertEquals(codeOf(raw), "url_not_https", raw);
  }
});

Deno.test("webhookTarget: malformed, empty, non-string and whitespace-bearing input is refused", () => {
  for (const raw of ["", "not a url", "https://", 42, null, undefined, {}, "https://hooks.example.com/a b", " https://hooks.example.com/", "https://hooks.example.com/\n"]) {
    assertEquals(codeOf(raw), "url_invalid", String(raw));
  }
  assertEquals(codeOf(`https://hooks.example.com/${"a".repeat(WEBHOOK_URL_MAX_LENGTH)}`), "url_too_long");
});

Deno.test("webhookTarget: credentials in the URL are refused", () => {
  assertEquals(codeOf("https://user:pass@hooks.example.com/"), "url_has_credentials");
  assertEquals(codeOf("https://user@hooks.example.com/"), "url_has_credentials");
});

Deno.test("webhookTarget: only 443 and unprivileged ports are allowed", () => {
  assertEquals(codeOf("https://hooks.example.com/"), "ok");
  assertEquals(codeOf("https://hooks.example.com:443/"), "ok");
  assertEquals(codeOf("https://hooks.example.com:1024/"), "ok");
  assertEquals(codeOf("https://hooks.example.com:65535/"), "ok");
  for (const port of [22, 25, 80, 1023]) {
    assertEquals(codeOf(`https://hooks.example.com:${port}/`), "url_port_not_allowed", String(port));
  }
});

Deno.test("webhookTarget: private, loopback, link-local and reserved IPv4 literals are refused in every spelling", () => {
  const blocked = [
    "127.0.0.1", "127.255.255.254", "10.0.0.1", "172.16.0.1", "172.31.255.255", "192.168.1.1",
    "169.254.169.254", // cloud metadata
    "100.64.0.1", "0.0.0.0", "192.0.2.1", "198.18.0.1", "198.51.100.1", "203.0.113.1",
    "224.0.0.1", "240.0.0.1", "255.255.255.255",
    // Spellings the URL parser canonicalises to the addresses above.
    "2130706433", "0x7f.0.0.1", "0177.0.0.1", "127.1", "0x7f000001", "10.1",
  ];
  for (const host of blocked) {
    assertEquals(codeOf(`https://${host}/`), "url_host_not_allowed", host);
  }
  assertEquals(codeOf("https://93.184.216.34/"), "ok");
  assertEquals(codeOf("https://172.32.0.1/"), "ok");
});

Deno.test("webhookTarget: non-global IPv6 literals are refused, including every IPv4-embedding form", () => {
  const blocked = [
    "[::1]", "[::]", "[fe80::1]", "[fc00::1]", "[fd12:3456:789a::1]", "[ff02::1]",
    "[::ffff:127.0.0.1]", "[::ffff:10.0.0.1]", "[::ffff:93.184.216.34]", "[::ffff:7f00:1]",
    "[64:ff9b::7f00:1]", // NAT64
    "[2002:7f00:1::1]", // 6to4
    "[2001:0:4136:e378:8000:63bf:3fff:fdd2]", // Teredo
    "[2001:db8::1]", // documentation
  ];
  for (const host of blocked) {
    assertEquals(codeOf(`https://${host}/`), "url_host_not_allowed", host);
  }
  assertEquals(codeOf("https://[2606:4700:4700::1111]/"), "ok");
});

Deno.test("webhookTarget: internal names, single labels and trailing dots are refused", () => {
  for (const host of [
    "localhost", "kong", "db", "supabase_kong_phoenix", "app.localhost", "printer.local",
    "vault.internal", "router.lan", "nas.home.arpa", "service.corp", "hooks.example.com.", "hooks.test",
  ]) {
    assertEquals(codeOf(`https://${host}/`), "url_host_not_allowed", host);
  }
});

Deno.test("webhookTarget: this project's own hosts are refused, including sibling hosts carrying the project ref", () => {
  for (const host of [
    "abcdefghijklmnopqrst.supabase.co",
    "abcdefghijklmnopqrst.functions.supabase.co",
    "db.abcdefghijklmnopqrst.supabase.co",
    "phoenix-portal.com",
    "api.phoenix-portal.com",
  ]) {
    assertEquals(codeOf(`https://${host}/functions/v1/delete-account`), "url_host_not_allowed", host);
  }
  // Someone else's project is a legitimate receiver.
  assertEquals(codeOf("https://zyxwvutsrqponmlkjihg.supabase.co/functions/v1/in"), "ok");
});

Deno.test("webhookTarget: own hosts are read from the environment by host name", () => {
  const env: Record<string, string> = {
    SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co",
    SUPABASE_PUBLIC_URL: "https://api.phoenix-portal.com",
    APP_URL: "https://phoenix-portal.com/",
  };

  const hosts = ownHostsFromEnv((name) => env[name]);

  assertEquals(hosts.sort(), ["abcdefghijklmnopqrst.supabase.co", "api.phoenix-portal.com", "phoenix-portal.com"]);
  assertEquals(ownHostsFromEnv(() => undefined), []);
});

Deno.test("webhookTarget: a name resolving only to public addresses is accepted", async () => {
  const dns = resolver({
    "hooks.example.com/A": ["93.184.216.34"],
    "hooks.example.com/AAAA": ["2606:4700:4700::1111"],
  });

  const target = await resolveWebhookTarget("https://hooks.example.com/in", OWN_HOSTS, dns);

  assert(target.ok);
  assertEquals(target.normalized, "https://hooks.example.com/in");
});

Deno.test("webhookTarget: one private address among public ones is a refusal", async () => {
  const cases: Array<Record<string, string[]>> = [
    { "hooks.example.com/A": ["93.184.216.34", "10.0.0.5"] },
    { "hooks.example.com/A": ["169.254.169.254"] },
    { "hooks.example.com/A": ["93.184.216.34"], "hooks.example.com/AAAA": ["::1"] },
    { "hooks.example.com/AAAA": ["::ffff:127.0.0.1"] },
    { "hooks.example.com/A": ["127.0.0.1"] },
  ];
  for (const answers of cases) {
    const target = await resolveWebhookTarget("https://hooks.example.com/in", OWN_HOSTS, resolver(answers));

    assertEquals(target.ok ? "ok" : target.code, "url_resolves_to_private_address", JSON.stringify(answers));
  }
});

Deno.test("webhookTarget: a resolver error or an empty answer fails closed", async () => {
  const failing: DnsResolver = () => Promise.reject(new Error("resolver down"));

  const failed = await resolveWebhookTarget("https://hooks.example.com/in", OWN_HOSTS, failing);
  const empty = await resolveWebhookTarget("https://hooks.example.com/in", OWN_HOSTS, resolver({}));

  assertEquals(failed.ok ? "ok" : failed.code, "dns_failed");
  assertEquals(empty.ok ? "ok" : empty.code, "dns_failed");
});

Deno.test("webhookTarget: a syntactically refused URL is never resolved", async () => {
  let lookups = 0;
  const counting: DnsResolver = () => {
    lookups += 1;
    return Promise.resolve(["93.184.216.34"]);
  };

  await resolveWebhookTarget("http://hooks.example.com/in", OWN_HOSTS, counting);
  await resolveWebhookTarget("https://localhost/in", OWN_HOSTS, counting);
  await resolveWebhookTarget("https://10.0.0.1/in", OWN_HOSTS, counting);

  assertEquals(lookups, 0);
});

Deno.test("webhookTarget: the fetch is a POST that does not follow redirects and has a timeout", async () => {
  let seen: RequestInit | undefined;
  let seenUrl = "";
  const fetchImpl = ((input: string | URL | Request, init?: RequestInit) => {
    seenUrl = String(input);
    seen = init;
    return Promise.resolve(new Response(null, { status: 204 }));
  }) as typeof fetch;

  await fetchWebhookTarget(fetchImpl, "https://hooks.example.com/in", {
    headers: { "content-type": "application/json" },
    body: "{}",
  });

  assertEquals(seenUrl, "https://hooks.example.com/in");
  assertEquals(seen?.method, "POST");
  assertEquals(seen?.redirect, "manual");
  assertEquals(seen?.body, "{}");
  assert(seen?.signal instanceof AbortSignal);
  assert(WEBHOOK_REQUEST_TIMEOUT_MS <= 10_000);
});

Deno.test("webhookTarget: address classification treats unparseable input as not public", () => {
  for (const address of ["", "999.1.1.1", "1.2.3", "01.2.3.4", "fe80::1%eth0", "gggg::1", "1:2:3:4:5:6:7:8:9", "::1::2"]) {
    assertEquals(isPublicIpAddress(address), false, address);
  }
  assertEquals(isPublicIpAddress("8.8.8.8"), true);
  assertEquals(isPublicIpAddress("2606:4700:4700::1111"), true);
});

Deno.test("webhookTarget: a custom header must be a plain, non-reserved name with a printable value", () => {
  assertEquals(validateCustomHeader("Authorization", "Bearer abc.def"), {
    ok: true,
    name: "Authorization",
    value: "Bearer abc.def",
  });
  assertEquals(validateCustomHeader("X-Api-Key", "k"), { ok: true, name: "X-Api-Key", value: "k" });

  for (const name of ["", "1abc", "bad name", "bad:name", "a".repeat(65), "x\r\ny", 7]) {
    const result = validateCustomHeader(name, "v");
    assertEquals(result.ok ? "ok" : result.code, "header_name_invalid", String(name));
  }
  for (const name of [
    "Host", "content-type", "Content-Length", "Transfer-Encoding", "Connection", "Cookie", "User-Agent",
    "webhook-signature", "Webhook-Id", "Proxy-Authorization", "X-Forwarded-For", "Sec-Fetch-Mode",
  ]) {
    const result = validateCustomHeader(name, "v");
    assertEquals(result.ok ? "ok" : result.code, "header_name_reserved", name);
  }
  for (const value of ["", "a\r\nX-Injected: 1", "a\nb", "tab\there", "café", "a".repeat(513), 5, null]) {
    const result = validateCustomHeader("Authorization", value);
    assertEquals(result.ok ? "ok" : result.code, "header_value_invalid", String(value));
  }
});
