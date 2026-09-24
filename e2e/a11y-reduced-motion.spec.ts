import { expect, type Page, test } from "@playwright/test";
import { mockAuthenticatedApp } from "./support/mockSupabase";

const ROUTES = ["/dashboard", "/analytics", "/history"];

/**
 * Elements whose CSS transition or animation lasts longer than 1ms.
 * theme.css collapses every duration to 0.01ms under
 * prefers-reduced-motion: reduce, so this must be empty then — and, as the
 * control test shows, non-empty otherwise.
 */
async function timedCssMotion(page: Page) {
	return page.evaluate(() => {
		const seconds = (value: string) =>
			value
				.split(",")
				.map((part) => part.trim())
				.map((part) =>
					part.endsWith("ms")
						? Number.parseFloat(part) / 1000
						: Number.parseFloat(part),
				);
		const offenders: string[] = [];
		for (const element of document.querySelectorAll("*")) {
			const styles = window.getComputedStyle(element);
			const transition = Math.max(...seconds(styles.transitionDuration));
			const animation =
				styles.animationName === "none"
					? 0
					: Math.max(...seconds(styles.animationDuration));
			if (transition > 0.001 || animation > 0.001) {
				const cls = (element as HTMLElement).className?.toString() ?? "";
				offenders.push(`${element.tagName.toLowerCase()}.${cls.slice(0, 50)}`);
			}
		}
		return offenders;
	});
}

/**
 * Elements whose transform changes while nothing is interacting with the
 * page: catches JS-driven (Framer Motion) movement that CSS rules cannot.
 * Compared per element (not by index), and only for elements present in both
 * samples, so data arriving between the samples is not mistaken for motion.
 */
async function movingElements(page: Page) {
	return page.evaluate(async () => {
		const before = new Map<Element, string>();
		for (const element of document.querySelectorAll("*")) {
			before.set(element, window.getComputedStyle(element).transform);
		}
		await new Promise((resolve) => setTimeout(resolve, 250));
		const moved: string[] = [];
		for (const [element, transform] of before) {
			if (!element.isConnected) continue;
			if (window.getComputedStyle(element).transform !== transform) {
				const cls = (element as HTMLElement).className?.toString() ?? "";
				moved.push(`${element.tagName.toLowerCase()}.${cls.slice(0, 50)}`);
			}
		}
		return moved;
	});
}

test.describe("Reduced motion", () => {
	for (const path of ROUTES) {
		test(`nothing moves or eases on ${path} under reduce`, async ({ page }) => {
			await page.emulateMedia({ reducedMotion: "reduce" });
			await mockAuthenticatedApp(page, { tier: "FLAME" });
			await page.goto(path);
			await expect(page.locator("#main-content")).toBeVisible();
			await page.waitForLoadState("networkidle");

			expect(await timedCssMotion(page)).toEqual([]);
			expect(await movingElements(page)).toEqual([]);
		});
	}

	test("control: the same page does animate without the preference", async ({
		page,
	}) => {
		await page.emulateMedia({ reducedMotion: "no-preference" });
		await mockAuthenticatedApp(page, { tier: "FLAME" });
		await page.goto("/dashboard");
		await expect(page.locator("#main-content")).toBeVisible();

		// Without this the assertions above could pass because the probe is
		// blind, not because motion was reduced.
		expect((await timedCssMotion(page)).length).toBeGreaterThan(0);
	});
});
