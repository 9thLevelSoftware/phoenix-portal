-- CI assertion (migrations.yml): after seed.sql and an apply of
-- 20260920005200_sync_queue_pending_unique.sql, every seeded row has the
-- status the migration promises, the unique index is in force, and no
-- duplicate active group survives anywhere in the table. Raises on any
-- mismatch.
--
-- Run after EVERY apply: the workflow applies the migration twice, and a
-- second apply must change nothing (idempotence).

DO $$
DECLARE
  v_mismatches text;
  v_duplicates bigint;
  v_sqlstate text;
BEGIN
  SELECT string_agg(
           format('%s: expected %s, got %s', e.id, e.status, coalesce(q.status, '<missing>')),
           E'\n' ORDER BY e.id)
  INTO v_mismatches
  FROM (VALUES
    -- D1 / strava: newest of each class kept, the rest superseded.
    ('52521111-0000-4000-8000-0000000000a1', 'pending'),
    ('52521111-0000-4000-8000-0000000000a2', 'superseded'),
    ('52521111-0000-4000-8000-0000000000a3', 'superseded'),
    ('52521111-0000-4000-8000-0000000000a4', 'pending'),
    ('52521111-0000-4000-8000-0000000000a5', 'superseded'),
    -- D2 / hevy: the in-flight row is kept even though it is older; the
    -- newer pending row is superseded. Superseding a live row would orphan
    -- its worker (completion keys on status = 'processing').
    ('52521111-0000-4000-8000-0000000000b1', 'superseded'),
    ('52521111-0000-4000-8000-0000000000b2', 'processing'),
    -- D3 / fitbit: one active row, terminal rows untouched.
    ('52521111-0000-4000-8000-0000000000c1', 'pending'),
    ('52521111-0000-4000-8000-0000000000c2', 'completed'),
    ('52521111-0000-4000-8000-0000000000c3', 'failed'),
    -- D4 / liftosaur: newest of two live rows kept.
    ('52521111-0000-4000-8000-0000000000d1', 'processing'),
    ('52521111-0000-4000-8000-0000000000d2', 'superseded'),
    -- D5 / garmin: NULL sync_type is the non-initial class.
    ('52521111-0000-4000-8000-0000000000e1', 'pending'),
    ('52521111-0000-4000-8000-0000000000e2', 'superseded')
  ) AS e(id, status)
  LEFT JOIN public.sync_queue q ON q.id = e.id::uuid
  WHERE q.id IS NULL
     OR q.status IS DISTINCT FROM e.status
     OR (e.status = 'superseded' AND q.completed_at IS NULL);

  IF v_mismatches IS NOT NULL THEN
    RAISE EXCEPTION E'sync_queue dedupe outcome mismatch:\n%', v_mismatches;
  END IF;

  SELECT count(*) INTO v_duplicates
  FROM (
    SELECT 1
    FROM public.sync_queue q
    WHERE q.status IN ('pending', 'processing')
    GROUP BY q.user_id, q.provider, (coalesce(q.sync_type, 'incremental') = 'initial')
    HAVING count(*) > 1
  ) d;
  IF v_duplicates > 0 THEN
    RAISE EXCEPTION 'sync_queue still has % duplicated active group(s)', v_duplicates;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indexrelid
    JOIN pg_class t ON t.oid = i.indrelid
    WHERE t.relname = 'sync_queue'
      AND c.relname = 'sync_queue_one_active'
      AND i.indisunique
      AND i.indpred IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'sync_queue_one_active is missing, not unique, or not partial';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indexrelid
    JOIN pg_class t ON t.oid = i.indrelid
    WHERE t.relname = 'sync_queue'
      AND c.relname = 'sync_queue_one_processing'
      AND i.indisunique
      AND i.indpred IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'sync_queue_one_processing is missing, not unique, or not partial';
  END IF;

  -- The index actually refuses a duplicate (23505 -> HTTP 409 in the provider
  -- sync functions). Rolled back so the fixture is unchanged.
  BEGIN
    INSERT INTO public.sync_queue (user_id, provider, sync_type, status)
    VALUES ('52525252-1111-4000-8000-000000000001', 'strava', 'incremental', 'pending');
    RAISE EXCEPTION 'a duplicate active sync_queue row was accepted';
  EXCEPTION WHEN unique_violation THEN
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
    IF v_sqlstate <> '23505' THEN
      RAISE EXCEPTION 'unexpected SQLSTATE % for a duplicate row', v_sqlstate;
    END IF;
  END;

  RAISE NOTICE 'sync_queue dedupe outcome matches the seeded expectations';
END
$$;
