import { queryOptions } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from './keys';

/**
 * Query options for session replay data.
 * Fetches session structure with exercises and sets for navigation.
 */
export const replaySessionOptions = (sessionId: string) =>
  queryOptions({
    queryKey: queryKeys.replay.session(sessionId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('workout_sessions')
        .select(`
          id,
          started_at,
          exercises:session_exercises (
            id,
            exercise_name,
            sets:exercise_sets (
              id,
              set_number
            )
          )
        `)
        .eq('id', sessionId)
        .single();

      if (error) throw error;
      return data;
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

/**
 * Query options for telemetry data of a specific set.
 * Fetches telemetry points and rep summaries for replay visualization.
 */
export const replayTelemetryOptions = (setId: string) =>
  queryOptions({
    queryKey: queryKeys.replay.telemetry(setId),
    queryFn: async () => {
      const [telemetryRes, summaryRes] = await Promise.all([
        supabase
          .from('telemetry_points')
          .select('*')
          .eq('set_id', setId)
          .order('timestamp_ms'),
        supabase
          .from('rep_summaries')
          .select('*')
          .eq('set_id', setId)
          .order('rep_number'),
      ]);

      if (telemetryRes.error) throw telemetryRes.error;
      if (summaryRes.error) throw summaryRes.error;

      return {
        telemetry: telemetryRes.data,
        repSummaries: summaryRes.data,
      };
    },
    staleTime: 10 * 60 * 1000, // Telemetry is immutable, cache longer
  });
