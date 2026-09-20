\set ON_ERROR_STOP on

BEGIN;

INSERT INTO auth.users(id) VALUES
  ('00000000-0000-4000-8000-000000000001'),
  ('00000000-0000-4000-8000-000000000099');
INSERT INTO public.local_profiles(user_id,id,name,color_index) VALUES
  ('00000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000001','Source',1),
  ('00000000-0000-4000-8000-000000000001','default','Default',7),
  ('00000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000001','Final',8),
  ('00000000-0000-4000-8000-000000000099','default','Other',0);

INSERT INTO public.workout_sessions(id,user_id,local_profile_id,name,routine_session_id,updated_at) VALUES
  ('10000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000001','A','10000000-0000-4000-8000-000000000010','2026-09-20T10:00:00Z'),
  ('10000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000001','B','10000000-0000-4000-8000-000000000010','2026-09-20T10:00:00Z'),
  ('10000000-0000-4000-8000-000000000099','00000000-0000-4000-8000-000000000099','default','Other account',NULL,'2026-09-20T10:00:00Z');
INSERT INTO public.exercise_progress(user_id,local_profile_id,session_id,exercise_id,exercise_name) VALUES
  ('00000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','bench','Bench');
INSERT INTO public.routines(id,user_id,local_profile_id,name) VALUES
  ('20000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000001','Routine');
INSERT INTO public.training_cycles(id,user_id,local_profile_id,name,updated_at) VALUES
  ('30000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000001','Cycle','2026-09-20T10:00:00Z');
INSERT INTO public.personal_records(id,user_id,local_profile_id) VALUES
  ('40000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000001');

-- Ownerless recovery proof accepts a mixed remote/local group only when every
-- required cloud-origin proof exists for this authenticated account/source.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',TRUE);
DO $$
DECLARE v_result RECORD;
BEGIN
  SELECT * INTO v_result FROM public.verify_profile_recovery_source(
    'a0000000-0000-4000-8000-000000000001',
    ARRAY['10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000004']::UUID[],
    '{}'::UUID[],'{}'::UUID[],'{}'::UUID[],
    ARRAY['10000000-0000-4000-8000-000000000001']::UUID[],
    '{}'::UUID[],'{}'::UUID[],'{}'::UUID[]
  );
  IF NOT v_result.verified
     OR v_result.authenticated_owner_user_id <> '00000000-0000-4000-8000-000000000001'::UUID
     OR v_result.verified_proof_count <> 1 THEN
    RAISE EXCEPTION 'mixed local and remote recovery proof rejected';
  END IF;

  SELECT * INTO v_result FROM public.verify_profile_recovery_source(
    'a0000000-0000-4000-8000-000000000001',
    ARRAY['10000000-0000-4000-8000-000000000004']::UUID[],
    '{}'::UUID[],'{}'::UUID[],'{}'::UUID[],
    ARRAY['10000000-0000-4000-8000-000000000004']::UUID[],
    '{}'::UUID[],'{}'::UUID[],'{}'::UUID[]
  );
  IF v_result.verified OR v_result.authenticated_owner_user_id IS NOT NULL THEN
    RAISE EXCEPTION 'missing cloud-origin proof accepted';
  END IF;

  SELECT * INTO v_result FROM public.verify_profile_recovery_source(
    'default',
    ARRAY['10000000-0000-4000-8000-000000000099']::UUID[],
    '{}'::UUID[],'{}'::UUID[],'{}'::UUID[],
    ARRAY['10000000-0000-4000-8000-000000000099']::UUID[],
    '{}'::UUID[],'{}'::UUID[],'{}'::UUID[]
  );
  IF v_result.verified THEN RAISE EXCEPTION 'wrong-account recovery proof accepted'; END IF;

  SELECT * INTO v_result FROM public.verify_profile_recovery_source(
    'default',
    ARRAY['10000000-0000-4000-8000-000000000001']::UUID[],
    '{}'::UUID[],'{}'::UUID[],'{}'::UUID[],
    ARRAY['10000000-0000-4000-8000-000000000001']::UUID[],
    '{}'::UUID[],'{}'::UUID[],'{}'::UUID[]
  );
  IF v_result.verified THEN RAISE EXCEPTION 'wrong-source recovery proof accepted'; END IF;
END $$;
RESET ROLE;

