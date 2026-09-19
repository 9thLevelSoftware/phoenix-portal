BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;

SELECT no_plan();

SELECT diag('database:routine-setting-vocabulary');

-- Same case table as tests/contract/routine-setting-vocabulary.test.ts
-- (SETTING_CASES); the TS normalizers and these SQL functions must agree.
CREATE TEMP TABLE setting_cases (fn TEXT, input TEXT, expected TEXT) ON COMMIT DROP;
INSERT INTO setting_cases (fn, input, expected) VALUES
  ('eccentric', NULL, NULL),
  ('eccentric', 'light', NULL),
  ('eccentric', 'moderate', NULL),
  ('eccentric', 'heavy', NULL),
  ('eccentric', '', NULL),
  ('eccentric', 'LOAD_120', 'LOAD_120'),
  ('eccentric', 'LOAD_0', 'LOAD_0'),
  ('eccentric', '120', 'LOAD_120'),
  ('eccentric', 'LOAD_+120', 'LOAD_120'),
  ('eccentric', 'LOAD_0120', 'LOAD_120'),
  ('eccentric', '4294967416', 'LOAD_120'),
  ('eccentric', 'load_120', NULL),
  ('eccentric', ' LOAD_120', NULL),
  ('eccentric', 'LOAD_120 ', NULL),
  ('eccentric', 'LOAD_', NULL),
  ('eccentric', '1.5', NULL),
  ('eccentric', '120abc', NULL),
  ('eccentric', '99999999999999999999', NULL),
  ('eccentric', 'LOAD_25', 'LOAD_25'),
  ('eccentric', '999', '999'),
  ('eccentric', '-5', '-5'),
  ('echo', NULL, NULL),
  ('echo', 'hard', 'HARD'),
  ('echo', 'Epic', 'EPIC'),
  ('echo', 'HARDER', 'HARDER'),
  ('echo', ' hard', NULL),
  ('echo', 'low', NULL),
  ('echo', 'medium', NULL),
  ('echo', 'high', NULL),
  ('echo', '', NULL),
  ('echo', 'MYTHIC', NULL),
  ('timing', 'TOP', 'TOP'),
  ('timing', 'BOTTOM', 'BOTTOM'),
  ('timing', 'top', NULL),
  ('timing', ' TOP', NULL),
  ('timing', '2-0-2', NULL),
  ('stop', 'TOP', 'TOP'),
  ('stop', 'BOTTOM', NULL),
  ('stop', 'top', NULL),
  ('stop', 'Lockout', NULL),
  ('colour', NULL, NULL),
  ('colour', 'indigo', 'indigo'),
  ('colour', 'Indigo', 'indigo'),
  ('colour', 'AMBER', 'amber'),
  ('colour', ' indigo', NULL),
  ('colour', '#6366F1', 'indigo'),
  ('colour', '#EC4899', 'pink'),
  ('colour', '#10B981', 'green'),
  ('colour', '#f59e0b', 'amber'),
  ('colour', '#123456', NULL),
  ('colour', 'purple', NULL),
  ('colour', '2', 'green'),
  ('colour', '+0', 'indigo'),
  ('colour', '7', '7'),
  ('colour', '-1', '-1');

SELECT is(
  CASE c.fn
    WHEN 'eccentric' THEN public.normalize_eccentric_load(c.input)
    WHEN 'echo' THEN public.normalize_echo_level(c.input)
    WHEN 'timing' THEN public.normalize_rep_count_timing(c.input)
    WHEN 'stop' THEN public.normalize_stop_at_position(c.input)
    WHEN 'colour' THEN public.normalize_superset_color(c.input)
  END,
  c.expected,
  format('%s(%L) = %L', c.fn, c.input, c.expected)
)
FROM setting_cases AS c;

INSERT INTO auth.users (id, email)
VALUES ('a2a2a2a2-0000-4000-8000-000000000011'::uuid, 'settings@example.test')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.routines (id, user_id, name)
VALUES (
    'a2a2a2a2-0000-4000-8000-000000000012'::uuid,
    'a2a2a2a2-0000-4000-8000-000000000011'::uuid,
    'Settings routine'
);

