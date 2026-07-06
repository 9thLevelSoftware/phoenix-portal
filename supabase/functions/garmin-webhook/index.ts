import { createClient } from 'jsr:@supabase/supabase-js@2';
import { getCorsHeaders } from '../_shared/cors.ts';
import { requireSubscription } from '../_shared/requireSubscription.ts';
import {
  resolveGarminWebhookIdentity,
  type GarminIdentityCandidate,
} from '../_shared/garminIdentity.ts';
import { decryptOAuthSecret } from '../_shared/oauthTokenCrypto.ts';
import { hmacSha256Hex } from '../_shared/hmac.ts';

/**
 * Garmin Connect webhook handler for activity push notifications.
 *
 * Garmin sends POST requests to this endpoint when a user completes an activity.
 * The webhook payload contains activity summaries that we normalize and store.
 *
 * Garmin push notifications include:
 * - activities: Array of activity summaries
 * - activityDetails: Detailed activity data (if configured)
 *
 * NOTE: Garmin developer program approval may be pending.
 * This function is ready but untested until webhook registration is complete.
 */

/**
 * Garmin webhook activity payload types.
 * Based on Garmin Connect Activity API documentation.
 */
interface GarminWebhookPayload {
  activities?: GarminActivitySummary[];
  activityDetails?: GarminActivitySummary[];
}

interface GarminActivitySummary {
  userId: string; // Garmin user ID
  userAccessToken: string; // OAuth access token for this user
  activityId: number;
  activityName: string;
  activityType: string;
  startTimeInSeconds: number; // Unix epoch seconds
  startTimeOffsetInSeconds: number;
  durationInSeconds: number;
  distanceInMeters?: number;
  activeKilocalories?: number;
  averageHeartRateInBeatsPerMinute?: number;
  maxHeartRateInBeatsPerMinute?: number;
  elevationGainInMeters?: number;
  summary?: Record<string, unknown>;
}

/**
 * Map Garmin activity type string to a generic activity type.
 * Garmin uses descriptive string types.
 */
function mapGarminActivityType(garminType: string): string {
  const mapping: Record<string, string> = {
    RUNNING: 'running',
    TRAIL_RUNNING: 'running',
    TREADMILL_RUNNING: 'running',
    CYCLING: 'cycling',
    MOUNTAIN_BIKING: 'cycling',
    INDOOR_CYCLING: 'cycling',
    SWIMMING: 'swimming',
    OPEN_WATER_SWIMMING: 'swimming',
    WALKING: 'walking',
    HIKING: 'hiking',
    STRENGTH_TRAINING: 'strength',
    YOGA: 'flexibility',
    PILATES: 'flexibility',
    ROWING: 'rowing',
    INDOOR_ROWING: 'rowing',
    ELLIPTICAL: 'cardio',
    STAIR_CLIMBING: 'cardio',
    FITNESS_EQUIPMENT: 'cardio',
  };
  return mapping[garminType] ?? 'other';
}

/**
 * Normalize a Garmin activity summary to Phoenix external_activities format.
 * Garmin already uses metric units, so minimal conversion needed.
 */
