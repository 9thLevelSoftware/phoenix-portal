-- Allow GIF/AVIF thumbnails produced by catalog:mirror.
-- Idempotent: updates exercise-media.allowed_mime_types if the bucket exists.

UPDATE storage.buckets
SET allowed_mime_types = ARRAY[
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif'
]::text[]
WHERE id = 'exercise-media';
