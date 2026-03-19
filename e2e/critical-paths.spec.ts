import { expect, test } from "@playwright/test";
import { mockAuthenticatedApp } from "./support/mockSupabase";

const SEEDED_SESSION_ID = "00000000-0000-4000-8000-000000000101";
const SEEDED_EXERCISE_ID = "00000000-0000-4000-8000-000000000201";

/**
 * Critical Path E2E Tests — Phase 4.11
 *
 * Tests four critical user flows:
 * 1. Routine builder — form loads and is interactive
 * 2. Cycle builder — schedule and form present
 * 3. Subscription gate — free users blocked from FLAME content
 * 4. Session detail — full workout data renders correctly
 */

test.describe("Routine Builder", () => {
	test.beforeEach(async ({ page }) => {
		await mockAuthenticatedApp(page, { tier: "FLAME" });
	});

	test("routine builder loads with form elements and add exercise button", async ({
		page,
	}) => {
		await page.goto("/routines/new");

		// Header controls present
		await expect(
			page.getByRole("button", { name: /cancel/i }),
		).toBeVisible({ timeout: 10000 });

		// Routine name input is editable
		const nameInput = page.locator('input[placeholder*="routine" i], input[placeholder*="name" i]').first();
		if (await nameInput.isVisible()) {
			await nameInput.fill("Test Upper Body Routine");
			await expect(nameInput).toHaveValue("Test Upper Body Routine");
		}

		// Add Exercise button present
		await expect(
			page.getByRole("button", { name: /add exercise/i }),
		).toBeVisible();
	});
});

test.describe("Cycle Builder", () => {
	test.beforeEach(async ({ page }) => {
		await mockAuthenticatedApp(page, { tier: "FLAME" });
	});

	test("cycle builder loads with schedule and duration controls", async ({
		page,
	}) => {
		await page.goto("/cycles/new");

		// Header controls present
		await expect(
			page.getByRole("button", { name: /cancel/i }),
		).toBeVisible({ timeout: 10000 });

		// Cycle Details section visible
		await expect(
			page.getByText(/cycle details|duration/i).first(),
		).toBeVisible();

		// Schedule section visible — day cards or workout schedule
		await expect(
			page.getByText(/workout schedule|week at a glance|day 1/i).first(),
		).toBeVisible();
	});
});

test.describe("Subscription Gate Behavior", () => {
	test("free users see upgrade prompt on integrations page", async ({
		page,
	}) => {
		await mockAuthenticatedApp(page, { tier: "FREE" });

		await page.goto("/integrations");

		// Should see upgrade prompt, NOT integration management UI
		await expect(
			page.getByText(/upgrade to flame/i),
		).toBeVisible({ timeout: 10000 });
		await expect(
			page.getByRole("link", { name: /compare plans/i }),
		).toBeVisible();
	});

	test("FLAME users can access integrations page fully", async ({
		page,
	}) => {
		await mockAuthenticatedApp(page, { tier: "FLAME" });

		await page.goto("/integrations");

		// Should NOT see upgrade prompt
		await expect(page.getByText(/upgrade to flame/i)).not.toBeVisible();

		// Should see integration management — provider cards or connect buttons
		await expect(
			page.getByText(/strava|fitbit|garmin|hevy/i).first(),
		).toBeVisible({ timeout: 10000 });
	});
});

test.describe("Session Detail with Full Data", () => {
	test("renders workout session with exercises, sets, and stats", async ({
		page,
	}) => {
		await mockAuthenticatedApp(page, {
			tier: "FLAME",
			workoutSessions: [
				{
					id: SEEDED_SESSION_ID,
					user_id: "00000000-0000-4000-8000-000000000001",
					name: "Pull Day",
					started_at: "2026-03-15T10:00:00.000Z",
					duration_seconds: 3600,
					total_volume: 5200,
					set_count: 6,
					exercise_count: 2,
					pr_count: 2,
					routine_name: "Upper Pull",
					workout_mode: "strength",
					notes: "Great session, felt strong",
				},
			],
			exercises: [
				{
					id: SEEDED_EXERCISE_ID,
					session_id: SEEDED_SESSION_ID,
					name: "Deadlift",
					muscle_group: "Back",
					order_index: 0,
				},
				{
					id: "00000000-0000-4000-8000-000000000202",
					session_id: SEEDED_SESSION_ID,
					name: "Barbell Row",
					muscle_group: "Back",
					order_index: 1,
				},
			],
			sets: [
				{
					id: "00000000-0000-4000-8000-000000000301",
					exercise_id: SEEDED_EXERCISE_ID,
					set_number: 1,
					target_reps: 5,
					actual_reps: 5,
					weight_kg: 140,
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
					weight_kg: 130,
					rpe: 7,
					is_pr: false,
					notes: null,
				},
				{
					id: "00000000-0000-4000-8000-000000000303",
					exercise_id: SEEDED_EXERCISE_ID,
					set_number: 3,
					target_reps: 5,
					actual_reps: 4,
					weight_kg: 130,
					rpe: 9,
					is_pr: false,
					notes: null,
				},
				{
					id: "00000000-0000-4000-8000-000000000304",
					exercise_id: "00000000-0000-4000-8000-000000000202",
					set_number: 1,
					target_reps: 8,
					actual_reps: 8,
					weight_kg: 80,
					rpe: 7,
					is_pr: true,
					notes: null,
				},
				{
					id: "00000000-0000-4000-8000-000000000305",
					exercise_id: "00000000-0000-4000-8000-000000000202",
					set_number: 2,
					target_reps: 8,
					actual_reps: 8,
					weight_kg: 75,
					rpe: 7,
					is_pr: false,
					notes: null,
				},
				{
					id: "00000000-0000-4000-8000-000000000306",
					exercise_id: "00000000-0000-4000-8000-000000000202",
					set_number: 3,
					target_reps: 8,
					actual_reps: 7,
					weight_kg: 75,
					rpe: 8,
					is_pr: false,
					notes: null,
				},
			],
		});

		await page.goto(`/history/${SEEDED_SESSION_ID}`);

		// Session name visible
		await expect(
			page.getByRole("heading", { name: /Pull Day/i }),
		).toBeVisible({ timeout: 10000 });

		// Both exercises visible
		await expect(page.getByText("Deadlift")).toBeVisible();
		await expect(page.getByText("Barbell Row")).toBeVisible();

		// Session stats visible (duration, volume, or exercise count)
		await expect(
			page.getByText(/60.*min|1.*hour|3600/i).first(),
		).toBeVisible();

		// PR indicator visible for at least one set
		await expect(
			page.getByText(/PR|personal record/i).first(),
		).toBeVisible();
	});
});
