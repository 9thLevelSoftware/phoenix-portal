import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { getCorsHeaders } from '../_shared/cors.ts';
import { checkRateLimit } from '../_shared/rateLimit.ts';
import {
  defaultPurgeUserDependencies,
  purgeUser,
  type PurgeResult,
} from '../_shared/accountPurge.ts';

interface DeleteAccountAuthClient {
  auth: {
    getUser(): Promise<{ data: { user: { id: string } | null } }>;
  };
}

export interface DeleteAccountHandlerDependencies {
  /** Client acting as the caller (their JWT), used only to identify them. */
  createAuthClient(authorization: string): DeleteAccountAuthClient;
  /** Service-role client for admin operations (bypasses RLS). */
  createAdminClient(): SupabaseClient;
  /** The purge core; injected so tests can stub Paddle. */
  purge(admin: SupabaseClient, userId: string): Promise<PurgeResult>;
}

function defaultDeleteAccountDependencies(): DeleteAccountHandlerDependencies {
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
    purge(adminClient, userId) {
      return purgeUser(adminClient, userId, defaultPurgeUserDependencies());
    },
  };
}

async function deleteAccountHandler(
  req: Request,
  deps: DeleteAccountHandlerDependencies,
): Promise<Response> {
  const cors = getCorsHeaders(req);
  const json = (body: unknown, status: number) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });

  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors });
  }

  // POST only — this is a destructive, state-changing endpoint. Reject any
  // other method before authentication so an accidental GET/HEAD or proxy
  // retry cannot trigger the deletion flow. (F317)
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  try {
    // Authenticate the user via their JWT. The account deleted is always the
    // JWT user; nothing in the request body can name another user.
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return json({ error: 'Missing Authorization header' }, 401);
    }
    const {
      data: { user },
    } = await deps.createAuthClient(authHeader).auth.getUser();
    if (!user) {
      return json({ error: 'Not authenticated' }, 401);
    }

    const userId = user.id;
    const supabaseAdmin = deps.createAdminClient();

    // Verify the user has a pending deletion request with expired grace period
    const { data: request, error: requestError } = await supabaseAdmin
      .from('deletion_requests')
      .select('id, scheduled_for')
      .eq('user_id', userId)
      .eq('status', 'pending')
      .single();

    if (requestError || !request) {
      return json({ error: 'No pending deletion request found' }, 400);
    }

    if (new Date(request.scheduled_for) > new Date()) {
      return json({
        error: 'Grace period has not expired yet',
        scheduled_for: request.scheduled_for,
      }, 400);
    }

    // Rate limit: 1 request per hour per user. Charged only once the request
    // is valid, so a premature click does not lock the user out for an hour.
    const rateCheck = await checkRateLimit(supabaseAdmin, {
      key: 'delete-account',
      userId,
      maxRequests: 1,
      windowSeconds: 3600,
    }, cors);
    if (!rateCheck.allowed) return rateCheck.response!;

    // The deletion request stays `pending` until the purge deletes the user;
    // it then cascades away with the rest of the account. Every purge step is
    // idempotent, so a failed run is retried by simply calling again.
    const result = await deps.purge(supabaseAdmin, userId);
    if (!result.ok) {
      console.error('[DELETE_ACCOUNT] purge failed:', {
        user_id: userId,
        stage: result.stage,
        billing_cancelled: result.billingCancelled,
        detail: result.detail,
      });
      if (result.billingCancelled) {
        console.error('[DELETE_ACCOUNT_PARTIAL_FAILURE] Paddle subscription was canceled but the account was not deleted', {
          user_id: userId,
          stage: result.stage,
        });
        return json({
          error: 'Billing subscription was canceled, but account deletion could not be completed. Please try again or contact support.',
          code: 'billing_canceled_account_delete_failed',
        }, 500);
      }
      if (result.stage.startsWith('billing_')) {
        return json({
          error: 'Failed to cancel billing subscription. Account deletion aborted. Please try again or contact support.',
        }, 502);
      }
      return json({ error: 'Failed to delete account. Please try again.' }, 500);
    }

    console.log(`Account deleted successfully for user ${userId}`);
    return json({ success: true }, 200);
  } catch (err) {
    console.error('Unexpected error in delete-account:', err);
    return json({ error: 'Internal server error' }, 500);
  }
}

export function createDeleteAccountHandler(
  deps: DeleteAccountHandlerDependencies = defaultDeleteAccountDependencies(),
): (req: Request) => Promise<Response> {
  return (req) => deleteAccountHandler(req, deps);
}

if (import.meta.main) {
  Deno.serve(createDeleteAccountHandler());
}
