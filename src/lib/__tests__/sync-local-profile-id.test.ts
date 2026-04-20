import { describe, expect, it } from "vitest";
import {
	DEFAULT_PROFILE_ID,
	isValidLocalProfileId,
} from "../../../supabase/functions/_shared/localProfileId.ts";

describe("isValidLocalProfileId", () => {
	it("accepts the mobile-seeded 'default' sentinel", () => {
		// Mobile UserProfileRepository seeds a profile with id='default' on first
		// boot and prevents deletion. Every real sync payload contains it.
		expect(isValidLocalProfileId(DEFAULT_PROFILE_ID)).toBe(true);
		expect(isValidLocalProfileId("default")).toBe(true);
	});

	it("accepts UUID v4-shaped profile ids created via generateUUID()", () => {
		expect(isValidLocalProfileId("0f8fad5b-d9cb-469f-a165-70867728950e")).toBe(
			true,
		);
		expect(isValidLocalProfileId("A1B2C3D4-E5F6-4789-ABCD-0123456789AB")).toBe(
			true,
		);
	});

	it("rejects arbitrary strings, numbers, null, and partial UUIDs", () => {
		expect(isValidLocalProfileId("Default")).toBe(false);
		expect(isValidLocalProfileId("not-a-uuid")).toBe(false);
		expect(isValidLocalProfileId("0f8fad5bd9cb469fa16570867728950e")).toBe(
			false,
		);
		expect(isValidLocalProfileId("")).toBe(false);
		expect(isValidLocalProfileId(null)).toBe(false);
		expect(isValidLocalProfileId(undefined)).toBe(false);
		expect(isValidLocalProfileId(42)).toBe(false);
		expect(isValidLocalProfileId({})).toBe(false);
	});

	it("rejects injection attempts disguised as 'default'", () => {
		expect(isValidLocalProfileId("default' OR 1=1 --")).toBe(false);
		expect(isValidLocalProfileId(" default")).toBe(false);
		expect(isValidLocalProfileId("default\n")).toBe(false);
	});
});
