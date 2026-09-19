import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { getCorsHeaders } from '../_shared/cors.ts';
import { errorMessage as describeError } from '../_shared/errorMessage.ts';
import { redactTokenShapedJson } from '../_shared/garminIdentity.ts';
import {
  createHevyPageFetcher,
  fetchHevyBackfill,
  HevyAuthError,
} from '../_shared/hevySync.ts';
import {
  createLiftosaurPageFetcher,
  fetchLiftosaurHistory,
  isLiftosaurCursor,
  LiftosaurAuthError,
  type LiftosaurCursor,
  toLiftosaurActivityRow,
} from '../_shared/liftosaurSync.ts';
import { checkRateLimit } from '../_shared/rateLimit.ts';
import { decryptOAuthSecret, encryptOAuthSecret } from '../_shared/oauthTokenCrypto.ts';
import { requireSubscription } from '../_shared/requireSubscription.ts';

/**
 * Loose Supabase client type for helper signatures. The bare
 * `ReturnType<typeof createClient>` collapses table payload types to `never`.
 */
// deno-lint-ignore no-explicit-any
type DbClient = SupabaseClient<any, any, any>;

/**
 * Mobile Integration Sync Edge Function
 *
 * Handles connect/sync/disconnect for API-key-based integrations (Hevy, Liftosaur)
 * initiated from the mobile app. These are providers with server-side APIs that
 * require an API key for fetching workout data.
 *
 * **Not used for:** Strong (file-based CSV import, handled locally on device),
 * Apple Health/Google Health Connect (device-local APIs, no server round-trip),
 * or OAuth providers (Strava, Fitbit, Garmin — handled by portal OAuth functions).
 *
 * Subscription gating: FREE users receive an empty activities array and
 * `requiresUpgrade: true`. Paid users (EMBER+) get full activity data and
 * Supabase persistence.
 *
 * Server-driven paging: each call reads a bounded number of provider pages.
 * When more remain, the response carries the activities read plus
 * `hasMore: true` and an opaque `nextCursor`; the mobile client
 * (IntegrationManager.syncProviderInternal) calls again with `cursor` until
 * `hasMore` is false. Continuation calls of a `connect` arrive without
 * `apiKey` and use the stored key. `last_sync_at` advances (to the chain's
 * start time, carried in the cursor) only on the final call.
 *
 * POST /functions/v1/mobile-integration-sync
 * Authorization: Bearer <GoTrue JWT>
 * Body: { provider: "hevy" | "liftosaur", action: "connect" | "sync" | "disconnect", apiKey?: string, cursor?: string }
 */

const ALLOWED_PROVIDERS = new Set(['hevy', 'liftosaur']);
const ALLOWED_ACTIONS = new Set(['connect', 'sync', 'disconnect']);

/**
 * Provider pages read per call. Hevy pages hold 10 workouts; the budget is
 * kept below Hevy's request rate limit, and a Hevy 429 mid-call ends the call
 * early with `hasMore` and the same resume page. Liftosaur pages hold 200.
 */
export const MOBILE_HEVY_PAGES_PER_CALL = 4;
export const MOBILE_LIFTOSAUR_PAGES_PER_CALL = 5;

/**
 * Per-user limits. A fresh call is limited tightly; a continuation (valid
 * `cursor`) uses its own, wider bucket so a legitimate paging chain is not cut
 * off at the sixth page. Each call is still authenticated and page-bounded.
 */
const FRESH_CALL_LIMIT = { key: 'mobile-integration-sync', maxRequests: 5, windowSeconds: 60 };
const CONTINUATION_LIMIT = { key: 'mobile-integration-sync:page', maxRequests: 60, windowSeconds: 60 };

/** Short code on provider fetch failures; provider text is only logged. */
const PROVIDER_FETCH_ERROR_CODE = 'PROVIDER_FETCH';

// =============================================================================
// Normalized activity DTO returned to mobile
// =============================================================================

