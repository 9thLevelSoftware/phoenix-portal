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
-- Portal cycle writes need FLAME (RLS).
INSERT INTO public.subscriptions (user_id, tier, status, current_period_end)
VALUES ('18181818-0000-4000-8000-000000000001'::uuid, 'FLAME', 'active', '2099-01-01+00');

INSERT INTO public.routines (id, user_id, name)
VALUES
    ('18181818-0000-4000-8000-0000000000a1'::uuid, '18181818-0000-4000-8000-000000000001'::uuid, 'R1'),
    ('18181818-0000-4000-8000-0000000000a2'::uuid, '18181818-0000-4000-8000-000000000001'::uuid, 'R2'),
    ('18181818-0000-4000-8000-0000000000a9'::uuid, '18181818-0000-4000-8000-000000000002'::uuid, 'Other user');

-- Written as postgres with no request claims (a migration / cron).
INSERT INTO public.training_cycles (
    id, user_id, name, description, duration_weeks, workout_days, rest_days,
    status, progression_settings, deload_settings, updated_at, portal_edited_at,
    portal_duration_set_at
) VALUES
    -- c1: portal-authored config, portal edit at .1234
    ('18181818-0000-4000-8000-0000000000c1'::uuid, '18181818-0000-4000-8000-000000000001'::uuid,
     'Portal name', '', 8, 4, 0, 'draft',
     '{"frequencyCycles":"1","portalOnly":"yes"}', '{"week":4}',
     '2026-01-10 00:00:00.1234+00', '2026-01-10 00:00:00.1234+00',
     '2026-01-10 00:00:00.1234+00'),
    -- c2: never portal-edited (no-op / legacy cases)
    ('18181818-0000-4000-8000-0000000000c2'::uuid, '18181818-0000-4000-8000-000000000001'::uuid,
     'Phone cycle', '', 1, 2, 0, 'draft', NULL, NULL,
     '2026-01-01 00:00:00+00', NULL, NULL),
    -- c3: legacy day cleanup
    ('18181818-0000-4000-8000-0000000000c3'::uuid, '18181818-0000-4000-8000-000000000001'::uuid,
     'Legacy', '', 1, 4, 0, 'draft', NULL, NULL,
     '2026-01-01 00:00:00+00', NULL, NULL);

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
                     '{"frequencyCycles":"1","portalOnly":"yes"}'::jsonb) $values$,
    'stale: name and counts kept, derived duration kept, deload kept, progression untouched (PR 19 R-10)'
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
                     '{"frequencyCycles":"1","portalOnly":"yes"}'::jsonb) $values$,
    'current: structure applied, null deload kept, null progression keeps the stored keys (PR 19 R-10)'
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
    $values$ VALUES (true, true, now()) $values$,
    'a new cycle is inserted with the server clock as updated_at (NF-12, PR 21)'
);
SELECT is(
    (SELECT client_updated_at FROM public.training_cycles
     WHERE id = '18181818-0000-4000-8000-0000000000c6'),
    '2026-02-01 00:00:00+00'::timestamptz,
    'the pushed updated_at is stored as the LWW key (PR 21)'
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

-- ---------------------------------------------------------------------------
-- Review round 1 (R-3, R-4, R-6, R-7, R-9, R-10, R-13, R-14)
-- ---------------------------------------------------------------------------
SELECT diag('database:cycle-merge-review-round-1');

SELECT ok(
    NOT (SELECT prosecdef FROM pg_proc
         WHERE oid = 'public.stamp_training_cycle_portal_edit()'::regprocedure),
    'the cycle stamp trigger function is SECURITY INVOKER (R-14)'
);

-- Fixtures (as postgres, no claims: nothing is stamped).
SELECT set_config('request.jwt.claims', '', true);
INSERT INTO public.subscriptions (user_id, tier, status, current_period_end)
VALUES ('18181818-0000-4000-8000-000000000002'::uuid, 'EMBER', 'active', '2099-01-01+00');
VALUES ('18181818-0000-4000-8000-000000000002'::uuid, 'FLAME', 'active', '2099-01-01+00');
INSERT INTO public.routines (id, user_id, name)
VALUES ('18181818-0000-4000-8000-0000000000a3'::uuid, '18181818-0000-4000-8000-000000000001'::uuid, 'R3');
INSERT INTO public.training_cycles (id, user_id, name, description, duration_weeks, workout_days,
                                    status, progression_settings, template_id, updated_at)
VALUES
    -- m1: mobile-created (never portal-edited), 7 days / 1 week
    ('18181818-0000-4000-8000-0000000000d1'::uuid, '18181818-0000-4000-8000-000000000001'::uuid,
     'Mobile grows', '', 1, 7, 'draft', NULL, NULL, '2026-01-01+00'),
    -- m2: mobile-created, progression with echo on plus a portal-only key,
    --     a template, and a rest day
    ('18181818-0000-4000-8000-0000000000d2'::uuid, '18181818-0000-4000-8000-000000000001'::uuid,
     'Progression', '', 1, 1, 'draft',
     '{"frequencyCycles":"2","echoLevelIncrease":"true","weightIncreasePercent":"2.5","portalKey":"keep"}',
     'tpl', '2026-01-01+00'),
    -- s1..s3: portal-stamping targets (owner)
    ('18181818-0000-4000-8000-0000000000d3'::uuid, '18181818-0000-4000-8000-000000000001'::uuid,
     'Stamp insert', '', 1, 1, 'draft', NULL, NULL, '2026-01-01+00'),
    ('18181818-0000-4000-8000-0000000000d4'::uuid, '18181818-0000-4000-8000-000000000001'::uuid,
     'Stamp delete', '', 1, 2, 'draft', NULL, NULL, '2026-01-01+00'),
    ('18181818-0000-4000-8000-0000000000d5'::uuid, '18181818-0000-4000-8000-000000000001'::uuid,
     'Portal RPC', '', 1, 1, 'draft', NULL, NULL, '2026-01-01+00'),
    -- owner cycle and another user's cycle, both with a day on routine a3
    ('18181818-0000-4000-8000-0000000000d6'::uuid, '18181818-0000-4000-8000-000000000001'::uuid,
     'Owner uses R3', '', 1, 1, 'draft', NULL, NULL, '2026-01-01+00'),
    ('18181818-0000-4000-8000-0000000000d7'::uuid, '18181818-0000-4000-8000-000000000002'::uuid,
     'Other user uses R3', '', 1, 1, 'draft', NULL, NULL, '2026-01-01+00');
INSERT INTO public.cycle_days (cycle_id, day_number, day_type, rest_type)
SELECT '18181818-0000-4000-8000-0000000000d1'::uuid, n, 'workout', NULL FROM generate_series(1, 7) AS n;
INSERT INTO public.cycle_days (cycle_id, day_number, day_type, rest_type)
VALUES ('18181818-0000-4000-8000-0000000000d2'::uuid, 1, 'rest', 'active_recovery'),
       ('18181818-0000-4000-8000-0000000000d4'::uuid, 1, 'workout', NULL),
       ('18181818-0000-4000-8000-0000000000d4'::uuid, 2, 'workout', NULL);
INSERT INTO public.cycle_days (cycle_id, day_number, routine_id)
VALUES ('18181818-0000-4000-8000-0000000000d6'::uuid, 1, '18181818-0000-4000-8000-0000000000a3'::uuid),
       ('18181818-0000-4000-8000-0000000000d7'::uuid, 1, '18181818-0000-4000-8000-0000000000a3'::uuid);
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);

