/**
 * Shared incremental-sync window for integrations whose provider filters by
 * activity START time (Strava `after`, Liftosaur `startDate`).
 *
 * A watermark taken from wall-clock sync time cannot be compared directly
 * against start time: an activity that started before a sync but was uploaded
 * after it (a watch that syncs the next morning, a long ride, a retroactive
 * log) would fall before the next window forever. So the window reaches back
 * `lookbackHours` from the EARLIER of the stored watermark and the newest
 * stored activity start. Upserts on (user_id, provider, external_id) make the
 * overlap free.
 *
 * Callers must capture the new watermark BEFORE fetching, so anything the
 * provider records while the run is in flight falls inside the next window.
 */

export const DEFAULT_INCREMENTAL_LOOKBACK_HOURS = 72;

export interface IncrementalWindowInput {
  /** Previous `user_integrations.last_sync_at` (ISO string), if any. */
  lastWatermark: string | null | undefined;
  /** Newest stored `external_activities.started_at` for this provider, if any. */
  maxStoredStartedAt?: string | null | undefined;
  lookbackHours?: number;
}

function parseTimestamp(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Returns the lower bound for an incremental fetch, or `null` when there is
 * nothing to anchor it to (no watermark and no stored rows): the caller should
 * then do a full fetch.
 */
export function computeIncrementalWindow(
  input: IncrementalWindowInput,
): { after: Date } | null {
  const anchors = [
    parseTimestamp(input.lastWatermark),
    parseTimestamp(input.maxStoredStartedAt),
  ].filter((ms): ms is number => ms !== null);

  if (anchors.length === 0) return null;

  const lookbackHours = input.lookbackHours ?? DEFAULT_INCREMENTAL_LOOKBACK_HOURS;
  const lookbackMs = Math.max(0, lookbackHours) * 60 * 60 * 1000;
  return { after: new Date(Math.min(...anchors) - lookbackMs) };
}
