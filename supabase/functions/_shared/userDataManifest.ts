/**
 * Single source of truth for where a user's data lives (R-31).
 *
 * Consumers:
 *   - `export-user-data` (GDPR export) serves every `USER_DATA_MANIFEST` table
 *     and every `NON_TABLE_SOURCES` entry, one page at a time, scoped to the
 *     JWT user. It selects only the explicit `columns` (plus
 *     `optionalColumns` where present), never `*`.
 *   - `purgeUser` (account deletion, PR 34) deletes the rows of every entry,
 *     whether in the manifest or in `EXCLUDED`, whose `purge` is `"explicit"`,
 *     using the entry's `purgeMatch` (EXCLUDED) or ownership path (manifest).
 *     For entries with `mayBeAbsent: true`, a missing relation (42P01 /
 *     PGRST205) is skipped and logged; for every other entry it is a failure.
 *   - `tests/security/user-data-manifest.test.ts` fails if a table with a
 *     `user_id` column, a `REFERENCES auth.users` FK, or an FK to such a table
 *     (in migrations or the generated types) is in neither list. It also checks
 *     the columns, the key uniqueness and the declared `purge` against the
 *     migrations.
 *
 * Export contract for the client (PR 37):
 *   - POST {table, cursor?} -> {table, rows, nextCursor | null}. Keep
 *     requesting with `cursor = nextCursor` until it is null. The endpoint
 *     ends paging only when a one-row probe after the page's last key finds
 *     nothing, so a PostgREST `max_rows` below `USER_DATA_PAGE_SIZE` cannot
 *     end paging early (and no per-page count rescans large tables).
 *   - `tableMissing: true` (HTTP 200, no rows) is returned only for
 *     `mayBeAbsent` entries whose relation does not exist in that database.
 *     The client MUST record every such table in the export (e.g. "N tables
 *     unavailable: ..." in the zip's README/manifest), never drop it silently.
 *     Any other missing relation is a 500.
 *   - HTTP 429 is resumable: honour `Retry-After` and continue from the last
 *     `nextCursor` (600 requests/hour; `rep_telemetry` can run to many pages).
 *
 * Pure TypeScript with no Deno or npm imports, so both Edge (Deno) and the
 * SPA/Vitest (Node) can import it.
 */

/** Rows per export page (requested limit). */
export const USER_DATA_PAGE_SIZE = 1000;

export type UserDataOwnership =
	/** Rows whose `column` equals the user id. */
	| { kind: "column"; column: string }
	/**
	 * Rows whose parent (`parentTable`, reached via the FK `fkColumn` →
	 * `parentTable.id`) has `parentTable.parentColumn` = user id.
	 */
	| {
			kind: "parent";
			fkColumn: string;
			parentTable: string;
			parentColumn: string;
	  };

/**
 * How account deletion removes the rows:
 * - `cascade`: an ON DELETE CASCADE chain from `auth.users` removes them.
 * - `set_null`: the owner column is ON DELETE SET NULL; rows survive
 *   anonymized (PR 34 decides whether to delete them outright).
 * - `explicit`: `purgeUser` must delete them (always safe to declare).
 */
export type UserDataPurge = "cascade" | "set_null" | "explicit";

export interface UserDataTable {
	table: string;
	ownership: UserDataOwnership;
	/**
	 * Keyset columns in ORDER BY order. Together with the ownership column
	 * they must cover a NOT NULL primary key / unique constraint.
	 */
	keyColumns: readonly string[];
	/** Exported columns (selected explicitly; credentials never listed). */
	columns: readonly string[];
	/**
	 * Columns that exist in prod but not in migrations (dashboard drift).
	 * Selected too; if the database lacks them (42703), the page is re-read
	 * with `columns` only.
	 */
	optionalColumns?: readonly string[];
	purge: UserDataPurge;
	/** The relation may not exist in every database (prod-only or not yet migrated). */
	mayBeAbsent?: true;
	/** Why the table is scoped or treated this way, when not obvious. */
	note?: string;
}

