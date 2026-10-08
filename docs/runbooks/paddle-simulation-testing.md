# Paddle Simulation Testing Guide

> Last updated: 2026-10-06
> Webhook handler: `supabase/functions/paddle-webhooks/index.ts`
> Gateway: `[functions.paddle-webhooks]` in `supabase/config.toml` has `verify_jwt = false`. The handler authenticates the raw body with the `Paddle-Signature` header.

## 1. Overview

Paddle Simulations send a synthetic notification to a notification destination. In the Paddle dashboard they live under **Developer Tools > Simulations**.

A simulation sent through a destination is signed by Paddle, so it exercises the handler's HMAC check. The body is whatever you put in the simulation. It does not create or update a subscription in Paddle, and the `id` / `customer_id` values in the body are the ones you typed.

That last point matters for `canceled` and `paused` payloads. When the mapped portal status is `canceled` and both `data.id` and `data.customer_id` are strings, the handler asks the Paddle API whether that customer has another live subscription before it writes. A fabricated customer still produces that HTTP call. See [Canceled and paused payloads](#canceled-and-paused-payloads).

Simulations do not open the Paddle.js checkout overlay (`openCheckout()` in `src/lib/paddle-client.ts`). They do not collect a payment or redirect to a success URL.

The handler writes a subscription only through `public.apply_subscription_event`. Transaction events are acknowledged and do not touch `subscriptions`.

---

## 2. Prerequisites

Run this suite against the Paddle **sandbox** and a non-production Supabase project. Every scenario writes `public.subscriptions` through the deployed function, and computing `cd_sig` puts `PADDLE_CUSTOM_DATA_SECRET` on your machine; anyone holding that secret can bind a payment to any user id. Never export the production custom-data secret. If production is unavoidable, use only the dedicated test user below.

### Notification destination accepts simulations

The destination's **Usage** must be **Platform and simulation**. A destination set to **Platform** does not receive simulated events.

1. Open the Paddle dashboard.
2. Go to **Developer Tools > Notifications**.
3. Open the destination whose URL is the deployed `paddle-webhooks` function.
4. Confirm **Usage** is **Platform and simulation**.

### Function deployed

Redeploy after a handler change before trusting a simulation. Deploy by hand only to a sandbox or preview project; production deploys go through `deploy-edge-functions.yml`, which runs the Edge tests and the prod-migration gate first:

```bash
npm run supabase -- functions deploy paddle-webhooks --project-ref "$SUPABASE_PROJECT_REF"
```

### A real portal user UUID

Subscription events bind `data.custom_data.user_id` to `auth.users.id`. The value must match this pattern (case-insensitive):

```text
^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$
```

```sql
SELECT id, email FROM auth.users WHERE email = 'your-test-user@example.com';
```

Use a dedicated test user for the suite in [section 5](#5-test-scenarios). The reset statement there clears ordering clocks, which on a real subscriber lets an older payload overwrite the current tier and status.

### `cd_sig` for that user

`paddle-checkout-custom-data` signs checkout `custom_data` as the hex HMAC-SHA256 of the user id, keyed with `PADDLE_CUSTOM_DATA_SECRET` after trimming surrounding whitespace. `paddle-webhooks` and `paddle-refresh-subscription` verify that digest with the same trimmed secret (`verifyPaddleCustomDataSignature` in `supabase/functions/_shared/paddleWebhookSecurity.ts`).

Put that hex digest on `data.custom_data.cd_sig`. A simulation Paddle signs does not add `cd_sig` for you.

```bash
# Writes the hex digest only. Do not commit the secret or the digest.
SIM_USER_ID='YOUR_TEST_USER_UUID' node --input-type=module -e '
import { createHmac } from "node:crypto";
const secret = (process.env.PADDLE_CUSTOM_DATA_SECRET ?? "").trim();
const userId = process.env.SIM_USER_ID ?? "";
if (!secret || !userId) process.exit(1);
process.stdout.write(createHmac("sha256", secret).update(userId).digest("hex") + "\n");
'
```

Trust rules, after the user id has been accepted as a UUID:

| `cd_sig` | Stored `paddle_subscription_id` | Result |
| --- | --- | --- |
| Valid HMAC of this `user_id` | Any, including no row | Event is trusted (`method: signature`) |
| Missing or not the HMAC | Equals `data.id` | Event is trusted (`method: legacy_subscription_match`). Log: `[Paddle] Accepted legacy unsigned event <event_id> by stored subscription match` |
| Missing or not the HMAC | Absent, or different from `data.id` | HTTP 401 `{ "error": "Invalid cd_sig" }`. Log: `[BILLING_ALERT] Missing or invalid cd_sig in custom_data (user_id spoofing attempt?):` |

The first simulation for a user with no row, and any simulation whose `data.id` is not the stored subscription id, needs a valid `cd_sig`.

### Edge Function secrets

The handler reads these at request time. Set them on the `paddle-webhooks` function.

| Variable | Role |
| --- | --- |
| `PADDLE_WEBHOOK_SECRET` | HMAC key for `Paddle-Signature`. Trimmed. Whitespace-only is treated as unset. |
| `PADDLE_CUSTOM_DATA_SECRET` | HMAC key for `cd_sig`. Required. Trimmed before verify. |
| `PADDLE_EMBER_PRICE_IDS` | Comma-separated Ember price ids. |
| `PADDLE_FLAME_PRICE_IDS` | Comma-separated Flame price ids. |
| `PADDLE_INFERNO_PRICE_IDS` | Comma-separated Inferno price ids. |
| `PADDLE_EMBER_MONTHLY_PRICE_ID`, `PADDLE_EMBER_ANNUAL_PRICE_ID` | Single Ember ids, unioned into the Ember set. |
| `PADDLE_FLAME_MONTHLY_PRICE_ID`, `PADDLE_FLAME_ANNUAL_PRICE_ID` | Single Flame ids, unioned into the Flame set. |
| `PADDLE_INFERNO_MONTHLY_PRICE_ID`, `PADDLE_INFERNO_ANNUAL_PRICE_ID` | Single Inferno ids, unioned into the Inferno set. |
| `PADDLE_API_KEY` | Bearer token for the live-subscription listing. Used only when a write's mapped status is `canceled`. |
| `PADDLE_ENVIRONMENT` | The exact value `sandbox` selects `https://sandbox-api.paddle.com`. Any other value, including unset, selects `https://api.paddle.com`. |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Service-role client that calls `apply_subscription_event`. |

`mapPriceIdToTier` (`supabase/functions/_shared/paddlePriceIds.ts`) checks Inferno, then Flame, then Ember. The handler does not use that precedence for an id listed under two tiers: it returns HTTP 500 `{ "error": "Billing configuration invalid" }` before reading the body, and the log names the duplicated ids.

HTTP 500 `{ "error": "Billing configuration incomplete" }` is returned when the union of those price-id variables is empty. The log line is `[FATAL] PADDLE_EMBER_PRICE_IDS, PADDLE_FLAME_PRICE_IDS, and PADDLE_INFERNO_PRICE_IDS must all be set`. One configured paid id is enough to pass. A missing `PADDLE_CUSTOM_DATA_SECRET` returns HTTP 500 `{ "error": "Billing custom_data signing is not configured" }`.

These three configuration responses are sent before the signature check.

---

## 3. Processing order

Every check below is implemented in `paddleWebhooksHandler`. Status codes are the ones the handler returns.

1. **Method.** Anything other than `POST` is HTTP 405 `{ "error": "Method not allowed" }`.
2. **Billing configuration.** The three HTTP 500 bodies in the secrets section above. No signature check yet.
3. **Signature.** Header name: `Paddle-Signature`. Form: `ts=<unix seconds>;h1=<hex>`, with one `h1` per active secret during a rotation. The HMAC-SHA256 payload is `ts + ":" + rawBody`, keyed with the trimmed `PADDLE_WEBHOOK_SECRET`. `ts` must be all digits. Its age must be within **300 seconds** of the function clock in either direction (`PADDLE_SIGNATURE_TOLERANCE_SECONDS`).
   - Missing secret or missing header: HTTP 401 `{ "error": "Unauthorized" }`.
   - Malformed header, wrong HMAC, or timestamp outside the window: HTTP 401 `{ "error": "Invalid signature" }`. A timestamp outside the window logs `[BILLING_ALERT] Webhook signature too old:` and the absolute age in seconds. Header values are not logged.
4. **JSON.** `JSON.parse` runs on the raw body after the signature check. A throw logs `Paddle webhook handler error:` and returns HTTP 500 `{ "error": "Internal server error" }`.
5. **Envelope.** Missing `event_id`, `event_type`, or `data` (each must be truthy): HTTP 400 `{ "error": "Invalid event payload" }`.
6. **Event type.** See the table below.
7. **User id** (subscription events only). `paddleWebhookResponseForCustomUserId`.
8. **Load `subscriptions` for that user.** A read error is HTTP 500 `{ "error": "Failed to load subscription state" }`. The handler does not treat a failed read as "no row".
9. **`cd_sig` trust.** See the table in Prerequisites.
10. **Ordering.** `classifyPaddleEventOrder`, against `last_event_id` and `last_event_occurred_at`.
11. **Which subscription may write the row.** `classifySubscriptionEventTarget`.
12. **Price and tier**, then **`apply_subscription_event`**. A mapped status of `canceled` may list other live subscriptions first.

`data.status` decides the stored status, the period columns, and `cancel_at_period_end`. The event name only chooses the branch in step 6. A `subscription.past_due` notification whose `data.status` is `active` is stored as `active`.

### Event types

| `event_type` | What the handler does |
| --- | --- |
| `subscription.created` | Subscription path (steps 7–12) |
| `subscription.updated` | Subscription path |
| `subscription.canceled` | Subscription path |
| `subscription.paused` | Subscription path |
| `subscription.resumed` | Subscription path |
| `subscription.activated` | Subscription path |
| `subscription.past_due` | Subscription path |
| `subscription.trialing` | Subscription path |
| `transaction.completed` | HTTP 200 `{ "received": true }`. Log: `[Paddle] Acknowledged transaction.completed event_id=<id>`. No user-id check and no database write. |
| `transaction.payment_failed` | Same acknowledgement, with that event type in the log. No database write. |
| Anything else | HTTP 200 `{ "received": true }`. Warn: `[Paddle] Unhandled event type: <type>`. No database write. |

Transaction and unhandled branches still require a signature-valid envelope (`event_id`, `event_type`, `data`).

### User id

| `data.custom_data.user_id` | Response | Database |
| --- | --- | --- |
| Absent, not a string, or `""` | HTTP 200 `{ "ignored": true }` | No read and no write. Warn: `[Paddle] Ignoring event with missing custom_data.user_id:` plus `event_id` and `event_type`. Paddle will not retry a 200. |
| Non-empty and not a UUID | HTTP 400 `{ "error": "Invalid user_id in custom_data" }` | No read and no write. `[BILLING_ALERT] Malformed custom_data.user_id in Paddle event:` |

### Ordering

The clock is the notification's `occurred_at`. `data.updated_at` is not read on this path.

| Result | When | Response |
| --- | --- | --- |
| duplicate | `event_id` equals the stored `last_event_id`. Checked before `occurred_at` is parsed, so this wins even when `occurred_at` is missing or older. | HTTP 200 `{ "received": true, "duplicate": true }`. No write. `updated_at` stays put. |
| invalid | Not a duplicate, and `occurred_at` is missing or `Date.parse` fails | HTTP 400 `{ "error": "Invalid occurred_at" }`. `[BILLING_ALERT] Missing or invalid Paddle occurred_at:` |
| stale | Parsed `occurred_at` is earlier than or equal to stored `last_event_occurred_at` | HTTP 200 `{ "received": true, "stale": true }`. Warn names both clocks. No write. |
| accept | No stored clock, or `occurred_at` is strictly later | Handler continues |

A successful write stores that `occurred_at` on `last_event_occurred_at` and the `event_id` on `last_event_id`, in the same `apply_subscription_event` statement as the tier and status. The next simulation needs a new `event_id` and a strictly later `occurred_at`.

If the RPC returns `false` because a newer clock won the update, the handler responds HTTP 200 `{ "received": true, "stale": true }` and warns `Skipped stale event <event_id> at write time (lost ordering race)`.

### Which subscription id may write

The portal keeps one `subscriptions` row per user. `classifySubscriptionEventTarget` compares `data.id` with the stored `paddle_subscription_id`.

| Situation | Result |
| --- | --- |
| No stored subscription id, empty `data.id`, or the two ids are equal | The event may write the row |
| Ids differ, and the mapped status is not `active`, `trialing`, or `past_due` | HTTP 200 `{ "received": true, "ignored": "untracked_subscription" }`. The row is not updated. |
| Ids differ, mapped status is `active`, `trialing`, or `past_due`, and the stored row is still entitled | Same ignore response. The row is not updated. |
| Ids differ, mapped status is `active`, `trialing`, or `past_due`, and the stored row is not entitled | The event may write the row (the new subscription replaces the stored one) |

An ignore also inserts `subscription_events` with `operation = 'IGNORED'` and `note = 'untracked_subscription'`. `paddle_subscription_id` on that audit row is the untracked id. `row_snapshot` carries `tracked_subscription_id`, `tracked_status`, and `event_type`. The log is `[BILLING_ALERT] foreign_subscription_event_ignored:`. A failed audit insert is logged (`[BILLING_ALERT] Failed to record untracked_subscription note:`) and the HTTP response is still the ignore.

Entitled, for this decision, means `isSubscriptionEntitled`: `past_due` is entitled; `active` is entitled until `current_period_end` plus 48 hours, or until `current_period_end` when `cancel_at_period_end` is set; `trialing` is entitled until `current_period_end`.

### Price id and tier

`resolveBasePlanPriceId` walks `data.items`. The first `price.id` that is in the configured paid set is the price used for the tier. When none match, the tier is decided from the first item's `price.id`. When that is also missing, the tier input is `""`.

On a direct write the handler does not pass that resolved id into `buildSubscriptionUpsertFromPaddleState`. The `price_id` column is `data.items[0].price.id`, or null when the first item has no price id. With a single item, the column and the tier input are the same id. A leading item that is not in the paid set can store that item's id (or null) while `tier` still comes from a later allowlisted item. The sibling-adoption write does pass the resolved sibling price id, so the column matches the adopted plan.

| Price id used for the tier | Stored tier | Response and row |
| --- | --- | --- |
| In the Inferno, Flame, or Ember set | Whatever is stored | Tier is that set's tier. Write continues. `price_id` is the first item's price id. |
| Non-empty, not in any set | `EMBER`, `FLAME`, or `INFERNO` | HTTP 200 and the write keeps the stored tier. `price_id` is the first item's price id, which is the unknown id when that id sits on item 0. Warn: `[BILLING_ALERT] Unknown price ID <id> — preserving existing tier <tier>` |
| Non-empty, not in any set | No row, or tier null / `FREE` / `free` | HTTP 500 `{ "error": "Unknown price_id — configuration error" }`. No RPC. Log: `[BILLING_ALERT] Unknown price ID — no existing tier to preserve (check PADDLE_* price envs):` |
| Empty (no items, or no `price.id` on the fallback item) | Any | HTTP 200. The write sets `tier` to `FREE` and `price_id` to null. This path does not log `[BILLING_ALERT]`. |

### Canceled and paused payloads

`mapPaddleStatusToSubscriptionStatus` maps Paddle `paused` and `canceled` both to portal `canceled`. For a portal status of `canceled`, `buildSubscriptionUpsertFromPaddleState` stores `current_period_start` and `current_period_end` as null, and `cancel_at_period_end` as false. `scheduled_change` does not keep the flag once the mapped status is `canceled`.

`cancel_at_period_end` is true only when the mapped status is `active` or `trialing` and `data.scheduled_change.action` is `cancel` or `pause`. Send that as `subscription.updated` (or `subscription.created`) with `data.status` still `active` or `trialing`.

Before applying a `canceled` portal status, when `data.id` and `data.customer_id` are both strings, the handler `GET`s:

```text
{base}/subscriptions?customer_id={customer_id}&status=active,trialing,past_due&order_by=-created_at
```

`{base}` is `https://sandbox-api.paddle.com` when `PADDLE_ENVIRONMENT` is exactly `sandbox`, and `https://api.paddle.com` otherwise. The call uses `Authorization: Bearer <PADDLE_API_KEY>` and aborts after 10 seconds.

| Listing result | Handler result |
| --- | --- |
| `PADDLE_API_KEY` unset, non-OK HTTP, timeout, or a body that is not JSON | HTTP 500 `{ "error": "Could not check for a live subscription" }`. The row is unchanged. Log: `[BILLING_ALERT] untracked_subscription_lookup_failed:`. A missing key also warns `[Paddle] PADDLE_API_KEY is not set — cannot look for an untracked subscription`. |
| HTTP 200 and no adoptable sibling | The canceled row is written. HTTP 200 `{ "received": true }`. |
| HTTP 200 and a sibling whose `custom_data.user_id` is this user, whose `cd_sig` verifies, and whose price maps to a paid tier | The row switches to that sibling. The cancellation is not what gets stored. HTTP 200 `{ "received": true, "switchedToUntrackedSubscription": true }`. Log: `[BILLING_ALERT] switched_to_untracked_subscription:`. |

A sibling is skipped when its `user_id` or `cd_sig` does not prove this user (`[BILLING_ALERT] untracked_subscription_not_adopted:`) or when its price is missing or maps to `FREE` (`[BILLING_ALERT] Untracked live subscription has no usable price ID; not adopting it:`). The handler then tries the next listed subscription. When none is adopted, the canceled row is written.

Confirm the listing before a pause or full-cancel scenario. A non-200 from this call means the scenario will not change the row. `PADDLE_BASE` is `https://sandbox-api.paddle.com` when `PADDLE_ENVIRONMENT` is exactly `sandbox`, and `https://api.paddle.com` otherwise.

```bash
curl -sS -D - \
  "${PADDLE_BASE}/subscriptions?customer_id=${CUSTOMER_ID}&status=active,trialing,past_due&order_by=-created_at" \
  -H "Authorization: Bearer ${PADDLE_API_KEY}"
```

A payload with no string `customer_id` skips the listing and writes the canceled row directly.

### Successful write

HTTP 200 `{ "received": true }`.

Log: `[Paddle] Successfully processed <event_type> for user <user_id>, paddle_customer_id: <customer_id>`.

An RPC error on that direct write is HTTP 500 `{ "error": "Database upsert failed" }` (`[BILLING_ALERT] Error applying subscription event for <event_type>:`). On the sibling-adoption write the body is `{ "error": "Failed to adopt live subscription" }` and the log is `[BILLING_ALERT] switch_to_untracked_subscription_failed:`. Either 500 leaves `last_event_id` and `last_event_occurred_at` unchanged.

When the RPC returns `false` because the subscription id being written differs from the id read at the start of the request (and this is not the adoption path), the response is HTTP 200 `{ "received": true, "ignored": "untracked_subscription" }` and the log is `[BILLING_ALERT] subscription_guard_rejected_write:`.

---

## 4. How to run a simulation

### Step 1: Open Simulations

In the Paddle dashboard, go to **Developer Tools > Simulations** and choose **New Simulation**.

### Step 2: Select the event type

Use one of the eight `subscription.*` types in the table above when you want a `subscriptions` write. `transaction.completed` and `transaction.payment_failed` only acknowledge. Any other type acknowledges with a warning.

### Step 3: Set the payload fields the handler reads

Paddle supplies a template. These are the fields the subscription path uses.

| Field | What to send |
| --- | --- |
| `event_id` | Unique for every write. Reuse the stored `last_event_id` only when you want `{ "duplicate": true }`. |
| `occurred_at` | ISO-8601 timestamp, strictly later than the stored `last_event_occurred_at`. An equal timestamp is stale. |
| `data.id` | Subscription id. A stable `sub_sim_` prefix makes the test row easy to find. A second id while the stored row is entitled is ignored (see the subscription-id table). |
| `data.customer_id` | Customer id. Required as a string for the listing on a `canceled` / `paused` status. |
| `data.status` | One of `active`, `trialing`, `paused`, `canceled`, `past_due`. Any other string is stored as portal status `none`. |
| `data.items[].price.id` | A price id from the secrets in section 2. The first allowlisted id wins. |
| `data.custom_data.user_id` | The test user's UUID. |
| `data.custom_data.cd_sig` | Hex HMAC from section 2, unless this `data.id` already matches the stored subscription id. |
| `data.current_billing_period.starts_at` / `ends_at` | Copied onto the row when the mapped status is not `canceled`. Both columns are stored as null when the mapped status is `canceled`. |
| `data.scheduled_change.action` | `cancel` or `pause` sets `cancel_at_period_end` when `data.status` is `active` or `trialing`. |
| `data.scheduled_change.effective_at` | Not read. Included here so a Paddle template can keep it. |

`data.items[].quantity` is not read.

### Step 4: Choose the destination

Select the destination that points at `paddle-webhooks` and whose usage includes simulations.

### Step 5: Send and check three places

1. The Simulations page shows the HTTP status. A write, a duplicate, a stale event, an ignore, and a transaction acknowledgement are all HTTP 200. Read the response body to tell them apart.
2. Edge Function logs show the `[Paddle]` and `[BILLING_ALERT]` lines from section 3.
3. `subscriptions` (and, for an untracked ignore, `subscription_events`) shows whether a row changed.

---

## 5. Test scenarios

Run scenarios 1–9 in order on one dedicated user, one `data.id` (`sub_sim_test01`), and strictly increasing `occurred_at` values. Each row assumes the previous write returned `{ "received": true }` and moved `last_event_occurred_at`.

Scenarios 10–11 are a second pass after the [reset](#reset-the-test-user). Scenarios 12–22 each state the row they need; they are not a continuation of 1–9.

Price tokens below mean an id that is only in that tier's set.

Every write replaces the whole row from that one payload. Send the full state on every event — `customer_id`, `items`, `current_billing_period`, and `custom_data` (with `cd_sig`) — even where a row below names only the fields that change. Omitting `current_billing_period` nulls both period columns, and an `active` row with no `current_period_end` is not entitled; omitting `customer_id` nulls `paddle_customer_id`.

### Ordered lifecycle

| # | Scenario | Event | Payload that decides the write | HTTP and `subscriptions` row |
| --- | --- | --- | --- | --- |
| 1 | New Ember subscription | `subscription.created` | `status: "active"`, Ember price, valid `cd_sig`, billing period set, `scheduled_change: null` | 200 `{ "received": true }`. `tier=EMBER`, `status=active`, `cancel_at_period_end=false`, periods copied, `price_id` is the Ember id, both event clocks set |
| 2 | Upgrade to Flame | `subscription.updated` | Same `data.id`, `status: "active"`, Flame price, later `occurred_at` | 200. `tier=FLAME`, `status=active` |
| 3 | Upgrade to Inferno | `subscription.updated` | Inferno price, later `occurred_at` | 200. `tier=INFERNO`, `status=active` |
| 4 | Downgrade to Ember | `subscription.updated` | Ember price, later `occurred_at` | 200. `tier=EMBER`, `status=active` |
| 5 | Cancel at period end | `subscription.updated` | `status: "active"`, same price, `scheduled_change.action: "cancel"`, later `occurred_at` | 200. `status=active`, `cancel_at_period_end=true`, periods unchanged |
| 6 | Past due | `subscription.past_due` | `status: "past_due"`, later `occurred_at` | 200. `status=past_due`, tier unchanged, periods kept, `cancel_at_period_end=false` |
| 7 | Recovered from past due | `subscription.updated` | `status: "active"`, `scheduled_change: null`, later `occurred_at` | 200. `status=active`, `cancel_at_period_end=false` |
| 8 | Paused | `subscription.paused` | `status: "paused"`, same `data.id`, string `customer_id`, later `occurred_at` | Listing HTTP 200 and no adopted sibling: 200 `{ "received": true }`. `status=canceled`, both period columns null, `cancel_at_period_end=false`. Listing failed: 500 `{ "error": "Could not check for a live subscription" }`, row unchanged — stop the suite |
| 9 | Resumed | `subscription.resumed` | `status: "active"`, `scheduled_change: null`, billing period set, later `occurred_at` | 200. `status=active`, `cancel_at_period_end=false`, periods copied from this payload |

A full cancel is the same write as scenario 8 with `event_type: "subscription.canceled"` and `data.status: "canceled"`. It takes the same listing branch.

### Trial pass

Reset the test user first, or send these on the `data.id` the row already tracks. A new `data.id` while the stored row is entitled returns `{ "ignored": "untracked_subscription" }` and leaves the row alone.

| # | Scenario | Event | Payload | HTTP and row |
| --- | --- | --- | --- | --- |
| 10 | Trial started | `subscription.created` | `status: "trialing"`, Ember price, valid `cd_sig`, billing period set | 200. `tier=EMBER`, `status=trialing`, periods copied, `cancel_at_period_end=false` |
| 11 | Trial converted | `subscription.activated` | Same `data.id`, `status: "active"`, later `occurred_at` | 200. `status=active` |

### Acknowledgements and refusals

| # | Scenario | What to send | HTTP | Database |
| --- | --- | --- | --- | --- |
| 12 | Duplicate | The stored `last_event_id` on a `subscription.*` event with the same `user_id` and a valid `cd_sig` (or a `data.id` equal to the stored id), valid signature | 200 `{ "received": true, "duplicate": true }` | Unchanged, including `updated_at` |
| 13 | Stale clock | New `event_id`, valid `cd_sig`, `occurred_at` earlier than or equal to `last_event_occurred_at` | 200 `{ "received": true, "stale": true }` | Unchanged |
| 14 | Missing user id | `custom_data` omitted or `{}` | 200 `{ "ignored": true }` | No read, no write |
| 15 | Malformed user id | `user_id` set to `not-a-uuid` | 400 `{ "error": "Invalid user_id in custom_data" }` | No read, no write |
| 16 | `cd_sig` does not verify and `data.id` is not the stored id | Omit `cd_sig`, use a `data.id` the user does not already have (a reset user has none) | 401 `{ "error": "Invalid cd_sig" }` | No write |
| 17 | Legacy unsigned match | Omit `cd_sig`, set `data.id` to the stored `paddle_subscription_id`, later `occurred_at` | 200 `{ "received": true }` | Write proceeds |
| 18 | Unknown price, paid tier already stored | New `event_id`, later `occurred_at`, first item's `price.id` absent from every set, stored tier paid | 200 `{ "received": true }` | Tier unchanged. `price_id` becomes that first item's id |
| 19 | Unknown price, no paid tier | After reset: valid `cd_sig`, unknown `price.id` | 500 `{ "error": "Unknown price_id — configuration error" }` | No write |
| 20 | No item price | `items: []` (or items with no `price.id`), later `occurred_at`, otherwise valid | 200 `{ "received": true }` | `tier=FREE`, `price_id` null |
| 21 | Untracked cancel while entitled | Different `data.id`, `status: "canceled"`, valid `cd_sig`, later `occurred_at`, stored row still entitled | 200 `{ "received": true, "ignored": "untracked_subscription" }` | `subscriptions` unchanged. One `subscription_events` row, `operation=IGNORED`, `note=untracked_subscription` |
| 22 | Transaction events and any other type | `transaction.completed`, `transaction.payment_failed`, or for example `customer.updated`, each with `event_id` and `data` | 200 `{ "received": true }` | `subscriptions` unchanged. Transactions log `Acknowledged`. Other types log `Unhandled event type:` |

Scenario 20 overwrites a paid tier with `FREE`. Run it on the test user and then reset.

### Walkthrough: scenario 1

```json
{
  "event_id": "evt_sim_001",
  "event_type": "subscription.created",
  "occurred_at": "2026-10-06T12:00:00Z",
  "data": {
    "id": "sub_sim_test01",
    "customer_id": "ctm_sim_test01",
    "status": "active",
    "items": [
      {
        "price": { "id": "pri_YOUR_EMBER_PRICE_ID" },
        "quantity": 1
      }
    ],
    "custom_data": {
      "user_id": "YOUR_TEST_USER_UUID",
      "cd_sig": "HEX_HMAC_OF_THAT_UUID"
    },
    "current_billing_period": {
      "starts_at": "2026-10-06T00:00:00Z",
      "ends_at": "2026-11-06T00:00:00Z"
    },
    "scheduled_change": null
  }
}
```

Replace `pri_YOUR_EMBER_PRICE_ID` with an id from the Ember set, and `cd_sig` with the digest from section 2.

```sql
SELECT tier, status, paddle_subscription_id, paddle_customer_id, price_id,
       cancel_at_period_end, current_period_start, current_period_end,
       last_event_id, last_event_occurred_at
FROM subscriptions
WHERE user_id = 'YOUR_TEST_USER_UUID';
```

| Column | Expected |
| --- | --- |
| `tier` | `EMBER` |
| `status` | `active` |
| `paddle_subscription_id` | `sub_sim_test01` |
| `paddle_customer_id` | `ctm_sim_test01` |
| `price_id` | `pri_YOUR_EMBER_PRICE_ID` (the first item's price id) |
| `cancel_at_period_end` | `false` |
| `current_period_start` | `2026-10-06T00:00:00Z` |
| `current_period_end` | `2026-11-06T00:00:00Z` |
| `last_event_id` | `evt_sim_001` |
| `last_event_occurred_at` | `2026-10-06T12:00:00Z` |

### Walkthrough: scenario 12

Send another signed notification whose `event_id` is the current `last_event_id` (`evt_sim_001` only while that is still the stored id). The response body is `{ "received": true, "duplicate": true }`.

```sql
SELECT last_event_id, last_event_occurred_at, updated_at
FROM subscriptions
WHERE user_id = 'YOUR_TEST_USER_UUID';
```

All three columns stay at the values from the write that stored that `event_id`.

A later scenario stores a new `last_event_id`. Resending `evt_sim_001` after that is not a duplicate. With the original `occurred_at` it is stale: `{ "received": true, "stale": true }`.

---

## 6. Verifying results

### Logs

Dashboard: **Edge Functions > paddle-webhooks > Invocations** (or **Logs**). The pinned Supabase CLI has no `functions logs` command.

A delivery that parsed logs `[Paddle] Received event: <event_type>, event_id: <event_id>, customer_id: <customer_id>` before the later accept, ignore, or error line.

The alert catalogue and Paddle's retry schedule are in [billing-incident-response.md](billing-incident-response.md). This handler answers 200 for "accepted, nothing to do" (duplicate, stale, missing user id, untracked subscription, transaction, unhandled type) 4xx when the payload is rejected (a retry of the same body fails the same way), and 5xx when the delivery should be retried.

### Row

```sql
SELECT user_id, tier, status, paddle_subscription_id, paddle_customer_id,
       price_id, cancel_at_period_end,
       current_period_start, current_period_end,
       last_event_id, last_event_occurred_at, updated_at
FROM subscriptions
WHERE user_id = 'YOUR_TEST_USER_UUID';
```

After scenario 21:

```sql
SELECT event_recorded_at, operation, note, status,
       paddle_subscription_id, last_event_id, last_event_occurred_at,
       row_snapshot
FROM subscription_events
WHERE user_id = 'YOUR_TEST_USER_UUID'
  AND operation = 'IGNORED'
ORDER BY event_recorded_at DESC;
```

### Portal

Log in as the test user and open a subscription-gated page. Effective access follows the row:

| Stored shape | Access |
| --- | --- |
| `status` `active` or `trialing`, `current_period_end` still in the future, paid tier | That paid tier. `active` with `cancel_at_period_end` false stays entitled for 48 hours after `current_period_end`. `trialing`, and `active` with `cancel_at_period_end` true, end at `current_period_end`. |
| `status` `past_due`, paid tier | That paid tier, including after `current_period_end`. |
| `status` `canceled` (Paddle `canceled` or `paused`), or `tier` `FREE` | The subscription gate. |

The portal caches the row with TanStack Query. Hard-refresh (`Ctrl+Shift+R`) after a simulation before treating the page as stale.

### Reset the test user

This is for the dedicated simulation user between suite runs. Clearing `last_event_id` and `last_event_occurred_at` on a real subscriber allows an older notification to overwrite the current tier, status, and period. Production replay rules are in [billing-incident-response.md](billing-incident-response.md).

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
    last_event_occurred_at = NULL,
    updated_at = NOW()
WHERE user_id = 'YOUR_TEST_USER_UUID';
```

Clearing only `last_event_id` still leaves the occurred-at clock in place, so an earlier `occurred_at` returns `{ "stale": true }`.

---

## 7. Troubleshooting

### HTTP 401 `Unauthorized` or `Invalid signature`

`Unauthorized` means `PADDLE_WEBHOOK_SECRET` is unset or whitespace-only, or the request has no `Paddle-Signature` header.

`Invalid signature` means the header did not verify: wrong secret for this destination, a tampered body, a malformed `ts` / `h1`, or a `ts` more than 300 seconds from the function clock. The too-old log is `[BILLING_ALERT] Webhook signature too old:`.

Copy the destination's secret key from **Developer Tools > Notifications** into `PADDLE_WEBHOOK_SECRET` and redeploy. Send the simulation from the dashboard so Paddle mints a fresh `ts`. Replaying a captured body from earlier than the window fails this check even when the JSON is unchanged.

A bare `curl -X POST <function-url>` reaches the signature check only after the configuration checks in section 2 pass. With those secrets set, the curl has no `Paddle-Signature` and returns 401 `{ "error": "Unauthorized" }`, which shows the function is reachable.

### HTTP 500 before any event log

| Body | Meaning |
| --- | --- |
| `Billing configuration incomplete` | No paid price id is configured |
| `Billing configuration invalid` | The same price id is in more than one tier set |
| `Billing custom_data signing is not configured` | `PADDLE_CUSTOM_DATA_SECRET` is unset or whitespace-only |

Fix the secret and redeploy. These responses do not depend on the simulation body.

### HTTP 200 `{ "ignored": true }`

The subscription event has no `data.custom_data.user_id`. Add the UUID and a matching `cd_sig`. Paddle treats the 200 as delivered.

### HTTP 400 `Invalid user_id in custom_data`

`user_id` is non-empty and is not a UUID. Replace it with `auth.users.id`.

### HTTP 401 `Invalid cd_sig`

The HMAC does not match, and `data.id` is not the stored `paddle_subscription_id`. Recompute `cd_sig` with the trimmed `PADDLE_CUSTOM_DATA_SECRET` and the exact `user_id` string. An event for a subscription id the row does not already track cannot use the legacy unsigned path.

### HTTP 200 and the tier or status you expected is missing

| Response body | What happened |
| --- | --- |
| `{ "received": true, "duplicate": true }` | `event_id` is already `last_event_id`. `updated_at` is unchanged. |
| `{ "received": true, "stale": true }` | `occurred_at` is earlier than or equal to `last_event_occurred_at`, or a newer write won at the RPC. The row is unchanged. |
| `{ "received": true, "ignored": "untracked_subscription" }` | `data.id` is not the tracked subscription, and this event was not allowed to replace it. `subscriptions` is unchanged. |
| `{ "received": true }` on `transaction.completed`, `transaction.payment_failed`, or an unhandled type | Acknowledged. The subscription path never ran. |
| `{ "received": true }` and `updated_at` moved | The write ran. Compare `price_id`, `occurred_at`, and `data.status` with section 3. A payload that repeats the current tier and status still bumps `updated_at` and the event clocks. |

Give the next write a new `event_id` and a later `occurred_at`. Do not clear the clocks on a real subscriber to force a replay.

### HTTP 500 `Unknown price_id — configuration error`

The price id is non-empty and is not in any tier set, and there is no paid tier on the row to keep. Add the id to the Ember, Flame, or Inferno variables (the comma-separated list, the matching single-id secret, or both) and redeploy. The 500 leaves the clocks alone, so the same `event_id` and `occurred_at` can be resent.

When the row already has a paid tier, the same unknown id returns 200 and keeps that tier. Check `price_id` and the preserving-tier warning so a 200 is not read as "mapped to the new plan".

### HTTP 200 and `tier` is `FREE`

The payload's items produced an empty price id. The handler writes `FREE` and does not log a billing alert. Put the base-plan `price.id` on an item. An unknown non-empty price id does not take this path.

### HTTP 500 `Could not check for a live subscription`

The payload maps to portal `canceled` (Paddle `canceled` or `paused`) and the customer listing did not return usable JSON. Set `PADDLE_API_KEY` on `paddle-webhooks`. Set `PADDLE_ENVIRONMENT` to `sandbox` when the key and the destination belong to the sandbox. The row is unchanged until a listing returns HTTP 200.

### The destination shows no request

Confirm the destination URL is the deployed function URL and that **Usage** includes simulations. Redeploy with the command in section 2, then use the bare POST above to separate "function not reachable" from "simulation not routed".

---

## 8. Reference

### Paddle `data.status` to the stored row

| Paddle `data.status` | `status` | Period columns | `cancel_at_period_end` |
| --- | --- | --- | --- |
| `active` | `active` | Copied from `current_billing_period` | True when `scheduled_change.action` is `cancel` or `pause` |
| `trialing` | `trialing` | Copied | True for the same two actions |
| `past_due` | `past_due` | Copied | False |
| `paused` | `canceled` | Both null | False |
| `canceled` | `canceled` | Both null | False |
| Any other string | `none` | Copied | False |

### Price id to `tier`

| Source | `tier` |
| --- | --- |
| Id in the Inferno set (list or `PADDLE_INFERNO_MONTHLY_PRICE_ID` / `PADDLE_INFERNO_ANNUAL_PRICE_ID`) | `INFERNO` |
| Id in the Flame set | `FLAME` |
| Id in the Ember set | `EMBER` |
| Non-empty id in none of the sets, no stored paid tier | No write. HTTP 500 |
| Non-empty id in none of the sets, stored paid tier | Stored tier kept |
| Empty price id | `FREE` |

An id present in two tier sets never reaches this mapping. The request fails earlier with `Billing configuration invalid`.

### Response catalogue

| HTTP | Body | When |
| --- | --- | --- |
| 200 | `{ "received": true }` | Subscription write applied, or a transaction / unhandled type was acknowledged |
| 200 | `{ "received": true, "duplicate": true }` | `event_id` matches `last_event_id` |
| 200 | `{ "received": true, "stale": true }` | `occurred_at` is not strictly newer, including a lost race at write time |
| 200 | `{ "received": true, "ignored": "untracked_subscription" }` | This subscription id must not replace the tracked row |
| 200 | `{ "received": true, "switchedToUntrackedSubscription": true }` | A canceled/paused event adopted another live subscription that proved this user |
| 200 | `{ "ignored": true }` | No `custom_data.user_id` |
| 400 | `{ "error": "Invalid event payload" }` | Missing `event_id`, `event_type`, or `data` |
| 400 | `{ "error": "Invalid user_id in custom_data" }` | `user_id` is not a UUID |
| 400 | `{ "error": "Invalid occurred_at" }` | Missing or unparseable `occurred_at` on a non-duplicate |
| 401 | `{ "error": "Unauthorized" }` | Webhook secret or `Paddle-Signature` header missing |
| 401 | `{ "error": "Invalid signature" }` | HMAC, header shape, or 300-second window failed |
| 401 | `{ "error": "Invalid cd_sig" }` | Custom-data HMAC failed and the subscription id does not match the row |
| 405 | `{ "error": "Method not allowed" }` | Not `POST` |
| 500 | `{ "error": "Billing configuration incomplete" }` | No paid price id configured |
| 500 | `{ "error": "Billing configuration invalid" }` | One price id configured on two tiers |
| 500 | `{ "error": "Billing custom_data signing is not configured" }` | `PADDLE_CUSTOM_DATA_SECRET` missing |
| 500 | `{ "error": "Failed to load subscription state" }` | Reading the existing row failed |
| 500 | `{ "error": "Unknown price_id — configuration error" }` | Unknown price and no paid tier to keep |
| 500 | `{ "error": "Could not check for a live subscription" }` | Canceled/paused listing failed |
| 500 | `{ "error": "Failed to adopt live subscription" }` | Sibling adoption write failed |
| 500 | `{ "error": "Database upsert failed" }` | `apply_subscription_event` returned an error |
| 500 | `{ "error": "Internal server error" }` | Unexpected throw, including a signed body that is not JSON |

---

## Related runbooks

- [Billing Incident Response](billing-incident-response.md) — alerts, retry behaviour, and production replay rules
