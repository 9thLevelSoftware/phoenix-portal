-- cycle_progression pgTAP (PR 19): progression_settings stays decodable by
-- mobile's non-lenient Map<String, String> (normalize trigger on every write
-- path), and merge_training_cycles_from_push keeps the mobile keys on a NULL
-- or stale push (review R-10).
--
-- Run locally with `supabase test db`.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;

SELECT no_plan();

SELECT diag('database:cycle-progression-catalog');

SELECT has_trigger(
    'public', 'training_cycles', 'training_cycles_normalize_progression',
    'training_cycles has the progression normalize trigger'
);
SELECT ok(
    (SELECT proconfig FROM pg_proc
     WHERE oid = 'public.normalize_cycle_progression_settings(jsonb)'::regprocedure)
      @> ARRAY['search_path=""']
    AND (SELECT proconfig FROM pg_proc
         WHERE oid = 'public.normalize_training_cycle_progression()'::regprocedure)
      @> ARRAY['search_path=""'],
    'the normalizer and its trigger function pin search_path'
);
SELECT ok(
    NOT (SELECT prosecdef FROM pg_proc
         WHERE oid = 'public.normalize_cycle_progression_settings(jsonb)'::regprocedure),
    'the normalizer is SECURITY INVOKER'
);
SELECT ok(
    NOT has_function_privilege('anon', 'public.normalize_cycle_progression_settings(jsonb)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.normalize_cycle_progression_settings(jsonb)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.normalize_training_cycle_progression()', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.normalize_training_cycle_progression()', 'EXECUTE'),
    'the normalizer and trigger function are not executable by browser roles'
);
SELECT is(
    (SELECT count(*)::int FROM pg_proc
     WHERE proname = 'pr19_normalized_cycle_progression'),
    0,
    'the one-shot backfill helper is gone'
);

SELECT diag('database:cycle-progression-normalizer');

SELECT is(
    public.normalize_cycle_progression_settings(
        '{"type":"percentage","amount":2.5,"frequency":1,"flag":true,"gone":null,"nested":{"a":1},"s":"x"}'),
    '{"type":"percentage","amount":"2.5","frequency":"1","flag":"true","nested":"{\"a\": 1}","s":"x"}'::jsonb,
    'numbers, booleans and objects become strings; JSON nulls are dropped'
);
SELECT is(
    public.normalize_cycle_progression_settings('{"weightIncreasePercent":"2.5"}'),
    '{"weightIncreasePercent":"2.5"}'::jsonb,
    'an all-string object is unchanged and no mobile key is derived'
);
SELECT is(public.normalize_cycle_progression_settings(NULL), NULL::jsonb, 'NULL stays NULL');
SELECT is(
    public.normalize_cycle_progression_settings('[1,2]'),
    NULL::jsonb,
    'a non-object becomes NULL'
);
SELECT is(
    public.normalize_cycle_progression_settings('"x"'),
    NULL::jsonb,
    'a JSON string becomes NULL'
);
SELECT is(
    public.normalize_cycle_progression_settings('null'),
    NULL::jsonb,
    'a JSON null becomes SQL NULL'
);

-- ---------------------------------------------------------------------------
-- Fixtures (postgres, no claims)
-- ---------------------------------------------------------------------------
INSERT INTO auth.users (id, email)
VALUES ('19191919-0000-4000-8000-000000000001'::uuid, 'cycle-progression@example.test')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.subscriptions (user_id, tier, status, current_period_end)
VALUES ('19191919-0000-4000-8000-000000000001'::uuid, 'FLAME', 'active', '2099-01-01+00');

SELECT diag('database:cycle-progression-trigger');

-- A numeric insert (e.g. a cached pre-PR-19 bundle) is normalized.
INSERT INTO public.training_cycles (id, user_id, name, progression_settings, updated_at)
VALUES
    -- p1: numeric insert
    ('19191919-0000-4000-8000-0000000000c1'::uuid, '19191919-0000-4000-8000-000000000001'::uuid,
     'Numeric insert', '{"type":"percentage","amount":2.5,"frequency":1,"x":null}', '2026-01-01+00'),
    -- p2: backfilled row (all strings, mobile keys derived), never portal-edited
    ('19191919-0000-4000-8000-0000000000c2'::uuid, '19191919-0000-4000-8000-000000000001'::uuid,
     'Backfilled', '{"type":"percentage","amount":"2.5","frequency":"1","frequencyCycles":"1","weightIncreasePercent":"2.5"}',
     '2026-01-01+00'),
    -- p3: phone cycle with echo on
    ('19191919-0000-4000-8000-0000000000c3'::uuid, '19191919-0000-4000-8000-000000000001'::uuid,
     'Echo on', '{"frequencyCycles":"2","echoLevelIncrease":"true","portalKey":"keep"}',
     '2026-01-01+00'),
    -- p4: portal progression edit target
    ('19191919-0000-4000-8000-0000000000c4'::uuid, '19191919-0000-4000-8000-000000000001'::uuid,
     'Portal edit', '{"frequencyCycles":"2"}', '2026-01-01+00');

SELECT is(
    (SELECT progression_settings FROM public.training_cycles
     WHERE id = '19191919-0000-4000-8000-0000000000c1'),
    '{"type":"percentage","amount":"2.5","frequency":"1"}'::jsonb,
    'a numeric insert is stored as strings with nulls dropped'
);

-- Non-object progression values are stored as NULL.
INSERT INTO public.training_cycles (id, user_id, name, progression_settings, updated_at)
VALUES
    ('19191919-0000-4000-8000-0000000000c5'::uuid, '19191919-0000-4000-8000-000000000001'::uuid,
     'Scalar', '5', '2026-01-01+00'),
    ('19191919-0000-4000-8000-0000000000c6'::uuid, '19191919-0000-4000-8000-000000000001'::uuid,
     'Array', '[1]', '2026-01-01+00');
SELECT results_eq(
    $sql$ SELECT name, progression_settings FROM public.training_cycles
          WHERE id IN ('19191919-0000-4000-8000-0000000000c5', '19191919-0000-4000-8000-0000000000c6')
          ORDER BY id $sql$,
    $values$ VALUES ('Scalar'::text, NULL::jsonb), ('Array', NULL) $values$,
    'inserting 5 or [1] stores NULL'
);

-- An authenticated PostgREST-style update with numbers is normalized too.
SET LOCAL ROLE authenticated;
SELECT set_config(
    'request.jwt.claims',
    '{"sub":"19191919-0000-4000-8000-000000000001","role":"authenticated"}',
    true
);
UPDATE public.training_cycles
   SET progression_settings = '{"frequencyCycles":4,"weightIncreasePercent":3.5,"trigger":"all_sets"}'
 WHERE id = '19191919-0000-4000-8000-0000000000c4';
RESET ROLE;

SELECT is(
    (SELECT progression_settings FROM public.training_cycles
     WHERE id = '19191919-0000-4000-8000-0000000000c4'),
    '{"frequencyCycles":"4","weightIncreasePercent":"3.5","trigger":"all_sets"}'::jsonb,
    'an authenticated numeric update is stored as strings'
);
SELECT ok(
    (SELECT portal_edited_at IS NOT NULL FROM public.training_cycles
     WHERE id = '19191919-0000-4000-8000-0000000000c4'),
    'the portal edit is stamped (for the stale-push case below)'
);

SELECT diag('database:cycle-progression-import');

-- A community snapshot with numeric progression imports as strings.
SELECT set_config('request.jwt.claims', '', true);
INSERT INTO public.shared_cycles (id, user_id, cycle_id, name, cycle_snapshot)
VALUES ('19191919-0000-4000-8000-0000000000e1'::uuid, '19191919-0000-4000-8000-000000000001'::uuid,
        '19191919-0000-4000-8000-0000000000c3'::uuid, 'Shared numeric',
        '{"duration_weeks":4,"days":[{"day_number":1,"day_type":"rest"}],
          "progression_settings":{"type":"percentage","amount":2.5,"frequency":1,"flag":false,"n":null},
          "deload_settings":null}');
SET LOCAL ROLE authenticated;
SELECT set_config(
    'request.jwt.claims',
    '{"sub":"19191919-0000-4000-8000-000000000001","role":"authenticated"}',
    true
);
CREATE TEMP TABLE imported AS
SELECT public.import_shared_cycle('19191919-0000-4000-8000-0000000000e1'::uuid) AS cycle_id;
RESET ROLE;

SELECT is(
    (SELECT tc.progression_settings FROM public.training_cycles tc
     JOIN imported i ON i.cycle_id = tc.id),
    '{"type":"percentage","amount":"2.5","frequency":"1","flag":"false"}'::jsonb,
    'import_shared_cycle of a numeric snapshot stores every value as a string'
);
SELECT ok(
    NOT EXISTS (
        SELECT 1 FROM public.training_cycles tc
        JOIN imported i ON i.cycle_id = tc.id,
        jsonb_each(tc.progression_settings) e
        WHERE jsonb_typeof(e.value) <> 'string'),
    'every imported progression value has jsonb_typeof string'
);

SELECT diag('database:cycle-progression-merge');

SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);

