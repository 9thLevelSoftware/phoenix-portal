import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import * as integrationMutations from "@/mutations/integrations";
import { MANUAL_SYNC_PROVIDERS } from "@/mutations/integrations";

/**
 * The portal's manual-sync button dispatches to `<provider>-sync`. If that
 * function does not exist the invoke fails at runtime, and if a function exists
 * but the provider is absent from the list the feature is silently unreachable
 * — which is exactly how Liftosaur shipped with a working sync nobody could
 * trigger from the portal.
 */
function syncFunctionExists(provider: string): boolean {
	return existsSync(
		join(
			process.cwd(),
			"supabase",
			"functions",
			`${provider}-sync`,
			"index.ts",
		),
	);
}

describe("MANUAL_SYNC_PROVIDERS", () => {
	it("lists only providers that have a deployable sync Edge Function", () => {
		for (const provider of MANUAL_SYNC_PROVIDERS) {
			expect(
				syncFunctionExists(provider),
				`supabase/functions/${provider}-sync/index.ts is missing`,
			).toBe(true);
		}
	});

	it("includes liftosaur (regression: sync function existed but was unreachable)", () => {
		expect(MANUAL_SYNC_PROVIDERS).toContain("liftosaur");
	});

	it("excludes garmin, which is webhook-driven and has nothing to pull", () => {
		expect(MANUAL_SYNC_PROVIDERS).not.toContain("garmin");
		expect(syncFunctionExists("garmin")).toBe(false);
	});

	it("excludes providers with no server-side pull path", () => {
		for (const provider of ["strong", "apple_health", "google_health"]) {
			expect(MANUAL_SYNC_PROVIDERS).not.toContain(provider);
		}
	});

	it("has no duplicate entries", () => {
		expect(new Set(MANUAL_SYNC_PROVIDERS).size).toBe(
			MANUAL_SYNC_PROVIDERS.length,
		);
	});
});

const SRC_ROOT = join(process.cwd(), "src");

/** Every .ts/.tsx under src/, excluding generated types and test files. */
function sourceFiles(dir: string, found: string[] = []): string[] {
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry);
		if (statSync(full).isDirectory()) {
			if (entry === "__tests__" || entry === "__mocks__") continue;
			sourceFiles(full, found);
			continue;
		}
		if (!/\.tsx?$/.test(entry)) continue;
		if (entry === "database.types.ts") continue;
		if (/\.test\.tsx?$/.test(entry)) continue;
		found.push(full);
	}
	return found;
}

function posixRelative(file: string): string {
	return relative(SRC_ROOT, file).split(sep).join("/");
}

/**
 * The browser is a READER of sync_queue, never a writer.
 *
 * Provider sync Edge Functions own their queue rows (PR 52): a row the browser
 * inserted as `pending` would be claimed by the next process-sync-queue pass
 * and dispatched a second time alongside the direct invoke (PR 31 review R-1),
 * and a browser-inserted `processing` row could never be released if the tab
 * closed. These assertions fail if any of that is reintroduced.
 */
describe("browser writes to sync_queue", () => {
	it("only the SyncStatus card touches sync_queue, and only to read it", () => {
		// PostgREST table access, not a mention of the name in a comment.
		const accessor = /\.from\(\s*["'`]sync_queue["'`]\s*\)/;
		const touching = sourceFiles(SRC_ROOT)
			.filter((file) => accessor.test(readFileSync(file, "utf8")))
			.map(posixRelative)
			.sort();

		expect(touching).toEqual(["app/components/integrations/SyncStatus.tsx"]);

		const syncStatus = readFileSync(
			join(SRC_ROOT, "app/components/integrations/SyncStatus.tsx"),
			"utf8",
		);
		for (const write of [".insert(", ".upsert(", ".update(", ".delete("]) {
			expect(syncStatus, `SyncStatus.tsx must not call ${write}`).not.toContain(
				write,
			);
		}
	});

	it("the integrations mutations go through Edge Functions only", () => {
		const source = readFileSync(
			join(SRC_ROOT, "mutations", "integrations.ts"),
			"utf8",
		);
		// No PostgREST table access at all: connect/disconnect/sync are all
		// service-role work behind an Edge Function.
		expect(source).not.toContain("supabase.from(");
	});

	it("exposes no connect mutation (it was the last browser table write)", () => {
		expect(Object.keys(integrationMutations)).not.toContain(
			"useConnectIntegration",
		);
	});
});
