-- FP-8 / F-057: at most ONE active sync_queue row per (user, provider, kind).
--
-- Background. Every path that queued a sync inserted unconditionally, so a
-- user who reconnected Strava twice, or clicked "Sync now" while a task was
-- already queued, accumulated duplicate pending rows. process-sync-queue
-- dispatches them one after another, which means the same window is fetched
-- from the provider twice and the provider's quota is spent twice.
--
-- PR 31 shipped two stopgaps: a one-time triage of the stale backlog, and a
-- BEFORE INSERT trigger that rejects a duplicate for the browser roles. Both
-- classify a row as `initial` vs everything else (incremental/manual), and
-- keep the newest row of EACH class per (user, provider): an `initial` is a
-- history import, a non-initial carries a since-watermark window, and
-- dropping either loses data. This migration makes that invariant a database
-- constraint that holds for every role, including the service role used by
-- the Edge Functions:
--
--   1. older duplicates among the active statuses (`pending`, `processing`)
--      are marked `superseded` — PR 31's vocabulary, not `failed`, because
--      nothing went wrong with them;
--   2. a partial unique index enforces the invariant from here on. A second
--      concurrent insert loses the race with SQLSTATE 23505, which the
--      provider sync functions turn into HTTP 409 `sync_already_queued`.
--
-- Class expression. PR 31 classifies with `sync_type IS NOT DISTINCT FROM
-- 'initial'`, i.e. a NULL sync_type (the column is nullable) counts as
-- non-initial. The plan's literal `(sync_type = 'initial')` would evaluate to
-- NULL for those rows, and NULL keys never conflict in a unique index — a
-- hole exactly where the old queue's untyped rows sit. `coalesce(sync_type,
-- 'incremental') = 'initial'` is the same classification as PR 31's, and is
-- immutable so it can be indexed.
--
-- Status transitions are safe under the index: pending <-> processing keeps
-- the same key (both statuses are inside the predicate), and completing or
-- failing a row drops it out of the index entirely.
--
-- A second partial unique index covers only `processing` rows and omits the
-- initial/non-initial class. The queue may retain one pending row of each
-- class, but only one worker may execute for a user/provider at a time. This
-- serializes rotating OAuth refresh tokens across queue and browser runs.
--
-- Operator, read-only count (run BEFORE applying; this is the same query the
-- migration RAISEs as a NOTICE, without the write):
--
--   WITH ranked AS (
--     SELECT q.id, q.user_id, q.provider, q.status,
--            row_number() OVER (
--              PARTITION BY q.user_id, q.provider,
--                           (coalesce(q.sync_type, 'incremental') = 'initial')
--              ORDER BY (q.status = 'processing') DESC,
--                       q.created_at DESC NULLS LAST, q.id DESC
--            ) AS rn
--     FROM public.sync_queue q
--     WHERE q.status IN ('pending', 'processing')
--   )
--   SELECT count(*) AS active_rows,
--          count(*) FILTER (WHERE rn = 1) AS kept,
--          count(*) FILTER (WHERE rn > 1) AS to_supersede
--   FROM ranked;
--
-- Idempotent: re-running supersedes nothing further (one row per class is
-- left), the index is created IF NOT EXISTS, and the trigger function is
-- replaced in place.

BEGIN;

SET LOCAL lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. Read-only count of what step 2 will change (NOTICE only; writes nothing).
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_counts jsonb;
BEGIN
  WITH ranked AS (
    SELECT row_number() OVER (
             PARTITION BY q.user_id, q.provider,
                          (coalesce(q.sync_type, 'incremental') = 'initial')
             ORDER BY (q.status = 'processing') DESC,
                      q.created_at DESC NULLS LAST, q.id DESC
           ) AS rn
    FROM public.sync_queue q
    WHERE q.status IN ('pending', 'processing')
  )
  SELECT jsonb_build_object(
           'active_rows', count(*),
           'kept', count(*) FILTER (WHERE rn = 1),
           'to_supersede', count(*) FILTER (WHERE rn > 1)
         )
  INTO v_counts
  FROM ranked;

  RAISE NOTICE 'sync_queue dedupe: %', v_counts;
END
$$;

-- ---------------------------------------------------------------------------
-- 2. Supersede the older duplicates of each (user, provider, class).
--
--    A `processing` row is ranked first, whatever its created_at: it may be
--    in flight right now, and superseding it would orphan the run (its
--    completion keys on `status = 'processing'`). Two live `processing` rows
--    of one class can only come from before this index existed; the newer is
--    kept and the older one's run, if any, simply completes nothing.
-- ---------------------------------------------------------------------------
WITH ranked AS (
  SELECT q.id,
         row_number() OVER (
           PARTITION BY q.user_id, q.provider,
                        (coalesce(q.sync_type, 'incremental') = 'initial')
           ORDER BY (q.status = 'processing') DESC,
                    q.created_at DESC NULLS LAST, q.id DESC
         ) AS rn
  FROM public.sync_queue q
  WHERE q.status IN ('pending', 'processing')
)
UPDATE public.sync_queue q
SET status = 'superseded',
    completed_at = now()
FROM ranked r
WHERE q.id = r.id
  AND r.rn > 1
  AND q.status IN ('pending', 'processing');

-- ---------------------------------------------------------------------------
-- 3. The invariant, for every role.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS sync_queue_one_active
  ON public.sync_queue (
    user_id,
    provider,
    ((coalesce(sync_type, 'incremental') = 'initial'))
  )
  WHERE status IN ('pending', 'processing');

COMMENT ON INDEX public.sync_queue_one_active IS
  'One active (pending/processing) sync_queue row per (user_id, provider, initial-or-not). A duplicate insert raises 23505, which the provider sync functions return as 409 sync_already_queued.';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.sync_queue q
    WHERE q.status = 'processing'
    GROUP BY q.user_id, q.provider
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'multiple processing sync_queue rows exist for one user/provider; pause the scheduler and let one finish before reapplying'
      USING ERRCODE = '42P17';
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS sync_queue_one_processing
  ON public.sync_queue (user_id, provider)
  WHERE status = 'processing';

COMMENT ON INDEX public.sync_queue_one_processing IS
  'At most one executing sync per user/provider, across initial and non-initial work, so rotating OAuth refresh tokens are serialized.';

-- ---------------------------------------------------------------------------
-- 4. PR 31's client-insert guard, plus the provider allow-list it was missing
--    (PR 31 security round 2 leftover). Unchanged otherwise; its duplicate
--    check is now backed by the index above, and is kept so a browser insert
--    still fails with the stable `sync_already_queued` message rather than an
--    index name.
--
--    `garmin` is deliberately NOT accepted: Garmin is webhook-driven and
--    process-sync-queue rejects a queued garmin task outright, so a client
--    could only ever create a row that is guaranteed to fail.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.sync_queue_guard_client_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $fn$
BEGIN
  -- Only browser roles are clamped; the service role (Edge Functions) and
  -- postgres (migrations, cron) insert as they need to.
  IF current_user NOT IN ('anon', 'authenticated') THEN
    RETURN NEW;
  END IF;

  NEW.created_at := now();
  NEW.status := 'pending';
  NEW.started_at := NULL;
  NEW.completed_at := NULL;
  NEW.error_message := NULL;
  NEW.retry_count := 0;
  NEW.sync_type := coalesce(NEW.sync_type, 'incremental');

  IF NEW.sync_type NOT IN ('initial', 'incremental', 'manual') THEN
    RAISE EXCEPTION 'invalid sync_type %', NEW.sync_type USING ERRCODE = '22023';
  END IF;

  IF NEW.provider IS NULL
     OR NEW.provider NOT IN ('strava', 'fitbit', 'hevy', 'liftosaur') THEN
    RAISE EXCEPTION 'invalid provider %', NEW.provider USING ERRCODE = '22023';
  END IF;

  -- Serialize concurrent inserts for the same pair so the check below holds.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(NEW.user_id::text || ':' || NEW.provider, 31)
  );

  IF EXISTS (
    SELECT 1 FROM public.sync_queue q
    WHERE q.user_id = NEW.user_id
      AND q.provider = NEW.provider
      AND q.status IN ('pending', 'processing')
      -- COALESCE is a SQL keyword expression, not a schema-qualifiable
      -- function, so it is safe under the pinned empty search_path.
      AND (coalesce(q.sync_type, 'incremental') = 'initial')
          = (NEW.sync_type = 'initial')
  ) THEN
    RAISE EXCEPTION 'sync_already_queued'
      USING ERRCODE = '23505',
            DETAIL = 'A sync of this kind is already queued or running for this provider.';
  END IF;

  RETURN NEW;
END
$fn$;

REVOKE ALL ON FUNCTION private.sync_queue_guard_client_insert()
  FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. Self-check: the index exists with the shape this migration promises, and
--    no duplicate survived step 2.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_duplicates bigint;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indexrelid
    JOIN pg_class t ON t.oid = i.indrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'sync_queue'
      AND c.relname = 'sync_queue_one_active'
      AND i.indisunique
      AND i.indpred IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'sync_queue_one_active is missing, not unique, or not partial'
      USING ERRCODE = '42P17';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indexrelid
    JOIN pg_class t ON t.oid = i.indrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'sync_queue'
      AND c.relname = 'sync_queue_one_processing'
      AND i.indisunique
      AND i.indpred IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'sync_queue_one_processing is missing, not unique, or not partial'
      USING ERRCODE = '42P17';
  END IF;

  SELECT count(*) INTO v_duplicates
  FROM (
    SELECT 1
    FROM public.sync_queue q
    WHERE q.status IN ('pending', 'processing')
    GROUP BY q.user_id, q.provider,
             (coalesce(q.sync_type, 'incremental') = 'initial')
    HAVING count(*) > 1
  ) d;

  IF v_duplicates > 0 THEN
    RAISE EXCEPTION 'sync_queue still has % duplicated active group(s)', v_duplicates
      USING ERRCODE = '42P17';
  END IF;
END
$$;

COMMIT;
