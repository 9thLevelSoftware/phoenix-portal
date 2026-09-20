-- CI fixture (migrations.yml): duplicate ACTIVE sync_queue rows, i.e. the
-- state prod is in before 20260920005200_sync_queue_pending_unique.sql runs.
-- Applied as postgres to a throwaway local stack with the unique index
-- dropped (the workflow drops it first — a clean `db reset` already created
-- it, so the pre-migration state cannot otherwise be reproduced). The
-- migration is then applied TWICE and check.sql asserts the outcome both
-- times. Never run against a real database.
--
-- user  provider   rows (newest first)                     expected
-- D1    strava     manual 1d, incr 2d, incr 3d (pending)   1d kept, 2d+3d superseded
-- D1    strava     initial 1d, initial 5d (pending)        1d kept, 5d superseded
-- D2    hevy       pending 1d, processing 4d               PROCESSING kept (in
--                                                          flight), pending superseded
-- D3    fitbit     pending 1d + completed 2d + failed 3d   all unchanged
-- D4    liftosaur  processing 1d, processing 2d            1d kept, 2d superseded
-- D5    garmin     pending 1d, pending 2d (NULL sync_type) 1d kept, 2d superseded
--                                                          (NULL = non-initial)

BEGIN;

INSERT INTO auth.users (id, email)
SELECT ('52525252-1111-4000-8000-00000000000' || u)::uuid, 'dedupe-ci-' || u || '@example.test'
FROM unnest(ARRAY['1', '2', '3', '4', '5']) AS u
ON CONFLICT (id) DO NOTHING;

DELETE FROM public.sync_queue
WHERE user_id IN (
  SELECT ('52525252-1111-4000-8000-00000000000' || u)::uuid
  FROM unnest(ARRAY['1', '2', '3', '4', '5']) AS u
);

INSERT INTO public.sync_queue (id, user_id, provider, sync_type, status, created_at, started_at)
VALUES
  -- D1 / strava: three non-initial and two initial, all pending.
  ('52521111-0000-4000-8000-0000000000a1', '52525252-1111-4000-8000-000000000001',
   'strava', 'manual', 'pending', now() - interval '1 day', NULL),
  ('52521111-0000-4000-8000-0000000000a2', '52525252-1111-4000-8000-000000000001',
   'strava', 'incremental', 'pending', now() - interval '2 days', NULL),
  ('52521111-0000-4000-8000-0000000000a3', '52525252-1111-4000-8000-000000000001',
   'strava', 'incremental', 'pending', now() - interval '3 days', NULL),
  ('52521111-0000-4000-8000-0000000000a4', '52525252-1111-4000-8000-000000000001',
   'strava', 'initial', 'pending', now() - interval '1 day', NULL),
  ('52521111-0000-4000-8000-0000000000a5', '52525252-1111-4000-8000-000000000001',
   'strava', 'initial', 'pending', now() - interval '5 days', NULL),
  -- D2 / hevy: an older row still being worked on, and a newer pending one.
  ('52521111-0000-4000-8000-0000000000b1', '52525252-1111-4000-8000-000000000002',
   'hevy', 'manual', 'pending', now() - interval '1 day', NULL),
  ('52521111-0000-4000-8000-0000000000b2', '52525252-1111-4000-8000-000000000002',
   'hevy', 'incremental', 'processing', now() - interval '4 days', now()),
  -- D3 / fitbit: one active row; the terminal ones are out of the index.
  ('52521111-0000-4000-8000-0000000000c1', '52525252-1111-4000-8000-000000000003',
   'fitbit', 'incremental', 'pending', now() - interval '1 day', NULL),
  ('52521111-0000-4000-8000-0000000000c2', '52525252-1111-4000-8000-000000000003',
   'fitbit', 'incremental', 'completed', now() - interval '2 days', NULL),
  ('52521111-0000-4000-8000-0000000000c3', '52525252-1111-4000-8000-000000000003',
   'fitbit', 'initial', 'failed', now() - interval '3 days', NULL),
  -- D4 / liftosaur: two live rows of one class (only possible pre-index).
  ('52521111-0000-4000-8000-0000000000d1', '52525252-1111-4000-8000-000000000004',
   'liftosaur', 'manual', 'processing', now() - interval '1 day', now()),
  ('52521111-0000-4000-8000-0000000000d2', '52525252-1111-4000-8000-000000000004',
   'liftosaur', 'manual', 'processing', now() - interval '2 days', now()),
  -- D5 / garmin: untyped legacy rows (sync_type NULL = non-initial class).
  ('52521111-0000-4000-8000-0000000000e1', '52525252-1111-4000-8000-000000000005',
   'garmin', NULL, 'pending', now() - interval '1 day', NULL),
  ('52521111-0000-4000-8000-0000000000e2', '52525252-1111-4000-8000-000000000005',
   'garmin', NULL, 'pending', now() - interval '2 days', NULL);

COMMIT;
