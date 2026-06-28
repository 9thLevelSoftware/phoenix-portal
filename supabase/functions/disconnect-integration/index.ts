import { createClient } from 'jsr:@supabase/supabase-js@2';
import { getCorsHeaders } from '../_shared/cors.ts';
import { checkRateLimit } from '../_shared/rateLimit.ts';

// Service-role client for DB operations (bypasses RLS)
const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

const ALLOWED_PROVIDERS = new Set([
  'strava',
  'fitbit',
  'garmin',
  'hevy',
  'liftosaur',
  'apple_health',
  'google_health',
]);

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Missing authorization' }),
        { status: 401, headers: { ...cors, 'Content-Type': 'application/json' } },
      );
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return new Response(
        JSON.stringify({ error: 'Not authenticated' }),
        { status: 401, headers: { ...cors, 'Content-Type': 'application/json' } },
      );
    }

    // Rate limit: 5 requests per minute per user
    const rateCheck = await checkRateLimit(supabaseAdmin, {
      key: 'disconnect-integration',
      userId: user.id,
      maxRequests: 5,
      windowSeconds: 60,
    }, cors);
    if (!rateCheck.allowed) return rateCheck.response!;

    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return new Response(
        JSON.stringify({ error: 'Invalid JSON body' }),
        { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } },
      );
    }
    const provider = typeof body.provider === 'string' ? body.provider : '';
    if (!provider || !ALLOWED_PROVIDERS.has(provider)) {
      return new Response(
        JSON.stringify({ error: 'Unsupported integration provider' }),
        { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } },
      );
    }

    const timestamp = new Date().toISOString();

    // Token deletion, integration-state reset, and sync-queue cancellation run
    // in one transaction via disconnect_integration (F303): doing them as three
    // concurrent statements outside a transaction could leave a partial state
    // (e.g. tokens deleted but the integration still flagged connected) if one
    // failed.
    const { error: disconnectError } = await supabaseAdmin.rpc('disconnect_integration', {
      p_user_id: user.id,
      p_provider: provider,
      p_timestamp: timestamp,
    });

    if (disconnectError) throw disconnectError;

    return new Response(
      JSON.stringify({ success: true }),
      { headers: { ...cors, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    console.error('disconnect-integration error:', err);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } },
    );
  }
});
