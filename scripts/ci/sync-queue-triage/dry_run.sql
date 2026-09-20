-- Read-only preview of the one-time sync_queue backlog triage in
-- supabase/migrations/20260920003100_scheduler_and_sync_queue_cron.sql
-- (Operator Action 7: run BEFORE applying and record the counts in the PR).
--
-- Every pending row lands in exactly one bucket, so the counts are disjoint
-- and sum to the number of pending rows:
--   failed / <reason>       step a: not dispatchable
--   superseded_duplicate    step b: an older row of the same
--                           (user, provider, initial|other) class
--   superseded_stale        step c: kept non-initial row older than 14 days
--                           (or created_at NULL)
--   kept                    stays pending
-- The classifier is identical to private.triage_sync_queue_backlog() in the
-- migration; CI (migrations.yml) seeds a backlog and fails if this preview
-- and the migration's actual outcome differ.

WITH pending AS (
  SELECT
    q.id, q.user_id, q.provider, q.sync_type, q.created_at,
    CASE
      WHEN q.provider NOT IN ('strava', 'fitbit', 'hevy', 'liftosaur')
        THEN 'provider_not_queueable'
      WHEN q.provider IN ('strava', 'fitbit') AND NOT (
        EXISTS (SELECT 1 FROM public.user_integrations i
                WHERE i.user_id = q.user_id AND i.provider = q.provider
                  AND i.status = 'connected')
        AND EXISTS (SELECT 1 FROM public.oauth_tokens t
                    WHERE t.user_id = q.user_id AND t.provider = q.provider)
      ) THEN 'integration_not_connected'
      WHEN q.provider IN ('hevy', 'liftosaur') AND NOT EXISTS (
        SELECT 1 FROM public.oauth_tokens t
        WHERE t.user_id = q.user_id AND t.provider = q.provider
          AND coalesce(t.api_key, '') <> ''
      ) THEN 'integration_not_connected'
      WHEN NOT EXISTS (
        SELECT 1 FROM public.subscriptions s
        WHERE s.user_id = q.user_id
          AND s.tier IN ('FLAME', 'INFERNO')
          AND s.status IN ('active', 'trialing')
          AND s.current_period_end > now()
      ) THEN 'subscription_required'
    END AS fail_reason
  FROM public.sync_queue q
  WHERE q.status = 'pending'
),
ranked AS (
  SELECT
    p.*,
    (p.sync_type IS NOT DISTINCT FROM 'initial') AS is_initial,
    row_number() OVER (
      PARTITION BY p.user_id, p.provider, (p.sync_type IS NOT DISTINCT FROM 'initial')
      ORDER BY p.created_at DESC NULLS LAST, p.id DESC
    ) AS rn_class
  FROM pending p
  WHERE p.fail_reason IS NULL
),
plan AS (
  SELECT id, 'failed' AS outcome, fail_reason AS reason
  FROM pending WHERE fail_reason IS NOT NULL
  UNION ALL
  SELECT id,
         CASE
           WHEN rn_class > 1 THEN 'superseded_duplicate'
           WHEN NOT is_initial
                AND (created_at IS NULL OR created_at < now() - interval '14 days')
             THEN 'superseded_stale'
           ELSE 'kept'
         END,
         NULL
  FROM ranked
)
SELECT outcome, reason, count(*) AS n
FROM plan
GROUP BY outcome, reason
ORDER BY outcome, reason;