-- R-10 (1): a phone with no local progression row pushes NULL after the
-- backfill. The backfilled mobile keys survive for the pull.
SELECT results_eq(
    $sql$
      SELECT accepted, structure_applied
      FROM public.merge_training_cycles_from_push(
        '19191919-0000-4000-8000-000000000001',
        '[{"id":"19191919-0000-4000-8000-0000000000c2","name":"Backfilled","description":"",
           "duration_weeks":1,"workout_days":0,"rest_days":0,"current_week":1,"status":"draft",
           "progression_settings":null,"base_updated_at":"2026-01-01T00:00:00Z","days":[]}]',
        false)
    $sql$,
    $values$ VALUES (true, true) $values$,
    'a current push with null progression is accepted'
);
SELECT is(
    (SELECT progression_settings FROM public.training_cycles
     WHERE id = '19191919-0000-4000-8000-0000000000c2'),
    '{"type":"percentage","amount":"2.5","frequency":"1","frequencyCycles":"1","weightIncreasePercent":"2.5"}'::jsonb,
    'a null push keeps the backfilled mobile keys'
);

-- R-10 (2): a stale push (base before the portal edit) carrying the phone's
-- old keys leaves the portal-edited progression alone.
SELECT results_eq(
    $sql$
      SELECT accepted, structure_applied
      FROM public.merge_training_cycles_from_push(
        '19191919-0000-4000-8000-000000000001',
        '[{"id":"19191919-0000-4000-8000-0000000000c4","name":"Portal edit","description":"",
           "duration_weeks":1,"workout_days":0,"rest_days":0,"current_week":1,"status":"draft",
           "progression_settings":{"frequencyCycles":"2"},
           "base_updated_at":"2026-01-01T00:00:00Z","days":[]}]',
        false)
    $sql$,
    $values$ VALUES (true, false) $values$,
    'a push based before the portal edit is stale'
);
SELECT is(
    (SELECT progression_settings FROM public.training_cycles
     WHERE id = '19191919-0000-4000-8000-0000000000c4'),
    '{"frequencyCycles":"4","weightIncreasePercent":"3.5","trigger":"all_sets"}'::jsonb,
    'a stale push keeps the portal-edited progression keys'
);

