# Billing Incident Response Runbook

> Last updated: 2026-09-20
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

### Find past_due rows Paddle's dunning should already have ended

`past_due` deliberately keeps a user entitled — the portal does not lock anyone
out mid-dunning. Paddle ends dunning within its own retry schedule, so a
`past_due` row whose period ended over a month ago means the closing event
never reached the portal.

```sql
-- Read-only. Expect zero rows.
SELECT user_id, tier, status, paddle_subscription_id,
       current_period_end, last_event_id, last_event_occurred_at, updated_at
FROM subscriptions
WHERE status = 'past_due'
  AND current_period_end < NOW() - INTERVAL '35 days'
ORDER BY current_period_end;
```

Any row here is a user still getting paid features for free. Do not edit the
row: check the subscription in Paddle, then have the user (or an authenticated
call on their behalf) hit `paddle-refresh-subscription`, which re-reads Paddle
and writes through the ordering guard. See §2's caution before reaching for
`UPDATE`.

---

## 2. Manually Fixing Subscription State

> Last verified against `8f7d3b8` (PR 44 `apply_subscription_event` guard +
> `subscriptions_paddle_subscription_id_key`; PR 45 ordered writers).

**Read this before running anything in this section.** Every code path that
writes `subscriptions` now goes through `public.apply_subscription_event`,
which (a) refuses a write that is not strictly newer than the stored
`last_event_occurred_at`, and (b) refuses a write whose
`paddle_subscription_id` differs from the stored non-null one unless the
incoming status would keep the user entitled. A hand-written `UPDATE` bypasses
both. Consequences to keep in mind:

- **Prefer `paddle-refresh-subscription`** over SQL. It re-reads Paddle and
  writes through the guard. SQL is for the cases refresh cannot reach.
- **A hand-edited row can be overwritten seconds later.** `last_event_id` /
  `last_event_occurred_at` are unchanged by these statements, so an in-flight
  Paddle redelivery still counts as newer and wins. If you need your value to
  stick, fix the state in Paddle too.
- **Never point a `paddle_subscription_id` at a different user's
  subscription.** `subscriptions_paddle_subscription_id_key` is a partial
  UNIQUE index over non-null ids, so a second user cannot hold the same id —
  the statement fails with `23505`. That is the index doing its job; see §10.
- **Clearing `paddle_subscription_id` is not a harmless reset.** It is how
  `paddle-refresh-subscription` records a subscription Paddle answers 404 for,
  and it is the only local link to the Paddle subscription: once it is NULL,
  nothing can cancel or refresh that subscription and the user may keep being
  billed. Confirm the subscription is really gone in Paddle first.

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
    last_event_occurred_at = NULL,
    updated_at = NOW()
WHERE user_id = '<uuid>';
```

`last_event_occurred_at` must be cleared **with** `last_event_id`, not instead
of it. `apply_subscription_event` only writes when the incoming
`occurred_at` is strictly greater than the stored one (or either is NULL), so a
row whose `last_event_id` was nulled but whose clock was left in place silently
rejects every replayed event that is older than that clock — the replay returns
200 and changes nothing. Clearing both makes the next event unconditional.

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

- The webhook handler skips an event whose `event_id` equals the stored `last_event_id` (duplicate), and `apply_subscription_event` refuses an event whose `occurred_at` is not newer than the stored `last_event_occurred_at` (stale). Both return 200 and change nothing.
- **Workaround:** If a replay is being skipped, clear **both** markers first. Clearing only `last_event_id` is not enough: the stored clock still rejects any replayed event older than it (see "Reset a stuck subscription row entirely" above).
  ```sql
  -- Clear the idempotency and ordering markers to allow reprocessing
  UPDATE subscriptions
  SET last_event_id = NULL,
      last_event_occurred_at = NULL
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

| Log message                                     | Meaning                                                          |
| ----------------------------------------------- | ---------------------------------------------------------------- |
| `[Paddle] Ignoring event with missing custom_data.user_id:` | Event carries no `user_id` in custom_data; acknowledged with 200 and ignored (no retry) |
| `[BILLING_ALERT] Malformed custom_data.user_id in Paddle event:` | `user_id` is present but not a UUID; answered 400 |
| `Error applying subscription event for <event_type>` | Database write failed (constraint violation, connection error) |
| `Paddle webhook handler error`                  | Unhandled exception (likely JSON parse failure or network issue) |
| `Unhandled event type: <type>`                  | Received a non-subscription event (normal, returns 200)          |

