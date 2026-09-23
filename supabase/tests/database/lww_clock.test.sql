-- lww_clock pgTAP (KD-5, PR 21): client_updated_at is the LWW key, the
-- trigger-owned updated_at stays the pull cursor.
--   * backfill: client_updated_at = updated_at, updated_at untouched
--   * stamping: postgres/no-JWT and service-role writes leave the key alone,
--     authenticated (portal) writes stamp it
--   * LWW RPCs: a device clock behind the server can update after an
--     accepted write; an older write is rejected; server_updated_at is the
--     stored key
--   * merge_training_cycles_from_push compares and writes the key
--   * a portal notes edit still reaches the sessions pull RPC (#116)
--
-- now() is frozen for the whole transaction, so device clocks are explicit
-- offsets from it. Run locally with `supabase test db`.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;

SELECT no_plan();

SELECT diag('database:lww-clock-catalog');

SELECT has_column('public', 'workout_sessions', 'client_updated_at', 'workout_sessions.client_updated_at exists');
SELECT has_column('public', 'routines', 'client_updated_at', 'routines.client_updated_at exists');
SELECT has_column('public', 'training_cycles', 'client_updated_at', 'training_cycles.client_updated_at exists');
SELECT has_trigger('public', 'workout_sessions', 'workout_sessions_client_updated_at', 'sessions have the LWW key stamp trigger');
SELECT has_trigger('public', 'routines', 'routines_client_updated_at', 'routines have the LWW key stamp trigger');
SELECT has_trigger('public', 'training_cycles', 'training_cycles_client_updated_at', 'cycles have the LWW key stamp trigger');
SELECT has_trigger('public', 'workout_sessions', 'sessions_updated_at', 'the updated_at trigger is still in place');
SELECT is(
    (SELECT count(*)::int FROM pg_proc
     WHERE proname IN ('upsert_workout_session_lww', 'upsert_routine_lww',
                       'upsert_training_cycle_lww', 'merge_training_cycles_from_push')
       AND pronamespace = 'public'::regnamespace),
    4,
    'exactly one overload of each LWW function'
);
-- R-4: the sessions pull RPC has to hand the LWW key to the Edge so the
-- device's own just-pushed rows are compared device-clock to device-clock.
SELECT ok(
    pg_get_function_result(
        'public.get_sessions_excluding_ids(uuid,uuid[],text,timestamptz,uuid,int,timestamptz)'::regprocedure
    ) LIKE '%client_updated_at timestamp with time zone%',
    'get_sessions_excluding_ids returns client_updated_at beside updated_at (R-4)'
);
-- R-3/R-6: the merge reports both clocks, so the push response's
-- rejections[].serverUpdatedAt can be the LWW key for every entity while
-- cycleVersions stays on the server-clock updated_at.
SELECT ok(
    pg_get_function_result(
        'public.merge_training_cycles_from_push(uuid,jsonb,boolean)'::regprocedure
    ) LIKE '%client_updated_at timestamp with time zone%',
    'merge_training_cycles_from_push returns the stored LWW key separately (R-3/R-6)'
);

SELECT diag('database:lww-clock-privileges');

SELECT ok(
    NOT has_function_privilege('anon', 'public.upsert_workout_session_lww(jsonb)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.upsert_routine_lww(jsonb)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.upsert_workout_session_lww(jsonb)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.upsert_routine_lww(jsonb)', 'EXECUTE')
    AND has_function_privilege('service_role', 'public.upsert_workout_session_lww(jsonb)', 'EXECUTE')
    AND has_function_privilege('service_role', 'public.upsert_routine_lww(jsonb)', 'EXECUTE'),
    'session/routine LWW RPCs are service_role only (no anon/authenticated forging, PR 10 R-1)'
);
SELECT ok(
    NOT has_function_privilege('anon', 'public.merge_training_cycles_from_push(uuid, jsonb, boolean)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.merge_training_cycles_from_push(uuid, jsonb, boolean)', 'EXECUTE')
    AND has_function_privilege('service_role', 'public.merge_training_cycles_from_push(uuid, jsonb, boolean)', 'EXECUTE'),
    'merge_training_cycles_from_push stays service_role only'
);
SELECT ok(
    NOT has_function_privilege('anon', 'public.backfill_client_updated_at()', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.backfill_client_updated_at()', 'EXECUTE')
    AND NOT has_function_privilege('service_role', 'public.backfill_client_updated_at()', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.stamp_client_updated_at_portal_edit()', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.stamp_client_updated_at_portal_edit()', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.update_updated_at_column()', 'EXECUTE'),
    'backfill and trigger functions are not callable by API roles'
);

-- ---------------------------------------------------------------------------
-- Fixtures: pre-migration rows. Written as postgres with no request claims
-- (like the migration itself), with explicit historical updated_at values
-- and no LWW key, i.e. the state the migration's backfill starts from.
-- ---------------------------------------------------------------------------
INSERT INTO auth.users (id, email)
VALUES ('21212121-0000-4000-8000-000000000001'::uuid, 'lww-clock-owner@example.test')
ON CONFLICT (id) DO NOTHING;

-- Portal writes need FLAME (RLS).
INSERT INTO public.subscriptions (user_id, tier, status, current_period_end)
VALUES ('21212121-0000-4000-8000-000000000001'::uuid, 'FLAME', 'active', '2099-01-01+00');

INSERT INTO public.workout_sessions (id, user_id, name, started_at, updated_at)
VALUES
    ('21212121-0000-4000-8000-0000000000a1'::uuid, '21212121-0000-4000-8000-000000000001'::uuid,
     'S1', '2026-01-01+00', '2026-01-02 03:04:05.123456+00'),
    ('21212121-0000-4000-8000-0000000000a2'::uuid, '21212121-0000-4000-8000-000000000001'::uuid,
     'S2', '2026-01-01+00', '2026-01-03+00');
INSERT INTO public.routines (id, user_id, name, updated_at)
VALUES
    ('21212121-0000-4000-8000-0000000000b1'::uuid, '21212121-0000-4000-8000-000000000001'::uuid,
     'R1', '2026-01-04 01:02:03.654321+00');
INSERT INTO public.training_cycles (id, user_id, name, updated_at)
VALUES
    ('21212121-0000-4000-8000-0000000000c1'::uuid, '21212121-0000-4000-8000-000000000001'::uuid,
     'C1', '2026-01-05+00');

SELECT is(
    (SELECT count(*)::int FROM public.workout_sessions
     WHERE user_id = '21212121-0000-4000-8000-000000000001' AND client_updated_at IS NOT NULL),
    0,
    'a postgres insert without request claims does not stamp client_updated_at'
);

SELECT diag('database:lww-clock-backfill');

CREATE TEMP TABLE lww_pre_backfill ON COMMIT DROP AS
    SELECT 'workout_sessions'::text AS tbl, id, updated_at FROM public.workout_sessions WHERE client_updated_at IS NULL
    UNION ALL
    SELECT 'routines', id, updated_at FROM public.routines WHERE client_updated_at IS NULL
    UNION ALL
    SELECT 'training_cycles', id, updated_at FROM public.training_cycles WHERE client_updated_at IS NULL;

SELECT ok(
    (SELECT count(*) FROM lww_pre_backfill) >= 4,
    'the snapshot holds the pre-migration fixture rows'
);

-- The same function the migration runs.
SELECT public.backfill_client_updated_at();

CREATE TEMP TABLE lww_post_backfill ON COMMIT DROP AS
    SELECT 'workout_sessions'::text AS tbl, id, updated_at, client_updated_at FROM public.workout_sessions
    UNION ALL
    SELECT 'routines', id, updated_at, client_updated_at FROM public.routines
    UNION ALL
    SELECT 'training_cycles', id, updated_at, client_updated_at FROM public.training_cycles;

SELECT is(
    (SELECT count(*)::int FROM lww_pre_backfill p
     JOIN lww_post_backfill a USING (tbl, id)
     WHERE a.updated_at IS DISTINCT FROM p.updated_at),
    0,
    'the backfill leaves updated_at unchanged on every row (vs the pre-backfill snapshot)'
);
SELECT is(
    (SELECT count(*)::int FROM lww_pre_backfill p
     JOIN lww_post_backfill a USING (tbl, id)
     WHERE a.client_updated_at IS DISTINCT FROM p.updated_at),
    0,
    'after the backfill client_updated_at = updated_at for every pre-existing row'
);
SELECT is(
    (SELECT count(*)::int FROM lww_post_backfill WHERE client_updated_at IS NULL),
    0,
    'no row is left without an LWW key'
);
SELECT is(
    current_setting('phoenix.skip_updated_at', true) IS DISTINCT FROM 'on',
    true,
    'the backfill restores phoenix.skip_updated_at'
);

SELECT diag('database:lww-clock-stamping');

-- postgres, no JWT (a migration / operator fix): key unchanged, cursor moves.
SELECT set_config('request.jwt.claims', '', true);
UPDATE public.workout_sessions SET name = 'S1 fixed'
WHERE id = '21212121-0000-4000-8000-0000000000a1';
SELECT results_eq(
    $sql$ SELECT client_updated_at, updated_at FROM public.workout_sessions
          WHERE id = '21212121-0000-4000-8000-0000000000a1' $sql$,
    $values$ VALUES ('2026-01-02 03:04:05.123456+00'::timestamptz, now()) $values$,
    'an UPDATE as postgres with no JWT leaves client_updated_at unchanged (updated_at still moves)'
);

-- Service-role request (an Edge push): key unchanged.
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
UPDATE public.routines SET name = 'R1 service'
WHERE id = '21212121-0000-4000-8000-0000000000b1';
SELECT is(
    (SELECT client_updated_at FROM public.routines WHERE id = '21212121-0000-4000-8000-0000000000b1'),
    '2026-01-04 01:02:03.654321+00'::timestamptz,
    'a service-role UPDATE leaves client_updated_at unchanged'
);

-- Portal (authenticated) request: key stamped.
SET LOCAL ROLE authenticated;
SELECT set_config(
    'request.jwt.claims',
    '{"sub":"21212121-0000-4000-8000-000000000001","role":"authenticated"}',
    true
);
UPDATE public.workout_sessions SET notes = 'portal note'
WHERE id = '21212121-0000-4000-8000-0000000000a2';
UPDATE public.routines SET name = 'R1 portal'
WHERE id = '21212121-0000-4000-8000-0000000000b1';
UPDATE public.training_cycles SET name = 'C1 portal'
WHERE id = '21212121-0000-4000-8000-0000000000c1';
RESET ROLE;
SELECT results_eq(
    $sql$ SELECT client_updated_at, updated_at FROM public.workout_sessions
          WHERE id = '21212121-0000-4000-8000-0000000000a2' $sql$,
    $values$ VALUES (now(), now()) $values$,
    'an authenticated UPDATE (portal notes edit) stamps client_updated_at'
);
SELECT is(
    (SELECT client_updated_at FROM public.routines WHERE id = '21212121-0000-4000-8000-0000000000b1'),
    now(),
    'an authenticated routine UPDATE stamps client_updated_at'
);
SELECT is(
    (SELECT client_updated_at FROM public.training_cycles WHERE id = '21212121-0000-4000-8000-0000000000c1'),
    now(),
    'an authenticated cycle UPDATE stamps client_updated_at'
);

-- Portal with the backfill GUC on: no stamp.
SET LOCAL ROLE authenticated;
SELECT set_config('phoenix.skip_updated_at', 'on', true);
UPDATE public.workout_sessions SET notes = 'quiet'
WHERE id = '21212121-0000-4000-8000-0000000000a1';
SELECT set_config('phoenix.skip_updated_at', 'off', true);
RESET ROLE;
SELECT is(
    (SELECT client_updated_at FROM public.workout_sessions WHERE id = '21212121-0000-4000-8000-0000000000a1'),
    '2026-01-02 03:04:05.123456+00'::timestamptz,
    'phoenix.skip_updated_at = on suppresses the stamp'
);

-- The INSERT arm of the stamp trigger (R-8). Rewriting the three triggers as
-- BEFORE UPDATE left the whole suite green: nothing exercised an INSERT.
-- Combined with R-14: a writer that supplies its own client_updated_at (the
-- forging attempt the trigger exists to stop) must not keep it.

-- postgres / no JWT first: an operator fix or a migration keeps its value.
SELECT set_config('request.jwt.claims', '', true);
INSERT INTO public.routines (id, user_id, name, updated_at, client_updated_at)
VALUES ('21212121-0000-4000-8000-0000000000b7'::uuid, '21212121-0000-4000-8000-000000000001'::uuid,
        'R operator insert', '2026-01-04+00', '2026-01-04+00');
SELECT is(
    (SELECT client_updated_at FROM public.routines WHERE id = '21212121-0000-4000-8000-0000000000b7'),
    '2026-01-04+00'::timestamptz,
    'a postgres INSERT with no JWT keeps the supplied client_updated_at'
);

-- authenticated (portal) INSERT: stamped now(), whatever was supplied.
SELECT set_config(
    'request.jwt.claims',
    '{"sub":"21212121-0000-4000-8000-000000000001","role":"authenticated"}',
    true
);
SET LOCAL ROLE authenticated;
-- Sessions are server-written only: the forged-key INSERT never lands.
SELECT throws_ok(
    $$ INSERT INTO public.workout_sessions (id, user_id, name, started_at, updated_at, client_updated_at)
       VALUES ('21212121-0000-4000-8000-0000000000a8'::uuid, '21212121-0000-4000-8000-000000000001'::uuid,
               'S portal insert', '2026-01-01+00', now() - interval '1 day', '9999-01-01+00') $$,
    '42501',
    NULL,
    'session: an authenticated INSERT with a forged client_updated_at is refused (sessions are server-written)'
);
INSERT INTO public.routines (id, user_id, name, updated_at, client_updated_at)
VALUES ('21212121-0000-4000-8000-0000000000b8'::uuid, '21212121-0000-4000-8000-000000000001'::uuid,
        'R portal insert', now() - interval '1 day', '9999-01-01+00');
INSERT INTO public.training_cycles (id, user_id, name, updated_at, client_updated_at)
VALUES ('21212121-0000-4000-8000-0000000000c8'::uuid, '21212121-0000-4000-8000-000000000001'::uuid,
        'C portal insert', now() - interval '1 day', '9999-01-01+00');
-- An authenticated UPDATE that forges the key (R-14). Only the key column is
-- touched, so R1's name stays 'R1 portal' for the routine RPC block below.
UPDATE public.routines SET client_updated_at = '9999-01-01+00'
WHERE id = '21212121-0000-4000-8000-0000000000b1';
RESET ROLE;
SELECT is(
    (SELECT client_updated_at FROM public.routines WHERE id = '21212121-0000-4000-8000-0000000000b8'),
    now(),
    'routine: an authenticated INSERT stamps client_updated_at over a forged far-future value (R-8/R-14)'
);
SELECT is(
    (SELECT client_updated_at FROM public.training_cycles WHERE id = '21212121-0000-4000-8000-0000000000c8'),
    now(),
    'cycle: an authenticated INSERT stamps client_updated_at over a forged far-future value (R-8/R-14)'
);
SELECT is(
    (SELECT client_updated_at FROM public.routines WHERE id = '21212121-0000-4000-8000-0000000000b1'),
    now(),
    'routine: an authenticated UPDATE cannot forge client_updated_at (R-14)'
);

SELECT diag('database:lww-clock-pull-116');

-- The portal notes edit moved the pull cursor, so an incremental pull that
-- already knows the session still returns it.
SELECT is(
    (SELECT notes FROM public.get_sessions_excluding_ids(
        '21212121-0000-4000-8000-000000000001'::uuid,
        ARRAY['21212121-0000-4000-8000-0000000000a1'::uuid, '21212121-0000-4000-8000-0000000000a2'::uuid],
        NULL, NULL, NULL, 76, now() - interval '1 minute')
     WHERE id = '21212121-0000-4000-8000-0000000000a2'),
    'portal note',
    'pull still returns a portal notes edit to a device that knows the session (#116)'
);

SELECT diag('database:lww-clock-session-rpc');

SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);

-- A device whose clock is 10 minutes behind the server. First write
-- (device time now-20m) is accepted and the server trigger moves updated_at
-- to now(). Its next edit (device time now-10m) must be accepted: at HEAD
-- the RPC compared it with updated_at (now()) and rejected it.
SELECT results_eq(
    format(
        $sql$ SELECT accepted, server_updated_at FROM public.upsert_workout_session_lww(%L::jsonb) $sql$,
        jsonb_build_array(jsonb_build_object(
            'id', '21212121-0000-4000-8000-0000000000a1',
            'user_id', '21212121-0000-4000-8000-000000000001',
            'name', 'device v1', 'started_at', '2026-01-01T00:00:00Z',
            'updated_at', now() - interval '20 minutes'))
    ),
    format($v$ VALUES (true, %L::timestamptz) $v$, now() - interval '20 minutes'),
    'session: first device write accepted, server_updated_at is the stored key'
);
SELECT results_eq(
    $sql$ SELECT updated_at, client_updated_at FROM public.workout_sessions
          WHERE id = '21212121-0000-4000-8000-0000000000a1' $sql$,
    $values$ VALUES (now(), now() - interval '20 minutes') $values$,
    'session: updated_at is the server write time, client_updated_at the device time'
);
SELECT results_eq(
    format(
        $sql$ SELECT accepted, server_updated_at FROM public.upsert_workout_session_lww(%L::jsonb) $sql$,
        jsonb_build_array(jsonb_build_object(
            'id', '21212121-0000-4000-8000-0000000000a1',
            'user_id', '21212121-0000-4000-8000-000000000001',
            'name', 'device v2', 'started_at', '2026-01-01T00:00:00Z',
            'updated_at', now() - interval '10 minutes'))
    ),
    format($v$ VALUES (true, %L::timestamptz) $v$, now() - interval '10 minutes'),
    'session: a device 10 minutes behind the server can update after an accepted write'
);
SELECT results_eq(
    format(
        $sql$ SELECT accepted, server_updated_at FROM public.upsert_workout_session_lww(%L::jsonb) $sql$,
        jsonb_build_array(jsonb_build_object(
            'id', '21212121-0000-4000-8000-0000000000a1',
            'user_id', '21212121-0000-4000-8000-000000000001',
            'name', 'older write', 'started_at', '2026-01-01T00:00:00Z',
            'updated_at', now() - interval '15 minutes'))
    ),
    format($v$ VALUES (false, %L::timestamptz) $v$, now() - interval '10 minutes'),
    'session: an older write is rejected and reports the stored key'
);
SELECT is(
    (SELECT name FROM public.workout_sessions WHERE id = '21212121-0000-4000-8000-0000000000a1'),
    'device v2',
    'session: the rejected write changed nothing'
);

-- The idempotent equal-key re-push (spec: "including an unchanged re-push";
-- summary decision 2). Tightening the guard to `<` left the suite green
-- because every other session stamp here is strictly ordered; with `<` a
-- device re-pushing its own unchanged row would get a spurious rejection and
-- treat its own data as stale.
SELECT results_eq(
    format(
        $sql$ SELECT accepted, server_updated_at FROM public.upsert_workout_session_lww(%L::jsonb) $sql$,
        jsonb_build_array(jsonb_build_object(
            'id', '21212121-0000-4000-8000-0000000000a1',
            'user_id', '21212121-0000-4000-8000-000000000001',
            'name', 'device v2', 'started_at', '2026-01-01T00:00:00Z',
            'updated_at', now() - interval '10 minutes'))
    ),
    format($v$ VALUES (true, %L::timestamptz) $v$, now() - interval '10 minutes'),
    'session: an equal key is accepted (idempotent re-push)'
);
SELECT results_eq(
    $sql$ SELECT name, updated_at, client_updated_at FROM public.workout_sessions
          WHERE id = '21212121-0000-4000-8000-0000000000a1' $sql$,
    format($v$ VALUES ('device v2'::text, now(), %L::timestamptz) $v$, now() - interval '10 minutes'),
    'session: the equal-key re-push leaves both clocks where they were'
);

-- R-4: the pull RPC hands the Edge both clocks. The Edge reports
-- client_updated_at to the device as the session's updatedAt (so the device
-- compares its own clock with its own clock and never overwrites its
-- freshly pushed row with the lossy pull projection), while updated_at
-- stays the cursor and the ordering key.
SELECT results_eq(
    $sql$ SELECT updated_at, client_updated_at FROM public.get_sessions_excluding_ids(
              '21212121-0000-4000-8000-000000000001'::uuid,
              ARRAY[]::uuid[], NULL, NULL, NULL, 76, NULL)
          WHERE id = '21212121-0000-4000-8000-0000000000a1' $sql$,
    format($v$ VALUES (now(), %L::timestamptz) $v$, now() - interval '10 minutes'),
    'sessions pull RPC (R-4): the server cursor and the device LWW key are reported separately'
);

-- The portal notes edit (key = now()) beats a device stamped earlier,
-- including an unchanged re-push of the device's last version.
SELECT results_eq(
    format(
        $sql$ SELECT accepted FROM public.upsert_workout_session_lww(%L::jsonb) $sql$,
        jsonb_build_array(jsonb_build_object(
            'id', '21212121-0000-4000-8000-0000000000a2',
            'user_id', '21212121-0000-4000-8000-000000000001',
            'name', 'S2', 'notes', NULL, 'started_at', '2026-01-01T00:00:00Z',
            'updated_at', now() - interval '1 minute'))
    ),
    $v$ VALUES (false) $v$,
    'session: a device push stamped before the portal edit is rejected'
);
SELECT is(
    (SELECT notes FROM public.workout_sessions WHERE id = '21212121-0000-4000-8000-0000000000a2'),
    'portal note',
    'session: the portal notes edit survives'
);

-- Brand new row: accepted with the device key.
SELECT results_eq(
    format(
        $sql$ SELECT accepted, server_updated_at FROM public.upsert_workout_session_lww(%L::jsonb) $sql$,
        jsonb_build_array(jsonb_build_object(
            'id', '21212121-0000-4000-8000-0000000000a3',
            'user_id', '21212121-0000-4000-8000-000000000001',
            'name', 'new', 'started_at', '2026-01-01T00:00:00Z',
            'updated_at', '2026-02-01T00:00:00Z'))
    ),
    $v$ VALUES (true, '2026-02-01T00:00:00Z'::timestamptz) $v$,
    'session: a new row is inserted with the device key'
);
SELECT results_eq(
    $sql$ SELECT updated_at, client_updated_at FROM public.workout_sessions
          WHERE id = '21212121-0000-4000-8000-0000000000a3' $sql$,
    $values$ VALUES (now(), '2026-02-01T00:00:00Z'::timestamptz) $values$,
    'session (NF-12): a new row''s pull cursor is the server clock, the device time is only the key'
);

SELECT diag('database:lww-clock-routine-rpc');

SELECT results_eq(
    format(
        $sql$ SELECT accepted, server_updated_at FROM public.upsert_routine_lww(%L::jsonb) $sql$,
        jsonb_build_array(jsonb_build_object(
            'id', '21212121-0000-4000-8000-0000000000b1',
            'user_id', '21212121-0000-4000-8000-000000000001',
            'name', 'stale phone', 'updated_at', now() - interval '1 minute'))
    ),
    format($v$ VALUES (false, %L::timestamptz) $v$, now()),
    'routine: a push stamped before the portal edit is rejected with the stored key'
);
SELECT is(
    (SELECT name FROM public.routines WHERE id = '21212121-0000-4000-8000-0000000000b1'),
    'R1 portal',
    'routine: the portal edit survives'
);
SELECT results_eq(
    format(
        $sql$ SELECT accepted, server_updated_at FROM public.upsert_routine_lww(%L::jsonb) $sql$,
        jsonb_build_array(jsonb_build_object(
            'id', '21212121-0000-4000-8000-0000000000b1',
            'user_id', '21212121-0000-4000-8000-000000000001',
            'name', 'newer phone', 'updated_at', now() + interval '1 minute'))
    ),
    format($v$ VALUES (true, %L::timestamptz) $v$, now() + interval '1 minute'),
    'routine: a later device edit is accepted and reports the stored key'
);
SELECT results_eq(
    format(
        $sql$ SELECT accepted FROM public.upsert_routine_lww(%L::jsonb) $sql$,
        jsonb_build_array(jsonb_build_object(
            'id', '21212121-0000-4000-8000-0000000000b1',
            'user_id', '21212121-0000-4000-8000-000000000001',
            'name', 'same-time phone', 'updated_at', now() + interval '1 minute'))
    ),
    $v$ VALUES (true) $v$,
    'routine: an equal key is accepted (idempotent re-push)'
);
SELECT results_eq(
    format(
        $sql$ SELECT accepted, server_updated_at FROM public.upsert_routine_lww(%L::jsonb) $sql$,
        jsonb_build_array(jsonb_build_object(
            'id', '21212121-0000-4000-8000-0000000000b2',
            'user_id', '21212121-0000-4000-8000-000000000001',
            'name', 'slow-clock new', 'updated_at', now() - interval '10 minutes'))
    ),
    format($v$ VALUES (true, %L::timestamptz) $v$, now() - interval '10 minutes'),
    'routine: a new row from a slow device clock is accepted with the device key'
);
SELECT is(
    (SELECT updated_at FROM public.routines WHERE id = '21212121-0000-4000-8000-0000000000b2'),
    now(),
    'routine (NF-12): a new row''s pull cursor is the server clock'
);

-- R-10: the routine RPC must compare the LWW key, not the server write
-- clock. Reverting its guard to `r.updated_at <= EXCLUDED.client_updated_at`
-- (the HEAD bug) left pgTAP green because no routine case updated twice
-- from a slow device clock. This mirrors the session sequence above.
SELECT results_eq(
    format(
        $sql$ SELECT accepted, server_updated_at FROM public.upsert_routine_lww(%L::jsonb) $sql$,
        jsonb_build_array(jsonb_build_object(
            'id', '21212121-0000-4000-8000-0000000000b3',
            'user_id', '21212121-0000-4000-8000-000000000001',
            'name', 'b3 v1', 'updated_at', now() - interval '20 minutes'))
    ),
    format($v$ VALUES (true, %L::timestamptz) $v$, now() - interval '20 minutes'),
    'routine: first write from a device 20 minutes behind is accepted'
);
SELECT is(
    (SELECT updated_at FROM public.routines WHERE id = '21212121-0000-4000-8000-0000000000b3'),
    now(),
    'routine: the accepted write moved the server clock to now()'
);
SELECT results_eq(
    format(
        $sql$ SELECT accepted, server_updated_at FROM public.upsert_routine_lww(%L::jsonb) $sql$,
        jsonb_build_array(jsonb_build_object(
            'id', '21212121-0000-4000-8000-0000000000b3',
            'user_id', '21212121-0000-4000-8000-000000000001',
            'name', 'b3 v2', 'updated_at', now() - interval '10 minutes'))
    ),
    format($v$ VALUES (true, %L::timestamptz) $v$, now() - interval '10 minutes'),
    'routine: a device 10 minutes behind the server can update after an accepted write'
);
SELECT results_eq(
    format(
        $sql$ SELECT accepted, server_updated_at FROM public.upsert_routine_lww(%L::jsonb) $sql$,
        jsonb_build_array(jsonb_build_object(
            'id', '21212121-0000-4000-8000-0000000000b3',
            'user_id', '21212121-0000-4000-8000-000000000001',
            'name', 'b3 older', 'updated_at', now() - interval '15 minutes'))
    ),
    format($v$ VALUES (false, %L::timestamptz) $v$, now() - interval '10 minutes'),
    'routine: an older write is rejected and reports the stored key'
);
SELECT is(
    (SELECT name FROM public.routines WHERE id = '21212121-0000-4000-8000-0000000000b3'),
    'b3 v2',
    'routine: the rejected write changed nothing'
);

SELECT diag('database:lww-clock-cross-user');

-- R-13: the ON CONFLICT guard must re-check ownership. The Edge's
-- assertRowsOwnedByUser pre-check runs in a separate round trip, so a row
-- created by another user between the check and the RPC would otherwise be
-- overwritten while user_id stayed the victim's. The RPCs run as
-- service_role, so RLS does not cover this.
INSERT INTO auth.users (id, email)
VALUES ('21212121-0000-4000-8000-000000000002'::uuid, 'lww-clock-other@example.test')
ON CONFLICT (id) DO NOTHING;

SELECT results_eq(
    format(
        $sql$ SELECT accepted, server_updated_at FROM public.upsert_workout_session_lww(%L::jsonb) $sql$,
        jsonb_build_array(jsonb_build_object(
            'id', '21212121-0000-4000-8000-0000000000a1',
            'user_id', '21212121-0000-4000-8000-000000000002',
            'name', 'takeover', 'started_at', '2026-01-01T00:00:00Z',
            'updated_at', now() + interval '1 day'))
    ),
    $v$ VALUES (false, NULL::timestamptz) $v$,
    'session: an upsert of another user''s id is rejected and leaks no key (R-13)'
);
SELECT results_eq(
    $sql$ SELECT name, user_id FROM public.workout_sessions
          WHERE id = '21212121-0000-4000-8000-0000000000a1' $sql$,
    $v$ VALUES ('device v2'::text, '21212121-0000-4000-8000-000000000001'::uuid) $v$,
    'session: the victim''s row is untouched by the cross-user upsert (R-13)'
);
SELECT results_eq(
    format(
        $sql$ SELECT accepted, server_updated_at FROM public.upsert_routine_lww(%L::jsonb) $sql$,
        jsonb_build_array(jsonb_build_object(
            'id', '21212121-0000-4000-8000-0000000000b3',
            'user_id', '21212121-0000-4000-8000-000000000002',
            'name', 'takeover', 'updated_at', now() + interval '1 day'))
    ),
    $v$ VALUES (false, NULL::timestamptz) $v$,
    'routine: an upsert of another user''s id is rejected and leaks no key (R-13)'
);
SELECT results_eq(
    $sql$ SELECT name, user_id FROM public.routines
          WHERE id = '21212121-0000-4000-8000-0000000000b3' $sql$,
    $v$ VALUES ('b3 v2'::text, '21212121-0000-4000-8000-000000000001'::uuid) $v$,
    'routine: the victim''s row is untouched by the cross-user upsert (R-13)'
);

SELECT diag('database:lww-clock-cycle-merge');

-- LWW on: compared against the key (portal edit = now()), not updated_at.
SELECT results_eq(
    format(
        $sql$ SELECT accepted, server_updated_at FROM public.merge_training_cycles_from_push(
                '21212121-0000-4000-8000-000000000001', %L::jsonb, true) $sql$,
        jsonb_build_array(jsonb_build_object(
            'id', '21212121-0000-4000-8000-0000000000c1', 'name', 'stale phone',
            'updated_at', now() - interval '1 minute'))
    ),
    format($v$ VALUES (false, %L::timestamptz) $v$, now()),
    'cycle (LWW on): a push stamped before the portal edit is rejected'
);
SELECT is(
    (SELECT name FROM public.training_cycles WHERE id = '21212121-0000-4000-8000-0000000000c1'),
    'C1 portal',
    'cycle (LWW on): the portal edit survives'
);

-- Cycle c2: service-role seed, then a behind-clock device.
INSERT INTO public.training_cycles (id, user_id, name, updated_at, client_updated_at)
VALUES ('21212121-0000-4000-8000-0000000000c2'::uuid, '21212121-0000-4000-8000-000000000001'::uuid,
        'C2', '2026-01-01+00', '2026-01-01+00');
SELECT results_eq(
    format(
        $sql$ SELECT accepted FROM public.merge_training_cycles_from_push(
                '21212121-0000-4000-8000-000000000001', %L::jsonb, true) $sql$,
        jsonb_build_array(jsonb_build_object(
            'id', '21212121-0000-4000-8000-0000000000c2', 'name', 'C2 v1',
            'updated_at', now() - interval '20 minutes'))
    ),
    $v$ VALUES (true) $v$,
    'cycle (LWW on): first device write accepted'
);
SELECT results_eq(
    $sql$ SELECT updated_at, client_updated_at FROM public.training_cycles
          WHERE id = '21212121-0000-4000-8000-0000000000c2' $sql$,
    $values$ VALUES (now(), now() - interval '20 minutes') $values$,
    'cycle: the merge writes the device key; updated_at is the server write time'
);
SELECT results_eq(
    format(
        $sql$ SELECT accepted FROM public.merge_training_cycles_from_push(
                '21212121-0000-4000-8000-000000000001', %L::jsonb, true) $sql$,
        jsonb_build_array(jsonb_build_object(
            'id', '21212121-0000-4000-8000-0000000000c2', 'name', 'C2 v2',
            'updated_at', now() - interval '10 minutes'))
    ),
    $v$ VALUES (true) $v$,
    'cycle (LWW on): a device 10 minutes behind the server can update after an accepted write'
);
-- R-3/R-6: the rejection reports BOTH clocks. server_updated_at stays the
-- stored server-clock updated_at (cycleVersions / baseUpdatedAt, KD-6) and
-- client_updated_at is the stored LWW key, which is what the Edge puts in
-- rejections[].serverUpdatedAt for every entity.
SELECT results_eq(
    format(
        $sql$ SELECT accepted, server_updated_at, client_updated_at
                FROM public.merge_training_cycles_from_push(
                '21212121-0000-4000-8000-000000000001', %L::jsonb, true) $sql$,
        jsonb_build_array(jsonb_build_object(
            'id', '21212121-0000-4000-8000-0000000000c2', 'name', 'C2 older',
            'updated_at', now() - interval '15 minutes'))
    ),
    format($v$ VALUES (false, now(), %L::timestamptz) $v$, now() - interval '10 minutes'),
    'cycle (LWW on): an older write is rejected, reporting the server cursor and the stored LWW key'
);
SELECT is(
    (SELECT name FROM public.training_cycles WHERE id = '21212121-0000-4000-8000-0000000000c2'),
    'C2 v2',
    'cycle (LWW on): the rejected write changed nothing'
);

-- LWW off: the push wins and still writes the key, so the key is correct
-- the day the flag flips.
SELECT results_eq(
    format(
        $sql$ SELECT accepted FROM public.merge_training_cycles_from_push(
                '21212121-0000-4000-8000-000000000001', %L::jsonb, false) $sql$,
        jsonb_build_array(jsonb_build_object(
            'id', '21212121-0000-4000-8000-0000000000c2', 'name', 'C2 off',
            'updated_at', now() - interval '30 minutes'))
    ),
    $v$ VALUES (true) $v$,
    'cycle (LWW off): an older push still applies'
);
SELECT is(
    (SELECT client_updated_at FROM public.training_cycles WHERE id = '21212121-0000-4000-8000-0000000000c2'),
    now() - interval '30 minutes',
    'cycle (LWW off): the merge writes the pushed key'
);
SELECT results_eq(
    format(
        $sql$ SELECT accepted FROM public.merge_training_cycles_from_push(
                '21212121-0000-4000-8000-000000000001', %L::jsonb, false) $sql$,
        jsonb_build_array(jsonb_build_object(
            'id', '21212121-0000-4000-8000-0000000000c9', 'name', 'C9 new',
            'updated_at', '2026-03-01T00:00:00Z'))
    ),
    $v$ VALUES (true) $v$,
    'cycle (LWW off): a new cycle is inserted'
);
SELECT is(
    (SELECT client_updated_at FROM public.training_cycles WHERE id = '21212121-0000-4000-8000-0000000000c9'),
    '2026-03-01T00:00:00Z'::timestamptz,
    'cycle (LWW off): a new cycle stores the pushed key'
);
SELECT is(
    (SELECT updated_at FROM public.training_cycles WHERE id = '21212121-0000-4000-8000-0000000000c9'),
    now(),
    'cycle (NF-12): a new cycle''s pull cursor is the server clock'
);

SELECT diag('database:lww-clock-skew-window');

-- R-2: a device whose clock trails the server, that has ALREADY pulled the
-- portal edit, must not lose its genuinely newer edit to the skew window.
-- Cycles carry base_updated_at, so the case is distinguishable: the stored
-- key IS the portal stamp (client_updated_at = portal_edited_at) and the
-- push's base is at or after it. Sessions and routines have no base and
-- keep the window (documented on the RPCs).
INSERT INTO public.training_cycles (id, user_id, name, updated_at, client_updated_at)
VALUES
    ('21212121-0000-4000-8000-0000000000c3'::uuid, '21212121-0000-4000-8000-000000000001'::uuid,
     'C3', now() - interval '2 hours', now() - interval '2 hours'),
    ('21212121-0000-4000-8000-0000000000c4'::uuid, '21212121-0000-4000-8000-000000000001'::uuid,
     'C4', now() - interval '2 hours', now() - interval '2 hours');

SELECT set_config(
    'request.jwt.claims',
    '{"sub":"21212121-0000-4000-8000-000000000001","role":"authenticated"}',
    true
);
SET LOCAL ROLE authenticated;
UPDATE public.training_cycles SET name = 'C3 portal'
WHERE id = '21212121-0000-4000-8000-0000000000c3';
UPDATE public.training_cycles SET name = 'C4 portal'
WHERE id = '21212121-0000-4000-8000-0000000000c4';
RESET ROLE;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);

