import { describe, expect, it } from "vitest";
import { formatTime } from "./formatTime";

describe("formatTime", () => {
	it("renders zero as 0:00", () => {
		expect(formatTime(0)).toBe("0:00");
	});

	it("pads seconds under a minute", () => {
		expect(formatTime(1_000)).toBe("0:01");
		expect(formatTime(9_999)).toBe("0:09");
	});

	it("rolls whole minutes and keeps leftover seconds", () => {
		expect(formatTime(60_000)).toBe("1:00");
		expect(formatTime(61_500)).toBe("1:01");
	});

	it("keeps minutes past 59 instead of wrapping to hours", () => {
		expect(formatTime(3_600_000)).toBe("60:00");
	});
});
