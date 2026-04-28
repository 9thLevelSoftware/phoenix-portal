import { expect, test } from "@playwright/test";

// Protected routes that should redirect unauthenticated users to "/"
const protectedRoutes = [
	{ name: "Dashboard", path: "/dashboard" },
	{ name: "History", path: "/history" },
	{ name: "Analytics", path: "/analytics" },
	{ name: "Community", path: "/community" },
	{ name: "Profile", path: "/profile" },
	{ name: "Pricing", path: "/pricing" },
];

test.describe("Auth-gated route redirects", () => {
	for (const { name, path } of protectedRoutes) {
		test(`${name} (${path}) redirects unauthenticated users to landing`, async ({
			page,
		}) => {
			await page.goto(path);

			// ProtectedRoute redirects to "/" when no user session
			await page.waitForURL("/", { timeout: 10000 });

			// Confirm landing page content is visible
			await page.waitForTimeout(2000);
			await expect(
				page.getByRole("heading", { name: "Your workouts, unlocked." }),
			).toBeVisible();
		});
	}

	test("unknown routes redirect to landing", async ({ page }) => {
		await page.goto("/nonexistent-page-xyz");

		// Catch-all route redirects unauthenticated users to "/"
		await page.waitForURL("/", { timeout: 10000 });

		await page.waitForTimeout(2000);
		await expect(
			page.getByRole("heading", { name: "Your workouts, unlocked." }),
		).toBeVisible();
	});
});
