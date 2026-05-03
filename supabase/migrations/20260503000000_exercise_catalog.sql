-- =============================================================
-- Exercise Catalog: shared exercise identity for mobile + portal
-- Resolves: GitHub issue #404 (exercise identity lost on sync)
-- =============================================================

-- 1. Catalog table
CREATE TABLE IF NOT EXISTS exercise_catalog (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    display_name TEXT NOT NULL,
    description TEXT,
    muscle_group TEXT NOT NULL,
    muscle_groups TEXT[] NOT NULL DEFAULT '{}',
    muscles TEXT[] DEFAULT '{}',
    equipment TEXT[] NOT NULL DEFAULT '{}',
    movement TEXT,
    sidedness TEXT,
    grip TEXT,
    grip_width TEXT,
    default_cable_config TEXT NOT NULL DEFAULT 'DOUBLE',
    min_rep_range REAL,
    popularity REAL NOT NULL DEFAULT 0,
    aliases TEXT[] DEFAULT '{}',
    thumbnail_url TEXT,
    archived BOOLEAN NOT NULL DEFAULT FALSE,
    is_custom BOOLEAN NOT NULL DEFAULT FALSE,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Catalog indexes
CREATE INDEX IF NOT EXISTS idx_exercise_catalog_name
    ON exercise_catalog (LOWER(name));
CREATE INDEX IF NOT EXISTS idx_exercise_catalog_muscle
    ON exercise_catalog (muscle_group);
CREATE INDEX IF NOT EXISTS idx_exercise_catalog_movement
    ON exercise_catalog (movement);
CREATE INDEX IF NOT EXISTS idx_exercise_catalog_custom
    ON exercise_catalog (user_id) WHERE is_custom = TRUE;

-- 3. RLS
ALTER TABLE exercise_catalog ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Library exercises visible to all authenticated users"
    ON exercise_catalog;
CREATE POLICY "Library exercises visible to all authenticated users"
    ON exercise_catalog FOR SELECT
    USING (is_custom = FALSE OR user_id = auth.uid());

DROP POLICY IF EXISTS "Users can insert their own custom exercises"
    ON exercise_catalog;
CREATE POLICY "Users can insert their own custom exercises"
    ON exercise_catalog FOR INSERT
    WITH CHECK (is_custom = TRUE AND user_id = auth.uid());

DROP POLICY IF EXISTS "Users can update their own custom exercises"
    ON exercise_catalog;
CREATE POLICY "Users can update their own custom exercises"
    ON exercise_catalog FOR UPDATE
    USING (is_custom = TRUE AND user_id = auth.uid());

DROP POLICY IF EXISTS "Users can delete their own custom exercises"
    ON exercise_catalog;
CREATE POLICY "Users can delete their own custom exercises"
    ON exercise_catalog FOR DELETE
    USING (is_custom = TRUE AND user_id = auth.uid());

-- 4. FK columns on existing tables
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'routine_exercises' AND column_name = 'exercise_id'
    ) THEN
        ALTER TABLE routine_exercises
            ADD COLUMN exercise_id TEXT REFERENCES exercise_catalog(id);
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'exercises' AND column_name = 'exercise_id'
    ) THEN
        ALTER TABLE exercises
            ADD COLUMN exercise_id TEXT REFERENCES exercise_catalog(id);
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'exercise_progress' AND column_name = 'exercise_id'
    ) THEN
        ALTER TABLE exercise_progress
            ADD COLUMN exercise_id TEXT REFERENCES exercise_catalog(id);
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'personal_records' AND column_name = 'exercise_id'
    ) THEN
        ALTER TABLE personal_records
            ADD COLUMN exercise_id TEXT REFERENCES exercise_catalog(id);
    END IF;
END $$;

DO $$ BEGIN
    IF to_regclass('public.overload_suggestions') IS NOT NULL
       AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'overload_suggestions'
          AND column_name = 'exercise_id'
    ) THEN
        ALTER TABLE overload_suggestions
            ADD COLUMN exercise_id TEXT REFERENCES exercise_catalog(id);
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'user_goals' AND column_name = 'exercise_id'
    ) THEN
        ALTER TABLE user_goals
            ADD COLUMN exercise_id TEXT REFERENCES exercise_catalog(id);
    END IF;
END $$;

-- 5. FK indexes
CREATE INDEX IF NOT EXISTS idx_routine_exercises_exercise_id
    ON routine_exercises (exercise_id);
CREATE INDEX IF NOT EXISTS idx_exercises_exercise_id
    ON exercises (exercise_id);
CREATE INDEX IF NOT EXISTS idx_exercise_progress_exercise_id
    ON exercise_progress (exercise_id);
CREATE INDEX IF NOT EXISTS idx_personal_records_exercise_id
    ON personal_records (exercise_id);
DO $$ BEGIN
    IF to_regclass('public.overload_suggestions') IS NOT NULL THEN
        CREATE INDEX IF NOT EXISTS idx_overload_suggestions_exercise_id
            ON overload_suggestions (exercise_id);
    END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_user_goals_exercise_id
    ON user_goals (exercise_id);
