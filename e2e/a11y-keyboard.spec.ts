import { expect, test } from "@playwright/test";
import { mockAuthenticatedApp } from "./support/mockSupabase";

test.describe("Keyboard navigation", () => {
	test.beforeEach(async ({ page }) => {
		// FLAME so /dashboard renders the app shell, not the upgrade prompt.
		await mockAuthenticatedApp(page, { tier: "FLAME" });
		await page.goto("/dashboard");
		await expect(page.locator("#main-content")).toBeVisible();
	});

	test("every sidebar link is reachable by Tab and shows a visible focus indicator", async ({
		page,
	}) => {
		// The skip link is the first stop.
		await page.keyboard.press("Tab");
		await expect(page.locator(":focus")).toHaveText(/skip/i);

		const links = page.locator('[data-sidebar="menu"] a[href]');
		const count = await links.count();
		expect(count).toBeGreaterThan(5);

		// Each link's appearance before it is focused, to prove focus changes it.
		const focusStyle = (element: Element) => {
			const styles = window.getComputedStyle(element);
			return `${styles.outlineStyle} ${styles.outlineWidth} ${styles.boxShadow}`;
		};
		const unfocused = await links.evaluateAll((elements) =>
			elements.map((element) => {
				const styles = window.getComputedStyle(element);
				return `${styles.outlineStyle} ${styles.outlineWidth} ${styles.boxShadow}`;
			}),
		);

		for (let i = 0; i < count; i++) {
			const link = links.nth(i);
			// Tab forward (bounded) until this link has focus, so the test fails
			// if a link is skipped or unreachable instead of passing on whatever
			// happens to be focused.
			for (let presses = 0; presses < 15; presses++) {
				if (
					await link.evaluate((element) => element === document.activeElement)
				)
					break;
				await page.keyboard.press("Tab");
			}
			await expect(link).toBeFocused();
			expect(
				await link.evaluate((element) => element.matches(":focus-visible")),
			).toBe(true);
			expect(
				await link.evaluate(focusStyle),
				`link ${i} looks the same focused and unfocused`,
			).not.toBe(unfocused[i]);
		}
	});

	test("Ctrl/Cmd+B collapses and expands the sidebar", async ({ page }) => {
		const sidebar = page.locator('[data-slot="sidebar"][data-state]');
		await expect(sidebar).toHaveAttribute("data-state", "expanded");

		// The handler compares event.key with "b", so the key must be lowercase.
		await page.keyboard.press("ControlOrMeta+b");
		await expect(sidebar).toHaveAttribute("data-state", "collapsed");
		// Regressions: collapsing used to flip straight back (useAutoCollapse
		// re-applied the stored preference) and to crash the app through a
		// Radix tooltip ref loop, unmounting everything.
		await page.waitForTimeout(500);
		await expect(sidebar).toHaveAttribute("data-state", "collapsed");
		await expect(page.locator("#main-content")).toBeVisible();
		await expect(page.getByRole("link", { name: "Workouts" })).toHaveAttribute(
			"title",
			"Workouts",
		);

		await page.keyboard.press("ControlOrMeta+b");
		await expect(sidebar).toHaveAttribute("data-state", "expanded");
		await page.waitForTimeout(500);
		await expect(sidebar).toHaveAttribute("data-state", "expanded");
	});
});
