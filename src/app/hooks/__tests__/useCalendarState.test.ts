import { describe, expect, it } from "vitest";
import { CALENDAR_WEEKDAY_LABELS, navigateMonth } from "../useCalendarState";

describe("calendar month navigation", () => {
	it("uses Sunday-first weekday labels", () => {
		expect([...CALENDAR_WEEKDAY_LABELS]).toEqual([
			"Su",
			"Mo",
			"Tu",
			"We",
			"Th",
			"Fr",
			"Sa",
		]);
	});

	it("pins the day to the 1st so a 31st does not overflow into the month after next", () => {
		const january31 = new Date(2024, 0, 31, 15, 45, 0);

		const next = navigateMonth(january31, "next");
		expect(next.getFullYear()).toBe(2024);
		expect(next.getMonth()).toBe(1);
		expect(next.getDate()).toBe(1);

		const previous = navigateMonth(january31, "prev");
		expect(previous.getFullYear()).toBe(2023);
		expect(previous.getMonth()).toBe(11);
		expect(previous.getDate()).toBe(1);

		expect(january31.getDate()).toBe(31);
	});

	it("steps a mid-month date onto the neighboring 1st", () => {
		const march15 = new Date(2024, 2, 15);
		const next = navigateMonth(march15, "next");
		expect(next.getFullYear()).toBe(2024);
		expect(next.getMonth()).toBe(3);
		expect(next.getDate()).toBe(1);
	});
});
