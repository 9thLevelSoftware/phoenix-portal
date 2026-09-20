-- Server-derived gamification counters (20260920002500_server_derived_gamification.sql).
--
-- Pins who owns each counter: the derived ones follow the stored rows (a
-- crafted push cannot inflate them, a delete lowers them), the best-ever ones
-- never go down, and the device-owned ones follow the last-workout date the
-- write carried — not a server stamp (F-070).
--
-- Runs in CI with the rest of the suite (`supabase test db` in
-- .github/workflows/migrations.yml); locally: `npm run test:db`.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;

SELECT no_plan();

SELECT diag('database:gamification-derivation-catalog');

-- The add-only dashboard counter triggers are gone; their functions stay.
SELECT hasnt_trigger('public', 'workout_sessions', 'trg_update_profile_stats_on_workout',
    'trg_update_profile_stats_on_workout is dropped');
SELECT hasnt_trigger('public', 'personal_records', 'trg_update_pr_count_on_record',
    'trg_update_pr_count_on_record is dropped');
SELECT has_function('public', 'update_profile_stats_on_workout',
    'update_profile_stats_on_workout() is kept');
SELECT has_function('public', 'update_pr_count_on_record',
    'update_pr_count_on_record() is kept');

SELECT has_trigger('public', 'workout_sessions', 'trg_recompute_gamification_on_session_delete',
    'workout_sessions recomputes on delete');
SELECT has_trigger('public', 'personal_records', 'trg_recompute_gamification_on_record_delete',
    'personal_records recomputes on delete');
SELECT has_trigger('public', 'personal_records', 'trg_recompute_gamification_on_record_tombstone',
    'personal_records recomputes on tombstone');

SELECT has_column('public', 'gamification_stats', 'last_workout_at',
    'gamification_stats.last_workout_at exists');
SELECT has_column('public', 'rpg_attributes', 'last_workout_at',
    'rpg_attributes.last_workout_at exists');

-- The derivation and both RPCs are server-side only (PR 10 lock).
SELECT is_empty(
    $sql$
        SELECT format('%s|%s', sig, rolname)
        FROM unnest(ARRAY[
            'public.recompute_gamification_stats(uuid)',
            'public.recompute_gamification_stats_after_change()',
            'public.upsert_gamification_stats_lww(jsonb)',
            'public.upsert_rpg_attributes_lww(jsonb)'
        ]) AS sig
        CROSS JOIN (VALUES ('anon'), ('authenticated'), ('public')) AS r(rolname)
        WHERE has_function_privilege(r.rolname, to_regprocedure(sig), 'EXECUTE')
    $sql$,
    'no derivation or stats RPC is executable by anon, authenticated or PUBLIC'
);

SELECT diag('database:gamification-derivation-behaviour');

INSERT INTO auth.users (id, email)
VALUES
    ('e5e5e5e5-0000-4000-8000-000000000005'::uuid, 'derived-a@example.test'),
    ('f6f6f6f6-0000-4000-8000-000000000006'::uuid, 'derived-b@example.test')
ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email;

DELETE FROM public.gamification_stats
WHERE user_id IN (
    'e5e5e5e5-0000-4000-8000-000000000005'::uuid,
    'f6f6f6f6-0000-4000-8000-000000000006'::uuid
);

-- Device A: 100 sessions with one set of 10 reps each, 25 kg per cable
-- (KD-8: stored per cable and never doubled).
INSERT INTO public.workout_sessions (id, user_id, name, total_volume, duration_seconds, started_at)
SELECT ('e5e5e5e5-1111-4000-8000-' || lpad(generation.index::text, 12, '0'))::uuid,
       'e5e5e5e5-0000-4000-8000-000000000005'::uuid,
       'device A session ' || generation.index,
       25,
       60,
       now() - (generation.index || ' days')::interval
FROM generate_series(1, 100) AS generation(index);

INSERT INTO public.exercises (id, session_id, user_id, name)
SELECT ('e5e5e5e5-2222-4000-8000-' || lpad(generation.index::text, 12, '0'))::uuid,
       ('e5e5e5e5-1111-4000-8000-' || lpad(generation.index::text, 12, '0'))::uuid,
       'e5e5e5e5-0000-4000-8000-000000000005'::uuid,
       'Bench Press'
FROM generate_series(1, 100) AS generation(index);

INSERT INTO public.sets (exercise_id, user_id, set_number, actual_reps, weight_kg)
SELECT ('e5e5e5e5-2222-4000-8000-' || lpad(generation.index::text, 12, '0'))::uuid,
       'e5e5e5e5-0000-4000-8000-000000000005'::uuid,
       1, 10, 25
FROM generate_series(1, 100) AS generation(index);

INSERT INTO public.personal_records (id, user_id, exercise_name, value)
VALUES
    ('e5e5e5e5-3333-4000-8000-000000000001'::uuid,
     'e5e5e5e5-0000-4000-8000-000000000005'::uuid, 'Bench Press', 100),
    ('e5e5e5e5-3333-4000-8000-000000000002'::uuid,
     'e5e5e5e5-0000-4000-8000-000000000005'::uuid, 'Squat', 140);

