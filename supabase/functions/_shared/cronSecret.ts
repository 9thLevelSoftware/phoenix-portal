/**
 * Shared authentication for Edge Functions invoked by pg_cron through
 * private.invoke_edge_function (KD-10). The Vault secret `edge_cron_secret`
 * is sent as the `x-cron-secret` header; Operator Action 7 sets the same
 * value as the Edge secret `CRON_SECRET`.
 */

import { timingSafeEqualString } from './timingSafe.ts';

export type EnvReader = (key: string) => string | undefined;

// The comparison itself now lives in _shared/timingSafe.ts so the provider
// sync handlers can use the same one for their service-role bearer check.
export { timingSafeEqualString };

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
