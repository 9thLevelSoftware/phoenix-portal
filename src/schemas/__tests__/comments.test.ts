import { describe, expect, it } from "vitest";
import { createCommentSchema } from "../comments";

describe("createCommentSchema", () => {
	it("parses valid body (normal length)", () => {
		const result = createCommentSchema.safeParse({ body: "Great workout!" });
		expect(result.success).toBe(true);
	});

	it("parses exactly 1 character (lower boundary)", () => {
		const result = createCommentSchema.safeParse({ body: "A" });
		expect(result.success).toBe(true);
	});

	it("parses exactly 500 characters (upper boundary)", () => {
		const body = "x".repeat(500);
		const result = createCommentSchema.safeParse({ body });
		expect(result.success).toBe(true);
	});

	it("fails for empty string", () => {
		const result = createCommentSchema.safeParse({ body: "" });
		expect(result.success).toBe(false);
		if (!result.success) {
			const errorMessages = result.error.issues.map((i) => i.message);
			expect(errorMessages).toContain("Comment cannot be empty");
		}
	});

	it("fails for 501 character string", () => {
		const body = "x".repeat(501);
		const result = createCommentSchema.safeParse({ body });
		expect(result.success).toBe(false);
		if (!result.success) {
			const errorMessages = result.error.issues.map((i) => i.message);
			expect(errorMessages).toContain("Comment must be 500 characters or less");
		}
	});

	it("fails when body is missing", () => {
		const result = createCommentSchema.safeParse({});
		expect(result.success).toBe(false);
	});
});
