import { createClient } from 'jsr:@supabase/supabase-js@2';
import { getCorsHeaders } from '../_shared/cors.ts';
import { checkRateLimit } from '../_shared/rateLimit.ts';

// Service-role client for admin operations (bypasses RLS)
const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);

  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors });
  }

  try {
    // Authenticate the user via their JWT
    const authHeader = req.headers.get('Authorization')!;
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

    // Note: Subscription cancellation is handled by Paddle.
    // The subscription record is deleted with the user's data below.
    // Paddle will stop billing when the subscription period ends.

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

    console.log(`Account deleted successfully for user ${userId}`);
    return new Response(
      JSON.stringify({ success: true }),
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
