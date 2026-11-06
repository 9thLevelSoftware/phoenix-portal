/**
 * Signing for outbound data-sharing webhooks, in the Standard Webhooks format
 * (https://www.standardwebhooks.com) so a receiver can verify with an
 * off-the-shelf library instead of code we would have to document and support.
 *
 *   webhook-id:        unique per delivery; the receiver's idempotency key
 *   webhook-timestamp: unix seconds; the receiver rejects stale ones (replay)
 *   webhook-signature: space-separated `v1,<base64 HMAC-SHA256>` entries
 *
 * The signed content is `${id}.${timestamp}.${body}` and the HMAC key is the
 * base64-DECODED bytes after the `whsec_` prefix, not the literal string.
 * webhookSigning.test.ts pins that with the specification's reference vector:
 * signing with the literal string produces a signature every reference
 * verifier rejects.
 */

export const WEBHOOK_SECRET_PREFIX = 'whsec_';
const SECRET_BYTES = 32;

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** A new signing secret: `whsec_` + base64 of 32 random bytes. */
export function generateWebhookSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(SECRET_BYTES));
  return `${WEBHOOK_SECRET_PREFIX}${bytesToBase64(bytes)}`;
}

/** The last four characters, shown so the user can tell two secrets apart. */
export function webhookSecretHint(secret: string): string {
  return secret.slice(-4);
}

function secretKeyBytes(secret: string): Uint8Array {
  if (!secret.startsWith(WEBHOOK_SECRET_PREFIX)) {
    throw new Error('webhook_secret_malformed');
  }
  let bytes: Uint8Array;
  try {
    bytes = base64ToBytes(secret.slice(WEBHOOK_SECRET_PREFIX.length));
  } catch {
    throw new Error('webhook_secret_malformed');
  }
  if (bytes.length < 24) throw new Error('webhook_secret_malformed');
  return bytes;
}

/** One `v1,<base64>` signature entry. */
export async function signWebhook(
  secret: string,
  id: string,
  timestampSeconds: number,
  body: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    secretKeyBytes(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signed = new TextEncoder().encode(`${id}.${timestampSeconds}.${body}`);
  const signature = await crypto.subtle.sign('HMAC', key, signed);
  return `v1,${bytesToBase64(new Uint8Array(signature))}`;
}

/**
 * The three signing headers. `secrets` is the current secret followed by any
 * previous one still inside its rotation overlap: the receiver accepts the
 * delivery if any entry verifies, so a rotation drops no events.
 */
export async function webhookSignatureHeaders(
  secrets: readonly string[],
  id: string,
  now: Date,
  body: string,
): Promise<Record<string, string>> {
  if (secrets.length === 0) throw new Error('webhook_secret_missing');
  const timestampSeconds = Math.floor(now.getTime() / 1000);
  const signatures: string[] = [];
  for (const secret of secrets) {
    signatures.push(await signWebhook(secret, id, timestampSeconds, body));
  }
  return {
    'webhook-id': id,
    'webhook-timestamp': String(timestampSeconds),
    'webhook-signature': signatures.join(' '),
  };
}
