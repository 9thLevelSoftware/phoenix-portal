-- Per-set telemetry storage (F-015 / F-037).
--
-- rep_telemetry stored one row per force-curve sample (~100 rows per second
-- per cable), so a single set cost thousands of heap tuples, index entries
-- and per-row headers. Samples now live one row per set in set_telemetry, as
-- aligned columnar arrays ordered by (timestamp_ms, id). Large arrays are
-- TOASTed and compressed by Postgres, and the per-sample tuple and index
-- overhead disappears.
--
-- Compatibility: `public.rep_telemetry` becomes a security_invoker VIEW with
-- the same columns and one row per sample, so every reader (the replay page
-- through telemetry_points, the GDPR export, the ownership probe's legacy
-- half, the pgTAP suite) sees exactly what it saw before. The old table is
-- renamed rep_telemetry_legacy and KEPT: the view serves its rows for any set
-- that has not been folded into set_telemetry yet, and nothing is deleted
-- here. private.backfill_set_telemetry folds legacy sets in chunks (operator
-- run, see the tail of this file); dropping the legacy table is a later,
-- separate migration once the backfill is verified.
--
-- Writers: replace_session_children writes set_telemetry directly (below).
-- Single-row INSERTs into the rep_telemetry view (service role, fixtures)
-- are routed by an INSTEAD OF trigger. The view grants no UPDATE or DELETE.
-- Every sample id stays globally unique, as the old primary key made it:
-- set_telemetry_sample_ids (section 1b) is a trigger-maintained unique index.
--
-- Read gating is unchanged: set_telemetry and rep_telemetry_legacy carry the
-- same INFERNO SELECT policy as rep_telemetry had (20260920003800), and both
-- views are security_invoker, so they inherit it.
--
-- Idempotent: safe to re-run. Timestamped after 20260922120000.

-- ---------------------------------------------------------------------------
-- 0. Retired component RPCs
-- ---------------------------------------------------------------------------
-- replace_session_components and upsert_workout_sessions_with_components
-- (20260920120000) are the retired component write path; nothing calls them
-- (mobile-sync-push writes children through replace_session_children). They
-- INSERT ... ON CONFLICT into rep_telemetry, which becomes a view below, so
-- they are dropped, every overload, before that happens. Never recreated.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
      FROM pg_catalog.pg_proc p
      JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN ('replace_session_components', 'upsert_workout_sessions_with_components')
  LOOP
    EXECUTE pg_catalog.format('DROP FUNCTION IF EXISTS %s', r.sig);
  END LOOP;
END
$$;
DROP FUNCTION IF EXISTS public.replace_session_components(UUID, UUID[], JSONB, JSONB, JSONB, JSONB);
DROP FUNCTION IF EXISTS public.upsert_workout_sessions_with_components(UUID, BOOLEAN, JSONB, UUID[], JSONB, JSONB, JSONB, JSONB);

