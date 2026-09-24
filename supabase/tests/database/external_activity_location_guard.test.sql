-- 20260924140000 (port of c60e76c3's database half): the database boundary
-- strips Strava route coordinates whichever writer supplies raw_data, so
-- mobile-sync-push cannot restore fields strava-sync already removed.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;

SELECT no_plan();

INSERT INTO auth.users (id, email)
VALUES ('5b5b5b5b-0000-4000-8000-000000000179'::uuid, 'external-location-guard@example.test')
ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email;

INSERT INTO public.external_activities (id, user_id, external_id, provider, name, started_at, raw_data)
VALUES (
    '5b5b5b5b-0179-4000-8000-000000000001'::uuid,
    '5b5b5b5b-0000-4000-8000-000000000179'::uuid,
    'strava-location-insert',
    'strava',
    'Private ride',
    now(),
    '{"map":{"summary_polyline":"secret"},"start_latlng":[1,2],"end_latlng":[3,4],"sport_type":"Ride"}'::jsonb
);

SELECT is(
    (SELECT raw_data FROM public.external_activities
      WHERE id = '5b5b5b5b-0179-4000-8000-000000000001'::uuid),
    '{"sport_type":"Ride"}'::jsonb,
    'a Strava insert strips all location-bearing fields'
);

UPDATE public.external_activities
   SET raw_data = raw_data || '{"map":{"polyline":"restored"},"start_latlng":[5,6],"end_latlng":[7,8],"moving_time":300}'::jsonb
 WHERE id = '5b5b5b5b-0179-4000-8000-000000000001'::uuid;

SELECT is(
    (SELECT raw_data FROM public.external_activities
      WHERE id = '5b5b5b5b-0179-4000-8000-000000000001'::uuid),
    '{"moving_time":300,"sport_type":"Ride"}'::jsonb,
    'a later writer cannot restore stripped Strava location fields'
);

INSERT INTO public.external_activities (id, user_id, external_id, provider, name, started_at, raw_data)
VALUES (
    '5b5b5b5b-0179-4000-8000-000000000002'::uuid,
    '5b5b5b5b-0000-4000-8000-000000000179'::uuid,
    'hevy-location-insert',
    'hevy',
    'Other activity',
    now(),
    '{"map":{"provider_specific":true},"start_latlng":[1,2]}'::jsonb
);

SELECT is(
    (SELECT raw_data FROM public.external_activities
      WHERE id = '5b5b5b5b-0179-4000-8000-000000000002'::uuid),
    '{"map":{"provider_specific":true},"start_latlng":[1,2]}'::jsonb,
    'other providers keep their provider-specific payload shape'
);

SELECT ok(
    NOT has_function_privilege('authenticated',
        'public.strip_strava_external_activity_location_data()', 'EXECUTE'),
    'authenticated cannot execute the trigger function directly'
);

SELECT * FROM finish();
ROLLBACK;
