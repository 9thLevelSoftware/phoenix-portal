-- Durable workout deletion, account-bound profile ownership transfer, and
-- unconditional timestamp LWW for training cycles.

ALTER TABLE public.training_cycles
  ADD COLUMN IF NOT EXISTS progress_state JSONB;
ALTER TABLE public.cycle_days
  ADD COLUMN IF NOT EXISTS echo_level TEXT,
  ADD COLUMN IF NOT EXISTS eccentric_load_percent INT;

CREATE TABLE IF NOT EXISTS public.workout_deletion_tombstones (
  mutation_id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  request_hash TEXT NOT NULL,
  profile_id TEXT,
  scope TEXT NOT NULL CHECK (scope IN ('COMPONENT', 'WORKOUT')),
  portal_session_id UUID NOT NULL,
  component_session_id UUID,
  deleted_at TIMESTAMPTZ NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT workout_deletion_component_shape CHECK (
    (scope = 'COMPONENT' AND component_session_id IS NOT NULL) OR
    (scope = 'WORKOUT' AND component_session_id IS NULL)
  )
);

DROP INDEX IF EXISTS public.idx_workout_deletion_account_cursor;
CREATE INDEX IF NOT EXISTS idx_workout_deletion_account_cursor
  ON public.workout_deletion_tombstones(user_id, recorded_at, mutation_id);
CREATE INDEX IF NOT EXISTS idx_workout_deletion_target
  ON public.workout_deletion_tombstones(user_id, portal_session_id, component_session_id);

CREATE TABLE IF NOT EXISTS public.training_cycle_deletion_tombstones (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  cycle_id UUID NOT NULL,
  deleted_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (user_id, cycle_id)
);

CREATE TABLE IF NOT EXISTS public.profile_ownership_claims (
  entity_type TEXT NOT NULL CHECK (entity_type IN (
    'workout_session', 'routine', 'training_cycle', 'personal_record'
  )),
  entity_id UUID NOT NULL,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  target_profile_id TEXT NOT NULL,
  mutation_id UUID NOT NULL,
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (entity_type, entity_id)
);

ALTER TABLE public.workout_deletion_tombstones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.training_cycle_deletion_tombstones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profile_ownership_claims ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS workout_deletion_select_own ON public.workout_deletion_tombstones;
CREATE POLICY workout_deletion_select_own
  ON public.workout_deletion_tombstones FOR SELECT
  USING (auth.uid() = user_id);
DROP POLICY IF EXISTS training_cycle_deletion_select_own ON public.training_cycle_deletion_tombstones;
CREATE POLICY training_cycle_deletion_select_own
  ON public.training_cycle_deletion_tombstones FOR SELECT USING (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS public.profile_ownership_transfers (
  mutation_id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  request_hash TEXT NOT NULL,
  source_profile_id TEXT,
  target_profile_id TEXT NOT NULL,
  workout_session_ids UUID[] NOT NULL DEFAULT '{}',
  routine_ids UUID[] NOT NULL DEFAULT '{}',
  cycle_ids UUID[] NOT NULL DEFAULT '{}',
  personal_record_ids UUID[] NOT NULL DEFAULT '{}',
  transferred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.profile_ownership_events (
  mutation_id UUID PRIMARY KEY REFERENCES public.profile_ownership_transfers(mutation_id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source_profile_id TEXT,
  target_profile_id TEXT NOT NULL,
  target_profile_name TEXT NOT NULL,
  target_profile_color_index INT NOT NULL,
  workout_session_ids UUID[] NOT NULL DEFAULT '{}',
  routine_ids UUID[] NOT NULL DEFAULT '{}',
  cycle_ids UUID[] NOT NULL DEFAULT '{}',
  personal_record_ids UUID[] NOT NULL DEFAULT '{}',
  transferred_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_profile_ownership_event_account_cursor
  ON public.profile_ownership_events(user_id, transferred_at, mutation_id);

ALTER TABLE public.profile_ownership_transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profile_ownership_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS profile_ownership_transfer_select_own ON public.profile_ownership_transfers;
CREATE POLICY profile_ownership_transfer_select_own
  ON public.profile_ownership_transfers FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS profile_ownership_event_select_own ON public.profile_ownership_events;
CREATE POLICY profile_ownership_event_select_own
  ON public.profile_ownership_events FOR SELECT USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.guard_profile_ownership_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF OLD.local_profile_id IS DISTINCT FROM NEW.local_profile_id
     AND COALESCE(current_setting('phoenix.allow_profile_transfer', TRUE), '') <> 'on' THEN
    RAISE EXCEPTION 'profile_ownership_transfer_required' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.guard_profile_ownership_claim()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_entity_type TEXT;
  v_entity_id UUID;
  v_claim RECORD;
BEGIN
  v_entity_type := CASE TG_TABLE_NAME
    WHEN 'workout_sessions' THEN 'workout_session'
    WHEN 'exercise_progress' THEN 'workout_session'
    WHEN 'routines' THEN 'routine'
    WHEN 'training_cycles' THEN 'training_cycle'
    WHEN 'personal_records' THEN 'personal_record'
  END;
  IF TG_TABLE_NAME = 'exercise_progress' THEN
    v_entity_id := (to_jsonb(NEW)->>'session_id')::UUID;
  ELSE
    v_entity_id := (to_jsonb(NEW)->>'id')::UUID;
  END IF;
  IF v_entity_id IS NULL THEN RETURN NEW; END IF;

  SELECT c.user_id, c.target_profile_id INTO v_claim
  FROM public.profile_ownership_claims c
  WHERE c.entity_type = v_entity_type AND c.entity_id = v_entity_id;
  IF FOUND AND (
    v_claim.user_id <> NEW.user_id OR
    v_claim.target_profile_id IS DISTINCT FROM NEW.local_profile_id
  ) THEN
    RAISE EXCEPTION 'profile_ownership_claim_mismatch' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

DO $$
DECLARE
  v_table TEXT;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'workout_sessions', 'routines', 'training_cycles',
    'personal_records', 'exercise_progress'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS guard_profile_ownership_update ON public.%I', v_table);
    EXECUTE format(
      'CREATE TRIGGER guard_profile_ownership_update BEFORE UPDATE OF local_profile_id ON public.%I FOR EACH ROW EXECUTE FUNCTION public.guard_profile_ownership_update()',
      v_table
    );
    EXECUTE format('DROP TRIGGER IF EXISTS guard_profile_ownership_claim ON public.%I', v_table);
    EXECUTE format(
      'CREATE TRIGGER guard_profile_ownership_claim BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.guard_profile_ownership_claim()',
      v_table
    );
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.guard_workout_tombstone()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'workout-portal:' || NEW.user_id::TEXT || ':' || NEW.id::TEXT, 0
  ));

  IF EXISTS (
    SELECT 1
    FROM public.workout_deletion_tombstones t
    WHERE t.user_id = NEW.user_id
      AND t.scope = 'WORKOUT'
      AND t.portal_session_id = NEW.id
  ) THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_workout_tombstone ON public.workout_sessions;
CREATE TRIGGER guard_workout_tombstone
  BEFORE INSERT OR UPDATE ON public.workout_sessions
  FOR EACH ROW EXECUTE FUNCTION public.guard_workout_tombstone();

CREATE OR REPLACE FUNCTION public.guard_workout_component_tombstone()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'workout-portal:' || NEW.user_id::TEXT || ':' || NEW.session_id::TEXT, 0
  ));
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'workout-component:' || NEW.user_id::TEXT || ':' || NEW.id::TEXT, 0
  ));

  IF EXISTS (
    SELECT 1
    FROM public.workout_deletion_tombstones t
    WHERE t.user_id = NEW.user_id
      AND (
        (t.scope = 'WORKOUT' AND t.portal_session_id = NEW.session_id) OR
        (t.scope = 'COMPONENT' AND t.portal_session_id = NEW.session_id
          AND t.component_session_id = NEW.id)
      )
  ) THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_workout_component_tombstone ON public.exercises;
CREATE TRIGGER guard_workout_component_tombstone
  BEFORE INSERT OR UPDATE ON public.exercises
  FOR EACH ROW EXECUTE FUNCTION public.guard_workout_component_tombstone();

CREATE OR REPLACE FUNCTION public.guard_training_cycle_lww()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_deleted_at TIMESTAMPTZ;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('training-cycle:' || NEW.id::TEXT, 0)
  );
  SELECT t.deleted_at INTO v_deleted_at
  FROM public.training_cycle_deletion_tombstones t
  WHERE t.user_id = NEW.user_id AND t.cycle_id = NEW.id;
  IF FOUND THEN
    IF NEW.updated_at IS NULL OR v_deleted_at >= NEW.updated_at THEN
      RETURN NULL;
    END IF;
    DELETE FROM public.training_cycle_deletion_tombstones t
    WHERE t.user_id = NEW.user_id AND t.cycle_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_training_cycle_lww ON public.training_cycles;
CREATE TRIGGER guard_training_cycle_lww
  BEFORE INSERT OR UPDATE ON public.training_cycles
  FOR EACH ROW EXECUTE FUNCTION public.guard_training_cycle_lww();

CREATE OR REPLACE FUNCTION public.get_blocked_workout_session_ids(
  p_user_id UUID,
  p_sessions JSONB
)
RETURNS TABLE(session_id UUID)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH incoming AS (
    SELECT
      (row->>'id')::UUID AS session_id,
      COALESCE(
        NULLIF(row->>'portalSessionId', '')::UUID,
        (row->>'id')::UUID
      ) AS portal_session_id
    FROM jsonb_array_elements(COALESCE(p_sessions, '[]'::JSONB)) row
  )
  SELECT DISTINCT i.session_id
  FROM incoming i
  JOIN public.workout_deletion_tombstones t
   ON t.user_id = p_user_id
   AND t.portal_session_id = i.portal_session_id
   AND t.scope = 'WORKOUT';
