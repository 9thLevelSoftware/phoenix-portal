import { devices, expect, test } from "@playwright/test";
import { mockAuthenticatedApp } from "./support/mockSupabase";

/** The iPhone 13 viewport used by the mobile touch-target gate. */
const { viewport, isMobile, hasTouch, userAgent } = devices["iPhone 13"];
test.use({ viewport, isMobile, hasTouch, userAgent });

const INTERACTIVE_SELECTOR = [
	"a[href]",
	"button",
	"input:not([type=hidden])",
	"select",
	"textarea",
	'[role="button"]',
	'[tabindex]:not([tabindex="-1"])',
]
	.map((selector) => `${selector}:visible`)
	.join(", ");

for (const path of ["/dashboard", "/history", "/routines"]) {
	test(`${path} has 44px mobile touch targets`, async ({ page }) => {
		await mockAuthenticatedApp(page, { tier: "FLAME" });
		await page.goto(path);
		// Measure the rendered page, not a blank or loading shell.
		await expect(page.locator("#main-content")).toBeVisible();
		await page.waitForLoadState("networkidle");

		const targets = await page
			.locator(INTERACTIVE_SELECTOR)
			.evaluateAll((elements) =>
				elements
					// Not a touch target: hidden from assistive tech, inert, or
					// visually hidden (sr-only until focused, e.g. the skip link).
					.filter(
						(element) =>
							!element.closest('[aria-hidden="true"], [inert]') &&
							element.getBoundingClientRect().width > 1,
					)
					.map((element) => {
						const rect = element.getBoundingClientRect();
						return {
							label:
								element.getAttribute("aria-label") ||
								element.textContent?.trim().replace(/\s+/g, " ").slice(0, 40) ||
								element.tagName.toLowerCase(),
							width: Math.round(rect.width),
							height: Math.round(rect.height),
						};
					}),
			);

		expect(
			targets.length,
			`${path} rendered too few controls to measure`,
		).toBeGreaterThan(5);

		const undersized = targets.filter(
			({ width, height }) => width < 44 || height < 44,
		);
		expect(
			undersized,
			`${path} has touch targets smaller than 44x44px: ${JSON.stringify(undersized)}`,
		).toEqual([]);
	});
}
