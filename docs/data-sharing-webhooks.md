# Data sharing webhooks

Phoenix Portal can push a user's own training data to an HTTPS endpoint the
user controls. This page is for whoever builds the **receiver**, and for
operators. For the rules the code must keep, see `CLAUDE.md` → "Data sharing
(outbound webhooks)".

- Available on **Flame and above**. Set up in the portal under
  **Profile → Settings → Data Sharing**.
- Up to **3 endpoints** per account. Each endpoint chooses which kinds of
  data it receives.
- Only the account owner can configure it, and an endpoint only ever receives
  its owner's data.

## Requirements for an endpoint

| | |
|---|---|
| Scheme | `https` only, with a certificate a normal client would trust |
| Host | A public DNS name or public IP. Private, loopback, link-local and reserved addresses are refused, when the endpoint is saved and again before every delivery |
| Port | 443, or 1024–65535 |
| Credentials | Not in the URL. Use the signature, or the optional custom header |
| Redirects | Never followed. A `3xx` answer is a failed delivery |
| Timeout | 10 seconds |
| Success | Any `2xx` status. The response body is ignored and never stored |

## The request

Every delivery is a `POST` with a JSON body and these headers:

| Header | Value |
|---|---|
| `content-type` | `application/json` |
| `user-agent` | `PhoenixPortal-Webhooks/1.0` |
| `webhook-id` | The delivery id. **The same on every retry** of that delivery: use it to deduplicate |
| `webhook-timestamp` | Unix seconds when this attempt was signed |
| `webhook-signature` | One or more space-separated `v1,<base64>` signatures |
| *(your custom header)* | Only if you configured one, e.g. `Authorization` |

Body:

```json
{
  "type": "workout.updated",
  "timestamp": "2026-11-06T12:00:00.000Z",
  "data": {
    "apiVersion": "2026-11-01",
    "endpointId": "…",
    "entity": "workout",
    "id": "…",
    "loadConvention": "per_cable_kg",
    "record": { "id": "…", "name": "…", "started_at": "…", "total_volume": 1200 },
    "children": {
      "exercises": [{ "id": "…", "session_id": "…", "name": "Row", "cable_count": 2 }],
      "sets": [{ "id": "…", "exercise_id": "…", "set_number": 1, "weight_kg": 40, "actual_reps": 8 }],
      "rep_summaries": [{ "id": "…", "set_id": "…", "rep_number": 1 }]
    }
  }
}
```

A deletion carries the id and nothing else:

```json
{
  "type": "routine.deleted",
  "timestamp": "2026-11-06T12:05:00.000Z",
  "data": { "apiVersion": "2026-11-01", "endpointId": "…", "entity": "routine", "id": "…" }
}
```

### Loads are per cable

Every weight and volume is **per cable**, exactly as the phone shows it and as
it is stored. Nothing is doubled. `exercises.cable_count` is `1`, `2` or
`null`; `null` means the machine did not report it, so do not assume two.

## Verifying a delivery

