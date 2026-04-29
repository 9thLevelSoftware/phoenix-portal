-- Persist Paddle webhook event ordering so older events cannot overwrite newer
-- subscription state when delivery happens out of order.

ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS last_event_occurred_at TIMESTAMPTZ;

COMMENT ON COLUMN public.subscriptions.last_event_occurred_at IS
  'Paddle webhook occurred_at timestamp for the last subscription event applied.';
