BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;

SELECT no_plan();

SELECT diag('database:exact-function-acls-and-no-client-dml');

SELECT has_table(
    'public',
    'local_profile_preferences',
    'profile preferences table exists'
);

SELECT diag('database:local-profiles-composite-primary-key');

SELECT is(
    (
        SELECT array_agg(attribute.attname::text ORDER BY key_column.ordinality)
        FROM pg_constraint constraint_row
        CROSS JOIN LATERAL unnest(constraint_row.conkey)
            WITH ORDINALITY AS key_column(attnum, ordinality)
        JOIN pg_attribute attribute
          ON attribute.attrelid = constraint_row.conrelid
         AND attribute.attnum = key_column.attnum
        WHERE constraint_row.conrelid = 'public.local_profiles'::regclass
          AND constraint_row.contype = 'p'
    ),
    ARRAY['user_id', 'id']::text[],
    'local_profiles primary key is exactly (user_id, id)'
);

SELECT is(
    (
        SELECT array_agg(attribute.attname::text ORDER BY key_column.ordinality)
        FROM pg_constraint constraint_row
        CROSS JOIN LATERAL unnest(constraint_row.conkey)
            WITH ORDINALITY AS key_column(attnum, ordinality)
        JOIN pg_attribute attribute
          ON attribute.attrelid = constraint_row.conrelid
         AND attribute.attnum = key_column.attnum
        WHERE constraint_row.conrelid = 'public.local_profile_preferences'::regclass
          AND constraint_row.contype = 'p'
    ),
    ARRAY['user_id', 'local_profile_id']::text[],
    'table primary key is exactly (user_id, local_profile_id)'
);

SELECT is(
    (
        SELECT jsonb_build_object(
            'childColumns', array_agg(child_attribute.attname::text ORDER BY child_key.ordinality),
            'referencedSchema', referenced_namespace.nspname,
            'referencedTable', referenced_table.relname,
            'referencedColumns', array_agg(parent_attribute.attname::text ORDER BY child_key.ordinality),
            'deleteAction', constraint_row.confdeltype
        )
        FROM pg_constraint constraint_row
        CROSS JOIN LATERAL unnest(constraint_row.conkey)
            WITH ORDINALITY AS child_key(attnum, ordinality)
        CROSS JOIN LATERAL unnest(constraint_row.confkey)
            WITH ORDINALITY AS parent_key(attnum, ordinality)
        JOIN pg_attribute child_attribute
          ON child_attribute.attrelid = constraint_row.conrelid
         AND child_attribute.attnum = child_key.attnum
        JOIN pg_class referenced_table
          ON referenced_table.oid = constraint_row.confrelid
        JOIN pg_namespace referenced_namespace
          ON referenced_namespace.oid = referenced_table.relnamespace
        JOIN pg_attribute parent_attribute
          ON parent_attribute.attrelid = constraint_row.confrelid
         AND parent_attribute.attnum = parent_key.attnum
        WHERE constraint_row.conrelid = 'public.local_profile_preferences'::regclass
          AND constraint_row.contype = 'f'
          AND child_key.ordinality = parent_key.ordinality
        GROUP BY constraint_row.oid,
                 referenced_namespace.nspname,
                 referenced_table.relname,
                 constraint_row.confdeltype
    ),
    '{"childColumns":["user_id","local_profile_id"],"referencedSchema":"public","referencedTable":"local_profiles","referencedColumns":["user_id","id"],"deleteAction":"c"}'::jsonb,
    'table has exactly one composite local_profiles foreign key with ON DELETE CASCADE'
);

SELECT is(
    (
        SELECT format_type(attribute.atttypid, attribute.atttypmod)
        FROM pg_attribute attribute
        WHERE attribute.attrelid = 'public.local_profile_preferences'::regclass
          AND attribute.attname = 'schema_version'
          AND NOT attribute.attisdropped
    ),
    'integer'::text,
    'schema_version is integer'
);

SELECT is(
    (
        SELECT pg_get_expr(default_row.adbin, default_row.adrelid)
        FROM pg_attribute attribute
        JOIN pg_attrdef default_row
          ON default_row.adrelid = attribute.attrelid
         AND default_row.adnum = attribute.attnum
        WHERE attribute.attrelid = 'public.local_profile_preferences'::regclass
          AND attribute.attname = 'schema_version'
    ),
    '1'::text,
    'schema_version defaults to contract version 1'
);

SELECT is(
    (
        SELECT jsonb_agg(
            jsonb_build_object(
                'name', check_row.constraint_name,
                'columns', check_row.constraint_columns,
                'expression', check_row.normalized_expression
            )
            ORDER BY check_row.constraint_name
        )
        FROM (
            SELECT
                constraint_row.conname::text AS constraint_name,
                array_agg(attribute.attname::text ORDER BY key_column.ordinality)
                    AS constraint_columns,
                btrim(regexp_replace(
                    pg_get_expr(constraint_row.conbin, constraint_row.conrelid, true),
                    '[[:space:]]+',
                    ' ',
                    'g'
                )) AS normalized_expression
            FROM pg_constraint constraint_row
            CROSS JOIN LATERAL unnest(constraint_row.conkey)
                WITH ORDINALITY AS key_column(attnum, ordinality)
            JOIN pg_attribute attribute
              ON attribute.attrelid = constraint_row.conrelid
             AND attribute.attnum = key_column.attnum
            WHERE constraint_row.conrelid = 'public.local_profile_preferences'::regclass
              AND constraint_row.contype = 'c'
            GROUP BY constraint_row.oid
            HAVING bool_or(attribute.attname = 'schema_version')
        ) AS check_row
    ),
    '[{"name":"local_profile_preferences_schema_version_check","columns":["schema_version"],"expression":"schema_version = 1"}]'::jsonb,
    'schema_version has exactly one single-column version-1 check expression'
);

