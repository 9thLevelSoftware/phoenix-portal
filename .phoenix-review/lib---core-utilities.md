# Review: Lib - Core Utilities

Scope reviewed:
- `src/lib/supabase.ts`
- `src/lib/paddle.ts`
- `src/lib/paddle-client.ts`
- `src/lib/pricing.ts`
- `src/lib/subscription-entitlement.ts`
- `src/lib/units.ts`
- `src/lib/telemetry.ts`
- `src/lib/telemetry-display.ts`
- `src/lib/sentry.ts`
- `src/lib/consent.ts`
- `src/lib/in-app-browser.ts`
- `src/lib/colors.ts`
- `src/lib/animations.ts`
- `src/lib/toast-undo.ts`
- `src/lib/database.types.ts`

Summary:
- Findings: 21
- Severity breakdown: 4 high, 14 medium, 3 low
- Category breakdown: 8 bug, 4 error, 9 failure-point

## `src/lib/supabase.ts`

### Finding 1
- Category: error
- Severity: high
- Line numbers: 42-58
- Description: `fetchWithAuthRetry` calls `supabaseRef.current.auth.refreshSession()` from inside the Supabase client's global custom fetch. If the request that receives a 401 is itself an auth refresh request, or if refresh fails with a 401, the same custom fetch can recursively call `refreshSession()` again and loop until repeated network calls or stack/resource exhaustion.
- Suggested fix direction: Add a re-entrancy guard and/or skip retry logic for Supabase auth endpoints such as `/auth/v1/token` and `/auth/v1/logout`. Only retry PostgREST/storage/function requests that can safely use the refreshed access token.

### Finding 2
- Category: failure-point
- Severity: medium
- Line numbers: 42-58
- Description: The retry path reuses the original `input` and `init` after the first `fetch`. If `input` is a `Request` with a body, the first fetch consumes the body stream and the retry can fail with an unusable body. Retrying non-idempotent requests also risks duplicating side effects if the server partially processed the first request before returning 401.
- Suggested fix direction: Restrict retries to safe request shapes or clone the `Request` before the first fetch. Consider only retrying idempotent methods by default and documenting/handling function calls separately.

## `src/lib/paddle.ts`

### Finding 3
- Category: bug
- Severity: high
- Line numbers: 18-28, 59-64, 133-146
- Description: `PaddleEventType` includes `transaction.completed` and `transaction.payment_failed`, but `PaddleWebhookEvent.data` is always typed as `PaddleSubscriptionData`. If transaction webhook events are passed to `buildSubscriptionUpsert`, fields such as `data.id`, `customer_id`, `status`, and `items[0].price.id` are interpreted as subscription data even though Paddle transaction payloads have a different shape. This can write incorrect subscription/customer IDs or silently downgrade tier resolution.
- Suggested fix direction: Use a discriminated union keyed by `event_type`, and make `buildSubscriptionUpsert` accept only subscription events. Handle transaction events in a separate mapper that resolves the related subscription explicitly.

### Finding 4
- Category: bug
- Severity: medium
- Line numbers: 72-94, 144-160
- Description: Unknown or missing Paddle price IDs map to `FREE`, and `buildSubscriptionUpsert` writes that tier. A missing env var, renamed Paddle price, or empty `items` array can therefore downgrade a paying user to `FREE` instead of failing closed.
- Suggested fix direction: Return `null`/throw for unknown non-empty price IDs in production webhook handling, log the unmapped price, and avoid updating `tier` until a known price mapping is available. Reserve `FREE` for explicit free/no-subscription states, not mapper failures.

### Finding 5
- Category: failure-point
- Severity: high
- Line numbers: 184-235
- Description: `verifyPaddleSignature` validates the HMAC but never checks freshness of the `ts=` value. Any previously captured valid webhook body/signature pair can be replayed indefinitely.
- Suggested fix direction: Parse `ts` as a Unix timestamp and reject signatures outside a short tolerance window, for example 5 minutes, before or after HMAC validation.

### Finding 6
- Category: bug
- Severity: high
- Line numbers: 154-170
- Description: The upsert payload records `last_event_id` and `last_event_occurred_at`, but this builder does not encode any stale-event protection. If the downstream upsert is unconditional, older Paddle webhooks can arrive after newer ones and overwrite current status/tier/period data.
- Suggested fix direction: Ensure the write path compares `event.occurred_at` with the stored `last_event_occurred_at` and ignores older or duplicate events. Keep the comparison in the same database statement/RPC as the update to avoid races.

