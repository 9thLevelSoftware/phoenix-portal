import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
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
