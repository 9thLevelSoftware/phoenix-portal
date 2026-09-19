-- cycle_merge pgTAP (KD-6, PR 18): portal_edited_at stamping triggers,
-- merge_training_cycles_from_push (config merge, stale structure, day
-- cleanup, no-op skip, LWW, ownership), the upsert_training_cycle_lww
-- wrapper, and function privileges.
--
-- now() is frozen for the whole transaction, so stale/current cases use
-- explicit past timestamps. Run locally with `supabase test db`.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;

SELECT no_plan();

SELECT diag('database:cycle-merge-catalog');

SELECT has_column('public', 'training_cycles', 'portal_edited_at', 'training_cycles.portal_edited_at exists');
SELECT has_trigger(
    'public', 'training_cycles', 'training_cycles_portal_edited_at',
    'training_cycles has the portal edit trigger'
);
SELECT has_trigger(
    'public', 'cycle_days', 'cycle_days_portal_edited_at',
    'cycle_days has the portal edit trigger'
);
SELECT ok(
    (SELECT prosecdef FROM pg_proc
     WHERE oid = 'public.merge_training_cycles_from_push(uuid, jsonb, boolean)'::regprocedure),
    'merge_training_cycles_from_push is SECURITY DEFINER'
);
SELECT ok(
    (SELECT proconfig FROM pg_proc
     WHERE oid = 'public.merge_training_cycles_from_push(uuid, jsonb, boolean)'::regprocedure)
      @> ARRAY['search_path=""'],
    'merge_training_cycles_from_push pins search_path'
);
SELECT is(
    (SELECT count(*)::int FROM pg_proc
     WHERE proname IN ('merge_training_cycles_from_push', 'upsert_training_cycle_lww')
       AND pronamespace = 'public'::regnamespace),
    2,
    'exactly one overload each of the merge and the LWW wrapper'
);

SELECT diag('database:cycle-merge-privileges');

