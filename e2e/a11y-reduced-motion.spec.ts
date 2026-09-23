import { expect, test } from "@playwright/test";
import { mockAuthenticatedApp } from "./support/mockSupabase";

const ROUTES = ["/dashboard", "/analytics", "/history"];

test.describe("Reduced motion", () => {
	test.use({ reducedMotion: "reduce" });

	for (const path of ROUTES) {
		test(`no layout-animating transforms on ${path}`, async ({ page }) => {
			await mockAuthenticatedApp(page);
			await page.goto(path);
			await page.waitForLoadState("networkidle");

			const result = await page.evaluate(() => {
				const issues: Array<{ tag: string; cls: string; reason: string }> = [];
				document.querySelectorAll("*").forEach((element) => {
					const styles = window.getComputedStyle(element);
					const transitionProperty = styles.transitionProperty;
					if (
						transitionProperty.includes("width") ||
						transitionProperty.includes("height") ||
						transitionProperty.includes("top") ||
						transitionProperty.includes("left") ||
						transitionProperty.includes("margin") ||
						transitionProperty.includes("padding")
					) {
						issues.push({
							tag: element.tagName,
							cls: (element as HTMLElement).className
								?.toString()
								.slice(0, 60) ?? "",
							reason: `layout transition: ${transitionProperty}`,
						});
					}
				});
				return issues;
			});

			expect(result).toEqual([]);
		});
	}
});
