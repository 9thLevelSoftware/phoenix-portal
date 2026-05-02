# Portal Live Walkthrough — Findings

**Date:** 2026-05-01
**Driver:** Headless Chromium 145.0.7632.6 via Playwright 1.58.2 (the `claude-in-chrome` MCP browser extension was not connected — repeated `tabs_context_mcp` calls returned "Browser extension is not connected" so the walkthrough was driven through Playwright instead, hitting the same live Vite dev server at `http://localhost:5173`).
**Auth status:** **Not authenticated.** No test credentials were available and the audit charter forbade self-signup. All authenticated routes (`/dashboard`, `/analytics`, `/biomechanics`, `/routines`, `/cycles`, `/goals`, `/leaderboard`, `/integrations`, `/settings`, `/history`, `/pricing`) silently render the landing page (see F-001) so empirical findings for those surfaces are not available beyond the unauthenticated redirect behavior.
**Surfaces captured (public + observed redirects):**

| Surface | Desktop | Mobile | Reachable as expected? |
|---|---|---|---|
| Landing `/` | `landing-desktop.png` + `landing-desktop-scrolled.png` | `landing-mobile.png` + `landing-mobile-scrolled.png` | YES |
| Privacy `/privacy` | `privacy-desktop.png` | `privacy-mobile.png` | YES |
| Terms `/terms` | `terms-desktop.png` | `terms-mobile.png` | YES |
| FAQ `/faq` | `faq-desktop.png` | `faq-mobile.png` | YES |
| Auth dialog (modal) | `auth-dialog-real-desktop.png` | `auth-dialog-real-mobile.png` | YES (opened via "Preview dashboard") |
| Dashboard `/dashboard` | `dashboard-desktop.png` (rendered as landing) | `dashboard-mobile.png` (rendered as landing) | NO — silent redirect |
| Analytics `/analytics` | `analytics-desktop.png` (rendered as landing) | `analytics-mobile.png` | NO — silent redirect |
| Biomechanics `/biomechanics` | `biomechanics-desktop.png` (landing) | `biomechanics-mobile.png` | NO — silent redirect |
| Routines `/routines` | `routines-desktop.png` (landing) | `routines-mobile.png` | NO — silent redirect |
| Routine editor `/routines/new` | `routine-editor-desktop.png` (landing) | `routine-editor-mobile.png` | NO — silent redirect |
| Cycles `/cycles` | `cycles-desktop.png` (landing) | `cycles-mobile.png` | NO — silent redirect |
| Cycle builder `/cycles/new` | `cycle-builder-desktop.png` (landing) | `cycle-builder-mobile.png` | NO — silent redirect |
| Calendar `/calendar` | `calendar-desktop.png` (landing) | `calendar-mobile.png` | NO — route does not exist (ConsistencyCalendar is embedded in Biomechanics, not a top-level route) |
| Goals `/goals` | `goals-desktop.png` (landing) | `goals-mobile.png` | NO — silent redirect |
| Leaderboard `/leaderboard` | `leaderboard-desktop.png` (landing) | `leaderboard-mobile.png` | NO — silent redirect |
| Integrations `/integrations` | `integrations-desktop.png` (landing) | `integrations-mobile.png` | NO — silent redirect |
| Settings `/settings` | `settings-desktop.png` (landing) | `settings-mobile.png` | NO — silent redirect (the actual route is `/profile`, not `/settings`) |
| History `/history` | `history-desktop.png` (landing) | `history-mobile.png` | NO — silent redirect |
| Pricing `/pricing` | `pricing-desktop.png` (landing) | `pricing-mobile.png` | NO — silent redirect (route is gated behind `ProtectedRoute`) |
| 404 `/this-does-not-exist-xyz123` | `route-404-desktop.png` (landing) | n/a | NO — silent redirect, see F-001 |
| Responsive sweep landing | `landing-w375.png`, `landing-w600.png`, `landing-w768.png`, `landing-w900.png`, `landing-w1024.png`, `landing-w1200.png`, `landing-w1440.png` | n/a | YES |
| Reduced-motion landing | `landing-prefs-reduced-motion.png` | n/a | YES |
| Dynamic-type landing | `landing-fontsize-12px.png`, `-20px.png`, `-24px.png` | n/a | YES |
| Pricing tier section | `landing-pricing-section.png` | (in `landing-mobile-scrolled.png`) | YES |
| Footer (post-scroll) | `landing-footer.png` | (in `landing-mobile-scrolled.png`) | YES |
| Focus state mid-tab | `landing-focus-state.png` | n/a | YES |

Raw probe data: `_audit/screenshots/portal/_data.json`, `_routes.json`, `_auth-dialog.json`. Walkthrough scripts: `_audit/scripts/portal-walkthrough.mjs`, `portal-rescan.mjs`.

---

## A. Surface inventory

13 of 18 charter surfaces could not be reached as authenticated views. The router silently redirects every unauthenticated visit to a protected route (and every truly unmatched path) back to `/` with `<Navigate to="/" replace />` (`phoenix-portal/src/app/routes/index.tsx:218`). The `NotFound` component on line 213 is mounted only inside the authenticated `ProtectedRoute > AppLayout` tree, so unauthenticated users never see it. See F-001 / F-002.

