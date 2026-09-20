/**
 * Watermark rule for provider pulls (`user_integrations.last_sync_at`).
 *
 * Invariant: no activity window may ever be skipped. `last_sync_at` is the
 * `after`/`since` cutoff of the next incremental run, so it may only move to
 * the end of a window this run fetched contiguously from the previous
 * watermark (or from the beginning of history when there was none).
 *
 * An `initial` run against an EXISTING watermark is a history backfill: it
 * fetches only what is older than what is stored, not the window since the
 * watermark. It therefore never moves the watermark; the next incremental or
 * manual run still fetches [last_sync_at, now]. This matters for queued
 * `initial` rows that sat pending while the user already synced manually.
 */
export function nextWatermark(opts: {
  syncType: string;
  /** `last_sync_at` read at the start of this run. */
  previous: string | null | undefined;
  /** End of the window this run fetched contiguously from `previous`. */
  contiguousUpTo: string;
}): string | null {
  if (opts.syncType === 'initial' && opts.previous) return null;
  return opts.contiguousUpTo;
}
