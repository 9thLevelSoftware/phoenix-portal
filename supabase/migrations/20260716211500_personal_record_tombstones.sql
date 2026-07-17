-- Issue #655: retain personal-record tombstones so deletes converge across devices.
-- Existing rows remain active because deleted_at defaults to NULL.
ALTER TABLE public.personal_records
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ NULL;

-- Mobile supplies the authoritative mutation timestamp used by the dedicated
-- UUID LWW protocol. Preserve it when present; direct portal edits that leave
-- updated_at unchanged still receive the normal server timestamp.
CREATE OR REPLACE FUNCTION public.update_personal_record_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.updated_at IS NULL OR NEW.updated_at = OLD.updated_at THEN
    NEW.updated_at = now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS personal_records_updated_at ON public.personal_records;
CREATE TRIGGER personal_records_updated_at
BEFORE UPDATE ON public.personal_records
FOR EACH ROW EXECUTE FUNCTION public.update_personal_record_updated_at();