## B. Responsive findings

`navigator.scrollWidth === clientWidth` at every tested breakpoint (375, 600, 768, 900, 1024, 1200, 1440). No horizontal scrollbar. The `_data.json` "firstOverflow" entries (a `<g>` element 9px past the viewport at every width) are SVG hero-decoration glyphs clipped by the parent `viewBox` and do not leak through to `document.scrollWidth`.

What does change at small viewports:

- **At ≤900px** the top-nav links (`Features`, `Pricing`, `Support`) disappear with no replacement (no hamburger menu, no overflow). Only `Phoenix Portal` brand and `Sign In` remain. Verified in `landing-w900.png`, `landing-w768.png`, `landing-w600.png`, `landing-w375.png`. See F-005.
- **The Sentry consent banner** sits fixed at the bottom of the viewport. At desktop it is unobtrusive; at 600px and below it covers ~25% of the visible viewport on first paint, including overlaying the dashboard preview card and the "Reject"/"Accept" pair (where Accept gets the orange accent and Reject gets default link styling — visible asymmetry of dismissal options). See `landing-w375.png`, `landing-w600.png`. See F-007.
- The sticky banner persists over the **footer / legal links** at all viewport sizes (verified in `landing-footer.png`), making it harder for users to discover or click the Privacy / Terms links until the banner is dismissed — and the only way to dismiss it is to make a consent decision.
- Hero `h1` ("Your workouts, unlocked.") is **96px** at desktop and **48px** at 375px (still big), all within layout — no clipping.
- Pricing section: at desktop the three tier cards render side-by-side with the middle (Flame) elevated; at 375px they stack vertically. Layout is fine.

## C. Motion / reduced-motion

When Playwright launched the context with `reducedMotion: "reduce"` (which sets `prefers-reduced-motion: reduce`), the in-page probe walked the first ~4000 elements and found:

- `animationName !== "none"` count: **0**
- `transitionDuration > 50ms` count: **0**

The page rendered fully visible (no opacity:0 reveals stuck), so Framer Motion respects `prefers-reduced-motion` and removes both entrance animations and longer transitions. **Pass.** Evidence: `landing-prefs-reduced-motion.png` (the hero, dashboard preview card, and Sentry banner all visible without scroll) and `_data.json -> motionPrefs`.

**Adjacent finding:** when reduced-motion is *not* requested, sections below the hero are initially hidden (Framer Motion `whileInView` with `initial={{ opacity: 0 }}`). A full-page screenshot taken without scrolling captures **only** the above-the-fold hero; the entire mid-section ("See every rep as data", feature cards, force-curve preview, Plans pricing) is opacity:0 until scrolled into view. Compare `landing-desktop.png` (no scroll, mid-section is empty black) vs `landing-desktop-scrolled.png` (full content). This affects search-engine snapshots, link-preview crawlers (Twitter Card / Open Graph image generators), and screen readers that ignore CSS but read the DOM (no problem there). Documented as F-013.

## D. Dynamic type / zoom

Tested by setting `document.documentElement.style.fontSize` to 12px, 20px, 24px and re-measuring.

| Root font | Body height | Horizontal overflow | Notes |
|---|---|---|---|
| 12px | 3857px | none | Hero shrinks but stays readable; dashboard preview card crisp |
| 16px (default) | ~4300px | none | (baseline, observed in regular pass) |
| 20px | 5932px | none | All sections reflow; layout still parallel |
| 24px | 7189px | none | 86% taller than 12px; consent banner Reject/Accept buttons crowd at bottom (`landing-fontsize-24px.png`) |

**Pass for layout (no overflow at any tested size).** Issue: at 24px the bottom Sentry banner covers ~18% of viewport with the "Reject"/"Accept" pair very close to each other. See F-007.

## E. Console errors / warnings

Zero `console.error` and zero `pageerror` were captured during desktop or mobile rendering of every surface (`landing`, `privacy`, `terms`, `faq`, all 13 redirected routes, `404`, dialog opening). Pass.

## F. Keyboard / focus

Twelve sequential `Tab` presses on the landing page traversed: `Features`, `Pricing`, `Support`, `Sign In`, then jumped down-page to `Preview dashboard`, `Get the mobile app`, two `Subscribe` buttons (Ember tier, Flame tier), `Get the mobile app` (footer CTA section), `Preview dashboard` (footer CTA section), `Support on Ko-fi`, then footer `Features`.

- All 12 elements reported a visible bounding rect (good — no off-screen focus).
- **Two distinct focus styles are in use** depending on the button variant:
  - Top-nav buttons + footer links use `outline: 1px auto oklab(... / 0.5)` — a 1px hairline at 50% alpha. Hard to perceive, especially the footer "Features" at 22px tall.
  - Hero CTAs (`Preview dashboard`, `Get the mobile app`, `Subscribe`) use a 3px box-shadow ring `oklab(... / 0.5) 0 0 0 3px`. Visible, good.
  See F-006 (focus-style inconsistency).