SELECT results_eq(
    $sql$ SELECT client_updated_at = portal_edited_at FROM public.training_cycles
          WHERE id = '21212121-0000-4000-8000-0000000000c3' $sql$,
    $v$ VALUES (true) $v$,
    'cycle: a portal edit stamps the LWW key and portal_edited_at with the same now()'
);
SELECT results_eq(
    format(
        $sql$ SELECT accepted, structure_applied FROM public.merge_training_cycles_from_push(
                '21212121-0000-4000-8000-000000000001', %L::jsonb, true) $sql$,
        jsonb_build_array(jsonb_build_object(
            'id', '21212121-0000-4000-8000-0000000000c3', 'name', 'C3 phone',
            'updated_at', now() - interval '9 minutes',
            'base_updated_at', now()))
    ),
    $v$ VALUES (true, true) $v$,
    'cycle (R-2): a slow-clock push whose base already includes the portal edit is accepted'
);
SELECT is(
    (SELECT name FROM public.training_cycles WHERE id = '21212121-0000-4000-8000-0000000000c3'),
    'C3 phone',
    'cycle (R-2): the device''s newer edit is applied'
);
SELECT results_eq(
    format(
        $sql$ SELECT accepted FROM public.merge_training_cycles_from_push(
                '21212121-0000-4000-8000-000000000001', %L::jsonb, true) $sql$,
        jsonb_build_array(jsonb_build_object(
            'id', '21212121-0000-4000-8000-0000000000c4', 'name', 'C4 phone',
            'updated_at', now() - interval '9 minutes',
            'base_updated_at', now() - interval '1 hour'))
    ),
    $v$ VALUES (false) $v$,
    'cycle (R-2): a push whose base predates the portal edit is still rejected'
);
SELECT is(
    (SELECT name FROM public.training_cycles WHERE id = '21212121-0000-4000-8000-0000000000c4'),
    'C4 portal',
    'cycle (R-2): the portal edit survives a genuinely stale push'
);

