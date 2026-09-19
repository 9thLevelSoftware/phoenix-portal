/**
 * Liftosaur public API client helpers, shared by `liftosaur-sync` (portal
 * queue) and `mobile-integration-sync` (mobile connect/sync) so the two import
 * paths cannot drift on paging, truncation or date handling. Mirrors
 * `_shared/hevySync.ts`.
 *
 * API reference: https://www.liftosaur.com/doc/api
 */

export const LIFTOSAUR_API_BASE = 'https://www.liftosaur.com/api/v1';

/** Records requested per `GET /history` page. */
export const LIFTOSAUR_PAGE_LIMIT = 200;

/**
 * Ceiling on pages per invocation so one enormous history cannot run past the
 * Edge Function wall-clock budget. A truncated run must not advance the sync
 * watermark past what it read — see `LiftosaurFetchResult.truncated`.
 */
export const LIFTOSAUR_MAX_PAGES = 10;

/** Raised for 401/403 so callers can mark the integration as key-invalid. */
export class LiftosaurAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LiftosaurAuthError';
  }
}

export interface LiftosaurRecord {
  id: number;
  text: string;
}

/** GET /v1/history -> { data: { records[], hasMore, nextCursor } } */
export interface LiftosaurHistoryPage {
  data: {
    records: LiftosaurRecord[];
    hasMore: boolean;
    nextCursor: number | null;
  };
}

export interface LiftoscriptMetadata {
  timestamp: string | null;
  program: string | null;
  dayName: string | null;
  durationSeconds: number | null;
}

/**
 * Parses Liftoscript workout text to extract metadata.
 *
 * Format example:
 * 2026-03-01T10:00:00Z / program: "5/3/1" / dayName: "Squat Day" / week: 1 / dayInWeek: 1 / duration: 3600s / exercises: { ... }
 *
 * `timestamp` is null when the text has no leading ISO 8601 date (or the date
 * does not parse).
 */
export function parseLiftoscriptMetadata(text: string): LiftoscriptMetadata {
  const tsMatch = text.match(
    /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?)/,
  );
  const rawTimestamp = tsMatch?.[1] ?? null;
  const timestamp = rawTimestamp && Number.isFinite(Date.parse(rawTimestamp))
    ? rawTimestamp
    : null;

  const programMatch = text.match(/program:\s*"([^"]+)"/);
  const program = programMatch?.[1] ?? null;

  const dayNameMatch = text.match(/dayName:\s*"([^"]+)"/);
  const dayName = dayNameMatch?.[1] ?? null;

  const durationMatch = text.match(/duration:\s*(\d+)s/);
  const durationSeconds = durationMatch ? parseInt(durationMatch[1], 10) : null;

  return { timestamp, program, dayName, durationSeconds };
}

/** Fetches one `/history` page and returns its parsed JSON body. */
export type LiftosaurPageFetcher = (params: URLSearchParams) => Promise<unknown>;

/**
 * Build a page fetcher bound to an API key, mapping Liftosaur's auth failures
 * onto LiftosaurAuthError and any other non-2xx onto a generic Error.
 */
export function createLiftosaurPageFetcher(
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): LiftosaurPageFetcher {
  return async (params) => {
    const response = await fetchImpl(
      `${LIFTOSAUR_API_BASE}/history?${params.toString()}`,
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
      },
    );

    if (response.status === 401 || response.status === 403) {
      throw new LiftosaurAuthError(
        'Liftosaur API access denied. Verify your API key and Premium subscription.',
      );
    }
    if (!response.ok) {
      throw new Error(`Liftosaur API returned ${response.status}`);
    }
    return await response.json();
  };
}

export interface LiftosaurFetchResult {
  records: LiftosaurRecord[];
  /** True when the page ceiling was hit while Liftosaur still had more pages. */
  truncated: boolean;
  /**
   * Resume point for a truncated fetch: the newest parsed workout date among
   * the records read, set ONLY when every dated record arrived in
   * non-decreasing date order. Everything up to it has then been read, so a
   * `startDate` window anchored here continues after what was stored instead
   * of re-reading the same first pages. Null when not truncated, when nothing
   * read had a date, or when the order could not be verified (the API does
   * not document its sort order, so a newest-first stream must not be treated
   * as resumable).
   */
  resumeAt: string | null;
}

