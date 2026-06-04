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
		personalRecords: [
			{
				id: "00000000-0000-4000-8000-000000000401",
				user_id: "00000000-0000-4000-8000-000000000001",
				exercise_name: "Bench Press",
				exercise_id: SEEDED_EXERCISE_ID,
				record_type: "MAX_WEIGHT",
				workout_phase: "CONCENTRIC",
				value: 100,
				achieved_at: "2026-03-01T14:00:00.000Z",
			},
			{
				id: "00000000-0000-4000-8000-000000000402",
				user_id: "00000000-0000-4000-8000-000000000001",
				exercise_name: "Bench Press",
				exercise_id: SEEDED_EXERCISE_ID,
				record_type: "MAX_WEIGHT",
				workout_phase: "ECCENTRIC",
				value: 125,
				achieved_at: "2026-03-01T14:00:00.000Z",
			},
		],
		phaseStatistics: [
			{
				session_id: SEEDED_SESSION_ID,
				user_id: "00000000-0000-4000-8000-000000000001",
				created_at: "2026-03-01T14:45:00.000Z",
				concentric_kg_avg: 80,
				concentric_kg_max: 100,
				concentric_vel_avg: 0.5,
				concentric_vel_max: 0.8,
				concentric_watt_avg: 200,
				concentric_watt_max: 300,
				eccentric_kg_avg: 95,
				eccentric_kg_max: 125,
				eccentric_vel_avg: 0.4,
				eccentric_vel_max: 0.7,
				eccentric_watt_avg: 220,
				eccentric_watt_max: 340,
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

	test("analytics progress tab shows phase-aware metrics", async ({ page }) => {
		await page.goto("/analytics?tab=progress");

		await expect(page.getByText("Phase Load, Speed & Power")).toBeVisible({
			timeout: 10000,
		});
		await expect(page.getByRole("button", { name: "All" })).toBeVisible();
		await expect(page.getByRole("button", { name: "Concentric" })).toBeVisible();
		await expect(page.getByRole("button", { name: "Eccentric" })).toBeVisible();
		await expect(page.getByText("Phase Strength Progression (kg)")).toBeVisible();
		await expect(page.getByText("125 kg")).toBeVisible();
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