SELECT results_eq(
    $sql$
        SELECT
            attribute.attname::text COLLATE "C",
            format_type(attribute.atttypid, attribute.atttypmod)::text COLLATE "C",
            attribute.attnotnull,
            pg_get_expr(default_row.adbin, default_row.adrelid)::text COLLATE "C"
        FROM pg_attribute attribute
        JOIN pg_attrdef default_row
          ON default_row.adrelid = attribute.attrelid
         AND default_row.adnum = attribute.attnum
        WHERE attribute.attrelid = 'public.local_profile_preferences'::regclass
          AND attribute.attname IN (
              'core_revision', 'rack_revision', 'workout_revision',
              'led_revision', 'vbt_revision'
          )
        ORDER BY attribute.attname
    $sql$,
    $values$
        VALUES
            ('core_revision'::text COLLATE "C", 'bigint'::text COLLATE "C", true, '0'::text COLLATE "C"),
            ('led_revision'::text COLLATE "C", 'bigint'::text COLLATE "C", true, '0'::text COLLATE "C"),
            ('rack_revision'::text COLLATE "C", 'bigint'::text COLLATE "C", true, '0'::text COLLATE "C"),
            ('vbt_revision'::text COLLATE "C", 'bigint'::text COLLATE "C", true, '0'::text COLLATE "C"),
            ('workout_revision'::text COLLATE "C", 'bigint'::text COLLATE "C", true, '0'::text COLLATE "C")
    $values$,
    'the five section revisions are independent non-null bigint counters defaulting to zero'
);

SELECT is(
    (
        SELECT jsonb_agg(
            jsonb_build_object(
                'name', check_row.constraint_name,
                'columns', check_row.constraint_columns,
                'expression', check_row.normalized_expression
            )
            ORDER BY check_row.constraint_name
        )
        FROM (
            SELECT
                constraint_row.conname::text AS constraint_name,
                array_agg(attribute.attname::text ORDER BY key_column.ordinality)
                    AS constraint_columns,
                btrim(regexp_replace(
                    pg_get_expr(constraint_row.conbin, constraint_row.conrelid, true),
                    '[[:space:]]+',
                    ' ',
                    'g'
                )) AS normalized_expression
            FROM pg_constraint constraint_row
            CROSS JOIN LATERAL unnest(constraint_row.conkey)
                WITH ORDINALITY AS key_column(attnum, ordinality)
            JOIN pg_attribute attribute
              ON attribute.attrelid = constraint_row.conrelid
             AND attribute.attnum = key_column.attnum
            WHERE constraint_row.conrelid = 'public.local_profile_preferences'::regclass
              AND constraint_row.contype = 'c'
            GROUP BY constraint_row.oid
            HAVING bool_or(attribute.attname = ANY (ARRAY[
                'core_revision', 'rack_revision', 'workout_revision',
                'led_revision', 'vbt_revision'
            ]::name[]))
        ) AS check_row
    ),
    '[
        {"name":"local_profile_preferences_core_revision_check","columns":["core_revision"],"expression":"core_revision >= 0"},
        {"name":"local_profile_preferences_led_revision_check","columns":["led_revision"],"expression":"led_revision >= 0"},
        {"name":"local_profile_preferences_rack_revision_check","columns":["rack_revision"],"expression":"rack_revision >= 0"},
        {"name":"local_profile_preferences_vbt_revision_check","columns":["vbt_revision"],"expression":"vbt_revision >= 0"},
        {"name":"local_profile_preferences_workout_revision_check","columns":["workout_revision"],"expression":"workout_revision >= 0"}
    ]'::jsonb,
    'each revision has exactly one independent single-column nonnegative check expression'
);

SELECT results_eq(
    $sql$
        SELECT
            attribute.attname::text COLLATE "C",
            format_type(attribute.atttypid, attribute.atttypmod)::text COLLATE "C",
            attribute.attnotnull,
            (default_row.oid IS NOT NULL) AS has_default
        FROM pg_attribute attribute
        LEFT JOIN pg_attrdef default_row
          ON default_row.adrelid = attribute.attrelid
         AND default_row.adnum = attribute.attnum
        WHERE attribute.attrelid = 'public.local_profile_preferences'::regclass
          AND attribute.attname IN (
              'core_updated_at', 'rack_updated_at', 'workout_updated_at',
              'led_updated_at', 'vbt_updated_at'
          )
        ORDER BY attribute.attname
    $sql$,
    $values$
        VALUES
            ('core_updated_at'::text COLLATE "C", 'timestamp with time zone'::text COLLATE "C", true, true),
            ('led_updated_at'::text COLLATE "C", 'timestamp with time zone'::text COLLATE "C", true, true),
            ('rack_updated_at'::text COLLATE "C", 'timestamp with time zone'::text COLLATE "C", true, true),
            ('vbt_updated_at'::text COLLATE "C", 'timestamp with time zone'::text COLLATE "C", true, true),
            ('workout_updated_at'::text COLLATE "C", 'timestamp with time zone'::text COLLATE "C", true, true)
    $values$,
    'all five sections have independent non-null timestamps with defaults'
);

SELECT is(
    (
        SELECT count(*)
        FROM pg_proc procedure_row
        JOIN pg_namespace namespace_row
          ON namespace_row.oid = procedure_row.pronamespace
        WHERE namespace_row.nspname = 'public'
          AND procedure_row.proname = 'local_profile_preference_section_canonical'
    ),
    1::bigint,
    'canonical section function has exactly one public overload'
);

SELECT is(
    (
        SELECT count(*)
        FROM pg_proc procedure_row
        JOIN pg_namespace namespace_row
          ON namespace_row.oid = procedure_row.pronamespace
        WHERE namespace_row.nspname = 'public'
          AND procedure_row.proname = 'mutate_local_profile_preference_section'
    ),
    1::bigint,
    'mutation function has exactly one public overload'
);

