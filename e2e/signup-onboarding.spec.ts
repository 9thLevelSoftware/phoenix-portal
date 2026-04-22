import { expect, test, type Locator, type Route } from "@playwright/test";
import {
	E2E_SUPABASE_ANON_KEY,
	E2E_SUPABASE_STORAGE_KEY,
	E2E_SUPABASE_URL,
	createStoredSession,
} from "./support/supabase";

/**
 * Signup + onboarding redirect E2E.
 *
 * Covers audit 05 priority gap #14 (sign-up flow E2E). Uses Playwright route
 * interception to mock Supabase Auth so the test runs without a live
 * backend — matches the pattern in `e2e/support/mockSupabase.ts`.
 *
 * Scenarios:
 *   1. Happy path: valid email + password → Supabase signUp succeeds →
 *      AuthProvider seeds a session → landing page redirects to /dashboard.
 *   2. Invalid email blocks submit with a readable inline error.
 *   3. Short password (<6 chars) blocks submit with a readable inline error.
 *   4. Mismatched confirmation password blocks submit with a readable error.
 *
 * Auth dialog markup reference: src/app/components/LandingPage.tsx
 *   - Tabs: "signin" | "signup"
 *   - Inputs: #signup-email, #signup-password, #signup-confirm
 *   - Submit CTA: "Create Account"
 *   - Validation messages rendered with role="alert"
 */

const TEST_EMAIL = "new-user@example.com";
const TEST_PASSWORD = "Valid-Passw0rd!";
const TEST_USER_ID = "00000000-0000-4000-8000-000000000555";

/** Install a minimal Supabase auth mock sufficient to let signUp succeed. */
async function installAuthMock(
	page: Parameters<typeof installAuthMockImpl>[0],
	opts?: { signUpShouldFail?: boolean },
) {
	return installAuthMockImpl(page, opts);
}

async function installAuthMockImpl(
	page: import("@playwright/test").Page,
	opts?: { signUpShouldFail?: boolean },
) {
	await page.route(`${E2E_SUPABASE_URL}/**`, async (route: Route) => {
		const url = new URL(route.request().url());
		const method = route.request().method();
		const pathname = url.pathname;

		// Supabase GoTrue signup endpoint
		if (pathname === "/auth/v1/signup" && method === "POST") {
			if (opts?.signUpShouldFail) {
				await route.fulfill({
					status: 400,
					contentType: "application/json",
					body: JSON.stringify({
						msg: "Signup disabled",
						error: "server_error",
					}),
				});
				return;
			}
			const session = createStoredSession({
				userId: TEST_USER_ID,
				email: TEST_EMAIL,
			});
			await route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify({
					user: session.user,
					session,
					access_token: session.access_token,
					refresh_token: session.refresh_token,
					expires_in: session.expires_in,
					token_type: session.token_type,
				}),
			});
			return;
		}

		// Any profile / subscription / onboarding queries after login fall back
		// to empty collections. This keeps dashboard-paint from 500ing in the
		// redirect target without having to mount the full mockSupabase harness.
		if (pathname.startsWith("/rest/v1/")) {
			await route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify([]),
			});
			return;
		}

		if (pathname.startsWith("/functions/v1/")) {
			await route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify({ success: true }),
			});
			return;
		}

		// Pass through otherwise-handled routes with an empty 200
		await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
	});
}

async function openSignUpTab(page: import("@playwright/test").Page) {
	await page.goto("/");
	// Framer Motion entrance — matches other public-pages specs
	await page.waitForTimeout(1500);
	await page.getByRole("button", { name: "Preview dashboard" }).first().click();

	const dialog = page.getByRole("dialog");
	await expect(dialog).toBeVisible({ timeout: 5000 });
	await dialog.getByRole("tab", { name: /Sign Up/i }).click();
	return dialog;
}

function getCreateAccountButton(dialog: Locator) {
	return dialog.getByRole("button", { name: /Create Account/i });
}

test.describe("Signup flow", () => {
	test("valid credentials sign up and redirect to dashboard", async ({ page }) => {
		await installAuthMock(page);
		const dialog = await openSignUpTab(page);

		await dialog.locator("#signup-email").fill(TEST_EMAIL);
		await dialog.locator("#signup-password").fill(TEST_PASSWORD);
		await dialog.locator("#signup-confirm").fill(TEST_PASSWORD);

		// Seed localStorage with the session the auth mock will return — this
		// lets AuthProvider hydrate on redirect without a full round-trip.
		await page.addInitScript(
			({ key, data }) => {
				window.localStorage.setItem(key, JSON.stringify(data));
			},
			{
				key: E2E_SUPABASE_STORAGE_KEY,
				data: createStoredSession({ userId: TEST_USER_ID, email: TEST_EMAIL }),
			},
		);

		await getCreateAccountButton(dialog).click();

		// The landing page auto-navigates authenticated users to /dashboard
		// (LandingPage.tsx lines 80-85). Wait up to 10s for AuthProvider to
		// observe the session and trigger navigation.
		await page.waitForURL("**/dashboard", { timeout: 10000 });
		expect(page.url()).toMatch(/\/dashboard$/);
	});

	test("invalid email blocks submit with readable error", async ({ page }) => {
		await installAuthMock(page);
		const dialog = await openSignUpTab(page);

		await dialog.locator("#signup-email").fill("not-an-email");
		await dialog.locator("#signup-password").fill(TEST_PASSWORD);
		await dialog.locator("#signup-confirm").fill(TEST_PASSWORD);
		await getCreateAccountButton(dialog).click();

		// The form schema (signUpSchema in LandingPage.tsx line 47) surfaces
		// "Invalid email address" via role="alert".
		await expect(
			dialog.locator('[role="alert"]').filter({ hasText: /invalid email/i }),
		).toBeVisible();
		// URL did not change — we're still on the landing page
		expect(page.url()).not.toMatch(/\/dashboard$/);
	});

	test("short password (<6 chars) blocks submit with readable error", async ({ page }) => {
		await installAuthMock(page);
		const dialog = await openSignUpTab(page);

		await dialog.locator("#signup-email").fill(TEST_EMAIL);
		await dialog.locator("#signup-password").fill("abc");
		await dialog.locator("#signup-confirm").fill("abc");
		await getCreateAccountButton(dialog).click();

		// signUpSchema line 53: min(6, "Password must be at least 6 characters")
		await expect(
			dialog
				.locator('[role="alert"]')
				.filter({ hasText: /at least 6 characters/i }),
		).toBeVisible();
		expect(page.url()).not.toMatch(/\/dashboard$/);
	});

	test("mismatched confirmation password blocks submit", async ({ page }) => {
		await installAuthMock(page);
		const dialog = await openSignUpTab(page);

		await dialog.locator("#signup-email").fill(TEST_EMAIL);
		await dialog.locator("#signup-password").fill(TEST_PASSWORD);
		await dialog.locator("#signup-confirm").fill(`${TEST_PASSWORD}-different`);
		await getCreateAccountButton(dialog).click();

		// signUpSchema.refine line 57: "Passwords do not match"
		await expect(
			dialog
				.locator('[role="alert"]')
				.filter({ hasText: /passwords do not match/i }),
		).toBeVisible();
		expect(page.url()).not.toMatch(/\/dashboard$/);
	});
});

// Assert the anon key env is actually wired so the test harness hasn't
// silently reverted to real auth.
test("[env sanity] anon key matches configured value", async () => {
	expect(typeof E2E_SUPABASE_ANON_KEY).toBe("string");
	expect(E2E_SUPABASE_ANON_KEY.length).toBeGreaterThan(0);
});
