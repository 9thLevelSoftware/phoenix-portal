/**
 * Data sharing (outbound webhooks): the scope registry cannot drift.
 *
 * Three places describe what a user may send to their own endpoint:
 *   - supabase/functions/_shared/dataSharingScopes.ts (payload builder, SPA);
 *   - private.webhook_entity_sources in the 20261106120000 migration (capture
 *     triggers and backfill);
 *   - USER_DATA_MANIFEST (column lists, and the list of every user table).
 *
 * A table that is captured but not built, or built but not captured, would
 * either deliver nothing or silently skip changes. A new user table that is in
 * neither an entity nor NOT_SHAREABLE would have been decided by default.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	DATA_SHARING_ENTITIES,
	DATA_SHARING_OMITTED_COLUMNS,
	DATA_SHARING_SCOPE_INFO,
	DATA_SHARING_SCOPES,
	MAX_WEBHOOK_ENDPOINTS,
	NOT_SHAREABLE,
} from "../../supabase/functions/_shared/dataSharingScopes.ts";
import {
	getUserDataTable,
	USER_DATA_MANIFEST,
} from "../../supabase/functions/_shared/userDataManifest.ts";

const migration = readFileSync(
	join(
		process.cwd(),
		"supabase/migrations/20261106120000_webhook_data_sharing.sql",
	),
	"utf8",
);

interface SourceRow {
	sourceTable: string;
	scope: string;
	entity: string;
	isRoot: boolean;
	idColumn: string;
	userColumn: string | null;
	parentTable: string | null;
	rowFilter: string | null;
}

function sqlValue(raw: string): string | null {
	const value = raw.trim();
	if (value === "NULL") return null;
	return value.replace(/^'|'$/g, "").replace(/''/g, "'");
}

/** The VALUES rows of the private.webhook_entity_sources seed. */
function parseEntitySources(sql: string): SourceRow[] {
	const start = sql.indexOf("INSERT INTO private.webhook_entity_sources");
	const end = sql.indexOf("ON CONFLICT (source_table) DO UPDATE", start);
	expect(start, "entity source seed not found").toBeGreaterThan(-1);
	expect(end, "entity source seed end not found").toBeGreaterThan(start);
	const rows: SourceRow[] = [];
	for (const line of sql.slice(start, end).split("\n")) {
		const match = line.match(/^\s*\((.*)\),?\s*$/);
		if (!match || !match[1].trim().startsWith("'")) continue;
		// Split on commas outside quotes.
		const cells = match[1].match(/'(?:[^']|'')*'|[^,]+/g) ?? [];
		const [
			sourceTable,
			scope,
			entity,
			isRoot,
			idColumn,
			userColumn,
			parentTable,
			rowFilter,
		] = cells.map((cell) => cell.trim());
		rows.push({
			sourceTable: sqlValue(sourceTable) ?? "",
			scope: sqlValue(scope) ?? "",
			entity: sqlValue(entity) ?? "",
			isRoot: isRoot === "true",
			idColumn: sqlValue(idColumn) ?? "",
			userColumn: sqlValue(userColumn),
			parentTable: sqlValue(parentTable),
			rowFilter: sqlValue(rowFilter),
		});
	}
	return rows;
}

/** The quoted names between `after` (which ends at the list's opener) and `closer`. */
function quotedList(sql: string, after: string, closer: string): string[] {
	const start = sql.indexOf(after);
	expect(start, `${after} not found`).toBeGreaterThan(-1);
	const open = start + after.length;
	const close = sql.indexOf(closer, open);
	return [...sql.slice(open, close).matchAll(/'([a-z_]+)'/g)].map(
		(match) => match[1],
	);
}

const sources = parseEntitySources(migration);