-- A row the backfill never reached: portal_edited_at set, client_updated_at
-- still NULL. Without the COALESCE around v_knows_portal_edit the `=`
-- comparison yields NULL, the whole IF condition becomes NULL, plpgsql
-- treats it as false and the LWW gate is skipped for every such row.
INSERT INTO public.training_cycles (id, user_id, name, updated_at, client_updated_at, portal_edited_at)
VALUES ('21212121-0000-4000-8000-0000000000c5'::uuid, '21212121-0000-4000-8000-000000000001'::uuid,
        'C5 portal', now(), NULL, now());
SELECT results_eq(
    format(
        $sql$ SELECT accepted FROM public.merge_training_cycles_from_push(
                '21212121-0000-4000-8000-000000000001', %L::jsonb, true) $sql$,
        jsonb_build_array(jsonb_build_object(
            'id', '21212121-0000-4000-8000-0000000000c5', 'name', 'C5 phone',
            'updated_at', now() - interval '9 minutes',
            'base_updated_at', now()))
    ),
    $v$ VALUES (false) $v$,
    'cycle (R-2): a NULL LWW key falls back to updated_at and the gate still rejects'
);
SELECT is(
    (SELECT name FROM public.training_cycles WHERE id = '21212121-0000-4000-8000-0000000000c5'),
    'C5 portal',
    'cycle (R-2): the NULL-key row is unchanged'
);

