import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDir = join(process.cwd(), "supabase", "migrations");

function readAllMigrationSql() {
	return readdirSync(migrationsDir)
		.filter((name) => name.endsWith(".sql"))
		.sort()
		.map((name) => readFileSync(join(migrationsDir, name), "utf8"))
		.join("\n");
}

describe("rate limit schema", () => {
	it("defines the check_rate_limit RPC expected by edge functions", () => {
		const sql = readAllMigrationSql();

		expect(sql).toMatch(
			/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.check_rate_limit\s*\(/i,
		);
		expect(sql).toMatch(
			/RETURNS\s+TABLE\s*\(\s*allowed\s+boolean\s*,\s*remaining\s+integer\s*,\s*retry_after_seconds\s+integer\s*\)/i,
		);
		expect(sql).toMatch(
			/FROM\s+public\.rate_limit_tracking\s+rlt[\s\S]+WHERE\s+rlt\.key\s*=\s*p_key[\s\S]+AND\s+rlt\.user_id\s*=\s*p_user_id/i,
		);
	});
});
