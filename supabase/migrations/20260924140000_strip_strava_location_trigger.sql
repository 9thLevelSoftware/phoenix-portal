-- Port of the database half of c60e76c3 (codex/review-pr-179).
--
-- 20260920004800 removed Strava's location keys (map, start_latlng,
-- end_latlng) from what external_activities already stored, and strava-sync
-- strips them before its upsert. Any other writer — mobile-sync-push's
-- external activity upsert, a future importer — can still store them. This
-- trigger enforces the rule at the database boundary for every writer. Keep
-- the key list in step with strava-sync's stripStravaLocationData and
-- 20260920004800.
--
-- Scope: provider = 'strava' only; other providers' payloads keep their
-- shape. The OAuth completion-handle half of c60e76c3 is not ported: the
-- session-bound completion design (KD-13) superseded it.
--
-- Idempotent: safe to re-run.

BEGIN;

CREATE OR REPLACE FUNCTION public.strip_strava_external_activity_location_data()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.provider = 'strava'
     AND NEW.raw_data IS NOT NULL
     AND jsonb_typeof(NEW.raw_data) = 'object' THEN
    NEW.raw_data := NEW.raw_data - 'map' - 'start_latlng' - 'end_latlng';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.strip_strava_external_activity_location_data() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS strip_strava_external_activity_location_data
  ON public.external_activities;
CREATE TRIGGER strip_strava_external_activity_location_data
  BEFORE INSERT OR UPDATE OF provider, raw_data ON public.external_activities
  FOR EACH ROW
  EXECUTE FUNCTION public.strip_strava_external_activity_location_data();

COMMIT;
