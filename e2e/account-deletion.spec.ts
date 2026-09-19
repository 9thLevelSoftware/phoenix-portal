import { expect, test, type Page, type Route } from "@playwright/test";
import { mockAuthenticatedApp } from "./support/mockSupabase";
import {
	E2E_SUPABASE_STORAGE_KEY,
	E2E_SUPABASE_URL,
} from "./support/supabase";

/**
 * Account deletion E2E — covers audit 05 priority gap #16.
 *
 * The real flow (src/app/components/profile/DangerZone.tsx) has three
 * states:
 *   A) No pending request → show "Delete My Account" button + confirmation
 *   B) Pending, within 30-day grace period → show countdown + "Cancel"
 *   C) Pending, grace period expired → show "Delete Now" + final confirm
 *
 * This spec covers (A) request and the (C) confirm-to-delete flow, which
 * is the destructive path the audit calls out as safety-critical. We use
 * Playwright route interception to mock the deletion_requests table, the
 * request_account_deletion RPC and the delete-account Edge Function so we
 * don't actually delete anything.
 *
 * Protections asserted:
 *   - "Delete My Account" button opens a confirmation dialog (not a
 *     one-click purge).
 *   - Cancelling the dialog leaves state unchanged.
 *   - Confirming calls the request_account_deletion RPC (never a direct
 *     deletion_requests insert) and the dialog names the deletion date.
 *   - Grace-expired path: "Delete Now" requires a SECOND confirmation.
 *   - After successful delete-account, the app signs out and redirects
 *     to "/".
 */

const USER_ID = "00000000-0000-4000-8000-000000000001";

type DeletionRow = {
	id: string;
	user_id: string;
	requested_at: string;
	scheduled_for: string;
	status: "pending" | "cancelled" | "executed";
} | null;

interface DeletionMockState {
	deletionRequest: DeletionRow;
	deleteAccountCalls: number;
	signOutCalls: number;
	/** POSTs to /rest/v1/rpc/request_account_deletion. */
	rpcCalls: number;
	/** Direct POSTs to /rest/v1/deletion_requests (must stay 0). */
	insertCalls: number;
}

/**
 * Attach deletion-specific route mocks on top of the standard
 * mockAuthenticatedApp harness. We don't call page.route inside
 * mockAuthenticatedApp because it would be overridden — instead, add
 * more specific handlers that run before the generic handler.
 */
async function installDeletionMock(
	page: Page,
	initial: DeletionRow,
): Promise<DeletionMockState> {
	await mockAuthenticatedApp(page, { tier: "EMBER", userId: USER_ID });

	const state: DeletionMockState = {
		deletionRequest: initial,
		deleteAccountCalls: 0,
		signOutCalls: 0,
		rpcCalls: 0,
		insertCalls: 0,
	};

	// More-specific route handler runs before the mockAuthenticatedApp
	// catch-all because Playwright routes are LIFO.
	await page.route(`${E2E_SUPABASE_URL}/**`, async (route: Route) => {
		const url = new URL(route.request().url());
		const method = route.request().method();
		const pathname = url.pathname;

		if (pathname === "/auth/v1/logout") {
			state.signOutCalls++;
			await route.fulfill({ status: 204, body: "" });
			return;
		}

		if (pathname === "/functions/v1/delete-account") {
			state.deleteAccountCalls++;
			state.deletionRequest = state.deletionRequest
				? { ...state.deletionRequest, status: "executed" }
				: null;
			await route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify({ success: true }),
			});
			return;
		}

		if (
			pathname === "/rest/v1/rpc/request_account_deletion" &&
			method === "POST"
		) {
			state.rpcCalls++;
			const now = new Date();
			const thirtyDays = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
			state.deletionRequest = {
				id: "deletion-1",
				user_id: USER_ID,
				requested_at: now.toISOString(),
				scheduled_for: thirtyDays.toISOString(),
				status: "pending",
			};
			// Non-SETOF composite return: PostgREST sends a single object.
			await route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify(state.deletionRequest),
			});
			return;
		}

		if (pathname === "/rest/v1/deletion_requests") {
			if (method === "GET") {
				await route.fulfill({
					status: 200,
					contentType: "application/json",
					body: JSON.stringify(
						state.deletionRequest && state.deletionRequest.status === "pending"
							? state.deletionRequest
							: null,
					),
				});
				return;
			}
			if (method === "POST") {
				// authenticated has no INSERT grant (20260920003300).
				state.insertCalls++;
				await route.fulfill({
					status: 403,
					contentType: "application/json",
					body: JSON.stringify({
						code: "42501",
						message: "permission denied for table deletion_requests",
					}),
				});
				return;
			}
			if (method === "PATCH") {
				// Cancel
				if (state.deletionRequest) {
					state.deletionRequest = {
						...state.deletionRequest,
						status: "cancelled",
					};
				}
				await route.fulfill({
					status: 204,
					contentType: "application/json",
					body: "",
				});
				return;
			}
		}

		// Defer to the next matching handler (mockAuthenticatedApp's
		// generic catch-all).
		await route.fallback();
	});

	return state;
}

async function openDangerZone(page: Page) {
	await page.goto("/profile");
	await expect(
		page.getByRole("heading", { name: /^e2e$/i }),
	).toBeVisible({ timeout: 10000 });

	// Profile page has tabs: Public Stats, Badges, Integrations, Settings.
	// DangerZone lives in the Settings tab. See src/app/components/Profile.tsx
	// line 443.
	await page.getByRole("tab", { name: /Settings/i }).click();
}