$$;

CREATE OR REPLACE FUNCTION public.get_blocked_workout_component_ids(
  p_user_id UUID,
  p_components JSONB
)
RETURNS TABLE(component_id UUID)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH incoming AS (
    SELECT
      (row->>'id')::UUID AS component_id,
      (row->>'portalSessionId')::UUID AS portal_session_id
    FROM jsonb_array_elements(COALESCE(p_components, '[]'::JSONB)) row
  )
  SELECT DISTINCT i.component_id
  FROM incoming i
  JOIN public.workout_deletion_tombstones t
    ON t.user_id = p_user_id
   AND t.portal_session_id = i.portal_session_id
   AND (t.scope = 'WORKOUT' OR t.component_session_id = i.component_id);
$$;

CREATE OR REPLACE FUNCTION public.transfer_profile_ownership(
  p_user_id UUID,
  p_transfers JSONB
)
RETURNS TABLE(mutation_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  rec JSONB;
  v_mutation_id UUID;
  v_source TEXT;
  v_target TEXT;
  v_sessions UUID[];
  v_routines UUID[];
  v_cycles UUID[];
  v_records UUID[];
  v_hash TEXT;
  v_existing RECORD;
  v_target_name TEXT;
  v_target_color INT;
  v_transferred_at TIMESTAMPTZ;
  v_lock RECORD;
BEGIN
  IF jsonb_typeof(COALESCE(p_transfers, '[]'::JSONB)) <> 'array' THEN
    RAISE EXCEPTION 'invalid_ownership_transfers' USING ERRCODE = '22023';
  END IF;

  -- All account events share one causal clock. Acquire this before any entity
  -- locks so concurrent/chained transfers cannot deadlock or receive an event
  -- order that differs from the committed source -> target sequence.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'profile-ownership-account:' || p_user_id::TEXT, 0
  ));

  FOR rec IN SELECT value FROM jsonb_array_elements(COALESCE(p_transfers, '[]'::JSONB)) LOOP
    v_mutation_id := (rec->>'mutationId')::UUID;
    v_source := rec->>'sourceProfileId';
    v_target := rec->>'targetProfileId';
    SELECT COALESCE(array_agg(value::UUID ORDER BY value), '{}'::UUID[])
      INTO v_sessions FROM jsonb_array_elements_text(COALESCE(rec->'workoutSessionIds', '[]'::JSONB));
    SELECT COALESCE(array_agg(value::UUID ORDER BY value), '{}'::UUID[])
      INTO v_routines FROM jsonb_array_elements_text(COALESCE(rec->'routineIds', '[]'::JSONB));
    SELECT COALESCE(array_agg(value::UUID ORDER BY value), '{}'::UUID[])
      INTO v_cycles FROM jsonb_array_elements_text(COALESCE(rec->'cycleIds', '[]'::JSONB));
    SELECT COALESCE(array_agg(value::UUID ORDER BY value), '{}'::UUID[])
      INTO v_records FROM jsonb_array_elements_text(COALESCE(rec->'personalRecordIds', '[]'::JSONB));

    IF cardinality(v_sessions) + cardinality(v_routines) + cardinality(v_cycles) + cardinality(v_records) = 0 THEN
      RAISE EXCEPTION 'ownership_transfer_requires_entity_ids' USING ERRCODE = '22023';
    END IF;
    IF cardinality(v_sessions) <> (SELECT count(DISTINCT x) FROM unnest(v_sessions) x)
       OR cardinality(v_routines) <> (SELECT count(DISTINCT x) FROM unnest(v_routines) x)
       OR cardinality(v_cycles) <> (SELECT count(DISTINCT x) FROM unnest(v_cycles) x)
       OR cardinality(v_records) <> (SELECT count(DISTINCT x) FROM unnest(v_records) x) THEN
      RAISE EXCEPTION 'ownership_transfer_duplicate_entity_id' USING ERRCODE = '22023';
    END IF;

    -- Lock every affected identity in canonical order, including ids which do
    -- not have a server row yet. This serializes overlapping transfers and
    -- makes source validation + claim update one atomic decision.
    FOR v_lock IN
      SELECT entity_type, entity_id FROM (
        SELECT 'workout_session'::TEXT entity_type, x entity_id FROM unnest(v_sessions) x
        UNION ALL SELECT 'routine', x FROM unnest(v_routines) x
        UNION ALL SELECT 'training_cycle', x FROM unnest(v_cycles) x
        UNION ALL SELECT 'personal_record', x FROM unnest(v_records) x
      ) locks ORDER BY entity_type, entity_id
    LOOP
      PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(v_lock.entity_type || ':' || v_lock.entity_id::TEXT, 0)
      );
    END LOOP;

    v_hash := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(jsonb_build_object(
      'sourceProfileId', v_source,
      'targetProfileId', v_target,
      'workoutSessionIds', to_jsonb(v_sessions),
      'routineIds', to_jsonb(v_routines),
      'cycleIds', to_jsonb(v_cycles),
      'personalRecordIds', to_jsonb(v_records)
    )::TEXT, 'UTF8')), 'hex');

    -- Serialize concurrent retries of the same immutable mutation id. Without
    -- this lock two identical requests can both miss the row and one loses on
    -- the primary key instead of receiving an idempotent acknowledgement.
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(v_mutation_id::TEXT, 0)
    );

    SELECT t.user_id, t.request_hash INTO v_existing
    FROM public.profile_ownership_transfers t WHERE t.mutation_id = v_mutation_id;
    IF FOUND THEN
      IF v_existing.user_id <> p_user_id OR v_existing.request_hash <> v_hash THEN
        RAISE EXCEPTION 'ownership_mutation_id_reuse' USING ERRCODE = '23505';
      END IF;
      mutation_id := v_mutation_id;
      RETURN NEXT;
      CONTINUE;
    END IF;

    -- Registration is required for a new transfer. A byte-equivalent replay
    -- above acknowledges the durable committed event even if a later device
    -- registration cleanup removed the target profile row.
    SELECT lp.name, lp.color_index
      INTO v_target_name, v_target_color
    FROM public.local_profiles lp
    WHERE lp.user_id = p_user_id AND lp.id = v_target;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'ownership_target_profile_not_registered' USING ERRCODE = 'P0001';
    END IF;

    IF EXISTS (SELECT 1 FROM public.workout_sessions s WHERE s.id = ANY(v_sessions) AND s.user_id <> p_user_id)
       OR EXISTS (SELECT 1 FROM public.routines r WHERE r.id = ANY(v_routines) AND r.user_id <> p_user_id)
       OR EXISTS (SELECT 1 FROM public.training_cycles c WHERE c.id = ANY(v_cycles) AND c.user_id <> p_user_id)
       OR EXISTS (SELECT 1 FROM public.personal_records p WHERE p.id = ANY(v_records) AND p.user_id <> p_user_id)
       OR EXISTS (
         SELECT 1 FROM public.profile_ownership_claims c
         WHERE c.user_id <> p_user_id AND (
           (c.entity_type = 'workout_session' AND c.entity_id = ANY(v_sessions)) OR
           (c.entity_type = 'routine' AND c.entity_id = ANY(v_routines)) OR
           (c.entity_type = 'training_cycle' AND c.entity_id = ANY(v_cycles)) OR
           (c.entity_type = 'personal_record' AND c.entity_id = ANY(v_records))
         )
       ) THEN
      RAISE EXCEPTION 'ownership_entity_account_mismatch' USING ERRCODE = 'P0001';
    END IF;

    IF EXISTS (SELECT 1 FROM public.workout_sessions s WHERE s.user_id = p_user_id AND s.id = ANY(v_sessions) AND s.local_profile_id IS DISTINCT FROM v_source)
       OR EXISTS (SELECT 1 FROM public.routines r WHERE r.user_id = p_user_id AND r.id = ANY(v_routines) AND r.local_profile_id IS DISTINCT FROM v_source)
       OR EXISTS (SELECT 1 FROM public.training_cycles c WHERE c.user_id = p_user_id AND c.id = ANY(v_cycles) AND c.local_profile_id IS DISTINCT FROM v_source)
       OR EXISTS (SELECT 1 FROM public.personal_records p WHERE p.user_id = p_user_id AND p.id = ANY(v_records) AND p.local_profile_id IS DISTINCT FROM v_source) THEN
      RAISE EXCEPTION 'ownership_source_or_entity_mismatch' USING ERRCODE = 'P0001';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.profile_ownership_claims c
      WHERE c.user_id = p_user_id AND c.target_profile_id IS DISTINCT FROM v_source AND (
        (c.entity_type = 'workout_session' AND c.entity_id = ANY(v_sessions)) OR
        (c.entity_type = 'routine' AND c.entity_id = ANY(v_routines)) OR
        (c.entity_type = 'training_cycle' AND c.entity_id = ANY(v_cycles)) OR
        (c.entity_type = 'personal_record' AND c.entity_id = ANY(v_records))
      )
    ) THEN
      RAISE EXCEPTION 'ownership_source_or_entity_mismatch' USING ERRCODE = 'P0001';
    END IF;

    v_transferred_at := date_trunc('milliseconds', clock_timestamp());
    SELECT GREATEST(
      v_transferred_at,
      COALESCE(max(t.transferred_at) + INTERVAL '1 millisecond', v_transferred_at)
    ) INTO v_transferred_at
    FROM public.profile_ownership_transfers t
    WHERE t.user_id = p_user_id;

    INSERT INTO public.profile_ownership_claims(
      entity_type, entity_id, user_id, target_profile_id, mutation_id, claimed_at
    )
      SELECT 'workout_session', x, p_user_id, v_target, v_mutation_id, v_transferred_at FROM unnest(v_sessions) x
      UNION ALL SELECT 'routine', x, p_user_id, v_target, v_mutation_id, v_transferred_at FROM unnest(v_routines) x
      UNION ALL SELECT 'training_cycle', x, p_user_id, v_target, v_mutation_id, v_transferred_at FROM unnest(v_cycles) x
      UNION ALL SELECT 'personal_record', x, p_user_id, v_target, v_mutation_id, v_transferred_at FROM unnest(v_records) x
    ON CONFLICT (entity_type, entity_id) DO UPDATE SET
      target_profile_id = EXCLUDED.target_profile_id,
      mutation_id = EXCLUDED.mutation_id,
      claimed_at = EXCLUDED.claimed_at
    WHERE public.profile_ownership_claims.user_id = EXCLUDED.user_id;
    IF (
      SELECT count(*) FROM public.profile_ownership_claims c
      WHERE c.user_id = p_user_id AND c.target_profile_id = v_target AND (
        (c.entity_type = 'workout_session' AND c.entity_id = ANY(v_sessions)) OR
        (c.entity_type = 'routine' AND c.entity_id = ANY(v_routines)) OR
        (c.entity_type = 'training_cycle' AND c.entity_id = ANY(v_cycles)) OR
        (c.entity_type = 'personal_record' AND c.entity_id = ANY(v_records))
      )
    ) <> cardinality(v_sessions) + cardinality(v_routines) + cardinality(v_cycles) + cardinality(v_records) THEN
      RAISE EXCEPTION 'ownership_entity_account_mismatch' USING ERRCODE = 'P0001';
    END IF;

    PERFORM set_config('phoenix.allow_profile_transfer', 'on', TRUE);
    UPDATE public.workout_sessions SET local_profile_id = v_target
      WHERE user_id = p_user_id AND id = ANY(v_sessions) AND local_profile_id IS NOT DISTINCT FROM v_source;
    UPDATE public.exercise_progress SET local_profile_id = v_target
      WHERE user_id = p_user_id AND session_id = ANY(v_sessions) AND local_profile_id IS NOT DISTINCT FROM v_source;
    UPDATE public.routines SET local_profile_id = v_target
      WHERE user_id = p_user_id AND id = ANY(v_routines) AND local_profile_id IS NOT DISTINCT FROM v_source;
    UPDATE public.training_cycles SET local_profile_id = v_target
      WHERE user_id = p_user_id AND id = ANY(v_cycles) AND local_profile_id IS NOT DISTINCT FROM v_source;
    UPDATE public.personal_records SET local_profile_id = v_target
      WHERE user_id = p_user_id AND id = ANY(v_records) AND local_profile_id IS NOT DISTINCT FROM v_source;
    PERFORM set_config('phoenix.allow_profile_transfer', '', TRUE);

    INSERT INTO public.profile_ownership_transfers(
      mutation_id, user_id, request_hash, source_profile_id, target_profile_id,
      workout_session_ids, routine_ids, cycle_ids, personal_record_ids, transferred_at
    ) VALUES (
      v_mutation_id, p_user_id, v_hash, v_source, v_target,
      v_sessions, v_routines, v_cycles, v_records, v_transferred_at
    );
    INSERT INTO public.profile_ownership_events(
      mutation_id, user_id, source_profile_id, target_profile_id,
      target_profile_name, target_profile_color_index, workout_session_ids,
      routine_ids, cycle_ids, personal_record_ids, transferred_at
    ) VALUES (
      v_mutation_id, p_user_id, v_source, v_target,
      v_target_name, v_target_color, v_sessions,
      v_routines, v_cycles, v_records, v_transferred_at
    );

    mutation_id := v_mutation_id;
    RETURN NEXT;
  END LOOP;
