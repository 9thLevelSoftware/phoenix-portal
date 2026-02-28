import Stripe from 'https://esm.sh/stripe@14?target=denonext';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { getCorsHeaders } from '../_shared/cors.ts';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
  apiVersion: '2024-11-20',
});

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
    // Step 1: Cancel Stripe subscription (if active)
    // Do NOT delete the Stripe customer — Stripe retains financial records per DPA
    // =========================================================================
    try {
      const { data: subscription } = await supabaseAdmin
        .from('subscriptions')
        .select('stripe_subscription_id')
        .eq('user_id', userId)
        .eq('status', 'active')
        .maybeSingle();

      if (subscription?.stripe_subscription_id) {
        await stripe.subscriptions.cancel(subscription.stripe_subscription_id);
        console.log(`Cancelled Stripe subscription ${subscription.stripe_subscription_id} for user ${userId}`);
      }
    } catch (stripeErr) {
      // Log but continue — don't block user's right to erasure because of Stripe API failure
      console.error('Stripe cancellation error (continuing with deletion):', stripeErr);
    }

    // =========================================================================
    // Step 2: Delete storage objects (avatars)
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
    // Step 3: Mark deletion request as executed
    // =========================================================================
    await supabaseAdmin
      .from('deletion_requests')
      .update({ status: 'executed', executed_at: new Date().toISOString() })
      .eq('id', request.id);

    // =========================================================================
    // Step 4: Delete auth user (cascades to all private data)
    // CASCADE-deletes: profiles, workout_sessions (and children), personal_records,
    //   exercise_progress, routines, training_cycles, user_goals, external_activities,
    //   user_integrations, subscriptions, community_votes, saved_community_items,
    //   challenge_participants, user_onboarding, oauth_tokens, oauth_states
    // SET NULL: community_comments.user_id, shared_routines.user_id, shared_cycles.user_id
    // =========================================================================
    const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(userId);
    if (deleteError) {
      console.error('Failed to delete auth user:', deleteError);
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
      JSON.stringify({ error: err.message ?? 'Internal server error' }),
      { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } }
    );
  }
});