SELECT ok(
    NOT has_function_privilege('anon', 'public.merge_training_cycles_from_push(uuid, jsonb, boolean)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.merge_training_cycles_from_push(uuid, jsonb, boolean)', 'EXECUTE')
    AND has_function_privilege('service_role', 'public.merge_training_cycles_from_push(uuid, jsonb, boolean)', 'EXECUTE'),
    'merge_training_cycles_from_push is service_role only'
);
SELECT ok(
    NOT has_function_privilege('anon', 'public.upsert_training_cycle_lww(jsonb)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.upsert_training_cycle_lww(jsonb)', 'EXECUTE')
    AND has_function_privilege('service_role', 'public.upsert_training_cycle_lww(jsonb)', 'EXECUTE'),
    'upsert_training_cycle_lww is service_role only'
);
SELECT ok(
    NOT has_function_privilege('anon', 'public.stamp_training_cycle_portal_edit()', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.stamp_training_cycle_portal_edit()', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.stamp_training_cycle_portal_edit_from_day()', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.stamp_training_cycle_portal_edit_from_day()', 'EXECUTE'),
    'the stamp trigger functions are not executable by browser roles'
);

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
INSERT INTO auth.users (id, email)
VALUES
    ('18181818-0000-4000-8000-000000000001'::uuid, 'cycle-merge-owner@example.test'),
    ('18181818-0000-4000-8000-000000000002'::uuid, 'cycle-merge-other@example.test')
ON CONFLICT (id) DO NOTHING;

-- Portal cycle writes need EMBER (RLS).
INSERT INTO public.subscriptions (user_id, tier, status, current_period_end)
VALUES ('18181818-0000-4000-8000-000000000001'::uuid, 'EMBER', 'active', '2099-01-01+00');

INSERT INTO public.routines (id, user_id, name)
VALUES
    ('18181818-0000-4000-8000-0000000000a1'::uuid, '18181818-0000-4000-8000-000000000001'::uuid, 'R1'),
    ('18181818-0000-4000-8000-0000000000a2'::uuid, '18181818-0000-4000-8000-000000000001'::uuid, 'R2'),
    ('18181818-0000-4000-8000-0000000000a9'::uuid, '18181818-0000-4000-8000-000000000002'::uuid, 'Other user');

-- Written as postgres with no request claims (a migration / cron).
INSERT INTO public.training_cycles (
    id, user_id, name, description, duration_weeks, workout_days, rest_days,
    status, progression_settings, deload_settings, updated_at, portal_edited_at
) VALUES
    -- c1: portal-authored config, portal edit at .1234
    ('18181818-0000-4000-8000-0000000000c1'::uuid, '18181818-0000-4000-8000-000000000001'::uuid,
     'Portal name', '', 8, 4, 0, 'draft',
     '{"frequencyCycles":"1","portalOnly":true}', '{"week":4}',
     '2026-01-10 00:00:00.1234+00', '2026-01-10 00:00:00.1234+00'),
    -- c2: never portal-edited (no-op / legacy cases)
    ('18181818-0000-4000-8000-0000000000c2'::uuid, '18181818-0000-4000-8000-000000000001'::uuid,
     'Phone cycle', '', 1, 2, 0, 'draft', NULL, NULL,
     '2026-01-01 00:00:00+00', NULL),
    -- c3: legacy day cleanup
    ('18181818-0000-4000-8000-0000000000c3'::uuid, '18181818-0000-4000-8000-000000000001'::uuid,
     'Legacy', '', 1, 4, 0, 'draft', NULL, NULL,
     '2026-01-01 00:00:00+00', NULL);

INSERT INTO public.cycle_days (cycle_id, day_number, routine_id, rest_type)
SELECT '18181818-0000-4000-8000-0000000000c1'::uuid, n,
       '18181818-0000-4000-8000-0000000000a1'::uuid,
       CASE WHEN n = 2 THEN 'active_recovery' END
FROM generate_series(1, 4) AS n;
INSERT INTO public.cycle_days (cycle_id, day_number, routine_id)
SELECT '18181818-0000-4000-8000-0000000000c2'::uuid, n, '18181818-0000-4000-8000-0000000000a1'::uuid
FROM generate_series(1, 2) AS n;
INSERT INTO public.cycle_days (cycle_id, day_number)
SELECT '18181818-0000-4000-8000-0000000000c3'::uuid, n FROM generate_series(1, 4) AS n;

SELECT diag('database:cycle-merge-stamping');

SELECT is(
    (SELECT portal_edited_at FROM public.training_cycles WHERE id = '18181818-0000-4000-8000-0000000000c2'),
    NULL,
    'a write without request claims (migration, cron) does not stamp portal_edited_at'
);

-- Service-role request (an Edge push): no stamp.
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
UPDATE public.training_cycles SET current_week = 2
WHERE id = '18181818-0000-4000-8000-0000000000c2';
SELECT is(
    (SELECT portal_edited_at FROM public.training_cycles WHERE id = '18181818-0000-4000-8000-0000000000c2'),
    NULL,
    'a service-role update does not stamp portal_edited_at'
);

-- Portal request (authenticated) with the backfill GUC on: no stamp.
SET LOCAL ROLE authenticated;
SELECT set_config(
    'request.jwt.claims',
    '{"sub":"18181818-0000-4000-8000-000000000001","role":"authenticated"}',
    true
);
SELECT set_config('phoenix.skip_updated_at', 'on', true);
UPDATE public.training_cycles SET current_week = 3
WHERE id = '18181818-0000-4000-8000-0000000000c2';
SELECT set_config('phoenix.skip_updated_at', 'off', true);
RESET ROLE;
SELECT is(
    (SELECT portal_edited_at FROM public.training_cycles WHERE id = '18181818-0000-4000-8000-0000000000c2'),
    NULL,
    'phoenix.skip_updated_at = on suppresses the stamp'
);

-- Portal day edit stamps the parent cycle.
SET LOCAL ROLE authenticated;
UPDATE public.cycle_days SET notes = 'portal note'
WHERE cycle_id = '18181818-0000-4000-8000-0000000000c3' AND day_number = 1;
RESET ROLE;
SELECT is(
    (SELECT portal_edited_at FROM public.training_cycles WHERE id = '18181818-0000-4000-8000-0000000000c3'),
    now(),
    'an authenticated cycle_days update stamps the parent cycle'
);
SELECT is(
    (SELECT updated_at FROM public.training_cycles WHERE id = '18181818-0000-4000-8000-0000000000c3'),
    now(),
    'the parent stamp also advances updated_at (pull cursor)'
);

-- Portal cycle insert: stamped, and updated_at is never older than the stamp.
SET LOCAL ROLE authenticated;
INSERT INTO public.training_cycles (id, user_id, name, updated_at)
VALUES ('18181818-0000-4000-8000-0000000000c5'::uuid,
        '18181818-0000-4000-8000-000000000001'::uuid, 'Portal new', '2020-01-01+00');
RESET ROLE;
SELECT results_eq(
    $sql$ SELECT portal_edited_at, updated_at FROM public.training_cycles
          WHERE id = '18181818-0000-4000-8000-0000000000c5' $sql$,
    $values$ VALUES (now(), now()) $values$,
    'an authenticated insert stamps portal_edited_at and lifts updated_at to it'
);

-- Back to a service-role request for the merge calls.
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
-- Reset c3's stamp for the legacy case below (as a migration would).
UPDATE public.training_cycles SET portal_edited_at = NULL
WHERE id = '18181818-0000-4000-8000-0000000000c3';

SELECT diag('database:cycle-merge-stale');

-- Stale: the device's base predates the portal edit. Structure ignored,
-- config merged.
SELECT results_eq(
    $sql$
      SELECT accepted, structure_applied
      FROM public.merge_training_cycles_from_push(
        '18181818-0000-4000-8000-000000000001',
        '[{"id":"18181818-0000-4000-8000-0000000000c1","name":"Phone name","description":"",
           "duration_weeks":1,"workout_days":3,"rest_days":0,"current_week":1,"status":"draft",
           "progression_settings":{"frequencyCycles":"3"},"deload_settings":null,
           "base_updated_at":"2026-01-09T00:00:00Z",
           "days":[{"day_number":1,"routine_id":"18181818-0000-4000-8000-0000000000a2"},
                   {"day_number":2},{"day_number":3}]}]',
        false)
    $sql$,
    $values$ VALUES (true, false) $values$,
    'a stale push is accepted with its structure not applied'
);
SELECT results_eq(
    $sql$ SELECT name, workout_days, duration_weeks, deload_settings, progression_settings
          FROM public.training_cycles WHERE id = '18181818-0000-4000-8000-0000000000c1' $sql$,
    $values$ VALUES ('Portal name'::text, 4, 8, '{"week":4}'::jsonb,
                     '{"frequencyCycles":"3","portalOnly":true}'::jsonb) $values$,
    'stale: name and counts kept, derived duration kept, deload kept, progression merged'
);
SELECT results_eq(
    $sql$ SELECT day_number, routine_id, rest_type FROM public.cycle_days
          WHERE cycle_id = '18181818-0000-4000-8000-0000000000c1' ORDER BY day_number $sql$,
    $values$ VALUES
      (1, '18181818-0000-4000-8000-0000000000a1'::uuid, NULL::text),
      (2, '18181818-0000-4000-8000-0000000000a1'::uuid, 'active_recovery'),
      (3, '18181818-0000-4000-8000-0000000000a1'::uuid, NULL),
      (4, '18181818-0000-4000-8000-0000000000a1'::uuid, NULL) $values$,
    'stale: the day list is untouched'
);
SELECT is(
    (SELECT portal_edited_at FROM public.training_cycles WHERE id = '18181818-0000-4000-8000-0000000000c1'),
    '2026-01-10 00:00:00.1234+00'::timestamptz,
    'a service-role merge never stamps portal_edited_at'
);