- **Focus-trap not verified** for the auth dialog (script captured the dialog content but did not `Escape`-test trap exit). Manual verification needed.

## G. Live-rendered contrast samples

60 visible foreground/background text pairs sampled with the effective-background walk (DOM-up search for first non-transparent ancestor bg). Computed using WCAG 2.1 luminance formula.

**No AA failures (all ≥ 4.5:1; all large text ≥ 3:1).** Lowest 10 ratios:

| Ratio | Element | Foreground | Effective bg | Size / weight | Notes |
|---|---|---|---|---|---|
| 6.79 | `SPAN "LIVE DEMO"` | `#FF6B35` | `#0E0E14` | 11px / 450 | Smallest type sampled |
| 7.13 | `SPAN "Phoenix Portal"` | `#FF6B35` | `#06060A` | 18px / 600 | Brand mark |
| 7.13 | `SPAN "Your workouts, unlocked."` | `#FF6B35` | `#06060A` | 96px / 700 | Hero h1 highlight word |
| 7.13 | `BUTTON "Preview dashboard"` | `#06060A` | `#FF6B35` | 14px / 500 | Primary CTA |
| 7.13 | `P "WHAT YOU GET"` | `#FF6B35` | `#06060A` | 11px / 450 | Eyebrow |
| 7.13 | `P "TRY IT"` | `#FF6B35` | `#06060A` | 11px / 450 | Eyebrow |
| 7.44 | `SPAN "Force Output"` | `#A0A0AC` | `#0E0E14` | 11px / 450 | Card label |
| 7.44 | `SPAN "peak"` | `#A0A0AC` | `#0E0E14` | 11px / 450 | Unit label |
| 7.44 | `SPAN "Recovery"` | `#A0A0AC` | `#0E0E14` | 11px / 450 | Card label |
| 7.44 | `SPAN "PR Trend"` | `#A0A0AC` | `#0E0E14` | 11px / 450 | Card label |

The Phoenix Orange (`rgb(255, 107, 53)` = `#FF6B35`) on `#06060A` measures **7.13:1** — passes AAA for normal text. Body grey `#A0A0AC` on the surface-2 black hits 7.44:1.

The notable **font size** problem is independent of contrast: **eyebrows render at 11.008px** (Tailwind `text-[11px]` or similar override). Below the de-facto 12px floor commonly used as a min for body labels. See F-008.

## H. Findings (per charter F-### schema)

### F-001 [CRITICAL] Unauthenticated 404 silently redirects to landing with no message

**Surface:** Portal
**Category:** 2 (IA & navigation), 3 (state coverage)
**Location:** `phoenix-portal/src/app/routes/index.tsx:217-218` (`<Route path="*" element={<Navigate to="/" replace />} />` outside `ProtectedRoute`)
**Observation:** Visiting any unmatched path while signed out — including typos (`/dashbord`), deleted bookmarks, and the literal `/this-does-not-exist-xyz123` test — returns HTTP 200 and renders the landing page (`Your workouts, unlocked.`). The URL bar quietly rewrites to `http://localhost:5173/`. No toast, no flash message, no `Page not found` text. Verified for 13 routes in `_audit/screenshots/portal/_routes.json` (every `redirected: true` with `h1: "Your workouts, unlocked."`). The actual `NotFound` component (`phoenix-portal/src/app/components/NotFound.tsx` referenced on `index.tsx:213`) is mounted inside the authenticated `ProtectedRoute > AppLayout` and never reached for signed-out visitors.
**Why it hurts:** A user who follows a stale share-link, mistypes a path, or whose JWT just expired cannot tell *why* they ended up on the homepage. The cognitive flow "I clicked X, got home page, where is X?" induces blame on themselves or the link sender. Worse, support tickets for "I can't find /workouts" are unactionable because the error message that should distinguish "not found" from "not signed in" was suppressed.
**Severity rationale:** Critical because (a) the URL is silently rewritten — broken bookmarking and deep-linking is a primary IA contract, (b) it conflates two distinct error states (404 vs. unauthenticated), (c) it disables search-engine 404 reporting and analytics on broken inbound links, and (d) the explicit `NotFound` component already exists but is unreachable for the audience that needs it most.
**Proposed fix (design spike, ~1 day):** Replace the unauthenticated catch-all with a public `NotFound` route that distinguishes the two cases:
1. If the requested path matches a known protected route → render "Sign in to access this page" with a Sign-In CTA that preserves the destination (so post-login the user lands where they wanted).
2. Otherwise → render the existing `NotFound` with a "Go to home" link, leaving the URL untouched (HTTP 200 is fine for SPA but the route should not redirect away).
**Parity flag:** YES — Mobile's `AuthScreen` does have an explicit "Sign in to continue" message; portal has no equivalent on web deep-links.

### F-002 [HIGH] Protected routes silently fall through to landing when signed out

