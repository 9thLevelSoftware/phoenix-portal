-- Ensure community vote counter trigger can update shared content rows
-- regardless of the voting user's row-level permissions.

CREATE OR REPLACE FUNCTION public.update_vote_count()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.item_type = 'routine' THEN
      UPDATE public.shared_routines
      SET vote_count = vote_count + 1
      WHERE id = NEW.item_id;
    ELSE
      UPDATE public.shared_cycles
      SET vote_count = vote_count + 1
      WHERE id = NEW.item_id;
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.item_type = 'routine' THEN
      UPDATE public.shared_routines
      SET vote_count = GREATEST(0, vote_count - 1)
      WHERE id = OLD.item_id;
    ELSE
      UPDATE public.shared_cycles
      SET vote_count = GREATEST(0, vote_count - 1)
      WHERE id = OLD.item_id;
    END IF;
    RETURN OLD;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS update_vote_count_on_change ON public.community_votes;
CREATE TRIGGER update_vote_count_on_change
  AFTER INSERT OR DELETE ON public.community_votes
  FOR EACH ROW
  EXECUTE FUNCTION public.update_vote_count();
