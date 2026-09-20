import { assertEquals } from "jsr:@std/assert@1";
import {
  buildExternalActivityRow,
  STRAVA_LOCATION_KEYS,
  stripStravaLocationData,
} from "./index.ts";

// A trimmed but faithful `/athlete/activities` element, including the three
// keys F-095 is about.
function stravaActivity(): Record<string, unknown> {
  return {
    id: 987654321,
    name: "Morning Run",
    sport_type: "Run",
    start_date: "2026-09-20T06:30:00Z",
    elapsed_time: 2100,
    distance: 5012.4,
    kilojoules: 420,
    average_heartrate: 148,
    max_heartrate: 176,
    total_elevation_gain: 63,
    achievement_count: 2,
    map: {
      id: "a987654321",
      summary_polyline: "u{~vFvyys@fS]",
      resource_state: 2,
    },
    start_latlng: [51.5074, -0.1278],
    end_latlng: [51.5081, -0.1265],
  };
}

const USER_ID = "00000000-0000-4000-8000-000000000001";
const SYNCED_AT = "2026-09-20T12:00:00.000Z";

Deno.test("strava-sync stores no route or endpoint coordinates", async (t) => {
  const row = buildExternalActivityRow(
    USER_ID,
    stravaActivity() as never,
    SYNCED_AT,
  );
  const stored = row.raw_data as Record<string, unknown>;

  for (const key of STRAVA_LOCATION_KEYS) {
    await t.step(`raw_data has no ${key}`, () => {
      assertEquals(Object.hasOwn(stored, key), false);
    });
  }

  // Belt and braces: the polyline string itself is nowhere in the payload.
  assertEquals(JSON.stringify(row).includes("summary_polyline"), false);
  assertEquals(JSON.stringify(row).includes("51.5074"), false);
});

Deno.test("strava-sync keeps every non-location field in raw_data", () => {
  const raw = stravaActivity();
  const row = buildExternalActivityRow(USER_ID, raw as never, SYNCED_AT);
  const stored = row.raw_data as Record<string, unknown>;

  const expectedKeys = Object.keys(raw)
    .filter((key) => !(STRAVA_LOCATION_KEYS as readonly string[]).includes(key))
    .sort();
  assertEquals(Object.keys(stored).sort(), expectedKeys);

  // Including fields the normalizer does not read — the stripping is targeted,
  // not a whitelist that would silently drop future provider data.
  assertEquals(stored.achievement_count, 2);
  assertEquals(stored.id, 987654321);
});

Deno.test("strava-sync still normalizes the columns it reads", () => {
  const row = buildExternalActivityRow(
    USER_ID,
    stravaActivity() as never,
    SYNCED_AT,
  );

  assertEquals(row.user_id, USER_ID);
  assertEquals(row.provider, "strava");
  assertEquals(row.external_id, "987654321");
  assertEquals(row.activity_type, "running");
  assertEquals(row.duration_seconds, 2100);
  assertEquals(row.distance_meters, 5012.4);
  assertEquals(row.avg_heart_rate, 148);
  assertEquals(row.max_heart_rate, 176);
  assertEquals(row.elevation_gain_meters, 63);
  assertEquals(row.synced_at, SYNCED_AT);
});

Deno.test("stripStravaLocationData does not mutate the provider payload", () => {
  const raw = stravaActivity();
  const stripped = stripStravaLocationData(raw);

  assertEquals(Object.hasOwn(stripped, "map"), false);
  // The caller's object is untouched, so nothing downstream sees a surprise.
  assertEquals(Object.hasOwn(raw, "map"), true);
});

Deno.test("stripStravaLocationData is a no-op on a payload without them", () => {
  const raw = { id: 1, name: "Indoor Ride", sport_type: "VirtualRide" };

  assertEquals(stripStravaLocationData(raw), raw);
});
