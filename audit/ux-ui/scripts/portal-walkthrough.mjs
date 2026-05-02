// Portal live walkthrough driver — drives a real Chromium via Playwright
// to capture screenshots, console errors, computed styles, and responsive checks.
//
// Output:
//   _audit/screenshots/portal/*.png
//   _audit/screenshots/portal/_data.json   (machine-readable findings inputs)
//
// Usage:
//   node _audit/scripts/portal-walkthrough.mjs
//
// Requires: Vite dev server already running at http://localhost:5173.
// Read-only: this script does not commit any UI mutations (no signups, no purchases).

import { pathToFileURL } from "node:url";
const PLAYWRIGHT_MJS =
  "C:/Users/dasbl/AndroidStudioProjects/Phoenix App Monorepo/phoenix-portal/node_modules/playwright/index.mjs";
const { chromium } = await import(pathToFileURL(PLAYWRIGHT_MJS).href);
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "../..");
const SCREENSHOT_DIR = path.join(REPO_ROOT, "_audit/screenshots/portal");
const DATA_FILE = path.join(SCREENSHOT_DIR, "_data.json");

const BASE_URL = process.env.AUDIT_BASE_URL ?? "http://localhost:5173";

const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 768, height: 1024 };
const RESPONSIVE_BREAKPOINTS = [1440, 1200, 1024, 900, 768, 600, 375];

const findings = {
  startedAt: new Date().toISOString(),
  baseUrl: BASE_URL,
  surfaces: {},
  consoleByPage: {},
  computedColorSamples: {},
  responsiveProbes: {},
  motionPrefs: {},
  dynamicType: {},
  routes: {},
  notes: [],
};

function logStep(msg) {
  process.stdout.write(`[walkthrough] ${msg}\n`);
}

async function ensureDir(p) {
  await fs.mkdir(p, { recursive: true });
}

async function captureSurface(context, surfaceKey, route, options = {}) {
  const {
    desktop = DESKTOP,
    mobile = MOBILE,
    waitMs = 1500,
    sampleSelectors = [],
  } = options;

  const surface = (findings.surfaces[surfaceKey] = {
    route,
    desktopShot: null,
    mobileShot: null,
    consoleErrors: [],
    pageErrors: [],
    title: null,
    h1Text: null,
    interactiveCount: null,
    httpStatus: null,
  });

  // ---- DESKTOP PASS ----
  const dPage = await context.newPage();
  const dErrors = [];
  const dConsole = [];
  dPage.on("pageerror", (e) => dErrors.push(e.message));
  dPage.on("console", (msg) => {
    const type = msg.type();
    if (type === "error" || type === "warning") {
      dConsole.push({ type, text: msg.text().slice(0, 500) });
    }
  });
  await dPage.setViewportSize(desktop);

  let resp;
  try {
    resp = await dPage.goto(BASE_URL + route, {
      waitUntil: "domcontentloaded",
      timeout: 20000,
    });
    surface.httpStatus = resp ? resp.status() : null;
  } catch (e) {
    surface.pageErrors.push(`goto failed: ${e.message}`);
  }
  await dPage.waitForTimeout(waitMs);

  surface.title = await dPage.title().catch(() => null);
  surface.h1Text = await dPage
    .locator("h1")
    .first()
    .textContent()
    .catch(() => null);
  surface.interactiveCount = await dPage
    .locator("button, a, input, select, textarea, [role='button'], [role='tab']")
    .count()
    .catch(() => null);

  surface.consoleErrors.push(...dConsole);
  surface.pageErrors.push(...dErrors);

  // Computed colors for visible samples
  if (sampleSelectors.length) {
    surface.colorSamples = [];
    for (const sel of sampleSelectors) {
      try {
        const data = await dPage.evaluate((s) => {
          const el = document.querySelector(s);
          if (!el) return null;
          const cs = getComputedStyle(el);
          const text = (el.textContent || "").trim().slice(0, 80);
          return {
            selector: s,
            color: cs.color,
            backgroundColor: cs.backgroundColor,
            fontSize: cs.fontSize,
            fontFamily: cs.fontFamily,
            fontWeight: cs.fontWeight,
            text,
          };
        }, sel);
        if (data) surface.colorSamples.push(data);
      } catch {}
    }
  }

  const dPath = path.join(SCREENSHOT_DIR, `${surfaceKey}-desktop.png`);
  await dPage
    .screenshot({ path: dPath, fullPage: true })
    .catch((e) => surface.pageErrors.push(`screenshot failed: ${e.message}`));
  surface.desktopShot = path.relative(REPO_ROOT, dPath).replace(/\\/g, "/");

  // ---- MOBILE PASS ----
  await dPage.setViewportSize(mobile);
  await dPage.waitForTimeout(800);
  const mPath = path.join(SCREENSHOT_DIR, `${surfaceKey}-mobile.png`);
  await dPage.screenshot({ path: mPath, fullPage: true }).catch(() => {});
  surface.mobileShot = path.relative(REPO_ROOT, mPath).replace(/\\/g, "/");

  await dPage.close();

  return surface;
}

