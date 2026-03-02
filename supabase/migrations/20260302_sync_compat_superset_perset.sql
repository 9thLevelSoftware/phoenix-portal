-- Migration: Superset grouping + per-set configuration columns
-- Adds mobile-app sync compatibility for superset workflows, per-set weight/rest
-- overrides, and advanced exercise settings (AMRAP, PR%, stall detection, etc.)

-- ============================================================
-- 1. routine_exercises — superset grouping columns
-- ============================================================
ALTER TABLE routine_exercises ADD COLUMN IF NOT EXISTS superset_id UUID;
ALTER TABLE routine_exercises ADD COLUMN IF NOT EXISTS superset_color TEXT;
ALTER TABLE routine_exercises ADD COLUMN IF NOT EXISTS superset_order INT;

-- ============================================================
-- 2. routine_exercises — per-set weight & rest overrides
-- ============================================================
ALTER TABLE routine_exercises ADD COLUMN IF NOT EXISTS per_set_weights JSONB;
ALTER TABLE routine_exercises ADD COLUMN IF NOT EXISTS per_set_rest JSONB;

-- ============================================================
-- 3. routine_exercises — advanced exercise settings
-- ============================================================
ALTER TABLE routine_exercises ADD COLUMN IF NOT EXISTS is_amrap BOOLEAN DEFAULT false;
ALTER TABLE routine_exercises ADD COLUMN IF NOT EXISTS pr_percentage NUMERIC;
ALTER TABLE routine_exercises ADD COLUMN IF NOT EXISTS rep_count_timing TEXT;
ALTER TABLE routine_exercises ADD COLUMN IF NOT EXISTS stop_at_position TEXT;
ALTER TABLE routine_exercises ADD COLUMN IF NOT EXISTS stall_detection BOOLEAN DEFAULT true;
ALTER TABLE routine_exercises ADD COLUMN IF NOT EXISTS eccentric_load TEXT;
ALTER TABLE routine_exercises ADD COLUMN IF NOT EXISTS echo_level TEXT;

-- ============================================================
-- 4. sets — per-exercise workout mode for synced workouts
-- ============================================================
ALTER TABLE sets ADD COLUMN IF NOT EXISTS workout_mode TEXT;

-- ============================================================
-- 5. workout_sessions — routine session grouping
-- ============================================================
ALTER TABLE workout_sessions ADD COLUMN IF NOT EXISTS routine_session_id UUID;
