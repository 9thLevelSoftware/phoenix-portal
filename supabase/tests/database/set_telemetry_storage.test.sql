-- Per-set telemetry storage (20260925200000, F-015 / F-037).
--   * set_telemetry: one row per set, aligned arrays, RLS + INFERNO read gate,
--     no client writes;
--   * rep_telemetry / telemetry_points: security_invoker per-sample views;
--     legacy rows are served until their set is folded, never twice;
--   * single-row INSERTs through the view keep the old table's contract;
--     UPDATE / DELETE are refused with 42501;
--   * replace_session_children stores sorted per-set arrays and moves a
--     payload id held by another set;
--   * private.backfill_set_telemetry folds legacy sets in chunks, is
--     idempotent and never deletes legacy rows;
--   * sample ids stay globally unique (set_telemetry_sample_ids): a duplicate
--     across sets, inside one set, or against another set's legacy row
--     raises 23505, and every writer above keeps the index exact.
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;

SELECT no_plan();

SELECT diag('database:set-telemetry-catalog');

SELECT has_table('public', 'set_telemetry', 'set_telemetry exists');
SELECT has_table('public', 'rep_telemetry_legacy', 'the per-sample table is kept as rep_telemetry_legacy');
SELECT is(
    (SELECT relkind::text FROM pg_class WHERE oid = 'public.rep_telemetry'::regclass),
    'v',
    'rep_telemetry is a view'
);
SELECT ok(
    (SELECT array_to_string(reloptions, ',') ~* 'security_invoker=(true|on)'
     FROM pg_class WHERE oid = 'public.rep_telemetry'::regclass)
    AND (SELECT array_to_string(reloptions, ',') ~* 'security_invoker=(true|on)'
         FROM pg_class WHERE oid = 'public.telemetry_points'::regclass),
    'rep_telemetry and telemetry_points are security_invoker'
);
SELECT ok(
    (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.set_telemetry'::regclass)
    AND (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.rep_telemetry_legacy'::regclass),
    'RLS is enabled on both backing tables'
);
SELECT ok(
    has_table_privilege('authenticated', 'public.set_telemetry', 'SELECT')
    AND NOT has_table_privilege('authenticated', 'public.set_telemetry', 'INSERT')
    AND NOT has_table_privilege('authenticated', 'public.set_telemetry', 'UPDATE')
    AND NOT has_table_privilege('authenticated', 'public.set_telemetry', 'DELETE')
    AND NOT has_table_privilege('authenticated', 'public.set_telemetry', 'TRUNCATE')
    AND NOT has_table_privilege('anon', 'public.set_telemetry', 'SELECT'),
    'clients may only read set_telemetry (anon not even that)'
);
SELECT ok(
    NOT has_table_privilege('authenticated', 'public.rep_telemetry', 'INSERT')
    AND NOT has_table_privilege('authenticated', 'public.rep_telemetry', 'UPDATE')
    AND NOT has_table_privilege('authenticated', 'public.rep_telemetry', 'DELETE')
    AND has_table_privilege('service_role', 'public.rep_telemetry', 'INSERT'),
    'only the service role writes through the rep_telemetry view'
);
SELECT ok(
    NOT EXISTS (
        SELECT 1 FROM (VALUES ('anon'), ('authenticated'), ('service_role')) AS r(rolname)
        WHERE has_function_privilege(r.rolname, 'private.backfill_set_telemetry(uuid, integer)', 'EXECUTE')
    ),
    'the backfill is owner-only'
);
SELECT has_table('public', 'set_telemetry_sample_ids', 'the sample-id index table exists');
SELECT col_is_pk('public', 'set_telemetry_sample_ids', 'id', 'a sample id is its primary key');
SELECT ok(
    (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.set_telemetry_sample_ids'::regclass)
    AND NOT EXISTS (
        SELECT 1
        FROM (VALUES ('anon'), ('authenticated'), ('service_role')) AS r(rolname)
        CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE')) AS p(priv)
        WHERE has_table_privilege(r.rolname, 'public.set_telemetry_sample_ids', p.priv)
    ),
    'the sample-id index is owner-only: RLS on, no client or service-role privilege'
);

-- ---------------------------------------------------------------------------
-- Fixtures (postgres)
-- ---------------------------------------------------------------------------
INSERT INTO auth.users (id, email) VALUES
    ('25250000-0000-4000-8000-000000000001'::uuid, 'set-telemetry-owner@example.test'),
    ('25250000-0000-4000-8000-000000000002'::uuid, 'set-telemetry-other@example.test')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.workout_sessions (id, user_id) VALUES
    ('25250000-0001-4000-8000-000000000001', '25250000-0000-4000-8000-000000000001'),
    ('25250000-0001-4000-8000-000000000002', '25250000-0000-4000-8000-000000000002');
INSERT INTO public.exercises (id, session_id, name, user_id) VALUES
    ('25250000-0002-4000-8000-000000000001', '25250000-0001-4000-8000-000000000001', 'Row', '25250000-0000-4000-8000-000000000001'),
    ('25250000-0002-4000-8000-000000000002', '25250000-0001-4000-8000-000000000002', 'Row', '25250000-0000-4000-8000-000000000002');
-- Sets s1..s4 belong to the owner, s9 to the other user.
INSERT INTO public.sets (id, exercise_id, set_number, user_id)
SELECT ('25250000-0003-4000-8000-00000000000' || n)::uuid,
       '25250000-0002-4000-8000-000000000001', n, '25250000-0000-4000-8000-000000000001'
FROM generate_series(1, 4) AS n;
INSERT INTO public.sets (id, exercise_id, set_number, user_id) VALUES
    ('25250000-0003-4000-8000-000000000009', '25250000-0002-4000-8000-000000000002', 1, '25250000-0000-4000-8000-000000000002');

CREATE FUNCTION pg_temp.s(n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
    SELECT ('25250000-0003-4000-8000-00000000000' || n)::uuid
$$;
CREATE FUNCTION pg_temp.sample(n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
    SELECT ('25250000-0004-4000-8000-' || lpad(n::text, 12, '0'))::uuid
$$;

-- Legacy rows (written before the migration) for s1 and s2, out of order.
INSERT INTO public.rep_telemetry_legacy (id, set_id, user_id, timestamp_ms, force_n) VALUES
    (pg_temp.sample(12), pg_temp.s(1), '25250000-0000-4000-8000-000000000001', 20, 2),
    (pg_temp.sample(11), pg_temp.s(1), '25250000-0000-4000-8000-000000000001', 10, 1),
    (pg_temp.sample(21), pg_temp.s(2), '25250000-0000-4000-8000-000000000001', 10, 3);

SELECT diag('database:set-telemetry-view-serves-legacy');

SELECT results_eq(
    $sql$ SELECT id, timestamp_ms FROM public.rep_telemetry WHERE set_id = pg_temp.s(1) ORDER BY timestamp_ms, id $sql$,
    $sql$ VALUES (pg_temp.sample(11), 10::bigint), (pg_temp.sample(12), 20::bigint) $sql$,
    'the view serves an unfolded set from the legacy table'
);

SELECT diag('database:set-telemetry-trigger-insert');

-- A single-row insert folds the set's legacy rows first, then appends.
INSERT INTO public.rep_telemetry (id, set_id, user_id, timestamp_ms, force_n)
VALUES (pg_temp.sample(13), pg_temp.s(1), '25250000-0000-4000-8000-000000000001', 15, 9);

SELECT results_eq(
    $sql$ SELECT id FROM public.rep_telemetry WHERE set_id = pg_temp.s(1) ORDER BY timestamp_ms, id $sql$,
    $sql$ VALUES (pg_temp.sample(11)), (pg_temp.sample(13)), (pg_temp.sample(12)) $sql$,
    'a view insert keeps the legacy samples of its set and adds the new one, each once'
);
SELECT is(
    (SELECT sample_count FROM public.set_telemetry WHERE set_id = pg_temp.s(1)),
    3,
    'the folded set holds all three samples'
);
SELECT is(
    (SELECT count(*)::int FROM public.rep_telemetry_legacy WHERE set_id = pg_temp.s(1)),
    2,
    'folding never deletes legacy rows'
);

SELECT throws_ok(
    $sql$ INSERT INTO public.rep_telemetry (id, set_id, user_id, timestamp_ms)
          VALUES (pg_temp.sample(11), pg_temp.s(3), '25250000-0000-4000-8000-000000000001', 1) $sql$,
    '23505', NULL,
    'a sample id already stored per set is refused as a duplicate key'
);
SELECT throws_ok(
    $sql$ INSERT INTO public.rep_telemetry (id, set_id, user_id, timestamp_ms)
          VALUES (pg_temp.sample(21), pg_temp.s(3), '25250000-0000-4000-8000-000000000001', 1) $sql$,
    '23505', NULL,
    'a sample id still in the legacy table is refused as a duplicate key'
);
SELECT throws_ok(
    $sql$ INSERT INTO public.rep_telemetry (set_id, user_id, timestamp_ms)
          VALUES (pg_temp.s(3), '25250000-0000-4000-8000-000000000001', NULL) $sql$,
    '23502', NULL,
    'timestamp_ms stays NOT NULL through the view'
);
SELECT throws_ok(
    $sql$ INSERT INTO public.rep_telemetry (set_id, user_id, timestamp_ms)
          VALUES (pg_temp.s(1), '25250000-0000-4000-8000-000000000002', 1) $sql$,
    '23505', NULL,
    'a sample for a set that holds another user''s telemetry is refused'
);
SELECT throws_ok(
    $sql$ UPDATE public.rep_telemetry SET force_n = 0 WHERE set_id = pg_temp.s(1) $sql$,
    '42501', NULL,
    'UPDATE through the view is refused with 42501'
);
SELECT throws_ok(
    $sql$ DELETE FROM public.telemetry_points WHERE set_id = pg_temp.s(1) $sql$,
    '42501', NULL,
    'DELETE through telemetry_points is refused with 42501'
);
SELECT throws_ok(
    $sql$ INSERT INTO public.set_telemetry (set_id, user_id, sample_count, ids, timestamp_ms, force_n, velocity_mps, position_mm, cable)
          VALUES (pg_temp.s(4), '25250000-0000-4000-8000-000000000001', 2, ARRAY[pg_temp.sample(41)], ARRAY[1::bigint], '{NULL}', '{NULL}', '{NULL}', '{NULL}') $sql$,
    '23514', NULL,
    'misaligned arrays violate the alignment CHECK'
);

SELECT diag('database:set-telemetry-replace-session-children');

-- A payload whose sample 21 (stored for s2 in legacy) now belongs to s3, plus
-- a new unordered pair for s3.
SELECT is(
    (public.replace_session_children(
        '25250000-0000-4000-8000-000000000001'::uuid,
        ARRAY[]::uuid[],
        '[]'::jsonb,
        '[]'::jsonb,
        '[]'::jsonb,
        jsonb_build_array(
            jsonb_build_object('id', pg_temp.sample(32), 'set_id', pg_temp.s(3), 'user_id', '25250000-0000-4000-8000-000000000001', 'timestamp_ms', 30, 'force_n', 5),
            jsonb_build_object('id', pg_temp.sample(31), 'set_id', pg_temp.s(3), 'user_id', '25250000-0000-4000-8000-000000000001', 'timestamp_ms', 20, 'force_n', 4),
            jsonb_build_object('id', pg_temp.sample(21), 'set_id', pg_temp.s(3), 'user_id', '25250000-0000-4000-8000-000000000001', 'timestamp_ms', 25, 'force_n', 3)
        )
    ) ->> 'rep_telemetry')::int,
    3,
    'replace_session_children reports every payload sample'
);
SELECT results_eq(
    $sql$ SELECT ids, timestamp_ms FROM public.set_telemetry WHERE set_id = pg_temp.s(3) $sql$,
    $sql$ VALUES (ARRAY[pg_temp.sample(31), pg_temp.sample(21), pg_temp.sample(32)], ARRAY[20, 25, 30]::bigint[]) $sql$,
    'samples are stored once per set, in (timestamp_ms, id) order'
);
SELECT is(
    (SELECT count(*)::int FROM public.rep_telemetry WHERE id = pg_temp.sample(21)),
    1,
    'a payload id held by another set moves; it is served exactly once'
);
SELECT is(
    (SELECT set_id FROM public.rep_telemetry WHERE id = pg_temp.sample(21)),
    pg_temp.s(3),
    'the moved sample now belongs to the payload set'
);

SELECT diag('database:set-telemetry-sample-id-uniqueness');

CREATE FUNCTION pg_temp.sample_index_matches() RETURNS boolean LANGUAGE sql AS $$
    SELECT NOT EXISTS (
        (SELECT x, t.set_id FROM public.set_telemetry t CROSS JOIN LATERAL unnest(t.ids) AS x
         EXCEPT ALL
         SELECT id, set_id FROM public.set_telemetry_sample_ids)
        UNION ALL
        (SELECT id, set_id FROM public.set_telemetry_sample_ids
         EXCEPT ALL
         SELECT x, t.set_id FROM public.set_telemetry t CROSS JOIN LATERAL unnest(t.ids) AS x)
    )
$$;

SELECT ok(
    pg_temp.sample_index_matches(),
    'after view inserts and replace_session_children (including a move), the index holds exactly the stored ids'
);
SELECT throws_ok(
    $sql$ INSERT INTO public.set_telemetry (set_id, user_id, sample_count, ids, timestamp_ms, force_n, velocity_mps, position_mm, cable)
          VALUES (pg_temp.s(4), '25250000-0000-4000-8000-000000000001', 1, ARRAY[pg_temp.sample(31)], ARRAY[1::bigint], '{NULL}', '{NULL}', '{NULL}', '{NULL}') $sql$,
    '23505', 'duplicate key value violates unique constraint "set_telemetry_sample_ids_pkey"',
    'a sample id stored for one set cannot be stored for a second set (the race two pushes could win)'
);
SELECT throws_ok(
    $sql$ UPDATE public.set_telemetry
             SET sample_count = sample_count + 1,
                 ids = ids || pg_temp.sample(31),
                 timestamp_ms = timestamp_ms || 99::bigint,
                 force_n = force_n || NULL::numeric,
                 velocity_mps = velocity_mps || NULL::numeric,
                 position_mm = position_mm || NULL::numeric,
                 cable = cable || NULL::text
           WHERE set_id = pg_temp.s(1) $sql$,
    '23505', 'duplicate key value violates unique constraint "set_telemetry_sample_ids_pkey"',
    'appending another set''s sample id to a set is refused'
);
SELECT throws_ok(
    $sql$ INSERT INTO public.set_telemetry (set_id, user_id, sample_count, ids, timestamp_ms, force_n, velocity_mps, position_mm, cable)
          VALUES (pg_temp.s(4), '25250000-0000-4000-8000-000000000001', 2, ARRAY[pg_temp.sample(77), pg_temp.sample(77)], ARRAY[1, 2]::bigint[], '{NULL,NULL}', '{NULL,NULL}', '{NULL,NULL}', '{NULL,NULL}') $sql$,
    '23505', 'duplicate key value violates unique constraint "set_telemetry_sample_ids_pkey"',
    'one set cannot hold the same sample id twice'
);
SELECT throws_ok(
    $sql$ UPDATE public.set_telemetry
             SET sample_count = sample_count + 1,
                 ids = ids || ids[1],
                 timestamp_ms = timestamp_ms || 99::bigint,
                 force_n = force_n || NULL::numeric,
                 velocity_mps = velocity_mps || NULL::numeric,
                 position_mm = position_mm || NULL::numeric,
                 cable = cable || NULL::text
           WHERE set_id = pg_temp.s(1) $sql$,
    '23505', 'duplicate key value violates unique constraint "set_telemetry_sample_ids_pkey"',
    'an update cannot repeat a set''s own sample id'
);
SELECT ok(
    pg_temp.sample_index_matches(),
    'refused writes leave the index unchanged'
);

SELECT diag('database:set-telemetry-backfill');

-- Fresh legacy sets for the backfill (s4 has none yet); s2 lost its only
-- sample to the move above.
INSERT INTO public.rep_telemetry_legacy (id, set_id, user_id, timestamp_ms, force_n) VALUES
    (pg_temp.sample(42), pg_temp.s(4), '25250000-0000-4000-8000-000000000001', 20, 2),
    (pg_temp.sample(41), pg_temp.s(4), '25250000-0000-4000-8000-000000000001', 10, 1),
    (pg_temp.sample(91), '25250000-0003-4000-8000-000000000009', '25250000-0000-4000-8000-000000000002', 10, 1),
    -- A foreign row in the owner's set s4 (the old client INSERT policy
    -- checked only rep_telemetry.user_id). It must never fold or be hidden.
    (pg_temp.sample(49), pg_temp.s(4), '25250000-0000-4000-8000-000000000002', 30, 9);

SELECT throws_ok(
    $sql$ INSERT INTO public.set_telemetry (set_id, user_id, sample_count, ids, timestamp_ms, force_n, velocity_mps, position_mm, cable)
          VALUES (pg_temp.s(2), '25250000-0000-4000-8000-000000000001', 1, ARRAY[pg_temp.sample(41)], ARRAY[1::bigint], '{NULL}', '{NULL}', '{NULL}', '{NULL}') $sql$,
    '23505', 'duplicate key value violates unique constraint "set_telemetry_sample_ids_pkey"',
    'a sample id still held by another set''s unfolded legacy rows is refused'
);

CREATE TEMP TABLE before_backfill AS
SELECT id, set_id, timestamp_ms, force_n FROM public.rep_telemetry;

CREATE TEMP TABLE backfill_run AS
SELECT * FROM private.backfill_set_telemetry(NULL, 1);
SELECT is(
    (SELECT folded_sets FROM backfill_run),
    1,
    'one chunk of one set folds one set'
);
SELECT isnt(
    (SELECT last_set_id FROM backfill_run),
    NULL,
    'the chunk returns its keyset cursor'
);

-- Drain with the cursor.
DO $$
DECLARE
  v_after uuid := (SELECT last_set_id FROM backfill_run);
  r record;
BEGIN
  LOOP
    SELECT * INTO r FROM private.backfill_set_telemetry(v_after, 1);
    EXIT WHEN r.last_set_id IS NULL;
    v_after := r.last_set_id;
  END LOOP;
END
$$;

SELECT results_eq(
    $sql$ SELECT l.id FROM public.rep_telemetry_legacy l
          WHERE NOT EXISTS (SELECT 1 FROM public.set_telemetry t
                             WHERE t.set_id = l.set_id AND t.user_id = l.user_id) $sql$,
    $values$ VALUES (pg_temp.sample(49)) $values$,
    'after the drain only the foreign row in a mixed-owner set is left unfolded'
);
SELECT is(
    (SELECT user_id FROM public.set_telemetry WHERE set_id = pg_temp.s(4)),
    '25250000-0000-4000-8000-000000000001'::uuid,
    'a mixed-owner set folds under its owner, never an arbitrary one'
);
SELECT set_eq(
    $sql$ SELECT id, set_id, timestamp_ms, force_n FROM public.rep_telemetry $sql$,
    $sql$ SELECT id, set_id, timestamp_ms, force_n FROM before_backfill $sql$,
    'the view serves exactly the same samples before and after the backfill (export parity)'
);
SELECT is(
    (SELECT folded_sets FROM private.backfill_set_telemetry(NULL, 500)),
    0,
    're-running the backfill folds nothing'
);
SELECT ok(
    pg_temp.sample_index_matches(),
    'the backfill''s folds are indexed too'
);
SELECT is(
    (SELECT count(*)::int FROM public.set_telemetry_sample_ids WHERE set_id = pg_temp.s(4)),
    2,
    'a folded legacy set indexes its own legacy ids'
);
SELECT is(
    (SELECT count(*)::int FROM public.rep_telemetry_legacy),
    6,
    'the backfill never deletes legacy rows'
);

-- Deleting a set's storage drops its index rows (the account-deletion path:
-- auth.users -> set_telemetry -> set_telemetry_sample_ids, all CASCADE).
DELETE FROM public.set_telemetry WHERE set_id = pg_temp.s(4);
SELECT is(
    (SELECT count(*)::int FROM public.set_telemetry_sample_ids WHERE set_id = pg_temp.s(4)),
    0,
    'deleting a set''s telemetry cascades to its index rows'
);
SELECT lives_ok(
    $sql$ INSERT INTO public.set_telemetry (set_id, user_id, sample_count, ids, timestamp_ms, force_n, velocity_mps, position_mm, cable)
          VALUES (pg_temp.s(4), '25250000-0000-4000-8000-000000000001', 1, ARRAY[pg_temp.sample(42)], ARRAY[20::bigint], '{2}', '{NULL}', '{NULL}', '{NULL}') $sql$,
    'a freed id can be stored again; its own set''s legacy row does not block it'
);

SELECT diag('database:set-telemetry-read-gate');

INSERT INTO public.subscriptions (user_id, tier, status, current_period_end) VALUES
    ('25250000-0000-4000-8000-000000000001', 'FLAME', 'active', now() + interval '30 days'),
    ('25250000-0000-4000-8000-000000000002', 'INFERNO', 'active', now() + interval '30 days')
ON CONFLICT (user_id) DO UPDATE SET tier = EXCLUDED.tier, status = EXCLUDED.status,
    current_period_end = EXCLUDED.current_period_end;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"25250000-0000-4000-8000-000000000001","role":"authenticated"}', true);
SELECT is(
    (SELECT count(*)::int FROM public.rep_telemetry)
      + (SELECT count(*)::int FROM public.set_telemetry)
      + (SELECT count(*)::int FROM public.rep_telemetry_legacy),
    0,
    'a FLAME owner reads none of its own telemetry, through any relation'
);
SELECT set_config('request.jwt.claims', '{"sub":"25250000-0000-4000-8000-000000000002","role":"authenticated"}', true);
SELECT results_eq(
    $sql$ SELECT id FROM public.telemetry_points ORDER BY timestamp_ms, id $sql$,
    $sql$ VALUES (pg_temp.sample(91)), (pg_temp.sample(49)) $sql$,
    'an INFERNO user reads its own samples (including its row in another account''s set), and only its own, through telemetry_points'
);
RESET ROLE;
SELECT set_config('request.jwt.claims', '', true);

SELECT ok(
    NOT has_table_privilege('authenticated', 'public.rep_telemetry_legacy', 'INSERT')
    AND NOT has_table_privilege('authenticated', 'public.rep_telemetry_legacy', 'UPDATE')
    AND NOT has_table_privilege('authenticated', 'public.rep_telemetry_legacy', 'DELETE')
    AND NOT has_table_privilege('anon', 'public.rep_telemetry_legacy', 'INSERT'),
    'clients cannot write the legacy telemetry table'
);

SELECT * FROM finish();
ROLLBACK;
