import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "@playwright/test";
import { test as authedTest, expect as authedExpect } from "./fixtures/auth";

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

// Pages accessible without authentication
const publicPages = [{ name: "Landing Page", path: "/" }];

// Pages that require authentication
const authedPages = [
	{ name: "Dashboard", path: "/dashboard" },
	{ name: "Workout History", path: "/history" },
	{ name: "Analytics", path: "/analytics" },
	{ name: "Community", path: "/community" },
	{ name: "Cycles", path: "/cycles" },
	{ name: "Routines", path: "/routines" },
	{ name: "Profile", path: "/profile" },
	{ name: "Recovery", path: "/recovery" },
	{ name: "Goals", path: "/goals" },
	{ name: "Compare", path: "/compare" },
];

test.describe("WCAG Accessibility Audit - Public Pages", () => {
	for (const { name, path } of publicPages) {
		test(`${name} has no critical WCAG violations`, async ({
			page,
		}) => {
			await page.goto(path);
			await page.waitForLoadState("networkidle");
			// Wait for Framer Motion entrance animations to complete
			// (longest delay is 0.6s + transition duration ~0.3s)
			await page.waitForTimeout(2000);

			const results = await new AxeBuilder({ page })
				.withTags(WCAG_TAGS)
				.analyze();

			// Log violations for debugging
			if (results.violations.length > 0) {
				console.log(
					`[${name}] a11y violations:`,
					results.violations.map((v) => ({
						id: v.id,
						impact: v.impact,
						description: v.description,
						nodes: v.nodes.length,
					})),
				);
			}

			// Filter to critical/serious only for the pass/fail gate
			const critical = results.violations.filter(
				(v) =>
					v.impact === "critical" || v.impact === "serious",
			);
			expect(
				critical,
				`${name} has ${critical.length} critical/serious a11y violations`,
			).toHaveLength(0);
		});
	}
});

authedTest.describe("WCAG Accessibility Audit - Authenticated Pages", () => {
	const skip = !process.env.SUPABASE_TEST_EMAIL;

	for (const { name, path } of authedPages) {
		authedTest(`${name} has no critical WCAG violations`, async ({
			authedPage: page,
		}) => {
			authedTest.skip(skip, "No test credentials");
			await page.goto(path);
			await page.waitForLoadState("networkidle");
			// Wait for any entrance animations to settle
			await page.waitForTimeout(2000);

			const results = await new AxeBuilder({ page })
				.withTags(WCAG_TAGS)
				.analyze();

			if (results.violations.length > 0) {
				console.log(
					`[${name}] a11y violations:`,
					results.violations.map((v) => ({
						id: v.id,
						impact: v.impact,
						description: v.description,
						nodes: v.nodes.length,
					})),
				);
			}

			const critical = results.violations.filter(
				(v) =>
					v.impact === "critical" || v.impact === "serious",
			);
			authedExpect(
				critical,
				`${name} has ${critical.length} critical/serious a11y violations`,
			).toHaveLength(0);
		});
	}
});
