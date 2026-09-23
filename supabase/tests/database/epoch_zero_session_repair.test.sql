-- C10 ("1970 session repair"): private.repair_epoch_zero_sessions(), defined
-- by supabase/migrations/20260926100000_repair_epoch_zero_sessions.sql.
--
-- Seeds one session per approved group (A/B/C), a normal untouched session,
-- and the two "left alone" cases (client_updated_at NULL, and client_updated_at
-- itself before 2000-01-01), plus matching exercise_progress and
-- personal_records rows to prove the copies are repaired only on an exact
-- value match (not by session_id alone). Calls the function directly (not a
-- copy of its SQL): it is idempotent and safe to call repeatedly inside this
-- transaction, so testing the real function is both simpler and more honest
-- than the vbt_assessments_dedupe.test.sql style of re-pasting migration DDL.
--
-- Every literal duration/timestamp below is chosen to need no `now()`-relative
-- math: group A's duration_seconds (1,700,000,000 = 2023-11-14T22:13:20Z) is
-- comfortably below any `now() + 1 day` upper bound this test will ever run
-- under, and groups B/C's fallback dates are fixed 2026 timestamps with no
-- dependency on the actual wall clock.
--
-- Follows supabase/tests/database/personal_records_legacy_identity... style
-- (seed auth.users first) and gamification_stats.test.sql (`plan(N)`, so a
-- deleted assertion cannot shrink the suite silently).

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;

SELECT plan(27);

SELECT diag('database:epoch-zero-session-repair');

SELECT ok(
    to_regprocedure('private.repair_epoch_zero_sessions()') IS NOT NULL,
    'private.repair_epoch_zero_sessions() exists'
);

INSERT INTO auth.users (id, email) VALUES
    ('c1000000-0000-4000-8000-00000000000a', 'c10-user-a@example.invalid'),
    ('c1000000-0000-4000-8000-00000000000b', 'c10-user-b@example.invalid');

-- ---------------------------------------------------------------------------
-- Seed workout_sessions. updated_at is seeded far in the past (the
-- sessions_updated_at trigger only fires BEFORE UPDATE, not INSERT, so this
-- sticks) to prove the repair's UPDATE advances it. client_updated_at is
-- seeded explicitly for the same reason: the portal-edit stamping trigger
-- only fires for auth.role() = 'authenticated', which this test is not.
-- ---------------------------------------------------------------------------

-- Group A: exact epoch zero, duration_seconds is a plausible Unix-seconds
-- timestamp (2023-11-14T22:13:20Z) -> started_at := that, duration := 0.
INSERT INTO public.workout_sessions
    (id, user_id, started_at, duration_seconds, client_updated_at, updated_at)
VALUES
    ('c1000000-0000-4000-8000-0000000000a1', 'c1000000-0000-4000-8000-00000000000a',
     '1970-01-01T00:00:00Z', 1700000000, '2026-01-01T00:00:00Z', '2020-01-01T00:00:00Z');

-- Group B: pre-2000 (epoch zero here too), duration_seconds is NOT a
-- plausible Unix-seconds timestamp and > 86,400 -> started_at :=
-- client_updated_at, duration := 0. Mirrors the production ~2.5-day rows.
INSERT INTO public.workout_sessions
    (id, user_id, started_at, duration_seconds, client_updated_at, updated_at)
VALUES
    ('c1000000-0000-4000-8000-0000000000a2', 'c1000000-0000-4000-8000-00000000000a',
     '1970-01-01T00:00:00Z', 213003, '2026-02-01T00:00:00Z', '2020-01-01T00:00:00Z');

-- Group C: pre-2000, not exactly epoch, duration_seconds <= 86,400 ->
-- started_at := client_updated_at, duration KEPT.
INSERT INTO public.workout_sessions
    (id, user_id, started_at, duration_seconds, client_updated_at, updated_at)
VALUES
    ('c1000000-0000-4000-8000-0000000000a3', 'c1000000-0000-4000-8000-00000000000b',
     '1969-06-01T00:00:00Z', 3600, '2026-03-01T00:00:00Z', '2020-01-01T00:00:00Z');

