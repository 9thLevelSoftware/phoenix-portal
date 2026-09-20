-- Assertions for the drifted-with-data apply (03-drifted-rows.sql, then
-- 20260920007600). Each failure raises, so psql -v ON_ERROR_STOP=1 fails the
-- CI step. These are the halves of section 1 and section 2 that the catalog
-- cannot show and that the pgTAP suite -- which runs against an empty database
-- -- can never reach.
\set ON_ERROR_STOP on

DO $$
DECLARE
  v_checks int := 0;
  v_created timestamptz;
  v_updated timestamptz;
  v_text    text;
  v_type    text;
  v_count   int;
BEGIN
  -- 1. Nothing is left NULL: the SET NOT NULL could not have succeeded
  --    otherwise, but assert it explicitly so a future "optimisation" that
  --    drops the backfill and adds a DEFAULT instead is still caught here.
  SELECT count(*) INTO v_count FROM public.routines
   WHERE created_at IS NULL OR updated_at IS NULL;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'gating: % routines still have a NULL timestamp', v_count;
  END IF;
  v_checks := v_checks + 1;

  SELECT count(*) INTO v_count FROM public.training_cycles WHERE updated_at IS NULL;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'gating: % training_cycles still have a NULL updated_at', v_count;
  END IF;
  v_checks := v_checks + 1;

  -- 2. Row A: created_at takes the row's own updated_at, not now(), and
  --    updated_at does NOT move. The second half is the delta-pull cursor
  --    guarantee -- it fails if the routines_updated_at trigger is allowed to
  --    fire during the backfill.
  SELECT created_at, updated_at INTO v_created, v_updated
  FROM public.routines WHERE id = '9a170000-1111-4000-8000-00000000a171'::uuid;
  IF v_created IS DISTINCT FROM '2020-01-01 00:00:00+00'::timestamptz THEN
    RAISE EXCEPTION 'gating: routine A created_at is %, expected the row''s updated_at 2020-01-01', v_created;
  END IF;
  v_checks := v_checks + 1;
  IF v_updated IS DISTINCT FROM '2020-01-01 00:00:00+00'::timestamptz THEN
    RAISE EXCEPTION 'gating: routine A updated_at moved to % -- the backfill re-stamped the pull cursor', v_updated;
  END IF;
  v_checks := v_checks + 1;

  -- 3. Row B: nothing to copy from, so both become a server timestamp.
  SELECT created_at, updated_at INTO v_created, v_updated
  FROM public.routines WHERE id = '9a170000-1111-4000-8000-00000000a172'::uuid;
  IF v_created IS NULL OR v_updated IS NULL THEN
    RAISE EXCEPTION 'gating: routine B still has a NULL timestamp (created_at=%, updated_at=%)', v_created, v_updated;
  END IF;
  IF v_created IS DISTINCT FROM v_updated THEN
    RAISE EXCEPTION 'gating: routine B created_at % and updated_at % should both be the same backfill clock', v_created, v_updated;
  END IF;
  v_checks := v_checks + 1;

  -- 4. Row C was already complete and must be untouched.
  SELECT created_at, updated_at INTO v_created, v_updated
  FROM public.routines WHERE id = '9a170000-1111-4000-8000-00000000a173'::uuid;
  IF v_created IS DISTINCT FROM '2019-06-01 00:00:00+00'::timestamptz
     OR v_updated IS DISTINCT FROM '2019-06-02 00:00:00+00'::timestamptz THEN
    RAISE EXCEPTION 'gating: routine C was modified (created_at=%, updated_at=%)', v_created, v_updated;
  END IF;
  v_checks := v_checks + 1;

  -- 5. to_jsonb(text), not text::jsonb. Under ::jsonb the first row would be
  --    an array and the second row would have aborted the migration with 22P02.
  SELECT jsonb_typeof(per_set_echo_levels), per_set_echo_levels #>> '{}'
    INTO v_type, v_text
  FROM public.routine_exercises WHERE id = '9a170000-2222-4000-8000-00000000a171'::uuid;
  IF v_type IS DISTINCT FROM 'string' THEN
    RAISE EXCEPTION 'gating: the JSON-array string became jsonb %, expected a string scalar (to_jsonb, not ::jsonb)', v_type;
  END IF;
  v_checks := v_checks + 1;
  IF v_text IS DISTINCT FROM '["LEVEL_1","LEVEL_2"]' THEN
    RAISE EXCEPTION 'gating: the JSON-array string did not round-trip: %', v_text;
  END IF;
  v_checks := v_checks + 1;

  SELECT jsonb_typeof(per_set_echo_levels), per_set_echo_levels #>> '{}'
    INTO v_type, v_text
  FROM public.routine_exercises WHERE id = '9a170000-2222-4000-8000-00000000a172'::uuid;
  IF v_type IS DISTINCT FROM 'string' OR v_text IS DISTINCT FROM 'not json' THEN
    RAISE EXCEPTION 'gating: the non-JSON string became % / %', v_type, v_text;
  END IF;
  v_checks := v_checks + 1;

  SELECT count(*) INTO v_count FROM public.routine_exercises
   WHERE id = '9a170000-2222-4000-8000-00000000a173'::uuid
     AND per_set_echo_levels IS NULL;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'gating: the NULL per_set_echo_levels row did not stay NULL';
  END IF;
  v_checks := v_checks + 1;

  -- 6. The catalog converged as well: NOT NULL, defaults, jsonb type, and the
  --    four prod-only columns back with their reconstructed defaults.
  SELECT count(*) INTO v_count
  FROM pg_attribute a
  WHERE a.attrelid IN (to_regclass('public.routines'), to_regclass('public.training_cycles'))
    AND a.attname IN ('created_at', 'updated_at')
    AND a.attnum > 0 AND NOT a.attisdropped
    AND NOT a.attnotnull;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'gating: % routines/training_cycles timestamp columns are still nullable', v_count;
  END IF;
  v_checks := v_checks + 1;

  SELECT count(*) INTO v_count
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND (table_name, column_name) IN (
      ('profiles', 'digest_frequency'),
      ('profiles', 'digest_last_sent_at'),
      ('profiles', 'feature_flags'),
      ('user_goals', 'last_snapshot_at')
    );
  IF v_count <> 4 THEN
    RAISE EXCEPTION 'gating: % of 4 prod-only columns were re-added', v_count;
  END IF;
  v_checks := v_checks + 1;

  SELECT column_default INTO v_text FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'digest_frequency';
  IF v_text IS DISTINCT FROM '''weekly''::text' THEN
    RAISE EXCEPTION 'gating: profiles.digest_frequency default is %, expected ''weekly''::text', v_text;
  END IF;
  v_checks := v_checks + 1;

  SELECT data_type INTO v_text FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'routine_exercises' AND column_name = 'per_set_echo_levels';
  IF v_text IS DISTINCT FROM 'jsonb' THEN
    RAISE EXCEPTION 'gating: routine_exercises.per_set_echo_levels is %, expected jsonb', v_text;
  END IF;
  v_checks := v_checks + 1;

  -- 7. The re-added columns are not client-writable: section 6 replaced the
  --    table-wide grant with a column list, so a column added later stays out.
  IF has_column_privilege('authenticated', 'public.profiles', 'feature_flags', 'UPDATE') THEN
    RAISE EXCEPTION 'gating: authenticated can UPDATE profiles.feature_flags after it was re-added';
  END IF;
  v_checks := v_checks + 1;

  RAISE NOTICE 'gating: % assertions passed', v_checks;
END
$$;
