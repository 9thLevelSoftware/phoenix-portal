-- PR 57: DB-enforced identity for set-derived personal records (R-3, F-062,
-- F-039, A-012).
--
-- 1. `personal_records.source` marks which push path produced a row:
--      'set_derived' - built from sessions[].exercises[].sets[].isPr hints
--                      (old mobile builds that send no top-level
--                      personalRecords); these rows have no client id.
--      'dedicated'   - top-level personalRecords with a stable client UUID.
--    NULL = legacy row written before this migration. Legacy rows are NOT
--    constrained: nothing distinguishes legacy set-derived rows from dedicated
--    ones, and dedicated rows that share a derived identity but have different
--    ids are legitimately distinct (F335). See design "Not Doing".
--
-- 2. A partial unique index on the derived identity of live set-derived rows.
--    The expressions mirror personalRecordDerivedIdentityKey() in
--    supabase/functions/_shared/personalRecordRow.ts:
--      profile   COALESCE(local_profile_id, 'default')  (NULL == 'default')
--      exercise  'id:' || exercise_id when present, else 'name:' || exercise_name
--      achieved_at (timestamptz equality == the TS epoch-ms normalization)
--      record_type
--      phase     COALESCE(workout_phase, 'COMBINED')
--    plus user_id, which the TS key omits because its lookups are user-scoped.
--
-- 3. upsert_set_derived_personal_records(p_user_id, p_rows jsonb) writes
--    set-derived rows with INSERT ... ON CONFLICT (<identity>) WHERE <predicate>.
--    PostgREST's `onConflict` cannot target a partial index (it emits no index
--    predicate), so this must be SQL (R-3).
--
-- 4. get_personal_record_identity_candidates(...) replaces the push handler's
--    GET `.in('achieved_at', ...)` probe: identities travel in the POST body
--    and results are keyset-paged, so neither the URL length limit nor
--    PostgREST max_rows can silently truncate the de-dup lookup.
--
-- Lock/cost notes (prod: ~5.9k live rows, 104 MB heap bloat):
--   * ADD COLUMN (nullable, no default) is catalog-only.
--   * The CHECK is added NOT VALID (brief ACCESS EXCLUSIVE, no scan) and then
--     validated under SHARE UPDATE EXCLUSIVE (writes continue).
--   * No existing row has source = 'set_derived' on first apply, so the dedupe
--     below touches zero rows and the index build is one heap scan under a
--     SHARE lock (sub-second at this size). The dedupe is the re-run guard.
--   * lock_timeout keeps the migration from queueing behind a long query and
--     blocking push traffic; re-run later if it times out (all steps are
--     idempotent).

SET lock_timeout = '10s';

-- ---------------------------------------------------------------------------
-- 1. source column + CHECK
-- ---------------------------------------------------------------------------
ALTER TABLE public.personal_records
  ADD COLUMN IF NOT EXISTS source TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.personal_records'::regclass
      AND conname = 'personal_records_source_check'
  ) THEN
    ALTER TABLE public.personal_records
      ADD CONSTRAINT personal_records_source_check
      CHECK (source IS NULL OR source IN ('set_derived', 'dedicated'))
      NOT VALID;
  END IF;
END $$;

ALTER TABLE public.personal_records
  VALIDATE CONSTRAINT personal_records_source_check;

COMMENT ON COLUMN public.personal_records.source IS
  'Push path that produced the row: set_derived (sets[].isPr hints, no client id) '
  'or dedicated (top-level personalRecords with a client UUID). NULL = legacy '
  'row from before 20260920005700; legacy rows are not identity-constrained.';

