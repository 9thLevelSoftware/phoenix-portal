# Feature Components Part 3 Review

Scope reviewed:
- `src/app/components/LandingPage.tsx`
- `src/app/components/landing/ForceCurveDemo.tsx`
- `src/app/components/landing/ProductShowcase.tsx`
- `src/app/components/Challenges.tsx`
- `src/app/components/ComparisonSessionPicker.tsx`
- `src/app/components/ComparisonView.tsx`
- `src/app/components/OnboardingOverlay.tsx`
- `src/app/components/FeatureHint.tsx`
- `src/app/components/WhatsNewBanner.tsx`
- `src/app/components/PWAInstallPrompt.tsx`
- `src/app/components/CookieConsentBanner.tsx`
- `src/app/components/OfflineBanner.tsx`
- `src/app/components/ConsistencyCalendar.tsx`
- `src/app/components/MuscleHeatmap.tsx`
- `src/app/components/NextWorkoutWidget.tsx`
- `src/app/components/FAQ.tsx`
- `src/app/components/PrivacyPolicy.tsx`
- `src/app/components/TermsOfService.tsx`

Verification performed:
- Read all 18 assigned files in full.
- Ran `npm run typecheck -- --pretty false` successfully.

Summary:
- Findings: 20
- Severity breakdown: critical 0, high 1, medium 10, low 9

## `src/app/components/LandingPage.tsx`

No findings.

## `src/app/components/landing/ForceCurveDemo.tsx`

### Finding 1
- Category: failure-point
- Severity: medium
- Line numbers: 105-116, 329-336
- Description: The chart only falls back when `ParentSize` reports `width <= 0`. For very narrow containers where `0 < width < MARGINS.left + MARGINS.right` (60px), `innerWidth` becomes negative and the x-scale range, axes, tooltip positions, and SVG paths are generated with invalid/reversed geometry. This can break rendering in constrained responsive layouts or tests that mount the component in a small container.
- Suggested fix direction: Clamp `innerWidth`/`innerHeight` to a minimum positive size, or use the fixed fallback until the measured width is at least the total horizontal margin plus a usable plot width.

### Finding 2
- Category: failure-point
- Severity: low
- Line numbers: 162-180
- Description: The SVG gradient id `force-area-gradient` is hardcoded. If multiple `ForceCurveDemo` instances render in the same document, duplicate ids can make `fill="url(#force-area-gradient)"` resolve to the wrong gradient definition or violate unique-id assumptions used by tests and assistive tooling.
- Suggested fix direction: Generate a per-instance id with `useId()` and reference that id in the `AreaClosed` fill.

## `src/app/components/landing/ProductShowcase.tsx`

### Finding 3
- Category: failure-point
- Severity: low
- Line numbers: 45-53
- Description: The mini force chart uses a hardcoded SVG gradient id `force-gradient`. Rendering more than one `ProductShowcase` on a page creates duplicate DOM ids and can cause `url(#force-gradient)` references to bind to another instance's gradient.
- Suggested fix direction: Use `useId()` or accept an id prefix from the parent, then build a unique gradient id for each rendered SVG.

## `src/app/components/Challenges.tsx`

### Finding 4
- Category: bug
- Severity: medium
- Line numbers: 497-505, 770-803
- Description: `activeChallenges` means every active challenge that is not completed, regardless of whether the user joined it. The desktop "Active Challenges" tab maps this entire list, so unjoined discoverable challenges appear as active challenges with a Join button. The mobile active tab filters to `joinedIds`, and mobile has a separate Discover tab, so desktop and mobile show different challenge states.
- Suggested fix direction: Split desktop the same way as mobile: active/joined challenges should be `joinedIds.has(c.id) && !completedIds.has(c.id)`, and unjoined challenges should be displayed in a Discover tab/section.

### Finding 5
- Category: failure-point
- Severity: high
- Line numbers: 260-264, 797-798
- Description: On desktop, clicking "Leave Challenge" immediately calls `leaveMutation.mutate(challenge.id)` with no confirmation, while mobile requires an AlertDialog that warns progress will be lost. This is a destructive action and is easy to trigger accidentally from the desktop card.
- Suggested fix direction: Reuse the `leaveConfirmId` confirmation flow for desktop leave actions and disable the confirm button while `leaveMutation.isPending`.

