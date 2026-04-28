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
		// FREE tier has no card in TIER_PRICING, so free users see Subscribe buttons
		await expect(
			page.getByRole("button", { name: "Subscribe" }).first(),
		).toBeVisible();

		await page.goto("/integrations");
		await expect(page.getByText("Upgrade to FLAME")).toBeVisible();
		await expect(
			page.getByRole("link", { name: "Compare Plans" }),
		).toBeVisible();
	});

	test("ember users see Ember as the current plan", async ({ page }) => {
		await mockAuthenticatedApp(page, { tier: "EMBER" });

		await page.goto("/pricing");
		await expect(
			page.getByRole("button", { name: "Current Plan" }),
		).toBeVisible();
		await expect(
			page.getByRole("heading", { name: "Ember", exact: true }),
		).toBeVisible();
	});

	test("flame users see lower tiers as included", async ({ page }) => {
		await mockAuthenticatedApp(page, { tier: "FLAME" });

		await page.goto("/pricing");
		await expect(page.getByText("Included in your plan")).toBeVisible();
	});
});
