-- =============================================================================
-- PR 23: deduplicate vbt_assessments and give it a natural unique key.
--
-- Why: mobile-sync-push deduplicated VBT assessments by comparing
-- `${exercise_id}:${created_at}` strings between the payload (Kotlin
-- Instant.toString(), "...Z") and PostgREST reads ("...+00:00"). The strings
-- never matched, so every push that carried assessments (mobile sends all of
-- them in the final batch) inserted a full duplicate set.
--
-- After this migration the Edge function upserts with
--   onConflict: 'user_id,exercise_id,created_at', ignoreDuplicates: true
-- (INSERT ... ON CONFLICT (user_id, exercise_id, created_at) DO NOTHING), so
-- equality is on the timestamptz value, not its text form.
--
-- DEPLOY ORDER: apply this migration BEFORE deploying the matching
-- mobile-sync-push. Without the index, ON CONFLICT raises 42P10; the push
-- still returns 200 but lists every assessment in `failed.assessments`.
-- With the index and the OLD Edge function, a push that re-sends an existing
-- assessment gets a unique violation on its bulk insert; again 200 with
-- `failed.assessments` (PR 22). Mobile re-sends all assessments on every final
-- batch, so nothing is lost once the new function is deployed.
--
-- OPERATOR: read-only before-count (rows this migration will delete):
--   SELECT count(*) - count(DISTINCT (user_id, exercise_id, created_at))
--          AS duplicate_rows,
--          count(*) AS total_rows
--     FROM public.vbt_assessments
--    WHERE created_at IS NOT NULL;
-- Take/confirm a backup (PITR) before applying (Operator Action 6).
--
-- Keeper: within each (user_id, exercise_id, created_at) group every row is a
-- re-push of the same immutable mobile assessment (mobile only inserts and
-- deletes AssessmentResult rows; userOverrideKg is set at insert). Any
-- deterministic keeper is therefore correct; we keep the lowest `id`.
-- `id` is gen_random_uuid(), so this is not "the earliest" row, only a stable
-- choice. Nothing references vbt_assessments.id.
--
-- NULL created_at: a standard unique index treats NULLs as distinct, so rows
-- with NULL created_at are left untouched (the push schema requires
-- createdAt, so the Edge function never writes NULL).
--
-- Locking / idempotence: the CLI does not wrap migration files in a
-- transaction, so this file uses an explicit BEGIN/COMMIT (repo convention)
-- and applies all or nothing. The explicit SHARE ROW EXCLUSIVE lock blocks concurrent
-- inserts (reads continue) from the DELETE until COMMIT, so no push can slip
-- a fresh duplicate in before the index is built. lock_timeout makes the
-- migration fail fast instead of queueing behind a long transaction and
-- stalling every writer; on failure nothing is applied or recorded and the
-- file can simply be re-run. CREATE INDEX CONCURRENTLY is not possible inside
-- a transactional migration; the table is small (not among the large tables
-- in the prod size survey), so a plain build is brief. Re-running is a no-op:
-- the DELETE finds no duplicates and the index already exists.
-- =============================================================================

BEGIN;

SET LOCAL lock_timeout = '10s';

LOCK TABLE public.vbt_assessments IN SHARE ROW EXCLUSIVE MODE;

DELETE FROM public.vbt_assessments AS v
 USING (
   SELECT id
     FROM (
       SELECT id,
              row_number() OVER (
                PARTITION BY user_id, exercise_id, created_at
                ORDER BY id
              ) AS rn
         FROM public.vbt_assessments
        WHERE created_at IS NOT NULL
     ) ranked
    WHERE ranked.rn > 1
 ) AS dup
 WHERE v.id = dup.id;

CREATE UNIQUE INDEX IF NOT EXISTS vbt_assessments_identity
  ON public.vbt_assessments (user_id, exercise_id, created_at);

-- Self-check: fail (and roll back) rather than record the migration as
-- applied without a usable unique index on the conflict target.
DO $$
DECLARE
  v_valid boolean;
BEGIN
  SELECT i.indisunique AND i.indisvalid
    INTO v_valid
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indexrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relname = 'vbt_assessments_identity';
  IF v_valid IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'vbt_assessments_identity is missing, not unique, or invalid';
  END IF;
END $$;

COMMIT;

-- idx_vbt_user (user_id) is now a left prefix of vbt_assessments_identity and
-- redundant, but it is left in place: dropping it is not needed for
-- correctness.