SELECT results_eq(
    $sql$
        SELECT
            procedure_row.proname::text COLLATE "C",
            pg_get_userbyid(procedure_row.proowner)::text COLLATE "C",
            procedure_row.provolatile::text COLLATE "C",
            procedure_row.prosecdef,
            procedure_row.proretset,
            format_type(procedure_row.prorettype, NULL)::text COLLATE "C",
            procedure_row.proconfig COLLATE "C"
        FROM pg_proc procedure_row
        WHERE procedure_row.oid IN (
            'public.local_profile_preference_section_canonical(public.local_profile_preferences,text)'::regprocedure,
            'public.mutate_local_profile_preference_section(uuid,text,text,integer,bigint,jsonb)'::regprocedure
        )
        ORDER BY procedure_row.proname
    $sql$,
    $values$
        VALUES
            (
                'local_profile_preference_section_canonical'::text COLLATE "C",
                'postgres'::text COLLATE "C",
                's'::text COLLATE "C",
                false,
                false,
                'jsonb'::text COLLATE "C",
                ARRAY['search_path=""']::text[] COLLATE "C"
            ),
            (
                'mutate_local_profile_preference_section'::text COLLATE "C",
                'postgres'::text COLLATE "C",
                'v'::text COLLATE "C",
                false,
                true,
                'record'::text COLLATE "C",
                ARRAY['search_path=""']::text[] COLLATE "C"
            )
    $values$,
    'functions have exact owners, volatility, SECURITY INVOKER, return modes, and empty search_path'
);

SELECT results_eq(
    $sql$
        SELECT
            procedure_row.proname::text COLLATE "C",
            procedure_row.proargnames COLLATE "C",
            procedure_row.proargmodes,
            ARRAY(
                SELECT format_type(argument_type, NULL)
                FROM unnest(procedure_row.proallargtypes)
                    WITH ORDINALITY AS argument(argument_type, ordinality)
                WHERE ordinality > procedure_row.pronargs
                ORDER BY ordinality
            )::text[] COLLATE "C" AS output_types
        FROM pg_proc procedure_row
        WHERE procedure_row.oid =
            'public.mutate_local_profile_preference_section(uuid,text,text,integer,bigint,jsonb)'::regprocedure
    $sql$,
    $values$
        VALUES (
            'mutate_local_profile_preference_section'::text COLLATE "C",
            ARRAY[
                'p_user_id', 'p_local_profile_id', 'p_section',
                'p_document_version', 'p_base_revision', 'p_payload',
                'accepted', 'rejection_reason', 'server_revision', 'canonical_section'
            ]::text[] COLLATE "C",
            ARRAY['i', 'i', 'i', 'i', 'i', 'i', 't', 't', 't', 't']::"char"[],
            ARRAY['boolean', 'text', 'bigint', 'jsonb']::text[] COLLATE "C"
        )
    $values$,
    'mutation function has the exact named input and TABLE return shape'
);

SELECT results_eq(
    $sql$
        SELECT
            procedure_row.proname::text COLLATE "C" AS function_name,
            CASE
                WHEN access_row.grantee = 0 THEN 'PUBLIC'
                ELSE pg_get_userbyid(access_row.grantee)
            END::text COLLATE "C" AS grantee,
            access_row.privilege_type::text COLLATE "C",
            access_row.is_grantable
        FROM pg_proc procedure_row
        CROSS JOIN LATERAL aclexplode(
            COALESCE(procedure_row.proacl, acldefault('f', procedure_row.proowner))
        ) AS access_row
        WHERE procedure_row.oid IN (
            'public.local_profile_preference_section_canonical(public.local_profile_preferences,text)'::regprocedure,
            'public.mutate_local_profile_preference_section(uuid,text,text,integer,bigint,jsonb)'::regprocedure
        )
          AND access_row.grantee <> procedure_row.proowner
        ORDER BY function_name, grantee, privilege_type
    $sql$,
    $values$
        VALUES
            (
                'local_profile_preference_section_canonical'::text COLLATE "C",
                'service_role'::text COLLATE "C",
                'EXECUTE'::text COLLATE "C",
                false
            ),
            (
                'mutate_local_profile_preference_section'::text COLLATE "C",
                'service_role'::text COLLATE "C",
                'EXECUTE'::text COLLATE "C",
                false
            )
    $values$,
    'service_role is the only non-owner function executor'
);

SELECT results_eq(
    $sql$
        SELECT
            role_name::text COLLATE "C",
            function_name::text COLLATE "C",
            has_function_privilege(
                role_name,
                function_name,
                'EXECUTE'
            )
        FROM (VALUES
            ('anon', 'public.local_profile_preference_section_canonical(public.local_profile_preferences,text)'),
            ('anon', 'public.mutate_local_profile_preference_section(uuid,text,text,integer,bigint,jsonb)'),
            ('authenticated', 'public.local_profile_preference_section_canonical(public.local_profile_preferences,text)'),
            ('authenticated', 'public.mutate_local_profile_preference_section(uuid,text,text,integer,bigint,jsonb)'),
            ('service_role', 'public.local_profile_preference_section_canonical(public.local_profile_preferences,text)'),
            ('service_role', 'public.mutate_local_profile_preference_section(uuid,text,text,integer,bigint,jsonb)')
        ) AS expected_access(role_name, function_name)
        ORDER BY role_name, function_name
    $sql$,
    $values$
        VALUES
            ('anon'::text COLLATE "C", 'public.local_profile_preference_section_canonical(public.local_profile_preferences,text)'::text COLLATE "C", false),
            ('anon'::text COLLATE "C", 'public.mutate_local_profile_preference_section(uuid,text,text,integer,bigint,jsonb)'::text COLLATE "C", false),
            ('authenticated'::text COLLATE "C", 'public.local_profile_preference_section_canonical(public.local_profile_preferences,text)'::text COLLATE "C", false),
            ('authenticated'::text COLLATE "C", 'public.mutate_local_profile_preference_section(uuid,text,text,integer,bigint,jsonb)'::text COLLATE "C", false),
            ('service_role'::text COLLATE "C", 'public.local_profile_preference_section_canonical(public.local_profile_preferences,text)'::text COLLATE "C", true),
            ('service_role'::text COLLATE "C", 'public.mutate_local_profile_preference_section(uuid,text,text,integer,bigint,jsonb)'::text COLLATE "C", true)
    $values$,
    'anon and authenticated cannot execute either function while service_role can'
);