END;
$$;

-- Non-mutating proof used before a device binds an ownerless cloud-origin
-- recovery group to the currently authenticated account. Required proof ids
-- must exist remotely; other exact group ids may still be local-only. The
-- result intentionally exposes no foreign-vs-missing per-id information.
CREATE OR REPLACE FUNCTION public.verify_profile_recovery_source(
  p_source_profile_id TEXT,
  p_workout_session_ids UUID[],
  p_routine_ids UUID[],
  p_cycle_ids UUID[],
  p_personal_record_ids UUID[],
  p_proof_workout_session_ids UUID[],
  p_proof_routine_ids UUID[],
  p_proof_cycle_ids UUID[],
  p_proof_personal_record_ids UUID[]
)
RETURNS TABLE(
  verified BOOLEAN,
  authenticated_owner_user_id UUID,
  verified_proof_count INT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_sessions UUID[] := COALESCE(p_workout_session_ids, '{}'::UUID[]);
  v_routines UUID[] := COALESCE(p_routine_ids, '{}'::UUID[]);
  v_cycles UUID[] := COALESCE(p_cycle_ids, '{}'::UUID[]);
  v_records UUID[] := COALESCE(p_personal_record_ids, '{}'::UUID[]);
  v_proof_sessions UUID[] := COALESCE(p_proof_workout_session_ids, '{}'::UUID[]);
  v_proof_routines UUID[] := COALESCE(p_proof_routine_ids, '{}'::UUID[]);
  v_proof_cycles UUID[] := COALESCE(p_proof_cycle_ids, '{}'::UUID[]);
  v_proof_records UUID[] := COALESCE(p_proof_personal_record_ids, '{}'::UUID[]);
  v_proof_count INT;
  v_valid BOOLEAN := TRUE;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'authentication_required' USING ERRCODE = '42501';
  END IF;
  IF p_source_profile_id IS NOT NULL
     AND p_source_profile_id <> 'default'
     AND p_source_profile_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION 'invalid_recovery_source_profile_id' USING ERRCODE = '22023';
  END IF;

  v_proof_count := cardinality(v_proof_sessions) + cardinality(v_proof_routines)
    + cardinality(v_proof_cycles) + cardinality(v_proof_records);

  -- Reject empty proof, duplicate proof inflation, or proof ids outside the
  -- exact group without revealing which validation failed.
  IF v_proof_count = 0
     OR cardinality(v_proof_sessions) <> (SELECT count(DISTINCT x) FROM unnest(v_proof_sessions) x)
     OR cardinality(v_proof_routines) <> (SELECT count(DISTINCT x) FROM unnest(v_proof_routines) x)
     OR cardinality(v_proof_cycles) <> (SELECT count(DISTINCT x) FROM unnest(v_proof_cycles) x)
     OR cardinality(v_proof_records) <> (SELECT count(DISTINCT x) FROM unnest(v_proof_records) x)
     OR EXISTS (SELECT 1 FROM unnest(v_proof_sessions) x WHERE NOT (x = ANY(v_sessions)))
     OR EXISTS (SELECT 1 FROM unnest(v_proof_routines) x WHERE NOT (x = ANY(v_routines)))
     OR EXISTS (SELECT 1 FROM unnest(v_proof_cycles) x WHERE NOT (x = ANY(v_cycles)))
     OR EXISTS (SELECT 1 FROM unnest(v_proof_records) x WHERE NOT (x = ANY(v_records))) THEN
    v_valid := FALSE;
  END IF;

  -- Any remotely existing identity in the complete group must already match
  -- the authenticated account and declared source. Missing non-proof ids are
  -- allowed because they may be stable local ids not uploaded yet.
  IF v_valid AND (
    EXISTS (SELECT 1 FROM public.workout_sessions s WHERE s.id = ANY(v_sessions)
      AND (s.user_id <> v_user_id OR s.local_profile_id IS DISTINCT FROM p_source_profile_id))
    OR EXISTS (SELECT 1 FROM public.routines r WHERE r.id = ANY(v_routines)
      AND (r.user_id <> v_user_id OR r.local_profile_id IS DISTINCT FROM p_source_profile_id))
    OR EXISTS (SELECT 1 FROM public.training_cycles c WHERE c.id = ANY(v_cycles)
      AND (c.user_id <> v_user_id OR c.local_profile_id IS DISTINCT FROM p_source_profile_id))
    OR EXISTS (SELECT 1 FROM public.personal_records p WHERE p.id = ANY(v_records)
      AND (p.user_id <> v_user_id OR p.local_profile_id IS DISTINCT FROM p_source_profile_id))
    OR EXISTS (
      SELECT 1 FROM public.profile_ownership_claims c
      WHERE (
        (c.entity_type = 'workout_session' AND c.entity_id = ANY(v_sessions)) OR
        (c.entity_type = 'routine' AND c.entity_id = ANY(v_routines)) OR
        (c.entity_type = 'training_cycle' AND c.entity_id = ANY(v_cycles)) OR
        (c.entity_type = 'personal_record' AND c.entity_id = ANY(v_records))
      ) AND (c.user_id <> v_user_id OR c.target_profile_id IS DISTINCT FROM p_source_profile_id)
    )
  ) THEN
    v_valid := FALSE;
  END IF;

  -- Every cloud-origin proof id must have positive remote evidence as either
  -- an entity row or a durable account/profile ownership claim.
  IF v_valid AND (
    EXISTS (SELECT 1 FROM unnest(v_proof_sessions) x WHERE
      NOT EXISTS (SELECT 1 FROM public.workout_sessions s WHERE s.id=x AND s.user_id=v_user_id AND s.local_profile_id IS NOT DISTINCT FROM p_source_profile_id)
      AND NOT EXISTS (SELECT 1 FROM public.profile_ownership_claims c WHERE c.entity_type='workout_session' AND c.entity_id=x AND c.user_id=v_user_id AND c.target_profile_id IS NOT DISTINCT FROM p_source_profile_id))
    OR EXISTS (SELECT 1 FROM unnest(v_proof_routines) x WHERE
      NOT EXISTS (SELECT 1 FROM public.routines r WHERE r.id=x AND r.user_id=v_user_id AND r.local_profile_id IS NOT DISTINCT FROM p_source_profile_id)
      AND NOT EXISTS (SELECT 1 FROM public.profile_ownership_claims c WHERE c.entity_type='routine' AND c.entity_id=x AND c.user_id=v_user_id AND c.target_profile_id IS NOT DISTINCT FROM p_source_profile_id))
    OR EXISTS (SELECT 1 FROM unnest(v_proof_cycles) x WHERE
      NOT EXISTS (SELECT 1 FROM public.training_cycles c WHERE c.id=x AND c.user_id=v_user_id AND c.local_profile_id IS NOT DISTINCT FROM p_source_profile_id)
      AND NOT EXISTS (SELECT 1 FROM public.profile_ownership_claims c WHERE c.entity_type='training_cycle' AND c.entity_id=x AND c.user_id=v_user_id AND c.target_profile_id IS NOT DISTINCT FROM p_source_profile_id))
    OR EXISTS (SELECT 1 FROM unnest(v_proof_records) x WHERE
      NOT EXISTS (SELECT 1 FROM public.personal_records p WHERE p.id=x AND p.user_id=v_user_id AND p.local_profile_id IS NOT DISTINCT FROM p_source_profile_id)
      AND NOT EXISTS (SELECT 1 FROM public.profile_ownership_claims c WHERE c.entity_type='personal_record' AND c.entity_id=x AND c.user_id=v_user_id AND c.target_profile_id IS NOT DISTINCT FROM p_source_profile_id))
  ) THEN
    v_valid := FALSE;
  END IF;

  verified := v_valid;
  authenticated_owner_user_id := CASE WHEN v_valid THEN v_user_id ELSE NULL END;
  verified_proof_count := CASE WHEN v_valid THEN v_proof_count ELSE 0 END;
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_workout_deletions(
  p_user_id UUID,
  p_request_profile_id TEXT,
  p_deletions JSONB
)
RETURNS TABLE(mutation_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  rec JSONB;
  v_mutation_id UUID;
  v_scope TEXT;
  v_portal UUID;
  v_component UUID;
  v_deleted_at TIMESTAMPTZ;
  v_hash TEXT;
  v_existing RECORD;
  v_target_count INT;
  v_wrong_group_count INT;
BEGIN
  IF p_request_profile_id IS NOT NULL
     AND p_request_profile_id <> 'default'
     AND p_request_profile_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION 'invalid_deletion_profile_id' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(COALESCE(p_deletions, '[]'::JSONB)) <> 'array' THEN
    RAISE EXCEPTION 'invalid_workout_deletions' USING ERRCODE = '22023';
  END IF;

  FOR rec IN SELECT value FROM jsonb_array_elements(COALESCE(p_deletions, '[]'::JSONB)) LOOP
    v_mutation_id := (rec->>'mutationId')::UUID;
    v_scope := rec->>'scope';
    v_portal := (rec->>'portalSessionId')::UUID;
    v_component := NULLIF(rec->>'componentSessionId', '')::UUID;
    v_deleted_at := (rec->>'deletedAt')::TIMESTAMPTZ;
    IF (v_scope = 'COMPONENT' AND v_component IS NULL)
       OR (v_scope = 'WORKOUT' AND v_component IS NOT NULL)
       OR v_scope NOT IN ('COMPONENT', 'WORKOUT') THEN
      RAISE EXCEPTION 'invalid_workout_deletion_scope' USING ERRCODE = '22023';
    END IF;

    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      'workout-portal:' || p_user_id::TEXT || ':' || v_portal::TEXT, 0
    ));
    IF v_component IS NOT NULL THEN
      PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
        'workout-component:' || p_user_id::TEXT || ':' || v_component::TEXT, 0
      ));
    END IF;

    v_hash := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(jsonb_build_object(
      'profileId', p_request_profile_id,
      'scope', v_scope,
      'portalSessionId', v_portal,
      'componentSessionId', v_component,
      'deletedAt', v_deleted_at
    )::TEXT, 'UTF8')), 'hex');
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(v_mutation_id::TEXT, 0)
    );
    SELECT t.user_id, t.request_hash INTO v_existing
    FROM public.workout_deletion_tombstones t WHERE t.mutation_id = v_mutation_id;
    IF FOUND THEN
      IF v_existing.user_id <> p_user_id OR v_existing.request_hash <> v_hash THEN
        RAISE EXCEPTION 'workout_deletion_mutation_id_reuse' USING ERRCODE = '23505';
      END IF;
      mutation_id := v_mutation_id;
      RETURN NEXT;
      CONTINUE;
    END IF;

    IF (v_scope = 'COMPONENT' AND EXISTS (
      SELECT 1 FROM public.exercises e WHERE e.id = v_component AND e.user_id <> p_user_id
    )) OR (v_scope = 'WORKOUT' AND EXISTS (
      SELECT 1 FROM public.workout_sessions s WHERE s.id = v_portal AND s.user_id <> p_user_id
    )) THEN
      RAISE EXCEPTION 'workout_deletion_account_mismatch' USING ERRCODE = 'P0001';
    END IF;

    IF v_scope = 'COMPONENT' THEN
      SELECT count(*),
        count(*) FILTER (WHERE e.session_id <> v_portal)
        INTO v_target_count, v_wrong_group_count
      FROM public.exercises e
      JOIN public.workout_sessions s ON s.id = e.session_id AND s.user_id = e.user_id
      WHERE e.user_id = p_user_id AND e.id = v_component;
      IF v_wrong_group_count > 0 THEN
        RAISE EXCEPTION 'workout_deletion_group_mismatch' USING ERRCODE = 'P0001';
      END IF;
    ELSE
      SELECT count(*)
        INTO v_target_count
      FROM public.workout_sessions s
      WHERE s.user_id = p_user_id AND s.id = v_portal;
    END IF;

    INSERT INTO public.workout_deletion_tombstones(
      mutation_id, user_id, request_hash, profile_id, scope,
      portal_session_id, component_session_id, deleted_at
    ) VALUES (
      v_mutation_id, p_user_id, v_hash, p_request_profile_id, v_scope,
      v_portal, v_component, v_deleted_at
    );

    IF v_scope = 'COMPONENT' THEN
      DELETE FROM public.exercises
      WHERE user_id = p_user_id AND id = v_component AND session_id = v_portal;

      -- Two devices can each delete a different member from the same stale
      -- two-member snapshot. The second serialized component deletion is the
      -- final-member deletion even though its immutable client body still says
      -- COMPONENT. Preserve that original ledger row and exact ack, and add a
      -- separate server-derived WORKOUT event before removing the empty parent.
      IF v_target_count > 0
         AND EXISTS (
           SELECT 1 FROM public.workout_sessions s
           WHERE s.user_id = p_user_id AND s.id = v_portal
         )
         AND NOT EXISTS (
           SELECT 1 FROM public.exercises e
           WHERE e.session_id = v_portal
         ) THEN
        INSERT INTO public.workout_deletion_tombstones(
          mutation_id, user_id, request_hash, profile_id, scope,
          portal_session_id, component_session_id, deleted_at
        ) VALUES (
          pg_catalog.gen_random_uuid(),
          p_user_id,
          pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
            jsonb_build_object(
              'derivedFromMutationId', v_mutation_id,
              'profileId', p_request_profile_id,
              'scope', 'WORKOUT',
              'portalSessionId', v_portal,
              'componentSessionId', NULL,
              'deletedAt', v_deleted_at
            )::TEXT,
            'UTF8'
          )), 'hex'),
          p_request_profile_id,
          'WORKOUT',
          v_portal,
          NULL,
          v_deleted_at
        );

        DELETE FROM public.workout_sessions
        WHERE user_id = p_user_id AND id = v_portal;
      ELSE
        UPDATE public.workout_sessions ws SET
          exercise_count = x.exercise_count,
          set_count = x.set_count,
          total_volume = x.total_volume,
          pr_count = x.pr_count
        FROM (
          SELECT s.id,
            count(DISTINCT e.id)::INT AS exercise_count,
            count(st.id)::INT AS set_count,
            COALESCE(sum(st.weight_kg * st.actual_reps), 0) AS total_volume,
            count(st.id) FILTER (WHERE st.is_pr)::INT AS pr_count
          FROM public.workout_sessions s
          LEFT JOIN public.exercises e ON e.session_id = s.id
          LEFT JOIN public.sets st ON st.exercise_id = e.id
          WHERE s.user_id = p_user_id AND s.id = v_portal
          GROUP BY s.id
        ) x WHERE ws.id = x.id;
      END IF;
    ELSE
      DELETE FROM public.workout_sessions
      WHERE user_id = p_user_id AND id = v_portal;
    END IF;

    mutation_id := v_mutation_id;
    RETURN NEXT;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_workout_with_tombstone(
  p_mutation_id UUID,
  p_portal_session_id UUID,
  p_component_session_id UUID,
  p_scope TEXT,
  p_profile_id TEXT,
  p_deleted_at TIMESTAMPTZ
)
RETURNS TABLE(mutation_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id UUID := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'authentication_required' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT d.mutation_id
  FROM public.apply_workout_deletions(
    v_user_id,
    p_profile_id,
    jsonb_build_array(jsonb_build_object(
      'mutationId', p_mutation_id,
      'scope', p_scope,
      'portalSessionId', p_portal_session_id,
      'componentSessionId', p_component_session_id,
      'deletedAt', p_deleted_at
    ))
  ) d;
END;
$$;

-- Replace only the listed stable component exercise ids. Multiple mobile
-- components share one portal workout_sessions parent; omitted component ids
-- are siblings and must remain untouched by a partial/older upload.
CREATE OR REPLACE FUNCTION public.replace_session_components(
  p_user_id UUID,
  p_component_ids UUID[],
  p_exercises JSONB,
  p_sets JSONB,
  p_rep_summaries JSONB,
  p_rep_telemetry JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_exercises INT := 0;
  v_sets INT := 0;
  v_rep_summaries INT := 0;
  v_rep_telemetry INT := 0;
  v_parent_ids UUID[] := '{}'::UUID[];
BEGIN
  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(COALESCE(p_exercises, '[]'::JSONB))
      AS x(id UUID, session_id UUID, user_id UUID)
    WHERE x.user_id <> p_user_id
       OR NOT (x.id = ANY(COALESCE(p_component_ids, '{}'::UUID[])))
       OR NOT EXISTS (
         SELECT 1 FROM public.workout_sessions s
         WHERE s.id = x.session_id AND s.user_id = p_user_id
       )
  ) THEN
    RAISE EXCEPTION 'workout_component_account_or_scope_mismatch' USING ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(array_agg(DISTINCT parent_id), '{}'::UUID[]) INTO v_parent_ids
  FROM (
    SELECT e.session_id AS parent_id
    FROM public.exercises e
    WHERE e.user_id = p_user_id AND e.id = ANY(COALESCE(p_component_ids, '{}'::UUID[]))
    UNION
    SELECT x.session_id AS parent_id
    FROM jsonb_to_recordset(COALESCE(p_exercises, '[]'::JSONB))
      AS x(id UUID, session_id UUID, user_id UUID)
  ) parents;

  DELETE FROM public.exercises
  WHERE id = ANY(COALESCE(p_component_ids, '{}'::UUID[]))
    AND user_id = p_user_id;

  IF jsonb_array_length(COALESCE(p_exercises, '[]'::JSONB)) > 0 THEN
    INSERT INTO public.exercises(id, session_id, user_id, name, exercise_id, muscle_group, order_index)
    SELECT id, session_id, user_id, name, exercise_id, muscle_group, order_index
    FROM jsonb_to_recordset(p_exercises) AS x(id UUID, session_id UUID, user_id UUID, name TEXT, exercise_id TEXT, muscle_group TEXT, order_index INT)
    ON CONFLICT (id) DO UPDATE SET session_id=EXCLUDED.session_id, user_id=EXCLUDED.user_id, name=EXCLUDED.name, exercise_id=EXCLUDED.exercise_id, muscle_group=EXCLUDED.muscle_group, order_index=EXCLUDED.order_index;
    GET DIAGNOSTICS v_exercises = ROW_COUNT;
  END IF;
  IF jsonb_array_length(COALESCE(p_sets, '[]'::JSONB)) > 0 THEN
    INSERT INTO public.sets(id, exercise_id, user_id, set_number, target_reps, actual_reps, weight_kg, rpe, is_pr, notes, workout_mode)
    SELECT id, exercise_id, user_id, set_number, target_reps, actual_reps, weight_kg, rpe, is_pr, notes, workout_mode
    FROM jsonb_to_recordset(p_sets) AS x(id UUID, exercise_id UUID, user_id UUID, set_number INT, target_reps INT, actual_reps INT, weight_kg NUMERIC, rpe NUMERIC, is_pr BOOLEAN, notes TEXT, workout_mode TEXT)
    ON CONFLICT (id) DO UPDATE SET exercise_id=EXCLUDED.exercise_id, user_id=EXCLUDED.user_id, set_number=EXCLUDED.set_number, target_reps=EXCLUDED.target_reps, actual_reps=EXCLUDED.actual_reps, weight_kg=EXCLUDED.weight_kg, rpe=EXCLUDED.rpe, is_pr=EXCLUDED.is_pr, notes=EXCLUDED.notes, workout_mode=EXCLUDED.workout_mode;
    GET DIAGNOSTICS v_sets = ROW_COUNT;
  END IF;
  IF jsonb_array_length(COALESCE(p_rep_summaries, '[]'::JSONB)) > 0 THEN
    INSERT INTO public.rep_summaries(id, set_id, user_id, rep_number, mean_velocity_mps, peak_velocity_mps, mean_force_n, peak_force_n, power_watts, rom_mm, tut_ms, left_force_avg, right_force_avg, asymmetry_pct, vbt_zone)
    SELECT id, set_id, user_id, rep_number, mean_velocity_mps, peak_velocity_mps, mean_force_n, peak_force_n, power_watts, rom_mm, tut_ms, left_force_avg, right_force_avg, asymmetry_pct, vbt_zone
    FROM jsonb_to_recordset(p_rep_summaries) AS x(id UUID, set_id UUID, user_id UUID, rep_number INT, mean_velocity_mps NUMERIC, peak_velocity_mps NUMERIC, mean_force_n NUMERIC, peak_force_n NUMERIC, power_watts NUMERIC, rom_mm NUMERIC, tut_ms INT, left_force_avg NUMERIC, right_force_avg NUMERIC, asymmetry_pct NUMERIC, vbt_zone TEXT)
    ON CONFLICT (id) DO UPDATE SET set_id=EXCLUDED.set_id, user_id=EXCLUDED.user_id, rep_number=EXCLUDED.rep_number, mean_velocity_mps=EXCLUDED.mean_velocity_mps, peak_velocity_mps=EXCLUDED.peak_velocity_mps, mean_force_n=EXCLUDED.mean_force_n, peak_force_n=EXCLUDED.peak_force_n, power_watts=EXCLUDED.power_watts, rom_mm=EXCLUDED.rom_mm, tut_ms=EXCLUDED.tut_ms, left_force_avg=EXCLUDED.left_force_avg, right_force_avg=EXCLUDED.right_force_avg, asymmetry_pct=EXCLUDED.asymmetry_pct, vbt_zone=EXCLUDED.vbt_zone;
    GET DIAGNOSTICS v_rep_summaries = ROW_COUNT;
  END IF;
  IF jsonb_array_length(COALESCE(p_rep_telemetry, '[]'::JSONB)) > 0 THEN
    INSERT INTO public.rep_telemetry(id, set_id, user_id, timestamp_ms, force_n, velocity_mps, position_mm, cable)
    SELECT id, set_id, user_id, timestamp_ms, force_n, velocity_mps, position_mm, cable
    FROM jsonb_to_recordset(p_rep_telemetry) AS x(id UUID, set_id UUID, user_id UUID, timestamp_ms BIGINT, force_n NUMERIC, velocity_mps NUMERIC, position_mm NUMERIC, cable TEXT)
    ON CONFLICT (id) DO UPDATE SET set_id=EXCLUDED.set_id, user_id=EXCLUDED.user_id, timestamp_ms=EXCLUDED.timestamp_ms, force_n=EXCLUDED.force_n, velocity_mps=EXCLUDED.velocity_mps, position_mm=EXCLUDED.position_mm, cable=EXCLUDED.cable;
    GET DIAGNOSTICS v_rep_telemetry = ROW_COUNT;
  END IF;

  UPDATE public.workout_sessions ws SET
    exercise_count = x.exercise_count,
    set_count = x.set_count,
    total_volume = x.total_volume,
    pr_count = x.pr_count
  FROM (
    SELECT s.id,
      count(DISTINCT e.id)::INT AS exercise_count,
      count(st.id)::INT AS set_count,
      COALESCE(sum(st.weight_kg * st.actual_reps), 0) AS total_volume,
      count(st.id) FILTER (WHERE st.is_pr)::INT AS pr_count
    FROM public.workout_sessions s
    LEFT JOIN public.exercises e ON e.session_id = s.id
    LEFT JOIN public.sets st ON st.exercise_id = e.id
    WHERE s.user_id = p_user_id AND s.id = ANY(v_parent_ids)
    GROUP BY s.id
  ) x WHERE ws.id = x.id;

  RETURN jsonb_build_object('exercises',v_exercises,'sets',v_sets,'rep_summaries',v_rep_summaries,'rep_telemetry',v_rep_telemetry);
END;
$$;

-- Parent acceptance and its complete component replacement share one database
-- transaction. Child rows are filtered inside the RPC to accepted parents, so
-- a crash or rejection cannot leave a new parent with old/partial children.
CREATE OR REPLACE FUNCTION public.upsert_workout_sessions_with_components(
  p_user_id UUID,
  p_enforce_lww BOOLEAN,
  p_rows JSONB,
  p_component_ids UUID[],
  p_exercises JSONB,
  p_sets JSONB,
  p_rep_summaries JSONB,
  p_rep_telemetry JSONB
)
RETURNS TABLE(id TEXT, accepted BOOLEAN, server_updated_at TIMESTAMPTZ)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  rec public.workout_sessions%ROWTYPE;
  result_rec RECORD;
  result_json JSONB;
  v_results JSONB := '[]'::JSONB;
  v_accepted_ids UUID[] := '{}'::UUID[];
  v_exercises JSONB;
  v_sets JSONB;
  v_rep_summaries JSONB;
  v_rep_telemetry JSONB;
  v_exercise_ids UUID[];
  v_set_ids UUID[];
  v_lock RECORD;
BEGIN
  IF EXISTS (
    SELECT 1 FROM jsonb_populate_recordset(NULL::public.workout_sessions, p_rows) r
    WHERE r.user_id <> p_user_id
  ) THEN
    RAISE EXCEPTION 'workout_session_account_mismatch' USING ERRCODE = 'P0001';
  END IF;

  -- The edge handler supplies one complete subtree for every named component.
  -- Reject a malformed graph instead of quietly filtering it after accepting
  -- the parent: any error must roll the parent and all dependent rows back.
  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(COALESCE(p_exercises, '[]'::JSONB))
      AS e(id UUID, session_id UUID, user_id UUID)
    WHERE e.user_id <> p_user_id
       OR NOT (e.id = ANY(COALESCE(p_component_ids, '{}'::UUID[])))
       OR NOT EXISTS (
         SELECT 1 FROM jsonb_populate_recordset(NULL::public.workout_sessions, p_rows) s
         WHERE s.id = e.session_id AND s.user_id = p_user_id
       )
  ) OR EXISTS (
    SELECT 1 FROM unnest(COALESCE(p_component_ids, '{}'::UUID[])) component_id
    WHERE NOT EXISTS (
      SELECT 1
      FROM jsonb_to_recordset(COALESCE(p_exercises, '[]'::JSONB)) AS e(id UUID)
      WHERE e.id = component_id
    )
  ) OR EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(COALESCE(p_sets, '[]'::JSONB))
      AS st(exercise_id UUID, user_id UUID)
    WHERE st.user_id <> p_user_id
       OR NOT EXISTS (
         SELECT 1
         FROM jsonb_to_recordset(COALESCE(p_exercises, '[]'::JSONB)) AS e(id UUID)
         WHERE e.id = st.exercise_id
       )
  ) OR EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(COALESCE(p_rep_summaries, '[]'::JSONB))
      AS r(set_id UUID, user_id UUID)
    WHERE r.user_id <> p_user_id
       OR NOT EXISTS (
         SELECT 1
         FROM jsonb_to_recordset(COALESCE(p_sets, '[]'::JSONB)) AS st(id UUID)
         WHERE st.id = r.set_id
       )
  ) OR EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(COALESCE(p_rep_telemetry, '[]'::JSONB))
      AS t(set_id UUID, user_id UUID)
    WHERE t.user_id <> p_user_id
       OR NOT EXISTS (
         SELECT 1
         FROM jsonb_to_recordset(COALESCE(p_sets, '[]'::JSONB)) AS st(id UUID)
         WHERE st.id = t.set_id
       )
  ) THEN
    RAISE EXCEPTION 'invalid_workout_component_graph' USING ERRCODE = '23503';
  END IF;

  FOR v_lock IN
    SELECT DISTINCT r.id AS portal_id
    FROM jsonb_populate_recordset(NULL::public.workout_sessions, p_rows) r
    ORDER BY r.id
  LOOP
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      'workout-portal:' || p_user_id::TEXT || ':' || v_lock.portal_id::TEXT, 0
    ));
  END LOOP;
  FOR v_lock IN
    SELECT component_id
    FROM unnest(COALESCE(p_component_ids, '{}'::UUID[])) component_id
    ORDER BY component_id
  LOOP
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      'workout-component:' || p_user_id::TEXT || ':' || v_lock.component_id::TEXT, 0
    ));
  END LOOP;

  IF p_enforce_lww THEN
    FOR result_rec IN SELECT * FROM public.upsert_workout_session_lww(p_rows) LOOP
      IF result_rec.accepted AND NOT EXISTS (
        SELECT 1 FROM public.workout_sessions s
        WHERE s.user_id = p_user_id AND s.id = result_rec.id::UUID
      ) THEN
        result_rec.accepted := FALSE;
        SELECT t.deleted_at INTO result_rec.server_updated_at
        FROM public.workout_deletion_tombstones t
        WHERE t.user_id = p_user_id AND t.scope = 'WORKOUT'
          AND t.portal_session_id = result_rec.id::UUID
        ORDER BY t.deleted_at DESC LIMIT 1;
      END IF;
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'id', result_rec.id,
        'accepted', result_rec.accepted,
        'server_updated_at', result_rec.server_updated_at
      ));
      IF result_rec.accepted THEN
        v_accepted_ids := array_append(v_accepted_ids, result_rec.id::UUID);
      END IF;
    END LOOP;
  ELSE
    FOR rec IN SELECT * FROM jsonb_populate_recordset(NULL::public.workout_sessions, p_rows) LOOP
      INSERT INTO public.workout_sessions AS ws (
        id,user_id,local_profile_id,name,started_at,duration_seconds,total_volume,
        set_count,exercise_count,pr_count,routine_name,workout_mode,routine_session_id,
        notes,avg_velocity_mps,avg_asymmetry_pct,velocity_loss_pct,dominant_side,
        strength_profile,form_score,deload_warnings,rom_violations,spotter_activations,
        peak_force_n,estimated_calories,heaviest_lift_kg,eccentric_load,echo_level,
        warmup_reps,working_reps,updated_at
      ) VALUES (
        rec.id,rec.user_id,rec.local_profile_id,rec.name,rec.started_at,rec.duration_seconds,
        rec.total_volume,rec.set_count,rec.exercise_count,rec.pr_count,rec.routine_name,
        rec.workout_mode,rec.routine_session_id,rec.notes,rec.avg_velocity_mps,
        rec.avg_asymmetry_pct,rec.velocity_loss_pct,rec.dominant_side,rec.strength_profile,
        rec.form_score,rec.deload_warnings,rec.rom_violations,rec.spotter_activations,
        rec.peak_force_n,rec.estimated_calories,rec.heaviest_lift_kg,rec.eccentric_load,
        rec.echo_level,rec.warmup_reps,rec.working_reps,COALESCE(rec.updated_at,NOW())
      ) ON CONFLICT ON CONSTRAINT workout_sessions_pkey DO UPDATE SET
        name=EXCLUDED.name,started_at=EXCLUDED.started_at,duration_seconds=EXCLUDED.duration_seconds,
        total_volume=EXCLUDED.total_volume,set_count=EXCLUDED.set_count,
        exercise_count=EXCLUDED.exercise_count,pr_count=EXCLUDED.pr_count,
        routine_name=EXCLUDED.routine_name,workout_mode=EXCLUDED.workout_mode,
        routine_session_id=EXCLUDED.routine_session_id,notes=EXCLUDED.notes,
        avg_velocity_mps=EXCLUDED.avg_velocity_mps,avg_asymmetry_pct=EXCLUDED.avg_asymmetry_pct,
        velocity_loss_pct=EXCLUDED.velocity_loss_pct,dominant_side=EXCLUDED.dominant_side,
        strength_profile=EXCLUDED.strength_profile,form_score=EXCLUDED.form_score,
        deload_warnings=EXCLUDED.deload_warnings,rom_violations=EXCLUDED.rom_violations,
        spotter_activations=EXCLUDED.spotter_activations,peak_force_n=EXCLUDED.peak_force_n,
        estimated_calories=EXCLUDED.estimated_calories,heaviest_lift_kg=EXCLUDED.heaviest_lift_kg,
        eccentric_load=EXCLUDED.eccentric_load,echo_level=EXCLUDED.echo_level,
        warmup_reps=EXCLUDED.warmup_reps,working_reps=EXCLUDED.working_reps,
        updated_at=EXCLUDED.updated_at;
      IF FOUND THEN
        v_accepted_ids := array_append(v_accepted_ids, rec.id);
        v_results := v_results || jsonb_build_array(jsonb_build_object(
          'id', rec.id, 'accepted', TRUE, 'server_updated_at', COALESCE(rec.updated_at,NOW())
        ));
      ELSE
        v_results := v_results || jsonb_build_array(jsonb_build_object(
          'id', rec.id, 'accepted', FALSE, 'server_updated_at', NULL
        ));
      END IF;
    END LOOP;
  END IF;

  SELECT COALESCE(jsonb_agg(elem), '[]'::JSONB) INTO v_exercises
  FROM jsonb_array_elements(COALESCE(p_exercises,'[]'::JSONB)) elem
  WHERE (elem->>'session_id')::UUID = ANY(v_accepted_ids)
    AND (elem->>'id')::UUID = ANY(COALESCE(p_component_ids, '{}'::UUID[]))
    AND NOT EXISTS (
      SELECT 1 FROM public.workout_deletion_tombstones t
      WHERE t.user_id = p_user_id
        AND t.portal_session_id = (elem->>'session_id')::UUID
        AND (
          t.scope = 'WORKOUT' OR
          (t.scope = 'COMPONENT' AND t.component_session_id = (elem->>'id')::UUID)
        )
    );
  SELECT COALESCE(array_agg((elem->>'id')::UUID), '{}'::UUID[]) INTO v_exercise_ids
  FROM jsonb_array_elements(v_exercises) elem;
  SELECT COALESCE(jsonb_agg(elem), '[]'::JSONB) INTO v_sets
  FROM jsonb_array_elements(COALESCE(p_sets,'[]'::JSONB)) elem
  WHERE (elem->>'exercise_id')::UUID = ANY(v_exercise_ids);
  SELECT COALESCE(array_agg((elem->>'id')::UUID), '{}'::UUID[]) INTO v_set_ids
  FROM jsonb_array_elements(v_sets) elem;
  SELECT COALESCE(jsonb_agg(elem), '[]'::JSONB) INTO v_rep_summaries
  FROM jsonb_array_elements(COALESCE(p_rep_summaries,'[]'::JSONB)) elem
  WHERE (elem->>'set_id')::UUID = ANY(v_set_ids);
  SELECT COALESCE(jsonb_agg(elem), '[]'::JSONB) INTO v_rep_telemetry
  FROM jsonb_array_elements(COALESCE(p_rep_telemetry,'[]'::JSONB)) elem
  WHERE (elem->>'set_id')::UUID = ANY(v_set_ids);

  PERFORM public.replace_session_components(
    p_user_id,
    v_exercise_ids,
    v_exercises,v_sets,v_rep_summaries,v_rep_telemetry
  );

  FOR result_json IN SELECT value FROM jsonb_array_elements(v_results) LOOP
    id := result_json->>'id';
    accepted := (result_json->>'accepted')::BOOLEAN;
    server_updated_at := NULLIF(result_json->>'server_updated_at','')::TIMESTAMPTZ;
    RETURN NEXT;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_training_cycles_lww(
  p_user_id UUID,
  p_rows JSONB
)
RETURNS TABLE(id TEXT, accepted BOOLEAN, server_updated_at TIMESTAMPTZ)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  rec JSONB;
  v_id UUID;
  v_updated_at TIMESTAMPTZ;
  v_existing_at TIMESTAMPTZ;
  v_tombstone_at TIMESTAMPTZ;