-- ---------------------------------------------------------------------------
-- 2. Dedupe live set-derived rows (re-run guard), then the unique index.
--    Keep the most recently updated row per identity (ties: lowest id) and
--    tombstone the others instead of hard-deleting them, so a device that
--    already pulled a loser id converges through the tombstone pull.
-- ---------------------------------------------------------------------------
WITH ranked AS (
  SELECT
    pr.id,
    row_number() OVER (
      PARTITION BY
        pr.user_id,
        COALESCE(pr.local_profile_id, 'default'),
        (CASE WHEN pr.exercise_id IS NOT NULL
          THEN 'id:' || pr.exercise_id
          ELSE 'name:' || pr.exercise_name END),
        pr.achieved_at,
        pr.record_type,
        COALESCE(pr.workout_phase, 'COMBINED')
      ORDER BY pr.updated_at DESC NULLS LAST, pr.id ASC
    ) AS rn
  FROM public.personal_records pr
  WHERE pr.source = 'set_derived'
    AND pr.deleted_at IS NULL
)
UPDATE public.personal_records pr
SET deleted_at = now(),
    updated_at = now()
FROM ranked
WHERE pr.id = ranked.id
  AND ranked.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS uq_personal_records_set_derived_identity
  ON public.personal_records (
    user_id,
    (COALESCE(local_profile_id, 'default')),
    (CASE WHEN exercise_id IS NOT NULL
      THEN 'id:' || exercise_id
      ELSE 'name:' || exercise_name END),
    achieved_at,
    record_type,
    (COALESCE(workout_phase, 'COMBINED'))
  )
  WHERE source = 'set_derived' AND deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- 3. Set-derived write path.
