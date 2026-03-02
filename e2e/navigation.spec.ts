import { test, expect, type Page } from "@playwright/test";

// Helper: navigate to landing and wait for framer-motion entrance animations
async function gotoLanding(page: Page) {
	await page.goto("/");
	await page.waitForLoadState("domcontentloaded");
	await page.waitForTimeout(2000);
}

test.describe("Navigation and cross-page links", () => {
	test("footer Privacy link navigates correctly", async ({ page }) => {
		await gotoLanding(page);

		// Footer privacy link - scroll into view and click
		const privacyLink = page.locator('footer a[href="/privacy"]');
		await privacyLink.scrollIntoViewIfNeeded();
		await privacyLink.click();

		// Verify navigation
		await page.waitForURL("/privacy", { timeout: 5000 });
		await page.waitForTimeout(1000);
		await expect(
			page.getByRole("heading", { name: /Privacy/i }).first(),
		).toBeVisible();
	});

	test("footer Terms of Service link navigates correctly", async ({
		page,
	}) => {
		await gotoLanding(page);

		// Footer terms link
		const termsLink = page.locator('footer a[href="/terms"]').first();
		await termsLink.scrollIntoViewIfNeeded();
		await termsLink.click();

		// Verify navigation
		await page.waitForURL("/terms", { timeout: 5000 });
		await page.waitForTimeout(1000);
		await expect(
			page.getByRole("heading", { name: /Terms/i }).first(),
		).toBeVisible();
	});

	test("footer FAQ & Contact link navigates correctly", async ({ page }) => {
		await gotoLanding(page);

		// Footer FAQ link
		const faqLink = page.locator('footer a[href="/faq"]');
		await faqLink.scrollIntoViewIfNeeded();
		await faqLink.click();

		// Verify navigation
		await page.waitForURL("/faq", { timeout: 5000 });
		await page.waitForTimeout(1000);
		await expect(
			page.getByRole("heading", { name: /Frequently Asked/i }).first(),
		).toBeVisible();
	});

	test("privacy page back-navigation to landing", async ({ page }) => {
		await page.goto("/privacy");
		await page.waitForLoadState("domcontentloaded");
		await page.waitForTimeout(1000);

		// Verify privacy page loaded
		await expect(
			page.getByRole("heading", { name: /Privacy/i }).first(),
		).toBeVisible();

		// Navigate to landing
		await page.goto("/");
		await page.waitForLoadState("domcontentloaded");
		await page.waitForTimeout(2000);

		// Landing content visible
		await expect(page.getByText("Project Phoenix").first()).toBeVisible();
	});

	test("cross-navigation between legal pages renders without errors", async ({
		page,
	}) => {
		const errors: string[] = [];
		page.on("pageerror", (err) => errors.push(err.message));

		// Visit privacy page
		await page.goto("/privacy");
		await page.waitForLoadState("domcontentloaded");
		await page.waitForTimeout(1000);
		await expect(
			page.getByRole("heading", { name: /Privacy/i }).first(),
		).toBeVisible();

		// Navigate to terms page
		await page.goto("/terms");
		await page.waitForLoadState("domcontentloaded");
		await page.waitForTimeout(1000);
		await expect(
			page.getByRole("heading", { name: /Terms/i }).first(),
		).toBeVisible();

		// Navigate to FAQ page
		await page.goto("/faq");
		await page.waitForLoadState("domcontentloaded");
		await page.waitForTimeout(1000);
		await expect(
			page.getByRole("heading", { name: /Frequently Asked/i }).first(),
		).toBeVisible();

		// No errors during any navigation
		expect(errors).toHaveLength(0);
	});
});
