-- Reconcile the from-zero schema with prod (NF-8), drop client TRUNCATE /
-- REFERENCES / TRIGGER on public tables (NF-9), tighten the client write
-- surface on profiles and the OAuth tables, and restate the SECURITY DEFINER
-- lockdown with the current browser allow-list.
--
-- WHAT THIS FILE CLAIMS, AND WHAT IT DOES NOT
--   Sections 1-3 are catalog-gated: each step runs only if the catalog still
--   shows the pre-reconciliation shape, and each step that runs raises a
--   `reconcile:` NOTICE. Whether they run on production depends on
--   production's catalog, which nobody with prod access has read for these
--   columns; the operator note below is how that gets settled before a push.
--   The evidence available from here is contradictory and is recorded as
--   such, not resolved:
--     * `20260920000200_capture_dashboard_functions_and_cron.sql:369` records
--       `routines.created_at` as "timestamptz DEFAULT now(), nullable;
--       verified read-only 2026-09-18".
--     * `src/lib/database.types.ts` renders it `created_at: string` (i.e. NOT
--       NULL) -- but that file is a 2026-04-17 prod snapshot (last genuinely
--       generated at 8a02721; hand-patched since) and it predates
--       `exercise_catalog`, the `exercise_id` columns and
--       `local_profile_preferences`, all of which prod has. It is therefore
--       the weaker of the two sources, not the stronger one.
--   So: section 2 "runs only if the column is still nullable". Under the
--   000200 reading it DOES run on prod -- see the operator note in
--   docs/runbooks/operations.md ("PR 76 / 20260920007600 pre-apply check").
--   Sections 4, 6 and 7 change grants unconditionally; section 5 re-asserts
--   function grants (converging, not a no-op).
--
-- 1-3. Schema drift. A clean apply of the migration chain differed from prod
--      in these places (found by PR 4's generated-types diff against the
--      prod-generated database.types.ts at 97b2646):
--        * routine_exercises.per_set_echo_levels is jsonb in prod, text here;
--        * routines.created_at, routines.updated_at and
--          training_cycles.updated_at are NOT NULL in prod, nullable here;
--        * profiles.digest_frequency / digest_last_sent_at / feature_flags and
--          user_goals.last_snapshot_at exist only in prod. Their types and
--          defaults are RECONSTRUCTED from the 2026-04-20 prod audit DDL
--          (commit ad2eb6b,
--          20260420230000_comprehensive_dashboard_drift_reconciliation.sql),
--          whose file is now the stub 20260420210411 ("Applied remotely").
--          They are NOT catalog-verified: a type generator cannot express a
--          default, so `DEFAULT 'weekly'` and `DEFAULT '{}'::jsonb` rest on
--          that transcription alone. No code reads them.
--
--      per_set_echo_levels conversion uses to_jsonb(text), not text::jsonb.
--      mobile-sync-push stores the mobile's value, a JSON *string*
--      (pushPayloadSchema perSetEchoLevels: z.string()), so prod rows hold a
--      jsonb string scalar and mobile-sync-pull hands the same string back.
--      to_jsonb keeps existing from-zero rows in that same shape (and never
--      fails on malformed text); parsing them into arrays would change what
--      pull returns to the mobile app. The two conversions are pinned apart
--      by scripts/migration-gating (a JSON-array string, a non-JSON string
--      and NULL are driven through this ALTER on real rows).
--      Gate caveat: it compares data_type <> 'jsonb', and the generated types
--      render `json` and `jsonb` identically, so "prod is already jsonb"
--      cannot be read off the types. If prod's column is `json`, this step
--      rewrites routine_exercises there (semantically correct -- to_jsonb(json)
--      embeds the value -- but it takes ACCESS EXCLUSIVE). The operator
--      pre-apply check covers it.
--
--      NOT NULL: routines.updated_at / training_cycles.updated_at have
--      DEFAULT now() in the chain; routines.created_at has DEFAULT now() from
--      20260920000200. Rows with NULL are backfilled first (created_at from
--      updated_at when present) with the row triggers suppressed, so the
--      backfill cannot move updated_at -- the delta-pull cursor -- and cannot
--      re-pull every routine on every device. See section 2's comment.
--
-- 4.   anon and authenticated held Supabase's default TRUNCATE, REFERENCES
--      and TRIGGER on every public table. PostgREST never issues them, but
--      TRUNCATE bypasses RLS entirely. Revoked on existing tables and in the
--      default privileges of every grantor role this migration can alter.
--      Scope limits, both deliberate:
--        * A bare REVOKE only removes grants where the migration role is the
--          grantor, and ALTER DEFAULT PRIVILEGES only covers a role the
--          migration role is a member of. `supabase_admin`'s default ACL in
--          public still grants TRUNCATE/REFERENCES/TRIGGER to anon and
--          authenticated, and `postgres` is not a member of `supabase_admin`
--          on hosted Supabase (or locally): the ALTER fails with 42501. The
--          loop below catches that and reports it as a `residual:` NOTICE.
--          Tables created by platform tooling running as supabase_admin
--          therefore still get those privileges. Not fixable from a
--          `db push`, and not fixable by the operator either.
--        * Scope is schema `public` only. storage.objects / storage.buckets
--          and supabase_functions.hooks keep the same default grants. That is
--          accepted: those tables are owned by supabase_storage_admin /
--          supabase_functions_admin, a postgres REVOKE there mostly fails,
--          and storage-api re-grants on every upgrade. PostgREST emits no
--          TRUNCATE and the exposed schemas are public, graphql_public.
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
--        this file, supabase/tests/database/definer_function_grants.test.sql
--        and supabase/tests/database/schema_drift.test.sql. The prod grant
--        check in .github/workflows/prod-migration-drift.yml is a fourth copy
--        OWNED BY PR 32/77, deliberately not edited here; whichever version of
--        that workflow lands last must carry request_account_deletion().
--      This file has the highest migration version in the run, so its
--      allow-list is the final word: a browser-callable SECURITY DEFINER
--      function introduced by a lower-numbered migration is revoked here
--      unless it is added to v_allow_list.
--
-- 6.   profiles: table-wide INSERT/UPDATE for authenticated replaced by a
--      column list (the pattern from 20260517173000 for shared_routines).
--      Section 3's three new columns -- and the pre-existing
--      stripe_customer_id -- were client-writable through a plain PATCH.
--
-- 7.   oauth_tokens / oauth_states: REVOKE ALL from the client roles. Both
--      are service-role-only by policy and by every caller (all Edge OAuth
--      and sync handlers use a service-role client; the SPA never queries
--      them), but they still carried Supabase's default table grants with
--      only RLS in the way. Carried over from PR 4's security review R-17.
--
-- Idempotent: safe to re-run. Re-running emits no `reconcile:` NOTICE on a
-- database already in the target shape; `residual:` NOTICEs report gaps this
-- migration cannot close. Enforced by scripts/migration-gating/run.sh in CI.

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
-- 2. NOT NULL timestamps, backfilled first.
-- ---------------------------------------------------------------------------
-- Gated per column on pg_attribute, not information_schema: information_schema
-- is privilege-filtered (it shows only columns the current user holds some
-- privilege on), so a gate built on it can silently read "no drift", and
-- 20260920000200:374 already uses pg_attribute for the same job. to_regclass
-- returns NULL for a missing table, so each gate is independently false on a
-- database that never got the column.
--
-- Trigger suppression: `routines_updated_at` (20260323120000:59) is a BEFORE
-- UPDATE trigger running update_updated_at_column(), which sets
-- updated_at = now(). updated_at is the delta-pull cursor, so an unsuppressed
-- backfill would re-pull every touched routine on every device. Two mechanisms,
-- both needed:
--   * `phoenix.skip_updated_at` is the repo idiom (PR 21, 20260920002100:76-85,
--     backfill_client_updated_at()). Contrary to one review note it does guard
--     updated_at itself, not only client_updated_at -- but only once 002100 is
--     in the chain. On a chain without it, current_setting(..., true) returns
--     NULL for an unknown custom GUC and the set_config is inert.
--   * DISABLE TRIGGER USER is what makes the claim true on every chain. USER
--     needs ownership only (ALL would need superuser) and names no trigger, so
--     a later rename cannot break it. The whole migration is one transaction,
--     so an error between DISABLE and ENABLE rolls the trigger state back.
DO $$
DECLARE
  v_created_nullable boolean;
  v_updated_nullable boolean;
  v_cycles_nullable  boolean;
  v_prev text;
