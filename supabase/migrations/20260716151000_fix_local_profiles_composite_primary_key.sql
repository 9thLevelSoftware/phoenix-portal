-- =============================================================================
-- Reconcile legacy local_profiles(id) primary keys with the intended
-- per-user key. The original local-profile migration declares
-- PRIMARY KEY (user_id, id), but older production state retained a global
-- PRIMARY KEY (id) and only added UNIQUE (user_id, id). That makes the
-- mobile "default" sentinel globally unique and causes handle_new_user() to
-- fail after the first account.
-- =============================================================================

DO $migration$
DECLARE
    primary_key_columns text[];
    unexpected_foreign_keys text[];
BEGIN
    SELECT array_agg(attribute.attname::text ORDER BY key_column.ordinality)
      INTO primary_key_columns
      FROM pg_constraint constraint_row
      CROSS JOIN LATERAL unnest(constraint_row.conkey)
          WITH ORDINALITY AS key_column(attnum, ordinality)
      JOIN pg_attribute attribute
        ON attribute.attrelid = constraint_row.conrelid
       AND attribute.attnum = key_column.attnum
     WHERE constraint_row.conrelid = 'public.local_profiles'::regclass
       AND constraint_row.contype = 'p';

    -- Fresh databases already have the intended composite primary key.
    IF primary_key_columns = ARRAY['user_id', 'id']::text[] THEN
        RETURN;
    END IF;

    IF primary_key_columns IS DISTINCT FROM ARRAY['id']::text[] THEN
        RAISE EXCEPTION
            'local_profiles reconciliation: unexpected primary key columns %',
            primary_key_columns;
    END IF;

    SELECT array_agg(format('%s.%s', child_namespace.nspname, constraint_row.conname)
                     ORDER BY child_namespace.nspname, constraint_row.conname)
      INTO unexpected_foreign_keys
      FROM pg_constraint constraint_row
      JOIN pg_class child_table
        ON child_table.oid = constraint_row.conrelid
      JOIN pg_namespace child_namespace
        ON child_namespace.oid = child_table.relnamespace
     WHERE constraint_row.confrelid = 'public.local_profiles'::regclass
       AND constraint_row.contype = 'f'
       AND constraint_row.conname NOT IN (
            'fk_exercise_progress_profile',
            'local_profile_preferences_parent_fkey',
            'fk_personal_records_profile',
            'fk_routines_profile',
            'fk_training_cycles_profile',
            'fk_workout_sessions_profile'
       );

    IF unexpected_foreign_keys IS NOT NULL THEN
        RAISE EXCEPTION
            'local_profiles reconciliation: unexpected referencing constraints %',
            unexpected_foreign_keys;
    END IF;

    -- These constraints depend on the legacy composite UNIQUE constraint.
    -- Drop and recreate them around the primary-key repair so PostgreSQL can
    -- bind every foreign key to the new composite primary key.
    ALTER TABLE public.exercise_progress
        DROP CONSTRAINT IF EXISTS fk_exercise_progress_profile;
    ALTER TABLE public.local_profile_preferences
        DROP CONSTRAINT IF EXISTS local_profile_preferences_parent_fkey;
    ALTER TABLE public.personal_records
        DROP CONSTRAINT IF EXISTS fk_personal_records_profile;
    ALTER TABLE public.routines
        DROP CONSTRAINT IF EXISTS fk_routines_profile;
    ALTER TABLE public.training_cycles
        DROP CONSTRAINT IF EXISTS fk_training_cycles_profile;
    ALTER TABLE public.workout_sessions
        DROP CONSTRAINT IF EXISTS fk_workout_sessions_profile;

    ALTER TABLE public.local_profiles
        DROP CONSTRAINT IF EXISTS local_profiles_user_id_id_key;
    ALTER TABLE public.local_profiles
        DROP CONSTRAINT local_profiles_pkey;
    ALTER TABLE public.local_profiles
        ADD CONSTRAINT local_profiles_pkey PRIMARY KEY (user_id, id);

    -- Restore every intended default parent before the validated preference
    -- foreign key is recreated. The statement is repeated after this block so
    -- already-correct databases receive the same idempotent backfill.
    INSERT INTO public.local_profiles (user_id, id, name, device_id)
    SELECT auth_user.id, 'default', 'Default', 'server'
    FROM auth.users AS auth_user
    ON CONFLICT (user_id, id) DO NOTHING;

    ALTER TABLE public.exercise_progress
        ADD CONSTRAINT fk_exercise_progress_profile
        FOREIGN KEY (user_id, local_profile_id)
        REFERENCES public.local_profiles(user_id, id)
        ON DELETE SET NULL (local_profile_id)
        NOT VALID;

    ALTER TABLE public.local_profile_preferences
        ADD CONSTRAINT local_profile_preferences_parent_fkey
        FOREIGN KEY (user_id, local_profile_id)
        REFERENCES public.local_profiles(user_id, id)
        ON DELETE CASCADE;

    ALTER TABLE public.personal_records
        ADD CONSTRAINT fk_personal_records_profile
        FOREIGN KEY (user_id, local_profile_id)
        REFERENCES public.local_profiles(user_id, id)
        ON DELETE SET NULL (local_profile_id)
        NOT VALID;

    ALTER TABLE public.routines
        ADD CONSTRAINT fk_routines_profile
        FOREIGN KEY (user_id, local_profile_id)
        REFERENCES public.local_profiles(user_id, id)
        ON DELETE SET NULL (local_profile_id)
        NOT VALID;

    ALTER TABLE public.training_cycles
        ADD CONSTRAINT fk_training_cycles_profile
        FOREIGN KEY (user_id, local_profile_id)
        REFERENCES public.local_profiles(user_id, id)
        ON DELETE SET NULL (local_profile_id)
        NOT VALID;

    ALTER TABLE public.workout_sessions
        ADD CONSTRAINT fk_workout_sessions_profile
        FOREIGN KEY (user_id, local_profile_id)
        REFERENCES public.local_profiles(user_id, id)
        ON DELETE SET NULL (local_profile_id)
        NOT VALID;
