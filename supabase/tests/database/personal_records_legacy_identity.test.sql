-- F-062: identity for legacy personal_records rows (20260925100000).
--
-- Legacy rows (source IS NULL) are unique on derived identity PLUS content
-- (exercise_name, muscle_group, value, unit, previous_value, weight_kg, reps,
-- session_id), NULLs equal. The dedupe keeps the
-- newest row per group and tombstones the rest. Rows that differ in content
-- stay distinct (F335), and set_derived / dedicated rows are untouched.
--
-- The data section drops the index inside this transaction, rebuilds the
-- legacy duplicates the migration starts from, runs the migration's own dedupe
-- function, then re-creates the index from its catalog definition.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;

SELECT plan(19);

SELECT diag('database:pr-legacy-identity-catalog');

SELECT ok(
    EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname = 'public' AND indexname = 'uq_personal_records_legacy_identity'
    ),
    'the legacy identity index exists'
);
SELECT ok(
    (SELECT indisunique AND indnullsnotdistinct FROM pg_index
     WHERE indexrelid = 'public.uq_personal_records_legacy_identity'::regclass),
    'it is unique with NULLS NOT DISTINCT'
);
SELECT ok(
    pg_get_expr(
        (SELECT indpred FROM pg_index
         WHERE indexrelid = 'public.uq_personal_records_legacy_identity'::regclass),
        'public.personal_records'::regclass
    ) ~ 'source IS NULL',
    'it covers legacy (source IS NULL) rows only'
);
SELECT ok(
    NOT EXISTS (
        SELECT 1 FROM (VALUES ('anon'), ('authenticated'), ('service_role')) AS r(role_name)
        WHERE has_function_privilege(r.role_name, 'private.dedupe_legacy_personal_records()', 'EXECUTE')
    ),
    'the dedupe function is owner-only'
);

SELECT diag('database:pr-legacy-identity-dedupe');

CREATE TEMP TABLE legacy_index_def ON COMMIT DROP AS
SELECT indexdef FROM pg_indexes
WHERE schemaname = 'public' AND indexname = 'uq_personal_records_legacy_identity';
DROP INDEX public.uq_personal_records_legacy_identity;

INSERT INTO auth.users (id, email)
VALUES ('62626262-0000-4000-8000-000000000001'::uuid, 'f062-legacy@example.test')
ON CONFLICT (id) DO NOTHING;

-- Lowest id is also the newest row in each group, so the expected survivor is
-- the same whether or not a trigger restamps updated_at on insert.
INSERT INTO public.personal_records
    (id, user_id, exercise_name, muscle_group, record_type, value, unit,
     achieved_at, updated_at, weight_kg, reps, session_id, source, deleted_at)
VALUES
    -- A: one record re-inserted under a fresh id (the 361k-row incident)
    ('62626262-0000-4000-8000-0000000000a1'::uuid, '62626262-0000-4000-8000-000000000001'::uuid,
     'Bench', 'Chest', 'MAX_WEIGHT', 100, 'kg', '2026-01-01T10:00:00.123Z', '2026-01-03', 100, 5, NULL, NULL, NULL),
    ('62626262-0000-4000-8000-0000000000a2'::uuid, '62626262-0000-4000-8000-000000000001'::uuid,
     'Bench', 'Chest', 'MAX_WEIGHT', 100, 'kg', '2026-01-01T10:00:00.123Z', '2026-01-02', 100, 5, NULL, NULL, NULL),
    -- A3: same derived identity, different value: a distinct record (F335)
    ('62626262-0000-4000-8000-0000000000a3'::uuid, '62626262-0000-4000-8000-000000000001'::uuid,
     'Bench', 'Chest', 'MAX_WEIGHT', 105, 'kg', '2026-01-01T10:00:00.123Z', '2026-01-01', 105, 5, NULL, NULL, NULL),
    -- A4: A's content in another unit: a distinct row
    ('62626262-0000-4000-8000-0000000000a4'::uuid, '62626262-0000-4000-8000-000000000001'::uuid,
     'Bench', 'Chest', 'MAX_WEIGHT', 100, 'lb', '2026-01-01T10:00:00.123Z', '2026-01-01', 100, 5, NULL, NULL, NULL),
    -- B: duplicates whose weight, reps and session are NULL (NULLs equal)
    ('62626262-0000-4000-8000-0000000000b1'::uuid, '62626262-0000-4000-8000-000000000001'::uuid,
     'Plank', 'Core', 'MAX_VOLUME', 60, 's', '2026-02-01T00:00:00Z', '2026-02-02', NULL, NULL, NULL, NULL, NULL),
    ('62626262-0000-4000-8000-0000000000b2'::uuid, '62626262-0000-4000-8000-000000000001'::uuid,
     'Plank', 'Core', 'MAX_VOLUME', 60, 's', '2026-02-01T00:00:00Z', '2026-02-01', NULL, NULL, NULL, NULL, NULL),
    -- C: an already tombstoned copy of A is not live, so it is ignored
    ('62626262-0000-4000-8000-0000000000c1'::uuid, '62626262-0000-4000-8000-000000000001'::uuid,
     'Bench', 'Chest', 'MAX_WEIGHT', 100, 'kg', '2026-01-01T10:00:00.123Z', '2026-01-05', 100, 5, NULL, NULL, '2026-01-06'),
    -- D: a dedicated row with A's content is outside the legacy identity
    ('62626262-0000-4000-8000-0000000000d1'::uuid, '62626262-0000-4000-8000-000000000001'::uuid,
     'Bench', 'Chest', 'MAX_WEIGHT', 100, 'kg', '2026-01-01T10:00:00.123Z', '2026-01-01', 100, 5, NULL, 'dedicated', NULL);

