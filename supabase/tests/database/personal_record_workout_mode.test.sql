BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;

SELECT plan(10);

INSERT INTO auth.users (id, email)
VALUES
  ('a0d01000-0000-4000-8000-000000000001', 'pr-mode@example.test'),
  ('a0d01000-0000-4000-8000-000000000002', 'pr-mode-other@example.test');

INSERT INTO public.personal_records
  (id, user_id, exercise_name, record_type, value, unit, achieved_at, source, workout_mode, deleted_at)
VALUES
  ('a0d01000-0000-4000-8000-000000000011', 'a0d01000-0000-4000-8000-000000000001',
   'Bench', 'MAX_WEIGHT', 100, 'kg', '2026-01-01T10:00:00Z', 'dedicated', 'ECHO', NULL),
  ('a0d01000-0000-4000-8000-000000000012', 'a0d01000-0000-4000-8000-000000000001',
   'Bench', 'MAX_WEIGHT', 80, 'kg', '2026-01-01T10:00:00Z', 'set_derived', NULL, NULL),
  ('a0d01000-0000-4000-8000-000000000013', 'a0d01000-0000-4000-8000-000000000001',
   'Bench', 'MAX_WEIGHT', 85, 'kg', '2026-01-01T10:00:00Z', 'set_derived', NULL, '2026-01-02'),
  ('a0d01000-0000-4000-8000-000000000014', 'a0d01000-0000-4000-8000-000000000002',
   'Bench', 'MAX_WEIGHT', 90, 'kg', '2026-01-01T10:00:00Z', 'set_derived', NULL, NULL);

-- PostgREST's merge-duplicates upsert takes this UPDATE path when the UUID
-- already exists. An omitted field arrives as NULL in the uniform batch.
SET LOCAL ROLE service_role;
INSERT INTO public.personal_records
  (id, user_id, exercise_name, record_type, value, unit, achieved_at, source, workout_mode)
VALUES
  ('a0d01000-0000-4000-8000-000000000011', 'a0d01000-0000-4000-8000-000000000001',
   'Bench', 'MAX_WEIGHT', 105, 'kg', '2026-01-01T10:00:00Z', 'dedicated', NULL)
ON CONFLICT (id) DO UPDATE SET
  value = EXCLUDED.value,
  workout_mode = EXCLUDED.workout_mode,
  source = EXCLUDED.source;

SELECT is(
  (SELECT workout_mode FROM public.personal_records WHERE id = 'a0d01000-0000-4000-8000-000000000011'),
  'ECHO',
  'a dedicated upsert with an unknown mode keeps the stored mode'
);
SELECT is(
  (SELECT value FROM public.personal_records WHERE id = 'a0d01000-0000-4000-8000-000000000011'),
  105::numeric,
  'a mode-less dedicated upsert still writes the measurements'
);

SELECT is(
  public.upsert_set_derived_personal_records(
    'a0d01000-0000-4000-8000-000000000001',
    '[
      {"exercise_name":"Bench","record_type":"MAX_WEIGHT","achieved_at":"2026-01-01T10:00:00Z",
       "workout_mode":"TUT","value":900,"fill_missing_workout_mode_only":true},
      {"exercise_name":"No existing row","record_type":"MAX_WEIGHT","achieved_at":"2026-01-01T10:00:00Z",
       "workout_mode":"TUT","value":900,"fill_missing_workout_mode_only":true}
    ]'::jsonb
  ),
  1,
  'a replay fills one live derived record and does not insert a missing record'
);
SELECT is(
  public.upsert_set_derived_personal_records(
    'a0d01000-0000-4000-8000-000000000001',
    '[{"exercise_name":"Bench","record_type":"MAX_WEIGHT","achieved_at":"2026-01-01T10:00:00Z",
       "workout_mode":"OLD_SCHOOL","value":900,"fill_missing_workout_mode_only":true}]'::jsonb
  ),
  0,
  'a subsequent replay cannot replace the known mode'
);

SELECT results_eq(
  $$SELECT workout_mode, value FROM public.personal_records WHERE id::text LIKE 'a0d01000-%' ORDER BY id$$,
  $$VALUES ('ECHO'::text, 105::numeric), ('TUT'::text, 80::numeric),
            (NULL::text, 85::numeric), (NULL::text, 90::numeric)$$,
  'only the live derived mode changes, with dedicated, deleted, and other-user records intact'
);
SELECT is(
  (SELECT count(*)::integer FROM public.personal_records
   WHERE user_id = 'a0d01000-0000-4000-8000-000000000001'),
  3,
  'the owning user keeps the same row count'
);

