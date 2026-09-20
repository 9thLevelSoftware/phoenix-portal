-- Stable child ids on portal routine / cycle updates, plus atomic create RPCs.
--
-- WHY (F-090, F-040, FP-3)
--
-- 1. update_routine_with_exercises / update_cycle_with_days replace every
--    child row on every save: they DELETE all children of the parent and
--    re-INSERT them with a fresh gen_random_uuid(). The phone keys its own
--    per-exercise state (rack / scaling defaults, and anything else it stores
--    against routine_exercises.id) by that id, so a portal edit that changed
--    only a routine's name silently invalidated every one of those references
--    — the exercise is "the same exercise" to the user and a brand new row to
--    the device. Same for cycle_days.
--
--    This migration lets the caller send each child's `id`. An id that is
--    already a child OF THIS PARENT is kept; anything else (absent, unknown,
--    or belonging to another routine / cycle — including another user's) gets
--    a fresh uuid. Children of the parent whose ids are not in the payload are
--    removed, exactly as today.
--
--    Backward compatible on the wire: the SPA currently sends no `id` keys at
--    all, and a payload without ids behaves exactly as it does today (every
--    child re-created). PR 15 starts sending them.
--
-- 2. Routine / cycle CREATE was not atomic (src/mutations/routines.ts:122-159,
--    src/mutations/cycles.ts:65-107): parent INSERT, then children INSERT,
--    then a best-effort compensating DELETE whose own failure is swallowed.
--    A failed compensating delete leaves a parent whose exercise_count does
--    not match its children, and that parent is pulled to the phone.
--    create_routine_with_exercises / create_cycle_with_days do the whole thing
--    in one statement-level transaction, mirroring the payload validation of
--    20260628180000_validate_replace_rpc_payloads.sql.
--
-- DELIBERATE DEVIATION from the plan's wording ("upsert by id").
-- The kept children are re-INSERTed with their original id and original
-- created_at rather than UPDATEd in place. The observable end state is
-- identical, and it is the safer of the two here:
--   * these bodies build the row with
--     jsonb_populate_record(NULL::public.routine_exercises, elem), which is
--     column-agnostic. An `ON CONFLICT (id) DO UPDATE SET <explicit list>`
--     would silently stop writing any column a later migration adds, while
--     the INSERT path would keep writing it — a split-brain that is invisible
--     until someone notices one setting never saves on edit.
--   * it is immune to transient unique-constraint collisions when kept rows
--     are re-ordered inside one statement.
-- The precondition is that nothing references routine_exercises.id or
-- cycle_days.id by foreign key (verified: no such constraint exists). That is
-- not left to trust — supabase/tests/database/routine_cycle_rpcs.test.sql
-- asserts the absence of any inbound FK, so adding one (especially an
-- ON DELETE CASCADE) turns that test red instead of silently deleting the
-- dependants on the next portal save.
--
-- SECURITY. All four functions are SECURITY INVOKER, so the FLAME RLS from
-- 20260920000900_flame_write_policies.sql decides who may write: an EMBER user
-- is refused by the policy, not by a hand-written tier check. auth.uid() is
-- read inside; it is never a parameter. Nothing here is SECURITY DEFINER, so
-- none of it belongs in the browser-callable DEFINER allow-list.
--
-- Idempotent: CREATE OR REPLACE only, plus REVOKE/GRANT restatements. No
-- signature changes to the two existing functions, so no DROP is needed
-- (KD-3 rule 3); both are rebuilt from their latest bodies —
-- update_routine_with_exercises from 20260821130000 (keeping the
-- drop_set_enabled COALESCE) and update_cycle_with_days from 20260628180000.

-- ---------------------------------------------------------------------------
-- 0. Shared payload validation helper.
--    Raises when the payload is not a JSON array of JSON objects. Both the
--    array check (20260628180000: a non-array must abort BEFORE the children
--    are deleted, or the RPC silently wipes them) and the per-element object
--    check (an element that is a string / number / null would otherwise blow
--    up mid-statement with an opaque error) happen before any mutation.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.assert_child_payload(
  p_payload JSONB,
  p_error TEXT
)
RETURNS VOID
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
BEGIN
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'array' THEN
    RAISE EXCEPTION '%: expected a JSON array', p_error
      USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_payload) AS elem
    WHERE jsonb_typeof(elem) <> 'object'
  ) THEN
    RAISE EXCEPTION '%: every element must be a JSON object', p_error
      USING ERRCODE = 'P0001';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.assert_child_payload(JSONB, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.assert_child_payload(JSONB, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.assert_child_payload(JSONB, TEXT) TO authenticated;

-- ---------------------------------------------------------------------------
-- 1. update_routine_with_exercises — same signature, stable child ids.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_routine_with_exercises(
  p_routine_id UUID,
  p_name TEXT,
  p_description TEXT,
  p_exercise_count INT,
  p_estimated_duration INT,
  p_exercises JSONB
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_updated UUID;
  v_resolved JSONB;
BEGIN
  -- Validate before mutating: a malformed payload must abort, not silently
  -- clear the children below.
  PERFORM public.assert_child_payload(p_exercises, 'invalid_exercises_payload');

  UPDATE public.routines
     SET name = p_name,
         description = p_description,
         exercise_count = p_exercise_count,
         estimated_duration = p_estimated_duration
   WHERE id = p_routine_id
     AND user_id = auth.uid()
  RETURNING id INTO v_updated;

  IF v_updated IS NULL THEN
    RAISE EXCEPTION 'routine_not_found_or_forbidden'
      USING ERRCODE = 'P0001';
  END IF;

  -- An `id` that is not canonical uuid text is a caller bug, not a request to
  -- mint a new row: fail loudly rather than quietly churning the id.
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_exercises) AS elem
    WHERE elem ? 'id'
      AND jsonb_typeof(elem->'id') <> 'null'
      AND (
        jsonb_typeof(elem->'id') <> 'string'
        OR elem->>'id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      )
  ) THEN
    RAISE EXCEPTION 'invalid_exercise_id: not a uuid'
      USING ERRCODE = 'P0001';
  END IF;

  -- Resolve every element's id BEFORE the delete below: keep an id that is
  -- already a child of THIS routine (carrying its created_at with it), mint a
  -- fresh one otherwise. A id belonging to another routine — the caller's or
  -- anyone else's — is not matched here and that row is never touched.
  SELECT COALESCE(jsonb_agg(s.resolved ORDER BY s.ord), '[]'::jsonb)
    INTO v_resolved
  FROM (
    SELECT t.ord,
           t.elem || jsonb_build_object(
             'id', COALESCE(existing.id, gen_random_uuid()),
             'created_at', COALESCE(existing.created_at, now())
           ) AS resolved
    FROM jsonb_array_elements(p_exercises) WITH ORDINALITY AS t(elem, ord)
    LEFT JOIN public.routine_exercises AS existing
           ON existing.routine_id = p_routine_id
          AND existing.id = CASE
                WHEN t.elem ? 'id' AND jsonb_typeof(t.elem->'id') = 'string'
                  THEN (t.elem->>'id')::uuid
              END
  ) AS s;

  IF (
    SELECT count(*) <> count(DISTINCT elem->>'id')
    FROM jsonb_array_elements(v_resolved) AS elem
  ) THEN
    RAISE EXCEPTION 'duplicate_exercise_id: an id appears twice in the payload'
      USING ERRCODE = 'P0001';
  END IF;

  -- Children omitted from the payload are removed; kept ones come straight
  -- back with the same id and created_at.
  DELETE FROM public.routine_exercises WHERE routine_id = p_routine_id;

  IF jsonb_array_length(v_resolved) > 0 THEN
    INSERT INTO public.routine_exercises
    SELECT (
      jsonb_populate_record(
        NULL::public.routine_exercises,
        elem || jsonb_build_object(
          'routine_id', p_routine_id,
          'drop_set_enabled', COALESCE((elem->>'drop_set_enabled')::boolean, false)
        )
      )
    ).*
    FROM jsonb_array_elements(v_resolved) AS elem;
  END IF;

  RETURN v_updated;
END;
$$;

REVOKE ALL ON FUNCTION public.update_routine_with_exercises(UUID, TEXT, TEXT, INT, INT, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_routine_with_exercises(UUID, TEXT, TEXT, INT, INT, JSONB) FROM anon;
GRANT EXECUTE ON FUNCTION public.update_routine_with_exercises(UUID, TEXT, TEXT, INT, INT, JSONB) TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. update_cycle_with_days — same signature, stable child ids.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_cycle_with_days(
  p_cycle_id UUID,
  p_name TEXT,
  p_description TEXT,
  p_duration_weeks INT,
  p_workout_days INT,
  p_rest_days INT,
  p_started_at TIMESTAMPTZ,
  p_progression_settings JSONB,
  p_deload_settings JSONB,
  p_days JSONB
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_updated UUID;
  v_resolved JSONB;
BEGIN
  PERFORM public.assert_child_payload(p_days, 'invalid_days_payload');

  UPDATE public.training_cycles
     SET name = p_name,
         description = p_description,
         duration_weeks = p_duration_weeks,
         workout_days = p_workout_days,
         rest_days = p_rest_days,
         started_at = p_started_at,
         progression_settings = p_progression_settings,
         deload_settings = p_deload_settings
   WHERE id = p_cycle_id
     AND user_id = auth.uid()
  RETURNING id INTO v_updated;

  IF v_updated IS NULL THEN
    RAISE EXCEPTION 'cycle_not_found_or_forbidden'
      USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_days) AS elem
    WHERE elem ? 'id'
      AND jsonb_typeof(elem->'id') <> 'null'
      AND (
        jsonb_typeof(elem->'id') <> 'string'
        OR elem->>'id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      )
  ) THEN
    RAISE EXCEPTION 'invalid_day_id: not a uuid'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(jsonb_agg(s.resolved ORDER BY s.ord), '[]'::jsonb)
    INTO v_resolved
  FROM (
    SELECT t.ord,
           t.elem || jsonb_build_object(
             'id', COALESCE(existing.id, gen_random_uuid())
           ) AS resolved
    FROM jsonb_array_elements(p_days) WITH ORDINALITY AS t(elem, ord)
    LEFT JOIN public.cycle_days AS existing
           ON existing.cycle_id = p_cycle_id
          AND existing.id = CASE
                WHEN t.elem ? 'id' AND jsonb_typeof(t.elem->'id') = 'string'
                  THEN (t.elem->>'id')::uuid
              END
  ) AS s;

  IF (
    SELECT count(*) <> count(DISTINCT elem->>'id')
    FROM jsonb_array_elements(v_resolved) AS elem
  ) THEN
    RAISE EXCEPTION 'duplicate_day_id: an id appears twice in the payload'
      USING ERRCODE = 'P0001';
  END IF;

  DELETE FROM public.cycle_days WHERE cycle_id = p_cycle_id;

  IF jsonb_array_length(v_resolved) > 0 THEN
    INSERT INTO public.cycle_days
    SELECT (
      jsonb_populate_record(
        NULL::public.cycle_days,
        elem || jsonb_build_object('cycle_id', p_cycle_id)
      )
    ).*
    FROM jsonb_array_elements(v_resolved) AS elem;
  END IF;

  RETURN v_updated;
END;
$$;

REVOKE ALL ON FUNCTION public.update_cycle_with_days(UUID, TEXT, TEXT, INT, INT, INT, TIMESTAMPTZ, JSONB, JSONB, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_cycle_with_days(UUID, TEXT, TEXT, INT, INT, INT, TIMESTAMPTZ, JSONB, JSONB, JSONB) FROM anon;
GRANT EXECUTE ON FUNCTION public.update_cycle_with_days(UUID, TEXT, TEXT, INT, INT, INT, TIMESTAMPTZ, JSONB, JSONB, JSONB) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. create_routine_with_exercises — parent + children in one transaction.
--    Any `id` in the payload is ignored: there is no parent that could own it
--    yet, so every child is minted fresh.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_routine_with_exercises(
  p_name TEXT,
  p_description TEXT,
  p_exercise_count INT,
  p_estimated_duration INT,
  p_exercises JSONB,
  p_local_profile_id TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user UUID := auth.uid();
  v_routine_id UUID;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'not_authenticated'
      USING ERRCODE = '28000';
  END IF;

  PERFORM public.assert_child_payload(p_exercises, 'invalid_exercises_payload');

  INSERT INTO public.routines (
    user_id, local_profile_id, name, description,
    exercise_count, estimated_duration, times_completed, is_favorite, tags
  )
  VALUES (
    v_user, p_local_profile_id, p_name, COALESCE(p_description, ''),
    COALESCE(p_exercise_count, 0), COALESCE(p_estimated_duration, 0),
    0, false, '{}'::text[]
  )
  RETURNING id INTO v_routine_id;

  IF jsonb_array_length(p_exercises) > 0 THEN
    INSERT INTO public.routine_exercises
    SELECT (
      jsonb_populate_record(
        NULL::public.routine_exercises,
        elem || jsonb_build_object(
          'id', gen_random_uuid(),
          'created_at', now(),
          'routine_id', v_routine_id,
          'drop_set_enabled', COALESCE((elem->>'drop_set_enabled')::boolean, false)
        )
      )
    ).*
    FROM jsonb_array_elements(p_exercises) AS elem;
  END IF;

  RETURN v_routine_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_routine_with_exercises(TEXT, TEXT, INT, INT, JSONB, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_routine_with_exercises(TEXT, TEXT, INT, INT, JSONB, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_routine_with_exercises(TEXT, TEXT, INT, INT, JSONB, TEXT) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. create_cycle_with_days — parent + days in one transaction.
--    status / current_week are the table's own defaults ('draft' / 1), which
--    is what the SPA writes today.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_cycle_with_days(
  p_name TEXT,
  p_description TEXT,
  p_duration_weeks INT,
  p_workout_days INT,
  p_rest_days INT,
  p_started_at TIMESTAMPTZ,
  p_progression_settings JSONB,
  p_deload_settings JSONB,
  p_days JSONB,
  p_local_profile_id TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user UUID := auth.uid();
  v_cycle_id UUID;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'not_authenticated'
      USING ERRCODE = '28000';
  END IF;

  PERFORM public.assert_child_payload(p_days, 'invalid_days_payload');

  INSERT INTO public.training_cycles (
    user_id, local_profile_id, name, description, duration_weeks,
    current_week, status, workout_days, rest_days, started_at,
    progression_settings, deload_settings
  )
  VALUES (
    v_user, p_local_profile_id, p_name, p_description,
    COALESCE(p_duration_weeks, 4), 1, 'draft',
    COALESCE(p_workout_days, 0), COALESCE(p_rest_days, 0), p_started_at,
    p_progression_settings, p_deload_settings
  )
  RETURNING id INTO v_cycle_id;

  IF jsonb_array_length(p_days) > 0 THEN
    INSERT INTO public.cycle_days
    SELECT (
      jsonb_populate_record(
        NULL::public.cycle_days,
        elem || jsonb_build_object(
          'id', gen_random_uuid(),
          'cycle_id', v_cycle_id
        )
      )
    ).*
    FROM jsonb_array_elements(p_days) AS elem;
  END IF;

  RETURN v_cycle_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_cycle_with_days(TEXT, TEXT, INT, INT, INT, TIMESTAMPTZ, JSONB, JSONB, JSONB, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_cycle_with_days(TEXT, TEXT, INT, INT, INT, TIMESTAMPTZ, JSONB, JSONB, JSONB, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_cycle_with_days(TEXT, TEXT, INT, INT, INT, TIMESTAMPTZ, JSONB, JSONB, JSONB, TEXT) TO authenticated;
