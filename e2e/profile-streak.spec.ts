import { expect, test } from "@playwright/test";
import { mockAuthenticatedApp } from "./support/mockSupabase";

const USER_ID = "00000000-0000-4000-8000-000000000001";

/**
 * 51 consecutive UTC workout days ending yesterday.
 * `workoutListOptions` keeps only 50 rows, so a client reduction of that
 * list reports 50. `workout_current_streak` reports 51.
 */
function fiftyOneDayHistory() {
	const yesterday = new Date();
	yesterday.setUTCHours(18, 0, 0, 0);
	yesterday.setUTCDate(yesterday.getUTCDate() - 1);

	return Array.from({ length: 51 }, (_, index) => {
		const started = new Date(yesterday);
		started.setUTCDate(yesterday.getUTCDate() - index);
		return {
			id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
			user_id: USER_ID,
			name: `Day ${index + 1}`,
			started_at: started.toISOString(),
			duration_seconds: 600,
			total_volume: 100,
			set_count: 1,
			exercise_count: 1,
			pr_count: 0,
			routine_name: null,
			workout_mode: "strength",
			notes: null,
		};
	});
}

test("profile current streak follows workout_current_streak past the 50-row list", async ({
	page,
}) => {
	await mockAuthenticatedApp(page, {
		tier: "EMBER",
		workoutSessions: fiftyOneDayHistory(),
	});

	await page.goto("/profile");

	await expect(page.getByText("51 day streak")).toBeVisible({
		timeout: 10000,
	});
	await expect(page.getByText("51d", { exact: true })).toBeVisible();
});
