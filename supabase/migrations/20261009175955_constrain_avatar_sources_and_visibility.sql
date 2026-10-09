-- FP-1/FP-5, phase 1: constrain stored sources, prepare authenticated delivery.
-- Keep the bucket public until the compatible SPA has deployed. Activation
-- is a separate operator migration: docs/security/avatar-private-activation.sql.txt.
BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION private.valid_avatar_source(source text, owner_id uuid)
RETURNS boolean LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT source IS NULL OR (source !~ '[[:space:]]' AND source ~ (
    '^https://(api[.]phoenix-portal[.]com|ilzlswmatadlnsuxatcv[.]supabase[.]co)'
    || '/storage/v1/object/public/avatars/' || owner_id::text
    || '/avatar[.][A-Za-z0-9_-]{1,32}([?]t=[0-9]+)?$'
  ));
$$;
REVOKE ALL ON FUNCTION private.valid_avatar_source(text, uuid) FROM PUBLIC, anon, authenticated;

-- Untrusted legacy URLs must not keep tracking existing viewers. Retain only
-- exact Phoenix origins and exact owner paths; do not extract a key from an
-- arbitrary URL or percent-decode it into a different authorized object.
UPDATE public.profiles SET avatar_url = NULL
WHERE NOT private.valid_avatar_source(avatar_url, id);

CREATE OR REPLACE FUNCTION private.authorize_avatar_source()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  -- profiles.user_id is generated from id and is not available in BEFORE INSERT.
  IF NOT private.valid_avatar_source(NEW.avatar_url, NEW.id) THEN
    RAISE EXCEPTION 'Avatar must use the owner path on Phoenix storage'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.authorize_avatar_source() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS authorize_avatar_source ON public.profiles;
CREATE TRIGGER authorize_avatar_source BEFORE INSERT OR UPDATE OF avatar_url, id
  ON public.profiles FOR EACH ROW EXECUTE FUNCTION private.authorize_avatar_source();

-- Owner policy remains for uploads, listing and GDPR export. Community viewers
-- can download only the current avatar of an explicitly visible profile.
DROP POLICY IF EXISTS "Users can read visible profile avatars" ON storage.objects;
CREATE POLICY "Users can read visible profile avatars"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'avatars'
    AND (select auth.uid()) IS NOT NULL
    -- SELECT is shared by download, listing and signed-URL minting. Restrict
    -- the viewer branch to authenticated download: a previously minted signed
    -- URL would otherwise outlive profile opt-out. Owner access stays separate.
    AND pg_catalog.current_setting('storage.operation', true)
      IN ('storage.object.get_authenticated', 'object.get_authenticated')
    AND EXISTS (
      SELECT 1 FROM public.public_profiles AS profile
      WHERE name = profile.user_id::text || '/' ||
        pg_catalog.substring(profile.avatar_url, '/(avatar[.][A-Za-z0-9_-]{1,32})(?:[?]t=[0-9]+)?$')
    )
  );

COMMIT;
