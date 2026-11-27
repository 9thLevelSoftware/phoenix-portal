BEGIN;

SET LOCAL lock_timeout = '5s';

-- Existing rows receive a server timestamp at migration time so clients that
-- missed a backdated mobile mutation can see the row on their next pull.
ALTER TABLE public.exercise_catalog
  ADD COLUMN IF NOT EXISTS sync_updated_at timestamptz NOT NULL
  DEFAULT statement_timestamp();

CREATE INDEX IF NOT EXISTS idx_exercise_catalog_custom_sync
  ON public.exercise_catalog (user_id, sync_updated_at, id)
  WHERE is_custom;

CREATE OR REPLACE FUNCTION public.stamp_exercise_catalog_sync_write()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    NEW.sync_updated_at := greatest(
      clock_timestamp(), OLD.sync_updated_at + interval '1 microsecond'
    );
  ELSE
    NEW.sync_updated_at := clock_timestamp();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS stamp_exercise_catalog_sync_write ON public.exercise_catalog;
CREATE TRIGGER stamp_exercise_catalog_sync_write
  BEFORE INSERT OR UPDATE ON public.exercise_catalog
  FOR EACH ROW EXECUTE FUNCTION public.stamp_exercise_catalog_sync_write();

-- Edge verifies the JWT and passes its user ID. The unique-index conflict
-- path locks the row before evaluating ownership, clock and tombstone state.
CREATE OR REPLACE FUNCTION public.upsert_mobile_custom_exercises(
  p_user_id uuid,
  p_rows jsonb
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  incoming record;
  receipt_at timestamptz := clock_timestamp();
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'p_user_id is required' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'p_rows must be a JSON array' USING ERRCODE = '22023';
  END IF;

  FOR incoming IN
    SELECT *
    FROM jsonb_to_recordset(p_rows) AS row_data(
      id text, name text, display_name text, muscle_group text,
      equipment text[], default_cable_config text, archived boolean,
      created_at timestamptz, updated_at timestamptz
    )
    ORDER BY id
  LOOP
    INSERT INTO public.exercise_catalog AS existing (
      id, name, display_name, muscle_group, muscle_groups, equipment,
      default_cable_config, is_custom, user_id, archived, created_at, updated_at
    ) VALUES (
      incoming.id, incoming.name, incoming.display_name, incoming.muscle_group,
      ARRAY[incoming.muscle_group], incoming.equipment, incoming.default_cable_config,
      true, p_user_id, incoming.archived, coalesce(incoming.created_at, receipt_at),
      coalesce(incoming.updated_at, receipt_at)
    )
    ON CONFLICT (id) DO UPDATE SET
      name = excluded.name,
      display_name = excluded.display_name,
      muscle_group = excluded.muscle_group,
      muscle_groups = excluded.muscle_groups,
      equipment = excluded.equipment,
      default_cable_config = excluded.default_cable_config,
      archived = excluded.archived,
      updated_at = greatest(excluded.updated_at, existing.updated_at)
    WHERE existing.is_custom AND existing.user_id = p_user_id AND (
      (
        incoming.updated_at IS NULL
        AND (NOT existing.archived OR excluded.archived)
      )
      OR incoming.updated_at > existing.updated_at
      OR (
        incoming.updated_at = existing.updated_at
        AND excluded.archived AND NOT existing.archived
      )
    );

    IF NOT FOUND AND NOT EXISTS (
      SELECT 1 FROM public.exercise_catalog
      WHERE id = incoming.id AND is_custom AND user_id = p_user_id
    ) THEN
      -- Roll back any earlier rows in this batch before returning the conflict.
      RAISE EXCEPTION USING ERRCODE = 'PCE01', MESSAGE = 'Catalog ID conflict';
    END IF;
  END LOOP;

  RETURN true;
EXCEPTION WHEN SQLSTATE 'PCE01' THEN
  RETURN false;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.upsert_mobile_custom_exercises(uuid, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_mobile_custom_exercises(uuid, jsonb)
  TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
