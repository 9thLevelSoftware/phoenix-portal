import { createClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

/**
 * Hevy Sync Edge Function
 *
 * Unlike OAuth providers, Hevy uses API key authentication.
 * - Receives { user_id, api_key? } in request body
 * - If api_key provided, stores it in user_integrations.api_key
 * - Fetches workouts from Hevy API (requires Hevy PRO subscription)
 * - Falls back gracefully if API returns 401/403
 * - Normalizes and upserts to external_activities
 *
 * Note: Hevy API documentation is limited. The CSV import path in
 * the portal UI is the primary import mechanism for most users.
 */

const HEVY_API_BASE = 'https://api.hevyapp.com/v1';

interface HevyWorkout {
  id: string;
  title: string;
  start_time: string;
  end_time: string;
  exercises: Array<{
    title: string;
    sets: Array<{
      set_type: string;
      weight_kg: number;
      reps: number;
      rpe: number | null;
    }>;
  }>;
}

Deno.serve(async (req) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { user_id, api_key, sync_type } = await req.json();

    if (!user_id) {
      return new Response(
        JSON.stringify({ error: 'user_id is required' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // If api_key provided, store it in user_integrations
    if (api_key) {
      const { error: upsertError } = await supabase
        .from('user_integrations')
        .upsert(
          {
            user_id,
            provider: 'hevy',
            api_key,
            status: 'connected',
            connected_at: new Date().toISOString(),
          },
          { onConflict: 'user_id,provider' }
        );

      if (upsertError) {
        console.error('Failed to store Hevy API key:', upsertError);
        return new Response(
          JSON.stringify({ error: 'Failed to store API key' }),
          {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        );
      }
    }

    // Retrieve the stored API key for this user
    const { data: integration } = await supabase
      .from('user_integrations')
      .select('api_key')
      .eq('user_id', user_id)
      .eq('provider', 'hevy')
      .single();

    const storedApiKey = integration?.api_key;

    if (!storedApiKey) {
      return new Response(
        JSON.stringify({
          error: 'No Hevy API key found. Use CSV import or provide an API key.',
          requires_pro: true,
        }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // Attempt to fetch workouts from Hevy API
    let workouts: HevyWorkout[] = [];
    try {
      const response = await fetch(`${HEVY_API_BASE}/workouts`, {
        headers: {
          'api-key': storedApiKey,
          'Content-Type': 'application/json',
        },
      });

      if (response.status === 401 || response.status === 403) {
        // API key invalid or Hevy PRO required
        await supabase
          .from('user_integrations')
          .update({
            status: 'error',
            error_message: 'API key invalid or Hevy PRO subscription required',
          })
          .eq('user_id', user_id)
          .eq('provider', 'hevy');

        return new Response(
          JSON.stringify({
            error: 'Hevy API access denied. Verify your API key and Hevy PRO subscription.',
            requires_pro: true,
          }),
          {
            status: 403,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        );
      }

      if (!response.ok) {
        throw new Error(`Hevy API returned ${response.status}`);
      }

      const data = await response.json();
      workouts = data.workouts ?? data ?? [];
    } catch (fetchError) {
      console.error('Hevy API fetch error:', fetchError);

      await supabase
        .from('user_integrations')
        .update({
          status: 'error',
          error_message: `Sync failed: ${fetchError.message}`,
        })
        .eq('user_id', user_id)
        .eq('provider', 'hevy');

      return new Response(
        JSON.stringify({ error: `Hevy API error: ${fetchError.message}` }),
        {
          status: 502,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // Normalize and upsert workouts to external_activities
    let importedCount = 0;
    for (const workout of workouts) {
      const startTime = new Date(workout.start_time);
      const endTime = new Date(workout.end_time);
      const durationSeconds = Math.round((endTime.getTime() - startTime.getTime()) / 1000);

      const { error: activityError } = await supabase
        .from('external_activities')
        .upsert(
          {
            user_id,
            external_id: `hevy-${workout.id}`,
            provider: 'hevy',
            name: workout.title,
            activity_type: 'strength',
            started_at: startTime.toISOString(),
            duration_seconds: durationSeconds > 0 ? durationSeconds : null,
            calories: null, // Hevy API does not provide calorie data
            raw_data: workout,
          },
          { onConflict: 'user_id,provider,external_id' }
        );

      if (!activityError) {
        importedCount++;
      }
    }

    // Update last sync timestamp and status
    await supabase
      .from('user_integrations')
      .update({
        last_sync_at: new Date().toISOString(),
        status: 'connected',
        error_message: null,
      })
      .eq('user_id', user_id)
      .eq('provider', 'hevy');

    // Mark sync queue entry as completed
    if (sync_type) {
      await supabase
        .from('sync_queue')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
        })
        .eq('user_id', user_id)
        .eq('provider', 'hevy')
        .eq('status', 'pending');
    }

    return new Response(
      JSON.stringify({
        success: true,
        imported: importedCount,
        total: workouts.length,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (err) {
    console.error('Hevy sync error:', err);
    return new Response(
      JSON.stringify({ error: err.message }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
