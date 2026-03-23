-- Fix: shared_routines/shared_cycles profiles join + owner edit/delete policies
-- The profiles(...) PostgREST join requires a FK path from shared_routines to profiles.
-- Currently only shared_routines_routine_id_fkey exists; user_id references auth.users
-- with no FK to profiles, so the join returns null ("Unknown" author).

-- 0. Backfill missing profiles for users who shared content but lack a profile row.
--    In Supabase, profiles.id = auth.users.id. Some users may exist in auth.users
--    without a corresponding profiles entry (e.g., trigger didn't fire).
INSERT INTO profiles (id)
SELECT DISTINCT sr.user_id FROM shared_routines sr
WHERE NOT EXISTS (SELECT 1 FROM profiles p WHERE p.id = sr.user_id)
ON CONFLICT (id) DO NOTHING;

INSERT INTO profiles (id)
SELECT DISTINCT sc.user_id FROM shared_cycles sc
WHERE NOT EXISTS (SELECT 1 FROM profiles p WHERE p.id = sc.user_id)
ON CONFLICT (id) DO NOTHING;

-- 1. Add FK from shared_routines.user_id → profiles.id
ALTER TABLE shared_routines
  ADD CONSTRAINT shared_routines_user_id_profiles_fkey
  FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;

-- 2. Add FK from shared_cycles.user_id → profiles.id
ALTER TABLE shared_cycles
  ADD CONSTRAINT shared_cycles_user_id_profiles_fkey
  FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;

-- 3. Allow authors to delete their own shared routines
CREATE POLICY "Users can delete own shared routines"
  ON shared_routines FOR DELETE USING (auth.uid() = user_id);

-- 4. Allow authors to delete their own shared cycles
CREATE POLICY "Users can delete own shared cycles"
  ON shared_cycles FOR DELETE USING (auth.uid() = user_id);

-- 5. Fix estimated_duration: convert any existing seconds values to minutes
-- Values > 300 are almost certainly stored in seconds (no routine takes 5+ hours)
UPDATE routines SET estimated_duration = ROUND(estimated_duration / 60)
  WHERE estimated_duration > 300;
UPDATE shared_routines SET estimated_duration = ROUND(estimated_duration / 60)
  WHERE estimated_duration > 300;

-- 6. Backfill profiles for ALL auth users (not just sharers)
INSERT INTO profiles (id)
SELECT id FROM auth.users
ON CONFLICT (id) DO NOTHING;

-- 7. Auto-create profile row on user signup (with display_name from email)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name)
  VALUES (NEW.id, split_part(NEW.email, '@', 1))
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 8. Fix community_comments INSERT policy — old tier names (PHOENIX/ELITE) → current names
DROP POLICY IF EXISTS "Premium users can post comments" ON community_comments;
CREATE POLICY "Premium users can post comments"
  ON community_comments FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND user_subscription_tier() IN ('EMBER', 'FLAME', 'INFERNO')
  );

-- 9. Add FK from community_comments.user_id → profiles.id (enables PostgREST join)
ALTER TABLE community_comments
  ADD CONSTRAINT community_comments_user_id_profiles_fkey
  FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;

-- 10. Backfill display_name from email for existing profiles with null name
UPDATE profiles p
SET display_name = split_part(au.email, '@', 1)
FROM auth.users au
WHERE p.id = au.id
AND p.display_name IS NULL;