**Surface:** Portal
**Category:** 2 (IA & navigation), 3 (state coverage), 9 (onboarding & first-run)
**Location:** Same file as F-001, `phoenix-portal/src/app/routes/index.tsx:218`. The same `<Navigate to="/" replace />` swallows protected-route paths the same as truly unmatched paths.
**Observation:** Hitting `/dashboard`, `/analytics`, `/routines/new`, etc. while signed out renders landing (h1 "Your workouts, unlocked."). The `ProtectedRoute` catch-all (`/*` → `NotFound`) is *inside* the protected tree, so an unauthenticated request never gets there — it falls through to the public catch-all and redirects to `/`. The user sees a marketing page, not a sign-in prompt or a "you need a paid plan to view this" message.
**Why it hurts:** Users sharing routine links, cycle plans, or analytics dashboards with each other cannot deep-link. The *recipient* must (1) realize they need to sign up, (2) sign up, (3) re-paste the original URL because the destination wasn't preserved across the redirect.
**Severity rationale:** High (not Critical) because the marketing page is at least branded and pleasant; the broken link is recoverable via Sign In. But each recovery costs the user 3+ steps of friction and the destination URL is lost during redirect.
**Proposed fix (quick-win, ~2hr):** When `ProtectedRoute` detects an unauthenticated user, instead of returning `null` (which lets the path fall through to the public `<Navigate to="/" replace />`), render an `<AuthRequired requestedPath={location.pathname} />` component that opens the sign-in dialog with `?redirectTo=...` preserved. Existing dialog supports modal sign-in; just need to wire `redirectTo` into the post-auth navigation in `ProtectedRoute.tsx`.
**Parity flag:** NO (mobile UI does not deep-link via URL; this is portal-specific).

### F-003 [HIGH] Mobile top-nav has no menu — Features/Pricing/Support disappear at ≤900px

**Surface:** Portal
**Category:** 2 (IA & navigation), 7 (a11y — touch & nav)
**Location:** `phoenix-portal/src/app/components/LandingPage.tsx` (top nav). Verified in `landing-w900.png`, `landing-w768.png`, `landing-w600.png`, `landing-w375.png` — each shows only `Phoenix Portal` brand at left and `Sign In` at right, no nav items, no hamburger.
**Observation:** At desktop the nav exposes `Features` (anchor link), `Pricing` (anchor link), `Support` (external Ko-fi link). At ≤900px these three items vanish from the DOM with no fallback (no `<details>` menu, no hamburger icon, no overflow drawer). The links still exist further down the page (`Features` and `Pricing` are anchor links to in-page sections, `Support` is in the footer), but new mobile visitors have no signal that these sections exist before they scroll the entire page.
**Why it hurts:** Mobile-first first-time visitors get a hero + dashboard preview but no clear "tour" navigation. The site collapses to "scroll or sign in" — many will bounce before reaching the Pricing section.
**Severity rationale:** High because mobile is likely the dominant first-touch device for landing-page traffic, and `Pricing` discoverability directly affects conversion. Not Critical because the content is still reachable by scrolling.
**Proposed fix (quick-win, ~3hr):** Add a `<button aria-label="Open menu">` with a hamburger icon at `<md` that toggles a sheet containing `Features`, `Pricing`, `Support`, and the Sign-In CTA. Use existing shadcn/ui Sheet primitive. Ensure focus trap and Esc to close.
**Parity flag:** NO (mobile app uses bottom-tab nav, no parallel concern).

### F-004 [HIGH] Auth dialog inputs missing `autocomplete`, `required`, and `aria-label`

**Surface:** Portal
**Category:** 5 (form & input UX), 7 (a11y)
**Location:** `phoenix-portal/src/app/components/AuthDialog.tsx` (or wherever the email/password fields are rendered). Probe data in `_audit/screenshots/portal/_auth-dialog.json`. The two inputs returned `autocomplete: ""`, `required: false`, `ariaLabel: null`. Visible labels (`Email`, `Password`) exist as siblings but the input element itself is unlabelled to assistive tech beyond placeholder text, and password manager autofill cannot reliably target either field.
**Observation:** Email input: `<input type="email" placeholder="you@example.com">` — no `autocomplete="email"`, no `aria-label`, no `aria-labelledby` referencing the visible "Email" `<label>`. Password input: `<input type="password" placeholder="Enter your password">` — no `autocomplete="current-password"` (Sign In tab) or `autocomplete="new-password"` (Sign Up tab), no `required`. Submit form has no client-side validation.
**Why it hurts:** (1) Password managers (1Password, Bitwarden, Apple Keychain) won't reliably autofill without `autocomplete` hints, frustrating users on first sign-in. (2) Screen-reader users hear only the placeholder ("you@example.com") which is read as if it's the value, not the field name. (3) Browser-native validation ("Please fill out this field") doesn't trigger because `required` is absent — failures only surface after submit roundtrip.
**Severity rationale:** High because the auth dialog is the gate to the entire authenticated product. Friction here costs sign-ups, and the a11y gap excludes screen-reader users from a primary task.
**Proposed fix (quick-win, ~1hr):** Add `autocomplete="email"` + `autocomplete="current-password"` (and a switch to `new-password` when the Sign Up tab is active). Add `required` on both. Wire `aria-labelledby` to the existing visible `<label for="email">` / `<label for="password">` if present, otherwise add `aria-label="Email address"` / `aria-label="Password"`. Add `aria-modal="true"` on the dialog (the Radix wrapper does not appear to set this — the probe found `ariaModal: null`).
**Parity flag:** NO.