SELECT results_eq(
    $sql$
        SELECT
            CASE
                WHEN access_row.grantee = 0 THEN 'PUBLIC'
                ELSE pg_get_userbyid(access_row.grantee)
            END::text COLLATE "C" AS grantee,
            access_row.privilege_type::text COLLATE "C",
            access_row.is_grantable
        FROM pg_class table_row
        CROSS JOIN LATERAL aclexplode(
            COALESCE(table_row.relacl, acldefault('r', table_row.relowner))
        ) AS access_row
        WHERE table_row.oid = 'public.local_profile_preferences'::regclass
          AND access_row.grantee <> table_row.relowner
          AND access_row.privilege_type IN ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
        ORDER BY grantee, privilege_type
    $sql$,
    $values$
        VALUES
            ('service_role'::text COLLATE "C", 'DELETE'::text COLLATE "C", false),
            ('service_role'::text COLLATE "C", 'INSERT'::text COLLATE "C", false),
            ('service_role'::text COLLATE "C", 'SELECT'::text COLLATE "C", false),
            ('service_role'::text COLLATE "C", 'UPDATE'::text COLLATE "C", false)
    $values$,
    'service_role has exactly SELECT, INSERT, UPDATE, and DELETE as the only non-owner table DML'
);

SELECT results_eq(
    $sql$
        SELECT
            role_name::text COLLATE "C",
            privilege_name::text COLLATE "C",
            has_table_privilege(
                role_name,
                'public.local_profile_preferences',
                privilege_name
            )
        FROM (VALUES ('anon'), ('authenticated')) AS roles(role_name)
        CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) AS privileges(privilege_name)
        ORDER BY role_name, privilege_name
    $sql$,
    $values$
        VALUES
            ('anon'::text COLLATE "C", 'DELETE'::text COLLATE "C", false),
            ('anon'::text COLLATE "C", 'INSERT'::text COLLATE "C", false),
            ('anon'::text COLLATE "C", 'SELECT'::text COLLATE "C", false),
            ('anon'::text COLLATE "C", 'UPDATE'::text COLLATE "C", false),
            ('authenticated'::text COLLATE "C", 'DELETE'::text COLLATE "C", false),
            ('authenticated'::text COLLATE "C", 'INSERT'::text COLLATE "C", false),
            ('authenticated'::text COLLATE "C", 'SELECT'::text COLLATE "C", false),
            ('authenticated'::text COLLATE "C", 'UPDATE'::text COLLATE "C", false)
    $values$,
    'anon and authenticated have no table DML privileges'
);

SELECT ok(
    (
        SELECT table_row.relrowsecurity
        FROM pg_class table_row
        WHERE table_row.oid = 'public.local_profile_preferences'::regclass
    ),
    'row level security is enabled'
);

SELECT results_eq(
    $sql$
        SELECT
            policyname::text COLLATE "C",
            cmd::text COLLATE "C",
            roles::text COLLATE "C",
            (qual IS NOT NULL) AS has_using,
            (with_check IS NOT NULL) AS has_with_check
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'local_profile_preferences'
        ORDER BY policyname
    $sql$,
    $values$
        VALUES
            ('local_profile_preferences_owner_delete'::text COLLATE "C", 'DELETE'::text COLLATE "C", '{authenticated}'::text COLLATE "C", true, false),
            ('local_profile_preferences_owner_insert'::text COLLATE "C", 'INSERT'::text COLLATE "C", '{authenticated}'::text COLLATE "C", false, true),
            ('local_profile_preferences_owner_select'::text COLLATE "C", 'SELECT'::text COLLATE "C", '{authenticated}'::text COLLATE "C", true, false),
            ('local_profile_preferences_owner_update'::text COLLATE "C", 'UPDATE'::text COLLATE "C", '{authenticated}'::text COLLATE "C", true, true)
    $values$,
    'the four authenticated owner policies have exact commands and checks'
);

SELECT diag('database:temporary-grant-owner-rls-and-cross-owner-user-id-protection');

INSERT INTO auth.users (id, email)
VALUES
    ('11111111-1111-4111-8111-111111111111'::uuid, 'preferences-owner-a@example.test'),
    ('22222222-2222-4222-8222-222222222222'::uuid, 'preferences-owner-b@example.test')
ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email;

INSERT INTO public.local_profiles (user_id, id, name, device_id)
VALUES
    ('11111111-1111-4111-8111-111111111111'::uuid, 'shared', 'Owner A Shared', 'pgtap'),
    ('22222222-2222-4222-8222-222222222222'::uuid, 'shared', 'Owner B Shared', 'pgtap'),
    ('22222222-2222-4222-8222-222222222222'::uuid, 'owner-b-insert', 'Owner B Insert', 'pgtap'),
    ('11111111-1111-4111-8111-111111111111'::uuid, 'all-sections', 'All Sections', 'pgtap')
ON CONFLICT (user_id, id) DO NOTHING;

INSERT INTO public.local_profile_preferences (user_id, local_profile_id)
VALUES
    ('11111111-1111-4111-8111-111111111111'::uuid, 'shared'),
    ('22222222-2222-4222-8222-222222222222'::uuid, 'shared');

CREATE OR REPLACE FUNCTION pg_temp.assert_sqlstate(
    statement_sql text,
    expected_sqlstate text,
    assertion_description text
) RETURNS text
LANGUAGE plpgsql
AS $assertion$
BEGIN
    EXECUTE statement_sql;
    RETURN extensions.ok(false, assertion_description);
EXCEPTION WHEN OTHERS THEN
    RETURN extensions.is(SQLSTATE, expected_sqlstate, assertion_description);