async function captureResponsiveBreakpoints(context) {
  // Use landing page for breakpoint sweep (richest layout)
  const page = await context.newPage();
  await page.goto(BASE_URL + "/", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);

  const probes = {};
  for (const w of RESPONSIVE_BREAKPOINTS) {
    await page.setViewportSize({ width: w, height: 900 });
    await page.waitForTimeout(400);
    const probe = await page.evaluate(() => {
      const html = document.documentElement;
      const horizScroll = html.scrollWidth > html.clientWidth + 1;
      const overflowingRect = (() => {
        const els = Array.from(document.body.querySelectorAll("*"));
        for (const el of els) {
          const r = el.getBoundingClientRect();
          if (r.right > document.documentElement.clientWidth + 4) {
            return {
              tag: el.tagName,
              cls: (el.className || "").toString().slice(0, 80),
              right: Math.round(r.right),
              vw: document.documentElement.clientWidth,
            };
          }
        }
        return null;
      })();
      return {
        clientWidth: html.clientWidth,
        scrollWidth: html.scrollWidth,
        horizScroll,
        firstOverflow: overflowingRect,
      };
    });
    probes[w] = probe;
    const p = path.join(SCREENSHOT_DIR, `landing-w${w}.png`);
    await page.screenshot({ path: p, fullPage: false }).catch(() => {});
    probes[w].screenshot = path.relative(REPO_ROOT, p).replace(/\\/g, "/");
  }
  findings.responsiveProbes = probes;
  await page.close();
}

async function probeMotionPrefs(browser) {
  // Run with prefers-reduced-motion: reduce
  const ctx = await browser.newContext({
    reducedMotion: "reduce",
    viewport: DESKTOP,
  });
  const page = await ctx.newPage();
  await page.goto(BASE_URL + "/", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2200);

  const probe = await page.evaluate(() => {
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    // Find any element currently animating (CSS animationName !== 'none')
    const animating = [];
    const transitioning = [];
    const all = Array.from(document.querySelectorAll("*")).slice(0, 4000);
    for (const el of all) {
      const cs = getComputedStyle(el);
      if (cs.animationName && cs.animationName !== "none") {
        animating.push({
          tag: el.tagName,
          cls: (el.className || "").toString().slice(0, 60),
          name: cs.animationName,
          duration: cs.animationDuration,
        });
      }
      // Non-trivial transitions
      if (cs.transitionDuration && cs.transitionDuration !== "0s") {
        const dur = parseFloat(cs.transitionDuration);
        if (dur > 0.05) {
          transitioning.push({
            tag: el.tagName,
            cls: (el.className || "").toString().slice(0, 60),
            prop: cs.transitionProperty,
            duration: cs.transitionDuration,
          });
        }
      }
      if (animating.length > 25 && transitioning.length > 25) break;
    }
    return {
      reduced,
      animatingCount: animating.length,
      transitioningCount: transitioning.length,
      animatingSamples: animating.slice(0, 12),
      transitioningSamples: transitioning.slice(0, 12),
    };
  });

  findings.motionPrefs = probe;
  const p = path.join(SCREENSHOT_DIR, "landing-prefs-reduced-motion.png");
  await page.screenshot({ path: p, fullPage: false }).catch(() => {});
  findings.motionPrefs.screenshot = path
    .relative(REPO_ROOT, p)
    .replace(/\\/g, "/");

  await ctx.close();
}

