-- Avatars storage pgTAP (NF-5): the owner can upsert-replace their own avatar
-- object. Other users and anon cannot read, list, or overwrite it. The bucket
-- stays public so getPublicUrl keeps working.
--
-- Follows supabase/tests/database/trust_plane.test.sql.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;

SELECT no_plan();

CREATE OR REPLACE FUNCTION pg_temp.assert_sqlstate(
    statement_sql text,
    expected_sqlstate text,
    assertion_description text
) RETURNS text
LANGUAGE plpgsql
AS $assertion$
BEGIN
    EXECUTE statement_sql;
    RETURN extensions.ok(false, assertion_description);
EXCEPTION WHEN OTHERS THEN
    RETURN extensions.is(SQLSTATE, expected_sqlstate, assertion_description);
END
$assertion$;

SELECT diag('database:storage-avatars-catalog');

SELECT is(
    (SELECT public FROM storage.buckets WHERE id = 'avatars'),
    true,
    'avatars bucket stays public (getPublicUrl rendering unaffected)'
);

SELECT is(
    (
        SELECT count(*)::int
        FROM pg_policies
        WHERE schemaname = 'storage'
          AND tablename = 'objects'
          AND policyname = 'Users can read own avatars'
    ),
    1,
    'owner avatars SELECT policy exists after migrations'
);

SELECT ok(
    (
        SELECT cmd = 'SELECT'
            AND roles = ARRAY['authenticated']::name[]
            AND qual LIKE '%avatars%'
            AND position('/%' IN qual) > 0
        FROM pg_policies
        WHERE schemaname = 'storage'
          AND tablename = 'objects'
          AND policyname = 'Users can read own avatars'
    ),
    'owner avatars SELECT policy is authenticated-only and path-scoped to auth.uid()/'
);

SELECT is_empty(
    $sql$
        SELECT policyname
        FROM pg_policies
        WHERE schemaname = 'storage'
          AND tablename = 'objects'
          AND cmd IN ('SELECT', 'ALL')
          AND (
              COALESCE(qual, '') ILIKE '%avatars%'
              OR policyname ILIKE '%avatar%'
          )
          AND (
              roles && ARRAY['anon', 'public']::name[]
              OR position('auth.uid()' IN COALESCE(qual, '')) = 0
          )
    $sql$,
    'no avatars SELECT policy is open to anon/public or unscoped'
);

SELECT diag('database:storage-avatars-rls');

INSERT INTO auth.users (id, email)
VALUES
    ('a1a1a1a1-0000-4000-8000-000000000073'::uuid, 'avatar-owner@example.test'),
    ('b2b2b2b2-0000-4000-8000-000000000073'::uuid, 'avatar-other@example.test')
ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email;

-- Owner (user A)
SET LOCAL ROLE authenticated;
SELECT set_config(
    'request.jwt.claims',
    '{"sub":"a1a1a1a1-0000-4000-8000-000000000073","role":"authenticated"}',
    true
);

SELECT lives_ok(
    $sql$
        INSERT INTO storage.objects (bucket_id, name, owner_id, metadata)
        VALUES (
            'avatars',
            'a1a1a1a1-0000-4000-8000-000000000073/avatar.png',
            'a1a1a1a1-0000-4000-8000-000000000073',
            '{"v":1}'::jsonb
        )
        ON CONFLICT (bucket_id, name) DO UPDATE
        SET metadata = EXCLUDED.metadata,
            owner_id = EXCLUDED.owner_id
    $sql$,
    'owner first avatar upload (upsert) succeeds'
);

SELECT lives_ok(
    $sql$
        INSERT INTO storage.objects (bucket_id, name, owner_id, metadata)
        VALUES (
            'avatars',
            'a1a1a1a1-0000-4000-8000-000000000073/avatar.png',
            'a1a1a1a1-0000-4000-8000-000000000073',
            '{"v":2}'::jsonb
        )
        ON CONFLICT (bucket_id, name) DO UPDATE
        SET metadata = EXCLUDED.metadata,
            owner_id = EXCLUDED.owner_id
    $sql$,
    'owner re-upload (upsert replace) of own avatar succeeds'
);

