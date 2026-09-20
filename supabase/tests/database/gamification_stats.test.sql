-- Server-derived gamification counters
-- (20260920002500_server_derived_gamification.sql +
--  20260920002501_backfill_server_derived_gamification.sql).
--
-- Pins who owns each column:
--   * the derived ones (counters AND all three streaks) follow the stored
--     rows — a crafted push cannot write them on EITHER the INSERT path or
--     the ON CONFLICT path, and a delete lowers them;
--   * the device_* shadow columns hold what the phone reported verbatim, so
--     mobile-sync-pull can hand the phone back its own numbers (R-10);
--   * the last-workout key is clamped to now() and a NULL key is not consent.
--
-- `plan(N)` rather than `no_plan()` on purpose (R-21): this file is the only
-- place the crafted-payload claim is proven, and with no_plan a deleted
-- assertion shrinks the suite silently while CI stays green.
--
-- Runs in CI with the rest of the suite (`supabase test db` in
-- .github/workflows/migrations.yml); locally: `npm run test:db`.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;

SELECT plan(46);

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

-- The device-reported shadow columns mobile-sync-pull serves (R-10).
SELECT is(
    (SELECT count(*)::int
       FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'gamification_stats'
        AND column_name IN ('device_total_workouts', 'device_total_reps',
                            'device_total_volume_kg', 'device_total_time_seconds',
                            'device_current_streak', 'device_longest_streak')),
    6,
    'all six device-reported shadow columns exist'
);

-- The derivation and both RPCs are server-side only (PR 10 lock). The
-- signature list is asserted to resolve as well as to be unprivileged:
-- to_regprocedure() returns NULL for an unresolvable signature and
-- has_function_privilege(role, NULL, ...) is NULL, not an error, so a rename
-- or a typo would silently drop a row from the is_empty check (R-22).
SELECT is(
    (SELECT count(*)::int FROM unnest(ARRAY[
        'public.derive_gamification_stats(uuid)',
        'public.recompute_gamification_stats(uuid)',
        'public.recompute_all_gamification_stats()',
        'public.recompute_gamification_stats_after_change()',
        'public.upsert_gamification_stats_lww(jsonb)',
        'public.upsert_rpg_attributes_lww(jsonb)'
     ]) AS sig WHERE to_regprocedure(sig) IS NOT NULL),
    6,
    'all six gamification function signatures resolve'
);

SELECT is_empty(
    $sql$
        SELECT format('%s|%s', sig, rolname)
        FROM unnest(ARRAY[
            'public.derive_gamification_stats(uuid)',
            'public.recompute_gamification_stats(uuid)',
            'public.recompute_all_gamification_stats()',
            'public.recompute_gamification_stats_after_change()',
            'public.upsert_gamification_stats_lww(jsonb)',
            'public.upsert_rpg_attributes_lww(jsonb)'
        ]) AS sig
        CROSS JOIN (VALUES ('anon'), ('authenticated'), ('public')) AS r(rolname)
        WHERE has_function_privilege(r.rolname, to_regprocedure(sig), 'EXECUTE')
    $sql$,
    'no derivation or stats RPC is executable by anon, authenticated or PUBLIC'
);

-- R-5: the counters follow the stored rows only because mobile-sync-push is
-- the sole writer. There is deliberately no INSERT/UPDATE trigger (it would
-- run inside the push transaction and a timeout would fail the write), so
-- this grant assertion is what makes a new client-side writer break loudly.
SELECT is_empty(
    $sql$
        SELECT format('%s|%s|%s', r.rolname, t.relname, p.priv)
        FROM (VALUES ('anon'), ('authenticated')) AS r(rolname)
        CROSS JOIN (VALUES ('workout_sessions'), ('personal_records'), ('sets')) AS t(relname)
        CROSS JOIN (VALUES ('INSERT'), ('UPDATE')) AS p(priv)
        WHERE has_table_privilege(r.rolname, 'public.' || t.relname, p.priv)
    $sql$,
    'anon and authenticated cannot INSERT or UPDATE any counter source table'
);

SELECT diag('database:gamification-derivation-behaviour');

INSERT INTO auth.users (id, email)
VALUES
    ('e5e5e5e5-0000-4000-8000-000000000005'::uuid, 'derived-a@example.test'),
    ('f6f6f6f6-0000-4000-8000-000000000006'::uuid, 'derived-b@example.test'),
    ('a7a7a7a7-0000-4000-8000-000000000007'::uuid, 'derived-c@example.test')
ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email;

