import { queryOptions } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from './keys';

/**
 * Session asymmetry data: rep summaries with exercise context for a session.
 * Uses two-step approach (consistent with analytics.ts pattern):
 * 1. Fetch exercise IDs for the session
 * 2. Fetch sets for those exercises
 * 3. Fetch rep summaries for those sets
 */
export function sessionAsymmetryOptions(sessionId: string) {
  return queryOptions({
    queryKey: queryKeys.biomechanics.asymmetry(sessionId),
    queryFn: async () => {
      // Step 1: Get exercises for this session
      const { data: exercises, error: exError } = await supabase
        .from('exercises')
        .select('id, name, muscle_group')
        .eq('session_id', sessionId);
      if (exError) throw exError;
      if (!exercises || exercises.length === 0) return [];

      // Step 2: Get sets for those exercises
      const exerciseIds = exercises.map((e) => e.id);
      const { data: sets, error: setError } = await supabase
        .from('sets')
        .select('id, exercise_id')
        .in('exercise_id', exerciseIds);
      if (setError) throw setError;
      if (!sets || sets.length === 0) return [];

      // Step 3: Get rep summaries for those sets
      const setIds = sets.map((s) => s.id);
      const { data: reps, error: repError } = await supabase
        .from('rep_summaries')
        .select('*')
        .in('set_id', setIds);
      if (repError) throw repError;

      // Build exercise lookup via sets
      const setToExercise = new Map(sets.map((s) => [s.id, s.exercise_id]));
      const exerciseMap = new Map(exercises.map((e) => [e.id, e]));

      return (reps ?? []).map((rep) => {
        const exerciseId = setToExercise.get(rep.set_id);
        const exercise = exerciseId ? exerciseMap.get(exerciseId) : undefined;
        return {
          ...rep,
          exercise_name: exercise?.name ?? 'Unknown',
          muscle_group: exercise?.muscle_group ?? 'Unknown',
        };
      });
    },
  });
}
