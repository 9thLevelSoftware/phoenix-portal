# E2E Tests Review

Scope reviewed:
- e2e/a11y.spec.ts
- e2e/account-deletion.spec.ts
- e2e/auth-redirect.spec.ts
- e2e/critical-paths.spec.ts
- e2e/integrations.spec.ts
- e2e/navigation.spec.ts
- e2e/pricing-gates.spec.ts
- e2e/public-pages.spec.ts
- e2e/realtime-cross-tab.spec.ts
- e2e/signup-onboarding.spec.ts
- e2e/smoke.spec.ts
- e2e/fixtures/auth.ts
- e2e/support/mockSupabase.ts
- e2e/support/supabase.ts

Verification note: read all assigned files in full. Ran `npm run typecheck -- --pretty false`; it passed.

Summary:
- Total findings: 24
- Critical: 0
- High: 4
- Medium: 16
- Low: 4

## e2e/a11y.spec.ts

### Finding 1
- Category: failure-point
- Severity: medium
- Line numbers: 52-60, 93-100
- Description: The axe audit collects WCAG A/AA violations but only fails on `critical` and `serious` impact violations. Moderate WCAG failures (for example many color contrast, landmark, label, or focus-order regressions) are logged but allowed to pass, so this is not a full WCAG A/AA regression gate despite the file/test naming.
- Suggested fix direction: Decide whether this test is only a smoke gate or a WCAG conformance gate. If it is intended as WCAG coverage, fail on all violations for the selected WCAG tags or maintain an explicit reviewed allowlist for known moderate/minor issues.

### Finding 2
- Category: failure-point
- Severity: medium
- Line numbers: 65-75
- Description: Authenticated page accessibility tests use the generic mock harness without seeding realistic page data for most routes. Several pages can render empty states, placeholders, or simplified mocked content, so accessibility regressions in populated cards, charts, forms, dialogs, and table/list states can be missed.
- Suggested fix direction: Add representative fixtures per authenticated route, or split a11y tests into empty-state and populated-state audits for pages with materially different DOMs.

## e2e/account-deletion.spec.ts

### Finding 3
- Category: failure-point
- Severity: medium
- Line numbers: 264-270, 291-302
- Description: The destructive-delete success path verifies sign-out/localStorage clearing, but it does not assert the documented redirect to `/`. A regression where the token is cleared but the user remains on `/profile` or an error screen would pass this spec.
- Suggested fix direction: After confirming deletion and sign-out, assert `page.waitForURL("/"...)` or an equivalent landing-page visible state in addition to token clearing.

### Finding 4
- Category: failure-point
- Severity: medium
- Line numbers: 94-123
- Description: The deletion_requests mock responds based only on path and method; it does not validate the `user_id` and `status` filters on GET or the POST payload shape. The production query is security-sensitive because it must read/write only the current user's pending deletion request, but the mock would still pass if those filters were accidentally dropped or changed.
- Suggested fix direction: Parse query parameters for `user_id=eq.<id>` and `status=eq.pending`, validate POST body includes the expected `user_id`, and return an error or empty result when the request does not match the production contract.

## e2e/auth-redirect.spec.ts

No findings.

## e2e/critical-paths.spec.ts

### Finding 5
- Category: bug
- Severity: medium
- Line numbers: 32-37
- Description: The routine builder test conditionally fills the routine-name input only if it is visible. If the input disappears, is hidden by a regression, or the selector stops matching, the test skips the assertion and can still pass as long as the Add Exercise button is present.
- Suggested fix direction: Treat the routine name input as required for the critical path: assert it is visible/editable before filling, or use a stable accessible label/test id and fail when it is absent.

### Finding 6
- Category: failure-point
- Severity: medium
- Line numbers: 73-104
- Description: The subscription-gate checks only visible copy/buttons and never verifies that gated integration-management controls are absent for FREE users or that FLAME-only network actions are unreachable. A page that displays the upgrade prompt while also leaking connect/sync controls could pass.
- Suggested fix direction: Add negative assertions for provider connect/sync/disconnect controls and, where possible, assert no gated integration requests are made for FREE users.

## e2e/integrations.spec.ts

### Finding 7
- Category: failure-point
- Severity: medium
- Line numbers: 43-50
- Description: The manual sync/disconnect test asserts generic text (`Recent Activity`, `completed`, `Connect Strava`) but does not verify the request contract for sync queue creation, provider argument, or edge-function invocation. Because the support mock auto-completes sync state, this can miss regressions where the UI calls the wrong endpoint/payload but still transitions under the mock.
- Suggested fix direction: Track and assert the intercepted `/rest/v1/sync_queue` POST body and `/functions/v1/strava-sync` request, including provider and sync type, before asserting UI state.

