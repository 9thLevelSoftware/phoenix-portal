import { test, expect } from "@playwright/test";
import { mockAuthenticatedApp } from "./support/mockSupabase";

const SEEDED_SESSION_ID = "00000000-0000-4000-8000-000000000101";
const SEEDED_EXERCISE_ID = "00000000-0000-4000-8000-000000000201";

async function mockAuthedPortal(page: Parameters<typeof mockAuthenticatedApp>[0]) {
	await mockAuthenticatedApp(page, {
		tier: "FLAME",
		workoutSessions: [
			{
				id: SEEDED_SESSION_ID,
				user_id: "00000000-0000-4000-8000-000000000001",
				name: "Foundation Session",
				started_at: "2026-03-01T14:00:00.000Z",
				duration_seconds: 2700,
				total_volume: 2400,
				set_count: 3,
				exercise_count: 1,
				pr_count: 1,
				routine_name: "Upper Power",
				workout_mode: "strength",
				notes: "Seeded E2E workout",
			},
		],
		exercises: [
			{
				id: SEEDED_EXERCISE_ID,
				session_id: SEEDED_SESSION_ID,
				name: "Bench Press",
				muscle_group: "Chest",
				order_index: 0,
			},
		],
		sets: [
			{
				id: "00000000-0000-4000-8000-000000000301",
				exercise_id: SEEDED_EXERCISE_ID,
				set_number: 1,
				target_reps: 5,
				actual_reps: 5,
				weight_kg: 100,
				rpe: 8,
				is_pr: true,
				notes: null,
			},
			{
				id: "00000000-0000-4000-8000-000000000302",
				exercise_id: SEEDED_EXERCISE_ID,
				set_number: 2,
				target_reps: 5,
				actual_reps: 5,
				weight_kg: 95,
				rpe: 8,
				is_pr: false,
				notes: null,
			},
		],
	});
}

test.describe("Public pages", () => {
	test("landing page loads", async ({ page }) => {
		await page.goto("/");
		await expect(page).toHaveTitle(/Phoenix/i);
	});
});

test.describe("Authenticated pages", () => {
	test.beforeEach(async ({ page }) => {
		await mockAuthedPortal(page);
	});

	test("dashboard loads with key sections", async ({ page }) => {
			await page.goto("/dashboard");
			await expect(
				page.getByText(/Dashboard|Welcome/i).first(),
			).toBeVisible({ timeout: 10000 });
	});

	test("workout history page loads", async ({ page }) => {
			await page.goto("/history");
			await expect(
				page.getByRole("heading", { name: /Workout History/i }),
			).toBeVisible({ timeout: 10000 });
	});

	test("session detail loads from seeded workout data", async ({ page }) => {
			await page.goto(`/history/${SEEDED_SESSION_ID}`);
			await expect(
				page.getByRole("heading", { name: /Foundation Session/i }),
			).toBeVisible({ timeout: 10000 });
			await expect(page.getByText("Bench Press")).toBeVisible({ timeout: 10000 });
	});

	test("analytics page loads", async ({ page }) => {
			await page.goto("/analytics");
			await expect(
				page.getByRole("heading", { name: "Analytics Hub" }),
			).toBeVisible({ timeout: 10000 });
	});

	test("community page loads", async ({ page }) => {
			await page.goto("/community");
			await expect(
				page.getByRole("heading", { name: /Community/i }),
			).toBeVisible({ timeout: 10000 });
	});

	test("cycles page loads", async ({ page }) => {
		await page.goto("/cycles");
		await expect(
			page.getByRole("heading", { name: /Training Cycles/i }),
		).toBeVisible({ timeout: 10000 });
	});

	test("routines page loads", async ({ page }) => {
			await page.goto("/routines");
			await expect(
				page.getByRole("heading", { name: /Routines/i }),
			).toBeVisible({ timeout: 10000 });
	});

	test("profile page loads", async ({ page }) => {
		await page.goto("/profile");
		await expect(
			page.getByRole("heading", { name: /^e2e$/i }),
		).toBeVisible({ timeout: 10000 });
	});

	test("recovery page loads", async ({ page }) => {
		await page.goto("/recovery");
		await expect(
			page.getByRole("heading", { name: /Recovery Readiness/i }),
		).toBeVisible({ timeout: 10000 });
	});

	test("goals page loads", async ({ page }) => {
		await page.goto("/goals");
		await expect(
			page.getByRole("heading", { name: /Training Goals/i }),
		).toBeVisible({ timeout: 10000 });
	});

	test("compare page loads", async ({ page }) => {
		await page.goto("/compare");
		await expect(
			page.getByText(/Missing Session IDs|Session Comparison/i).first(),
		).toBeVisible({ timeout: 10000 });
	});
});