BEGIN
  IF jsonb_typeof(COALESCE(p_rows, '[]'::JSONB)) <> 'array' THEN
    RAISE EXCEPTION 'invalid_cycle_deletions' USING ERRCODE = '22023';
  END IF;
  FOR rec IN SELECT value FROM jsonb_array_elements(COALESCE(p_rows, '[]'::JSONB)) LOOP
    v_id := (rec->>'id')::UUID;
    v_updated_at := (rec->>'updatedAt')::TIMESTAMPTZ;
    IF v_updated_at IS NULL THEN
      RAISE EXCEPTION 'cycle_deletion_timestamp_required' USING ERRCODE = '22023';
    END IF;
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('training-cycle:' || v_id::TEXT, 0)
    );

    SELECT c.updated_at INTO v_existing_at
    FROM public.training_cycles c
    WHERE c.id = v_id AND c.user_id = p_user_id
    FOR UPDATE;
    IF NOT FOUND AND EXISTS (
      SELECT 1 FROM public.training_cycles c WHERE c.id = v_id AND c.user_id <> p_user_id
    ) THEN
      RAISE EXCEPTION 'cycle_account_mismatch' USING ERRCODE = 'P0001';
    END IF;
    SELECT t.deleted_at INTO v_tombstone_at
    FROM public.training_cycle_deletion_tombstones t
    WHERE t.user_id = p_user_id AND t.cycle_id = v_id
    FOR UPDATE;

    IF (v_existing_at IS NOT NULL AND v_existing_at > v_updated_at)
       OR (v_tombstone_at IS NOT NULL AND v_tombstone_at > v_updated_at) THEN
      id := v_id::TEXT;
      accepted := FALSE;
      server_updated_at := GREATEST(v_existing_at, v_tombstone_at);
      RETURN NEXT;
      CONTINUE;
    END IF;

    INSERT INTO public.training_cycle_deletion_tombstones(user_id, cycle_id, deleted_at)
    VALUES (p_user_id, v_id, v_updated_at)
    ON CONFLICT (user_id, cycle_id) DO UPDATE
      SET deleted_at = EXCLUDED.deleted_at
      WHERE public.training_cycle_deletion_tombstones.deleted_at <= EXCLUDED.deleted_at;
    DELETE FROM public.training_cycles c WHERE c.user_id = p_user_id AND c.id = v_id;
    id := v_id::TEXT;
    accepted := TRUE;
    server_updated_at := v_updated_at;
    RETURN NEXT;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_training_cycle_lww(
  p_cycle_id UUID,
  p_updated_at TIMESTAMPTZ
)
RETURNS TABLE(id TEXT, accepted BOOLEAN, server_updated_at TIMESTAMPTZ)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id UUID := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'authentication_required' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT d.id, d.accepted, d.server_updated_at
  FROM public.delete_training_cycles_lww(
    v_user_id,
    jsonb_build_array(jsonb_build_object('id', p_cycle_id, 'updatedAt', p_updated_at))
  ) d;
