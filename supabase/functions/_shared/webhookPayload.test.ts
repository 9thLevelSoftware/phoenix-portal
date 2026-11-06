import { assert, assertEquals } from "jsr:@std/assert@1";
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { FakeDb, fakeClient, type Row } from "./testing/fakeSupabase.ts";
import { buildWebhookEvent } from "./webhookPayload.ts";

const USER_A = "aaaaaaaa-0000-4000-8000-00000000000a";
const USER_B = "bbbbbbbb-0000-4000-8000-00000000000b";
const ENDPOINT = "eeeeeeee-0000-4000-8000-00000000000a";

function client(tables: Record<string, Row[]>) {
  const db = new FakeDb(tables);
  return { db, admin: fakeClient(db) as unknown as SupabaseClient };
}

function build(admin: SupabaseClient, entity: string, entityId: string, userId = USER_A) {
  return buildWebhookEvent(admin, { userId, endpointId: ENDPOINT, entity, entityId });
}

// Two users with the same shape of data, so any missing owner filter shows up
// as the other user's rows in the result.
function workoutTables(): Record<string, Row[]> {
  return {
    workout_sessions: [
      { id: "s-a", user_id: USER_A, name: "A session", total_volume: 1200, notes: "mine" },
      { id: "s-b", user_id: USER_B, name: "B session", total_volume: 9999, notes: "theirs" },
    ],
    exercises: [
      { id: "e-a1", session_id: "s-a", user_id: USER_A, name: "Row", order_index: 0, cable_count: 2 },
      { id: "e-a2", session_id: "s-a", user_id: USER_A, name: "Press", order_index: 1, cable_count: null },
      { id: "e-b1", session_id: "s-b", user_id: USER_B, name: "B exercise", order_index: 0 },
      // A row filed under A's session but owned by B must not travel either.
      { id: "e-x", session_id: "s-a", user_id: USER_B, name: "Planted", order_index: 9 },
    ],
    sets: [
      { id: "set-a1", exercise_id: "e-a1", user_id: USER_A, set_number: 1, weight_kg: 40, actual_reps: 8 },
      { id: "set-a2", exercise_id: "e-a2", user_id: USER_A, set_number: 1, weight_kg: 22.5, actual_reps: 10 },
      { id: "set-b1", exercise_id: "e-b1", user_id: USER_B, set_number: 1, weight_kg: 500, actual_reps: 1 },
      { id: "set-x", exercise_id: "e-x", user_id: USER_B, set_number: 1, weight_kg: 1, actual_reps: 1 },
    ],
    rep_summaries: [
      { id: "rep-a1", set_id: "set-a1", user_id: USER_A, rep_number: 1, mean_velocity_mps: 0.5 },
      { id: "rep-b1", set_id: "set-b1", user_id: USER_B, rep_number: 1, mean_velocity_mps: 9 },
    ],
  };
}

Deno.test("webhookPayload: a workout carries its own record and nested children, and nothing of another user's", async () => {
  const { admin } = client(workoutTables());

  const event = await build(admin, "workout", "s-a");

  assert(event.kind === "updated");
  assertEquals(event.type, "workout.updated");
  assertEquals(event.data.endpointId, ENDPOINT);
  assertEquals(event.data.entity, "workout");
  assertEquals(event.data.id, "s-a");
  assertEquals(event.data.record, { id: "s-a", name: "A session", total_volume: 1200, notes: "mine" });
  const children = event.data.children as Record<string, Row[]>;
  assertEquals(children.exercises.map((row) => row.id), ["e-a1", "e-a2"]);
  assertEquals(children.sets.map((row) => row.id), ["set-a1", "set-a2"]);
  assertEquals(children.rep_summaries.map((row) => row.id), ["rep-a1"]);
  const text = JSON.stringify(event.data);
  for (const leaked of ["B session", "theirs", "B exercise", "Planted", "set-b1", "rep-b1", USER_B]) {
    assert(!text.includes(leaked), leaked);
  }
});

Deno.test("webhookPayload: the owner's user id is not copied into the record or any child", async () => {
  const { admin } = client(workoutTables());

  const event = await build(admin, "workout", "s-a");

  assert(event.kind === "updated");
  assert(!JSON.stringify(event.data).includes(USER_A));
  assertEquals("user_id" in (event.data.record as Row), false);
});

Deno.test("webhookPayload: loads are sent per cable exactly as stored", async () => {
  const { admin } = client(workoutTables());

  const event = await build(admin, "workout", "s-a");

  assert(event.kind === "updated");
  assertEquals(event.data.loadConvention, "per_cable_kg");
  const sets = (event.data.children as Record<string, Row[]>).sets;
  assertEquals(sets.map((row) => row.weight_kg), [40, 22.5]);
  // cable_count is passed through, NULL included: unknown is never assumed to be two.
  const exercises = (event.data.children as Record<string, Row[]>).exercises;
  assertEquals(exercises.map((row) => row.cable_count), [2, null]);
});

Deno.test("webhookPayload: another user's entity id reads as not found, never as their data", async () => {
  const { admin } = client(workoutTables());

  const event = await build(admin, "workout", "s-b", USER_A);

  assertEquals(event, {
    kind: "deleted",
    type: "workout.deleted",
    data: { endpointId: ENDPOINT, entity: "workout", id: "s-b" },
  });
});