-- Trigger on insert: legacy portal values (as a pre-migration community
-- snapshot import would write them) become what the phone does.
INSERT INTO public.routine_exercises (
    id, routine_id, name, mode,
    eccentric_load, echo_level, rep_count_timing, stop_at_position, superset_color
)
VALUES (
    'a2a2a2a2-0000-4000-8000-000000000013'::uuid,
    'a2a2a2a2-0000-4000-8000-000000000012'::uuid,
    'Legacy', 'ECHO',
    'heavy', 'high', '2-0-2', 'Lockout', '#F59E0B'
);

SELECT results_eq(
    $$SELECT eccentric_load, echo_level, rep_count_timing, stop_at_position, superset_color
      FROM public.routine_exercises
      WHERE id = 'a2a2a2a2-0000-4000-8000-000000000013'::uuid$$,
    $$VALUES (NULL::TEXT, NULL::TEXT, NULL::TEXT, NULL::TEXT, 'amber'::TEXT)$$,
    'insert with legacy portal values stores the phone''s defaults and the colour name'
);

-- Values mobile itself writes are unchanged.
INSERT INTO public.routine_exercises (
    id, routine_id, name, mode,
    eccentric_load, echo_level, rep_count_timing, stop_at_position, superset_color
)
VALUES (
    'a2a2a2a2-0000-4000-8000-000000000014'::uuid,
    'a2a2a2a2-0000-4000-8000-000000000012'::uuid,
    'Mobile', 'ECHO',
    'LOAD_120', 'EPIC', 'BOTTOM', 'TOP', 'pink'
);

SELECT results_eq(
    $$SELECT eccentric_load, echo_level, rep_count_timing, stop_at_position, superset_color
      FROM public.routine_exercises
      WHERE id = 'a2a2a2a2-0000-4000-8000-000000000014'::uuid$$,
    $$VALUES ('LOAD_120'::TEXT, 'EPIC'::TEXT, 'BOTTOM'::TEXT, 'TOP'::TEXT, 'pink'::TEXT)$$,
    'insert with mobile vocabulary is a no-op'
);

-- Backfill statement from the migration: after the trigger has run, a
-- re-run changes 0 rows (idempotent).
ALTER TABLE public.routine_exercises DISABLE TRIGGER routine_exercises_normalize_settings;
UPDATE public.routine_exercises
SET echo_level = 'low', stop_at_position = 'BOTTOM', superset_color = '#6366F1'
WHERE id = 'a2a2a2a2-0000-4000-8000-000000000014'::uuid;
ALTER TABLE public.routine_exercises ENABLE TRIGGER routine_exercises_normalize_settings;

CREATE TEMP TABLE backfill_counts (pass INT, changed INT) ON COMMIT DROP;
DO $$
DECLARE
  v_pass INT;
  v_changed INT;
BEGIN
  FOR v_pass IN 1..2 LOOP
    UPDATE public.routine_exercises
    SET eccentric_load = public.normalize_eccentric_load(eccentric_load),
        echo_level = public.normalize_echo_level(echo_level),
        rep_count_timing = public.normalize_rep_count_timing(rep_count_timing),
        stop_at_position = public.normalize_stop_at_position(stop_at_position),
        superset_color = public.normalize_superset_color(superset_color)
    WHERE routine_id = 'a2a2a2a2-0000-4000-8000-000000000012'::uuid
      AND (eccentric_load IS DISTINCT FROM public.normalize_eccentric_load(eccentric_load)
        OR echo_level IS DISTINCT FROM public.normalize_echo_level(echo_level)
        OR rep_count_timing IS DISTINCT FROM public.normalize_rep_count_timing(rep_count_timing)
        OR stop_at_position IS DISTINCT FROM public.normalize_stop_at_position(stop_at_position)
        OR superset_color IS DISTINCT FROM public.normalize_superset_color(superset_color));
    GET DIAGNOSTICS v_changed = ROW_COUNT;
    INSERT INTO backfill_counts VALUES (v_pass, v_changed);
  END LOOP;
