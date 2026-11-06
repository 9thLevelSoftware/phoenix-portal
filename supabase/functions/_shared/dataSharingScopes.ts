/**
 * Data sharing (outbound webhooks): what a user may send to an endpoint of
 * their choosing, and what never leaves that way.
 *
 * Pure data with no imports, so the SPA can read the scope list for its
 * settings form and the Edge worker can read the entity shapes for its
 * payload builder from the same place.
 *
 * Three things must agree, and tests/security/data-sharing-scopes.test.ts
 * fails when they do not:
 *   - this file;
 *   - private.webhook_entity_sources in
 *     supabase/migrations/20261106120000_webhook_data_sharing.sql, which
 *     drives the capture triggers and the backfill;
 *   - USER_DATA_MANIFEST (userDataManifest.ts): every manifest table is either
 *     part of an entity here or listed in NOT_SHAREABLE with a reason, so a
 *     new user table forces a decision instead of defaulting either way.
 *
 * Payload fields are the manifest's column lists. The manifest test that
 * forbids credential-like column names therefore guards webhook payloads too.
 */

export const DATA_SHARING_SCOPES = [
	"workouts",
	"personal_records",
	"routines",
	"cycles",
	"goals",
	"progress",
	"achievements",
	"external_activities",
	"profile",
] as const;

export type DataSharingScope = (typeof DATA_SHARING_SCOPES)[number];

/** The tier that unlocks data sharing. Enforced server-side (FP-2). */
export const DATA_SHARING_MIN_TIER = "FLAME" as const;

/** Endpoints one user may register. Mirrors create_webhook_endpoint. */
export const MAX_WEBHOOK_ENDPOINTS = 3;

export interface DataSharingScopeInfo {
	scope: DataSharingScope;
	label: string;
	description: string;
}

/** User-facing copy for the settings form, in display order. */
export const DATA_SHARING_SCOPE_INFO: readonly DataSharingScopeInfo[] = [
	{
		scope: "workouts",
		label: "Workouts",
		description:
			"Sessions with their exercises, sets and rep summaries. Loads are per cable, as on the phone. Raw force-curve telemetry is not included.",
	},
	{
		scope: "personal_records",
		label: "Personal records",
		description: "Max weight, max volume and 1RM records, including deletions.",
	},
	{
		scope: "routines",
		label: "Routines",
		description: "Routine definitions and their exercises, including deletions.",
	},
	{
		scope: "cycles",
		label: "Training cycles",
		description: "Cycle definitions and their days, including deletions.",
	},
	{
		scope: "goals",
		label: "Goals",
		description: "Your goals and their status.",
	},
	{
		scope: "progress",
		label: "Exercise progress",
		description:
			"Per-session progress snapshots for each exercise, including the estimated 1RM.",
	},
	{
		scope: "achievements",
		label: "Achievements",
		description: "Earned badges, lifetime stats and RPG attributes.",
	},
	{
		scope: "external_activities",
		label: "Imported activities",
		description:
			"Activities imported from connected apps. Activities imported from Strava are not shared.",
	},
	{
		scope: "profile",
		label: "Profile",
		description: "Display name, units and preferences, and your local profiles.",
	},
];

/**
 * A table whose rows travel inside the parent entity's payload. `parent` is
 * the entity's own table or another child, `fkColumn` the child column that
 * holds that parent's `id`.
 */
export interface DataSharingChild {
	table: string;
	parent: string;
	fkColumn: string;
	/**
	 * Set when the table has no capture trigger of its own: the sibling table
	 * whose trigger covers its changes, because the two are only ever written
	 * together. Left out when the table is itself a capture source.
	 */
	capturedThrough?: string;
}

export interface DataSharingEntity {
	/** Name in the event type: `<entity>.updated` / `<entity>.deleted`. */
	entity: string;
	scope: DataSharingScope;
	table: string;
	idColumn: string;
	/** Column holding the owner. Every read filters on it. */
	userColumn: string;
	/** A row with this column set is reported as deleted. */
	softDeleteColumn?: string;
	/** A row whose column equals the value is never shared. */
	exclude?: { column: string; equals: string; reason: string };
	children: readonly DataSharingChild[];
}