-- Normal row: started_at >= 2000-01-01 -> never a candidate, untouched.
INSERT INTO public.workout_sessions
    (id, user_id, started_at, duration_seconds, client_updated_at, updated_at)
VALUES
    ('c1000000-0000-4000-8000-0000000000a4', 'c1000000-0000-4000-8000-00000000000a',
     '2026-06-01T00:00:00Z', 1800, '2026-06-01T00:00:00Z', '2026-06-01T00:00:00Z');

-- client_updated_at NULL -> left alone entirely (no LWW key to advance).
INSERT INTO public.workout_sessions
    (id, user_id, started_at, duration_seconds, client_updated_at, updated_at)
VALUES
    ('c1000000-0000-4000-8000-0000000000a5', 'c1000000-0000-4000-8000-00000000000b',
     '1970-01-01T00:00:00Z', 213003, NULL, '2020-01-01T00:00:00Z');

-- client_updated_at itself before 2000-01-01 -> no reliable fallback clock,
-- left alone (see the migration header's idempotency note).
INSERT INTO public.workout_sessions
    (id, user_id, started_at, duration_seconds, client_updated_at, updated_at)
VALUES
    ('c1000000-0000-4000-8000-0000000000a6', 'c1000000-0000-4000-8000-00000000000b',
     '1970-01-01T00:00:00Z', 213003, '1969-01-01T00:00:00Z', '2020-01-01T00:00:00Z');

-- ---------------------------------------------------------------------------
-- exercise_progress: one row per repaired session matching the OLD
-- started_at exactly (must move), one on the SAME session with an unrelated
-- recorded_at (must NOT move -- proves the match is by value), and one on
-- the untouched normal session (control).
-- ---------------------------------------------------------------------------
INSERT INTO public.exercise_progress
    (id, user_id, exercise_name, session_id, recorded_at)
VALUES
    ('c1000000-0000-4000-8000-0000000000b1', 'c1000000-0000-4000-8000-00000000000a',
     'Bench Press', 'c1000000-0000-4000-8000-0000000000a1', '1970-01-01T00:00:00Z'),
    ('c1000000-0000-4000-8000-0000000000b2', 'c1000000-0000-4000-8000-00000000000a',
     'Squat', 'c1000000-0000-4000-8000-0000000000a1', '2024-05-05T00:00:00Z'),
    ('c1000000-0000-4000-8000-0000000000b3', 'c1000000-0000-4000-8000-00000000000a',
     'Row', 'c1000000-0000-4000-8000-0000000000a4', '2026-06-01T00:00:00Z');

-- ---------------------------------------------------------------------------
-- personal_records: set-derived and legacy (source IS NULL) rows on the OLD
-- started_at (must move), a dedicated row that ALSO happens to carry the
-- exact old started_at (must ALSO move -- the match is on value, not
-- source; see the migration header), and an unrelated row on the untouched
-- session (control).
-- ---------------------------------------------------------------------------
INSERT INTO public.personal_records
    (id, user_id, exercise_name, value, session_id, achieved_at, source)
VALUES
    ('c1000000-0000-4000-8000-0000000000c1', 'c1000000-0000-4000-8000-00000000000a',
     'Bench Press', 100, 'c1000000-0000-4000-8000-0000000000a1', '1970-01-01T00:00:00Z', 'set_derived'),
    ('c1000000-0000-4000-8000-0000000000c2', 'c1000000-0000-4000-8000-00000000000a',
     'Deadlift', 150, 'c1000000-0000-4000-8000-0000000000a2', '1970-01-01T00:00:00Z', NULL),
    ('c1000000-0000-4000-8000-0000000000c3', 'c1000000-0000-4000-8000-00000000000a',
     'Overhead Press', 60, 'c1000000-0000-4000-8000-0000000000a1', '1970-01-01T00:00:00Z', 'dedicated'),
    ('c1000000-0000-4000-8000-0000000000c4', 'c1000000-0000-4000-8000-00000000000a',
     'Row', 80, 'c1000000-0000-4000-8000-0000000000a4', '2020-01-01T00:00:00Z', 'dedicated');

-- ---------------------------------------------------------------------------
-- gamification_stats: seeded with deliberately wrong stale counters for both
-- users, so a correction proves recompute_gamification_stats() actually ran
-- (it is UPDATE-only, so a row must pre-exist).
-- ---------------------------------------------------------------------------
INSERT INTO public.gamification_stats (user_id, total_workouts, total_time_seconds)
VALUES
    ('c1000000-0000-4000-8000-00000000000a', 555, 555555),
    ('c1000000-0000-4000-8000-00000000000b', 555, 555555);

-- ---------------------------------------------------------------------------
-- Run the repair.
-- ---------------------------------------------------------------------------
SELECT diag('database:epoch-zero-session-repair-first-run');

SELECT is(
    (SELECT group_a FROM private.repair_epoch_zero_sessions()),
    1,
    'first run: group A repaired one session'
);
-- The function is UPDATE-based and non-deterministic to call twice inside
-- one assertion, so every subsequent check re-derives the row from the base
-- tables rather than calling the function again for a second value.

SELECT is(
    (SELECT started_at FROM public.workout_sessions WHERE id = 'c1000000-0000-4000-8000-0000000000a1'),
    '2023-11-14T22:13:20Z'::timestamptz,
    'group A: started_at reinterpreted from duration_seconds as Unix seconds'
);
SELECT is(
    (SELECT duration_seconds FROM public.workout_sessions WHERE id = 'c1000000-0000-4000-8000-0000000000a1'),
    0,
    'group A: duration_seconds zeroed'
);
SELECT isnt(
    (SELECT client_updated_at FROM public.workout_sessions WHERE id = 'c1000000-0000-4000-8000-0000000000a1'),
    '2026-01-01T00:00:00Z'::timestamptz,
    'group A: client_updated_at advanced past its seeded value'
);
SELECT isnt(
    (SELECT updated_at FROM public.workout_sessions WHERE id = 'c1000000-0000-4000-8000-0000000000a1'),
    '2020-01-01T00:00:00Z'::timestamptz,
    'group A: updated_at advanced (sessions_updated_at trigger fired)'
);

SELECT is(
    (SELECT started_at FROM public.workout_sessions WHERE id = 'c1000000-0000-4000-8000-0000000000a2'),
    '2026-02-01T00:00:00Z'::timestamptz,
    'group B: started_at falls back to client_updated_at'
);
SELECT is(
    (SELECT duration_seconds FROM public.workout_sessions WHERE id = 'c1000000-0000-4000-8000-0000000000a2'),
    0,
    'group B: duration_seconds zeroed (was > 86,400)'
);

SELECT is(
    (SELECT started_at FROM public.workout_sessions WHERE id = 'c1000000-0000-4000-8000-0000000000a3'),
    '2026-03-01T00:00:00Z'::timestamptz,
    'group C: started_at falls back to client_updated_at'
);
SELECT is(
    (SELECT duration_seconds FROM public.workout_sessions WHERE id = 'c1000000-0000-4000-8000-0000000000a3'),
    3600,
    'group C: duration_seconds kept (was <= 86,400)'
);

SELECT is(
    (SELECT started_at FROM public.workout_sessions WHERE id = 'c1000000-0000-4000-8000-0000000000a4'),
    '2026-06-01T00:00:00Z'::timestamptz,
    'normal row: untouched'
);

SELECT is(
    (SELECT started_at FROM public.workout_sessions WHERE id = 'c1000000-0000-4000-8000-0000000000a5'),
    '1970-01-01T00:00:00Z'::timestamptz,
    'client_updated_at NULL: left alone'
);
SELECT ok(
    (SELECT client_updated_at FROM public.workout_sessions WHERE id = 'c1000000-0000-4000-8000-0000000000a5') IS NULL,
    'client_updated_at NULL: still NULL (not touched)'
);

SELECT is(
    (SELECT started_at FROM public.workout_sessions WHERE id = 'c1000000-0000-4000-8000-0000000000a6'),
    '1970-01-01T00:00:00Z'::timestamptz,
    'client_updated_at itself pre-2000: left alone'
);

SELECT diag('database:epoch-zero-session-repair-exercise-progress');

SELECT is(
    (SELECT recorded_at FROM public.exercise_progress WHERE id = 'c1000000-0000-4000-8000-0000000000b1'),
    '2023-11-14T22:13:20Z'::timestamptz,
    'exercise_progress.recorded_at moved with its session (exact old-value match)'
);
SELECT is(
    (SELECT recorded_at FROM public.exercise_progress WHERE id = 'c1000000-0000-4000-8000-0000000000b2'),
    '2024-05-05T00:00:00Z'::timestamptz,
    'exercise_progress on the same session but a DIFFERENT recorded_at: untouched'
);
SELECT is(
    (SELECT recorded_at FROM public.exercise_progress WHERE id = 'c1000000-0000-4000-8000-0000000000b3'),
    '2026-06-01T00:00:00Z'::timestamptz,
    'exercise_progress on the untouched normal session: untouched'
);

SELECT diag('database:epoch-zero-session-repair-personal-records');

SELECT is(
    (SELECT achieved_at FROM public.personal_records WHERE id = 'c1000000-0000-4000-8000-0000000000c1'),
    '2023-11-14T22:13:20Z'::timestamptz,
    'set-derived personal_records.achieved_at moved with its session'
);
SELECT is(
    (SELECT achieved_at FROM public.personal_records WHERE id = 'c1000000-0000-4000-8000-0000000000c2'),
    '2026-02-01T00:00:00Z'::timestamptz,
    'legacy (source IS NULL) personal_records.achieved_at moved with its session'
);
SELECT is(
    (SELECT achieved_at FROM public.personal_records WHERE id = 'c1000000-0000-4000-8000-0000000000c3'),
    '2023-11-14T22:13:20Z'::timestamptz,
    'dedicated personal_records.achieved_at ALSO moves when it exactly matched the old value'
);
SELECT is(
    (SELECT achieved_at FROM public.personal_records WHERE id = 'c1000000-0000-4000-8000-0000000000c4'),
    '2020-01-01T00:00:00Z'::timestamptz,
    'personal_records with an unrelated achieved_at: untouched'
);

SELECT diag('database:epoch-zero-session-repair-gamification');

SELECT is(
    (SELECT total_time_seconds FROM public.gamification_stats WHERE user_id = 'c1000000-0000-4000-8000-00000000000a'),
    1800::bigint,
    'user A gamification_stats.total_time_seconds recomputed (0 + 0 + 1800, the two repaired sessions plus the normal one)'
);
SELECT is(
    (SELECT total_workouts::int FROM public.gamification_stats WHERE user_id = 'c1000000-0000-4000-8000-00000000000a'),
    3,
    'user A gamification_stats.total_workouts recomputed (3 sessions)'
);
SELECT is(
    (SELECT total_time_seconds FROM public.gamification_stats WHERE user_id = 'c1000000-0000-4000-8000-00000000000b'),
    (3600 + 213003 + 213003)::bigint,
    'user B gamification_stats.total_time_seconds recomputed (group C kept its duration; the two skipped rows keep theirs too)'
);
SELECT is(
    (SELECT total_workouts::int FROM public.gamification_stats WHERE user_id = 'c1000000-0000-4000-8000-00000000000b'),
    3,
    'user B gamification_stats.total_workouts recomputed (3 sessions)'
);

-- ---------------------------------------------------------------------------
-- Idempotency: nothing left to repair among the already-fixed rows, but the
-- two permanently-unrepairable rows (NULL / unusable client_updated_at) are
-- reported as skipped on EVERY run, not just the first (they never leave
-- started_at < 2000-01-01, so the WHERE clause keeps finding them).
-- ---------------------------------------------------------------------------
SELECT diag('database:epoch-zero-session-repair-idempotent-rerun');

SELECT results_eq(
    $sql$
        SELECT group_a, group_b, group_c, skipped, progress_rows, pr_rows
          FROM private.repair_epoch_zero_sessions()
    $sql$,
    $sql$ VALUES (0, 0, 0, 2, 0, 0) $sql$,
    'second run: nothing left to repair; the two unrepairable rows are still reported skipped'
);

SELECT is(
    (SELECT started_at FROM public.workout_sessions WHERE id = 'c1000000-0000-4000-8000-0000000000a1'),
    '2023-11-14T22:13:20Z'::timestamptz,
    'second run: group A row unchanged by the re-run'
);

SELECT * FROM finish();

ROLLBACK;
