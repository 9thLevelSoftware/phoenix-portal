-- Fix H-18: Cross-profile session bleed in parity-sync RPCs
--
-- Root cause: All profile-scoped parity-sync RPCs contained an unconditional
--   "OR xxx.local_profile_id IS NULL"
-- arm at the end of their profile filter. This caused multi-profile users to
-- receive every NULL-profile (legacy) row in EVERY profile pull, regardless of
-- which profile was requested.
--
-- The safe arm "(p_profile_id = 'default' AND xxx.local_profile_id IS NULL)"
-- is intentional and is kept — it allows legacy NULL-profile rows to be served
-- when the caller explicitly asks for the 'default' profile. The unconditional
-- arm is what leaks data across profiles and is removed here.
--
-- This migration also backfills NULL local_profile_id → 'default' for
-- workout_sessions, routines, and training_cycles (personal_records was already
-- backfilled by migration 20260608120000). The backfill is scoped to users who
-- own a 'default' local_profile, matching the same safe pattern used previously.

-- ============================================================================
-- BACKFILL: Normalize NULL local_profile_id → 'default'
-- ============================================================================

UPDATE public.workout_sessions
SET local_profile_id = 'default',
    updated_at        = NOW()
WHERE local_profile_id IS NULL
  AND EXISTS (
      SELECT 1
      FROM public.local_profiles lp
      WHERE lp.user_id = workout_sessions.user_id
        AND lp.id = 'default'
  );

UPDATE public.routines
SET local_profile_id = 'default',
    updated_at        = NOW()
WHERE local_profile_id IS NULL
  AND EXISTS (
      SELECT 1
      FROM public.local_profiles lp
      WHERE lp.user_id = routines.user_id
        AND lp.id = 'default'
  );

UPDATE public.training_cycles
SET local_profile_id = 'default',
    updated_at        = NOW()
WHERE local_profile_id IS NULL
  AND EXISTS (
      SELECT 1
      FROM public.local_profiles lp
      WHERE lp.user_id = training_cycles.user_id
        AND lp.id = 'default'
  );

-- ============================================================================
-- get_sessions_excluding_ids
-- Source: 20260421001000_fix_sessions_rpc_column_types.sql
-- Must DROP first (return type change not allowed with CREATE OR REPLACE)
-- ============================================================================

DROP FUNCTION IF EXISTS get_sessions_excluding_ids(uuid, uuid[], text, timestamptz, uuid, int);

