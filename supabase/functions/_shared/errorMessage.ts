/**
 * Extract a human-readable message from an unknown thrown value.
 *
 * `catch` clauses surface `unknown` (or `any`, depending on tsconfig); reading
 * `.message` off them directly is unsafe. Use this helper to narrow safely so
 * every edge function reports errors consistently.
 */
export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  // Supabase/PostgREST errors are often plain objects with a `message` string,
  // not Error instances — read it directly instead of stringifying to [object Object].
  if (
    err != null &&
    typeof err === 'object' &&
    'message' in err &&
    typeof (err as { message: unknown }).message === 'string'
  ) {
    return (err as { message: string }).message;
  }
  try {
    return String(err);
  } catch {
    return 'Unknown error';
  }
}
