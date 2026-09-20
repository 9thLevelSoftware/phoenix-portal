import { createClient } from 'jsr:@supabase/supabase-js@2';
import { getCorsHeaders } from '../_shared/cors.ts';
import { errorMessage } from '../_shared/errorMessage.ts';
import {
  createHevyPageFetcher,
  fetchHevyBackfill,
  fetchHevyEvents,
  HEVY_MAX_PAGES,
  HevyAuthError,
  hevyExternalId,
  toExternalActivityRow,
  type HevyWorkout,
} from '../_shared/hevySync.ts';
import { decryptOAuthSecret, encryptOAuthSecret } from '../_shared/oauthTokenCrypto.ts';
import { checkManualSyncRateLimit } from '../_shared/manualSyncRateLimit.ts';
import { requireSubscription } from '../_shared/requireSubscription.ts';
import {
  completeSyncQueueEntry,
  type DbClient,
  heartbeatSyncQueueEntry,
} from '../_shared/syncQueue.ts';
import { isServiceRoleBearer } from '../_shared/timingSafe.ts';

/**
 * Hevy Sync Edge Function
 *
 * Unlike OAuth providers, Hevy uses API key authentication.
 * - Receives { user_id, api_key? } in request body
 * - If api_key provided, stores it in oauth_tokens.api_key (server-only)
 * - Fetches workouts from Hevy API (requires Hevy PRO subscription)
 * - Falls back gracefully if API returns 401/403
 * - Normalizes and upserts to external_activities
 *
 * Two fetch modes (see fetchHevyBackfill / fetchHevyEvents):
 * - Initial / no prior sync: full paginated backfill via GET /v1/workouts.
 * - Incremental: GET /v1/workouts/events?since=<last_sync_at>, which reports
 *   both updates and deletions so removed Hevy workouts stop lingering here.
 *
 * The CSV import path in the portal UI remains available for non-PRO users.
 *
 * When dispatched by process-sync-queue the body also carries `queue_id`: the
 * run completes that row only, and renews its lease (heartbeat) while it runs.
 * process-sync-queue reclaims a hevy task after HEARTBEAT_LEASE_MS (5 minutes)
 * without a heartbeat. The lease is renewed on entry, after every fetched page
 * and after every upsert chunk, so the longest silent window is one request
 * (capped by PROVIDER_REQUEST_TIMEOUT_MS) or one upsert chunk.
 */

/** Per-request ceiling for Hevy calls, so a hung request cannot outlast the lease. */
const PROVIDER_REQUEST_TIMEOUT_MS = 30_000;

export interface HevySyncDependencies {
  env: (key: string) => string | undefined;
  // deno-lint-ignore no-explicit-any
  createClient: (url: string, key: string, options?: any) => DbClient;
  /** Used for Hevy API calls. */
  fetch: typeof fetch;
  now: () => Date;
}

function defaultHevySyncDependencies(): HevySyncDependencies {
  return {
    env: (key) => Deno.env.get(key),
    createClient: (url, key, options) => createClient(url, key, options),
    fetch: (input, init) => fetch(input, init),
    now: () => new Date(),
  };
}

export function createHevySyncHandler(
  dependencies: HevySyncDependencies = defaultHevySyncDependencies(),
): (req: Request) => Promise<Response> {
  return (req) => hevySync(req, dependencies);
}

if (import.meta.main) {
  Deno.serve(createHevySyncHandler());
}