INSERT INTO public.local_profiles (user_id, id, name)
VALUES ('a0d01000-0000-4000-8000-000000000001', 'second', 'Second');

INSERT INTO public.personal_records
  (id, user_id, local_profile_id, exercise_name, record_type, value, unit, achieved_at, source, workout_mode, updated_at)
VALUES
  ('a0d01000-0000-4000-8000-000000000015', 'a0d01000-0000-4000-8000-000000000001',
   NULL, 'Pulldown', 'MAX_WEIGHT', 60, 'kg', '2026-01-01T10:00:00Z', 'set_derived', NULL, now()),
  ('a0d01000-0000-4000-8000-000000000016', 'a0d01000-0000-4000-8000-000000000001',
   'second', 'Pulldown', 'MAX_WEIGHT', 60, 'kg', '2026-01-01T10:00:00Z', 'set_derived', 'ECHO', now()),
  ('a0d01000-0000-4000-8000-000000000017', 'a0d01000-0000-4000-8000-000000000001',
   NULL, 'Cable row', 'MAX_WEIGHT', 60, 'kg', '2026-01-01T10:00:00Z', 'set_derived', 'ECHO', now() - interval '2 days'),
  ('a0d01000-0000-4000-8000-000000000018', 'a0d01000-0000-4000-8000-000000000001',
   NULL, 'Squat', 'MAX_WEIGHT', 60, 'kg', '2026-01-01T10:00:00Z', 'set_derived', 'ECHO', now());

UPDATE public.personal_records
SET workout_mode = 'ECHO'
WHERE id = 'a0d01000-0000-4000-8000-000000000014';

-- Keep the repair and the tombstone on the same timestamp to require an ID
-- tie-break on the continuation page.
UPDATE public.personal_records SET updated_at = now()
WHERE id = 'a0d01000-0000-4000-8000-000000000013';

SELECT results_eq(
  $$SELECT id FROM public.get_known_personal_record_changes(
    'a0d01000-0000-4000-8000-000000000001',
    ARRAY(SELECT id FROM public.personal_records WHERE id::text LIKE 'a0d01000-%'
          AND id <> 'a0d01000-0000-4000-8000-000000000018'),
    now() - interval '2 minutes', 'default', NULL, NULL, 1
  )$$,
  $$VALUES ('a0d01000-0000-4000-8000-000000000012'::uuid)$$,
  'the first page includes the known mode repair'
);
SELECT results_eq(
  $$SELECT id FROM public.get_known_personal_record_changes(
    'a0d01000-0000-4000-8000-000000000001',
    ARRAY(SELECT id FROM public.personal_records WHERE id::text LIKE 'a0d01000-%'
          AND id <> 'a0d01000-0000-4000-8000-000000000018'),
    now() - interval '2 minutes', 'default', now(), 'a0d01000-0000-4000-8000-000000000012', 76
  )$$,
  $$VALUES ('a0d01000-0000-4000-8000-000000000013'::uuid)$$,
  'the continuation includes the tombstone and excludes dedicated, unknown-mode, stale, other-profile, other-user, and unseen records'
);
SELECT results_eq(
  $$SELECT id FROM public.get_known_personal_record_changes(
    'a0d01000-0000-4000-8000-000000000001',
    ARRAY(SELECT id FROM public.personal_records WHERE id::text LIKE 'a0d01000-%'),
    now() - interval '2 minutes', 'second', NULL, NULL, 76
  )$$,
  $$VALUES ('a0d01000-0000-4000-8000-000000000016'::uuid)$$,
  'a named profile receives only its own known recent change'
);
SELECT results_eq(
  $$SELECT id FROM public.get_known_personal_record_changes(
    'a0d01000-0000-4000-8000-000000000001',
    ARRAY(SELECT id FROM public.personal_records WHERE id::text LIKE 'a0d01000-%'
          AND id <> 'a0d01000-0000-4000-8000-000000000018'),
    now() - interval '2 minutes', NULL, NULL, NULL, 76
  )$$,
  $$VALUES ('a0d01000-0000-4000-8000-000000000012'::uuid),
           ('a0d01000-0000-4000-8000-000000000013'::uuid),
           ('a0d01000-0000-4000-8000-000000000016'::uuid)$$,
  'an omitted profile retains owner-wide parity and cannot include another owner'
);

RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
