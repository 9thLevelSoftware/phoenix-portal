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

	test("manual sync refreshes the integration and disconnect returns the provider to a connect state", async ({
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
					last_sync_at: "2025-09-20T12:00:00.000Z",
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
		await expect(page.getByText("Last synced: Just now")).toBeVisible();
		await expect(page.getByText("Recent Activity")).toHaveCount(0);

		await page.getByRole("button", { name: "Disconnect" }).click();
		await expect(
			page.getByRole("button", { name: "Connect Strava" }),
		).toBeVisible();
	});

	test("active sync count uses status, not the latest activity rows", async ({
		page,
	}) => {
		const userId = "00000000-0000-4000-8000-000000000001";
		const recent = Array.from({ length: 10 }, (_, index) => ({
			id: `sync-recent-${index}`,
			user_id: userId,
			provider: "hevy" as const,
			sync_type: "manual",
			status: index === 0 ? "superseded" : "completed",
			error_message: null,
			created_at: new Date(Date.now() - index * 1000).toISOString(),
			started_at: null,
			completed_at: new Date().toISOString(),
			retry_count: 0,
		}));

		await mockAuthenticatedApp(page, {
			tier: "FLAME",
			syncQueue: [
				...recent,
				{
					id: "sync-pending-old",
					user_id: userId,
					provider: "strava",
					sync_type: "manual",
					status: "pending",
					error_message: null,
					created_at: "2020-01-01T00:00:00.000Z",
					started_at: null,
					completed_at: null,
					retry_count: 0,
				},
				{
					id: "sync-processing-old",
					user_id: userId,
					provider: "fitbit",
					sync_type: "manual",
					status: "processing",
					error_message: null,
					created_at: "2020-01-02T00:00:00.000Z",
					started_at: "2020-01-02T00:01:00.000Z",
					completed_at: null,
					retry_count: 0,
				},
			],
		});

		await page.goto("/integrations");
		await expect(page.getByText("1 sync(s) pending")).toBeVisible();
		await expect(page.getByText("Syncing fitbit...")).toBeVisible();
		await expect(page.getByText("All synced")).toHaveCount(0);
		await expect(page.getByText("superseded")).toBeVisible();
		await expect(page.getByText("strava", { exact: true })).toHaveCount(0);
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
