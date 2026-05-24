-- Reconcile production migration history.
--
-- Production already contains migration version 20260503160018, but the
-- corresponding migration file was missing from the repository. The Supabase
-- GitHub integration refuses to deploy new main-branch migrations while remote
-- versions are absent locally. Keep this no-op file so local history can match
-- the production history without changing schema on fresh databases.
DO $$
BEGIN
  NULL;
END $$;
