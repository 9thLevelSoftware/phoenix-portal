/**
 * Where an outbound data-sharing webhook may be sent (SSRF guard).
 *
 * This is the only place in the code base that makes a request to a URL a
 * user chose. Every other outbound fetch goes to a fixed provider host.
 *
 * Rules, all enforced here and nowhere else:
 *   - https only, no credentials in the URL, port 443 or 1024-65535;
 *   - the host must be a public DNS name or a public IP literal: loopback,
 *     private, link-local (cloud metadata), CGNAT, ULA, multicast, reserved
 *     and IPv4-mapped / translated IPv6 ranges are refused, as are single-label
 *     names, internal suffixes and this project's own hosts;
 *   - every address the name resolves to must be public, checked when the
 *     endpoint is saved and again before every delivery; a resolver error
 *     fails closed;
 *   - redirects are never followed, the request times out, and the response
 *     body is never read.
 *
 * RESIDUAL RISK (not closed here): the runtime's fetch resolves the name
 * again and cannot be pinned to the address that was checked, so a host that
 * answers the check with a public address and the connection with a private
 * one (DNS rebinding) can still be aimed at an internal address. What bounds
 * it: the request is https with certificate validation, so an internal
 * service would have to present a certificate valid for the attacker's name;
 * the request carries no Supabase credential (webhookSend.test.ts asserts
 * it); nothing from the response beyond its status code is kept; and every
 * failure before an HTTP status is reported as one code, `connection_failed`,
 * so it is not a port scanner.
 */

export const WEBHOOK_URL_MAX_LENGTH = 2048;
export const WEBHOOK_REQUEST_TIMEOUT_MS = 10_000;
/** A resolver that does not answer in this long counts as a failed lookup. */
export const WEBHOOK_DNS_TIMEOUT_MS = 5_000;

export type WebhookTargetRejection =
  | 'url_invalid'
  | 'url_too_long'
  | 'url_not_https'
  | 'url_has_credentials'
  | 'url_port_not_allowed'
  | 'url_host_not_allowed'
  | 'url_resolves_to_private_address'
  | 'dns_failed';

/** Messages safe to show the endpoint's owner. */
export const WEBHOOK_TARGET_MESSAGES: Record<WebhookTargetRejection, string> = {
  url_invalid: 'Enter a valid URL.',
  url_too_long: `The URL must be at most ${WEBHOOK_URL_MAX_LENGTH} characters.`,
  url_not_https: 'The URL must start with https://.',
  url_has_credentials: 'The URL must not contain a username or password. Use the custom header instead.',
  url_port_not_allowed: 'Use port 443 or a port from 1024 to 65535.',
  url_host_not_allowed: 'That host cannot be used as a data sharing endpoint.',
  url_resolves_to_private_address: 'That host resolves to a private or reserved address.',
  dns_failed: 'The host name could not be resolved. Check it and try again.',
};

/** Resolves a name to addresses of one family; no records is an empty list. */
export type DnsResolver = (hostname: string, recordType: 'A' | 'AAAA') => Promise<string[]>;

/** The Edge runtime's resolver. "No records" is an answer, not a failure. */
export const systemDnsResolver: DnsResolver = async (hostname, recordType) => {
  try {
    return await Deno.resolveDns(hostname, recordType);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return [];
    throw error;
  }
};

const BLOCKED_SUFFIXES = [
  'localhost',
  'local',
  'internal',
  'intranet',
  'lan',
  'home',
  'corp',
  'home.arpa',
  'test',
  'invalid',
  'example',
  'onion',
];

function parseIpv4(host: string): number[] | null {
  const parts = host.split('.');
  if (parts.length !== 4) return null;
  const octets: number[] = [];
  for (const part of parts) {
    if (!/^(0|[1-9][0-9]{0,2})$/.test(part)) return null;
    const value = Number(part);
    if (value > 255) return null;
    octets.push(value);
  }
  return octets;
}

