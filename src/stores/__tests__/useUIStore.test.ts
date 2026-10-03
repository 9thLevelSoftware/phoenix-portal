import { beforeEach, describe, expect, it } from "vitest";
import { useUIStore } from "../useUIStore";

describe("useUIStore", () => {
	beforeEach(() => {
		useUIStore.setState({ streak: 0 });
	});

	it("has correct initial state", () => {
		expect(useUIStore.getState().streak).toBe(0);
	});

	it("setStreak() updates streak", () => {
		useUIStore.getState().setStreak(5);
		expect(useUIStore.getState().streak).toBe(5);
	});
});
