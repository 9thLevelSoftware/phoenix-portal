-- CI fixture (migrations.yml): a stale sync_queue backlog covering every
-- triage branch. Applied as postgres to a throwaway local stack, then the
-- scheduler migration is re-applied so its own triage call runs over it, and
-- check.sql asserts the outcome. Never run against a real database.
--
-- user  provider   integration / tokens / plan        pending rows -> expected
-- A     strava     connected, tokens, FLAME           incr 1d, incr 2d, manual 3d
--                                                     -> 1d kept; 2d, 3d superseded
-- B     fitbit     disconnected, tokens, FLAME        incr 1d -> failed not_connected
-- C     hevy       connected, api_key, FLAME          incr 30d -> superseded (stale)
-- D     strava     connected, tokens, FLAME           initial 30d -> kept
-- E     liftosaur  connected, no api_key, FLAME       incr 1d -> failed not_connected
-- F     strava     connected, tokens, FLAME           initial 20d, incr 1d -> both kept;
--                                                     initial 25d -> superseded
-- G     hevy       status 'error', api_key, FLAME     incr 1d -> kept (still syncs)
-- H     strava     connected, tokens, EMBER           incr 1d -> failed subscription
-- I     garmin     connected, tokens, FLAME           incr 1d -> failed provider
-- A also has a completed row (40d) and D a processing row on another
-- provider (fitbit); both are untouched.

BEGIN;

INSERT INTO auth.users (id, email)
SELECT ('c1c1c1c1-0000-4000-8000-00000000000' || u)::uuid, 'triage-' || u || '@example.test'
FROM unnest(ARRAY['a', 'b', 'c', 'd', 'e', 'f']) AS u
ON CONFLICT (id) DO NOTHING;
INSERT INTO auth.users (id, email)
SELECT ('c1c1c1c1-0000-4000-8000-0000000000' || u)::uuid, 'triage-' || u || '@example.test'
FROM unnest(ARRAY['1a', '1b', '1c']) AS u
ON CONFLICT (id) DO NOTHING;
-- G = ...001a, H = ...001b, I = ...001c

INSERT INTO public.subscriptions (user_id, tier, status, current_period_end)
SELECT u::uuid, tier, 'active', now() + interval '30 days'
FROM (VALUES
  ('c1c1c1c1-0000-4000-8000-00000000000a', 'FLAME'),
  ('c1c1c1c1-0000-4000-8000-00000000000b', 'FLAME'),
  ('c1c1c1c1-0000-4000-8000-00000000000c', 'FLAME'),
  ('c1c1c1c1-0000-4000-8000-00000000000d', 'FLAME'),
  ('c1c1c1c1-0000-4000-8000-00000000000e', 'FLAME'),
  ('c1c1c1c1-0000-4000-8000-00000000000f', 'INFERNO'),
  ('c1c1c1c1-0000-4000-8000-00000000001a', 'FLAME'),
  ('c1c1c1c1-0000-4000-8000-00000000001b', 'EMBER'),
  ('c1c1c1c1-0000-4000-8000-00000000001c', 'FLAME')
) AS v(u, tier)
ON CONFLICT (user_id) DO UPDATE
  SET tier = EXCLUDED.tier, status = EXCLUDED.status,
      current_period_end = EXCLUDED.current_period_end;

INSERT INTO public.user_integrations (user_id, provider, status)
VALUES
  ('c1c1c1c1-0000-4000-8000-00000000000a', 'strava', 'connected'),
  ('c1c1c1c1-0000-4000-8000-00000000000b', 'fitbit', 'disconnected'),
  ('c1c1c1c1-0000-4000-8000-00000000000c', 'hevy', 'connected'),
  ('c1c1c1c1-0000-4000-8000-00000000000d', 'strava', 'connected'),
  ('c1c1c1c1-0000-4000-8000-00000000000e', 'liftosaur', 'connected'),
  ('c1c1c1c1-0000-4000-8000-00000000000f', 'strava', 'connected'),
  ('c1c1c1c1-0000-4000-8000-00000000001a', 'hevy', 'error'),
  ('c1c1c1c1-0000-4000-8000-00000000001b', 'strava', 'connected'),
  ('c1c1c1c1-0000-4000-8000-00000000001c', 'garmin', 'connected')
ON CONFLICT (user_id, provider) DO UPDATE SET status = EXCLUDED.status;

