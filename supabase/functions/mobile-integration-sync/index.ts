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
  completedSyncColumns,
  createLiftosaurPageFetcher,
  fetchLiftosaurHistory,
  LiftosaurAuthError,
  type LiftosaurFetchResult,
  type LiftosaurIntegrationState,
  planLiftosaurSync,
  resolveLiftosaurTruncation,
  toLiftosaurActivityRow,
  writeLiftosaurRows,
} from '../_shared/liftosaurSync.ts';
import { checkRateLimit } from '../_shared/rateLimit.ts';
import { decryptOAuthSecret, encryptOAuthSecret } from '../_shared/oauthTokenCrypto.ts';
import { requireSubscription } from '../_shared/requireSubscription.ts';
import {
  defaultProviderRevokeDependencies,
  type ProviderRevokeDependencies,
  revokeAndDisconnect,
} from '../_shared/providerRevoke.ts';

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
 * Imports never truncate silently (F-020). Liftosaur shares its fetcher,
 * resumable backfill (user_integrations.backfill_*) and undated-record rule
 * with liftosaur-sync (_shared/liftosaurSync.ts): a `connect` starts a
 * full-history chain, each `sync` continues it, and last_sync_at moves only
 * once the whole window has been read. A Hevy backfill that hits its page
 * budget is reported and never advances the watermark, as in hevy-sync.
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

/**
 * Shares the paginator with hevy-sync (../_shared/hevySync.ts) so the mobile
 * and portal import paths cannot drift on page size or termination logic.
 * Only the returned DTO shape differs — mobile takes camelCase.
 */
async function fetchHevyActivities(
  apiKey: string,
  fetchImpl: typeof fetch,
): Promise<{ activities: ActivityDto[]; truncated: boolean }> {
  let allWorkouts: HevyWorkout[];
  let truncated: boolean;
  try {
    const result = await fetchHevyBackfill(createHevyPageFetcher(apiKey, fetchImpl));
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
  return { activities, truncated };
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

interface MobileIntegrationAuthClient {
  auth: {
    getUser(): Promise<{ data: { user: { id: string } | null } }>;
  };
}

export interface MobileIntegrationSyncDependencies {
  /** Client acting as the caller (their JWT), used only to identify them. */
  createAuthClient(authorization: string): MobileIntegrationAuthClient;
  /** Service-role client for DB operations (bypasses RLS). */
  createAdminClient(): DbClient;
  /** Provider revoke HTTP + credentials; injected so tests never hit a provider. */
  revoke: ProviderRevokeDependencies;
  /** Provider API fetch; defaults to global fetch. */
  fetch?: typeof fetch;
  /** Wall clock; defaults to `new Date()`. */
  now?: () => Date;
}

function defaultMobileIntegrationSyncDependencies(): MobileIntegrationSyncDependencies {
  return {
    createAuthClient(authorization: string) {
      return createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_ANON_KEY')!,
        { global: { headers: { Authorization: authorization } } }
      );
    },
    createAdminClient() {
      return createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
      );
    },
    revoke: defaultProviderRevokeDependencies(),
  };
}

