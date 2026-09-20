-- PR 23: vbt_assessments duplicate cleanup + vbt_assessments_identity index.
--
-- The DELETE and CREATE UNIQUE INDEX below are a verbatim copy of the data
-- statements in supabase/migrations/20260920002300_vbt_assessments_unique.sql
-- (migrations are immutable once merged, so the copy cannot drift from what
-- ran in prod). The test drops the index inside this transaction, seeds
-- duplicates, runs the cleanup twice and rolls everything back.
--
-- Follows supabase/tests/database/profile_preferences.test.sql.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;

SELECT no_plan();

SELECT diag('database:vbt-assessments-identity-index');

SELECT ok(
    (
        SELECT i.indisunique AND i.indisvalid
          FROM pg_index i
         WHERE i.indexrelid = 'public.vbt_assessments_identity'::regclass
    ),
    'vbt_assessments_identity exists and is a valid unique index'
);

SELECT is(
    (
        SELECT array_agg(a.attname::text ORDER BY k.ord)
          FROM pg_index i
          CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY AS k(attnum, ord)
          JOIN pg_attribute a
            ON a.attrelid = i.indrelid AND a.attnum = k.attnum
         WHERE i.indexrelid = 'public.vbt_assessments_identity'::regclass
    ),
    ARRAY['user_id', 'exercise_id', 'created_at'],
    'vbt_assessments_identity covers (user_id, exercise_id, created_at)'
);

SELECT diag('database:vbt-assessments-dedupe');

INSERT INTO auth.users (id, email) VALUES
    ('23232323-0000-4000-8000-000000000001', 'pr23-a@example.invalid'),
    ('23232323-0000-4000-8000-000000000002', 'pr23-b@example.invalid');

DROP INDEX public.vbt_assessments_identity;

-- Fixed ids so the expected keeper (lowest id) is known.
INSERT INTO public.vbt_assessments
    (id, user_id, exercise_id, estimated_1rm_kg, created_at)
VALUES
    -- One instant written three ways: one group, keeper ...0a01.
    ('00000000-0000-4000-8000-00000000a003', '23232323-0000-4000-8000-000000000001', 'ex-a', 100, '2026-07-11T12:00:00Z'),
    ('00000000-0000-4000-8000-00000000a001', '23232323-0000-4000-8000-000000000001', 'ex-a', 100, '2026-07-11T12:00:00+00:00'),
    ('00000000-0000-4000-8000-00000000a002', '23232323-0000-4000-8000-000000000001', 'ex-a', 100, '2026-07-11T14:00:00+02:00'),
    -- Same exercise, different instant: its own group.
    ('00000000-0000-4000-8000-00000000b001', '23232323-0000-4000-8000-000000000001', 'ex-a', 100, '2026-07-12T12:00:00Z'),
    -- Same key but another user: its own group.
    ('00000000-0000-4000-8000-00000000c001', '23232323-0000-4000-8000-000000000002', 'ex-a', 100, '2026-07-11T12:00:00Z'),
    -- NULL created_at duplicates: untouched.
    ('00000000-0000-4000-8000-00000000d001', '23232323-0000-4000-8000-000000000001', 'ex-n', 80, NULL),
    ('00000000-0000-4000-8000-00000000d002', '23232323-0000-4000-8000-000000000001', 'ex-n', 80, NULL);

-- Operator before-count query from the migration header.
SELECT is(
    (
        SELECT count(*) - count(DISTINCT (user_id, exercise_id, created_at))
          FROM public.vbt_assessments
         WHERE created_at IS NOT NULL
           AND user_id IN ('23232323-0000-4000-8000-000000000001',
                           '23232323-0000-4000-8000-000000000002')
    ),
    2::bigint,
    'before-count query reports the two surplus rows'
);

-- ---- verbatim from the migration -------------------------------------------
DELETE FROM public.vbt_assessments AS v
 USING (
   SELECT id
     FROM (
       SELECT id,
              row_number() OVER (
                PARTITION BY user_id, exercise_id, created_at
                ORDER BY id
              ) AS rn
         FROM public.vbt_assessments
        WHERE created_at IS NOT NULL
     ) ranked
    WHERE ranked.rn > 1
 ) AS dup
 WHERE v.id = dup.id;

CREATE UNIQUE INDEX IF NOT EXISTS vbt_assessments_identity
  ON public.vbt_assessments (user_id, exercise_id, created_at);
-- ---------------------------------------------------------------------------

SELECT results_eq(
    $sql$
        SELECT id::text
          FROM public.vbt_assessments
         WHERE user_id IN ('23232323-0000-4000-8000-000000000001',
                           '23232323-0000-4000-8000-000000000002')
         ORDER BY id
    $sql$,
    ARRAY[
        '00000000-0000-4000-8000-00000000a001',
        '00000000-0000-4000-8000-00000000b001',
        '00000000-0000-4000-8000-00000000c001',
        '00000000-0000-4000-8000-00000000d001',
        '00000000-0000-4000-8000-00000000d002'
    ],
    'one row (lowest id) per value-equal group; other instant, other user and NULL rows kept'
);

-- Re-run: nothing more to delete, index build skipped.
SELECT lives_ok(
    $sql$
        DELETE FROM public.vbt_assessments AS v
         USING (
           SELECT id
             FROM (
               SELECT id,
                      row_number() OVER (
                        PARTITION BY user_id, exercise_id, created_at
                        ORDER BY id
                      ) AS rn
                 FROM public.vbt_assessments
                WHERE created_at IS NOT NULL
             ) ranked
            WHERE ranked.rn > 1
         ) AS dup
         WHERE v.id = dup.id
    $sql$,
    're-running the cleanup succeeds'
);

SELECT lives_ok(
    $sql$
        CREATE UNIQUE INDEX IF NOT EXISTS vbt_assessments_identity
          ON public.vbt_assessments (user_id, exercise_id, created_at)
    $sql$,
    're-running the index build is a no-op'
);

SELECT is(
    (
        SELECT count(*)
          FROM public.vbt_assessments
         WHERE user_id IN ('23232323-0000-4000-8000-000000000001',
                           '23232323-0000-4000-8000-000000000002')
    ),
    5::bigint,
    're-run deleted nothing'
);

SELECT throws_ok(
    $sql$
        INSERT INTO public.vbt_assessments
            (user_id, exercise_id, estimated_1rm_kg, created_at)
        VALUES ('23232323-0000-4000-8000-000000000001', 'ex-a', 100,
                '2026-07-11T08:00:00-04:00')
    $sql$,
    '23505',
    NULL,
    'rebuilt index rejects another text form of a stored instant'
);

SELECT lives_ok(
    $sql$
        INSERT INTO public.vbt_assessments
            (user_id, exercise_id, estimated_1rm_kg, created_at)
        VALUES
            ('23232323-0000-4000-8000-000000000001', 'ex-z', 1, '2026-08-01T00:00:00Z'),
            ('23232323-0000-4000-8000-000000000001', 'ex-z', 1, '2026-08-01T00:00:00+00:00')
        ON CONFLICT (user_id, exercise_id, created_at) DO NOTHING
    $sql$,
    'ON CONFLICT DO NOTHING accepts two same-key rows in one statement'
);

SELECT is(
    (
        SELECT count(*)
          FROM public.vbt_assessments
         WHERE user_id = '23232323-0000-4000-8000-000000000001'
           AND exercise_id = 'ex-z'
    ),
    1::bigint,
    'ON CONFLICT DO NOTHING inserts one row for two same-key rows in one statement'
);

SELECT * FROM finish();

ROLLBACK;