BEGIN
  SELECT NOT a.attnotnull INTO v_created_nullable
  FROM pg_attribute a
  WHERE a.attrelid = to_regclass('public.routines')
    AND a.attname = 'created_at' AND a.attnum > 0 AND NOT a.attisdropped;

  SELECT NOT a.attnotnull INTO v_updated_nullable
  FROM pg_attribute a
  WHERE a.attrelid = to_regclass('public.routines')
    AND a.attname = 'updated_at' AND a.attnum > 0 AND NOT a.attisdropped;

  v_created_nullable := coalesce(v_created_nullable, false);
  v_updated_nullable := coalesce(v_updated_nullable, false);

  IF v_created_nullable OR v_updated_nullable THEN
    IF v_created_nullable THEN
      RAISE NOTICE 'reconcile: routines.created_at SET NOT NULL';
    END IF;
    IF v_updated_nullable THEN
      RAISE NOTICE 'reconcile: routines.updated_at SET NOT NULL';
    END IF;

    v_prev := current_setting('phoenix.skip_updated_at', true);
    PERFORM set_config('phoenix.skip_updated_at', 'on', true);
    ALTER TABLE public.routines DISABLE TRIGGER USER;
    UPDATE public.routines
      SET created_at = coalesce(created_at, updated_at, now()),
          updated_at = coalesce(updated_at, created_at, now())
      WHERE created_at IS NULL OR updated_at IS NULL;
    ALTER TABLE public.routines ENABLE TRIGGER USER;
    PERFORM set_config('phoenix.skip_updated_at', coalesce(v_prev, ''), true);

    IF v_created_nullable THEN
      ALTER TABLE public.routines
        ALTER COLUMN created_at SET DEFAULT now(),
        ALTER COLUMN created_at SET NOT NULL;
    END IF;
    IF v_updated_nullable THEN
      ALTER TABLE public.routines
        ALTER COLUMN updated_at SET DEFAULT now(),
        ALTER COLUMN updated_at SET NOT NULL;
    END IF;
  END IF;

  SELECT NOT a.attnotnull INTO v_cycles_nullable
  FROM pg_attribute a
  WHERE a.attrelid = to_regclass('public.training_cycles')
    AND a.attname = 'updated_at' AND a.attnum > 0 AND NOT a.attisdropped;

  IF coalesce(v_cycles_nullable, false) THEN
    RAISE NOTICE 'reconcile: training_cycles.updated_at SET NOT NULL';

    v_prev := current_setting('phoenix.skip_updated_at', true);
    PERFORM set_config('phoenix.skip_updated_at', 'on', true);
    ALTER TABLE public.training_cycles DISABLE TRIGGER USER;
    -- training_cycles has no created_at column, so now() is the only source.
    UPDATE public.training_cycles
      SET updated_at = now()
      WHERE updated_at IS NULL;
    ALTER TABLE public.training_cycles ENABLE TRIGGER USER;
    PERFORM set_config('phoenix.skip_updated_at', coalesce(v_prev, ''), true);

    ALTER TABLE public.training_cycles
      ALTER COLUMN updated_at SET DEFAULT now(),
      ALTER COLUMN updated_at SET NOT NULL;
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 3. Prod-only columns. Types/defaults are RECONSTRUCTED from the 2026-04-20
--    prod audit DDL (ad2eb6b); they are not catalog-verified. The operator
--    pre-apply check in docs/runbooks/operations.md captures the real shape.
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
--    Scope limits are documented in the header (grantor role, schema public).
-- ---------------------------------------------------------------------------
REVOKE TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public FROM anon, authenticated;

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    -- Every grantor whose default ACL in public still hands the client roles
    -- one of these privileges, plus the roles this migration normally runs as.
    SELECT DISTINCT grantor FROM (
      SELECT pg_get_userbyid(d.defaclrole) AS grantor
      FROM pg_default_acl d
      JOIN pg_namespace n ON n.oid = d.defaclnamespace
      CROSS JOIN LATERAL aclexplode(d.defaclacl) AS a
      WHERE n.nspname = 'public'
        AND d.defaclobjtype = 'r'
        AND pg_get_userbyid(a.grantee) IN ('anon', 'authenticated')
        AND a.privilege_type IN ('TRUNCATE', 'REFERENCES', 'TRIGGER')
      UNION ALL SELECT 'postgres'
      UNION ALL SELECT current_user
    ) g
    WHERE EXISTS (SELECT 1 FROM pg_roles WHERE rolname = g.grantor)
    ORDER BY 1
  LOOP
    BEGIN
      EXECUTE format(
        'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public'
        || ' REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLES FROM anon, authenticated',
        r.grantor);
    EXCEPTION WHEN insufficient_privilege THEN
      -- Expected for supabase_admin: postgres is not a member of it, so this
      -- gap cannot be closed from a db push. Reported, not silently dropped.
      RAISE NOTICE 'residual: default privileges of % in schema public still grant TRUNCATE/REFERENCES/TRIGGER to anon/authenticated (%)',
        r.grantor, SQLERRM;
    END;
  END LOOP;
