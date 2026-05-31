import { describe, expect, it } from "vitest";
import {
	buildAllowedRedirectUrls,
	buildManagedConfig,
	buildPortalCallbackUrl,
	inferProjectRef,
	MANAGED_BLOCK_END,
	MANAGED_BLOCK_START,
} from "../../../scripts/sync-social-auth.mjs";

describe("sync-social-auth", () => {
	it("infers the project ref from the public Supabase URL", () => {
		expect(
			inferProjectRef({
				projectRef: "",
				supabaseUrl: "https://ilzlswmatadlnsuxatcv.supabase.co",
			}),
		).toBe("ilzlswmatadlnsuxatcv");
	});

	it("builds exact callback allow-list entries and deduplicates extras", () => {
		expect(
			buildAllowedRedirectUrls({
				siteUrl: "https://portal.projectphoenix.app",
				additionalRedirectUrls:
					"http://localhost:5173/auth/callback, https://preview.projectphoenix.app/auth/callback",
			}),
		).toEqual([
			"http://localhost:5173/auth/callback",
			"https://portal.projectphoenix.app/auth/callback",
			"https://preview.projectphoenix.app/auth/callback",
		]);
	});

	it("replaces the managed placeholder block with provider config", () => {
		const baseConfig = `[auth]
refresh_token_reuse_interval = 60

${MANAGED_BLOCK_START}
# placeholder
${MANAGED_BLOCK_END}

[functions.example]
verify_jwt = false
`;

		const managedConfig = buildManagedConfig(baseConfig, {
			siteUrl: "https://portal.projectphoenix.app/",
			allowedRedirectUrls: [
				buildPortalCallbackUrl("https://portal.projectphoenix.app"),
				buildPortalCallbackUrl("http://localhost:5173"),
			],
			googleClientId: "google-client-id",
			googleSecret: "google-secret",
			appleClientId: "apple-services-id",
			appleSecret: "apple-secret",
		});

		expect(managedConfig).toContain(
			'site_url = "https://portal.projectphoenix.app/"',
		);
		expect(managedConfig).toContain("[auth.external.google]");
		expect(managedConfig).toContain('client_id = "google-client-id"');
		expect(managedConfig).toContain('secret = "apple-secret"');
		expect(managedConfig).toContain("[functions.example]");
	});
});