SELECT diag('database:cycle-merge-current-base');

-- Current base truncated to milliseconds (.123 vs stored .1234): current.
SELECT results_eq(
    $sql$
      SELECT accepted, structure_applied, server_updated_at = now()
      FROM public.merge_training_cycles_from_push(
        '18181818-0000-4000-8000-000000000001',
        '[{"id":"18181818-0000-4000-8000-0000000000c1","name":"Phone name","description":"",
           "duration_weeks":1,"workout_days":3,"rest_days":0,"current_week":1,"status":"draft",
           "progression_settings":null,"deload_settings":null,
           "base_updated_at":"2026-01-10T00:00:00.123Z",
           "days":[{"day_number":1,"routine_id":"18181818-0000-4000-8000-0000000000a2"},
                   {"day_number":2,"rest_type":null},
                   {"day_number":4,"routine_id":"18181818-0000-4000-8000-0000000000a9"}]}]',
        false)
    $sql$,
    $values$ VALUES (true, true, true) $values$,
    'a millisecond-truncated base equal to the stored version counts as current'
);
SELECT results_eq(
    $sql$ SELECT name, workout_days, duration_weeks, deload_settings, progression_settings
          FROM public.training_cycles WHERE id = '18181818-0000-4000-8000-0000000000c1' $sql$,
    $values$ VALUES ('Phone name'::text, 3, 8, '{"week":4}'::jsonb,
                     '{"frequencyCycles":"3","portalOnly":true}'::jsonb) $values$,
    'current: structure applied, null deload/progression keep the stored values'
);
SELECT results_eq(
    $sql$ SELECT day_number, routine_id, rest_type FROM public.cycle_days
          WHERE cycle_id = '18181818-0000-4000-8000-0000000000c1' ORDER BY day_number $sql$,
    $values$ VALUES
      (1, '18181818-0000-4000-8000-0000000000a2'::uuid, NULL::text),
      (2, NULL::uuid, 'active_recovery'),
      (4, NULL::uuid, NULL) $values$,
    'current: day 3 (not in the payload) deleted, rest_type kept, foreign routine written as NULL'
);