END
$assertion$;

CREATE OR REPLACE FUNCTION pg_temp.execute_row_count(statement_sql text)
RETURNS bigint
LANGUAGE plpgsql
AS $execution$
DECLARE
    affected_rows bigint;
BEGIN
    EXECUTE statement_sql;
    GET DIAGNOSTICS affected_rows = ROW_COUNT;
    RETURN affected_rows;
END
$execution$;

GRANT SELECT, INSERT, UPDATE, DELETE
    ON TABLE public.local_profile_preferences
    TO authenticated;

SET LOCAL ROLE authenticated;
SELECT set_config(
    'request.jwt.claims',
    '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}',
    true
);

SELECT results_eq(
    $sql$
        SELECT user_id, local_profile_id COLLATE "C"
        FROM public.local_profile_preferences
        ORDER BY user_id, local_profile_id
    $sql$,
    $values$
        VALUES (
            '11111111-1111-4111-8111-111111111111'::uuid,
            'shared'::text COLLATE "C"
        )
    $values$,
    'owner A sees exactly owner A preference identity and no owner B row'
);

SELECT is(
    pg_temp.execute_row_count($sql$
        UPDATE public.local_profile_preferences
           SET weight_unit = 'KG'
         WHERE user_id = '22222222-2222-4222-8222-222222222222'::uuid
    $sql$),
    0::bigint,
    'owner A cannot update owner B preference rows'
);

SELECT is(
    pg_temp.execute_row_count($sql$
        DELETE FROM public.local_profile_preferences
         WHERE user_id = '22222222-2222-4222-8222-222222222222'::uuid
    $sql$),
    0::bigint,
    'owner A cannot delete owner B preference rows'
);

SELECT pg_temp.assert_sqlstate(
    $sql$
        INSERT INTO public.local_profile_preferences (user_id, local_profile_id)
        VALUES ('22222222-2222-4222-8222-222222222222'::uuid, 'owner-b-insert')
    $sql$,
    '42501',
    'owner A cannot insert an owner B preference row'
);

SELECT pg_temp.assert_sqlstate(
    $sql$
        UPDATE public.local_profile_preferences
           SET user_id = '22222222-2222-4222-8222-222222222222'::uuid
         WHERE user_id = '11111111-1111-4111-8111-111111111111'::uuid
           AND local_profile_id = 'shared'
    $sql$,
    '42501',
    'owner UPDATE WITH CHECK rejects changing user_id from owner A to owner B'
);

RESET ROLE;
REVOKE SELECT, INSERT, UPDATE, DELETE
    ON TABLE public.local_profile_preferences
    FROM authenticated;

SELECT diag('database:base-revision-accept-and-stale-canonical-conflict');

CREATE TEMP TABLE preference_mutation_results (
    section text NOT NULL,
    accepted boolean,
    rejection_reason text,
    server_revision bigint,
    canonical_section jsonb
) ON COMMIT DROP;

INSERT INTO preference_mutation_results
SELECT 'CORE', result.*
FROM public.mutate_local_profile_preference_section(
    '11111111-1111-4111-8111-111111111111'::uuid,
    'all-sections',
    'CORE',
    1,
    0,
    '{"bodyWeightKg":82.5,"weightUnit":"KG","weightIncrement":2.5}'::jsonb
) AS result;

INSERT INTO preference_mutation_results
SELECT 'RACK', result.*
FROM public.mutate_local_profile_preference_section(
    '11111111-1111-4111-8111-111111111111'::uuid,
    'all-sections',
    'RACK',
    1,
    0,
    '{"version":1,"items":[{"id":"rack-1","weightKg":20}]}'::jsonb
) AS result;

INSERT INTO preference_mutation_results
SELECT 'WORKOUT', result.*
FROM public.mutate_local_profile_preference_section(
    '11111111-1111-4111-8111-111111111111'::uuid,
    'all-sections',
    'WORKOUT',
    1,
    0,
    '{"version":1,"summaryCountdownSeconds":10,"autoStartCountdownSeconds":3,"defaultRoutineExerciseWeightPercentOfPR":75}'::jsonb
) AS result;

INSERT INTO preference_mutation_results
SELECT 'LED', result.*
FROM public.mutate_local_profile_preference_section(
    '11111111-1111-4111-8111-111111111111'::uuid,
    'all-sections',
    'LED',
    1,
    0,
    '{"ledColorSchemeId":3,"preferences":{"version":1,"discoModeUnlocked":true}}'::jsonb
) AS result;

INSERT INTO preference_mutation_results
SELECT 'VBT', result.*
FROM public.mutate_local_profile_preference_section(
    '11111111-1111-4111-8111-111111111111'::uuid,
    'all-sections',
    'VBT',
    1,
    0,
    '{"vbtEnabled":false,"preferences":{"version":1,"velocityLossThresholdPercent":25,"autoEndOnVelocityLoss":true,"defaultScalingBasis":"MAX_WEIGHT_PR","verbalEncouragementEnabled":true,"vulgarModeEnabled":false,"vulgarTier":"STRONG","dominatrixModeUnlocked":false,"dominatrixModeActive":false}}'::jsonb
) AS result;

SELECT results_eq(
    $sql$
        SELECT
            section COLLATE "C",
            accepted,
            rejection_reason COLLATE "C",
            server_revision,
            (canonical_section ->> 'section') COLLATE "C",
            (canonical_section ->> 'documentVersion')::integer,
            (canonical_section ->> 'serverRevision')::bigint
        FROM preference_mutation_results
        ORDER BY section
    $sql$,
    $values$
        VALUES
            ('CORE'::text COLLATE "C", true, NULL::text COLLATE "C", 1::bigint, 'CORE'::text COLLATE "C", 1, 1::bigint),
            ('LED'::text COLLATE "C", true, NULL::text COLLATE "C", 1::bigint, 'LED'::text COLLATE "C", 1, 1::bigint),
            ('RACK'::text COLLATE "C", true, NULL::text COLLATE "C", 1::bigint, 'RACK'::text COLLATE "C", 1, 1::bigint),
            ('VBT'::text COLLATE "C", true, NULL::text COLLATE "C", 1::bigint, 'VBT'::text COLLATE "C", 1, 1::bigint),
            ('WORKOUT'::text COLLATE "C", true, NULL::text COLLATE "C", 1::bigint, 'WORKOUT'::text COLLATE "C", 1, 1::bigint)
    $values$,
    'all five sections accept base revision zero as server revision one'
);

