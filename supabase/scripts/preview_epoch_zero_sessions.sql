-- Read-only operator preview for
-- supabase/migrations/20260926100000_repair_epoch_zero_sessions.sql
-- ("1970 session repair", C10).
--
-- Run this BEFORE pushing that migration. It performs no writes. The CASE
-- expressions below are copied verbatim from
-- private.repair_epoch_zero_sessions() (defined by that migration) -- if one
-- changes, change the other in the same commit, or this preview will stop
-- matching what the migration actually does.
--
-- No user ids, emails or names are printed: only the first 8 characters of
-- the session id (enough for an operator to cross-reference by hand) and the
-- old/new started_at + duration_seconds.

-- ---------------------------------------------------------------------------
-- 1. Per-row preview: every session the migration would repair, and what it
--    would become.
-- ---------------------------------------------------------------------------
WITH candidates AS (
  SELECT
    ws.id,
    ws.started_at AS old_started_at,
    ws.duration_seconds AS old_duration_seconds,
    ws.client_updated_at,
    CASE
      WHEN ws.started_at = '1970-01-01T00:00:00Z'::timestamptz
        AND ws.duration_seconds BETWEEN 946684800
          AND (floor(extract(epoch FROM now()))::bigint + 86400)
      THEN 'A'
      WHEN ws.duration_seconds > 86400 THEN 'B'
      ELSE 'C'
    END AS repair_group
  FROM public.workout_sessions ws
  WHERE ws.started_at < '2000-01-01T00:00:00Z'::timestamptz
),
repairable AS (
  SELECT
    c.id,
    c.old_started_at,
    c.old_duration_seconds,
    c.repair_group,
    CASE
      WHEN c.repair_group = 'A' THEN to_timestamp(c.old_duration_seconds)
      ELSE c.client_updated_at
    END AS new_started_at,
    CASE
      WHEN c.repair_group IN ('A', 'B') THEN 0
      ELSE c.old_duration_seconds
    END AS new_duration_seconds
  FROM candidates c
  WHERE c.client_updated_at IS NOT NULL
    AND (
      c.repair_group = 'A'
      OR c.client_updated_at >= '2000-01-01T00:00:00Z'::timestamptz
    )
)
SELECT
  left(r.id::text, 8) AS session_id_prefix,
  r.old_started_at,
  r.old_duration_seconds,
  r.new_started_at,
  r.new_duration_seconds,
  r.repair_group
FROM repairable r
ORDER BY r.repair_group, r.old_started_at;

-- ---------------------------------------------------------------------------
-- 2. Summary counts (matches the NOTICE the migration itself prints).
-- ---------------------------------------------------------------------------
WITH candidates AS (
  SELECT
    ws.id,
    ws.duration_seconds AS old_duration_seconds,
    ws.started_at AS old_started_at,
    ws.client_updated_at,
    CASE
      WHEN ws.started_at = '1970-01-01T00:00:00Z'::timestamptz
        AND ws.duration_seconds BETWEEN 946684800
          AND (floor(extract(epoch FROM now()))::bigint + 86400)
      THEN 'A'
      WHEN ws.duration_seconds > 86400 THEN 'B'
      ELSE 'C'
    END AS repair_group
  FROM public.workout_sessions ws
  WHERE ws.started_at < '2000-01-01T00:00:00Z'::timestamptz
),
repairable AS (
  SELECT c.id, c.repair_group
  FROM candidates c
  WHERE c.client_updated_at IS NOT NULL
    AND (
      c.repair_group = 'A'
      OR c.client_updated_at >= '2000-01-01T00:00:00Z'::timestamptz
    )
)
SELECT
  (SELECT count(*) FROM repairable WHERE repair_group = 'A') AS group_a,
  (SELECT count(*) FROM repairable WHERE repair_group = 'B') AS group_b,
  (SELECT count(*) FROM repairable WHERE repair_group = 'C') AS group_c,
  (SELECT count(*) FROM candidates) - (SELECT count(*) FROM repairable) AS skipped,
  (SELECT count(*) FROM candidates) AS total_candidates;

-- ---------------------------------------------------------------------------
-- 3. Skipped rows only (client_updated_at NULL, or itself still before
--    2000-01-01) -- these are left alone by the migration and need operator
--    follow-up.
-- ---------------------------------------------------------------------------
WITH candidates AS (
  SELECT
    ws.id,
    ws.started_at AS old_started_at,
    ws.duration_seconds AS old_duration_seconds,
    ws.client_updated_at,
    CASE
      WHEN ws.started_at = '1970-01-01T00:00:00Z'::timestamptz
        AND ws.duration_seconds BETWEEN 946684800
          AND (floor(extract(epoch FROM now()))::bigint + 86400)
      THEN 'A'
      WHEN ws.duration_seconds > 86400 THEN 'B'
      ELSE 'C'
    END AS repair_group
  FROM public.workout_sessions ws
  WHERE ws.started_at < '2000-01-01T00:00:00Z'::timestamptz
)
SELECT
  left(c.id::text, 8) AS session_id_prefix,
  c.old_started_at,
  c.old_duration_seconds,
  c.client_updated_at,
  c.repair_group,
  CASE
    WHEN c.client_updated_at IS NULL THEN 'client_updated_at is NULL'
    ELSE 'client_updated_at is itself before 2000-01-01'
  END AS skip_reason
FROM candidates c
WHERE NOT (
  c.client_updated_at IS NOT NULL
  AND (
    c.repair_group = 'A'
    OR c.client_updated_at >= '2000-01-01T00:00:00Z'::timestamptz
  )
)
ORDER BY c.old_started_at;
