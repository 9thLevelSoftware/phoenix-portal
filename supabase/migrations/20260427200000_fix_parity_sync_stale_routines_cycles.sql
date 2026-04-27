-- Migration: Fix parity sync excluding portal-edited routines and cycles
--
-- Problem: get_routines_excluding_ids and get_cycles_excluding_ids use
-- `id != ALL(p_known_ids)` to return only NEW entities. But routines and
-- cycles are shared-authority — the portal can edit them. When mobile already
-- knows an ID, the RPC excludes it even if it was updated since last sync.
-- Portal edits are invisible to mobile pull.
--
-- Fix: Add p_last_sync_at parameter. Return entities that are either:
--   (1) NOT in known IDs (new entities), OR
--   (2) IN known IDs but updated_at > p_last_sync_at (stale entities)
--
-- Sessions and badges are NOT affected — sessions are mobile-authoritative
-- (portal never edits them) and badges are mobile-computed.

-- ============================================================================
-- get_routines_excluding_ids: Now also returns known routines updated since last sync
-- ============================================================================
CREATE OR REPLACE FUNCTION get_routines_excluding_ids(
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
'Fetches routines not in the provided ID list OR updated since last sync. Uses POST body via RPC to bypass URL length limits.';


-- ============================================================================
-- get_cycles_excluding_ids: Now also returns known cycles updated since last sync
-- ============================================================================
CREATE OR REPLACE FUNCTION get_cycles_excluding_ids(
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
'Fetches training cycles not in the provided ID list OR updated since last sync. Uses POST body via RPC to bypass URL length limits.';