export const DATA_SHARING_ENTITIES: readonly DataSharingEntity[] = [
	{
		entity: "workout",
		scope: "workouts",
		table: "workout_sessions",
		idColumn: "id",
		userColumn: "user_id",
		children: [
			{ table: "exercises", parent: "workout_sessions", fkColumn: "session_id" },
			// No browser role can write sets or rep summaries, and every server
			// writer rewrites `exercises` in the same call (pgTAP guards the
			// grant), so the `exercises` trigger captures their changes too.
			{
				table: "sets",
				parent: "exercises",
				fkColumn: "exercise_id",
				capturedThrough: "exercises",
			},
			{
				table: "rep_summaries",
				parent: "sets",
				fkColumn: "set_id",
				capturedThrough: "exercises",
			},
		],
	},
	{
		entity: "personal_record",
		scope: "personal_records",
		table: "personal_records",
		idColumn: "id",
		userColumn: "user_id",
		softDeleteColumn: "deleted_at",
		children: [],
	},
	{
		entity: "routine",
		scope: "routines",
		table: "routines",
		idColumn: "id",
		userColumn: "user_id",
		children: [
			{ table: "routine_exercises", parent: "routines", fkColumn: "routine_id" },
		],
	},
	{
		entity: "cycle",
		scope: "cycles",
		table: "training_cycles",
		idColumn: "id",
		userColumn: "user_id",
		children: [
			{ table: "cycle_days", parent: "training_cycles", fkColumn: "cycle_id" },
		],
	},
	{
		entity: "goal",
		scope: "goals",
		table: "user_goals",
		idColumn: "id",
		userColumn: "user_id",
		children: [],
	},
	{
		entity: "exercise_progress",
		scope: "progress",
		table: "exercise_progress",
		idColumn: "id",
		userColumn: "user_id",
		children: [],
	},
	{
		entity: "badge",
		scope: "achievements",
		table: "earned_badges",
		idColumn: "id",
		userColumn: "user_id",
		children: [],
	},
	{
		entity: "gamification_stats",
		scope: "achievements",
		table: "gamification_stats",
		idColumn: "id",
		userColumn: "user_id",
		children: [],
	},
	{
		entity: "rpg_attributes",
		scope: "achievements",
		table: "rpg_attributes",
		idColumn: "id",
		userColumn: "user_id",
		children: [],
	},
	{
		entity: "external_activity",
		scope: "external_activities",
		table: "external_activities",
		idColumn: "id",
		userColumn: "user_id",
		exclude: {
			column: "provider",
			equals: "strava",
			reason:
				"Strava's API terms restrict onward disclosure of Strava data to third parties.",
		},
		children: [],
	},
	{
		entity: "profile",
		scope: "profile",
		table: "profiles",
		idColumn: "id",
		// profiles.id is the auth user id.
		userColumn: "id",
		children: [],
	},
	{
		entity: "local_profile",
		scope: "profile",
		table: "local_profiles",
		idColumn: "id",
		userColumn: "user_id",
		children: [],
	},
];

/** Columns never copied into a payload, whatever the manifest lists. */
export const DATA_SHARING_OMITTED_COLUMNS: Readonly<Record<string, readonly string[]>> = {
	// The user's own Stripe/Paddle customer id is in the GDPR export on
	// purpose (R-13), but a third-party endpoint has no use for it.
	profiles: ["stripe_customer_id", "feature_flags", "digest_last_sent_at"],
};

/**
 * Manifest tables that are deliberately not shared. Each entry says why, so
 * the decision is reviewable. Anything new in USER_DATA_MANIFEST must be added
 * either to an entity above or here.
 */
export const NOT_SHAREABLE: Readonly<Record<string, string>> = {
	// Size and tier
	rep_telemetry:
		"Raw force-curve samples: megabytes per session, and INFERNO-gated for reads.",
	session_phase_statistics:
		"INFERNO-gated biomechanics; a FLAME endpoint must not carry data its owner cannot read in the portal.",
	vbt_assessments:
		"INFERNO-gated biomechanics; a FLAME endpoint must not carry data its owner cannot read in the portal.",
	exercise_signatures:
		"INFERNO-gated biomechanics; a FLAME endpoint must not carry data its owner cannot read in the portal.",
	telemetry_analysis: "Derived from raw telemetry; prod-only table.",
	// Account, billing and consent state
	subscriptions: "Billing state, not training data.",
	subscription_events: "Billing audit trail.",
	deletion_requests: "Account lifecycle state.",
	user_onboarding: "Portal onboarding state.",
	local_profile_preferences:
		"Device settings (LED, rack, VBT preferences); not training data.",
	// Sync bookkeeping
	profile_ownership_claims: "Internal sync bookkeeping.",
	profile_ownership_events: "Internal sync bookkeeping.",
	profile_ownership_transfers: "Internal sync bookkeeping.",
	training_cycle_deletion_tombstones:
		"Internal sync bookkeeping; deletions are sent as cycle.deleted events.",
	workout_deletion_tombstones:
		"Internal sync bookkeeping; deletions are sent as workout.deleted events.",
	sync_tombstones:
		"Internal sync bookkeeping; deletions are sent as <entity>.deleted events.",
	sync_queue: "Internal provider-sync queue.",
	user_integrations: "Connection metadata for other providers.",
	// Derived or regenerated wholesale
	user_insights:
		"Regenerated wholesale every 15 minutes; every pass would re-send every insight.",
	leaderboard_snapshots:
		"Rebuilt every 15 minutes; ranks are relative to other users.",
	goal_snapshots: "Prod-only derived table.",
	overload_suggestions: "Prod-only derived table.",
	wearable_daily_summaries: "Prod-only table; provider terms not reviewed.",
	exercise_catalog:
		"Custom exercise definitions; not in the first version (no change stream requested).",
	// Community: rows that reference other users or are already public
	shared_routines: "Already published to the community.",
	shared_cycles: "Already published to the community.",
	community_comments: "Community content; references other users' items.",
	community_votes: "References other users' items.",
	saved_community_items: "References other users' items.",
	challenge_participants: "Community participation state.",
	creator_follows: "References other users.",
	user_blocks: "References other users.",
	content_reports: "References other users.",
	// This feature's own tables
	webhook_endpoints: "The sharing configuration itself.",
	webhook_deliveries: "The delivery log itself.",
};

const ENTITY_BY_NAME: ReadonlyMap<string, DataSharingEntity> = new Map(
	DATA_SHARING_ENTITIES.map((entry) => [entry.entity, entry]),
);

export function getDataSharingEntity(
	entity: string,
): DataSharingEntity | undefined {
	return ENTITY_BY_NAME.get(entity);
}

export function isDataSharingScope(value: unknown): value is DataSharingScope {
	return (
		typeof value === "string" &&
		(DATA_SHARING_SCOPES as readonly string[]).includes(value)
	);
}
