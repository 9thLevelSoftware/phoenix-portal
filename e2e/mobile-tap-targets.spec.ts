import { devices, test } from "@playwright/test";
import { mockAuthenticatedApp } from "./support/mockSupabase";

/** The iPhone 13 viewport used by the mobile touch-target gate. */
const { viewport, isMobile, hasTouch, userAgent } = devices["iPhone 13"];
test.use({ viewport, isMobile, hasTouch, userAgent });

const INTERACTIVE_SELECTOR =
	'a:visible, button:visible, input:visible, select:visible, textarea:visible, [role="button"]:visible, [tabindex]:visible';

for (const path of ["/dashboard", "/history", "/routines"]) {
	test(`${path} has 44px mobile touch targets`, async ({ page }) => {
		await mockAuthenticatedApp(page, { tier: "FLAME" });
		await page.goto(path);
		await page.waitForLoadState("networkidle");

		const undersized = await page
			.locator(INTERACTIVE_SELECTOR)
			.evaluateAll((elements) =>
				elements
					.map((element) => {
						const rect = element.getBoundingClientRect();
						return {
							label:
								element.getAttribute("aria-label") ||
								element.textContent?.trim().replace(/\s+/g, " ") ||
								element.tagName.toLowerCase(),
							tag: element.tagName.toLowerCase(),
							height: Math.round(rect.height),
						};
					})
					.filter(({ height }) => height < 44),
			);

		test
			.expect(
				undersized,
				`${path} has interactive elements shorter than 44px: ${JSON.stringify(undersized)}`,
			)
			.toEqual([]);
	});
}