/**
 * Rows match when `column` = user id, OR (if given) when the text at
 * `json.path` inside the jsonb `json.column` equals the user id.
 */
export interface UserDataPurgeMatch {
	column: string;
	json?: { column: string; path: readonly string[] };
}

export interface ExcludedUserDataTable {
	table: string;
	/** Why it is not exported. */
	reason: string;
	purge: UserDataPurge;
	purgeMatch: UserDataPurgeMatch;
	mayBeAbsent?: true;
}

/** User data outside public tables. Served by export-user-data too. */
export interface NonTableSource {
	/** Name passed as `table` to export-user-data. */
	source: string;
	description: string;
	/** Fields returned per row. */
	fields: readonly string[];
	purge: string;
}

const byUserId = { kind: "column", column: "user_id" } as const;
const ID = ["id"] as const;
const PROD_ONLY_NOTE =
	"Prod-only table: prod FK user_id -> auth.users ON DELETE CASCADE (prod-evidence.md); purge explicit until the DDL is captured in migrations.";

function owned(
	table: string,
	purge: UserDataPurge,
	columns: readonly string[],
	extra: Partial<UserDataTable> = {},
): UserDataTable {
	return {
		table,
		ownership: byUserId,
		keyColumns: ID,
		columns,
		purge,
		...extra,
	};
}