/** True only for globally routable unicast IPv4. */
export function isPublicIpv4(address: string): boolean {
  const octets = parseIpv4(address);
  if (!octets) return false;
  const [a, b, c] = octets;
  if (a === 0) return false; // "this network"
  if (a === 10) return false; // private
  if (a === 100 && b >= 64 && b <= 127) return false; // CGNAT
  if (a === 127) return false; // loopback
  if (a === 169 && b === 254) return false; // link-local, cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return false; // private
  if (a === 192 && b === 0 && c === 0) return false; // IETF protocol assignments
  if (a === 192 && b === 0 && c === 2) return false; // documentation
  if (a === 192 && b === 88 && c === 99) return false; // 6to4 relay
  if (a === 192 && b === 168) return false; // private
  if (a === 198 && (b === 18 || b === 19)) return false; // benchmarking
  if (a === 198 && b === 51 && c === 100) return false; // documentation
  if (a === 203 && b === 0 && c === 113) return false; // documentation
  if (a >= 224) return false; // multicast, reserved, broadcast
  return true;
}

/** Eight 16-bit groups, or null when `address` is not IPv6. */
function parseIpv6(address: string): number[] | null {
  let text = address;
  if (text.includes('%')) return null; // zone ids are never public
  // An embedded IPv4 tail (::ffff:1.2.3.4) becomes two groups.
  const lastColon = text.lastIndexOf(':');
  if (lastColon === -1) return null;
  const tail = text.slice(lastColon + 1);
  if (tail.includes('.')) {
    const v4 = parseIpv4(tail);
    if (!v4) return null;
    const high = ((v4[0] << 8) | v4[1]).toString(16);
    const low = ((v4[2] << 8) | v4[3]).toString(16);
    text = `${text.slice(0, lastColon + 1)}${high}:${low}`;
  }
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const parseGroups = (part: string): number[] | null => {
    if (part === '') return [];
    const groups: number[] = [];
    for (const group of part.split(':')) {
      if (!/^[0-9a-fA-F]{1,4}$/.test(group)) return null;
      groups.push(Number.parseInt(group, 16));
    }
    return groups;
  };
  const head = parseGroups(halves[0]);
  const rest = halves.length === 2 ? parseGroups(halves[1]) : [];
  if (!head || !rest) return null;
  if (halves.length === 1) return head.length === 8 ? head : null;
  const missing = 8 - head.length - rest.length;
  if (missing < 1) return null;
  return [...head, ...new Array<number>(missing).fill(0), ...rest];
}

/**
 * True only for global unicast IPv6 (2000::/3) outside the ranges that embed
 * or tunnel an IPv4 address or are reserved. Anything that could smuggle a
 * private IPv4 address (mapped, NAT64, 6to4, Teredo) is refused outright
 * rather than unpacked.
 */
export function isPublicIpv6(address: string): boolean {
  const groups = parseIpv6(address);
  if (!groups) return false;
  const [first, second] = groups;
  if ((first & 0xe000) !== 0x2000) return false; // not 2000::/3: ::, ::1, mapped, NAT64, ULA, link-local, multicast
  if (first === 0x2001 && second === 0x0db8) return false; // documentation
  if (first === 0x2001 && second === 0x0000) return false; // Teredo
  if (first === 0x2001 && second >= 0x0010 && second <= 0x002f) return false; // ORCHID
  if (first === 0x2002) return false; // 6to4
  if (first === 0x3fff && second <= 0x0fff) return false; // documentation
  return true;
}

export function isPublicIpAddress(address: string): boolean {
  return address.includes(':') ? isPublicIpv6(address) : isPublicIpv4(address);
}

function isIpLiteral(hostname: string): boolean {
  return hostname.startsWith('[') || parseIpv4(hostname) !== null;
}