INSERT INTO public.oauth_tokens (user_id, provider, access_token, api_key)
VALUES
  ('c1c1c1c1-0000-4000-8000-00000000000a', 'strava', 'tok', NULL),
  ('c1c1c1c1-0000-4000-8000-00000000000b', 'fitbit', 'tok', NULL),
  ('c1c1c1c1-0000-4000-8000-00000000000c', 'hevy', NULL, 'key'),
  ('c1c1c1c1-0000-4000-8000-00000000000d', 'strava', 'tok', NULL),
  ('c1c1c1c1-0000-4000-8000-00000000000f', 'strava', 'tok', NULL),
  ('c1c1c1c1-0000-4000-8000-00000000001a', 'hevy', NULL, 'key'),
  ('c1c1c1c1-0000-4000-8000-00000000001b', 'strava', 'tok', NULL),
  ('c1c1c1c1-0000-4000-8000-00000000001c', 'garmin', 'tok', NULL)
ON CONFLICT (user_id, provider) DO NOTHING;

-- Fixture intentionally seeds a PRE-triage backlog with duplicate active
-- (user_id, provider, is_initial) rows so private.triage_sync_queue_backlog
-- can supersede them. Migration 20260920005200 already created the partial
-- unique index sync_queue_one_active; drop it for this throwaway CI DB so
-- the fixture can load, then triage re-establishes a compliant state.
DROP INDEX IF EXISTS public.sync_queue_one_active;
DROP INDEX IF EXISTS public.sync_queue_one_processing;

INSERT INTO public.sync_queue (id, user_id, provider, sync_type, status, created_at, started_at)
VALUES
  ('c1c10000-0000-4000-8000-0000000000a1', 'c1c1c1c1-0000-4000-8000-00000000000a', 'strava', 'incremental', 'pending', now() - interval '1 day', NULL),
  ('c1c10000-0000-4000-8000-0000000000a2', 'c1c1c1c1-0000-4000-8000-00000000000a', 'strava', 'incremental', 'pending', now() - interval '2 days', NULL),
  ('c1c10000-0000-4000-8000-0000000000a3', 'c1c1c1c1-0000-4000-8000-00000000000a', 'strava', 'manual', 'pending', now() - interval '3 days', NULL),
  ('c1c10000-0000-4000-8000-0000000000a4', 'c1c1c1c1-0000-4000-8000-00000000000a', 'strava', 'incremental', 'completed', now() - interval '40 days', NULL),
  ('c1c10000-0000-4000-8000-0000000000b1', 'c1c1c1c1-0000-4000-8000-00000000000b', 'fitbit', 'incremental', 'pending', now() - interval '1 day', NULL),
  ('c1c10000-0000-4000-8000-0000000000c1', 'c1c1c1c1-0000-4000-8000-00000000000c', 'hevy', 'incremental', 'pending', now() - interval '30 days', NULL),
  ('c1c10000-0000-4000-8000-0000000000d1', 'c1c1c1c1-0000-4000-8000-00000000000d', 'strava', 'initial', 'pending', now() - interval '30 days', NULL),
  ('c1c10000-0000-4000-8000-0000000000d2', 'c1c1c1c1-0000-4000-8000-00000000000d', 'fitbit', 'incremental', 'processing', now() - interval '1 hour', now() - interval '1 minute'),
  ('c1c10000-0000-4000-8000-0000000000e1', 'c1c1c1c1-0000-4000-8000-00000000000e', 'liftosaur', 'incremental', 'pending', now() - interval '1 day', NULL),
  ('c1c10000-0000-4000-8000-0000000000f1', 'c1c1c1c1-0000-4000-8000-00000000000f', 'strava', 'initial', 'pending', now() - interval '20 days', NULL),
  ('c1c10000-0000-4000-8000-0000000000f2', 'c1c1c1c1-0000-4000-8000-00000000000f', 'strava', 'incremental', 'pending', now() - interval '1 day', NULL),
  ('c1c10000-0000-4000-8000-0000000000f3', 'c1c1c1c1-0000-4000-8000-00000000000f', 'strava', 'initial', 'pending', now() - interval '25 days', NULL),
  ('c1c10000-0000-4000-8000-0000000001a1', 'c1c1c1c1-0000-4000-8000-00000000001a', 'hevy', 'incremental', 'pending', now() - interval '1 day', NULL),
  ('c1c10000-0000-4000-8000-0000000001b1', 'c1c1c1c1-0000-4000-8000-00000000001b', 'strava', 'incremental', 'pending', now() - interval '1 day', NULL),
  ('c1c10000-0000-4000-8000-0000000001c1', 'c1c1c1c1-0000-4000-8000-00000000001c', 'garmin', 'incremental', 'pending', now() - interval '1 day', NULL);

COMMIT;
