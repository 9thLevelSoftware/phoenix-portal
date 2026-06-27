# Review: Edge Functions - Billing (Paddle)

Scope reviewed:
- `supabase/functions/_shared/paddlePriceIds.ts`
- `supabase/functions/_shared/paddleSubscriptionState.ts`
- `supabase/functions/_shared/paddleSubscriptionUpdate.ts`
- `supabase/functions/_shared/paddleWebhookSecurity.ts`
- `supabase/functions/paddle-webhooks/index.ts`
- `supabase/functions/paddle-cancel-subscription/index.ts`
- `supabase/functions/paddle-checkout-custom-data/index.ts`
- `supabase/functions/paddle-refresh-subscription/index.ts`
- `supabase/functions/paddle-update-subscription/index.ts`

Summary:
- Findings: 18
- Severity breakdown: 0 critical, 3 high, 12 medium, 3 low
- Category breakdown: 5 bug, 0 stub, 4 error, 9 failure-point

## `supabase/functions/_shared/paddlePriceIds.ts`

### Finding 1
- Category: failure-point
- Severity: medium
- Line numbers: 73-94, 106-114
- Description: Price IDs are collected into independent tier sets and `mapPriceIdToTier` resolves duplicates by fixed precedence (`INFERNO` before `FLAME` before `EMBER`). A duplicated or copied-into-the-wrong-secret Paddle price ID will silently map customers to the wrong paid tier rather than failing configuration validation.
- Suggested fix direction: Validate the configured price IDs at cold start or before use: trim/dedupe globally, reject any price ID that appears in more than one tier, and log a fatal configuration error instead of silently choosing a tier by precedence.

## `supabase/functions/_shared/paddleSubscriptionState.ts`

### Finding 2
- Category: bug
- Severity: medium
- Line numbers: 13-18, 74, 77-90
- Description: Subscription state is derived only from `subscription.items?.[0]?.price?.id`. Paddle subscriptions can contain multiple items, and Paddle's update API requires callers to send the complete item list. If a non-plan item or add-on appears first, the upsert records the wrong `price_id`/tier or `null` even though the plan item is present elsewhere in the response.
- Suggested fix direction: Identify the base plan item explicitly, for example by matching all subscription items against the configured paid price ID allowlist and requiring exactly one recognized plan item. Reject or alert on zero/multiple plan items rather than relying on response ordering.

## `supabase/functions/_shared/paddleSubscriptionUpdate.ts`

### Finding 3
- Category: bug
- Severity: high
- Line numbers: 24-29
- Description: `buildPaddleSubscriptionPatch` sends `items: [{ price_id: newPriceId, quantity: 1 }]` for every plan switch. Paddle's update API treats the `items` array as the complete desired subscription item list, so omitted existing items are removed and any non-1 quantity is reset. If subscriptions ever include add-ons, metered items, or multiple quantities, a plan change will unintentionally drop or rewrite them.
- Suggested fix direction: Fetch or carry forward the current Paddle subscription items, replace only the base plan item, preserve unrelated items and quantities, and send the full intended item list. Add tests for a subscription with at least one add-on item.

### Finding 4
- Category: failure-point
- Severity: medium
- Line numbers: 18-21
- Description: The no-op/uncancel decision compares only the locally stored `currentPriceId` against the requested price. If the local `subscriptions.price_id` is stale, missing, or failed to update after a webhook/refresh problem, the function may call Paddle for a change that is already current or fail to take the intended `uncancel` path for a same-plan subscription with a scheduled cancellation.
- Suggested fix direction: For subscription updates, either refresh the current Paddle subscription before building the patch or treat the local price as a cache and reconcile after Paddle returns the authoritative subscription. Keep the same-plan uncancel case based on Paddle's current item state when possible.

## `supabase/functions/_shared/paddleWebhookSecurity.ts`

