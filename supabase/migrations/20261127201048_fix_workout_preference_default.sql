BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- Match the mobile WorkoutPreferences and JustLiftDefaultsDocument constructor
-- defaults. Mobile expands its version-only placeholder to this complete wire
-- document, which the pull validator requires.
ALTER TABLE public.local_profile_preferences
    ALTER COLUMN workout_preferences SET DEFAULT $workout$
{
  "version": 1,
  "stopAtTop": false,
  "beepsEnabled": true,
  "stallDetectionEnabled": true,
  "audioRepCountEnabled": false,
  "repCountTiming": "TOP",
  "summaryCountdownSeconds": 10,
  "autoStartCountdownSeconds": 5,
  "gamificationEnabled": true,
  "autoStartRoutine": false,
  "countdownBeepsEnabled": true,
  "repSoundEnabled": true,
  "motionStartEnabled": false,
  "weightSuggestionsEnabled": true,
  "defaultRoutineExerciseUsePercentOfPR": false,
  "defaultRoutineExerciseWeightPercentOfPR": 80,
  "voiceStopEnabled": false,
  "justLiftDefaults": {
    "workoutModeId": 0,
    "weightPerCableKg": 20,
    "weightChangePerRep": 0,
    "eccentricLoadPercentage": 100,
    "echoLevelValue": 1,
    "stallDetectionEnabled": true,
    "repCountTimingName": "TOP",
    "restSeconds": 60
  },
  "singleExerciseDefaults": {}
}
$workout$::jsonb;

-- Expand only untouched placeholders, retaining the section's revision and
-- timestamps so existing base-revision-zero edits still succeed.
UPDATE public.local_profile_preferences
   SET workout_preferences = DEFAULT
 WHERE workout_revision = 0
   AND workout_preferences = '{"version":1}'::jsonb;