END;
$$;

SELECT results_eq(
    'SELECT pass, changed FROM backfill_counts ORDER BY pass',
    $$VALUES (1, 1), (2, 0)$$,
    'backfill rewrites the legacy row once and is a no-op on re-run'
);

SELECT results_eq(
    $$SELECT echo_level, stop_at_position, superset_color
      FROM public.routine_exercises
      WHERE id = 'a2a2a2a2-0000-4000-8000-000000000014'::uuid$$,
    $$VALUES (NULL::TEXT, NULL::TEXT, 'indigo'::TEXT)$$,
    'backfill maps low -> NULL, BOTTOM stop -> NULL, legacy hex -> name'
);

-- Grants (KD-3 rule 3b). The SECURITY INVOKER trigger calls the helpers as
-- the writing role.
SELECT ok(
    has_function_privilege('authenticated', 'public.normalize_eccentric_load(text)', 'EXECUTE')
    AND has_function_privilege('authenticated', 'public.normalize_superset_color(text)', 'EXECUTE')
    AND has_function_privilege('authenticated', 'public.kotlin_to_long_or_null(text)', 'EXECUTE'),
    'authenticated can execute the helpers (portal writes)'
);
SELECT ok(
    has_function_privilege('service_role', 'public.normalize_echo_level(text)', 'EXECUTE')
    AND has_function_privilege('service_role', 'public.normalize_stop_at_position(text)', 'EXECUTE')
    AND has_function_privilege('service_role', 'public.normalize_rep_count_timing(text)', 'EXECUTE'),
    'service_role can execute the helpers (mobile-sync-push writes)'
);
SELECT ok(
    NOT has_function_privilege('anon', 'public.normalize_eccentric_load(text)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.kotlin_to_long_or_null(text)', 'EXECUTE'),
    'anon cannot execute the helpers'
);
SELECT ok(
    NOT has_function_privilege('authenticated', 'public.routine_exercises_normalize_settings()', 'EXECUTE'),
    'authenticated cannot execute the trigger function directly'
);

-- A real SPA-shaped write: authenticated EMBER user through RLS.
INSERT INTO public.subscriptions (user_id, tier, status, current_period_end)
VALUES (
    'a2a2a2a2-0000-4000-8000-000000000011'::uuid,
    'EMBER',
    'active',
    now() + INTERVAL '30 days'
)
ON CONFLICT (user_id) DO UPDATE
SET tier = EXCLUDED.tier,
    status = EXCLUDED.status,
    current_period_end = EXCLUDED.current_period_end;

SET LOCAL ROLE authenticated;
SELECT set_config(
    'request.jwt.claims',
    '{"sub":"a2a2a2a2-0000-4000-8000-000000000011","role":"authenticated"}',
    true
);

INSERT INTO public.routine_exercises (id, routine_id, name, mode, eccentric_load, superset_color)
VALUES (
    'a2a2a2a2-0000-4000-8000-000000000015'::uuid,
    'a2a2a2a2-0000-4000-8000-000000000012'::uuid,
    'RLS', 'ECHO', '120', '#EC4899'
);

SELECT results_eq(
    $$SELECT eccentric_load, superset_color FROM public.routine_exercises
      WHERE id = 'a2a2a2a2-0000-4000-8000-000000000015'::uuid$$,
    $$VALUES ('LOAD_120'::TEXT, 'pink'::TEXT)$$,
    'authenticated insert through RLS runs the trigger'
);

RESET ROLE;
SELECT set_config('request.jwt.claims', '', true);

SET LOCAL ROLE service_role;
UPDATE public.routine_exercises
SET echo_level = 'hardest'
WHERE id = 'a2a2a2a2-0000-4000-8000-000000000015'::uuid;
RESET ROLE;

SELECT is(
    (SELECT echo_level FROM public.routine_exercises WHERE id = 'a2a2a2a2-0000-4000-8000-000000000015'::uuid),
    'HARDEST',
    'service_role update runs the trigger'
);

SELECT * FROM finish();

ROLLBACK;
