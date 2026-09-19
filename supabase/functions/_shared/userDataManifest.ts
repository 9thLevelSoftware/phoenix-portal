/**
 * Single source of truth for every table that holds a user's data (R-31).
 *
 * Consumers:
 *   - `export-user-data` (GDPR export): serves only `USER_DATA_MANIFEST`
 *     entries, one keyset page at a time, scoped to the JWT user.
 *   - `purgeUser` (account deletion, PR 34): deletes rows of every entry,
 *     manifest or `EXCLUDED`, whose `purge` is `"explicit"`.
 *   - `tests/security/user-data-manifest.test.ts`: fails if a table with a
 *     `user_id` column, a `REFERENCES auth.users` FK, or an FK to such a table
 *     (migrations and generated types) is in neither list, and verifies each
 *     declared `purge` against the parsed ON DELETE actions.
 *
 * Pure TypeScript with no Deno or npm imports, so both Edge (Deno) and the
 * SPA/Vitest (Node) can import it.
 */

/** Rows per export page. Matches PostgREST's `max_rows` (A-001). */
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
 * - `explicit`: nothing removes them automatically; `purgeUser` must delete
 *   them by the ownership path (always safe to declare).
 */
export type UserDataPurge = "cascade" | "set_null" | "explicit";

export interface UserDataTable {
	table: string;
	ownership: UserDataOwnership;
	/**
	 * Keyset columns, unique among the user's rows, in ORDER BY order. The
	 * ownership filter is applied separately, so it is not part of the key.
	 */
	keyColumns: readonly string[];
	purge: UserDataPurge;
	/** Why the table is scoped or treated this way, when not obvious. */
	note?: string;
}

export interface ExcludedUserDataTable {
	table: string;
	/** Why it is not exported. */
	reason: string;
	purge: UserDataPurge;
	/** How `purgeUser` finds the user's rows when `purge` is `explicit`. */
	purgeMatch?: string;
}

const byUserId = { kind: "column", column: "user_id" } as const;
const ID = ["id"] as const;

function owned(
	table: string,
	purge: UserDataPurge,
	extra: Partial<UserDataTable> = {},
): UserDataTable {
	return { table, ownership: byUserId, keyColumns: ID, purge, ...extra };
}