describe("data sharing scope registry", () => {
	it("parses the migration's entity sources", () => {
		// Not vacuous: a broken parser would make every comparison below pass.
		expect(sources.length).toBeGreaterThanOrEqual(15);
		expect(
			sources.find((row) => row.sourceTable === "workout_sessions"),
		).toEqual({
			sourceTable: "workout_sessions",
			scope: "workouts",
			entity: "workout",
			isRoot: true,
			idColumn: "id",
			userColumn: "user_id",
			parentTable: null,
			rowFilter: null,
		});
		expect(
			sources.find((row) => row.sourceTable === "routine_exercises"),
		).toMatchObject({
			isRoot: false,
			userColumn: null,
			parentTable: "routines",
		});
	});

	it("has one entity per root source, with the same table, scope and key columns", () => {
		const fromSql = sources
			.filter((row) => row.isRoot)
			.map((row) => ({
				entity: row.entity,
				scope: row.scope,
				table: row.sourceTable,
				idColumn: row.idColumn,
				userColumn: row.userColumn,
			}))
			.sort((a, b) => a.entity.localeCompare(b.entity));
		const fromTs = DATA_SHARING_ENTITIES.map((entry) => ({
			entity: entry.entity,
			scope: entry.scope,
			table: entry.table,
			idColumn: entry.idColumn,
			userColumn: entry.userColumn,
		})).sort((a, b) => a.entity.localeCompare(b.entity));
		expect(fromTs).toEqual(fromSql);
	});

	it("captures child tables only for an entity that builds them into its payload", () => {
		for (const row of sources.filter((source) => !source.isRoot)) {
			const entity = DATA_SHARING_ENTITIES.find(
				(entry) => entry.entity === row.entity,
			);
			expect(entity, row.sourceTable).toBeDefined();
			const child = entity?.children.find(
				(entry) => entry.table === row.sourceTable,
			);
			expect(
				child,
				`${row.sourceTable} is captured but not a payload child`,
			).toBeDefined();
			// The capture records the parent id found in this column.
			expect(child?.fkColumn).toBe(row.idColumn);
			expect(child?.parent).toBe(entity?.table);
		}
	});

	it("excludes in the trigger exactly what the payload builder excludes", () => {
		for (const entity of DATA_SHARING_ENTITIES) {
			const row = sources.find((source) => source.sourceTable === entity.table);
			if (entity.exclude) {
				expect(row?.rowFilter).toBe(
					`c.${entity.exclude.column} IS DISTINCT FROM '${entity.exclude.equals}'`,
				);
			} else {
				expect(row?.rowFilter, entity.table).toBeNull();
			}
		}
	});

	it("allows the same scopes and entities in the table constraints", () => {
		expect(quotedList(migration, "scopes <@ ARRAY[", "]").sort()).toEqual(
			[...DATA_SHARING_SCOPES].sort(),
		);
		expect(quotedList(migration, "CHECK (entity IN (", ")").sort()).toEqual(
			[...DATA_SHARING_ENTITIES.map((entry) => entry.entity), "ping"].sort(),
		);
		expect(migration).toContain(
			`c_max_endpoints CONSTANT integer := ${MAX_WEBHOOK_ENDPOINTS};`,
		);
	});

	it("describes every scope once, and every scope has an entity", () => {
		expect(DATA_SHARING_SCOPE_INFO.map((info) => info.scope)).toEqual([
			...DATA_SHARING_SCOPES,
		]);
		for (const scope of DATA_SHARING_SCOPES) {
			expect(
				DATA_SHARING_ENTITIES.some((entry) => entry.scope === scope),
				scope,
			).toBe(true);
		}
	});

	it("classifies every manifest table as shared or not shareable, never both", () => {
		const shared = new Set<string>();
		for (const entity of DATA_SHARING_ENTITIES) {
			shared.add(entity.table);
			for (const child of entity.children) shared.add(child.table);
		}
		const unclassified = USER_DATA_MANIFEST.map((entry) => entry.table).filter(
			(table) => !shared.has(table) && !(table in NOT_SHAREABLE),
		);
		expect(unclassified).toEqual([]);
		expect([...shared].filter((table) => table in NOT_SHAREABLE)).toEqual([]);
		// No stale names in either list.
		const manifestTables = new Set(
			USER_DATA_MANIFEST.map((entry) => entry.table),
		);
		expect([...shared].filter((table) => !manifestTables.has(table))).toEqual(
			[],
		);
		expect(
			Object.keys(NOT_SHAREABLE).filter((table) => !manifestTables.has(table)),
		).toEqual([]);
	});

	it("builds payloads only from columns the manifest exports", () => {
		for (const entity of DATA_SHARING_ENTITIES) {
			const root = getUserDataTable(entity.table);
			expect(root?.columns, entity.table).toContain(entity.idColumn);
			expect(root?.columns, entity.table).toContain(entity.userColumn);
			if (entity.softDeleteColumn) {
				expect(root?.columns).toContain(entity.softDeleteColumn);
			}
			if (entity.exclude) {
				expect(root?.columns).toContain(entity.exclude.column);
			}
			const known = new Set([entity.table]);
			for (const child of entity.children) {
				// A child hangs off the entity's table or an earlier child.
				expect(
					known.has(child.parent),
					`${child.table} -> ${child.parent}`,
				).toBe(true);
				const manifest = getUserDataTable(child.table);
				expect(manifest?.columns, child.table).toContain(child.fkColumn);
				expect(manifest?.columns, child.table).toContain("id");
				known.add(child.table);
			}
		}
		for (const [table, columns] of Object.entries(
			DATA_SHARING_OMITTED_COLUMNS,
		)) {
			const manifest = getUserDataTable(table);
			for (const column of columns) {
				expect(manifest?.columns, `${table}.${column}`).toContain(column);
			}
		}
	});

	it("never shares a table whose reads are INFERNO-gated or that holds raw telemetry", () => {
		// FP-2: a FLAME endpoint must not carry what its owner cannot read.
		const shared = DATA_SHARING_ENTITIES.flatMap((entry) => [
			entry.table,
			...entry.children.map((child) => child.table),
		]);
		for (const table of [
			"rep_telemetry",
			"set_telemetry",
			"session_phase_statistics",
			"vbt_assessments",
			"exercise_signatures",
		]) {
			expect(shared, table).not.toContain(table);
		}
	});
});
