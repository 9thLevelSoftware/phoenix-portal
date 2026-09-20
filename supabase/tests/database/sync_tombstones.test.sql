-- sync_tombstones pgTAP (KD-4, PR 16): the AFTER DELETE triggers on routines
-- and training_cycles, the account-deletion guard, get_sync_tombstones, and
-- the table/function privileges.
--
-- Follows supabase/tests/database/profile_preferences.test.sql.
-- Run locally with `supabase test db`.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;

SELECT no_plan();

SELECT diag('database:sync-tombstones-catalog');

SELECT has_table('public', 'sync_tombstones', 'sync_tombstones exists');
SELECT has_column(
    'public', 'routines', 'created_at',
    'routines.created_at exists (written by upsert_routine_lww)'
);
SELECT col_is_pk(
    'public', 'sync_tombstones', ARRAY['user_id', 'entity', 'entity_id'],
    'primary key is (user_id, entity, entity_id)'
);
SELECT ok(
    NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.sync_tombstones'::regclass AND contype = 'f'
    ),
    'sync_tombstones has no foreign key (the trigger can fire during an account cascade)'
);
SELECT ok(
    (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.sync_tombstones'::regclass),
    'RLS is enabled on sync_tombstones'
);
SELECT has_trigger('public', 'routines', 'routines_sync_tombstone', 'routines has the tombstone trigger');
SELECT has_trigger(
    'public', 'training_cycles', 'training_cycles_sync_tombstone',
    'training_cycles has the tombstone trigger'
);
SELECT ok(
    (SELECT prosecdef FROM pg_proc WHERE oid = 'public.record_sync_tombstone()'::regprocedure),
    'record_sync_tombstone is SECURITY DEFINER'
);
SELECT ok(
    (SELECT proconfig FROM pg_proc WHERE oid = 'public.record_sync_tombstone()'::regprocedure)
      @> ARRAY['search_path=""'],
    'record_sync_tombstone pins search_path'
);

SELECT diag('database:sync-tombstones-privileges');

SELECT ok(
    NOT has_function_privilege('anon', 'public.record_sync_tombstone()', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.record_sync_tombstone()', 'EXECUTE'),
    'record_sync_tombstone is not executable by anon or authenticated'
);
SELECT ok(
    NOT has_function_privilege(
        'anon', 'public.get_sync_tombstones(uuid, text, uuid[], timestamptz)', 'EXECUTE'
    )
    AND NOT has_function_privilege(
        'authenticated', 'public.get_sync_tombstones(uuid, text, uuid[], timestamptz)', 'EXECUTE'
    ),
    'get_sync_tombstones is not executable by anon or authenticated'
);
SELECT ok(
    has_function_privilege(
        'service_role', 'public.get_sync_tombstones(uuid, text, uuid[], timestamptz)', 'EXECUTE'
    ),
    'get_sync_tombstones is executable by service_role'
);
SELECT is(
    (SELECT count(*)::int FROM pg_proc
     WHERE proname = 'get_sync_tombstones' AND pronamespace = 'public'::regnamespace),
    1,
    'exactly one get_sync_tombstones overload exists'
);
SELECT ok(
    NOT has_table_privilege('anon', 'public.sync_tombstones', 'SELECT')
    AND NOT has_table_privilege('authenticated', 'public.sync_tombstones', 'INSERT')
    AND NOT has_table_privilege('authenticated', 'public.sync_tombstones', 'UPDATE')
    AND NOT has_table_privilege('authenticated', 'public.sync_tombstones', 'DELETE')
    AND NOT has_table_privilege('authenticated', 'public.sync_tombstones', 'TRUNCATE'),
    'browser roles cannot write sync_tombstones and anon cannot read it'
);

SELECT diag('database:sync-tombstones-trigger');

INSERT INTO auth.users (id, email)
VALUES
    ('16161616-0000-4000-8000-000000000001'::uuid, 'tombstones-owner@example.test'),
    ('16161616-0000-4000-8000-000000000002'::uuid, 'tombstones-other@example.test'),
    ('16161616-0000-4000-8000-000000000003'::uuid, 'tombstones-deleted@example.test')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.routines (id, user_id, name)
VALUES
    ('16161616-0000-4000-8000-0000000000a1'::uuid, '16161616-0000-4000-8000-000000000001'::uuid, 'Owner routine'),
    ('16161616-0000-4000-8000-0000000000a2'::uuid, '16161616-0000-4000-8000-000000000001'::uuid, 'Owner live routine'),
    ('16161616-0000-4000-8000-0000000000a3'::uuid, '16161616-0000-4000-8000-000000000002'::uuid, 'Other routine'),
    ('16161616-0000-4000-8000-0000000000a4'::uuid, '16161616-0000-4000-8000-000000000003'::uuid, 'Deleted user routine');

INSERT INTO public.training_cycles (id, user_id, name)
VALUES
    ('16161616-0000-4000-8000-0000000000c1'::uuid, '16161616-0000-4000-8000-000000000001'::uuid, 'Owner cycle'),
    ('16161616-0000-4000-8000-0000000000c4'::uuid, '16161616-0000-4000-8000-000000000003'::uuid, 'Deleted user cycle');

-- A cycle day that references the owner routine: the FK clears it on delete.
INSERT INTO public.cycle_days (cycle_id, day_number, routine_id)
VALUES (
    '16161616-0000-4000-8000-0000000000c1'::uuid, 1,
    '16161616-0000-4000-8000-0000000000a1'::uuid
);

DELETE FROM public.routines WHERE id = '16161616-0000-4000-8000-0000000000a1'::uuid;
DELETE FROM public.routines WHERE id = '16161616-0000-4000-8000-0000000000a3'::uuid;

SELECT results_eq(
    $sql$
        SELECT user_id, entity, entity_id
        FROM public.sync_tombstones
        WHERE user_id IN (
            '16161616-0000-4000-8000-000000000001'::uuid,
            '16161616-0000-4000-8000-000000000002'::uuid
        )
        ORDER BY user_id, entity, entity_id
    $sql$,
    $values$
        VALUES
            ('16161616-0000-4000-8000-000000000001'::uuid, 'routine'::text,
             '16161616-0000-4000-8000-0000000000a1'::uuid),
            ('16161616-0000-4000-8000-000000000002'::uuid, 'routine'::text,
             '16161616-0000-4000-8000-0000000000a3'::uuid)
    $values$,
    'deleting a routine records one tombstone for its owner'
);

SELECT is(
    (SELECT routine_id FROM public.cycle_days
     WHERE cycle_id = '16161616-0000-4000-8000-0000000000c1'::uuid AND day_number = 1),
    NULL,
    'the cycle day routine reference is cleared by the existing ON DELETE SET NULL'
);

DELETE FROM public.training_cycles WHERE id = '16161616-0000-4000-8000-0000000000c1'::uuid;

SELECT ok(
    EXISTS (
        SELECT 1 FROM public.sync_tombstones
        WHERE user_id = '16161616-0000-4000-8000-000000000001'::uuid
          AND entity = 'cycle'
          AND entity_id = '16161616-0000-4000-8000-0000000000c1'::uuid
    ),
    'deleting a training cycle records a cycle tombstone'
);

-- Re-deleting the same id (re-created by another path) bumps deleted_at.
UPDATE public.sync_tombstones
SET deleted_at = '2000-01-01T00:00:00Z'
WHERE entity_id = '16161616-0000-4000-8000-0000000000a1'::uuid;
INSERT INTO public.routines (id, user_id, name)
VALUES ('16161616-0000-4000-8000-0000000000a1'::uuid, '16161616-0000-4000-8000-000000000001'::uuid, 'Recreated');
DELETE FROM public.routines WHERE id = '16161616-0000-4000-8000-0000000000a1'::uuid;

SELECT is(
    (SELECT count(*)::int FROM public.sync_tombstones
     WHERE entity_id = '16161616-0000-4000-8000-0000000000a1'::uuid),
    1,
    'a repeated delete keeps one tombstone row'
);
SELECT ok(
    (SELECT deleted_at FROM public.sync_tombstones
     WHERE entity_id = '16161616-0000-4000-8000-0000000000a1'::uuid) > '2000-01-01T00:00:00Z',
    'a repeated delete refreshes deleted_at'
);

-- Account deletion cascade: auth.users is gone before the cascade deletes the
-- user's routines and cycles, so the trigger records nothing.
DELETE FROM auth.users WHERE id = '16161616-0000-4000-8000-000000000003'::uuid;

SELECT is(
    (SELECT count(*)::int FROM public.routines
     WHERE user_id = '16161616-0000-4000-8000-000000000003'::uuid),
    0,
    'the account cascade deleted the user routine'
);
SELECT is(
    (SELECT count(*)::int FROM public.sync_tombstones
     WHERE user_id = '16161616-0000-4000-8000-000000000003'::uuid),
    0,
    'the account-deletion cascade leaves no tombstones for the deleted user'
);

SELECT diag('database:sync-tombstones-rpc');

SELECT results_eq(
    $sql$
        SELECT entity, entity_id FROM public.get_sync_tombstones(
            '16161616-0000-4000-8000-000000000001'::uuid,
            NULL,
            ARRAY[
                '16161616-0000-4000-8000-0000000000a1'::uuid,
                '16161616-0000-4000-8000-0000000000a2'::uuid,
                '16161616-0000-4000-8000-0000000000a3'::uuid,
                '16161616-0000-4000-8000-0000000000c1'::uuid
            ],
            NULL
        ) ORDER BY entity, entity_id
    $sql$,
    $values$
        VALUES
            ('cycle'::text, '16161616-0000-4000-8000-0000000000c1'::uuid),
            ('routine'::text, '16161616-0000-4000-8000-0000000000a1'::uuid)
    $values$,
    'ids filter: only the caller''s tombstoned ids (live and other-user ids excluded)'
);

SELECT results_eq(
    $sql$
        SELECT entity_id FROM public.get_sync_tombstones(
            '16161616-0000-4000-8000-000000000001'::uuid, 'routine', NULL, now() - interval '1 hour'
        )
    $sql$,
    $values$ VALUES ('16161616-0000-4000-8000-0000000000a1'::uuid) $values$,
    'since filter with an entity returns tombstones recorded after p_since'
);

SELECT is_empty(
    $sql$
        SELECT 1 FROM public.get_sync_tombstones(
            '16161616-0000-4000-8000-000000000001'::uuid, 'routine', NULL, now() + interval '1 hour'
        )
    $sql$,
    'since filter excludes older tombstones'
);

-- A tombstoned id that is live again is not reported.
INSERT INTO public.routines (id, user_id, name)
VALUES ('16161616-0000-4000-8000-0000000000a1'::uuid, '16161616-0000-4000-8000-000000000001'::uuid, 'Live again');
SELECT is_empty(
    $sql$
        SELECT 1 FROM public.get_sync_tombstones(
            '16161616-0000-4000-8000-000000000001'::uuid, 'routine',
            ARRAY['16161616-0000-4000-8000-0000000000a1'::uuid], NULL
        )
    $sql$,
    'a tombstoned id that exists again is not reported'
);

-- Another user's row with the same id does not hide the owner's tombstone.
INSERT INTO public.training_cycles (id, user_id, name)
VALUES ('16161616-0000-4000-8000-0000000000c1'::uuid, '16161616-0000-4000-8000-000000000002'::uuid, 'Taken by other');
SELECT results_eq(
    $sql$
        SELECT entity_id FROM public.get_sync_tombstones(
            '16161616-0000-4000-8000-000000000001'::uuid, 'cycle',
            ARRAY['16161616-0000-4000-8000-0000000000c1'::uuid], NULL
        )
    $sql$,
    $values$ VALUES ('16161616-0000-4000-8000-0000000000c1'::uuid) $values$,
    'a row with the same id owned by another user does not hide the tombstone'
);

SELECT diag('database:sync-tombstones-rls');

SET LOCAL ROLE authenticated;
SELECT set_config(
    'request.jwt.claims',
    '{"sub":"16161616-0000-4000-8000-000000000002","role":"authenticated"}',
    true
);

SELECT results_eq(
    $sql$ SELECT entity_id FROM public.sync_tombstones ORDER BY entity_id $sql$,
    $values$ VALUES ('16161616-0000-4000-8000-0000000000a3'::uuid) $values$,
    'an authenticated user sees only their own tombstones'
);

RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
