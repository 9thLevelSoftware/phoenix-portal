// STUB TYPES - Replace with `supabase gen types typescript` output when schema is finalized

export type Database = {
  public: {
    Tables: {
      workout_sessions: {
        Row: {
          id: string;
          user_id: string;
          name: string;
          started_at: string;
          duration_seconds: number;
          total_volume: number;
          set_count: number;
          exercise_count: number;
          pr_count: number;
          routine_name: string | null;
          workout_mode: string | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          name: string;
          started_at: string;
          duration_seconds: number;
          total_volume: number;
          set_count: number;
          exercise_count: number;
          pr_count: number;
          routine_name?: string | null;
          workout_mode?: string | null;
        };
        Update: {
          id?: string;
          user_id?: string;
          name?: string;
          started_at?: string;
          duration_seconds?: number;
          total_volume?: number;
          set_count?: number;
          exercise_count?: number;
          pr_count?: number;
          routine_name?: string | null;
          workout_mode?: string | null;
        };
      };
      exercises: {
        Row: {
          id: string;
          session_id: string;
          name: string;
          muscle_group: string;
          order_index: number;
        };
        Insert: {
          id?: string;
          session_id: string;
          name: string;
          muscle_group: string;
          order_index: number;
        };
        Update: {
          id?: string;
          session_id?: string;
          name?: string;
          muscle_group?: string;
          order_index?: number;
        };
      };
      sets: {
        Row: {
          id: string;
          exercise_id: string;
          set_number: number;
          target_reps: number;
          actual_reps: number;
          weight_kg: number;
          rpe: number | null;
          is_pr: boolean;
          notes: string | null;
        };
        Insert: {
          id?: string;
          exercise_id: string;
          set_number: number;
          target_reps: number;
          actual_reps: number;
          weight_kg: number;
          rpe?: number | null;
          is_pr: boolean;
          notes?: string | null;
        };
        Update: {
          id?: string;
          exercise_id?: string;
          set_number?: number;
          target_reps?: number;
          actual_reps?: number;
          weight_kg?: number;
          rpe?: number | null;
          is_pr?: boolean;
          notes?: string | null;
        };
      };
      personal_records: {
        Row: {
          id: string;
          user_id: string;
          exercise_name: string;
          muscle_group: string;
          record_type: string;
          value: number;
          unit: string;
          achieved_at: string;
          previous_value: number | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          exercise_name: string;
          muscle_group: string;
          record_type: string;
          value: number;
          unit: string;
          achieved_at: string;
          previous_value?: number | null;
        };
        Update: {
          id?: string;
          user_id?: string;
          exercise_name?: string;
          muscle_group?: string;
          record_type?: string;
          value?: number;
          unit?: string;
          achieved_at?: string;
          previous_value?: number | null;
        };
      };
      routines: {
        Row: {
          id: string;
          user_id: string;
          name: string;
          description: string;
          exercise_count: number;
          estimated_duration: number;
          times_completed: number;
          last_used_at: string | null;
          tags: string[] | null;
          is_favorite: boolean;
        };
        Insert: {
          id?: string;
          user_id: string;
          name: string;
          description: string;
          exercise_count: number;
          estimated_duration: number;
          times_completed: number;
          last_used_at?: string | null;
          tags?: string[] | null;
          is_favorite: boolean;
        };
        Update: {
          id?: string;
          user_id?: string;
          name?: string;
          description?: string;
          exercise_count?: number;
          estimated_duration?: number;
          times_completed?: number;
          last_used_at?: string | null;
          tags?: string[] | null;
          is_favorite?: boolean;
        };
      };
      training_cycles: {
        Row: {
          id: string;
          user_id: string;
          name: string;
          duration_weeks: number;
          current_week: number;
          status: string;
          workout_days: number;
          rest_days: number;
          last_used_at: string | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          name: string;
          duration_weeks: number;
          current_week: number;
          status: string;
          workout_days: number;
          rest_days: number;
          last_used_at?: string | null;
        };
        Update: {
          id?: string;
          user_id?: string;
          name?: string;
          duration_weeks?: number;
          current_week?: number;
          status?: string;
          workout_days?: number;
          rest_days?: number;
          last_used_at?: string | null;
        };
      };
      analytics_summaries: {
        Row: {
          id: string;
          user_id: string;
          period: string;
          total_workouts: number;
          total_volume: number;
          total_duration: number;
          avg_session_duration: number;
          streak_days: number;
          computed_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          period: string;
          total_workouts: number;
          total_volume: number;
          total_duration: number;
          avg_session_duration: number;
          streak_days: number;
          computed_at: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          period?: string;
          total_workouts?: number;
          total_volume?: number;
          total_duration?: number;
          avg_session_duration?: number;
          streak_days?: number;
          computed_at?: string;
        };
      };
    };
  };
};