SELECT results_eq(
    $sql$
        SELECT count(*)::int, max(metadata ->> 'v')
        FROM storage.objects
        WHERE bucket_id = 'avatars'
          AND name LIKE 'a1a1a1a1-0000-4000-8000-000000000073/%'
    $sql$,
    $sql$ VALUES (1, '2') $sql$,
    'owner sees exactly one own avatar object, replaced in place'
);

-- Other user (user B)
SELECT set_config(
    'request.jwt.claims',
    '{"sub":"b2b2b2b2-0000-4000-8000-000000000073","role":"authenticated"}',
    true
);

SELECT is(
    (
        SELECT count(*)::int
        FROM storage.objects
        WHERE bucket_id = 'avatars'
    ),
    0,
    'other user cannot read or list another user''s avatar objects'
);

SELECT pg_temp.assert_sqlstate(
    $sql$
        INSERT INTO storage.objects (bucket_id, name, owner_id, metadata)
        VALUES (
            'avatars',
            'a1a1a1a1-0000-4000-8000-000000000073/avatar.png',
            'b2b2b2b2-0000-4000-8000-000000000073',
            '{"v":"hijack"}'::jsonb
        )
        ON CONFLICT (bucket_id, name) DO UPDATE
        SET metadata = EXCLUDED.metadata,
            owner_id = EXCLUDED.owner_id
    $sql$,
    '42501',
    'other user cannot upsert-overwrite another user''s avatar'
);

UPDATE storage.objects
SET metadata = '{"v":"hijack"}'::jsonb
WHERE bucket_id = 'avatars'
  AND name = 'a1a1a1a1-0000-4000-8000-000000000073/avatar.png';

-- Direct DELETE is blocked for every role by storage.protect_delete()
-- (statement trigger), so the DELETE policy is exercised via the Storage API,
-- not here.

-- Anon
RESET ROLE;
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);

SELECT is(
    (
        SELECT count(*)::int
        FROM storage.objects
        WHERE bucket_id = 'avatars'
    ),
    0,
    'anon cannot list avatar objects'
);

RESET ROLE;
SELECT set_config('request.jwt.claims', '', true);

-- Idempotency: re-run the migration body; the policy must still exist once
-- and still let the owner upsert.
DROP POLICY IF EXISTS "Users can read own avatars" ON storage.objects;
CREATE POLICY "Users can read own avatars"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'avatars'
    AND name LIKE (select auth.uid())::text || '/%'
  );

SELECT is(
    (
        SELECT count(*)::int
        FROM pg_policies
        WHERE schemaname = 'storage'
          AND tablename = 'objects'
          AND policyname = 'Users can read own avatars'
    ),
    1,
    'owner avatars SELECT policy exists exactly once after re-apply'
);

SET LOCAL ROLE authenticated;
SELECT set_config(
    'request.jwt.claims',
    '{"sub":"a1a1a1a1-0000-4000-8000-000000000073","role":"authenticated"}',
    true
);

SELECT lives_ok(
    $sql$
        INSERT INTO storage.objects (bucket_id, name, owner_id, metadata)
        VALUES (
            'avatars',
            'a1a1a1a1-0000-4000-8000-000000000073/avatar.png',
            'a1a1a1a1-0000-4000-8000-000000000073',
            '{"v":2}'::jsonb
        )
        ON CONFLICT (bucket_id, name) DO UPDATE
        SET metadata = EXCLUDED.metadata,
            owner_id = EXCLUDED.owner_id
    $sql$,
    'owner re-upload still succeeds after migration re-apply'
);

RESET ROLE;
SELECT set_config('request.jwt.claims', '', true);

SELECT results_eq(
    $sql$
        SELECT count(*)::int, max(metadata ->> 'v')
        FROM storage.objects
        WHERE bucket_id = 'avatars'
          AND name = 'a1a1a1a1-0000-4000-8000-000000000073/avatar.png'
    $sql$,
    $sql$ VALUES (1, '2') $sql$,
    'other user''s UPDATE left the owner''s avatar untouched'
);

SELECT * FROM finish();

ROLLBACK;