async function probeDynamicType(browser) {
  const ctx = await browser.newContext({ viewport: DESKTOP });
  const page = await ctx.newPage();
  await page.goto(BASE_URL + "/", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1800);

  const out = { samples: {} };

  for (const fontSize of ["12px", "20px", "24px"]) {
    await page.evaluate((fs) => {
      document.documentElement.style.fontSize = fs;
    }, fontSize);
    await page.waitForTimeout(500);

    const probe = await page.evaluate(() => {
      const html = document.documentElement;
      return {
        rootFontSize: getComputedStyle(html).fontSize,
        clientWidth: html.clientWidth,
        scrollWidth: html.scrollWidth,
        horizOverflow: html.scrollWidth > html.clientWidth + 1,
        bodyHeight: document.body.scrollHeight,
      };
    });
    const p = path.join(SCREENSHOT_DIR, `landing-fontsize-${fontSize}.png`);
    await page.screenshot({ path: p, fullPage: false }).catch(() => {});
    probe.screenshot = path.relative(REPO_ROOT, p).replace(/\\/g, "/");
    out.samples[fontSize] = probe;
  }
  // Reset
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "";
  });
  findings.dynamicType = out;
  await ctx.close();
}

async function probeKeyboardFocus(context) {
  const page = await context.newPage();
  await page.goto(BASE_URL + "/", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1800);

  const tabs = [];
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press("Tab");
    await page.waitForTimeout(120);
    const info = await page.evaluate(() => {
      const a = document.activeElement;
      if (!a) return null;
      const cs = a ? getComputedStyle(a) : null;
      const r = a.getBoundingClientRect();
      return {
        tag: a.tagName,
        role: a.getAttribute("role"),
        text: (a.textContent || a.getAttribute("aria-label") || "")
          .trim()
          .slice(0, 80),
        href: a.getAttribute("href"),
        outline: cs ? cs.outline : null,
        outlineColor: cs ? cs.outlineColor : null,
        outlineWidth: cs ? cs.outlineWidth : null,
        boxShadow: cs ? cs.boxShadow.slice(0, 200) : null,
        rect: {
          x: Math.round(r.x),
          y: Math.round(r.y),
          w: Math.round(r.width),
          h: Math.round(r.height),
        },
        visible: r.width > 0 && r.height > 0 && r.bottom > 0,
      };
    });
    tabs.push(info);
  }
  findings.keyboardFocus = tabs;

  // Screenshot mid-tab traverse to show focus state
  await page.keyboard.press("Tab");
  const p = path.join(SCREENSHOT_DIR, "landing-focus-state.png");
  await page.screenshot({ path: p, fullPage: false }).catch(() => {});
  findings.keyboardFocusScreenshot = path
    .relative(REPO_ROOT, p)
    .replace(/\\/g, "/");

  await page.close();
}

