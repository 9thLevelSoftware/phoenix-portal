-- Prod-shape reconciliation and client table privileges
-- (20260920007600_reconcile_prod_schema_drift.sql).
--
-- Pins that a clean apply matches the shape NF-8 reconciled (types,
-- nullability, defaults, prod-only columns), that anon and authenticated hold
-- no TRUNCATE / REFERENCES / TRIGGER on any public table now or by default
-- (NF-9), that profiles' server-owned columns and the OAuth token tables are
-- not client-writable, and that every allow-listed SECURITY DEFINER function
-- that exists is executable by authenticated (a missing expected grant fails
-- here, not only an over-broad one).
--
-- Division of labour with the sibling suite (do not assume more than this):
--   * definer_function_grants.test.sql owns the EXHAUSTIVE check -- its
--     set_eq fails when any non-allow-listed definer becomes executable by
--     anon/authenticated. It is the authority on the allow-list.
--   * this file owns the MISSING-grant check (an allow-listed function that
--     exists but is not executable) plus the prod-shape and table-privilege
--     assertions. It also carries its own unlisted-definer is_empty so it does
--     not pass vacuously, but the sibling's set_eq is the stricter of the two.
--
-- Allow-list (keep in sync with 20260920007600 and
-- definer_function_grants.test.sql; the copy in
-- .github/workflows/prod-migration-drift.yml is owned by PR 32/77):
--   import_shared_routine(uuid, text), import_shared_cycle(uuid, text),
--   workout_current_streak(uuid), user_has_min_tier(text),
--   user_subscription_tier(), request_account_deletion(),
--   delete_training_cycle_lww, delete_workout_with_tombstone,
--   verify_profile_recovery_source (20260920120000),
--   exercise_progress_series, exercise_progress_series_many (20260925900000)
--
-- What this file deliberately does NOT cover:
--   * the migration's gating / idempotency / drifted-with-data behaviour. The
--     suite runs against a freshly migrated empty database, so section 2's
--     backfill executes over zero rows here. scripts/migration-gating/run.sh
--     (wired into .github/workflows/migrations.yml) drives those paths.
--   * a default ACL owned by supabase_admin. `supabase test db` runs as
--     postgres, which may not SET ROLE supabase_admin, so a live probe of a
--     supabase_admin-created table is impossible from inside the suite. The
--     catalog assertions below cover it instead.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;

SELECT plan(38);

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

-- The four columns below are reconstructed from the 2026-04-20 prod audit DDL
-- (ad2eb6b), not from a catalog read of prod. These assertions pin what this
-- repo ships; they are not evidence about production.
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

SELECT diag('database:schema-drift-echo-levels-jsonb-shape');