DELETE FROM public.gamification_stats
WHERE user_id IN (
    'e5e5e5e5-0000-4000-8000-000000000005'::uuid,
    'f6f6f6f6-0000-4000-8000-000000000006'::uuid,
    'a7a7a7a7-0000-4000-8000-000000000007'::uuid
);

-- Device A: 100 sessions with one set of 10 reps each, 25 kg per cable
-- (KD-8: stored per cable and never doubled), on 100 consecutive UTC days
-- ending yesterday — so the derived current streak is 100 as well.
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

-- Device A's own push. It reports its OWN lifetime figures, which do not
-- match the server's (the phone counts its own profile and aggregates the
-- machine total, not per cable) — that is the whole point of the shadow
-- columns, so the numbers here are deliberately different.
SELECT lives_ok(
    $sql$
        SELECT public.upsert_gamification_stats_lww(
            jsonb_build_array(jsonb_build_object(
                'user_id', 'e5e5e5e5-0000-4000-8000-000000000005',
                'device_total_workouts', 317,
                'device_total_reps', 1000,
                'device_total_volume_kg', 5000,
                'device_total_time_seconds', 6000,
                'device_current_streak', 9,
                'device_longest_streak', 30,
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
    $values$ VALUES (100::bigint, 1000, 2500::numeric, 6000::bigint, 2, 100, 100, 100) $values$,
    'every derived counter AND all three streaks equal the stored rows'
);

-- The phone's own numbers survive untouched beside them. This is what
-- mobile-sync-pull serves, so an installed build sees no change (R-10).
SELECT results_eq(
    $sql$
        SELECT device_total_workouts, device_total_reps, device_total_volume_kg,
               device_total_time_seconds, device_current_streak, device_longest_streak
        FROM public.gamification_stats
        WHERE user_id = 'e5e5e5e5-0000-4000-8000-000000000005'::uuid
    $sql$,
    $values$ VALUES (317, 1000, 5000::numeric, 6000, 9, 30) $values$,
    'the recompute leaves the device-reported shadow columns alone'
);

-- Stale device B: an older last-workout date, lower numbers.
SELECT results_eq(
    $sql$
        SELECT accepted
        FROM public.upsert_gamification_stats_lww(
            jsonb_build_array(jsonb_build_object(
                'user_id', 'e5e5e5e5-0000-4000-8000-000000000005',
                'device_total_workouts', 90,
                'device_current_streak', 1,
                'device_longest_streak', 12,
                'last_workout_at', now() - INTERVAL '10 days'
            ))
        )
    $sql$,
    $values$ VALUES (FALSE) $values$,
    'a stale device write is reported as rejected'
);

SELECT results_eq(
    $sql$
        SELECT total_workouts, device_total_workouts, device_current_streak, device_longest_streak
        FROM public.gamification_stats
        WHERE user_id = 'e5e5e5e5-0000-4000-8000-000000000005'::uuid
    $sql$,
    $values$ VALUES (100::bigint, 317, 9, 30) $values$,
    'a stale device lowers neither the derived totals nor the shadow columns'
);

-- R-3 / R-11: a stats-only push (`sessions: []` on the wire) carries a NULL
-- key. That is the exact shape a stale device sends, so it must NOT be
-- treated as consent to overwrite a newer device.
SELECT results_eq(
    $sql$
        SELECT accepted
        FROM public.upsert_gamification_stats_lww(
            jsonb_build_array(jsonb_build_object(
                'user_id', 'e5e5e5e5-0000-4000-8000-000000000005',
                'device_total_workouts', 1,
                'device_current_streak', 0,
                'device_longest_streak', 1
            ))
        )
    $sql$,
    $values$ VALUES (FALSE) $values$,
    'a null-key write against a stored key is rejected, not auto-accepted'
);

SELECT results_eq(
    $sql$
        SELECT device_total_workouts, device_current_streak, device_longest_streak
        FROM public.gamification_stats
        WHERE user_id = 'e5e5e5e5-0000-4000-8000-000000000005'::uuid
    $sql$,
    $values$ VALUES (317, 9, 30) $values$,
    'the null-key write changed nothing'
);

-- R-15: a rejected write must not touch the row at all, or it would bump
-- updated_at — the pull cursor — and drag an unchanged row into the next
-- delta pull, where the phone would write it back over its own value.
SELECT is(
    (SELECT count(*)::int FROM public.gamification_stats
      WHERE user_id = 'e5e5e5e5-0000-4000-8000-000000000005'::uuid),
    1,
    'sanity: device A has exactly one stats row to compare against'
);

-- NB: `now()` is the TRANSACTION timestamp, so inside one pgTAP transaction
-- an unwanted `updated_at = now()` writes the value that is already there
-- and no comparison of updated_at can see it. The row version (ctid) does
-- change on any rewrite, so that is what pins "the rejected write touched
-- nothing at all"; for the recompute, which rewrites the row by design, the
-- guard is on the function body instead.
CREATE TEMP TABLE pr25_cursor AS
SELECT ctid AS row_version FROM public.gamification_stats
 WHERE user_id = 'e5e5e5e5-0000-4000-8000-000000000005'::uuid;

SELECT public.upsert_gamification_stats_lww(
    jsonb_build_array(jsonb_build_object(
        'user_id', 'e5e5e5e5-0000-4000-8000-000000000005',
        'device_total_workouts', 5,
        'last_workout_at', now() - INTERVAL '10 days'
    ))
);

SELECT is(
    (SELECT gs.ctid FROM public.gamification_stats gs
      WHERE gs.user_id = 'e5e5e5e5-0000-4000-8000-000000000005'::uuid),
    (SELECT row_version FROM pr25_cursor),
    'a rejected write does not touch the row at all, so it cannot bump the pull cursor'
);

-- The recompute must not bump updated_at either: nothing it writes is served
-- to the phone, so re-delivering the row would only make the phone's value
-- flap between the pull and its own local recompute.
SELECT is(
    (SELECT count(*)::int
       FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname = 'recompute_gamification_stats'
        AND p.prosrc ~* 'updated_at'),
    0,
    'recompute_gamification_stats never writes updated_at (the pull cursor)'
);

-- …and it does rewrite a corrupted derived column, so the guard above is not
-- protecting a function that does nothing.
UPDATE public.gamification_stats
   SET total_workouts = 1
 WHERE user_id = 'e5e5e5e5-0000-4000-8000-000000000005'::uuid;

SELECT public.recompute_gamification_stats('e5e5e5e5-0000-4000-8000-000000000005'::uuid);

SELECT is(
    (SELECT gs.total_workouts FROM public.gamification_stats gs
      WHERE gs.user_id = 'e5e5e5e5-0000-4000-8000-000000000005'::uuid),
    100::bigint,
    'the recompute rewrites a corrupted derived column'
);

-- R-2 / R-24: a far-future key must be clamped, or it would pin every
-- device-reported column against all later honest pushes forever.
SELECT results_eq(
    $sql$
        SELECT accepted
        FROM public.upsert_gamification_stats_lww(
            jsonb_build_array(jsonb_build_object(
                'user_id', 'e5e5e5e5-0000-4000-8000-000000000005',
                'device_total_workouts', 999,
                'last_workout_at', '2099-01-01T00:00:00Z'
            ))
        )
    $sql$,
    $values$ VALUES (TRUE) $values$,
    'a far-future key is accepted (it is newer) but clamped'
);

SELECT ok(
    (SELECT gs.last_workout_at FROM public.gamification_stats gs
      WHERE gs.user_id = 'e5e5e5e5-0000-4000-8000-000000000005'::uuid) <= now(),
    'the stored conflict key is never in the server''s future'
);

SELECT results_eq(
    $sql$
        SELECT accepted
        FROM public.upsert_gamification_stats_lww(
            jsonb_build_array(jsonb_build_object(
                'user_id', 'e5e5e5e5-0000-4000-8000-000000000005',
                'device_total_workouts', 320,
                'last_workout_at', now()
            ))
        )
    $sql$,
    $values$ VALUES (TRUE) $values$,
    'an honest push after a far-future push is still accepted'
);

SELECT is(
    (SELECT gs.device_total_workouts FROM public.gamification_stats gs
      WHERE gs.user_id = 'e5e5e5e5-0000-4000-8000-000000000005'::uuid),
    320,
    'the honest push wins; the 2099 device is not locked in'
);

-- R-8 / R-15: a rejection reports the STORED conflict key, not a fresh
-- server clock, so the device knows what it has to beat.
SELECT results_eq(
    $sql$
        SELECT server_updated_at = (SELECT gs.last_workout_at FROM public.gamification_stats gs
                                     WHERE gs.user_id = 'e5e5e5e5-0000-4000-8000-000000000005'::uuid)
        FROM public.upsert_gamification_stats_lww(
            jsonb_build_array(jsonb_build_object(
                'user_id', 'e5e5e5e5-0000-4000-8000-000000000005',
                'device_total_workouts', 1,
                'last_workout_at', now() - INTERVAL '30 days'
            ))
        )
    $sql$,
    $values$ VALUES (TRUE) $values$,
    'a rejection returns the stored last_workout_at as server_updated_at'
);

-- Deleting a session lowers the derived totals AND the derived streaks
-- (trigger path, no push). Removing yesterday breaks the run to today.
DELETE FROM public.workout_sessions
WHERE id = 'e5e5e5e5-1111-4000-8000-000000000001'::uuid;

SELECT results_eq(
    $sql$
        SELECT total_workouts, total_reps, total_volume_kg, total_time_seconds,
               current_streak, longest_streak
        FROM public.gamification_stats
        WHERE user_id = 'e5e5e5e5-0000-4000-8000-000000000005'::uuid
    $sql$,
    $values$ VALUES (99::bigint, 990, 2475::numeric, 5940::bigint, 0, 99) $values$,
    'deleting a session lowers the totals and the derived streaks'
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

SELECT results_eq(
    $sql$
        SELECT accepted
        FROM public.upsert_rpg_attributes_lww(
            jsonb_build_array(jsonb_build_object(
                'user_id', 'e5e5e5e5-0000-4000-8000-000000000005',
                'level', 2,
                'experience_points', 100,
                'last_workout_at', now() - INTERVAL '10 days'
            ))
        )
    $sql$,
    $values$ VALUES (FALSE) $values$,
    'a stale rpg push is rejected'
);

SELECT results_eq(
    $sql$
        SELECT accepted
        FROM public.upsert_rpg_attributes_lww(
            jsonb_build_array(jsonb_build_object(
                'user_id', 'e5e5e5e5-0000-4000-8000-000000000005',
                'level', 2,
                'experience_points', 100
            ))
        )
    $sql$,
    $values$ VALUES (FALSE) $values$,
    'a null-key rpg push against a stored key is rejected'
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

SELECT diag('database:gamification-derivation-insert-path');

-- R-17: the derived columns are absent from BOTH column lists of the RPC.
-- The ON CONFLICT path is covered above; this is the INSERT path, where a
-- first write from a user with no stats row carries crafted derived
-- counters. With the columns re-added to the INSERT list only, this goes red
-- (mutation M13, which was fully green before).
SELECT results_eq(
    $sql$
        SELECT accepted
        FROM public.upsert_gamification_stats_lww(
            jsonb_build_array(jsonb_build_object(
                'user_id', 'f6f6f6f6-0000-4000-8000-000000000006',
                'total_workouts', 10000,
                'total_reps', 987654,
                'total_volume_kg', 99999999,
                'total_time_seconds', 8888888,
                'pr_count', 4242,
                'current_streak', 777,
                'longest_streak', 888,
                'best_streak', 999,
                'device_total_workouts', 4,
                'device_current_streak', 4,
                'device_longest_streak', 4
            ))
        )
    $sql$,
    $values$ VALUES (TRUE) $values$,
    'a first stats write without a last-workout date is accepted'
);

SELECT results_eq(
    $sql$
        SELECT total_workouts, total_reps, total_volume_kg, total_time_seconds,
               pr_count, current_streak, longest_streak, best_streak
        FROM public.gamification_stats
        WHERE user_id = 'f6f6f6f6-0000-4000-8000-000000000006'::uuid
    $sql$,
    $values$ VALUES (0::bigint, 0, 0::numeric, 0::bigint, 0, 0, 0, 0) $values$,
    'a crafted first write cannot seed a derived counter on the INSERT path'
);

SELECT results_eq(
    $sql$
        SELECT device_total_workouts, device_current_streak, device_longest_streak
        FROM public.gamification_stats
        WHERE user_id = 'f6f6f6f6-0000-4000-8000-000000000006'::uuid
    $sql$,
    $values$ VALUES (4, 4, 4) $values$,
    'the same first write does store the device-reported shadow values'
);

SELECT diag('database:gamification-derivation-no-insert');

-- The recompute is UPDATE-only on purpose (R-10). A user who pushes only
-- routines must NOT get an all-zero stats row, because mobile-sync-pull
-- would then serve zeroes where it used to serve null and the phone's
-- unconditional merge would wipe its own lifetime stats.
INSERT INTO public.workout_sessions (id, user_id, name, total_volume, duration_seconds, started_at)
VALUES ('a7a7a7a7-1111-4000-8000-000000000001'::uuid,
        'a7a7a7a7-0000-4000-8000-000000000007'::uuid, 'C session', 42, 120, now());

SELECT public.recompute_gamification_stats('a7a7a7a7-0000-4000-8000-000000000007'::uuid);

SELECT is_empty(
    $sql$
        SELECT 1 FROM public.gamification_stats
        WHERE user_id = 'a7a7a7a7-0000-4000-8000-000000000007'::uuid
    $sql$,
    'the recompute never INSERTs a stats row (it would pull back as zeroes)'
);

SELECT diag('database:gamification-derivation-backfill');

-- R-16 / R-19: the 20260920002501 selection predicate and its effect. The
-- backfill loop itself runs against an empty DB at migration time, so
-- without this the whole block could be deleted and the suite stay green
-- (mutation M12). Seed the exact drift the add-only triggers left behind.
INSERT INTO public.gamification_stats (
    user_id, total_workouts, total_reps, total_volume_kg, total_time_seconds,
    pr_count, current_streak, longest_streak, best_streak,
    device_total_workouts, device_current_streak, device_longest_streak
)
VALUES ('a7a7a7a7-0000-4000-8000-000000000007'::uuid,
        999, 9990, 99999, 99999, 77, 55, 66, 66, 12, 3, 4);

-- The exact call 20260920002501 makes. Deleting recompute_all_gamification_stats
-- (or breaking its selection predicate) now turns this red; before it was
-- extracted, truncating the migration at the backfill left the suite green
-- (mutation M12).
SELECT ok(
    public.recompute_all_gamification_stats() >= 1,
    'recompute_all_gamification_stats visits the existing stats rows'
);

SELECT results_eq(
    $sql$
        SELECT total_workouts, total_reps, total_volume_kg, total_time_seconds,
               pr_count, current_streak, longest_streak, best_streak
        FROM public.gamification_stats
        WHERE user_id = 'a7a7a7a7-0000-4000-8000-000000000007'::uuid
    $sql$,
    $values$ VALUES (1::bigint, 0, 42::numeric, 120::bigint, 0, 1, 1, 1) $values$,
    'the backfill loop collapses an inflated row onto the derived values'
);

SELECT results_eq(
    $sql$
        SELECT device_total_workouts, device_current_streak, device_longest_streak
        FROM public.gamification_stats
        WHERE user_id = 'a7a7a7a7-0000-4000-8000-000000000007'::uuid
    $sql$,
    $values$ VALUES (12, 3, 4) $values$,
    'the backfill leaves the device-reported shadow columns untouched'
);

-- A stats row whose user has no sessions at all collapses to zero rather
-- than keeping a stale figure — pinned deliberately rather than discovered
-- in support (R-16).
SELECT results_eq(
    $sql$
        SELECT total_workouts, total_volume_kg, current_streak, longest_streak
        FROM public.gamification_stats
        WHERE user_id = 'f6f6f6f6-0000-4000-8000-000000000006'::uuid
    $sql$,
    $values$ VALUES (0::bigint, 0::numeric, 0, 0) $values$,
    'a stats row with no sessions derives to zero'
);

-- Account deletion still works with sessions, records and a stats row in
-- place: the delete triggers must not try to write stats for a user that is
-- being cascaded away.
SELECT lives_ok(
    $sql$
        DELETE FROM auth.users WHERE id = 'a7a7a7a7-0000-4000-8000-000000000007'::uuid
    $sql$,
    'deleting the auth user cascades with the recompute triggers in place'
);

SELECT is_empty(
    $sql$
        SELECT 1 FROM public.gamification_stats
        WHERE user_id = 'a7a7a7a7-0000-4000-8000-000000000007'::uuid
    $sql$,
    'the deleted user keeps no stats row'
);

SELECT * FROM finish();

ROLLBACK;
