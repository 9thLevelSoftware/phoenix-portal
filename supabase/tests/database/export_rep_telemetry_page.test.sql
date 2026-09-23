-- 20260925200000 section 9: the GDPR export pages rep_telemetry by set, and
-- yields exactly the view's rows.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;

SELECT plan(6);

INSERT INTO auth.users (id, email) VALUES
    ('29290000-0000-4000-8000-000000000001'::uuid, 'export-pages@example.test'),
    ('29290000-0000-4000-8000-000000000002'::uuid, 'export-pages-other@example.test')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.workout_sessions (id, user_id) VALUES
    ('29290000-0001-4000-8000-000000000001', '29290000-0000-4000-8000-000000000001');
INSERT INTO public.exercises (id, session_id, name, user_id) VALUES
    ('29290000-0002-4000-8000-000000000001', '29290000-0001-4000-8000-000000000001', 'Row',
     '29290000-0000-4000-8000-000000000001');
INSERT INTO public.sets (id, exercise_id, set_number, user_id)
SELECT ('29290000-0003-4000-8000-00000000000' || n)::uuid,
       '29290000-0002-4000-8000-000000000001', n, '29290000-0000-4000-8000-000000000001'
FROM generate_series(1, 4) AS n;

-- Three folded sets with 3, 1 and 2 samples, and one unfolded legacy set.
INSERT INTO public.set_telemetry
    (set_id, user_id, sample_count, ids, timestamp_ms, force_n, velocity_mps, position_mm, cable)
SELECT ('29290000-0003-4000-8000-00000000000' || s)::uuid,
       '29290000-0000-4000-8000-000000000001', k,
       array_agg(('29290000-0004-4000-8000-0000000' || s || lpad(i::text, 4, '0'))::uuid ORDER BY i),
       array_agg((i * 10)::bigint ORDER BY i), array_agg(i::numeric ORDER BY i),
       array_agg(NULL::numeric ORDER BY i), array_agg(NULL::numeric ORDER BY i),
       array_agg(NULL::text ORDER BY i)
FROM (VALUES (1, 3), (2, 1), (3, 2)) AS v(s, k)
CROSS JOIN LATERAL generate_series(1, v.k) AS i
GROUP BY s, k;
INSERT INTO public.rep_telemetry_legacy (id, set_id, user_id, timestamp_ms, force_n) VALUES
    ('29290000-0005-4000-8000-000000000001', '29290000-0003-4000-8000-000000000004',
     '29290000-0000-4000-8000-000000000001', 20, 2),
    ('29290000-0005-4000-8000-000000000002', '29290000-0003-4000-8000-000000000004',
     '29290000-0000-4000-8000-000000000001', 10, 1);

SELECT ok(
    has_function_privilege('service_role', 'public.export_rep_telemetry_page(uuid, uuid, integer)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.export_rep_telemetry_page(uuid, uuid, integer)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.export_rep_telemetry_page(uuid, uuid, integer)', 'EXECUTE'),
    'service-role only'
);

-- Drain page by page, as the exporter does, with a given target.
CREATE FUNCTION pg_temp.drain(p_target integer)
RETURNS TABLE(page integer, id uuid, set_id uuid, timestamp_ms bigint, force_n numeric, user_id uuid)
LANGUAGE plpgsql AS $$
DECLARE
  v_after uuid := NULL;
  v_page integer := 0;
  v_last uuid;
BEGIN
  LOOP
    v_page := v_page + 1;
    v_last := NULL;
    FOR id, set_id, timestamp_ms, force_n, user_id IN
      SELECT e.id, e.set_id, e.timestamp_ms, e.force_n, e.user_id
        FROM public.export_rep_telemetry_page('29290000-0000-4000-8000-000000000001', v_after, p_target) e
    LOOP
      page := v_page;
      v_last := set_id;
      RETURN NEXT;
    END LOOP;
    EXIT WHEN v_last IS NULL;
    v_after := v_last;
  END LOOP;
END;
$$;

SELECT set_eq(
    $sql$ SELECT id, set_id, timestamp_ms, force_n, user_id FROM pg_temp.drain(1000) $sql$,
    $sql$ SELECT id, set_id, timestamp_ms, force_n, user_id FROM public.rep_telemetry
           WHERE user_id = '29290000-0000-4000-8000-000000000001' $sql$,
    'the paged export yields exactly the view rows (both stores), each once'
);
SELECT is(
    (SELECT count(*)::int FROM pg_temp.drain(1)),
    (SELECT count(*)::int FROM public.rep_telemetry WHERE user_id = '29290000-0000-4000-8000-000000000001'),
    'no row is duplicated or dropped at any page size'
);
SELECT is(
    (SELECT max(page) FROM pg_temp.drain(1)),
    4,
    'with a one-row target there is one page per set, not per sample (8 samples, 4 sets)'
);
SELECT is(
    (SELECT max(page) FROM pg_temp.drain(1000)),
    1,
    'every set fits one page at the default target'
);
SELECT is_empty(
    $sql$ SELECT 1 FROM public.export_rep_telemetry_page('29290000-0000-4000-8000-000000000002', NULL, 1000) $sql$,
    'another account sees none of these rows'
);

SELECT * FROM finish();
ROLLBACK;
