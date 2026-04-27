export type Json =
	| string
	| number
	| boolean
	| null
	| { [key: string]: Json | undefined }
	| Json[];

export type Database = {
	// Allows to automatically instantiate createClient with right options
	// instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
	__InternalSupabase: {
		PostgrestVersion: "14.1";
	};
	public: {
		Tables: {
			challenge_participants: {
				Row: {
					challenge_id: string;
					completed_at: string | null;
					id: string;
					joined_at: string;
					user_id: string;
				};
				Insert: {
					challenge_id: string;
					completed_at?: string | null;
					id?: string;
					joined_at?: string;
					user_id: string;
				};
				Update: {
					challenge_id?: string;
					completed_at?: string | null;
					id?: string;
					joined_at?: string;
					user_id?: string;
				};
				Relationships: [
					{
						foreignKeyName: "challenge_participants_challenge_id_fkey";
						columns: ["challenge_id"];
						isOneToOne: false;
						referencedRelation: "challenges";
						referencedColumns: ["id"];
					},
				];
			};
			challenges: {
				Row: {
					challenge_type: string;
					created_at: string;
					description: string | null;
					difficulty: string;
					end_date: string | null;
					id: string;
					is_active: boolean;
					name: string;
					prize: string | null;
					start_date: string | null;
					target_unit: string | null;
					target_value: number;
				};
				Insert: {
					challenge_type: string;
					created_at?: string;
					description?: string | null;
					difficulty?: string;
					end_date?: string | null;
					id?: string;
					is_active?: boolean;
					name: string;
					prize?: string | null;
					start_date?: string | null;
					target_unit?: string | null;
					target_value: number;
				};
				Update: {
					challenge_type?: string;
					created_at?: string;
					description?: string | null;
					difficulty?: string;
					end_date?: string | null;
					id?: string;
					is_active?: boolean;
					name?: string;
					prize?: string | null;
					start_date?: string | null;
					target_unit?: string | null;
					target_value?: number;
				};
				Relationships: [];
			};
			community_benchmarks: {
				Row: {
					id: string;
					metric_key: string | null;
					metric_type: string;
					percentile_values: Json;
					total_users: number;
					updated_at: string | null;
				};
				Insert: {
					id?: string;
					metric_key?: string | null;
					metric_type: string;
					percentile_values?: Json;
					total_users?: number;
					updated_at?: string | null;
				};
				Update: {
					id?: string;
					metric_key?: string | null;
					metric_type?: string;
					percentile_values?: Json;
					total_users?: number;
					updated_at?: string | null;
				};
				Relationships: [];
			};
			community_comments: {
				Row: {
					body: string;
					created_at: string;
					deleted_at: string | null;
					id: string;
					item_id: string;
					item_type: string;
					updated_at: string;
					user_id: string | null;
				};
				Insert: {
					body: string;
					created_at?: string;
					deleted_at?: string | null;
					id?: string;
					item_id: string;
					item_type: string;
					updated_at?: string;
					user_id?: string | null;
				};
				Update: {
					body?: string;
					created_at?: string;
					deleted_at?: string | null;
					id?: string;
					item_id?: string;
					item_type?: string;
					updated_at?: string;
					user_id?: string | null;
				};
				Relationships: [
					{
						foreignKeyName: "community_comments_user_id_profiles_fkey";
						columns: ["user_id"];
						isOneToOne: false;
						referencedRelation: "creator_stats";
						referencedColumns: ["user_id"];
					},
					{
						foreignKeyName: "community_comments_user_id_profiles_fkey";
						columns: ["user_id"];
						isOneToOne: false;
						referencedRelation: "profiles";
						referencedColumns: ["id"];
					},
				];
			};
			community_votes: {
				Row: {
					created_at: string;
					id: string;
					item_id: string;
					item_type: string;
					user_id: string;
				};
				Insert: {
					created_at?: string;
					id?: string;
					item_id: string;
					item_type: string;
					user_id: string;
				};
				Update: {
					created_at?: string;
					id?: string;
					item_id?: string;
					item_type?: string;
					user_id?: string;
				};
				Relationships: [];
			};
			content_reports: {
				Row: {
					category: string;
					content_id: string;
					content_type: string;
					created_at: string;
					description: string | null;
					id: string;
					reporter_id: string;
				};
				Insert: {
					category: string;
					content_id: string;
					content_type: string;
					created_at?: string;
					description?: string | null;
					id?: string;
					reporter_id: string;
				};
				Update: {
					category?: string;
					content_id?: string;
					content_type?: string;
					created_at?: string;
					description?: string | null;
					id?: string;
					reporter_id?: string;
				};
				Relationships: [];
			};
			creator_follows: {
				Row: {
					created_at: string;
					followed_id: string;
					follower_id: string;
					id: string;
				};
				Insert: {
					created_at?: string;
					followed_id: string;
					follower_id: string;
					id?: string;
				};
				Update: {
					created_at?: string;
					followed_id?: string;
					follower_id?: string;
					id?: string;
				};
				Relationships: [];
			};
			cycle_days: {
				Row: {
					cycle_id: string;
					day_number: number;
					day_type: string;
					id: string;
					notes: string | null;
					rep_modifier: number;
					rest_override: number | null;
					rest_type: string | null;
					routine_id: string | null;
					weight_adjustment: number;
				};
				Insert: {
					cycle_id: string;
					day_number: number;
					day_type?: string;
					id?: string;
					notes?: string | null;
					rep_modifier?: number;
					rest_override?: number | null;
					rest_type?: string | null;
					routine_id?: string | null;
					weight_adjustment?: number;
				};
				Update: {
					cycle_id?: string;
					day_number?: number;
					day_type?: string;
					id?: string;
					notes?: string | null;
					rep_modifier?: number;
					rest_override?: number | null;
					rest_type?: string | null;
					routine_id?: string | null;
					weight_adjustment?: number;
				};
				Relationships: [
					{
						foreignKeyName: "cycle_days_cycle_id_fkey";
						columns: ["cycle_id"];
						isOneToOne: false;
						referencedRelation: "training_cycles";
						referencedColumns: ["id"];
					},
					{
						foreignKeyName: "cycle_days_routine_id_fkey";
						columns: ["routine_id"];
						isOneToOne: false;
						referencedRelation: "routines";
						referencedColumns: ["id"];
					},
				];
			};
			deletion_requests: {
				Row: {
					cancelled_at: string | null;
					executed_at: string | null;
					id: string;
					requested_at: string;
					scheduled_for: string;
					status: string;
					user_id: string;
				};
				Insert: {
					cancelled_at?: string | null;
					executed_at?: string | null;
					id?: string;
					requested_at?: string;
					scheduled_for?: string;
					status?: string;
					user_id: string;
				};
				Update: {
					cancelled_at?: string | null;
					executed_at?: string | null;
					id?: string;
					requested_at?: string;
					scheduled_for?: string;
					status?: string;
					user_id?: string;
				};
				Relationships: [];
			};
			earned_badges: {
				Row: {
					badge_description: string | null;
					badge_id: string;
					badge_name: string;
					badge_tier: string | null;
					earned_at: string;
					id: string;
					user_id: string;
				};
				Insert: {
					badge_description?: string | null;
					badge_id: string;
					badge_name: string;
					badge_tier?: string | null;
					earned_at?: string;
					id?: string;
					user_id: string;
				};
				Update: {
					badge_description?: string | null;
					badge_id?: string;
					badge_name?: string;
					badge_tier?: string | null;
					earned_at?: string;
					id?: string;
					user_id?: string;
				};
				Relationships: [];
			};
			exercise_progress: {
				Row: {
					estimated_1rm_kg: number;
					exercise_name: string;
					id: string;
					local_profile_id: string | null;
					max_reps: number;
					max_weight_kg: number;
					recorded_at: string;
					session_id: string;
					set_count: number;
					total_volume_kg: number;
					user_id: string;
				};
				Insert: {
					estimated_1rm_kg?: number;
					exercise_name: string;
					id?: string;
					local_profile_id?: string | null;
					max_reps?: number;
					max_weight_kg?: number;
					recorded_at?: string;
					session_id: string;
					set_count?: number;
					total_volume_kg?: number;
					user_id: string;
				};
				Update: {
					estimated_1rm_kg?: number;
					exercise_name?: string;
					id?: string;
					local_profile_id?: string | null;
					max_reps?: number;
					max_weight_kg?: number;
					recorded_at?: string;
					session_id?: string;
					set_count?: number;
					total_volume_kg?: number;
					user_id?: string;
				};
				Relationships: [
					{
						foreignKeyName: "exercise_progress_session_id_fkey";
						columns: ["session_id"];
						isOneToOne: false;
						referencedRelation: "workout_sessions";
						referencedColumns: ["id"];
					},
					{
						foreignKeyName: "fk_exercise_progress_profile";
						columns: ["user_id", "local_profile_id"];
						isOneToOne: false;
						referencedRelation: "local_profiles";
						referencedColumns: ["user_id", "id"];
					},
				];
			};
			exercise_signatures: {
				Row: {
					cable_config: string | null;
					confidence: number | null;
					created_at: string | null;
					duration_ms: number | null;
					exercise_id: string;
					id: string;
					rom_mm: number | null;
					sample_count: number | null;
					symmetry_ratio: number | null;
					updated_at: string | null;
					user_id: string;
					velocity_profile: string | null;
				};
				Insert: {
					cable_config?: string | null;
					confidence?: number | null;
					created_at?: string | null;
					duration_ms?: number | null;
					exercise_id: string;
					id?: string;
					rom_mm?: number | null;
					sample_count?: number | null;
					symmetry_ratio?: number | null;
					updated_at?: string | null;
					user_id: string;
					velocity_profile?: string | null;
				};
				Update: {
					cable_config?: string | null;
					confidence?: number | null;
					created_at?: string | null;
					duration_ms?: number | null;
					exercise_id?: string;
					id?: string;
					rom_mm?: number | null;
					sample_count?: number | null;
					symmetry_ratio?: number | null;
					updated_at?: string | null;
					user_id?: string;
					velocity_profile?: string | null;
				};
				Relationships: [];
			};
			exercises: {
				Row: {
					id: string;
					muscle_group: string;
					name: string;
					order_index: number;
					session_id: string;
					user_id: string;
				};
				Insert: {
					id?: string;
					muscle_group?: string;
					name: string;
					order_index?: number;
					session_id: string;
					user_id: string;
				};
				Update: {
					id?: string;
					muscle_group?: string;
					name?: string;
					order_index?: number;
					session_id?: string;
					user_id?: string;
				};
				Relationships: [
					{
						foreignKeyName: "exercises_session_id_fkey";
						columns: ["session_id"];
						isOneToOne: false;
						referencedRelation: "workout_sessions";
						referencedColumns: ["id"];
					},
				];
			};
			external_activities: {
				Row: {
					activity_type: string | null;
					avg_heart_rate: number | null;
					calories: number | null;
					distance_meters: number | null;
					duration_seconds: number | null;
					elevation_gain_meters: number | null;
					external_id: string;
					id: string;
					max_heart_rate: number | null;
					name: string;
					provider: string;
					raw_data: Json | null;
					started_at: string;
					synced_at: string | null;
					updated_at: string;
					user_id: string;
				};
				Insert: {
					activity_type?: string | null;
					avg_heart_rate?: number | null;
					calories?: number | null;
					distance_meters?: number | null;
					duration_seconds?: number | null;
					elevation_gain_meters?: number | null;
					external_id: string;
					id?: string;
					max_heart_rate?: number | null;
					name: string;
					provider: string;
					raw_data?: Json | null;
					started_at: string;
					synced_at?: string | null;
					updated_at?: string;
					user_id: string;
				};
				Update: {
					activity_type?: string | null;
					avg_heart_rate?: number | null;
					calories?: number | null;
					distance_meters?: number | null;
					duration_seconds?: number | null;
					elevation_gain_meters?: number | null;
					external_id?: string;
					id?: string;
					max_heart_rate?: number | null;
					name?: string;
					provider?: string;
					raw_data?: Json | null;
					started_at?: string;
					synced_at?: string | null;
					updated_at?: string;
					user_id?: string;
				};
				Relationships: [];
			};
			gamification_stats: {
				Row: {
					best_streak: number;
					current_streak: number;
					id: string;
					longest_streak: number;
					pr_count: number;
					total_reps: number;
					total_time_seconds: number;
					total_volume_kg: number;
					total_workouts: number;
					updated_at: string;
					user_id: string;
				};
				Insert: {
					best_streak?: number;
					current_streak?: number;
					id?: string;
					longest_streak?: number;
					pr_count?: number;
					total_reps?: number;
					total_time_seconds?: number;
					total_volume_kg?: number;
					total_workouts?: number;
					updated_at?: string;
					user_id: string;
				};
				Update: {
					best_streak?: number;
					current_streak?: number;
					id?: string;
					longest_streak?: number;
					pr_count?: number;
					total_reps?: number;
					total_time_seconds?: number;
					total_volume_kg?: number;
					total_workouts?: number;
					updated_at?: string;
					user_id?: string;
				};
				Relationships: [];
			};
			goal_snapshots: {
				Row: {
					current_value: number;
					goal_id: string;
					id: string;
					predicted_completion: string | null;
					progress_pct: number;
					snapshotted_at: string;
					user_id: string;
				};
				Insert: {
					current_value?: number;
					goal_id: string;
					id?: string;
					predicted_completion?: string | null;
					progress_pct?: number;
					snapshotted_at?: string;
					user_id: string;
				};
				Update: {
					current_value?: number;
					goal_id?: string;
					id?: string;
					predicted_completion?: string | null;
					progress_pct?: number;
					snapshotted_at?: string;
					user_id?: string;
				};
				Relationships: [
					{
						foreignKeyName: "goal_snapshots_goal_id_fkey";
						columns: ["goal_id"];
						isOneToOne: false;
						referencedRelation: "user_goals";
						referencedColumns: ["id"];
					},
				];
			};
			leaderboard_events: {
				Row: {
					created_at: string | null;
					description: string | null;
					end_date: string;
					id: string;
					is_active: boolean | null;
					metric: string;
					metric_label: string;
					name: string;
					prize_description: string | null;
					start_date: string;
					updated_at: string | null;
				};
				Insert: {
					created_at?: string | null;
					description?: string | null;
					end_date: string;
					id?: string;
					is_active?: boolean | null;
					metric: string;
					metric_label: string;
					name: string;
					prize_description?: string | null;
					start_date: string;
					updated_at?: string | null;
				};
				Update: {
					created_at?: string | null;
					description?: string | null;
					end_date?: string;
					id?: string;
					is_active?: boolean | null;
					metric?: string;
					metric_label?: string;
					name?: string;
					prize_description?: string | null;
					start_date?: string;
					updated_at?: string | null;
				};
				Relationships: [];
			};
			local_profiles: {
				Row: {
					color_index: number;
					created_at: string;
					device_id: string | null;
					id: string;
					name: string;
					updated_at: string;
					user_id: string;
				};
				Insert: {
					color_index?: number;
					created_at?: string;
					device_id?: string | null;
					id: string;
					name: string;
					updated_at?: string;
					user_id: string;
				};
				Update: {
					color_index?: number;
					created_at?: string;
					device_id?: string | null;
					id?: string;
					name?: string;
					updated_at?: string;
					user_id?: string;
				};
				Relationships: [];
			};
			oauth_states: {
				Row: {
					created_at: string | null;
					expires_at: string;
					id: string;
					provider: string;
					state_token: string;
					user_id: string;
				};
				Insert: {
					created_at?: string | null;
					expires_at: string;
					id?: string;
					provider: string;
					state_token: string;
					user_id: string;
				};
				Update: {
					created_at?: string | null;
					expires_at?: string;
					id?: string;
					provider?: string;
					state_token?: string;
					user_id?: string;
				};
				Relationships: [];
			};
			oauth_tokens: {
				Row: {
					access_token: string | null;
					api_key: string | null;
					created_at: string | null;
					id: string;
					provider: string;
					refresh_token: string | null;
					token_expires_at: string | null;
					updated_at: string | null;
					user_id: string;
				};
				Insert: {
					access_token?: string | null;
					api_key?: string | null;
					created_at?: string | null;
					id?: string;
					provider: string;
					refresh_token?: string | null;
					token_expires_at?: string | null;
					updated_at?: string | null;
					user_id: string;
				};
				Update: {
					access_token?: string | null;
					api_key?: string | null;
					created_at?: string | null;
					id?: string;
					provider?: string;
					refresh_token?: string | null;
					token_expires_at?: string | null;
					updated_at?: string | null;
					user_id?: string;
				};
				Relationships: [];
			};
			overload_suggestions: {
				Row: {
					confidence: number;
					created_at: string;
					current_value: number;
					exercise_name: string;
					expires_at: string;
					id: string;
					rationale: string;
					suggested_value: number;
					suggestion_type: string;
					user_id: string;
				};
				Insert: {
					confidence: number;
					created_at?: string;
					current_value: number;
					exercise_name: string;
					expires_at?: string;
					id?: string;
					rationale: string;
					suggested_value: number;
					suggestion_type: string;
					user_id: string;
				};
				Update: {
					confidence?: number;
					created_at?: string;
					current_value?: number;
					exercise_name?: string;
					expires_at?: string;
					id?: string;
					rationale?: string;
					suggested_value?: number;
					suggestion_type?: string;
					user_id?: string;
				};
				Relationships: [];
			};
			personal_records: {
				Row: {
					achieved_at: string;
					exercise_name: string;
					id: string;
					local_profile_id: string | null;
					muscle_group: string;
					previous_value: number | null;
					record_type: string;
					reps: number | null;
					session_id: string | null;
					unit: string;
					updated_at: string;
					user_id: string;
					value: number;
					weight_kg: number | null;
					workout_phase: string | null;
				};
				Insert: {
					achieved_at?: string;
					exercise_name: string;
					id?: string;
					local_profile_id?: string | null;
					muscle_group?: string;
					previous_value?: number | null;
					record_type?: string;
					reps?: number | null;
					session_id?: string | null;
					unit?: string;
					updated_at?: string;
					user_id: string;
					value: number;
					weight_kg?: number | null;
					workout_phase?: string | null;
				};
				Update: {
					achieved_at?: string;
					exercise_name?: string;
					id?: string;
					local_profile_id?: string | null;
					muscle_group?: string;
					previous_value?: number | null;
					record_type?: string;
					reps?: number | null;
					session_id?: string | null;
					unit?: string;
					updated_at?: string;
					user_id?: string;
					value?: number;
					weight_kg?: number | null;
					workout_phase?: string | null;
				};
				Relationships: [
					{
						foreignKeyName: "fk_personal_records_profile";
						columns: ["user_id", "local_profile_id"];
						isOneToOne: false;
						referencedRelation: "local_profiles";
						referencedColumns: ["user_id", "id"];
					},
					{
						foreignKeyName: "personal_records_session_id_fkey";
						columns: ["session_id"];
						isOneToOne: false;
						referencedRelation: "workout_sessions";
						referencedColumns: ["id"];
					},
				];
			};
			profiles: {
				Row: {
					avatar_url: string | null;
					challenge_updates: boolean;
					created_at: string | null;
					digest_frequency: string | null;
					digest_last_sent_at: string | null;
					display_name: string | null;
					email_digests: boolean;
					feature_flags: Json | null;
					id: string;
					leaderboard_participation: boolean;
					profile_visible: boolean;
					push_notifications: boolean;
					streak_reminders: boolean;
					stripe_customer_id: string | null;
					updated_at: string | null;
					user_id: string | null;
					weight_unit: string;
				};
				Insert: {
					avatar_url?: string | null;
					challenge_updates?: boolean;
					created_at?: string | null;
					digest_frequency?: string | null;
					digest_last_sent_at?: string | null;
					display_name?: string | null;
					email_digests?: boolean;
					feature_flags?: Json | null;
					id: string;
					leaderboard_participation?: boolean;
					profile_visible?: boolean;
					push_notifications?: boolean;
					streak_reminders?: boolean;
					stripe_customer_id?: string | null;
					updated_at?: string | null;
					user_id?: string | null;
					weight_unit?: string;
				};
				Update: {
					avatar_url?: string | null;
					challenge_updates?: boolean;
					created_at?: string | null;
					digest_frequency?: string | null;
					digest_last_sent_at?: string | null;
					display_name?: string | null;
					email_digests?: boolean;
					feature_flags?: Json | null;
					id?: string;
					leaderboard_participation?: boolean;
					profile_visible?: boolean;
					push_notifications?: boolean;
					streak_reminders?: boolean;
					stripe_customer_id?: string | null;
					updated_at?: string | null;
					user_id?: string | null;
					weight_unit?: string;
				};
				Relationships: [];
			};
			rate_limit_tracking: {
				Row: {
					id: string;
					key: string | null;
					last_request_at: string | null;
					last_reset_at: string | null;
					provider: string;
					requests_this_window: number | null;
					user_id: string | null;
					window_started_at: string | null;
				};
				Insert: {
					id?: string;
					key?: string | null;
					last_request_at?: string | null;
					last_reset_at?: string | null;
					provider: string;
					requests_this_window?: number | null;
					user_id?: string | null;
					window_started_at?: string | null;
				};
				Update: {
					id?: string;
					key?: string | null;
					last_request_at?: string | null;
					last_reset_at?: string | null;
					provider?: string;
					requests_this_window?: number | null;
					user_id?: string | null;
					window_started_at?: string | null;
				};
				Relationships: [];
			};
			rep_summaries: {
				Row: {
					asymmetry_pct: number | null;
					id: string;
					left_force_avg: number | null;
					mean_force_n: number | null;
					mean_velocity_mps: number | null;
					peak_force_n: number | null;
					peak_velocity_mps: number | null;
					power_watts: number | null;
					rep_number: number;
					right_force_avg: number | null;
					rom_mm: number | null;
					set_id: string;
					tut_ms: number | null;
					user_id: string;
					vbt_zone: string | null;
				};
				Insert: {
					asymmetry_pct?: number | null;
					id?: string;
					left_force_avg?: number | null;
					mean_force_n?: number | null;
					mean_velocity_mps?: number | null;
					peak_force_n?: number | null;
					peak_velocity_mps?: number | null;
					power_watts?: number | null;
					rep_number: number;
					right_force_avg?: number | null;
					rom_mm?: number | null;
					set_id: string;
					tut_ms?: number | null;
					user_id: string;
					vbt_zone?: string | null;
				};
				Update: {
					asymmetry_pct?: number | null;
					id?: string;
					left_force_avg?: number | null;
					mean_force_n?: number | null;
					mean_velocity_mps?: number | null;
					peak_force_n?: number | null;
					peak_velocity_mps?: number | null;
					power_watts?: number | null;
					rep_number?: number;
					right_force_avg?: number | null;
					rom_mm?: number | null;
					set_id?: string;
					tut_ms?: number | null;
					user_id?: string;
					vbt_zone?: string | null;
				};
				Relationships: [
					{
						foreignKeyName: "rep_summaries_set_id_fkey";
						columns: ["set_id"];
						isOneToOne: false;
						referencedRelation: "sets";
						referencedColumns: ["id"];
					},
				];
			};
			rep_telemetry: {
				Row: {
					cable: string | null;
					force_n: number | null;
					id: string;
					position_mm: number | null;
					set_id: string;
					timestamp_ms: number;
					user_id: string;
					velocity_mps: number | null;
				};
				Insert: {
					cable?: string | null;
					force_n?: number | null;
					id?: string;
					position_mm?: number | null;
					set_id: string;
					timestamp_ms: number;
					user_id: string;
					velocity_mps?: number | null;
				};
				Update: {
					cable?: string | null;
					force_n?: number | null;
					id?: string;
					position_mm?: number | null;
					set_id?: string;
					timestamp_ms?: number;
					user_id?: string;
					velocity_mps?: number | null;
				};
				Relationships: [
					{
						foreignKeyName: "rep_telemetry_set_id_fkey";
						columns: ["set_id"];
						isOneToOne: false;
						referencedRelation: "sets";
						referencedColumns: ["id"];
					},
				];
			};
			routine_exercises: {
				Row: {
					created_at: string;
					duration_seconds: number | null;
					eccentric_load: string | null;
					echo_level: string | null;
					id: string;
					is_amrap: boolean | null;
					is_bodyweight: boolean;
					mode: string;
					muscle_group: string;
					name: string;
					order_index: number;
					per_set_echo_levels: Json | null;
					per_set_reps: Json | null;
					per_set_rest: Json | null;
					per_set_weights: Json | null;
					pr_percentage: number | null;
					rep_count_timing: string | null;
					reps: number;
					rest_seconds: number;
					routine_id: string;
					sets: number;
					stall_detection: boolean | null;
					stop_at_position: string | null;
					superset_color: string | null;
					superset_id: string | null;
					superset_order: number | null;
					warmup_sets: string | null;
					weight: number;
				};
				Insert: {
					created_at?: string;
					duration_seconds?: number | null;
					eccentric_load?: string | null;
					echo_level?: string | null;
					id?: string;
					is_amrap?: boolean | null;
					is_bodyweight?: boolean;
					mode?: string;
					muscle_group?: string;
					name: string;
					order_index?: number;
					per_set_echo_levels?: Json | null;
					per_set_reps?: Json | null;
					per_set_rest?: Json | null;
					per_set_weights?: Json | null;
					pr_percentage?: number | null;
					rep_count_timing?: string | null;
					reps?: number;
					rest_seconds?: number;
					routine_id: string;
					sets?: number;
					stall_detection?: boolean | null;
					stop_at_position?: string | null;
					superset_color?: string | null;
					superset_id?: string | null;
					superset_order?: number | null;
					warmup_sets?: string | null;
					weight?: number;
				};
				Update: {
					created_at?: string;
					duration_seconds?: number | null;
					eccentric_load?: string | null;
					echo_level?: string | null;
					id?: string;
					is_amrap?: boolean | null;
					is_bodyweight?: boolean;
					mode?: string;
					muscle_group?: string;
					name?: string;
					order_index?: number;
					per_set_echo_levels?: Json | null;
					per_set_reps?: Json | null;
					per_set_rest?: Json | null;
					per_set_weights?: Json | null;
					pr_percentage?: number | null;
					rep_count_timing?: string | null;
					reps?: number;
					rest_seconds?: number;
					routine_id?: string;
					sets?: number;
					stall_detection?: boolean | null;
					stop_at_position?: string | null;
					superset_color?: string | null;
					superset_id?: string | null;
					superset_order?: number | null;
					warmup_sets?: string | null;
					weight?: number;
				};
				Relationships: [
					{
						foreignKeyName: "routine_exercises_routine_id_fkey";
						columns: ["routine_id"];
						isOneToOne: false;
						referencedRelation: "routines";
						referencedColumns: ["id"];
					},
				];
			};
			routines: {
				Row: {
					created_at: string;
					description: string;
					estimated_duration: number;
					exercise_count: number;
					id: string;
					is_favorite: boolean;
					last_used_at: string | null;
					local_profile_id: string | null;
					name: string;
					tags: string[] | null;
					times_completed: number;
					updated_at: string;
					user_id: string;
				};
				Insert: {
					created_at?: string;
					description?: string;
					estimated_duration?: number;
					exercise_count?: number;
					id?: string;
					is_favorite?: boolean;
					last_used_at?: string | null;
					local_profile_id?: string | null;
					name: string;
					tags?: string[] | null;
					times_completed?: number;
					updated_at?: string;
					user_id: string;
				};
				Update: {
					created_at?: string;
					description?: string;
					estimated_duration?: number;
					exercise_count?: number;
					id?: string;
					is_favorite?: boolean;
					last_used_at?: string | null;
					local_profile_id?: string | null;
					name?: string;
					tags?: string[] | null;
					times_completed?: number;
					updated_at?: string;
					user_id?: string;
				};
				Relationships: [
					{
						foreignKeyName: "fk_routines_profile";
						columns: ["user_id", "local_profile_id"];
						isOneToOne: false;
						referencedRelation: "local_profiles";
						referencedColumns: ["user_id", "id"];
					},
				];
			};
			rpg_attributes: {
				Row: {
					character_class: string | null;
					consistency: number;
					experience_points: number;
					id: string;
					level: number;
					mastery: number;
					power: number;
					stamina: number;
					strength: number;
					updated_at: string;
					user_id: string;
				};
				Insert: {
					character_class?: string | null;
					consistency?: number;
					experience_points?: number;
					id?: string;
					level?: number;
					mastery?: number;
					power?: number;
					stamina?: number;
					strength?: number;
					updated_at?: string;
					user_id: string;
				};
				Update: {
					character_class?: string | null;
					consistency?: number;
					experience_points?: number;
					id?: string;
					level?: number;
					mastery?: number;
					power?: number;
					stamina?: number;
					strength?: number;
					updated_at?: string;
					user_id?: string;
				};
				Relationships: [];
			};
			saved_community_items: {
				Row: {
					id: string;
					item_type: string;
					saved_at: string;
					shared_item_id: string;
					user_id: string;
				};
				Insert: {
					id?: string;
					item_type: string;
					saved_at?: string;
					shared_item_id: string;
					user_id: string;
				};
				Update: {
					id?: string;
					item_type?: string;
					saved_at?: string;
					shared_item_id?: string;
					user_id?: string;
				};
				Relationships: [];
			};
			session_phase_statistics: {
				Row: {
					concentric_kg_avg: number | null;
					concentric_kg_max: number | null;
					concentric_vel_avg: number | null;
					concentric_vel_max: number | null;
					concentric_watt_avg: number | null;
					concentric_watt_max: number | null;
					created_at: string | null;
					eccentric_kg_avg: number | null;
					eccentric_kg_max: number | null;
					eccentric_vel_avg: number | null;
					eccentric_vel_max: number | null;
					eccentric_watt_avg: number | null;
					eccentric_watt_max: number | null;
					id: string;
					session_id: string;
					user_id: string;
				};
				Insert: {
					concentric_kg_avg?: number | null;
					concentric_kg_max?: number | null;
					concentric_vel_avg?: number | null;
					concentric_vel_max?: number | null;
					concentric_watt_avg?: number | null;
					concentric_watt_max?: number | null;
					created_at?: string | null;
					eccentric_kg_avg?: number | null;
					eccentric_kg_max?: number | null;
					eccentric_vel_avg?: number | null;
					eccentric_vel_max?: number | null;
					eccentric_watt_avg?: number | null;
					eccentric_watt_max?: number | null;
					id?: string;
					session_id: string;
					user_id: string;
				};
				Update: {
					concentric_kg_avg?: number | null;
					concentric_kg_max?: number | null;
					concentric_vel_avg?: number | null;
					concentric_vel_max?: number | null;
					concentric_watt_avg?: number | null;
					concentric_watt_max?: number | null;
					created_at?: string | null;
					eccentric_kg_avg?: number | null;
					eccentric_kg_max?: number | null;
					eccentric_vel_avg?: number | null;
					eccentric_vel_max?: number | null;
					eccentric_watt_avg?: number | null;
					eccentric_watt_max?: number | null;
					id?: string;
					session_id?: string;
					user_id?: string;
				};
				Relationships: [
					{
						foreignKeyName: "session_phase_statistics_session_id_fkey";
						columns: ["session_id"];
						isOneToOne: true;
						referencedRelation: "workout_sessions";
						referencedColumns: ["id"];
					},
				];
			};
			sets: {
				Row: {
					actual_reps: number;
					exercise_id: string;
					id: string;
					is_pr: boolean;
					notes: string | null;
					rpe: number | null;
					set_number: number;
					target_reps: number | null;
					user_id: string;
					weight_kg: number;
					workout_mode: string | null;
				};
				Insert: {
					actual_reps?: number;
					exercise_id: string;
					id?: string;
					is_pr?: boolean;
					notes?: string | null;
					rpe?: number | null;
					set_number: number;
					target_reps?: number | null;
					user_id: string;
					weight_kg?: number;
					workout_mode?: string | null;
				};
				Update: {
					actual_reps?: number;
					exercise_id?: string;
					id?: string;
					is_pr?: boolean;
					notes?: string | null;
					rpe?: number | null;
					set_number?: number;
					target_reps?: number | null;
					user_id?: string;
					weight_kg?: number;
					workout_mode?: string | null;
				};
				Relationships: [
					{
						foreignKeyName: "sets_exercise_id_fkey";
						columns: ["exercise_id"];
						isOneToOne: false;
						referencedRelation: "exercises";
						referencedColumns: ["id"];
					},
				];
			};
			shared_cycles: {
				Row: {
					comment_count: number;
					cycle_id: string;
					description: string;
					difficulty: string;
					duration_weeks: number;
					hot_score: number;
					id: string;
					name: string;
					save_count: number;
					shared_at: string;
					tags: string[];
					updated_at: string;
					user_id: string | null;
					vote_count: number;
				};
				Insert: {
					comment_count?: number;
					cycle_id: string;
					description?: string;
					difficulty?: string;
					duration_weeks?: number;
					hot_score?: number;
					id?: string;
					name: string;
					save_count?: number;
					shared_at?: string;
					tags?: string[];
					updated_at?: string;
					user_id?: string | null;
					vote_count?: number;
				};
				Update: {
					comment_count?: number;
					cycle_id?: string;
					description?: string;
					difficulty?: string;
					duration_weeks?: number;
					hot_score?: number;
					id?: string;
					name?: string;
					save_count?: number;
					shared_at?: string;
					tags?: string[];
					updated_at?: string;
					user_id?: string | null;
					vote_count?: number;
				};
				Relationships: [
					{
						foreignKeyName: "shared_cycles_cycle_id_fkey";
						columns: ["cycle_id"];
						isOneToOne: false;
						referencedRelation: "training_cycles";
						referencedColumns: ["id"];
					},
					{
						foreignKeyName: "shared_cycles_user_id_profiles_fkey";
						columns: ["user_id"];
						isOneToOne: false;
						referencedRelation: "creator_stats";
						referencedColumns: ["user_id"];
					},
					{
						foreignKeyName: "shared_cycles_user_id_profiles_fkey";
						columns: ["user_id"];
						isOneToOne: false;
						referencedRelation: "profiles";
						referencedColumns: ["id"];
					},
				];
			};
			shared_routines: {
				Row: {
					comment_count: number;
					description: string;
					difficulty: string;
					estimated_duration: number;
					exercise_count: number;
					exercises_snapshot: Json | null;
					hot_score: number;
					id: string;
					name: string;
					routine_id: string;
					save_count: number;
					shared_at: string;
					tags: string[];
					updated_at: string;
					user_id: string | null;
					vote_count: number;
				};
				Insert: {
					comment_count?: number;
					description?: string;
					difficulty?: string;
					estimated_duration?: number;
					exercise_count?: number;
					exercises_snapshot?: Json | null;
					hot_score?: number;
					id?: string;
					name: string;
					routine_id: string;
					save_count?: number;
					shared_at?: string;
					tags?: string[];
					updated_at?: string;
					user_id?: string | null;
					vote_count?: number;
				};
				Update: {
					comment_count?: number;
					description?: string;
					difficulty?: string;
					estimated_duration?: number;
					exercise_count?: number;
					exercises_snapshot?: Json | null;
					hot_score?: number;
					id?: string;
					name?: string;
					routine_id?: string;
					save_count?: number;
					shared_at?: string;
					tags?: string[];
					updated_at?: string;
					user_id?: string | null;
					vote_count?: number;
				};
				Relationships: [
					{
						foreignKeyName: "shared_routines_routine_id_fkey";
						columns: ["routine_id"];
						isOneToOne: false;
						referencedRelation: "routines";
						referencedColumns: ["id"];
					},
					{
						foreignKeyName: "shared_routines_user_id_profiles_fkey";
						columns: ["user_id"];
						isOneToOne: false;
						referencedRelation: "creator_stats";
						referencedColumns: ["user_id"];
					},
					{
						foreignKeyName: "shared_routines_user_id_profiles_fkey";
						columns: ["user_id"];
						isOneToOne: false;
						referencedRelation: "profiles";
						referencedColumns: ["id"];
					},
				];
			};
			subscriptions: {
				Row: {
					cancel_at_period_end: boolean | null;
					created_at: string | null;
					current_period_end: string;
					current_period_start: string | null;
					environment: string | null;
					id: string;
					last_event_id: string | null;
					paddle_customer_id: string | null;
					paddle_subscription_id: string | null;
					price_id: string | null;
					status: string;
					tier: string;
					updated_at: string | null;
					user_id: string;
				};
				Insert: {
					cancel_at_period_end?: boolean | null;
					created_at?: string | null;
					current_period_end: string;
					current_period_start?: string | null;
					environment?: string | null;
					id?: string;
					last_event_id?: string | null;
					paddle_customer_id?: string | null;
					paddle_subscription_id?: string | null;
					price_id?: string | null;
					status: string;
					tier: string;
					updated_at?: string | null;
					user_id: string;
				};
				Update: {
					cancel_at_period_end?: boolean | null;
					created_at?: string | null;
					current_period_end?: string;
					current_period_start?: string | null;
					environment?: string | null;
					id?: string;
					last_event_id?: string | null;
					paddle_customer_id?: string | null;
					paddle_subscription_id?: string | null;
					price_id?: string | null;
					status?: string;
					tier?: string;
					updated_at?: string | null;
					user_id?: string;
				};
				Relationships: [];
			};
			sync_queue: {
				Row: {
					completed_at: string | null;
					created_at: string | null;
					error_message: string | null;
					id: string;
					provider: string;
					retry_count: number | null;
					started_at: string | null;
					status: string | null;
					sync_type: string | null;
					user_id: string;
				};
				Insert: {
					completed_at?: string | null;
					created_at?: string | null;
					error_message?: string | null;
					id?: string;
					provider: string;
					retry_count?: number | null;
					started_at?: string | null;
					status?: string | null;
					sync_type?: string | null;
					user_id: string;
				};
				Update: {
					completed_at?: string | null;
					created_at?: string | null;
					error_message?: string | null;
					id?: string;
					provider?: string;
					retry_count?: number | null;
					started_at?: string | null;
					status?: string | null;
					sync_type?: string | null;
					user_id?: string;
				};
				Relationships: [];
			};
			telemetry_analysis: {
				Row: {
					analysis_type: string;
					computed_at: string;
					id: string;
					result: Json;
					set_id: string;
					user_id: string;
					worker_version: string | null;
				};
				Insert: {
					analysis_type: string;
					computed_at?: string;
					id?: string;
					result: Json;
					set_id: string;
					user_id: string;
					worker_version?: string | null;
				};
				Update: {
					analysis_type?: string;
					computed_at?: string;
					id?: string;
					result?: Json;
					set_id?: string;
					user_id?: string;
					worker_version?: string | null;
				};
				Relationships: [];
			};
			training_cycles: {
				Row: {
					current_week: number;
					deload_settings: Json | null;
					description: string | null;
					duration_weeks: number;
					id: string;
					last_used_at: string | null;
					local_profile_id: string | null;
					name: string;
					progression_settings: Json | null;
					rest_days: number;
					started_at: string | null;
					status: string;
					updated_at: string;
					user_id: string;
					workout_days: number;
				};
				Insert: {
					current_week?: number;
					deload_settings?: Json | null;
					description?: string | null;
					duration_weeks?: number;
					id?: string;
					last_used_at?: string | null;
					local_profile_id?: string | null;
					name: string;
					progression_settings?: Json | null;
					rest_days?: number;
					started_at?: string | null;
					status?: string;
					updated_at?: string;
					user_id: string;
					workout_days?: number;
				};
				Update: {
					current_week?: number;
					deload_settings?: Json | null;
					description?: string | null;
					duration_weeks?: number;
					id?: string;
					last_used_at?: string | null;
					local_profile_id?: string | null;
					name?: string;
					progression_settings?: Json | null;
					rest_days?: number;
					started_at?: string | null;
					status?: string;
					updated_at?: string;
					user_id?: string;
					workout_days?: number;
				};
				Relationships: [
					{
						foreignKeyName: "fk_training_cycles_profile";
						columns: ["user_id", "local_profile_id"];
						isOneToOne: false;
						referencedRelation: "local_profiles";
						referencedColumns: ["user_id", "id"];
					},
				];
			};
			user_blocks: {
				Row: {
					blocked_id: string;
					blocker_id: string;
					created_at: string;
					id: string;
				};
				Insert: {
					blocked_id: string;
					blocker_id: string;
					created_at?: string;
					id?: string;
				};
				Update: {
					blocked_id?: string;
					blocker_id?: string;
					created_at?: string;
					id?: string;
				};
				Relationships: [];
			};
			user_goals: {
				Row: {
					completed_at: string | null;
					created_at: string;
					deadline: string | null;
					exercise_name: string | null;
					goal_type: string;
					id: string;
					last_snapshot_at: string | null;
					period: string;
					predicted_completion_date: string | null;
					status: string;
					target_unit: string;
					target_value: number;
					updated_at: string;
					user_id: string;
				};
				Insert: {
					completed_at?: string | null;
					created_at?: string;
					deadline?: string | null;
					exercise_name?: string | null;
					goal_type: string;
					id?: string;
					last_snapshot_at?: string | null;
					period?: string;
					predicted_completion_date?: string | null;
					status?: string;
					target_unit: string;
					target_value: number;
					updated_at?: string;
					user_id: string;
				};
				Update: {
					completed_at?: string | null;
					created_at?: string;
					deadline?: string | null;
					exercise_name?: string | null;
					goal_type?: string;
					id?: string;
					last_snapshot_at?: string | null;
					period?: string;
					predicted_completion_date?: string | null;
					status?: string;
					target_unit?: string;
					target_value?: number;
					updated_at?: string;
					user_id?: string;
				};
				Relationships: [];
			};
			user_insights: {
				Row: {
					created_at: string | null;
					description: string;
					expires_at: string | null;
					id: string;
					insight_type: string;
					metric_delta: number | null;
					metric_name: string | null;
					metric_unit: string | null;
					metric_value: number | null;
					period: string;
					recommendation: string | null;
					title: string;
					user_id: string;
				};
				Insert: {
					created_at?: string | null;
					description: string;
					expires_at?: string | null;
					id?: string;
					insight_type: string;
					metric_delta?: number | null;
					metric_name?: string | null;
					metric_unit?: string | null;
					metric_value?: number | null;
					period?: string;
					recommendation?: string | null;
					title: string;
					user_id: string;
				};
				Update: {
					created_at?: string | null;
					description?: string;
					expires_at?: string | null;
					id?: string;
					insight_type?: string;
					metric_delta?: number | null;
					metric_name?: string | null;
					metric_unit?: string | null;
					metric_value?: number | null;
					period?: string;
					recommendation?: string | null;
					title?: string;
					user_id?: string;
				};
				Relationships: [];
			};
			user_integrations: {
				Row: {
					connected_at: string | null;
					error_message: string | null;
					id: string;
					last_sync_at: string | null;
					provider: string;
					provider_user_id: string | null;
					status: string | null;
					user_id: string;
				};
				Insert: {
					connected_at?: string | null;
					error_message?: string | null;
					id?: string;
					last_sync_at?: string | null;
					provider: string;
					provider_user_id?: string | null;
					status?: string | null;
					user_id: string;
				};
				Update: {
					connected_at?: string | null;
					error_message?: string | null;
					id?: string;
					last_sync_at?: string | null;
					provider?: string;
					provider_user_id?: string | null;
					status?: string | null;
					user_id?: string;
				};
				Relationships: [];
			};
			user_onboarding: {
				Row: {
					completed_at: string | null;
					created_at: string;
					dismissed_hints: Json;
					dismissed_whats_new: boolean;
					id: string;
					user_id: string;
					version_seen: string | null;
				};
				Insert: {
					completed_at?: string | null;
					created_at?: string;
					dismissed_hints?: Json;
					dismissed_whats_new?: boolean;
					id?: string;
					user_id: string;
					version_seen?: string | null;
				};
				Update: {
					completed_at?: string | null;
					created_at?: string;
					dismissed_hints?: Json;
					dismissed_whats_new?: boolean;
					id?: string;
					user_id?: string;
					version_seen?: string | null;
				};
				Relationships: [];
			};
			vbt_assessments: {
				Row: {
					assessment_session_id: string | null;
					created_at: string | null;
					estimated_1rm_kg: number;
					exercise_id: string;
					id: string;
					load_velocity_data: Json | null;
					user_id: string;
					user_override_kg: number | null;
				};
				Insert: {
					assessment_session_id?: string | null;
					created_at?: string | null;
					estimated_1rm_kg: number;
					exercise_id: string;
					id?: string;
					load_velocity_data?: Json | null;
					user_id: string;
					user_override_kg?: number | null;
				};
				Update: {
					assessment_session_id?: string | null;
					created_at?: string | null;
					estimated_1rm_kg?: number;
					exercise_id?: string;
					id?: string;
					load_velocity_data?: Json | null;
					user_id?: string;
					user_override_kg?: number | null;
				};
				Relationships: [];
			};
			wearable_daily_summaries: {
				Row: {
					awake_minutes: number | null;
					body_battery: number | null;
					created_at: string;
					deep_sleep_minutes: number | null;
					hr_zones: Json | null;
					hrv_ms: number | null;
					id: string;
					light_sleep_minutes: number | null;
					provider: string;
					rem_sleep_minutes: number | null;
					resting_hr: number | null;
					sleep_duration_minutes: number | null;
					sleep_score: number | null;
					stress_score: number | null;
					summary_date: string;
					user_id: string;
				};
				Insert: {
					awake_minutes?: number | null;
					body_battery?: number | null;
					created_at?: string;
					deep_sleep_minutes?: number | null;
					hr_zones?: Json | null;
					hrv_ms?: number | null;
					id?: string;
					light_sleep_minutes?: number | null;
					provider: string;
					rem_sleep_minutes?: number | null;
					resting_hr?: number | null;
					sleep_duration_minutes?: number | null;
					sleep_score?: number | null;
					stress_score?: number | null;
					summary_date: string;
					user_id: string;
				};
				Update: {
					awake_minutes?: number | null;
					body_battery?: number | null;
					created_at?: string;
					deep_sleep_minutes?: number | null;
					hr_zones?: Json | null;
					hrv_ms?: number | null;
					id?: string;
					light_sleep_minutes?: number | null;
					provider?: string;
					rem_sleep_minutes?: number | null;
					resting_hr?: number | null;
					sleep_duration_minutes?: number | null;
					sleep_score?: number | null;
					stress_score?: number | null;
					summary_date?: string;
					user_id?: string;
				};
				Relationships: [];
			};
			workout_sessions: {
				Row: {
					avg_asymmetry_pct: number | null;
					avg_velocity_mps: number | null;
					deload_warnings: number | null;
					dominant_side: string | null;
					duration_seconds: number;
					eccentric_load: number | null;
					echo_level: number | null;
					estimated_calories: number | null;
					exercise_count: number;
					form_score: number | null;
					heaviest_lift_kg: number | null;
					id: string;
					local_profile_id: string | null;
					name: string | null;
					notes: string | null;
					peak_force_n: number | null;
					pr_count: number;
					rom_violations: number | null;
					routine_name: string | null;
					routine_session_id: string | null;
					set_count: number;
					spotter_activations: number | null;
					started_at: string;
					strength_profile: string | null;
					total_volume: number;
					updated_at: string | null;
					user_id: string;
					velocity_loss_pct: number | null;
					warmup_reps: number | null;
					working_reps: number | null;
					workout_mode: string | null;
				};
				Insert: {
					avg_asymmetry_pct?: number | null;
					avg_velocity_mps?: number | null;
					deload_warnings?: number | null;
					dominant_side?: string | null;
					duration_seconds?: number;
					eccentric_load?: number | null;
					echo_level?: number | null;
					estimated_calories?: number | null;
					exercise_count?: number;
					form_score?: number | null;
					heaviest_lift_kg?: number | null;
					id?: string;
					local_profile_id?: string | null;
					name?: string | null;
					notes?: string | null;
					peak_force_n?: number | null;
					pr_count?: number;
					rom_violations?: number | null;
					routine_name?: string | null;
					routine_session_id?: string | null;
					set_count?: number;
					spotter_activations?: number | null;
					started_at?: string;
					strength_profile?: string | null;
					total_volume?: number;
					updated_at?: string | null;
					user_id: string;
					velocity_loss_pct?: number | null;
					warmup_reps?: number | null;
					working_reps?: number | null;
					workout_mode?: string | null;
				};
				Update: {
					avg_asymmetry_pct?: number | null;
					avg_velocity_mps?: number | null;
					deload_warnings?: number | null;
					dominant_side?: string | null;
					duration_seconds?: number;
					eccentric_load?: number | null;
					echo_level?: number | null;
					estimated_calories?: number | null;
					exercise_count?: number;
					form_score?: number | null;
					heaviest_lift_kg?: number | null;
					id?: string;
					local_profile_id?: string | null;
					name?: string | null;
					notes?: string | null;
					peak_force_n?: number | null;
					pr_count?: number;
					rom_violations?: number | null;
					routine_name?: string | null;
					routine_session_id?: string | null;
					set_count?: number;
					spotter_activations?: number | null;
					started_at?: string;
					strength_profile?: string | null;
					total_volume?: number;
					updated_at?: string | null;
					user_id?: string;
					velocity_loss_pct?: number | null;
					warmup_reps?: number | null;
					working_reps?: number | null;
					workout_mode?: string | null;
				};
				Relationships: [
					{
						foreignKeyName: "fk_workout_sessions_profile";
						columns: ["user_id", "local_profile_id"];
						isOneToOne: false;
						referencedRelation: "local_profiles";
						referencedColumns: ["user_id", "id"];
					},
				];
			};
		};
		Views: {
			creator_stats: {
				Row: {
					avatar_url: string | null;
					display_name: string | null;
					featured_count: number | null;
					total_shares: number | null;
					total_upvotes: number | null;
					user_id: string | null;
				};
				Relationships: [];
			};
			telemetry_points: {
				Row: {
					cable: string | null;
					force_n: number | null;
					id: string | null;
					position_mm: number | null;
					set_id: string | null;
					timestamp_ms: number | null;
					user_id: string | null;
					velocity_mps: number | null;
				};
				Insert: {
					cable?: string | null;
					force_n?: number | null;
					id?: string | null;
					position_mm?: number | null;
					set_id?: string | null;
					timestamp_ms?: number | null;
					user_id?: string | null;
					velocity_mps?: number | null;
				};
				Update: {
					cable?: string | null;
					force_n?: number | null;
					id?: string | null;
					position_mm?: number | null;
					set_id?: string | null;
					timestamp_ms?: number | null;
					user_id?: string | null;
					velocity_mps?: number | null;
				};
				Relationships: [
					{
						foreignKeyName: "rep_telemetry_set_id_fkey";
						columns: ["set_id"];
						isOneToOne: false;
						referencedRelation: "sets";
						referencedColumns: ["id"];
					},
				];
			};
		};
		Functions: {
			check_rate_limit: {
				Args: {
					p_key: string;
					p_max_requests: number;
					p_user_id: string;
					p_window_seconds: number;
				};
				Returns: {
					allowed: boolean;
					remaining: number;
					retry_after_seconds: number;
				}[];
			};
			detect_plateaus: {
				Args: {
					p_profile_id?: string;
					p_user_id: string;
					p_variance_threshold?: number;
					p_window_sessions?: number;
				};
				Returns: {
					coefficient_of_variation: number;
					exercise_name: string;
					is_plateau: boolean;
					recent_avg: number;
					recent_stddev: number;
					session_count: number;
				}[];
			};
			get_acwr: {
				Args: {
					p_acute_days?: number;
					p_chronic_days?: number;
					p_user_id: string;
				};
				Returns: {
					acute_load: number;
					acwr: number;
					calc_date: string;
					chronic_load: number;
					risk_zone: string;
				}[];
			};
			get_badges_excluding_ids: {
				Args: {
					p_cursor_earned_at?: string;
					p_cursor_id?: number;
					p_known_ids?: number[];
					p_limit?: number;
					p_user_id: string;
				};
				Returns: {
					badge_description: string;
					badge_id: string;
					badge_name: string;
					badge_tier: string;
					earned_at: string;
					id: number;
					user_id: string;
				}[];
			};
			get_cycles_excluding_ids: {
				Args: {
					p_cursor_id?: string;
					p_cursor_updated_at?: string;
					p_known_ids?: string[];
					p_limit?: number;
					p_profile_id?: string;
					p_user_id: string;
				};
				Returns: {
					current_week: number;
					deload_settings: Json;
					description: string;
					duration_weeks: number;
					id: string;
					last_used_at: string;
					local_profile_id: string;
					name: string;
					progression_settings: Json;
					rest_days: number;
					started_at: string;
					status: string;
					updated_at: string;
					user_id: string;
					workout_days: number;
				}[];
			};
			get_exercise_mastery_rankings: {
				Args: { result_limit?: number };
				Returns: {
					mastered_count: number;
					rank: number;
					user_id: string;
				}[];
			};
			get_exercise_trend: {
				Args: {
					p_exercise_name: string;
					p_lookback_days?: number;
					p_profile_id?: string;
					p_user_id: string;
				};
				Returns: {
					data_points: number;
					r_squared: number;
					trend_direction: string;
					trend_slope: number;
					weekly_gain: number;
				}[];
			};
			get_goal_progress_cached: {
				Args: { p_user_id: string };
				Returns: {
					current_value: number;
					deadline: string;
					exercise_name: string;
					goal_id: string;
					goal_type: string;
					predicted_completion: string;
					progress_pct: number;
					snapshotted_at: string;
					status: string;
					target_unit: string;
					target_value: number;
				}[];
			};
			get_muscle_distribution: {
				Args: { p_profile_id?: string; p_user_id: string };
				Returns: {
					name: string;
					value: number;
				}[];
			};
			get_percentile_rank: {
				Args: {
					p_metric_key?: string;
					p_metric_type: string;
					p_user_id: string;
				};
				Returns: {
					percentile: number;
					rank_description: string;
					user_value: number;
				}[];
			};
			get_personal_records_excluding_ids: {
				Args: {
					p_known_ids?: number[];
					p_profile_id?: string;
					p_user_id: string;
				};
				Returns: {
					achieved_at: string;
					exercise_name: string;
					id: number;
					local_profile_id: string;
					muscle_group: string;
					record_type: string;
					reps: number;
					session_id: string;
					updated_at: string;
					user_id: string;
					value: number;
					weight_kg: number;
					workout_phase: string;
				}[];
			};
			get_pr_count_rankings: {
				Args: { result_limit?: number };
				Returns: {
					pr_count: number;
					rank: number;
					user_id: string;
				}[];
			};
			get_profile_stats: {
				Args: { p_user_id: string };
				Returns: {
					best_streak: number;
					current_streak: number;
					longest_streak: number;
					pr_count: number;
					total_volume_kg: number;
					total_workouts: number;
				}[];
			};
			get_routines_excluding_ids: {
				Args: {
					p_cursor_id?: string;
					p_cursor_updated_at?: string;
					p_known_ids?: string[];
					p_limit?: number;
					p_profile_id?: string;
					p_user_id: string;
				};
				Returns: {
					description: string;
					estimated_duration: number;
					exercise_count: number;
					id: string;
					is_favorite: boolean;
					local_profile_id: string;
					name: string;
					times_completed: number;
					updated_at: string;
					user_id: string;
				}[];
			};
			get_sessions_excluding_ids: {
				Args: {
					p_cursor_id?: string;
					p_cursor_updated_at?: string;
					p_known_ids?: string[];
					p_limit?: number;
					p_profile_id?: string;
					p_user_id: string;
				};
				Returns: {
					avg_asymmetry_pct: number;
					avg_velocity_mps: number;
					deload_warnings: number;
					dominant_side: string;
					duration_seconds: number;
					eccentric_load: number;
					echo_level: number;
					estimated_calories: number;
					exercise_count: number;
					form_score: number;
					heaviest_lift_kg: number;
					id: string;
					local_profile_id: string;
					name: string;
					notes: string;
					peak_force_n: number;
					pr_count: number;
					rom_violations: number;
					routine_name: string;
					routine_session_id: string;
					set_count: number;
					spotter_activations: number;
					started_at: string;
					strength_profile: string;
					total_volume: number;
					updated_at: string;
					user_id: string;
					velocity_loss_pct: number;
					warmup_reps: number;
					working_reps: number;
					workout_mode: string;
				}[];
			};
			get_user_pr_rank: {
				Args: { target_user_id: string };
				Returns: {
					pr_count: number;
					rank: number;
					user_id: string;
				}[];
			};
			get_volume_comparison: {
				Args: { p_days?: number; p_profile_id?: string; p_user_id: string };
				Returns: {
					avg_volume: number;
					period: string;
					session_count: number;
					total_duration: number;
					total_sets: number;
					total_volume: number;
				}[];
			};
			get_volume_rolling_avg: {
				Args: {
					p_lookback_days?: number;
					p_profile_id?: string;
					p_user_id: string;
					p_window_days?: number;
				};
				Returns: {
					daily_volume: number;
					rolling_avg: number;
					workout_date: string;
				}[];
			};
			get_wearable_trends: {
				Args: { p_lookback_days?: number; p_user_id: string };
				Returns: {
					hrv_7d_avg: number;
					hrv_ms: number;
					resting_hr: number;
					resting_hr_7d_avg: number;
					sleep_score: number;
					sleep_score_7d_avg: number;
					summary_date: string;
				}[];
			};
			get_workout_streak: {
				Args: { p_profile_id?: string; p_user_id: string };
				Returns: number;
			};
			refresh_community_benchmarks: { Args: never; Returns: undefined };
			refresh_hot_scores: { Args: never; Returns: undefined };
			upsert_external_activity_lww: {
				Args: { p_rows: Json };
				Returns: {
					accepted: boolean;
					id: string;
					server_updated_at: string;
				}[];
			};
			upsert_gamification_stats_lww: {
				Args: { p_rows: Json };
				Returns: {
					accepted: boolean;
					id: string;
					server_updated_at: string;
				}[];
			};
			upsert_routine_lww: {
				Args: { p_rows: Json };
				Returns: {
					accepted: boolean;
					id: string;
					server_updated_at: string;
				}[];
			};
			upsert_rpg_attributes_lww: {
				Args: { p_rows: Json };
				Returns: {
					accepted: boolean;
					id: string;
					server_updated_at: string;
				}[];
			};
			upsert_training_cycle_lww: {
				Args: { p_rows: Json };
				Returns: {
					accepted: boolean;
					id: string;
					server_updated_at: string;
				}[];
			};
			upsert_workout_session_lww: {
				Args: { p_rows: Json };
				Returns: {
					accepted: boolean;
					id: string;
					server_updated_at: string;
				}[];
			};
			user_subscription_tier: { Args: never; Returns: string };
		};
		Enums: {
			[_ in never]: never;
		};
		CompositeTypes: {
			[_ in never]: never;
		};
	};
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<
	keyof Database,
	"public"
>];