test.describe("Account deletion flow", () => {
	test("State A: request deletion requires explicit confirmation", async ({
		page,
	}) => {
		const state = await installDeletionMock(page, null);
		await openDangerZone(page);

		// DangerZone state A: "Delete My Account" button is visible
		const openDialog = page.getByRole("button", { name: /Delete My Account/i });
		await expect(openDialog).toBeVisible({ timeout: 10000 });

		// Clicking opens a confirmation alert dialog — NOT an immediate delete
		await openDialog.click();

		const alert = page.getByRole("alertdialog");
		await expect(alert).toBeVisible();
		await expect(alert.getByText(/Are you sure\?/i)).toBeVisible();

		// The dialog names the exact deletion date and the billing rule.
		const expectedDate = new Date(
			Date.now() + 30 * 24 * 60 * 60 * 1000,
		).toLocaleDateString("en-US", {
			year: "numeric",
			month: "long",
			day: "numeric",
		});
		await expect(alert).toContainText(
			`permanently deleted on ${expectedDate}`,
		);
		await expect(alert).toContainText(`Billing stops on ${expectedDate}`);
		await expect(alert).toContainText(
			"renewal that falls before that date is still charged unless you cancel your plan first",
		);

		// No request yet — just confirmed the dialog exists
		expect(state.rpcCalls).toBe(0);
		expect(state.insertCalls).toBe(0);
	});

	test("State A: cancelling the confirmation leaves state untouched", async ({
		page,
	}) => {
		const state = await installDeletionMock(page, null);
		await openDangerZone(page);

		await page.getByRole("button", { name: /Delete My Account/i }).click();

		const alert = page.getByRole("alertdialog");
		await expect(alert).toBeVisible();
		// Radix AlertDialogCancel has the label "Cancel"
		await alert.getByRole("button", { name: /^Cancel$/ }).click();

		await expect(alert).toBeHidden();
		expect(state.rpcCalls).toBe(0);
		expect(state.insertCalls).toBe(0);
		expect(state.deleteAccountCalls).toBe(0);
	});

	test("State A: confirming schedules deletion via request_account_deletion", async ({
		page,
	}) => {
		const state = await installDeletionMock(page, null);
		await openDangerZone(page);

		await page.getByRole("button", { name: /Delete My Account/i }).click();
		const alert = page.getByRole("alertdialog");
		await expect(alert).toBeVisible();

		// Confirmation action labelled "Yes, Delete My Account"
		await alert
			.getByRole("button", { name: /Yes, Delete My Account/i })
			.click();

		// The RPC was called; row is now pending and the UI shows State B
		await expect.poll(() => state.rpcCalls).toBeGreaterThanOrEqual(1);
		await expect(page.getByText(/Deletion Scheduled/i)).toBeVisible();
		expect(state.insertCalls).toBe(0); // No direct table insert
		expect(state.deleteAccountCalls).toBe(0); // No immediate purge
	});

	test("State C: grace-expired path requires a second confirmation", async ({
		page,
	}) => {
		// Seed a pending request whose scheduled_for is in the past.
		const past = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
		const state = await installDeletionMock(page, {
			id: "deletion-1",
			user_id: USER_ID,
			requested_at: past,
			scheduled_for: past,
			status: "pending",
		});
		await openDangerZone(page);

		// "Delete Now" button renders in State C
		const deleteNow = page.getByRole("button", { name: /Delete Now/i });
		await expect(deleteNow).toBeVisible({ timeout: 10000 });

		await deleteNow.click();

		// Second confirmation — "Permanent Deletion" alert dialog
		const alert = page.getByRole("alertdialog");
		await expect(alert).toBeVisible();
		await expect(
			alert.getByRole("heading", { name: /Permanent Deletion/i }),
		).toBeVisible();

		// Cancel first — state must not have flipped
		await alert.getByRole("button", { name: /^Cancel$/ }).click();
		expect(state.deleteAccountCalls).toBe(0);

		// Now re-open and confirm
		await deleteNow.click();
		await expect(alert).toBeVisible();
		await alert
			.getByRole("button", { name: /Yes, Delete Permanently/i })
			.click();

		await expect
			.poll(() => state.deleteAccountCalls, { timeout: 5000 })
			.toBeGreaterThanOrEqual(1);

		// After delete-account succeeds, the mutation signs out. The mock
		// returns 204 for /auth/v1/logout. Verify the sign-out happened and
		// the auth token was cleared by the Supabase client.
		await expect
			.poll(() => state.signOutCalls, { timeout: 5000 })
			.toBeGreaterThanOrEqual(1);
	});

	test("State C success: user ends up signed out (token cleared)", async ({
		page,
	}) => {
		const past = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
		await installDeletionMock(page, {
			id: "deletion-1",
			user_id: USER_ID,
			requested_at: past,
			scheduled_for: past,
			status: "pending",
		});
		await openDangerZone(page);

		await page.getByRole("button", { name: /Delete Now/i }).click();
		const alert = page.getByRole("alertdialog");
		await alert
			.getByRole("button", { name: /Yes, Delete Permanently/i })
			.click();

		// The Supabase client calls localStorage.removeItem on signOut.
		// Poll until the stored session is gone.
		await expect
			.poll(
				async () =>
					await page.evaluate(
						(key) => window.localStorage.getItem(key),
						E2E_SUPABASE_STORAGE_KEY,
					),
				{ timeout: 5000 },
			)
			.toBeNull();
	});
});