/** Tables exported to the user (and purged per `purge`). */
export const USER_DATA_MANIFEST: readonly UserDataTable[] = [
	// Account & billing
	{
		table: "profiles",
		ownership: { kind: "column", column: "id" },
		keyColumns: ID,
		columns: [
			"id",
			"stripe_customer_id",
			"created_at",
			"updated_at",
			"user_id",
			"display_name",
			"avatar_url",
			"weight_unit",
			"email_digests",
			"push_notifications",
			"streak_reminders",
			"challenge_updates",
			"profile_visible",
			"leaderboard_participation",
			// PR 76 (20260920007600) supplies the DDL for these three, which were
			// prod-only drift columns before it.
			"digest_frequency",
			"digest_last_sent_at",
			"feature_flags",
		],
		purge: "cascade",
		note: "profiles.id is the auth user id (FK, ON DELETE CASCADE); user_id is a generated copy. stripe_customer_id is exported deliberately (PR 37 R-13): it is the user's own billing identifier, not a credential.",
	},
	owned("subscriptions", "cascade", [
		"id",
		"user_id",
		"tier",
		"status",
		"current_period_start",
		"current_period_end",
		"cancel_at_period_end",
		"created_at",
		"updated_at",
		"environment",
		"last_event_id",
		"paddle_customer_id",
		"paddle_subscription_id",
		"price_id",
		"last_event_occurred_at",
	],
	{
		note: "Billing-provider ids (paddle_customer_id, paddle_subscription_id, price_id, last_event_id) are exported deliberately (PR 37 R-13): they are the user's own identifiers, not credentials, and are useless without the server-side provider API key.",
	},
	),
	owned(
		"subscription_events",
		"explicit",
		[
			"id",
			"subscription_row_id",
			"user_id",
			"operation",
			"event_recorded_at",
			"tier",
			"status",
			"current_period_start",
			"current_period_end",
			"cancel_at_period_end",
			"environment",
			"last_event_id",
			"paddle_customer_id",
			"paddle_subscription_id",
			"price_id",
			"last_event_occurred_at",
			"subscription_created_at",
			"subscription_updated_at",
			"row_snapshot",
			// PR 44: why the subscription guard applied or ignored the event.
			"note",
		],
		{
			mayBeAbsent: true,
			note: "Billing audit trail (R-31: exported and purged). No FK to auth.users (prod-evidence.md); DDL captured by PR 2. Billing-provider ids (paddle_customer_id, paddle_subscription_id, price_id, last_event_id) are exported deliberately (PR 37 R-13): they are the user's own identifiers, not credentials, and are useless without the server-side provider API key.",
		},
	),
	owned("deletion_requests", "cascade", [
		"id",
		"user_id",
		"requested_at",
		"scheduled_for",
		"cancelled_at",
		"executed_at",
		"status",
		// PR 32: audit of the cancelled request this one replaced.
		"previous_requested_at",
		"previous_cancelled_at",
		"rerequest_count",
		// PR 35: purge-worker state on the user's own erasure request.
		"claimed_at",
		"needs_support_reason",
		"last_attempt_at",
	]),
	owned("user_onboarding", "cascade", [
		"id",
		"user_id",
		"completed_at",
		"version_seen",
		"dismissed_hints",
		"dismissed_whats_new",
		"created_at",
	]),
	owned("local_profiles", "cascade", [
		"user_id",
		"id",
		"name",
		"color_index",
		"device_id",
		"created_at",
		"updated_at",
	]),
	{
		table: "local_profile_preferences",
		ownership: byUserId,
		keyColumns: ["local_profile_id"],
		columns: [
			"user_id",
			"local_profile_id",
			"schema_version",
			"body_weight_kg",
			"weight_unit",
			"weight_increment",
			"core_revision",
			"core_updated_at",
			"equipment_rack",
			"rack_revision",
			"rack_updated_at",
			"workout_preferences",
			"workout_revision",
			"workout_updated_at",
			"led_color_scheme_id",
			"led_preferences",
			"led_revision",
			"led_updated_at",
			"vbt_enabled",
			"vbt_preferences",
			"vbt_revision",
			"vbt_updated_at",
			"updated_at",
		],
		purge: "cascade",
		note: "Primary key (user_id, local_profile_id); user_id is fixed by the ownership filter.",
	},
	// Workouts
	owned("workout_sessions", "cascade", [
		"id",
		"user_id",
		"name",
		"started_at",
		"duration_seconds",
		"total_volume",
		"set_count",
		"exercise_count",
		"pr_count",
		"routine_name",
		"workout_mode",
		"notes",
		"routine_session_id",
		"avg_velocity_mps",
		"avg_asymmetry_pct",
		"velocity_loss_pct",
		"dominant_side",
		"strength_profile",
		"form_score",
		"deload_warnings",
		"rom_violations",
		"spotter_activations",
		"peak_force_n",
		"estimated_calories",
		"heaviest_lift_kg",
		"eccentric_load",
		"echo_level",
		"warmup_reps",
		"working_reps",
		"local_profile_id",
		"updated_at",
		// PR 21 (KD-5): the device LWW key; `updated_at` stays server-owned.
		"client_updated_at",
	]),
	owned("exercises", "cascade", [
		"id",
		"session_id",
		"name",
		"muscle_group",
		"order_index",
		"user_id",
		"exercise_id",
		// PR 28/29 (KD-8): 1, 2, or NULL when the build did not report it.
		"cable_count",
	]),
	owned("sets", "cascade", [
		"id",
		"exercise_id",
		"set_number",
		"target_reps",
		"actual_reps",
		"weight_kg",
		"rpe",
		"is_pr",
		"notes",
		"user_id",
		"workout_mode",
	]),
	owned("rep_summaries", "cascade", [
		"id",
		"set_id",
		"rep_number",
		"mean_velocity_mps",
		"peak_velocity_mps",
		"mean_force_n",
		"peak_force_n",
		"power_watts",
		"rom_mm",
		"tut_ms",
		"left_force_avg",
		"right_force_avg",
		"asymmetry_pct",
		"vbt_zone",
		"user_id",
	]),
	// A security_invoker VIEW since 20260925200000: one row per sample over
	// set_telemetry plus any legacy rows not yet folded, with the same columns
	// the table had, so the export is unchanged. The two backing tables are in
	// EXCLUDED so no sample is exported twice.
	owned("rep_telemetry", "cascade", [
		"id",
		"set_id",
		"timestamp_ms",
		"force_n",
		"velocity_mps",
		"position_mm",
		"cable",
		"user_id",
	]),
	owned("personal_records", "cascade", [
		"id",
		"user_id",
		"exercise_name",
		"muscle_group",
		"record_type",
		"value",
		"unit",
		"achieved_at",
		"previous_value",
		"workout_phase",
		"local_profile_id",
		"updated_at",
		"weight_kg",
		"reps",
		"session_id",
		"exercise_id",
		"deleted_at",
		// PR 57: push path that produced the row (set_derived | dedicated);
		// NULL on rows predating 20260920005700.
		"source",
	]),
	owned("exercise_progress", "cascade", [
		"id",
		"user_id",
		"exercise_name",
		"session_id",
		"recorded_at",
		"max_weight_kg",
		"total_volume_kg",
		"estimated_1rm_kg",
		"max_reps",
		"set_count",
		"local_profile_id",
		"exercise_id",
		"velocity_estimated_1rm_kg",
	]),
	owned("session_phase_statistics", "cascade", [
		"id",
		"session_id",
		"user_id",
		"concentric_kg_avg",
		"concentric_kg_max",
		"concentric_vel_avg",
		"concentric_vel_max",
		"concentric_watt_avg",
		"concentric_watt_max",
		"eccentric_kg_avg",
		"eccentric_kg_max",
		"eccentric_vel_avg",
		"eccentric_vel_max",
		"eccentric_watt_avg",
		"eccentric_watt_max",
		"created_at",
	]),
	owned("exercise_signatures", "cascade", [
		"id",
		"user_id",
		"exercise_id",
		"rom_mm",
		"duration_ms",
		"symmetry_ratio",
		"velocity_profile",
		"cable_config",
		"sample_count",
		"confidence",
		"updated_at",
		"created_at",
	]),
	owned("vbt_assessments", "cascade", [
		"id",
		"user_id",
		"exercise_id",
		"estimated_1rm_kg",
		"load_velocity_data",
		"assessment_session_id",
		"user_override_kg",
		"created_at",
	]),
	owned(
		"exercise_catalog",
		"cascade",
		[
			"id",
			"name",
			"display_name",
			"description",
			"muscle_group",
			"muscle_groups",
			"muscles",
			"equipment",
			"movement",
			"sidedness",
			"grip",
			"grip_width",
			"default_cable_config",
			"min_rep_range",
			"popularity",
			"aliases",
			"thumbnail_url",
			"archived",
			"is_custom",
			"user_id",
			"created_at",
			"updated_at",
			"source",
			"source_id",
			"license",
			"license_author",
			"license_url",
		],
		{
			note: "Only the user's own custom exercises (user_id = uid); global catalog rows have user_id NULL.",
		},
	),
	// Routines & cycles
	owned(
		"routines",
		"cascade",
		[
			"id",
			"user_id",
			"name",
			"description",
			"exercise_count",
			"estimated_duration",
			"times_completed",
			"last_used_at",
			"tags",
			"is_favorite",
			"updated_at",
			"local_profile_id",
			"created_at",
			// PR 21 (KD-5): the device LWW key.
			"client_updated_at",
		],
	),
	{
		table: "routine_exercises",
		ownership: {
			kind: "parent",
			fkColumn: "routine_id",
			parentTable: "routines",
			parentColumn: "user_id",
		},
		keyColumns: ID,
		columns: [
			"id",
			"routine_id",
			"name",
			"muscle_group",
			"sets",
			"reps",
			"weight",
			"rest_seconds",
			"mode",
			"order_index",
			"created_at",
			"superset_id",
			"superset_color",
			"superset_order",
			"per_set_weights",
			"per_set_rest",
			"is_amrap",
			"pr_percentage",
			"rep_count_timing",
			"stop_at_position",
			"stall_detection",
			"eccentric_load",
			"echo_level",
			"is_bodyweight",
			"duration_seconds",
			"per_set_echo_levels",
			"warmup_sets",
			"per_set_reps",
			"exercise_id",
			"drop_set_enabled",
			"drop_set_min_weight_kg",
		],
		purge: "cascade",
	},
	owned("training_cycles", "cascade", [
		"id",
		"user_id",
		"name",
		"description",
		"duration_weeks",
		"current_week",
		"status",
		"workout_days",
		"rest_days",
		"started_at",
		"last_used_at",
		"progression_settings",
		"deload_settings",
		// PR 76 / sync-reliability: where the cycle has progressed to.
		"progress_state",
		"updated_at",
		"local_profile_id",
		"template_id",
		// PR 18 (KD-6): portal-edit bookkeeping for the cycle merge.
		"portal_edited_at",
		"portal_duration_set_at",
		// PR 21 (KD-5): the device LWW key.
		"client_updated_at",
	]),
	{
		table: "cycle_days",
		ownership: {
			kind: "parent",
			fkColumn: "cycle_id",
			parentTable: "training_cycles",
			parentColumn: "user_id",
		},
		keyColumns: ID,
		columns: [
			"id",
			"cycle_id",
			"day_number",
			"day_type",
			"routine_id",
			"weight_adjustment",
			"rep_modifier",
			"rest_override",
			"notes",
			"rest_type",
			"echo_level",
			"eccentric_load_percent",
		],
		purge: "cascade",
	},
	// The five tables 20260920120000 (sync reliability contract) adds. All are
	// owned by a user via `user_id` and all cascade-purge with auth.users(id).
	// `source_profile_id` / `target_profile_id` / `profile_id` are the user's
	// own *local* profile ids (the same family already exported as
	// `local_profiles`), not other auth users — exporting them leaks nothing.
	// Same class as `sync_tombstones`: soft-delete / ownership bookkeeping the
	// user authored by using the product.
	{
		table: "profile_ownership_claims",
		ownership: byUserId,
		keyColumns: ["entity_type", "entity_id"],
		columns: [
			"entity_type",
			"entity_id",
			"user_id",
			"target_profile_id",
			"mutation_id",
			"claimed_at",
		],
		purge: "cascade",
	},
	{
		table: "profile_ownership_events",
		ownership: byUserId,
		keyColumns: ["mutation_id"],
		columns: [
			"mutation_id",
			"user_id",
			"source_profile_id",
			"target_profile_id",
			"target_profile_name",
			"target_profile_color_index",
			"workout_session_ids",
			"routine_ids",
			"cycle_ids",
			"personal_record_ids",
			"transferred_at",
		],
		purge: "cascade",
	},
	{
		table: "profile_ownership_transfers",
		ownership: byUserId,
		keyColumns: ["mutation_id"],
		columns: [
			"mutation_id",
			"user_id",
			"request_hash",
			"source_profile_id",
			"target_profile_id",
			"workout_session_ids",
			"routine_ids",
			"cycle_ids",
			"personal_record_ids",
			"transferred_at",
		],
		purge: "cascade",
	},
	{
		table: "training_cycle_deletion_tombstones",
		ownership: byUserId,
		keyColumns: ["cycle_id"],
		columns: ["user_id", "cycle_id", "deleted_at"],
		purge: "cascade",
	},
	{
		table: "workout_deletion_tombstones",
		ownership: byUserId,
		keyColumns: ["mutation_id"],
		columns: [
			"mutation_id",
			"user_id",
			"request_hash",
			"profile_id",
			"scope",
			"portal_session_id",
			"component_session_id",
			"deleted_at",
			"recorded_at",
		],
		purge: "cascade",
	},
	{
		table: "sync_tombstones",
		ownership: byUserId,
		keyColumns: ["entity", "entity_id"],
		columns: ["user_id", "entity", "entity_id", "deleted_at", "client_deleted_at"],
		purge: "explicit",
		mayBeAbsent: true,
		note: "PK (user_id, entity, entity_id); user_id cascades from auth.users since 20260920001600, and purgeUser still deletes it explicitly (R-6, R-30). client_deleted_at is the deletion's LWW clock (204-E); deleted_at stays the server clock.",
	},
	// Goals, gamification, insights
	owned(
		"user_goals",
		"cascade",
		[
			"id",
			"user_id",
			"goal_type",
			"target_value",
			"target_unit",
			"exercise_name",
			"deadline",
			"period",
			"status",
			"completed_at",
			"created_at",
			"updated_at",
			"exercise_id",
			"predicted_completion_date",
			// PR 30 (KD-8): whether the target is a per-cable or total load.
			"target_basis",
			// PR 76 (20260920007600) supplies the DDL for this one.
			"last_snapshot_at",
		],
	),
	owned(
		"goal_snapshots",
		"explicit",
		[
			"id",
			"user_id",
			"goal_id",
			"current_value",
			"progress_pct",
			"predicted_completion",
			"snapshotted_at",
		],
		{ mayBeAbsent: true, note: PROD_ONLY_NOTE },
	),
	owned(
		"overload_suggestions",
		"explicit",
		[
			"id",
			"user_id",
			"exercise_name",
			"suggestion_type",
			"current_value",
			"suggested_value",
			"rationale",
			"confidence",
			"created_at",
			"expires_at",
			"exercise_id",
		],
		{ mayBeAbsent: true, note: PROD_ONLY_NOTE },
	),
	owned(
		"telemetry_analysis",
		"explicit",
		[
			"id",
			"set_id",
			"user_id",
			"analysis_type",
			"result",
			"computed_at",
			"worker_version",
		],
		{ mayBeAbsent: true, note: PROD_ONLY_NOTE },
	),
	owned(
		"wearable_daily_summaries",
		"explicit",
		[
			"id",
			"user_id",
			"summary_date",
			"provider",
			"resting_hr",
			"hrv_ms",
			"sleep_score",
			"sleep_duration_minutes",
			"deep_sleep_minutes",
			"rem_sleep_minutes",
			"light_sleep_minutes",
			"awake_minutes",
			"hr_zones",
			"stress_score",
			"body_battery",
			"created_at",
		],
		{ mayBeAbsent: true, note: PROD_ONLY_NOTE },
	),
	owned("earned_badges", "cascade", [
		"id",
		"user_id",
		"badge_id",
		"badge_name",
		"badge_description",
		"badge_tier",
		"earned_at",
	]),
	owned("gamification_stats", "cascade", [
		"id",
		"user_id",
		"total_workouts",
		"total_reps",
		"total_volume_kg",
		"longest_streak",
		"current_streak",
		"total_time_seconds",
		"updated_at",
		"pr_count",
		"best_streak",
		// PR 25: device-reported lifetime counters kept verbatim alongside the
		// server-derived columns; mobile-sync-pull serves these, not the derived ones.
		"last_workout_at",
		"device_total_workouts",
		"device_total_reps",
		"device_total_volume_kg",
		"device_total_time_seconds",
		"device_current_streak",
		"device_longest_streak",
	]),
	owned("rpg_attributes", "cascade", [
		"id",
		"user_id",
		"strength",
		"power",
		"stamina",
		"consistency",
		"mastery",
		"character_class",
		"level",
		"experience_points",
		"updated_at",
		// PR 25: last-workout date carried by the write that set this row.
		"last_workout_at",
	]),
	// PR 56: leaderboard values and ranks per participating profile, rebuilt
	// every 15 minutes by refresh_leaderboard_snapshots(). These are the user's
	// own rows. RLS is service_role-only (a direct PostgREST read would expose
	// the whole opted-in roster), but export-user-data reads with the service
	// role. An opt-out trigger deletes the user's rows immediately.
	owned(
		"leaderboard_snapshots",
		"cascade",
		["metric", "period", "user_id", "value", "rank", "computed_at"],
		{
			keyColumns: ["metric", "period"],
			mayBeAbsent: true,
			note: "Created by 20260920005600; may be absent until that migration is applied everywhere. purge cascade via profiles(id) ON DELETE CASCADE.",
		},
	),
	owned("user_insights", "cascade", [
		"id",
		"user_id",
		"insight_type",
		"title",
		"description",
		"recommendation",
		"metric_name",
		"metric_value",
		"metric_unit",
		"metric_delta",
		"period",
		"created_at",
		"expires_at",
	]),
	// Community
	owned("shared_routines", "set_null", [
		"id",
		"user_id",
		"routine_id",
		"name",
		"description",
		"exercise_count",
		"estimated_duration",
		"exercises_snapshot",
		"tags",
		"difficulty",
		"vote_count",
		"save_count",
		"hot_score",
		"comment_count",
		"shared_at",
		"updated_at",
	]),
	owned("shared_cycles", "set_null", [
		"id",
		"user_id",
		"cycle_id",
		"name",
		"description",
		"duration_weeks",
		"tags",
		"difficulty",
		"vote_count",
		"save_count",
		"hot_score",
		"comment_count",
		"shared_at",
		"updated_at",
		"cycle_snapshot",
	]),
	owned("community_comments", "set_null", [
		"id",
		"item_id",
		"item_type",
		"user_id",
		"body",
		"created_at",
		"updated_at",
		"deleted_at",
	]),
	owned("community_votes", "cascade", [
		"id",
		"user_id",
		"item_id",
		"item_type",
		"created_at",
	]),
	owned("saved_community_items", "cascade", [
		"id",
		"user_id",
		"shared_item_id",
		"item_type",
		"saved_at",
		"imported_routine_id",
		"imported_cycle_id",
	]),
	owned("challenge_participants", "cascade", [
		"id",
		"challenge_id",
		"user_id",
		"joined_at",
		"completed_at",
	]),
	{
		table: "creator_follows",
		ownership: { kind: "column", column: "follower_id" },
		keyColumns: ID,
		columns: ["id", "follower_id", "followed_id", "created_at"],
		purge: "cascade",
		note: "The user's own follows. Rows where another user follows them (followed_id) also cascade on delete but are not exported: they identify third parties.",
	},
	{
		table: "user_blocks",
		ownership: { kind: "column", column: "blocker_id" },
		keyColumns: ID,
		columns: ["id", "blocker_id", "blocked_id", "created_at"],
		purge: "cascade",
		note: "The user's own blocks. Who blocked the user is not disclosed (blocked_id rows still cascade on delete).",
	},
	{
		table: "content_reports",
		ownership: { kind: "column", column: "reporter_id" },
		keyColumns: ID,
		columns: [
			"id",
			"reporter_id",
			"content_id",
			"content_type",
			"category",
			"description",
			"created_at",
		],
		purge: "cascade",
		note: "Reports the user filed. Reporters of the user's content are not disclosed.",
	},
	// Integrations
	owned(
		"user_integrations",
		"cascade",
		[
			"id",
			"user_id",
			"provider",
			"provider_user_id",
			"connected_at",
			"last_sync_at",
			"status",
			"error_message",
			// PR 50: resumable provider-backfill window and chain start.
			"backfill_before",
			"backfill_after",
			"backfill_started_at",
		],
		{
			note: "Connection metadata only; credentials live in oauth_tokens (EXCLUDED).",
		},
	),
	owned("external_activities", "cascade", [
		"id",
		"user_id",
		"external_id",
		"provider",
		"name",
		"activity_type",
		"started_at",
		"duration_seconds",
		"distance_meters",
		"calories",
		"avg_heart_rate",
		"max_heart_rate",
		"elevation_gain_meters",
		"raw_data",
		"synced_at",
		"updated_at",
	]),
	owned("sync_queue", "cascade", [
		"id",
		"user_id",
		"provider",
		"sync_type",
		"status",
		"created_at",
		"started_at",
		"completed_at",
		"retry_count",
		"error_message",
	]),
];