END;
$$;

-- Portal edits participate in the same timestamp register as mobile edits.
CREATE OR REPLACE FUNCTION public.update_cycle_with_days(
  p_cycle_id UUID,
  p_name TEXT,
  p_description TEXT,
  p_duration_weeks INT,
  p_workout_days INT,
  p_rest_days INT,
  p_started_at TIMESTAMPTZ,
  p_progression_settings JSONB,
  p_deload_settings JSONB,
  p_days JSONB
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_updated UUID;
  v_merged_days JSONB := '[]'::JSONB;
  v_day JSONB;
  v_existing_echo TEXT;
  v_existing_eccentric INT;
  v_existing_day BOOLEAN;
BEGIN
  IF p_days IS NULL OR jsonb_typeof(p_days) <> 'array' THEN
    RAISE EXCEPTION 'invalid_days_payload: expected a JSON array' USING ERRCODE = 'P0001';
  END IF;
  UPDATE public.training_cycles
     SET name = p_name,
         description = p_description,
         duration_weeks = p_duration_weeks,
         workout_days = p_workout_days,
         rest_days = p_rest_days,
         started_at = p_started_at,
         progression_settings = p_progression_settings,
         deload_settings = p_deload_settings,
         updated_at = NOW()
   WHERE id = p_cycle_id AND user_id = auth.uid()
  RETURNING id INTO v_updated;
  IF v_updated IS NULL THEN
    RAISE EXCEPTION 'cycle_not_found_or_forbidden' USING ERRCODE = 'P0001';
  END IF;
  FOR v_day IN SELECT value FROM jsonb_array_elements(p_days) LOOP
    SELECT d.echo_level, d.eccentric_load_percent
      INTO v_existing_echo, v_existing_eccentric
    FROM public.cycle_days d
    WHERE d.cycle_id = p_cycle_id
      AND d.day_number = (v_day->>'day_number')::INT;
    v_existing_day := FOUND;
    IF v_existing_day AND NOT COALESCE((v_day->>'echo_level_present')::BOOLEAN, FALSE) THEN
      v_day := jsonb_set(v_day, '{echo_level}', COALESCE(to_jsonb(v_existing_echo), 'null'::JSONB), TRUE);
    END IF;
    IF v_existing_day AND NOT COALESCE((v_day->>'eccentric_load_percent_present')::BOOLEAN, FALSE) THEN
      v_day := jsonb_set(v_day, '{eccentric_load_percent}', COALESCE(to_jsonb(v_existing_eccentric), 'null'::JSONB), TRUE);
    END IF;
    v_merged_days := v_merged_days || jsonb_build_array(
      v_day - 'echo_level_present' - 'eccentric_load_percent_present'
    );
  END LOOP;
  DELETE FROM public.cycle_days WHERE cycle_id = p_cycle_id;
  IF jsonb_array_length(p_days) > 0 THEN
    INSERT INTO public.cycle_days
    SELECT (
      jsonb_populate_record(
        NULL::public.cycle_days,
        elem || jsonb_build_object('id', gen_random_uuid(), 'cycle_id', p_cycle_id)
      )
    ).*
    FROM jsonb_array_elements(v_merged_days) AS elem;
  END IF;
  RETURN v_updated;
END;
$$;

-- Cycle LWW is always active. Missing timestamps can create a row, but cannot
-- overwrite an existing structure. Accepted is returned only when the parent
-- mutation committed; callers gate every child write/deletion on this result.
CREATE OR REPLACE FUNCTION public.upsert_training_cycle_lww(p_rows JSONB)
RETURNS TABLE(id TEXT, accepted BOOLEAN, server_updated_at TIMESTAMPTZ)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  rec_json JSONB;
  rec RECORD;
  existing_row public.training_cycles%ROWTYPE;
  v_exists BOOLEAN;
  v_timestamp TIMESTAMPTZ;
  v_tombstone_at TIMESTAMPTZ;
  v_progression_settings_present BOOLEAN;
  v_progress_state_present BOOLEAN;
BEGIN
  FOR rec_json IN SELECT value FROM jsonb_array_elements(COALESCE(p_rows, '[]'::JSONB)) LOOP
    SELECT * INTO rec FROM jsonb_populate_record(NULL::public.training_cycles, rec_json);
    -- progression_settings predates its presence bit. A legacy non-null JSON
    -- document remains an authoritative update; absent/null without the bit
    -- preserves the stored value, while presence=true permits an explicit clear.
    v_progression_settings_present :=
      COALESCE((rec_json->>'progression_settings_present')::BOOLEAN, FALSE)
      OR (
        rec_json ? 'progression_settings'
        AND rec_json->'progression_settings' IS DISTINCT FROM 'null'::JSONB
      );
    v_progress_state_present := COALESCE((rec_json->>'progress_state_present')::BOOLEAN, FALSE);
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('training-cycle:' || rec.id::TEXT, 0)
    );
    SELECT c.* INTO existing_row FROM public.training_cycles c WHERE c.id = rec.id;
    v_exists := FOUND;
    IF v_exists AND (existing_row.user_id <> rec.user_id OR existing_row.local_profile_id IS DISTINCT FROM rec.local_profile_id) THEN
      RAISE EXCEPTION 'cycle_owner_or_profile_mismatch' USING ERRCODE = 'P0001';
    END IF;
    IF v_exists AND (rec.updated_at IS NULL OR (existing_row.updated_at IS NOT NULL AND existing_row.updated_at > rec.updated_at)) THEN
      RETURN QUERY SELECT rec.id::TEXT, FALSE, existing_row.updated_at;
      CONTINUE;
    END IF;
    SELECT t.deleted_at INTO v_tombstone_at
    FROM public.training_cycle_deletion_tombstones t
    WHERE t.user_id = rec.user_id AND t.cycle_id = rec.id
    FOR UPDATE;
    IF FOUND AND (rec.updated_at IS NULL OR v_tombstone_at >= rec.updated_at) THEN
      RETURN QUERY SELECT rec.id::TEXT, FALSE, v_tombstone_at;
      CONTINUE;
    END IF;
    v_timestamp := COALESCE(rec.updated_at, NOW());
    INSERT INTO public.training_cycles AS c(
      id,user_id,local_profile_id,name,description,duration_weeks,workout_days,rest_days,current_week,status,started_at,last_used_at,progression_settings,deload_settings,template_id,progress_state,updated_at
    ) VALUES (
      rec.id,rec.user_id,rec.local_profile_id,rec.name,rec.description,COALESCE(rec.duration_weeks,4),COALESCE(rec.workout_days,0),COALESCE(rec.rest_days,0),COALESCE(rec.current_week,1),COALESCE(rec.status,'draft'),rec.started_at,rec.last_used_at,rec.progression_settings,rec.deload_settings,rec.template_id,rec.progress_state,v_timestamp
    ) ON CONFLICT ON CONSTRAINT training_cycles_pkey DO UPDATE SET
      name=EXCLUDED.name,description=EXCLUDED.description,duration_weeks=EXCLUDED.duration_weeks,workout_days=EXCLUDED.workout_days,rest_days=EXCLUDED.rest_days,current_week=EXCLUDED.current_week,status=EXCLUDED.status,started_at=EXCLUDED.started_at,last_used_at=EXCLUDED.last_used_at,progression_settings=CASE WHEN v_progression_settings_present THEN EXCLUDED.progression_settings ELSE c.progression_settings END,deload_settings=EXCLUDED.deload_settings,template_id=COALESCE(EXCLUDED.template_id,c.template_id),progress_state=CASE WHEN v_progress_state_present THEN EXCLUDED.progress_state ELSE c.progress_state END,updated_at=EXCLUDED.updated_at;
    DELETE FROM public.training_cycle_deletion_tombstones t
      WHERE t.user_id = rec.user_id AND t.cycle_id = rec.id AND t.deleted_at < v_timestamp;
    RETURN QUERY SELECT rec.id::TEXT, TRUE, v_timestamp;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.upsert_training_cycles_with_days_lww(
  p_user_id UUID,
  p_rows JSONB,
  p_days JSONB
)
RETURNS TABLE(id TEXT, accepted BOOLEAN, server_updated_at TIMESTAMPTZ)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  result_rec RECORD;
  result_json JSONB;
  v_results JSONB := '[]'::JSONB;
  v_accepted_ids UUID[] := '{}'::UUID[];
  v_merged_days JSONB := '[]'::JSONB;
  v_day JSONB;
  v_existing_echo TEXT;
  v_existing_eccentric INT;
  v_existing_day BOOLEAN;
