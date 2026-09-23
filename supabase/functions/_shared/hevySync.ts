/**
 * Hevy public API client helpers.
 *
 * Pure/injectable pieces of the Hevy sync live here so they can be exercised
 * from Vitest (see src/lib/__tests__/hevy-sync.test.ts) without standing up an
 * Edge Function. `hevy-sync/index.ts` composes these with Supabase persistence.
 *
 * API reference: https://api.hevyapp.com/docs
 */

export const HEVY_API_BASE = 'https://api.hevyapp.com/v1';

/**
 * Hevy caps `pageSize` at 10 for the workout endpoints. Requesting more is a
 * 400; requesting none returns a single short page, which is why an unpaginated
 * call silently imports only the first handful of workouts.
 */
export const HEVY_PAGE_SIZE = 10;

/**
 * Ceiling on pages per invocation so one enormous account cannot run past the
 * Edge Function wall-clock budget. A truncated run must not advance the sync
 * watermark — see `HevyFetchResult.truncated`.
 */
export const HEVY_MAX_PAGES = 100;

/** Raised for 401/403 so callers can mark the integration as key-invalid. */
export class HevyAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HevyAuthError';
  }
}

export interface HevyWorkout {
  id: string;
  title: string;
  start_time: string;
  end_time: string;
  /** ISO 8601; used as the resume point for truncated event fetches. */
  updated_at?: string;
  exercises?: Array<{
    title: string;
    sets: Array<{
      set_type: string;
      weight_kg: number;
      reps: number;
      rpe: number | null;
    }>;
  }>;
}

/** GET /v1/workouts -> { page, page_count, workouts[] } */
export interface HevyPaginatedWorkouts {
  page: number;
  page_count: number;
  workouts: HevyWorkout[];
}

/** GET /v1/workouts/events -> { page, page_count, events[] } */
export type HevyWorkoutEvent =
  | { type: 'updated'; workout: HevyWorkout }
  | { type: 'deleted'; id: string; deleted_at?: string };

export interface HevyPaginatedEvents {
  page: number;
  page_count: number;
  events: HevyWorkoutEvent[];
}

export interface HevyFetchResult {
  workouts: HevyWorkout[];
  deletedIds: string[];
  /** True when the page ceiling was hit before the API ran out of pages. */
  truncated: boolean;
  /**
   * Latest `updated_at` observed across the fetched events, or null.
   *
   * This is the resume point for a truncated incremental fetch: replaying
   * `events?since=` from here continues after what was already processed,
   * rather than re-reading the same first pages forever. Only meaningful for
   * the events path — `/v1/workouts` offers no date filter, so a truncated
   * backfill has no derivable resume point.
   */
  latestEventAt: string | null;
}

/** Max of two ISO timestamps, tolerating nulls and unparseable values. */
export function maxIsoTimestamp(
  a: string | null,
  b: string | null | undefined,
): string | null {
  if (!b) return a;
  const bMs = Date.parse(b);
  if (!Number.isFinite(bMs)) return a;
  if (!a) return b;
  const aMs = Date.parse(a);
  if (!Number.isFinite(aMs)) return b;
  return bMs > aMs ? b : a;
}

/** Fetches one page and returns its parsed JSON body. */
export type HevyPageFetcher = (
  path: string,
  params: URLSearchParams,
) => Promise<unknown>;

/**
 * Build a page fetcher bound to an API key, mapping Hevy's auth failures onto
 * HevyAuthError and any other non-2xx onto a generic Error.
 */
export function createHevyPageFetcher(
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): HevyPageFetcher {
  return async (path, params) => {
    const response = await fetchImpl(
      `${HEVY_API_BASE}${path}?${params.toString()}`,
      {
        headers: {
          'api-key': apiKey,
          'Content-Type': 'application/json',
        },
      },
    );

    if (response.status === 401 || response.status === 403) {
      throw new HevyAuthError(
        'Hevy API access denied. Verify your API key and Hevy PRO subscription.',
      );
    }
    if (!response.ok) {
      throw new Error(`Hevy API returned ${response.status}`);
    }
    return await response.json();
  };
}

/**
 * Split a page of workout events into upserts and deletions.
 * Unknown event types are ignored rather than throwing, so a future Hevy event
 * kind cannot break an otherwise healthy sync.
 */
