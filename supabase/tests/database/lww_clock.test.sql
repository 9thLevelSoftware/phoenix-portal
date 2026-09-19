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

-- Portal writes need EMBER (RLS).
INSERT INTO public.subscriptions (user_id, tier, status, current_period_end)
VALUES ('21212121-0000-4000-8000-000000000001'::uuid, 'EMBER', 'active', '2099-01-01+00');

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
SELECT results_eq(
    format(
        $sql$ SELECT accepted FROM public.merge_training_cycles_from_push(
                '21212121-0000-4000-8000-000000000001', %L::jsonb, true) $sql$,
        jsonb_build_array(jsonb_build_object(
            'id', '21212121-0000-4000-8000-0000000000c2', 'name', 'C2 older',
            'updated_at', now() - interval '15 minutes'))
    ),
    $v$ VALUES (false) $v$,
    'cycle (LWW on): an older write is rejected'
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

SELECT * FROM finish();
ROLLBACK;