-- The migration converts per_set_echo_levels with to_jsonb(text), NOT
-- text::jsonb, because mobile stores a JSON *string* and mobile-sync-pull must
-- hand the same string back. col_type_is above passes under either conversion,
-- so the write-side contract is pinned here: a JSON-array string must land as
-- a jsonb STRING SCALAR (jsonb_typeof = 'string'), a non-JSON string must be
-- storable at all, and NULL must stay NULL. to_jsonb(...::text) is what
-- PostgREST/Edge do with a JS string; a bare '[...]' literal would be parsed
-- by the jsonb input function and would test nothing.
-- The conversion itself (this migration's USING clause on real text rows) is
-- driven by scripts/migration-gating/.
INSERT INTO auth.users (id, email)
VALUES ('d7000000-0000-4000-8000-00000000d701'::uuid, 'schema-drift@example.test')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.routines (id, user_id, name)
VALUES ('d7000000-1111-4000-8000-00000000d701'::uuid,
        'd7000000-0000-4000-8000-00000000d701'::uuid,
        'schema drift routine')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.routine_exercises (id, routine_id, name, per_set_echo_levels)
VALUES
    ('d7000000-2222-4000-8000-00000000d701'::uuid,
     'd7000000-1111-4000-8000-00000000d701'::uuid,
     'json array string',
     to_jsonb('["LEVEL_1","LEVEL_2"]'::text)),
    ('d7000000-2222-4000-8000-00000000d702'::uuid,
     'd7000000-1111-4000-8000-00000000d701'::uuid,
     'non json string',
     to_jsonb('not json'::text)),
    ('d7000000-2222-4000-8000-00000000d703'::uuid,
     'd7000000-1111-4000-8000-00000000d701'::uuid,
     'null echo levels',
     NULL);

SELECT is(
    (SELECT jsonb_typeof(per_set_echo_levels) FROM public.routine_exercises
     WHERE id = 'd7000000-2222-4000-8000-00000000d701'::uuid),
    'string',
    'a JSON-array string stores as a jsonb string scalar, not an array (to_jsonb, not ::jsonb)'
);
SELECT is(
    (SELECT per_set_echo_levels #>> '{}' FROM public.routine_exercises
     WHERE id = 'd7000000-2222-4000-8000-00000000d701'::uuid),
    '["LEVEL_1","LEVEL_2"]',
    'the JSON-array string round-trips byte for byte'
);
SELECT is(
    (SELECT jsonb_typeof(per_set_echo_levels) FROM public.routine_exercises
     WHERE id = 'd7000000-2222-4000-8000-00000000d702'::uuid),
    'string',
    'a non-JSON string is storable and stays a jsonb string scalar (::jsonb would have raised 22P02)'
);
SELECT is(
    (SELECT per_set_echo_levels #>> '{}' FROM public.routine_exercises
     WHERE id = 'd7000000-2222-4000-8000-00000000d702'::uuid),
    'not json',
    'the non-JSON string round-trips byte for byte'
);
SELECT ok(
    (SELECT per_set_echo_levels IS NULL FROM public.routine_exercises
     WHERE id = 'd7000000-2222-4000-8000-00000000d703'::uuid),
    'NULL per_set_echo_levels stays NULL'
);

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

-- Default ACLs, WITHOUT the defaclrole = 'postgres' filter the first version of
-- this file carried: that filter made the assertion blind to the gap it exists
-- to catch. Two assertions instead:
--   (a) nothing remains under a grantor the migration role can actually alter;
--   (b) the only grantor it cannot alter is supabase_admin -- a NEW unfixable
--       grantor is a change worth failing on.
SELECT diag(
    'default ACLs in public still granting TRUNCATE/REFERENCES/TRIGGER to a client role: '
    || coalesce(
        (SELECT string_agg(DISTINCT pg_get_userbyid(d.defaclrole) || '/'
                           || pg_get_userbyid(a.grantee) || '/' || a.privilege_type, ', ')
         FROM pg_default_acl d
         JOIN pg_namespace n ON n.oid = d.defaclnamespace
         CROSS JOIN LATERAL aclexplode(d.defaclacl) AS a
         WHERE n.nspname = 'public'
           AND d.defaclobjtype = 'r'
           AND pg_get_userbyid(a.grantee) IN ('anon', 'authenticated')
           AND a.privilege_type IN ('TRUNCATE', 'REFERENCES', 'TRIGGER')),
        '(none)')
);

SELECT is_empty(
    $sql$
        SELECT pg_get_userbyid(d.defaclrole), pg_get_userbyid(a.grantee), a.privilege_type
        FROM pg_default_acl d
        JOIN pg_namespace n ON n.oid = d.defaclnamespace
        CROSS JOIN LATERAL aclexplode(d.defaclacl) AS a
        WHERE n.nspname = 'public'
          AND d.defaclobjtype = 'r'
          AND pg_get_userbyid(a.grantee) IN ('anon', 'authenticated')
          AND a.privilege_type IN ('TRUNCATE', 'REFERENCES', 'TRIGGER')
          AND pg_has_role(current_user, d.defaclrole, 'MEMBER')
    $sql$,
    'no default privileges the migration role can alter still grant TRUNCATE/REFERENCES/TRIGGER to anon/authenticated'
);

SELECT is_empty(
    $sql$
        SELECT pg_get_userbyid(d.defaclrole), pg_get_userbyid(a.grantee), a.privilege_type
        FROM pg_default_acl d
        JOIN pg_namespace n ON n.oid = d.defaclnamespace
        CROSS JOIN LATERAL aclexplode(d.defaclacl) AS a
        WHERE n.nspname = 'public'
          AND d.defaclobjtype = 'r'
          AND pg_get_userbyid(a.grantee) IN ('anon', 'authenticated')
          AND a.privilege_type IN ('TRUNCATE', 'REFERENCES', 'TRIGGER')
          AND pg_get_userbyid(d.defaclrole) <> 'supabase_admin'
    $sql$,
    'supabase_admin is the only grantor whose default ACL still grants these (platform-owned, not fixable from a db push)'
);

-- A table postgres creates later does not get the privileges back. This probe
-- cannot cover the supabase_admin branch (see the header); the two assertions
-- above are the guard for that.
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

SELECT diag('database:schema-drift-client-write-surface');

-- profiles: table-wide INSERT/UPDATE was replaced by a column list, so a
-- column added to the table is NOT automatically client-writable.
SELECT is(
    has_table_privilege('authenticated', 'public.profiles', 'UPDATE'),
    false,
    'authenticated holds no table-wide UPDATE on profiles'
);
SELECT ok(
    has_column_privilege('authenticated', 'public.profiles', 'display_name', 'UPDATE')
      AND has_column_privilege('authenticated', 'public.profiles', 'weight_unit', 'UPDATE')
      AND has_column_privilege('authenticated', 'public.profiles', 'email_digests', 'UPDATE'),
    'the portal-editable profile columns are still UPDATE-able by authenticated'
);
SELECT is_empty(
    $sql$
        SELECT col
        FROM unnest(ARRAY[
            'id', 'user_id', 'created_at', 'stripe_customer_id',
            'digest_frequency', 'digest_last_sent_at', 'feature_flags'
        ]) AS col
        WHERE has_column_privilege('authenticated', 'public.profiles', col, 'UPDATE')
           OR has_column_privilege('anon', 'public.profiles', col, 'UPDATE')
    $sql$,
    'server-owned profile columns are not UPDATE-able by anon/authenticated'
);

-- oauth_tokens / oauth_states hold live provider credentials and are
-- service-role only (PR 4 review R-17).
SELECT is_empty(
    $sql$
        SELECT t.tbl, r.rolname, pr.priv
        FROM (VALUES ('public.oauth_tokens'), ('public.oauth_states')) AS t(tbl)
        CROSS JOIN (VALUES ('anon'), ('authenticated')) AS r(rolname)
        CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) AS pr(priv)
        WHERE has_table_privilege(r.rolname, t.tbl, pr.priv)
    $sql$,
    'anon/authenticated hold no SELECT/INSERT/UPDATE/DELETE on oauth_tokens or oauth_states'
);
SELECT ok(
    has_table_privilege('service_role', 'public.oauth_tokens', 'SELECT')
      AND has_table_privilege('service_role', 'public.oauth_states', 'SELECT'),
    'service_role still reads oauth_tokens and oauth_states'
);

