-- Migration: Add RPC functions for parity-based sync to bypass URL length limits
--
-- Problem: supabase-js .not('id', 'in', '(...)') uses GET with IDs in URL params.
-- Users with 500+ sessions exceed HTTP URL limits (~8KB), causing sync failures.
--
-- Solution: RPC functions accept ID arrays in POST body (no URL limit).
-- Edge Functions call these instead of building .not().in() queries.

-- ============================================================================
-- get_sessions_excluding_ids: Fetch sessions NOT in the provided ID list
-- ============================================================================
CREATE OR REPLACE FUNCTION get_sessions_excluding_ids(
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
    routine_session_id UUID,
    notes TEXT,
    updated_at TIMESTAMPTZ,
    avg_velocity_mps NUMERIC,
    avg_asymmetry_pct NUMERIC,
    velocity_loss_pct NUMERIC,
    dominant_side TEXT,
    strength_profile TEXT,
    form_score NUMERIC,
    deload_warnings INT,
    rom_violations INT,
    spotter_activations INT,
    peak_force_n NUMERIC,
    estimated_calories INT,
    heaviest_lift_kg NUMERIC,
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
      -- Exclude known IDs (empty array = include all)
      AND (array_length(p_known_ids, 1) IS NULL OR ws.id != ALL(p_known_ids))
      -- Profile filter
      AND (
          p_profile_id IS NULL
          OR (p_profile_id = 'default' AND ws.local_profile_id IS NULL)
          OR ws.local_profile_id = p_profile_id
          OR ws.local_profile_id IS NULL
      )
      -- Cursor-based pagination (composite key: updated_at, id)
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
-- get_routines_excluding_ids: Fetch routines NOT in the provided ID list
-- ============================================================================
CREATE OR REPLACE FUNCTION get_routines_excluding_ids(
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
      AND (array_length(p_known_ids, 1) IS NULL OR r.id != ALL(p_known_ids))
      AND (
          p_profile_id IS NULL
          OR (p_profile_id = 'default' AND r.local_profile_id IS NULL)
          OR r.local_profile_id = p_profile_id
          OR r.local_profile_id IS NULL
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

COMMENT ON FUNCTION get_routines_excluding_ids IS
'Fetches routines not in the provided ID list. Uses POST body via RPC to bypass URL length limits.';


-- ============================================================================
-- get_cycles_excluding_ids: Fetch training cycles NOT in the provided ID list
-- ============================================================================
CREATE OR REPLACE FUNCTION get_cycles_excluding_ids(
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
      AND (array_length(p_known_ids, 1) IS NULL OR tc.id != ALL(p_known_ids))
      AND (
          p_profile_id IS NULL
          OR (p_profile_id = 'default' AND tc.local_profile_id IS NULL)
          OR tc.local_profile_id = p_profile_id
          OR tc.local_profile_id IS NULL
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

COMMENT ON FUNCTION get_cycles_excluding_ids IS
'Fetches training cycles not in the provided ID list. Uses POST body via RPC to bypass URL length limits.';


-- ============================================================================
-- get_badges_excluding_ids: Fetch badges NOT in the provided ID list
-- ============================================================================
CREATE OR REPLACE FUNCTION get_badges_excluding_ids(
    p_user_id UUID,
    p_known_ids BIGINT[] DEFAULT '{}',
    p_cursor_earned_at TIMESTAMPTZ DEFAULT NULL,
    p_cursor_id BIGINT DEFAULT NULL,
    p_limit INT DEFAULT 76
)
RETURNS TABLE (
    id BIGINT,
    user_id UUID,
    badge_id TEXT,
    badge_name TEXT,
    badge_description TEXT,
    badge_tier TEXT,
    earned_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    SELECT
        eb.id,
        eb.user_id,
        eb.badge_id,
        eb.badge_name,
        eb.badge_description,
        eb.badge_tier,
        eb.earned_at
    FROM earned_badges eb
    WHERE eb.user_id = p_user_id
      AND (array_length(p_known_ids, 1) IS NULL OR eb.id != ALL(p_known_ids))
      AND (
          p_cursor_earned_at IS NULL
          OR eb.earned_at > p_cursor_earned_at
          OR (eb.earned_at = p_cursor_earned_at AND eb.id > p_cursor_id)
      )
    ORDER BY eb.earned_at ASC, eb.id ASC
    LIMIT p_limit;
END;
$$;

COMMENT ON FUNCTION get_badges_excluding_ids IS
'Fetches earned badges not in the provided ID list. Uses POST body via RPC to bypass URL length limits.';


-- ============================================================================
-- get_personal_records_excluding_ids: Fetch PRs NOT in the provided ID list
-- ============================================================================
CREATE OR REPLACE FUNCTION get_personal_records_excluding_ids(
    p_user_id UUID,
    p_known_ids BIGINT[] DEFAULT '{}',
    p_profile_id TEXT DEFAULT NULL
)
RETURNS TABLE (
    id BIGINT,
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
    FROM personal_records pr
    WHERE pr.user_id = p_user_id
      AND (array_length(p_known_ids, 1) IS NULL OR pr.id != ALL(p_known_ids))
      AND (
          p_profile_id IS NULL
          OR (p_profile_id = 'default' AND pr.local_profile_id IS NULL)
          OR pr.local_profile_id = p_profile_id
          OR pr.local_profile_id IS NULL
      )
    ORDER BY pr.updated_at ASC, pr.id ASC;
END;
$$;

COMMENT ON FUNCTION get_personal_records_excluding_ids IS
'Fetches personal records not in the provided ID list. Uses POST body via RPC to bypass URL length limits.';
