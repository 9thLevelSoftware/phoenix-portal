BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- Service-only checkout ledger. An unfinished remote transaction is never
-- replaced until Paddle confirms it canceled, including after local expiry.
CREATE TABLE IF NOT EXISTS public.paddle_checkout_authorizations (
  nonce uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  price_id text NOT NULL,
  environment text NOT NULL CHECK (environment IN ('sandbox', 'production')),
  expires_at timestamptz NOT NULL,
  transaction_id text UNIQUE,
  subscription_id text UNIQUE,
  customer_id text,
  state text NOT NULL DEFAULT 'creating' CHECK (state IN ('creating', 'configuring', 'ready', 'closing', 'bound', 'canceled')),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.paddle_checkout_authorizations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.paddle_checkout_authorizations FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.paddle_checkout_authorizations TO service_role;
CREATE INDEX IF NOT EXISTS paddle_checkout_authorizations_user_idx ON public.paddle_checkout_authorizations(user_id);

-- Preserve pre-cutover billing ownership already authenticated and audited by
-- the old webhook. Never use customer ID or arbitrary provider custom_data as
-- a backfill authority. Conflicting historical owners require operator repair.
INSERT INTO public.paddle_checkout_authorizations(nonce,user_id,price_id,environment,expires_at,subscription_id,customer_id,state)
SELECT gen_random_uuid(), s.user_id, 'legacy', 'production', now(), s.paddle_subscription_id, s.paddle_customer_id, 'bound'
FROM public.subscriptions s WHERE s.paddle_subscription_id IS NOT NULL
ON CONFLICT (subscription_id) DO NOTHING;
INSERT INTO public.paddle_checkout_authorizations(nonce,user_id,price_id,environment,expires_at,subscription_id,customer_id,state)
SELECT gen_random_uuid(), e.user_id, 'legacy', 'production', now(), e.paddle_subscription_id, max(e.paddle_customer_id), 'bound'
FROM public.subscription_events e JOIN auth.users u ON u.id = e.user_id
WHERE e.note = 'untracked_subscription' AND e.paddle_subscription_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.subscription_events other WHERE other.paddle_subscription_id = e.paddle_subscription_id AND other.user_id <> e.user_id)
  AND NOT EXISTS (SELECT 1 FROM public.subscriptions other WHERE other.paddle_subscription_id = e.paddle_subscription_id AND other.user_id <> e.user_id)
GROUP BY e.user_id,e.paddle_subscription_id ON CONFLICT (subscription_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.is_paddle_subscription_bound(p_user_id uuid, p_subscription_id text)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM public.paddle_checkout_authorizations WHERE user_id = p_user_id AND subscription_id = p_subscription_id AND state = 'bound')
    AND NOT EXISTS (SELECT 1 FROM public.deletion_requests WHERE user_id = p_user_id AND status IN ('pending', 'executing'));
$$;