CREATE FUNCTION get_sessions_excluding_ids(
    p_user_id UUID,
    p_known_ids UUID[] DEFAULT '{}',
    p_profile_id TEXT DEFAULT NULL,
    p_cursor_updated_at TIMESTAMPTZ DEFAULT NULL,
    p_cursor_id UUID DEFAULT NULL,
    p_limit INT DEFAULT 76
)
RETURNS TABLE (
    id UUID,
    user_id UUID,
    name TEXT,
    started_at TIMESTAMPTZ,
    duration_seconds INT,
    total_volume NUMERIC,
    set_count INT,
    exercise_count INT,
    pr_count INT,
    routine_name TEXT,
    workout_mode TEXT,
    routine_session_id TEXT,
    notes TEXT,
    updated_at TIMESTAMPTZ,
    avg_velocity_mps REAL,
    avg_asymmetry_pct REAL,
    velocity_loss_pct REAL,
    dominant_side TEXT,
    strength_profile TEXT,
    form_score INT,
    deload_warnings INT,
    rom_violations INT,
    spotter_activations INT,
    peak_force_n REAL,
    estimated_calories REAL,
    heaviest_lift_kg REAL,
    eccentric_load INT,
    echo_level INT,
    warmup_reps INT,
    working_reps INT,
    local_profile_id TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    SELECT
        ws.id,
        ws.user_id,
        ws.name,
        ws.started_at,
        ws.duration_seconds,
        ws.total_volume,
        ws.set_count,
        ws.exercise_count,
        ws.pr_count,
        ws.routine_name,
        ws.workout_mode,
        ws.routine_session_id,
        ws.notes,
        ws.updated_at,
        ws.avg_velocity_mps,
        ws.avg_asymmetry_pct,
        ws.velocity_loss_pct,
        ws.dominant_side,
        ws.strength_profile,
        ws.form_score,
        ws.deload_warnings,
        ws.rom_violations,
        ws.spotter_activations,
        ws.peak_force_n,
        ws.estimated_calories,
        ws.heaviest_lift_kg,
        ws.eccentric_load,
        ws.echo_level,
        ws.warmup_reps,
        ws.working_reps,
        ws.local_profile_id
    FROM workout_sessions ws
    WHERE ws.user_id = p_user_id
      AND (array_length(p_known_ids, 1) IS NULL OR ws.id != ALL(p_known_ids))
      AND (
          p_profile_id IS NULL
          OR (p_profile_id = 'default' AND ws.local_profile_id IS NULL)
          OR ws.local_profile_id = p_profile_id
          -- Removed: OR ws.local_profile_id IS NULL  (H-18: caused cross-profile bleed)
      )
      AND (
          p_cursor_updated_at IS NULL
          OR ws.updated_at > p_cursor_updated_at
          OR (ws.updated_at = p_cursor_updated_at AND ws.id > p_cursor_id)
      )
    ORDER BY ws.updated_at ASC, ws.id ASC
    LIMIT p_limit;
END;
$$;

COMMENT ON FUNCTION get_sessions_excluding_ids IS
'Fetches workout sessions not in the provided ID list. Uses POST body via RPC to bypass URL length limits for large parity sync.';

-- ============================================================================
-- get_routines_excluding_ids
-- Source: 20260427200000_fix_parity_sync_stale_routines_cycles.sql
-- ============================================================================

DROP FUNCTION IF EXISTS get_routines_excluding_ids(UUID, UUID[], TEXT, TIMESTAMPTZ, UUID, INT);
DROP FUNCTION IF EXISTS get_routines_excluding_ids(UUID, UUID[], TEXT, TIMESTAMPTZ, UUID, INT, TIMESTAMPTZ);

CREATE FUNCTION get_routines_excluding_ids(
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

COMMENT ON FUNCTION get_routines_excluding_ids(UUID, UUID[], TEXT, TIMESTAMPTZ, UUID, INT, TIMESTAMPTZ) IS
'Fetches routines not in the provided ID list OR updated since last sync. Uses POST body via RPC to bypass URL length limits.';

-- ============================================================================
-- get_cycles_excluding_ids
-- Source: 20260427200000_fix_parity_sync_stale_routines_cycles.sql
-- ============================================================================

DROP FUNCTION IF EXISTS get_cycles_excluding_ids(UUID, UUID[], TEXT, TIMESTAMPTZ, UUID, INT);
DROP FUNCTION IF EXISTS get_cycles_excluding_ids(UUID, UUID[], TEXT, TIMESTAMPTZ, UUID, INT, TIMESTAMPTZ);

CREATE FUNCTION get_cycles_excluding_ids(
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
    duration_weeks INT,
    workout_days INT,
    rest_days INT,
    current_week INT,
    status TEXT,
    started_at TIMESTAMPTZ,
    last_used_at TIMESTAMPTZ,
    progression_settings JSONB,
    deload_settings JSONB,
    updated_at TIMESTAMPTZ,
    local_profile_id TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    SELECT
        tc.id,
        tc.user_id,
        tc.name,
        tc.description,
        tc.duration_weeks,
        tc.workout_days,
        tc.rest_days,
        tc.current_week,
        tc.status,
        tc.started_at,
        tc.last_used_at,
        tc.progression_settings,
        tc.deload_settings,
        tc.updated_at,
        tc.local_profile_id
    FROM training_cycles tc
    WHERE tc.user_id = p_user_id
      -- Return entities that are NEW (not in known IDs) or STALE (updated since last sync)
      AND (
          array_length(p_known_ids, 1) IS NULL
          OR tc.id != ALL(p_known_ids)
          OR (p_last_sync_at IS NOT NULL AND tc.updated_at > p_last_sync_at)
      )
      AND (
          p_profile_id IS NULL
          OR (p_profile_id = 'default' AND tc.local_profile_id IS NULL)
          OR tc.local_profile_id = p_profile_id
          -- Removed: OR tc.local_profile_id IS NULL  (H-18: caused cross-profile bleed)
      )
      AND (
          p_cursor_updated_at IS NULL
          OR tc.updated_at > p_cursor_updated_at
          OR (tc.updated_at = p_cursor_updated_at AND tc.id > p_cursor_id)
      )
    ORDER BY tc.updated_at ASC, tc.id ASC
    LIMIT p_limit;
END;
$$;

COMMENT ON FUNCTION get_cycles_excluding_ids(UUID, UUID[], TEXT, TIMESTAMPTZ, UUID, INT, TIMESTAMPTZ) IS
'Fetches training cycles not in the provided ID list OR updated since last sync. Uses POST body via RPC to bypass URL length limits.';

-- Restore service-role-only execution after DROP/CREATE. Newly-created
-- PostgreSQL functions grant EXECUTE to PUBLIC by default, but these parity
-- sync RPCs trust caller-supplied user IDs and are Edge Function internals.
DO $$
DECLARE
  fn regprocedure;
BEGIN
  FOR fn IN
    SELECT p.oid::regprocedure
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = ANY (ARRAY[
        'get_sessions_excluding_ids',
        'get_routines_excluding_ids',
        'get_cycles_excluding_ids'
      ])
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
  END LOOP;
END;
$$;

-- ============================================================================
-- get_personal_records_excluding_ids
-- Source: 20260428234500_fix_parity_sync_uuid_badges_prs.sql
-- Signature unchanged — CREATE OR REPLACE is safe here.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_personal_records_excluding_ids(
    p_user_id UUID,
    p_known_ids UUID[] DEFAULT '{}',
    p_profile_id TEXT DEFAULT NULL
)
RETURNS TABLE (
    id UUID,
    user_id UUID,
    exercise_name TEXT,
    muscle_group TEXT,
    record_type TEXT,
    value NUMERIC,
    weight_kg NUMERIC,
    reps INT,
    workout_phase TEXT,
    session_id UUID,
    achieved_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ,
    local_profile_id TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    SELECT
        pr.id,
        pr.user_id,
        pr.exercise_name,
        pr.muscle_group,
        pr.record_type,
        pr.value,
        pr.weight_kg,
        pr.reps,
        pr.workout_phase,
        pr.session_id,
        pr.achieved_at,
        pr.updated_at,
        pr.local_profile_id
    FROM public.personal_records pr
    WHERE pr.user_id = p_user_id
      AND (array_length(p_known_ids, 1) IS NULL OR pr.id != ALL(p_known_ids))
      AND (
          p_profile_id IS NULL
          OR (p_profile_id = 'default' AND pr.local_profile_id IS NULL)
          OR pr.local_profile_id = p_profile_id
          -- Removed: OR pr.local_profile_id IS NULL  (H-18: caused cross-profile bleed)
      )
    ORDER BY pr.updated_at ASC, pr.id ASC;
END;
$$;

COMMENT ON FUNCTION public.get_personal_records_excluding_ids(UUID, UUID[], TEXT) IS
'Fetches personal records not in the provided UUID list. Uses POST body via RPC to bypass URL length limits.';
