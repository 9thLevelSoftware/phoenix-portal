export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      challenge_participants: {
        Row: {
          challenge_id: string
          completed_at: string | null
          id: string
          joined_at: string
          user_id: string
        }
        Insert: {
          challenge_id: string
          completed_at?: string | null
          id?: string
          joined_at?: string
          user_id: string
        }
        Update: {
          challenge_id?: string
          completed_at?: string | null
          id?: string
          joined_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "challenge_participants_challenge_id_fkey"
            columns: ["challenge_id"]
            isOneToOne: false
            referencedRelation: "challenges"
            referencedColumns: ["id"]
          },
        ]
      }
      challenges: {
        Row: {
          challenge_type: string
          created_at: string
          description: string | null
          difficulty: string
          end_date: string | null
          id: string
          is_active: boolean
          name: string
          prize: string | null
          start_date: string | null
          target_unit: string | null
          target_value: number
        }
        Insert: {
          challenge_type: string
          created_at?: string
          description?: string | null
          difficulty?: string
          end_date?: string | null
          id?: string
          is_active?: boolean
          name: string
          prize?: string | null
          start_date?: string | null
          target_unit?: string | null
          target_value: number
        }
        Update: {
          challenge_type?: string
          created_at?: string
          description?: string | null
          difficulty?: string
          end_date?: string | null
          id?: string
          is_active?: boolean
          name?: string
          prize?: string | null
          start_date?: string | null
          target_unit?: string | null
          target_value?: number
        }
        Relationships: []
      }
      community_comments: {
        Row: {
          body: string
          created_at: string
          deleted_at: string | null
          id: string
          item_id: string
          item_type: string
          updated_at: string
          user_id: string
        }
        Insert: {
          body: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          item_id: string
          item_type: string
          updated_at?: string
          user_id: string
        }
        Update: {
          body?: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          item_id?: string
          item_type?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      community_votes: {
        Row: {
          created_at: string
          id: string
          item_id: string
          item_type: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          item_id: string
          item_type: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          item_id?: string
          item_type?: string
          user_id?: string
        }
        Relationships: []
      }
      cycle_days: {
        Row: {
          cycle_id: string
          day_number: number
          day_type: string
          id: string
          notes: string | null
          rep_modifier: number
          rest_override: number | null
          rest_type: string | null
          routine_id: string | null
          weight_adjustment: number
        }
        Insert: {
          cycle_id: string
          day_number: number
          day_type?: string
          id?: string
          notes?: string | null
          rep_modifier?: number
          rest_override?: number | null
          rest_type?: string | null
          routine_id?: string | null
          weight_adjustment?: number
        }
        Update: {
          cycle_id?: string
          day_number?: number
          day_type?: string
          id?: string
          notes?: string | null
          rep_modifier?: number
          rest_override?: number | null
          rest_type?: string | null
          routine_id?: string | null
          weight_adjustment?: number
        }
        Relationships: [
          {
            foreignKeyName: "cycle_days_cycle_id_fkey"
            columns: ["cycle_id"]
            isOneToOne: false
            referencedRelation: "training_cycles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cycle_days_routine_id_fkey"
            columns: ["routine_id"]
            isOneToOne: false
            referencedRelation: "routines"
            referencedColumns: ["id"]
          },
        ]
      }
      exercises: {
        Row: {
          id: string
          muscle_group: string
          name: string
          order_index: number
          session_id: string
        }
        Insert: {
          id?: string
          muscle_group?: string
          name: string
          order_index?: number
          session_id: string
        }
        Update: {
          id?: string
          muscle_group?: string
          name?: string
          order_index?: number
          session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "exercises_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "workout_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      external_activities: {
        Row: {
          activity_type: string | null
          avg_heart_rate: number | null
          calories: number | null
          distance_meters: number | null
          duration_seconds: number | null
          elevation_gain_meters: number | null
          external_id: string
          id: string
          max_heart_rate: number | null
          name: string
          provider: string
          raw_data: Json | null
          started_at: string
          synced_at: string | null
          user_id: string
        }
        Insert: {
          activity_type?: string | null
          avg_heart_rate?: number | null
          calories?: number | null
          distance_meters?: number | null
          duration_seconds?: number | null
          elevation_gain_meters?: number | null
          external_id: string
          id?: string
          max_heart_rate?: number | null
          name: string
          provider: string
          raw_data?: Json | null
          started_at: string
          synced_at?: string | null
          user_id: string
        }
        Update: {
          activity_type?: string | null
          avg_heart_rate?: number | null
          calories?: number | null
          distance_meters?: number | null
          duration_seconds?: number | null
          elevation_gain_meters?: number | null
          external_id?: string
          id?: string
          max_heart_rate?: number | null
          name?: string
          provider?: string
          raw_data?: Json | null
          started_at?: string
          synced_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      personal_records: {
        Row: {
          achieved_at: string
          exercise_name: string
          id: string
          muscle_group: string
          previous_value: number | null
          record_type: string
          unit: string
          user_id: string
          value: number
        }
        Insert: {
          achieved_at?: string
          exercise_name: string
          id?: string
          muscle_group?: string
          previous_value?: number | null
          record_type?: string
          unit?: string
          user_id: string
          value: number
        }
        Update: {
          achieved_at?: string
          exercise_name?: string
          id?: string
          muscle_group?: string
          previous_value?: number | null
          record_type?: string
          unit?: string
          user_id?: string
          value?: number
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          challenge_updates: boolean
          created_at: string | null
          display_name: string | null
          email_digests: boolean
          id: string
          leaderboard_participation: boolean
          profile_visible: boolean
          push_notifications: boolean
          streak_reminders: boolean
          stripe_customer_id: string | null
          updated_at: string | null
          user_id: string | null
          weight_unit: string
        }
        Insert: {
          avatar_url?: string | null
          challenge_updates?: boolean
          created_at?: string | null
          display_name?: string | null
          email_digests?: boolean
          id: string
          leaderboard_participation?: boolean
          profile_visible?: boolean
          push_notifications?: boolean
          streak_reminders?: boolean
          stripe_customer_id?: string | null
          updated_at?: string | null
          user_id?: string | null
          weight_unit?: string
        }
        Update: {
          avatar_url?: string | null
          challenge_updates?: boolean
          created_at?: string | null
          display_name?: string | null
          email_digests?: boolean
          id?: string
          leaderboard_participation?: boolean
          profile_visible?: boolean
          push_notifications?: boolean
          streak_reminders?: boolean
          stripe_customer_id?: string | null
          updated_at?: string | null
          user_id?: string | null
          weight_unit?: string
        }
        Relationships: []
      }
      rate_limit_tracking: {
        Row: {
          id: string
          last_request_at: string | null
          last_reset_at: string | null
          provider: string
          requests_this_window: number | null
          window_started_at: string | null
        }
        Insert: {
          id?: string
          last_request_at?: string | null
          last_reset_at?: string | null
          provider: string
          requests_this_window?: number | null
          window_started_at?: string | null
        }
        Update: {
          id?: string
          last_request_at?: string | null
          last_reset_at?: string | null
          provider?: string
          requests_this_window?: number | null
          window_started_at?: string | null
        }
        Relationships: []
      }
      rep_summaries: {
        Row: {
          asymmetry_pct: number | null
          id: string
          left_force_avg: number | null
          mean_force_n: number | null
          mean_velocity_mps: number | null
          peak_force_n: number | null
          peak_velocity_mps: number | null
          power_watts: number | null
          rep_number: number
          right_force_avg: number | null
          rom_mm: number | null
          set_id: string
          tut_ms: number | null
          vbt_zone: string | null
        }
        Insert: {
          asymmetry_pct?: number | null
          id?: string
          left_force_avg?: number | null
          mean_force_n?: number | null
          mean_velocity_mps?: number | null
          peak_force_n?: number | null
          peak_velocity_mps?: number | null
          power_watts?: number | null
          rep_number: number
          right_force_avg?: number | null
          rom_mm?: number | null
          set_id: string
          tut_ms?: number | null
          vbt_zone?: string | null
        }
        Update: {
          asymmetry_pct?: number | null
          id?: string
          left_force_avg?: number | null
          mean_force_n?: number | null
          mean_velocity_mps?: number | null
          peak_force_n?: number | null
          peak_velocity_mps?: number | null
          power_watts?: number | null
          rep_number?: number
          right_force_avg?: number | null
          rom_mm?: number | null
          set_id?: string
          tut_ms?: number | null
          vbt_zone?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "rep_summaries_set_id_fkey"
            columns: ["set_id"]
            isOneToOne: false
            referencedRelation: "sets"
            referencedColumns: ["id"]
          },
        ]
      }
      rep_telemetry: {
        Row: {
          cable: string | null
          force_n: number | null
          id: string
          position_mm: number | null
          set_id: string
          timestamp_ms: number
          velocity_mps: number | null
        }
        Insert: {
          cable?: string | null
          force_n?: number | null
          id?: string
          position_mm?: number | null
          set_id: string
          timestamp_ms: number
          velocity_mps?: number | null
        }
        Update: {
          cable?: string | null
          force_n?: number | null
          id?: string
          position_mm?: number | null
          set_id?: string
          timestamp_ms?: number
          velocity_mps?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "rep_telemetry_set_id_fkey"
            columns: ["set_id"]
            isOneToOne: false
            referencedRelation: "sets"
            referencedColumns: ["id"]
          },
        ]
      }
      routine_exercises: {
        Row: {
          created_at: string
          id: string
          mode: string
          muscle_group: string
          name: string
          order_index: number
          reps: number
          rest_seconds: number
          routine_id: string
          sets: number
          weight: number
        }
        Insert: {
          created_at?: string
          id?: string
          mode?: string
          muscle_group?: string
          name: string
          order_index?: number
          reps?: number
          rest_seconds?: number
          routine_id: string
          sets?: number
          weight?: number
        }
        Update: {
          created_at?: string
          id?: string
          mode?: string
          muscle_group?: string
          name?: string
          order_index?: number
          reps?: number
          rest_seconds?: number
          routine_id?: string
          sets?: number
          weight?: number
        }
        Relationships: [
          {
            foreignKeyName: "routine_exercises_routine_id_fkey"
            columns: ["routine_id"]
            isOneToOne: false
            referencedRelation: "routines"
            referencedColumns: ["id"]
          },
        ]
      }
      routines: {
        Row: {
          description: string
          estimated_duration: number
          exercise_count: number
          id: string
          is_favorite: boolean
          last_used_at: string | null
          name: string
          tags: string[] | null
          times_completed: number
          user_id: string
        }
        Insert: {
          description?: string
          estimated_duration?: number
          exercise_count?: number
          id?: string
          is_favorite?: boolean
          last_used_at?: string | null
          name: string
          tags?: string[] | null
          times_completed?: number
          user_id: string
        }
        Update: {
          description?: string
          estimated_duration?: number
          exercise_count?: number
          id?: string
          is_favorite?: boolean
          last_used_at?: string | null
          name?: string
          tags?: string[] | null
          times_completed?: number
          user_id?: string
        }
        Relationships: []
      }
      saved_community_items: {
        Row: {
          id: string
          item_type: string
          saved_at: string
          shared_item_id: string
          user_id: string
        }
        Insert: {
          id?: string
          item_type: string
          saved_at?: string
          shared_item_id: string
          user_id: string
        }
        Update: {
          id?: string
          item_type?: string
          saved_at?: string
          shared_item_id?: string
          user_id?: string
        }
        Relationships: []
      }
      sets: {
        Row: {
          actual_reps: number
          exercise_id: string
          id: string
          is_pr: boolean
          notes: string | null
          rpe: number | null
          set_number: number
          target_reps: number | null
          weight_kg: number
        }
        Insert: {
          actual_reps?: number
          exercise_id: string
          id?: string
          is_pr?: boolean
          notes?: string | null
          rpe?: number | null
          set_number: number
          target_reps?: number | null
          weight_kg?: number
        }
        Update: {
          actual_reps?: number
          exercise_id?: string
          id?: string
          is_pr?: boolean
          notes?: string | null
          rpe?: number | null
          set_number?: number
          target_reps?: number | null
          weight_kg?: number
        }
        Relationships: [
          {
            foreignKeyName: "sets_exercise_id_fkey"
            columns: ["exercise_id"]
            isOneToOne: false
            referencedRelation: "exercises"
            referencedColumns: ["id"]
          },
        ]
      }
      shared_cycles: {
        Row: {
          comment_count: number
          cycle_id: string
          description: string
          difficulty: string
          duration_weeks: number
          hot_score: number
          id: string
          name: string
          save_count: number
          shared_at: string
          tags: string[]
          updated_at: string
          user_id: string
          vote_count: number
        }
        Insert: {
          comment_count?: number
          cycle_id: string
          description?: string
          difficulty?: string
          duration_weeks?: number
          hot_score?: number
          id?: string
          name: string
          save_count?: number
          shared_at?: string
          tags?: string[]
          updated_at?: string
          user_id: string
          vote_count?: number
        }
        Update: {
          comment_count?: number
          cycle_id?: string
          description?: string
          difficulty?: string
          duration_weeks?: number
          hot_score?: number
          id?: string
          name?: string
          save_count?: number
          shared_at?: string
          tags?: string[]
          updated_at?: string
          user_id?: string
          vote_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "shared_cycles_cycle_id_fkey"
            columns: ["cycle_id"]
            isOneToOne: false
            referencedRelation: "training_cycles"
            referencedColumns: ["id"]
          },
        ]
      }
      shared_routines: {
        Row: {
          comment_count: number
          description: string
          difficulty: string
          estimated_duration: number
          exercise_count: number
          exercises_snapshot: Json | null
          hot_score: number
          id: string
          name: string
          routine_id: string
          save_count: number
          shared_at: string
          tags: string[]
          updated_at: string
          user_id: string
          vote_count: number
        }
        Insert: {
          comment_count?: number
          description?: string
          difficulty?: string
          estimated_duration?: number
          exercise_count?: number
          exercises_snapshot?: Json | null
          hot_score?: number
          id?: string
          name: string
          routine_id: string
          save_count?: number
          shared_at?: string
          tags?: string[]
          updated_at?: string
          user_id: string
          vote_count?: number
        }
        Update: {
          comment_count?: number
          description?: string
          difficulty?: string
          estimated_duration?: number
          exercise_count?: number
          exercises_snapshot?: Json | null
          hot_score?: number
          id?: string
          name?: string
          routine_id?: string
          save_count?: number
          shared_at?: string
          tags?: string[]
          updated_at?: string
          user_id?: string
          vote_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "shared_routines_routine_id_fkey"
            columns: ["routine_id"]
            isOneToOne: false
            referencedRelation: "routines"
            referencedColumns: ["id"]
          },
        ]
      }
      subscriptions: {
        Row: {
          cancel_at_period_end: boolean | null
          created_at: string | null
          current_period_end: string
          current_period_start: string
          id: string
          price_id: string
          status: string
          stripe_customer_id: string
          stripe_subscription_id: string
          tier: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          cancel_at_period_end?: boolean | null
          created_at?: string | null
          current_period_end: string
          current_period_start: string
          id?: string
          price_id: string
          status: string
          stripe_customer_id: string
          stripe_subscription_id: string
          tier: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          cancel_at_period_end?: boolean | null
          created_at?: string | null
          current_period_end?: string
          current_period_start?: string
          id?: string
          price_id?: string
          status?: string
          stripe_customer_id?: string
          stripe_subscription_id?: string
          tier?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      sync_queue: {
        Row: {
          completed_at: string | null
          created_at: string | null
          error_message: string | null
          id: string
          provider: string
          retry_count: number | null
          started_at: string | null
          status: string | null
          sync_type: string | null
          user_id: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string | null
          error_message?: string | null
          id?: string
          provider: string
          retry_count?: number | null
          started_at?: string | null
          status?: string | null
          sync_type?: string | null
          user_id: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string | null
          error_message?: string | null
          id?: string
          provider?: string
          retry_count?: number | null
          started_at?: string | null
          status?: string | null
          sync_type?: string | null
          user_id?: string
        }
        Relationships: []
      }
      training_cycles: {
        Row: {
          current_week: number
          deload_settings: Json | null
          description: string | null
          duration_weeks: number
          id: string
          last_used_at: string | null
          name: string
          progression_settings: Json | null
          rest_days: number
          started_at: string | null
          status: string
          user_id: string
          workout_days: number
        }
        Insert: {
          current_week?: number
          deload_settings?: Json | null
          description?: string | null
          duration_weeks?: number
          id?: string
          last_used_at?: string | null
          name: string
          progression_settings?: Json | null
          rest_days?: number
          started_at?: string | null
          status?: string
          user_id: string
          workout_days?: number
        }
        Update: {
          current_week?: number
          deload_settings?: Json | null
          description?: string | null
          duration_weeks?: number
          id?: string
          last_used_at?: string | null
          name?: string
          progression_settings?: Json | null
          rest_days?: number
          started_at?: string | null
          status?: string
          user_id?: string
          workout_days?: number
        }
        Relationships: []
      }
      user_goals: {
        Row: {
          completed_at: string | null
          created_at: string
          deadline: string | null
          exercise_name: string | null
          goal_type: string
          id: string
          period: string
          status: string
          target_unit: string
          target_value: number
          updated_at: string
          user_id: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          deadline?: string | null
          exercise_name?: string | null
          goal_type: string
          id?: string
          period?: string
          status?: string
          target_unit: string
          target_value: number
          updated_at?: string
          user_id: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          deadline?: string | null
          exercise_name?: string | null
          goal_type?: string
          id?: string
          period?: string
          status?: string
          target_unit?: string
          target_value?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_integrations: {
        Row: {
          access_token: string | null
          api_key: string | null
          connected_at: string | null
          error_message: string | null
          id: string
          last_sync_at: string | null
          provider: string
          provider_user_id: string | null
          refresh_token: string | null
          status: string | null
          token_expires_at: string | null
          user_id: string
        }
        Insert: {
          access_token?: string | null
          api_key?: string | null
          connected_at?: string | null
          error_message?: string | null
          id?: string
          last_sync_at?: string | null
          provider: string
          provider_user_id?: string | null
          refresh_token?: string | null
          status?: string | null
          token_expires_at?: string | null
          user_id: string
        }
        Update: {
          access_token?: string | null
          api_key?: string | null
          connected_at?: string | null
          error_message?: string | null
          id?: string
          last_sync_at?: string | null
          provider?: string
          provider_user_id?: string | null
          refresh_token?: string | null
          status?: string | null
          token_expires_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      user_onboarding: {
        Row: {
          completed_at: string | null
          created_at: string
          dismissed_hints: Json
          dismissed_whats_new: boolean
          id: string
          user_id: string
          version_seen: string | null
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          dismissed_hints?: Json
          dismissed_whats_new?: boolean
          id?: string
          user_id: string
          version_seen?: string | null
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          dismissed_hints?: Json
          dismissed_whats_new?: boolean
          id?: string
          user_id?: string
          version_seen?: string | null
        }
        Relationships: []
      }
      user_subscriptions: {
        Row: {
          created_at: string | null
          expires_at: string | null
          id: string
          last_verified_at: string | null
          product_id: string | null
          revenuecat_customer_id: string | null
          subscription_status: string | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          expires_at?: string | null
          id?: string
          last_verified_at?: string | null
          product_id?: string | null
          revenuecat_customer_id?: string | null
          subscription_status?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          expires_at?: string | null
          id?: string
          last_verified_at?: string | null
          product_id?: string | null
          revenuecat_customer_id?: string | null
          subscription_status?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      workout_sessions: {
        Row: {
          duration_seconds: number
          exercise_count: number
          id: string
          name: string | null
          pr_count: number
          routine_name: string | null
          set_count: number
          started_at: string
          total_volume: number
          user_id: string
          workout_mode: string | null
        }
        Insert: {
          duration_seconds?: number
          exercise_count?: number
          id?: string
          name?: string | null
          pr_count?: number
          routine_name?: string | null
          set_count?: number
          started_at?: string
          total_volume?: number
          user_id: string
          workout_mode?: string | null
        }
        Update: {
          duration_seconds?: number
          exercise_count?: number
          id?: string
          name?: string | null
          pr_count?: number
          routine_name?: string | null
          set_count?: number
          started_at?: string
          total_volume?: number
          user_id?: string
          workout_mode?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      telemetry_points: {
        Row: {
          cable: string | null
          force_n: number | null
          id: string | null
          position_mm: number | null
          set_id: string | null
          timestamp_ms: number | null
          velocity_mps: number | null
        }
        Insert: {
          cable?: string | null
          force_n?: number | null
          id?: string | null
          position_mm?: number | null
          set_id?: string | null
          timestamp_ms?: number | null
          velocity_mps?: number | null
        }
        Update: {
          cable?: string | null
          force_n?: number | null
          id?: string | null
          position_mm?: number | null
          set_id?: string | null
          timestamp_ms?: number | null
          velocity_mps?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "rep_telemetry_set_id_fkey"
            columns: ["set_id"]
            isOneToOne: false
            referencedRelation: "sets"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      user_subscription_tier: { Args: never; Returns: string }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