END
$migration$;

-- Backfill every account after the key repair. This is intentionally
-- idempotent and also covers accounts created between the original migration
-- and this reconciliation.
INSERT INTO public.local_profiles (user_id, id, name, device_id)
SELECT auth_user.id, 'default', 'Default', 'server'
FROM auth.users AS auth_user
ON CONFLICT (user_id, id) DO NOTHING;

-- Reassert the signup trigger contract in case the legacy environment also
-- retained an older function body.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
    INSERT INTO public.profiles (id, display_name)
    VALUES (
        NEW.id,
        COALESCE(NULLIF(split_part(NEW.email, '@', 1), ''), 'User')
    )
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.local_profiles (user_id, id, name, device_id)
    VALUES (NEW.id, 'default', 'Default', 'server')
    ON CONFLICT (user_id, id) DO NOTHING;

    RETURN NEW;
END
$function$;

DO $postcondition$
DECLARE
    primary_key_columns text[];
BEGIN
    SELECT array_agg(attribute.attname::text ORDER BY key_column.ordinality)
      INTO primary_key_columns
      FROM pg_constraint constraint_row
      CROSS JOIN LATERAL unnest(constraint_row.conkey)
          WITH ORDINALITY AS key_column(attnum, ordinality)
      JOIN pg_attribute attribute
        ON attribute.attrelid = constraint_row.conrelid
       AND attribute.attnum = key_column.attnum
     WHERE constraint_row.conrelid = 'public.local_profiles'::regclass
       AND constraint_row.contype = 'p';

    IF primary_key_columns IS DISTINCT FROM ARRAY['user_id', 'id']::text[] THEN
        RAISE EXCEPTION
            'local_profiles reconciliation: expected composite primary key, got %',
            primary_key_columns;
    END IF;
END
$postcondition$;
