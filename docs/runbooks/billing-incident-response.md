# Billing Incident Response Runbook

> Last updated: 2026-03-18
> Webhook handler: `supabase/functions/paddle-webhooks/index.ts`

## 1. Identifying Affected Users

### Find users with unexpected subscription states

```sql
-- Users with non-standard statuses (not in the normal lifecycle)
SELECT user_id, tier, status, paddle_subscription_id, updated_at
FROM subscriptions
WHERE status NOT IN ('active', 'trialing', 'canceled', 'none')
   OR (status = 'active' AND paddle_subscription_id IS NULL);
```

### Find users whose tier doesn't match their status

```sql
-- Users paying for a tier but marked as canceled/none
SELECT user_id, tier, status, paddle_subscription_id, price_id, updated_at
FROM subscriptions
WHERE tier IN ('EMBER', 'FLAME', 'INFERNO')
  AND status NOT IN ('active', 'trialing');
```

### Find users with stale subscriptions (no update in 35+ days)

```sql
-- Active subscriptions that haven't been updated by any webhook recently.
-- Paddle sends subscription.updated on each renewal, so a 35-day gap
-- for a monthly subscription indicates missed webhooks.
SELECT user_id, tier, status, paddle_subscription_id,
       current_period_end, updated_at,
       NOW() - updated_at AS staleness
FROM subscriptions
WHERE status = 'active'
  AND updated_at < NOW() - INTERVAL '35 days'
ORDER BY updated_at ASC;
```

### Find users with expired billing periods still marked active

```sql
SELECT user_id, tier, status, current_period_end, updated_at
FROM subscriptions
WHERE status = 'active'
  AND current_period_end < NOW();
```

---

## 2. Manually Fixing Subscription State

### Force a user to a specific tier and status

```sql
-- CAUTION: Only use after confirming the correct state in Paddle dashboard.
-- Replace <uuid> with the actual user_id.
UPDATE subscriptions
SET tier = 'EMBER',
    status = 'active',
    cancel_at_period_end = FALSE,
    updated_at = NOW()
WHERE user_id = '<uuid>';
```

### Downgrade a user to FREE (e.g., after confirmed cancellation)

```sql
UPDATE subscriptions
SET tier = 'FREE',
    status = 'canceled',
    cancel_at_period_end = FALSE,
    updated_at = NOW()
WHERE user_id = '<uuid>';
```

### Reset a stuck subscription row entirely

```sql
-- Nuclear option: wipe the row back to a clean FREE state.
-- The next Paddle webhook will re-populate Paddle-specific fields.
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
WHERE user_id = '<uuid>';
```

### Insert a subscription row for a user who has none

```sql
-- If the user somehow has no row in subscriptions (e.g., signup predates
-- the table, or the row was accidentally deleted).
INSERT INTO subscriptions (user_id, tier, status, updated_at)
VALUES ('<uuid>', 'FREE', 'none', NOW())
ON CONFLICT (user_id) DO NOTHING;
```

---

## 3. Reconciling with Paddle

### Step-by-step reconciliation process

1. **Export portal subscription data:**
   ```sql
   SELECT user_id, tier, status, paddle_subscription_id, paddle_customer_id,
          price_id, current_period_start, current_period_end,
          cancel_at_period_end, last_event_id, updated_at
   FROM subscriptions
   WHERE paddle_subscription_id IS NOT NULL
   ORDER BY updated_at DESC;
   ```

2. **Open Paddle dashboard:** Navigate to **Subscriptions** in the left sidebar.

3. **Cross-reference each row:**
   - Match `paddle_subscription_id` in the portal against the Subscription ID in Paddle.
   - Verify the Paddle subscription status matches the portal `status` (accounting for the mapping: Paddle `paused` maps to portal `canceled`).
   - Verify the price/product matches the portal `tier`.
   - Verify `current_period_end` matches Paddle's next billing date.

4. **For mismatches:** Use the manual fix SQL above to correct the portal state, then trigger a webhook replay (see Section 5) to confirm the system processes it correctly.

### Bulk reconciliation query

```sql
-- Find subscriptions where the portal thinks the user is active but
-- the billing period has already ended (possible missed cancellation webhook).
SELECT user_id, paddle_subscription_id, status, tier,
       current_period_end,
       NOW() - current_period_end AS overdue_by
FROM subscriptions
WHERE status = 'active'
  AND current_period_end < NOW()
ORDER BY current_period_end ASC;
```

---

