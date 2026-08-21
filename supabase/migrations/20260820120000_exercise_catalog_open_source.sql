-- Open-source exercise catalogue provenance + public media bucket.
-- Additive: does not delete or remap legacy library rows.

ALTER TABLE public.exercise_catalog
  ADD COLUMN IF NOT EXISTS source TEXT,
  ADD COLUMN IF NOT EXISTS source_id TEXT,
  ADD COLUMN IF NOT EXISTS license TEXT,
  ADD COLUMN IF NOT EXISTS license_author TEXT,
  ADD COLUMN IF NOT EXISTS license_url TEXT;

UPDATE public.exercise_catalog
SET source = 'user'
WHERE is_custom = TRUE
  AND source IS NULL;

CREATE INDEX IF NOT EXISTS idx_exercise_catalog_source
  ON public.exercise_catalog (source);

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'exercise-media',
  'exercise-media',
  TRUE,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']::text[]
)
ON CONFLICT (id) DO UPDATE
SET
  public = TRUE,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'Public read exercise-media'
  ) THEN
    CREATE POLICY "Public read exercise-media"
      ON storage.objects
      FOR SELECT
      USING (bucket_id = 'exercise-media');
  END IF;
END $$;
