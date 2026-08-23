import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { getCorsHeaders } from '../_shared/cors.ts';
import { redactTokenShapedJson } from '../_shared/garminIdentity.ts';
import {
  createHevyPageFetcher,
  fetchHevyBackfill,
  HevyAuthError,
} from '../_shared/hevySync.ts';
import { checkRateLimit } from '../_shared/rateLimit.ts';
import { decryptOAuthSecret, encryptOAuthSecret } from '../_shared/oauthTokenCrypto.ts';
import { requireSubscription } from '../_shared/requireSubscription.ts';

/**
 * Loose Supabase client type for helper signatures. The bare
 * `ReturnType<typeof createClient>` collapses table payload types to `never`.
 */
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

// =============================================================================
// Provider API configuration
// =============================================================================

const LIFTOSAUR_API_BASE = 'https://www.liftosaur.com/api/v1';

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
// Liftosaur types
// =============================================================================

interface LiftosaurRecord {
  id: number;
  text: string;
}

interface LiftosaurHistoryResponse {
  data: {
    records: LiftosaurRecord[];
    hasMore: boolean;
    nextCursor: number | null;
  };
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
// Liftosaur text parser (mirrors liftosaur-sync)
// =============================================================================

function parseLiftoscriptMetadata(text: string): {
  timestamp: string | null;
  program: string | null;
  dayName: string | null;
  durationSeconds: number | null;
} {
  const tsMatch = text.match(
    /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?)/
  );
  const timestamp = tsMatch?.[1] ?? null;

  const programMatch = text.match(/program:\s*"([^"]+)"/);
  const program = programMatch?.[1] ?? null;

  const dayNameMatch = text.match(/dayName:\s*"([^"]+)"/);
  const dayName = dayNameMatch?.[1] ?? null;

  const durationMatch = text.match(/duration:\s*(\d+)s/);
  const durationSeconds = durationMatch ? parseInt(durationMatch[1], 10) : null;

  return { timestamp, program, dayName, durationSeconds };
}

// =============================================================================
// Provider fetch logic
// =============================================================================

/**
 * Shares the paginator with hevy-sync (../_shared/hevySync.ts) so the mobile
 * and portal import paths cannot drift on page size or termination logic.
 * Only the returned DTO shape differs — mobile takes camelCase.
 */
async function fetchHevyActivities(apiKey: string): Promise<ActivityDto[]> {
  let allWorkouts: HevyWorkout[];
  try {
    const fetchPage = createHevyPageFetcher(apiKey);
    const result = await fetchHevyBackfill(fetchPage);
    allWorkouts = result.workouts as HevyWorkout[];
  } catch (err) {
    if (err instanceof HevyAuthError) {
      throw new ApiKeyError(err.message);
    }
    throw err;
  }

  return allWorkouts.map((w) => {
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
}

async function fetchLiftosaurActivities(apiKey: string): Promise<ActivityDto[]> {
  const allRecords: LiftosaurRecord[] = [];
  let cursor: number | null = null;
  let hasMore = true;
  const MAX_PAGES = 10;
  let page = 0;

  while (hasMore && page < MAX_PAGES) {
    const params = new URLSearchParams({ limit: '200' });
    if (cursor !== null) {
      params.set('cursor', cursor.toString());
    }

    const response = await fetch(
      `${LIFTOSAUR_API_BASE}/history?${params.toString()}`,
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
      }
    );

    if (response.status === 401 || response.status === 403) {
      throw new ApiKeyError('Liftosaur API access denied. Verify your API key and Premium subscription.');
    }
    if (!response.ok) {
      throw new Error(`Liftosaur API returned ${response.status}`);
    }

    const result: LiftosaurHistoryResponse = await response.json();
    allRecords.push(...result.data.records);
    hasMore = result.data.hasMore;
    cursor = result.data.nextCursor;
    page++;
  }

  return allRecords.map((record) => {
    const meta = parseLiftoscriptMetadata(record.text);
    const name = meta.dayName
      ? meta.program
        ? `${meta.program} — ${meta.dayName}`
        : meta.dayName
      : meta.program ?? `Workout #${record.id}`;

    const startedAt = meta.timestamp
      ? new Date(meta.timestamp).toISOString()
      : new Date().toISOString();

    return {
      externalId: `liftosaur-${record.id}`,
      provider: 'liftosaur',
      name,
      activityType: 'strength',
      startedAt,
      durationSeconds: meta.durationSeconds ?? 0,
      rawData: JSON.stringify({ id: record.id, text: record.text }),
    };
  });
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

Deno.serve(async (req) => {
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

    const supabaseAuth = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );

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
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

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

      // Fetch activities from the provider
      let activities: ActivityDto[];
      try {
        activities = provider === 'hevy'
          ? await fetchHevyActivities(apiKey)
          : await fetchLiftosaurActivities(apiKey);
      } catch (fetchErr) {
        const isApiKeyError = fetchErr instanceof ApiKeyError;
        const errorMessage = (fetchErr as Error).message;

        // Update integration status to error
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

      if (activities.length > 0) {
        const failedCount = await persistActivities(supabase, userId, provider, activities);
        if (failedCount > 0) {
          return await partialPersistFailureResponse(
            supabase, userId, provider, failedCount, activities.length, cors,
          );
        }
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
          status: 'connected',
          activities,
        }),
        { headers: { ...cors, 'Content-Type': 'application/json' } }
      );
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

    // Fetch activities from the provider
    let activities: ActivityDto[];
    try {
      activities = provider === 'hevy'
        ? await fetchHevyActivities(storedApiKey)
        : await fetchLiftosaurActivities(storedApiKey);
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

    if (activities.length > 0) {
      const failedCount = await persistActivities(supabase, userId, provider, activities);
      if (failedCount > 0) {
        return await partialPersistFailureResponse(
          supabase, userId, provider, failedCount, activities.length, cors,
        );
      }
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
        status: 'synced',
        activities,
      }),
      { headers: { ...cors, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    console.error('mobile-integration-sync error:', err);
    return new Response(
      JSON.stringify({ status: 'error', error: (err as Error).message ?? 'Internal server error' }),
      { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } }
    );
  }
});

// =============================================================================
// Helpers
// =============================================================================

/**
 * Persist normalized activities to external_activities table.
 * Maps ActivityDto camelCase fields to snake_case columns.
 *
 * Returns the number of activities that failed to persist so callers can avoid
 * advancing `last_sync_at` past data that was never written (which would skip
 * those activities permanently on the next incremental sync).
 */
async function persistActivities(
  supabase: DbClient,
  userId: string,
  provider: string,
  activities: ActivityDto[]
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
        { onConflict: 'user_id,provider,external_id' }
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
