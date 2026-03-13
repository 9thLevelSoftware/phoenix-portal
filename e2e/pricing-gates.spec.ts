import { expect, test } from "@playwright/test";
import { mockAuthenticatedApp } from "./support/mockSupabase";

test.describe("Pricing and gates", () => {
	test("free users see app-managed upgrade CTAs and annual pricing", async ({
		page,
	}) => {
		await mockAuthenticatedApp(page, { tier: "FREE" });

		await page.goto("/pricing");
		await expect(
			page.getByRole("heading", { name: "Choose Your Plan" }),
		).toBeVisible();
		await expect(
			page.getByRole("button", { name: "Current Plan" }),
		).toBeVisible();
		await expect(
			page.getByRole("button", { name: "Subscribe in the App" }),
		).toHaveCount(2);

		await page.getByRole("switch", { name: "Annual billing" }).click();
		await expect(page.getByText("$12.50").first()).toBeVisible();
		await expect(page.getByText("$20.83").first()).toBeVisible();

		await page.goto("/integrations");
		await expect(page.getByText("Upgrade to ELITE")).toBeVisible();
		await expect(page.getByRole("link", { name: "Compare Plans" })).toBeVisible();
	});

	test("phoenix users see Phoenix as the current plan", async ({ page }) => {
		await mockAuthenticatedApp(page, { tier: "PHOENIX" });

		await page.goto("/pricing");
		await expect(
			page.getByRole("button", { name: "Current Plan" }),
		).toBeVisible();
		await expect(
			page.getByRole("button", { name: "Subscribe in the App" }),
		).toHaveCount(1);
		await expect(
			page.getByRole("heading", { name: "Phoenix", exact: true }),
		).toBeVisible();
	});

	test("elite users see lower tiers included instead of upgrade CTAs", async ({
		page,
	}) => {
		await mockAuthenticatedApp(page, { tier: "ELITE" });

		await page.goto("/pricing");
		await expect(page.getByText("Included in Elite")).toBeVisible();
		await expect(
			page.getByRole("button", { name: "Subscribe in the App" }),
		).toHaveCount(0);
	});
});
