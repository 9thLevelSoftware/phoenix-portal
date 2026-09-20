-- Reconcile the from-zero schema with prod (NF-8), drop client TRUNCATE /
-- REFERENCES / TRIGGER on public tables (NF-9), and restate the SECURITY
-- DEFINER lockdown with the current browser allow-list.
--
-- 1-3. Schema drift. A clean apply of the migration chain differed from prod
--      in these places (found by PR 4's generated-types diff against the
--      prod-generated database.types.ts at 97b2646):
--        * routine_exercises.per_set_echo_levels is jsonb in prod, text here;
--        * routines.created_at, routines.updated_at and
--          training_cycles.updated_at are NOT NULL in prod, nullable here;
--        * profiles.digest_frequency / digest_last_sent_at / feature_flags and
--          user_goals.last_snapshot_at exist only in prod. Their types and
--          defaults come from the 2026-04-20 prod audit DDL (commit ad2eb6b,
--          20260420230000_comprehensive_dashboard_drift_reconciliation.sql),
--          whose file is now the stub 20260420210411 ("Applied remotely").
--          No code reads them.
--      Every step is gated on the catalog, so on prod (already that shape)
--      none of them runs and no table lock is taken. Each step that does run
--      raises a `reconcile:` NOTICE.
--
--      per_set_echo_levels conversion uses to_jsonb(text), not text::jsonb.
--      mobile-sync-push stores the mobile's value, a JSON *string*
--      (pushPayloadSchema perSetEchoLevels: z.string()), so prod rows hold a
--      jsonb string scalar and mobile-sync-pull hands the same string back.
--      to_jsonb keeps existing from-zero rows in that same shape (and never
--      fails on malformed text); parsing them into arrays would change what
--      pull returns to the mobile app. Prod never runs this conversion.
--
--      NOT NULL: routines.updated_at / training_cycles.updated_at have
--      DEFAULT now() in the chain; routines.created_at has DEFAULT now() from
--      20260920000200. Rows with NULL are backfilled first (created_at from
--      updated_at when present). Evidence note: 20260920000200 records
--      routines.created_at as nullable in prod, but the prod-generated types
--      (`created_at: string`, no `| null`) say NOT NULL, as for the other two.
--      If prod were nullable, this step would run there as a single
--      catalog-gated backfill + SET NOT NULL on routines.
--
-- 4.   anon and authenticated held Supabase's default TRUNCATE, REFERENCES
--      and TRIGGER on every public table. PostgREST never issues them, but
--      TRUNCATE bypasses RLS entirely. Revoke them on existing tables and in
--      postgres's default privileges for public, so new tables do not get
--      them back. This is the one section that changes prod (grants only).
--
-- 5.   Restated lockdown (20260920000100 sections 3, 3b, 6 and 7), with the
--      browser allow-list extended by public.request_account_deletion()
--      (PR 32). 20260920000100 cannot be edited, and its allow-list does not
--      name that function, so a re-run of it would revoke authenticated's
--      EXECUTE; running this block afterwards re-grants it. It is the only
--      SECURITY DEFINER function added since 20260920000100 that the browser
--      calls; the other new authenticated-executable functions are SECURITY
--      INVOKER and are not touched by this loop. On a database without
--      request_account_deletion the entry matches nothing.
--      Allow-list copies (keep in sync):
--        this file, supabase/tests/database/definer_function_grants.test.sql,
--        supabase/tests/database/schema_drift.test.sql and the prod grant
--        check in .github/workflows/prod-migration-drift.yml.
--
-- Idempotent: safe to re-run; a no-op on prod apart from section 4.

BEGIN;