SELECT results_eq(
    $sql$
        SELECT
            section COLLATE "C",
            canonical_section -> 'payload'
        FROM preference_mutation_results
        ORDER BY section
    $sql$,
    $values$
        VALUES
            (
                'CORE'::text COLLATE "C",
                '{"bodyWeightKg":82.5,"weightUnit":"KG","weightIncrement":2.5}'::jsonb
            ),
            (
                'LED'::text COLLATE "C",
                '{"ledColorSchemeId":3,"preferences":{"version":1,"discoModeUnlocked":true}}'::jsonb
            ),
            (
                'RACK'::text COLLATE "C",
                '{"version":1,"items":[{"id":"rack-1","weightKg":20}]}'::jsonb
            ),
            (
                'VBT'::text COLLATE "C",
                '{"vbtEnabled":false,"preferences":{"version":1,"velocityLossThresholdPercent":25,"autoEndOnVelocityLoss":true,"defaultScalingBasis":"MAX_WEIGHT_PR","verbalEncouragementEnabled":true,"vulgarModeEnabled":false,"vulgarTier":"STRONG","dominatrixModeUnlocked":false,"dominatrixModeActive":false}}'::jsonb
            ),
            (
                'WORKOUT'::text COLLATE "C",
                '{"version":1,"summaryCountdownSeconds":10,"autoStartCountdownSeconds":3,"defaultRoutineExerciseWeightPercentOfPR":75}'::jsonb
            )
    $values$,
    'base-zero accepts return the exact canonical payload for every section'
);

SELECT is(
    (
        SELECT ARRAY[
            core_revision,
            rack_revision,
            workout_revision,
            led_revision,
            vbt_revision
        ]
        FROM public.local_profile_preferences
        WHERE user_id = '11111111-1111-4111-8111-111111111111'::uuid
          AND local_profile_id = 'all-sections'
    ),
    ARRAY[1, 1, 1, 1, 1]::bigint[],
    'accepting every base-zero section increments each independent revision once'
);

SELECT ok(
    (
        SELECT bool_and(
            (canonical_section ->> 'localProfileId') = 'all-sections'
            AND canonical_section ? 'serverUpdatedAt'
            AND jsonb_typeof(canonical_section -> 'payload') = 'object'
        )
        FROM preference_mutation_results
    ),
    'every accepted mutation returns a complete canonical section envelope'
);

TRUNCATE preference_mutation_results;

INSERT INTO preference_mutation_results
SELECT 'WORKOUT', result.*
FROM public.mutate_local_profile_preference_section(
    '11111111-1111-4111-8111-111111111111'::uuid,
    'all-sections',
    'WORKOUT',
    1,
    1,
    '{"version":1,"summaryCountdownSeconds":15,"autoStartCountdownSeconds":4,"defaultRoutineExerciseWeightPercentOfPR":85}'::jsonb
) AS result;

SELECT is(
    (
        SELECT ARRAY[
            core_revision,
            rack_revision,
            workout_revision,
            led_revision,
            vbt_revision
        ]
        FROM public.local_profile_preferences
        WHERE user_id = '11111111-1111-4111-8111-111111111111'::uuid
          AND local_profile_id = 'all-sections'
    ),
    ARRAY[1, 1, 2, 1, 1]::bigint[],
    'a matching base increments only the targeted section revision'
);

SELECT results_eq(
    $sql$
        SELECT
            accepted,
            rejection_reason COLLATE "C",
            server_revision,
            canonical_section -> 'payload'
        FROM preference_mutation_results
    $sql$,
    $values$
        VALUES (
            true,
            NULL::text COLLATE "C",
            2::bigint,
            '{"version":1,"summaryCountdownSeconds":15,"autoStartCountdownSeconds":4,"defaultRoutineExerciseWeightPercentOfPR":85}'::jsonb
        )
    $values$,
    'matching-base mutation returns the targeted canonical version-1 WORKOUT document'
);

SELECT is(
    (
        SELECT jsonb_build_object(
            'CORE', jsonb_build_object(
                'bodyWeightKg', body_weight_kg,
                'weightUnit', weight_unit,
                'weightIncrement', weight_increment
            ),
            'RACK', equipment_rack,
            'LED', jsonb_build_object(
                'ledColorSchemeId', led_color_scheme_id,
                'preferences', led_preferences
            ),
            'VBT', jsonb_build_object(
                'vbtEnabled', vbt_enabled,
                'preferences', vbt_preferences
            )
        )
        FROM public.local_profile_preferences
        WHERE user_id = '11111111-1111-4111-8111-111111111111'::uuid
          AND local_profile_id = 'all-sections'
    ),
    '{
        "CORE":{"bodyWeightKg":82.5,"weightUnit":"KG","weightIncrement":2.5},
        "RACK":{"version":1,"items":[{"id":"rack-1","weightKg":20}]},
        "LED":{"ledColorSchemeId":3,"preferences":{"version":1,"discoModeUnlocked":true}},
        "VBT":{"vbtEnabled":false,"preferences":{"version":1,"velocityLossThresholdPercent":25,"autoEndOnVelocityLoss":true,"defaultScalingBasis":"MAX_WEIGHT_PR","verbalEncouragementEnabled":true,"vulgarModeEnabled":false,"vulgarTier":"STRONG","dominatrixModeUnlocked":false,"dominatrixModeActive":false}}
    }'::jsonb,
    'matching WORKOUT mutation preserves exact CORE, RACK, LED, and VBT siblings'
);

