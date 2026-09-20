/**
 * Manifest completeness (R-31): every table holding a user's data must be in
 * USER_DATA_MANIFEST (exported) or EXCLUDED (with a reason).
 *
 * Discovery sources:
 *   1. supabase/migrations/*.sql, including DDL inside DO blocks: tables with
 *      a `user_id` column, a `REFERENCES auth.users` FK, or (transitively) an
 *      FK to such a table. Limitation: DDL built dynamically in `EXECUTE`
 *      strings or inside function bodies is not parsed.
 *   2. src/lib/database.types.ts: tables whose Row has `user_id`. This used to
 *      catch prod tables whose migration is only a stub. Since PR 4 the file is
 *      generated from the MIGRATED local schema (`npm run gen:types:local`), so
 *      it no longer records prod's shape and this source adds nothing that
 *      source 1 misses. Prod's own shape is evidenced outside the repo
 *      (prod-evidence.md, as cited throughout userDataManifest.ts).
 *   2. src/lib/database.types.ts (generated from the clean migrated schema):
 *      tables whose Row has `user_id`. This catches migration DDL shapes the
 *      lightweight SQL parser does not understand.
 *
 * Merge-order note: TABLES_WITHOUT_MIGRATION_DDL lists subscription_events
 * (DDL from PR 2) and sync_tombstones (DDL from PR 16). When their DDL lands,
 * this test only warns; remove the entry then so the column checks apply.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	EXCLUDED,
	NON_TABLE_SOURCES,
	USER_DATA_MANIFEST,
	type UserDataPurge,
	type UserDataTable,
} from "../../supabase/functions/_shared/userDataManifest.ts";
import {
	discoverUserOwnedTables,
	parseMigrations,
	tableRowColumnsFromTypes,
} from "./helpers/migrationSchema.ts";

function missingFromManifest(owned: Map<string, string>): string[] {
	const covered = new Set([
		...USER_DATA_MANIFEST.map((entry) => entry.table),
		...EXCLUDED.map((entry) => entry.table),
	]);
	return [...owned.keys()].filter((table) => !covered.has(table)).sort();
}

const migrationsDir = join(process.cwd(), "supabase/migrations");
const migrationTexts = readdirSync(migrationsDir)
	.filter((file) => file.endsWith(".sql"))
	.sort()
	.map((file) => readFileSync(join(migrationsDir, file), "utf8"));
const schema = parseMigrations(migrationTexts);
const typeColumns = tableRowColumnsFromTypes(
	readFileSync(join(process.cwd(), "src/lib/database.types.ts"), "utf8"),
);
const typeUserIdTables = [...typeColumns]
	.filter(([, columns]) => columns.has("user_id"))
	.map(([table]) => table);

/**
 * Manifest/EXCLUDED tables with no DDL on this branch. Each must be named
 * here (and be `mayBeAbsent`) so a typo cannot hide behind "not in
 * migrations".
 */
const TABLES_WITHOUT_MIGRATION_DDL: Record<string, string> = {
	// Empty on this branch: PR 2 (20260920000200) captured subscription_events,
	// paddle_webhook_events, goal_snapshots, overload_suggestions,
	// telemetry_analysis and wearable_daily_summaries, and PR 16
	// (20260920001600) creates sync_tombstones, so every manifest and EXCLUDED
	// table is now parseable from the migrations and the column checks apply to
	// all of them. Add an entry here only for a table that genuinely has no
	// DDL on the branch.
	subscription_events: "prod table; captured into migrations by PR 2",
	sync_tombstones: "created by PR 16",
	paddle_webhook_events: "prod table; no migration",
	goal_snapshots: "prod table; stub migration 20260420210411",
	overload_suggestions: "prod table; stub migration 20260420210411",
	telemetry_analysis: "prod table; stub migration 20260420210411",
	wearable_daily_summaries: "prod table; stub migration 20260420210411",
};

const CREDENTIAL_COLUMN = /token|api_key|secret|password/;

function ownershipColumn(entry: UserDataTable): string {
	return entry.ownership.kind === "column"
		? entry.ownership.column
		: entry.ownership.fkColumn;
}

/**
 * The purge behaviour the parsed FKs actually give, or null if unknown: the
 * ownership column's FK to auth.users, else an ON DELETE CASCADE FK to a
 * manifest table that itself cascades.
 */
