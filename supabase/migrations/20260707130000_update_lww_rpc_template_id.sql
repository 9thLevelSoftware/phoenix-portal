CREATE OR REPLACE FUNCTION public.upsert_training_cycle_lww(p_rows jsonb)
RETURNS TABLE(id text, accepted boolean, server_updated_at timestamptz)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  rec record;
  existing_ts timestamptz;
BEGIN
  FOR rec IN
    SELECT * FROM jsonb_populate_recordset(NULL::public.training_cycles, p_rows)
  LOOP
    SELECT c.updated_at INTO existing_ts
      FROM public.training_cycles c
      WHERE c.id = rec.id;

    IF existing_ts IS NULL OR existing_ts <= rec.updated_at THEN
      INSERT INTO public.training_cycles AS c (
        id, user_id, local_profile_id, name, description, duration_weeks,
        workout_days, rest_days, current_week, status, started_at,
        last_used_at, progression_settings, deload_settings, template_id,
        updated_at
      ) VALUES (
        rec.id, rec.user_id, rec.local_profile_id, rec.name, rec.description,
        rec.duration_weeks, rec.workout_days, rec.rest_days, rec.current_week,
        rec.status, rec.started_at, rec.last_used_at, rec.progression_settings,
        rec.deload_settings, rec.template_id, COALESCE(rec.updated_at, NOW())
      )
      ON CONFLICT (id) DO UPDATE SET
        name                 = EXCLUDED.name,
        description          = EXCLUDED.description,
        duration_weeks       = EXCLUDED.duration_weeks,
        workout_days         = EXCLUDED.workout_days,
        rest_days            = EXCLUDED.rest_days,
        current_week         = EXCLUDED.current_week,
        status               = EXCLUDED.status,
        started_at           = EXCLUDED.started_at,
        last_used_at         = EXCLUDED.last_used_at,
        progression_settings = EXCLUDED.progression_settings,
        deload_settings      = EXCLUDED.deload_settings,
        template_id          = COALESCE(EXCLUDED.template_id, c.template_id),
        updated_at           = EXCLUDED.updated_at
      WHERE c.updated_at <= EXCLUDED.updated_at;

      RETURN QUERY SELECT rec.id::text, TRUE, COALESCE(rec.updated_at, NOW());
    ELSE
      RETURN QUERY SELECT rec.id::text, FALSE, existing_ts;
    END IF;
  END LOOP;
END;
$$;