SELECT diag('database:schema-drift-allow-list');

-- service_role_required: false only where the migration deliberately revokes
-- service_role (an auth.uid()-bound RPC with nothing to do for a service caller).
CREATE TEMP TABLE drift_allow_list (
    ident text PRIMARY KEY,
    expected_on_clean_apply boolean,
    service_role_required boolean NOT NULL DEFAULT true
)
    ON COMMIT DROP;
INSERT INTO drift_allow_list (ident, expected_on_clean_apply) VALUES
    ('import_shared_routine(uuid, text)', true),
    ('import_shared_cycle(uuid, text)', true),
    ('workout_current_streak(uuid)', true),
    ('user_has_min_tier(text)', true),
    ('user_subscription_tier()', true),
    -- Added by 20260920003200 (PR 32), which is not in this branch's chain.
    ('request_account_deletion()', false),
    -- 20260920120000: auth.uid()-bound portal/mobile RPCs.
    ('delete_training_cycle_lww(uuid, timestamp with time zone)', true),
    ('delete_workout_with_tombstone(uuid, uuid, uuid, text, text, timestamp with time zone)', true),
    ('verify_profile_recovery_source(text, uuid[], uuid[], uuid[], uuid[], uuid[], uuid[], uuid[], uuid[])', true),
    -- 20260925900000: caller-scoped DEFINER progress reads (INFERNO VBT gate).
    ('exercise_progress_series(text, text, integer)', true),
    ('exercise_progress_series_many(text[], text, integer)', true);
UPDATE drift_allow_list SET service_role_required = false
 WHERE ident IN (
     'verify_profile_recovery_source(text, uuid[], uuid[], uuid[], uuid[], uuid[], uuid[], uuid[], uuid[])',
     -- auth.uid()-scoped reads; a service caller has no uid to scope by.
     'exercise_progress_series(text, text, integer)',
     'exercise_progress_series_many(text[], text, integer)'
 );

SELECT is_empty(
    $sql$
        SELECT format('%s(%s)', p.proname, oidvectortypes(p.proargtypes))
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        JOIN drift_allow_list a ON a.ident = format('%s(%s)', p.proname, oidvectortypes(p.proargtypes))
        WHERE n.nspname = 'public'
          AND (
            NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
            OR (a.service_role_required AND NOT has_function_privilege('service_role', p.oid, 'EXECUTE'))
          )
    $sql$,
    'every allow-listed function that exists is executable by authenticated and service_role'
);

-- Without this, the assertion above is vacuous for a function that vanished:
-- the JOIN simply matches nothing.
SELECT is_empty(
    $sql$
        SELECT a.ident
        FROM drift_allow_list a
        WHERE a.expected_on_clean_apply
          AND NOT EXISTS (
            SELECT 1
            FROM pg_proc p
            JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public'
              AND format('%s(%s)', p.proname, oidvectortypes(p.proargtypes)) = a.ident
          )
    $sql$,
    'every allow-listed function expected on a clean apply exists'
);

-- The sibling definer_function_grants.test.sql set_eq is the authority, but
-- this file must not stay green when a brand-new definer is exposed either.
SELECT is_empty(
    $sql$
        SELECT p.oid::regprocedure::text
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.prosecdef
          AND NOT EXISTS (
            SELECT 1 FROM drift_allow_list a
            WHERE a.ident = format('%s(%s)', p.proname, oidvectortypes(p.proargtypes))
          )
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
    $sql$,
    'no SECURITY DEFINER function outside the allow-list is executable by anon/authenticated'
);

SELECT * FROM finish();

ROLLBACK;
