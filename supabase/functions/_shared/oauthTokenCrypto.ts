/**
 * AES-GCM encryption for oauth_tokens sensitive columns (access_token, refresh_token, api_key).
 * Set OAUTH_TOKEN_ENCRYPTION_KEY to a base64-encoded 32-byte key. When unset, values pass through (legacy/dev).
 */

const PREFIX = 'enc:v1:';

let keyCache: CryptoKey | null | undefined;

function bytesToBase64(bytes: Uint8Array): string {
  let s = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(s);
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function getAesKey(): Promise<CryptoKey | null> {
  if (keyCache === null) return null;
  if (keyCache) return keyCache;
  const raw = Deno.env.get('OAUTH_TOKEN_ENCRYPTION_KEY');
  if (!raw?.trim()) {
    keyCache = null;
    return null;
  }
  let keyBytes: Uint8Array;
  try {
    keyBytes = base64ToBytes(raw.trim());
  } catch {
    console.error('[oauthTokenCrypto] OAUTH_TOKEN_ENCRYPTION_KEY is not valid base64');
    keyCache = null;
    return null;
  }
  if (keyBytes.length !== 32) {
    console.error('[oauthTokenCrypto] OAUTH_TOKEN_ENCRYPTION_KEY must decode to 32 bytes (AES-256)');
    keyCache = null;
    return null;
  }
  keyCache = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
  return keyCache;
}

export async function encryptOAuthSecret(
  plain: string | null | undefined,
): Promise<string | null | undefined> {
  if (plain == null || plain === '') return plain;
  const key = await getAesKey();
  if (!key) return plain;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const enc = new TextEncoder().encode(plain);
  const buf = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc);
  const combined = new Uint8Array(iv.length + buf.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(buf), iv.length);
  return `${PREFIX}${bytesToBase64(combined)}`;
}

export async function decryptOAuthSecret(
  stored: string | null | undefined,
): Promise<string | null | undefined> {
  if (stored == null || stored === '') return stored;
  if (!stored.startsWith(PREFIX)) return stored;
  const key = await getAesKey();
  if (!key) {
    console.warn('[oauthTokenCrypto] Encrypted token in DB but OAUTH_TOKEN_ENCRYPTION_KEY not set');
    return stored;
  }
  try {
    const combined = base64ToBytes(stored.slice(PREFIX.length));
    const iv = combined.slice(0, 12);
    const ciphertext = combined.slice(12);
    const dec = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
    return new TextDecoder().decode(dec);
  } catch (e) {
    console.error('[oauthTokenCrypto] decrypt failed:', e);
    throw new Error('oauth_token_decrypt_failed');
  }
}
