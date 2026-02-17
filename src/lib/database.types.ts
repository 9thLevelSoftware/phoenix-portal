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
			profiles: {
				Row: {
					id: string;
					display_name: string;
					avatar_url: string | null;
					stripe_customer_id: string | null;
					created_at: string;
					updated_at: string;
				};
				Insert: {
					id: string;
					display_name: string;
					avatar_url?: string | null;
					stripe_customer_id?: string | null;
					created_at?: string;
					updated_at?: string;
				};
				Update: {
					id?: string;
					display_name?: string;
					avatar_url?: string | null;
					stripe_customer_id?: string | null;
					created_at?: string;
					updated_at?: string;
				};
			};
			subscriptions: {
				Row: {
					id: string;
					user_id: string;
					stripe_customer_id: string;
					stripe_subscription_id: string;
					tier: "FREE" | "PHOENIX" | "ELITE";
					status:
						| "active"
						| "past_due"
						| "canceled"
						| "trialing"
						| "incomplete";
					price_id: string;
					current_period_start: string;
					current_period_end: string;
					cancel_at_period_end: boolean;
					created_at: string;
					updated_at: string;
				};
				Insert: {
					id?: string;
					user_id: string;
					stripe_customer_id: string;
					stripe_subscription_id: string;
					tier: "FREE" | "PHOENIX" | "ELITE";
					status:
						| "active"
						| "past_due"
						| "canceled"
						| "trialing"
						| "incomplete";
					price_id: string;
					current_period_start: string;
					current_period_end: string;
					cancel_at_period_end?: boolean;
					created_at?: string;
					updated_at?: string;
				};
				Update: {
					id?: string;
					user_id?: string;
					stripe_customer_id?: string;
					stripe_subscription_id?: string;
					tier?: "FREE" | "PHOENIX" | "ELITE";
					status?:
						| "active"
						| "past_due"
						| "canceled"
						| "trialing"
						| "incomplete";
					price_id?: string;
					current_period_start?: string;
					current_period_end?: string;
					cancel_at_period_end?: boolean;
					created_at?: string;
					updated_at?: string;
				};
			};
			shared_routines: {
				Row: {
					id: string;
					user_id: string;
					routine_id: string;
					name: string;
					description: string;
					exercise_count: number;
					estimated_duration: number;
					exercises_snapshot: unknown;
					tags: string[];
					difficulty: "Beginner" | "Intermediate" | "Advanced";
					vote_count: number;
					save_count: number;
					hot_score: number;
					shared_at: string;
					updated_at: string;
				};
				Insert: {
					id?: string;
					user_id: string;
					routine_id: string;
					name: string;
					description: string;
					exercise_count: number;
					estimated_duration: number;
					exercises_snapshot: unknown;
					tags: string[];
					difficulty: "Beginner" | "Intermediate" | "Advanced";
					vote_count?: number;
					save_count?: number;
					hot_score?: number;
					shared_at?: string;
					updated_at?: string;
				};
				Update: {
					id?: string;
					user_id?: string;
					routine_id?: string;
					name?: string;
					description?: string;
					exercise_count?: number;
					estimated_duration?: number;
					exercises_snapshot?: unknown;
					tags?: string[];
					difficulty?: "Beginner" | "Intermediate" | "Advanced";
					vote_count?: number;
					save_count?: number;
					hot_score?: number;
					shared_at?: string;
					updated_at?: string;
				};
			};
			shared_cycles: {
				Row: {
					id: string;
					user_id: string;
					cycle_id: string;
					name: string;
					description: string;
					duration_weeks: number;
					tags: string[];
					difficulty: "Beginner" | "Intermediate" | "Advanced";
					vote_count: number;
					save_count: number;
					hot_score: number;
					shared_at: string;
					updated_at: string;
				};
				Insert: {
					id?: string;
					user_id: string;
					cycle_id: string;
					name: string;
					description: string;
					duration_weeks: number;
					tags: string[];
					difficulty: "Beginner" | "Intermediate" | "Advanced";
					vote_count?: number;
					save_count?: number;
					hot_score?: number;
					shared_at?: string;
					updated_at?: string;
				};
				Update: {
					id?: string;
					user_id?: string;
					cycle_id?: string;
					name?: string;
					description?: string;
					duration_weeks?: number;
					tags?: string[];
					difficulty?: "Beginner" | "Intermediate" | "Advanced";
					vote_count?: number;
					save_count?: number;
					hot_score?: number;
					shared_at?: string;
					updated_at?: string;
				};
			};
			community_votes: {
				Row: {
					id: string;
					user_id: string;
					item_id: string;
					item_type: "routine" | "cycle";
					created_at: string;
				};
				Insert: {
					id?: string;
					user_id: string;
					item_id: string;
					item_type: "routine" | "cycle";
					created_at?: string;
				};
				Update: {
					id?: string;
					user_id?: string;
					item_id?: string;
					item_type?: "routine" | "cycle";
					created_at?: string;
				};
			};
			saved_community_items: {
				Row: {
					id: string;
					user_id: string;
					shared_item_id: string;
					item_type: "routine" | "cycle";
					saved_at: string;
				};
				Insert: {
					id?: string;
					user_id: string;
					shared_item_id: string;
					item_type: "routine" | "cycle";
					saved_at?: string;
				};
				Update: {
					id?: string;
					user_id?: string;
					shared_item_id?: string;
					item_type?: "routine" | "cycle";
					saved_at?: string;
				};
			};
			user_integrations: {
				Row: {
					id: string;
					user_id: string;
					provider: string;
					provider_user_id: string | null;
					access_token: string | null;
					refresh_token: string | null;
					token_expires_at: string | null;
					api_key: string | null;
					connected_at: string;
					last_sync_at: string | null;
					status: string;
					error_message: string | null;
				};
				Insert: {
					id?: string;
					user_id: string;
					provider: string;
					provider_user_id?: string | null;
					access_token?: string | null;
					refresh_token?: string | null;
					token_expires_at?: string | null;
					api_key?: string | null;
					connected_at?: string;
					last_sync_at?: string | null;
					status?: string;
					error_message?: string | null;
				};
				Update: {
					id?: string;
					user_id?: string;
					provider?: string;
					provider_user_id?: string | null;
					access_token?: string | null;
					refresh_token?: string | null;
					token_expires_at?: string | null;
					api_key?: string | null;
					connected_at?: string;
					last_sync_at?: string | null;
					status?: string;
					error_message?: string | null;
				};
			};
			sync_queue: {
				Row: {
					id: string;
					user_id: string;
					provider: string;
					sync_type: string;
					status: string;
					created_at: string;
					started_at: string | null;
					completed_at: string | null;
					retry_count: number;
					error_message: string | null;
				};
				Insert: {
					id?: string;
					user_id: string;
					provider: string;
					sync_type?: string;
					status?: string;
					created_at?: string;
					started_at?: string | null;
					completed_at?: string | null;
					retry_count?: number;
					error_message?: string | null;
				};
				Update: {
					id?: string;
					user_id?: string;
					provider?: string;
					sync_type?: string;
					status?: string;
					created_at?: string;
					started_at?: string | null;
					completed_at?: string | null;
					retry_count?: number;
					error_message?: string | null;
				};
			};
			rate_limit_tracking: {
				Row: {
					id: string;
					provider: string;
					requests_this_window: number;
					window_started_at: string;
					last_request_at: string | null;
					last_reset_at: string | null;
				};
				Insert: {
					id?: string;
					provider: string;
					requests_this_window?: number;
					window_started_at?: string;
					last_request_at?: string | null;
					last_reset_at?: string | null;
				};
				Update: {
					id?: string;
					provider?: string;
					requests_this_window?: number;
					window_started_at?: string;
					last_request_at?: string | null;
					last_reset_at?: string | null;
				};
			};
			external_activities: {
				Row: {
					id: string;
					user_id: string;
					external_id: string;
					provider: string;
					name: string;
					activity_type: string | null;
					started_at: string;
					duration_seconds: number | null;
					distance_meters: number | null;
					calories: number | null;
					avg_heart_rate: number | null;
					max_heart_rate: number | null;
					elevation_gain_meters: number | null;
					raw_data: unknown;
					synced_at: string;
				};
				Insert: {
					id?: string;
					user_id: string;
					external_id: string;
					provider: string;
					name: string;
					activity_type?: string | null;
					started_at: string;
					duration_seconds?: number | null;
					distance_meters?: number | null;
					calories?: number | null;
					avg_heart_rate?: number | null;
					max_heart_rate?: number | null;
					elevation_gain_meters?: number | null;
					raw_data?: unknown;
					synced_at?: string;
				};
				Update: {
					id?: string;
					user_id?: string;
					external_id?: string;
					provider?: string;
					name?: string;
					activity_type?: string | null;
					started_at?: string;
					duration_seconds?: number | null;
					distance_meters?: number | null;
					calories?: number | null;
					avg_heart_rate?: number | null;
					max_heart_rate?: number | null;
					elevation_gain_meters?: number | null;
					raw_data?: unknown;
					synced_at?: string;
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
		Views: {
			creator_stats: {
				Row: {
					user_id: string;
					display_name: string;
					avatar_url: string | null;
					total_shares: number;
					total_upvotes: number;
					featured_count: number;
				};
			};
		};
	};
};