SELECT diag('database:cycle-merge-legacy-and-noop');

-- Legacy (no base): only days above the payload max are deleted.
SELECT results_eq(
    $sql$
      SELECT accepted, structure_applied
      FROM public.merge_training_cycles_from_push(
        '18181818-0000-4000-8000-000000000001',
        '[{"id":"18181818-0000-4000-8000-0000000000c3","name":"Legacy","description":"",
           "duration_weeks":1,"workout_days":2,"rest_days":0,"current_week":1,"status":"draft",
           "days":[{"day_number":1},{"day_number":2}, {"day_number":4}]}]',
        false)
    $sql$,
    $values$ VALUES (true, true) $values$,
    'a legacy push is applied'
);
SELECT results_eq(
    $sql$ SELECT day_number FROM public.cycle_days
          WHERE cycle_id = '18181818-0000-4000-8000-0000000000c3' ORDER BY day_number $sql$,
    $values$ VALUES (1), (2), (3), (4) $values$,
    'legacy: a removed middle day is kept (only > max is deleted)'
);
SELECT lives_ok(
    $sql$
      SELECT * FROM public.merge_training_cycles_from_push(
        '18181818-0000-4000-8000-000000000001',
        '[{"id":"18181818-0000-4000-8000-0000000000c3","name":"Legacy","description":"",
           "duration_weeks":1,"workout_days":2,"rest_days":0,"current_week":1,"status":"draft",
           "days":[{"day_number":1},{"day_number":2}]}]',
        false)
    $sql$,
    'legacy push with a lower max'
);
SELECT results_eq(
    $sql$ SELECT day_number FROM public.cycle_days
          WHERE cycle_id = '18181818-0000-4000-8000-0000000000c3' ORDER BY day_number $sql$,
    $values$ VALUES (1), (2) $values$,
    'legacy: days above the payload max are deleted'
);

-- No-op: c2 pushed exactly as stored leaves updated_at alone. Pin a known
-- past updated_at first (cycles_updated_at would rewrite it to now()).
ALTER TABLE public.training_cycles DISABLE TRIGGER cycles_updated_at;
UPDATE public.training_cycles SET updated_at = '2026-01-01 00:00:00+00'
WHERE id = '18181818-0000-4000-8000-0000000000c2';
ALTER TABLE public.training_cycles ENABLE TRIGGER cycles_updated_at;
SELECT results_eq(
    $sql$
      SELECT accepted, server_updated_at
      FROM public.merge_training_cycles_from_push(
        '18181818-0000-4000-8000-000000000001',
        '[{"id":"18181818-0000-4000-8000-0000000000c2","name":"Phone cycle","description":"",
           "duration_weeks":1,"workout_days":2,"rest_days":0,"current_week":3,"status":"draft",
           "updated_at":"2026-01-01T00:00:00Z",
           "days":[{"day_number":1,"routine_id":"18181818-0000-4000-8000-0000000000a1"},
                   {"day_number":2,"routine_id":"18181818-0000-4000-8000-0000000000a1"}]}]',
        true)
    $sql$,
    $values$ VALUES (true, '2026-01-01 00:00:00+00'::timestamptz) $values$,
    'an unchanged push is accepted and leaves updated_at unchanged'
);

-- A day-only change bumps the parent's updated_at.
SELECT results_eq(
    $sql$
      SELECT accepted, server_updated_at = now()
      FROM public.merge_training_cycles_from_push(
        '18181818-0000-4000-8000-000000000001',
        '[{"id":"18181818-0000-4000-8000-0000000000c2","name":"Phone cycle","description":"",
           "duration_weeks":1,"workout_days":2,"rest_days":0,"current_week":3,"status":"draft",
           "updated_at":"2026-01-01T00:00:00Z",
           "days":[{"day_number":1,"routine_id":"18181818-0000-4000-8000-0000000000a2"},
                   {"day_number":2,"routine_id":"18181818-0000-4000-8000-0000000000a1"}]}]',
        false)
    $sql$,
    $values$ VALUES (true, true) $values$,
    'a day-only change advances the parent updated_at'
);