SET LOCAL lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. routine_exercises.per_set_echo_levels: text -> jsonb (prod type).
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'routine_exercises'
      AND column_name = 'per_set_echo_levels'
      AND data_type <> 'jsonb'
  ) THEN
    RAISE NOTICE 'reconcile: routine_exercises.per_set_echo_levels -> jsonb';
    ALTER TABLE public.routine_exercises
      ALTER COLUMN per_set_echo_levels TYPE jsonb
      USING to_jsonb(per_set_echo_levels);
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 2. NOT NULL timestamps (prod shape), backfilled first.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  -- One backfill for both routines columns. The BEFORE UPDATE trigger
  -- routines_updated_at stamps updated_at = now() on every row touched here,
  -- so a backfilled row is simply pulled again by delta sync (drifted
  -- databases only; prod never runs this).
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'routines'
      AND column_name IN ('created_at', 'updated_at') AND is_nullable = 'YES'
  ) THEN
    RAISE NOTICE 'reconcile: routines.created_at/updated_at SET NOT NULL';
    UPDATE public.routines
      SET created_at = coalesce(created_at, updated_at, now()),
          updated_at = coalesce(updated_at, now())
      WHERE created_at IS NULL OR updated_at IS NULL;
    ALTER TABLE public.routines
      ALTER COLUMN created_at SET DEFAULT now(),
      ALTER COLUMN created_at SET NOT NULL,
      ALTER COLUMN updated_at SET DEFAULT now(),
      ALTER COLUMN updated_at SET NOT NULL;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'training_cycles'
      AND column_name = 'updated_at' AND is_nullable = 'YES'
  ) THEN
    RAISE NOTICE 'reconcile: training_cycles.updated_at SET NOT NULL';
    UPDATE public.training_cycles
      SET updated_at = now()
      WHERE updated_at IS NULL;
    ALTER TABLE public.training_cycles ALTER COLUMN updated_at SET DEFAULT now();
    ALTER TABLE public.training_cycles ALTER COLUMN updated_at SET NOT NULL;
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 3. Prod-only columns (types/defaults from the 2026-04-20 prod audit DDL).
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'digest_frequency'
  ) THEN
    RAISE NOTICE 'reconcile: add profiles.digest_frequency';
    ALTER TABLE public.profiles ADD COLUMN digest_frequency text DEFAULT 'weekly';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'digest_last_sent_at'
  ) THEN
    RAISE NOTICE 'reconcile: add profiles.digest_last_sent_at';
    ALTER TABLE public.profiles ADD COLUMN digest_last_sent_at timestamptz;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'feature_flags'
  ) THEN
    RAISE NOTICE 'reconcile: add profiles.feature_flags';
    ALTER TABLE public.profiles ADD COLUMN feature_flags jsonb DEFAULT '{}'::jsonb;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'user_goals' AND column_name = 'last_snapshot_at'
  ) THEN
    RAISE NOTICE 'reconcile: add user_goals.last_snapshot_at';
    ALTER TABLE public.user_goals ADD COLUMN last_snapshot_at timestamptz;
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 4. No TRUNCATE / REFERENCES / TRIGGER for anon or authenticated (NF-9).
-- ---------------------------------------------------------------------------
REVOKE TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public FROM anon, authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLES FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Restated SECURITY DEFINER lockdown (20260920000100 sections 3, 3b, 6, 7)
--    with the current browser allow-list.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_allow_list CONSTANT TEXT[] := ARRAY[
    'import_shared_routine(uuid, text)',
    'import_shared_cycle(uuid, text)',
    'workout_current_streak(uuid)',
    'user_has_min_tier(text)',
    'user_subscription_tier()',
    'request_account_deletion()'
  ];
  v_dangerous CONSTANT TEXT[] := ARRAY[
    'get_routines_excluding_ids',
    'get_sessions_excluding_ids',
    'get_cycles_excluding_ids',
    'get_personal_records_excluding_ids',
    'get_badges_excluding_ids',
    'get_personal_record_tombstones',
    'get_percentile_rank',
    'get_profile_stats',
    'refresh_hot_scores',
    'refresh_community_benchmarks',
    'insert_routine_exercises_from_snapshot',
    'replace_session_children',
    'replace_user_insights',
    'apply_subscription_event',
    'disconnect_integration'
  ];
  fn RECORD;
BEGIN
  FOR fn IN
    SELECT p.oid::regprocedure AS sig,
           format('%s(%s)', p.proname, oidvectortypes(p.proargtypes)) AS ident,
           pg_get_userbyid(p.proowner) AS owner
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prokind = 'f'
      AND (p.prosecdef OR p.proname = ANY (v_dangerous))
      AND NOT EXISTS (
        SELECT 1 FROM pg_depend d
        WHERE d.classid = 'pg_proc'::regclass
          AND d.objid = p.oid
          AND d.deptype = 'e'
      )
    ORDER BY 2
  LOOP
    IF fn.owner <> current_user THEN
      RAISE NOTICE 'lockdown: % is owned by %, grants may not change', fn.sig, fn.owner;
    END IF;
    BEGIN
      IF fn.ident = ANY (v_allow_list) THEN
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', fn.sig);
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', fn.sig);
      ELSE
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn.sig);
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn.sig);
      END IF;
    EXCEPTION WHEN insufficient_privilege THEN
      RAISE NOTICE 'lockdown: skipped grants on % (%)', fn.sig, SQLERRM;
    END;
  END LOOP;
END;
$$;

-- 5b. Keep anon on a tier helper only while a PUBLIC/anon SELECT/ALL policy
--     calls it (same predicate as 20260920000100 block 3b).
DO $$
DECLARE
  fn RECORD;
