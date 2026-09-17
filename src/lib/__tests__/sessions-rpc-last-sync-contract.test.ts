import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const MIGRATION = "20260917185323_add_sessions_rpc_last_sync_at.sql";

function readWorkspaceFile(...segments: string[]): string {
	return readFileSync(join(process.cwd(), ...segments), "utf8");
}

describe("sessions excluding-ids last-sync migration", () => {
	const migration = readWorkspaceFile("supabase", "migrations", MIGRATION);

	it("adds p_last_sync_at and returns new or stale sessions", () => {
		const match = migration.match(
			/CREATE\s+FUNCTION\s+get_sessions_excluding_ids[\s\S]*?\$\$;/i,
		);
		expect(match).not.toBeNull();
		expect(match?.[0]).toMatch(/p_last_sync_at\s+TIMESTAMPTZ\s+DEFAULT\s+NULL/i);
		expect(match?.[0]).toMatch(/ws\.updated_at\s*>\s*p_last_sync_at/i);
		expect(match?.[0]).toMatch(/ws\.started_at\s*>\s*p_last_sync_at/i);
		expect(match?.[0]).toMatch(/ws\.id\s*!=\s*ALL\s*\(p_known_ids\)/i);
	});

	it("limits the RPC to the service role after recreate", () => {
		expect(migration).toMatch(
			/REVOKE\s+ALL\s+ON\s+FUNCTION\s+%s\s+FROM\s+PUBLIC/i,
		);
		expect(migration).toMatch(
			/GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+%s\s+TO\s+service_role/i,
		);
		expect(migration).toMatch(/p\.proname\s*=\s*'get_sessions_excluding_ids'/);
	});
});

describe("sessions excluding-ids database types", () => {
	const databaseTypes = readWorkspaceFile("src", "lib", "database.types.ts");

	it("exposes p_last_sync_at on get_sessions_excluding_ids", () => {
		const rpc = databaseTypes.match(
			/get_sessions_excluding_ids:[\s\S]*?get_[a-z_]+?:/,
		)?.[0];
		expect(rpc).toMatch(/p_last_sync_at\?: string/);
	});
});