export function createMobileIntegrationSyncHandler(
  deps: MobileIntegrationSyncDependencies = defaultMobileIntegrationSyncDependencies(),
): (req: Request) => Promise<Response> {
  return (req) => mobileIntegrationSyncHandler(req, deps);
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

    const {
      data: { user },
    } = await deps.createAuthClient(authHeader).auth.getUser();

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
      // Same path as the portal's disconnect-integration (FP-5): revoke (a
      // no-op for these API-key providers), then disconnect_integration
      // deletes the key, resets the integration and cancels queued syncs in
      // one transaction. Stays ahead of the subscription gate so a lapsed
      // user can always disconnect.
      const result = await revokeAndDisconnect(supabase, userId, provider, deps.revoke);
      if (!result.ok) {
        return new Response(
          JSON.stringify({ status: 'error', error: 'Failed to disconnect integration. Please try again.' }),
          { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } }
        );
      }

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

      // A new Liftosaur key may be another account: clear the previous key's
      // cursor and watermark BEFORE the key is replaced, so no later sync can
      // read the new account against them (a failed key write below then only
      // costs the old key a full, idempotent re-read).
      if (provider === 'liftosaur') {
        const { error: resetError } = await supabase
          .from('user_integrations')
          .update({ last_sync_at: null, backfill_before: null, backfill_after: null, backfill_started_at: null })
          .eq('user_id', userId)
          .eq('provider', provider);
        if (resetError) {
          console.error('Failed to reset liftosaur sync state:', resetError);
          return new Response(
            JSON.stringify({ status: 'error', error: 'Failed to save connection state. Please retry.' }),
            { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } }
          );
        }
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
      const { error: stateError } = await supabase
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
      if (stateError) {
        // A Liftosaur key whose previous cursor was not cleared must not be
        // read against it; retryable.
        console.error(`Failed to save ${provider} connection state:`, stateError);
        return new Response(
          JSON.stringify({ status: 'error', error: 'Failed to save connection state. Please retry.' }),
          { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } }
        );
      }

      return await importActivities({
        supabase, userId, provider, apiKey, action: 'connect', cors, deps,
      });
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

    return await importActivities({
      supabase, userId, provider, apiKey: storedApiKey, action: 'sync', cors, deps,
    });
  } catch (err) {
    // The thrown message can carry DB internals or provider text; it is
    // logged here and summarised to the caller as a stable code.
    console.error('mobile-integration-sync error:', err);
    return new Response(
      JSON.stringify({
        status: 'error',
        error: 'Internal server error',
        code: 'internal_error',
      }),
      { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } }
    );
  }
}

if (import.meta.main) {
  Deno.serve(createMobileIntegrationSyncHandler());
}

// =============================================================================
// Import
// =============================================================================

interface ImportContext {
  supabase: DbClient;
  userId: string;
  provider: string;
  apiKey: string;
  action: 'connect' | 'sync';
  cors: Record<string, string>;
  deps: MobileIntegrationSyncDependencies;
}

/** Fetch, persist and report one provider import (connect or sync). */
function importActivities(ctx: ImportContext): Promise<Response> {
  return ctx.provider === 'hevy' ? importHevy(ctx) : importLiftosaur(ctx);
}

