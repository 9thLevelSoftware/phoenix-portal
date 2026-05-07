# Paddle Simulation Testing Guide

> Last updated: 2026-03-18
> Webhook handler: `supabase/functions/paddle-webhooks/index.ts`

## 1. Overview

Paddle Simulations let you fire synthetic webhook events at your endpoint without
creating real subscriptions or processing real payments. They live in the Paddle
dashboard under **Developer Tools > Simulations**.

### Why simulations instead of a full sandbox?

- **No checkout flow needed.** Simulations target the webhook handler directly,
  so you can test every subscription lifecycle event without walking through
  Paddle's checkout UI each time.
- **Controlled payloads.** You set exactly which fields appear in the event body,
  making it easy to reproduce edge cases (missing `custom_data`, unknown price
  IDs, duplicate `event_id` values).
- **Fast iteration.** Fire an event, check the Edge Function logs, query the DB,
  repeat. No waiting for Paddle to process a real transaction.

### What simulations do NOT cover

- **Checkout overlay.** The Paddle.js overlay (`openCheckout()` in
  `src/lib/paddle-client.ts`) is not exercised. Simulations skip signature
  generation, payment collection, and the redirect back to your success URL.
- **Signature verification.** Simulated events sent via the Paddle dashboard
  use Paddle's own signing infrastructure, so they do exercise HMAC verification.
  However, the payload content is synthetic -- it was never part of a real
  transaction.
- **Real Paddle state.** Simulated events do not create or modify actual
  subscriptions in Paddle. The `subscription_id` and `customer_id` values in
  the payload are fabricated and will not appear in the Paddle dashboard's
  subscription list.

---

## 2. Prerequisites

### Webhook destination configured for simulations

Your Paddle notification destination must have its **Usage** type set to
**Platform and simulation**. If it is set to "Platform" only, the destination
will reject simulated events.

To verify or change this:

1. Open the Paddle dashboard.
2. Navigate to **Developer Tools > Notifications**.
3. Click the destination pointing at your Supabase Edge Function URL.
4. Confirm the **Usage** field reads **Platform and simulation**.

### Edge Function deployed and reachable

The `paddle-webhooks` Edge Function must be deployed and its URL must match
the destination configured in Paddle. If you recently changed the function,
redeploy before running simulations:

```bash
supabase functions deploy paddle-webhooks --project-ref $SUPABASE_PROJECT_REF
```

### A real portal user UUID

Every simulation payload must include a `custom_data.user_id` value that
corresponds to a real row in the `auth.users` table. Without this, the webhook
handler returns HTTP 500 with `"Missing user_id in custom_data"` and the
subscription upsert is skipped entirely.

To find a test user's UUID:

```sql
SELECT id, email FROM auth.users WHERE email = 'your-test-user@example.com';
```

### Environment variables set on the Edge Function

The handler reads these secrets at runtime. Confirm they are set in the
Supabase dashboard under **Edge Functions > paddle-webhooks > Secrets**, or via
the CLI:

| Variable                   | Purpose                                                       |
| -------------------------- | ------------------------------------------------------------- |
| `PADDLE_WEBHOOK_SECRET`    | HMAC-SHA256 secret for signature verification                 |
| `PADDLE_EMBER_PRICE_IDS`   | Comma-separated Paddle price IDs that map to the EMBER tier   |
| `PADDLE_FLAME_PRICE_IDS`   | Comma-separated Paddle price IDs that map to the FLAME tier   |
| `PADDLE_INFERNO_PRICE_IDS` | Comma-separated Paddle price IDs that map to the INFERNO tier |

If a price ID in your simulation payload does not appear in any of these
variables, the handler maps it to `FREE` -- silently. See the troubleshooting
section for how to catch this.

---

## 3. How to Run a Simulation

### Step 1: Open the Simulations page

In the Paddle dashboard, navigate to **Developer Tools > Simulations**. Click
**New Simulation**.

### Step 2: Select the event type

Choose the Paddle event you want to simulate from the dropdown. The webhook
handler processes these subscription events:

- `subscription.created`
- `subscription.updated`
- `subscription.canceled`
- `subscription.paused`
- `subscription.resumed`
- `subscription.activated`

Any other event type (e.g., `transaction.completed`) is accepted with HTTP 200
but not processed -- the handler logs `Unhandled event type: <type>` and returns
early.

### Step 3: Configure the payload

Paddle pre-fills a template payload for the selected event type. You must
customize these fields to match your test scenario:

**Fields you must set:**

