/**
 * Constant-time string comparison for secret material (service-role bearer
 * tokens, cron secrets).
 *
 * The two operands are NAMED rather than positional on purpose: the whole
 * timing property rests on which one is which. `expected` is the secret the
 * server holds, `provided` is whatever the caller sent. The loop runs exactly
 * `provided.length` times, so its trip count depends only on caller-supplied
 * input and never on the secret's length — swap them and the length oracle is
 * back, with an unchanged return value and every test still green. A single
 * object parameter makes that mistake impossible to make silently.
 *
 * Unlike a naive implementation, this does NOT return early when the lengths
 * differ. An early length check makes "wrong length" measurably cheaper than
 * "right length, wrong bytes", which hands an attacker the secret's length for
 * free and lets them probe byte-by-byte from a known-good length. The length
 * difference is instead folded into the same accumulator as the byte
 * differences.
 */
export function timingSafeEqualString(
  operands: { expected: string; provided: string },
): boolean {
  const encoder = new TextEncoder();
  const a = encoder.encode(operands.expected);
  const b = encoder.encode(operands.provided);

  // Non-zero whenever the byte lengths differ; the comparison below can only
  // ever add more difference, never cancel this out.
  let diff = a.length ^ b.length;

  // `a` is indexed modulo its own length so every byte of `b` is compared
  // against something. With an empty expected secret there is nothing to index
  // (modulo zero). Defensive rather than load-bearing: `a[NaN]` would read
  // `undefined`, `undefined ^ x === x`, and `diff` is already non-zero for any
  // non-empty `provided` — so removing this line changes no return value. It
  // stays to keep the loop's intent legible and to survive a rewrite that
  // indexes something which throws on NaN.
  if (a.length === 0) return diff === 0;

  for (let i = 0; i < b.length; i++) {
    diff |= a[i % a.length] ^ b[i];
  }

  return diff === 0;
}

/**
 * True when `Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>` was presented.
 *
 * The blank/unset-key guard is defence in depth, not a closed hole: the
 * `Bearer ${key ?? ''}` form this replaced would only have admitted the
 * literal header `Bearer ` (trailing space), and `Headers` normalises trailing
 * whitespace away, so `headers.get()` can never produce it. The guard matters
 * for any future caller that gets the header from something other than a
 * `Headers` object (a JSON body, a query parameter), where no normalisation
 * applies.
 */
export function isServiceRoleBearer(
  authHeader: string | null,
  serviceRoleKey: string | undefined,
): boolean {
  if (!serviceRoleKey) return false;
  if (!authHeader) return false;
  return timingSafeEqualString({
    expected: `Bearer ${serviceRoleKey}`,
    provided: authHeader,
  });
}