async function hevySync(req: Request, deps: HevySyncDependencies): Promise<Response> {
  const cors = getCorsHeaders(req);

  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors });
  }

  try {
    // Parse request body first (needed for both auth paths)
    const body = await req.json();

    // ---- Auth: Dual-path (browser JWT or service-role key) ----
    const authHeader = req.headers.get('Authorization');

    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Missing authorization' }),
        { status: 401, headers: { ...cors, 'Content-Type': 'application/json' } },
      );
    }

    let userId: string;

    // Try JWT auth first (browser-initiated calls)
    const supabaseAuth = deps.createClient(
      deps.env('SUPABASE_URL')!,
      deps.env('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user: jwtUser } } = await supabaseAuth.auth.getUser();

    if (jwtUser) {
      // Browser-initiated: use JWT-verified user ID, ignore body.user_id
      userId = jwtUser.id;
    } else {
      // Not a valid user JWT -- must be service-role call from process-sync-queue.
      // Verify the caller is actually using the service role key, in constant
      // time so the comparison leaks neither the key's bytes nor its length.
      const isServiceRole = isServiceRoleBearer(
        authHeader,
        deps.env('SUPABASE_SERVICE_ROLE_KEY'),
      );

      if (!isServiceRole || !body.user_id) {
        return new Response(
          JSON.stringify({ error: 'Not authenticated' }),
          { status: 401, headers: { ...cors, 'Content-Type': 'application/json' } },
        );
      }
      userId = body.user_id;
    }

    const { api_key, sync_type } = body;
    const queueId = typeof body.queue_id === 'string' ? body.queue_id : null;
    const calledByQueueProcessor = !jwtUser;
    // Only the queue path holds a lease on a sync_queue row.
    const leaseQueueId = calledByQueueProcessor ? queueId : null;

    const supabase = deps.createClient(
      deps.env('SUPABASE_URL')!,
      deps.env('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Cap browser-initiated invocations per user. Keyed on the JWT-verified
    // id, so nobody can spend another user's budget; the queue path (service
    // role) is exempt and has its own budget under the `hevy` key.
    //
    // A call carrying `api_key` is a credential WRITE — the only way to store
    // a Hevy key — and goes to its own roomier bucket, so a user retrying a
    // mistyped key cannot lock themselves out of saving the correct one.
    if (jwtUser) {
      const rateCheck = await checkManualSyncRateLimit(
        supabase,
        { provider: 'hevy', userId, credentialWrite: Boolean(api_key) },
        cors,
      );
      if (!rateCheck.allowed) return rateCheck.response!;
    }

    // Renew the lease immediately: the processor claimed this row before it
    // called us, so the work below must not run on that claim's clock.
    await heartbeatSyncQueueEntry(supabase, leaseQueueId, userId, deps.now());

    // Subscription gate — FLAME or higher required for integrations
    const gate = await requireSubscription(supabase, userId, 'FLAME', cors);
    if (!gate.allowed) return gate.response;

    // If api_key provided, store it in oauth_tokens (server-only table)
    if (api_key) {
      const { error: tokenUpsertError } = await supabase
        .from('oauth_tokens')
        .upsert(
          {
            user_id: userId,
            provider: 'hevy',
            api_key: await encryptOAuthSecret(api_key),
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'user_id,provider' }
        );

      if (tokenUpsertError) {
        console.error('Failed to store Hevy API key:', tokenUpsertError);
        return new Response(
          JSON.stringify({ error: 'Failed to store API key' }),
          {
            status: 500,
            headers: { ...cors, 'Content-Type': 'application/json' },
          }
        );
      }

      // Update user_integrations with non-sensitive status only
      await supabase
        .from('user_integrations')
        .upsert(
          {
            user_id: userId,
            provider: 'hevy',
            status: 'connected',
            connected_at: new Date().toISOString(),
          },
          { onConflict: 'user_id,provider' }
        );
    }

    // Retrieve the stored API key from oauth_tokens (server-only)
    const { data: tokenData } = await supabase
      .from('oauth_tokens')
      .select('api_key')
      .eq('user_id', userId)
      .eq('provider', 'hevy')
      .single();

    const storedApiKey = (await decryptOAuthSecret(tokenData?.api_key)) ?? '';

    if (!storedApiKey) {
      return new Response(
        JSON.stringify({
          error: 'No Hevy API key found. Use CSV import or provide an API key.',
          requires_pro: true,
        }),
        {
          status: 400,
          headers: { ...cors, 'Content-Type': 'application/json' },
        }
      );
    }

    // Read the prior watermark to decide between backfill and incremental fetch.
    const { data: integration } = await supabase
      .from('user_integrations')
      .select('last_sync_at')
      .eq('user_id', userId)
      .eq('provider', 'hevy')
      .maybeSingle();

    const lastSyncAt = (integration?.last_sync_at as string | null) ?? null;
    const useEvents = sync_type !== 'initial' && !!lastSyncAt;

    // Capture the watermark *before* fetching. Anything Hevy records while this
    // run is in flight then falls inside the next run's `since` window instead
    // of being skipped. Upserts are idempotent, so the small overlap is free.
    const syncStartedAt = deps.now().toISOString();

    let workouts: HevyWorkout[] = [];
    let deletedIds: string[] = [];
    let truncated = false;
    let latestEventAt: string | null = null;
    try {
      // Renew the queue lease after every page: a 100-page backfill can
      // outlast process-sync-queue's heartbeat lease before any upsert runs.
      const fetchWithHeartbeat: typeof fetch = async (input, init) => {
        const response = await deps.fetch(input, {
          ...init,
          signal: AbortSignal.timeout(PROVIDER_REQUEST_TIMEOUT_MS),
        });
        await heartbeatSyncQueueEntry(supabase, leaseQueueId, userId, deps.now());
        return response;
      };
      const fetchPage = createHevyPageFetcher(storedApiKey, fetchWithHeartbeat);
      const result = useEvents
        ? await fetchHevyEvents(fetchPage, lastSyncAt!)
        : await fetchHevyBackfill(fetchPage);

      workouts = result.workouts;
      deletedIds = result.deletedIds;
      truncated = result.truncated;
      latestEventAt = result.latestEventAt;
    } catch (fetchError) {
      console.error('Hevy API fetch error:', fetchError);
      if (fetchError instanceof HevyAuthError) {
        // API key invalid or Hevy PRO required
        await supabase
          .from('user_integrations')
          .update({
            status: 'error',
            error_message: 'API key invalid or Hevy PRO subscription required',
          })
          .eq('user_id', userId)
          .eq('provider', 'hevy');

        return new Response(
          JSON.stringify({
            error: 'API key invalid or Hevy PRO subscription required',
            code: 'provider_auth_failed',
            requires_pro: true,
          }),
          { status: 403, headers: { ...cors, 'Content-Type': 'application/json' } }
        );
      }

      // The thrown error is logged above and goes no further. The fetch+parse is
      // wrapped as a whole, so besides our own fixed "Hevy API returned N" it
      // can be a V8 JSON parse message quoting the provider's body, or a
      // transport/TLS internal. `user_integrations.error_message` is rendered
      // by ProviderCard and the response body is copied into
      // `sync_queue.error_message` by the processor, so both get fixed text.
      await supabase
        .from('user_integrations')
        .update({
          status: 'error',
          error_message: 'Hevy sync failed; will retry',
        })
        .eq('user_id', userId)
        .eq('provider', 'hevy');

      return new Response(
        JSON.stringify({ error: 'Hevy API error', code: 'provider_fetch_failed' }),
        {
          status: 502,
          headers: { ...cors, 'Content-Type': 'application/json' },
        }
      );
    }

    // Apply deletions reported by the events feed. These are hard deletes: the
    // workout no longer exists in Hevy, so leaving it here would strand a row
    // that no future sync can reconcile.
    // NOTE: mobile clients that already pulled the activity will not learn of
    // the removal until external_activities carries a `deleted_at` tombstone
    // (planned alongside the health data model migration).
    let deletedCount = 0;
    if (deletedIds.length > 0) {
      const externalIds = deletedIds.map(hevyExternalId);
      const { error: deleteError, count } = await supabase
        .from('external_activities')
        .delete({ count: 'exact' })
        .eq('user_id', userId)
        .eq('provider', 'hevy')
        .in('external_id', externalIds);

      if (deleteError) {
        console.error('Failed to apply Hevy deletions:', deleteError);
        await supabase
          .from('user_integrations')
          .update({
            status: 'error',
            error_message: `Failed to apply ${deletedIds.length} deletion(s)`,
          })
          .eq('user_id', userId)
          .eq('provider', 'hevy');

        return new Response(
          JSON.stringify({ error: 'Failed to apply Hevy deletions' }),
          { status: 502, headers: { ...cors, 'Content-Type': 'application/json' } }
        );
      }
      deletedCount = count ?? 0;
    }

    // Normalize and upsert workouts to external_activities
    let importedCount = 0;
    let failedCount = 0;

    // Upsert in chunks rather than one round trip per workout — a full backfill
    // can run to hundreds of workouts and per-row round trips exhaust the Edge
    // Function wall clock long before the data is in.
    const UPSERT_CHUNK_SIZE = 100;
    const rows = workouts.map((workout) => toExternalActivityRow(userId, workout));

    for (let i = 0; i < rows.length; i += UPSERT_CHUNK_SIZE) {
      const chunk = rows.slice(i, i + UPSERT_CHUNK_SIZE);
      const { error: activityError } = await supabase
        .from('external_activities')
        .upsert(chunk, { onConflict: 'user_id,provider,external_id' });

      if (activityError) {
        failedCount += chunk.length;
        console.error(
          `Failed to persist Hevy workouts ${i}-${i + chunk.length - 1}:`,
          activityError,
        );
      } else {
        importedCount += chunk.length;
      }
      await heartbeatSyncQueueEntry(supabase, leaseQueueId, userId, deps.now());
    }

    // If any activity failed to persist, do NOT advance last_sync_at: the next
    // incremental sync uses it as the cutoff and would skip the dropped rows.
    // Returning non-2xx lets the queue processor retry (upserts are idempotent).
    if (failedCount > 0) {
      const failMessage = `Failed to persist ${failedCount} of ${workouts.length} workouts`;
      await supabase
        .from('user_integrations')
        .update({ status: 'error', error_message: failMessage })
        .eq('user_id', userId)
        .eq('provider', 'hevy');

      return new Response(
        JSON.stringify({ error: failMessage, imported: importedCount, failed: failedCount }),
        { status: 502, headers: { ...cors, 'Content-Type': 'application/json' } }
      );
    }

    // A truncated fetch means pages remain unread, so the watermark cannot jump
    // to `syncStartedAt` — that would move `since` past events we never saw.
    //
    // Whether a retry can make progress depends on which endpoint we were on:
    //
    //  - Events feed: the stream is date-ordered, so advancing `since` to the
    //    newest event actually processed lets the next attempt continue from
    //    there. Retry is productive; ask for one.
    //
    //  - Backfill: /v1/workouts is paged only, with no date filter and no
    //    resume point derivable from what is already stored. A retry would
    //    reissue the identical request, truncate identically, and repeat until
    //    the queue's retry cap — so fail terminally and say why instead of
    //    burning ten attempts. Resuming properly needs a persisted page cursor
    //    (planned with the integration_sync_cursors table).
    if (truncated) {
      const canResume = useEvents && !!latestEventAt;

      if (canResume) {
        await supabase
          .from('user_integrations')
          .update({
            last_sync_at: latestEventAt,
            status: 'connected',
            error_message:
              `Hevy fetch hit the ${HEVY_MAX_PAGES}-page budget; ` +
              `${importedCount} workouts stored, resuming from ${latestEventAt}`,
          })
          .eq('user_id', userId)
          .eq('provider', 'hevy');
      } else {
        await supabase
          .from('user_integrations')
          .update({
            status: 'error',
            error_message:
              `Hevy backfill exceeded the ${HEVY_MAX_PAGES}-page budget ` +
              `(${importedCount} workouts stored). Retrying would repeat the ` +
              'same request; resumable backfill is required for accounts this large.',
          })
          .eq('user_id', userId)
          .eq('provider', 'hevy');
      }

      const truncMessage = canResume
        ? `Hevy fetch exceeded the ${HEVY_MAX_PAGES}-page budget; resuming from ${latestEventAt}`
        : `Hevy backfill exceeded the ${HEVY_MAX_PAGES}-page budget and cannot resume`;
      console.warn(truncMessage);

      return new Response(
        JSON.stringify({ error: truncMessage, imported: importedCount, deleted: deletedCount }),
        {
          // 502 is retryable per process-sync-queue; 500 is not. Only request a
          // retry when the next attempt will behave differently.
          status: canResume ? 502 : 500,
          headers: { ...cors, 'Content-Type': 'application/json' },
        }
      );
    }

    // Update last sync timestamp and status (all activities persisted). Uses the
    // pre-fetch timestamp so concurrent Hevy writes land in the next window.
    await supabase
      .from('user_integrations')
      .update({
        last_sync_at: syncStartedAt,
        status: 'connected',
        error_message: null,
      })
      .eq('user_id', userId)
      .eq('provider', 'hevy');

    // Complete only the queue row this run was dispatched for (or, for a
    // browser run, at most the newest pending row of the same sync_type).
    // Never sweep every pending row: a second queued task must still run.
    if (queueId || sync_type) {
      await completeSyncQueueEntry(supabase, {
        userId,
        provider: 'hevy',
        syncType: sync_type ?? 'incremental',
        queueId,
        calledByQueueProcessor,
      });
    }

    return new Response(
      JSON.stringify({
        success: true,
        mode: useEvents ? 'incremental' : 'backfill',
        imported: importedCount,
        deleted: deletedCount,
        total: workouts.length,
      }),
      {
        headers: { ...cors, 'Content-Type': 'application/json' },
      }
    );
  } catch (err) {
    // `errorMessage` is a deliberate passthrough of `.message`, which for a
    // driver error carries constraint/column/relation names and for a parse
    // failure carries a slice of the provider's body. Log it, return a code.
    console.error('Hevy sync error:', err);
    return new Response(
      JSON.stringify({ error: 'Hevy sync failed', code: 'internal_error' }),
      {
        status: 500,
        headers: { ...cors, 'Content-Type': 'application/json' },
      }
    );
  }
}
