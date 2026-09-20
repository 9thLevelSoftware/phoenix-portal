import { describe, expect, it } from "vitest";
import { OAuthInitiateError } from "@/lib/integrations/oauthRedirect";
import { isTierDenied, TIER_DENIED_MESSAGE } from "@/lib/tierErrors";

describe("isTierDenied", () => {
	it("matches a PostgREST RLS denial (42501)", () => {
		expect(
			isTierDenied({
				code: "42501",
				message: "new row violates row-level security policy",
			}),
		).toBe(true);
	});

	it("matches FLAME_REQUIRED from the import RPCs", () => {
		expect(isTierDenied({ code: "P0001", message: "FLAME_REQUIRED" })).toBe(
			true,
		);
	});

	it("matches a 402 from supabase.functions.invoke", () => {
		// FunctionsHttpError carries the raw Response on `context`.
		expect(
			isTierDenied({
				name: "FunctionsHttpError",
				message: "Edge Function returned a non-2xx status code",
				context: { status: 402 },
			}),
		).toBe(true);
	});

	it("matches the 402 thrown by the OAuth initiators", () => {
		expect(
			isTierDenied(
				new OAuthInitiateError(
					"A Flame subscription or higher is required for this feature.",
					402,
				),
			),
		).toBe(true);
	});

	it("does not match unrelated failures", () => {
		expect(isTierDenied(null)).toBe(false);
		expect(isTierDenied(undefined)).toBe(false);
		expect(isTierDenied("42501")).toBe(false);
		expect(isTierDenied(new Error("Network request failed"))).toBe(false);
		expect(
			isTierDenied({ code: "23505", message: "duplicate key value" }),
		).toBe(false);
		// A retryable subscription-lookup outage must not be read as a denial.
		expect(
			isTierDenied(new OAuthInitiateError("Temporarily unavailable", 503)),
		).toBe(false);
		expect(isTierDenied({ context: { status: 500 } })).toBe(false);
	});

	it("names the tier in the shared message without naming a price", () => {
		expect(TIER_DENIED_MESSAGE).toMatch(/Flame/);
	});
});