### `[BILLING_ALERT]` catalogue

> Last verified against `8f7d3b8` (PR 44 + PR 45).

Every alert in this section is logged verbatim with a `[BILLING_ALERT]` prefix,
so the whole channel is one grep. The four billing functions log separately:

```bash
for fn in paddle-webhooks paddle-refresh-subscription \
          paddle-update-subscription paddle-cancel-subscription; do
  echo "== $fn"
  supabase functions logs "$fn" --project-ref $SUPABASE_PROJECT_REF --limit 200 \
    | grep BILLING_ALERT
done
```

#### Double-subscription alerts (`paddle-webhooks`)

These fire when a Paddle customer holds more than one subscription but the
portal keeps a single row per user. Work them through §10.

| Alert string                                            | What happened                                                                                                                                                                                | What the operator does                                                                                                                                                                                          |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `[BILLING_ALERT] foreign_subscription_event_ignored:`   | An event arrived for a subscription id that is not the tracked one, and applying it would have cost the user their entitlement. It was ignored and audited as a `subscription_events` row with `operation='IGNORED'`, `note='untracked_subscription'`. | Nothing is broken — this is the guard working. But the customer has two subscriptions: go to §10 and decide which one they are keeping. The audit row carries the untracked id/status, and `row_snapshot` carries the tracked id/status. |
| `[BILLING_ALERT] switched_to_untracked_subscription:`   | The tracked subscription was cancelled while another of this customer's subscriptions was live **and proved ownership** (its `custom_data.user_id` is this user and its `cd_sig` verifies). The row now follows the live one. | Success, not a failure. Still go to §10: the customer is (or was) paying for two subscriptions and may be owed a refund on the cancelled one.                                                                        |
| `[BILLING_ALERT] untracked_subscription_not_adopted:`   | A live sibling was found but could not be adopted: its `custom_data.user_id` is someone else, or the `cd_sig` did not verify. The cancellation proceeds and the user drops to FREE.          | Check whether a real second subscription of theirs exists in Paddle (a shared Paddle customer is only an email match, so an unadoptable candidate may belong to a different person). If theirs, resolve via §10.     |
| `[BILLING_ALERT] Untracked live subscription has no usable price ID; not adopting it:` | The sibling's price is not in the `PADDLE_*_PRICE_IDS` env vars, so adopting it would put a paying user on FREE.                                                | Add the price id to that function's env and redeploy. Note that a plain refresh will **not** fix the user: the cancellation already applied, so the row points at the cancelled subscription and re-reading it changes nothing. The sibling is picked up by its own next Paddle event, or by a refresh against the sibling's transaction. Resolve via §10. |
| `[BILLING_ALERT] untracked_subscription_lookup_failed:` | Paddle could not be asked whether a live sibling exists (429/5xx/timeout). The handler returns 500 and **does not** apply the cancellation, so the user keeps access.                       | Self-healing: Paddle redelivers and the listing is retried. If it persists, check `PADDLE_API_KEY` is set in `paddle-webhooks`' secrets — this function did not call the Paddle API before PR 44, so the key may never have been set there. |
| `[BILLING_ALERT] switch_to_untracked_subscription_failed:` | The adoption write itself errored. The row is left **untouched** — still the (now cancelled in Paddle) tracked subscription, so the user keeps access rather than dropping to FREE.       | Self-healing: the 500 makes Paddle redeliver, `last_event_occurred_at` did not move, so the redelivery is accepted and the whole rescue runs again. Act only if it keeps firing across Paddle's retry window (§9) — then fix the DB error and run `paddle-refresh-subscription`. |

**Known silent case, no alert.** If the sibling's cancellation `occurred_at` is
*earlier* than the tracked subscription's, the adoption write comes back stale
and the row stays active on an already-cancelled subscription until its period
end. Nothing alerts. `paddle-refresh-subscription`, or the sibling's own next
Paddle event, corrects it. This follows from the `occurred_at` ordering rule and
is documented in the handler, not a defect introduced by the rescue.

#### Ordering- and binding-guard alerts (all four functions)

