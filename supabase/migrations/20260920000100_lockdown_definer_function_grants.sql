-- Lock down SECURITY DEFINER function execution and pin search_path.
--
-- Production exposed several SECURITY DEFINER functions in `public` to anon
-- and authenticated (Supabase security advisor lints 0028/0029), including
-- get_routines_excluding_ids (cross-user routine read by user id),
-- get_percentile_rank (cross-user aggregates), refresh_* (expensive global
-- recompute) and insert_routine_exercises_from_snapshot (cross-user routine
-- write). Several of these were created outside migrations, so per-signature
-- REVOKEs alone cannot reach them. This migration:
--
--   1. Adds auth guards to the two exposed bodies we own
--      (get_routines_excluding_ids, insert_routine_exercises_from_snapshot).
--   2. Revokes EXECUTE explicitly, per signature, on the migration-defined
--      Edge-only RPCs.
--   3. Walks pg_proc and revokes EXECUTE from PUBLIC/anon/authenticated on
--      every SECURITY DEFINER function in `public` outside the allow-list
--      (covers overloads and dashboard-only functions without naming a
--      signature that may not exist on a clean apply). service_role keeps
--      EXECUTE. Trigger functions keep working: EXECUTE is checked at
--      CREATE TRIGGER time, not when the trigger fires. pg_cron jobs run as
--      the function owner (postgres) and are unaffected.
--   4. Pins search_path on the functions the advisor reports as mutable.
--   5. Re-asserts that anon cannot read public.public_profiles.
--   6. Removes Supabase's per-schema default EXECUTE grants to anon and
--      authenticated for functions postgres creates in `public`. The global
--      built-in PUBLIC default cannot be removed per schema, and a global
--      revoke would also hit extension functions, so every migration that
--      creates a function must still REVOKE ... FROM PUBLIC itself (KD-3 3b).
--      The pgTAP guard (definer_function_grants.test.sql) and the daily prod
--      grant check (.github/workflows/prod-migration-drift.yml) enforce it.
--   7. Asserts its own effect: aborts if any function in the named dangerous
--      set is still executable by anon or authenticated; NOTICEs any other
--      remaining exposure.
--
-- Browser allow-list (EXECUTE for authenticated + service_role only):
--   import_shared_routine, import_shared_cycle, workout_current_streak
--     (called from src/ via supabase.rpc; bodies check auth.uid()),
--   user_has_min_tier, user_subscription_tier
--     (evaluated inside RLS policies as the calling role).
-- The same list lives in supabase/tests/database/definer_function_grants.test.sql
-- and in the prod grant check step of .github/workflows/prod-migration-drift.yml.
--
-- anon on the tier helpers: every policy in the migration chain that calls
-- user_has_min_tier / user_subscription_tier is INSERT/UPDATE/DELETE with an
-- `auth.uid() = user_id` conjunct, which anon can never satisfy, and anon
-- already lost EXECUTE on user_has_min_tier in 20260823120000. Revoking anon
-- turns an RLS denial into a privilege denial (same SQLSTATE 42501). If the
-- target database has a SELECT/ALL policy for PUBLIC/anon that calls one of
-- them (e.g. a dashboard-created policy), block 3b below keeps anon on that
-- function and raises a NOTICE so the operator sees it.
--
-- Ownership: all SECURITY DEFINER functions in prod `public` are owned by
-- postgres (the migration role), so REVOKE/ALTER are within privilege. Each
-- per-function statement in the loops still traps insufficient_privilege and
-- NOTICEs, so only the final self-assertion can abort the migration.
--
-- Idempotent: every statement is safe to re-run.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Auth guards on the two exposed bodies we own.
--    Signatures, return types and bodies are copied from their latest
--    definitions; only the guard at the top is new. CREATE OR REPLACE keeps
--    existing grants; section 2/3 re-apply them anyway.
-- ---------------------------------------------------------------------------