## 4. Issuing Refunds

### Via Paddle Dashboard (preferred)

1. Navigate to **Paddle Dashboard > Transactions**.
2. Search by customer email, Paddle customer ID, or transaction ID.
3. Click the transaction to open its detail view.
4. Click **Refund** and select either full or partial refund.
5. Add an internal note explaining the reason.
6. Confirm the refund.

### Via Paddle API

```bash
# Full refund for a specific transaction
curl -X POST "https://api.paddle.com/transactions/{transaction_id}/refund" \
  -H "Authorization: Bearer ${PADDLE_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"reason": "Billing error - portal state mismatch"}'
```

### After issuing a refund

- Paddle will fire `transaction.refunded` and potentially `subscription.canceled` webhooks.
- Verify the portal subscription state updates within a few minutes.
- If it does not update, check Edge Function logs (see Section 7) and manually fix state (see Section 2).

---

## 5. Emergency Webhook Replay

### Using Paddle Simulations

Paddle provides a webhook simulation feature for testing and recovery.

1. Navigate to **Paddle Dashboard > Developer Tools > Notifications**.
2. Find the failed notification by event type or date.
3. Click **Retry** to re-send the notification to your webhook endpoint.

### Using the Paddle API to replay a notification

```bash
# Replay a specific notification by its ID
curl -X POST "https://api.paddle.com/notifications/{notification_id}/replay" \
  -H "Authorization: Bearer ${PADDLE_API_KEY}"
```

### Using Paddle Simulations for specific event types

1. Navigate to **Paddle Dashboard > Developer Tools > Simulations**.
2. Create a new simulation for the desired event type (e.g., `subscription.updated`).
3. Configure the payload to match the affected subscription.
4. Run the simulation.

### Important notes on replay

- The webhook handler uses `last_event_id` for idempotency. If the original event was partially processed (idempotency check passed but upsert failed), a replay with the same `event_id` will be skipped.
- **Workaround:** If a replay is being skipped due to idempotency, first clear the `last_event_id` in the database:
  ```sql
  -- Clear idempotency marker to allow reprocessing
  UPDATE subscriptions
  SET last_event_id = NULL
  WHERE user_id = '<uuid>';
  ```
- Then retry the webhook replay.

---

## 6. Escalation Path

### Handle internally (Tier 1)

- Single user with mismatched subscription state
- Webhook processing error visible in Edge Function logs
- User reports wrong tier but Paddle dashboard shows correct state
- **Action:** Fix with SQL (Section 2), replay webhook if needed (Section 5)

### Handle internally with monitoring (Tier 2)

- Multiple users affected by the same issue
- Webhook endpoint returning 500 errors consistently
- Price ID mapping returning "FREE" for valid subscriptions
- **Action:** Fix the root cause in code, deploy, replay affected webhooks, monitor for recurrence

### Contact Paddle Support (Tier 3)

