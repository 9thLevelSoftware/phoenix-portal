import { describe, expect, it } from "vitest";

import { cardVariants } from "../card";

describe("cardVariants", () => {
	it("keeps legacy defaults without outer padding", () => {
		const classes = cardVariants();

		expect(classes).toContain("bg-card");
		expect(classes).toContain("border");
		expect(classes).toContain("rounded-xl");
		expect(classes.split(/\s+/)).not.toContain("p-6");
	});

	it("resolves the stat surface without implicit padding", () => {
		const classes = cardVariants({ variant: "stat" });

		expect(classes).toContain("bg-card");
		expect(classes).toContain("rounded-lg");
		expect(classes).toContain("shadow-sm");
	});

	it("supports compact stat padding", () => {
		expect(cardVariants({ variant: "stat", padding: "sm" })).toContain("p-3");
	});

	it("supports compact padding", () => {
		expect(cardVariants({ padding: "sm" })).toContain("p-3");
	});
});