DO $$
DECLARE v_ack UUID;
BEGIN
  SELECT mutation_id INTO v_ack FROM public.transfer_profile_ownership(
    '00000000-0000-4000-8000-000000000001',
    '[{"mutationId":"50000000-0000-4000-8000-000000000001","sourceProfileId":"a0000000-0000-4000-8000-000000000001","targetProfileId":"default","workoutSessionIds":["10000000-0000-4000-8000-000000000001"],"routineIds":["20000000-0000-4000-8000-000000000001"],"cycleIds":["30000000-0000-4000-8000-000000000001"],"personalRecordIds":["40000000-0000-4000-8000-000000000001"]}]'::JSONB
  );
  IF v_ack <> '50000000-0000-4000-8000-000000000001' THEN RAISE EXCEPTION 'transfer ack mismatch'; END IF;
  IF (SELECT local_profile_id FROM public.workout_sessions WHERE id='10000000-0000-4000-8000-000000000001') <> 'default' THEN RAISE EXCEPTION 'session not transferred'; END IF;
  IF (SELECT local_profile_id FROM public.exercise_progress WHERE session_id='10000000-0000-4000-8000-000000000001') <> 'default' THEN RAISE EXCEPTION 'derived progress not transferred'; END IF;
  IF (SELECT local_profile_id FROM public.workout_sessions WHERE id='10000000-0000-4000-8000-000000000002') <> 'a0000000-0000-4000-8000-000000000001' THEN RAISE EXCEPTION 'unlisted sibling transferred'; END IF;
  IF (SELECT target_profile_name FROM public.profile_ownership_events WHERE mutation_id=v_ack) <> 'Default' THEN RAISE EXCEPTION 'event metadata missing'; END IF;
END $$;

-- Exact replay is idempotent and does not duplicate the immutable event.
SELECT mutation_id FROM public.transfer_profile_ownership(
  '00000000-0000-4000-8000-000000000001',
  '[{"mutationId":"50000000-0000-4000-8000-000000000001","sourceProfileId":"a0000000-0000-4000-8000-000000000001","targetProfileId":"default","workoutSessionIds":["10000000-0000-4000-8000-000000000001"],"routineIds":["20000000-0000-4000-8000-000000000001"],"cycleIds":["30000000-0000-4000-8000-000000000001"],"personalRecordIds":["40000000-0000-4000-8000-000000000001"]}]'::JSONB
);
DO $$ BEGIN
  IF (SELECT count(*) FROM public.profile_ownership_events) <> 1 THEN RAISE EXCEPTION 'duplicate ownership event'; END IF;
END $$;

-- A lost-ack replay remains acknowledgeable after registration cleanup. The
-- immutable committed operation, rather than mutable registration state, wins.
DELETE FROM public.local_profiles
WHERE user_id='00000000-0000-4000-8000-000000000001' AND id='default';
SELECT mutation_id FROM public.transfer_profile_ownership(
  '00000000-0000-4000-8000-000000000001',
  '[{"mutationId":"50000000-0000-4000-8000-000000000001","sourceProfileId":"a0000000-0000-4000-8000-000000000001","targetProfileId":"default","workoutSessionIds":["10000000-0000-4000-8000-000000000001"],"routineIds":["20000000-0000-4000-8000-000000000001"],"cycleIds":["30000000-0000-4000-8000-000000000001"],"personalRecordIds":["40000000-0000-4000-8000-000000000001"]}]'::JSONB
);
DO $$ DECLARE v_rejected BOOLEAN := FALSE; BEGIN
  BEGIN
    PERFORM * FROM public.transfer_profile_ownership(
      '00000000-0000-4000-8000-000000000001',
      '[{"mutationId":"50000000-0000-4000-8000-000000000099","sourceProfileId":null,"targetProfileId":"default","workoutSessionIds":[],"routineIds":["20000000-0000-4000-8000-000000000099"],"cycleIds":[],"personalRecordIds":[]}]'::JSONB
    );
  EXCEPTION WHEN SQLSTATE 'P0001' THEN v_rejected := TRUE; END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'new ownership transfer accepted an unregistered target'; END IF;
END $$;
INSERT INTO public.local_profiles(user_id,id,name,color_index) VALUES
  ('00000000-0000-4000-8000-000000000001','default','Default',7);

SELECT mutation_id FROM public.transfer_profile_ownership(
  '00000000-0000-4000-8000-000000000001',
  '[{"mutationId":"50000000-0000-4000-8000-000000000004","sourceProfileId":null,"targetProfileId":"default","workoutSessionIds":[],"routineIds":["20000000-0000-4000-8000-000000000004"],"cycleIds":[],"personalRecordIds":[]}]'::JSONB
);
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',TRUE);
INSERT INTO public.routines(id,user_id,local_profile_id,name)
VALUES ('20000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000001','default','Role guarded');
RESET ROLE;

DO $$ DECLARE v_rejected BOOLEAN := FALSE; BEGIN
  BEGIN
    PERFORM * FROM public.transfer_profile_ownership(
      '00000000-0000-4000-8000-000000000001',
      '[{"mutationId":"50000000-0000-4000-8000-000000000001","sourceProfileId":"a0000000-0000-4000-8000-000000000001","targetProfileId":"default","workoutSessionIds":["10000000-0000-4000-8000-000000000002"],"routineIds":[],"cycleIds":[],"personalRecordIds":[]}]'::JSONB
    );
    RAISE EXCEPTION 'different-body ownership replay was accepted';
  EXCEPTION WHEN unique_violation THEN NULL; END;
END $$;

