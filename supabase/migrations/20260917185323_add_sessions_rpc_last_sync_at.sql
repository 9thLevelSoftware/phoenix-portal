-- Fix: parity session pull omitted portal-side updates
--
-- get_routines_excluding_ids / get_cycles_excluding_ids already accept
-- p_last_sync_at and return known IDs that were updated since last sync
-- (20260427200000, reapplied in 20260706120000). get_sessions_excluding_ids
-- never received that parameter. The 20260427 comment that "sessions are
-- mobile-authoritative (portal never edits them)" is stale: portal writes
-- session notes via workout_sessions.updated_at, and the legacy direct
-- session query already filters
--   updated_at.gt.lastSync OR started_at.gt.lastSync.
--
-- Without p_last_sync_at, incremental parity pull (known session IDs +
-- lastSync > 0) excludes every known ID, so portal notes/edits never
-- return. lastSync=0 / full sync hid the gap.
--
-- Additive: p_last_sync_at defaults to NULL. When NULL, the NEW-only
-- known-ID exclusion is unchanged.

DROP FUNCTION IF EXISTS get_sessions_excluding_ids(uuid, uuid[], text, timestamptz, uuid, int);
DROP FUNCTION IF EXISTS get_sessions_excluding_ids(uuid, uuid[], text, timestamptz, uuid, int, timestamptz);

CREATE FUNCTION get_sessions_excluding_ids(
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
      -- NEW (not in known IDs) or STALE (updated/started since last sync)
      AND (
          array_length(p_known_ids, 1) IS NULL
          OR ws.id != ALL(p_known_ids)
          OR (
              p_last_sync_at IS NOT NULL
              AND (
                  ws.updated_at > p_last_sync_at
                  OR ws.started_at > p_last_sync_at
              )
          )
      )
      AND (
          p_profile_id IS NULL
          OR (p_profile_id = 'default' AND ws.local_profile_id IS NULL)
          OR ws.local_profile_id = p_profile_id
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

COMMENT ON FUNCTION get_sessions_excluding_ids(uuid, uuid[], text, timestamptz, uuid, int, timestamptz) IS
'Fetches workout sessions not in the provided ID list OR updated/started since last sync. Uses POST body via RPC to bypass URL length limits.';

DO $$
DECLARE
  fn regprocedure;
BEGIN
  FOR fn IN
    SELECT p.oid::regprocedure
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'get_sessions_excluding_ids'
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
  END LOOP;
END;
$$;