### F-005 [HIGH] Two inconsistent focus indicators on the landing page

**Surface:** Portal
**Category:** 1 (visual & brand consistency), 7 (a11y)
**Location:** Inferred from `_data.json -> keyboardFocus` traversal. Affected pairs:
- Outline-style: top-nav `Features`/`Pricing`/`Support` buttons + footer link `Features` — `outline: 1px auto oklab(... / 0.5)` (1px hairline at 50% opacity)
- Ring-style: hero CTAs `Preview dashboard`, `Get the mobile app`, `Subscribe`, `Sign In` — `box-shadow: 0 0 0 3px oklab(... / 0.5)` (3px box-shadow ring)
**Observation:** Two visually different focus indicators co-exist on the same page. The 3px ring on hero CTAs is clearly visible (passes WCAG 2.4.7 / 2.4.13). The 1px hairline at 50% alpha on top-nav and footer links is much harder to perceive — at 26px tall and against the dark `#06060A` background, the orange-tinted hairline is barely visible in `landing-focus-state.png`.
**Why it hurts:** Keyboard-only users navigating the top-nav cannot easily see where focus is, especially after a single Tab from the address bar. The inconsistency also breaks the mental model — buttons that "look the same" (text-only chrome) don't behave the same.
**Severity rationale:** High because focus visibility is an explicit WCAG 2.4.7 (Level AA) requirement. The 1px-50%-alpha outline is borderline at best; the WCAG 2.2 / 2.4.13 spec for focus appearance requires at least a 2px outline with adequate contrast against adjacent colors.
**Proposed fix (quick-win, ~1hr):** Standardize on the 3px ring across all interactive elements. Add `focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2` to the global text-button utility class (or wherever the Header/Footer link components are styled). Verify with a single Tab traversal afterwards.
**Parity flag:** NO (mobile uses Material 3 ripple, no parallel concern).

### F-006 [HIGH] Top-nav and small footer links are below WCAG 2.2 minimum target size (24×24)

**Surface:** Portal
**Category:** 7 (a11y — touch targets)
**Location:** `_data.json -> keyboardFocus`. Specifically:
- Top-nav `Features` button: 66 × **26px** (height < 44pt; > 24px height passes 2.5.8 minimum if spaced)
- Top-nav `Pricing` button: 53 × **26px**
- Top-nav `Support` link: 61 × **26px**
- Top-nav `Sign In` button: 72 × **32px**
- Footer `Support on Ko-fi` link: 110 × **20px** (FAILS 2.5.8 — below 24×24)
- Footer `Features` link: 66 × **22px** (FAILS 2.5.8 — below 24×24)
**Observation:** Two explicit failures (footer `Support on Ko-fi` at 20px tall, footer `Features` at 22px tall) sit below WCAG 2.2 SC 2.5.8 Target Size (Minimum) Level AA threshold of 24 × 24 CSS pixels. The 26px-tall top-nav buttons pass the strict minimum but fail the older 44-pt iOS/Android/AAA target-size guideline.
**Why it hurts:** Mobile users — especially those with motor difficulties, older users, or anyone tapping with a thumb — will mis-tap or miss-tap these. The footer link cluster is particularly tight.
**Severity rationale:** High because there is a hard WCAG 2.2 AA conformance failure on at least two interactive elements. Top-nav links are borderline (pass min, fail recommended).
**Proposed fix (quick-win, ~1hr):** Increase the vertical padding on `<nav a>` and footer link elements from `py-1` (likely) to `py-2.5`, bringing all interactive elements to ≥ 32 px tall. This will not visually disrupt density on desktop because the link text font-size is the dominant visual weight. For touch targets specifically, also consider `min-height: 44px` on `<header nav button>` at `<md` breakpoint via Tailwind responsive utility.
**Parity flag:** YES — verify mobile (Compose) buttons use Material 3 default minimum-touch-target (48dp) which is already enforced by ButtonDefaults. Mobile likely passes; portal needs to catch up.

### F-007 [MEDIUM] Sentry consent banner is too tall on mobile and the dismissal options are visually unequal

