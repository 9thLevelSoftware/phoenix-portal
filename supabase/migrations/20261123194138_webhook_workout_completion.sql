BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE public.workout_sessions ADD COLUMN IF NOT EXISTS completed_at timestamptz;
COMMENT ON COLUMN public.workout_sessions.completed_at IS
  'First explicit workout finish reported by mobile after its workout graph is saved. NULL when unknown.';

ALTER TABLE public.webhook_endpoints DROP CONSTRAINT IF EXISTS webhook_endpoints_scopes_check;
ALTER TABLE public.webhook_endpoints ADD CONSTRAINT webhook_endpoints_scopes_check
  CHECK (
    cardinality(scopes) BETWEEN 1 AND 10
    AND scopes <@ ARRAY[
      'workouts', 'completed_workouts', 'personal_records', 'routines', 'cycles', 'goals',
      'progress', 'achievements', 'external_activities', 'profile'
    ]::text[]
  );

ALTER TABLE public.webhook_deliveries DROP CONSTRAINT IF EXISTS webhook_deliveries_entity_check;
ALTER TABLE public.webhook_deliveries ADD CONSTRAINT webhook_deliveries_entity_check
  CHECK (entity IN (
    'workout', 'workout_completion', 'personal_record', 'routine', 'cycle', 'goal',
    'exercise_progress', 'badge', 'gamification_stats',
    'rpg_attributes', 'external_activity', 'profile', 'local_profile', 'ping'
  ));

-- Completion has its own subscription and queue key. The first transition is
-- serialized by the workout row lock, even across retries and concurrent pushes.
CREATE OR REPLACE FUNCTION private.enqueue_workout_completion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.webhook_deliveries (endpoint_id, user_id, entity, entity_id)
    SELECT e.id, NEW.user_id, 'workout_completion', NEW.id::text
    FROM public.webhook_endpoints e
    WHERE e.user_id = NEW.user_id
      AND e.status = 'active'
      AND e.scopes @> ARRAY['completed_workouts']
  ON CONFLICT (endpoint_id, entity, entity_id) WHERE status = 'pending' DO NOTHING;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  -- The workout write still succeeds. Resend all can recover from a queue failure.
  RAISE WARNING '[WEBHOOKS] completion enqueue failed: %', SQLSTATE;
  RETURN NULL;
END
$$;
REVOKE ALL ON FUNCTION private.enqueue_workout_completion() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS webhook_capture_workout_completion ON public.workout_sessions;
CREATE TRIGGER webhook_capture_workout_completion
  AFTER UPDATE OF completed_at ON public.workout_sessions
  FOR EACH ROW WHEN (OLD.completed_at IS NULL AND NEW.completed_at IS NOT NULL)
  EXECUTE FUNCTION private.enqueue_workout_completion();

-- Keep the existing child RPC available to previous Edge deployments. This
-- wrapper commits the completion marker and the replacement graph atomically.
CREATE OR REPLACE FUNCTION public.replace_session_children_with_completion(
  p_user_id uuid,
  p_session_ids uuid[],
  p_exercises jsonb,
  p_sets jsonb,
  p_rep_summaries jsonb,
  p_rep_telemetry jsonb,
  p_progress jsonb,
  p_completions jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  candidate record;
  v_result jsonb;
BEGIN
  FOR candidate IN
    SELECT c.id, c.client_updated_at
    FROM pg_catalog.jsonb_to_recordset(p_completions)
      AS c(id uuid, client_updated_at timestamptz)
    ORDER BY c.id
  LOOP
    -- In the non-transactional push path, the parent upsert happened in an
    -- earlier request. Refuse a superseded final graph before replacing children.
    PERFORM 1 FROM public.workout_sessions w
      WHERE w.id = candidate.id AND w.user_id = p_user_id
        AND w.id = ANY(p_session_ids)
        AND w.client_updated_at = candidate.client_updated_at
      FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Workout completion parent changed during sync' USING ERRCODE = '40001';
    END IF;
  END LOOP;

  v_result := public.replace_session_children(
    p_user_id, p_session_ids, p_exercises, p_sets, p_rep_summaries, p_rep_telemetry, p_progress
  );

  UPDATE public.workout_sessions w
    SET completed_at = c.completed_at
  FROM pg_catalog.jsonb_to_recordset(p_completions) AS c(id uuid, completed_at timestamptz)
  WHERE w.id = c.id AND w.user_id = p_user_id AND w.id = ANY(p_session_ids)
    AND w.completed_at IS NULL AND c.completed_at >= w.started_at
    AND EXISTS (
      SELECT 1 FROM public.exercises e JOIN public.sets s ON s.exercise_id = e.id
      WHERE e.session_id = w.id AND e.user_id = p_user_id AND s.user_id = p_user_id
    );

  RETURN v_result;
END
$$;
REVOKE ALL ON FUNCTION public.replace_session_children_with_completion(uuid, uuid[], jsonb, jsonb, jsonb, jsonb, jsonb, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.replace_session_children_with_completion(uuid, uuid[], jsonb, jsonb, jsonb, jsonb, jsonb, jsonb)
  TO service_role;

CREATE OR REPLACE FUNCTION public.enqueue_webhook_backfill(
  p_user_id uuid,
  p_endpoint_id uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_scopes text[];
  s record;
  v_sql text;
  v_rows integer;
  v_total integer := 0;
BEGIN
  SELECT e.scopes INTO v_scopes
  FROM public.webhook_endpoints e
  WHERE e.id = p_endpoint_id
    AND e.user_id = p_user_id
    AND e.status = 'active';

  IF v_scopes IS NULL THEN
    RETURN 0;
  END IF;

  IF 'completed_workouts' = ANY(v_scopes) THEN
    INSERT INTO public.webhook_deliveries (endpoint_id, user_id, entity, entity_id)
      SELECT p_endpoint_id, p_user_id, 'workout_completion', w.id::text
      FROM public.workout_sessions w
      WHERE w.user_id = p_user_id AND w.completed_at IS NOT NULL
    ON CONFLICT (endpoint_id, entity, entity_id) WHERE status = 'pending' DO NOTHING;
    GET DIAGNOSTICS v_total = ROW_COUNT;
  END IF;

  FOR s IN
    SELECT * FROM private.webhook_entity_sources src
    WHERE src.is_root AND src.scope = ANY (v_scopes)
    ORDER BY src.source_table
  LOOP
    CONTINUE WHEN pg_catalog.to_regclass(pg_catalog.format('public.%I', s.source_table)) IS NULL;

    v_sql := pg_catalog.format(
      'INSERT INTO public.webhook_deliveries (endpoint_id, user_id, entity, entity_id) '
      || 'SELECT $1, $2, $3, c.%I::text FROM public.%I c WHERE c.%I = $2',
      s.id_column, s.source_table, s.user_column);
    IF s.row_filter IS NOT NULL THEN
      v_sql := v_sql || ' AND (' || s.row_filter || ')';
    END IF;
    IF s.backfill_filter IS NOT NULL THEN
      v_sql := v_sql || ' AND (' || s.backfill_filter || ')';
    END IF;
    v_sql := v_sql
      || ' ON CONFLICT (endpoint_id, entity, entity_id) '
      || 'WHERE status = ''pending'' DO NOTHING';

    EXECUTE v_sql USING p_endpoint_id, p_user_id, s.entity;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    v_total := v_total + v_rows;
  END LOOP;

  RETURN v_total;
END
$$;

NOTIFY pgrst, 'reload schema';
COMMIT;
