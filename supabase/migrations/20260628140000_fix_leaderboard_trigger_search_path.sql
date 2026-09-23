-- F220: update_leaderboard_events_updated_at() is a SECURITY DEFINER trigger
-- function declared with `SET search_path = public`. Including a mutable schema
-- in a definer function's search_path is a Supabase security-linter finding and
-- a search-path hijack vector. Redefine with an empty search_path and
-- schema-qualify now(). Idempotent: CREATE OR REPLACE preserves the existing
-- trigger binding.

CREATE OR REPLACE FUNCTION public.update_leaderboard_events_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at = pg_catalog.now();
  RETURN NEW;
END;
$$;
