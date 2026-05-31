-- Keep parity-sync RPC ID types aligned with the base schema.
-- earned_badges.id and personal_records.id are UUIDs, not bigint values.

DROP FUNCTION IF EXISTS public.get_badges_excluding_ids(UUID, BIGINT[], TIMESTAMPTZ, BIGINT, INT);
DROP FUNCTION IF EXISTS public.get_personal_records_excluding_ids(UUID, BIGINT[], TEXT);

CREATE OR REPLACE FUNCTION public.get_badges_excluding_ids(
    p_user_id UUID,
    p_known_ids UUID[] DEFAULT '{}',
    p_cursor_earned_at TIMESTAMPTZ DEFAULT NULL,
    p_cursor_id UUID DEFAULT NULL,
    p_limit INT DEFAULT 76
)
RETURNS TABLE (
    id UUID,
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
    FROM public.earned_badges eb
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

COMMENT ON FUNCTION public.get_badges_excluding_ids(UUID, UUID[], TIMESTAMPTZ, UUID, INT) IS
'Fetches earned badges not in the provided UUID list. Uses POST body via RPC to bypass URL length limits.';

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
          OR pr.local_profile_id IS NULL
      )
    ORDER BY pr.updated_at ASC, pr.id ASC;
END;
$$;

COMMENT ON FUNCTION public.get_personal_records_excluding_ids(UUID, UUID[], TEXT) IS
'Fetches personal records not in the provided UUID list. Uses POST body via RPC to bypass URL length limits.';
