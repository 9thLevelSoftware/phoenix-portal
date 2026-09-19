/**
 * Manifest completeness (R-31): every table holding a user's data must be in
 * USER_DATA_MANIFEST (exported) or EXCLUDED (with a reason).
 *
 * Discovery sources:
 *   1. supabase/migrations/*.sql: tables with a `user_id` column, a
 *      `REFERENCES auth.users` FK, or (transitively) an FK to such a table.
 *   2. src/lib/database.types.ts (generated from prod): tables whose Row has
 *      `user_id`. This catches prod tables whose migration is only a stub
 *      (e.g. 20260420210411_comprehensive_dashboard_drift_reconciliation.sql).
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	EXCLUDED,
	USER_DATA_MANIFEST,
	type UserDataPurge,
	type UserDataTable,
} from "../../supabase/functions/_shared/userDataManifest.ts";

interface ForeignKey {
	name: string;
	columns: string[];
	/** schema-qualified, e.g. `auth.users` or `public.routines` */
	ref: string;
	onDelete: string;
}

interface ParsedTable {
	columns: Set<string>;
	fks: ForeignKey[];
}

type Schema = Map<string, ParsedTable>;

const IDENT = String.raw`"?(\w+)"?`;
const QUALIFIED = String.raw`(?:"?(\w+)"?\.)?"?(\w+)"?`;

function stripSql(sql: string): string {
	return sql
		.replace(/\$(\w*)\$[\s\S]*?\$\1\$/g, "''")
		.replace(/--[^\n]*/g, "")
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/'(?:[^']|'')*'/g, "''");
}

function norm(name: string): string {
	return name.toLowerCase();
}

function splitTopLevel(body: string): string[] {
	const parts: string[] = [];
	let depth = 0;
	let current = "";
	for (const ch of body) {
		if (ch === "(") depth++;
		if (ch === ")") depth--;
		if (ch === "," && depth === 0) {
			parts.push(current);
			current = "";
		} else {
			current += ch;
		}
	}
	if (current.trim()) parts.push(current);
	return parts.map((part) => part.trim());
}

function parseReference(
	clause: string,
): { ref: string; onDelete: string } | null {
	const match = new RegExp(String.raw`\breferences\s+${QUALIFIED}`, "i").exec(
		clause,
	);
	if (!match) return null;
	const onDelete =
		/\bon\s+delete\s+(cascade|set\s+null|set\s+default|restrict|no\s+action)/i
			.exec(clause)?.[1]
			.toLowerCase()
			.replace(/\s+/, " ") ?? "no action";
	return {
		ref: `${norm(match[1] ?? "public")}.${norm(match[2])}`,
		onDelete,
	};
}