END
$$;

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

  -- Same predicate as the section-5 loop: assert only on functions that loop
  -- actually visits. An allow-listed function that is SECURITY INVOKER and not
  -- in v_dangerous is never granted above, so asserting on it would turn a
  -- later hardening PR into an unfixable clean-apply failure here.
  SELECT string_agg(format('%s', p.oid::regprocedure), '; ' ORDER BY p.oid::regprocedure::text)
  INTO v_offenders
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND format('%s(%s)', p.proname, oidvectortypes(p.proargtypes)) = ANY (v_allow_list)
    AND (p.prosecdef OR p.proname = ANY (v_dangerous))
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

-- ---------------------------------------------------------------------------
-- 6. profiles: column-list INSERT/UPDATE for authenticated.
-- ---------------------------------------------------------------------------
-- profiles already has a column-list SELECT grant (20260517173000:72-88) but
-- kept a table-wide INSERT/UPDATE, so every column added to it became
-- client-writable: a PATCH with a user JWT set feature_flags and returned 204.
-- The list below is exactly what the portal writes (src/mutations/profile.ts;
-- the mobile app never PATCHes profiles, it only reads subscriptions over
-- PostgREST). id/user_id/created_at stay unwritable on UPDATE, and
-- stripe_customer_id, digest_frequency, digest_last_sent_at and feature_flags
-- are server-owned. Same shape as shared_routines in 20260517173000:143-166.
REVOKE INSERT, UPDATE ON TABLE public.profiles FROM PUBLIC, anon, authenticated;
GRANT INSERT (
  id,
  display_name,
  avatar_url,
  created_at,
  updated_at,
  weight_unit,
  email_digests,
  push_notifications,
  streak_reminders,
  challenge_updates,
  profile_visible,
  leaderboard_participation
) ON TABLE public.profiles TO authenticated;
GRANT UPDATE (
  display_name,
  avatar_url,
  updated_at,
  weight_unit,
  email_digests,
  push_notifications,
  streak_reminders,
  challenge_updates,
  profile_visible,
  leaderboard_participation
) ON TABLE public.profiles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.profiles TO service_role;

-- ---------------------------------------------------------------------------
-- 7. oauth_tokens / oauth_states are service-role only (PR 4 review R-17).
-- ---------------------------------------------------------------------------
-- Both tables hold live provider credentials. RLS already denies every client
-- role (no policy any client can satisfy), but the Supabase default table
-- grants were still in place, so RLS was the only thing in the way. No SPA
-- query and no Edge caller uses anything but a service-role client, and
-- public.disconnect_integration() -- the one SQL writer -- is service_role
-- only, so the revoke costs nothing.
REVOKE ALL ON TABLE public.oauth_tokens FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.oauth_states FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.oauth_tokens TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.oauth_states TO service_role;

COMMIT;
