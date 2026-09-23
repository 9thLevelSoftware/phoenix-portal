/**
 * Liftosaur public API client helpers, shared by `liftosaur-sync` (portal
 * queue) and `mobile-integration-sync` (mobile connect/sync) so the two import
 * paths cannot drift on paging, truncation, resume or date handling. Mirrors
 * `_shared/hevySync.ts`.
 *
 * API reference: https://www.liftosaur.com/doc/api
 */

import { computeIncrementalWindow } from './incrementalWindow.ts';

export const LIFTOSAUR_API_BASE = 'https://www.liftosaur.com/api/v1';

/** Records requested per `GET /history` page. */
export const LIFTOSAUR_PAGE_LIMIT = 200;

/**
 * Ceiling on pages per invocation so one enormous history cannot run past the
 * Edge Function wall-clock budget. A truncated run never advances the sync
 * watermark past what it read: see `resolveLiftosaurTruncation`.
 */
export const LIFTOSAUR_MAX_PAGES = 10;

/** Per-request ceiling, so one hung request cannot outlast a queue lease. */
export const LIFTOSAUR_REQUEST_TIMEOUT_MS = 30_000;

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
 * onto LiftosaurAuthError and any other non-2xx onto a generic Error. Every
 * request carries a timeout.
 */
export function createLiftosaurPageFetcher(
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs: number = LIFTOSAUR_REQUEST_TIMEOUT_MS,
): LiftosaurPageFetcher {
  return async (params) => {
    const response = await fetchImpl(
      `${LIFTOSAUR_API_BASE}/history?${params.toString()}`,
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        signal: AbortSignal.timeout(timeoutMs),
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

/**
 * - `descending`: newest first, the documented `/history` order.
 * - `ascending`: oldest first.
 * - `unknown`: mixed order, or fewer than two distinct dates (a single date,
 *   or all-equal dates, says nothing about the order and must never be used
 *   to derive a resume point).
 */
export type LiftosaurDateOrder = 'ascending' | 'descending' | 'unknown';

export interface LiftosaurFetchResult {
  records: LiftosaurRecord[];
  /** True when Liftosaur still had records this fetch did not read. */
  truncated: boolean;
  reason: LiftosaurTruncationReason | null;
  /** Oldest / newest parsed workout date among the records read. */
  oldestDatedAt: string | null;
  newestDatedAt: string | null;
  /** Order of the dated records read. */
  order: LiftosaurDateOrder;
}

export interface FetchLiftosaurHistoryOptions {
  /** ISO 8601 lower bound on workout date (`startDate`), or null for none. */
  startDate?: string | null;
  /** ISO 8601 upper bound on workout date (`endDate`), or null for none. */
  endDate?: string | null;
  maxPages?: number;
  /** Called after every page (e.g. to renew a queue lease). */
  onPage?: () => Promise<void> | void;
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
  let cursor: LiftosaurCursor | null = null;
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
    await options.onPage?.();
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
    oldestDatedAt: dated.length > 0 ? new Date(Math.min(...dated)).toISOString() : null,
    newestDatedAt: dated.length > 0 ? new Date(Math.max(...dated)).toISOString() : null,
    order: liftosaurDateOrder(dated),
  };
}

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

// ---------------------------------------------------------------------------
// Resumable backfill (user_integrations.backfill_*, 20260920005000)
// ---------------------------------------------------------------------------

/** The backfill columns plus the watermark, as read from user_integrations. */
export interface LiftosaurIntegrationState {
  last_sync_at?: string | null;
  backfill_before?: string | null;
  backfill_after?: string | null;
  backfill_started_at?: string | null;
}

export interface LiftosaurSyncPlan {
  /** True when this run continues an in-progress backfill chain. */
  inBackfill: boolean;
  /** `startDate` for the fetch (null = full history). */
  startDate: string | null;
  /** `endDate` for the fetch (null = up to now). */
  endDate: string | null;
  /** When the chain started; becomes last_sync_at when it completes. */
  chainStartedAt: string;
  /** The un-chained incremental lower bound (for the ascending fallback). */
  incrementalSince: string | null;
}

/**
 * Decide the window for a run.
 *
 * /history is newest-first and one run reads at most LIFTOSAUR_MAX_PAGES pages,
 * so a larger history is read DOWNWARD over several runs: each run that stops
 * early records `backfill_before` (the next run's `endDate`) and the chain's
 * start time. The watermark (`last_sync_at`, hence `startDate`) is left alone
 * until the chain reaches the end; moving it earlier would make the next
 * window start after its own `endDate`. An `initial` sync (a (re)connect)
 * starts a fresh full-history chain, so a chain that cannot progress is never
 * stuck.
 */
export function planLiftosaurSync(
  state: LiftosaurIntegrationState | null,
  syncType: string | undefined,
  now: Date,
): LiftosaurSyncPlan {
  const lastSyncAt = state?.last_sync_at ?? null;
  const backfillBefore = state?.backfill_before ?? null;
  const backfillAfter = state?.backfill_after ?? null;
  const backfillStartedAt = state?.backfill_started_at ?? null;

  // `startDate` filters on workout date, but the watermark is wall-clock sync
  // time. Reach back a lookback (shared with Strava) so a workout that was in
  // progress during the last sync, or logged retroactively, is still
  // requested. Upserts are idempotent, so the overlap is free.
  const incrementalWindow = syncType !== 'initial'
    ? computeIncrementalWindow({ lastWatermark: lastSyncAt })
    : null;
  const incrementalSince = incrementalWindow
    ? incrementalWindow.after.toISOString()
    : null;

  const inBackfill = syncType !== 'initial' &&
    backfillBefore !== null &&
    backfillStartedAt !== null;

  return {
    inBackfill,
    // A chain keeps the lower bound it started with: an `initial` chain has
    // none, so its follow-ups still read the full history below the old
    // watermark instead of stopping at last_sync_at minus the lookback.
    startDate: inBackfill ? backfillAfter : incrementalSince,
    endDate: inBackfill ? backfillBefore : null,
    // Capture the watermark before fetching so records Liftosaur writes while
    // this run is in flight fall inside the next window.
    chainStartedAt: inBackfill ? backfillStartedAt! : now.toISOString(),
    incrementalSince,
  };
}

/** Columns that end any backfill when a run reads its whole window. */
export function completedSyncColumns(
  plan: LiftosaurSyncPlan,
): Record<string, unknown> {
  return {
    last_sync_at: plan.chainStartedAt,
    backfill_before: null,
    backfill_after: null,
    backfill_started_at: null,
    status: 'connected',
    error_message: null,
  };
}

/**
 * What a truncated run does next. Every outcome keeps the watermark at or
 * below what was actually read.
 *
 * - `continue`: newest-first page (the documented order). Everything newer
 *   than the oldest record read is stored, so the next run continues below it
 *   with `endDate`. The caller writes `columns` and makes sure a run follows.
 * - `resume`: oldest-first page (not the documented order). The newest record
 *   read is a safe watermark; the caller writes `columns` and asks for a retry
 *   (`retryReadsFurther`) or leaves it to the next incremental sync.
 * - `stuck`: no safe resume point (unclear order, or a chain that stopped
 *   progressing). The caller reports `message` as an error and advances nothing.
 */
export type LiftosaurTruncationOutcome =
  | { kind: 'continue'; message: string; nextBefore: string; columns: Record<string, unknown> }
  | {
    kind: 'resume';
    message: string;
    resumeAt: string;
    retryReadsFurther: boolean;
    columns: Record<string, unknown>;
  }
  | { kind: 'stuck'; message: string; columns: Record<string, unknown> };

export function resolveLiftosaurTruncation(
  fetched: LiftosaurFetchResult,
  plan: LiftosaurSyncPlan,
  syncType: string | undefined,
  storedCount: number,
): LiftosaurTruncationOutcome {
  const why = fetched.reason === 'missing_cursor'
    ? 'Liftosaur reported more history but no cursor to continue from'
    : `Liftosaur history is larger than one run can read (${LIFTOSAUR_MAX_PAGES} pages)`;

  let cannotResume =
    'the records read were not in a clear date order (fewer than two distinct dates, or mixed order)';

  if (fetched.order === 'descending' && fetched.oldestDatedAt) {
    // +1s because `endDate` may be exclusive; re-reading the boundary second
    // is idempotent.
    const nextBefore = new Date(Date.parse(fetched.oldestDatedAt) + 1000).toISOString();
    const progresses = !plan.inBackfill ||
      (plan.endDate !== null && Date.parse(nextBefore) < Date.parse(plan.endDate));
    if (progresses) {
      const message = `Importing Liftosaur history: ${why}. ${storedCount} records stored ` +
        'this run; older records are imported by the next run.';
      return {
        kind: 'continue',
        message,
        nextBefore,
        columns: {
          backfill_before: nextBefore,
          backfill_after: plan.startDate,
          backfill_started_at: plan.chainStartedAt,
          status: 'connected',
          error_message: message,
        },
      };
    }
    cannotResume = 'more records share one date than a single run can read';
  }

  // Oldest-first fallback: the newest record read is a safe watermark. It only
  // helps when the new window starts later than this one; an `initial` sync
  // ignores the watermark and would repeat the same request.
  if (!plan.inBackfill && fetched.order === 'ascending' && fetched.newestDatedAt) {
    const resumeAt = fetched.newestDatedAt;
    const resumeWindow = computeIncrementalWindow({ lastWatermark: resumeAt });
    const windowMoves = resumeWindow !== null &&
      (plan.incrementalSince === null ||
        resumeWindow.after.getTime() > Date.parse(plan.incrementalSince));
    if (windowMoves) {
      const retryReadsFurther = syncType !== 'initial';
      const message = `${why}; ${storedCount} records stored, ` +
        (retryReadsFurther
          ? `resuming from ${resumeAt}`
          : `the next incremental sync resumes from ${resumeAt}`);
      return {
        kind: 'resume',
        message,
        resumeAt,
        retryReadsFurther,
        columns: { last_sync_at: resumeAt, status: 'connected', error_message: message },
      };
    }
    cannotResume = 'more records share this window than a single run can read';
  }

  const message = `${why}; ${storedCount} records stored, but the import cannot resume: ` +
    `${cannotResume}.`;
  return { kind: 'stuck', message, columns: { status: 'error', error_message: message } };
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

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
 * `started_at` is NOT NULL, so an undated record still needs a value on first
 * insert: `importedAt`, ONE value per run (never a per-row wall clock). Write
 * undated rows with `writeLiftosaurRows`, which inserts them only when absent,
 * so a re-sync never moves a stored record to a new date.
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
      started_at: meta.timestamp ? new Date(meta.timestamp).toISOString() : importedAt,
      duration_seconds: meta.durationSeconds ?? null,
      calories: null,
      raw_data: { id: record.id, text: record.text },
    },
  };
}