Deno.test("webhookPayload: a row that is gone is a deleted event carrying the id only", async () => {
  const { admin } = client({ routines: [], routine_exercises: [] });

  const event = await build(admin, "routine", "r-gone");

  assertEquals(event, {
    kind: "deleted",
    type: "routine.deleted",
    data: { endpointId: ENDPOINT, entity: "routine", id: "r-gone" },
  });
});

Deno.test("webhookPayload: a soft-deleted personal record is a deleted event without its values", async () => {
  const { admin } = client({
    personal_records: [
      { id: "pr-1", user_id: USER_A, exercise_name: "Row", value: 100, deleted_at: "2026-11-01T00:00:00Z" },
      { id: "pr-2", user_id: USER_A, exercise_name: "Press", value: 60, deleted_at: null, record_type: "MAX_WEIGHT" },
    ],
  });

  const deleted = await build(admin, "personal_record", "pr-1");
  const live = await build(admin, "personal_record", "pr-2");

  assertEquals(deleted.kind, "deleted");
  assert(!JSON.stringify(deleted).includes("100"));
  assert(live.kind === "updated");
  assertEquals((live.data.record as Row).value, 60);
  assertEquals((live.data.record as Row).record_type, "MAX_WEIGHT");
  assertEquals("children" in live.data, false);
});

Deno.test("webhookPayload: a routine's exercises are read through the owner-checked routine", async () => {
  const { admin } = client({
    routines: [
      { id: "r-a", user_id: USER_A, name: "Push" },
      { id: "r-b", user_id: USER_B, name: "Theirs" },
    ],
    routine_exercises: [
      { id: "re-a", routine_id: "r-a", name: "Press", sets: 3 },
      { id: "re-b", routine_id: "r-b", name: "Their press", sets: 9 },
    ],
  });

  const mine = await build(admin, "routine", "r-a");
  const theirs = await build(admin, "routine", "r-b");

  assert(mine.kind === "updated");
  assertEquals((mine.data.children as Record<string, Row[]>).routine_exercises.map((row) => row.id), ["re-a"]);
  assertEquals(theirs.kind, "deleted");
  assert(!JSON.stringify(theirs).includes("Their press"));
});

Deno.test("webhookPayload: a Strava-sourced activity is never built", async () => {
  const { admin } = client({
    external_activities: [
      { id: "x-strava", user_id: USER_A, provider: "strava", name: "Ride", raw_data: { secret: 1 } },
      { id: "x-hevy", user_id: USER_A, provider: "hevy", name: "Lift" },
    ],
  });

  const strava = await build(admin, "external_activity", "x-strava");
  const hevy = await build(admin, "external_activity", "x-hevy");

  assertEquals(strava, { kind: "skip", reason: "not_shareable" });
  assert(hevy.kind === "updated");
  assertEquals((hevy.data.record as Row).name, "Lift");
});

Deno.test("webhookPayload: a profile omits billing and internal columns even when the database returns them", async () => {
  const { admin } = client({
    profiles: [{
      id: USER_A,
      user_id: USER_A,
      display_name: "Ada",
      weight_unit: "kg",
      stripe_customer_id: "ctm_billing_identifier",
      feature_flags: { beta: true },
      digest_last_sent_at: "2026-11-01T00:00:00Z",
      // Not in the manifest at all: must not travel either.
      internal_note: "do not share",
    }],
  });

  const event = await build(admin, "profile", USER_A);

  assert(event.kind === "updated");
  const record = event.data.record as Row;
  assertEquals(record.display_name, "Ada");
  assertEquals(record.weight_unit, "kg");
  for (const column of ["stripe_customer_id", "feature_flags", "digest_last_sent_at", "internal_note", "user_id"]) {
    assertEquals(column in record, false, column);
  }
  assert(!JSON.stringify(event).includes("ctm_billing_identifier"));
});

Deno.test("webhookPayload: an unknown entity is skipped without a read", async () => {
  const { admin, db } = client({});

  for (const entity of ["ping", "subscription", "rep_telemetry", "vbt_assessment"]) {
    assertEquals(await build(admin, entity, "x"), { kind: "skip", reason: "unknown_entity" }, entity);
  }
  assertEquals(Object.keys(db.tables), []);
});

Deno.test("webhookPayload: more children than one page are all returned", async () => {
  const sets: Row[] = [];
  for (let i = 0; i < 1050; i += 1) {
    sets.push({
      // UUID-shaped, as real ids are (the double orders date-like strings as dates).
      id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
      exercise_id: "e-1",
      user_id: USER_A,
      set_number: i,
      weight_kg: 10,
    });
  }
  const { admin } = client({
    workout_sessions: [{ id: "s-1", user_id: USER_A, name: "Long" }],
    exercises: [{ id: "e-1", session_id: "s-1", user_id: USER_A, name: "Row" }],
    sets,
    rep_summaries: [],
  });

  const event = await build(admin, "workout", "s-1");

  assert(event.kind === "updated");
  const built = (event.data.children as Record<string, Row[]>).sets;
  assertEquals(built.length, 1050);
  assertEquals(new Set(built.map((row) => row.id)).size, 1050);
});

Deno.test("webhookPayload: a read error is reported as an error, not as a deletion", async () => {
  const failing = {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve({ data: null, error: { message: "boom" } }),
          }),
        }),
      }),
    }),
  } as unknown as SupabaseClient;

  const event = await build(failing, "routine", "r-1");

  assertEquals(event, { kind: "error" });
});
