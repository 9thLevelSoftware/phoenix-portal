import { queryOptions } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from './keys';
import {
  workoutListSchema,
  personalRecordListSchema,
} from '@/schemas/transforms';

/**
 * Paginated workout session list for a user.
 * Returns Zod-transformed WorkoutSession[] (weights doubled, dates as Date, duration as minutes).
 */
export function workoutListOptions(userId: string) {
  return queryOptions({
    queryKey: queryKeys.workouts.list(userId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('workout_sessions')
        .select('*')
        .eq('user_id', userId)
        .order('started_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return workoutListSchema.parse(data);
    },
  });
}

/**
 * Dashboard summary stats -- recent workouts for the past 7 days.
 * Returns raw rows so the Dashboard component can aggregate (weekly volume chart, totals).
 */
export function dashboardStatsOptions(userId: string) {
  return queryOptions({
    queryKey: [...queryKeys.workouts.all, 'dashboard-stats', userId] as const,
    queryFn: async () => {
      const weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 7);

      const { data, error } = await supabase
        .from('workout_sessions')
        .select('started_at, total_volume, duration_seconds, pr_count')
        .eq('user_id', userId)
        .gte('started_at', weekAgo.toISOString())
        .order('started_at', { ascending: true });
      if (error) throw error;
      return data;
    },
  });
}

/**
 * Most recent personal records for the dashboard PR widget.
 * Returns Zod-transformed PersonalRecord[] (weights doubled, dates as Date).
 */
export function recentPRsOptions(userId: string) {
  return queryOptions({
    queryKey: [...queryKeys.records.all, 'recent', userId] as const,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('personal_records')
        .select('*')
        .eq('user_id', userId)
        .order('achieved_at', { ascending: false })
        .limit(5);
      if (error) throw error;
      return personalRecordListSchema.parse(data);
    },
  });
}