SELECT diag('database:cycle-merge-lww-and-ownership');

SELECT results_eq(
    $sql$
      SELECT accepted, server_updated_at = now()
      FROM public.merge_training_cycles_from_push(
        '18181818-0000-4000-8000-000000000001',
        '[{"id":"18181818-0000-4000-8000-0000000000c2","name":"Older","description":"",
           "updated_at":"2020-01-01T00:00:00Z","days":[]}]',
        true)
    $sql$,
    $values$ VALUES (false, true) $values$,
    'LWW on: an older updated_at is rejected with the stored version'
);
SELECT is(
    (SELECT name FROM public.training_cycles WHERE id = '18181818-0000-4000-8000-0000000000c2'),
    'Phone cycle',
    'LWW rejection writes nothing'
);
SELECT results_eq(
    $sql$
      SELECT accepted FROM public.merge_training_cycles_from_push(
        '18181818-0000-4000-8000-000000000002',
        '[{"id":"18181818-0000-4000-8000-0000000000c2","name":"Hijack","description":"","days":[]}]',
        false)
    $sql$,
    $values$ VALUES (false) $values$,
    'a cycle owned by another user is refused'
);
SELECT is(
    (SELECT count(*)::int FROM public.cycle_days WHERE cycle_id = '18181818-0000-4000-8000-0000000000c2'),
    2,
    'the refused merge touched no days'
);

SELECT diag('database:cycle-merge-insert-and-wrapper');

SELECT results_eq(
    $sql$
      SELECT accepted, structure_applied, server_updated_at
      FROM public.merge_training_cycles_from_push(
        '18181818-0000-4000-8000-000000000001',
        '[{"id":"18181818-0000-4000-8000-0000000000c6","user_id":"18181818-0000-4000-8000-000000000002",
           "name":"New","description":"","duration_weeks":1,"workout_days":1,"rest_days":0,
           "current_week":1,"status":"draft","updated_at":"2026-02-01T00:00:00Z",
           "days":[{"day_number":1,"routine_id":"18181818-0000-4000-8000-0000000000a1","rest_type":"full"}]}]',
        false)
    $sql$,
    $values$ VALUES (true, true, '2026-02-01 00:00:00+00'::timestamptz) $values$,
    'a new cycle is inserted with the pushed updated_at'
);
SELECT results_eq(
    $sql$ SELECT c.user_id, d.day_number, d.routine_id, d.rest_type
          FROM public.training_cycles c JOIN public.cycle_days d ON d.cycle_id = c.id
          WHERE c.id = '18181818-0000-4000-8000-0000000000c6' $sql$,
    $values$ VALUES ('18181818-0000-4000-8000-000000000001'::uuid, 1,
                     '18181818-0000-4000-8000-0000000000a1'::uuid, 'full'::text) $values$,
    'the insert is owned by p_user_id (payload user_id ignored) with its day'
);

SELECT results_eq(
    $sql$
      SELECT id, accepted FROM public.upsert_training_cycle_lww(
        '[{"id":"18181818-0000-4000-8000-0000000000c1","user_id":"18181818-0000-4000-8000-000000000001",
           "name":"Wrapper","description":"","duration_weeks":1,"workout_days":3,"rest_days":0,
           "current_week":1,"status":"draft","deload_settings":null,
           "updated_at":"2099-01-01T00:00:00Z"}]')
    $sql$,
    $values$ VALUES ('18181818-0000-4000-8000-0000000000c1'::text, true) $values$,
    'upsert_training_cycle_lww delegates to the merge'
);
SELECT results_eq(
    $sql$ SELECT name, deload_settings,
                 (SELECT count(*)::int FROM public.cycle_days
                  WHERE cycle_id = '18181818-0000-4000-8000-0000000000c1')
          FROM public.training_cycles WHERE id = '18181818-0000-4000-8000-0000000000c1' $sql$,
    $values$ VALUES ('Wrapper'::text, '{"week":4}'::jsonb, 3) $values$,
    'the wrapper keeps deload and leaves days to the caller'
);

SELECT * FROM finish();
ROLLBACK;