export interface FetchLiftosaurHistoryOptions {
  /** ISO 8601 lower bound on workout date (`startDate`), or null for all. */
  startDate?: string | null;
  maxPages?: number;
}

/**
 * Paginated GET /v1/history, following `nextCursor` while `hasMore`.
 * Never silently stops: if pages remain after `maxPages`, `truncated` is set.
 */
export async function fetchLiftosaurHistory(
  fetchPage: LiftosaurPageFetcher,
  options: FetchLiftosaurHistoryOptions = {},
): Promise<LiftosaurFetchResult> {
  const maxPages = options.maxPages ?? LIFTOSAUR_MAX_PAGES;
  const records: LiftosaurRecord[] = [];
  let cursor: number | null = null;
  let hasMore = true;
  let page = 0;

  while (hasMore && page < maxPages) {
    const params = new URLSearchParams({ limit: String(LIFTOSAUR_PAGE_LIMIT) });
    // GET /history supports startDate/endDate (ISO 8601) alongside the cursor.
    if (options.startDate) params.set('startDate', options.startDate);
    if (cursor !== null) params.set('cursor', cursor.toString());

    const data = (await fetchPage(params)) as LiftosaurHistoryPage;
    records.push(...(data?.data?.records ?? []));
    cursor = data?.data?.nextCursor ?? null;
    // A page that claims more but gives no cursor cannot be continued; treat
    // it as truncated rather than as the end of the history.
    hasMore = data?.data?.hasMore === true;
    page++;
    if (hasMore && cursor === null) break;
  }

  const truncated = hasMore;
  return {
    records,
    truncated,
    resumeAt: truncated ? ascendingMaxDate(records) : null,
  };
}

/**
 * Newest parsed date if the dated records are in non-decreasing order, else
 * null. Undated records are skipped (they carry no ordering information).
 */
function ascendingMaxDate(records: readonly LiftosaurRecord[]): string | null {
  let maxMs: number | null = null;
  for (const record of records) {
    const timestamp = parseLiftoscriptMetadata(record.text).timestamp;
    if (!timestamp) continue;
    const ms = Date.parse(timestamp);
    if (maxMs !== null && ms < maxMs) return null;
    maxMs = ms;
  }
  return maxMs === null ? null : new Date(maxMs).toISOString();
}

/** external_activities.external_id for a Liftosaur history record. */
export function liftosaurExternalId(recordId: number): string {
  return `liftosaur-${recordId}`;
}

/** Readable workout name from the Liftoscript metadata. */
export function liftosaurWorkoutName(
  record: LiftosaurRecord,
  meta: LiftoscriptMetadata,
): string {
  return meta.dayName
    ? meta.program ? `${meta.program} — ${meta.dayName}` : meta.dayName
    : meta.program ?? `Workout #${record.id}`;
}

export interface LiftosaurActivityRow {
  /** True when the Liftoscript text had no parseable date. */
  undated: boolean;
  row: Record<string, unknown>;
}

/**
 * Map a Liftosaur record onto an external_activities row.
 *
 * `started_at` is NOT NULL in external_activities, so an undated record still
 * needs a value on first insert: `importedAt`. Callers MUST write undated rows
 * with `ignoreDuplicates: true` (INSERT … ON CONFLICT DO NOTHING) so a re-sync
 * never moves an already stored record to a new date.
 */
export function toLiftosaurActivityRow(
  userId: string,
  record: LiftosaurRecord,
  importedAt: string,
): LiftosaurActivityRow {
  const meta = parseLiftoscriptMetadata(record.text);
  return {
    undated: meta.timestamp === null,
    row: {
      user_id: userId,
      external_id: liftosaurExternalId(record.id),
      provider: 'liftosaur',
      name: liftosaurWorkoutName(record, meta),
      activity_type: 'strength',
      started_at: meta.timestamp
        ? new Date(meta.timestamp).toISOString()
        : importedAt,
      duration_seconds: meta.durationSeconds ?? null,
      calories: null,
      raw_data: { id: record.id, text: record.text },
    },
  };
}