## `src/lib/paddle-client.ts`

### Finding 7
- Category: failure-point
- Severity: medium
- Line numbers: 78-103
- Description: `scriptLoadPromise` is cached even when the Paddle script load rejects. A transient CDN/network/ad-block failure leaves the module permanently stuck with the rejected promise, so later checkout attempts cannot retry without a full page reload.
- Suggested fix direction: Clear `scriptLoadPromise` in the rejection path or wrap the promise with `.catch()` that resets the cache before rethrowing. Optionally remove the failed script element.

### Finding 8
- Category: error
- Severity: medium
- Line numbers: 128-145, 201-210
- Description: Missing token or missing `window.Paddle` causes `initializePaddle` to return without throwing, and `openCheckout` then logs an error and returns normally. Callers awaiting `openCheckout` cannot distinguish a successfully opened checkout from a no-op, so UI loading/state and user feedback can become incorrect.
- Suggested fix direction: Make initialization failures throw typed errors and let callers show the same error path used for signing failures. Alternatively return an explicit success/failure result instead of `Promise<void>`.

### Finding 9
- Category: bug
- Severity: medium
- Line numbers: 110-120, 156-165, 197-199
- Description: Checkout callbacks are stored in a single module-level `activeCallbacks` object. A double click, two components opening checkout, or any overlapping checkout attempt overwrites callbacks for the prior checkout. Completion/close events can then notify the wrong caller, or a stale callback can run for a later checkout.
- Suggested fix direction: Prevent concurrent checkout opens, clear callbacks on close/success, and correlate events to a checkout/session identifier where Paddle exposes one.

## `src/lib/pricing.ts`

No findings identified in this file. The empty price-ID fallback is risky in isolation, but current `PricingPlans` callers guard empty IDs before invoking checkout.

## `src/lib/subscription-entitlement.ts`

### Finding 10
- Category: failure-point
- Severity: medium
- Line numbers: 11-30, 33-42
- Description: Only `active` and `trialing` are treated as entitlement-bearing statuses. A `past_due` subscription with a future `current_period_end` immediately loses paid access, even though payment processors commonly allow a grace/retry window while the billing period is still current.
- Suggested fix direction: Confirm the billing policy. If grace access is intended, include `past_due` while `current_period_end` is still future, possibly with separate UI messaging and stale-refresh behavior.

## `src/lib/units.ts`

### Finding 11
- Category: bug
- Severity: medium
- Line numbers: 52-64
- Description: `weightInputToKg` converts blank, invalid, null, and undefined input to `0`. In forms that call this on every `onChange`, temporarily clearing a field or typing an invalid intermediate value can overwrite existing persisted settings with zero.
- Suggested fix direction: Return `null`/`undefined`/`NaN` for invalid or blank input and let callers decide whether to preserve the previous value, reject submission, or intentionally store zero.

### Finding 12
- Category: failure-point
- Severity: low
- Line numbers: 5-8, 20-37, 66-82
- Description: `safeNumber` filters only `null`, `undefined`, and `NaN`; it allows `Infinity` and `-Infinity`. Formatting helpers can therefore emit `Infinity kg`, `Infinity lbs`, or nonsensical abbreviated values if upstream calculations divide by zero or overflow.
- Suggested fix direction: Use `Number.isFinite` instead of only `Number.isNaN`, or handle infinite values explicitly with a display fallback such as `—`.

## `src/lib/telemetry.ts`

### Finding 13
- Category: failure-point
- Severity: medium
- Line numbers: 32-40
- Description: `downsampleTelemetry` accepts any `targetPoints` value. Values such as `0`, `1`, `2`, negative numbers, or non-finite numbers are passed directly into the LTTB implementation and can throw or return unusable chart data.
- Suggested fix direction: Validate `targetPoints` before calling LTTB. Clamp to a documented minimum, or return an empty/original array for unsupported values.

