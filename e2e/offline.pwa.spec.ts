import { expect, type Page, test } from "@playwright/test";

// Offline smoke for the app-shell-only precache (brownfield F-087 / PR 62).
// Only the shell is precached; route chunks are cached at runtime once
// visited. Offline, a visited route must still work, and a never-visited
// route must show an offline message rather than "New version available".

async function waitForServiceWorkerControl(page: Page) {
	await page.evaluate(async () => {
		await navigator.serviceWorker.ready;
	});
	// clientsClaim: the active worker takes control of this page without a
	// reload, but the controllerchange can lag slightly behind `ready`.
	await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
}

async function expectOfflineRouteMessage(page: Page) {
	await expect(
		page.getByRole("heading", { name: "You're offline" }),
	).toBeVisible();
	await expect(
		page.getByText(/hasn't been downloaded for offline use yet/i),
	).toBeVisible();
	await expect(page.getByText("New version available")).toHaveCount(0);
}

test("app shell boots offline; visited routes work, unvisited ones say offline", async ({
	page,
	context,
}) => {
	// Online: open one lazy route so its chunk lands in the runtime cache.
	await page.goto("/terms");
	await expect(
		page.getByRole("heading", { name: /Terms/i }).first(),
	).toBeVisible();
	await waitForServiceWorkerControl(page);
	// Reload once under SW control so the route chunk is fetched through the
	// worker (and stored in the runtime cache).
	await page.reload();
	await expect(
		page.getByRole("heading", { name: /Terms/i }).first(),
	).toBeVisible();

	await context.setOffline(true);
	try {
		// Visited route: shell from precache, route chunk from runtime cache.
		await page.reload();
		await expect(
			page.getByRole("heading", { name: /Terms/i }).first(),
		).toBeVisible();

		// Never-visited lazy route: the shell (precached) still renders and
		// explains the page isn't available offline.
		await page.goto("/faq");
		await expectOfflineRouteMessage(page);

		// Cold offline load of a never-visited route (full navigation served by
		// the precached index.html).
		await page.goto("/privacy");
		await expectOfflineRouteMessage(page);
	} finally {
		await context.setOffline(false);
	}
});

test("runtime cache never stores HTML under a script URL", async ({
	page,
	context,
}) => {
	// Mimic Cloudflare's SPA fallback: a missing hashed asset is answered with
	// `200 text/html` (index.html).
	const missing = "/assets/does-not-exist-abc123.js";
	await context.route(`**${missing}`, (route) =>
		route.fulfill({
			status: 200,
			contentType: "text/html",
			body: "<!doctype html><title>Phoenix</title>",
		}),
	);

	await page.goto("/terms");
	await waitForServiceWorkerControl(page);

	await page.evaluate(async (url) => {
		await fetch(url).catch(() => undefined);
	}, missing);

	const cached = await page.evaluate(async (url) => {
		const cache = await caches.open("phoenix-assets");
		const hit = await cache.match(url);
		return hit ? hit.headers.get("content-type") : null;
	}, missing);
	expect(cached).toBeNull();
});