function derivedPurge(
	table: string,
	column: string,
	seen = new Set<string>(),
): UserDataPurge | null {
	const parsed = schema.get(table);
	if (!parsed || seen.has(table)) return null;
	seen.add(table);
	const own = parsed.fks.find(
		(fk) => fk.columns.includes(column) && fk.ref === "auth.users",
	);
	if (own?.onDelete === "cascade") return "cascade";
	if (own?.onDelete === "set null") return "set_null";
	for (const fk of parsed.fks) {
		if (!fk.ref.startsWith("public.") || fk.onDelete !== "cascade") continue;
		const parentTable = fk.ref.slice(7);
		const parent = USER_DATA_MANIFEST.find((e) => e.table === parentTable);
		if (
			parent &&
			derivedPurge(parentTable, ownershipColumn(parent), new Set(seen)) ===
				"cascade"
		) {
			return "cascade";
		}
	}
	return null;
}

describe("user data manifest (R-31)", () => {
	const owned = discoverUserOwnedTables(schema, typeUserIdTables);

	it("parses the migrations it depends on", () => {
		// Sanity: if the parser regresses, discovery would silently shrink.
		for (const table of [
			"workout_sessions",
			"local_profile_preferences",
			"rate_limit_tracking",
			"routine_exercises",
			"cycle_days",
			"exercise_catalog",
		]) {
			expect(owned.has(table), table).toBe(true);
		}
		expect(owned.get("routine_exercises")).toBe("FK to routines");
		// Was "user_id in database.types.ts": PR 2 captured this table's DDL, so
		// migration discovery now finds it first. The types-only discovery path
		// is still exercised by any prod table whose migration is a stub.
		expect(owned.has("wearable_daily_summaries")).toBe(true);
		expect(owned.has("challenges")).toBe(false);
		expect(owned.has("community_benchmarks")).toBe(false);
		expect(owned.size).toBeGreaterThanOrEqual(45);
		// Prod-only tables are declared explicitly below and are intentionally
		// absent from the canonical clean-migration type snapshot.
		expect(owned.has("wearable_daily_summaries")).toBe(false);
		expect(owned.size).toBeGreaterThanOrEqual(40);
		expect(schema.get("routines")?.uniques.get("routines_pkey")).toEqual([
			"id",
		]);
		expect(
			schema
				.get("local_profile_preferences")
				?.uniques.get("local_profile_preferences_pkey"),
		).toEqual(["user_id", "local_profile_id"]);
	});

	it("covers every user-owned table in the manifest or EXCLUDED", () => {
		expect(missingFromManifest(owned)).toEqual([]);
	});

	it("fails when a dummy user-owned table is added to the migrations", () => {
		const withDummy = parseMigrations([
			...migrationTexts,
			`CREATE TABLE IF NOT EXISTS public.zz_dummy_owned (
				id uuid PRIMARY KEY,
				user_id uuid NOT NULL
			);
			CREATE TABLE zz_dummy_fk (
				id uuid PRIMARY KEY,
				owner uuid REFERENCES auth.users(id) ON DELETE CASCADE
			);
			CREATE TABLE zz_dummy_child (
				id uuid PRIMARY KEY,
				parent_id uuid REFERENCES public.zz_dummy_fk(id)
			);
			CREATE TABLE zz_dummy_global (id uuid PRIMARY KEY, label text);`,
		]);
		expect(
			missingFromManifest(discoverUserOwnedTables(withDummy, typeUserIdTables)),
		).toEqual(["zz_dummy_child", "zz_dummy_fk", "zz_dummy_owned"]);
	});

	it("finds user-owned DDL inside DO blocks but not inside function bodies", () => {
		const withDoBlocks = parseMigrations([
			...migrationTexts,
			`CREATE TABLE zz_do_later (id uuid PRIMARY KEY, label text);
			DO $$
			BEGIN
				IF NOT EXISTS (SELECT 1 FROM information_schema.columns
					WHERE table_name = 'zz_do_later' AND column_name = 'user_id') THEN
					ALTER TABLE zz_do_later ADD COLUMN user_id uuid;
				END IF;
			END $$;
			DO $body$ BEGIN
				CREATE TABLE IF NOT EXISTS zz_do_created (
					id uuid PRIMARY KEY,
					owner uuid REFERENCES auth.users(id)
				);
			END $body$;
			CREATE OR REPLACE FUNCTION zz_fn() RETURNS void LANGUAGE plpgsql AS $$
			BEGIN
				CREATE TABLE zz_fn_table (id uuid PRIMARY KEY, user_id uuid);
			END $$;`,
		]);
		const found = missingFromManifest(
			discoverUserOwnedTables(withDoBlocks, typeUserIdTables),
		);
		expect(found).toEqual(["zz_do_created", "zz_do_later"]);
	});

	it("fails when a user-owned table only appears in the generated types", () => {
		expect(
			missingFromManifest(
				discoverUserOwnedTables(schema, [...typeUserIdTables, "zz_prod_only"]),
			),
		).toEqual(["zz_prod_only"]);
	});

	it("has unique tables, key columns, reasons and structured purge rules", () => {
		const names = [
			...USER_DATA_MANIFEST.map((e) => e.table),
			...EXCLUDED.map((e) => e.table),
			...NON_TABLE_SOURCES.map((s) => s.source),
		];
		expect(new Set(names).size).toBe(names.length);
		for (const entry of USER_DATA_MANIFEST) {
			expect(entry.keyColumns.length, entry.table).toBeGreaterThan(0);
			for (const column of entry.keyColumns) {
				expect(entry.columns, `${entry.table}.${column}`).toContain(column);
			}
		}
		for (const entry of EXCLUDED) {
			expect(entry.reason.length, entry.table).toBeGreaterThan(20);
			expect(entry.purgeMatch.column, entry.table).toBeTruthy();
		}
	});

	it("names every listed table that has no migration DDL and marks it mayBeAbsent", () => {
		const entries = [...USER_DATA_MANIFEST, ...EXCLUDED];
		const undeclared = entries
			.map((e) => e.table)
			.filter(
				(table) =>
					!schema.has(table) && !(table in TABLES_WITHOUT_MIGRATION_DDL),
			);
		expect(undeclared).toEqual([]);
		for (const entry of entries) {
			if (!schema.has(entry.table)) {
				expect(entry.mayBeAbsent, `${entry.table} needs mayBeAbsent`).toBe(
					true,
				);
			}
		}
		for (const table of Object.keys(TABLES_WITHOUT_MIGRATION_DDL)) {
			if (schema.has(table)) {
				// Merge-order tolerant (PR 2 / PR 16): warn, don't fail.
				console.warn(
					`[user-data-manifest] ${table} now has migration DDL; remove it from TABLES_WITHOUT_MIGRATION_DDL (and mayBeAbsent once it is in prod).`,
				);
			}
		}
	});

	// PR 4 (7f87b880) regenerated src/lib/database.types.ts from the MIGRATED
	// local schema, so it is no longer a record of prod's shape: the two rules
	// this test used to run against it ("optional but not in prod types" and
	// "exists in prod types only; add to optionalColumns") now only report the
	// migration/prod drift that optionalColumns exists to tolerate. The prod
	// oracle is the operator's own read (prod-evidence.md) — not this file.
	it("exports exactly the migrated columns, plus prod-only drift columns as optional", () => {
	it("exports exactly the migrated columns and keeps prod-only drift columns optional", () => {
		const problems: string[] = [];
		for (const entry of USER_DATA_MANIFEST) {
			const parsed = schema.get(entry.table);
			const types = typeColumns.get(entry.table);
			const optional = entry.optionalColumns ?? [];
			if (parsed) {
				const listed = new Set(entry.columns);
				for (const column of parsed.columns) {
					if (!listed.has(column))
						problems.push(`${entry.table}.${column} not exported`);
				}
				for (const column of entry.columns) {
					if (!parsed.columns.has(column))
						problems.push(`${entry.table}.${column} not in migrations`);
				}
				for (const column of optional) {
					if (parsed.columns.has(column))
						problems.push(
							`${entry.table}.${column} is migrated; move to columns`,
						);
					// database.types.ts is generated from a clean migrated schema, so
					// production-only drift columns are expected to be absent from it.
				}
				for (const column of types ?? []) {
					if (!parsed.columns.has(column) && !optional.includes(column)) {
						problems.push(
							`${entry.table}.${column} exists in prod types only; add to optionalColumns`,
						);
					}
				}
			} else if (types) {
				for (const column of types) {
					if (!entry.columns.includes(column))
						problems.push(`${entry.table}.${column} (prod) not exported`);
				}
			}
		}
		expect(problems).toEqual([]);
	});

	it("never exports credential-like columns (explicit column lists)", () => {
		for (const entry of USER_DATA_MANIFEST) {
			const exported = [...entry.columns, ...(entry.optionalColumns ?? [])];
			expect(
				exported.filter((column) => CREDENTIAL_COLUMN.test(column)),
				entry.table,
			).toEqual([]);
		}
		for (const source of NON_TABLE_SOURCES) {
			expect(
				source.fields.filter((field) => CREDENTIAL_COLUMN.test(field)),
				source.source,
			).toEqual([]);
		}
	});

	it("keys every table by NOT NULL columns covering a primary key or unique constraint", () => {
		const problems: string[] = [];
		for (const entry of USER_DATA_MANIFEST) {
			const parsed = schema.get(entry.table);
			if (!parsed) continue;
			const scope = new Set([ownershipColumn(entry), ...entry.keyColumns]);
			const covered = [...parsed.uniques.values()].some(
				(unique) =>
					unique.every((column) => scope.has(column)) &&
					entry.keyColumns.every((column) => unique.includes(column)),
			);
			if (!covered) problems.push(`${entry.table}: key not unique`);
			for (const column of entry.keyColumns) {
				if (!parsed.notNull.has(column))
					problems.push(`${entry.table}.${column} nullable`);
			}
			if (entry.ownership.kind === "parent") {
				const { fkColumn, parentTable, parentColumn } = entry.ownership;
				if (
					!parsed.fks.some(
						(fk) =>
							fk.columns.includes(fkColumn) &&
							fk.ref === `public.${parentTable}`,
					)
				) {
					problems.push(`${entry.table}.${fkColumn} -> ${parentTable} missing`);
				}
				if (!schema.get(parentTable)?.columns.has(parentColumn)) {
					problems.push(`${parentTable}.${parentColumn} missing`);
				}
			} else if (!parsed.columns.has(entry.ownership.column)) {
				problems.push(`${entry.table}.${entry.ownership.column} missing`);
			}
		}
		expect(problems).toEqual([]);
	});

	it("rejects a non-unique or nullable key", () => {
		const parsed = parseMigrations([
			"CREATE TABLE zz_k (id uuid PRIMARY KEY, user_id uuid, created_at timestamptz);",
		]).get("zz_k");
		expect(parsed?.uniques.get("zz_k_pkey")).toEqual(["id"]);
		expect(parsed?.notNull.has("id")).toBe(true);
		expect(parsed?.notNull.has("created_at")).toBe(false);
		expect(
			[...(parsed?.uniques.values() ?? [])].some((u) =>
				u.includes("created_at"),
			),
		).toBe(false);
	});

	it("declares purge behaviour the schema actually provides", () => {
		const entries: Array<{ table: string; column: string; purge: string }> = [
			...USER_DATA_MANIFEST.map((e) => ({
				table: e.table,
				column: ownershipColumn(e),
				purge: e.purge,
			})),
			...EXCLUDED.map((e) => ({
				table: e.table,
				column: e.purgeMatch.column,
				purge: e.purge,
			})),
		];
		const wrong: string[] = [];
		for (const { table, column, purge } of entries) {
			if (purge === "explicit") continue; // always safe
			const actual = derivedPurge(table, column);
			if (actual !== purge) {
				wrong.push(`${table}: declared ${purge}, schema gives ${actual}`);
			}
		}
		expect(wrong).toEqual([]);
	});

	it("records the R-31 decisions", () => {
		const excluded = new Map(EXCLUDED.map((e) => [e.table, e]));
		const exported = new Map(USER_DATA_MANIFEST.map((e) => [e.table, e]));
		expect(exported.get("subscription_events")?.purge).toBe("explicit");
		expect(exported.get("sync_tombstones")?.keyColumns).toEqual([
			"entity",
			"entity_id",
		]);
		expect(exported.get("sync_tombstones")?.purge).toBe("explicit");
		expect(excluded.get("paddle_webhook_events")?.purge).toBe("explicit");
		expect(excluded.get("paddle_webhook_events")?.purgeMatch).toEqual({
			column: "user_id",
			json: { column: "payload", path: ["data", "custom_data", "user_id"] },
		});
		expect(excluded.get("rate_limit_tracking")?.purge).toBe("explicit");
		expect(excluded.get("rate_limit_tracking")?.purgeMatch).toEqual({
			column: "user_id",
		});
		for (const table of [
			"local_profiles",
			"local_profile_preferences",
			"session_phase_statistics",
			"exercise_signatures",
			"vbt_assessments",
			"user_insights",
			"exercise_catalog",
			"external_activities",
			"gamification_stats",
		]) {
			expect(exported.has(table), table).toBe(true);
		}
		expect(exported.has("oauth_tokens")).toBe(false);
		expect(NON_TABLE_SOURCES.map((s) => s.source)).toEqual([
			"auth_account",
			"storage_avatars",
		]);
	});
});