-- Stable local-only ids can be claimed before their first upload. The claim
-- binds later insertion to the target account/profile and does not require a
-- client-side guess about server presence.
SELECT mutation_id FROM public.transfer_profile_ownership(
  '00000000-0000-4000-8000-000000000001',
  '[{"mutationId":"50000000-0000-4000-8000-000000000002","sourceProfileId":null,"targetProfileId":"default","workoutSessionIds":["10000000-0000-4000-8000-000000000003"],"routineIds":[],"cycleIds":[],"personalRecordIds":[]}]'::JSONB
);
DO $$ DECLARE v_rejected BOOLEAN := FALSE; BEGIN
  BEGIN
    INSERT INTO public.workout_sessions(id,user_id,local_profile_id,name)
    VALUES ('10000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000001','Wrong target');
  EXCEPTION WHEN SQLSTATE 'P0001' THEN v_rejected := TRUE; END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'claimed insert used wrong profile'; END IF;
  INSERT INTO public.workout_sessions(id,user_id,local_profile_id,name)
  VALUES ('10000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000001','default','Claimed target');
END $$;

DO $$ DECLARE v_rejected BOOLEAN := FALSE; BEGIN
  BEGIN
    PERFORM * FROM public.transfer_profile_ownership(
      '00000000-0000-4000-8000-000000000001',
      '[{"mutationId":"50000000-0000-4000-8000-000000000003","sourceProfileId":null,"targetProfileId":"default","workoutSessionIds":["10000000-0000-4000-8000-000000000099"],"routineIds":[],"cycleIds":[],"personalRecordIds":[]}]'::JSONB
    );
  EXCEPTION WHEN SQLSTATE 'P0001' THEN v_rejected := TRUE; END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'cross-account entity transfer accepted'; END IF;
END $$;

DO $$ DECLARE v_rejected BOOLEAN := FALSE; BEGIN
  BEGIN
    UPDATE public.workout_sessions SET local_profile_id='default'
    WHERE id='10000000-0000-4000-8000-000000000002';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN v_rejected := TRUE; END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'ordinary ownership move was accepted'; END IF;
END $$;

-- Chained transfers in one RPC retain causal order even when mutation UUID
-- lexical order is the reverse of the source -> target sequence.
SELECT mutation_id FROM public.transfer_profile_ownership(
  '00000000-0000-4000-8000-000000000001',
  '[{"mutationId":"ffffffff-ffff-4fff-8fff-000000000011","sourceProfileId":"a0000000-0000-4000-8000-000000000001","targetProfileId":"default","workoutSessionIds":["10000000-0000-4000-8000-000000000002"],"routineIds":[],"cycleIds":[],"personalRecordIds":[]},{"mutationId":"00000000-0000-4000-8000-000000000013","sourceProfileId":"default","targetProfileId":"b0000000-0000-4000-8000-000000000001","workoutSessionIds":["10000000-0000-4000-8000-000000000002"],"routineIds":[],"cycleIds":[],"personalRecordIds":[]}]'::JSONB
);
DO $$
DECLARE
  v_first TIMESTAMPTZ;
  v_second TIMESTAMPTZ;
  v_order UUID[];
BEGIN
  SELECT transferred_at INTO v_first FROM public.profile_ownership_events
  WHERE mutation_id='ffffffff-ffff-4fff-8fff-000000000011';
  SELECT transferred_at INTO v_second FROM public.profile_ownership_events
  WHERE mutation_id='00000000-0000-4000-8000-000000000013';
  SELECT array_agg(mutation_id ORDER BY transferred_at, mutation_id) INTO v_order
  FROM public.profile_ownership_events
  WHERE mutation_id IN (
    'ffffffff-ffff-4fff-8fff-000000000011',
    '00000000-0000-4000-8000-000000000013'
  );
  IF v_second < v_first + INTERVAL '1 millisecond' THEN
    RAISE EXCEPTION 'chained ownership timestamps are not strictly monotonic';
  END IF;
  IF v_order <> ARRAY[
    'ffffffff-ffff-4fff-8fff-000000000011'::UUID,
    '00000000-0000-4000-8000-000000000013'::UUID
  ] THEN RAISE EXCEPTION 'ownership pull cursor order is not causal'; END IF;
  IF (SELECT local_profile_id FROM public.workout_sessions WHERE id='10000000-0000-4000-8000-000000000002')
     <> 'b0000000-0000-4000-8000-000000000001' THEN
    RAISE EXCEPTION 'chained ownership final target mismatch';
  END IF;
  IF (SELECT claimed_at FROM public.profile_ownership_claims
      WHERE entity_type='workout_session' AND entity_id='10000000-0000-4000-8000-000000000002')
     <> v_second THEN RAISE EXCEPTION 'claim timestamp diverged from causal event'; END IF;
END $$;

-- The mobile adapter groups local component sessions under one portal parent.
-- Stable local component ids are exercises.id; replacing one preserves an
-- omitted sibling under the same parent and recomputes the parent aggregate.
INSERT INTO public.exercises(id,session_id,user_id,name,exercise_id,muscle_group,order_index) VALUES
  ('60000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001','Old A','a','Chest',0),
  ('60000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001','Keep B','b','Back',1);