async function probeColorPairs(context) {
  // Sample foreground/background of Phoenix-critical elements on the landing page
  const page = await context.newPage();
  await page.goto(BASE_URL + "/", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);

  const samples = await page.evaluate(() => {
    function walkText(root, limit = 80) {
      const out = [];
      const tw = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, null);
      let n = tw.currentNode;
      while ((n = tw.nextNode())) {
        if (out.length >= limit) break;
        const txt = (n.textContent || "").trim();
        const own = Array.from(n.childNodes).some(
          (c) => c.nodeType === 3 && c.textContent.trim().length > 1
        );
        if (!own || txt.length < 2 || txt.length > 200) continue;
        const r = n.getBoundingClientRect();
        if (r.width === 0 || r.height === 0 || r.bottom < 0 || r.top > 5000)
          continue;
        const cs = getComputedStyle(n);
        out.push({
          tag: n.tagName,
          role: n.getAttribute("role"),
          text: txt.slice(0, 100),
          color: cs.color,
          background: cs.backgroundColor,
          fontSize: cs.fontSize,
          fontWeight: cs.fontWeight,
        });
      }
      return out;
    }
    return walkText(document.body, 200);
  });

  // Effective bg: walk up DOM and find first non-transparent background
  const enriched = await page.evaluate((items) => {
    function effectiveBg(el) {
      let cur = el;
      while (cur && cur !== document.documentElement) {
        const cs = getComputedStyle(cur);
        const bg = cs.backgroundColor;
        if (
          bg &&
          bg !== "rgba(0, 0, 0, 0)" &&
          bg !== "transparent" &&
          !bg.endsWith(", 0)")
        ) {
          return bg;
        }
        cur = cur.parentElement;
      }
      return getComputedStyle(document.body).backgroundColor;
    }
    function rgbToArr(s) {
      const m = s.match(/rgba?\(([^)]+)\)/);
      if (!m) return null;
      const parts = m[1].split(",").map((x) => parseFloat(x.trim()));
      return parts.length >= 3 ? parts.slice(0, 3) : null;
    }
    function lum(rgb) {
      const [R, G, B] = rgb.map((v) => {
        const c = v / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * R + 0.7152 * G + 0.0722 * B;
    }
    function ratio(fg, bg) {
      const f = rgbToArr(fg);
      const b = rgbToArr(bg);
      if (!f || !b) return null;
      const Lf = lum(f);
      const Lb = lum(b);
      const lighter = Math.max(Lf, Lb);
      const darker = Math.min(Lf, Lb);
      return (lighter + 0.05) / (darker + 0.05);
    }
    // Re-resolve with effective bg
    const all = Array.from(document.body.querySelectorAll("*")).slice(0, 4000);
    const map = new WeakMap();
    return items
      .map((it) => {
        // find an element matching this text (approximate)
        const el = all.find(
          (e) =>
            (e.textContent || "").trim().slice(0, 100) === it.text &&
            e.tagName === it.tag
        );
        if (!el) return { ...it, ratio: null, effectiveBg: null };
        const eb = effectiveBg(el);
        const r = ratio(it.color, eb);
        return {
          ...it,
          effectiveBg: eb,
          ratio: r ? Math.round(r * 100) / 100 : null,
        };
      })
      .filter((x) => x.ratio !== null)
      .slice(0, 60);
  }, samples);

  findings.computedColorSamples = enriched;
  await page.close();
}

async function probe404(context) {
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));

  let resp;
  try {
    resp = await page.goto(BASE_URL + "/this-does-not-exist-xyz123", {
      waitUntil: "domcontentloaded",
      timeout: 12000,
    });
  } catch (e) {
    findings.notes.push("404 nav threw: " + e.message);
  }
  await page.waitForTimeout(2000);

  const info = {
    httpStatus: resp ? resp.status() : null,
    title: await page.title().catch(() => null),
    h1: await page
      .locator("h1")
      .first()
      .textContent()
      .catch(() => null),
    bodyText: await page
      .locator("body")
      .textContent()
      .then((t) => (t || "").slice(0, 600)),
    pageErrors: errors,
  };
  const p = path.join(SCREENSHOT_DIR, "route-404-desktop.png");
  await page.screenshot({ path: p, fullPage: false }).catch(() => {});
  info.screenshot = path.relative(REPO_ROOT, p).replace(/\\/g, "/");
  findings.routes["404"] = info;
  await page.close();
}