/**
 * User-linked tables that are deliberately not exported. Each still states how
 * account deletion removes its rows.
 */
export const EXCLUDED: readonly ExcludedUserDataTable[] = [
	{
		table: "set_telemetry",
		reason: "Storage for force-curve samples, one row per set as arrays (20260925200000). Every sample is exported once, per row, through the rep_telemetry view in the manifest.",
		purge: "cascade",
		purgeMatch: { column: "user_id" },
	},
	{
		table: "set_telemetry_sample_ids",
		reason: "Trigger-maintained unique index of the sample ids stored in set_telemetry (20260925200000): ids and set ids only, no content of its own. Every sample id is already exported through the rep_telemetry view.",
		// set_id -> set_telemetry ON DELETE CASCADE, which cascades from auth.users.
		purge: "cascade",
		purgeMatch: { column: "set_id" },
	},
	{
		table: "rep_telemetry_legacy",
		reason: "Per-sample rows written before 20260925200000, kept until the set_telemetry backfill is verified. The rep_telemetry view serves them until then, so they are exported through it and never twice.",
		// The renamed table keeps its FK to auth.users ON DELETE CASCADE, but
		// the migration parser cannot see a rename, so the purge is explicit
		// (always safe) rather than a cascade the tests cannot verify.
		purge: "explicit",
		purgeMatch: { column: "user_id" },
		// Dropped by a later migration once the backfill is verified.
		mayBeAbsent: true,
	},
	{
		table: "oauth_tokens",
		reason: "Provider access/refresh tokens and API keys are credentials, not user content; connection metadata is exported via user_integrations.",
		purge: "cascade",
		purgeMatch: { column: "user_id" },
	},
	{
		table: "oauth_states",
		reason: "Short-lived OAuth CSRF state rows; transient operational data.",
		purge: "cascade",
		purgeMatch: { column: "user_id" },
	},
	{
		table: "rate_limit_tracking",
		reason: "Transient operational request counters (R-31 decision: purged, not exported).",
		purge: "explicit",
		purgeMatch: { column: "user_id" },
	},
	{
		table: "paddle_webhook_events",
		reason: "Raw Paddle provider payloads (R-31 decision: purged, not exported). Billing history is exported via subscriptions and subscription_events; Paddle, as merchant of record, keeps its own tax records.",
		purge: "explicit",
		// Prod has a nullable user_id column (prod-evidence.md); events that
		// arrived before linking carry the id only in custom_data.
		purgeMatch: {
			column: "user_id",
			json: { column: "payload", path: ["data", "custom_data", "user_id"] },
		},
		mayBeAbsent: true,
	},
];

