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

/**
 * Liftosaur's paging cursor. Treated as opaque: the docs show a number, but a
 * non-empty string is accepted too rather than mistaken for "no cursor".
 */
export type LiftosaurCursor = number | string;

export function isLiftosaurCursor(value: unknown): value is LiftosaurCursor {
  return (typeof value === 'number' && Number.isFinite(value)) ||
    (typeof value === 'string' && value.length > 0 && value.length <= 256);
}

/** GET /v1/history -> { data: { records[], hasMore, nextCursor } } */
export interface LiftosaurHistoryPage {
  data: {
    records: LiftosaurRecord[];
    hasMore: boolean;
    nextCursor: LiftosaurCursor | null;
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
    try {
      return await response.json();
    } catch {
      // Never let provider body text (e.g. an HTML error page) reach the caller.
      throw new Error('Liftosaur API returned an unreadable response');
    }
  };
}

/**
 * Why a fetch stopped with history still unread:
 * - `page_budget`: `maxPages` pages were read and Liftosaur still had more.
 * - `missing_cursor`: Liftosaur reported `hasMore` without a `nextCursor`, so
 *   the stream cannot be continued (an API contract problem).
 */
export type LiftosaurTruncationReason = 'page_budget' | 'missing_cursor';

export interface LiftosaurFetchResult {
  records: LiftosaurRecord[];
  /** True when Liftosaur still had records this fetch did not read. */
  truncated: boolean;
  reason: LiftosaurTruncationReason | null;
  /** Liftosaur's cursor for the next unread page, when it gave one. */
  nextCursor: LiftosaurCursor | null;
  /** Oldest / newest parsed workout date among the records read. */
  oldestDatedAt: string | null;
  newestDatedAt: string | null;
  /** Order of the dated records read — see `liftosaurDateOrder`. */
  order: LiftosaurDateOrder;
}

export interface FetchLiftosaurHistoryOptions {
  /** ISO 8601 lower bound on workout date (`startDate`), or null for none. */
  startDate?: string | null;
  /** ISO 8601 upper bound on workout date (`endDate`), or null for none. */
  endDate?: string | null;
  /** Liftosaur cursor to resume from (a previous `nextCursor`). */
  cursor?: LiftosaurCursor | null;
  maxPages?: number;
}

/**
 * Paginated GET /v1/history, following `nextCursor` while `hasMore`.
 * Never silently stops: if records remain unread, `truncated` is set and
 * `reason` says why.
 */
export async function fetchLiftosaurHistory(
  fetchPage: LiftosaurPageFetcher,
  options: FetchLiftosaurHistoryOptions = {},
): Promise<LiftosaurFetchResult> {
  const maxPages = options.maxPages ?? LIFTOSAUR_MAX_PAGES;
  const records: LiftosaurRecord[] = [];
  let cursor: LiftosaurCursor | null = options.cursor ?? null;
  let hasMore = true;
  let reason: LiftosaurTruncationReason | null = null;
  let page = 0;

  while (hasMore && page < maxPages) {
    const params = new URLSearchParams({ limit: String(LIFTOSAUR_PAGE_LIMIT) });
    // GET /history supports startDate/endDate (ISO 8601) alongside the cursor.
    if (options.startDate) params.set('startDate', options.startDate);
    if (options.endDate) params.set('endDate', options.endDate);
    if (cursor !== null) params.set('cursor', String(cursor));

    const data = (await fetchPage(params)) as LiftosaurHistoryPage;
    records.push(...(data?.data?.records ?? []));
    const next = data?.data?.nextCursor;
    cursor = isLiftosaurCursor(next) ? next : null;
    hasMore = data?.data?.hasMore === true;
    page++;
    // A page that claims more but gives no cursor cannot be continued; treat
    // it as truncated rather than as the end of the history, and do not
    // re-request page 1.
    if (hasMore && cursor === null) {
      reason = 'missing_cursor';
      break;
    }
  }
  if (hasMore && reason === null) reason = 'page_budget';

  const dated = records
    .map((record) => parseLiftoscriptMetadata(record.text).timestamp)
    .filter((timestamp): timestamp is string => timestamp !== null)
    .map((timestamp) => Date.parse(timestamp));

  return {
    records,
    truncated: hasMore,
    reason,
    nextCursor: hasMore ? cursor : null,
    oldestDatedAt: dated.length > 0 ? new Date(Math.min(...dated)).toISOString() : null,
    newestDatedAt: dated.length > 0 ? new Date(Math.max(...dated)).toISOString() : null,
    order: liftosaurDateOrder(dated),
  };
}

/**
 * - `descending`: newest first — the documented `/history` order.
 * - `ascending`: oldest first.
 * - `unknown`: mixed order, or fewer than two distinct dates (a single date,
 *   or all-equal dates, says nothing about the order and must never be used
 *   to derive a resume point).
 */
export type LiftosaurDateOrder = 'ascending' | 'descending' | 'unknown';

/** Order of a sequence of epoch-ms dates, as defined by `LiftosaurDateOrder`. */
export function liftosaurDateOrder(dates: readonly number[]): LiftosaurDateOrder {
  let increases = 0;
  let decreases = 0;
  for (let i = 1; i < dates.length; i++) {
    if (dates[i] > dates[i - 1]) increases++;
    else if (dates[i] < dates[i - 1]) decreases++;
  }
  if (increases > 0 && decreases === 0) return 'ascending';
  if (decreases > 0 && increases === 0) return 'descending';
  return 'unknown';
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
 * An undated row without `started_at`. After the insert-only write, callers
 * apply this with a plain UPDATE (never an upsert: Postgres checks NOT NULL on
 * the proposed INSERT row before ON CONFLICT), so edits to
 * name/duration/raw_data land while the stored date stays put.
 */
export function withoutStartedAt(
  row: Record<string, unknown>,
): Record<string, unknown> {
  const { started_at: _startedAt, ...rest } = row;
  return rest;
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