### Finding 6
- Category: failure-point
- Severity: low
- Line numbers: 62-68, 165, 230-232, 457
- Description: Date parsing failures are not handled. If a malformed/null `end_date` is returned from the API cast, `new Date(endDate).getTime()` becomes `NaN`, `Math.max(0, NaN)` returns `NaN`, and the UI displays `NaN days` / `NaN days left` instead of a safe fallback.
- Suggested fix direction: Validate parsed dates before computing the difference and render an "unknown"/"ended" fallback when the date is invalid.

## `src/app/components/ComparisonSessionPicker.tsx`

### Finding 7
- Category: failure-point
- Severity: low
- Line numbers: 67-75
- Description: The search field is identified only by placeholder text and has no programmatic label. Once users type into it, screen-reader users lose the accessible prompt for what the input searches.
- Suggested fix direction: Add a visually-hidden `<label>` linked with `htmlFor`, or add an `aria-label="Search sessions by name or date"` to the input.

### Finding 8
- Category: failure-point
- Severity: low
- Line numbers: 92-97
- Description: Session rows are clickable `Card` elements without button/link semantics, `tabIndex`, or keyboard handlers. Keyboard and assistive-technology users cannot reliably select a session from the dialog.
- Suggested fix direction: Render each row as a real `<button type="button">` styled like the card, or add appropriate `role="button"`, `tabIndex={0}`, and Enter/Space handling.

## `src/app/components/ComparisonView.tsx`

### Finding 9
- Category: bug
- Severity: medium
- Line numbers: 359-361
- Description: The premium upgrade copy refers to "Phoenix and Elite plans", but the app's pricing source of truth defines Ember, Flame, and Inferno tiers. Users blocked by the comparison gate are pointed at nonexistent plan names.
- Suggested fix direction: Import tier names/capability metadata from the pricing/subscription source of truth, or update the copy to the current tier names.

### Finding 10
- Category: failure-point
- Severity: medium
- Line numbers: 476-502
- Description: The error state renders raw `errorA?.message || errorB?.message` directly to the user. Supabase/PostgREST and parsing errors can contain implementation details, table/column names, or confusing low-level messages that are not appropriate for end users.
- Suggested fix direction: Log/report the raw error internally and render a generic user-safe message with a retry/back-to-history action.

## `src/app/components/OnboardingOverlay.tsx`

### Finding 11
- Category: failure-point
- Severity: medium
- Line numbers: 99-105
- Description: `Dialog` close events call `onComplete()`. Pressing Escape, clicking the overlay/close affordance, or any parent-driven close therefore marks onboarding complete instead of simply dismissing or keeping it incomplete. A brand-new user can accidentally skip all onboarding without choosing Skip or completing the steps.
- Suggested fix direction: Disable outside/Escape close for mandatory onboarding, or route close events to a separate dismiss/skip handler that is explicit in UI and analytics.

## `src/app/components/FeatureHint.tsx`

No findings.

## `src/app/components/WhatsNewBanner.tsx`

### Finding 12
- Category: failure-point
- Severity: low
- Line numbers: 24-28
- Description: `handleDismiss` schedules `onDismiss()` with `setTimeout` but does not clear the timer on unmount. If the banner unmounts before 300ms because of route changes or parent state changes, the stale timer can still fire and mutate onboarding state after the component lifecycle has ended.
- Suggested fix direction: Store the timeout id in a ref and clear it in an effect cleanup, or let `AnimatePresence`/motion completion callbacks trigger persistence while the component is still mounted.

## `src/app/components/PWAInstallPrompt.tsx`

### Finding 13
- Category: failure-point
- Severity: low
- Line numbers: 64-66
- Description: The dismiss control is an icon-only button with no accessible name. Screen readers will announce an unlabeled button, making it unclear that it closes the install prompt.
- Suggested fix direction: Add `aria-label="Dismiss install prompt"` or include visually-hidden text inside the button.