function hostOf(value: string | undefined | null): string | null {
  if (!value) return null;
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * This project's own hosts, which an endpoint may never point at: the
 * Supabase API (and any sibling host carrying the project ref) and the portal.
 */
export function ownHostsFromEnv(env: (name: string) => string | undefined): string[] {
  const hosts = new Set<string>();
  for (const name of ['SUPABASE_URL', 'SUPABASE_PUBLIC_URL', 'APP_URL']) {
    const host = hostOf(env(name));
    if (host) hosts.add(host);
  }
  return [...hosts];
}

function matchesOwnHost(hostname: string, ownHosts: readonly string[]): boolean {
  for (const own of ownHosts) {
    if (hostname === own || hostname.endsWith(`.${own}`)) return true;
    // <ref>.supabase.co also answers as <ref>.functions.supabase.co,
    // db.<ref>.supabase.co, ...: refuse any host carrying the project ref.
    if (own.endsWith('.supabase.co')) {
      const ref = own.split('.')[0];
      if (ref.length >= 12 && hostname.split('.').includes(ref)) return true;
    }
  }
  return false;
}

export type ParsedWebhookTarget =
  | { ok: true; url: URL; normalized: string; hostname: string; ipLiteral: boolean }
  | { ok: false; code: WebhookTargetRejection };

/** Syntactic checks only; resolveWebhookTarget adds the DNS check. */
export function parseWebhookUrl(raw: unknown, ownHosts: readonly string[] = []): ParsedWebhookTarget {
  if (typeof raw !== 'string' || raw.length === 0) return { ok: false, code: 'url_invalid' };
  if (raw.length > WEBHOOK_URL_MAX_LENGTH) return { ok: false, code: 'url_too_long' };
  // Whitespace and control characters are stripped by the URL parser; a URL
  // that needs that is not what the user thinks it is.
  // deno-lint-ignore no-control-regex
  if (/[\s\u0000-\u001f\u007f]/.test(raw)) return { ok: false, code: 'url_invalid' };

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, code: 'url_invalid' };
  }
  if (url.protocol !== 'https:') return { ok: false, code: 'url_not_https' };
  if (url.username !== '' || url.password !== '') return { ok: false, code: 'url_has_credentials' };
  if (url.port !== '') {
    const port = Number(url.port);
    if (!Number.isInteger(port) || port < 1024 || port > 65535) {
      return { ok: false, code: 'url_port_not_allowed' };
    }
  }

  // The parser has already canonicalised odd IPv4 spellings (decimal, hex,
  // short forms) into dotted quads, so the checks below see the real address.
  const hostname = url.hostname.toLowerCase();
  if (hostname === '' || hostname.endsWith('.')) return { ok: false, code: 'url_host_not_allowed' };

  const ipLiteral = isIpLiteral(hostname);
  if (ipLiteral) {
    const address = hostname.startsWith('[') ? hostname.slice(1, -1) : hostname;
    if (!isPublicIpAddress(address)) return { ok: false, code: 'url_host_not_allowed' };
  } else {
    const labels = hostname.split('.');
    // Single-label names (kong, db, a container name) only resolve internally.
    if (labels.length < 2) return { ok: false, code: 'url_host_not_allowed' };
    // A numeric last label is an address the parser declined to canonicalise.
    if (/^[0-9]+$/.test(labels[labels.length - 1])) return { ok: false, code: 'url_host_not_allowed' };
    for (const suffix of BLOCKED_SUFFIXES) {
      if (hostname === suffix || hostname.endsWith(`.${suffix}`)) {
        return { ok: false, code: 'url_host_not_allowed' };
      }
    }
  }
  if (matchesOwnHost(hostname, ownHosts)) return { ok: false, code: 'url_host_not_allowed' };

  url.hash = '';
  return { ok: true, url, normalized: url.toString(), hostname, ipLiteral };
}

export type ResolvedWebhookTarget =
  | { ok: true; url: URL; normalized: string }
  | { ok: false; code: WebhookTargetRejection };

/**
 * parseWebhookUrl plus: every address the host resolves to must be public.
 * One private answer among public ones is a refusal, since the connection
 * may use any of them. A resolver error, or no address at all, fails closed.
 */
function withDeadline<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('dns_timeout')), ms);
  });
  return Promise.race([work, deadline]).finally(() => clearTimeout(timer));
}