SELECT public.replace_session_components(
  '00000000-0000-4000-8000-000000000001',
  ARRAY['60000000-0000-4000-8000-000000000001']::UUID[],
  '[{"id":"60000000-0000-4000-8000-000000000001","session_id":"10000000-0000-4000-8000-000000000001","user_id":"00000000-0000-4000-8000-000000000001","name":"New A","exercise_id":"a","muscle_group":"Chest","order_index":0}]',
  '[{"id":"70000000-0000-4000-8000-000000000001","exercise_id":"60000000-0000-4000-8000-000000000001","user_id":"00000000-0000-4000-8000-000000000001","set_number":1,"actual_reps":5,"weight_kg":10,"is_pr":true}]',
  '[]','[]'
);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.exercises WHERE id='60000000-0000-4000-8000-000000000002') THEN RAISE EXCEPTION 'sibling child lost'; END IF;
  IF (SELECT total_volume FROM public.workout_sessions WHERE id='10000000-0000-4000-8000-000000000001') <> 50 THEN RAISE EXCEPTION 'aggregate not recomputed'; END IF;
END $$;

-- Two devices can each see two components and independently send COMPONENT
-- deletions. The second commit removes the last server-side child, so it also
-- creates an immutable derived WORKOUT tombstone and removes the empty parent.
INSERT INTO public.workout_sessions(id,user_id,local_profile_id,name,updated_at)
VALUES ('10000000-0000-4000-8000-000000000040','00000000-0000-4000-8000-000000000001','default','Concurrent component deletes','2026-09-20T10:00:00Z');
INSERT INTO public.exercises(id,session_id,user_id,name,exercise_id,muscle_group,order_index) VALUES
  ('60000000-0000-4000-8000-000000000041','10000000-0000-4000-8000-000000000040','00000000-0000-4000-8000-000000000001','Member A','a','Chest',0),
  ('60000000-0000-4000-8000-000000000042','10000000-0000-4000-8000-000000000040','00000000-0000-4000-8000-000000000001','Member B','b','Back',1);
DO $$
DECLARE
  v_ack UUID;
  v_tombstone_count INT;
BEGIN
  SELECT mutation_id INTO v_ack FROM public.apply_workout_deletions(
    '00000000-0000-4000-8000-000000000001','default',
    '[{"mutationId":"80000000-0000-4000-8000-000000000041","scope":"COMPONENT","portalSessionId":"10000000-0000-4000-8000-000000000040","componentSessionId":"60000000-0000-4000-8000-000000000041","deletedAt":"2026-09-20T12:00:00Z"}]'
  );
  IF v_ack <> '80000000-0000-4000-8000-000000000041'::UUID THEN
    RAISE EXCEPTION 'first component deletion ack mismatch';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.workout_sessions WHERE id='10000000-0000-4000-8000-000000000040')
     OR NOT EXISTS (SELECT 1 FROM public.exercises WHERE id='60000000-0000-4000-8000-000000000042') THEN
    RAISE EXCEPTION 'first component deletion removed parent or sibling';
  END IF;

  SELECT mutation_id INTO v_ack FROM public.apply_workout_deletions(
    '00000000-0000-4000-8000-000000000001','default',
    '[{"mutationId":"80000000-0000-4000-8000-000000000042","scope":"COMPONENT","portalSessionId":"10000000-0000-4000-8000-000000000040","componentSessionId":"60000000-0000-4000-8000-000000000042","deletedAt":"2026-09-20T12:00:01Z"}]'
  );
  IF v_ack <> '80000000-0000-4000-8000-000000000042'::UUID THEN
    RAISE EXCEPTION 'final component deletion ack mismatch';
  END IF;
  IF EXISTS (SELECT 1 FROM public.workout_sessions WHERE id='10000000-0000-4000-8000-000000000040') THEN
    RAISE EXCEPTION 'final component deletion left an empty parent';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.workout_deletion_tombstones
    WHERE mutation_id='80000000-0000-4000-8000-000000000042'
      AND scope='COMPONENT'
      AND component_session_id='60000000-0000-4000-8000-000000000042'
  ) THEN RAISE EXCEPTION 'original final component ledger body was changed'; END IF;
  IF (SELECT count(*) FROM public.workout_deletion_tombstones
      WHERE user_id='00000000-0000-4000-8000-000000000001'
        AND portal_session_id='10000000-0000-4000-8000-000000000040'
        AND scope='WORKOUT'
        AND component_session_id IS NULL
        AND profile_id='default'
        AND deleted_at='2026-09-20T12:00:01Z') <> 1 THEN
    RAISE EXCEPTION 'derived final-member workout tombstone missing or duplicated';
  END IF;
  SELECT count(*) INTO v_tombstone_count FROM public.workout_deletion_tombstones
  WHERE portal_session_id='10000000-0000-4000-8000-000000000040';

  SELECT mutation_id INTO v_ack FROM public.apply_workout_deletions(
    '00000000-0000-4000-8000-000000000001','default',
    '[{"mutationId":"80000000-0000-4000-8000-000000000042","scope":"COMPONENT","portalSessionId":"10000000-0000-4000-8000-000000000040","componentSessionId":"60000000-0000-4000-8000-000000000042","deletedAt":"2026-09-20T12:00:01Z"}]'
  );
  IF v_ack <> '80000000-0000-4000-8000-000000000042'::UUID THEN
    RAISE EXCEPTION 'final component replay ack mismatch';
  END IF;
  IF (SELECT count(*) FROM public.workout_deletion_tombstones
      WHERE portal_session_id='10000000-0000-4000-8000-000000000040') <> v_tombstone_count THEN
    RAISE EXCEPTION 'final component replay duplicated derived tombstone';
  END IF;
