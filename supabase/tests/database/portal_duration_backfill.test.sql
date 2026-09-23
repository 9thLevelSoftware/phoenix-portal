-- 20260924130000: portal_duration_set_at backfill (port of e38321d2 /
-- 8aa731a2). The statement below mirrors the migration's; it must stay in
-- step with it.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;

SELECT no_plan();

INSERT INTO auth.users (id, email)
VALUES ('27272727-0000-4000-8000-000000000001'::uuid, 'duration-backfill@example.test')
ON CONFLICT (id) DO NOTHING;

-- As postgres with no JWT nothing is stamped; cycles_updated_at is off so the
-- fixtures keep their historical updated_at.
ALTER TABLE public.training_cycles DISABLE TRIGGER cycles_updated_at;
INSERT INTO public.training_cycles (id, user_id, name, duration_weeks, updated_at) VALUES
    ('27272727-0000-4000-8000-0000000000c1'::uuid, '27272727-0000-4000-8000-000000000001'::uuid,
     'Pre-marker cycle', 6, '2026-06-01T00:00:00Z'),
    ('27272727-0000-4000-8000-0000000000c2'::uuid, '27272727-0000-4000-8000-000000000001'::uuid,
     'Mobile cycle after the marker', 1, '2026-09-21T00:00:00Z');
UPDATE public.training_cycles SET portal_duration_set_at = NULL
 WHERE user_id = '27272727-0000-4000-8000-000000000001';

-- The migration's statement, run twice (idempotency).
UPDATE public.training_cycles
   SET portal_duration_set_at = updated_at
 WHERE portal_duration_set_at IS NULL
   AND updated_at < '2026-09-20T00:00:00Z'::timestamptz;
UPDATE public.training_cycles
   SET portal_duration_set_at = updated_at
 WHERE portal_duration_set_at IS NULL
   AND updated_at < '2026-09-20T00:00:00Z'::timestamptz;
ALTER TABLE public.training_cycles ENABLE TRIGGER cycles_updated_at;

SELECT results_eq(
    $sql$ SELECT id, portal_duration_set_at, updated_at FROM public.training_cycles
           WHERE user_id = '27272727-0000-4000-8000-000000000001' ORDER BY id $sql$,
    $values$ VALUES
      ('27272727-0000-4000-8000-0000000000c1'::uuid, '2026-06-01T00:00:00Z'::timestamptz, '2026-06-01T00:00:00Z'::timestamptz),
      ('27272727-0000-4000-8000-0000000000c2'::uuid, NULL::timestamptz, '2026-09-21T00:00:00Z'::timestamptz)
    $values$,
    'a pre-marker cycle is portal-owned, a later mobile cycle stays unmarked, updated_at never moves'
);

-- A legacy push of the derived default keeps the portal-set duration.
SELECT lives_ok(
    $sql$
      SELECT * FROM public.merge_training_cycles_from_push(
        '27272727-0000-4000-8000-000000000001',
        (SELECT jsonb_build_array(jsonb_build_object(
           'id', '27272727-0000-4000-8000-0000000000c1', 'name', 'Pre-marker cycle',
           'description', '', 'duration_weeks', 1, 'workout_days', 3, 'rest_days', 0,
           'current_week', 1, 'status', 'draft',
           'days', (SELECT jsonb_agg(jsonb_build_object('day_number', n, 'day_type', 'workout'))
                    FROM generate_series(1, 3) AS n)))),
        false)
    $sql$,
    'legacy push of the pre-marker cycle'
);
SELECT is(
    (SELECT duration_weeks FROM public.training_cycles
      WHERE id = '27272727-0000-4000-8000-0000000000c1'),
    6,
    'the backfilled cycle keeps its portal duration'
);

-- The unmarked mobile cycle still follows its own derived duration.
SELECT lives_ok(
    $sql$
      SELECT * FROM public.merge_training_cycles_from_push(
        '27272727-0000-4000-8000-000000000001',
        (SELECT jsonb_build_array(jsonb_build_object(
           'id', '27272727-0000-4000-8000-0000000000c2', 'name', 'Mobile cycle after the marker',
           'description', '', 'duration_weeks', 2, 'workout_days', 8, 'rest_days', 0,
           'current_week', 1, 'status', 'draft',
           'days', (SELECT jsonb_agg(jsonb_build_object('day_number', n, 'day_type', 'workout'))
                    FROM generate_series(1, 8) AS n)))),
        false)
    $sql$,
    'mobile grows its cycle to eight days'
);
SELECT is(
    (SELECT duration_weeks FROM public.training_cycles
      WHERE id = '27272727-0000-4000-8000-0000000000c2'),
    2,
    'a mobile-derived duration is not frozen'
);

SELECT * FROM finish();
ROLLBACK;
