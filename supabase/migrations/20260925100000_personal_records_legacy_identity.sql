-- F-062 (consolidation C8a): identity for legacy personal_records rows.
--
-- 20260920005700 constrained set-derived rows (source = 'set_derived') and
-- deliberately left legacy rows (source IS NULL, written before that
-- migration) unconstrained: nothing marks a legacy row as set-derived or
-- dedicated, and two dedicated records with the same derived identity but
-- different ids are legitimately distinct, possibly with the same value
-- (F335, _shared/personalRecordRow.ts personalRecordIdentityKey).
--
-- The duplicates that incident produced (361k rows for ~4k logical PRs) were
-- the SAME record re-inserted under fresh ids: identical content. So the
-- legacy identity here is the derived identity PLUS every user-visible or
-- behavioural column (exercise_name, muscle_group, value, unit,
-- previous_value, weight_kg, reps, session_id), with NULLs equal. Two legacy
-- rows that match on every one of those are indistinguishable wherever they
-- are shown (RecordsTab, insights, exports), so collapsing them loses
-- nothing, while any real difference keeps both rows and F335 holds.
-- set_derived and dedicated rows are untouched.
--
-- Dedupe mirrors 20260920005700: keep the most recently updated row per
-- identity (ties: lowest id) and TOMBSTONE the others (deleted_at, updated_at
-- = now()) rather than delete them, so a device that already pulled a loser id
-- converges through get_personal_record_tombstones. The dedupe is a function
-- so the pgTAP suite exercises exactly this logic; it is owner-only.
--
-- Operator pre-check (read-only; rows this migration will tombstone):
--   SELECT count(*) FROM (
--     SELECT row_number() OVER (
--       PARTITION BY user_id, COALESCE(local_profile_id, 'default'),
--         (CASE WHEN NULLIF(exercise_id, '') IS NOT NULL
--           THEN 'id:' || exercise_id ELSE 'name:' || exercise_name END),
--         date_trunc('milliseconds', achieved_at AT TIME ZONE 'UTC'),
--         record_type, COALESCE(workout_phase, 'COMBINED'),
--         exercise_name, muscle_group, value, unit, previous_value,
--         weight_kg, reps, session_id
--       ORDER BY updated_at DESC NULLS LAST, id ASC) AS rn
--     FROM public.personal_records
--     WHERE source IS NULL AND deleted_at IS NULL) r
--   WHERE rn > 1;
-- Expected small: prod duplicates were already cleaned (A-011).
--
-- Lock/cost: like 20260920005700, the file holds its locks until COMMIT
-- (a dedupe scan plus one index build). lock_timeout stops it queueing behind
-- a long query; every step is idempotent, so a timed-out run is simply re-run.

BEGIN;

SET LOCAL lock_timeout = '10s';

CREATE OR REPLACE FUNCTION private.dedupe_legacy_personal_records()
RETURNS integer
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $$
  WITH ranked AS (
    SELECT
      pr.id,
      row_number() OVER (
        PARTITION BY
          pr.user_id,
          COALESCE(pr.local_profile_id, 'default'),
          (CASE WHEN NULLIF(pr.exercise_id, '') IS NOT NULL
            THEN 'id:' || pr.exercise_id
            ELSE 'name:' || pr.exercise_name END),
          date_trunc('milliseconds', pr.achieved_at AT TIME ZONE 'UTC'),
          pr.record_type,
          COALESCE(pr.workout_phase, 'COMBINED'),
          pr.exercise_name,
          pr.muscle_group,
          pr.value,
          pr.unit,
          pr.previous_value,
          pr.weight_kg,
          pr.reps,
          pr.session_id
        ORDER BY pr.updated_at DESC NULLS LAST, pr.id ASC
      ) AS rn
    FROM public.personal_records pr
    WHERE pr.source IS NULL
      AND pr.deleted_at IS NULL
  ),
  tombstoned AS (
    UPDATE public.personal_records pr
    SET deleted_at = now(),
        updated_at = now()
    FROM ranked
    WHERE pr.id = ranked.id
      AND ranked.rn > 1
    RETURNING 1
  )
  SELECT count(*)::integer FROM tombstoned;
$$;

REVOKE ALL ON FUNCTION private.dedupe_legacy_personal_records()
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION private.dedupe_legacy_personal_records() IS
  'F-062: tombstones all but the newest of each group of live legacy (source IS NULL) '
  'personal_records that match on derived identity AND content. Returns the count. '
  'Called by 20260925100000; owner-only.';

SELECT private.dedupe_legacy_personal_records();

CREATE UNIQUE INDEX IF NOT EXISTS uq_personal_records_legacy_identity
  ON public.personal_records (
    user_id,
    (COALESCE(local_profile_id, 'default')),
    (CASE WHEN NULLIF(exercise_id, '') IS NOT NULL
      THEN 'id:' || exercise_id
      ELSE 'name:' || exercise_name END),
    (date_trunc('milliseconds', achieved_at AT TIME ZONE 'UTC')),
    record_type,
    (COALESCE(workout_phase, 'COMBINED')),
    exercise_name,
    muscle_group,
    value,
    unit,
    previous_value,
    weight_kg,
    reps,
    session_id
  )
  NULLS NOT DISTINCT
  WHERE source IS NULL AND deleted_at IS NULL;

COMMENT ON INDEX public.uq_personal_records_legacy_identity IS
  'F-062: live legacy (source IS NULL) personal_records are unique on derived '
  'identity plus content (exercise_name, muscle_group, value, unit, previous_value, '
  'weight_kg, reps, session_id), NULLs equal. '
  'set_derived rows use uq_personal_records_set_derived_identity; dedicated rows '
  'stay id-keyed (F335).';

COMMIT;
