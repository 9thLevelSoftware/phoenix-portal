import { test as base, type Page } from "@playwright/test";

export const test = base.extend<{ authedPage: Page }>({
	authedPage: async ({ page }, use) => {
		const email = process.env.SUPABASE_TEST_EMAIL;
		const password = process.env.SUPABASE_TEST_PASSWORD;

		if (email && password) {
			// Navigate to login and authenticate
			await page.goto("/");
			// Wait for auth UI and fill credentials
			await page.getByPlaceholder(/email/i).fill(email);
			await page.getByPlaceholder(/password/i).fill(password);
			await page
				.getByRole("button", { name: /sign in|log in/i })
				.click();
			await page.waitForURL("**/dashboard", { timeout: 10000 });
		}

		await use(page);
	},
});

export { expect } from "@playwright/test";
