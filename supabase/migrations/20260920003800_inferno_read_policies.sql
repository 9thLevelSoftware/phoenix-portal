-- PR 38: gate the force-curve and biomechanics data at INFERNO, server-side.
--
-- User decision (2026-09-18): force curves are an INFERNO feature, and paid
-- capability is enforced on the server — the rows must not leave the database
-- for a user who has not paid for them. A route guard in the browser is not a
-- boundary.
--
-- Tables gated here (KD-12):
--   * rep_telemetry            — per-sample force / velocity / position
--   * vbt_assessments          — velocity-based 1RM assessments
--   * session_phase_statistics — concentric / eccentric load, speed, power
--   * exercise_signatures      — ROM / symmetry / velocity-profile signatures
--
-- The `telemetry_points` view over rep_telemetry is `security_invoker`
-- (20260324120000_fix_security_definer_views.sql), so it inherits the gate;
-- it is the reader the session-replay page actually uses.
--
-- NOT gated (deliberately):
--   * rep_summaries stays readable at the user's existing tier. Session replay
--     is FLAME and degrades to rep-by-rep playback built from rep_summaries,
--     with an explicit "Force curves require Inferno" notice in the UI.
--   * The GDPR export is unaffected: export-user-data reads with the service
--     role, which bypasses RLS, so a FLAME (or FREE) user can still export
--     every telemetry row they own. Gating reads must never gate Article 15.
--   * The service_role INSERT / ALL policies are untouched, so mobile-sync-push
--     keeps writing telemetry for EMBER+ users regardless of this gate.
--   * The existing authenticated INSERT policy on rep_telemetry is untouched.
--
-- Rules applied (same as PR 9, 20260920000900_flame_write_policies.sql):
--   * `(select ...)` wrappers around auth.uid() and user_has_min_tier() so
--     Postgres evaluates each once per statement as an initPlan (R-37).
--   * `TO authenticated`, so anon is not accidentally granted a policy.
--   * DROP POLICY IF EXISTS + CREATE POLICY, so the migration is re-runnable.
--
-- No function is created or replaced here, so there is nothing to add to the
-- PR 76 SECURITY DEFINER allow-list and no database.types.ts regeneration:
-- policies do not change the generated schema.

-- ---------------------------------------------------------------------------
-- 1. rep_telemetry — raw force curves (read through telemetry_points too)
-- ---------------------------------------------------------------------------

-- Pre-denormalisation name (00002_base_schema.sql). Already dropped by
-- 20260228_rls_denormalization.sql; dropped again so a database that never ran
-- that migration cleanly cannot keep an ungated permissive SELECT policy
-- ORing the gate away.
DROP POLICY IF EXISTS "Users can view telemetry in own sessions" ON public.rep_telemetry;

DROP POLICY IF EXISTS "Users can view own telemetry" ON public.rep_telemetry;
CREATE POLICY "Users can view own telemetry"
  ON public.rep_telemetry FOR SELECT
  TO authenticated
  USING (
    (select auth.uid()) = user_id
    AND (select public.user_has_min_tier('INFERNO'))
  );

-- ---------------------------------------------------------------------------
-- 2. vbt_assessments — velocity-based 1RM
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "Users can view own VBT assessments" ON public.vbt_assessments;
CREATE POLICY "Users can view own VBT assessments"
  ON public.vbt_assessments FOR SELECT
  TO authenticated
  USING (
    (select auth.uid()) = user_id
    AND (select public.user_has_min_tier('INFERNO'))
  );

-- ---------------------------------------------------------------------------
-- 3. session_phase_statistics — concentric / eccentric load, speed, power
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "Users can view own phase statistics" ON public.session_phase_statistics;
CREATE POLICY "Users can view own phase statistics"
  ON public.session_phase_statistics FOR SELECT
  TO authenticated
  USING (
    (select auth.uid()) = user_id
    AND (select public.user_has_min_tier('INFERNO'))
  );

-- ---------------------------------------------------------------------------
-- 4. exercise_signatures — ROM / symmetry / velocity profile
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "Users can view own exercise signatures" ON public.exercise_signatures;
CREATE POLICY "Users can view own exercise signatures"
  ON public.exercise_signatures FOR SELECT
  TO authenticated
  USING (
    (select auth.uid()) = user_id
    AND (select public.user_has_min_tier('INFERNO'))
  );