-- A5: A's content with a different previous value: a distinct row
INSERT INTO public.personal_records
    (id, user_id, exercise_name, muscle_group, record_type, value, unit,
     achieved_at, updated_at, weight_kg, reps, previous_value)
VALUES
    ('62626262-0000-4000-8000-0000000000a5'::uuid, '62626262-0000-4000-8000-000000000001'::uuid,
     'Bench', 'Chest', 'MAX_WEIGHT', 100, 'kg', '2026-01-01T10:00:00.123Z', '2026-01-01', 100, 5, 95);

SELECT is(
    private.dedupe_legacy_personal_records(),
    2,
    'the dedupe tombstones one copy of A and one of B'
);
SELECT results_eq(
    $sql$
        SELECT id FROM public.personal_records
        WHERE user_id = '62626262-0000-4000-8000-000000000001'::uuid AND deleted_at IS NULL
        ORDER BY id
    $sql$,
    $values$ VALUES
        ('62626262-0000-4000-8000-0000000000a1'::uuid),
        ('62626262-0000-4000-8000-0000000000a3'::uuid),
        ('62626262-0000-4000-8000-0000000000a4'::uuid),
        ('62626262-0000-4000-8000-0000000000a5'::uuid),
        ('62626262-0000-4000-8000-0000000000b1'::uuid),
        ('62626262-0000-4000-8000-0000000000d1'::uuid)
    $values$,
    'survivors: the newest A, the distinct A3/A4/A5, one B, and the dedicated row'
);
SELECT is(
    (SELECT count(*)::int FROM public.personal_records
     WHERE id IN ('62626262-0000-4000-8000-0000000000a2'::uuid,
                  '62626262-0000-4000-8000-0000000000b2'::uuid)
       AND deleted_at IS NOT NULL),
    2,
    'the losers are tombstoned, not deleted, so devices converge via the tombstone pull'
);
SELECT is(
    private.dedupe_legacy_personal_records(),
    0,
    'a second run changes nothing'
);

SELECT diag('database:pr-legacy-identity-constraint');

DO $$ BEGIN EXECUTE (SELECT indexdef FROM legacy_index_def); END $$;

SELECT throws_ok(
    $sql$
        INSERT INTO public.personal_records
            (id, user_id, exercise_name, muscle_group, record_type, value, unit,
             achieved_at, weight_kg, reps)
        VALUES ('62626262-0000-4000-8000-0000000000e1'::uuid, '62626262-0000-4000-8000-000000000001'::uuid,
                'Bench', 'Chest', 'MAX_WEIGHT', 100, 'kg', '2026-01-01T10:00:00.123Z', 100, 5)
    $sql$,
    '23505',
    NULL,
    'a new legacy duplicate of A is rejected'
);
SELECT lives_ok(
    $sql$
        INSERT INTO public.personal_records
            (id, user_id, exercise_name, muscle_group, record_type, value, unit,
             achieved_at, weight_kg, reps)
        VALUES ('62626262-0000-4000-8000-0000000000e2'::uuid, '62626262-0000-4000-8000-000000000001'::uuid,
                'Bench', 'Chest', 'MAX_WEIGHT', 110, 'kg', '2026-01-01T10:00:00.123Z', 110, 5)
    $sql$,
    'a legacy row that differs in content is allowed'
);
SELECT lives_ok(
    $sql$
        INSERT INTO public.personal_records
            (id, user_id, exercise_name, muscle_group, record_type, value, unit,
             achieved_at, weight_kg, reps)
        VALUES ('62626262-0000-4000-8000-0000000000e5'::uuid, '62626262-0000-4000-8000-000000000001'::uuid,
                'Bench', 'Back', 'MAX_WEIGHT', 100, 'kg', '2026-01-01T10:00:00.123Z', 100, 5)
    $sql$,
    'a legacy row that differs only in muscle group is allowed'
);
SELECT lives_ok(
    $sql$
        INSERT INTO public.personal_records
            (id, user_id, exercise_name, muscle_group, record_type, value, unit,
             achieved_at, weight_kg, reps, source)
        VALUES ('62626262-0000-4000-8000-0000000000e3'::uuid, '62626262-0000-4000-8000-000000000001'::uuid,
                'Bench', 'Chest', 'MAX_WEIGHT', 100, 'kg', '2026-01-01T10:00:00.123Z', 100, 5, 'dedicated')
    $sql$,
    'a dedicated row with the same content stays id-keyed (F335)'
);
SELECT throws_ok(
    $sql$
        INSERT INTO public.personal_records
            (id, user_id, exercise_name, muscle_group, record_type, value, unit, achieved_at)
        VALUES ('62626262-0000-4000-8000-0000000000e4'::uuid, '62626262-0000-4000-8000-000000000001'::uuid,
                'Plank', 'Core', 'MAX_VOLUME', 60, 's', '2026-02-01T00:00:00Z')
    $sql$,
    '23505',
    NULL,
    'NULL weight, reps and session compare equal'
);