-- Device A's own push: a truthful stats row plus its streaks.
SELECT lives_ok(
    $sql$
        SELECT public.upsert_gamification_stats_lww(
            jsonb_build_array(jsonb_build_object(
                'user_id', 'e5e5e5e5-0000-4000-8000-000000000005',
                'total_workouts', 100,
                'total_reps', 1000,
                'total_volume_kg', 2500,
                'total_time_seconds', 6000,
                'current_streak', 9,
                'longest_streak', 30,
                'last_workout_at', now()
            ))
        )
    $sql$,
    'device A stats push runs'
);

SELECT public.recompute_gamification_stats('e5e5e5e5-0000-4000-8000-000000000005'::uuid);

SELECT results_eq(
    $sql$
        SELECT total_workouts, total_reps, total_volume_kg, total_time_seconds,
               pr_count, current_streak, longest_streak, best_streak
        FROM public.gamification_stats
        WHERE user_id = 'e5e5e5e5-0000-4000-8000-000000000005'::uuid
    $sql$,
    $values$ VALUES (100::bigint, 1000, 2500::numeric, 6000::bigint, 2, 9, 30, 30) $values$,
    'derived counters equal the stored rows; streaks come from the device'
);

-- Stale device B (90 workouts, an older last-workout date, a lower streak).
SELECT lives_ok(
    $sql$
        SELECT public.upsert_gamification_stats_lww(
            jsonb_build_array(jsonb_build_object(
                'user_id', 'e5e5e5e5-0000-4000-8000-000000000005',
                'total_workouts', 90,
                'total_reps', 900,
                'total_volume_kg', 2250,
                'total_time_seconds', 5400,
                'current_streak', 1,
                'longest_streak', 12,
                'last_workout_at', now() - INTERVAL '10 days'
            ))
        )
    $sql$,
    'stale device B stats push runs'
);

SELECT results_eq(
    $sql$
        SELECT total_workouts, total_volume_kg, current_streak, longest_streak, best_streak
        FROM public.gamification_stats
        WHERE user_id = 'e5e5e5e5-0000-4000-8000-000000000005'::uuid
    $sql$,
    $values$ VALUES (100::bigint, 2500::numeric, 9, 30, 30) $values$,
    'a stale device lowers neither the derived totals nor the streaks'
);

SELECT results_eq(
    $sql$
        SELECT accepted
        FROM public.upsert_gamification_stats_lww(
            jsonb_build_array(jsonb_build_object(
                'user_id', 'e5e5e5e5-0000-4000-8000-000000000005',
                'current_streak', 2,
                'last_workout_at', now() - INTERVAL '10 days'
            ))
        )
    $sql$,
    $values$ VALUES (FALSE) $values$,
    'the stale write is reported as rejected'
);

-- A crafted push claiming 10,000 workouts.
SELECT lives_ok(
    $sql$
        SELECT public.upsert_gamification_stats_lww(
            jsonb_build_array(jsonb_build_object(
                'user_id', 'e5e5e5e5-0000-4000-8000-000000000005',
                'total_workouts', 10000,
                'total_volume_kg', 99999999,
                'pr_count', 4242,
                'last_workout_at', now() + INTERVAL '1 day'
            ))
        )
    $sql$,
    'crafted stats push runs'
);

SELECT results_eq(
    $sql$
        SELECT total_workouts, total_volume_kg, pr_count
        FROM public.gamification_stats
        WHERE user_id = 'e5e5e5e5-0000-4000-8000-000000000005'::uuid
    $sql$,
    $values$ VALUES (100::bigint, 2500::numeric, 2) $values$,
    'a crafted push cannot inflate a derived counter, even before the recompute'
);

-- A later device does own the device-owned columns.
SELECT lives_ok(
    $sql$
        SELECT public.upsert_gamification_stats_lww(
            jsonb_build_array(jsonb_build_object(
                'user_id', 'e5e5e5e5-0000-4000-8000-000000000005',
                'current_streak', 11,
                'longest_streak', 11,
                'last_workout_at', now() + INTERVAL '2 days'
            ))
        )
    $sql$,
    'later device stats push runs'
);

SELECT results_eq(
    $sql$
        SELECT current_streak, longest_streak, best_streak
        FROM public.gamification_stats
        WHERE user_id = 'e5e5e5e5-0000-4000-8000-000000000005'::uuid
    $sql$,
    $values$ VALUES (11, 30, 30) $values$,
    'the later write sets current_streak and never lowers the best-ever streaks'
);

-- Deleting a session lowers the derived totals (trigger path, no push).
DELETE FROM public.workout_sessions
WHERE id = 'e5e5e5e5-1111-4000-8000-000000000001'::uuid;

