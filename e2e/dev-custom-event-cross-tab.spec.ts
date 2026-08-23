import { expect, test, type Page } from "@playwright/test";
import { mockAuthenticatedApp } from "./support/mockSupabase";
import { E2E_SUPABASE_URL } from "./support/supabase";

/**
 * DEV CustomEvent cross-tab invalidation — NOT live Supabase Broadcast (A-028).
 *
 * Playwright E2E has a mocked REST surface and no Realtime WebSocket. This
 * spec dispatches `phoenix:e2e-sync-complete` (DEV-only listener in
 * `useRealtimeSync`) after swapping the mock workout list. Passing it does
 * not prove FP-6 / Broadcast topic `sync:{userId}`.
 *
 * The skipped case below is a regression marker for a live Broadcast run;
 * it is not executed in this harness.
 */

const USER_ID = "00000000-0000-4000-8000-000000000001";
const SESSION_A_ID = "00000000-0000-4000-8000-000000001001";
const SESSION_B_ID = "00000000-0000-4000-8000-000000001002";
const NEW_SESSION_ID = "00000000-0000-4000-8000-000000001099";

/** Seed a workouts list that both tabs will load on /dashboard. */
function seedWorkouts(extra?: Record<string, unknown>[]) {
	return [
		{
			id: SESSION_A_ID,
			user_id: USER_ID,
			name: "Pull Day",
			started_at: "2026-04-01T10:00:00.000Z",
			duration_seconds: 3600,
			total_volume: 5000,
			set_count: 10,
			exercise_count: 3,
			pr_count: 0,
			routine_name: "Upper Pull",
			workout_mode: "strength",
			notes: null,
		},
		{
			id: SESSION_B_ID,
			user_id: USER_ID,
			name: "Push Day",
			started_at: "2026-04-02T10:00:00.000Z",
			duration_seconds: 3000,
			total_volume: 4500,
			set_count: 9,
			exercise_count: 3,
			pr_count: 1,
			routine_name: "Upper Push",
			workout_mode: "strength",
			notes: null,
		},
		...(extra ?? []),
	];
}

async function openDashboard(page: Page) {
	await page.goto("/dashboard");
	await expect(
		page.getByText(/Dashboard|Welcome/i).first(),
	).toBeVisible({ timeout: 10000 });
}

function workoutHeading(page: Page, name: string) {
	return page.getByRole("heading", { name, exact: true });
}

test.describe("DEV CustomEvent cross-tab invalidation (not Broadcast)", () => {
	test.skip(
		"live Supabase Broadcast drives cross-tab invalidation — not covered here",
		async () => {
			// Would require VITE_SUPABASE_URL pointing to a real project that
			// authorises WebSocket connections. This file is not that proof.
			// Manual path if operators ever need it:
			//   1. Log in as the same user in two tabs.
			//   2. From tab A, complete a mobile workout (or send
			//      sync_complete on private sync:{userId}).
			//   3. Observe tab B's dashboard workout list refreshes within 1s.
		},
	);

	test("DEV CustomEvent: tab B reloads workout list after simulated sync", async ({
		browser,
	}) => {
		// Two isolated contexts — each gets its own cookies/storage.
		const contextA = await browser.newContext();
		const contextB = await browser.newContext();
		const pageA = await contextA.newPage();
		const pageB = await contextB.newPage();

		try {
			// Seed each tab with the same user and starter workout list.
			const seedSessions = seedWorkouts();
			await mockAuthenticatedApp(pageA, {
				tier: "EMBER",
				userId: USER_ID,
				workoutSessions: [...seedSessions],
			});
			await mockAuthenticatedApp(pageB, {
				tier: "EMBER",
				userId: USER_ID,
				workoutSessions: [...seedSessions],
			});

			await openDashboard(pageA);
			await openDashboard(pageB);

			// Step 1: verify tab B sees the initial list (two sessions, no new one)
			await expect(workoutHeading(pageB, "Pull Day")).toBeVisible({
				timeout: 10000,
			});
			await expect(workoutHeading(pageB, "Push Day")).toBeVisible();

			// Step 2: inject a new session into tab B's mock dataset. Next time
			// the Dashboard's workout query refetches, it will see the row.
			//
			// Because mockAuthenticatedApp uses a closure-scoped state object
			// per call, we reinstall the mock with the expanded list. The new
			// route handler runs before the previous one (LIFO).
			await pageB.route(
				`${E2E_SUPABASE_URL}/rest/v1/workout_sessions**`,
				async (route) => {
					await route.fulfill({
						status: 200,
						contentType: "application/json",
						body: JSON.stringify([
							...seedSessions,
							{
								id: NEW_SESSION_ID,
								user_id: USER_ID,
								name: "Leg Day",
								started_at: "2026-04-03T10:00:00.000Z",
								duration_seconds: 2700,
								total_volume: 6000,
								set_count: 12,
								exercise_count: 4,
								pr_count: 1,
								routine_name: "Lower",
								workout_mode: "strength",
								notes: null,
							},
						]),
					});
				},
			);

			// Step 3: DEV-only CustomEvent. This is not a Broadcast send.
			await pageB.evaluate((userId) => {
				window.dispatchEvent(
					new CustomEvent("phoenix:e2e-sync-complete", {
						detail: { userId },
					}),
				);
			}, USER_ID);

			// Step 4: assert tab B now shows "Leg Day" within 5s. If the
			// invalidation didn't propagate we'd time out here.
			await expect(workoutHeading(pageB, "Leg Day")).toBeVisible({
				timeout: 5000,
			});
		} finally {
			await contextA.close();
			await contextB.close();
		}
	});
});
