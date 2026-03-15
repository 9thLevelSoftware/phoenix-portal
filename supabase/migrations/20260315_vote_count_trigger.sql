-- Phase 23: Auto-update vote_count on shared_routines/shared_cycles
-- Mirrors update_comment_count() pattern from 20260218_phase11_comments.sql

CREATE OR REPLACE FUNCTION public.update_vote_count()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.item_type = 'routine' THEN
      UPDATE shared_routines SET vote_count = vote_count + 1 WHERE id = NEW.item_id;
    ELSE
      UPDATE shared_cycles SET vote_count = vote_count + 1 WHERE id = NEW.item_id;
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.item_type = 'routine' THEN
      UPDATE shared_routines SET vote_count = GREATEST(0, vote_count - 1) WHERE id = OLD.item_id;
    ELSE
      UPDATE shared_cycles SET vote_count = GREATEST(0, vote_count - 1) WHERE id = OLD.item_id;
    END IF;
    RETURN OLD;
  END IF;
  RETURN COALESCE(NEW, OLD);
END; $$;

CREATE TRIGGER update_vote_count_on_change
  AFTER INSERT OR DELETE ON community_votes
  FOR EACH ROW EXECUTE FUNCTION public.update_vote_count();
