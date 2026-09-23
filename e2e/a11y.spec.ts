import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { mockAuthenticatedApp } from "./support/mockSupabase";

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

/**
 * Wait until no Web Animation is still running. A fixed sleep alone is not
 * enough under parallel load: when the dev server is slow, axe can sample an
 * entrance fade at partial opacity and report a color-contrast violation that
 * the settled page does not have (OP-13).
 */
async function waitForAnimationsToSettle(page: Page) {
	await page.waitForFunction(
		() =>
			document
				.getAnimations()
				.every((animation) => animation.playState !== "running"),
		undefined,
		{ timeout: 10_000 },
	);
}

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
	test.beforeEach(async ({ page }) => {
		// The app's MotionConfig respects prefers-reduced-motion; emulating that
		// media query drops entrance transforms before axe samples contrast.
		await page.emulateMedia({ reducedMotion: "reduce" });
	});

	for (const { name, path } of publicPages) {
		test(`${name} has no critical WCAG violations`, async ({ page }) => {
			await page.goto(path);
			await page.waitForLoadState("networkidle");
			await waitForAnimationsToSettle(page);

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
				(v) => v.impact === "critical" || v.impact === "serious",
			);
			expect(
				critical,
				`${name} has ${critical.length} critical/serious a11y violations`,
			).toHaveLength(0);
		});
	}
});

test.describe("WCAG Accessibility Audit - Authenticated Pages", () => {
	test.beforeEach(async ({ page }) => {
		// Keep the audit from sampling Sonner's opacity transition while a toast
		// is being removed. The reduced-motion stylesheet preserves the final
		// colors, so axe still evaluates their real contrast.
		await page.emulateMedia({ reducedMotion: "reduce" });
		await mockAuthenticatedApp(page, { tier: "FLAME" });
	});

	for (const { name, path } of authedPages) {
		test(`${name} has no critical WCAG violations`, async ({ page }) => {
			await page.goto(path);
			await page.waitForLoadState("networkidle");
			await waitForAnimationsToSettle(page);

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
				(v) => v.impact === "critical" || v.impact === "serious",
			);
			expect(
				critical,
				`${name} has ${critical.length} critical/serious a11y violations`,
			).toHaveLength(0);
		});
	}
});