export type Tables<
	DefaultSchemaTableNameOrOptions extends
		| keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
		| { schema: keyof DatabaseWithoutInternals },
	TableName extends DefaultSchemaTableNameOrOptions extends {
		schema: keyof DatabaseWithoutInternals;
	}
		? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
				DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
		: never = never,
> = DefaultSchemaTableNameOrOptions extends {
	schema: keyof DatabaseWithoutInternals;
}
	? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
			DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
			Row: infer R;
		}
		? R
		: never
	: DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
				DefaultSchema["Views"])
		? (DefaultSchema["Tables"] &
				DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
				Row: infer R;
			}
			? R
			: never
		: never;

export type TablesInsert<
	DefaultSchemaTableNameOrOptions extends
		| keyof DefaultSchema["Tables"]
		| { schema: keyof DatabaseWithoutInternals },
	TableName extends DefaultSchemaTableNameOrOptions extends {
		schema: keyof DatabaseWithoutInternals;
	}
		? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
		: never = never,
> = DefaultSchemaTableNameOrOptions extends {
	schema: keyof DatabaseWithoutInternals;
}
	? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
			Insert: infer I;
		}
		? I
		: never
	: DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
		? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
				Insert: infer I;
			}
			? I
			: never
		: never;

export type TablesUpdate<
	DefaultSchemaTableNameOrOptions extends
		| keyof DefaultSchema["Tables"]
		| { schema: keyof DatabaseWithoutInternals },
	TableName extends DefaultSchemaTableNameOrOptions extends {
		schema: keyof DatabaseWithoutInternals;
	}
		? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
		: never = never,
