BEGIN;

-- Issue #1227 - custom equipment vocabulary (packet P-1, ships first).
--
-- Adds the CUSTOM_EQUIPMENT profile-preference section to
-- public.local_profile_preferences, matching the existing section shape:
-- a jsonb document column, an independent nonnegative bigint revision, and a
-- section updated_at column. Additive only: the five existing sections are
-- untouched, so an older client that never writes this section can not clobber
-- it and can not be broken by it.
--
-- Document shape version 1 (see the shared custom-equipment contract):
--   { "version": 1, "items": [ { "token": "U_EZ_BAR", "label": "EZ Bar", "createdAt": 1791500000000 } ] }
--   max 24 items, token ^U_[A-Z0-9_]{1,40}$ unique, label 1..32 trimmed chars,
--   no comma, no control character, labels unique case/punctuation-insensitively,
--   octet length <= 8192.

ALTER TABLE public.local_profile_preferences
    ADD COLUMN IF NOT EXISTS custom_equipment jsonb NOT NULL DEFAULT '{"version":1,"items":[]}'::jsonb;

ALTER TABLE public.local_profile_preferences
    ADD COLUMN IF NOT EXISTS custom_equipment_revision bigint NOT NULL DEFAULT 0;

ALTER TABLE public.local_profile_preferences
    ADD COLUMN IF NOT EXISTS custom_equipment_updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.local_profile_preferences
    DROP CONSTRAINT IF EXISTS local_profile_preferences_custom_equipment_revision_check;
ALTER TABLE public.local_profile_preferences
    ADD CONSTRAINT local_profile_preferences_custom_equipment_revision_check
    CHECK (custom_equipment_revision >= 0);

-- The row-level `updated_at` convenience column must keep covering every section
-- timestamp, so it is rebuilt to include custom_equipment_updated_at.
ALTER TABLE public.local_profile_preferences DROP COLUMN IF EXISTS updated_at;
ALTER TABLE public.local_profile_preferences
    ADD COLUMN updated_at timestamptz GENERATED ALWAYS AS (
        greatest(
            core_updated_at,
            rack_updated_at,
            workout_updated_at,
            led_updated_at,
            vbt_updated_at,
            custom_equipment_updated_at
        )
    ) STORED;