export function foldWorkoutEvents(events: readonly HevyWorkoutEvent[]): {
  workouts: HevyWorkout[];
  deletedIds: string[];
} {
  const workouts: HevyWorkout[] = [];
  const deletedIds: string[] = [];

  for (const event of events) {
    if (event?.type === 'deleted' && event.id) {
      deletedIds.push(event.id);
    } else if (event?.type === 'updated' && event.workout) {
      workouts.push(event.workout);
    }
  }

  return { workouts, deletedIds };
}

/**
 * Full backfill via GET /v1/workouts.
 *
 * Terminates on `page_count` rather than inferring the end from a short page,
 * so a final page landing exactly on the size boundary is not mistaken for the
 * end of the collection.
 */
export async function fetchHevyBackfill(
  fetchPage: HevyPageFetcher,
  maxPages: number = HEVY_MAX_PAGES,
): Promise<HevyFetchResult> {
  const workouts: HevyWorkout[] = [];
  let page = 1;
  let pageCount = 1;

  while (page <= pageCount && page <= maxPages) {
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(HEVY_PAGE_SIZE),
    });

    const data = (await fetchPage('/workouts', params)) as HevyPaginatedWorkouts;
    workouts.push(...(data?.workouts ?? []));
    pageCount = data?.page_count ?? 1;
    page++;
  }

  return {
    workouts,
    deletedIds: [],
    truncated: page <= pageCount,
    latestEventAt: null,
  };
}

/**
 * Incremental fetch via GET /v1/workouts/events?since=.
 * Returns updated workouts to upsert and deleted workout ids to remove.
 */
export async function fetchHevyEvents(
  fetchPage: HevyPageFetcher,
  since: string,
  maxPages: number = HEVY_MAX_PAGES,
): Promise<HevyFetchResult> {
  const workouts: HevyWorkout[] = [];
  const deletedIds: string[] = [];
  let page = 1;
  let pageCount = 1;
  let latestEventAt: string | null = null;

  while (page <= pageCount && page <= maxPages) {
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(HEVY_PAGE_SIZE),
      since,
    });

    const data = (await fetchPage(
      '/workouts/events',
      params,
    )) as HevyPaginatedEvents;

    const folded = foldWorkoutEvents(data?.events ?? []);
    workouts.push(...folded.workouts);
    deletedIds.push(...folded.deletedIds);

    // Track how far through the event stream we got so a truncated run can
    // resume rather than replaying from the original `since`.
    for (const event of data?.events ?? []) {
      latestEventAt =
        event?.type === 'deleted'
          ? maxIsoTimestamp(latestEventAt, event.deleted_at)
          : maxIsoTimestamp(latestEventAt, event?.workout?.updated_at);
    }

    pageCount = data?.page_count ?? 1;
    page++;
  }

  return { workouts, deletedIds, truncated: page <= pageCount, latestEventAt };
}

/**
 * external_activities.external_id for a Hevy workout.
 *
 * The `hevy-` prefix is load-bearing: it is what the CSV import path
 * (src/lib/integrations/hevy.ts) and mobile-integration-sync also produce, so
 * the same workout arriving by any route collides on the same row.
 */
export function hevyExternalId(workoutId: string): string {
  return `hevy-${workoutId}`;
}

/** Map a Hevy workout onto an external_activities row. */
export function toExternalActivityRow(
  userId: string,
  workout: HevyWorkout,
): Record<string, unknown> {
  const startTime = new Date(workout.start_time);
  const endTime = new Date(workout.end_time);
  const startMs = startTime.getTime();
  const endMs = endTime.getTime();
  const durationSeconds = Number.isFinite(startMs) && Number.isFinite(endMs)
    ? Math.round((endMs - startMs) / 1000)
    : 0;

  return {
    user_id: userId,
    external_id: hevyExternalId(workout.id),
    provider: 'hevy',
    name: workout.title,
    activity_type: 'strength',
    started_at: startTime.toISOString(),
    duration_seconds: durationSeconds > 0 ? durationSeconds : null,
    calories: null, // Hevy API does not provide calorie data
    raw_data: workout,
  };
}