END $$;

INSERT INTO public.workout_sessions(id,user_id,local_profile_id,name)
VALUES ('10000000-0000-4000-8000-000000000040','00000000-0000-4000-8000-000000000001','default','Stale parent replay');
INSERT INTO public.exercises(id,session_id,user_id,name,exercise_id,muscle_group,order_index)
VALUES ('60000000-0000-4000-8000-000000000042','10000000-0000-4000-8000-000000000040','00000000-0000-4000-8000-000000000001','Stale child replay','b','Back',1);
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.workout_sessions WHERE id='10000000-0000-4000-8000-000000000040') THEN
    RAISE EXCEPTION 'derived workout tombstone allowed parent resurrection';
  END IF;
  IF EXISTS (SELECT 1 FROM public.exercises WHERE id='60000000-0000-4000-8000-000000000042') THEN
    RAISE EXCEPTION 'derived workout tombstone allowed child resurrection';
  END IF;
END $$;

-- Component tombstone deletes only exercise A, persists globally, and blocks
-- stale component replay while leaving its parent and sibling B intact.
SELECT mutation_id FROM public.apply_workout_deletions(
  '00000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000001',
  '[{"mutationId":"80000000-0000-4000-8000-000000000001","scope":"COMPONENT","portalSessionId":"10000000-0000-4000-8000-000000000001","componentSessionId":"60000000-0000-4000-8000-000000000001","deletedAt":"2026-09-20T12:00:00Z"}]'
);
INSERT INTO public.exercises(id,session_id,user_id,name,exercise_id,muscle_group,order_index)
VALUES ('60000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001','Replay','a','Chest',0);
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.exercises WHERE id='60000000-0000-4000-8000-000000000001') THEN RAISE EXCEPTION 'tombstoned component resurrected'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.workout_sessions WHERE id='10000000-0000-4000-8000-000000000001') THEN RAISE EXCEPTION 'component deletion removed parent'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.exercises WHERE id='60000000-0000-4000-8000-000000000002') THEN RAISE EXCEPTION 'component deletion removed sibling'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.get_blocked_workout_component_ids(
      '00000000-0000-4000-8000-000000000001',
      '[{"id":"60000000-0000-4000-8000-000000000001","portalSessionId":"10000000-0000-4000-8000-000000000001"}]'
    )
  ) THEN RAISE EXCEPTION 'blocked-component lookup missed tombstone'; END IF;
  IF (SELECT profile_id FROM public.workout_deletion_tombstones
      WHERE mutation_id='80000000-0000-4000-8000-000000000001')
     <> 'a0000000-0000-4000-8000-000000000001' THEN
    RAISE EXCEPTION 'original deletion route was rebound after ownership transfer';
  END IF;
END $$;
DELETE FROM public.local_profiles
WHERE user_id='00000000-0000-4000-8000-000000000001'
  AND id='a0000000-0000-4000-8000-000000000001';
SELECT mutation_id FROM public.apply_workout_deletions(
  '00000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000001',
  '[{"mutationId":"80000000-0000-4000-8000-000000000001","scope":"COMPONENT","portalSessionId":"10000000-0000-4000-8000-000000000001","componentSessionId":"60000000-0000-4000-8000-000000000001","deletedAt":"2026-09-20T12:00:00Z"}]'
);
-- The route is immutable metadata: a brand-new deletion remains valid after
-- its local profile registration was removed, including an absent target.
SELECT mutation_id FROM public.apply_workout_deletions(
  '00000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000001',
  '[{"mutationId":"80000000-0000-4000-8000-000000000099","scope":"WORKOUT","portalSessionId":"10000000-0000-4000-8000-000000000098","deletedAt":"2026-09-20T12:00:00Z"}]'
);
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.workout_deletion_tombstones
    WHERE mutation_id='80000000-0000-4000-8000-000000000099'
      AND profile_id='a0000000-0000-4000-8000-000000000001'
      AND portal_session_id='10000000-0000-4000-8000-000000000098'
  ) THEN RAISE EXCEPTION 'unregistered immutable route tombstone missing'; END IF;
END $$;

