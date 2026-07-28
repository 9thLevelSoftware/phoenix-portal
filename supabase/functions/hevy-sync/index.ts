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
import { requireSubscription } from '../_shared/requireSubscription.ts';

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
 */


Deno.serve(async (req) => {
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
    const supabaseAuth = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user: jwtUser } } = await supabaseAuth.auth.getUser();

    if (jwtUser) {
      // Browser-initiated: use JWT-verified user ID, ignore body.user_id
      userId = jwtUser.id;
    } else {
      // Not a valid user JWT -- must be service-role call from process-sync-queue
      // Verify the caller is actually using the service role key
      const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
      const isServiceRole = authHeader === `Bearer ${serviceRoleKey}`;

      if (!isServiceRole || !body.user_id) {
        return new Response(
          JSON.stringify({ error: 'Not authenticated' }),
          { status: 401, headers: { ...cors, 'Content-Type': 'application/json' } },
        );
      }
      userId = body.user_id;
    }

    const { api_key, sync_type } = body;

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

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
    const syncStartedAt = new Date().toISOString();

    let workouts: HevyWorkout[] = [];
    let deletedIds: string[] = [];
    let truncated = false;
    try {
      const fetchPage = createHevyPageFetcher(storedApiKey);
      const result = useEvents
        ? await fetchHevyEvents(fetchPage, lastSyncAt!)
        : await fetchHevyBackfill(fetchPage);

      workouts = result.workouts;
      deletedIds = result.deletedIds;
      truncated = result.truncated;
    } catch (fetchError) {
      console.error('Hevy API fetch error:', fetchError);
      const fetchMessage = errorMessage(fetchError);

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
          JSON.stringify({ error: fetchMessage, requires_pro: true }),
          { status: 403, headers: { ...cors, 'Content-Type': 'application/json' } }
        );
      }

      await supabase
        .from('user_integrations')
        .update({
          status: 'error',
          error_message: `Sync failed: ${fetchMessage}`,
        })
        .eq('user_id', userId)
        .eq('provider', 'hevy');

      return new Response(
        JSON.stringify({ error: `Hevy API error: ${fetchMessage}` }),
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

    // A truncated fetch means pages remain unread. Advancing the watermark here
    // would move `since` past workouts we never saw, stranding them permanently.
    // Fail retryably instead. Resumable backfill needs a persisted page cursor
    // (planned with the integration_sync_cursors table).
    if (truncated) {
      const truncMessage =
        `Hevy fetch exceeded the ${HEVY_MAX_PAGES}-page budget; ` +
        `${importedCount} workouts stored, watermark not advanced`;
      console.warn(truncMessage);
      await supabase
        .from('user_integrations')
        .update({ status: 'error', error_message: truncMessage })
        .eq('user_id', userId)
        .eq('provider', 'hevy');

      return new Response(
        JSON.stringify({ error: truncMessage, imported: importedCount }),
        { status: 502, headers: { ...cors, 'Content-Type': 'application/json' } }
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

    // Mark sync queue entry as completed
    if (sync_type) {
      await supabase
        .from('sync_queue')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
        })
        .eq('user_id', userId)
        .eq('provider', 'hevy')
        .eq('status', 'pending');
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
    console.error('Hevy sync error:', err);
    return new Response(
      JSON.stringify({ error: errorMessage(err) }),
      {
        status: 500,
        headers: { ...cors, 'Content-Type': 'application/json' },
      }
    );
  }
});
