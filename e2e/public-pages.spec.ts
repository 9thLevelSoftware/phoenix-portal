import { expect, type Page, test } from "@playwright/test";

// Helper: navigate and wait for DOM content (not networkidle, which hangs without Supabase)
async function gotoPublic(page: Page, path: string) {
	await page.goto(path);
	await page.waitForLoadState("domcontentloaded");
}

// Helper: navigate to landing page and wait for framer-motion entrance animations
async function gotoLanding(page: Page) {
	await gotoPublic(page, "/");
	// Framer Motion entrance animations have delays up to 0.8s + transition ~0.8s
	await page.waitForTimeout(2000);
}

test.describe("Public pages - render and content", () => {
	test.describe("Landing page", () => {
		test("hero content renders correctly", async ({ page }) => {
			// Capture page errors
			const errors: string[] = [];
			page.on("pageerror", (err) => errors.push(err.message));

			await gotoLanding(page);

			// Page title matches Phoenix
			await expect(page).toHaveTitle(/Phoenix/i);

			// Hero heading
			await expect(
				page.getByRole("heading", { name: "Your workouts, unlocked." }),
			).toBeVisible();

			// Tagline
			await expect(
				page.getByText("Rise From the Ashes. Forge Your Strength.").first(),
			).toBeVisible();

			// Primary hero CTAs
			await expect(
				page.getByRole("button", { name: "Preview dashboard" }).first(),
			).toBeVisible();
			await expect(
				page.getByRole("link", { name: "Get the mobile app" }).first(),
			).toBeVisible();

			// No console errors during page load
			expect(errors).toHaveLength(0);
		});

		test("pricing section displays all tiers", async ({ page }) => {
			await gotoLanding(page);

			// Scroll to pricing section
			const pricingHeading = page.getByRole("heading", { name: "Plans" });
			await pricingHeading.scrollIntoViewIfNeeded();
			await expect(pricingHeading).toBeVisible();

			// Three tier names from TIER_PRICING (Ember, Flame, Inferno — no Free card)
			await expect(
				page.getByRole("heading", { name: "Ember", exact: true }),
			).toBeVisible();
			await expect(
				page.getByRole("heading", { name: "Flame", exact: true }),
			).toBeVisible();
			await expect(
				page.getByRole("heading", { name: "Inferno", exact: true }),
			).toBeVisible();

			// Price amounts
			await expect(page.getByText("$5").first()).toBeVisible();
			await expect(page.getByText("$15").first()).toBeVisible();
			await expect(page.getByText("$25").first()).toBeVisible();
		});

		test("auth dialog opens when Preview dashboard is clicked", async ({
			page,
		}) => {
			await gotoLanding(page);

			await page
				.getByRole("button", { name: "Preview dashboard" })
				.first()
				.click();

			// Dialog becomes visible (sr-only title: "Sign in to Phoenix Portal")
			const dialog = page.getByRole("dialog");
			await expect(dialog).toBeVisible({ timeout: 5000 });

			// Email and password inputs
			await expect(dialog.locator('input[type="email"]')).toBeVisible();
			await expect(dialog.locator('input[type="password"]')).toBeVisible();

			// Sign In and Sign Up tab triggers
			await expect(dialog.getByRole("tab", { name: /Sign In/i })).toBeVisible();
			await expect(dialog.getByRole("tab", { name: /Sign Up/i })).toBeVisible();
		});
	});

	test.describe("Privacy Policy page", () => {
		test("renders with heading and content", async ({ page }) => {
			const errors: string[] = [];
			page.on("pageerror", (err) => errors.push(err.message));

			await gotoPublic(page, "/privacy");
			// Wait for lazy-load + entrance animation
			await page.waitForTimeout(1500);

			// Heading with "Privacy" text
			await expect(
				page.getByRole("heading", { name: /Privacy/i }).first(),
			).toBeVisible();

			// Substantive content (not blank/error) -- use body text of the whole page
			const bodyText = await page.locator("body").textContent();
			expect(bodyText?.length).toBeGreaterThan(200);

			expect(errors).toHaveLength(0);
		});
	});

	test.describe("Terms of Service page", () => {
		test("renders with heading and content", async ({ page }) => {
			const errors: string[] = [];
			page.on("pageerror", (err) => errors.push(err.message));

			await gotoPublic(page, "/terms");
			await page.waitForTimeout(1500);

			// Heading with "Terms" text
			await expect(
				page.getByRole("heading", { name: /Terms/i }).first(),
			).toBeVisible();

			// Substantive content
			const bodyText = await page.locator("body").textContent();
			expect(bodyText?.length).toBeGreaterThan(200);

			expect(errors).toHaveLength(0);
		});
	});

	test.describe("FAQ page", () => {
		test("renders with heading and accordion items", async ({ page }) => {
			const errors: string[] = [];
			page.on("pageerror", (err) => errors.push(err.message));

			await gotoPublic(page, "/faq");
			await page.waitForTimeout(1500);

			// Heading with "Frequently Asked" text
			await expect(
				page.getByRole("heading", { name: /Frequently Asked/i }).first(),
			).toBeVisible();

			// At least 3 accordion trigger buttons (Radix AccordionTrigger)
			const accordionButtons = page.locator(
				"button[data-radix-collection-item]",
			);
			const count = await accordionButtons.count();
			expect(count).toBeGreaterThanOrEqual(3);

			// Click an accordion item and verify content expands
			const firstTrigger = accordionButtons.first();
			await firstTrigger.click();
			// After clicking, the associated content should be visible
			const expandedContent = page.locator(
				'[data-state="open"] [role="region"]',
			);
			await expect(expandedContent.first()).toBeVisible({ timeout: 3000 });

			expect(errors).toHaveLength(0);
		});
	});
});