interface ActivityDto {
  externalId: string;
  provider: string;
  name: string;
  activityType: string;
  startedAt: string;
  durationSeconds: number;
  distanceMeters?: number;
  calories?: number;
  avgHeartRate?: number;
  maxHeartRate?: number;
  elevationGainMeters?: number;
  rawData?: string;
}

/** Mirrors mobile IntegrationEntityErrorDto. */
interface EntityErrorDto {
  entityType: string;
  code?: string;
  message: string;
  retryAfterSeconds?: number;
}

// =============================================================================
// Hevy types
// =============================================================================

interface HevyWorkout {
  id: string;
  title: string;
  start_time: string;
  end_time: string;
  exercises: Array<{
    title: string;
    sets: Array<{
      set_type: string;
      weight_kg: number;
      reps: number;
      rpe: number | null;
    }>;
  }>;
}

// =============================================================================
// Request body and paging cursor
// =============================================================================

interface MobileIntegrationRequest {
  provider: string;
  action: string;
  apiKey?: string;
  cursor?: string | null;
}

/** Decoded `cursor`: where the next call resumes, and when the chain began. */
interface PagingCursor {
  v: 1;
  provider: 'hevy' | 'liftosaur';
  /** Hevy: next /v1/workouts page to read (>= 1). */
  hevyPage?: number;
  /** Liftosaur: /history `nextCursor` to resume from (opaque). */
  liftosaurCursor?: LiftosaurCursor;
  /** ISO time the chain's first call started; becomes last_sync_at. */
  chainStartedAt: string;
}

function encodeCursor(cursor: PagingCursor): string {
  return JSON.stringify(cursor);
}

/** Parses and validates a request cursor for `provider`; null when invalid. */
function decodeCursor(raw: unknown, provider: string): PagingCursor | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 512) return null;
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || parsed.v !== 1) return null;
  if (parsed.provider !== provider) return null;
  if (typeof parsed.chainStartedAt !== 'string') return null;
  const chainMs = Date.parse(parsed.chainStartedAt);
  if (!Number.isFinite(chainMs) || chainMs > Date.now() + 60_000) return null;
  const chainStartedAt = new Date(chainMs).toISOString();
  if (provider === 'hevy') {
    const page = parsed.hevyPage;
    if (typeof page !== 'number' || !Number.isSafeInteger(page) || page < 1) return null;
    return { v: 1, provider, hevyPage: page, chainStartedAt };
  }
  const liftosaurCursor = parsed.liftosaurCursor;
  if (!isLiftosaurCursor(liftosaurCursor)) return null;
  return { v: 1, provider: 'liftosaur', liftosaurCursor, chainStartedAt };
}

// =============================================================================
// Provider fetch logic
// =============================================================================

interface ProviderFetchResult {
  activities: ActivityDto[];
  /** External ids whose provider record has no parseable date. */
  undated: Set<string>;
  /** Resume point when more remains and the chain can continue; else null. */
  next: Omit<PagingCursor, 'v' | 'provider' | 'chainStartedAt'> | null;
  /** Non-fatal problems to report on a successful page (e.g. provider 429). */
  errors: EntityErrorDto[];
  /** More remained but the chain cannot continue: a real failure. */
  failure: string | null;
}

/**
 * Shares the paginator with hevy-sync (../_shared/hevySync.ts) so the mobile
 * and portal import paths cannot drift on page size or termination logic.
 * Only the returned DTO shape differs — mobile takes camelCase.
 */
