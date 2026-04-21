-- Fix: Multiple column type mismatches in get_sessions_excluding_ids RPC
-- Real columns declared as NUMERIC, integer declared as NUMERIC
-- Must DROP first because return type change not allowed with CREATE OR REPLACE

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
    avg_velocity_mps REAL,         -- Fixed: was NUMERIC
    avg_asymmetry_pct REAL,        -- Fixed: was NUMERIC
    velocity_loss_pct REAL,        -- Fixed: was NUMERIC
    dominant_side TEXT,
    strength_profile TEXT,
    form_score INT,                -- Fixed: was NUMERIC
    deload_warnings INT,
    rom_violations INT,
    spotter_activations INT,
    peak_force_n REAL,             -- Fixed: was NUMERIC
    estimated_calories REAL,       -- Fixed: was INT
    heaviest_lift_kg REAL,         -- Fixed: was NUMERIC
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
          OR ws.local_profile_id IS NULL
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