-- R-3: a mobile-created cycle follows the phone's derived duration.
SELECT lives_ok(
    $sql$
      SELECT * FROM public.merge_training_cycles_from_push(
        '18181818-0000-4000-8000-000000000001',
        (SELECT jsonb_build_array(jsonb_build_object(
           'id', '18181818-0000-4000-8000-0000000000d1', 'name', 'Mobile grows',
           'description', '', 'duration_weeks', 2, 'workout_days', 14, 'rest_days', 0,
           'current_week', 1, 'status', 'draft', 'updated_at', '2099-01-01T00:00:00Z',
           'days', (SELECT jsonb_agg(jsonb_build_object('day_number', n, 'day_type', 'workout'))
                    FROM generate_series(1, 14) AS n)))),
        false)
    $sql$,
    'mobile grows a never-portal-edited cycle to 14 days (LWW off)'
);
SELECT is(
    (SELECT duration_weeks FROM public.training_cycles WHERE id = '18181818-0000-4000-8000-0000000000d1'),
    2,
    'R-3: a mobile-created cycle takes the derived duration (1 -> 2 weeks)'
);
SELECT lives_ok(
    $sql$
      SELECT * FROM public.merge_training_cycles_from_push(
        '18181818-0000-4000-8000-000000000001',
        (SELECT jsonb_build_array(jsonb_build_object(
           'id', '18181818-0000-4000-8000-0000000000d1', 'name', 'Mobile grows',
           'description', '', 'duration_weeks', 3, 'workout_days', 21, 'rest_days', 0,
           'current_week', 1, 'status', 'draft', 'updated_at', '2099-01-01T00:00:00Z',
           'days', (SELECT jsonb_agg(jsonb_build_object('day_number', n, 'day_type', 'workout'))
                    FROM generate_series(1, 21) AS n)))),
        true)
    $sql$,
    'mobile grows it again to 21 days (LWW on)'
);
SELECT is(
    (SELECT duration_weeks FROM public.training_cycles WHERE id = '18181818-0000-4000-8000-0000000000d1'),
    3,
    'R-3: the derived duration is taken under LWW on as well'
);
-- (The portal-edited case, where a derived value keeps the stored 8 weeks,
-- is covered by the stale/current c1 assertions above.)