export async function resolveWebhookTarget(
  raw: unknown,
  ownHosts: readonly string[],
  resolveDns: DnsResolver,
  dnsTimeoutMs: number = WEBHOOK_DNS_TIMEOUT_MS,
): Promise<ResolvedWebhookTarget> {
  const parsed = parseWebhookUrl(raw, ownHosts);
  if (!parsed.ok) return parsed;
  if (parsed.ipLiteral) return { ok: true, url: parsed.url, normalized: parsed.normalized };

  let addresses: string[];
  try {
    // The request timeout only starts once the fetch does; without a
    // deadline here a resolver that hangs would hold a delivery, and the
    // worker pass it belongs to, for as long as it liked.
    const [v4, v6] = await withDeadline(
      Promise.all([
        resolveDns(parsed.hostname, 'A'),
        resolveDns(parsed.hostname, 'AAAA'),
      ]),
      dnsTimeoutMs,
    );
    addresses = [...v4, ...v6];
  } catch {
    return { ok: false, code: 'dns_failed' };
  }
  if (addresses.length === 0) return { ok: false, code: 'dns_failed' };
  if (!addresses.every(isPublicIpAddress)) {
    return { ok: false, code: 'url_resolves_to_private_address' };
  }
  return { ok: true, url: parsed.url, normalized: parsed.normalized };
}

/**
 * The only fetch to a user-chosen URL. Redirects are returned, not followed
 * (a 3xx could point anywhere, including back inside), and the call is timed
 * out. Callers must not read the response body.
 */
export function fetchWebhookTarget(
  fetchImpl: typeof fetch,
  url: string,
  init: { headers: Record<string, string>; body: string },
): Promise<Response> {
  return fetchImpl(url, {
    method: 'POST',
    headers: init.headers,
    body: init.body,
    redirect: 'manual',
    signal: AbortSignal.timeout(WEBHOOK_REQUEST_TIMEOUT_MS),
  });
}

const CUSTOM_HEADER_NAME = /^[A-Za-z][A-Za-z0-9-]{0,63}$/;
const CUSTOM_HEADER_VALUE = /^[\x20-\x7E]{1,512}$/;
const RESERVED_HEADER_NAMES = new Set([
  'host',
  'connection',
  'keep-alive',
  'upgrade',
  'te',
  'trailer',
  'transfer-encoding',
  'expect',
  'cookie',
  'user-agent',
  'origin',
  'referer',
  'forwarded',
  'via',
]);
const RESERVED_HEADER_PREFIXES = ['content-', 'proxy-', 'sec-', 'webhook-', 'x-forwarded-'];

export type CustomHeaderRejection = 'header_name_invalid' | 'header_name_reserved' | 'header_value_invalid';

export const CUSTOM_HEADER_MESSAGES: Record<CustomHeaderRejection, string> = {
  header_name_invalid: 'The header name may contain only letters, digits and hyphens, and must start with a letter.',
  header_name_reserved: 'That header is set by the portal and cannot be overridden.',
  header_value_invalid: 'The header value must be 1 to 512 printable ASCII characters.',
};

/**
 * One header the user may add for receivers that cannot verify a signature
 * (for example `Authorization`). No CR/LF or control characters: a value is
 * sent as a header, never interpreted.
 */
export function validateCustomHeader(
  name: unknown,
  value: unknown,
): { ok: true; name: string; value: string } | { ok: false; code: CustomHeaderRejection } {
  if (typeof name !== 'string' || !CUSTOM_HEADER_NAME.test(name)) {
    return { ok: false, code: 'header_name_invalid' };
  }
  const lower = name.toLowerCase();
  if (RESERVED_HEADER_NAMES.has(lower) || RESERVED_HEADER_PREFIXES.some((prefix) => lower.startsWith(prefix))) {
    return { ok: false, code: 'header_name_reserved' };
  }
  if (typeof value !== 'string' || !CUSTOM_HEADER_VALUE.test(value)) {
    return { ok: false, code: 'header_value_invalid' };
  }
  return { ok: true, name, value };
}
