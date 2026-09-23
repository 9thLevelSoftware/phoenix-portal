import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { getCorsHeaders } from '../_shared/cors.ts';
import { checkRateLimit } from '../_shared/rateLimit.ts';
import {
  defaultProviderRevokeDependencies,
  type ProviderRevokeDependencies,
  revokeAndDisconnect,
} from '../_shared/providerRevoke.ts';

const ALLOWED_PROVIDERS = new Set([
  'strava',
  'fitbit',
  'garmin',
  'hevy',
  'liftosaur',
  'apple_health',
  'google_health',
]);

interface DisconnectAuthClient {
  auth: {
    getUser(): Promise<{ data: { user: { id: string } | null } }>;
  };
}

export interface DisconnectIntegrationDependencies {
  /** Client acting as the caller (their JWT), used only to identify them. */
  createAuthClient(authorization: string): DisconnectAuthClient;
  /** Service-role client for DB operations (bypasses RLS). */
  createAdminClient(): SupabaseClient;
  /** Provider revoke HTTP + credentials; injected so tests never hit a provider. */
  revoke: ProviderRevokeDependencies;
}

function defaultDisconnectIntegrationDependencies(): DisconnectIntegrationDependencies {
  let admin: SupabaseClient | null = null;
  return {
    createAuthClient(authorization: string) {
      return createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_ANON_KEY')!,
        { global: { headers: { Authorization: authorization } } },
      );
    },
    createAdminClient() {
      admin ??= createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      );
      return admin;
    },
    revoke: defaultProviderRevokeDependencies(),
  };
}

async function disconnectIntegrationHandler(
  req: Request,
  deps: DisconnectIntegrationDependencies,
): Promise<Response> {
  const cors = getCorsHeaders(req);
  const json = (body: unknown, status: number) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return json({ error: 'Missing authorization' }, 401);
    }

    const {
      data: { user },
    } = await deps.createAuthClient(authHeader).auth.getUser();

    if (!user) {
      return json({ error: 'Not authenticated' }, 401);
    }

    const supabaseAdmin = deps.createAdminClient();

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
      return json({ error: 'Invalid JSON body' }, 400);
    }
    const provider = typeof body.provider === 'string' ? body.provider : '';
    if (!provider || !ALLOWED_PROVIDERS.has(provider)) {
      return json({ error: 'Unsupported integration provider' }, 400);
    }

    // Revoke the provider grant (best effort), then delete the token, reset
    // the integration and cancel queued syncs in one transaction via
    // disconnect_integration (F303, FP-5). The same path serves the mobile
    // disconnect action and the account purge.
    const result = await revokeAndDisconnect(supabaseAdmin, user.id, provider, deps.revoke);
    if (!result.ok) {
      return json({ error: 'Failed to disconnect integration. Please try again.' }, 500);
    }

    return json({ success: true }, 200);
  } catch (err) {
    console.error('disconnect-integration error:', err);
    return json({ error: 'Internal server error' }, 500);
  }
}

export function createDisconnectIntegrationHandler(
  deps: DisconnectIntegrationDependencies = defaultDisconnectIntegrationDependencies(),
): (req: Request) => Promise<Response> {
  return (req) => disconnectIntegrationHandler(req, deps);
}

if (import.meta.main) {
  Deno.serve(createDisconnectIntegrationHandler());
}
