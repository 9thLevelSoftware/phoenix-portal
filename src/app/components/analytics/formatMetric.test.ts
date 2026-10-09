import { describe, expect, it } from "vitest";
import { formatMetric } from "./formatMetric";

describe("formatMetric", () => {
	it("trims a trailing .0 at the default one decimal", () => {
		expect(formatMetric(10)).toBe("10");
		expect(formatMetric(10.0)).toBe("10");
		expect(formatMetric(0)).toBe("0");
	});

	it("keeps a non-zero fractional digit", () => {
		expect(formatMetric(10.5)).toBe("10.5");
		expect(formatMetric(0.4)).toBe("0.4");
	});

	it("honors an explicit decimal count without extra trimming", () => {
		expect(formatMetric(0.8, 2)).toBe("0.80");
		expect(formatMetric(12.4, 0)).toBe("12");
		expect(formatMetric(1.04, 2)).toBe("1.04");
	});
});