> = DefaultSchemaTableNameOrOptions extends {
	schema: keyof DatabaseWithoutInternals;
}
	? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
			Update: infer U;
		}
		? U
		: never
	: DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
		? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
				Update: infer U;
			}
			? U
			: never
		: never;

export type Enums<
	DefaultSchemaEnumNameOrOptions extends
		| keyof DefaultSchema["Enums"]
		| { schema: keyof DatabaseWithoutInternals },
	EnumName extends DefaultSchemaEnumNameOrOptions extends {
		schema: keyof DatabaseWithoutInternals;
	}
		? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
		: never = never,
> = DefaultSchemaEnumNameOrOptions extends {
	schema: keyof DatabaseWithoutInternals;
}
	? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
	: DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
		? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
		: never;

export type CompositeTypes<
	PublicCompositeTypeNameOrOptions extends
		| keyof DefaultSchema["CompositeTypes"]
		| { schema: keyof DatabaseWithoutInternals },
	CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
		schema: keyof DatabaseWithoutInternals;
	}
		? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
		: never = never,
> = PublicCompositeTypeNameOrOptions extends {
	schema: keyof DatabaseWithoutInternals;
}
	? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
	: PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
		? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
		: never;

export const Constants = {
	public: {
		Enums: {},
	},
} as const;