| Field path                 | What to enter                        | Why it matters                                                                           |
| -------------------------- | ------------------------------------ | ---------------------------------------------------------------------------------------- |
| `data.custom_data.user_id` | A real portal user UUID              | Links the subscription to a portal user. Without this, the handler returns 500.          |
| `data.items[0].price.id`   | A Paddle price ID from your env vars | Determines the tier (EMBER/FLAME/INFERNO). Use an ID from `PADDLE_EMBER_PRICE_IDS`, etc. |
| `data.status`              | The Paddle subscription status       | Maps to the portal status: `active`, `trialing`, `paused`, `canceled`, or `past_due`.    |

**Fields to set for specific scenarios:**

| Field path                              | When to set                               | Example value            |
| --------------------------------------- | ----------------------------------------- | ------------------------ |
| `data.scheduled_change.action`          | Cancel-at-period-end or pause scenarios   | `"cancel"` or `"pause"`  |
| `data.scheduled_change.effective_at`    | When the scheduled change takes effect    | `"2026-04-01T00:00:00Z"` |
| `data.current_billing_period.starts_at` | Any scenario where you need billing dates | `"2026-03-01T00:00:00Z"` |
| `data.current_billing_period.ends_at`   | Any scenario where you need billing dates | `"2026-04-01T00:00:00Z"` |
| `data.id`                               | Always (subscription ID)                  | `"sub_sim_01abc"`        |
| `data.customer_id`                      | Always (customer ID)                      | `"ctm_sim_01abc"`        |

**Tip:** Use a consistent `data.id` prefix like `sub_sim_` for simulated
subscriptions. This makes them easy to identify and clean up in the database.

### Step 4: Select the webhook destination

Choose the destination that points to your `paddle-webhooks` Edge Function.
Ensure it has "Platform and simulation" usage.

### Step 5: Send and verify

Click **Send**. Then check the results in three places:

1. **Paddle Simulations page** -- shows the HTTP status code returned by the
   Edge Function (expect 200).
2. **Supabase Edge Function logs** -- shows the handler's `console.log` and
   `console.error` output.
3. **Supabase database** -- query the `subscriptions` table to verify the
   upserted row.

---

## 4. Test Scenarios

Run these scenarios as a regression suite before releases that touch billing
code. Use a dedicated test user UUID for all scenarios, and run them in the
order listed (each scenario builds on the state left by the previous one).

### Scenario table

| #   | Scenario                      | Event Type                                            | Key Payload Fields                                                                    | Expected DB State                                                                    |
| --- | ----------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| 1   | New subscription (EMBER)      | `subscription.created`                                | `status: "active"`, `items[0].price.id: <EMBER price>`, `custom_data.user_id: <UUID>` | `tier=EMBER`, `status=active`, `cancel_at_period_end=false`                          |
| 2   | Upgrade to FLAME              | `subscription.updated`                                | `status: "active"`, `items[0].price.id: <FLAME price>`                                | `tier=FLAME`, `status=active`                                                        |
| 3   | Upgrade to INFERNO            | `subscription.updated`                                | `status: "active"`, `items[0].price.id: <INFERNO price>`                              | `tier=INFERNO`, `status=active`                                                      |
| 4   | Downgrade to EMBER            | `subscription.updated`                                | `status: "active"`, `items[0].price.id: <EMBER price>`                                | `tier=EMBER`, `status=active`                                                        |
| 5   | Cancel at period end          | `subscription.canceled`                               | `status: "canceled"`, `scheduled_change.action: "cancel"`                             | `status=canceled`, `cancel_at_period_end=true`                                       |
| 6   | Pause subscription            | `subscription.paused`                                 | `status: "paused"`                                                                    | `status=canceled` (mapped), `cancel_at_period_end=true`                              |
| 7   | Resume after pause            | `subscription.resumed`                                | `status: "active"`                                                                    | `status=active`, `cancel_at_period_end=false`                                        |
| 8   | Past due (payment failed)     | `subscription.updated`                                | `status: "past_due"`                                                                  | `status=past_due`                                                                    |
| 9   | Recovery from past due        | `subscription.updated`                                | `status: "active"`                                                                    | `status=active`                                                                      |
| 10  | Trial started                 | `subscription.created`                                | `status: "trialing"`, `items[0].price.id: <EMBER price>`                              | `tier=EMBER`, `status=trialing`                                                      |
| 11  | Trial converted               | `subscription.activated`                              | `status: "active"`                                                                    | `status=active`                                                                      |
| 12  | Duplicate event (idempotency) | Any (reuse exact `event_id` from a previous scenario) | Same payload as the previous run                                                      | HTTP 200 with `{ "received": true, "duplicate": true }`, DB unchanged                |
| 13  | Missing user_id               | `subscription.created`                                | `custom_data: {}` (no `user_id`)                                                      | HTTP 500 with `"Missing user_id in custom_data"`, no DB change                       |
| 14  | Unknown price ID              | `subscription.updated`                                | `items[0].price.id: "pri_does_not_exist"`                                             | `tier=FREE` (silent fallback -- see known issue 8.5 in billing-incident-response.md) |