-- The millisecond truncation is load-bearing, and a now()-based case cannot
-- see it: a real device sends back the base it PULLED, at millisecond
-- precision, while portal_edited_at is stored at microsecond precision. With
-- a bare `v_base >= v_existing.portal_edited_at` the escape stops firing for
-- every real device — R-2 would silently revert to "not addressed" in
-- production while this suite stayed green. PR 18 carries the same pin for
-- the staleness rule (integration: cycle merge … a base truncated to
-- milliseconds that equals the stored version is current). Explicit
-- timestamps, so the sub-millisecond digits are never accidentally zero.
INSERT INTO public.training_cycles
    (id, user_id, name, updated_at, client_updated_at, portal_edited_at)
VALUES ('21212121-0000-4000-8000-0000000000c6'::uuid, '21212121-0000-4000-8000-000000000001'::uuid,
        'C6 portal',
        '2026-09-20 10:00:00.123456+00', '2026-09-20 10:00:00.123456+00',
        '2026-09-20 10:00:00.123456+00');
SELECT results_eq(
    format(
        $sql$ SELECT accepted, structure_applied FROM public.merge_training_cycles_from_push(
                '21212121-0000-4000-8000-000000000001', %L::jsonb, true) $sql$,
        jsonb_build_array(jsonb_build_object(
            'id', '21212121-0000-4000-8000-0000000000c6', 'name', 'C6 phone',
            -- The device's clock is nine minutes behind the portal edit.
            'updated_at', '2026-09-20T09:51:00Z',
            -- The base as a device round-trips it: millisecond precision.
            'base_updated_at', '2026-09-20T10:00:00.123Z'))
    ),
    $v$ VALUES (true, true) $v$,
    'cycle (R-2): a millisecond-truncated base equal to portal_edited_at still clears the LWW gate'
);
SELECT is(
    (SELECT name FROM public.training_cycles WHERE id = '21212121-0000-4000-8000-0000000000c6'),
    'C6 phone',
    'cycle (R-2): the device edit behind a ms-truncated base is applied'
);