--    user_id, source and deleted_at are forced server-side; any user_id,
--    source or deleted_at in p_rows is ignored. An optional per-row id is
--    honoured for a new insert only; on conflict the stored id is kept.
--    DISTINCT ON guards against two payload rows with the same identity in
--    one statement (SQLSTATE 21000); the last one in array order wins.
--    DO UPDATE only fires when a value actually changed, so an unchanged
--    re-push does not bump updated_at (and so is not re-pulled by devices).
--    Returns the number of rows inserted or updated.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.upsert_set_derived_personal_records(UUID, JSONB);
CREATE FUNCTION public.upsert_set_derived_personal_records(
  p_user_id UUID,
  p_rows JSONB
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'p_user_id is required' USING ERRCODE = '22004';
  END IF;
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'p_rows must be a JSON array' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.personal_records AS pr (
    id,
    user_id,
    local_profile_id,
    exercise_name,
    exercise_id,
    muscle_group,
    record_type,
    value,
    weight_kg,
    reps,
    unit,
    session_id,
    achieved_at,
    workout_phase,
    source,
    deleted_at
  )
  SELECT DISTINCT ON (
    COALESCE(r.local_profile_id, 'default'),
    (CASE WHEN r.exercise_id IS NOT NULL
      THEN 'id:' || r.exercise_id
      ELSE 'name:' || r.exercise_name END),
    r.achieved_at,
    COALESCE(r.record_type, 'MAX_WEIGHT'),
    COALESCE(r.workout_phase, 'COMBINED')
  )
    COALESCE(r.id, gen_random_uuid()),
    p_user_id,
    r.local_profile_id,
    r.exercise_name,
    r.exercise_id,
    COALESCE(r.muscle_group, 'General'),
    COALESCE(r.record_type, 'MAX_WEIGHT'),
    r.value,
    r.weight_kg,
    r.reps,
    COALESCE(r.unit, 'kg'),
    r.session_id,
    r.achieved_at,
    COALESCE(r.workout_phase, 'COMBINED'),
    'set_derived',
    NULL
  FROM jsonb_array_elements(p_rows) WITH ORDINALITY AS e(elem, ord)
  CROSS JOIN LATERAL jsonb_to_record(e.elem) AS r(
    id UUID,
    local_profile_id TEXT,
    exercise_name TEXT,
    exercise_id TEXT,
    muscle_group TEXT,
    record_type TEXT,
    value NUMERIC,
    weight_kg NUMERIC,
    reps INTEGER,
    unit TEXT,
    session_id UUID,
    achieved_at TIMESTAMPTZ,
    workout_phase TEXT
  )
  ORDER BY
    COALESCE(r.local_profile_id, 'default'),
    (CASE WHEN r.exercise_id IS NOT NULL
      THEN 'id:' || r.exercise_id
      ELSE 'name:' || r.exercise_name END),
    r.achieved_at,
    COALESCE(r.record_type, 'MAX_WEIGHT'),
    COALESCE(r.workout_phase, 'COMBINED'),
    e.ord DESC
  ON CONFLICT (
    user_id,
    (COALESCE(local_profile_id, 'default')),
    (CASE WHEN exercise_id IS NOT NULL
      THEN 'id:' || exercise_id
      ELSE 'name:' || exercise_name END),
    achieved_at,
    record_type,
    (COALESCE(workout_phase, 'COMBINED'))
  )
  WHERE source = 'set_derived' AND deleted_at IS NULL
  DO UPDATE SET
    exercise_name = EXCLUDED.exercise_name,
    muscle_group = EXCLUDED.muscle_group,
    value = EXCLUDED.value,
    weight_kg = EXCLUDED.weight_kg,
    reps = EXCLUDED.reps,
    unit = EXCLUDED.unit,
    session_id = EXCLUDED.session_id
  WHERE (pr.exercise_name, pr.muscle_group, pr.value, pr.weight_kg, pr.reps,
         pr.unit, pr.session_id)
    IS DISTINCT FROM
        (EXCLUDED.exercise_name, EXCLUDED.muscle_group, EXCLUDED.value,
         EXCLUDED.weight_kg, EXCLUDED.reps, EXCLUDED.unit, EXCLUDED.session_id);

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION public.upsert_set_derived_personal_records(UUID, JSONB) IS
  'mobile-sync-push only (service_role). Idempotent write of set-derived PRs '
  'keyed on uq_personal_records_set_derived_identity. Legacy NULL-source and '
  'dedicated rows are never matched or modified.';

-- ---------------------------------------------------------------------------
-- 4. Existing-row probe for push de-dup (POST body, keyset paged by id).
--    Returns every row (live or tombstoned, any source) whose achieved_at is
--    in p_achieved_at, a superset the handler filters with its TS identity
--    keys exactly as it did with the old GET probe.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.get_personal_record_identity_candidates(
  UUID, TIMESTAMPTZ[], UUID, INT
);
CREATE FUNCTION public.get_personal_record_identity_candidates(
  p_user_id UUID,
  p_achieved_at TIMESTAMPTZ[],
  p_after_id UUID DEFAULT NULL,
  p_limit INT DEFAULT 500
)
RETURNS TABLE (
  id UUID,
  local_profile_id TEXT,
  exercise_id TEXT,
  exercise_name TEXT,
  achieved_at TIMESTAMPTZ,
  record_type TEXT,
  workout_phase TEXT,
  updated_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    pr.id,
    pr.local_profile_id,
    pr.exercise_id,
    pr.exercise_name,
    pr.achieved_at,
    pr.record_type,
    pr.workout_phase,
    pr.updated_at,
    pr.deleted_at
  FROM public.personal_records pr
  WHERE pr.user_id = p_user_id
    AND pr.achieved_at = ANY(COALESCE(p_achieved_at, '{}'))
    AND (p_after_id IS NULL OR pr.id > p_after_id)
  ORDER BY pr.id ASC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 500), 1), 1000);
$$;

COMMENT ON FUNCTION public.get_personal_record_identity_candidates(
  UUID, TIMESTAMPTZ[], UUID, INT
) IS
  'mobile-sync-push only (service_role). Keyset-paged (id) existing-PR probe; '
  'identities travel in the POST body instead of a GET .in() URL.';

-- ---------------------------------------------------------------------------
-- 5. Privileges (KD-3 rule 3b): Edge-internal, service_role only.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.upsert_set_derived_personal_records(UUID, JSONB)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_set_derived_personal_records(UUID, JSONB)
  TO service_role;

REVOKE ALL ON FUNCTION public.get_personal_record_identity_candidates(
  UUID, TIMESTAMPTZ[], UUID, INT
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_personal_record_identity_candidates(
  UUID, TIMESTAMPTZ[], UUID, INT
) TO service_role;

RESET lock_timeout;