-- One normalization/validation rule set. Cross-item rules (token uniqueness,
-- label-slug uniqueness) can not live in a bare CHECK expression because CHECK
-- forbids subqueries, so the whole rule set lives in one IMMUTABLE function that
-- the CHECK calls. The TypeScript validator (profilePreferenceContract.ts) and
-- the mobile Kotlin validator implement the same rules; do not fork them.
CREATE OR REPLACE FUNCTION public.validate_custom_equipment_document(p_document jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $validate$
    SELECT CASE
        WHEN p_document IS NULL THEN false
        WHEN jsonb_typeof(p_document) <> 'object' THEN false
        WHEN NOT (p_document ? 'version') THEN false
        WHEN jsonb_typeof(p_document -> 'version') <> 'number' THEN false
        WHEN (p_document ->> 'version')::integer <> 1 THEN false
        WHEN NOT (p_document ? 'items') THEN false
        WHEN jsonb_typeof(p_document -> 'items') <> 'array' THEN false
        WHEN jsonb_array_length(p_document -> 'items') > 24 THEN false
        WHEN octet_length(p_document::text) > 8192 THEN false
        WHEN EXISTS (
            SELECT 1
              FROM jsonb_array_elements(p_document -> 'items') AS item(value)
             WHERE jsonb_typeof(item.value) <> 'object'
                OR (SELECT count(*) FROM jsonb_object_keys(item.value) AS entry(key)) <> 3
                OR EXISTS (
                    SELECT 1
                      FROM jsonb_object_keys(item.value) AS entry(key)
                     WHERE entry.key NOT IN ('token', 'label', 'createdAt')
                )
                OR jsonb_typeof(item.value -> 'token') <> 'string'
                OR jsonb_typeof(item.value -> 'label') <> 'string'
                OR jsonb_typeof(item.value -> 'createdAt') <> 'number'
                OR (item.value ->> 'token') !~ '^U_[A-Z0-9_]{1,40}$'
                OR btrim(item.value ->> 'label') = ''
                OR length(btrim(item.value ->> 'label')) > 32
                OR (item.value ->> 'label') LIKE '%,%'
                OR (item.value ->> 'label') ~ '[[:cntrl:]]'
                OR btrim(
                       upper(
                           regexp_replace(btrim(item.value ->> 'label'), '[^A-Za-z0-9]+', '_', 'g')
                       ),
                       '_'
                   ) = ''
                OR btrim(
                       upper(
                           regexp_replace(btrim(item.value ->> 'label'), '[^A-Za-z0-9]+', '_', 'g')
                       ),
                       '_'
                   ) = ANY (ARRAY[
                       'LONG_BAR', 'BENCH', 'HANDLES', 'SHORT_BAR', 'ANKLE_STRAP', 'BELT',
                       'ROPE', 'BODYWEIGHT', 'CABLE', 'BAR', 'BARBELL', 'SINGLE_HANDLE',
                       'BOTH_HANDLES', 'STRAPS', 'BLACK_CABLES', 'RED_CABLES', 'GREY_CABLES',
                       'CABLES', 'PUMP_HANDLES', 'DUMBBELLS'
                   ]::text[])
        ) THEN false
        WHEN EXISTS (
            SELECT 1
              FROM jsonb_array_elements(p_document -> 'items') AS item(value)
             GROUP BY item.value ->> 'token'
            HAVING count(*) > 1
        ) THEN false
        WHEN EXISTS (
            SELECT 1
              FROM jsonb_array_elements(p_document -> 'items') AS item(value)
             GROUP BY btrim(
                 upper(regexp_replace(btrim(item.value ->> 'label'), '[^A-Za-z0-9]+', '_', 'g')),
                 '_'
             )
            HAVING count(*) > 1
        ) THEN false
        ELSE true
    END
$validate$;

REVOKE ALL ON FUNCTION public.validate_custom_equipment_document(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.validate_custom_equipment_document(jsonb) TO service_role;

ALTER TABLE public.local_profile_preferences
    DROP CONSTRAINT IF EXISTS local_profile_preferences_custom_equipment_object_check;
ALTER TABLE public.local_profile_preferences
    ADD CONSTRAINT local_profile_preferences_custom_equipment_object_check
    CHECK (public.validate_custom_equipment_document(custom_equipment));

-- Canonical envelope builder: CUSTOM_EQUIPMENT behaves exactly like RACK.
CREATE OR REPLACE FUNCTION public.local_profile_preference_section_canonical(
    p_row public.local_profile_preferences,
    p_section text
) RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $canonical$
    SELECT jsonb_build_object(
        'localProfileId', p_row.local_profile_id,
        'section', p_section,
        'documentVersion', CASE p_section
            WHEN 'CORE' THEN 1
            WHEN 'RACK' THEN (p_row.equipment_rack ->> 'version')::integer
            WHEN 'WORKOUT' THEN (p_row.workout_preferences ->> 'version')::integer
            WHEN 'LED' THEN (p_row.led_preferences ->> 'version')::integer
            WHEN 'VBT' THEN (p_row.vbt_preferences ->> 'version')::integer
            WHEN 'CUSTOM_EQUIPMENT' THEN (p_row.custom_equipment ->> 'version')::integer
        END,
        'serverRevision', CASE p_section
            WHEN 'CORE' THEN p_row.core_revision
            WHEN 'RACK' THEN p_row.rack_revision
            WHEN 'WORKOUT' THEN p_row.workout_revision
            WHEN 'LED' THEN p_row.led_revision
            WHEN 'VBT' THEN p_row.vbt_revision
            WHEN 'CUSTOM_EQUIPMENT' THEN p_row.custom_equipment_revision
        END,
        'serverUpdatedAt', to_char(
            (CASE p_section
                WHEN 'CORE' THEN p_row.core_updated_at
                WHEN 'RACK' THEN p_row.rack_updated_at
                WHEN 'WORKOUT' THEN p_row.workout_updated_at
                WHEN 'LED' THEN p_row.led_updated_at
                WHEN 'VBT' THEN p_row.vbt_updated_at
                WHEN 'CUSTOM_EQUIPMENT' THEN p_row.custom_equipment_updated_at
            END) AT TIME ZONE 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
        ),
        'payload', CASE p_section
            WHEN 'CORE' THEN jsonb_build_object(
                'bodyWeightKg', p_row.body_weight_kg,
                'weightUnit', p_row.weight_unit,
                'weightIncrement', p_row.weight_increment
            )
            WHEN 'RACK' THEN p_row.equipment_rack
            WHEN 'WORKOUT' THEN p_row.workout_preferences
            WHEN 'LED' THEN jsonb_build_object(
                'ledColorSchemeId', p_row.led_color_scheme_id,
                'preferences', p_row.led_preferences
            )
            WHEN 'VBT' THEN jsonb_build_object(
                'vbtEnabled', p_row.vbt_enabled,
                'preferences', p_row.vbt_preferences
            )
            WHEN 'CUSTOM_EQUIPMENT' THEN p_row.custom_equipment
        END
    );
$canonical$;

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
        INSERT INTO public.local_profile_preferences (
            user_id, local_profile_id,
            body_weight_kg, weight_unit, weight_increment, core_revision,
            equipment_rack, rack_revision,
            workout_preferences, workout_revision,
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
            CASE WHEN p_section = 'WORKOUT' THEN p_payload ELSE '{"version":1}'::jsonb END,
            CASE WHEN p_section = 'WORKOUT' THEN 1 ELSE 0 END,
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

REVOKE ALL ON FUNCTION public.local_profile_preference_section_canonical(
    public.local_profile_preferences, text
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mutate_local_profile_preference_section(
    uuid, text, text, integer, bigint, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.local_profile_preference_section_canonical(
    public.local_profile_preferences, text
) TO service_role;
GRANT EXECUTE ON FUNCTION public.mutate_local_profile_preference_section(
    uuid, text, text, integer, bigint, jsonb
) TO service_role;

COMMIT;
