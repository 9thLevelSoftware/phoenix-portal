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
      community_comments: {
        Row: {
          id: string
          item_id: string
          item_type: string
          user_id: string
          body: string
          created_at: string
          updated_at: string
          deleted_at: string | null
        }
        Insert: {
          id?: string
          item_id: string
          item_type: string
          user_id?: string
          body: string
          created_at?: string
          updated_at?: string
          deleted_at?: string | null
        }
        Update: {
          id?: string
          item_id?: string
          item_type?: string
          user_id?: string
          body?: string
          created_at?: string
          updated_at?: string
          deleted_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "community_comments_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          }
        ]
      }
      shared_routines: {
        Row: {
          id: string
          user_id: string
          routine_id: string
          name: string
          description: string
          exercise_count: number
          estimated_duration: number
          exercises_snapshot: Json | null
          tags: string[]
          difficulty: string
          vote_count: number
          save_count: number
          hot_score: number
          comment_count: number
          shared_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          routine_id: string
          name: string
          description: string
          exercise_count?: number
          estimated_duration?: number
          exercises_snapshot?: Json | null
          tags?: string[]
          difficulty?: string
          vote_count?: number
          save_count?: number
          hot_score?: number
          comment_count?: number
          shared_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          routine_id?: string
          name?: string
          description?: string
          exercise_count?: number
          estimated_duration?: number
          exercises_snapshot?: Json | null
          tags?: string[]
          difficulty?: string
          vote_count?: number
          save_count?: number
          hot_score?: number
          comment_count?: number
          shared_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      shared_cycles: {
        Row: {
          id: string
          user_id: string
          cycle_id: string
          name: string
          description: string
          duration_weeks: number
          tags: string[]
          difficulty: string
          vote_count: number
          save_count: number
          hot_score: number
          comment_count: number
          shared_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          cycle_id: string
          name: string
          description: string
          duration_weeks?: number
          tags?: string[]
          difficulty?: string
          vote_count?: number
          save_count?: number
          hot_score?: number
          comment_count?: number
          shared_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          cycle_id?: string
          name?: string
          description?: string
          duration_weeks?: number
          tags?: string[]
          difficulty?: string
          vote_count?: number
          save_count?: number
          hot_score?: number
          comment_count?: number
          shared_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      user_onboarding: {
        Row: {
          id: string
          user_id: string
          completed_at: string | null
          version_seen: string | null
          dismissed_hints: Json
          dismissed_whats_new: boolean
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          completed_at?: string | null
          version_seen?: string | null
          dismissed_hints?: Json
          dismissed_whats_new?: boolean
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          completed_at?: string | null
          version_seen?: string | null
          dismissed_hints?: Json
          dismissed_whats_new?: boolean
          created_at?: string
        }
        Relationships: []
      }
      user_goals: {
        Row: {
          id: string
          user_id: string
          goal_type: "frequency" | "volume" | "pr"
          target_value: number
          target_unit: string
          exercise_name: string | null
          deadline: string | null
          period: "weekly" | "monthly"
          status: "active" | "completed" | "archived"
          completed_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          goal_type: "frequency" | "volume" | "pr"
          target_value: number
          target_unit: string
          exercise_name?: string | null
          deadline?: string | null
          period?: "weekly" | "monthly"
          status?: "active" | "completed" | "archived"
          completed_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          goal_type?: "frequency" | "volume" | "pr"
          target_value?: number
          target_unit?: string
          exercise_name?: string | null
          deadline?: string | null
          period?: "weekly" | "monthly"
          status?: "active" | "completed" | "archived"
          completed_at?: string | null
          created_at?: string
          updated_at?: string
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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
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