| Alert string                                              | What happened                                                                                                                                                                                                       | What the operator does                                                                                                                                             |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `[BILLING_ALERT] subscription_guard_rejected_write:`      | `apply_subscription_event` refused a write because the subscription id differed from the stored one and the incoming status would not keep the user entitled. From `paddle-webhooks` the line carries `path=direct`; from the other three it carries `source=refresh`, `source=update` or `source=cancel`. Each line also names `attempted_subscription_id` and `tracked_subscription_id`. | Same situation as `foreign_subscription_event_ignored`, reached by a different route: two subscription ids for one user. Go to §10. From `source=refresh`/`update` the caller is told (`applied:false`, `reason:'untracked_subscription'`) and the stored row is returned unchanged, so the UI is honest — no user-facing repair needed. |
| `[BILLING_ALERT] subscription_already_bound_to_another_user:` | The write hit `23505` on `subscriptions_paddle_subscription_id_key`: this Paddle subscription is already bound to a **different portal user**. The line carries `source=refresh\|update\|cancel` and the `paddle_subscription_id`. | **Needs a human decision — the system deliberately will not guess.** See §10 "One subscription, two claimants". From `refresh` and `update` the caller gets `409 {"code":"subscription_already_bound"}` and sees "This subscription is linked to a different account. Contact support." From `cancel` it is logged only: Paddle has already cancelled, and the call still reports success. |
| `[BILLING_ALERT] cancel_response_mismatch:`               | Paddle's `POST /subscriptions/{id}/cancel` did not return the cancelled subscription entity in `data` (or returned a different id), so there was no trustworthy post-cancel state to store. The cancellation itself succeeded; the local write was skipped. | Usually nothing: the `subscription.canceled` webhook reconciles the row within Paddle's delivery window. Confirm the row does flip to `canceled`. **If this fires on every cancel**, the assumption that Paddle returns the full entity is wrong for this account/API version — the cancel UI will silently stop updating until the webhook lands. A sandbox cancel settles it; that assumption was never confirmed against live Paddle. |
| `[BILLING_ALERT] Paddle update response subscription mismatch:` | `paddle-update-subscription` got back a subscription whose id is not the one it changed.                                                                                                                       | Same class as above: verify in Paddle, let the webhook reconcile.                                                                                                     |

#### Configuration and trust alerts

| Alert string                                                    | What happened                                                                                                                         | What the operator does                                                                                                 |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `[BILLING_ALERT] Unknown price ID <id> — preserving existing tier <tier>` (and the `during refresh` / `after update` variants) | A price id is not in the `PADDLE_*_PRICE_IDS` env vars. The existing tier is kept rather than dropping the user to FREE. | Add the price id to the env of **every** billing function and redeploy, then refresh the affected users.                     |
| `[BILLING_ALERT] Unknown price ID — no existing tier to preserve:` | Same, but there was no tier to fall back on, so the user lands on FREE while paying.                                                 | HIGH. Fix the env immediately, then run `paddle-refresh-subscription` for each affected user.                                 |
| `[BILLING_ALERT] Missing or invalid cd_sig in custom_data (user_id spoofing attempt?):` | An event's `custom_data.user_id` was not accompanied by a valid signature.                                       | Security signal. Investigate before touching data; do not hand-apply the event.                                              |
| `[BILLING_ALERT] Malformed custom_data.user_id in Paddle event:` | `custom_data.user_id` is not a UUID.                                                                                                 | A checkout flow is passing the wrong value. Find the caller.                                                                 |
| `[BILLING_ALERT] Missing or invalid Paddle occurred_at:`        | The event carries no usable ordering clock, so it cannot be ordered against the stored row.                                          | Rare; check the Paddle notification payload before replaying.                                                                |
| `[BILLING_ALERT] Webhook signature too old:`                    | Replay protection (signature age over 5 minutes).                                                                                     | Harmless in isolation. A burst means clock skew on the function host or a genuine replay attempt.                            |
| `[BILLING_ALERT] Failed to load existing subscription:`         | The pre-classification read of the `subscriptions` row failed, so the handler could not decide whether the event is foreign.          | Transport/DB error; Paddle redelivers.                                                                                       |
| `[BILLING_ALERT] Failed to record untracked_subscription note:` | The event was correctly ignored, but the `subscription_events` audit row could not be written.                                        | The ignore still happened; you have lost the §10 evidence for that one event. Work from Paddle's subscription list instead.  |
| `[BILLING_ALERT] Checkout signing subscription lookup failed:`  | `paddle-checkout-custom-data` could not read the user's subscription row while signing a checkout.                                    | Transient; the user can retry. Persistent means a DB problem.                                                                |
| `[BILLING_ALERT] Paddle transaction custom_data.user_id mismatch:` / `Invalid cd_sig on Paddle transaction:` | Someone tried to refresh against a transaction that does not prove it belongs to them.                       | Security signal, refused. No data action.                                                                                    |
| `[BILLING_ALERT] Paddle subscription not found (404), clearing provider identifiers:` | `paddle-refresh-subscription` asked Paddle for the stored subscription and got a 404, so it wrote a canceled/FREE row and cleared the ids. | Expected after a subscription is fully removed in Paddle. If the user says they are still paying, they have a *different* subscription — §10. |
| `[BILLING_ALERT] paddle_subscription_not_found; local row terminal, continuing` | Account deletion: Paddle 404s the stored id but the local row is already `canceled`/`expired`. The purge continues. | Nothing.                                                                                                                     |
| `[BILLING_ALERT] paddle_subscription_not_found; local row not terminal, aborting` | Account deletion: Paddle 404s a subscription the portal still considers live, so the purge **aborts** and the deletion request is parked `needs_support_reason = 'billing_subscription_not_found'`. | Reconcile the subscription with Paddle, then clear the reason — see operations.md §5, "Deletion alerts and the needs-support path". |

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

