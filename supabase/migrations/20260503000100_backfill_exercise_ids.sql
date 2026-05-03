-- =============================================================
-- Backfill exercise_id on existing rows where name is unambiguous
-- Only matches exercises that have a unique name in the catalog
-- (i.e., no equipment variants). Ambiguous names are left NULL.
-- =============================================================

-- routine_exercises
UPDATE routine_exercises re
SET exercise_id = ec.id
FROM exercise_catalog ec
WHERE re.exercise_id IS NULL
  AND LOWER(TRIM(re.name)) = LOWER(TRIM(ec.name))
  AND LOWER(TRIM(ec.name)) IN (
      SELECT LOWER(TRIM(name)) FROM exercise_catalog
      WHERE is_custom = FALSE
      GROUP BY LOWER(TRIM(name)) HAVING COUNT(*) = 1
  );

-- exercises (session exercises)
UPDATE exercises ex
SET exercise_id = ec.id
FROM exercise_catalog ec
WHERE ex.exercise_id IS NULL
  AND LOWER(TRIM(ex.name)) = LOWER(TRIM(ec.name))
  AND LOWER(TRIM(ec.name)) IN (
      SELECT LOWER(TRIM(name)) FROM exercise_catalog
      WHERE is_custom = FALSE
      GROUP BY LOWER(TRIM(name)) HAVING COUNT(*) = 1
  );

-- exercise_progress
UPDATE exercise_progress ep
SET exercise_id = ec.id
FROM exercise_catalog ec
WHERE ep.exercise_id IS NULL
  AND LOWER(TRIM(ep.exercise_name)) = LOWER(TRIM(ec.name))
  AND LOWER(TRIM(ec.name)) IN (
      SELECT LOWER(TRIM(name)) FROM exercise_catalog
      WHERE is_custom = FALSE
      GROUP BY LOWER(TRIM(name)) HAVING COUNT(*) = 1
  );

-- personal_records
UPDATE personal_records pr
SET exercise_id = ec.id
FROM exercise_catalog ec
WHERE pr.exercise_id IS NULL
  AND LOWER(TRIM(pr.exercise_name)) = LOWER(TRIM(ec.name))
  AND LOWER(TRIM(ec.name)) IN (
      SELECT LOWER(TRIM(name)) FROM exercise_catalog
      WHERE is_custom = FALSE
      GROUP BY LOWER(TRIM(name)) HAVING COUNT(*) = 1
  );

-- overload_suggestions
UPDATE overload_suggestions os
SET exercise_id = ec.id
FROM exercise_catalog ec
WHERE os.exercise_id IS NULL
  AND LOWER(TRIM(os.exercise_name)) = LOWER(TRIM(ec.name))
  AND LOWER(TRIM(ec.name)) IN (
      SELECT LOWER(TRIM(name)) FROM exercise_catalog
      WHERE is_custom = FALSE
      GROUP BY LOWER(TRIM(name)) HAVING COUNT(*) = 1
  );

-- user_goals (exercise_name is nullable)
UPDATE user_goals ug
SET exercise_id = ec.id
FROM exercise_catalog ec
WHERE ug.exercise_id IS NULL
  AND ug.exercise_name IS NOT NULL
  AND LOWER(TRIM(ug.exercise_name)) = LOWER(TRIM(ec.name))
  AND LOWER(TRIM(ec.name)) IN (
      SELECT LOWER(TRIM(name)) FROM exercise_catalog
      WHERE is_custom = FALSE
      GROUP BY LOWER(TRIM(name)) HAVING COUNT(*) = 1
  );
