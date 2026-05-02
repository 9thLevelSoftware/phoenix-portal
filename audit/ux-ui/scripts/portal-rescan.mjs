// Re-scan: scroll-through to trigger framer-motion whileInView sections,
// then capture full-page. Also probes the auth dialog more carefully.
import { pathToFileURL } from "node:url";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PLAYWRIGHT_MJS =
  "C:/Users/dasbl/AndroidStudioProjects/Phoenix App Monorepo/phoenix-portal/node_modules/playwright/index.mjs";
const { chromium } = await import(pathToFileURL(PLAYWRIGHT_MJS).href);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "../..");
const SHOT_DIR = path.join(REPO_ROOT, "_audit/screenshots/portal");

async function scrollThrough(page) {
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      let total = 0;
      const distance = 600;
      const timer = setInterval(() => {
        const sh = document.documentElement.scrollHeight;
        window.scrollBy(0, distance);
        total += distance;
        if (total >= sh) {
          clearInterval(timer);
          resolve();
        }
      }, 250);
    });
  });
  await page.waitForTimeout(1500);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(800);
}

const browser = await chromium.launch({ headless: true });

// Desktop revisit with scroll-trigger
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto("http://localhost:5173/", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2200);
  await scrollThrough(page);
  await page.screenshot({
    path: path.join(SHOT_DIR, "landing-desktop-scrolled.png"),
    fullPage: true,
  });

  // Now capture the FAQ section if linked, plus pricing tier card layout
  const pricingShot = path.join(SHOT_DIR, "landing-pricing-section.png");
  await page.evaluate(() => {
    const el = Array.from(document.querySelectorAll("h2,h3"))
      .find((h) => /plans|pricing/i.test(h.textContent || ""));
    if (el) el.scrollIntoView({ block: "start", behavior: "instant" });
  });
  await page.waitForTimeout(900);
  await page.screenshot({ path: pricingShot, fullPage: false });

  // Capture footer
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(SHOT_DIR, "landing-footer.png"), fullPage: false });

  await ctx.close();
}

// Mobile revisit with scroll-trigger
{
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 } });
  const page = await ctx.newPage();
  await page.goto("http://localhost:5173/", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);
  await scrollThrough(page);
  await page.screenshot({
    path: path.join(SHOT_DIR, "landing-mobile-scrolled.png"),
    fullPage: true,
  });
  await ctx.close();
}

// Auth dialog: open it and capture the actual dialog (not just the overlay)
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto("http://localhost:5173/", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2200);
  await page.getByRole("button", { name: /Preview dashboard/i }).first().click();
  await page.waitForTimeout(1500);
  // Try to find role=dialog with content
  const dialogInfo = await page.evaluate(() => {
    const dlgs = Array.from(document.querySelectorAll('[role="dialog"]'));
    const real = dlgs.find((d) => d.querySelector("input, button, h2"));
    if (!real) return { count: dlgs.length, dialogs: dlgs.map(d => d.outerHTML.slice(0, 200)) };
    const inputs = Array.from(real.querySelectorAll("input")).map((i) => ({
      type: i.type,
      autocomplete: i.autocomplete,
      ariaLabel: i.getAttribute("aria-label"),
      placeholder: i.placeholder,
      required: i.required,
    }));
    const buttons = Array.from(real.querySelectorAll("button")).map((b) => ({
      text: b.textContent?.trim().slice(0, 60),
      type: b.type,
      role: b.getAttribute("role"),
    }));
    const headings = Array.from(real.querySelectorAll("h1,h2,h3"))
      .map((h) => ({ tag: h.tagName, text: (h.textContent || "").trim() }));
    const tabs = Array.from(real.querySelectorAll('[role="tab"]'))
      .map((t) => (t.textContent || "").trim());
    return {
      ariaModal: real.getAttribute("aria-modal"),
      ariaLabelledBy: real.getAttribute("aria-labelledby"),
      ariaDescribedBy: real.getAttribute("aria-describedby"),
      headings,
      tabs,
      inputs,
      buttons,
      htmlPreview: real.outerHTML.slice(0, 2000),
    };
  });
  await page.screenshot({
    path: path.join(SHOT_DIR, "auth-dialog-real-desktop.png"),
    fullPage: false,
  });
  // Mobile auth dialog
  await page.setViewportSize({ width: 375, height: 812 });
  await page.waitForTimeout(700);
  await page.screenshot({
    path: path.join(SHOT_DIR, "auth-dialog-real-mobile.png"),
    fullPage: false,
  });
  await fs.writeFile(
    path.join(SHOT_DIR, "_auth-dialog.json"),
    JSON.stringify(dialogInfo, null, 2)
  );
  await ctx.close();
}

// Auth-gated route probe — check whether ProtectedRoute redirects, returns landing,
// or renders an unauth notice. Also capture URL after navigation.
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const auditRoutes = [
    "/dashboard", "/analytics", "/biomechanics", "/routines", "/cycles",
    "/calendar", "/goals", "/leaderboard", "/integrations", "/settings",
    "/history", "/pricing", "/this-does-not-exist",
  ];
  const out = {};
  for (const r of auditRoutes) {
    const resp = await page.goto("http://localhost:5173" + r, {
      waitUntil: "domcontentloaded",
      timeout: 12000,
    });
    await page.waitForTimeout(1800);
    const finalUrl = page.url();
    const h1 = await page.locator("h1").first().textContent().catch(() => null);
    out[r] = {
      requestedRoute: r,
      finalUrl,
      h1: h1?.trim() ?? null,
      status: resp ? resp.status() : null,
      redirected: !finalUrl.endsWith(r) && finalUrl !== "http://localhost:5173" + r,
    };
  }
  await fs.writeFile(
    path.join(SHOT_DIR, "_routes.json"),
    JSON.stringify(out, null, 2)
  );
  await ctx.close();
}

await browser.close();
console.log("rescan complete");
