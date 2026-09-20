-- CI assertion (migrations.yml): after seed.sql and a re-apply of
-- 20260920003100_scheduler_and_sync_queue_cron.sql, every seeded row has
-- the outcome of the migration's own triage call. Raises on any mismatch.

DO $$
DECLARE
  v_mismatches text;
BEGIN
  SELECT string_agg(
           format('%s: expected %s/%s, got %s/%s',
                  e.id, e.status, coalesce(e.error_message, '-'),
                  coalesce(q.status, '<missing>'), coalesce(q.error_message, '-')),
           E'\n' ORDER BY e.id)
  INTO v_mismatches
  FROM (VALUES
    ('c1c10000-0000-4000-8000-0000000000a1', 'pending', NULL),
    ('c1c10000-0000-4000-8000-0000000000a2', 'superseded', NULL),
    ('c1c10000-0000-4000-8000-0000000000a3', 'superseded', NULL),
    ('c1c10000-0000-4000-8000-0000000000a4', 'completed', NULL),
    ('c1c10000-0000-4000-8000-0000000000b1', 'failed', 'integration_not_connected'),
    ('c1c10000-0000-4000-8000-0000000000c1', 'superseded', NULL),
    ('c1c10000-0000-4000-8000-0000000000d1', 'pending', NULL),
    ('c1c10000-0000-4000-8000-0000000000d2', 'processing', NULL),
    ('c1c10000-0000-4000-8000-0000000000e1', 'failed', 'integration_not_connected'),
    ('c1c10000-0000-4000-8000-0000000000f1', 'pending', NULL),
    ('c1c10000-0000-4000-8000-0000000000f2', 'pending', NULL),
    ('c1c10000-0000-4000-8000-0000000000f3', 'superseded', NULL),
    ('c1c10000-0000-4000-8000-0000000001a1', 'pending', NULL),
    ('c1c10000-0000-4000-8000-0000000001b1', 'failed', 'subscription_required'),
    ('c1c10000-0000-4000-8000-0000000001c1', 'failed', 'provider_not_queueable')
  ) AS e(id, status, error_message)
  LEFT JOIN public.sync_queue q ON q.id = e.id::uuid
  WHERE q.id IS NULL
     OR q.status IS DISTINCT FROM e.status
     OR (e.error_message IS NOT NULL AND q.error_message IS DISTINCT FROM e.error_message)
     OR (q.status IN ('failed', 'superseded') AND q.completed_at IS NULL);

  IF v_mismatches IS NOT NULL THEN
    RAISE EXCEPTION E'sync_queue triage outcome mismatch:\n%', v_mismatches;
  END IF;

  IF to_regprocedure('private.triage_sync_queue_backlog()') IS NOT NULL THEN
    RAISE EXCEPTION 'private.triage_sync_queue_backlog() must be dropped after the migration runs it';
  END IF;

  RAISE NOTICE 'sync_queue triage outcome matches the seeded expectations';
END
$$;