### Finding 5
- Category: bug
- Severity: medium
- Line numbers: 35-42
- Description: `classifyPaddleEventOrder` marks any distinct event with `incomingTime <= lastTime` as stale. Paddle may deliver multiple valid events for the same subscription with identical `occurred_at` timestamps, especially when events are only second-level distinct or generated in the same billing transition. A later distinct event at the same timestamp can therefore be acknowledged and dropped without updating local billing state.
- Suggested fix direction: Treat only `incomingTime < lastTime` as stale, or store/process a deterministic secondary ordering key. If equal timestamps must be suppressed, fetch the authoritative Paddle subscription state before acknowledging the event.

### Finding 6
- Category: failure-point
- Severity: low
- Line numbers: 48-67
- Description: The custom-data signature comparison iterates only over `Math.min(a.length, b.length)` and returns immediately after a length-dependent amount of work. Length is not secret, and the expected hex digest length is fixed, but malformed attacker-controlled signatures with different lengths still produce measurably different timing than same-length signatures.
- Suggested fix direction: Normalize by rejecting non-hex/non-64-character signatures before comparison, or compare against a fixed-length zero-padded buffer so every invalid signature follows the same amount of work.

## `supabase/functions/paddle-webhooks/index.ts`

### Finding 7
- Category: error
- Severity: high
- Line numbers: 207-211, 246-276
- Description: The existing subscription lookup ignores the `error` returned by `.maybeSingle()`. A database outage, duplicate-row error, schema drift, or service-role failure is treated as “no existing subscription,” disabling duplicate/stale event detection and rejecting legacy unsigned events for the wrong reason. A stale but validly signed event can then proceed to upsert because the previous `last_event_occurred_at` was not loaded.
- Suggested fix direction: Capture `{ data, error }`, log unexpected errors, and return a 500 so Paddle retries instead of processing with missing ordering/trust context. Only treat `data === null` as no existing subscription when the query succeeded.

### Finding 8
- Category: bug
- Severity: high
- Line numbers: 207-315
- Description: Webhook idempotency and ordering are implemented as a read-then-upsert sequence outside a transaction or conditional update. Concurrent deliveries can both read the same old `last_event_occurred_at`, both classify as accepted, and then commit out of order; the older event can overwrite the newer subscription state and `last_event_id`.
- Suggested fix direction: Move ordering into an atomic database operation, such as an RPC/upsert that updates only when `last_event_occurred_at IS NULL OR incoming_occurred_at > last_event_occurred_at`, or record events in a separate table with a unique event ID and process them serially per subscription/user.

### Finding 9
- Category: failure-point
- Severity: medium
- Line numbers: 189-220
- Description: `custom_data.user_id` is checked only for truthiness before being used in a Supabase equality filter and as the HMAC message. A malformed signed event with a non-string `user_id` can coerce to an unexpected string for signature verification or cause the database client to error in a path currently handled as a generic 500.
- Suggested fix direction: Require `typeof userId === "string"`, trim and validate it as the expected Supabase user ID format before querying or signing, and return a 400/401 billing alert for malformed custom data.

### Finding 10
- Category: error
- Severity: low
- Line numbers: 140-142, 333-338
- Description: `JSON.parse(rawBody)` is inside the broad handler `try`, so a signed but malformed JSON payload is returned as a 500 `Internal server error`. That classifies a client/payload problem as an infrastructure failure and can trigger retries/noisy alerts instead of a clear invalid-payload response.
- Suggested fix direction: Catch JSON parse errors separately after signature verification and return a 400 `Invalid JSON payload` with billing-alert logging. Keep 500 responses for database/configuration/server failures that Paddle should retry.

## `supabase/functions/paddle-cancel-subscription/index.ts`

### Finding 11
- Category: bug
- Severity: medium
- Line numbers: 54-81
- Description: Cancellation is allowed only for local statuses `active` and `trialing`. Paddle subscriptions in `past_due` or `paused` states can still need user-initiated cancellation, but this function returns “No active subscription found” before calling Paddle. Users with failed payments or paused subscriptions may be unable to cancel from the portal.
- Suggested fix direction: Align the allowed local statuses with Paddle's cancellable statuses, or call Paddle for any row with a `paddle_subscription_id` and translate Paddle's response if the subscription is not cancellable. Include `cancel_at_period_end` in the query so already-scheduled cancellations can return an idempotent success.