- Webhooks are not being delivered at all (no requests hitting the endpoint)
- Signature verification is failing on all webhooks (possible secret rotation)
- Paddle dashboard shows subscription states that don't match any webhook events received
- Transaction or refund API calls are failing
- **Action:** File a support ticket at [Paddle Support](https://www.paddle.com/support) with:
  - Affected subscription IDs
  - Timeframe of the issue
  - Edge Function logs showing the error
  - Expected vs actual behavior

### Emergency (Tier 4)

- All users losing paid access simultaneously
- Webhook secret compromised (unauthorized webhook calls)
- **Action:**
  1. Rotate the `PADDLE_WEBHOOK_SECRET` environment variable immediately.
  2. Update the webhook secret in **Paddle Dashboard > Developer Tools > Notifications**.
  3. Bulk-fix affected users with SQL.
  4. Contact Paddle support for a full webhook replay of the affected time window.

---

## 7. Checking Edge Function Logs

### Via Supabase Dashboard

1. Navigate to **Supabase Dashboard > Edge Functions > paddle-webhooks**.
2. View recent invocations and their HTTP status codes.
3. Click individual invocations to see `console.log` and `console.error` output.

### Via Supabase CLI

```bash
# Tail live logs
supabase functions logs paddle-webhooks --project-ref $SUPABASE_PROJECT_REF

# View recent logs
supabase functions logs paddle-webhooks --project-ref $SUPABASE_PROJECT_REF --limit 100
```

### Key log messages to search for

| Log message | Meaning |
|---|---|
| `Missing custom_data.user_id in Paddle event` | Checkout was created without passing `user_id` in custom_data |
| `Error upserting subscription for <event_type>` | Database write failed (constraint violation, connection error) |
| `Paddle webhook handler error` | Unhandled exception (likely JSON parse failure or network issue) |
| `Unhandled event type: <type>` | Received a non-subscription event (normal, returns 200) |

---

## 8. Known Failure Modes (from Error Recovery Analysis)

### 8.1 Upsert failure (500 response)

- **What happens:** Paddle receives HTTP 500 and retries with exponential backoff (up to 60 retries over 3 days on live, 3 retries over 15 minutes on sandbox).
- **Is retry safe?** Yes, the retry is idempotent in the success path. However, see 8.2 for a subtle gap.

### 8.2 Race condition between idempotency check and upsert

- **Gap:** Lines 196-207 perform a SELECT to check `last_event_id`. Lines 237-239 perform the upsert that writes `last_event_id`. If the first attempt passes the idempotency check, then the upsert fails, the `last_event_id` was never written. On retry, the same event passes the idempotency check again and the upsert is re-attempted. **This is actually safe** -- the check-then-write gap works correctly because a failed upsert means `last_event_id` was not updated, so the retry correctly re-attempts the full operation.
- **True risk:** If two different events for the same user arrive nearly simultaneously, both could pass the idempotency check (since they have different `event_id` values), and the second upsert could overwrite the first with stale data. This is a **last-write-wins** scenario with no event ordering guarantee.
- **Mitigation:** Paddle generally delivers events in order, but under retry conditions ordering is not guaranteed. Consider adding an `occurred_at` timestamp comparison to prevent older events from overwriting newer state.

### 8.3 JSON.parse failure (line 157)

- **What happens:** Falls into the outer catch block (line 253), returns 500.
- **When:** Paddle sends a malformed body, or network truncation corrupts the payload.
- **Consequence:** Paddle retries. Since the issue is in the payload, retries will succeed if the corruption was transient, or keep failing if Paddle is sending bad data.
- **Severity:** Low. Paddle payloads are well-formed in practice.

### 8.4 Missing custom_data.user_id (lines 186-193)

- **What happens:** Returns 400.
- **When:** Checkout session was created without passing `customData: { user_id }` in the client-side Paddle.Checkout.open() call.
- **Consequence:** Paddle does NOT retry on 400 responses (only 5xx triggers retry). The subscription is created in Paddle but never reflected in the portal. The user pays but gets no access.
- **Severity:** HIGH. This is a data loss scenario with no automatic recovery.
- **Mitigation:** Verify all checkout flows pass `user_id` in custom_data. Add an alert on this log message. Consider a reconciliation cron job that queries Paddle API for subscriptions missing from the portal.

### 8.5 Price ID maps to "FREE" (line 92)

- **What happens:** The subscription is upserted with `tier = 'FREE'` even though the user is paying.
- **When:** A new price ID is created in Paddle but the `PADDLE_INFERNO_PRICE_IDS`, `PADDLE_FLAME_PRICE_IDS`, or `PADDLE_EMBER_PRICE_IDS` environment variables were not updated.
- **Consequence:** User pays but gets FREE tier access. No error is logged -- this is a silent failure.
- **Severity:** HIGH. Silent data corruption.
- **Mitigation:** Add a warning log when `mapPriceIdToTier` returns "FREE" for a subscription event (subscription events should always have a paid tier). Add monitoring/alerting on subscriptions where `tier = 'FREE'` but `paddle_subscription_id IS NOT NULL`.

---

## 9. Paddle Webhook Retry Policy Reference

| Environment | Max retries | Window | Distribution |
|---|---|---|---|
| Sandbox | 3 | 15 minutes | Exponential backoff |
| Live | 60 | 3 days | 20 attempts in first hour, 47 in first day, 60 total |

- Paddle expects an HTTP 200 response within **5 seconds**.
- Only **5xx responses** and **timeouts** trigger retries.
- **4xx responses** (400, 401, etc.) do NOT trigger retries.
- After all retry attempts are exhausted, the notification status is set to **failed**.
- Failed notifications can be manually replayed via the Paddle API or dashboard.

Sources:
- [Handle webhook delivery - Paddle Developer](https://developer.paddle.com/webhooks/respond-to-webhooks)
- [Webhooks overview - Paddle Developer](https://developer.paddle.com/webhooks/overview)
- [Simulate webhooks - Paddle Developer](https://developer.paddle.com/webhooks/test-webhooks)