CREATE OR REPLACE FUNCTION public.mark_paddle_subscription_terminal(p_user_id uuid, p_subscription_id text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM 1 FROM auth.users WHERE id = p_user_id FOR UPDATE;
  UPDATE public.paddle_checkout_authorizations SET state = 'canceled' WHERE user_id = p_user_id AND subscription_id = p_subscription_id;
  RETURN true;
END $$;

CREATE OR REPLACE FUNCTION public.reserve_paddle_checkout(p_user_id uuid, p_nonce uuid, p_price_id text, p_environment text, p_expires_at timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r public.paddle_checkout_authorizations%ROWTYPE;
BEGIN
  PERFORM 1 FROM auth.users WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('action', 'blocked'); END IF;
  IF EXISTS (SELECT 1 FROM public.deletion_requests WHERE user_id = p_user_id AND status IN ('pending', 'executing'))
    OR EXISTS (SELECT 1 FROM public.subscriptions WHERE user_id = p_user_id AND paddle_subscription_id IS NOT NULL AND status <> 'canceled')
    OR EXISTS (SELECT 1 FROM public.paddle_checkout_authorizations a WHERE a.user_id = p_user_id AND a.state = 'bound'
      AND NOT EXISTS (SELECT 1 FROM public.subscriptions s WHERE s.user_id = p_user_id AND s.paddle_subscription_id = a.subscription_id AND s.status = 'canceled'))
  THEN RETURN jsonb_build_object('action', 'blocked'); END IF;
  SELECT * INTO r FROM public.paddle_checkout_authorizations WHERE user_id = p_user_id AND state IN ('creating', 'configuring', 'ready', 'closing') ORDER BY created_at LIMIT 1 FOR UPDATE;
  IF FOUND THEN
    IF r.state = 'closing' THEN RETURN to_jsonb(r) || jsonb_build_object('action', 'close'); END IF;
    IF r.state = 'configuring' THEN RETURN to_jsonb(r) || jsonb_build_object('action', 'configure'); END IF;
    IF r.state <> 'ready' THEN RETURN jsonb_build_object('action', 'busy'); END IF;
    IF r.price_id = p_price_id AND r.environment = p_environment AND r.expires_at > now() THEN
      RETURN to_jsonb(r) || jsonb_build_object('action', 'reuse');
    END IF;
    UPDATE public.paddle_checkout_authorizations SET state = 'closing' WHERE nonce = r.nonce;
    RETURN to_jsonb(r) || jsonb_build_object('action', 'close');
  END IF;
  INSERT INTO public.paddle_checkout_authorizations(nonce,user_id,price_id,environment,expires_at)
    VALUES(p_nonce,p_user_id,p_price_id,p_environment,p_expires_at) RETURNING * INTO r;
  RETURN to_jsonb(r) || jsonb_build_object('action', 'create');
END $$;

CREATE OR REPLACE FUNCTION public.finish_paddle_checkout(p_user_id uuid, p_nonce uuid, p_transaction_id text, p_canceled boolean DEFAULT false)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM 1 FROM auth.users WHERE id = p_user_id FOR UPDATE;
  IF p_canceled THEN
    UPDATE public.paddle_checkout_authorizations SET state = 'canceled' WHERE nonce = p_nonce AND user_id = p_user_id
      AND (state = 'closing' OR (state = 'creating' AND transaction_id IS NULL AND p_transaction_id IS NULL));
  ELSE
    UPDATE public.paddle_checkout_authorizations SET state = 'ready', transaction_id = p_transaction_id WHERE nonce = p_nonce AND user_id = p_user_id AND state IN ('creating', 'configuring', 'ready', 'closing') AND (transaction_id IS NULL OR transaction_id = p_transaction_id);
  END IF;
  RETURN FOUND;
END $$;

CREATE OR REPLACE FUNCTION public.record_paddle_checkout_transaction(p_user_id uuid, p_nonce uuid, p_transaction_id text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM 1 FROM auth.users WHERE id = p_user_id FOR UPDATE;
  UPDATE public.paddle_checkout_authorizations SET state = 'configuring', transaction_id = p_transaction_id
    WHERE nonce = p_nonce AND user_id = p_user_id AND state = 'creating' AND transaction_id IS NULL;
  RETURN FOUND;
END $$;

CREATE OR REPLACE FUNCTION public.bind_paddle_checkout(p_user_id uuid, p_nonce uuid, p_transaction_id text, p_subscription_id text, p_customer_id text, p_price_id text, p_environment text, p_completed_at timestamptz)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r public.paddle_checkout_authorizations%ROWTYPE;
BEGIN
  PERFORM 1 FROM auth.users WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  SELECT * INTO r FROM public.paddle_checkout_authorizations WHERE nonce = p_nonce AND user_id = p_user_id FOR UPDATE;
  IF NOT FOUND OR r.transaction_id IS DISTINCT FROM p_transaction_id OR r.price_id IS DISTINCT FROM p_price_id
    OR r.environment IS DISTINCT FROM p_environment THEN RETURN false; END IF;
  IF r.subscription_id = p_subscription_id THEN RETURN true; END IF;
  IF r.state NOT IN ('ready', 'closing') OR p_completed_at IS NULL OR p_completed_at > r.expires_at OR p_completed_at < r.created_at
    OR EXISTS (SELECT 1 FROM public.deletion_requests WHERE user_id = p_user_id AND status IN ('pending', 'executing'))
    OR EXISTS (SELECT 1 FROM public.subscriptions WHERE user_id = p_user_id AND paddle_subscription_id IS NOT NULL AND paddle_subscription_id <> p_subscription_id AND status <> 'canceled')
  THEN RETURN false; END IF;
  UPDATE public.paddle_checkout_authorizations SET state = 'bound', subscription_id = p_subscription_id, customer_id = p_customer_id WHERE nonce = r.nonce;
  RETURN true;
END $$;

REVOKE ALL ON FUNCTION public.reserve_paddle_checkout(uuid,uuid,text,text,timestamptz), public.finish_paddle_checkout(uuid,uuid,text,boolean), public.bind_paddle_checkout(uuid,uuid,text,text,text,text,text,timestamptz), public.is_paddle_subscription_bound(uuid,text), public.mark_paddle_subscription_terminal(uuid,text), public.record_paddle_checkout_transaction(uuid,uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_paddle_checkout(uuid,uuid,text,text,timestamptz), public.finish_paddle_checkout(uuid,uuid,text,boolean), public.bind_paddle_checkout(uuid,uuid,text,text,text,text,text,timestamptz), public.is_paddle_subscription_bound(uuid,text), public.mark_paddle_subscription_terminal(uuid,text), public.record_paddle_checkout_transaction(uuid,uuid,text) TO service_role;
COMMIT;