BEGIN
  FOR fn IN
    SELECT p.oid::regprocedure AS sig, p.proname
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND format('%s(%s)', p.proname, oidvectortypes(p.proargtypes))
          IN ('user_has_min_tier(text)', 'user_subscription_tier()')
  LOOP
    IF EXISTS (
      SELECT 1
      FROM pg_policies pol
      WHERE pol.roles && ARRAY['public', 'anon']::name[]
        AND pol.cmd IN ('SELECT', 'ALL')
        AND (
          coalesce(pol.qual, '') LIKE '%' || fn.proname || '(%'
          OR coalesce(pol.with_check, '') LIKE '%' || fn.proname || '(%'
        )
    ) THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO anon', fn.sig);
      RAISE NOTICE 'lockdown: kept anon EXECUTE on % because a PUBLIC/anon SELECT policy calls it', fn.sig;
    END IF;
  END LOOP;
END;
$$;

-- 5c. Default privileges for functions (re-assert 20260920000100 section 6).
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM anon, authenticated;

-- 5d. Self-assertion: no dangerous function exposed, and every allow-listed
--     function that exists is executable by authenticated (missing expected
--     grant). Other exposed definers are reported with a NOTICE.
DO $$
DECLARE
  v_allow_list CONSTANT TEXT[] := ARRAY[
    'import_shared_routine(uuid, text)',
    'import_shared_cycle(uuid, text)',
    'workout_current_streak(uuid)',
    'user_has_min_tier(text)',
    'user_subscription_tier()',
    'request_account_deletion()'
  ];
  v_dangerous CONSTANT TEXT[] := ARRAY[
    'get_routines_excluding_ids',
    'get_sessions_excluding_ids',
    'get_cycles_excluding_ids',
    'get_personal_records_excluding_ids',
    'get_badges_excluding_ids',
    'get_personal_record_tombstones',
    'get_percentile_rank',
    'get_profile_stats',
    'refresh_hot_scores',
    'refresh_community_benchmarks',
    'insert_routine_exercises_from_snapshot',
    'replace_session_children',
    'replace_user_insights',
    'apply_subscription_event',
    'disconnect_integration'
  ];
  v_offenders TEXT;
  fn RECORD;
BEGIN
  SELECT string_agg(
           format('%s (anon=%s, authenticated=%s)',
                  p.oid::regprocedure,
                  has_function_privilege('anon', p.oid, 'EXECUTE'),
                  has_function_privilege('authenticated', p.oid, 'EXECUTE')),
           '; ' ORDER BY p.oid::regprocedure::text)
  INTO v_offenders
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = ANY (v_dangerous)
    AND NOT EXISTS (
      SELECT 1 FROM pg_depend d
      WHERE d.classid = 'pg_proc'::regclass
        AND d.objid = p.oid
        AND d.deptype = 'e'
    )
    AND (
      has_function_privilege('anon', p.oid, 'EXECUTE')
      OR has_function_privilege('authenticated', p.oid, 'EXECUTE')
    );

  IF v_offenders IS NOT NULL THEN
    RAISE EXCEPTION 'lockdown: dangerous functions still executable by anon/authenticated: %', v_offenders
      USING ERRCODE = '42501';
  END IF;

  SELECT string_agg(format('%s', p.oid::regprocedure), '; ' ORDER BY p.oid::regprocedure::text)
  INTO v_offenders
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND format('%s(%s)', p.proname, oidvectortypes(p.proargtypes)) = ANY (v_allow_list)
    AND pg_get_userbyid(p.proowner) = current_user
    AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE');

  IF v_offenders IS NOT NULL THEN
    RAISE EXCEPTION 'lockdown: allow-listed functions not executable by authenticated: %', v_offenders
      USING ERRCODE = '42501';
  END IF;

  FOR fn IN
    SELECT p.oid::regprocedure AS sig,
           has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_exec,
           has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_exec
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef
      AND NOT (format('%s(%s)', p.proname, oidvectortypes(p.proargtypes)) = ANY (v_allow_list))
      AND NOT EXISTS (
        SELECT 1 FROM pg_depend d
        WHERE d.classid = 'pg_proc'::regclass
          AND d.objid = p.oid
          AND d.deptype = 'e'
      )
      AND (
        has_function_privilege('anon', p.oid, 'EXECUTE')
        OR has_function_privilege('authenticated', p.oid, 'EXECUTE')
      )
  LOOP
    RAISE NOTICE 'lockdown: % still executable (anon=%, authenticated=%)',
      fn.sig, fn.anon_exec, fn.auth_exec;
  END LOOP;
END;
$$;

COMMIT;