async function probeAuthDialog(context) {
  const page = await context.newPage();
  await page.goto(BASE_URL + "/", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2200);

  // Try to click "Preview dashboard" or any "Sign in"
  let opened = false;
  try {
    const btn = page
      .getByRole("button", { name: /Preview dashboard|Sign in|Sign In|Sign up/i })
      .first();
    if (await btn.count()) {
      await btn.click({ timeout: 4000 });
      opened = true;
    }
  } catch {}
  await page.waitForTimeout(1200);

  const dialogInfo = await page.evaluate(() => {
    const dlg = document.querySelector('[role="dialog"], [data-state="open"]');
    if (!dlg) return null;
    const inputs = Array.from(dlg.querySelectorAll("input")).map((i) => ({
      type: i.type,
      name: i.name,
      ariaLabel: i.getAttribute("aria-label"),
      placeholder: i.placeholder,
    }));
    const buttons = Array.from(dlg.querySelectorAll("button")).map((b) =>
      b.textContent?.trim().slice(0, 60)
    );
    return {
      ariaModal: dlg.getAttribute("aria-modal"),
      ariaLabelledBy: dlg.getAttribute("aria-labelledby"),
      ariaDescribedBy: dlg.getAttribute("aria-describedby"),
      inputs,
      buttons,
      htmlSnippet: dlg.outerHTML.slice(0, 1200),
    };
  });

  const p = path.join(SCREENSHOT_DIR, "auth-dialog-desktop.png");
  await page.screenshot({ path: p, fullPage: false }).catch(() => {});

  findings.routes["auth-dialog"] = {
    opened,
    dialog: dialogInfo,
    screenshot: path.relative(REPO_ROOT, p).replace(/\\/g, "/"),
  };
  await page.close();
}

(async () => {
  await ensureDir(SCREENSHOT_DIR);
  logStep(`Launching Chromium → ${BASE_URL}`);
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: DESKTOP,
    deviceScaleFactor: 1,
  });

  try {
    // Surfaces (auth-gated routes are still navigated; we observe what renders)
    const surfaces = [
      ["landing", "/"],
      ["privacy", "/privacy"],
      ["terms", "/terms"],
      ["faq", "/faq"],
      ["dashboard", "/dashboard"],
      ["analytics", "/analytics"],
      ["biomechanics", "/biomechanics"],
      ["routines", "/routines"],
      ["routine-editor", "/routines/new"],
      ["cycles", "/cycles"],
      ["cycle-builder", "/cycles/new"],
      ["calendar", "/calendar"],
      ["goals", "/goals"],
      ["leaderboard", "/leaderboard"],
      ["integrations", "/integrations"],
      ["settings", "/settings"],
      ["history", "/history"],
      ["pricing", "/pricing"],
    ];

    for (const [key, route] of surfaces) {
      logStep(`capturing ${key} (${route})`);
      try {
        await captureSurface(context, key, route, {
          sampleSelectors: ["h1", "h2", "p", "button", "a"],
          waitMs: 1700,
        });
      } catch (e) {
        findings.notes.push(`${key} capture failed: ${e.message}`);
      }
    }

    logStep("auth dialog probe");
    await probeAuthDialog(context);

    logStep("404 route probe");
    await probe404(context);

    logStep("responsive breakpoint sweep");
    await captureResponsiveBreakpoints(context);

    logStep("keyboard focus probe");
    await probeKeyboardFocus(context);

    logStep("color contrast probe");
    await probeColorPairs(context);

    logStep("motion prefs probe");
    await context.close();
    await probeMotionPrefs(browser);

    logStep("dynamic type probe");
    await probeDynamicType(browser);
  } finally {
    findings.finishedAt = new Date().toISOString();
    await fs.writeFile(DATA_FILE, JSON.stringify(findings, null, 2));
    logStep(`wrote ${DATA_FILE}`);
    await browser.close();
  }
})().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