TRUNCATE preference_mutation_results;

INSERT INTO preference_mutation_results
SELECT 'WORKOUT', result.*
FROM public.mutate_local_profile_preference_section(
    '11111111-1111-4111-8111-111111111111'::uuid,
    'all-sections',
    'WORKOUT',
    1,
    1,
    '{"version":1,"summaryCountdownSeconds":5,"autoStartCountdownSeconds":2,"defaultRoutineExerciseWeightPercentOfPR":50}'::jsonb
) AS result;

SELECT results_eq(
    $sql$
        SELECT
            accepted,
            rejection_reason COLLATE "C",
            server_revision,
            (canonical_section ->> 'section') COLLATE "C",
            canonical_section -> 'payload'
        FROM preference_mutation_results
    $sql$,
    $values$
        VALUES (
            false,
            'REVISION_CONFLICT'::text COLLATE "C",
            2::bigint,
            'WORKOUT'::text COLLATE "C",
            '{"version":1,"summaryCountdownSeconds":15,"autoStartCountdownSeconds":4,"defaultRoutineExerciseWeightPercentOfPR":85}'::jsonb
        )
    $values$,
    'stale base returns REVISION_CONFLICT with the current canonical targeted section'
);

CREATE TEMP TABLE preference_rejection_results (
    case_name text NOT NULL,
    accepted boolean,
    rejection_reason text,
    server_revision bigint,
    canonical_section jsonb
) ON COMMIT DROP;

INSERT INTO preference_rejection_results
SELECT 'invalid-section', result.*
FROM public.mutate_local_profile_preference_section(
    '11111111-1111-4111-8111-111111111111'::uuid,
    'all-sections',
    'NOPE',
    1,
    0,
    '{}'::jsonb
) AS result;

INSERT INTO preference_rejection_results
SELECT 'invalid-version', result.*
FROM public.mutate_local_profile_preference_section(
    '11111111-1111-4111-8111-111111111111'::uuid,
    'all-sections',
    'CORE',
    2,
    0,
    '{}'::jsonb
) AS result;

INSERT INTO preference_rejection_results
SELECT 'invalid-payload', result.*
FROM public.mutate_local_profile_preference_section(
    '11111111-1111-4111-8111-111111111111'::uuid,
    'all-sections',
    'CORE',
    1,
    0,
    '[]'::jsonb
) AS result;

INSERT INTO preference_rejection_results
SELECT 'unknown-profile', result.*
FROM public.mutate_local_profile_preference_section(
    '11111111-1111-4111-8111-111111111111'::uuid,
    'missing-profile',
    'CORE',
    1,
    0,
    '{"bodyWeightKg":82.5,"weightUnit":"KG","weightIncrement":2.5}'::jsonb
) AS result;

SELECT results_eq(
    $sql$
        SELECT
            case_name COLLATE "C",
            accepted,
            rejection_reason COLLATE "C",
            server_revision,
            canonical_section
        FROM preference_rejection_results
        ORDER BY case_name
    $sql$,
    $values$
        VALUES
            ('invalid-payload'::text COLLATE "C", false, 'VALIDATION_FAILED'::text COLLATE "C", 0::bigint, NULL::jsonb),
            ('invalid-section'::text COLLATE "C", false, 'UNSUPPORTED_SECTION'::text COLLATE "C", 0::bigint, NULL::jsonb),
            ('invalid-version'::text COLLATE "C", false, 'UNSUPPORTED_DOCUMENT_VERSION'::text COLLATE "C", 0::bigint, NULL::jsonb),
            ('unknown-profile'::text COLLATE "C", false, 'UNKNOWN_PROFILE'::text COLLATE "C", 0::bigint, NULL::jsonb)
    $values$,
    'invalid section, version, payload, and unknown profile return explicit rejection rows'
);

CREATE TEMP TABLE malformed_preference_rejection_results (
    case_name text NOT NULL,
    accepted boolean,
    rejection_reason text,
    server_revision bigint,
    canonical_section jsonb
) ON COMMIT DROP;

SELECT lives_ok(
    $sql$
        INSERT INTO malformed_preference_rejection_results
        SELECT malformed_case.case_name, result.*
        FROM (
            VALUES
                ('empty-core', 'CORE', 1::bigint, '{}'::jsonb),
                ('empty-rack', 'RACK', 1::bigint, '{}'::jsonb),
                ('empty-workout', 'WORKOUT', 2::bigint, '{}'::jsonb),
                ('empty-led', 'LED', 1::bigint, '{}'::jsonb),
                ('empty-vbt', 'VBT', 1::bigint, '{}'::jsonb),
                (
                    'invalid-core-number',
                    'CORE',
                    1::bigint,
                    '{"bodyWeightKg":"heavy","weightUnit":"KG","weightIncrement":2.5}'::jsonb
                ),
                (
                    'invalid-rack-items',
                    'RACK',
                    1::bigint,
                    '{"version":1,"items":"not-an-array"}'::jsonb
                ),
                (
                    'overflow-workout-countdown',
                    'WORKOUT',
                    2::bigint,
                    '{"version":1,"summaryCountdownSeconds":999999999999999999999}'::jsonb
                ),
                (
                    'invalid-led-scheme',
                    'LED',
                    1::bigint,
                    '{"ledColorSchemeId":"bright","preferences":{"version":1,"discoModeUnlocked":false}}'::jsonb
                ),
                (
                    'invalid-vbt-enabled',
                    'VBT',
                    1::bigint,
                    '{"vbtEnabled":"sometimes","preferences":{"version":1,"velocityLossThresholdPercent":20}}'::jsonb
                )
        ) AS malformed_case(case_name, section_name, base_revision, payload)
        CROSS JOIN LATERAL public.mutate_local_profile_preference_section(
            '11111111-1111-4111-8111-111111111111'::uuid,
            'all-sections',
            malformed_case.section_name,
            1,
            malformed_case.base_revision,
            malformed_case.payload
        ) AS result
    $sql$,
    'malformed section objects return rejection rows without raising database exceptions'
);

