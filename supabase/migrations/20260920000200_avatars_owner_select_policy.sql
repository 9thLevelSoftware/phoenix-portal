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
-- The bucket stays public (storage.buckets.public = true). Storage serves
-- public avatar URLs without checking RLS, so getPublicUrl rendering is
-- unchanged.
--
-- Idempotent: running it again drops and recreates the same policy.

DROP POLICY IF EXISTS "Users can read own avatars" ON storage.objects;

CREATE POLICY "Users can read own avatars"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'avatars'
    AND name LIKE (select auth.uid())::text || '/%'
  );
