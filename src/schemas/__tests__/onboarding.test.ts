import { describe, expect, it } from "vitest";
import { onboardingSchema } from "../onboarding";

describe("onboardingSchema", () => {
	it("parses a non-empty dismissed_hints map keyed by hint id", () => {
		const result = onboardingSchema.safeParse({
			id: "11111111-1111-4111-8111-111111111111",
			user_id: "22222222-2222-4222-8222-222222222222",
			completed_at: "2026-01-15T12:00:00.000Z",
			version_seen: "1.0.0",
			dismissed_hints: { "recovery-readiness": true },
			dismissed_whats_new: false,
			created_at: "2026-01-01T00:00:00.000Z",
		});

		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.dismissed_hints).toEqual({
				"recovery-readiness": true,
			});
		}
	});
});