-- R-1: NULL duration/status/description keep the stored values.
SELECT lives_ok(
    $sql$
      SELECT * FROM public.merge_training_cycles_from_push(
        '18181818-0000-4000-8000-000000000001',
        '[{"id":"18181818-0000-4000-8000-0000000000d1","name":"Mobile grows",
           "description":null,"duration_weeks":null,"status":null,
           "workout_days":21,"rest_days":0,"current_week":1}]',
        false)
    $sql$,
    'a push with null duration/status/description'
);
SELECT results_eq(
    $sql$ SELECT duration_weeks, status, description FROM public.training_cycles
          WHERE id = '18181818-0000-4000-8000-0000000000d1' $sql$,
    $values$ VALUES (3, 'draft'::text, ''::text) $values$,
    'R-1: null duration, status and description keep the stored values'
);

-- R-4 / R-9 / R-6 on m2.
SELECT lives_ok(
    $sql$
      SELECT * FROM public.merge_training_cycles_from_push(
        '18181818-0000-4000-8000-000000000001',
        '[{"id":"18181818-0000-4000-8000-0000000000d2","name":"Progression","description":"",
           "duration_weeks":1,"workout_days":1,"rest_days":0,"current_week":1,"status":"draft",
           "progression_settings":{"frequencyCycles":"2"},"template_id":null,
           "days":[{"day_number":1,"day_type":"workout","rest_type":null}]}]',
        false)
    $sql$,
    'mobile turns echo increase off, clears the weight step, nulls template, flips day 1 to workout'
);
SELECT results_eq(
    $sql$ SELECT progression_settings, template_id FROM public.training_cycles
          WHERE id = '18181818-0000-4000-8000-0000000000d2' $sql$,
    $values$ VALUES ('{"frequencyCycles":"2","portalKey":"keep"}'::jsonb, 'tpl'::text) $values$,
    'R-4: cleared mobile keys stay cleared, the portal-only key survives; R-9: null template_id keeps the stored one'
);
SELECT results_eq(
    $sql$ SELECT day_type, rest_type FROM public.cycle_days
          WHERE cycle_id = '18181818-0000-4000-8000-0000000000d2' AND day_number = 1 $sql$,
    $values$ VALUES ('workout'::text, NULL::text) $values$,
    'R-6: a day switched from rest to workout drops its rest_type'
);
SELECT lives_ok(
    $sql$
      SELECT * FROM public.merge_training_cycles_from_push(
        '18181818-0000-4000-8000-000000000001',
        '[{"id":"18181818-0000-4000-8000-0000000000d2","name":"Progression","description":"",
           "duration_weeks":1,"workout_days":1,"rest_days":0,"current_week":1,"status":"draft",
           "progression_settings":null,"template_id":"tpl2",
           "days":[{"day_number":1,"day_type":"workout"}]}]',
        false)
    $sql$,
    'mobile pushes a null progression and sets a new template'
);
SELECT results_eq(
    $sql$ SELECT progression_settings, template_id FROM public.training_cycles
          WHERE id = '18181818-0000-4000-8000-0000000000d2' $sql$,
    $values$ VALUES ('{"frequencyCycles":"2","portalKey":"keep"}'::jsonb, 'tpl2'::text) $values$,
    'PR 19 R-10: a null progression keeps the stored mobile keys; R-9: a non-null template_id replaces'
);

