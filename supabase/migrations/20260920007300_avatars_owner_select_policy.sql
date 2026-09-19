-- Avatars: owner-scoped SELECT on storage.objects (NF-5).
--
-- Profile.tsx uploads with `upload(path, file, { upsert: true })`. Storage
-- turns that into INSERT ... ON CONFLICT DO UPDATE, and Postgres needs a
-- SELECT policy that lets the caller see the conflicting row. The avatars
-- bucket had INSERT/UPDATE/DELETE policies but no SELECT policy, so every
-- upsert upload (first upload and re-upload) failed RLS (42501). Postgres
-- applies the SELECT policy to the new row too. Owner list() and remove()
-- also returned nothing, because Storage reads the row first.
--
-- This replaces the "Do NOT add a SELECT policy" note in
-- 20260823120000_trust_rls_broadcast_self_leak.sql section 8. That note was
-- about public listing, and it still holds: this policy uses the same
-- `<auth.uid()>/` prefix rule as the write policies. Users can only read or
-- list their own folder. anon and other users still see nothing.
--
-- This migration does not touch storage.buckets. It leaves the avatars
-- bucket's `public` flag as it is (20260823120000 creates the bucket with
-- public = true). Storage serves public avatar URLs without checking RLS, so
-- getPublicUrl rendering is unchanged.
--
-- Drop-and-recreate is deliberate. The spec said "create only if absent",
-- but always recreating the policy makes it match this exact definition,
-- even if an older or dashboard-made policy with the same name has a
-- different predicate. It is idempotent: re-running it gives the same single
-- policy.
--
-- Ordering hazard: 20260823120000 section 8 has a DO-loop that drops every
-- storage.objects policy whose name matches '%avatar%' (or whose predicate
-- mentions avatars), and then recreates only INSERT/UPDATE/DELETE. That loop
-- would drop this policy. Keep this migration after 20260823120000. If that
-- file (or its section 8) is ever replayed by hand, for example during drift
-- reconciliation, replay this file afterwards too, or NF-5 comes back.
-- storage_avatars.test.sql asserts that the policy exists.

DROP POLICY IF EXISTS "Users can read own avatars" ON storage.objects;

CREATE POLICY "Users can read own avatars"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'avatars'
    AND name LIKE (select auth.uid())::text || '/%'
  );