function parseListColumns(list: string): string[] {
	return list.split(",").map((c) => norm(c.trim().replace(/"/g, "")));
}

/** Handles one column definition or table constraint (CREATE or ALTER ADD). */
function applyElement(
	tableName: string,
	table: ParsedTable,
	element: string,
): void {
	const fkConstraint = new RegExp(
		String.raw`^(?:constraint\s+${IDENT}\s+)?foreign\s+key\s*\(([^)]*)\)`,
		"i",
	).exec(element);
	if (fkConstraint) {
		const reference = parseReference(element);
		if (reference) {
			const columns = parseListColumns(fkConstraint[2]);
			table.fks.push({
				name: norm(fkConstraint[1] ?? `${tableName}_${columns[0]}_fkey`),
				columns,
				...reference,
			});
		}
		return;
	}
	if (/^(constraint|primary|unique|check|exclude|like)\b/i.test(element)) {
		return;
	}
	const column = new RegExp(`^${IDENT}`).exec(element);
	if (!column) return;
	const name = norm(column[1]);
	table.columns.add(name);
	const reference = parseReference(element);
	if (reference) {
		table.fks.push({
			name: `${tableName}_${name}_fkey`,
			columns: [name],
			...reference,
		});
	}
}

function parseMigrations(sqlTexts: string[]): Schema {
	const schema: Schema = new Map();
	const createTable = new RegExp(
		String.raw`^create\s+(?:unlogged\s+)?table\s+(?:if\s+not\s+exists\s+)?${QUALIFIED}\s*\(([\s\S]*)\)`,
		"i",
	);
	const alterTable = new RegExp(
		String.raw`^alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?${QUALIFIED}\s+([\s\S]*)$`,
		"i",
	);
	const dropTable = new RegExp(
		String.raw`^drop\s+table\s+(?:if\s+exists\s+)?${QUALIFIED}`,
		"i",
	);
	for (const text of sqlTexts) {
		for (const raw of stripSql(text).split(";")) {
			const statement = raw.trim();
			let match = createTable.exec(statement);
			if (match) {
				if (match[1] && norm(match[1]) !== "public") continue;
				const name = norm(match[2]);
				const table = schema.get(name) ?? { columns: new Set(), fks: [] };
				schema.set(name, table);
				for (const element of splitTopLevel(match[3])) {
					applyElement(name, table, element);
				}
				continue;
			}
			match = alterTable.exec(statement);
			if (match) {
				if (match[1] && norm(match[1]) !== "public") continue;
				const tableName = norm(match[2]);
				const table = schema.get(tableName);
				if (!table) continue;
				for (const action of splitTopLevel(match[3])) {
					const add = /^add\s+(?:column\s+)?(?:if\s+not\s+exists\s+)?/i.exec(
						action,
					);
					if (add) {
						applyElement(tableName, table, action.slice(add[0].length).trim());
						continue;
					}
					const dropConstraint = new RegExp(
						String.raw`^drop\s+constraint\s+(?:if\s+exists\s+)?${IDENT}`,
						"i",
					).exec(action);
					if (dropConstraint) {
						const constraint = norm(dropConstraint[1]);
						table.fks = table.fks.filter((fk) => fk.name !== constraint);
						continue;
					}
					const drop = new RegExp(
						String.raw`^drop\s+column\s+(?:if\s+exists\s+)?${IDENT}`,
						"i",
					).exec(action);
					if (drop) {
						const column = norm(drop[1]);
						table.columns.delete(column);
						table.fks = table.fks.filter((fk) => !fk.columns.includes(column));
					}
				}
				continue;
			}
			match = dropTable.exec(statement);
			if (match && (!match[1] || norm(match[1]) === "public")) {
				schema.delete(norm(match[2]));
			}
		}
	}
	return schema;
}

/** Tables whose generated Row type has a `user_id` field. */
function userIdTablesFromTypes(source: string): Set<string> {
	const start = source.indexOf("Tables: {");
	const end = source.indexOf("Views: {", start);
	const lines = source.slice(start, end).split("\n");
	const tables = new Set<string>();
	let current: string | null = null;
	let inRow = false;
	for (const line of lines) {
		const table = /^\t\t\t(\w+): \{$/.exec(line);
		if (table) {
			current = table[1];
			inRow = false;
			continue;
		}
		if (/^\t\t\t\tRow: \{$/.test(line)) inRow = true;
		else if (/^\t\t\t\t\}/.test(line)) inRow = false;
		else if (inRow && current && /^\t\t\t\t\tuser_id\??:/.test(line)) {
			tables.add(current);
		}
	}
	return tables;
}

/** table -> why it counts as user-owned */
function discoverUserOwnedTables(
	schema: Schema,
	typeUserIdTables: Iterable<string> = [],
): Map<string, string> {
	const owned = new Map<string, string>();
	for (const [name, table] of schema) {
		if (table.columns.has("user_id")) owned.set(name, "user_id column");
		else if (table.fks.some((fk) => fk.ref === "auth.users")) {
			owned.set(name, "FK to auth.users");
		}
	}
	for (const name of typeUserIdTables) {
		if (!owned.has(name)) owned.set(name, "user_id in database.types.ts");
	}
	let changed = true;
	while (changed) {
		changed = false;
		for (const [name, table] of schema) {
			if (owned.has(name)) continue;
			const parent = table.fks.find(
				(fk) => fk.ref.startsWith("public.") && owned.has(fk.ref.slice(7)),
			);
			if (parent) {
				owned.set(name, `FK to ${parent.ref.slice(7)}`);
				changed = true;
			}
		}
	}
	return owned;
}

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
const typeTables = userIdTablesFromTypes(
	readFileSync(join(process.cwd(), "src/lib/database.types.ts"), "utf8"),
);

/**
 * Manifest/EXCLUDED tables with no DDL on this branch. Each must be named
 * here so a typo in the manifest cannot hide behind "not in migrations".
 */
const TABLES_WITHOUT_MIGRATION_DDL: Record<string, string> = {
	subscription_events: "prod table; captured into migrations by PR 2",
	sync_tombstones: "created by PR 16",
	paddle_webhook_events: "prod table; no migration",
	goal_snapshots: "prod table; stub migration 20260420210411",
	overload_suggestions: "prod table; stub migration 20260420210411",
	telemetry_analysis: "prod table; stub migration 20260420210411",
	wearable_daily_summaries: "prod table; stub migration 20260420210411",
};

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
	const owned = discoverUserOwnedTables(schema, typeTables);

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
		expect(owned.get("wearable_daily_summaries")).toBe(
			"user_id in database.types.ts",
		);
		expect(owned.has("challenges")).toBe(false);
		expect(owned.has("community_benchmarks")).toBe(false);
		expect(owned.size).toBeGreaterThanOrEqual(45);
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
			missingFromManifest(discoverUserOwnedTables(withDummy, typeTables)),
		).toEqual(["zz_dummy_child", "zz_dummy_fk", "zz_dummy_owned"]);
	});

	it("fails when a user-owned table only appears in the generated types", () => {
		expect(
			missingFromManifest(
				discoverUserOwnedTables(schema, [...typeTables, "zz_prod_only"]),
			),
		).toEqual(["zz_prod_only"]);
	});

	it("has unique tables, key columns and reasons", () => {
		const names = [
			...USER_DATA_MANIFEST.map((e) => e.table),
			...EXCLUDED.map((e) => e.table),
		];
		expect(new Set(names).size).toBe(names.length);
		for (const entry of USER_DATA_MANIFEST) {
			expect(entry.keyColumns.length, entry.table).toBeGreaterThan(0);
		}
		for (const entry of EXCLUDED) {
			expect(entry.reason.length, entry.table).toBeGreaterThan(20);
			if (entry.purge === "explicit") {
				expect(entry.purgeMatch, entry.table).toBeTruthy();
			}
		}
	});

	it("names every listed table that has no migration DDL", () => {
		const undeclared = [
			...USER_DATA_MANIFEST.map((e) => e.table),
			...EXCLUDED.map((e) => e.table),
		].filter(
			(table) => !schema.has(table) && !(table in TABLES_WITHOUT_MIGRATION_DDL),
		);
		expect(undeclared).toEqual([]);
		for (const table of Object.keys(TABLES_WITHOUT_MIGRATION_DDL)) {
			expect(schema.has(table), `${table} now has DDL; drop it here`).toBe(
				false,
			);
		}
	});

	it("uses ownership and key columns that exist in the migrations", () => {
		for (const entry of USER_DATA_MANIFEST) {
			const parsed = schema.get(entry.table);
			if (!parsed) continue;
			for (const column of [ownershipColumn(entry), ...entry.keyColumns]) {
				expect(parsed.columns.has(column), `${entry.table}.${column}`).toBe(
					true,
				);
			}
			if (entry.ownership.kind === "parent") {
				const { fkColumn, parentTable, parentColumn } = entry.ownership;
				expect(
					parsed.fks.some(
						(fk) =>
							fk.columns.includes(fkColumn) &&
							fk.ref === `public.${parentTable}`,
					),
					`${entry.table}.${fkColumn} -> ${parentTable}`,
				).toBe(true);
				expect(
					schema.get(parentTable)?.columns.has(parentColumn),
					`${parentTable}.${parentColumn}`,
				).toBe(true);
			}
			const credentials = [...parsed.columns].filter((column) =>
				/token|api_key|secret|password/.test(column),
			);
			expect(credentials, `${entry.table} exports credentials`).toEqual([]);
		}
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
				column: "user_id",
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
		expect(excluded.get("rate_limit_tracking")?.purge).toBe("explicit");
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
	});
});