-- R-7 / R-10: the real portal write paths, as the authenticated role.
SET LOCAL ROLE authenticated;
SELECT set_config(
    'request.jwt.claims',
    '{"sub":"18181818-0000-4000-8000-000000000001","role":"authenticated"}',
    true
);
-- PostgREST-style day INSERT on d3 and DELETE on d4.
INSERT INTO public.cycle_days (cycle_id, day_number)
VALUES ('18181818-0000-4000-8000-0000000000d3'::uuid, 2);
DELETE FROM public.cycle_days
WHERE cycle_id = '18181818-0000-4000-8000-0000000000d4'::uuid AND day_number = 2;
-- The portal's cycle save RPC on d5.
SELECT public.update_cycle_with_days(
    '18181818-0000-4000-8000-0000000000d5'::uuid, 'Saved on portal', '', 4, 2, 0, NULL,
    '{"frequencyCycles":"2"}'::jsonb, NULL,
    '[{"day_number":1,"day_type":"workout","weight_adjustment":0,"rep_modifier":0},
      {"day_number":2,"day_type":"workout","weight_adjustment":0,"rep_modifier":0}]'::jsonb
);
-- Owner deletes routine a3: ON DELETE SET NULL updates d6 (owner) and d7
-- (another user's cycle pointing at it).
DELETE FROM public.routines WHERE id = '18181818-0000-4000-8000-0000000000a3'::uuid;
RESET ROLE;

SELECT is(
    (SELECT portal_edited_at FROM public.training_cycles WHERE id = '18181818-0000-4000-8000-0000000000d3'),
    now(),
    'R-10: an authenticated day INSERT stamps the parent cycle'
);
SELECT is(
    (SELECT portal_edited_at FROM public.training_cycles WHERE id = '18181818-0000-4000-8000-0000000000d4'),
    now(),
    'R-10: an authenticated day DELETE stamps the parent cycle'
);
SELECT results_eq(
    $sql$ SELECT portal_edited_at, updated_at, portal_edited_at = updated_at
          FROM public.training_cycles WHERE id = '18181818-0000-4000-8000-0000000000d5' $sql$,
    $values$ VALUES (now(), now(), true) $values$,
    'R-7: update_cycle_with_days as authenticated stamps portal_edited_at = updated_at'
);
SELECT is(
    (SELECT portal_edited_at FROM public.training_cycles WHERE id = '18181818-0000-4000-8000-0000000000d6'),
    now(),
    'R-7: a portal routine delete (ON DELETE SET NULL) stamps the owner''s cycle that used it'
);
SELECT is(
    (SELECT portal_edited_at FROM public.training_cycles WHERE id = '18181818-0000-4000-8000-0000000000d7'),
    NULL,
    'R-13: the cascade never stamps another user''s cycle'
);

-- R-7: a base pulled right after the portal save (ms-truncated) is current.
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SELECT results_eq(
    format(
      $sql$
        SELECT structure_applied FROM public.merge_training_cycles_from_push(
          '18181818-0000-4000-8000-000000000001',
          jsonb_build_array(jsonb_build_object(
            'id', '18181818-0000-4000-8000-0000000000d5', 'name', 'Phone after pull',
            'description', '', 'duration_weeks', 4, 'workout_days', 2, 'rest_days', 0,
            'current_week', 1, 'status', 'draft',
            'base_updated_at', %L,
            'days', '[{"day_number":1,"day_type":"workout"},{"day_number":2,"day_type":"workout"}]'::jsonb)),
          false)
      $sql$,
      to_char(date_trunc('milliseconds', now()) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    ),
    $values$ VALUES (true) $values$,
    'R-7: a ms-truncated base equal to the portal save is current'
);

-- ---------------------------------------------------------------------------
-- Review round 2: duration is portal-owned only when set on the portal.
-- ---------------------------------------------------------------------------
SELECT diag('database:cycle-merge-review-round-2');

SELECT has_column(
    'public', 'training_cycles', 'portal_duration_set_at',
    'training_cycles.portal_duration_set_at exists'
);

-- Fixtures as postgres with no claims (no stamps): two phone-created cycles
-- of 7 days / 1 week, and one whose progression holds only mobile keys.
SELECT set_config('request.jwt.claims', '', true);
INSERT INTO public.training_cycles (id, user_id, name, description, duration_weeks, workout_days,
                                    status, progression_settings, updated_at)
VALUES
    ('18181818-0000-4000-8000-0000000000e1'::uuid, '18181818-0000-4000-8000-000000000001'::uuid,
     'Renamed on portal', '', 1, 7, 'draft', NULL, '2026-01-01+00'),
    ('18181818-0000-4000-8000-0000000000e2'::uuid, '18181818-0000-4000-8000-000000000001'::uuid,
     'Duration set on portal', '', 1, 7, 'draft', NULL, '2026-01-01+00'),
    ('18181818-0000-4000-8000-0000000000e3'::uuid, '18181818-0000-4000-8000-000000000001'::uuid,
     'Mobile keys only', '', 1, 0, 'draft',
     '{"frequencyCycles":"2","echoLevelIncrease":"true"}', '2026-01-01+00');
INSERT INTO public.cycle_days (cycle_id, day_number)
SELECT c, n
FROM unnest(ARRAY['18181818-0000-4000-8000-0000000000e1'::uuid,
                  '18181818-0000-4000-8000-0000000000e2'::uuid]) AS c,
     generate_series(1, 7) AS n;

-- Portal: rename e1 (duration untouched), set e2 to 6 weeks.
SET LOCAL ROLE authenticated;
SELECT set_config(
    'request.jwt.claims',
    '{"sub":"18181818-0000-4000-8000-000000000001","role":"authenticated"}',
    true
);
UPDATE public.training_cycles SET name = 'Renamed on portal!'
WHERE id = '18181818-0000-4000-8000-0000000000e1';
UPDATE public.training_cycles SET duration_weeks = 6
WHERE id = '18181818-0000-4000-8000-0000000000e2';
RESET ROLE;

SELECT results_eq(
    $sql$ SELECT id::text, portal_edited_at IS NOT NULL, portal_duration_set_at IS NOT NULL
          FROM public.training_cycles
          WHERE id IN ('18181818-0000-4000-8000-0000000000e1', '18181818-0000-4000-8000-0000000000e2')
          ORDER BY id $sql$,
    $values$ VALUES ('18181818-0000-4000-8000-0000000000e1', true, false),
                    ('18181818-0000-4000-8000-0000000000e2', true, true) $values$,
    'a portal rename stamps portal_edited_at only; a portal duration change also stamps portal_duration_set_at'
);

SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);

-- Phone grows e1 to 14 days (derived 2 weeks) and pushes e2's derived
-- default for its 7 days (1 week). No base: legacy structure rules.
SELECT lives_ok(
    $sql$
      SELECT * FROM public.merge_training_cycles_from_push(
        '18181818-0000-4000-8000-000000000001',
        (SELECT jsonb_build_array(
           jsonb_build_object(
             'id', '18181818-0000-4000-8000-0000000000e1', 'name', 'Renamed on portal!',
             'description', '', 'duration_weeks', 2, 'workout_days', 14, 'rest_days', 0,
             'current_week', 1, 'status', 'draft',
             'days', (SELECT jsonb_agg(jsonb_build_object('day_number', n, 'day_type', 'workout'))
                      FROM generate_series(1, 14) AS n)),
           jsonb_build_object(
             'id', '18181818-0000-4000-8000-0000000000e2', 'name', 'Duration set on portal',
             'description', '', 'duration_weeks', 1, 'workout_days', 7, 'rest_days', 0,
             'current_week', 1, 'status', 'draft',
             'days', (SELECT jsonb_agg(jsonb_build_object('day_number', n, 'day_type', 'workout'))
                      FROM generate_series(1, 7) AS n)))),
        false)
    $sql$,
    'phone pushes after the portal rename / duration edit'
);
SELECT results_eq(
    $sql$ SELECT id::text, duration_weeks FROM public.training_cycles
          WHERE id IN ('18181818-0000-4000-8000-0000000000e1', '18181818-0000-4000-8000-0000000000e2')
          ORDER BY id $sql$,
    $values$ VALUES ('18181818-0000-4000-8000-0000000000e1', 2),
                    ('18181818-0000-4000-8000-0000000000e2', 6) $values$,
    'a portal rename does not freeze duration (phone growth applies); a portal-set duration survives the derived default'
);

-- PR 19 R-10: a null progression keeps stored mobile-only keys.
SELECT lives_ok(
    $sql$
      SELECT * FROM public.merge_training_cycles_from_push(
        '18181818-0000-4000-8000-000000000001',
        '[{"id":"18181818-0000-4000-8000-0000000000e3","name":"Mobile keys only","description":"",
           "duration_weeks":1,"workout_days":0,"rest_days":0,"current_week":1,"status":"draft",
           "progression_settings":null,"days":[]}]',
        false)
    $sql$,
    'phone pushes a null progression'
);
SELECT is(
    (SELECT progression_settings FROM public.training_cycles
     WHERE id = '18181818-0000-4000-8000-0000000000e3'),
    '{"frequencyCycles":"2","echoLevelIncrease":"true"}'::jsonb,
    'a null progression over mobile-only keys keeps them (PR 19 R-10)'
);

SELECT * FROM finish();
ROLLBACK;