BEGIN
  IF EXISTS (
    SELECT 1 FROM jsonb_populate_recordset(NULL::public.training_cycles, p_rows) r
    WHERE r.user_id <> p_user_id
  ) THEN
    RAISE EXCEPTION 'cycle_account_mismatch' USING ERRCODE = 'P0001';
  END IF;

  FOR result_rec IN SELECT * FROM public.upsert_training_cycle_lww(p_rows) LOOP
    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'id', result_rec.id,
      'accepted', result_rec.accepted,
      'server_updated_at', result_rec.server_updated_at
    ));
    IF result_rec.accepted THEN
      v_accepted_ids := array_append(v_accepted_ids, result_rec.id::UUID);
    END IF;
  END LOOP;

  -- Merge the two additive modifiers before replacing accepted children.
  -- Legacy payloads omit presence flags and therefore preserve stored values;
  -- an authoritative `present=true` with an omitted/null value clears it.
  FOR v_day IN SELECT value FROM jsonb_array_elements(COALESCE(p_days,'[]'::JSONB)) LOOP
    SELECT d.echo_level, d.eccentric_load_percent
      INTO v_existing_echo, v_existing_eccentric
    FROM public.cycle_days d
    WHERE d.cycle_id = (v_day->>'cycle_id')::UUID
      AND d.day_number = (v_day->>'day_number')::INT;
    v_existing_day := FOUND;
    IF v_existing_day AND NOT COALESCE((v_day->>'echo_level_present')::BOOLEAN, FALSE) THEN
      v_day := jsonb_set(v_day, '{echo_level}', COALESCE(to_jsonb(v_existing_echo), 'null'::JSONB), TRUE);
    END IF;
    IF v_existing_day AND NOT COALESCE((v_day->>'eccentric_load_percent_present')::BOOLEAN, FALSE) THEN
      v_day := jsonb_set(v_day, '{eccentric_load_percent}', COALESCE(to_jsonb(v_existing_eccentric), 'null'::JSONB), TRUE);
    END IF;
    v_merged_days := v_merged_days || jsonb_build_array(
      v_day - 'echo_level_present' - 'eccentric_load_percent_present'
    );
  END LOOP;

  DELETE FROM public.cycle_days d WHERE d.cycle_id = ANY(v_accepted_ids);
  INSERT INTO public.cycle_days(
    id,cycle_id,day_number,day_type,routine_id,weight_adjustment,
    rep_modifier,rest_override,rest_type,notes,echo_level,eccentric_load_percent
  )
  SELECT gen_random_uuid(), d.cycle_id, d.day_number, COALESCE(d.day_type,'workout'),
    d.routine_id, COALESCE(d.weight_adjustment,0), COALESCE(d.rep_modifier,0),
    d.rest_override,d.rest_type,d.notes,d.echo_level,d.eccentric_load_percent
  FROM jsonb_to_recordset(v_merged_days) AS d(
    cycle_id UUID, day_number INT, day_type TEXT, routine_id UUID,
    weight_adjustment NUMERIC, rep_modifier INT, rest_override INT,
    rest_type TEXT, notes TEXT, echo_level TEXT, eccentric_load_percent INT
  )
  WHERE d.cycle_id = ANY(v_accepted_ids);

  FOR result_json IN SELECT value FROM jsonb_array_elements(v_results) LOOP
    id := result_json->>'id';
    accepted := (result_json->>'accepted')::BOOLEAN;
    server_updated_at := NULLIF(result_json->>'server_updated_at','')::TIMESTAMPTZ;
    RETURN NEXT;
  END LOOP;
