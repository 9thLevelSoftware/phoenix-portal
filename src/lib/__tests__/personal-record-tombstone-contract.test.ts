import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { getUserDataTable } from "../../../supabase/functions/_shared/userDataManifest.ts";

const MIGRATION = "20260716211500_personal_record_tombstones.sql";

function readWorkspaceFile(...segments: string[]): string {
	return readFileSync(join(process.cwd(), ...segments), "utf8");
}

function personalRecordQuery(source: string): string {
	const start = source.search(/\.from\(["']personal_records["']\)/);
	expect(start).toBeGreaterThanOrEqual(0);
	const end = source.indexOf(";", start);
	expect(end).toBeGreaterThan(start);
	return source.slice(start, end);
}

describe("personal record tombstone migration", () => {
	const migration = readWorkspaceFile("supabase", "migrations", MIGRATION);

	it("keeps unseen parity rows active and returns the complete table shape", () => {
		const match = migration.match(
			/CREATE\s+FUNCTION\s+public\.get_personal_records_excluding_ids[\s\S]*?\$\$;/i,
		);
		expect(match).not.toBeNull();
		expect(match?.[0]).toMatch(/RETURNS\s+SETOF\s+public\.personal_records/i);
		expect(match?.[0]).toMatch(/pr\.deleted_at\s+IS\s+NULL/i);
		expect(match?.[0]).toMatch(/SECURITY\s+INVOKER/i);
	});

	it("defines a bounded known-ID tombstone RPC", () => {
		const match = migration.match(
			/CREATE\s+FUNCTION\s+public\.get_personal_record_tombstones[\s\S]*?\$\$;/i,
		);
		expect(match).not.toBeNull();
		expect(match?.[0]).toMatch(/RETURNS\s+SETOF\s+public\.personal_records/i);
		expect(match?.[0]).toMatch(/pr\.id\s*=\s*ANY\s*\(p_known_ids\)/i);
		expect(match?.[0]).toMatch(/pr\.deleted_at\s+IS\s+NOT\s+NULL/i);
		expect(match?.[0]).toMatch(/pr\.updated_at\s*>\s*p_last_sync_at/i);
		expect(match?.[0]).toMatch(/LIMIT\s+p_limit/i);
		expect(match?.[0]).toMatch(/SECURITY\s+INVOKER/i);
	});

	it("limits both internal RPCs to the service role", () => {
		for (const functionName of [
			"get_personal_records_excluding_ids",
			"get_personal_record_tombstones",
		]) {
			expect(migration).toMatch(
				new RegExp(
					`REVOKE\\s+ALL\\s+ON\\s+FUNCTION\\s+public\\.${functionName}`,
					"i",
				),
			);
			expect(migration).toMatch(
				new RegExp(
					`GRANT\\s+EXECUTE\\s+ON\\s+FUNCTION\\s+public\\.${functionName}`,
					"i",
				),
			);
		}
	});
});

describe("personal record tombstone database types", () => {
	const databaseTypes = readWorkspaceFile("src", "lib", "database.types.ts");

	it("uses UUID parity IDs and exposes the tombstone RPC", () => {
		const activeRpc = databaseTypes.match(
			/get_personal_records_excluding_ids:[\s\S]*?get_pr_count_rankings:/,
		)?.[0];
		expect(activeRpc).toMatch(/p_known_ids\?: string\[\]/);
		expect(activeRpc).toMatch(/deleted_at: string \| null/);
		expect(databaseTypes).toMatch(/get_personal_record_tombstones:/);
	});
});

describe("server-side active personal record reads", () => {
	// compute-rankings reads leaderboard_snapshots; its PR counts are built in
	// SQL by refresh_leaderboard_snapshots (asserted below and in pgTAP
	// supabase/tests/database/leaderboard.test.sql).
	it("leaderboard snapshot and PR ranking RPCs exclude tombstones", () => {
		const migration = readWorkspaceFile(
			"supabase",
			"migrations",
			"20260920005600_leaderboard_snapshots.sql",
		);
		for (const fn of [
			"refresh_leaderboard_snapshots",
			"get_pr_count_rankings",
			"get_user_pr_rank",
		]) {
			const body = migration.match(
				new RegExp(
					`CREATE\\s+OR\\s+REPLACE\\s+FUNCTION\\s+public\\.${fn}[\\s\\S]*?\\$\\$;`,
					"i",
				),
			)?.[0];
			expect(body, fn).toMatch(/pr\.deleted_at\s+IS\s+NULL/i);
		}
	});

	for (const path of [
		["supabase", "functions", "generate-insights", "index.ts"],
		// The GDPR export (src/lib/export/data-export.ts) reads through the
		// export-user-data endpoint and deliberately includes tombstoned rows
		// with their deleted_at: it is a copy of all data held, not a PR view.
	]) {
		it(`${path.join("/")} excludes tombstones`, () => {
			const query = personalRecordQuery(readWorkspaceFile(...path));
			expect(query).toMatch(/\.is\(["']deleted_at["'],\s*null\)/);
		});
	}
});

describe("GDPR export of personal records", () => {
	it("exports tombstoned rows with their deleted_at marker", () => {
		// The export is a copy of all data held, so tombstones are included;
		// deleted_at is what tells the user those records were deleted.
		const entry = getUserDataTable("personal_records");
		expect(entry?.columns).toContain("deleted_at");
		expect(readWorkspaceFile("src", "lib", "export", "data-export.ts")).toMatch(
			/non-null deleted_at are records you deleted/,
		);
	});
});
