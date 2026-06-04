import { describe, expect, it } from "vitest";
import { validateOAuthRedirectUrl } from "./oauthRedirect";

describe("validateOAuthRedirectUrl", () => {
	it("accepts a Strava authorization URL for Strava redirects", () => {
		const url =
			"https://www.strava.com/oauth/authorize?client_id=client&state=state";

		expect(validateOAuthRedirectUrl("strava", url)).toBe(url);
	});

	it("accepts a Fitbit authorization URL for Fitbit redirects", () => {
		const url =
			"https://www.fitbit.com/oauth2/authorize?client_id=client&state=state";

		expect(validateOAuthRedirectUrl("fitbit", url)).toBe(url);
	});

	it("accepts the Garmin Edge Function URL on the configured Supabase origin", () => {
		const url =
			"https://staging-project.supabase.co/functions/v1/garmin-oauth?state=state";

		expect(
			validateOAuthRedirectUrl("garmin", url, {
				supabaseUrl: "https://staging-project.supabase.co",
			}),
		).toBe(url);
	});

	it("rejects non-HTTPS redirects", () => {
		expect(() =>
			validateOAuthRedirectUrl(
				"strava",
				"http://www.strava.com/oauth/authorize?state=state",
			),
		).toThrow(/HTTPS/);
	});

	it("rejects redirects to an unexpected host", () => {
		expect(() =>
			validateOAuthRedirectUrl(
				"fitbit",
				"https://www.strava.com/oauth/authorize?state=state",
			),
		).toThrow(/requested provider/);
	});

	it("rejects Garmin redirects outside the configured Supabase origin", () => {
		expect(() =>
			validateOAuthRedirectUrl(
				"garmin",
				"https://attacker.example/functions/v1/garmin-oauth?state=state",
				{ supabaseUrl: "https://staging-project.supabase.co" },
			),
		).toThrow(/requested provider/);
	});
});