END;
$$;

REVOKE ALL ON TABLE public.workout_deletion_tombstones FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.training_cycle_deletion_tombstones, public.profile_ownership_claims FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.profile_ownership_transfers FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.profile_ownership_events FROM PUBLIC, anon;
GRANT SELECT ON public.workout_deletion_tombstones, public.profile_ownership_events TO authenticated;
GRANT SELECT ON public.workout_deletion_tombstones, public.profile_ownership_transfers, public.profile_ownership_events TO service_role;
GRANT SELECT ON public.training_cycle_deletion_tombstones, public.profile_ownership_claims TO service_role;

REVOKE ALL ON FUNCTION public.get_blocked_workout_session_ids(UUID, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_blocked_workout_component_ids(UUID, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.transfer_profile_ownership(UUID, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.verify_profile_recovery_source(TEXT, UUID[], UUID[], UUID[], UUID[], UUID[], UUID[], UUID[], UUID[]) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.apply_workout_deletions(UUID, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.replace_session_components(UUID, UUID[], JSONB, JSONB, JSONB, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.upsert_workout_sessions_with_components(UUID, BOOLEAN, JSONB, UUID[], JSONB, JSONB, JSONB, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.delete_training_cycles_lww(UUID, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.upsert_training_cycles_with_days_lww(UUID, JSONB, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_blocked_workout_session_ids(UUID, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_blocked_workout_component_ids(UUID, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.transfer_profile_ownership(UUID, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.verify_profile_recovery_source(TEXT, UUID[], UUID[], UUID[], UUID[], UUID[], UUID[], UUID[], UUID[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.apply_workout_deletions(UUID, TEXT, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.replace_session_components(UUID, UUID[], JSONB, JSONB, JSONB, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.upsert_workout_sessions_with_components(UUID, BOOLEAN, JSONB, UUID[], JSONB, JSONB, JSONB, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.delete_training_cycles_lww(UUID, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.upsert_training_cycles_with_days_lww(UUID, JSONB, JSONB) TO service_role;
REVOKE ALL ON FUNCTION public.delete_workout_with_tombstone(UUID, UUID, UUID, TEXT, TEXT, TIMESTAMPTZ) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.delete_training_cycle_lww(UUID, TIMESTAMPTZ) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_workout_with_tombstone(UUID, UUID, UUID, TEXT, TEXT, TIMESTAMPTZ) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_training_cycle_lww(UUID, TIMESTAMPTZ) TO authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_training_cycle_lww(JSONB) TO service_role;
