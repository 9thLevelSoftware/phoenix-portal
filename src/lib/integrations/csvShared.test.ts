import { describe, expect, it } from "vitest";
import { groupBy, MILES_TO_METERS } from "./csvShared";

describe("csvShared", () => {
	it("uses the international mile", () => {
		expect(MILES_TO_METERS).toBe(1609.344);
	});

	it("groups items by key and keeps first-seen order", () => {
		const grouped = groupBy(
			[
				{ id: "a1", workout: "Push" },
				{ id: "b1", workout: "Pull" },
				{ id: "a2", workout: "Push" },
			],
			(row) => row.workout,
		);

		expect(Object.keys(grouped)).toEqual(["Push", "Pull"]);
		expect(grouped.Push.map((row) => row.id)).toEqual(["a1", "a2"]);
		expect(grouped.Pull.map((row) => row.id)).toEqual(["b1"]);
	});

	it("returns an empty record for no items", () => {
		expect(groupBy([], () => "unused")).toEqual({});
	});
});