async function fetchHevyActivities(
  apiKey: string,
  cursor: PagingCursor | null,
): Promise<ProviderFetchResult> {
  let result;
  try {
    const fetchPage = createHevyPageFetcher(apiKey);
    result = await fetchHevyBackfill(fetchPage, MOBILE_HEVY_PAGES_PER_CALL, {
      startPage: cursor?.hevyPage ?? 1,
      stopOnRateLimit: true,
    });
  } catch (err) {
    if (err instanceof HevyAuthError) {
      throw new ApiKeyError(err.message);
    }
    throw err;
  }

  const activities = (result.workouts as HevyWorkout[]).map((w) => {
    const startTime = new Date(w.start_time);
    const endTime = new Date(w.end_time);
    const durationSeconds = Math.round((endTime.getTime() - startTime.getTime()) / 1000);
    return {
      externalId: `hevy-${w.id}`,
      provider: 'hevy',
      name: w.title,
      activityType: 'strength',
      startedAt: startTime.toISOString(),
      durationSeconds: durationSeconds > 0 ? durationSeconds : 0,
      rawData: JSON.stringify(w),
    };
  });
  return {
    activities,
    undated: new Set(),
    next: result.truncated ? { hevyPage: result.nextPage } : null,
    errors: result.rateLimited
      ? [{
        entityType: 'activities',
        code: 'provider_rate_limited',
        message: 'Hevy rate limit reached; the sync continues from where it stopped.',
        retryAfterSeconds: 60,
      }]
      : [],
    failure: null,
  };
}

/** Shares the fetcher and row mapping with liftosaur-sync (../_shared/liftosaurSync.ts). */
async function fetchLiftosaurActivities(
  apiKey: string,
  cursor: PagingCursor | null,
): Promise<ProviderFetchResult> {
  let result;
  try {
    result = await fetchLiftosaurHistory(createLiftosaurPageFetcher(apiKey), {
      cursor: cursor?.liftosaurCursor ?? null,
      maxPages: MOBILE_LIFTOSAUR_PAGES_PER_CALL,
    });
  } catch (err) {
    if (err instanceof LiftosaurAuthError) {
      throw new ApiKeyError(err.message);
    }
    throw err;
  }

  // Undated records get the import time on first insert only (the column is
  // NOT NULL); persistActivities writes them insert-only and then re-applies
  // the other columns, and the DTO is given the stored date afterwards.
  const importedAt = new Date().toISOString();
  const undated = new Set<string>();
  const activities = result.records.map((record) => {
    // Only the provider-derived fields are read here; persistActivities sets
    // user_id itself, so no user id is needed for the mapping.
    const { undated: isUndated, row } = toLiftosaurActivityRow('', record, importedAt);
    const externalId = row.external_id as string;
    if (isUndated) undated.add(externalId);
    return {
      externalId,
      provider: 'liftosaur',
      name: row.name as string,
      activityType: 'strength',
      startedAt: row.started_at as string,
      durationSeconds: (row.duration_seconds as number | null) ?? 0,
      rawData: JSON.stringify({ id: record.id, text: record.text }),
    };
  });

  const canContinue = result.truncated && result.nextCursor !== null;
  return {
    activities,
    undated,
    next: canContinue ? { liftosaurCursor: result.nextCursor! } : null,
    errors: [],
    failure: result.truncated && !canContinue
      ? 'Liftosaur reported more history but no cursor to continue from; ' +
        `${activities.length} activities stored, the rest could not be imported.`
      : null,
  };
}

// Custom error for API key issues (distinguishes from other errors)
class ApiKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ApiKeyError';
  }
}

// =============================================================================
// Handler
// =============================================================================

export interface MobileIntegrationSyncAuthClient {
  auth: {
    getUser(): Promise<{ data: { user: { id: string } | null } }>;
  };
}

export interface MobileIntegrationSyncDependencies {
  createAuthClient(authorization: string): MobileIntegrationSyncAuthClient;
  createAdminClient(): DbClient;
}

function defaultDependencies(): MobileIntegrationSyncDependencies {
  return {
    createAuthClient(authorization: string) {
      return createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_ANON_KEY')!,
        { global: { headers: { Authorization: authorization } } }
      ) as unknown as MobileIntegrationSyncAuthClient;
    },
    createAdminClient() {
      return createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
      );
    },
  };
}