/** User data that does not live in a public table. */
export const NON_TABLE_SOURCES: readonly NonTableSource[] = [
	{
		source: "auth_account",
		description: "The auth account from the verified JWT user (auth.users).",
		fields: [
			"id",
			"email",
			"phone",
			"created_at",
			"last_sign_in_at",
			"email_confirmed_at",
			"identity_providers",
		],
		purge: "auth.admin.deleteUser",
	},
	{
		source: "storage_avatars",
		description: "References to the user's files in the avatars Storage bucket (avatars/{uid}/*); the image itself is downloaded by the client from avatar_url or the path.",
		fields: ["bucket", "path", "size", "mimetype", "updated_at"],
		purge: "delete-account removes avatars/{uid}/* (best effort)",
	},
];

const MANIFEST_BY_TABLE: ReadonlyMap<string, UserDataTable> = new Map(
	USER_DATA_MANIFEST.map((entry) => [entry.table, entry]),
);

/** Everything the export client should request, in order. */
export const USER_DATA_EXPORT_TABLES: readonly string[] = [
	...NON_TABLE_SOURCES.map((source) => source.source),
	...USER_DATA_MANIFEST.map((entry) => entry.table),
];

export function getUserDataTable(table: string): UserDataTable | undefined {
	return MANIFEST_BY_TABLE.get(table);
}

export function isNonTableSource(name: string): boolean {
	return NON_TABLE_SOURCES.some((source) => source.source === name);
}
