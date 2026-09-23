-- Security hardening and dead-path removal (consolidation PR C3).
--
-- 1. NF-31  challenge_participants: anon and authenticated held table-wide
--           and per-column UPDATE with no UPDATE policy. The SPA only INSERTs
--           (join) and DELETEs (leave); completion is server-side. Revoked.
-- 2. OP-14  workout_sessions: authenticated kept UPDATE(notes) only for a
--           notes hook with no UI. The hook is deleted; the grant goes too.
-- 3. NF-30  check_comment_rate_limit counted LIVE community_comments rows, so
--           a hard delete handed back a slot. It now counts write events in
--           private.comment_rate_events (same limit: 5 per hour per user).
-- NF-36 (the INFERNO gate on exercise_progress.velocity_estimated_1rm_kg) is
-- NOT here: revoking a column the deployed SPA reads with select("*") would
-- break it under migrations-first rollout. This PR ships the explicit-column
-- reader; the revoke follows in a later migration applied after it is live.
--
-- Idempotent throughout; re-applying converges.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. NF-31
-- ---------------------------------------------------------------------------
REVOKE UPDATE ON public.challenge_participants FROM anon, authenticated;

DO $$
DECLARE
  r record;
BEGIN
  -- A table-level REVOKE leaves separately granted column privileges alone.
  FOR r IN
    SELECT DISTINCT grantee, column_name
    FROM information_schema.column_privileges
    WHERE table_schema = 'public'
      AND table_name = 'challenge_participants'
      AND privilege_type = 'UPDATE'
      AND grantee IN ('anon', 'authenticated')
  LOOP
    EXECUTE format(
      'REVOKE UPDATE (%I) ON public.challenge_participants FROM %I',
      r.column_name, r.grantee
    );
  END LOOP;
END
$$;

-- ---------------------------------------------------------------------------
-- 2. OP-14
-- ---------------------------------------------------------------------------
REVOKE UPDATE (notes) ON public.workout_sessions FROM authenticated;

-- ---------------------------------------------------------------------------
-- 3. NF-30
-- ---------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS private;

CREATE TABLE IF NOT EXISTS private.comment_rate_events (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS comment_rate_events_user_created_idx
  ON private.comment_rate_events (user_id, created_at);

REVOKE ALL ON TABLE private.comment_rate_events FROM PUBLIC, anon, authenticated;

-- Carry the current hour's window over once, from the comments that exist.
INSERT INTO private.comment_rate_events (user_id, created_at)
SELECT c.user_id, c.created_at
FROM public.community_comments c
WHERE c.user_id IS NOT NULL
  AND c.created_at > now() - INTERVAL '1 hour'
  AND NOT EXISTS (SELECT 1 FROM private.comment_rate_events);

CREATE OR REPLACE FUNCTION public.check_comment_rate_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  recent_count int;
BEGIN
  -- Serialize one user's concurrent comment inserts so two cannot both see 4.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('comment-rate:' || NEW.user_id::text, 0)
  );

  DELETE FROM private.comment_rate_events
  WHERE user_id = NEW.user_id
    AND created_at <= now() - INTERVAL '1 hour';

  SELECT count(*) INTO recent_count
  FROM private.comment_rate_events
  WHERE user_id = NEW.user_id
    AND created_at > now() - INTERVAL '1 hour';

  IF recent_count >= 5 THEN
    RAISE EXCEPTION 'Rate limit exceeded: maximum 5 comments per hour';
  END IF;

  -- Rolled back with the comment if the insert fails later.
  INSERT INTO private.comment_rate_events (user_id) VALUES (NEW.user_id);
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.check_comment_rate_limit() FROM PUBLIC, anon, authenticated;


COMMIT;