SELECT diag('database:lww-clock-owner-immutable');

-- R-13 on the SHIPPING path. SYNC_LWW_ENABLED defaults to false, so the
-- default push path is a service-role PostgREST upsert that never reaches
-- the guarded LWW RPCs and writes user_id as well — a cross-user id in the
-- TOCTOU window would change the row's OWNER, not just its contents.
-- PostgREST cannot express the predicate, so the guard is a DB trigger and
-- covers every writer. The session claims here are service_role, i.e. the
-- push's own identity.
SELECT throws_ok(
    $sql$ UPDATE public.workout_sessions
             SET user_id = '21212121-0000-4000-8000-000000000002'::uuid,
                 name = 'takeover'
           WHERE id = '21212121-0000-4000-8000-0000000000a1' $sql$,
    '42501', NULL,
    'session: a service-role UPDATE that moves the row to another user is refused (R-13)'
);
SELECT throws_ok(
    $sql$ UPDATE public.routines
             SET user_id = '21212121-0000-4000-8000-000000000002'::uuid,
                 name = 'takeover'
           WHERE id = '21212121-0000-4000-8000-0000000000b3' $sql$,
    '42501', NULL,
    'routine: a service-role UPDATE that moves the row to another user is refused (R-13)'
);
SELECT throws_ok(
    $sql$ UPDATE public.training_cycles
             SET user_id = '21212121-0000-4000-8000-000000000002'::uuid,
                 name = 'takeover'
           WHERE id = '21212121-0000-4000-8000-0000000000c1' $sql$,
    '42501', NULL,
    'cycle: a service-role UPDATE that moves the row to another user is refused (R-13)'
);
SELECT results_eq(
    $sql$ SELECT name, user_id FROM public.workout_sessions
          WHERE id = '21212121-0000-4000-8000-0000000000a1' $sql$,
    $v$ VALUES ('device v2'::text, '21212121-0000-4000-8000-000000000001'::uuid) $v$,
    'session: the refused takeover left the victim''s row untouched'
);
SELECT results_eq(
    $sql$ SELECT name, user_id FROM public.routines
          WHERE id = '21212121-0000-4000-8000-0000000000b3' $sql$,
    $v$ VALUES ('b3 v2'::text, '21212121-0000-4000-8000-000000000001'::uuid) $v$,
    'routine: the refused takeover left the victim''s row untouched'
);

-- No false positives: an ordinary UPDATE that leaves user_id alone still
-- works (the push's own writes go through this trigger on every row).
UPDATE public.workout_sessions SET name = 'still editable'
WHERE id = '21212121-0000-4000-8000-0000000000a1';
SELECT is(
    (SELECT name FROM public.workout_sessions WHERE id = '21212121-0000-4000-8000-0000000000a1'),
    'still editable',
    'session: an UPDATE that keeps user_id is unaffected by the owner guard'
);

SELECT * FROM finish();
ROLLBACK;
