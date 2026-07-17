-- Issue #655: synchronizable Personal Record tombstones.
-- Never hard-delete PR snapshots: mobile and portal reconcile the same stable UUID
-- using updated_at, with deleted_at winning equal-timestamp conflicts.

ALTER TABLE public.personal_records
    ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_personal_records_sync_cursor
    ON public.personal_records (user_id, local_profile_id, updated_at, id);

-- Replace the obsolete BIGINT parity contract with the UUID identity that the
-- mobile client already sends. Known IDs are normally omitted, except that a
-- tombstone changed since the client's checkpoint is deliberately returned.
DROP FUNCTION IF EXISTS public.get_personal_records_excluding_ids(UUID, BIGINT[], TEXT);

CREATE OR REPLACE FUNCTION public.get_personal_records_excluding_ids(
    p_user_id UUID,
    p_known_ids UUID[] DEFAULT '{}',
    p_profile_id TEXT DEFAULT NULL,
    p_since TIMESTAMPTZ DEFAULT NULL
)
RETURNS TABLE (
    id UUID,
    user_id UUID,
    exercise_name TEXT,
    exercise_id TEXT,
    muscle_group TEXT,
    record_type TEXT,
    value NUMERIC,
    weight_kg NUMERIC,
    reps INT,
    workout_phase TEXT,
    session_id UUID,
    achieved_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ,
    deleted_at TIMESTAMPTZ,
    local_profile_id TEXT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT
        pr.id,
        pr.user_id,
        pr.exercise_name,
        pr.exercise_id,
        pr.muscle_group,
        pr.record_type,
        pr.value,
        pr.weight_kg,
        pr.reps,
        pr.workout_phase,
        pr.session_id,
        pr.achieved_at,
        pr.updated_at,
        pr.deleted_at,
        pr.local_profile_id
    FROM public.personal_records pr
    WHERE pr.user_id = p_user_id
      AND (
          cardinality(p_known_ids) = 0
          OR pr.id <> ALL(p_known_ids)
          OR (pr.deleted_at IS NOT NULL AND (p_since IS NULL OR pr.updated_at > p_since))
      )
      AND (
          p_profile_id IS NULL
          OR (p_profile_id = 'default' AND pr.local_profile_id IS NULL)
          OR pr.local_profile_id = p_profile_id
          OR pr.local_profile_id IS NULL
      )
    ORDER BY pr.updated_at ASC, pr.id ASC;
$$;

COMMENT ON FUNCTION public.get_personal_records_excluding_ids(UUID, UUID[], TEXT, TIMESTAMPTZ) IS
    'Returns PR rows absent from the client parity list plus tombstones changed since the client checkpoint.';

-- Atomic LWW upsert for stable-id mobile Personal Record rows. Rows without a
-- stable ID retain the legacy handler path for backward compatibility, but a
-- tombstone is always written through this function.
CREATE OR REPLACE FUNCTION public.upsert_personal_record_lww(p_rows JSONB)
RETURNS TABLE (
    id UUID,
    accepted BOOLEAN,
    server_updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    incoming RECORD;
    current_row public.personal_records%ROWTYPE;
    incoming_updated_at TIMESTAMPTZ;
    incoming_deleted_at TIMESTAMPTZ;
    should_accept BOOLEAN;
BEGIN
    FOR incoming IN
        SELECT * FROM jsonb_to_recordset(p_rows) AS rows(
            id UUID,
            user_id UUID,
            local_profile_id TEXT,
            exercise_name TEXT,
            exercise_id TEXT,
            muscle_group TEXT,
            record_type TEXT,
            value NUMERIC,
            weight_kg NUMERIC,
            reps INT,
            unit TEXT,
            session_id UUID,
            achieved_at TIMESTAMPTZ,
            updated_at TIMESTAMPTZ,
            deleted_at TIMESTAMPTZ,
            workout_phase TEXT
        )
    LOOP
        SELECT * INTO current_row
        FROM public.personal_records
        WHERE personal_records.id = incoming.id
        FOR UPDATE;

        incoming_deleted_at := incoming.deleted_at;
        incoming_updated_at := incoming.updated_at;

        IF NOT FOUND THEN
            incoming_updated_at := COALESCE(incoming_updated_at, now());
            INSERT INTO public.personal_records (
                id, user_id, local_profile_id, exercise_name, exercise_id,
                muscle_group, record_type, value, weight_kg, reps, unit,
                session_id, achieved_at, updated_at, deleted_at, workout_phase
            ) VALUES (
                incoming.id, incoming.user_id, incoming.local_profile_id,
                incoming.exercise_name, incoming.exercise_id,
                COALESCE(incoming.muscle_group, 'General'),
                COALESCE(incoming.record_type, 'MAX_WEIGHT'),
                COALESCE(incoming.value, 0), incoming.weight_kg, incoming.reps,
                COALESCE(incoming.unit, 'kg'), incoming.session_id,
                COALESCE(incoming.achieved_at, incoming_updated_at),
                incoming_updated_at, incoming_deleted_at,
                COALESCE(incoming.workout_phase, 'COMBINED')
            ) ON CONFLICT (id) DO NOTHING;

            id := incoming.id;
            accepted := FOUND;
            server_updated_at := incoming_updated_at;
            RETURN NEXT;
            CONTINUE;
        END IF;

        -- Never let an old client which lacks a mutation timestamp resurrect a
        -- tombstoned stable record. For still-active historical rows, retain
        -- the legacy server-time fallback.
        IF incoming_updated_at IS NULL THEN
            IF current_row.deleted_at IS NOT NULL AND incoming_deleted_at IS NULL THEN
                id := incoming.id;
                accepted := FALSE;
                server_updated_at := current_row.updated_at;
                RETURN NEXT;
                CONTINUE;
            END IF;
            incoming_updated_at := now();
        END IF;

        should_accept := incoming.user_id = current_row.user_id
            AND (
                incoming_updated_at > current_row.updated_at
                OR (
                    incoming_updated_at = current_row.updated_at
                    AND incoming_deleted_at IS NOT NULL
                    AND current_row.deleted_at IS NULL
                )
            );

        IF should_accept THEN
            UPDATE public.personal_records
            SET local_profile_id = incoming.local_profile_id,
                exercise_name = incoming.exercise_name,
                exercise_id = incoming.exercise_id,
                muscle_group = COALESCE(incoming.muscle_group, 'General'),
                record_type = COALESCE(incoming.record_type, 'MAX_WEIGHT'),
                value = COALESCE(incoming.value, 0),
                weight_kg = incoming.weight_kg,
                reps = incoming.reps,
                unit = COALESCE(incoming.unit, 'kg'),
                session_id = incoming.session_id,
                achieved_at = COALESCE(incoming.achieved_at, incoming_updated_at),
                updated_at = incoming_updated_at,
                deleted_at = incoming_deleted_at,
                workout_phase = COALESCE(incoming.workout_phase, 'COMBINED')
            WHERE personal_records.id = incoming.id;
        END IF;

        id := incoming.id;
        accepted := should_accept;
        server_updated_at := CASE WHEN should_accept THEN incoming_updated_at ELSE current_row.updated_at END;
        RETURN NEXT;
    END LOOP;
END;
$$;

COMMENT ON FUNCTION public.upsert_personal_record_lww(JSONB) IS
    'Issue #655 stable UUID LWW upsert; equal timestamp tombstones win over active records.';