SELECT results_eq(
    $sql$
        SELECT total_workouts, total_reps, total_volume_kg, total_time_seconds
        FROM public.gamification_stats
        WHERE user_id = 'e5e5e5e5-0000-4000-8000-000000000005'::uuid
    $sql$,
    $values$ VALUES (99::bigint, 990, 2475::numeric, 5940::bigint) $values$,
    'deleting a session lowers total_workouts, total_reps, volume and time'
);

-- A record tombstone lowers pr_count; a hard delete does too.
UPDATE public.personal_records
   SET deleted_at = now()
 WHERE id = 'e5e5e5e5-3333-4000-8000-000000000001'::uuid;

SELECT is(
    (SELECT pr_count FROM public.gamification_stats
      WHERE user_id = 'e5e5e5e5-0000-4000-8000-000000000005'::uuid),
    1,
    'tombstoning a personal record lowers pr_count'
);

DELETE FROM public.personal_records
WHERE id = 'e5e5e5e5-3333-4000-8000-000000000002'::uuid;

SELECT is(
    (SELECT pr_count FROM public.gamification_stats
      WHERE user_id = 'e5e5e5e5-0000-4000-8000-000000000005'::uuid),
    0,
    'deleting a personal record lowers pr_count'
);

-- rpg_attributes: every column is device-owned and follows the same key.
SELECT lives_ok(
    $sql$
        SELECT public.upsert_rpg_attributes_lww(
            jsonb_build_array(jsonb_build_object(
                'user_id', 'e5e5e5e5-0000-4000-8000-000000000005',
                'level', 9,
                'experience_points', 4000,
                'last_workout_at', now()
            ))
        )
    $sql$,
    'device A rpg push runs'
);

SELECT lives_ok(
    $sql$
        SELECT public.upsert_rpg_attributes_lww(
            jsonb_build_array(jsonb_build_object(
                'user_id', 'e5e5e5e5-0000-4000-8000-000000000005',
                'level', 2,
                'experience_points', 100,
                'last_workout_at', now() - INTERVAL '10 days'
            ))
        )
    $sql$,
    'stale device B rpg push runs'
);

SELECT results_eq(
    $sql$
        SELECT level, experience_points
        FROM public.rpg_attributes
        WHERE user_id = 'e5e5e5e5-0000-4000-8000-000000000005'::uuid
    $sql$,
    $values$ VALUES (9, 4000) $values$,
    'a stale device cannot roll back XP or level'
);

-- A first write for a user with no row yet, and a legacy write with no
-- last-workout date, are both accepted (older app versions keep working).
SELECT results_eq(
    $sql$
        SELECT accepted
        FROM public.upsert_gamification_stats_lww(
            jsonb_build_array(jsonb_build_object(
                'user_id', 'f6f6f6f6-0000-4000-8000-000000000006',
                'current_streak', 4,
                'longest_streak', 4
            ))
        )
    $sql$,
    $values$ VALUES (TRUE) $values$,
    'a first stats write without a last-workout date is accepted'
);

SELECT results_eq(
    $sql$
        SELECT current_streak, longest_streak, best_streak, total_workouts
        FROM public.gamification_stats
        WHERE user_id = 'f6f6f6f6-0000-4000-8000-000000000006'::uuid
    $sql$,
    $values$ VALUES (4, 4, 4, 0::bigint) $values$,
    'the first write creates the row with zeroed derived counters'
);

-- The recompute creates the stats row for a user that never pushed stats.
DELETE FROM public.gamification_stats
WHERE user_id = 'f6f6f6f6-0000-4000-8000-000000000006'::uuid;

INSERT INTO public.workout_sessions (id, user_id, name, total_volume, duration_seconds, started_at)
VALUES ('f6f6f6f6-1111-4000-8000-000000000001'::uuid,
        'f6f6f6f6-0000-4000-8000-000000000006'::uuid, 'B session', 42, 120, now());

SELECT public.recompute_gamification_stats('f6f6f6f6-0000-4000-8000-000000000006'::uuid);

SELECT results_eq(
    $sql$
        SELECT total_workouts, total_volume_kg, total_time_seconds
        FROM public.gamification_stats
        WHERE user_id = 'f6f6f6f6-0000-4000-8000-000000000006'::uuid
    $sql$,
    $values$ VALUES (1::bigint, 42::numeric, 120::bigint) $values$,
    'the recompute creates a missing stats row'
);

-- Account deletion still works with sessions, records and a stats row in
-- place: the delete triggers must not try to write stats for a user that is
-- being cascaded away.
SELECT lives_ok(
    $sql$
        DELETE FROM auth.users WHERE id = 'f6f6f6f6-0000-4000-8000-000000000006'::uuid
    $sql$,
    'deleting the auth user cascades with the recompute triggers in place'
);

SELECT is_empty(
    $sql$
        SELECT 1 FROM public.gamification_stats
        WHERE user_id = 'f6f6f6f6-0000-4000-8000-000000000006'::uuid
    $sql$,
    'the deleted user keeps no stats row'
);

SELECT * FROM finish();

ROLLBACK;