| Environment | Max retries | Window     | Distribution                                         |
| ----------- | ----------- | ---------- | ---------------------------------------------------- |
| Sandbox     | 3           | 15 minutes | Exponential backoff                                  |
| Live        | 60          | 3 days     | 20 attempts in first hour, 47 in first day, 60 total |

- Paddle expects an HTTP 200 response within **5 seconds**.
- Only **5xx responses** and **timeouts** trigger retries.
- **4xx responses** (400, 401, etc.) do NOT trigger retries.
- After all retry attempts are exhausted, the notification status is set to **failed**.
- Failed notifications can be manually replayed via the Paddle API or dashboard.

Sources:
- [Handle webhook delivery - Paddle Developer](https://developer.paddle.com/webhooks/respond-to-webhooks)
- [Webhooks overview - Paddle Developer](https://developer.paddle.com/webhooks/overview)
- [Simulate webhooks - Paddle Developer](https://developer.paddle.com/webhooks/test-webhooks)

---

## 10. One Customer, Two Subscriptions

> Last verified against `8f7d3b8` (PR 44 + PR 45).

The portal stores exactly one `subscriptions` row per user, but a Paddle
customer can hold several subscriptions — a customer is keyed by the email
typed into the checkout overlay, so a second purchase, a failed-then-retried
signup, or a family member using the same email all produce one.

### When you land here

Any of: `[BILLING_ALERT] foreign_subscription_event_ignored`,
`switched_to_untracked_subscription`, `untracked_subscription_not_adopted`,
`subscription_guard_rejected_write`, or a user reporting two charges.

### Gather the evidence

```sql
-- What the portal thinks.
SELECT user_id, tier, status, paddle_customer_id, paddle_subscription_id,
       price_id, current_period_end, cancel_at_period_end,
       last_event_id, last_event_occurred_at
FROM subscriptions WHERE user_id = '<uuid>';

-- Every event the guard ignored for this user, newest first. row_snapshot
-- carries what the tracked row looked like at the time.
SELECT event_recorded_at, operation, note, status,
       paddle_subscription_id AS untracked_id, last_event_id,
       last_event_occurred_at, row_snapshot
FROM subscription_events
WHERE user_id = '<uuid>' AND operation = 'IGNORED'
ORDER BY event_recorded_at DESC;
```

`subscription_events` is created only where it is absent
(`20260920000200`), and both the webhook and `apply_subscription_event` write
the `IGNORED` rows. If the query errors with "relation does not exist" you are
on a database without it — there is no audit trail to read, so work from
Paddle's subscription list below instead.

Then list the customer's subscriptions in **Paddle Dashboard > Customers >
(customer) > Subscriptions**, or:

```bash
curl -s "https://api.paddle.com/subscriptions?customer_id=<paddle_customer_id>" \
  -H "Authorization: Bearer ${PADDLE_API_KEY}"
```

### Decide, then act in Paddle first

1. Confirm with the user which subscription they intend to keep.
2. Cancel the other **in Paddle**, with a prorated refund if they were charged
   for overlapping periods (§4). Cancelling in Paddle is irreversible — the
   subscription cannot be restored, only replaced by a new checkout.
3. Have the user open the portal and hit Refresh (or make an authenticated call
   to `paddle-refresh-subscription` on their behalf). Do **not** hand-edit the
   row: refresh re-reads Paddle and writes through the ordering guard.
4. Verify the row now matches the kept subscription:

```sql
SELECT user_id, tier, status, paddle_subscription_id, price_id,
       current_period_end, last_event_occurred_at
FROM subscriptions WHERE user_id = '<uuid>';
```

### One subscription, two claimants

`[BILLING_ALERT] subscription_already_bound_to_another_user` is a different
problem: one Paddle subscription id is already bound to a **different portal
user**, and `subscriptions_paddle_subscription_id_key` refused to bind it
twice. `refresh` and `update` answer the caller `409
{"code":"subscription_already_bound"}`.

**Do not resolve this by picking a row.** Every billing function keys off the
stored `paddle_subscription_id`, so assigning it to the wrong account hands
that user cancel, refund and plan-change control over someone else's
subscription. The system refuses to guess on purpose; so should you.

Find both claimants:

```sql
SELECT user_id, tier, status, paddle_customer_id, paddle_subscription_id,
       current_period_end, updated_at
FROM subscriptions
WHERE paddle_subscription_id = '<sub_...>';
```

Establish the true owner from evidence outside the portal — Paddle's own
`custom_data.user_id` on the subscription, the billing email, the payment
method, the checkout that created it — and only then clear the id from the
losing row:

```sql
-- Only after the true owner is established. This removes the losing account's
-- only link to that subscription; it cannot be undone from the portal.
UPDATE subscriptions
SET paddle_subscription_id = NULL,
    tier = 'FREE',
    status = 'none',
    price_id = NULL,
    current_period_start = NULL,
    current_period_end = NULL,
    cancel_at_period_end = FALSE,
    last_event_id = NULL,
    last_event_occurred_at = NULL,
    updated_at = NOW()
WHERE user_id = '<losing uuid>';
```

Then run `paddle-refresh-subscription` for the true owner.

If the losing account had a real subscription of its own that the contested id
had overwritten, the statement above leaves them on FREE with no local link to
it. They need a refresh against their own subscription's transaction, or their
subscription's next Paddle event, before their access comes back — check
Paddle for a live subscription in their name before closing the case.

The same duplicate condition blocks migration `20260920004400` from applying:
it runs a pre-check and aborts, naming every subscription bound to more than
one user, rather than picking a winner. Run that check read-only before any
`supabase db push`:

```sql
SELECT s.paddle_subscription_id,
       string_agg(s.user_id::text, ', ' ORDER BY s.user_id) AS user_ids,
       count(*) AS bound_users
  FROM public.subscriptions s
 WHERE s.paddle_subscription_id IS NOT NULL
 GROUP BY s.paddle_subscription_id
HAVING count(*) > 1
 ORDER BY s.paddle_subscription_id;
```

### Known asymmetry between the webhook and refresh

`paddle-webhooks` pre-classifies every event with
`classifySubscriptionEventTarget`, which refuses to let a *second live*
subscription take over a row that is still entitled.
`paddle-refresh-subscription`'s transaction path does **not** run that check —
it relies on the SQL guard alone, and the SQL guard admits any write whose
status is `active`, `trialing` or `past_due`.

Consequence: a user who has just paid for a second subscription and then
refreshes against that transaction will have the new subscription adopted onto
a row that was still entitled to the old one. This is deliberate. The direction
the SQL guard admits can only ever *keep* a user entitled, never revoke, and
the alternative — refusing the adoption — would leave someone who just paid
looking at a stale subscription. The practical effect is that the old
subscription stops being tracked by the portal while still billing in Paddle,
which is exactly what §10 exists to clean up: if a user reports two charges,
check Paddle's subscription list, not just the portal row.
