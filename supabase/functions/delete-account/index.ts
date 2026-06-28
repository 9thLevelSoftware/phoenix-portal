import { createClient } from 'jsr:@supabase/supabase-js@2';
import { getCorsHeaders } from '../_shared/cors.ts';
import { checkRateLimit } from '../_shared/rateLimit.ts';

// Service-role client for admin operations (bypasses RLS)
const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

function isCancellablePaddleStatus(status: string | null | undefined) {
  return ['active', 'trialing', 'past_due'].includes(status ?? '');
}

function getPaddleBaseUrl() {
  const paddleEnv = Deno.env.get('PADDLE_ENVIRONMENT') ?? 'production';
  return paddleEnv === 'sandbox'
    ? 'https://sandbox-api.paddle.com'
    : 'https://api.paddle.com';
}

async function cancelPaddleSubscription(subscriptionId: string, apiKey: string) {
  const paddleRes = await fetch(
    `${getPaddleBaseUrl()}/subscriptions/${subscriptionId}/cancel`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ effective_from: 'immediately' }),
    },
  );

  if (paddleRes.ok) {
    return { ok: true as const };
  }

  return {
    ok: false as const,
    status: paddleRes.status,
    detail: await paddleRes.text(),
  };
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);

  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors });
  }

  // POST only — this is a destructive, state-changing endpoint. Reject any
  // other method before authentication so an accidental GET/HEAD or proxy
  // retry cannot trigger the deletion flow. (F317)
  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({ error: 'Method not allowed' }),
      { status: 405, headers: { ...cors, 'Content-Type': 'application/json' } }
    );
  }

  try {
    // Authenticate the user via their JWT
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Missing Authorization header' }),
        { status: 401, headers: { ...cors, 'Content-Type': 'application/json' } }
      );
    }
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return new Response(
        JSON.stringify({ error: 'Not authenticated' }),
        { status: 401, headers: { ...cors, 'Content-Type': 'application/json' } }
      );
    }

    const userId = user.id;

    // Rate limit: 1 request per hour per user
    const rateCheck = await checkRateLimit(supabaseAdmin, {
      key: 'delete-account',
      userId,
      maxRequests: 1,
      windowSeconds: 3600,
    }, cors);
    if (!rateCheck.allowed) return rateCheck.response!;

    // Verify the user has a pending deletion request with expired grace period
    const { data: request, error: requestError } = await supabaseAdmin
      .from('deletion_requests')
      .select('id, scheduled_for')
      .eq('user_id', userId)
      .eq('status', 'pending')
      .single();

    if (requestError || !request) {
      return new Response(
        JSON.stringify({ error: 'No pending deletion request found' }),
        { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } }
      );
    }

    const scheduledFor = new Date(request.scheduled_for);
    if (scheduledFor > new Date()) {
      return new Response(
        JSON.stringify({
          error: 'Grace period has not expired yet',
          scheduled_for: request.scheduled_for,
        }),
        { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } }
      );
    }

    // =========================================================================
    // Step 1: Delete storage objects (avatars)
    // =========================================================================
    try {
      const { data: avatarFiles } = await supabaseAdmin.storage
        .from('avatars')
        .list(userId);

      if (avatarFiles && avatarFiles.length > 0) {
        const filePaths = avatarFiles.map((f) => `${userId}/${f.name}`);
        await supabaseAdmin.storage.from('avatars').remove(filePaths);
        console.log(`Removed ${filePaths.length} avatar file(s) for user ${userId}`);
      }
    } catch (storageErr) {
      // Log but continue — avatar cleanup is not critical
      console.error('Storage cleanup error (continuing with deletion):', storageErr);
    }

    // =========================================================================
    // Step 1b: Capture subscription state before auth user delete
    // =========================================================================
    const { data: subscriptionRow } = await supabaseAdmin
      .from('subscriptions')
      .select('paddle_subscription_id, status')
      .eq('user_id', userId)
      .maybeSingle();

    const shouldCancelPaddle =
      !!subscriptionRow?.paddle_subscription_id &&
      isCancellablePaddleStatus(subscriptionRow.status);
    const paddleApiKey = Deno.env.get('PADDLE_API_KEY');

    if (shouldCancelPaddle && !paddleApiKey) {
      console.error('[DELETE_ACCOUNT] PADDLE_API_KEY is not set');
      return new Response(
        JSON.stringify({ error: 'Billing service not configured. Account deletion aborted.' }),
        { status: 502, headers: { ...cors, 'Content-Type': 'application/json' } }
      );
    }

    // =========================================================================
    // Step 2: Mark deletion request as executed
    // =========================================================================
    const { error: updateError } = await supabaseAdmin
      .from('deletion_requests')
      .update({ status: 'executed', executed_at: new Date().toISOString() })
      .eq('id', request.id);

    if (updateError) {
      console.error('[DELETE_ACCOUNT] Failed to mark deletion request as executed:', updateError);
      return new Response(
        JSON.stringify({ error: 'Failed to process deletion. Please try again.' }),
        { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } }
      );
    }

    // =========================================================================
    // Step 3: Delete auth user (cascades to all private data)
    // CASCADE-deletes: profiles, workout_sessions (and children), personal_records,
    //   exercise_progress, routines, training_cycles, user_goals, external_activities,
    //   user_integrations, subscriptions, community_votes, saved_community_items,
    //   challenge_participants, user_onboarding, oauth_tokens, oauth_states
    // SET NULL: community_comments.user_id, shared_routines.user_id, shared_cycles.user_id
    // =========================================================================
    const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(userId);
    if (deleteError) {
      // Roll back the deletion request status to prevent partial-delete state
      await supabaseAdmin
        .from('deletion_requests')
        .update({ status: 'pending', executed_at: null })
        .eq('id', request.id);

      console.error('[DELETE_ACCOUNT] Failed to delete auth user, rolled back request status:', deleteError);
      return new Response(
        JSON.stringify({ error: 'Failed to delete account. Please try again.' }),
        { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } }
      );
    }

    let billingCancellationPending = false;
    if (shouldCancelPaddle && subscriptionRow?.paddle_subscription_id && paddleApiKey) {
      const paddleResult = await cancelPaddleSubscription(
        subscriptionRow.paddle_subscription_id,
        paddleApiKey,
      );

      if (!paddleResult.ok) {
        billingCancellationPending = true;
        console.error(
          '[DELETE_ACCOUNT] Paddle cancel failed after auth delete. Manual follow-up required:',
          subscriptionRow.paddle_subscription_id,
          paddleResult.status,
          paddleResult.detail,
        );
      }
    }

    console.log(`Account deleted successfully for user ${userId}`);
    return new Response(
      JSON.stringify({ success: true, billingCancellationPending }),
      { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    console.error('Unexpected error in delete-account:', err);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } }
    );
  }
});
