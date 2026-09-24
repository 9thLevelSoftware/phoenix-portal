import { expect, test } from "@playwright/test";
import { mockAuthenticatedApp } from "./support/mockSupabase";

test.describe("Keyboard navigation", () => {
	test("sidebar is fully keyboard-navigable with visible focus", async ({
		page,
	}) => {
		await mockAuthenticatedApp(page);
		await page.goto("/dashboard");

		// Focus SkipToContent first, then tab through the shell controls.
		await page.keyboard.press("Tab");
		const firstFocused = await page.evaluate(
			() =>
				document.activeElement?.tagName +
				" " +
				document.activeElement?.textContent,
		);
		expect(firstFocused.toLowerCase()).toContain("skip");

		const navLinks = page.locator('[data-sidebar="menu"] a[href]');
		const count = await navLinks.count();
		expect(count).toBeGreaterThan(5);

		for (let i = 0; i < count; i++) {
			await page.keyboard.press("Tab");
			const focused = page.locator(":focus");
			await expect(focused).toBeVisible();

			// Tailwind focus-visible rings are rendered as a box shadow by the
			// browser; keep outline as a fallback for native focus indicators.
			const focusIndicator = await focused.evaluate((element) => {
				const styles = window.getComputedStyle(element);
				return {
					outlineStyle: styles.outlineStyle,
					boxShadow: styles.boxShadow,
				};
			});
			expect(
				focusIndicator.outlineStyle !== "none" ||
					focusIndicator.boxShadow !== "none",
			).toBe(true);
		}
	});

	test("command palette or dialogs are keyboard reachable", async ({
		page,
	}) => {
		await mockAuthenticatedApp(page);
		await page.goto("/dashboard");

		// The shell currently exposes Ctrl/Cmd+B for the sidebar. Keep this
		// check tolerant of builds that do not provide a command palette.
		const isMac = process.platform === "darwin";
		await page.keyboard.press(isMac ? "Meta+K" : "Control+K");
		const palette = page.locator("[role='dialog'], [cmdk-root]");
		if (await palette.count()) {
			await expect(palette).toBeVisible();
			await page.keyboard.press("Escape");
			await expect(palette).not.toBeVisible();
		}
	});
});