### Finding 12
- Category: failure-point
- Severity: medium
- Line numbers: 98-125
- Description: After Paddle successfully schedules cancellation, the function returns `{ success: true }` without persisting the returned subscription state. Until the webhook arrives, local `cancel_at_period_end` remains stale, and if the webhook is delayed or permanently failing the user sees an active non-canceling subscription even though Paddle has scheduled cancellation.
- Suggested fix direction: Parse the successful Paddle response, validate the returned subscription ID, and upsert the local subscription state using the shared Paddle state builder (or at least set `cancel_at_period_end: true` from `scheduled_change`) while still allowing the webhook to reconcile later.

### Finding 13
- Category: failure-point
- Severity: medium
- Line numbers: 110-118
- Description: Raw Paddle API error text is returned to the authenticated client in `details`. Paddle error bodies can include provider request IDs, object IDs, or operational details that are useful for logs but not necessary in client responses.
- Suggested fix direction: Log the full Paddle error server-side with request/user context, return a stable public error code/message to the client, and expose detailed diagnostics only through server logs or an internal support correlation ID.

## `supabase/functions/paddle-checkout-custom-data/index.ts`

### Finding 14
- Category: error
- Severity: low
- Line numbers: 38-51
- Description: Unlike the other browser-facing Paddle functions, this handler has no outer `try/catch`. Supabase auth client failures, environment edge cases, or crypto/HMAC failures will escape the handler, producing the platform default 500 response rather than a consistent JSON response with CORS headers.
- Suggested fix direction: Wrap the authenticated path in a `try/catch`, log unexpected errors, and return `{ error: "Internal server error" }` with the same CORS and JSON headers used elsewhere.

## `supabase/functions/paddle-refresh-subscription/index.ts`

### Finding 15
- Category: failure-point
- Severity: medium
- Line numbers: 248-282
- Description: When Paddle returns 404 for a stored subscription ID, the function marks the local row `canceled` but leaves `paddle_subscription_id` and `price_id` intact. Future diagnostics and reconciliation still point at a missing Paddle object, and stale price data remains attached to a terminal cancellation path.
- Suggested fix direction: Decide whether a 404 should clear provider identifiers/price data or move them to an audit/history field. At minimum, log the missing subscription ID and update enough local state to prevent future refresh/cancel/update paths from repeatedly targeting the same missing Paddle subscription.

### Finding 16
- Category: error
- Severity: medium
- Line numbers: 294-302, 358-363
- Description: The successful Paddle subscription response is parsed with `await paddleResponse.json()` outside a response-specific `try/catch`. If Paddle or an intermediary returns a 2xx non-JSON body, the broad catch maps it to a generic 500 instead of a 502 invalid-provider-response error, which makes provider response corruption look like an internal application failure.
- Suggested fix direction: Wrap provider JSON parsing separately, return a 502 `Invalid Paddle response`, and include the Paddle request/status metadata in server logs.

## `supabase/functions/paddle-update-subscription/index.ts`

### Finding 17
- Category: failure-point
- Severity: medium
- Line numbers: 212-220
- Description: Raw Paddle API error text is returned to the authenticated client in `details`. As with cancellation, provider error bodies may expose request IDs, object IDs, or operational details that should remain in server logs rather than the browser response.
- Suggested fix direction: Return a stable public error code/message and log the full Paddle error text server-side with a correlation ID.

### Finding 18
- Category: failure-point
- Severity: medium
- Line numbers: 277-284
- Description: The function immediately upserts the local subscription from the Paddle PATCH response, but the shared builder still derives `price_id` from `updatedSubscription.items?.[0]`. If Paddle's update response shape omits items, returns items in a different order, or includes add-ons before the plan item, the local row can be written with the correct `tier` passed in but an incorrect/null `price_id`, breaking future no-op and plan-change decisions.
- Suggested fix direction: Reuse the explicitly resolved `updatedPriceId` when building the upsert, or enhance the shared builder to resolve the configured plan item from the full item array. Add a regression test where the Paddle response contains multiple items or omits the price on the first item.