-- Preserve the existing mutation RPC and ACLs. Its non-WORKOUT insert must use
-- the column default, while a WORKOUT-first insert keeps the supplied document.
CREATE OR REPLACE FUNCTION public.mutate_local_profile_preference_section(
    p_user_id uuid,
    p_local_profile_id text,
    p_section text,
    p_document_version integer,
    p_base_revision bigint,
    p_payload jsonb
) RETURNS TABLE (
    accepted boolean,
    rejection_reason text,
    server_revision bigint,
    canonical_section jsonb
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $mutation$
DECLARE
    current_row public.local_profile_preferences%ROWTYPE;
    current_revision bigint;
BEGIN
    IF p_section IS NULL
       OR p_section NOT IN ('CORE', 'RACK', 'WORKOUT', 'LED', 'VBT', 'CUSTOM_EQUIPMENT') THEN
        RETURN QUERY SELECT false, 'UNSUPPORTED_SECTION', 0::bigint, NULL::jsonb;
        RETURN;
    END IF;
    IF p_document_version IS NULL OR p_document_version <> 1 THEN
        RETURN QUERY SELECT false, 'UNSUPPORTED_DOCUMENT_VERSION', 0::bigint, NULL::jsonb;
        RETURN;
    END IF;
    IF p_base_revision IS NULL OR p_base_revision < 0
       OR p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
        RETURN QUERY SELECT false, 'VALIDATION_FAILED', 0::bigint, NULL::jsonb;
        RETURN;
    END IF;
    IF p_section = 'CUSTOM_EQUIPMENT'
       AND NOT public.validate_custom_equipment_document(p_payload) THEN
        RETURN QUERY SELECT false, 'VALIDATION_FAILED', 0::bigint, NULL::jsonb;
        RETURN;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM public.local_profiles
         WHERE user_id = p_user_id AND id = p_local_profile_id
    ) THEN
        RETURN QUERY SELECT false, 'UNKNOWN_PROFILE', 0::bigint, NULL::jsonb;
        RETURN;
    END IF;

    BEGIN
    CASE p_section
        WHEN 'CORE' THEN
            UPDATE public.local_profile_preferences
               SET body_weight_kg = (p_payload ->> 'bodyWeightKg')::double precision,
                   weight_unit = p_payload ->> 'weightUnit',
                   weight_increment = (p_payload ->> 'weightIncrement')::double precision,
                   core_revision = core_revision + 1,
                   core_updated_at = clock_timestamp()
             WHERE user_id = p_user_id
               AND local_profile_id = p_local_profile_id
               AND core_revision = p_base_revision
            RETURNING * INTO current_row;
        WHEN 'RACK' THEN
            UPDATE public.local_profile_preferences
               SET equipment_rack = p_payload,
                   rack_revision = rack_revision + 1,
                   rack_updated_at = clock_timestamp()
             WHERE user_id = p_user_id
               AND local_profile_id = p_local_profile_id
               AND rack_revision = p_base_revision
            RETURNING * INTO current_row;
        WHEN 'WORKOUT' THEN
            UPDATE public.local_profile_preferences
               SET workout_preferences = p_payload,
                   workout_revision = workout_revision + 1,
                   workout_updated_at = clock_timestamp()
             WHERE user_id = p_user_id
               AND local_profile_id = p_local_profile_id
               AND workout_revision = p_base_revision
            RETURNING * INTO current_row;
        WHEN 'LED' THEN
            UPDATE public.local_profile_preferences
               SET led_color_scheme_id = (p_payload ->> 'ledColorSchemeId')::integer,
                   led_preferences = p_payload -> 'preferences',
                   led_revision = led_revision + 1,
                   led_updated_at = clock_timestamp()
             WHERE user_id = p_user_id
               AND local_profile_id = p_local_profile_id
               AND led_revision = p_base_revision
            RETURNING * INTO current_row;
        WHEN 'VBT' THEN
            UPDATE public.local_profile_preferences
               SET vbt_enabled = (p_payload ->> 'vbtEnabled')::boolean,
                   vbt_preferences = p_payload -> 'preferences',
                   vbt_revision = vbt_revision + 1,
                   vbt_updated_at = clock_timestamp()
             WHERE user_id = p_user_id
               AND local_profile_id = p_local_profile_id
               AND vbt_revision = p_base_revision
            RETURNING * INTO current_row;
        WHEN 'CUSTOM_EQUIPMENT' THEN
            UPDATE public.local_profile_preferences
               SET custom_equipment = p_payload,
                   custom_equipment_revision = custom_equipment_revision + 1,
                   custom_equipment_updated_at = clock_timestamp()
             WHERE user_id = p_user_id
               AND local_profile_id = p_local_profile_id
               AND custom_equipment_revision = p_base_revision
            RETURNING * INTO current_row;
    END CASE;

    IF FOUND THEN
        canonical_section := public.local_profile_preference_section_canonical(current_row, p_section);
        server_revision := (canonical_section ->> 'serverRevision')::bigint;
        RETURN QUERY SELECT true, NULL::text, server_revision, canonical_section;
        RETURN;
    END IF;

    IF p_base_revision = 0 THEN
        -- Let the column default initialize WORKOUT for every other section.
        IF p_section = 'WORKOUT' THEN
            INSERT INTO public.local_profile_preferences (
                user_id, local_profile_id, workout_preferences, workout_revision
            ) VALUES (p_user_id, p_local_profile_id, p_payload, 1)
            ON CONFLICT (user_id, local_profile_id) DO NOTHING
            RETURNING * INTO current_row;
        ELSE
            INSERT INTO public.local_profile_preferences (
                user_id, local_profile_id,
                body_weight_kg, weight_unit, weight_increment, core_revision,
                equipment_rack, rack_revision,
                led_color_scheme_id, led_preferences, led_revision,
                vbt_enabled, vbt_preferences, vbt_revision,
                custom_equipment, custom_equipment_revision
            ) VALUES (
                p_user_id,
                p_local_profile_id,
                CASE WHEN p_section = 'CORE' THEN (p_payload ->> 'bodyWeightKg')::double precision ELSE 0 END,
                CASE WHEN p_section = 'CORE' THEN p_payload ->> 'weightUnit' ELSE 'LB' END,
                CASE WHEN p_section = 'CORE' THEN (p_payload ->> 'weightIncrement')::double precision ELSE -1 END,
                CASE WHEN p_section = 'CORE' THEN 1 ELSE 0 END,
                CASE WHEN p_section = 'RACK' THEN p_payload ELSE '{"version":1,"items":[]}'::jsonb END,
                CASE WHEN p_section = 'RACK' THEN 1 ELSE 0 END,
                CASE WHEN p_section = 'LED' THEN (p_payload ->> 'ledColorSchemeId')::integer ELSE 0 END,
                CASE WHEN p_section = 'LED' THEN p_payload -> 'preferences' ELSE '{"version":1,"discoModeUnlocked":false}'::jsonb END,
                CASE WHEN p_section = 'LED' THEN 1 ELSE 0 END,
                CASE WHEN p_section = 'VBT' THEN (p_payload ->> 'vbtEnabled')::boolean ELSE true END,
                CASE WHEN p_section = 'VBT' THEN p_payload -> 'preferences' ELSE '{"version":1,"velocityLossThresholdPercent":20,"autoEndOnVelocityLoss":false,"defaultScalingBasis":"MAX_WEIGHT_PR","verbalEncouragementEnabled":false,"vulgarModeEnabled":false,"vulgarTier":"STRONG","dominatrixModeUnlocked":false,"dominatrixModeActive":false}'::jsonb END,
                CASE WHEN p_section = 'VBT' THEN 1 ELSE 0 END,
                CASE WHEN p_section = 'CUSTOM_EQUIPMENT' THEN p_payload ELSE '{"version":1,"items":[]}'::jsonb END,
                CASE WHEN p_section = 'CUSTOM_EQUIPMENT' THEN 1 ELSE 0 END
            )
            ON CONFLICT (user_id, local_profile_id) DO NOTHING
            RETURNING * INTO current_row;
        END IF;

        IF FOUND THEN
            canonical_section := public.local_profile_preference_section_canonical(current_row, p_section);
            server_revision := (canonical_section ->> 'serverRevision')::bigint;
            RETURN QUERY SELECT true, NULL::text, server_revision, canonical_section;
            RETURN;
        END IF;

        CASE p_section
            WHEN 'CORE' THEN
                UPDATE public.local_profile_preferences
                   SET body_weight_kg = (p_payload ->> 'bodyWeightKg')::double precision,
                       weight_unit = p_payload ->> 'weightUnit',
                       weight_increment = (p_payload ->> 'weightIncrement')::double precision,
                       core_revision = 1,
                       core_updated_at = clock_timestamp()
                 WHERE user_id = p_user_id AND local_profile_id = p_local_profile_id AND core_revision = 0
                RETURNING * INTO current_row;
            WHEN 'RACK' THEN
                UPDATE public.local_profile_preferences
                   SET equipment_rack = p_payload, rack_revision = 1, rack_updated_at = clock_timestamp()
                 WHERE user_id = p_user_id AND local_profile_id = p_local_profile_id AND rack_revision = 0
                RETURNING * INTO current_row;
            WHEN 'WORKOUT' THEN
                UPDATE public.local_profile_preferences
                   SET workout_preferences = p_payload, workout_revision = 1, workout_updated_at = clock_timestamp()
                 WHERE user_id = p_user_id AND local_profile_id = p_local_profile_id AND workout_revision = 0
                RETURNING * INTO current_row;
            WHEN 'LED' THEN
                UPDATE public.local_profile_preferences
                   SET led_color_scheme_id = (p_payload ->> 'ledColorSchemeId')::integer,
                       led_preferences = p_payload -> 'preferences',
                       led_revision = 1,
                       led_updated_at = clock_timestamp()
                 WHERE user_id = p_user_id AND local_profile_id = p_local_profile_id AND led_revision = 0
                RETURNING * INTO current_row;
            WHEN 'VBT' THEN
                UPDATE public.local_profile_preferences
                   SET vbt_enabled = (p_payload ->> 'vbtEnabled')::boolean,
                       vbt_preferences = p_payload -> 'preferences',
                       vbt_revision = 1,
                       vbt_updated_at = clock_timestamp()
                 WHERE user_id = p_user_id AND local_profile_id = p_local_profile_id AND vbt_revision = 0
                RETURNING * INTO current_row;
            WHEN 'CUSTOM_EQUIPMENT' THEN
                UPDATE public.local_profile_preferences
                   SET custom_equipment = p_payload,
                       custom_equipment_revision = 1,
                       custom_equipment_updated_at = clock_timestamp()
                 WHERE user_id = p_user_id AND local_profile_id = p_local_profile_id AND custom_equipment_revision = 0
                RETURNING * INTO current_row;
        END CASE;

        IF FOUND THEN
            canonical_section := public.local_profile_preference_section_canonical(current_row, p_section);
            server_revision := (canonical_section ->> 'serverRevision')::bigint;
            RETURN QUERY SELECT true, NULL::text, server_revision, canonical_section;
            RETURN;
        END IF;
    END IF;

    SELECT * INTO current_row
      FROM public.local_profile_preferences
     WHERE user_id = p_user_id AND local_profile_id = p_local_profile_id;

    IF NOT FOUND THEN
        RETURN QUERY SELECT false, 'REVISION_CONFLICT', 0::bigint, NULL::jsonb;
        RETURN;
    END IF;
    canonical_section := public.local_profile_preference_section_canonical(current_row, p_section);
    current_revision := (canonical_section ->> 'serverRevision')::bigint;
    RETURN QUERY SELECT false, 'REVISION_CONFLICT', current_revision, canonical_section;
    EXCEPTION
        WHEN check_violation
          OR not_null_violation
          OR numeric_value_out_of_range
          OR invalid_text_representation THEN
            RETURN QUERY SELECT false, 'VALIDATION_FAILED', 0::bigint, NULL::jsonb;
            RETURN;
    END;
END
$mutation$;

NOTIFY pgrst, 'reload schema';

COMMIT;