## `src/app/components/CookieConsentBanner.tsx`

### Finding 14
- Category: failure-point
- Severity: medium
- Line numbers: 10-14, 20-28
- Description: Consent read/write calls are not protected from storage failures. `getConsentStatus()` and `setConsentStatus()` use `localStorage` directly, so browsers that block storage, private-mode quota/security errors, or embedded contexts can throw and break the banner/app instead of falling back gracefully.
- Suggested fix direction: Wrap consent reads/writes in `try/catch`, default to showing the banner when reads fail, and keep in-memory visibility changes even if persistence fails.

## `src/app/components/OfflineBanner.tsx`

No findings.

## `src/app/components/ConsistencyCalendar.tsx`

### Finding 15
- Category: bug
- Severity: medium
- Line numbers: 41-45, 121-123, 136-137
- Description: Workout days are keyed with `toISOString().slice(0, 10)`, which groups by UTC date, while the calendar grid, labels, and streak computations otherwise use local calendar days. Workouts near local midnight can be counted on the wrong day for users outside UTC, causing incorrect heatmap cells and streaks.
- Suggested fix direction: Use a local-date key such as `format(d, "yyyy-MM-dd")` consistently for unique days, countMap keys, and grid lookup keys.

### Finding 16
- Category: failure-point
- Severity: low
- Line numbers: 217-239, 245-269
- Description: Calendar cell details are only available through mouse hover on SVG rects. Keyboard users and touch devices cannot reveal the per-day tooltip, despite the rects being presented with interactive cursor styling.
- Suggested fix direction: Make cells focusable with keyboard handlers/focus tooltip support, or provide an accessible textual summary/list for selected days.

## `src/app/components/MuscleHeatmap.tsx`

### Finding 17
- Category: failure-point
- Severity: low
- Line numbers: 225-247, 273-310, 330-350
- Description: Muscle-region details are only available via mouse hover, and the Front/Back toggle buttons do not expose selected state (`aria-pressed`). Touch, keyboard, and assistive-technology users cannot inspect region values or reliably know which view is active.
- Suggested fix direction: Add `aria-pressed` to the view toggle buttons, make regions focusable/selectable, and show the same tooltip/details on focus/click/touch as on hover.

## `src/app/components/NextWorkoutWidget.tsx`

### Finding 18
- Category: failure-point
- Severity: medium
- Line numbers: 12-18, 152-160
- Description: `RoutineName` treats any missing or failed routine detail as `Custom Workout`. If the routine query errors, is unauthorized, or returns no row because of a data integrity issue, the schedule silently shows a different workout type instead of indicating that the assigned routine could not be loaded.
- Suggested fix direction: Track `isError` separately and render an explicit "Routine unavailable" state (with retry/logging) instead of falling back to `Custom Workout` except when `result.routineId` is actually null.

## `src/app/components/FAQ.tsx`

### Finding 19
- Category: bug
- Severity: medium
- Line numbers: 72-83
- Description: The FAQ hardcodes stale subscription information: it says there are two tiers and prices Ember at $15/mo, while the pricing source of truth defines Ember at $5/mo, Flame at $15/mo, and Inferno at $25/mo. This can mislead users evaluating plans.
- Suggested fix direction: Import tier data from `TIER_PRICING` or rewrite the FAQ copy to avoid hardcoded prices/tier counts that can drift from the pricing module.

## `src/app/components/PrivacyPolicy.tsx`

### Finding 20
- Category: bug
- Severity: medium
- Line numbers: 135-144, 185-189, 301-304
- Description: The policy states that performance metrics such as velocity/load/power are collected and stored on cloud servers, but the Bluetooth section later says relevant metrics are stored locally and no Bluetooth data is transmitted to external parties. These statements conflict for the same sensor-derived workout data and can create a compliance/support issue.
- Suggested fix direction: Clarify the data flow: distinguish transient BLE control traffic from workout metrics uploaded/synced to Supabase, and make the storage/transmission statements consistent.

## `src/app/components/TermsOfService.tsx`

No findings.