// deno-lint-ignore no-explicit-any
type Db = { from(table: string): any };

/**
 * Persist Liftosaur rows. Dated rows are upserted. Undated rows are inserted
 * only when absent (ON CONFLICT DO NOTHING) and then refreshed with a plain
 * UPDATE that leaves started_at alone: an upsert that omits started_at is
 * rejected, because Postgres checks NOT NULL on the proposed INSERT row
 * before ON CONFLICT. Returns the failure count; callers must not advance the
 * watermark when it is non-zero.
 */
export async function writeLiftosaurRows(
  supabase: Db,
  userId: string,
  rows: LiftosaurActivityRow[],
  extraColumns: Record<string, unknown> = {},
  onRow?: (index: number) => Promise<void> | void,
): Promise<{ written: number; failed: number }> {
  let written = 0;
  let failed = 0;
  const undated: Array<Record<string, unknown>> = [];
  for (let i = 0; i < rows.length; i++) {
    const { undated: isUndated, row } = rows[i];
    const full = { ...row, ...extraColumns };
    const { error } = await supabase
      .from('external_activities')
      .upsert(full, {
        onConflict: 'user_id,provider,external_id',
        ignoreDuplicates: isUndated,
      });
    if (error) {
      failed++;
      console.error(`Failed to persist Liftosaur record ${String(row.external_id)}:`, error);
    } else {
      written++;
      if (isUndated) undated.push(full);
    }
    await onRow?.(i + 1);
  }
  for (const row of undated) {
    const { user_id: _u, provider: _p, external_id: externalId, started_at: _s, ...changes } = row;
    const { error } = await supabase
      .from('external_activities')
      .update(changes)
      .eq('user_id', userId)
      .eq('provider', 'liftosaur')
      .eq('external_id', externalId as string);
    if (error) {
      failed++;
      written--;
      console.error(`Failed to refresh Liftosaur record ${String(externalId)}:`, error);
    }
  }
  return { written, failed };
}