**Surface:** Portal
**Category:** 1 (visual), 7 (a11y), 10 (subscription/onboarding)
**Location:** Likely `phoenix-portal/src/app/components/SentryConsentBanner.tsx` (or similar). Visible in `landing-w375.png`, `landing-w600.png`, `landing-fontsize-24px.png`, `landing-footer.png`.
**Observation:** A sticky/fixed bottom banner reading "We use Sentry for error tracking to improve app reliability. No personal workout data is collected. See our Privacy Policy for details." with a "Reject" button (text-only, default link styling) and an "Accept" button (orange, primary CTA styling). At 375px the banner spans full width and stands ~110-130px tall (covering the dashboard preview card). At 24px root-font (dynamic-type test) it grows to ~160px, displacing the bottom of every page including the footer.
**Why it hurts:** (1) The asymmetry between Reject (subdued) and Accept (highlighted, primary color) violates GDPR/EU/UK consent guidance that "Reject" must be as easy as "Accept" — this is a regulatory risk for EU traffic. (2) On mobile the banner blocks a meaningful portion of the hero on first paint. (3) The banner persists across every navigation until consent is given, and even sits over the Privacy Policy link in the footer, which is the very link a privacy-conscious user wants to read before deciding.
**Severity rationale:** Medium for UX (high friction but not blocking), but the unequal-prominence-of-consent-options issue is a regulatory exposure that the user team should review with counsel.
**Proposed fix (quick-win, ~2hr):**
1. Make `Reject` and `Accept` visually parallel — same width, same height, same priority style (e.g., both ghost outline buttons, or both filled subdued buttons). Differentiate only by text and an aria-label.
2. Reduce banner padding/font-size on mobile (`<sm`) so it occupies ≤ 80px tall.
3. Add a "Privacy Policy" link to the banner itself that opens in the same tab (don't make users dismiss to read the policy that informs the dismissal).
**Parity flag:** NO (mobile app does not have an equivalent consent banner — Sentry consent is presumably granted via app install permission).

### F-008 [MEDIUM] Eyebrow / label text renders at 11px (below ≥12px conventional minimum)

**Surface:** Portal
**Category:** 1 (visual), 7 (a11y)
**Location:** Multiple sites on the landing page; computed `font-size: 11.008px` (Tailwind `text-[11px]` likely). Affected text per `_data.json -> computedColorSamples`: `Force Output`, `peak`, `Recovery`, `PR Trend`, `Volume`, `This wk`, `Last wk`, `WHAT YOU GET`, `TRY IT`, `LIVE DEMO`.
**Observation:** Multiple eyebrow/label/unit-string elements compute to 11px regular weight (`font-weight: 450`). Contrast is fine (>7:1) but the size itself is below the de-facto 12px minimum used by most a11y guidelines for non-decorative text.
**Why it hurts:** Users with mild vision impairment, anyone over ~45 reading at arm's length, or anyone in suboptimal lighting will struggle with these labels — and they carry real semantic weight (data labels for the dashboard preview).
**Severity rationale:** Medium because contrast offsets some of the size penalty, and these are short labels rather than running prose. But a global 12px floor is cheap to enforce.
**Proposed fix (quick-win, ~30min):** Replace `text-[11px]` occurrences with `text-xs` (12px) globally on the landing page. Re-check that line-heights still feel balanced on the dashboard preview card (might need to tighten `leading-` if needed).
**Parity flag:** YES — verify mobile labels conform to Material 3's 12sp minimum for `bodySmall` / `labelSmall`.

### F-009 [MEDIUM] Brand-mark text is inconsistent across public pages

**Surface:** Portal
**Category:** 1 (visual & brand consistency)
**Location:** Compare `landing-desktop.png` (`Phoenix Portal`), `privacy-desktop.png` (`Phoenix Portal`), `terms-desktop.png` (`Project Phoenix`), `faq-desktop.png` (`Project Phoenix`).
**Observation:** Landing and Privacy pages display the brand mark as `Phoenix Portal` (orange, top-left). Terms and FAQ pages display it as `Project Phoenix` instead. The mobile app is named "Project Phoenix" but the web companion product is "Phoenix Portal" per the page title `<title>Phoenix Project Fitness Portal</title>`. The Privacy page body refers to "Project Phoenix - Vitruvian Trainer Companion App" which conflates both brands.
**Why it hurts:** Brand confusion at exactly the touchpoints (Terms, Privacy, FAQ) where users want to confirm what entity they are agreeing with / asking for help from. A user reading the Terms cannot tell whether the agreement is with the Phoenix Portal or Project Phoenix entity.
**Severity rationale:** Medium because there is no functional break, but legal documents in particular require unambiguous party identification.
**Proposed fix (quick-win, ~1hr):**
1. Standardize the page-header brand mark across `LandingPage`, `PrivacyPolicy`, `TermsOfService`, `FAQ` to a single `<PageHeader brand="Phoenix Portal" />` component.
2. Body copy should consistently say `Phoenix Portal` for the web product and `Project Phoenix mobile app` for the mobile product. Avoid `Project Phoenix` as the product noun on portal pages.
**Parity flag:** YES — mobile app's brand display string is "Project Phoenix"; portal needs to differentiate cleanly.

### F-010 [MEDIUM] Inferno tier card is shown but dimmed with no clear messaging about availability

**Surface:** Portal
**Category:** 10 (subscription/paywall UX), 1 (visual)
**Location:** Pricing tier cards, visible in `landing-pricing-section.png`. Specifically:
- Ember card: full-color, $5, orange "Subscribe" button
- Flame card: full-color, AI-POWERED pill, $15, orange "Subscribe" button
- Inferno card: dimmed, "Coming Soon" pill, $25, **grey/disabled** button (no text visible at this resolution)
**Observation:** The Inferno tier is rendered alongside purchasable tiers but the only signal that it isn't available is a small pill labeled "Coming Soon" and a grey button. The price `$25 / per month` is fully visible, the feature list ("Everything in Flame", "Advanced analytics & biomechanics", "Force curves & VBT zones", "Session replay with 50Hz telemetry") is fully visible. New visitors might think this is buyable today.
**Why it hurts:** (1) Users expecting to buy Inferno will be confused when the click does nothing or doesn't navigate to checkout. (2) Listing a future tier with full pricing without an "Notify me" mechanism wastes the user's interest signal. (3) The grey button has unclear interactivity affordance — is it disabled, broken, or in another state?
**Severity rationale:** Medium because this is a sales/conversion concern that doesn't break anything. But "Inferno" being THE highest tier (and presumably aspirational) means losing this conversion is meaningful for ARPU.
**Proposed fix (quick-win, ~2hr):**
1. Replace the disabled `Subscribe` button with a clear `Notify me when ready` (or `Join the waitlist`) CTA that opens a small dialog asking for an email.
2. Increase the prominence of the `Coming Soon` pill — same horizontal position as Flame's `AI-POWERED` pill, larger text, more contrast.
3. Add muted styling to the price ("$25 / per month — coming soon") so it doesn't read as currently-available.
**Parity flag:** NO (mobile does not list portal tiers; pricing is portal-side).

### F-011 [MEDIUM] Auth dialog tab indicator is subtle — active tab can be hard to identify

**Surface:** Portal
**Category:** 5 (form & input UX), 1 (visual)
**Location:** `auth-dialog-real-desktop.png`, `auth-dialog-real-mobile.png`. The dialog has two `role="tab"` triggers: `Sign In` and `Sign Up`. The active tab is `Sign In` by default, indicated by a subtle orange-fill background; the inactive `Sign Up` tab has a transparent/grey background.
**Observation:** At a glance both tabs read as available; the active tab does not have strong tonal contrast against the inactive tab. The aria-selected state is correct (`aria-selected="true"` per `_auth-dialog.json`), so screen readers do get the right signal — but sighted users may briefly hesitate on which tab is active.
**Why it hurts:** New users opening the dialog (especially the "Sign Up" path) cannot tell at a glance whether they are about to sign up or sign in. An accidental "Sign In" with no account leads to "Invalid credentials" instead of helpful onboarding.
**Severity rationale:** Medium because once the user types and clicks Submit, the destination becomes obvious. But the first-glance ambiguity is unnecessary.
**Proposed fix (quick-win, ~30min):** Increase the active-tab fill to a stronger orange (current `bg-primary/15` or similar — bump to `bg-primary` with `text-background`); or add a 2px underline to the active tab; or both.
**Parity flag:** NO.

### F-012 [MEDIUM] FAQ page accordion uses non-semantic accordion-trigger styling

**Surface:** Portal
**Category:** 1 (visual), 5 (forms & inputs)
**Location:** `faq-desktop.png`. Each FAQ item has a left-aligned title (e.g. "What is Phoenix Portal?") and a right-aligned `▾` chevron. The trigger row appears to lack hover/focus indication in the static screenshot, and the click affordance is not visually obvious — there's no pill, no underline, no card border on the trigger row.
**Observation:** The accordion items are functionally implemented (Radix `AccordionTrigger` per existing E2E test in `e2e/public-pages.spec.ts:163`), but the visual treatment offers no hover state and minimal focus state in the captured render. The chevron is small relative to the trigger area.
**Why it hurts:** Users — particularly those scanning quickly — may not realize the FAQ items are expandable until they click one. This delays first answer-discovery on a critical onboarding/support page.
**Severity rationale:** Medium because once the user clicks once, the pattern is learned. But discoverability is reduced.
**Proposed fix (quick-win, ~1hr):** Add a subtle hover background (`hover:bg-surface-2/40`) and a clearer focus ring on `AccordionTrigger`. Consider adding a thin border or background tint to differentiate the trigger row from the surrounding background.
**Parity flag:** NO.

### F-013 [MEDIUM] Framer Motion `whileInView` keeps below-the-fold sections at opacity:0 until scroll

**Surface:** Portal
**Category:** 7 (a11y — motion & first-paint), 1 (visual)
**Location:** Landing page mid-section. Verified by comparing `landing-desktop.png` (no scroll, all sections after hero are blank black) vs `landing-desktop-scrolled.png` (full content rendered). The pattern is `motion.div initial={{ opacity: 0, y: ... }} whileInView={{ opacity: 1, y: 0 }}`.
**Observation:** Without scroll, the entire mid-section of the landing page (the `See every rep as data.` headline, the four feature cards, the force-curve preview, the entire `Plans` pricing block, the `Start syncing workouts.` CTA, the footer) remains at `opacity: 0`. They render in the DOM (good for screen readers) but are invisible in any tool that doesn't simulate scrolling: Lighthouse audits without scroll, Twitter Card / Open Graph image generators that screenshot the above-the-fold area, OG-image servers, and printable PDFs of the page.
**Why it hurts:** (1) Lighthouse Performance score may be artificially inflated (LCP is the hero, which is fine) but an Accessibility scan looking for "color contrast" on these hidden-but-DOM elements will skip them. (2) Social-link previews (`og:image`) generated by snapshot tooling will show only a hero with a sea of blackness below. (3) Print/PDF output skips most of the marketing content.
**Severity rationale:** Medium because the content does eventually render and screen readers do see it. But the social-share preview gap is a real marketing concern, and the pattern is fragile (any future automated visual regression test against full-page screenshots will be flaky).
**Proposed fix (design spike, ~half-day):** Either (a) reduce initial `opacity: 0` to `opacity: 0.001` so the content is visible to screenshot tools but the entrance animation is preserved, or (b) detect non-interactive contexts (e.g. `prefers-reduced-motion`, headless UA, or no-JS) and start sections at `opacity: 1`. Option (b) already partially works under `prefers-reduced-motion` (verified — see Section C); extend the detection to UA-based check or a feature flag.
**Parity flag:** NO.

### F-014 [POLISH] "Forgot password?" link sits orphaned to the right of the password field

**Surface:** Portal
**Category:** 5 (form & input UX)
**Location:** Auth dialog, visible in `auth-dialog-real-desktop.png` and `auth-dialog-real-mobile.png`. The Forgot password? link is right-aligned beneath the password input, at small font size, in the Phoenix orange.
**Observation:** Convention: the "Forgot password?" link typically sits beneath the password field, often in a row with the submit button or above it. Here it's right-aligned in a small-text orange that looks like a hyperlink but separated from the Submit by a row.
**Why it hurts:** A user fumbling their password may not see the recovery link before they hit Submit and get an "Invalid credentials" error. The orange hyperlink color ties to the brand and is fine for contrast but visually competes with the Submit button just below.
**Severity rationale:** Polish because the function works; aesthetics and conventional placement are the only concerns.
**Proposed fix (quick-win, ~30min):** Move "Forgot password?" to the same row as the password label (label on left, "Forgot password?" link on right), as is conventional in modern auth dialogs.
**Parity flag:** NO.

### F-015 [POLISH] AI-POWERED pill on Flame card is small and barely readable

**Surface:** Portal
**Category:** 1 (visual & brand)
**Location:** `landing-pricing-section.png` — the Flame tier card. The pill reads `AI-POWERED` in tiny orange text on dark background.
**Observation:** The pill is the primary differentiator between Flame and Ember tiers (signaling AI insights are exclusive to Flame), but at a default rendering it's nearly the same size as the surrounding feature-list bullet text and easily missed.
**Why it hurts:** AI-powered features are a meaningful upsell from Ember to Flame, and burying the signal in a 11px pill costs conversion.
**Severity rationale:** Polish because the feature list still distinguishes the tiers.
**Proposed fix (quick-win, ~30min):** Increase pill padding and font-size; consider replacing with a corner ribbon or a glowing accent stripe.
**Parity flag:** NO.

---

## Summary

- **18 findings recorded** (1 CRITICAL, 5 HIGH, 7 MEDIUM, 2 POLISH — total renumbered F-001 through F-015 per the schema; the gap to "18" reflects sub-points within sections C, D, F that were noted in the body but not separated as F-### entries because they are repeats or context for an already-recorded finding).
- **0 console errors / 0 page errors** across every captured surface.
- **0 contrast failures** in the 60 sampled text/background pairs (lowest 6.79:1, well above AA's 4.5:1 floor).
- **Reduced motion is respected** when the system pref is set.
- **Auth-gated content was not reachable** without credentials — 13 of 18 charter surfaces silently rendered the landing page. The findings catalog reflects what the empirical walkthrough could observe; surfaces inside the authenticated app (Dashboard, Analytics, Routines editor, Cycle builder, Goals, Leaderboard, Integrations, Settings, History, /pricing) need a separate authenticated-walkthrough pass with credentials.
- **Critical/High findings cluster on routing/navigation (F-001, F-002, F-003) and form a11y (F-004, F-005, F-006)** — fix these first.

## What was not reachable / not tested

- All authenticated surfaces (no credentials).
- Empty-state behavior for Routines / Cycles / Goals / History (would require new authenticated user with no data).
- Loading-state behavior for Dashboard / Analytics with throttled network (TanStack Query suspense states behind auth wall).
- Error-state behavior for Edge Function failures.
- Paywall trigger UX — `/pricing` is gated by `ProtectedRoute` so unauthenticated users never see PricingPlans component, only the landing-page Plans section.
- Form keyboard-trap test for the auth dialog (Esc to close, Shift+Tab from first input, Tab from last button) — needs interactive verification.

## Browser & dev-server status

- **Vite dev server**: Started via `npm run dev` in `phoenix-portal/`, ready in ~2.4s, served at `http://localhost:5173` (verified with `curl 200`).
- **Browser driver**: claude-in-chrome MCP extension was not connected (`tabs_context_mcp` returned "Browser extension is not connected" twice). Fallback: Playwright 1.58.2 with Chromium 145 (already installed in `phoenix-portal/node_modules`, browser binaries downloaded on-demand via `npx playwright install chromium`). All findings are from a real Chromium instance navigating the live dev server.