-- Latest body: 20260706120000_fix_parity_sync_profile_bleed.sql
CREATE OR REPLACE FUNCTION public.get_routines_excluding_ids(
    p_user_id UUID,
    p_known_ids UUID[] DEFAULT '{}',
    p_profile_id TEXT DEFAULT NULL,
    p_cursor_updated_at TIMESTAMPTZ DEFAULT NULL,
    p_cursor_id UUID DEFAULT NULL,
    p_limit INT DEFAULT 76,
    p_last_sync_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS TABLE (
    id UUID,
    user_id UUID,
    name TEXT,
    description TEXT,
    exercise_count INT,
    estimated_duration INT,
    times_completed INT,
    is_favorite BOOLEAN,
    updated_at TIMESTAMPTZ,
    local_profile_id TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- Edge (service_role) reads on behalf of a verified user; anyone else
    -- may only read their own routines.
    IF coalesce(auth.role(), '') <> 'service_role'
       AND p_user_id IS DISTINCT FROM auth.uid() THEN
        RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;

    RETURN QUERY
    SELECT
        r.id,
        r.user_id,
        r.name,
        r.description,
        r.exercise_count,
        r.estimated_duration,
        r.times_completed,
        r.is_favorite,
        r.updated_at,
        r.local_profile_id
    FROM routines r
    WHERE r.user_id = p_user_id
      -- Return entities that are NEW (not in known IDs) or STALE (updated since last sync)
      AND (
          array_length(p_known_ids, 1) IS NULL
          OR r.id != ALL(p_known_ids)
          OR (p_last_sync_at IS NOT NULL AND r.updated_at > p_last_sync_at)
      )
      AND (
          p_profile_id IS NULL
          OR (p_profile_id = 'default' AND r.local_profile_id IS NULL)
          OR r.local_profile_id = p_profile_id
          -- Removed: OR r.local_profile_id IS NULL  (H-18: caused cross-profile bleed)
      )
      AND (
          p_cursor_updated_at IS NULL
          OR r.updated_at > p_cursor_updated_at
          OR (r.updated_at = p_cursor_updated_at AND r.id > p_cursor_id)
      )
    ORDER BY r.updated_at ASC, r.id ASC
    LIMIT p_limit;
END;
$$;

-- Latest body: 20260821120000_routine_exercise_drop_set.sql
-- import_shared_routine / import_shared_cycle call this as a definer after
-- inserting the routine for auth.uid(); auth.uid() is still the caller inside
-- the nested call, so the ownership guard passes for them.
CREATE OR REPLACE FUNCTION public.insert_routine_exercises_from_snapshot(
  p_routine_id UUID,
  p_snapshot JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role'
     AND NOT EXISTS (
       SELECT 1
       FROM public.routines r
       WHERE r.id = p_routine_id
         AND r.user_id = auth.uid()
     ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF p_snapshot IS NULL OR jsonb_typeof(p_snapshot) <> 'array' THEN
    RAISE EXCEPTION 'Routine snapshot is unavailable';
  END IF;

  INSERT INTO public.routine_exercises (
    routine_id,
    name,
    muscle_group,
    exercise_id,
    sets,
    reps,
    weight,
    rest_seconds,
    duration_seconds,
    mode,
    order_index,
    superset_id,
    superset_color,
    superset_order,
    per_set_weights,
    per_set_rest,
    per_set_reps,
    per_set_echo_levels,
    is_amrap,
    is_bodyweight,
    pr_percentage,
    rep_count_timing,
    stop_at_position,
    stall_detection,
    eccentric_load,
    echo_level,
    warmup_sets,
    drop_set_enabled,
    drop_set_min_weight_kg
  )
  SELECT
    p_routine_id,
    COALESCE(ex.name, 'Exercise'),
    COALESCE(ex.muscle_group, 'General'),
    ex.exercise_id,
    COALESCE(ex.sets, 3),
    COALESCE(ex.reps, 10),
    COALESCE(ex.weight, 0),
    COALESCE(ex.rest_seconds, 90),
    ex.duration_seconds,
    COALESCE(ex.mode, 'OLD_SCHOOL'),
    COALESCE(ex.order_index, 0),
    ex.superset_id,
    ex.superset_color,
    ex.superset_order,
    ex.per_set_weights,
    ex.per_set_rest,
    ex.per_set_reps,
    ex.per_set_echo_levels,
    COALESCE(ex.is_amrap, false),
    COALESCE(ex.is_bodyweight, false),
    ex.pr_percentage,
    ex.rep_count_timing,
    ex.stop_at_position,
    COALESCE(ex.stall_detection, true),
    ex.eccentric_load,
    ex.echo_level,
    ex.warmup_sets,
    COALESCE(ex.drop_set_enabled, false),
    ex.drop_set_min_weight_kg
  FROM jsonb_to_recordset(p_snapshot) AS ex(
    name TEXT,
    muscle_group TEXT,
    exercise_id TEXT,
    sets INT,
    reps INT,
    weight NUMERIC,
    rest_seconds INT,
    duration_seconds INT,
    mode TEXT,
    order_index INT,
    superset_id TEXT,
    superset_color TEXT,
    superset_order INT,
    per_set_weights JSONB,
    per_set_rest JSONB,
    per_set_reps JSONB,
    per_set_echo_levels JSONB,
    is_amrap BOOLEAN,
    is_bodyweight BOOLEAN,
    pr_percentage NUMERIC,
    rep_count_timing TEXT,
    stop_at_position TEXT,
    stall_detection BOOLEAN,
    eccentric_load TEXT,
    echo_level TEXT,
    warmup_sets TEXT,
    drop_set_enabled BOOLEAN,
    drop_set_min_weight_kg NUMERIC
  )
  ORDER BY COALESCE(ex.order_index, 0);
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. Explicit per-signature REVOKEs for migration-defined Edge-only RPCs.
--    (Dashboard-only functions are handled only by the existence-guarded
--    loop in section 3, so a clean apply never names a missing object.)
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.get_routines_excluding_ids(UUID, UUID[], TEXT, TIMESTAMPTZ, UUID, INT, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_routines_excluding_ids(UUID, UUID[], TEXT, TIMESTAMPTZ, UUID, INT, TIMESTAMPTZ)
  TO service_role;

REVOKE ALL ON FUNCTION public.get_sessions_excluding_ids(UUID, UUID[], TEXT, TIMESTAMPTZ, UUID, INT, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_sessions_excluding_ids(UUID, UUID[], TEXT, TIMESTAMPTZ, UUID, INT, TIMESTAMPTZ)
  TO service_role;

REVOKE ALL ON FUNCTION public.get_cycles_excluding_ids(UUID, UUID[], TEXT, TIMESTAMPTZ, UUID, INT, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_cycles_excluding_ids(UUID, UUID[], TEXT, TIMESTAMPTZ, UUID, INT, TIMESTAMPTZ)
  TO service_role;

REVOKE ALL ON FUNCTION public.get_personal_records_excluding_ids(UUID, UUID[], TEXT, TIMESTAMPTZ, UUID, INT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_personal_records_excluding_ids(UUID, UUID[], TEXT, TIMESTAMPTZ, UUID, INT)
  TO service_role;

REVOKE ALL ON FUNCTION public.get_badges_excluding_ids(UUID, UUID[], TIMESTAMPTZ, UUID, INT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_badges_excluding_ids(UUID, UUID[], TIMESTAMPTZ, UUID, INT)
  TO service_role;

REVOKE ALL ON FUNCTION public.get_personal_record_tombstones(UUID, UUID[], TIMESTAMPTZ, TEXT, TIMESTAMPTZ, UUID, INT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_personal_record_tombstones(UUID, UUID[], TIMESTAMPTZ, TEXT, TIMESTAMPTZ, UUID, INT)
  TO service_role;

REVOKE ALL ON FUNCTION public.insert_routine_exercises_from_snapshot(UUID, JSONB)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.insert_routine_exercises_from_snapshot(UUID, JSONB)
  TO service_role;

REVOKE ALL ON FUNCTION public.replace_session_children(UUID, UUID[], JSONB, JSONB, JSONB, JSONB)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.replace_session_children(UUID, UUID[], JSONB, JSONB, JSONB, JSONB)
  TO service_role;

REVOKE ALL ON FUNCTION public.replace_user_insights(UUID, TEXT, JSONB)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.replace_user_insights(UUID, TEXT, JSONB)
  TO service_role;

REVOKE ALL ON FUNCTION public.apply_subscription_event(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, BOOLEAN, TEXT, TIMESTAMPTZ
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_subscription_event(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, BOOLEAN, TEXT, TIMESTAMPTZ
) TO service_role;

REVOKE ALL ON FUNCTION public.disconnect_integration(UUID, TEXT, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.disconnect_integration(UUID, TEXT, TIMESTAMPTZ)
  TO service_role;

-- ---------------------------------------------------------------------------
-- 3. Catalog-driven revoke over every SECURITY DEFINER function in public.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_allow_list CONSTANT TEXT[] := ARRAY[
    'import_shared_routine',
    'import_shared_cycle',
    'workout_current_streak',
    'user_has_min_tier',
    'user_subscription_tier'
  ];
  fn RECORD;
BEGIN
  FOR fn IN
    SELECT p.oid::regprocedure AS sig, p.proname
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef
      AND NOT EXISTS (
        SELECT 1 FROM pg_depend d
        WHERE d.classid = 'pg_proc'::regclass
          AND d.objid = p.oid
          AND d.deptype = 'e'
      )
    ORDER BY p.proname
  LOOP
    BEGIN
      IF fn.proname = ANY (v_allow_list) THEN
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', fn.sig);
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', fn.sig);
      ELSE
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn.sig);
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn.sig);
      END IF;
    EXCEPTION WHEN insufficient_privilege THEN
      RAISE NOTICE 'lockdown: skipped grants on % (not owner: %)', fn.sig, SQLERRM;
    END;
  END LOOP;
END;
$$;

-- 3b. Keep anon on a tier helper only if a PUBLIC/anon SELECT or ALL policy
--     calls it (no such policy exists in the migration chain; this guards a
--     dashboard-created one so anon reads error-free as before).
DO $$
DECLARE
  fn RECORD;
BEGIN
  FOR fn IN
    SELECT p.oid::regprocedure AS sig, p.proname
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('user_has_min_tier', 'user_subscription_tier')
  LOOP
    IF EXISTS (
      SELECT 1
      FROM pg_policies pol
      WHERE pol.roles && ARRAY['public', 'anon']::name[]
        AND pol.cmd IN ('SELECT', 'ALL')
        AND (
          coalesce(pol.qual, '') LIKE '%' || fn.proname || '(%'
          OR coalesce(pol.with_check, '') LIKE '%' || fn.proname || '(%'
        )
    ) THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO anon', fn.sig);
      RAISE NOTICE 'lockdown: kept anon EXECUTE on % because a PUBLIC/anon SELECT policy calls it', fn.sig;
    END IF;
  END LOOP;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. Pin search_path on functions the advisor reports as mutable (most exist
--    only in prod), plus any SECURITY DEFINER function in public that has no
--    search_path at all. Never loosens an existing setting on a definer.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  fn RECORD;
BEGIN
  FOR fn IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND NOT EXISTS (
        SELECT 1 FROM pg_depend d
        WHERE d.classid = 'pg_proc'::regclass
          AND d.objid = p.oid
          AND d.deptype = 'e'
      )
      AND (
        p.proname IN (
          'get_acwr',
          'get_muscle_distribution',
          'get_workout_streak',
          'get_volume_rolling_avg',
          'detect_plateaus',
          'get_exercise_trend',
          'get_volume_comparison',
          'get_wearable_trends',
          'get_goal_progress_cached',
          '_external_activities_bump_updated_at',
          'update_personal_record_updated_at'
        )
        OR (
          p.prosecdef
          AND NOT EXISTS (
            SELECT 1
            FROM unnest(coalesce(p.proconfig, '{}'::TEXT[])) AS cfg(setting)
            WHERE cfg.setting LIKE 'search_path=%'
          )
        )
      )
  LOOP
    BEGIN
      EXECUTE format('ALTER FUNCTION %s SET search_path = public, pg_temp', fn.sig);
    EXCEPTION WHEN insufficient_privilege THEN
      RAISE NOTICE 'lockdown: skipped search_path on % (not owner: %)', fn.sig, SQLERRM;
    END;
  END LOOP;
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. public_profiles: authenticated-only (re-assert 20260517173000).
-- ---------------------------------------------------------------------------
REVOKE ALL ON public.public_profiles FROM anon, PUBLIC;

-- ---------------------------------------------------------------------------
-- 6. Default privileges: drop Supabase's per-schema EXECUTE grants to anon
--    and authenticated for functions postgres creates in public. This does
--    NOT remove the global PUBLIC default (see header).
-- ---------------------------------------------------------------------------
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7. Self-assertion.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_allow_list CONSTANT TEXT[] := ARRAY[
    'import_shared_routine',
    'import_shared_cycle',
    'workout_current_streak',
    'user_has_min_tier',
    'user_subscription_tier'
  ];
  -- Selected by name without a prosecdef filter: two of these are SECURITY
  -- INVOKER but still trust a caller-supplied user id.
  v_dangerous CONSTANT TEXT[] := ARRAY[
    'get_routines_excluding_ids',
    'get_sessions_excluding_ids',
    'get_cycles_excluding_ids',
    'get_personal_records_excluding_ids',
    'get_badges_excluding_ids',
    'get_personal_record_tombstones',
    'get_percentile_rank',
    'get_profile_stats',
    'refresh_hot_scores',
    'refresh_community_benchmarks',
    'insert_routine_exercises_from_snapshot',
    'replace_session_children',
    'replace_user_insights',
    'apply_subscription_event',
    'disconnect_integration'
  ];
  v_offenders TEXT;
  fn RECORD;
BEGIN
  SELECT string_agg(
           format('%s (anon=%s, authenticated=%s)',
                  p.oid::regprocedure,
                  has_function_privilege('anon', p.oid, 'EXECUTE'),
                  has_function_privilege('authenticated', p.oid, 'EXECUTE')),
           '; ' ORDER BY p.oid::regprocedure::text)
  INTO v_offenders
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = ANY (v_dangerous)
    AND NOT EXISTS (
      SELECT 1 FROM pg_depend d
      WHERE d.classid = 'pg_proc'::regclass
        AND d.objid = p.oid
        AND d.deptype = 'e'
    )
    AND (
      has_function_privilege('anon', p.oid, 'EXECUTE')
      OR has_function_privilege('authenticated', p.oid, 'EXECUTE')
    );

  IF v_offenders IS NOT NULL THEN
    RAISE EXCEPTION 'lockdown: dangerous functions still executable by anon/authenticated: %', v_offenders
      USING ERRCODE = '42501';
  END IF;

  FOR fn IN
    SELECT p.oid::regprocedure AS sig,
           has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_exec,
           has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_exec
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef
      AND NOT (p.proname = ANY (v_allow_list))
      AND NOT EXISTS (
        SELECT 1 FROM pg_depend d
        WHERE d.classid = 'pg_proc'::regclass
          AND d.objid = p.oid
          AND d.deptype = 'e'
      )
      AND (
        has_function_privilege('anon', p.oid, 'EXECUTE')
        OR has_function_privilege('authenticated', p.oid, 'EXECUTE')
      )
  LOOP
    RAISE NOTICE 'lockdown: % still executable (anon=%, authenticated=%)',
      fn.sig, fn.anon_exec, fn.auth_exec;
  END LOOP;
END;
$$;

COMMIT;
