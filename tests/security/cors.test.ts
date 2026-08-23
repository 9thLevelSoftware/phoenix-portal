import { describe, expect, it } from "vitest";
import {
	buildAllowedOrigins,
	isHostedSupabaseUrl,
	shouldAllowLocalhostOrigins,
} from "../../supabase/functions/_shared/corsOrigins.ts";

describe("CORS localhost fail-closed", () => {
	it("treats *.supabase.co project URLs as hosted", () => {
		expect(isHostedSupabaseUrl("https://abcdefgh.supabase.co")).toBe(true);
		expect(isHostedSupabaseUrl("http://127.0.0.1:54321")).toBe(false);
		expect(isHostedSupabaseUrl(undefined)).toBe(false);
	});

	it("never appends localhost when ENVIRONMENT is production", () => {
		expect(
			shouldAllowLocalhostOrigins("production", "http://127.0.0.1:54321"),
		).toBe(false);
		expect(
			buildAllowedOrigins(
				"https://phoenix-portal.com",
				"production",
				undefined,
			),
		).toEqual(["https://phoenix-portal.com"]);
	});

	it("never appends localhost against a hosted project even if ENVIRONMENT is unset", () => {
		expect(
			shouldAllowLocalhostOrigins(undefined, "https://abcdefgh.supabase.co"),
		).toBe(false);
		expect(
			buildAllowedOrigins(undefined, undefined, "https://abcdefgh.supabase.co"),
		).toEqual([]);
	});

	it("allows localhost only for non-production local stacks", () => {
		expect(
			shouldAllowLocalhostOrigins("development", "http://127.0.0.1:54321"),
		).toBe(true);
		expect(
			buildAllowedOrigins(undefined, undefined, "http://127.0.0.1:54321"),
		).toEqual(["http://localhost:5173", "http://localhost:3000"]);
	});
});
