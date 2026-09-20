-- Untracked-subscription guard for apply_subscription_event (F-022, R-34).
--
-- The portal keeps ONE subscriptions row per user, but a Paddle customer can
-- hold more than one subscription. Before this migration every event with a
-- valid cd_sig wrote that row, ordered only by occurred_at — so the old
-- subscription's `subscription.canceled` (the end of dunning) revoked the
-- access the new, paid subscription had just granted.
--
-- Rule (identical to _shared/billingAction.ts#classifySubscriptionEventTarget,
-- which paddle-webhooks applies before it calls this function; this copy
-- closes the read-then-decide race between concurrent deliveries):
--   Ignore an event whose subscription id differs from the stored, non-null
--   one, UNLESS the incoming status is 'active'/'trialing' and the stored row
--   is not entitled — which is how a user who resubscribed under a new
--   subscription id is adopted rather than locked out.
--
-- On ignore the untracked subscription id and status are recorded in
-- public.subscription_events as a note='untracked_subscription' row (the
-- evidence PR 68's manual double-subscription resolution works from) and the
-- function returns false, exactly like a stale event.
--
-- Entitlement here is the shared predicate (20260920000800): past_due keeps
-- access; active has a 48h renewal grace unless cancel_at_period_end; trialing
-- has none. Parity fixture: tests/fixtures/entitlement-cases.json.
--
-- Same signature and return type as 20260628130000, so this is a plain
-- CREATE OR REPLACE. Grants are restated because CREATE OR REPLACE resets
-- omitted attributes (KD-3 rule 3b).

-- ---------------------------------------------------------------------------
-- 1. subscription_events gains a note column and an 'IGNORED' operation.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.subscription_events') IS NULL THEN
    RAISE NOTICE 'public.subscription_events is absent; skipping note column';
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'subscription_events'
      AND column_name = 'note'
  ) THEN
    ALTER TABLE public.subscription_events ADD COLUMN note text;
  END IF;

  -- 'IGNORED' rows are not a row mutation: they record an event the guard
  -- refused to apply. Widen the CHECK so they are storable.
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.subscription_events'::regclass
      AND conname = 'subscription_events_operation_check'
  ) THEN
    ALTER TABLE public.subscription_events
      DROP CONSTRAINT subscription_events_operation_check;
  END IF;
  ALTER TABLE public.subscription_events
    ADD CONSTRAINT subscription_events_operation_check
    CHECK (operation IN ('INSERT', 'UPDATE', 'DELETE', 'IGNORED'));

  -- The audit trigger writes row_snapshot for real mutations; an ignored
  -- event has no row to snapshot, so allow it to be empty.
  ALTER TABLE public.subscription_events ALTER COLUMN row_snapshot SET DEFAULT '{}'::jsonb;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. apply_subscription_event: the guard.
-- ---------------------------------------------------------------------------
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
  v_stored RECORD;
  v_stored_entitled BOOLEAN;
BEGIN
  SELECT s.paddle_subscription_id, s.status, s.current_period_end, s.cancel_at_period_end
    INTO v_stored
    FROM public.subscriptions s
   WHERE s.user_id = p_user_id;

  IF FOUND
     AND v_stored.paddle_subscription_id IS NOT NULL
     AND p_paddle_subscription_id IS NOT NULL
     AND p_paddle_subscription_id <> v_stored.paddle_subscription_id
  THEN
    v_stored_entitled := (
      v_stored.status = 'past_due'
      OR (
        v_stored.status = 'active'
        AND v_stored.current_period_end IS NOT NULL
        AND now() < v_stored.current_period_end + CASE
          WHEN COALESCE(v_stored.cancel_at_period_end, false) THEN interval '0'
          ELSE interval '48 hours'
        END
      )
      OR (
        v_stored.status = 'trialing'
        AND v_stored.current_period_end IS NOT NULL
        AND now() < v_stored.current_period_end
      )
    );

    IF p_status NOT IN ('active', 'trialing') OR v_stored_entitled THEN
      IF to_regclass('public.subscription_events') IS NOT NULL THEN
        INSERT INTO public.subscription_events (
          user_id, operation, note, status, paddle_customer_id,
          paddle_subscription_id, last_event_id, last_event_occurred_at,
          row_snapshot
        )
        VALUES (
          p_user_id, 'IGNORED', 'untracked_subscription', p_status,
          p_paddle_customer_id, p_paddle_subscription_id, p_last_event_id,
          p_last_event_occurred_at,
          jsonb_build_object(
            'tracked_subscription_id', v_stored.paddle_subscription_id,
            'tracked_status', v_stored.status,
            'incoming_tier', p_tier
          )
        );
      END IF;
      RETURN FALSE;
    END IF;
  END IF;

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

COMMENT ON FUNCTION public.apply_subscription_event(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, BOOLEAN, TEXT, TIMESTAMPTZ
) IS
  'Ordered, atomic write of a Paddle subscription event. Returns false for a stale event and for an event from an untracked subscription that would not keep the user entitled (the latter also records a note=untracked_subscription row in subscription_events). service_role only.';

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