### Detailed walkthrough: Scenario 1 (New subscription)

This example walks through the full process for a single scenario.

**Payload to configure in the Paddle Simulations UI:**

```json
{
  "event_id": "evt_sim_001",
  "event_type": "subscription.created",
  "occurred_at": "2026-03-18T12:00:00Z",
  "data": {
    "id": "sub_sim_test01",
    "customer_id": "ctm_sim_test01",
    "status": "active",
    "items": [
      {
        "price": {
          "id": "pri_YOUR_EMBER_MONTHLY_PRICE_ID"
        },
        "quantity": 1
      }
    ],
    "custom_data": {
      "user_id": "YOUR_TEST_USER_UUID"
    },
    "current_billing_period": {
      "starts_at": "2026-03-18T00:00:00Z",
      "ends_at": "2026-04-18T00:00:00Z"
    },
    "scheduled_change": null
  }
}
```

Replace `pri_YOUR_EMBER_MONTHLY_PRICE_ID` with an actual price ID from the
`PADDLE_EMBER_PRICE_IDS` environment variable, and `YOUR_TEST_USER_UUID` with a
real `auth.users.id` value.

**Expected result after sending:**

```sql
SELECT tier, status, paddle_subscription_id, paddle_customer_id,
       cancel_at_period_end, current_period_start, current_period_end,
       last_event_id
FROM subscriptions
WHERE user_id = 'YOUR_TEST_USER_UUID';
```

| Column                   | Expected value         |
| ------------------------ | ---------------------- |
| `tier`                   | `EMBER`                |
| `status`                 | `active`               |
| `paddle_subscription_id` | `sub_sim_test01`       |
| `paddle_customer_id`     | `ctm_sim_test01`       |
| `cancel_at_period_end`   | `false`                |
| `current_period_start`   | `2026-03-18T00:00:00Z` |
| `current_period_end`     | `2026-04-18T00:00:00Z` |
| `last_event_id`          | `evt_sim_001`          |

### Detailed walkthrough: Scenario 12 (Duplicate event / idempotency)

After running Scenario 1, send the **exact same payload** again with the same
`event_id` value (`evt_sim_001`).

**Expected behavior:**

- The handler finds an existing row where `last_event_id = 'evt_sim_001'`.
- It returns HTTP 200 with `{ "received": true, "duplicate": true }`.
- No database write occurs. The `updated_at` timestamp does not change.

**How to verify:**

```sql
SELECT last_event_id, updated_at
FROM subscriptions
WHERE user_id = 'YOUR_TEST_USER_UUID';
```

The `updated_at` value should be identical to what it was after Scenario 1.

---

## 5. Verifying Results

### Check Edge Function logs

**Via the Supabase dashboard:**

1. Navigate to **Edge Functions > paddle-webhooks**.
2. View the **Invocations** tab for recent calls and their HTTP status codes.
3. Click an invocation to see the `console.log` / `console.error` output.

**Via the Supabase CLI:**

```bash
# Tail live logs (useful while running simulations)
supabase functions logs paddle-webhooks --project-ref $SUPABASE_PROJECT_REF

# View the last 50 log entries
supabase functions logs paddle-webhooks --project-ref $SUPABASE_PROJECT_REF --limit 50
```

### Query the subscriptions table

After each simulation, verify the database state matches expectations:

```sql
SELECT user_id, tier, status, paddle_subscription_id, paddle_customer_id,
       price_id, cancel_at_period_end,
       current_period_start, current_period_end,
       last_event_id, updated_at
FROM subscriptions
WHERE user_id = 'YOUR_TEST_USER_UUID';
```

### Verify the portal UI

1. Log into the portal as the test user.
2. Navigate to any subscription-gated feature.
3. Confirm access matches the expected tier:
   - **Active paid tier:** Feature is accessible.
   - **Canceled / paused / past_due:** Feature shows the subscription gate
     (upsell prompt).
   - **FREE:** Feature shows the subscription gate.

Note: The portal uses TanStack Query to cache subscription data. If the UI
does not reflect the change immediately, the cache may be stale. Either wait
for the automatic refetch interval, or hard-refresh the browser
(`Ctrl+Shift+R`).

### Reset state between test runs

If you need a clean slate before re-running the full scenario suite, reset the
test user's subscription row:

```sql
UPDATE subscriptions
SET tier = 'FREE',
    status = 'none',
    paddle_customer_id = NULL,
    paddle_subscription_id = NULL,
    price_id = NULL,
    current_period_start = NULL,
    current_period_end = NULL,
    cancel_at_period_end = FALSE,
    last_event_id = NULL,
    updated_at = NOW()
WHERE user_id = 'YOUR_TEST_USER_UUID';
```

---

## 6. Troubleshooting

### Simulation returns HTTP 401 (signature error)

