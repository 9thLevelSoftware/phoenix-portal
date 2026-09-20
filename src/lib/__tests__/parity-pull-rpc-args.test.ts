import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Database } from "@/lib/database.types";

// mobile-sync-pull passes p_last_sync_at to every parity RPC. The generated
// types must keep it. The typed literals below fail `tsc -p tsconfig.test.json`
// if it disappears; `npm run typecheck` (bare `tsc --noEmit` over a
// references-only tsconfig) does not check test files, so the text check below
// is what fails in `npm test`. Behaviour and grants are covered by the real-SQL
// "integration: " tests in supabase/functions/mobile-sync-pull/index.test.ts.
type Functions = Database["public"]["Functions"];

const USER_ID = "00000000-0000-4000-8000-000000000001";
const STALE_SINCE = "2026-06-30T23:58:00.000Z";

const sessionsArgs: Functions["get_sessions_excluding_ids"]["Args"] = {
	p_user_id: USER_ID,
	p_last_sync_at: STALE_SINCE,
};
const routinesArgs: Functions["get_routines_excluding_ids"]["Args"] = {
	p_user_id: USER_ID,
	p_last_sync_at: STALE_SINCE,
};
const cyclesArgs: Functions["get_cycles_excluding_ids"]["Args"] = {
	p_user_id: USER_ID,
	p_last_sync_at: STALE_SINCE,
};

const databaseTypes = readFileSync(
	join(process.cwd(), "src", "lib", "database.types.ts"),
	"utf8",
);

function argsBlock(rpc: string): string {
	const match = databaseTypes.match(
		new RegExp(`${rpc}: \\{\\s*Args: \\{([^}]*)\\}`),
	);
	expect(match, rpc).not.toBeNull();
	return match?.[1] ?? "";
}

describe("parity pull RPC argument types", () => {
	it("accept p_last_sync_at on sessions, routines and cycles", () => {
		for (const args of [sessionsArgs, routinesArgs, cyclesArgs]) {
			expect(args.p_last_sync_at).toBe(STALE_SINCE);
		}
		for (const rpc of [
			"get_sessions_excluding_ids",
			"get_routines_excluding_ids",
			"get_cycles_excluding_ids",
		]) {
			expect(argsBlock(rpc), rpc).toMatch(/p_last_sync_at\?: string;/);
		}
	});
});
