import { beforeEach, describe, expect, it } from "vitest";
import { useProfileFilterStore } from "@/stores/useProfileFilterStore";

describe("useProfileFilterStore", () => {
	beforeEach(() => {
		useProfileFilterStore.getState().reset();
	});

	it("defaults to null (all profiles / unfiltered)", () => {
		expect(useProfileFilterStore.getState().activeProfileId).toBeNull();
	});

	it("sets a specific profile filter", () => {
		useProfileFilterStore.getState().setActiveProfileId("profile-123");
		expect(useProfileFilterStore.getState().activeProfileId).toBe(
			"profile-123",
		);
	});

	it("clears the filter back to null", () => {
		useProfileFilterStore.getState().setActiveProfileId("profile-123");
		useProfileFilterStore.getState().setActiveProfileId(null);
		expect(useProfileFilterStore.getState().activeProfileId).toBeNull();
	});

	it("reset() clears the profile filter", () => {
		useProfileFilterStore.getState().setActiveProfileId("profile-123");
		useProfileFilterStore.getState().reset();
		expect(useProfileFilterStore.getState().activeProfileId).toBeNull();
	});
});
