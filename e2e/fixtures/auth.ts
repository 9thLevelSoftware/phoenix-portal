import { test as base, type Page } from "@playwright/test";

export const test = base.extend<{ authedPage: Page }>({
	authedPage: async ({ page }, use) => {
		const email = process.env.SUPABASE_TEST_EMAIL;
		const password = process.env.SUPABASE_TEST_PASSWORD;

		if (email && password) {
			// Navigate to landing page
			await page.goto("/");
			await page.waitForLoadState("networkidle");
			// Wait for Framer Motion entrance animations to complete
			await page.waitForTimeout(2000);

			// Click "Get Started" to open the auth dialog
			await page
				.getByRole("button", { name: /get started/i })
				.first()
				.click();

			// Wait for the Radix Dialog to appear
			const dialog = page.locator('[role="dialog"]');
			await dialog.waitFor({ state: "visible", timeout: 5000 });

			// Fill credentials within the dialog scope
			await dialog.getByPlaceholder("you@example.com").fill(email);
			await dialog
				.getByPlaceholder("Enter your password")
				.fill(password);

			// Click Sign In within the dialog
			await dialog
				.getByRole("button", { name: /^sign in$/i })
				.click();

			// Wait for redirect to dashboard
			await page.waitForURL("**/dashboard", { timeout: 15000 });
		}

		await use(page);
	},
});

export { expect } from "@playwright/test";
