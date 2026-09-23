import { describe, expect, it } from "vitest";

import { cardVariants } from "../card";

describe("cardVariants", () => {
	it("keeps the default card surface and medium padding", () => {
		const classes = cardVariants();

		expect(classes).toContain("bg-card");
		expect(classes).toContain("border");
		expect(classes).toContain("rounded-lg");
		expect(classes).toContain("shadow-sm");
		expect(classes).toContain("p-6");
	});

	it("provides the elevated surface variant", () => {
		const classes = cardVariants({ variant: "elevated" });

		expect(classes).toContain("bg-surface-1");
		expect(classes).toContain("border-0");
		expect(classes).toContain("shadow-md");
	});

	it("provides the inset surface variant", () => {
		const classes = cardVariants({ variant: "inset" });

		expect(classes).toContain("bg-surface-2");
		expect(classes).toContain("border-0");
		expect(classes).toContain("shadow-none");
	});

	it("uses compact padding for stat tiles by default", () => {
		const classes = cardVariants({ variant: "stat", padding: "sm" });

		expect(classes).toContain("bg-card");
		expect(classes).toContain("rounded-lg");
		expect(classes).toContain("shadow-sm");
		expect(classes).toContain("p-3");
	});

	it("supports each explicit padding preset", () => {
		expect(cardVariants({ padding: "sm" })).toContain("p-3");
		expect(cardVariants({ padding: "md" })).toContain("p-6");
		expect(cardVariants({ padding: "lg" })).toContain("p-8");
	});
});