-- A locally-created workout can be deleted before its first parent upload.
-- The parent tombstone acknowledges and blocks a later stale in-flight insert.
SELECT mutation_id FROM public.apply_workout_deletions(
  '00000000-0000-4000-8000-000000000001','default',
  '[{"mutationId":"80000000-0000-4000-8000-000000000002","scope":"WORKOUT","portalSessionId":"10000000-0000-4000-8000-000000000020","deletedAt":"2026-09-20T12:00:00Z"}]'
);
INSERT INTO public.workout_sessions(id,user_id,local_profile_id,name)
VALUES ('10000000-0000-4000-8000-000000000020','00000000-0000-4000-8000-000000000001','default','Late upload');
DO $$ DECLARE v_rejected BOOLEAN := FALSE; BEGIN
  IF EXISTS (SELECT 1 FROM public.workout_sessions WHERE id='10000000-0000-4000-8000-000000000020') THEN
    RAISE EXCEPTION 'pre-upload workout tombstone did not block parent';
  END IF;
  BEGIN
    PERFORM * FROM public.apply_workout_deletions(
      '00000000-0000-4000-8000-000000000001','default',
      '[{"mutationId":"80000000-0000-4000-8000-000000000003","scope":"COMPONENT","portalSessionId":"10000000-0000-4000-8000-000000000099","componentSessionId":"60000000-0000-4000-8000-000000000002","deletedAt":"2026-09-20T12:00:00Z"}]'
    );
  EXCEPTION WHEN SQLSTATE 'P0001' THEN v_rejected := TRUE; END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'component deletion accepted wrong portal group'; END IF;
END $$;

-- Grouped uploads send the local session id separately from the portal parent.
-- Tombstone matching must use portalSessionId, not the local id.
SELECT mutation_id FROM public.apply_workout_deletions(
  '00000000-0000-4000-8000-000000000001','default',
  '[{"mutationId":"80000000-0000-4000-8000-000000000050","scope":"WORKOUT","portalSessionId":"10000000-0000-4000-8000-000000000050","deletedAt":"2026-01-01T00:00:00Z"}]'
);
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.get_blocked_workout_session_ids(
      '00000000-0000-4000-8000-000000000001',
      '[{"id":"10000000-0000-4000-8000-000000000051","portalSessionId":"10000000-0000-4000-8000-000000000050"}]'
    ) WHERE session_id='10000000-0000-4000-8000-000000000051'
  ) THEN RAISE EXCEPTION 'grouped portal tombstone missed local session id'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.get_blocked_workout_session_ids(
      '00000000-0000-4000-8000-000000000001',
      '[{"id":"10000000-0000-4000-8000-000000000051"}]'
    )
  ) THEN RAISE EXCEPTION 'id-only probe blocked an ungrouped local session'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.workout_deletion_tombstones
    WHERE mutation_id='80000000-0000-4000-8000-000000000050'
      AND deleted_at='2026-01-01T00:00:00Z'
      AND recorded_at > deleted_at
  ) THEN RAISE EXCEPTION 'tombstone recorded_at did not capture server commit time'; END IF;
END $$;

-- Parent acceptance and dependent replacement roll back as one unit.
DO $$ BEGIN
  BEGIN
    PERFORM * FROM public.upsert_workout_sessions_with_components(
      '00000000-0000-4000-8000-000000000001', TRUE,
      '[{"id":"10000000-0000-4000-8000-000000000030","user_id":"00000000-0000-4000-8000-000000000001","local_profile_id":"default","name":"Atomic","started_at":"2026-09-20T12:00:00Z","duration_seconds":0,"total_volume":0,"set_count":0,"exercise_count":0,"pr_count":0,"updated_at":"2026-09-20T12:00:00Z"}]',
      ARRAY['60000000-0000-4000-8000-000000000030']::UUID[],
      '[{"id":"60000000-0000-4000-8000-000000000030","session_id":"10000000-0000-4000-8000-000000000030","user_id":"00000000-0000-4000-8000-000000000001","name":"Atomic component","exercise_id":"a","muscle_group":"Chest","order_index":0}]',
      '[{"id":"70000000-0000-4000-8000-000000000030","exercise_id":"60000000-0000-4000-8000-000000000099","user_id":"00000000-0000-4000-8000-000000000001","set_number":1}]',
      '[]','[]'
    );
    RAISE EXCEPTION 'invalid child replacement accepted';
  EXCEPTION WHEN foreign_key_violation THEN NULL; END;
  IF EXISTS (SELECT 1 FROM public.workout_sessions WHERE id='10000000-0000-4000-8000-000000000030') THEN
    RAISE EXCEPTION 'parent survived failed atomic component replacement';
  END IF;
END $$;

-- Reusing the deletion mutation for a different target is rejected.
DO $$ BEGIN
  BEGIN
    PERFORM * FROM public.apply_workout_deletions(
      '00000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000001',
      '[{"mutationId":"80000000-0000-4000-8000-000000000001","scope":"COMPONENT","portalSessionId":"10000000-0000-4000-8000-000000000001","componentSessionId":"60000000-0000-4000-8000-000000000002","deletedAt":"2026-09-20T12:00:00Z"}]'
    );
    RAISE EXCEPTION 'different-body deletion replay was accepted';
  EXCEPTION WHEN unique_violation THEN NULL; END;
END $$;

