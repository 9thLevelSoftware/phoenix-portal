-- PR 19 (FP-3, F-045): make training_cycles.progression_settings decodable
-- by mobile.
--
-- Mobile decodes progressionSettings as a Kotlin Map<String, String> with a
-- non-lenient Json (Project-Phoenix-MP SqlDelightSyncRepository
-- .mergePortalCycles) and reads frequencyCycles, weightIncreasePercent,
-- echoLevelIncrease and eccentricLoadIncreasePercent. The portal builder used
-- to write {type, amount, frequency, trigger, upperIncrement, lowerIncrement}
-- with NUMBER values, so the phone's decode failed and the cycle's
-- progression was silently dropped.
--
-- For every object-valued progression_settings this backfill:
--   1. rewrites every non-string value as its JSON text
--      (2.5 -> "2.5", true -> "true"); JSON nulls are dropped, since
--      Map<String, String> cannot hold them;
--   2. adds the mobile keys the portal values imply, when absent:
--        frequency (number)                    -> frequencyCycles (integer)
--        amount (number), type = 'percentage'  -> weightIncreasePercent
--      Existing mobile keys are never overwritten.
-- Portal-only keys stay, now as strings; mobile ignores them.
--
-- updated_at: INTENTIONALLY bumped. This is a real data change the phones
-- must receive, so the cycles_updated_at trigger is allowed to fire (no
-- phoenix.skip_updated_at) and every client, including ones pulling with a
-- real lastSync, re-pulls the fixed progression. portal_edited_at is not
-- stamped: migrations do not run with an authenticated JWT.
--
-- Idempotent: rows are updated only when the rewritten value differs, and a
-- second run finds nothing to change.
--
-- Read-only count of rows this backfill changes (run before and after; the
-- after-count must be 0):
--   SELECT count(*) FROM public.training_cycles tc
--   WHERE jsonb_typeof(tc.progression_settings) = 'object'
--     AND (
--       EXISTS (SELECT 1 FROM jsonb_each(tc.progression_settings) e
--               WHERE jsonb_typeof(e.value) <> 'string')
--       OR (NOT tc.progression_settings ? 'frequencyCycles'
--           AND jsonb_typeof(tc.progression_settings -> 'frequency') = 'number'
--           AND (tc.progression_settings ->> 'frequency')::numeric >= 1)
--       OR (NOT tc.progression_settings ? 'weightIncreasePercent'
--           AND tc.progression_settings ->> 'type' = 'percentage'
--           AND jsonb_typeof(tc.progression_settings -> 'amount') = 'number')
--     );
-- The migration also RAISEs NOTICE with the pending and updated counts.
--
-- The helper function below is temporary (dropped at the end), revoked from
-- PUBLIC/anon/authenticated while it exists.

CREATE OR REPLACE FUNCTION public.pr19_normalized_cycle_progression(p_settings JSONB)
RETURNS JSONB
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  WITH stringified AS (
    SELECT COALESCE(
      jsonb_object_agg(
        e.key,
        CASE WHEN jsonb_typeof(e.value) = 'string' THEN e.value
             ELSE to_jsonb(e.value #>> '{}')
        END
      ),
      '{}'::jsonb
    ) AS s
    FROM jsonb_each(p_settings) AS e
    WHERE jsonb_typeof(e.value) <> 'null'
  )
  SELECT s
    || CASE
         WHEN NOT (s ? 'frequencyCycles')
              AND jsonb_typeof(p_settings -> 'frequency') = 'number'
              AND (p_settings ->> 'frequency')::numeric >= 1
         THEN jsonb_build_object(
                'frequencyCycles',
                round((p_settings ->> 'frequency')::numeric)::bigint::text)
         ELSE '{}'::jsonb
       END
    || CASE
         WHEN NOT (s ? 'weightIncreasePercent')
              AND p_settings ->> 'type' = 'percentage'
              AND jsonb_typeof(p_settings -> 'amount') = 'number'
         THEN jsonb_build_object('weightIncreasePercent', p_settings ->> 'amount')
         ELSE '{}'::jsonb
       END
  FROM stringified
$$;

REVOKE ALL ON FUNCTION public.pr19_normalized_cycle_progression(JSONB) FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
  v_pending BIGINT;
  v_updated BIGINT;
BEGIN
  SELECT count(*) INTO v_pending
  FROM public.training_cycles
  WHERE jsonb_typeof(progression_settings) = 'object'
    AND public.pr19_normalized_cycle_progression(progression_settings)
        IS DISTINCT FROM progression_settings;
  RAISE NOTICE 'backfill_cycle_progression_keys: % row(s) to update', v_pending;

  -- updated_at is left to the cycles_updated_at trigger on purpose (see
  -- header): phones must re-pull these rows.
  UPDATE public.training_cycles
  SET progression_settings =
        public.pr19_normalized_cycle_progression(progression_settings)
  WHERE jsonb_typeof(progression_settings) = 'object'
    AND public.pr19_normalized_cycle_progression(progression_settings)
        IS DISTINCT FROM progression_settings;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RAISE NOTICE 'backfill_cycle_progression_keys: % row(s) updated', v_updated;
END;
$$;

DROP FUNCTION IF EXISTS public.pr19_normalized_cycle_progression(JSONB);
