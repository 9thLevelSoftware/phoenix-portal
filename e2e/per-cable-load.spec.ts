import { expect, test } from "@playwright/test";
import { mockAuthenticatedApp } from "./support/mockSupabase";

// KD-8: loads are shown per cable first (as on the phone). A total appears
// only when the exercise's cable count is known; NULL never means 2 cables.

const USER_ID = "00000000-0000-4000-8000-000000000001";
const SESSION_ID = "00000000-0000-4000-8000-000000000a01";
const TWO_CABLE_EXERCISE_ID = "00000000-0000-4000-8000-000000000a11";
const ONE_CABLE_EXERCISE_ID = "00000000-0000-4000-8000-000000000a12";
const UNKNOWN_CABLE_EXERCISE_ID = "00000000-0000-4000-8000-000000000a13";

function daysAgo(days: number): string {
	return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function set(id: string, exerciseId: string, weightKg: number) {
	return {
		id,
		exercise_id: exerciseId,
		set_number: 1,
		target_reps: 8,
		actual_reps: 8,
		weight_kg: weightKg,
		rpe: 8,
		is_pr: false,
		notes: null,
	};
}

async function seed(page: Parameters<typeof mockAuthenticatedApp>[0]) {
	await mockAuthenticatedApp(page, {
		tier: "INFERNO",
		workoutSessions: [
			{
				id: SESSION_ID,
				user_id: USER_ID,
				name: "Cable Count Session",
				started_at: daysAgo(3),
				duration_seconds: 1800,
				total_volume: 1200,
				set_count: 3,
				exercise_count: 3,
				pr_count: 0,
				routine_name: null,
				workout_mode: "OLD_SCHOOL",
				notes: null,
				heaviest_lift_kg: 20,
			},
		],
		exercises: [
			{
				id: TWO_CABLE_EXERCISE_ID,
				session_id: SESSION_ID,
				name: "Bench Press",
				muscle_group: "Chest",
				order_index: 0,
				cable_count: 2,
			},
			{
				id: ONE_CABLE_EXERCISE_ID,
				session_id: SESSION_ID,
				name: "Single Arm Row",
				muscle_group: "Back",
				order_index: 1,
				cable_count: 1,
			},
			{
				id: UNKNOWN_CABLE_EXERCISE_ID,
				session_id: SESSION_ID,
				name: "Squat",
				muscle_group: "Legs",
				order_index: 2,
				cable_count: null,
			},
		],
		sets: [
			set("00000000-0000-4000-8000-000000000a21", TWO_CABLE_EXERCISE_ID, 20),
			set("00000000-0000-4000-8000-000000000a22", ONE_CABLE_EXERCISE_ID, 20),
			set("00000000-0000-4000-8000-000000000a23", UNKNOWN_CABLE_EXERCISE_ID, 20),
		],
		personalRecords: [
			{
				id: "00000000-0000-4000-8000-000000000a31",
				user_id: USER_ID,
				exercise_name: "Bench Press",
				exercise_id: TWO_CABLE_EXERCISE_ID,
				muscle_group: "Chest",
				record_type: "MAX_WEIGHT",
				workout_phase: "COMBINED",
				value: 20,
				unit: "kg",
				previous_value: 18,
				achieved_at: daysAgo(3),
			},
		],
		exerciseProgress: [
			{
				id: "00000000-0000-4000-8000-000000000a41",
				user_id: USER_ID,
				exercise_name: "Bench Press",
				session_id: SESSION_ID,
				recorded_at: daysAgo(10),
				max_weight_kg: 18,
				total_volume_kg: 144,
				estimated_1rm_kg: 22,
				velocity_estimated_1rm_kg: null,
				max_reps: 8,
				set_count: 1,
			},
			{
				id: "00000000-0000-4000-8000-000000000a42",
				user_id: USER_ID,
				exercise_name: "Bench Press",
				session_id: SESSION_ID,
				recorded_at: daysAgo(3),
				max_weight_kg: 20,
				total_volume_kg: 160,
				estimated_1rm_kg: 25,
				velocity_estimated_1rm_kg: null,
				max_reps: 8,
				set_count: 1,
			},
		],
	});
}

test.describe("Per-cable load display", () => {
	test.beforeEach(async ({ page }) => {
		await seed(page);
	});

	test("session detail shows per cable first, total only with a known count", async ({
		page,
	}) => {
		await page.goto(`/history/${SESSION_ID}`);
		await expect(
			page.getByRole("heading", { name: /Cable Count Session/i }),
		).toBeVisible({ timeout: 10000 });

		// First exercise (2 cables) is expanded by default.
		await expect(page.getByText("20 kg per cable · 40 kg total")).toBeVisible();

		await page.getByRole("button", { name: /Single Arm Row/i }).click();
		await expect(page.getByText("20 kg per cable · 20 kg total")).toBeVisible();

		await page.getByRole("button", { name: /Squat/i }).click();
		await expect(
			page.getByText("20 kg per cable", { exact: true }).first(),
		).toBeVisible();
	});

	test("records show per-cable values without doubling", async ({ page }) => {
		await page.goto("/analytics?tab=records");
		await expect(
			page.getByRole("button", { name: /Bench Press.*20 kg per cable/ }),
		).toBeVisible({ timeout: 10000 });
		await expect(page.getByText(/40 kg/)).toHaveCount(0);
	});

	test("progress shows the stored 1RM per cable without doubling", async ({
		page,
	}) => {
		await page.goto("/analytics?tab=progress");
		await expect(page.getByText("current 1RM", { exact: true }).filter({ visible: true })).toBeVisible({
			timeout: 15000,
		});
		await expect(page.getByText("25 kg per cable").filter({ visible: true }).first()).toBeVisible();
		await expect(page.getByText(/50 kg/)).toHaveCount(0);
	});
});
