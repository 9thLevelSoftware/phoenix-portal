-- Correct core dip variants after the initial keyword backfill.
--
-- The first backfill migration had already been pushed with a generic "dips"
-- keyword that classifies these names as Chest. Keep that migration append-only
-- and repair only rows that are still General or were moved to Chest by that
-- generic rule.

WITH core_dip_patterns(pattern) AS (
    VALUES
        ('\m(plank dips?|hip dips?|oblique dips?)\M'),
        ('\m(plank|oblique)s?\M.*\mdips?\M')
),
candidate_exercises AS (
    SELECT
        id,
        btrim(
            regexp_replace(
                lower(btrim(name)),
                '[[:space:]]*\(.*\)[[:space:]]*$',
                ''
            )
        ) AS norm_name
    FROM exercises
    WHERE muscle_group IN ('General', 'Chest')
)
UPDATE exercises ex
SET muscle_group = 'Core'
FROM candidate_exercises candidate
WHERE ex.id = candidate.id
  AND ex.muscle_group IN ('General', 'Chest')
  AND EXISTS (
      SELECT 1
      FROM core_dip_patterns pattern
      WHERE candidate.norm_name ~ pattern.pattern
  );
