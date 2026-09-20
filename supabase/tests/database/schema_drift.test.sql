-- Prod-shape reconciliation and client table privileges
-- (20260920007600_reconcile_prod_schema_drift.sql).
--
-- Pins that a clean apply matches prod for the columns NF-8 found drifted
-- (types, nullability, defaults, prod-only columns), that anon and
-- authenticated hold no TRUNCATE / REFERENCES / TRIGGER on any public table
-- now or by default (NF-9), and that every allow-listed SECURITY DEFINER
-- function that exists is executable by authenticated (a missing expected
-- grant fails here, not only an over-broad one).
--
-- Allow-list (keep in sync with 20260920007600, definer_function_grants.test.sql
-- and the prod grant check in .github/workflows/prod-migration-drift.yml):
--   import_shared_routine(uuid, text), import_shared_cycle(uuid, text),
--   workout_current_streak(uuid), user_has_min_tier(text),
--   user_subscription_tier(), request_account_deletion()

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;

SELECT no_plan();

SELECT diag('database:schema-drift-columns');

SELECT col_type_is('public', 'routine_exercises', 'per_set_echo_levels', 'jsonb',
    'routine_exercises.per_set_echo_levels is jsonb (prod type)');

SELECT col_not_null('public', 'routines', 'created_at', 'routines.created_at is NOT NULL');
SELECT col_not_null('public', 'routines', 'updated_at', 'routines.updated_at is NOT NULL');
SELECT col_not_null('public', 'training_cycles', 'updated_at', 'training_cycles.updated_at is NOT NULL');
SELECT col_default_is('public', 'routines', 'created_at', 'now()', 'routines.created_at defaults to now()');
SELECT col_default_is('public', 'routines', 'updated_at', 'now()', 'routines.updated_at defaults to now()');
SELECT col_default_is('public', 'training_cycles', 'updated_at', 'now()',
    'training_cycles.updated_at defaults to now()');

SELECT col_type_is('public', 'profiles', 'digest_frequency', 'text', 'profiles.digest_frequency is text');
SELECT col_is_null('public', 'profiles', 'digest_frequency', 'profiles.digest_frequency is nullable');
SELECT col_default_is('public', 'profiles', 'digest_frequency', 'weekly'::text,
    'profiles.digest_frequency defaults to weekly');
SELECT col_type_is('public', 'profiles', 'digest_last_sent_at', 'timestamp with time zone',
    'profiles.digest_last_sent_at is timestamptz');
SELECT col_is_null('public', 'profiles', 'digest_last_sent_at', 'profiles.digest_last_sent_at is nullable');
SELECT col_hasnt_default('public', 'profiles', 'digest_last_sent_at',
    'profiles.digest_last_sent_at has no default');
SELECT col_type_is('public', 'profiles', 'feature_flags', 'jsonb', 'profiles.feature_flags is jsonb');
SELECT col_is_null('public', 'profiles', 'feature_flags', 'profiles.feature_flags is nullable');
SELECT col_default_is('public', 'profiles', 'feature_flags', '{}'::jsonb,
    'profiles.feature_flags defaults to {}');
SELECT col_type_is('public', 'user_goals', 'last_snapshot_at', 'timestamp with time zone',
    'user_goals.last_snapshot_at is timestamptz');
SELECT col_is_null('public', 'user_goals', 'last_snapshot_at', 'user_goals.last_snapshot_at is nullable');
SELECT col_hasnt_default('public', 'user_goals', 'last_snapshot_at',
    'user_goals.last_snapshot_at has no default');

SELECT diag('database:schema-drift-table-privileges');

SELECT is_empty(
    $sql$
        SELECT c.oid::regclass::text, r.rolname, pr.priv
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        CROSS JOIN (VALUES ('anon'), ('authenticated')) AS r(rolname)
        CROSS JOIN (VALUES ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) AS pr(priv)
        WHERE n.nspname = 'public'
          AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
          AND has_table_privilege(r.rolname, c.oid, pr.priv)
    $sql$,
    'anon/authenticated hold no TRUNCATE, REFERENCES or TRIGGER on any public relation'
);

SELECT is_empty(
    $sql$
        SELECT d.defaclobjtype, pg_get_userbyid(a.grantee), a.privilege_type
        FROM pg_default_acl d
        JOIN pg_namespace n ON n.oid = d.defaclnamespace
        CROSS JOIN LATERAL aclexplode(d.defaclacl) AS a
        WHERE n.nspname = 'public'
          AND d.defaclrole = 'postgres'::regrole
          AND d.defaclobjtype = 'r'
          AND pg_get_userbyid(a.grantee) IN ('anon', 'authenticated')
          AND a.privilege_type IN ('TRUNCATE', 'REFERENCES', 'TRIGGER')
    $sql$,
    'postgres default privileges in public grant no TRUNCATE/REFERENCES/TRIGGER to anon/authenticated'
);

-- A table postgres creates later does not get the privileges back.
CREATE TABLE public.schema_drift_probe (id int);
SELECT is(
    has_table_privilege('authenticated', 'public.schema_drift_probe', 'TRUNCATE')
      OR has_table_privilege('anon', 'public.schema_drift_probe', 'TRUNCATE'),
    false,
    'a newly created public table grants no TRUNCATE to anon/authenticated'
);
SELECT is(
    has_table_privilege('authenticated', 'public.schema_drift_probe', 'SELECT'),
    true,
    'default SELECT on new tables is unchanged (only TRUNCATE/REFERENCES/TRIGGER revoked)'
);
DROP TABLE public.schema_drift_probe;

SET LOCAL ROLE authenticated;
SELECT throws_ok(
    $sql$ TRUNCATE public.routines $sql$,
    '42501',
    NULL,
    'authenticated cannot TRUNCATE routines'
);
RESET ROLE;

SELECT diag('database:schema-drift-allow-list');

CREATE TEMP TABLE drift_allow_list (ident text PRIMARY KEY) ON COMMIT DROP;
INSERT INTO drift_allow_list (ident) VALUES
    ('import_shared_routine(uuid, text)'),
    ('import_shared_cycle(uuid, text)'),
    ('workout_current_streak(uuid)'),
    ('user_has_min_tier(text)'),
    ('user_subscription_tier()'),
    ('request_account_deletion()');

SELECT is_empty(
    $sql$
        SELECT format('%s(%s)', p.proname, oidvectortypes(p.proargtypes))
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        JOIN drift_allow_list a ON a.ident = format('%s(%s)', p.proname, oidvectortypes(p.proargtypes))
        WHERE n.nspname = 'public'
          AND (
            NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
            OR NOT has_function_privilege('service_role', p.oid, 'EXECUTE')
          )
    $sql$,
    'every allow-listed function that exists is executable by authenticated and service_role'
);

SELECT isnt_empty(
    $sql$
        SELECT 1
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND format('%s(%s)', p.proname, oidvectortypes(p.proargtypes))
              IN ('user_has_min_tier(text)', 'user_subscription_tier()')
    $sql$,
    'the tier helpers used by RLS exist'
);

SELECT * FROM finish();

ROLLBACK;
