import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { getCorsHeaders } from '../_shared/cors.ts';
import { checkRateLimit } from '../_shared/rateLimit.ts';
import {
  defaultPurgeUserDependencies,
  purgeUser,
  type PurgeResult,
} from '../_shared/accountPurge.ts';

/** One delete-account attempt per user per window (charged after validation). */
const DELETE_RATE_LIMIT_WINDOW_SECONDS = 3600;

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
  const json = (body: unknown, status: number, extra: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...cors, ...extra, 'Content-Type': 'application/json' },
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
      windowSeconds: DELETE_RATE_LIMIT_WINDOW_SECONDS,
    }, cors);
    if (!rateCheck.allowed) return rateCheck.response!;

    // Claim the request (pending -> executed) before any side effect. The
    // user's own "cancel deletion" is RLS-gated on status = 'pending', so a
    // cancel from another tab or device cannot slip in while the purge runs
    // (review R-6; PR 35 replaces this with its atomic 'executing' claim). On
    // success the row cascades away with the account; on failure it is put
    // back to 'pending' so the user can retry or cancel.
    const { data: claimed, error: claimError } = await supabaseAdmin
      .from('deletion_requests')
      .update({ status: 'executed', executed_at: new Date().toISOString() })
      .eq('id', request.id)
      .eq('status', 'pending')
      .select('id');
    if (claimError) {
      console.error('[DELETE_ACCOUNT] could not claim deletion request:', claimError);
      return json({ error: 'Failed to process deletion. Please try again later.' }, 500);
    }
    if (!claimed || claimed.length === 0) {
      return json({ error: 'Deletion request is no longer pending' }, 409);
    }

    const result = await deps.purge(supabaseAdmin, userId);
    if (!result.ok) {
      // deleteUser did not succeed, so the user and the request still exist.
      const { error: revertError } = await supabaseAdmin
        .from('deletion_requests')
        .update({ status: 'pending', executed_at: null })
        .eq('id', request.id)
        .eq('status', 'executed');
      if (revertError) {
        console.error('[DELETION_ALERT] claim_revert_failed', {
          user_id: userId,
          request_id: request.id,
          error: revertError,
        });
      }
      console.error('[DELETE_ACCOUNT] purge failed:', {
        user_id: userId,
        stage: result.stage,
        billing_cancelled: result.billingCancelled,
        detail: result.detail,
      });
      // The rate limit charged above stays in force (a failed purge never
      // deletes it), so tell the user when a retry will actually be accepted.
      const retry = { 'Retry-After': String(DELETE_RATE_LIMIT_WINDOW_SECONDS) };
      const retryText = 'You can try again in about an hour.';
      if (result.billingCancelled) {
        console.error('[DELETE_ACCOUNT_PARTIAL_FAILURE] Paddle subscription was canceled but the account was not deleted', {
          user_id: userId,
          stage: result.stage,
        });
        return json({
          error: `Billing subscription was canceled, but account deletion could not be completed. ${retryText} If it keeps failing, contact support.`,
          code: 'billing_canceled_account_delete_failed',
        }, 500, retry);
      }
      if (result.stage === 'billing_not_found') {
        return json({
          error: 'Your billing subscription could not be verified with our payment provider, so account deletion was stopped to make sure you are not billed again. Please contact support to complete the deletion.',
          code: 'billing_subscription_not_found',
        }, 502);
      }
      if (result.stage.startsWith('billing_')) {
        return json({
          error: `Failed to cancel billing subscription. Account deletion aborted. ${retryText} If it keeps failing, contact support.`,
          code: 'billing_cancel_failed',
        }, 502, retry);
      }
      return json({ error: `Failed to delete account. ${retryText}` }, 500, retry);
    }

    if (result.residualTables.length > 0) {
      console.error('[DELETION_ALERT] account deleted with residual rows', {
        user_id: userId,
        residual_tables: result.residualTables,
      });
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