async function mobileIntegrationSyncHandler(
  req: Request,
  deps: MobileIntegrationSyncDependencies,
): Promise<Response> {
  const cors = getCorsHeaders(req);
  const json = { ...cors, 'Content-Type': 'application/json' };

  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors });
  }

  // POST only
  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({ status: 'error', error: 'Method not allowed' }),
      { status: 405, headers: json }
    );
  }

  try {
    // =========================================================================
    // 1. JWT verification — authenticate the mobile user
    // =========================================================================
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ status: 'error', error: 'Missing Authorization header' }),
        { status: 401, headers: json }
      );
    }

    const supabaseAuth = deps.createAuthClient(authHeader);

    const {
      data: { user },
    } = await supabaseAuth.auth.getUser();

    if (!user) {
      return new Response(
        JSON.stringify({ status: 'error', error: 'Not authenticated' }),
        { status: 401, headers: json }
      );
    }

    const userId = user.id;

    // =========================================================================
    // 2. Parse and validate request body
    // =========================================================================
    let body: MobileIntegrationRequest;
    try {
      body = await req.json();
    } catch {
      return new Response(
        JSON.stringify({ status: 'error', error: 'Invalid JSON body' }),
        { status: 400, headers: json }
      );
    }

    const { provider, action, apiKey } = body ?? {};

    if (!provider || !ALLOWED_PROVIDERS.has(provider)) {
      return new Response(
        JSON.stringify({ status: 'error', error: `Unsupported provider. Allowed: ${[...ALLOWED_PROVIDERS].join(', ')}` }),
        { status: 400, headers: json }
      );
    }

    if (!action || !ALLOWED_ACTIONS.has(action)) {
      return new Response(
        JSON.stringify({ status: 'error', error: `Invalid action. Allowed: ${[...ALLOWED_ACTIONS].join(', ')}` }),
        { status: 400, headers: json }
      );
    }

    const hasCursor = body.cursor !== undefined && body.cursor !== null;
    const cursor = hasCursor ? decodeCursor(body.cursor, provider) : null;
    if (hasCursor && action !== 'disconnect' && cursor === null) {
      return new Response(
        JSON.stringify({ status: 'error', error: 'Invalid sync cursor (INVALID_CURSOR). Start the sync again.' }),
        { status: 400, headers: json }
      );
    }

    // =========================================================================
    // 3. Service-role client for DB operations (bypasses RLS) + rate limit
    // =========================================================================
    const supabase = deps.createAdminClient();

    const limit = cursor ? CONTINUATION_LIMIT : FRESH_CALL_LIMIT;
    const rateCheck = await checkRateLimit(supabase, { ...limit, userId }, cors);
    if (!rateCheck.allowed) return rateCheck.response!;

    // =========================================================================
    // 4. Handle DISCONNECT
    // =========================================================================
    if (action === 'disconnect') {
      await Promise.all([
        supabase
          .from('oauth_tokens')
          .delete()
          .eq('user_id', userId)
          .eq('provider', provider),
        supabase
          .from('user_integrations')
          .update({
            status: 'disconnected',
            connected_at: null,
            error_message: null,
            // Drop any in-progress liftosaur-sync backfill so a reconnect
            // starts fresh instead of resuming a stale chain.
            backfill_before: null,
            backfill_started_at: null,
          })
          .eq('user_id', userId)
          .eq('provider', provider),
      ]);

      return new Response(
        JSON.stringify({ status: 'disconnected' }),
        { headers: json }
      );
    }

    const gate = await requireSubscription(supabase, userId, 'FLAME', cors);
    if (!gate.allowed) return gate.response;

    // =========================================================================
    // 5. Handle CONNECT (first call) — store API key + fetch activities.
    //    A connect continuation (cursor, no apiKey) behaves like sync.
    // =========================================================================
    if (action === 'connect' && !cursor) {
      if (!apiKey || typeof apiKey !== 'string' || apiKey.trim().length === 0) {
        return new Response(
          JSON.stringify({ status: 'error', error: 'API key is required for connect action' }),
          { status: 400, headers: json }
        );
      }

      // Store API key in oauth_tokens (server-only table, same as hevy-sync/liftosaur-sync)
      const { error: tokenUpsertError } = await supabase
        .from('oauth_tokens')
        .upsert(
          {
            user_id: userId,
            provider,
            api_key: await encryptOAuthSecret(apiKey),
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'user_id,provider' }
        );

      if (tokenUpsertError) {
        console.error(`Failed to store ${provider} API key:`, tokenUpsertError);
        return new Response(
          JSON.stringify({ status: 'error', error: 'Failed to store API key' }),
          { status: 500, headers: json }
        );
      }

      // Update user_integrations status
      await supabase
        .from('user_integrations')
        .upsert(
          {
            user_id: userId,
            provider,
            status: 'connected',
            connected_at: new Date().toISOString(),
            error_message: null,
          },
          { onConflict: 'user_id,provider' }
        );

      return await importProviderActivities(supabase, userId, provider, apiKey, 'connected', null, cors);
    }

    // =========================================================================
    // 6. Handle SYNC (and connect continuations) — use the stored API key
    // =========================================================================

    // Retrieve stored API key. Use maybeSingle so a genuinely-missing row is
    // null (handled below as "connect first"), and surface a real DB error as a
    // retryable 500 instead of silently treating it as "no key found" (F355).
    const { data: tokenData, error: tokenError } = await supabase
      .from('oauth_tokens')
      .select('api_key')
      .eq('user_id', userId)
      .eq('provider', provider)
      .maybeSingle();

    if (tokenError) {
      console.error('mobile-integration-sync stored-token lookup failed:', tokenError);
      return new Response(
        JSON.stringify({
          status: 'error',
          error: 'Failed to read stored integration credentials. Please retry shortly.',
        }),
        { status: 500, headers: json }
      );
    }

    const storedApiKey = (await decryptOAuthSecret(tokenData?.api_key)) ?? '';

    if (!storedApiKey) {
      return new Response(
        JSON.stringify({
          status: 'error',
          error: `No ${provider} API key found. Connect the integration first.`,
        }),
        { status: 400, headers: json }
      );
    }

    const successStatus = action === 'connect' ? 'connected' : 'synced';
    return await importProviderActivities(
      supabase, userId, provider, storedApiKey, successStatus, cursor, cors,
    );
  } catch (err) {
    console.error('mobile-integration-sync error:', describeError(err));
    return new Response(
      JSON.stringify({ status: 'error', error: 'Internal server error' }),
      { status: 500, headers: json }
    );
  }
}