-- Cycle timestamp LWW: missing clock creates, but cannot overwrite; older
-- clock rejects and a newer clock accepts.
DO $$
DECLARE accepted_values BOOLEAN[];
BEGIN
  SELECT array_agg(accepted) INTO accepted_values FROM public.upsert_training_cycle_lww(
    '[{"id":"90000000-0000-4000-8000-000000000001","user_id":"00000000-0000-4000-8000-000000000001","local_profile_id":"default","name":"Created"}]'
  );
  IF accepted_values <> ARRAY[TRUE] THEN RAISE EXCEPTION 'create-only cycle rejected'; END IF;
  SELECT array_agg(accepted) INTO accepted_values FROM public.upsert_training_cycle_lww(
    '[{"id":"90000000-0000-4000-8000-000000000001","user_id":"00000000-0000-4000-8000-000000000001","local_profile_id":"default","name":"Legacy overwrite"}]'
  );
  IF accepted_values <> ARRAY[FALSE] THEN RAISE EXCEPTION 'clockless overwrite accepted'; END IF;
  SELECT array_agg(accepted) INTO accepted_values FROM public.upsert_training_cycle_lww(
    '[{"id":"90000000-0000-4000-8000-000000000001","user_id":"00000000-0000-4000-8000-000000000001","local_profile_id":"default","name":"Newer","updated_at":"2099-01-01T00:00:00Z"}]'
  );
  IF accepted_values <> ARRAY[TRUE] THEN RAISE EXCEPTION 'newer cycle rejected'; END IF;
  SELECT array_agg(accepted) INTO accepted_values FROM public.upsert_training_cycle_lww(
    '[{"id":"90000000-0000-4000-8000-000000000001","user_id":"00000000-0000-4000-8000-000000000001","local_profile_id":"default","name":"Older","updated_at":"2020-01-01T00:00:00Z"}]'
  );
  IF accepted_values <> ARRAY[FALSE] THEN RAISE EXCEPTION 'older cycle accepted'; END IF;
END $$;

-- Cycle deletion is the same timestamp LWW register as active edits. A newer
-- deletion blocks stale resurrection; a strictly newer active edit may win.
DO $$
DECLARE accepted_values BOOLEAN[];
BEGIN
  SELECT array_agg(accepted) INTO accepted_values FROM public.delete_training_cycles_lww(
    '00000000-0000-4000-8000-000000000001',
    '[{"id":"90000000-0000-4000-8000-000000000001","updatedAt":"2099-01-02T00:00:00Z"}]'
  );
  IF accepted_values <> ARRAY[TRUE] THEN RAISE EXCEPTION 'newer cycle deletion rejected'; END IF;
  SELECT array_agg(accepted) INTO accepted_values FROM public.upsert_training_cycle_lww(
    '[{"id":"90000000-0000-4000-8000-000000000001","user_id":"00000000-0000-4000-8000-000000000001","local_profile_id":"default","name":"Stale resurrection","updated_at":"2099-01-01T12:00:00Z"}]'
  );
  IF accepted_values <> ARRAY[FALSE] THEN RAISE EXCEPTION 'stale cycle resurrected'; END IF;
  SELECT array_agg(accepted) INTO accepted_values FROM public.upsert_training_cycle_lww(
    '[{"id":"90000000-0000-4000-8000-000000000001","user_id":"00000000-0000-4000-8000-000000000001","local_profile_id":"default","name":"New active","updated_at":"2099-01-03T00:00:00Z"}]'
  );
  IF accepted_values <> ARRAY[TRUE] THEN RAISE EXCEPTION 'strictly newer active cycle rejected'; END IF;
  IF EXISTS (SELECT 1 FROM public.training_cycle_deletion_tombstones WHERE cycle_id='90000000-0000-4000-8000-000000000001') THEN
    RAISE EXCEPTION 'cycle tombstone not cleared by newer active edit';
  END IF;
END $$;