### Finding 14
- Category: bug
- Severity: medium
- Line numbers: 46-62
- Description: `normalizeRepTime` assumes points are already sorted by `timestamp_ms`, using the first point as min and the last point as max. If Supabase or another caller provides unsorted telemetry, normalized times can be negative, greater than 100, or inverted.
- Suggested fix direction: Sort by `timestamp_ms` or compute `min`/`max` across all points before normalizing. If order matters for rendering, return a sorted copy rather than mutating the input.

## `src/lib/telemetry-display.ts`

### Finding 15
- Category: bug
- Severity: low
- Line numbers: 14-31
- Description: The helpers are typed for `"A" | "B"`, but runtime data from `database.types.ts` allows `rep_telemetry.cable` to be `string | null`. Any invalid value passed through casts or untyped data will be displayed as `Right`/`right` because the implementation treats everything except `"A"` as cable B.
- Suggested fix direction: Add a runtime guard/parser for cable identifiers and return an explicit `Unknown`/`unknown` fallback for invalid or null values.

## `src/lib/sentry.ts`

No findings identified in this file.

## `src/lib/consent.ts`

### Finding 16
- Category: error
- Severity: medium
- Line numbers: 5-15
- Description: `getConsentStatus` and `setConsentStatus` access `localStorage` directly with no `typeof window` check or `try/catch`. Browsers can throw `SecurityError` when storage is disabled, blocked, or unavailable, and `main.tsx` calls `getConsentStatus()` during startup before React renders.
- Suggested fix direction: Wrap localStorage reads/writes in `try/catch`, return `null` when reads fail, and ignore or surface write failures without crashing app startup.

## `src/lib/in-app-browser.ts`

### Finding 17
- Category: bug
- Severity: medium
- Line numbers: 74-88
- Description: `buildAndroidChromeIntentUrl` includes the original URL hash inside `rest` and then appends another `#Intent` separator. For URLs with fragments, the result contains two hash markers, e.g. `...#top#Intent;...`, which can prevent Android from parsing the intent metadata correctly.
- Suggested fix direction: Exclude the source fragment from the `intent://` path or encode it according to Android intent URI rules before appending the single `#Intent` block. Update the existing test that currently asserts the malformed double-hash output.

## `src/lib/colors.ts`

No findings identified in this file.

## `src/lib/animations.ts`

No findings identified in this file.

## `src/lib/toast-undo.ts`

### Finding 18
- Category: error
- Severity: medium
- Line numbers: 51-57
- Description: If the delayed `action` fails, the catch block only shows a generic toast and swallows the error. Callers cannot roll back optimistic UI state, invalidate queries, log the actual failure, or react differently to expected failures.
- Suggested fix direction: Add an `onError(error)` callback and/or rethrow after showing the toast. Preserve the original error for telemetry/logging.

### Finding 19
- Category: failure-point
- Severity: low
- Line numbers: 34-59
- Description: The destructive timer is independent of the toast lifecycle. If the toast is dismissed by timeout, programmatic dismissal, route change, or component unmount before `delayMs`, the action still executes with no visible Undo affordance.
- Suggested fix direction: Use the toast library's dismissal/close hooks if available, keep the toast visible for the entire undo window, and provide a returned cancellation function so components can clear the pending action on unmount.

## `src/lib/database.types.ts`

### Finding 20
- Category: failure-point
- Severity: medium
- Line numbers: 1576-1627
- Description: The `subscriptions` table exposes `status` and `tier` as unrestricted `string` types even though the application expects narrow unions (`FREE`/`EMBER`/`FLAME`/`INFERNO` and known subscription statuses). This weakens compile-time protection and allows invalid writes to type-check.
- Suggested fix direction: Back the database columns with enums or generated check-constraint-aware types where possible. At minimum, centralize typed insert/update helpers that validate tier/status before writing.

### Finding 21
- Category: failure-point
- Severity: medium
- Line numbers: 1036-1066, 2169-2199
- Description: Telemetry rows/views allow nullable `cable`, `force_n`, `velocity_mps`, and `position_mm`, while `src/lib/telemetry.ts` chart helpers require non-null numbers and a strict `"A" | "B"` cable. Directly passing query results into chart code can produce runtime failures or incorrect display after casts.
- Suggested fix direction: Add a normalization layer for telemetry query results that drops or defaults incomplete samples and validates cable identifiers before constructing `TelemetryPoint` objects.
