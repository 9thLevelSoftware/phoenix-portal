-- Issue #883 (9thLevelSoftware/Project-Phoenix-MP): additive belt-squat catalog rows.
--
-- Why: PR #706 in Project-Phoenix-MP replaced the legacy exercise catalogue with
-- free-exercise-db, which carries no belt equipment at all, so "Belt Squat" and every
-- belt-equipped squat variant disappeared from the mobile picker (issue #883). The mobile
-- fix ships a supplemental belt-squat seed (SupplementalCatalogSeed) with these exact
-- stable IDs. exercise_catalog is the FK target for exercise_id on routine_exercises /
-- exercises / exercise_progress / personal_records / overload_suggestions / user_goals,
-- and mobile-sync-push resolves incoming ids through resolveCatalogExerciseId
-- (supabase/functions/_shared/catalogExerciseIds.ts), writing NULL when the id and the
-- normalized name are both absent — a mobile-only id would silently push exercise_id=NULL
-- and re-break issue #404 exercise identity. Architecture review condition A for #883
-- therefore requires the portal to carry the same stable IDs with BELT equipment, merged
-- before the mobile release (see AGENTS.md -> "Release order": migration first, additive).
--
-- Idempotent (ON CONFLICT (id) DO UPDATE), safe to re-run. Additive only: wger_1935
-- ('Belt Squat', equipment '{}') and every other existing row are left untouched.
-- The rows are original Project Phoenix seed content (also in Project-Phoenix-MP's
-- SupplementalCatalogSeed) — not derived from free-exercise-db, wger, or the retired
-- proprietary legacy catalogue.

INSERT INTO exercise_catalog (
  id, name, display_name, description, muscle_group, muscle_groups, muscles,
  equipment, movement, sidedness, grip, grip_width, default_cable_config,
  min_rep_range, popularity, aliases, thumbnail_url, archived, is_custom,
  user_id, source, source_id, license, license_author, license_url
) VALUES
('Belt_Squat','Belt Squat','Belt Squat','Fasten a squat belt around your waist and clip it to the low pulley or belt squat platform.
Stand tall with feet about shoulder-width apart, brace your core, and squat down until your thighs are at least parallel to the floor.
Drive through your midfoot to stand back up, keeping your chest up and your knees tracking over your toes.','LEGS',ARRAY['LEGS']::text[],ARRAY['quads','glutes','hamstrings']::text[],ARRAY['BELT']::text[],'strength','bilateral',NULL,NULL,'DOUBLE',NULL,0,'{}'::text[],NULL,FALSE,FALSE,NULL,'phoenix-supplemental','Belt_Squat','Proprietary',NULL,'https://github.com/9thLevelSoftware/Project-Phoenix-MP'),
('Belt_Squat_Pulses','Belt Squat Pulses','Belt Squat Pulses','Fasten a squat belt around your waist and clip it to the low pulley or belt squat platform.
Squat down to about knee depth and stay there, pulsing a few inches up and down under control.
Keep your core braced and your knees tracking over your toes for the whole set, then stand up to finish.','LEGS',ARRAY['LEGS']::text[],ARRAY['quads','glutes','hamstrings']::text[],ARRAY['BELT']::text[],'strength','bilateral',NULL,NULL,'DOUBLE',NULL,0,'{}'::text[],NULL,FALSE,FALSE,NULL,'phoenix-supplemental','Belt_Squat_Pulses','Proprietary',NULL,'https://github.com/9thLevelSoftware/Project-Phoenix-MP'),
('Sumo_Belt_Squat','Sumo Belt Squat','Sumo Belt Squat','Fasten a squat belt around your waist and clip it to the low pulley or belt squat platform.
Take a wide stance with your toes turned out and sit down between your hips until your thighs are at least parallel to the floor.
Push the floor apart with your feet and stand back up, keeping your torso tall and knees tracking over your toes.','LEGS',ARRAY['LEGS']::text[],ARRAY['quads','glutes','adductors','hamstrings']::text[],ARRAY['BELT']::text[],'strength','bilateral',NULL,NULL,'DOUBLE',NULL,0,'{}'::text[],NULL,FALSE,FALSE,NULL,'phoenix-supplemental','Sumo_Belt_Squat','Proprietary',NULL,'https://github.com/9thLevelSoftware/Project-Phoenix-MP')
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  display_name = EXCLUDED.display_name,
  description = EXCLUDED.description,
  muscle_group = EXCLUDED.muscle_group,
  muscle_groups = EXCLUDED.muscle_groups,
  muscles = EXCLUDED.muscles,
  equipment = EXCLUDED.equipment,
  movement = EXCLUDED.movement,
  sidedness = EXCLUDED.sidedness,
  grip = EXCLUDED.grip,
  grip_width = EXCLUDED.grip_width,
  default_cable_config = EXCLUDED.default_cable_config,
  min_rep_range = EXCLUDED.min_rep_range,
  popularity = EXCLUDED.popularity,
  aliases = EXCLUDED.aliases,
  thumbnail_url = EXCLUDED.thumbnail_url,
  archived = EXCLUDED.archived,
  source = EXCLUDED.source,
  source_id = EXCLUDED.source_id,
  license = EXCLUDED.license,
  license_author = EXCLUDED.license_author,
  license_url = EXCLUDED.license_url,
  updated_at = NOW();