SELECT diag('database:pr-legacy-identity-reassignment');

-- Deleting a local profile sets local_profile_id to NULL ('default'). A legacy
-- row that becomes identical to one already under 'default' is tombstoned
-- instead of failing the profile deletion.
INSERT INTO public.local_profiles (user_id, id, name)
VALUES ('62626262-0000-4000-8000-000000000001'::uuid, 'phone-b', 'Phone B');
INSERT INTO public.personal_records
    (id, user_id, local_profile_id, exercise_name, muscle_group, record_type, value, unit,
     achieved_at, weight_kg, reps)
VALUES ('62626262-0000-4000-8000-0000000000f1'::uuid, '62626262-0000-4000-8000-000000000001'::uuid,
        'phone-b', 'Bench', 'Chest', 'MAX_WEIGHT', 100, 'kg', '2026-01-01T10:00:00.123Z', 100, 5);
SELECT lives_ok(
    $sql$
        DELETE FROM public.local_profiles
        WHERE user_id = '62626262-0000-4000-8000-000000000001' AND id = 'phone-b'
    $sql$,
    'deleting a profile whose record duplicates a default-profile record succeeds'
);
SELECT ok(
    (SELECT deleted_at IS NOT NULL AND local_profile_id IS NULL FROM public.personal_records
     WHERE id = '62626262-0000-4000-8000-0000000000f1'),
    'the reassigned duplicate is tombstoned'
);
SELECT ok(
    (SELECT deleted_at IS NULL FROM public.personal_records
     WHERE id = '62626262-0000-4000-8000-0000000000a1'),
    'the record it duplicated stays live'
);

-- Deleting a session sets session_id to NULL, with the same outcome.
INSERT INTO public.workout_sessions (id, user_id)
VALUES ('62626262-0000-4000-8000-0000000005e1'::uuid, '62626262-0000-4000-8000-000000000001'::uuid);
INSERT INTO public.personal_records
    (id, user_id, exercise_name, muscle_group, record_type, value, unit, achieved_at, session_id)
VALUES ('62626262-0000-4000-8000-0000000000f2'::uuid, '62626262-0000-4000-8000-000000000001'::uuid,
        'Plank', 'Core', 'MAX_VOLUME', 60, 's', '2026-02-01T00:00:00Z',
        '62626262-0000-4000-8000-0000000005e1'::uuid);
SELECT lives_ok(
    $sql$
        DELETE FROM public.workout_sessions WHERE id = '62626262-0000-4000-8000-0000000005e1'
    $sql$,
    'deleting a session whose record then duplicates another succeeds'
);
SELECT ok(
    (SELECT deleted_at IS NOT NULL FROM public.personal_records
     WHERE id = '62626262-0000-4000-8000-0000000000f2'),
    'the record left without its session is tombstoned as the duplicate'
);

-- An ordinary edit that creates no duplicate is untouched.
UPDATE public.personal_records SET value = 111
 WHERE id = '62626262-0000-4000-8000-0000000000e2';
SELECT ok(
    (SELECT deleted_at IS NULL AND value = 111 FROM public.personal_records
     WHERE id = '62626262-0000-4000-8000-0000000000e2'),
    'a non-colliding edit stays live'
);

SELECT * FROM finish();

ROLLBACK;
