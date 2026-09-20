-- PR 48 (F-095 / FP-5): strip route and endpoint coordinates from stored
-- Strava activity payloads.
--
-- `strava-sync` used to write the provider's activity JSON to
-- `external_activities.raw_data` verbatim. That payload carries `map` (the
-- encoded polyline of the entire route), `start_latlng` and `end_latlng` — for
-- most people, the coordinates of their home. Nothing in the portal reads any
-- of them: the normalizer takes name, type, time, distance, calories, heart
-- rate and elevation, and no query, view or export selects these keys out of
-- `raw_data`. They are held, exported under GDPR, and carried by every read of
-- the table, for no purpose.
--
-- `supabase/functions/strava-sync/index.ts#stripStravaLocationData` removes the
-- same three keys before the upsert from now on. This migration removes them
-- from what is already stored. Keep the two lists in step.
--
-- Scope: `provider = 'strava'` only. Other providers' payloads are shaped
-- differently and are not this PR's subject.
--
-- Idempotent: the predicate matches only rows that still carry at least one of
-- the keys, so a second run updates zero rows. `jsonb - text` on an absent key
-- is a no-op regardless.
--
-- Lock safety: this is a data UPDATE, so it takes a ROW EXCLUSIVE lock on
-- `external_activities` and row locks on the matched rows. `lock_timeout`
-- bounds the wait so a contended apply fails fast and can be retried rather
-- than blocking sync writes; `statement_timeout` bounds the rewrite itself.
-- Both are SET LOCAL, so the explicit BEGIN/COMMIT is required.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

UPDATE public.external_activities
SET raw_data = raw_data - 'map' - 'start_latlng' - 'end_latlng'
WHERE provider = 'strava'
  AND raw_data IS NOT NULL
  AND jsonb_typeof(raw_data) = 'object'
  AND raw_data ?| ARRAY['map', 'start_latlng', 'end_latlng'];

COMMIT;

-- Read-only verification. Expected: 0 after this migration, and 0 on every
-- subsequent run of `strava-sync`. Run it against the target database by hand;
-- it is intentionally not part of the migration.
--
--   SELECT count(*) AS rows_with_location_keys
--   FROM public.external_activities
--   WHERE provider = 'strava'
--     AND raw_data IS NOT NULL
--     AND jsonb_typeof(raw_data) = 'object'
--     AND raw_data ?| ARRAY['map', 'start_latlng', 'end_latlng'];
