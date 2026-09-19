import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { getCorsHeaders } from '../_shared/cors.ts';
import { redactTokenShapedJson } from '../_shared/garminIdentity.ts';
import {
  createHevyPageFetcher,
  fetchHevyBackfill,
  HEVY_MAX_PAGES,
  HevyAuthError,
} from '../_shared/hevySync.ts';
import {
  createLiftosaurPageFetcher,
  fetchLiftosaurHistory,
  LIFTOSAUR_MAX_PAGES,
  LiftosaurAuthError,
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
 * POST /functions/v1/mobile-integration-sync
 * Authorization: Bearer <GoTrue JWT>
 * Body: { provider: "hevy" | "liftosaur", action: "connect" | "sync" | "disconnect", apiKey?: string }
 */

const ALLOWED_PROVIDERS = new Set(['hevy', 'liftosaur']);
const ALLOWED_ACTIONS = new Set(['connect', 'sync', 'disconnect']);

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
// Request body
// =============================================================================

interface MobileIntegrationRequest {
  provider: string;
  action: string;
  apiKey?: string;
}

// =============================================================================
// Provider fetch logic
// =============================================================================

interface ProviderFetchResult {
  activities: ActivityDto[];
  /**
   * External ids whose provider record has no parseable date. They are
   * persisted insert-only so a re-sync never moves their stored date.
   */
  undatedIds: Set<string>;
  /** True when the provider still had pages after the per-run page ceiling. */
  truncated: boolean;
  maxPages: number;
}

/**
 * Shares the paginator with hevy-sync (../_shared/hevySync.ts) so the mobile
 * and portal import paths cannot drift on page size or termination logic.
 * Only the returned DTO shape differs — mobile takes camelCase.
 */
async function fetchHevyActivities(apiKey: string): Promise<ProviderFetchResult> {
  let allWorkouts: HevyWorkout[];
  let truncated: boolean;
  try {
    const fetchPage = createHevyPageFetcher(apiKey);
    const result = await fetchHevyBackfill(fetchPage);
    allWorkouts = result.workouts as HevyWorkout[];
    truncated = result.truncated;
  } catch (err) {
    if (err instanceof HevyAuthError) {
      throw new ApiKeyError(err.message);
    }
    throw err;
  }

  const activities = allWorkouts.map((w) => {
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
  return { activities, undatedIds: new Set(), truncated, maxPages: HEVY_MAX_PAGES };
}

/** Shares the fetcher and row mapping with liftosaur-sync (../_shared/liftosaurSync.ts). */
async function fetchLiftosaurActivities(apiKey: string): Promise<ProviderFetchResult> {
  let result;
  try {
    result = await fetchLiftosaurHistory(createLiftosaurPageFetcher(apiKey));
  } catch (err) {
    if (err instanceof LiftosaurAuthError) {
      throw new ApiKeyError(err.message);
    }
    throw err;
  }

  // Undated records get the import time on first insert only (the column is
  // NOT NULL); persistActivities writes them insert-only, so the stored date
  // stays put on re-sync. The DTO echoes the attempted value, which for an
  // already stored undated record can differ from the stored one.
  const importedAt = new Date().toISOString();
  const undatedIds = new Set<string>();
  const activities = result.records.map((record) => {
    const { undated, row } = toLiftosaurActivityRow('', record, importedAt);
    const externalId = row.external_id as string;
    if (undated) undatedIds.add(externalId);
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
  return {
    activities,
    undatedIds,
    truncated: result.truncated,
    maxPages: LIFTOSAUR_MAX_PAGES,
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

  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors });
  }

  // POST only
  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({ status: 'error', error: 'Method not allowed' }),
      { status: 405, headers: { ...cors, 'Content-Type': 'application/json' } }
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
        { status: 401, headers: { ...cors, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseAuth = deps.createAuthClient(authHeader);

    const {
      data: { user },
    } = await supabaseAuth.auth.getUser();

    if (!user) {
      return new Response(
        JSON.stringify({ status: 'error', error: 'Not authenticated' }),
        { status: 401, headers: { ...cors, 'Content-Type': 'application/json' } }
      );
    }

    const userId = user.id;

    // =========================================================================
    // 2. Service-role client for DB operations (bypasses RLS)
    // =========================================================================
    const supabase = deps.createAdminClient();

    const rateCheck = await checkRateLimit(supabase, {
      key: 'mobile-integration-sync',
      userId,
      maxRequests: 5,
      windowSeconds: 60,
    }, cors);
    if (!rateCheck.allowed) return rateCheck.response!;

    // =========================================================================
    // 3. Parse and validate request body
    // =========================================================================
    let body: MobileIntegrationRequest;
    try {
      body = await req.json();
    } catch {
      return new Response(
        JSON.stringify({ status: 'error', error: 'Invalid JSON body' }),
        { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } }
      );
    }

    const { provider, action, apiKey } = body;

    if (!provider || !ALLOWED_PROVIDERS.has(provider)) {
      return new Response(
        JSON.stringify({ status: 'error', error: `Unsupported provider. Allowed: ${[...ALLOWED_PROVIDERS].join(', ')}` }),
        { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } }
      );
    }

    if (!action || !ALLOWED_ACTIONS.has(action)) {
      return new Response(
        JSON.stringify({ status: 'error', error: `Invalid action. Allowed: ${[...ALLOWED_ACTIONS].join(', ')}` }),
        { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } }
      );
    }

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
          })
          .eq('user_id', userId)
          .eq('provider', provider),
      ]);

      return new Response(
        JSON.stringify({ status: 'disconnected' }),
        { headers: { ...cors, 'Content-Type': 'application/json' } }
      );
    }

    const gate = await requireSubscription(supabase, userId, 'FLAME', cors);
    if (!gate.allowed) return gate.response;

    // =========================================================================
    // 5. Handle CONNECT — store API key + fetch activities
    // =========================================================================
    if (action === 'connect') {
      if (!apiKey || typeof apiKey !== 'string' || apiKey.trim().length === 0) {
        return new Response(
          JSON.stringify({ status: 'error', error: 'API key is required for connect action' }),
          { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } }
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
          { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } }
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

      return await importProviderActivities(supabase, userId, provider, apiKey, 'connected', cors);
    }

    // =========================================================================
    // 6. Handle SYNC — fetch new activities using stored API key
    // =========================================================================
    // action === 'sync'

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
        { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } }
      );
    }

    const storedApiKey = (await decryptOAuthSecret(tokenData?.api_key)) ?? '';

    if (!storedApiKey) {
      return new Response(
        JSON.stringify({
          status: 'error',
          error: `No ${provider} API key found. Connect the integration first.`,
        }),
        { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } }
      );
    }

    return await importProviderActivities(supabase, userId, provider, storedApiKey, 'synced', cors);
  } catch (err) {
    console.error('mobile-integration-sync error:', err);
    return new Response(
      JSON.stringify({ status: 'error', error: (err as Error).message ?? 'Internal server error' }),
      { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } }
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
 * Fetch from the provider, persist, and build the response shared by the
 * connect and sync actions. `last_sync_at` advances only when every activity
 * was fetched AND persisted.
 */
async function importProviderActivities(
  supabase: DbClient,
  userId: string,
  provider: string,
  apiKey: string,
  successStatus: 'connected' | 'synced',
  cors: Record<string, string>,
): Promise<Response> {
  let fetched: ProviderFetchResult;
  try {
    fetched = provider === 'hevy'
      ? await fetchHevyActivities(apiKey)
      : await fetchLiftosaurActivities(apiKey);
  } catch (fetchErr) {
    const isApiKeyError = fetchErr instanceof ApiKeyError;
    const errorMessage = (fetchErr as Error).message;

    await supabase
      .from('user_integrations')
      .update({
        status: 'error',
        error_message: errorMessage,
      })
      .eq('user_id', userId)
      .eq('provider', provider);

    return new Response(
      JSON.stringify({ status: 'error', error: errorMessage }),
      {
        status: isApiKeyError ? 403 : 502,
        headers: { ...cors, 'Content-Type': 'application/json' },
      }
    );
  }

  const { activities, undatedIds, truncated, maxPages } = fetched;

  if (activities.length > 0) {
    const failedCount = await persistActivities(supabase, userId, provider, activities, undatedIds);
    if (failedCount > 0) {
      return await partialPersistFailureResponse(
        supabase, userId, provider, failedCount, activities.length, cors,
      );
    }
  }

  // The provider still had pages after the per-run ceiling. What was read is
  // stored, but the import is incomplete: report it as an error (visible on the
  // integration card and to the mobile caller) and do NOT advance last_sync_at.
  if (truncated) {
    const truncMessage =
      `${provider} history exceeded the ${maxPages}-page budget; ` +
      `${activities.length} activities stored, the rest were not imported`;
    console.warn(`mobile-integration-sync: ${truncMessage}`);
    await supabase
      .from('user_integrations')
      .update({ status: 'error', error_message: truncMessage })
      .eq('user_id', userId)
      .eq('provider', provider);

    return new Response(
      JSON.stringify({
        status: 'error',
        error: truncMessage,
        truncated: true,
        imported: activities.length,
      }),
      { status: 502, headers: { ...cors, 'Content-Type': 'application/json' } }
    );
  }

  // Update last sync timestamp
  await supabase
    .from('user_integrations')
    .update({
      last_sync_at: new Date().toISOString(),
      status: 'connected',
      error_message: null,
    })
    .eq('user_id', userId)
    .eq('provider', provider);

  return new Response(
    JSON.stringify({
      status: successStatus,
      activities,
    }),
    { headers: { ...cors, 'Content-Type': 'application/json' } }
  );
}

/**
 * Persist normalized activities to external_activities table.
 * Maps ActivityDto camelCase fields to snake_case columns.
 *
 * Activities in `undatedIds` are written insert-only (ignoreDuplicates), so an
 * already stored record keeps its original started_at.
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
  undatedIds: ReadonlySet<string>,
): Promise<number> {
  let failedCount = 0;
  for (const activity of activities) {
    const { error } = await supabase
      .from('external_activities')
      .upsert(
        {
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
          synced_at: new Date().toISOString(),
        },
        {
          onConflict: 'user_id,provider,external_id',
          ignoreDuplicates: undatedIds.has(activity.externalId),
        }
      );

    if (error) {
      failedCount++;
      console.error(`Failed to persist activity ${activity.externalId}:`, error.message);
    }
  }
  return failedCount;
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
