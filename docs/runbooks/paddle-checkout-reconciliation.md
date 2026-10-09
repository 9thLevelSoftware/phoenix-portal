# Checkout transaction reconciliation

Ship the additive billing migration first, then the Edge Functions, then the
SPA. Old clients that omit `price_id` fail closed; reload them after the SPA
deploy. Do not restore the old custom-data-only checkout response.

The service-only `paddle_checkout_authorizations` ledger serializes checkout
creation. A known transaction in `configuring` or `closing` retries its existing
Paddle transaction. A definitive POST 400/401/403/422 response cancels the empty
reservation. A timeout, network failure, 5xx, or database failure before recording
the returned ID can leave `creating` with `transaction_id IS NULL`. Checkout and
account deletion stop until that uncertain external purchase is reconciled.

For that case, the operator must:

1. Read only the affected account's ledger row: nonce, environment, price,
   creation time and transaction ID. Keep API keys out of logs and reports.
2. In the matching Paddle environment, enumerate transactions around that time
   and locate the exact `custom_data.cd_nonce` and `custom_data.user_id`. The
   initial POST carries those identifiers before the transaction ID is known.
   Do not infer ownership from billing email or customer ID.
3. If found, record that exact ID through `record_paddle_checkout_transaction`
   using the service role, then retry the checkout endpoint. It completes the
   signed binding on the same transaction. For deletion, retry the deletion
   request; purge confirms and cancels the outstanding transaction first.
4. If Paddle independently confirms that no transaction was created, release
   the empty reservation with `finish_paddle_checkout(user_id, nonce, NULL,
   true)`. Do not release merely because one list page was empty.
5. If an ID was returned but the database write failed, confirm its nonce at
   Paddle before recording it. If ownership or completion is ambiguous, retain
   the reservation and ask Paddle support to resolve it.

Never replace an uncertain or unpaid transaction with a new transaction. A
replacement is allowed only after Paddle confirms the prior one canceled.
Existing bound subscriptions continue to receive renewal, plan-change and
cancellation events after the original authorization expires. A pending
deletion request prevents new issuance and new bindings.

Run a Paddle sandbox purchase, delayed subscription event, trial, transaction
replacement and deletion with a paused sibling before production rollout. Local
handler doubles prove the boundary logic but do not establish Paddle's real
event delivery timing or production permissions.