/** Tables exported to the user (and purged per `purge`). */
export const USER_DATA_MANIFEST: readonly UserDataTable[] = [
	// Account & billing
	{
		table: "profiles",
		ownership: { kind: "column", column: "id" },
		keyColumns: ID,
		purge: "cascade",
		note: "profiles.id is the auth user id (FK, ON DELETE CASCADE); user_id is a generated copy.",
	},
	owned("subscriptions", "cascade"),
	owned("subscription_events", "explicit", {
		note: "Billing audit trail (R-31 decision: exported and purged). No FK to auth.users; table created by PR 2 from prod.",
	}),
	owned("deletion_requests", "cascade"),
	owned("user_onboarding", "cascade"),
	owned("local_profiles", "cascade"),
	{
		table: "local_profile_preferences",
		ownership: byUserId,
		keyColumns: ["local_profile_id"],
		purge: "cascade",
		note: "Primary key (user_id, local_profile_id); user_id is fixed by the ownership filter.",
	},
	// Workouts
	owned("workout_sessions", "cascade"),
	owned("exercises", "cascade"),
	owned("sets", "cascade"),
	owned("rep_summaries", "cascade"),
	owned("rep_telemetry", "cascade"),
	owned("personal_records", "cascade"),
	owned("exercise_progress", "cascade"),
	owned("session_phase_statistics", "cascade"),
	owned("exercise_signatures", "cascade"),
	owned("vbt_assessments", "cascade"),
	owned("exercise_catalog", "cascade", {
		note: "Only the user's own custom exercises (user_id = uid); global catalog rows have user_id NULL.",
	}),
	// Routines & cycles
	owned("routines", "cascade"),
	{
		table: "routine_exercises",
		ownership: {
			kind: "parent",
			fkColumn: "routine_id",
			parentTable: "routines",
			parentColumn: "user_id",
		},
		keyColumns: ID,
		purge: "cascade",
	},
	owned("training_cycles", "cascade"),
	{
		table: "cycle_days",
		ownership: {
			kind: "parent",
			fkColumn: "cycle_id",
			parentTable: "training_cycles",
			parentColumn: "user_id",
		},
		keyColumns: ID,
		purge: "cascade",
	},
	{
		table: "sync_tombstones",
		ownership: byUserId,
		keyColumns: ["entity", "entity_id"],
		purge: "explicit",
		note: "No id column and no FK (PR 16); purgeUser deletes it after deleteUser (R-6, R-30).",
	},
	// Goals, gamification, insights
	owned("user_goals", "cascade"),
	owned("goal_snapshots", "explicit", {
		note: "Prod-only table (stub migration 20260420210411); FK behaviour unverifiable here.",
	}),
	owned("overload_suggestions", "explicit", {
		note: "Prod-only table (stub migration 20260420210411); FK behaviour unverifiable here.",
	}),
	owned("telemetry_analysis", "explicit", {
		note: "Prod-only table (stub migration 20260420210411); FK behaviour unverifiable here.",
	}),
	owned("wearable_daily_summaries", "explicit", {
		note: "Prod-only table (stub migration 20260420210411); FK behaviour unverifiable here.",
	}),
	owned("earned_badges", "cascade"),
	owned("gamification_stats", "cascade"),
	owned("rpg_attributes", "cascade"),
	owned("user_insights", "cascade"),
	// Community
	owned("shared_routines", "set_null"),
	owned("shared_cycles", "set_null"),
	owned("community_comments", "set_null"),
	owned("community_votes", "cascade"),
	owned("saved_community_items", "cascade"),
	owned("challenge_participants", "cascade"),
	{
		table: "creator_follows",
		ownership: { kind: "column", column: "follower_id" },
		keyColumns: ID,
		purge: "cascade",
		note: "The user's own follows. Rows where another user follows them (followed_id) also cascade on delete but are not exported: they identify third parties.",
	},
	{
		table: "user_blocks",
		ownership: { kind: "column", column: "blocker_id" },
		keyColumns: ID,
		purge: "cascade",
		note: "The user's own blocks. Who blocked the user is not disclosed (blocked_id rows still cascade on delete).",
	},
	{
		table: "content_reports",
		ownership: { kind: "column", column: "reporter_id" },
		keyColumns: ID,
		purge: "cascade",
		note: "Reports the user filed. Reporters of the user's content are not disclosed.",
	},
	// Integrations
	owned("user_integrations", "cascade", {
		note: "Connection metadata only; credentials live in oauth_tokens (EXCLUDED).",
	}),
	owned("external_activities", "cascade"),
	owned("sync_queue", "cascade"),
];

/**
 * User-linked tables that are deliberately not exported. Each still states how
 * account deletion removes its rows.
 */
export const EXCLUDED: readonly ExcludedUserDataTable[] = [
	{
		table: "oauth_tokens",
		reason: "Provider access/refresh tokens and API keys are credentials, not user content; connection metadata is exported via user_integrations.",
		purge: "cascade",
	},
	{
		table: "oauth_states",
		reason: "Short-lived OAuth CSRF state rows; transient operational data.",
		purge: "cascade",
	},
	{
		table: "rate_limit_tracking",
		reason: "Transient operational request counters (R-31 decision: purged, not exported).",
		purge: "explicit",
		purgeMatch: "user_id = uid",
	},
	{
		table: "paddle_webhook_events",
		reason: "Raw Paddle provider payloads (R-31 decision: purged, not exported). Billing history is exported via subscriptions and subscription_events; Paddle, as merchant of record, keeps its own tax records.",
		purge: "explicit",
		purgeMatch:
			"user_id = uid if that column exists, otherwise payload->'data'->'custom_data'->>'user_id' = uid",
	},
];

const MANIFEST_BY_TABLE: ReadonlyMap<string, UserDataTable> = new Map(
	USER_DATA_MANIFEST.map((entry) => [entry.table, entry]),
);

/** Exportable table names, in manifest order. */
export const USER_DATA_EXPORT_TABLES: readonly string[] =
	USER_DATA_MANIFEST.map((entry) => entry.table);

export function getUserDataTable(table: string): UserDataTable | undefined {
	return MANIFEST_BY_TABLE.get(table);
}
