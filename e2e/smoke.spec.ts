import { test as base, expect } from "@playwright/test";
import { test as authedTest } from "./fixtures/auth";

base.describe("Public pages", () => {
	base("landing page loads", async ({ page }) => {
		await page.goto("/");
		await expect(page).toHaveTitle(/Phoenix/i);
	});
});

authedTest.describe("Authenticated pages", () => {
	// These tests only run if SUPABASE_TEST_EMAIL is set
	const skip = !process.env.SUPABASE_TEST_EMAIL;

	authedTest(
		"dashboard loads with key sections",
		async ({ authedPage: page }) => {
			authedTest.skip(skip, "No test credentials");
			await page.goto("/dashboard");
			await expect(
				page.getByText(/Dashboard|Welcome/i).first(),
			).toBeVisible({ timeout: 10000 });
		},
	);

	authedTest(
		"workout history page loads",
		async ({ authedPage: page }) => {
			authedTest.skip(skip, "No test credentials");
			await page.goto("/history");
			await expect(
				page.getByRole("heading", { name: /Workout History/i }),
			).toBeVisible({ timeout: 10000 });
		},
	);

	authedTest(
		"session detail loads from history",
		async ({ authedPage: page }) => {
			authedTest.skip(skip, "No test credentials");
			await page.goto("/history");
			await page.waitForLoadState("networkidle");
			// Click the first session in the list to navigate to detail
			const firstSession = page
				.locator("[data-testid='session-row'], a[href*='/history/']")
				.first();
			// Skip if no sessions exist (new test user)
			if ((await firstSession.count()) === 0) {
				authedTest.skip(true, "No workout sessions for test user");
				return;
			}
			await firstSession.click();
			await expect(
				page.getByText(/Session Detail|Exercise|Sets/i).first(),
			).toBeVisible({ timeout: 10000 });
		},
	);

	authedTest(
		"analytics page loads",
		async ({ authedPage: page }) => {
			authedTest.skip(skip, "No test credentials");
			await page.goto("/analytics");
			await expect(
				page.getByRole("heading", { name: "Analytics Hub" }),
			).toBeVisible({ timeout: 10000 });
		},
	);

	authedTest(
		"community page loads",
		async ({ authedPage: page }) => {
			authedTest.skip(skip, "No test credentials");
			await page.goto("/community");
			await expect(
				page.getByRole("heading", { name: /Community/i }),
			).toBeVisible({ timeout: 10000 });
		},
	);

	authedTest("cycles page loads", async ({ authedPage: page }) => {
		authedTest.skip(skip, "No test credentials");
		await page.goto("/cycles");
		await expect(
			page.getByRole("heading", { name: /Training Cycles/i }),
		).toBeVisible({ timeout: 10000 });
	});

	authedTest(
		"routines page loads",
		async ({ authedPage: page }) => {
			authedTest.skip(skip, "No test credentials");
			await page.goto("/routines");
			await expect(
				page.getByRole("heading", { name: /Routines/i }),
			).toBeVisible({ timeout: 10000 });
		},
	);

	authedTest("profile page loads", async ({ authedPage: page }) => {
		authedTest.skip(skip, "No test credentials");
		await page.goto("/profile");
		await expect(
			page.getByRole("heading", { name: /vitruvian|profile/i }),
		).toBeVisible({ timeout: 10000 });
	});

	authedTest(
		"recovery page loads",
		async ({ authedPage: page }) => {
			authedTest.skip(skip, "No test credentials");
			await page.goto("/recovery");
			await expect(
				page.getByRole("heading", { name: "Recovery", exact: true }),
			).toBeVisible({ timeout: 10000 });
		},
	);
});