### Finding 8
- Category: failure-point
- Severity: low
- Line numbers: 72-78
- Description: The Garmin test asserts there are zero `Sync Now` buttons on the whole page. This is only correct for the current single-provider fixture and will become brittle if the page renders another connected provider with a valid manual-sync button in the same test state.
- Suggested fix direction: Scope the absence assertion to the Garmin provider card/section instead of the whole page.

## e2e/navigation.spec.ts

### Finding 9
- Category: failure-point
- Severity: medium
- Line numbers: 61-79
- Description: The test named `privacy page back-navigation to landing` uses `page.goto("/")` rather than exercising an in-page back/home link, browser back behavior, or an app navigation element. It therefore verifies direct routing, not the user-facing back-navigation path.
- Suggested fix direction: Click the actual back/home control from the privacy page, or use browser back if that is the intended behavior, and assert the landing page renders afterward.

### Finding 10
- Category: failure-point
- Severity: low
- Line numbers: 3-8, 20-21, 38-39, 54-55, 63-74, 90-107
- Description: The navigation suite relies heavily on fixed `waitForTimeout` sleeps to wait for animation/page readiness. This adds runtime and can still be flaky on slow CI or under changed animation durations.
- Suggested fix direction: Replace fixed sleeps with web-first assertions for the next visible landmark/heading, or disable/reduce animations in Playwright through app config/CSS for E2E runs.

## e2e/pricing-gates.spec.ts

### Finding 11
- Category: failure-point
- Severity: medium
- Line numbers: 36-43
- Description: The FLAME downgrade test only checks for a `Downgrade` button and absence of `Included in your plan`. It does not assert which tier/card the downgrade action belongs to, so a mislabeled button on the wrong plan or multiple plan-card state regression could pass.
- Suggested fix direction: Scope assertions to each pricing card and verify current FLAME state separately from EMBER/other lower-tier downgrade CTAs.

## e2e/public-pages.spec.ts

### Finding 12
- Category: failure-point
- Severity: medium
- Line numbers: 117-121, 138-142
- Description: Privacy and Terms content checks use only body text length greater than 200. This can pass with unrelated boilerplate, duplicated navigation text, or an error page that contains enough text.
- Suggested fix direction: Assert stable page-specific legal sections/headings and at least one expected policy/terms clause rather than only total body length.

### Finding 13
- Category: failure-point
- Severity: low
- Line numbers: 20-47, 105-121, 127-142, 148-175
- Description: The public-page error checks listen for `pageerror` only. Console errors, failed network requests for critical chunks/assets, and React recoverable errors logged to console can go unnoticed.
- Suggested fix direction: Add `console` and `requestfailed` listeners with an allowlist for known benign failures, or use Playwright's web error/request assertions where appropriate.

## e2e/realtime-cross-tab.spec.ts

### Finding 14
- Category: stub
- Severity: high
- Line numbers: 81-94
- Description: The only real Supabase Realtime broadcast test is `test.skip`, leaving the actual WebSocket/channel path unexecuted in automated E2E. The file documents the manual path but does not enforce it, so regressions in channel subscription, auth, or Supabase broadcast payloads will not fail CI.
- Suggested fix direction: Add a separate live-realtime project/tag gated by required credentials, or implement a local WebSocket/realtime test double that exercises the Supabase channel API instead of skipping the path entirely.

### Finding 15
- Category: bug
- Severity: high
- Line numbers: 96-181
- Description: The mocked cross-tab test does not actually simulate a cross-tab broadcast. It creates two isolated browser contexts, never triggers any action from tab A, mutates only page B's mocked REST response, and directly dispatches the development-only `phoenix:e2e-sync-complete` event inside page B. A broken cross-tab communication path would still pass.
- Suggested fix direction: Use two pages in the same browser context when testing browser-tab behavior, trigger the broadcast/source action from one page, and observe invalidation in the other. Keep direct custom-event dispatch in lower-level component tests rather than labeling it cross-tab E2E.

## e2e/signup-onboarding.spec.ts

### Finding 16
- Category: bug
- Severity: medium
- Line numbers: 134-144
- Description: The test calls `page.addInitScript` after the landing page and dialog are already loaded. `addInitScript` affects future navigations/documents, not the current page, so this localStorage seed does not hydrate the active AuthProvider before the submit click. The test currently relies on Supabase client side effects instead of the stated setup.
- Suggested fix direction: Seed storage before `page.goto("/")`, or remove the misleading init script and explicitly assert that the mocked signup response causes the Supabase client/AuthProvider to store the session.

