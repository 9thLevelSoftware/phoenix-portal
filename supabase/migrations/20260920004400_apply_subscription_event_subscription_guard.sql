-- Untracked-subscription guard for apply_subscription_event (F-022, R-34),
-- plus a partial UNIQUE index binding a Paddle subscription to one user.
--
-- The portal keeps ONE subscriptions row per user, but a Paddle customer can
-- hold more than one subscription. Before this migration every event with a
-- valid cd_sig wrote that row, ordered only by occurred_at — so the old
-- subscription's `subscription.canceled` (the end of dunning) revoked the
-- access the new, paid subscription had just granted.
--
-- Rule: ignore an event whose subscription id differs from the stored,
-- non-null one UNLESS the incoming status would leave the user entitled
-- ('active' / 'trialing' / 'past_due'). That blocks the F-022 money bug — an
-- old subscription's `canceled` revoking the access a newer paid one grants —
-- while still letting a user who resubscribed under a new subscription id be
-- adopted rather than locked out.
--
-- The stricter preference "don't let a second LIVE subscription take over a
-- row that is still entitled" lives in app code
-- (_shared/billingAction.ts#classifySubscriptionEventTarget, which
-- paddle-webhooks applies before calling this function). It is deliberately
-- not duplicated here: this copy NARROWS the read-then-decide race between
-- concurrent deliveries, and anything that slips past the app-code check can
-- only KEEP the user entitled, never revoke.
--
-- "Narrows", not closes: the guard reads without FOR UPDATE under READ
-- COMMITTED, so two concurrent deliveries can both evaluate it against the
-- pre-update snapshot; only the ordering predicate in the ON CONFLICT WHERE
-- is re-evaluated under the row lock. The residue is benign — the only
-- writes that can pass the guard are ones that keep the user entitled — so
-- the worst case is a row pointing at the older of two live subscriptions,
-- never a revocation.
--
-- On ignore the untracked subscription id and status are recorded in
-- public.subscription_events as a note='untracked_subscription' row (the
-- evidence PR 68's manual double-subscription resolution works from) and the
-- function returns false, exactly like a stale event.
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
-- 2. One Paddle subscription may back at most one portal user.
--
-- Structural defence in depth for the R-34 adoption path (security review R-1):
-- whatever code path gets there, two rows must never hold the same
-- paddle_subscription_id, because every billing function (cancel, refresh,
-- plan change) keys off the stored id — a second binding would hand one user
-- control of another's subscription.
--
-- The old Stripe-era UNIQUE was dropped in 20260303_revenuecat_schema_migration
-- and 20260317150000_paddle_schema_fix re-added the column as plain TEXT, so
-- duplicates may already exist in prod. Name them in the exception rather than
-- letting CREATE UNIQUE INDEX fail with a single opaque pair: the operator has
-- to decide which user legitimately owns the subscription before this applies.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_duplicates text;
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class
    WHERE relname = 'subscriptions_paddle_subscription_id_key'
      AND relnamespace = 'public'::regnamespace
  ) THEN
    RETURN;
  END IF;

  SELECT string_agg(
           format('%s (users: %s)', paddle_subscription_id, user_ids),
           '; ' ORDER BY paddle_subscription_id
         )
    INTO v_duplicates
    FROM (
      SELECT paddle_subscription_id,
             string_agg(user_id::text, ', ' ORDER BY user_id) AS user_ids
        FROM public.subscriptions
       WHERE paddle_subscription_id IS NOT NULL
       GROUP BY paddle_subscription_id
      HAVING count(*) > 1
    ) dupes;

  IF v_duplicates IS NOT NULL THEN
    RAISE EXCEPTION
      'Cannot add the unique paddle_subscription_id index: % Paddle subscription(s) are bound to more than one user: %. Resolve the duplicates (decide the true owner, clear the other row) and re-run.',
      (SELECT count(*) FROM (
         SELECT 1 FROM public.subscriptions
          WHERE paddle_subscription_id IS NOT NULL
          GROUP BY paddle_subscription_id HAVING count(*) > 1
       ) d),
      v_duplicates;
  END IF;

  CREATE UNIQUE INDEX subscriptions_paddle_subscription_id_key
    ON public.subscriptions (paddle_subscription_id)
    WHERE paddle_subscription_id IS NOT NULL;
END;
$$;

COMMENT ON INDEX public.subscriptions_paddle_subscription_id_key IS
  'One Paddle subscription backs at most one portal user. Every billing function keys off the stored id, so a second binding would hand one user control of another user''s subscription (PR 44 security review R-1).';

-- ---------------------------------------------------------------------------
-- 3. apply_subscription_event: the guard.
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
    -- Block exactly the dangerous direction: an untracked subscription whose
    -- state would NOT leave the user entitled (the F-022 money bug — an old
    -- subscription's `canceled` revoking the access a newer paid one grants).
    -- 'past_due' is in the allowed set because it keeps access during
    -- Paddle's retry window (binding user decision, R-33); leaving it out
    -- would make the rescue unable to adopt a past-due sibling and drop a
    -- paying user to FREE.
    --
    -- Deliberately NOT also requiring "the stored row is not entitled": that
    -- preference ("don't let a second live subscription steal an entitled
    -- row") is enforced in app code by
    -- _shared/billingAction.ts#classifySubscriptionEventTarget, which runs
    -- before this function. Enforcing it here too would block the R-34
    -- rescue's single-statement adopt and force a cancel-then-adopt sequence
    -- that exposes a transient `canceled` row. Anything that slips past the
    -- app-code check can only ever KEEP the user entitled, never revoke.
    IF p_status NOT IN ('active', 'trialing', 'past_due') THEN
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
