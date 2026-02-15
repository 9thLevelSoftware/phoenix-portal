import { queryOptions } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from './keys';

/** Volume trend over time (for area/bar chart) */
export function volumeTrendOptions(userId: string, period: string = '4w') {
  return queryOptions({
    queryKey: queryKeys.analytics.summary(userId, `volume-${period}`),
    queryFn: async () => {
      const daysBack = period === '4w' ? 28 : period === '12w' ? 84 : 7;
      const since = new Date();
      since.setDate(since.getDate() - daysBack);

      const { data, error } = await supabase
        .from('workout_sessions')
        .select('started_at, total_volume')
        .eq('user_id', userId)
        .gte('started_at', since.toISOString())
        .order('started_at', { ascending: true });
      if (error) throw error;
      return data;
    },
  });
}

/** Muscle group distribution (for pie/donut chart) */
export function muscleGroupOptions(userId: string) {
  return queryOptions({
    queryKey: queryKeys.analytics.summary(userId, 'muscle-groups'),
    queryFn: async () => {
      // Two-step approach: get user's session IDs, then get exercises grouped by muscle_group
      const { data: sessions, error: sessionError } = await supabase
        .from('workout_sessions')
        .select('id')
        .eq('user_id', userId);
      if (sessionError) throw sessionError;

      if (!sessions || sessions.length === 0) return [];

      const sessionIds = sessions.map((s) => s.id);
      const { data: exercises, error: exerciseError } = await supabase
        .from('exercises')
        .select('muscle_group')
        .in('session_id', sessionIds);
      if (exerciseError) throw exerciseError;

      // Group by muscle_group and count
      const counts: Record<string, number> = {};
      for (const ex of exercises ?? []) {
        counts[ex.muscle_group] = (counts[ex.muscle_group] ?? 0) + 1;
      }

      const total = Object.values(counts).reduce((sum, c) => sum + c, 0);
      return Object.entries(counts).map(([name, count]) => ({
        name,
        value: total > 0 ? Math.round((count / total) * 100) : 0,
      }));
    },
  });
}

/** Strength progress (exercise-specific 1RM trends for line chart) */
export function strengthProgressOptions(userId: string) {
  return queryOptions({
    queryKey: queryKeys.analytics.summary(userId, 'strength-progress'),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('personal_records')
        .select('exercise_name, value, achieved_at')
        .eq('user_id', userId)
        .order('achieved_at', { ascending: true });
      if (error) throw error;
      return data;
    },
  });
}