-- R-10 (3): a current non-null push without echoLevelIncrease turns it off;
-- portal-only keys survive; numeric incoming values are normalized.
SELECT lives_ok(
    $sql$
      SELECT * FROM public.merge_training_cycles_from_push(
        '19191919-0000-4000-8000-000000000001',
        '[{"id":"19191919-0000-4000-8000-0000000000c3","name":"Echo on","description":"",
           "duration_weeks":1,"workout_days":0,"rest_days":0,"current_week":1,"status":"draft",
           "progression_settings":{"frequencyCycles":3},"days":[]}]',
        false)
    $sql$,
    'phone turns echo increase off'
);
SELECT is(
    (SELECT progression_settings FROM public.training_cycles
     WHERE id = '19191919-0000-4000-8000-0000000000c3'),
    '{"frequencyCycles":"3","portalKey":"keep"}'::jsonb,
    'a non-null push without echoLevelIncrease removes it and keeps portal-only keys'
);

-- An identical re-push is a no-op (normalized comparison): no UPDATE, so
-- the row version (ctid) does not change. (now() is frozen in this
-- transaction, so updated_at cannot show it.)
CREATE TEMP TABLE before_repush AS
SELECT ctid AS row_version FROM public.training_cycles
WHERE id = '19191919-0000-4000-8000-0000000000c3';
SELECT lives_ok(
    $sql$
      SELECT * FROM public.merge_training_cycles_from_push(
        '19191919-0000-4000-8000-000000000001',
        '[{"id":"19191919-0000-4000-8000-0000000000c3","name":"Echo on","description":"",
           "duration_weeks":1,"workout_days":0,"rest_days":0,"current_week":1,"status":"draft",
           "progression_settings":{"frequencyCycles":3},"days":[]}]',
        false)
    $sql$,
    'phone re-pushes the same progression'
);
SELECT is(
    (SELECT ctid FROM public.training_cycles
     WHERE id = '19191919-0000-4000-8000-0000000000c3'),
    (SELECT row_version FROM before_repush),
    'an unchanged push (numeric vs stored string) writes nothing'
);

SELECT * FROM finish();
ROLLBACK;