function normalizeGarminWebhookActivity(
  activity: GarminActivitySummary,
): Record<string, unknown> {
  // startTimeInSeconds is an absolute Unix epoch timestamp. startTimeOffsetInSeconds
  // describes the local timezone offset and must NOT be added to the epoch — doing so
  // stores local wall-clock time as UTC and shifts activities by hours for non-UTC users.
  const startedAt = new Date(activity.startTimeInSeconds * 1000).toISOString();

  return {
    external_id: String(activity.activityId),
    provider: 'garmin',
    name: activity.activityName ?? 'Garmin Activity',
    activity_type: mapGarminActivityType(activity.activityType),
    started_at: startedAt,
    duration_seconds: activity.durationInSeconds,
    distance_meters: activity.distanceInMeters ?? null,
    calories: activity.activeKilocalories ?? null,
    avg_heart_rate: activity.averageHeartRateInBeatsPerMinute ?? null,
    max_heart_rate: activity.maxHeartRateInBeatsPerMinute ?? null,
    elevation_gain_meters: activity.elevationGainInMeters ?? null,
  };
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);

  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors });
  }

  // Garmin sends GET for webhook verification (ping)
  if (req.method === 'GET') {
    return new Response('OK', {
      status: 200,
      headers: { ...cors, 'Content-Type': 'text/plain' },
    });
  }

  // Only accept POST for activity push notifications
  if (req.method !== 'POST') {
    return new Response('Method not allowed', {
      status: 405,
      headers: cors,
    });
  }

  try {
    // Validate HMAC-SHA256 signature — mandatory, reject if not configured
    const WEBHOOK_SECRET = Deno.env.get('GARMIN_WEBHOOK_SECRET');
    if (!WEBHOOK_SECRET) {
      console.error('[GARMIN_WEBHOOK] GARMIN_WEBHOOK_SECRET not configured');
      return new Response(
        JSON.stringify({ error: 'Webhook not configured' }),
        { status: 503, headers: { ...cors, 'Content-Type': 'application/json' } },
      );
    }

    // Read raw body text first so we can verify the signature over the exact bytes
    // Garmin sends before we attempt JSON parsing.
    const rawBody = await req.text();

    // Garmin signs the request body with HMAC-SHA256 using the consumer secret and
    // sends the hex digest in the x-garmin-signature header.
    const providedSignature = req.headers.get('x-garmin-signature');
    if (!providedSignature) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...cors, 'Content-Type': 'application/json' } },
      );
    }

    // Compute expected HMAC-SHA256 of the raw request body keyed with the consumer secret.
    const expectedSignature = await hmacSha256Hex(WEBHOOK_SECRET, rawBody);

    // Timing-safe comparison: encode both hex strings and XOR byte-by-byte so the
    // comparison time does not leak information about the correct signature.
    const encoder = new TextEncoder();
    const a = encoder.encode(providedSignature);
    const b = encoder.encode(expectedSignature);
    // Length check is safe to do outside the loop because HMAC-SHA256 hex output is
    // always 64 chars — a length mismatch only reveals that the header was malformed.
    if (a.length !== b.length) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...cors, 'Content-Type': 'application/json' } },
      );
    }
    let mismatch = 0;
    for (let i = 0; i < a.length; i++) {
      mismatch |= a[i] ^ b[i];
    }
    if (mismatch !== 0) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...cors, 'Content-Type': 'application/json' } },
      );
    }

    const payload: GarminWebhookPayload = JSON.parse(rawBody);
    // Garmin may deliver both `activities` (summaries) and `activityDetails` in the
    // same payload. Merge and de-duplicate by activityId so detailed records are not
    // dropped whenever summaries are also present. Details win on conflict.
    const mergedById = new Map<number, GarminActivitySummary>();
    for (const summary of payload.activities ?? []) {
      mergedById.set(summary.activityId, summary);
    }
    for (const detail of payload.activityDetails ?? []) {
      mergedById.set(detail.activityId, detail);
    }
    const activities = [...mergedById.values()];

    if (activities.length === 0) {
      // Acknowledge receipt even if no activities (could be a ping or other event)
      return new Response(
        JSON.stringify({ received: true, processed: 0 }),
        { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } },
      );
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const { data: connectedIntegrations, error: integrationsError } = await supabase
      .from('user_integrations')
      .select('user_id, provider_user_id')
      .eq('provider', 'garmin')
      .eq('status', 'connected');

    if (integrationsError) {
      console.error('[GARMIN_WEBHOOK] failed to fetch connected integrations:', integrationsError);
      return new Response(
        JSON.stringify({ received: true, processed: 0, errors: activities.length }),
        { status: 503, headers: { ...cors, 'Content-Type': 'application/json' } },
      );
    }

    const { data: tokenRows, error: tokensError } = await supabase
      .from('oauth_tokens')
      .select('user_id, access_token')
      .eq('provider', 'garmin');

    if (tokensError) {
      console.error('[GARMIN_WEBHOOK] failed to fetch Garmin tokens:', tokensError);
      return new Response(
        JSON.stringify({ received: true, processed: 0, errors: activities.length }),
        { status: 503, headers: { ...cors, 'Content-Type': 'application/json' } },
      );
    }

    const tokenByUserId = new Map(
      (tokenRows ?? []).map((token) => [token.user_id, token.access_token]),
    );
    const identityCandidates: GarminIdentityCandidate[] = (connectedIntegrations ?? [])
      .map((integration) => ({
        user_id: integration.user_id,
        provider_user_id: integration.provider_user_id ?? null,
        access_token: tokenByUserId.get(integration.user_id),
      }));

    let processed = 0;
    let errors = 0;
    let persistenceFailure = false; // fix(audit): C5 — track unrecoverable DB errors

    for (const activity of activities) {
      try {
        const identity = await resolveGarminWebhookIdentity(
          activity,
          identityCandidates,
          decryptOAuthSecret,
        );

        if (!identity.ok) {
          console.warn(
            `[GARMIN_WEBHOOK] rejected Garmin identity for userId ${activity.userId}: ${identity.reason}`,
          );
          errors++;
          continue;
        }

        if (identity.bindProviderUserId) {
          const { error: bindError } = await supabase
            .from('user_integrations')
            .update({ provider_user_id: activity.userId })
            .eq('user_id', identity.userId)
            .eq('provider', 'garmin');

          if (bindError) {
            console.error('[GARMIN_WEBHOOK] failed to bind Garmin provider_user_id:', bindError);
            persistenceFailure = true;
            errors++;
            continue;
          }
        }

        // Subscription gate — FLAME or higher for integrations
        const gate = await requireSubscription(supabase, identity.userId, 'FLAME', cors);
        if (!gate.allowed) {
          console.warn(`[GARMIN_WEBHOOK] user ${identity.userId} does not have FLAME subscription`);
          errors++;
          continue;
        }

        const normalized = normalizeGarminWebhookActivity(activity);

        const { error: upsertError } = await supabase
          .from('external_activities')
          .upsert(
            {
              user_id: identity.userId,
              ...normalized,
              raw_data: activity,
              synced_at: new Date().toISOString(),
            },
            { onConflict: 'user_id,provider,external_id' },
          );

        if (upsertError) {
          // fix(audit): C5 — upsert failure is transient; signal retry to Garmin
          console.error('[GARMIN_WEBHOOK] failed to upsert activity:', upsertError);
          persistenceFailure = true;
          errors++;
          continue;
        }

        // Update last_sync_at for this user's Garmin integration. The activity is
        // already persisted, so a failed timestamp update is non-fatal — log it but
        // do not signal a retry (that would re-upsert already-stored activities).
        const { error: lastSyncError } = await supabase
          .from('user_integrations')
          .update({ last_sync_at: new Date().toISOString() })
          .eq('user_id', identity.userId)
          .eq('provider', 'garmin');

        if (lastSyncError) {
          console.error('[GARMIN_WEBHOOK] failed to update last_sync_at:', lastSyncError);
        }

        processed++;
      } catch (activityError) {
        // fix(audit): C5 — unexpected error per activity; treat as transient
        console.error('[GARMIN_WEBHOOK] error processing activity:', activityError);
        persistenceFailure = true;
        errors++;
      }
    }

    // fix(audit): C5 — return 5xx when any persistence failure occurred so Garmin
    // retries per their webhook contract. Only return 200 on fully successful
    // (or deterministically non-retryable) processing.
    if (persistenceFailure) {
      return new Response(
        JSON.stringify({
          received: true,
          processed,
          errors,
          error: 'Transient failure — please retry',
        }),
        { status: 503, headers: { ...cors, 'Content-Type': 'application/json' } },
      );
    }

    return new Response(
      JSON.stringify({ received: true, processed, errors }),
      { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    // fix(audit): C5 — stop swallowing errors. Propagate 5xx so Garmin retries.
    console.error('[GARMIN_WEBHOOK] unhandled error:', err);
    return new Response(
      JSON.stringify({
        received: false,
        error: err instanceof Error ? err.message : 'Processing error',
      }),
      { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } },
    );
  }
});
