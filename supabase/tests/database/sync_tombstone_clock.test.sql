-- 204-C / 204-E (20260924100000): tombstone client clock, the atomic clocked
-- cycle delete and the push re-create gate.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;

SELECT no_plan();

SELECT diag('database:sync-tombstone-clock-catalog');

SELECT has_column('public', 'sync_tombstones', 'client_deleted_at',
    'sync_tombstones.client_deleted_at exists');
SELECT col_not_null('public', 'sync_tombstones', 'client_deleted_at',
    'client_deleted_at is NOT NULL');
SELECT ok(
    NOT EXISTS (SELECT 1 FROM public.sync_tombstones WHERE client_deleted_at IS NULL),
    'every tombstone has a client clock (backfilled from deleted_at)'
);
SELECT ok(
    has_function_privilege('service_role', 'public.delete_cycles_clocked(uuid, jsonb)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.delete_cycles_clocked(uuid, jsonb)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.delete_cycles_clocked(uuid, jsonb)', 'EXECUTE'),
    'delete_cycles_clocked is service-role only'
);
SELECT ok(
    has_function_privilege('service_role', 'public.apply_sync_tombstone_gate(uuid, jsonb)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.apply_sync_tombstone_gate(uuid, jsonb)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.apply_sync_tombstone_gate(uuid, jsonb)', 'EXECUTE'),
    'apply_sync_tombstone_gate is service-role only'
);

INSERT INTO auth.users (id, email)
VALUES ('24242424-0000-4000-8000-000000000001'::uuid, 'tombstone-clock@example.test')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.training_cycles (id, user_id, name, client_updated_at) VALUES
    ('24242424-0000-4000-8000-0000000000c1'::uuid, '24242424-0000-4000-8000-000000000001'::uuid,
     'Stored newer', '2026-09-20T12:00:00Z'),
    ('24242424-0000-4000-8000-0000000000c2'::uuid, '24242424-0000-4000-8000-000000000001'::uuid,
     'Stored older', '2026-09-20T10:00:00Z'),
    ('24242424-0000-4000-8000-0000000000c4'::uuid, '24242424-0000-4000-8000-000000000001'::uuid,
     'No stored key', NULL);

SELECT diag('database:delete-cycles-clocked');

SELECT results_eq(
    $sql$
      SELECT id, accepted, existed, server_updated_at
        FROM public.delete_cycles_clocked(
          '24242424-0000-4000-8000-000000000001',
          '[{"id":"24242424-0000-4000-8000-0000000000c1","updatedAt":"2026-09-20T11:00:00Z"},
            {"id":"24242424-0000-4000-8000-0000000000c2","updatedAt":"2026-09-20T11:00:00Z"},
            {"id":"24242424-0000-4000-8000-0000000000c3","updatedAt":"2026-09-20T11:30:00Z"},
            {"id":"24242424-0000-4000-8000-0000000000c4","updatedAt":"2026-09-20T09:00:00Z"}]')
    $sql$,
    $values$ VALUES
      ('24242424-0000-4000-8000-0000000000c1'::uuid, false, true, '2026-09-20T12:00:00Z'::timestamptz),
      ('24242424-0000-4000-8000-0000000000c2'::uuid, true, true, NULL::timestamptz),
      ('24242424-0000-4000-8000-0000000000c3'::uuid, true, false, NULL::timestamptz),
      ('24242424-0000-4000-8000-0000000000c4'::uuid, true, true, NULL::timestamptz)
    $values$,
    'a stored key strictly newer rejects; an older, missing or absent row loses to the delete'
);
SELECT results_eq(
    $sql$ SELECT id FROM public.training_cycles
           WHERE user_id = '24242424-0000-4000-8000-000000000001' ORDER BY id $sql$,
    $values$ VALUES ('24242424-0000-4000-8000-0000000000c1'::uuid) $values$,
    'only the rejected cycle survives'
);
SELECT results_eq(
    $sql$ SELECT entity_id, client_deleted_at FROM public.sync_tombstones
           WHERE user_id = '24242424-0000-4000-8000-000000000001' ORDER BY entity_id $sql$,
    $values$ VALUES
      ('24242424-0000-4000-8000-0000000000c2'::uuid, '2026-09-20T11:00:00Z'::timestamptz),
      ('24242424-0000-4000-8000-0000000000c3'::uuid, '2026-09-20T11:30:00Z'::timestamptz),
      ('24242424-0000-4000-8000-0000000000c4'::uuid, '2026-09-20T09:00:00Z'::timestamptz)
    $values$,
    'deleted and already-absent cycles are tombstoned with the device clock'
);
SELECT is(
    current_setting('phoenix.sync_delete_clock', true),
    '',
    'the delete clock setting is cleared after the call'
);