-- The parent clock and day replacement are one transaction. Once the newer
-- structure commits, an older request is rejected before touching its days.
DO $$
DECLARE accepted_values BOOLEAN[];
BEGIN
  SELECT array_agg(accepted) INTO accepted_values FROM public.upsert_training_cycles_with_days_lww(
    '00000000-0000-4000-8000-000000000001',
    '[{"id":"90000000-0000-4000-8000-000000000001","user_id":"00000000-0000-4000-8000-000000000001","local_profile_id":"default","name":"Newest structure","progression_settings_present":true,"progression_settings":{"type":"linear","amount":5},"progress_state_present":true,"progress_state":{"currentDayNumber":2,"lastCompletedDate":1789948800000,"cycleStartDate":1789862400000,"lastAdvancedAt":1789952400000,"completedDays":[1],"missedDays":[],"rotationCount":3},"updated_at":"2099-01-04T00:00:00Z"}]',
    '[{"cycle_id":"90000000-0000-4000-8000-000000000001","day_number":1,"day_type":"workout","notes":"new-day","echo_level_present":true,"echo_level":"HIGH","eccentric_load_percent_present":true,"eccentric_load_percent":125}]'
  );
  IF accepted_values <> ARRAY[TRUE] THEN RAISE EXCEPTION 'new cycle structure rejected'; END IF;
  SELECT array_agg(accepted) INTO accepted_values FROM public.upsert_training_cycles_with_days_lww(
    '00000000-0000-4000-8000-000000000001',
    '[{"id":"90000000-0000-4000-8000-000000000001","user_id":"00000000-0000-4000-8000-000000000001","local_profile_id":"default","name":"Stale structure","updated_at":"2099-01-03T12:00:00Z"}]',
    '[{"cycle_id":"90000000-0000-4000-8000-000000000001","day_number":1,"day_type":"workout","notes":"stale-day"}]'
  );
  IF accepted_values <> ARRAY[FALSE] THEN RAISE EXCEPTION 'stale cycle structure accepted'; END IF;
  IF (SELECT notes FROM public.cycle_days WHERE cycle_id='90000000-0000-4000-8000-000000000001' AND day_number=1) <> 'new-day' THEN
    RAISE EXCEPTION 'stale cycle days overwrote newer structure';
  END IF;

  -- progression_settings predates its presence bit. A legacy non-null value
  -- remains authoritative while the other newly-added dependent fields retain
  -- their presence-gated values.
  SELECT array_agg(accepted) INTO accepted_values FROM public.upsert_training_cycles_with_days_lww(
    '00000000-0000-4000-8000-000000000001',
    '[{"id":"90000000-0000-4000-8000-000000000001","user_id":"00000000-0000-4000-8000-000000000001","local_profile_id":"default","name":"Legacy non-null progression","progression_settings":{"type":"wave","amount":3},"updated_at":"2099-01-05T00:00:00Z"}]',
    '[{"cycle_id":"90000000-0000-4000-8000-000000000001","day_number":1,"day_type":"workout","notes":"legacy-day"}]'
  );
  IF accepted_values <> ARRAY[TRUE] THEN RAISE EXCEPTION 'legacy non-null progression update rejected'; END IF;
  IF (SELECT progression_settings->>'type' FROM public.training_cycles WHERE id='90000000-0000-4000-8000-000000000001') <> 'wave'
     OR (SELECT progress_state->>'currentDayNumber' FROM public.training_cycles WHERE id='90000000-0000-4000-8000-000000000001') <> '2'
     OR (SELECT echo_level FROM public.cycle_days WHERE cycle_id='90000000-0000-4000-8000-000000000001' AND day_number=1) <> 'HIGH'
     OR (SELECT eccentric_load_percent FROM public.cycle_days WHERE cycle_id='90000000-0000-4000-8000-000000000001' AND day_number=1) <> 125 THEN
    RAISE EXCEPTION 'legacy non-null progression compatibility failed';
  END IF;

  -- A legacy absent/null progression value is omission, not deletion.
  SELECT array_agg(accepted) INTO accepted_values FROM public.upsert_training_cycles_with_days_lww(
    '00000000-0000-4000-8000-000000000001',
    '[{"id":"90000000-0000-4000-8000-000000000001","user_id":"00000000-0000-4000-8000-000000000001","local_profile_id":"default","name":"Legacy missing progression","progression_settings":null,"updated_at":"2099-01-05T12:00:00Z"}]',
    '[{"cycle_id":"90000000-0000-4000-8000-000000000001","day_number":1,"day_type":"workout","notes":"legacy-missing-day"}]'
  );
  IF accepted_values <> ARRAY[TRUE] THEN RAISE EXCEPTION 'legacy missing progression update rejected'; END IF;
  IF (SELECT progression_settings->>'type' FROM public.training_cycles WHERE id='90000000-0000-4000-8000-000000000001') <> 'wave' THEN
    RAISE EXCEPTION 'legacy absent/null progression erased stored document';
  END IF;

  -- Presence=true with omitted values is the explicit clear representation
  -- used by Kotlin serialization with explicitNulls=false.
  SELECT array_agg(accepted) INTO accepted_values FROM public.upsert_training_cycles_with_days_lww(
    '00000000-0000-4000-8000-000000000001',
    '[{"id":"90000000-0000-4000-8000-000000000001","user_id":"00000000-0000-4000-8000-000000000001","local_profile_id":"default","name":"Cleared modifiers","progression_settings_present":true,"progress_state_present":true,"updated_at":"2099-01-06T00:00:00Z"}]',
    '[{"cycle_id":"90000000-0000-4000-8000-000000000001","day_number":1,"day_type":"workout","notes":"cleared-day","echo_level_present":true,"eccentric_load_percent_present":true}]'
  );
  IF accepted_values <> ARRAY[TRUE] THEN RAISE EXCEPTION 'explicit cycle clear rejected'; END IF;
  IF (SELECT progression_settings FROM public.training_cycles WHERE id='90000000-0000-4000-8000-000000000001') IS NOT NULL
     OR (SELECT progress_state FROM public.training_cycles WHERE id='90000000-0000-4000-8000-000000000001') IS NOT NULL
     OR (SELECT echo_level FROM public.cycle_days WHERE cycle_id='90000000-0000-4000-8000-000000000001' AND day_number=1) IS NOT NULL
     OR (SELECT eccentric_load_percent FROM public.cycle_days WHERE cycle_id='90000000-0000-4000-8000-000000000001' AND day_number=1) IS NOT NULL THEN
    RAISE EXCEPTION 'explicit cycle clear did not clear dependent state';
  END IF;
END $$;

SELECT 'sync reliability PostgreSQL contract passed' AS result;
ROLLBACK;
