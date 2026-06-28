-- Atomic, ordering-guarded application of a Paddle subscription webhook event.
--
-- Background: paddle-webhooks read the existing subscription row, classified the
-- event order in app code, then upserted. Two concurrent deliveries for the same
-- user could both read the same old last_event_occurred_at, both classify as
-- "accept", and commit out of order — the older event overwriting the newer
-- state and last_event_id (F264).
--
-- This function folds the ordering decision into the write: the ON CONFLICT
-- DO UPDATE only fires when the incoming event is strictly newer than the stored
-- last_event_occurred_at (or there is none). It returns true when the row was
-- inserted/updated, false when the incoming event was stale and skipped.
--
-- SECURITY DEFINER + service_role-only EXECUTE: only the webhook (service role)
-- applies subscription state; clients must never call this. The columns written
-- mirror buildSubscriptionUpsertFromPaddleState exactly.

CREATE OR REPLACE FUNCTION public.apply_subscription_event(
  p_user_id UUID,
  p_paddle_customer_id TEXT,
  p_paddle_subscription_id TEXT,
  p_tier TEXT,
  p_status TEXT,
  p_price_id TEXT,
  p_current_period_start TIMESTAMPTZ,
  p_current_period_end TIMESTAMPTZ,
  p_cancel_at_period_end BOOLEAN,
  p_last_event_id TEXT,
  p_last_event_occurred_at TIMESTAMPTZ
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows INT;
BEGIN
  INSERT INTO public.subscriptions AS s (
    user_id,
    paddle_customer_id,
    paddle_subscription_id,
    tier,
    status,
    price_id,
    current_period_start,
    current_period_end,
    cancel_at_period_end,
    last_event_id,
    last_event_occurred_at,
    updated_at
  ) VALUES (
    p_user_id,
    p_paddle_customer_id,
    p_paddle_subscription_id,
    p_tier,
    p_status,
    p_price_id,
    p_current_period_start,
    p_current_period_end,
    p_cancel_at_period_end,
    p_last_event_id,
    p_last_event_occurred_at,
    now()
  )
  ON CONFLICT (user_id) DO UPDATE
    SET paddle_customer_id = EXCLUDED.paddle_customer_id,
        paddle_subscription_id = EXCLUDED.paddle_subscription_id,
        tier = EXCLUDED.tier,
        status = EXCLUDED.status,
        price_id = EXCLUDED.price_id,
        current_period_start = EXCLUDED.current_period_start,
        current_period_end = EXCLUDED.current_period_end,
        cancel_at_period_end = EXCLUDED.cancel_at_period_end,
        last_event_id = EXCLUDED.last_event_id,
        last_event_occurred_at = EXCLUDED.last_event_occurred_at,
        updated_at = now()
    WHERE s.last_event_occurred_at IS NULL
       OR EXCLUDED.last_event_occurred_at IS NULL
       OR EXCLUDED.last_event_occurred_at > s.last_event_occurred_at;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows > 0;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_subscription_event(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, BOOLEAN, TEXT, TIMESTAMPTZ
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_subscription_event(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, BOOLEAN, TEXT, TIMESTAMPTZ
) FROM anon;
REVOKE ALL ON FUNCTION public.apply_subscription_event(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, BOOLEAN, TEXT, TIMESTAMPTZ
) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.apply_subscription_event(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, BOOLEAN, TEXT, TIMESTAMPTZ
) TO service_role;
