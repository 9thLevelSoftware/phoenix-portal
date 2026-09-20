import { expect, test } from "@playwright/test";
import { mockAuthenticatedApp } from "./support/mockSupabase";

const USER_ID = "00000000-0000-4000-8000-000000000001";
const SESSION_COUNT = 300;
const DAY_MS = 24 * 60 * 60 * 1000;

// One exercise per muscle group, so the distribution has more than one slice.
const EXERCISE_NAMES = ["Bench Press", "Bent Over Row", "Back Squat"];

function seedHistory() {
	const workoutSessions = [];
	const exercises = [];

	for (let index = 0; index < SESSION_COUNT; index++) {
		const sessionId = `00000000-0000-4000-8000-${String(1000 + index).padStart(12, "0")}`;
		const startedAt = new Date(
			Date.now() - (SESSION_COUNT - 1 - index) * DAY_MS,
		).toISOString();

		workoutSessions.push({
			id: sessionId,
			user_id: USER_ID,
			name: `Session ${index + 1}`,
			started_at: startedAt,
			duration_seconds: 3000,
			total_volume: 2000 + index,
			set_count: 12,
			exercise_count: EXERCISE_NAMES.length,
			pr_count: 0,
			routine_name: "Full Body",
			workout_mode: "strength",
			notes: null,
		});

		EXERCISE_NAMES.forEach((name, order) => {
			exercises.push({
				id: `${sessionId}-${order}`,
				session_id: sessionId,
				name,
				// Production rows carry a hardcoded "General"; classification must
				// come from the exercise name.
				muscle_group: "General",
				order_index: order,
			});
		});
	}

	return { workoutSessions, exercises };
}

/**
 * Regression for F-035: the muscle distribution used to fetch every session id
 * and send them all back in a `.in(session_id, ids)` GET URL, which exceeds the
 * ~8 KB URL limit at roughly 200 sessions. A 300-session account must render
 * the chart from a single aggregate RPC.
 */
test.describe("Analytics at 300 sessions", () => {
	test("renders the muscle chart without any session id list in a URL", async ({
		page,
	}) => {
		const requestUrls: string[] = [];
		page.on("request", (request) => {
			requestUrls.push(request.url());
		});

		await mockAuthenticatedApp(page, { tier: "FLAME", ...seedHistory() });
		await page.goto("/analytics");

		await expect(
			page.getByRole("heading", { name: "Analytics Hub" }),
		).toBeVisible({ timeout: 30000 });
		const muscleCard = page
			.locator("div")
			.filter({
				has: page.getByRole("heading", { name: "Muscle Group Distribution" }),
			})
			.last();
		await expect(muscleCard).toBeVisible({ timeout: 15000 });

		// The donut is rendered on a canvas, which only mounts when the
		// distribution has rows; the empty state replaces it otherwise.
		await expect(muscleCard.locator("canvas")).toHaveCount(1, {
			timeout: 15000,
		});
		await expect(page.getByText("No muscle group data yet")).toHaveCount(0);
		await expect(page.getByText("No volume data for this period")).toHaveCount(
			0,
		);

		const frequencyCalls = requestUrls.filter((url) =>
			url.includes("/rest/v1/rpc/exercise_frequency"),
		);
		expect(frequencyCalls.length).toBeGreaterThan(0);

		const idListRequests = requestUrls.filter(
			(url) => url.includes("session_id=in.") || url.includes("id=in."),
		);
		expect(idListRequests).toEqual([]);

		const longestUrl = requestUrls.reduce(
			(max, url) => Math.max(max, url.length),
			0,
		);
		expect(longestUrl).toBeLessThan(8000);
	});
});