Signatures follow the [Standard Webhooks](https://www.standardwebhooks.com)
format, so an existing library will verify them. With the reference Node
library:

```js
import { Webhook } from "standardwebhooks";

const webhook = new Webhook(process.env.PHOENIX_SIGNING_SECRET); // "whsec_…"

export async function handler(request) {
  const body = await request.text(); // the raw body, before any JSON parsing
  let event;
  try {
    event = webhook.verify(body, {
      "webhook-id": request.headers.get("webhook-id"),
      "webhook-timestamp": request.headers.get("webhook-timestamp"),
      "webhook-signature": request.headers.get("webhook-signature"),
    });
  } catch {
    return new Response("invalid signature", { status: 401 });
  }
  // event.type, event.data …
  return new Response(null, { status: 204 });
}
```

By hand:

1. The signed content is `{webhook-id}.{webhook-timestamp}.{raw body}`.
2. The key is the **base64-decoded** bytes after the `whsec_` prefix (not the
   text of the secret).
3. Compute HMAC-SHA256 and base64-encode it. Accept the delivery if it equals
   the value after `v1,` in **any** entry of `webhook-signature`, compared in
   constant time.
4. Reject a `webhook-timestamp` more than a few minutes from your clock, to
   stop replays.

Verify against the raw bytes you received. Re-serialising the JSON first
changes the bytes and the signature will not match.

### The custom header

For receivers that cannot verify a signature (some no-code tools), an endpoint
can carry one extra header, for example `Authorization: Bearer …`. It is sent
on every delivery and stored encrypted. It proves the caller knows the value;
unlike the signature it does not protect the body from being altered, so
prefer the signature where you can.

### Replacing the secret

"Replace secret" creates a new secret and shows it once. For the next
**24 hours** each delivery carries two signatures, new secret first, so a
receiver holding either secret keeps verifying. After that only the new one is
used.

## Events

`<entity>.updated` is sent when an item is created or changed and carries its
current state. `<entity>.deleted` is sent when it is removed. `ping` is the
test delivery from the portal's "Send test" button.

| Scope (chosen per endpoint) | Entity | `record` is a row of | `children` |
|---|---|---|---|
| Workouts | `workout` | `workout_sessions` | `exercises`, `sets`, `rep_summaries` |
| Personal records | `personal_record` | `personal_records` | — |
| Routines | `routine` | `routines` | `routine_exercises` |
| Training cycles | `cycle` | `training_cycles` | `cycle_days` |
| Goals | `goal` | `user_goals` | — |
| Exercise progress | `exercise_progress` | `exercise_progress` | — |
| Achievements | `badge`, `gamification_stats`, `rpg_attributes` | `earned_badges`, `gamification_stats`, `rpg_attributes` | — |
| Imported activities | `external_activity` | `external_activities` (never Strava-sourced rows) | — |
| Profile | `profile`, `local_profile` | `profiles`, `local_profiles` | — |

Field names are the database column names, the same ones the "Download All My
Data" export uses. The account's internal user id is not included.

**Never sent this way:** raw force-curve telemetry, the Inferno biomechanics
tables, activities imported from Strava, community content, billing data, or
anything belonging to another user.

## Delivery behaviour

- **At least once.** A delivery can arrive more than once (a retry after your
  `2xx` was lost, or "Resend all"). Deduplicate on `webhook-id`, or simply
  upsert by `data.id`.
- **Current state, not a change log.** The payload is built when it is sent.
  Several quick edits to one item arrive as one delivery with the final state;
  an item edited and then deleted arrives as a deletion.
- **No ordering guarantee** between items. Because each delivery carries the
  current state, applying them in any order converges.
- **Timing.** Changes are picked up within about a minute, after a 20-second
  settle delay.
- **Retries.** Any answer other than `2xx`, a timeout or a connection failure
  is retried after about 1 min, 5 min, 15 min, 1 h, 3 h, 6 h, 12 h and 24 h
  (nine attempts over roughly two days). `429` and `503` honour `Retry-After`
  up to one hour.
- **Switched off automatically.** If a delivery uses up all its attempts, or
  the endpoint answers `410 Gone`, the endpoint is switched off and the portal
  says why. Switching it back on sends one test delivery first and only
  succeeds if that is accepted.
- **Paused with the plan.** If the account drops below Flame the endpoint is
  paused and nothing is sent until the plan returns and the owner switches it
  back on.
- **Size.** A payload over 1 MB is not sent and is shown as "too large" in the
  delivery log.
- **Resend all** queues one delivery for every existing item in the endpoint's
  selected data. Use it to load history into a new receiver.

The portal keeps a 30-day delivery log per endpoint: status, attempt count,
HTTP status and a fixed reason code. It never records your endpoint's response
body.

## Security notes for operators

- The only code that fetches a user-chosen URL is
  `supabase/functions/_shared/webhookTarget.ts`. Its header documents one
  **residual risk that is not closed**: the runtime cannot pin a connection to
  the address it validated, so DNS rebinding can still aim a request at an
  internal address. It is bounded by https with certificate validation, by the
  request carrying no Supabase credential, by redirects not being followed, and
  by nothing of the response being kept beyond its status code.
- Signing secrets and custom header values are encrypted with
  `OAUTH_TOKEN_ENCRYPTION_KEY` in `webhook_endpoint_secrets`, which no browser
  role can read. Rotating that key without re-encrypting makes every endpoint
  fail with `internal_error` until its secret is replaced.
- Operating steps (switching deliveries on and off, reading the queue) are in
  `docs/runbooks/operations.md` → "Data Sharing Webhooks".
