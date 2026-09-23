-- 204-D (20260924110000): a cycle the profile-ownership guard refuses is a
-- structured rejection for that cycle only, not a failed batch.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;

SELECT no_plan();

INSERT INTO auth.users (id, email)
VALUES ('25252525-0000-4000-8000-000000000001'::uuid, 'merge-profile@example.test')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.local_profiles (user_id, id, name)
VALUES ('25252525-0000-4000-8000-000000000001'::uuid, 'phone-named', 'Named');

-- A portal-created cycle: no local profile.
INSERT INTO public.training_cycles (id, user_id, name, client_updated_at)
VALUES ('25252525-0000-4000-8000-0000000000c1'::uuid, '25252525-0000-4000-8000-000000000001'::uuid,
        'Portal cycle', '2026-09-20T10:00:00Z');

SELECT results_eq(
    $sql$
      SELECT id, accepted, structure_applied, client_updated_at
        FROM public.merge_training_cycles_from_push(
          '25252525-0000-4000-8000-000000000001',
          '[{"id":"25252525-0000-4000-8000-0000000000c1","local_profile_id":"phone-named",
             "name":"From phone","updated_at":"2026-09-20T11:00:00Z","days":[]},
            {"id":"25252525-0000-4000-8000-0000000000c2","local_profile_id":"phone-named",
             "name":"New phone cycle","updated_at":"2026-09-20T11:00:00Z","days":[]}]',
          true)
    $sql$,
    $values$ VALUES
      ('25252525-0000-4000-8000-0000000000c1'::text, false, false, '2026-09-20T10:00:00Z'::timestamptz),
      ('25252525-0000-4000-8000-0000000000c2'::text, true, true, '2026-09-20T11:00:00Z'::timestamptz)
    $values$,
    'the refused cycle is rejected with its stored LWW key; the rest of the batch applies'
);
SELECT results_eq(
    $sql$ SELECT name, local_profile_id FROM public.training_cycles
           WHERE id = '25252525-0000-4000-8000-0000000000c1' $sql$,
    $values$ VALUES ('Portal cycle'::text, NULL::text) $values$,
    'the refused cycle keeps its stored content and profile'
);
SELECT is(
    (SELECT local_profile_id FROM public.training_cycles
      WHERE id = '25252525-0000-4000-8000-0000000000c2'),
    'phone-named',
    'a new cycle under the named profile is written'
);

-- Other guard failures are still errors, not rejections.
SELECT throws_ok(
    $sql$
      SELECT * FROM public.merge_training_cycles_from_push(
        '25252525-0000-4000-8000-000000000001',
        '[{"name":"no id"}]',
        true)
    $sql$,
    '22023',
    NULL,
    'a malformed cycle still raises'
);

SELECT * FROM finish();
ROLLBACK;
