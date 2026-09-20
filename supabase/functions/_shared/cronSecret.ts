/**
 * Shared authentication for Edge Functions invoked by pg_cron through
 * private.invoke_edge_function (KD-10). The Vault secret `edge_cron_secret`
 * is sent as the `x-cron-secret` header; Operator Action 7 sets the same
 * value as the Edge secret `CRON_SECRET`.
 */

export type EnvReader = (key: string) => string | undefined;

/** Constant-time string comparison (length is not secret). */
export function timingSafeEqualString(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  if (ea.length !== eb.length) return false;
  let diff = 0;
  for (let i = 0; i < ea.length; i++) diff |= ea[i] ^ eb[i];
  return diff === 0;
}

/**
 * True when `x-cron-secret` equals CRON_SECRET (or, if that is unset, the
 * first set name in `legacyNames`). An unset/blank secret never matches.
 */
export function hasValidCronSecret(
  req: Request,
  env: EnvReader,
  legacyNames: readonly string[] = [],
): boolean {
  let expected: string | undefined;
  for (const name of ['CRON_SECRET', ...legacyNames]) {
    const value = env(name)?.trim();
    if (value) {
      expected = value;
      break;
    }
  }
  if (!expected) return false;
  const provided = req.headers.get('x-cron-secret') ?? '';
  return timingSafeEqualString(expected, provided);
}