-- ---------------------------------------------------------------------------
-- 1. Storage
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.set_telemetry (
  set_id UUID PRIMARY KEY REFERENCES public.sets(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  sample_count INTEGER NOT NULL,
  ids UUID[] NOT NULL,
  timestamp_ms BIGINT[] NOT NULL,
  force_n NUMERIC[] NOT NULL,
  velocity_mps NUMERIC[] NOT NULL,
  position_mm NUMERIC[] NOT NULL,
  cable TEXT[] NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT set_telemetry_columns_aligned CHECK (
    sample_count = cardinality(ids)
    AND cardinality(timestamp_ms) = cardinality(ids)
    AND cardinality(force_n) = cardinality(ids)
    AND cardinality(velocity_mps) = cardinality(ids)
    AND cardinality(position_mm) = cardinality(ids)
    AND cardinality(cable) = cardinality(ids)
  )
);

CREATE INDEX IF NOT EXISTS set_telemetry_user_id_idx
  ON public.set_telemetry (user_id);
-- Sample-id lookups (the push ownership probe, id moves): ids && ARRAY[...].
CREATE INDEX IF NOT EXISTS set_telemetry_ids_gin
  ON public.set_telemetry USING gin (ids);

ALTER TABLE public.set_telemetry ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own set telemetry" ON public.set_telemetry;
CREATE POLICY "Users can view own set telemetry"
  ON public.set_telemetry FOR SELECT
  TO authenticated
  USING (
    (select auth.uid()) = user_id
    AND (select public.user_has_min_tier('INFERNO'))
  );

REVOKE ALL ON public.set_telemetry FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.set_telemetry TO authenticated;
GRANT ALL ON public.set_telemetry TO service_role;

COMMENT ON TABLE public.set_telemetry IS
  'Force-curve samples, one row per set as aligned arrays ordered by (timestamp_ms, id). Read per sample through the rep_telemetry view. INFERNO-gated. 20260925200000.';

-- ---------------------------------------------------------------------------
-- 1b. Sample ids stay globally unique
-- ---------------------------------------------------------------------------
-- rep_telemetry.id was a primary key. Inside per-set arrays nothing stops two
-- concurrent pushes from storing the same sample id in two sets, and an
-- EXISTS pre-check cannot close that race. This side table restores the key
-- at the database level: one row per stored sample id, maintained by a
-- trigger on every set_telemetry write (replace_session_children, the view's
-- INSTEAD OF insert, the backfill), so a duplicate raises 23505 atomically;
-- a concurrent writer of the same id blocks on the index and then fails.
-- Rows go with their set (ON DELETE CASCADE), and so with the account:
-- set_telemetry cascades from auth.users. It is an index, not user content,
-- so it is not exported (see EXCLUDED in _shared/userDataManifest.ts).
-- Owner-only: RLS on, no policies, no grants; only the trigger writes it.
CREATE TABLE IF NOT EXISTS public.set_telemetry_sample_ids (
  id UUID PRIMARY KEY,
  set_id UUID NOT NULL REFERENCES public.set_telemetry(set_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS set_telemetry_sample_ids_set_id_idx
  ON public.set_telemetry_sample_ids (set_id);

ALTER TABLE public.set_telemetry_sample_ids ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.set_telemetry_sample_ids
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON TABLE public.set_telemetry_sample_ids IS
  'Unique index of every sample id stored in set_telemetry.ids (the old rep_telemetry primary key). Trigger-maintained, owner-only, not user content. 20260925200000.';

-- SECURITY DEFINER so the side table needs no grants; a trigger function
-- cannot be called directly. The legacy check keeps an id unique against an
-- unfolded legacy row of ANOTHER set too (folding a set re-uses its own legacy
-- ids by design). rep_telemetry_legacy receives no new rows, so that check
-- has no race.
CREATE OR REPLACE FUNCTION private.set_telemetry_sample_ids_sync()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_added UUID[];
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_added := NEW.ids;
  ELSE
    IF (SELECT count(DISTINCT x) FROM unnest(NEW.ids) AS x) <> cardinality(NEW.ids) THEN
      RAISE EXCEPTION 'duplicate key value violates unique constraint "set_telemetry_sample_ids_pkey"'
        USING ERRCODE = '23505',
              DETAIL = format('set %s holds a sample id twice', NEW.set_id);
    END IF;
    -- Set differences, hashed: a move strips a few ids from a large set.
    DELETE FROM public.set_telemetry_sample_ids s
     WHERE s.set_id = OLD.set_id
       AND s.id IN (SELECT unnest(OLD.ids) EXCEPT SELECT unnest(NEW.ids));
    SELECT array_agg(d.x) INTO v_added
      FROM (SELECT unnest(NEW.ids) AS x EXCEPT SELECT unnest(OLD.ids)) AS d;
  END IF;

  IF v_added IS NULL OR cardinality(v_added) = 0 THEN
    RETURN NULL;
  END IF;

  IF to_regclass('public.rep_telemetry_legacy') IS NOT NULL THEN
    PERFORM 1
      FROM public.rep_telemetry_legacy l
     WHERE l.id = ANY(v_added)
       AND l.set_id <> NEW.set_id
     LIMIT 1;
    IF FOUND THEN
      RAISE EXCEPTION 'duplicate key value violates unique constraint "set_telemetry_sample_ids_pkey"'
        USING ERRCODE = '23505',
              DETAIL = format('a sample id for set %s is stored for another set in rep_telemetry_legacy', NEW.set_id);
    END IF;
  END IF;

  INSERT INTO public.set_telemetry_sample_ids (id, set_id)
  SELECT x, NEW.set_id FROM unnest(v_added) AS x;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION private.set_telemetry_sample_ids_sync()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS set_telemetry_sample_ids_sync ON public.set_telemetry;
CREATE TRIGGER set_telemetry_sample_ids_sync
  AFTER INSERT OR UPDATE OF ids ON public.set_telemetry
  FOR EACH ROW EXECUTE FUNCTION private.set_telemetry_sample_ids_sync();

-- Rows written before the trigger existed (a re-run). A genuine cross-set
-- duplicate among them raises 23505 here rather than being hidden.
INSERT INTO public.set_telemetry_sample_ids (id, set_id)
SELECT x, t.set_id
FROM public.set_telemetry t
CROSS JOIN LATERAL unnest(t.ids) AS x
WHERE NOT EXISTS (
  SELECT 1 FROM public.set_telemetry_sample_ids s
  WHERE s.id = x AND s.set_id = t.set_id
);

-- ---------------------------------------------------------------------------
-- 2. The per-sample table keeps its rows under a new name
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.rep_telemetry_legacy') IS NULL
     AND EXISTS (
       SELECT 1
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public'
         AND c.relname = 'rep_telemetry'
         AND c.relkind = 'r'
     ) THEN
    ALTER TABLE public.rep_telemetry RENAME TO rep_telemetry_legacy;
  END IF;
END
$$;

-- RENAME keeps ACLs and policies. Clients never write the legacy table (a
-- write there would bypass set_telemetry_sample_ids and be hidden by the
-- view once its set is folded), whatever grants or insert policy an older or
-- dashboard-drifted database carried over from rep_telemetry.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.rep_telemetry_legacy FROM PUBLIC, anon, authenticated;
DROP POLICY IF EXISTS "Users can insert own telemetry" ON public.rep_telemetry_legacy;

COMMENT ON TABLE public.rep_telemetry_legacy IS
  'Per-sample force-curve rows written before 20260925200000. Read through the rep_telemetry view until private.backfill_set_telemetry folds each set into set_telemetry; kept until that is verified.';

-- ---------------------------------------------------------------------------
-- 3. Per-sample compatibility views
-- ---------------------------------------------------------------------------
-- Same columns, in the same order, as the old table. A set folded into
-- set_telemetry hides its legacy rows, so no sample is served twice.
CREATE OR REPLACE VIEW public.rep_telemetry
WITH (security_invoker = true) AS
SELECT s.id, t.set_id, s.timestamp_ms, s.force_n, s.velocity_mps,
       s.position_mm, s.cable, t.user_id
FROM public.set_telemetry t
CROSS JOIN LATERAL unnest(t.ids, t.timestamp_ms, t.force_n, t.velocity_mps,
                          t.position_mm, t.cable)
  AS s(id, timestamp_ms, force_n, velocity_mps, position_mm, cable)
UNION ALL
SELECT l.id, l.set_id, l.timestamp_ms, l.force_n, l.velocity_mps,
       l.position_mm, l.cable, l.user_id
FROM public.rep_telemetry_legacy l
WHERE NOT EXISTS (
  SELECT 1 FROM public.set_telemetry t2
   WHERE t2.set_id = l.set_id AND t2.user_id = l.user_id
);

COMMENT ON VIEW public.rep_telemetry IS
  'One row per force-curve sample, over set_telemetry plus unfolded legacy rows. security_invoker: inherits the INFERNO read gate. 20260925200000.';

-- The replay page reads this name. It was bound to the renamed table's OID,
-- so it is re-pointed at the view.
CREATE OR REPLACE VIEW public.telemetry_points
WITH (security_invoker = true) AS
SELECT id, set_id, timestamp_ms, force_n, velocity_mps, position_mm, cable,
       user_id
FROM public.rep_telemetry;

REVOKE ALL ON public.rep_telemetry FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.rep_telemetry TO authenticated;
GRANT SELECT, INSERT ON public.rep_telemetry TO service_role;

REVOKE ALL ON public.telemetry_points FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.telemetry_points TO authenticated;
GRANT SELECT ON public.telemetry_points TO service_role;

-- ---------------------------------------------------------------------------
-- 4. Single-sample INSERTs through the view
-- ---------------------------------------------------------------------------
-- Keeps the old table's contract for one-row writers: NOT NULL columns, a
-- unique sample id across both stores, and the set's owner. A set that still
-- has legacy rows is folded first, so the new sample does not hide them.
-- Appended samples are not re-sorted; readers order by (timestamp_ms, id).
CREATE OR REPLACE FUNCTION public.rep_telemetry_view_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_id UUID := COALESCE(NEW.id, gen_random_uuid());
  v_rows INTEGER;
BEGIN
  IF NEW.set_id IS NULL OR NEW.user_id IS NULL OR NEW.timestamp_ms IS NULL THEN
    RAISE EXCEPTION 'null value in a NOT NULL column of rep_telemetry (set_id, user_id, timestamp_ms)'
      USING ERRCODE = '23502';
  END IF;

  IF EXISTS (SELECT 1 FROM public.set_telemetry t WHERE t.ids @> ARRAY[v_id])
     OR EXISTS (SELECT 1 FROM public.rep_telemetry_legacy l WHERE l.id = v_id) THEN
    RAISE EXCEPTION 'duplicate key value violates unique constraint "rep_telemetry_pkey"'
      USING ERRCODE = '23505',
            DETAIL = format('Key (id)=(%s) already exists.', v_id);
  END IF;

  INSERT INTO public.set_telemetry
    (set_id, user_id, sample_count, ids, timestamp_ms, force_n, velocity_mps,
     position_mm, cable)
  SELECT l.set_id, l.user_id, count(*)::int,
         array_agg(l.id ORDER BY l.timestamp_ms, l.id),
         array_agg(l.timestamp_ms ORDER BY l.timestamp_ms, l.id),
         array_agg(l.force_n ORDER BY l.timestamp_ms, l.id),
         array_agg(l.velocity_mps ORDER BY l.timestamp_ms, l.id),
         array_agg(l.position_mm ORDER BY l.timestamp_ms, l.id),
         array_agg(l.cable ORDER BY l.timestamp_ms, l.id)
  FROM public.rep_telemetry_legacy l
  WHERE l.set_id = NEW.set_id AND l.user_id = NEW.user_id
  GROUP BY l.set_id, l.user_id
  ON CONFLICT (set_id) DO NOTHING;

  INSERT INTO public.set_telemetry AS t
    (set_id, user_id, sample_count, ids, timestamp_ms, force_n, velocity_mps,
     position_mm, cable)
  VALUES (NEW.set_id, NEW.user_id, 1, ARRAY[v_id], ARRAY[NEW.timestamp_ms],
          ARRAY[NEW.force_n], ARRAY[NEW.velocity_mps], ARRAY[NEW.position_mm],
          ARRAY[NEW.cable])
  ON CONFLICT (set_id) DO UPDATE SET
    sample_count = t.sample_count + 1,
    ids = t.ids || EXCLUDED.ids,
    timestamp_ms = t.timestamp_ms || EXCLUDED.timestamp_ms,
    force_n = t.force_n || EXCLUDED.force_n,
    velocity_mps = t.velocity_mps || EXCLUDED.velocity_mps,
    position_mm = t.position_mm || EXCLUDED.position_mm,
    cable = t.cable || EXCLUDED.cable,
    updated_at = now()
  WHERE t.user_id = EXCLUDED.user_id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    RAISE EXCEPTION 'set % already holds another user''s telemetry', NEW.set_id
      USING ERRCODE = '23505';
  END IF;

  NEW.id := v_id;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.rep_telemetry_view_insert() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS rep_telemetry_view_insert ON public.rep_telemetry;
CREATE TRIGGER rep_telemetry_view_insert
  INSTEAD OF INSERT ON public.rep_telemetry
  FOR EACH ROW EXECUTE FUNCTION public.rep_telemetry_view_insert();

-- telemetry_points used to be a simple, auto-updatable view over the table;
-- over the union view it is not, so it takes the same insert route.
DROP TRIGGER IF EXISTS telemetry_points_view_insert ON public.telemetry_points;
CREATE TRIGGER telemetry_points_view_insert
  INSTEAD OF INSERT ON public.telemetry_points
  FOR EACH ROW EXECUTE FUNCTION public.rep_telemetry_view_insert();

-- Samples are rewritten per set by replace_session_children, never edited in
-- place. Without these triggers an UPDATE/DELETE on the non-updatable views
-- fails with SQLSTATE 55000; with them every role gets the same 42501
-- refusal the table's missing client grants used to produce.
CREATE OR REPLACE FUNCTION public.rep_telemetry_view_refuse_write()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'permission denied: % is read-only; telemetry is rewritten per set by replace_session_children', TG_TABLE_NAME
    USING ERRCODE = '42501';
END;
$$;

REVOKE ALL ON FUNCTION public.rep_telemetry_view_refuse_write() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS rep_telemetry_view_refuse_write ON public.rep_telemetry;
CREATE TRIGGER rep_telemetry_view_refuse_write
  INSTEAD OF UPDATE OR DELETE ON public.rep_telemetry
  FOR EACH ROW EXECUTE FUNCTION public.rep_telemetry_view_refuse_write();

DROP TRIGGER IF EXISTS telemetry_points_view_refuse_write ON public.telemetry_points;
CREATE TRIGGER telemetry_points_view_refuse_write
  INSTEAD OF UPDATE OR DELETE ON public.telemetry_points
  FOR EACH ROW EXECUTE FUNCTION public.rep_telemetry_view_refuse_write();

-- ---------------------------------------------------------------------------
-- 5. replace_session_children writes per-set rows
-- ---------------------------------------------------------------------------
-- Signature, grants and tier-1 / tier-2 re-linking are unchanged from
-- 20260922120000; only the stash read and the final telemetry write move to
-- set_telemetry.

CREATE OR REPLACE FUNCTION public.replace_session_children(
  p_user_id UUID,
  p_session_ids UUID[],
  p_exercises JSONB,
  p_sets JSONB,
  p_rep_summaries JSONB,
  p_rep_telemetry JSONB,
  p_progress JSONB DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_exercises INT := 0;
  v_sets INT := 0;
  v_rep_summaries INT := 0;
  v_rep_telemetry INT := 0;
  v_rep_telemetry_preserved INT := 0;
  v_payload_telemetry_ids UUID[];
  v_exercise_progress INT := 0;
  -- Mirrors MAX_TELEMETRY_POINTS in supabase/functions/mobile-sync-push/index.ts.
  c_max_session_telemetry CONSTANT INT := 50000;
BEGIN
  -- 0. Stash telemetry that can be re-linked unambiguously (see header).
  --    Must run before step 1, whose CASCADE deletes it. The temp table is
  --    dropped at commit; it is cleared first in case the function is called
  --    more than once in the same transaction.
  IF to_regclass('pg_temp.rsc_telemetry_stash') IS NULL THEN
    CREATE TEMP TABLE rsc_telemetry_stash (
      id UUID,
      set_id UUID,
      session_id UUID,
      user_id UUID,
      timestamp_ms BIGINT,
      force_n NUMERIC,
      velocity_mps NUMERIC,
      position_mm NUMERIC,
      cable TEXT
    ) ON COMMIT DROP;
  ELSE
    DELETE FROM pg_temp.rsc_telemetry_stash;
  END IF;

  IF p_session_ids IS NOT NULL AND array_length(p_session_ids, 1) IS NOT NULL THEN
    INSERT INTO pg_temp.rsc_telemetry_stash
      (id, set_id, session_id, user_id, timestamp_ms, force_n, velocity_mps,
       position_mm, cable)
    WITH old_sets AS (
      SELECT
        s.id AS set_id,
        e.id AS exercise_row_id,
        e.session_id,
        COALESCE('id:' || NULLIF(btrim(e.exercise_id), ''),
                 'name:' || lower(btrim(e.name))) AS identity,
        e.order_index,
        s.set_number
      FROM public.exercises e
      JOIN public.sets s ON s.exercise_id = e.id
      WHERE e.session_id = ANY(p_session_ids)
        AND e.user_id = p_user_id
    ),
    new_exercises AS (
      SELECT ne.id, ne.session_id, ne.name, ne.exercise_id, ne.order_index
      FROM jsonb_to_recordset(COALESCE(p_exercises, '[]'::jsonb)) AS ne(
        id UUID,
        session_id UUID,
        user_id UUID,
        name TEXT,
        exercise_id TEXT,
        order_index INT
      )
      WHERE ne.session_id = ANY(p_session_ids)
        AND ne.user_id = p_user_id
    ),
    payload_telemetry_sets AS (
      SELECT DISTINCT t.set_id
      FROM jsonb_to_recordset(COALESCE(p_rep_telemetry, '[]'::jsonb)) AS t(set_id UUID)
    ),
    new_sets AS (
      SELECT
        ns.id AS set_id,
        ne.id AS exercise_row_id,
        ne.session_id,
        COALESCE('id:' || NULLIF(btrim(ne.exercise_id), ''),
                 'name:' || lower(btrim(ne.name))) AS identity,
        ne.order_index,
        ns.set_number,
        EXISTS (
          SELECT 1 FROM payload_telemetry_sets pt WHERE pt.set_id = ns.id
        ) AS has_payload_telemetry
      FROM jsonb_to_recordset(COALESCE(p_sets, '[]'::jsonb)) AS ns(
        id UUID,
        exercise_id UUID,
        set_number INT
      )
      JOIN new_exercises ne ON ne.id = ns.exercise_id
    ),
    -- Uniqueness is counted over ALL sets on each side (including new sets
    -- that carry payload telemetry, and sets outside the tier's candidates),
    -- so ambiguity can never be hidden by a filter.
    old_keys AS (
      SELECT o.*,
             count(*) OVER (PARTITION BY o.session_id, o.exercise_row_id, o.set_number) AS id_key_count,
             count(*) OVER (PARTITION BY o.session_id, o.identity, o.order_index, o.set_number) AS legacy_key_count,
             EXISTS (
               SELECT 1 FROM new_exercises ne
               WHERE ne.id = o.exercise_row_id AND ne.session_id = o.session_id
             ) AS exercise_row_kept
      FROM old_sets o
    ),
    new_keys AS (
      SELECT n.*,
             count(*) OVER (PARTITION BY n.session_id, n.exercise_row_id, n.set_number) AS id_key_count,
             count(*) OVER (PARTITION BY n.session_id, n.identity, n.order_index, n.set_number) AS legacy_key_count,
             EXISTS (
               SELECT 1 FROM public.exercises e
               WHERE e.id = n.exercise_row_id AND e.session_id = n.session_id
                 AND e.user_id = p_user_id
             ) AS exercise_row_kept
      FROM new_sets n
    ),
    set_map AS (
      -- Tier 1: stable exercise row id + set_number.
      SELECT o.set_id AS old_set_id, n.set_id AS new_set_id, n.session_id
      FROM old_keys o
      JOIN new_keys n
        ON n.session_id = o.session_id
       AND n.exercise_row_id = o.exercise_row_id
       AND n.set_number = o.set_number
      WHERE o.id_key_count = 1
        AND n.id_key_count = 1
        AND NOT n.has_payload_telemetry
      UNION ALL
      -- Tier 2: legacy fallback, only between exercises whose row id did not
      -- survive on the other side.
      SELECT o.set_id, n.set_id, n.session_id
      FROM old_keys o
      JOIN new_keys n
        ON n.session_id = o.session_id
       AND n.identity = o.identity
       AND n.order_index = o.order_index
       AND n.set_number = o.set_number
      WHERE NOT o.exercise_row_kept
        AND NOT n.exercise_row_kept
        AND o.legacy_key_count = 1
        AND n.legacy_key_count = 1
        AND NOT n.has_payload_telemetry
    )
    -- Stored samples of the old sets: per-set storage, plus the legacy rows of
    -- a set the backfill has not folded yet (20260925200000). Joined per set
    -- so only the affected sets are unpacked.
    SELECT s.id, m.new_set_id, m.session_id, t.user_id, s.timestamp_ms,
           s.force_n, s.velocity_mps, s.position_mm, s.cable
    FROM set_map m
    JOIN public.set_telemetry t
      ON t.set_id = m.old_set_id AND t.user_id = p_user_id
    CROSS JOIN LATERAL unnest(t.ids, t.timestamp_ms, t.force_n,
                              t.velocity_mps, t.position_mm, t.cable)
      AS s(id, timestamp_ms, force_n, velocity_mps, position_mm, cable)
    UNION ALL
    SELECT l.id, m.new_set_id, m.session_id, l.user_id, l.timestamp_ms,
           l.force_n, l.velocity_mps, l.position_mm, l.cable
    FROM set_map m
    JOIN public.rep_telemetry_legacy l
      ON l.set_id = m.old_set_id AND l.user_id = p_user_id
    WHERE NOT EXISTS (
      SELECT 1 FROM public.set_telemetry t2
   WHERE t2.set_id = l.set_id AND t2.user_id = l.user_id
    );

    -- Per-session bound (see header): stash + payload telemetry for the
    -- session must not exceed c_max_session_telemetry, else delete as before.
    DELETE FROM pg_temp.rsc_telemetry_stash st
    USING (
      SELECT k.session_id
      FROM pg_temp.rsc_telemetry_stash k
      GROUP BY k.session_id
      HAVING count(*) + (
        SELECT count(*)
        FROM jsonb_to_recordset(COALESCE(p_rep_telemetry, '[]'::jsonb)) AS t(set_id UUID)
        JOIN jsonb_to_recordset(COALESCE(p_sets, '[]'::jsonb)) AS ns(id UUID, exercise_id UUID)
          ON ns.id = t.set_id
        JOIN jsonb_to_recordset(COALESCE(p_exercises, '[]'::jsonb)) AS ne(id UUID, session_id UUID)
          ON ne.id = ns.exercise_id
        WHERE ne.session_id = k.session_id
      ) > c_max_session_telemetry
    ) over_cap
    WHERE st.session_id = over_cap.session_id;
  END IF;

  -- 1. Clear existing exercises for the affected sessions. ON DELETE CASCADE
  --    removes their sets, rep_summaries and rep_telemetry. Scoped by user_id
  --    as defence-in-depth even though this runs as service_role.
  IF p_session_ids IS NOT NULL AND array_length(p_session_ids, 1) IS NOT NULL THEN
    DELETE FROM public.exercises
    WHERE session_id = ANY(p_session_ids)
      AND user_id = p_user_id;
  END IF;

  -- 2. Re-insert exercises. cable_count (PR 28): absent/null -> NULL
  --    (unknown); the column CHECK rejects anything but 1 or 2.
  IF p_exercises IS NOT NULL AND jsonb_array_length(p_exercises) > 0 THEN
    INSERT INTO public.exercises
      (id, session_id, user_id, name, exercise_id, muscle_group, order_index,
       cable_count)
    SELECT id, session_id, user_id, name, exercise_id, muscle_group, order_index,
           cable_count
    FROM jsonb_to_recordset(p_exercises) AS x(
      id UUID,
      session_id UUID,
      user_id UUID,
      name TEXT,
      exercise_id TEXT,
      muscle_group TEXT,
      order_index INT,
      cable_count SMALLINT
    )
    ON CONFLICT (id) DO UPDATE SET
      session_id = EXCLUDED.session_id,
      user_id = EXCLUDED.user_id,
      name = EXCLUDED.name,
      exercise_id = EXCLUDED.exercise_id,
      muscle_group = EXCLUDED.muscle_group,
      order_index = EXCLUDED.order_index,
      cable_count = EXCLUDED.cable_count;
    GET DIAGNOSTICS v_exercises = ROW_COUNT;
  END IF;

  -- 3. Re-insert sets.
  IF p_sets IS NOT NULL AND jsonb_array_length(p_sets) > 0 THEN
    INSERT INTO public.sets
      (id, exercise_id, user_id, set_number, target_reps, actual_reps,
       weight_kg, rpe, is_pr, notes, workout_mode)
    SELECT id, exercise_id, user_id, set_number, target_reps, actual_reps,
           weight_kg, rpe, is_pr, notes, workout_mode
    FROM jsonb_to_recordset(p_sets) AS x(
      id UUID,
      exercise_id UUID,
      user_id UUID,
      set_number INT,
      target_reps INT,
      actual_reps INT,
      weight_kg NUMERIC,
      rpe NUMERIC,
      is_pr BOOLEAN,
      notes TEXT,
      workout_mode TEXT
    )
    ON CONFLICT (id) DO UPDATE SET
      exercise_id = EXCLUDED.exercise_id,
      user_id = EXCLUDED.user_id,
      set_number = EXCLUDED.set_number,
      target_reps = EXCLUDED.target_reps,
      actual_reps = EXCLUDED.actual_reps,
      weight_kg = EXCLUDED.weight_kg,
      rpe = EXCLUDED.rpe,
      is_pr = EXCLUDED.is_pr,
      notes = EXCLUDED.notes,
      workout_mode = EXCLUDED.workout_mode;
    GET DIAGNOSTICS v_sets = ROW_COUNT;
  END IF;

  -- 4. Re-insert rep_summaries.
  IF p_rep_summaries IS NOT NULL AND jsonb_array_length(p_rep_summaries) > 0 THEN
    INSERT INTO public.rep_summaries
      (id, set_id, user_id, rep_number, mean_velocity_mps, peak_velocity_mps,
       mean_force_n, peak_force_n, power_watts, rom_mm, tut_ms, left_force_avg,
       right_force_avg, asymmetry_pct, vbt_zone)
    SELECT id, set_id, user_id, rep_number, mean_velocity_mps, peak_velocity_mps,
           mean_force_n, peak_force_n, power_watts, rom_mm, tut_ms, left_force_avg,
           right_force_avg, asymmetry_pct, vbt_zone
    FROM jsonb_to_recordset(p_rep_summaries) AS x(
      id UUID,
      set_id UUID,
      user_id UUID,
      rep_number INT,
      mean_velocity_mps NUMERIC,
      peak_velocity_mps NUMERIC,
      mean_force_n NUMERIC,
      peak_force_n NUMERIC,
      power_watts NUMERIC,
      rom_mm NUMERIC,
      tut_ms INT,
      left_force_avg NUMERIC,
      right_force_avg NUMERIC,
      asymmetry_pct NUMERIC,
      vbt_zone TEXT
    )
    ON CONFLICT (id) DO UPDATE SET
      set_id = EXCLUDED.set_id,
      user_id = EXCLUDED.user_id,
      rep_number = EXCLUDED.rep_number,
      mean_velocity_mps = EXCLUDED.mean_velocity_mps,
      peak_velocity_mps = EXCLUDED.peak_velocity_mps,
      mean_force_n = EXCLUDED.mean_force_n,
      peak_force_n = EXCLUDED.peak_force_n,
      power_watts = EXCLUDED.power_watts,
      rom_mm = EXCLUDED.rom_mm,
      tut_ms = EXCLUDED.tut_ms,
      left_force_avg = EXCLUDED.left_force_avg,
      right_force_avg = EXCLUDED.right_force_avg,
      asymmetry_pct = EXCLUDED.asymmetry_pct,
      vbt_zone = EXCLUDED.vbt_zone;
    GET DIAGNOSTICS v_rep_summaries = ROW_COUNT;
  END IF;

  -- 5 + 6. Write telemetry in per-set form (set_telemetry, 20260925200000).
  --    The per-sample semantics are unchanged: payload samples upsert by id
  --    (an id stored for another set moves to this one), and the stashed
  --    samples re-link without overwriting a payload sample. A duplicate id
  --    inside the payload is refused, as the old ON CONFLICT DO UPDATE refused
  --    to touch one row twice.
  IF to_regclass('pg_temp.rsc_telemetry_write') IS NULL THEN
    CREATE TEMP TABLE rsc_telemetry_write (
      id UUID PRIMARY KEY,
      set_id UUID NOT NULL,
      user_id UUID NOT NULL,
      timestamp_ms BIGINT NOT NULL,
      force_n NUMERIC,
      velocity_mps NUMERIC,
      position_mm NUMERIC,
      cable TEXT,
      from_payload BOOLEAN NOT NULL
    ) ON COMMIT DROP;
  ELSE
    DELETE FROM pg_temp.rsc_telemetry_write;
  END IF;

  IF p_rep_telemetry IS NOT NULL AND jsonb_array_length(p_rep_telemetry) > 0 THEN
    INSERT INTO pg_temp.rsc_telemetry_write
      (id, set_id, user_id, timestamp_ms, force_n, velocity_mps, position_mm,
       cable, from_payload)
    SELECT id, set_id, user_id, timestamp_ms, force_n, velocity_mps,
           position_mm, cable, TRUE
    FROM jsonb_to_recordset(p_rep_telemetry) AS x(
      id UUID,
      set_id UUID,
      user_id UUID,
      timestamp_ms BIGINT,
      force_n NUMERIC,
      velocity_mps NUMERIC,
      position_mm NUMERIC,
      cable TEXT
    );
    GET DIAGNOSTICS v_rep_telemetry = ROW_COUNT;

    -- An id already stored for another set moves here.
    SELECT array_agg(w.id) INTO v_payload_telemetry_ids
    FROM pg_temp.rsc_telemetry_write w
    WHERE w.from_payload;

    UPDATE public.set_telemetry t
       SET (sample_count, ids, timestamp_ms, force_n, velocity_mps,
            position_mm, cable, updated_at) = (
         SELECT count(*)::int,
                COALESCE(array_agg(s.id ORDER BY s.ord), '{}'),
                COALESCE(array_agg(s.timestamp_ms ORDER BY s.ord), '{}'),
                COALESCE(array_agg(s.force_n ORDER BY s.ord), '{}'),
                COALESCE(array_agg(s.velocity_mps ORDER BY s.ord), '{}'),
                COALESCE(array_agg(s.position_mm ORDER BY s.ord), '{}'),
                COALESCE(array_agg(s.cable ORDER BY s.ord), '{}'),
                now()
         FROM unnest(t.ids, t.timestamp_ms, t.force_n, t.velocity_mps,
                     t.position_mm, t.cable) WITH ORDINALITY
           AS s(id, timestamp_ms, force_n, velocity_mps, position_mm, cable, ord)
         WHERE NOT (s.id = ANY(v_payload_telemetry_ids))
       )
     WHERE t.ids && v_payload_telemetry_ids;
    DELETE FROM public.set_telemetry t
     WHERE t.sample_count = 0;
    DELETE FROM public.rep_telemetry_legacy l
     WHERE l.id = ANY(v_payload_telemetry_ids);
  END IF;

  INSERT INTO pg_temp.rsc_telemetry_write
    (id, set_id, user_id, timestamp_ms, force_n, velocity_mps, position_mm,
     cable, from_payload)
  SELECT id, set_id, user_id, timestamp_ms, force_n, velocity_mps,
         position_mm, cable, FALSE
  FROM pg_temp.rsc_telemetry_stash
  ON CONFLICT (id) DO NOTHING;
  GET DIAGNOSTICS v_rep_telemetry_preserved = ROW_COUNT;

  -- A target set that already holds samples (payload telemetry for a set
  -- outside this push's sessions) keeps them, including legacy rows the
  -- backfill has not folded yet. Payload ids were removed from those rows
  -- above, so nothing here can shadow a payload sample.
  INSERT INTO pg_temp.rsc_telemetry_write
    (id, set_id, user_id, timestamp_ms, force_n, velocity_mps, position_mm,
     cable, from_payload)
  SELECT s.id, t.set_id, t.user_id, s.timestamp_ms, s.force_n, s.velocity_mps,
         s.position_mm, s.cable, FALSE
  FROM public.set_telemetry t
  CROSS JOIN LATERAL unnest(t.ids, t.timestamp_ms, t.force_n, t.velocity_mps,
                            t.position_mm, t.cable)
    AS s(id, timestamp_ms, force_n, velocity_mps, position_mm, cable)
  WHERE t.set_id IN (SELECT DISTINCT w.set_id FROM pg_temp.rsc_telemetry_write w)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO pg_temp.rsc_telemetry_write
    (id, set_id, user_id, timestamp_ms, force_n, velocity_mps, position_mm,
     cable, from_payload)
  SELECT l.id, l.set_id, l.user_id, l.timestamp_ms, l.force_n, l.velocity_mps,
         l.position_mm, l.cable, FALSE
  FROM public.rep_telemetry_legacy l
  WHERE EXISTS (
      SELECT 1 FROM pg_temp.rsc_telemetry_write w
       WHERE w.set_id = l.set_id AND w.user_id = l.user_id
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.set_telemetry t
       WHERE t.set_id = l.set_id AND t.user_id = l.user_id
    )
  ON CONFLICT (id) DO NOTHING;

  DELETE FROM public.set_telemetry t
   WHERE t.set_id IN (SELECT DISTINCT w.set_id FROM pg_temp.rsc_telemetry_write w);

  -- One row per set, samples in (timestamp_ms, id) order. Two owners for one
  -- set collide on the primary key, which rolls the whole call back.
  INSERT INTO public.set_telemetry
    (set_id, user_id, sample_count, ids, timestamp_ms, force_n, velocity_mps,
     position_mm, cable)
  SELECT w.set_id, w.user_id, count(*)::int,
         array_agg(w.id ORDER BY w.timestamp_ms, w.id),
         array_agg(w.timestamp_ms ORDER BY w.timestamp_ms, w.id),
         array_agg(w.force_n ORDER BY w.timestamp_ms, w.id),
         array_agg(w.velocity_mps ORDER BY w.timestamp_ms, w.id),
         array_agg(w.position_mm ORDER BY w.timestamp_ms, w.id),
         array_agg(w.cable ORDER BY w.timestamp_ms, w.id)
  FROM pg_temp.rsc_telemetry_write w
  GROUP BY w.set_id, w.user_id;

  -- 7. Refresh exercise_progress for the affected sessions (F-069). Only when
  --    the caller passes p_progress: NULL (today's 6-argument call) leaves
  --    exercise_progress untouched. An empty array clears the sessions' rows
  --    (for example a re-push that removed every exercise). Omitted/NULL
  --    defaulted columns get their column default, as a PostgREST insert that
  --    omits the key would.
  IF p_progress IS NOT NULL
     AND p_session_ids IS NOT NULL
     AND array_length(p_session_ids, 1) IS NOT NULL THEN
    DELETE FROM public.exercise_progress
    WHERE session_id = ANY(p_session_ids)
      AND user_id = p_user_id;

    INSERT INTO public.exercise_progress
      (user_id, local_profile_id, exercise_name, exercise_id, session_id,
       recorded_at, max_weight_kg, total_volume_kg, estimated_1rm_kg,
       velocity_estimated_1rm_kg, max_reps, set_count)
    SELECT p_user_id, x.local_profile_id, x.exercise_name, x.exercise_id,
           x.session_id, COALESCE(x.recorded_at, now()),
           COALESCE(x.max_weight_kg, 0), COALESCE(x.total_volume_kg, 0),
           COALESCE(x.estimated_1rm_kg, 0), x.velocity_estimated_1rm_kg,
           COALESCE(x.max_reps, 0), COALESCE(x.set_count, 0)
    FROM jsonb_to_recordset(p_progress) AS x(
      user_id UUID,
      local_profile_id TEXT,
      exercise_name TEXT,
      exercise_id TEXT,
      session_id UUID,
      recorded_at TIMESTAMPTZ,
      max_weight_kg NUMERIC,
      total_volume_kg NUMERIC,
      estimated_1rm_kg NUMERIC,
      velocity_estimated_1rm_kg NUMERIC,
      max_reps INT,
      set_count INT
    )
    WHERE x.session_id = ANY(p_session_ids)
      AND x.user_id = p_user_id;
    GET DIAGNOSTICS v_exercise_progress = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object(
    'exercises', v_exercises,
    'sets', v_sets,
    'rep_summaries', v_rep_summaries,
    'rep_telemetry', v_rep_telemetry,
    'rep_telemetry_preserved', v_rep_telemetry_preserved,
    'exercise_progress', v_exercise_progress
  );
END;
$$;

REVOKE ALL ON FUNCTION public.replace_session_children(uuid, uuid[], jsonb, jsonb, jsonb, jsonb, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.replace_session_children(uuid, uuid[], jsonb, jsonb, jsonb, jsonb, jsonb)
  TO service_role;

-- ---------------------------------------------------------------------------
-- 6. Backfill: fold legacy sets into set_telemetry, in chunks
-- ---------------------------------------------------------------------------
-- Owner-only. Keyset over set_id so each call starts where the last one
-- stopped. A set that already has a set_telemetry row (it was re-pushed after
-- this migration, which folded its legacy rows at that time) is skipped.
-- Legacy rows are never deleted here.
--
-- Operator loop, until folded_sets = 0 and last_set_id IS NULL:
--   SELECT * FROM private.backfill_set_telemetry(NULL, 500);
--   SELECT * FROM private.backfill_set_telemetry('<last_set_id>', 500);
CREATE OR REPLACE FUNCTION private.backfill_set_telemetry(
  p_after_set_id UUID DEFAULT NULL,
  p_max_sets INTEGER DEFAULT 500
)
RETURNS TABLE(folded_sets INTEGER, last_set_id UUID)
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_sets UUID[];
  v_folded INTEGER;
BEGIN
  SELECT array_agg(x.set_id ORDER BY x.set_id)
    INTO v_sets
  FROM (
    SELECT DISTINCT l.set_id
    FROM public.rep_telemetry_legacy l
    WHERE (p_after_set_id IS NULL OR l.set_id > p_after_set_id)
      AND NOT EXISTS (
        SELECT 1 FROM public.set_telemetry t
       WHERE t.set_id = l.set_id AND t.user_id = l.user_id
      )
    ORDER BY l.set_id
    LIMIT GREATEST(p_max_sets, 1)
  ) x;

  IF v_sets IS NULL THEN
    RETURN QUERY SELECT 0, NULL::UUID;
    RETURN;
  END IF;

  INSERT INTO public.set_telemetry
    (set_id, user_id, sample_count, ids, timestamp_ms, force_n, velocity_mps,
     position_mm, cable)
  SELECT l.set_id, l.user_id, count(*)::int,
         array_agg(l.id ORDER BY l.timestamp_ms, l.id),
         array_agg(l.timestamp_ms ORDER BY l.timestamp_ms, l.id),
         array_agg(l.force_n ORDER BY l.timestamp_ms, l.id),
         array_agg(l.velocity_mps ORDER BY l.timestamp_ms, l.id),
         array_agg(l.position_mm ORDER BY l.timestamp_ms, l.id),
         array_agg(l.cable ORDER BY l.timestamp_ms, l.id)
  FROM public.rep_telemetry_legacy l
  WHERE l.set_id = ANY(v_sets)
    -- Only the set owner's rows fold. The old client INSERT policy checked
    -- only rep_telemetry.user_id, so a set can hold another account's rows;
    -- those stay in the legacy table, still visible through the owner-aware
    -- view, for the operator to review (never silently hidden).
    AND EXISTS (
      SELECT 1 FROM public.sets s WHERE s.id = l.set_id AND s.user_id = l.user_id
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.set_telemetry t
       WHERE t.set_id = l.set_id AND t.user_id = l.user_id
    )
  GROUP BY l.set_id, l.user_id
  ON CONFLICT (set_id) DO NOTHING;
  GET DIAGNOSTICS v_folded = ROW_COUNT;

  RETURN QUERY SELECT v_folded, v_sets[array_length(v_sets, 1)];
END;
$$;

REVOKE ALL ON FUNCTION private.backfill_set_telemetry(UUID, INTEGER)
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION private.backfill_set_telemetry(UUID, INTEGER) IS
  'Folds rep_telemetry_legacy sets into set_telemetry, p_max_sets per call, keyset on set_id. Idempotent; never deletes legacy rows. 20260925200000.';

-- ---------------------------------------------------------------------------
-- 9. Linear GDPR export of rep_telemetry
-- ---------------------------------------------------------------------------
-- Keyset-paging the view by sample id would unpack every set of the user on
-- each page (the id only exists after unnest), so an export is quadratic in
-- samples. This pages by set instead: the next sets after p_after_set_id, in
-- set_id order, until about p_target_rows samples, unpacked once. Rows are
-- exactly the view's rows for those sets (both stores), in (set_id,
-- timestamp_ms, id) order. Service role only (export-user-data).
CREATE INDEX IF NOT EXISTS set_telemetry_user_set_idx
  ON public.set_telemetry (user_id, set_id);

CREATE OR REPLACE FUNCTION public.export_rep_telemetry_page(
  p_user_id UUID,
  p_after_set_id UUID DEFAULT NULL,
  p_target_rows INTEGER DEFAULT 1000
)
RETURNS TABLE(
  id UUID, set_id UUID, timestamp_ms BIGINT, force_n NUMERIC,
  velocity_mps NUMERIC, position_mm NUMERIC, cable TEXT, user_id UUID
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  WITH candidate AS (
    SELECT t.set_id, t.sample_count::bigint AS n
      FROM public.set_telemetry t
     WHERE t.user_id = p_user_id
       AND (p_after_set_id IS NULL OR t.set_id > p_after_set_id)
    UNION ALL
    SELECT l.set_id, count(*)
      FROM public.rep_telemetry_legacy l
     WHERE l.user_id = p_user_id
       AND (p_after_set_id IS NULL OR l.set_id > p_after_set_id)
       AND NOT EXISTS (
         SELECT 1 FROM public.set_telemetry t2
          WHERE t2.set_id = l.set_id AND t2.user_id = l.user_id
       )
     GROUP BY l.set_id
  ),
  next_sets AS (
    SELECT c.set_id, sum(c.n) AS n
      FROM candidate c
     GROUP BY c.set_id
     ORDER BY c.set_id
     LIMIT GREATEST(COALESCE(p_target_rows, 1000), 1)
  ),
  page AS (
    SELECT s.set_id
      FROM (
        SELECT ns.set_id,
               sum(ns.n) OVER (ORDER BY ns.set_id ROWS UNBOUNDED PRECEDING) - ns.n AS before
          FROM next_sets ns
      ) s
     WHERE s.before < GREATEST(COALESCE(p_target_rows, 1000), 1)
  )
  SELECT r.id, r.set_id, r.timestamp_ms, r.force_n, r.velocity_mps,
         r.position_mm, r.cable, r.user_id
    FROM public.rep_telemetry r
   WHERE r.user_id = p_user_id
     AND r.set_id IN (SELECT page.set_id FROM page)
   ORDER BY r.set_id, r.timestamp_ms, r.id;
$$;

REVOKE ALL ON FUNCTION public.export_rep_telemetry_page(UUID, UUID, INTEGER)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.export_rep_telemetry_page(UUID, UUID, INTEGER) TO service_role;

COMMENT ON FUNCTION public.export_rep_telemetry_page(UUID, UUID, INTEGER) IS
  'GDPR export: the rep_telemetry rows of the user''s next sets after p_after_set_id (set_id order, ~p_target_rows samples), each set unpacked once. Service role only.';