SELECT diag('database:sync-tombstone-trigger-clock');

-- A delete from any other path records now() as its client clock.
INSERT INTO public.routines (id, user_id, name)
VALUES ('24242424-0000-4000-8000-0000000000a1'::uuid, '24242424-0000-4000-8000-000000000001'::uuid, 'R');
DELETE FROM public.routines WHERE id = '24242424-0000-4000-8000-0000000000a1';
SELECT is(
    (SELECT client_deleted_at FROM public.sync_tombstones
      WHERE entity = 'routine' AND entity_id = '24242424-0000-4000-8000-0000000000a1'),
    now(),
    'an unclocked delete records now() as the tombstone clock'
);

SELECT diag('database:apply-sync-tombstone-gate');

SELECT results_eq(
    $sql$
      SELECT entity, entity_id, skipped
        FROM public.apply_sync_tombstone_gate(
          '24242424-0000-4000-8000-000000000001',
          '[{"entity":"cycle","id":"24242424-0000-4000-8000-0000000000c2","clock":"2026-09-20T11:00:00Z"},
            {"entity":"cycle","id":"24242424-0000-4000-8000-0000000000c4"},
            {"entity":"cycle","id":"24242424-0000-4000-8000-0000000000c3","clock":"2026-09-20T12:00:00Z"},
            {"entity":"cycle","id":"24242424-0000-4000-8000-0000000000c1","clock":"2026-01-01T00:00:00Z"},
            {"entity":"cycle","id":"24242424-0000-4000-8000-0000000000c9","clock":"2026-09-20T12:00:00Z"}]')
    $sql$,
    $values$ VALUES
      ('cycle'::text, '24242424-0000-4000-8000-0000000000c2'::uuid, true),
      ('cycle'::text, '24242424-0000-4000-8000-0000000000c4'::uuid, true),
      ('cycle'::text, '24242424-0000-4000-8000-0000000000c3'::uuid, false)
    $values$,
    'equal or missing clocks are skipped; a strictly newer clock wins; live rows and ids with no tombstone are not reported'
);
SELECT results_eq(
    $sql$ SELECT entity_id FROM public.sync_tombstones
           WHERE user_id = '24242424-0000-4000-8000-000000000001' AND entity = 'cycle'
           ORDER BY entity_id $sql$,
    $values$ VALUES
      ('24242424-0000-4000-8000-0000000000c2'::uuid),
      ('24242424-0000-4000-8000-0000000000c4'::uuid)
    $values$,
    'the gate removes only the tombstone the newer edit beat'
);

SELECT diag('database:sync-tombstone-race-and-partial-write');

-- A delete at clock 10 raced an edit at clock 09: the push's cleanup deletes
-- the re-created row without a clock. The tombstone keeps clock 10, so an
-- edit at clock 11 still wins.
INSERT INTO public.sync_tombstones (user_id, entity, entity_id, deleted_at, client_deleted_at)
VALUES ('24242424-0000-4000-8000-000000000001', 'cycle', '24242424-0000-4000-8000-0000000000d1',
        now() - interval '1 second', '2026-09-20T10:00:00Z');
