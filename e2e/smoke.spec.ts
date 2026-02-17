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
				page.getByText(/Dashboard|Welcome/i),
			).toBeVisible({ timeout: 10000 });
		},
	);

	authedTest(
		"workout history page loads",
		async ({ authedPage: page }) => {
			authedTest.skip(skip, "No test credentials");
			await page.goto("/history");
			await expect(
				page.getByText(/Workout History|No workouts/i),
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
			await firstSession.click();
			await expect(
				page.getByText(/Session Detail|Exercise|Sets/i),
			).toBeVisible({ timeout: 10000 });
		},
	);

	authedTest(
		"analytics page loads",
		async ({ authedPage: page }) => {
			authedTest.skip(skip, "No test credentials");
			await page.goto("/analytics");
			await expect(
				page.getByText(/Analytics|Performance/i),
			).toBeVisible({ timeout: 10000 });
		},
	);

	authedTest(
		"community page loads",
		async ({ authedPage: page }) => {
			authedTest.skip(skip, "No test credentials");
			await page.goto("/community");
			await expect(page.getByText(/Community/i)).toBeVisible({
				timeout: 10000,
			});
		},
	);

	authedTest("cycles page loads", async ({ authedPage: page }) => {
		authedTest.skip(skip, "No test credentials");
		await page.goto("/cycles");
		await expect(
			page.getByText(/Training Cycles|Create/i),
		).toBeVisible({ timeout: 10000 });
	});

	authedTest(
		"routines page loads",
		async ({ authedPage: page }) => {
			authedTest.skip(skip, "No test credentials");
			await page.goto("/routines");
			await expect(page.getByText(/Routines/i)).toBeVisible({
				timeout: 10000,
			});
		},
	);

	authedTest("profile page loads", async ({ authedPage: page }) => {
		authedTest.skip(skip, "No test credentials");
		await page.goto("/profile");
		await expect(
			page.getByText(/Profile|Settings/i),
		).toBeVisible({ timeout: 10000 });
	});

	authedTest(
		"recovery page loads",
		async ({ authedPage: page }) => {
			authedTest.skip(skip, "No test credentials");
			await page.goto("/recovery");
			await expect(page.getByText(/Recovery/i)).toBeVisible({
				timeout: 10000,
			});
		},
	);
});
