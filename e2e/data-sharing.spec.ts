import { expect, test } from "@playwright/test";
import { mockAuthenticatedApp } from "./support/mockSupabase";

const USER_ID = "00000000-0000-4000-8000-000000000001";

function endpoint(overrides: Record<string, unknown> = {}) {
	return {
		id: "endpoint-existing",
		user_id: USER_ID,
		label: "Home server",
		url: "https://hooks.example.com/in",
		scopes: ["workouts", "routines"],
		status: "active",
		disabled_reason: null,
		custom_header_name: null,
		signing_key_hint: "abcd",
		consecutive_failures: 0,
		last_success_at: null,
		last_failure_at: null,
		created_at: "2026-11-01T12:00:00.000Z",
		updated_at: "2026-11-01T12:00:00.000Z",
		...overrides,
	};
}

test.describe("Data sharing", () => {
	test("a Flame user adds an endpoint, sees the secret once, tests it and deletes it", async ({
		page,
	}) => {
		await mockAuthenticatedApp(page, { tier: "FLAME" });
		await page.goto("/profile?tab=settings");

		const section = page.getByTestId("data-sharing");
		await expect(section.getByText(/No endpoints yet/)).toBeVisible();

		await section.getByRole("button", { name: "Add endpoint" }).click();
		const form = page.getByRole("dialog");
		await form.getByLabel("Name", { exact: true }).fill("Home server");
		await form.getByLabel("Endpoint URL").fill("https://hooks.example.com/in");
		await form.getByRole("switch", { name: "Workouts" }).click();
		await form.getByRole("button", { name: "Add endpoint" }).click();

		// The secret is shown once, then cannot be found anywhere on the page.
		const secret = page.getByTestId("signing-secret");
		await expect(secret).toContainText("whsec_");
		await page.getByRole("button", { name: "I have saved it" }).click();
		await expect(secret).toHaveCount(0);
		await expect(page.getByText(/whsec_/)).toHaveCount(0);

		await expect(section.getByText("Home server")).toBeVisible();
		await expect(section.getByText("Active", { exact: true })).toBeVisible();

		await section.getByRole("button", { name: "Send test" }).click();
		await expect(
			section.getByText("The receiver accepted the test delivery (200)."),
		).toBeVisible();
		await section.getByRole("button", { name: "Recent deliveries" }).click();
		await expect(section.getByText("Delivered", { exact: true })).toBeVisible();

		await section.getByRole("button", { name: "Delete", exact: true }).click();
		await page
			.getByRole("alertdialog")
			.getByRole("button", { name: "Delete endpoint" })
			.click();
		await expect(section.getByText(/No endpoints yet/)).toBeVisible();
	});

	test("a user below Flame can pause and delete an endpoint but not add or edit one", async ({
		page,
	}) => {
		await mockAuthenticatedApp(page, {
			tier: "EMBER",
			webhookEndpoints: [endpoint()],
		});
		await page.goto("/profile?tab=settings");

		const section = page.getByTestId("data-sharing");
		await expect(section.getByText("Home server")).toBeVisible();
		await expect(section.getByTestId("data-sharing-upgrade")).toContainText(
			"Data sharing is part of Flame.",
		);
		await expect(
			section.getByRole("button", { name: "Add endpoint" }),
		).toBeDisabled();
		await expect(
			section.getByRole("button", { name: "Edit", exact: true }),
		).toBeDisabled();
		await expect(
			section.getByRole("button", { name: "Send test" }),
		).toBeDisabled();

		await section.getByRole("button", { name: "Pause", exact: true }).click();
		await expect(section.getByText("Paused", { exact: true })).toBeVisible();
		await expect(section.getByText("You paused this endpoint.")).toBeVisible();
		// Switching it back on needs the plan.
		await expect(
			section.getByRole("button", { name: "Switch on" }),
		).toBeDisabled();
	});
});
