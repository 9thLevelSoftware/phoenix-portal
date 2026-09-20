/**
 * Constant-time string comparison for secret material (service-role bearer
 * tokens, cron secrets).
 *
 * Argument order is `(expected, provided)`: `expected` is the secret the
 * server holds, `provided` is whatever the caller sent. The loop runs exactly
 * `provided.length` times, so its trip count depends only on caller-supplied
 * input and never on the secret's length.
 *
 * Unlike a naive implementation, this does NOT return early when the lengths
 * differ. An early length check makes "wrong length" measurably cheaper than
 * "right length, wrong bytes", which hands an attacker the secret's length for
 * free and lets them probe byte-by-byte from a known-good length. The length
 * difference is instead folded into the same accumulator as the byte
 * differences.
 */
export function timingSafeEqualString(
  expected: string,
  provided: string,
): boolean {
  const encoder = new TextEncoder();
  const a = encoder.encode(expected);
  const b = encoder.encode(provided);

  // Non-zero whenever the byte lengths differ; the comparison below can only
  // ever add more difference, never cancel this out.
  let diff = a.length ^ b.length;

  // `a` is indexed modulo its own length so every byte of `b` is compared
  // against something. With an empty expected secret there is nothing to index
  // (modulo zero), and `diff` already encodes the mismatch for any non-empty
  // `provided`.
  if (a.length === 0) return diff === 0;

  for (let i = 0; i < b.length; i++) {
    diff |= a[i % a.length] ^ b[i];
  }

  return diff === 0;
}

/**
 * True when `Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>` was presented.
 *
 * A blank/unset service-role key never matches: without this guard an
 * environment missing the secret would accept the literal header `Bearer `.
 */
export function isServiceRoleBearer(
  authHeader: string | null,
  serviceRoleKey: string | undefined,
): boolean {
  if (!serviceRoleKey) return false;
  if (!authHeader) return false;
  return timingSafeEqualString(`Bearer ${serviceRoleKey}`, authHeader);
}