INSERT INTO public.training_cycles (id, user_id, name, updated_at, client_updated_at)
VALUES ('24242424-0000-4000-8000-0000000000d1', '24242424-0000-4000-8000-000000000001',
        'Raced edit', now() + interval '1 day', '2026-09-20T09:00:00Z');
DELETE FROM public.training_cycles WHERE id = '24242424-0000-4000-8000-0000000000d1';
SELECT is(
    (SELECT client_deleted_at FROM public.sync_tombstones
      WHERE entity_id = '24242424-0000-4000-8000-0000000000d1'),
    '2026-09-20T10:00:00Z'::timestamptz,
    'a clockless re-delete of a resurrection keeps the original delete clock'
);
SELECT results_eq(
    $sql$ SELECT skipped FROM public.apply_sync_tombstone_gate('24242424-0000-4000-8000-000000000001',
            '[{"entity":"cycle","id":"24242424-0000-4000-8000-0000000000d1","clock":"2026-09-20T11:00:00Z"}]') $sql$,
    $values$ VALUES (false) $values$,
    'an edit strictly newer than the original delete still wins'
);

-- Partial write: a stale row (key 09) is live alongside its tombstone (10).
INSERT INTO public.sync_tombstones (user_id, entity, entity_id, deleted_at, client_deleted_at)
VALUES ('24242424-0000-4000-8000-000000000001', 'routine', '24242424-0000-4000-8000-0000000000d2',
        now() - interval '1 second', '2026-09-20T10:00:00Z');
INSERT INTO public.routines (id, user_id, name, client_updated_at)
VALUES ('24242424-0000-4000-8000-0000000000d2', '24242424-0000-4000-8000-000000000001',
        'Resurrected', '2026-09-20T09:00:00Z');
SELECT results_eq(
    $sql$ SELECT skipped FROM public.apply_sync_tombstone_gate('24242424-0000-4000-8000-000000000001',
            '[{"entity":"routine","id":"24242424-0000-4000-8000-0000000000d2","clock":"2026-09-20T09:30:00Z"}]') $sql$,
    $values$ VALUES (true) $values$,
    'a stale edit of a live resurrected row is skipped'
);
SELECT ok(
    NOT EXISTS (SELECT 1 FROM public.routines WHERE id = '24242424-0000-4000-8000-0000000000d2')
    AND (SELECT client_deleted_at FROM public.sync_tombstones
          WHERE entity_id = '24242424-0000-4000-8000-0000000000d2') = '2026-09-20T10:00:00Z'::timestamptz,
    'the resurrected row is deleted again and the tombstone keeps its clock'
);

-- Partial write the other way: the live row (key 11) had won; only the
-- tombstone clear was lost.
INSERT INTO public.sync_tombstones (user_id, entity, entity_id, deleted_at, client_deleted_at)
VALUES ('24242424-0000-4000-8000-000000000001', 'routine', '24242424-0000-4000-8000-0000000000d3',
        now() - interval '1 second', '2026-09-20T10:00:00Z');
INSERT INTO public.routines (id, user_id, name, client_updated_at)
VALUES ('24242424-0000-4000-8000-0000000000d3', '24242424-0000-4000-8000-000000000001',
        'Winning edit', '2026-09-20T11:00:00Z');
SELECT is(
    (SELECT count(*)::int FROM public.apply_sync_tombstone_gate('24242424-0000-4000-8000-000000000001',
        '[{"entity":"routine","id":"24242424-0000-4000-8000-0000000000d3","clock":"2026-09-20T09:30:00Z"}]')),
    0,
    'a live row newer than its tombstone is not skipped'
);
SELECT ok(
    EXISTS (SELECT 1 FROM public.routines WHERE id = '24242424-0000-4000-8000-0000000000d3')
    AND NOT EXISTS (SELECT 1 FROM public.sync_tombstones
                     WHERE entity_id = '24242424-0000-4000-8000-0000000000d3'),
    'its stale tombstone is removed and the row stays'
);

SELECT * FROM finish();
ROLLBACK;
