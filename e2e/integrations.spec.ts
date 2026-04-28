import { expect, test } from "@playwright/test";
import { mockAuthenticatedApp } from "./support/mockSupabase";

test.describe("Integrations", () => {
	test("oauth callback feedback is surfaced and the URL is cleaned up", async ({
		page,
	}) => {
		await mockAuthenticatedApp(page, { tier: "FLAME" });

		await page.goto("/integrations?connected=strava");
		await expect(page.getByText("Successfully connected strava")).toBeVisible();
		await expect(page).toHaveURL(/\/integrations$/);

		await page.goto("/integrations?error=auth_failed");
		await expect(
			page.getByText("Connection failed: auth_failed"),
		).toBeVisible();
		await expect(page).toHaveURL(/\/integrations$/);
	});

	test("manual sync updates status and disconnect returns the provider to a connect state", async ({
		page,
	}) => {
		await mockAuthenticatedApp(page, {
			tier: "FLAME",
			integrations: [
				{
					id: "integration-strava",
					user_id: "00000000-0000-4000-8000-000000000001",
					provider: "strava",
					provider_user_id: "athlete-1",
					connected_at: new Date().toISOString(),
					last_sync_at: null,
					status: "connected",
					error_message: null,
				},
			],
		});

		await page.goto("/integrations");
		await expect(
			page.getByRole("heading", { name: "Integrations" }),
		).toBeVisible();

		await page.getByRole("button", { name: "Sync Now" }).click();
		await expect(page.getByText("Recent Activity")).toBeVisible();
		await expect(page.getByText("completed")).toBeVisible();

		await page.getByRole("button", { name: "Disconnect" }).click();
		await expect(
			page.getByRole("button", { name: "Connect Strava" }),
		).toBeVisible();
	});

	test("garmin shows webhook guidance instead of a dead sync button", async ({
		page,
	}) => {
		await mockAuthenticatedApp(page, {
			tier: "FLAME",
			integrations: [
				{
					id: "integration-garmin",
					user_id: "00000000-0000-4000-8000-000000000001",
					provider: "garmin",
					provider_user_id: "garmin-athlete",
					connected_at: new Date().toISOString(),
					last_sync_at: new Date().toISOString(),
					status: "connected",
					error_message: null,
				},
			],
		});

		await page.goto("/integrations");
		await expect(
			page.getByText(
				"Garmin sync is webhook-driven. New activities appear automatically after Garmin pushes them.",
			),
		).toBeVisible();
		await expect(page.getByRole("button", { name: "Sync Now" })).toHaveCount(0);
	});
});