**Cause:** The `PADDLE_WEBHOOK_SECRET` set on the Edge Function does not match
the webhook secret associated with the notification destination in Paddle.

**Fix:**

1. Open Paddle dashboard > **Developer Tools > Notifications**.
2. Click the destination and copy its **Secret key**.
3. Set that value as `PADDLE_WEBHOOK_SECRET` in Supabase Edge Function secrets.
4. Redeploy or restart the Edge Function.

The webhook handler also rejects signatures older than 5 minutes (replay
protection). If you see `[BILLING_ALERT] Webhook signature too old` in the logs,
this is not a configuration issue -- it means the simulated event's timestamp
was too far in the past.

### Simulation returns HTTP 500 with "Missing user_id in custom_data"

**Cause:** The simulation payload does not include `data.custom_data.user_id`,
or `custom_data` is present but `user_id` is missing or empty.

**Fix:** Edit the simulation payload and add the `custom_data` block:

```json
"custom_data": {
  "user_id": "a-valid-uuid-from-auth-users"
}
```

### Event processed (HTTP 200) but DB row unchanged

**Cause 1: Idempotency guard.** The `last_event_id` in the database already
matches the `event_id` in the simulation payload. The handler returns
`{ "received": true, "duplicate": true }` and skips the upsert.

**Fix:** Use a unique `event_id` for each simulation, or clear the idempotency
marker first:

```sql
UPDATE subscriptions
SET last_event_id = NULL
WHERE user_id = 'YOUR_TEST_USER_UUID';
```

**Cause 2: Upsert succeeded but wrote the same values.** If the payload matches
the existing row, the upsert completes without visible change. Check `updated_at`
to confirm the row was touched.

### Tier is FREE even though a valid price ID was sent

**Cause:** The price ID in the simulation payload is not listed in the
`PADDLE_EMBER_PRICE_IDS`, `PADDLE_FLAME_PRICE_IDS`, or
`PADDLE_INFERNO_PRICE_IDS` environment variables on the Edge Function.

**Fix:** Verify the price ID you are sending matches one of the configured
values. Check for typos, extra whitespace, or a missing entry. The handler logs
`[BILLING_ALERT] Unknown price ID mapped to FREE tier` when this happens.

```bash
# Confirm which price IDs are configured
supabase secrets list --project-ref $SUPABASE_PROJECT_REF
```

### Destination not receiving simulated events

**Cause:** The notification destination's **Usage** type is set to "Platform"
instead of "Platform and simulation".

**Fix:**

1. Open Paddle dashboard > **Developer Tools > Notifications**.
2. Click the destination.
3. Change **Usage** to **Platform and simulation**.
4. Save and retry the simulation.

### Edge Function logs show no invocation at all

**Cause:** The destination URL may be wrong, or the Edge Function is not
deployed.

**Fix:**

1. Verify the destination URL matches the deployed Edge Function's public URL.
2. Redeploy the function: `supabase functions deploy paddle-webhooks --project-ref $SUPABASE_PROJECT_REF`
3. Test connectivity with a simple curl: `curl -X POST <function-url>` (expect
   HTTP 401, which confirms the function is reachable).

---

## 7. Reference: Status and Tier Mapping

These tables summarize how the webhook handler translates Paddle data into
portal database state. Refer to these when building simulation payloads.

### Paddle status to portal status

| Paddle `data.status` | Portal `status` column | Portal access tier |
| -------------------- | ---------------------- | ------------------ |
| `active`             | `active`               | Paid tier granted  |
| `trialing`           | `trialing`             | Paid tier granted  |
| `paused`             | `canceled`             | Falls back to FREE |
| `canceled`           | `canceled`             | Falls back to FREE |
| `past_due`           | `past_due`             | Falls back to FREE |

### Price ID to tier

| Environment variable       | Portal `tier` value |
| -------------------------- | ------------------- |
| `PADDLE_EMBER_PRICE_IDS`   | `EMBER`             |
| `PADDLE_FLAME_PRICE_IDS`   | `FLAME`             |
| `PADDLE_INFERNO_PRICE_IDS` | `INFERNO`           |
| No match                   | `FREE`              |

### Handled event types

| Paddle event type        | Typical scenario                                 |
| ------------------------ | ------------------------------------------------ |
| `subscription.created`   | User completes checkout for the first time       |
| `subscription.updated`   | Upgrade, downgrade, renewal, or payment failure  |
| `subscription.canceled`  | User cancels (may be scheduled for period end)   |
| `subscription.paused`    | Subscription paused (maps to canceled in portal) |
| `subscription.resumed`   | Subscription resumed after pause                 |
| `subscription.activated` | Trial converts to active (first real payment)    |

---

## Related Runbooks

- [Billing Incident Response](billing-incident-response.md) -- manual fixes,
  reconciliation, refunds, and escalation