SELECT results_eq(
    $sql$
        SELECT
            case_name COLLATE "C",
            accepted,
            rejection_reason COLLATE "C",
            server_revision,
            canonical_section
        FROM malformed_preference_rejection_results
        ORDER BY case_name
    $sql$,
    $values$
        VALUES
            ('empty-core'::text COLLATE "C", false, 'VALIDATION_FAILED'::text COLLATE "C", 0::bigint, NULL::jsonb),
            ('empty-led'::text COLLATE "C", false, 'VALIDATION_FAILED'::text COLLATE "C", 0::bigint, NULL::jsonb),
            ('empty-rack'::text COLLATE "C", false, 'VALIDATION_FAILED'::text COLLATE "C", 0::bigint, NULL::jsonb),
            ('empty-vbt'::text COLLATE "C", false, 'VALIDATION_FAILED'::text COLLATE "C", 0::bigint, NULL::jsonb),
            ('empty-workout'::text COLLATE "C", false, 'VALIDATION_FAILED'::text COLLATE "C", 0::bigint, NULL::jsonb),
            ('invalid-core-number'::text COLLATE "C", false, 'VALIDATION_FAILED'::text COLLATE "C", 0::bigint, NULL::jsonb),
            ('invalid-led-scheme'::text COLLATE "C", false, 'VALIDATION_FAILED'::text COLLATE "C", 0::bigint, NULL::jsonb),
            ('invalid-rack-items'::text COLLATE "C", false, 'VALIDATION_FAILED'::text COLLATE "C", 0::bigint, NULL::jsonb),
            ('invalid-vbt-enabled'::text COLLATE "C", false, 'VALIDATION_FAILED'::text COLLATE "C", 0::bigint, NULL::jsonb),
            ('overflow-workout-countdown'::text COLLATE "C", false, 'VALIDATION_FAILED'::text COLLATE "C", 0::bigint, NULL::jsonb)
    $values$,
    'malformed section objects return the exact validation rejection contract'
);

CREATE TEMP TABLE required_nested_key_state_before ON COMMIT DROP AS
SELECT
    rack_revision,
    equipment_rack,
    led_revision,
    led_preferences,
    vbt_revision,
    vbt_preferences
FROM public.local_profile_preferences
WHERE user_id = '11111111-1111-4111-8111-111111111111'::uuid
  AND local_profile_id = 'all-sections';

CREATE TEMP TABLE missing_required_key_results (
    case_name text NOT NULL,
    accepted boolean,
    rejection_reason text,
    server_revision bigint,
    canonical_section jsonb
) ON COMMIT DROP;

INSERT INTO missing_required_key_results
SELECT missing_key_case.case_name, result.*
FROM (
    VALUES
        ('missing-rack-items', 'RACK', 1::bigint, '{"version":1}'::jsonb),
        (
            'missing-led-flag',
            'LED',
            1::bigint,
            '{"ledColorSchemeId":3,"preferences":{"version":1}}'::jsonb
        ),
        (
            'missing-vbt-threshold',
            'VBT',
            1::bigint,
            '{"vbtEnabled":false,"preferences":{"version":1}}'::jsonb
        )
) AS missing_key_case(case_name, section_name, base_revision, payload)
CROSS JOIN LATERAL public.mutate_local_profile_preference_section(
    '11111111-1111-4111-8111-111111111111'::uuid,
    'all-sections',
    missing_key_case.section_name,
    1,
    missing_key_case.base_revision,
    missing_key_case.payload
) AS result;

SELECT results_eq(
    $sql$
        SELECT
            case_name COLLATE "C",
            accepted,
            rejection_reason COLLATE "C",
            server_revision,
            canonical_section
        FROM missing_required_key_results
        ORDER BY case_name
    $sql$,
    $values$
        VALUES
            ('missing-led-flag'::text COLLATE "C", false, 'VALIDATION_FAILED'::text COLLATE "C", 0::bigint, NULL::jsonb),
            ('missing-rack-items'::text COLLATE "C", false, 'VALIDATION_FAILED'::text COLLATE "C", 0::bigint, NULL::jsonb),
            ('missing-vbt-threshold'::text COLLATE "C", false, 'VALIDATION_FAILED'::text COLLATE "C", 0::bigint, NULL::jsonb)
    $values$,
    'missing required nested keys return the exact validation rejection contract'
);

SELECT results_eq(
    $sql$
        SELECT
            current_row.rack_revision = before_row.rack_revision,
            current_row.equipment_rack = before_row.equipment_rack,
            current_row.led_revision = before_row.led_revision,
            current_row.led_preferences = before_row.led_preferences,
            current_row.vbt_revision = before_row.vbt_revision,
            current_row.vbt_preferences = before_row.vbt_preferences
        FROM public.local_profile_preferences AS current_row
        CROSS JOIN required_nested_key_state_before AS before_row
        WHERE current_row.user_id = '11111111-1111-4111-8111-111111111111'::uuid
          AND current_row.local_profile_id = 'all-sections'
    $sql$,
    $values$
        VALUES (true, true, true, true, true, true)
    $values$,
    'missing required nested keys do not change stored payloads or revisions'
);

SELECT results_eq(
    $sql$
        SELECT
            accepted,
            rejection_reason COLLATE "C",
            server_revision,
            canonical_section -> 'payload'
        FROM public.mutate_local_profile_preference_section(
            '11111111-1111-4111-8111-111111111111'::uuid,
            'all-sections',
            'WORKOUT',
            1,
            2,
            '{"version":1}'::jsonb
        )
    $sql$,
    $values$
        VALUES (true, NULL::text COLLATE "C", 3::bigint, '{"version":1}'::jsonb)
    $values$,
    'WORKOUT fields remain optional when the required version is present'
);

SELECT * FROM finish();
ROLLBACK;