### Finding 17
- Category: failure-point
- Severity: medium
- Line numbers: 83-105
- Description: The signup auth mock returns `[]` or `{ success: true }` for broad REST/functions/auth fallthroughs, including endpoints not explicitly modeled for the signup flow. This can hide wrong endpoint calls or invalid response-shape handling during post-signup dashboard hydration.
- Suggested fix direction: Fulfill only the specific endpoints expected by the signup flow with realistic shapes, and fail unexpected Supabase paths with a clear 500/error in test output.

## e2e/smoke.spec.ts

### Finding 18
- Category: failure-point
- Severity: medium
- Line numbers: 199-203
- Description: The compare-page smoke test accepts `Missing Session IDs` as a passing state. That verifies the route can render an empty/error prompt, but not that the comparison critical path works with selected sessions.
- Suggested fix direction: Add a seeded comparison test that navigates with valid session IDs and asserts comparison metrics/content, leaving the missing-IDs assertion as a separate empty-state test.

## e2e/fixtures/auth.ts

### Finding 19
- Category: bug
- Severity: medium
- Line numbers: 5-9, 16-34, 60-67
- Description: `loadEnvFile()` runs after importing constants from `../support/supabase`. If `e2e/.env` is intended to provide `VITE_SUPABASE_URL` or `VITE_SUPABASE_ANON_KEY`, those constants have already been initialized to process env/default values before the file is loaded. Live auth fixtures can silently target the wrong Supabase URL/key.
- Suggested fix direction: Load the e2e env file before importing/initializing Supabase constants, or centralize env loading in Playwright config/global setup before any E2E support modules are imported.

### Finding 20
- Category: failure-point
- Severity: medium
- Line numbers: 14, 41-52, 83-91
- Description: The live session cache is a single `.session-cache.json` beside the fixture, keyed only by timestamp and not by Supabase URL, test email, or user. Switching test accounts/projects within 30 minutes can reuse the wrong user's session; parallel workers can also race on the same cache file.
- Suggested fix direction: Include Supabase URL/project ref and test email in the cache key/filename, validate `expires_at`, and write cache files atomically (write temp then rename) or disable shared cache when workers run in parallel.

## e2e/support/mockSupabase.ts

### Finding 21
- Category: failure-point
- Severity: high
- Line numbers: 180-208, 362-395, 453-487
- Description: The generic row filter only implements `eq` and `in`, ignoring common PostgREST query operators such as `gte`, `lte`, `range`, `limit`, and ordering semantics. Production queries for dashboard stats, lists, pagination, and ordered detail data can be wrong while mocked E2E still returns all seeded rows in insertion order.
- Suggested fix direction: Extend the mock to model the PostgREST operators used by the app, especially date ranges, limits/ranges, and ordering, or assert request URLs exactly in tests that depend on those query contracts.

### Finding 22
- Category: failure-point
- Severity: high
- Line numbers: 330-335, 489-495
- Description: Unknown Edge Functions and unknown REST tables are fulfilled with successful generic responses. This masks missing mock coverage and allows new or misspelled production requests to pass E2E with empty/success data instead of surfacing the unmodeled dependency.
- Suggested fix direction: Fail closed for unknown functions/tables with an explanatory test error. Add explicit cases for every endpoint the app is expected to call.

### Finding 23
- Category: failure-point
- Severity: low
- Line numbers: 253-257, 423-426, 453-457
- Description: Several route handlers call `JSON.parse(request.postData())` without guarding parse errors. A malformed or unexpectedly empty request body will throw from the route handler rather than returning a controlled test failure with endpoint context.
- Suggested fix direction: Wrap request-body parsing in a helper that reports the endpoint, method, and body on parse failure, then fulfills a clear 400/500 response for test diagnostics.

## e2e/support/supabase.ts

### Finding 24
- Category: failure-point
- Severity: medium
- Line numbers: 3-15
- Description: The default Supabase URL is a real-looking hosted domain (`https://test-project.supabase.co`). Any unmocked request or test that accidentally bypasses route interception may attempt external network access instead of failing locally and deterministically.
- Suggested fix direction: Use a non-routable/local default URL for mocked E2E, or configure Playwright to fail unexpected network calls to Supabase unless a live-test project is explicitly enabled.