export function createMobileIntegrationSyncHandler(
  deps: MobileIntegrationSyncDependencies = defaultDependencies(),
): (req: Request) => Promise<Response> {
  return (req) => mobileIntegrationSyncHandler(req, deps);
}

if (import.meta.main) {
  Deno.serve(createMobileIntegrationSyncHandler());
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Fetch one bounded slice from the provider, persist it, and build the
 * response shared by the connect and sync actions.
 *
 * - More remains and the chain can continue: 200 with the activities read,
 *   `hasMore: true` and `nextCursor`; integration status and `last_sync_at`
 *   are left alone (the chain is in progress, not failing).
 * - Final slice: `last_sync_at` = the chain's start time.
 * - More remains but cannot be continued: the activities read are still
 *   returned (200, `partial: true`, `errors`), and the integration card shows
 *   the error; `last_sync_at` is not advanced.
 */
async function importProviderActivities(
  supabase: DbClient,
  userId: string,
  provider: string,
  apiKey: string,
  successStatus: 'connected' | 'synced',
  cursor: PagingCursor | null,
  cors: Record<string, string>,
): Promise<Response> {
  const json = { ...cors, 'Content-Type': 'application/json' };
  const chainStartedAt = cursor?.chainStartedAt ?? new Date().toISOString();

  let fetched: ProviderFetchResult;
  try {
    fetched = provider === 'hevy'
      ? await fetchHevyActivities(apiKey, cursor)
      : await fetchLiftosaurActivities(apiKey, cursor);
  } catch (fetchErr) {
    const isApiKeyError = fetchErr instanceof ApiKeyError;
    // ApiKeyError messages are fixed strings. Anything else may carry
    // provider text: log it, and show a generic message with a short code.
    if (!isApiKeyError) {
      console.error(`mobile-integration-sync ${provider} fetch failed:`, describeError(fetchErr));
    }
    const message = isApiKeyError
      ? (fetchErr as Error).message
      : `Could not fetch from ${provider} (${PROVIDER_FETCH_ERROR_CODE}). Please retry shortly.`;

    await supabase
      .from('user_integrations')
      .update({
        status: 'error',
        error_message: message,
      })
      .eq('user_id', userId)
      .eq('provider', provider);

    return new Response(
      JSON.stringify({
        status: 'error',
        error: message,
        ...(isApiKeyError ? {} : { code: PROVIDER_FETCH_ERROR_CODE }),
      }),
      { status: isApiKeyError ? 403 : 502, headers: json }
    );
  }

  const { activities, undated } = fetched;

  if (activities.length > 0) {
    const failedCount = await persistActivities(supabase, userId, provider, activities, undated);
    if (failedCount > 0) {
      return await partialPersistFailureResponse(
        supabase, userId, provider, failedCount, activities.length, cors,
      );
    }
  }

  // The phone overwrites startedAt on an existing externalId, so give it the
  // STORED date of an undated record, not this attempt's import time.
  if (undated.size > 0) {
    const storedDates = await readStoredStartedAt(supabase, userId, provider, [...undated]);
    if (storedDates === null) {
      return await partialPersistFailureResponse(
        supabase, userId, provider, undated.size, activities.length, cors,
      );
    }
    for (const activity of activities) {
      const stored = storedDates.get(activity.externalId);
      if (stored) activity.startedAt = stored;
    }
  }

  if (fetched.failure) {
    console.warn(`mobile-integration-sync: ${fetched.failure}`);
    await supabase
      .from('user_integrations')
      .update({ status: 'error', error_message: fetched.failure })
      .eq('user_id', userId)
      .eq('provider', provider);

    return new Response(
      JSON.stringify({
        status: successStatus,
        activities,
        hasMore: false,
        partial: true,
        errors: [{ entityType: 'activities', code: 'history_truncated', message: fetched.failure }],
        error: fetched.failure,
      }),
      { headers: json }
    );
  }

  if (fetched.next) {
    const nextCursor = encodeCursor({
      v: 1,
      provider: provider as PagingCursor['provider'],
      ...fetched.next,
      chainStartedAt,
    });
    return new Response(
      JSON.stringify({
        status: successStatus,
        activities,
        hasMore: true,
        nextCursor,
        partial: fetched.errors.length > 0,
        errors: fetched.errors,
      }),
      { headers: json }
    );
  }

  // Final slice: every page of the chain has been read and stored.
  await supabase
    .from('user_integrations')
    .update({
      last_sync_at: chainStartedAt,
      status: 'connected',
      error_message: null,
    })
    .eq('user_id', userId)
    .eq('provider', provider);

  return new Response(
    JSON.stringify({
      status: successStatus,
      activities,
      hasMore: false,
    }),
    { headers: json }
  );
}

/**
 * Persist normalized activities to external_activities table.
 * Maps ActivityDto camelCase fields to snake_case columns.
 *
 * Activities in `undated` are written insert-only (ignoreDuplicates), so an
 * already stored record keeps its original started_at; their other columns
 * are then re-applied without started_at so edits still land.
 *
 * Returns the number of activities that failed to persist so callers can avoid
 * advancing `last_sync_at` past data that was never written (which would skip
 * those activities permanently on the next incremental sync).
 */
async function persistActivities(
  supabase: DbClient,
  userId: string,
  provider: string,
  activities: ActivityDto[],
  undated: ReadonlySet<string>,
): Promise<number> {
  let failedCount = 0;
  const syncedAt = new Date().toISOString();
  const rowFor = (activity: ActivityDto) => ({
    user_id: userId,
    external_id: activity.externalId,
    provider,
    name: activity.name,
    activity_type: activity.activityType,
    started_at: activity.startedAt,
    duration_seconds: activity.durationSeconds > 0 ? activity.durationSeconds : null,
    distance_meters: activity.distanceMeters ?? null,
    calories: activity.calories ?? null,
    avg_heart_rate: activity.avgHeartRate ?? null,
    max_heart_rate: activity.maxHeartRate ?? null,
    elevation_gain_meters: activity.elevationGainMeters ?? null,
    raw_data: activity.rawData
      ? redactTokenShapedJson(JSON.parse(activity.rawData))
      : null,
    synced_at: syncedAt,
  });

  for (const activity of activities) {
    const { error } = await supabase
      .from('external_activities')
      .upsert(rowFor(activity), {
        onConflict: 'user_id,provider,external_id',
        ignoreDuplicates: undated.has(activity.externalId),
      });

    if (error) {
      failedCount++;
      console.error(`Failed to persist activity ${activity.externalId}:`, error.message);
    }
  }
  if (failedCount > 0) return failedCount;

  for (const activity of activities) {
    if (!undated.has(activity.externalId)) continue;
    // The row exists now: ON CONFLICT DO UPDATE of everything but started_at.
    const { started_at: _startedAt, ...refresh } = rowFor(activity);
    const { error } = await supabase
      .from('external_activities')
      .upsert(refresh, { onConflict: 'user_id,provider,external_id' });
    if (error) {
      failedCount++;
      console.error(`Failed to update activity ${activity.externalId}:`, error.message);
    }
  }
  return failedCount;
}

/** Stored started_at for `externalIds`, or null when the read fails. */
async function readStoredStartedAt(
  supabase: DbClient,
  userId: string,
  provider: string,
  externalIds: string[],
): Promise<Map<string, string> | null> {
  const stored = new Map<string, string>();
  const CHUNK = 100;
  for (let i = 0; i < externalIds.length; i += CHUNK) {
    const { data, error } = await supabase
      .from('external_activities')
      .select('external_id, started_at')
      .eq('user_id', userId)
      .eq('provider', provider)
      .in('external_id', externalIds.slice(i, i + CHUNK));
    if (error) {
      console.error('Failed to read stored activity dates:', error.message);
      return null;
    }
    for (const row of (data ?? []) as Array<{ external_id: string; started_at: string }>) {
      stored.set(row.external_id, new Date(row.started_at).toISOString());
    }
  }
  return stored;
}

/**
 * Mark the integration as a partial-persistence failure and build the 502 the
 * caller should return. Does NOT advance `last_sync_at` so the next sync retries.
 */
async function partialPersistFailureResponse(
  supabase: DbClient,
  userId: string,
  provider: string,
  failedCount: number,
  total: number,
  cors: Record<string, string>,
): Promise<Response> {
  const failMessage = `Failed to persist ${failedCount} of ${total} activities`;
  await supabase
    .from('user_integrations')
    .update({ status: 'error', error_message: failMessage })
    .eq('user_id', userId)
    .eq('provider', provider);

  return new Response(
    JSON.stringify({ status: 'error', error: failMessage }),
    { status: 502, headers: { ...cors, 'Content-Type': 'application/json' } }
  );
}