function json(body: unknown, status: number, cors: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

function updateIntegration(ctx: ImportContext, values: Record<string, unknown>) {
  return ctx.supabase
    .from('user_integrations')
    .update(values)
    .eq('user_id', ctx.userId)
    .eq('provider', ctx.provider);
}

async function importHevy(ctx: ImportContext): Promise<Response> {
  const now = ctx.deps.now ?? (() => new Date());
  const okStatus = ctx.action === 'connect' ? 'connected' : 'synced';
  // Captured before fetching so workouts written meanwhile land in the next window.
  const syncStartedAt = now().toISOString();

  let fetched: { activities: ActivityDto[]; truncated: boolean };
  try {
    fetched = await fetchHevyActivities(ctx.apiKey, ctx.deps.fetch ?? fetch);
  } catch (fetchErr) {
    return await providerFetchFailureResponse(
      ctx.supabase, ctx.userId, ctx.provider, fetchErr, ctx.cors,
    );
  }
  const { activities, truncated } = fetched;

  if (activities.length > 0) {
    const failedCount = await persistActivities(
      ctx.supabase, ctx.userId, ctx.provider, activities, now,
    );
    if (failedCount > 0) {
      return await partialPersistFailureResponse(
        ctx.supabase, ctx.userId, ctx.provider, failedCount, activities.length, ctx.cors,
      );
    }
  }

  // /v1/workouts has no date filter and no resumable cursor, so a backfill
  // past the page budget cannot resume: store what was read, never advance
  // the watermark, and say so (the same rule as hevy-sync). Never silent.
  if (truncated) {
    const message =
      `Hevy history exceeds the ${HEVY_MAX_PAGES}-page budget (${activities.length} ` +
      'workouts stored). Older workouts were not imported.';
    await updateIntegration(ctx, { status: 'error', error_message: message });
    console.warn(message);
    return json(
      { status: 'error', error: message, code: 'history_truncated', truncated: true, imported: activities.length },
      500,
      ctx.cors,
    );
  }

  await updateIntegration(ctx, {
    last_sync_at: syncStartedAt,
    status: 'connected',
    error_message: null,
  });
  return json({ status: okStatus, activities }, 200, ctx.cors);
}

async function importLiftosaur(ctx: ImportContext): Promise<Response> {
  const now = ctx.deps.now ?? (() => new Date());
  const okStatus = ctx.action === 'connect' ? 'connected' : 'synced';
  // A connect (a new or re-entered key) reads the full history as a fresh
  // chain; a sync continues any chain in progress, else reads incrementally.
  const syncType = ctx.action === 'connect' ? 'initial' : 'manual';

  const { data: integration, error: integrationError } = await ctx.supabase
    .from('user_integrations')
    .select('last_sync_at, backfill_before, backfill_after, backfill_started_at')
    .eq('user_id', ctx.userId)
    .eq('provider', 'liftosaur')
    .maybeSingle();
  if (integrationError) {
    console.error('mobile-integration-sync integration lookup failed:', integrationError);
    return json(
      { status: 'error', error: 'Failed to read integration state. Please retry shortly.' },
      500,
      ctx.cors,
    );
  }
  const plan = planLiftosaurSync(
    (integration ?? null) as LiftosaurIntegrationState | null,
    syncType,
    now(),
  );

  let fetched: LiftosaurFetchResult;
  try {
    fetched = await fetchLiftosaurHistory(
      createLiftosaurPageFetcher(ctx.apiKey, ctx.deps.fetch ?? fetch),
      { startDate: plan.startDate, endDate: plan.endDate },
    );
  } catch (fetchErr) {
    return await providerFetchFailureResponse(
      ctx.supabase,
      ctx.userId,
      ctx.provider,
      fetchErr instanceof LiftosaurAuthError ? new ApiKeyError(fetchErr.message) : fetchErr,
      ctx.cors,
    );
  }

  // An undated record gets ONE per-run import time on first insert and is
  // never re-dated afterwards (writeLiftosaurRows). No per-row wall clock.
  const importedAt = now().toISOString();
  const rows = fetched.records.map((record) => {
    const built = toLiftosaurActivityRow(ctx.userId, record, importedAt);
    return {
      ...built,
      row: { ...built.row, raw_data: redactTokenShapedJson(built.row.raw_data) },
    };
  });
  const { failed } = await writeLiftosaurRows(
    ctx.supabase,
    ctx.userId,
    rows,
    // external_activities.synced_at is the server's pull cursor (NF-10).
    { synced_at: importedAt },
  );
  if (failed > 0) {
    return await partialPersistFailureResponse(
      ctx.supabase, ctx.userId, ctx.provider, failed, rows.length, ctx.cors,
    );
  }

  const activities = await liftosaurDtos(ctx, rows.map((r) => r.row), rows.filter((r) => r.undated));
  if (activities === null) {
    // The rows are stored, but the phone would get a wrong date for an
    // undated one. Nothing advances; the writes are idempotent on retry.
    return json(
      { status: 'error', error: 'Failed to read stored activity dates. Please retry shortly.' },
      500,
      ctx.cors,
    );
  }

  if (fetched.truncated) {
    const outcome = resolveLiftosaurTruncation(fetched, plan, syncType, rows.length);
    const { error: cursorError } = await updateIntegration(ctx, outcome.columns);
    if (cursorError) return continuationSaveFailed(ctx, cursorError);
    console.warn(outcome.message);
    if (outcome.kind === 'stuck') {
      return json(
        {
          status: 'error',
          error: outcome.message,
          code: 'history_cannot_resume',
          truncated: true,
          imported: rows.length,
        },
        500,
        ctx.cors,
      );
    }
    // The stored cursor (continue) or watermark (resume) lets the next sync
    // pick up where this one stopped.
    return json(
      {
        status: okStatus,
        activities,
        truncated: true,
        continuing: outcome.kind === 'continue',
        message: outcome.message,
        ...(outcome.kind === 'resume' ? { resumeAt: outcome.resumeAt } : {}),
      },
      200,
      ctx.cors,
    );
  }

  const { error: watermarkError } = await updateIntegration(ctx, completedSyncColumns(plan));
  if (watermarkError) return continuationSaveFailed(ctx, watermarkError);
  return json({ status: okStatus, activities }, 200, ctx.cors);
}

/**
 * The rows are stored but the cursor or watermark is not, so the next sync
 * would re-read this window while the phone was told progress was saved.
 * Retryable: the writes are idempotent.
 */
function continuationSaveFailed(ctx: ImportContext, error: unknown): Response {
  console.error('mobile-integration-sync sync state save failed:', error);
  return json(
    { status: 'error', error: 'Failed to save sync progress. Please retry shortly.' },
    500,
    ctx.cors,
  );
}

/**
 * Mobile DTOs for the Liftosaur rows just written. An undated row reports the
 * date actually STORED (its first import time), not this run's sentinel, so
 * the phone and the server never disagree about it. null when that stored
 * date cannot be read.
 */
async function liftosaurDtos(
  ctx: ImportContext,
  rows: Array<Record<string, unknown>>,
  undated: Array<{ row: Record<string, unknown> }>,
): Promise<ActivityDto[] | null> {
  const storedStart = new Map<string, string>();
  const undatedIds = undated.map((r) => r.row.external_id as string);
  for (let i = 0; i < undatedIds.length; i += 100) {
    const { data, error } = await ctx.supabase
      .from('external_activities')
      .select('external_id, started_at')
      .eq('user_id', ctx.userId)
      .eq('provider', 'liftosaur')
      .in('external_id', undatedIds.slice(i, i + 100));
    if (error) {
      console.error('mobile-integration-sync stored-date lookup failed:', error);
      return null;
    }
    for (const stored of (data ?? []) as Array<{ external_id: string; started_at: string }>) {
      storedStart.set(stored.external_id, stored.started_at);
    }
  }
  return rows.map((row) => ({
    externalId: row.external_id as string,
    provider: 'liftosaur',
    name: row.name as string,
    activityType: 'strength',
    startedAt: storedStart.get(row.external_id as string) ?? (row.started_at as string),
    durationSeconds: (row.duration_seconds as number | null) ?? 0,
    rawData: JSON.stringify(row.raw_data),
  }));
}

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
  activities: ActivityDto[],
  now: () => Date,
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
          synced_at: now().toISOString(),
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
 * Shared failure path for the provider fetches.
 *
 * The thrown message is NOT returned and NOT stored. Our own throws are fixed
 * sentences, but the fetch+parse is wrapped as a whole: an unguarded
 * `await response.json()` on a 200 with a non-JSON body (an upstream HTML
 * error page, say) throws a `SyntaxError` whose message quotes a slice of that
 * body, and a transport failure throws a fetch/TLS internal.
 * `user_integrations.error_message` is browser-readable and rendered by the
 * integration card, so it gets fixed text and the detail goes to the log.
 */
async function providerFetchFailureResponse(
  supabase: DbClient,
  userId: string,
  provider: string,
  fetchErr: unknown,
  cors: Record<string, string>,
): Promise<Response> {
  const isApiKeyError = fetchErr instanceof ApiKeyError;
  console.error(`mobile-integration-sync ${provider} fetch failed:`, fetchErr);

  await supabase
    .from('user_integrations')
    .update({
      status: 'error',
      error_message: isApiKeyError
        ? 'API key rejected by the provider. Reconnect to resume syncing.'
        : 'Provider sync failed; will retry',
    })
    .eq('user_id', userId)
    .eq('provider', provider);

  return new Response(
    JSON.stringify({
      status: 'error',
      error: isApiKeyError ? 'Provider rejected the API key' : 'Provider request failed',
      code: isApiKeyError ? 'provider_auth_failed' : 'provider_fetch_failed',
    }),
    {
      status: isApiKeyError ? 403 : 502,
      headers: { ...cors, 'Content-Type': 'application/json' },
    }
  );
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
