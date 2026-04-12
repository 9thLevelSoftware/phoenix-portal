/**
 * Workout Entity Fixtures for Beta Sync Validation
 *
 * These factories create valid DTO shapes for workout-related entities
 * as they flow through the sync pipeline (mobile-sync-push/pull).
 *
 * Key conventions:
 * - All weight values are per-cable (0-220kg range)
 * - Workout modes: OLD_SCHOOL, ECHO, PUMP, TUT, TUT_BEAST, ECCENTRIC_ONLY (plus CLASSIC legacy alias)
 * - Velocity zones: EXPLOSIVE (>=1.0), FAST (>=0.75), MODERATE (>=0.5), SLOW (>=0.25), GRIND (<0.25)
 * - Asymmetry: 2% threshold for BALANCED classification
 */

import type { Database } from "@/lib/database.types";

// Type aliases for cleaner code
type WorkoutSessionRow = Database["public"]["Tables"]["workout_sessions"]["Row"];
type WorkoutSessionInsert = Database["public"]["Tables"]["workout_sessions"]["Insert"];
type ExerciseRow = Database["public"]["Tables"]["exercises"]["Row"];
type ExerciseInsert = Database["public"]["Tables"]["exercises"]["Insert"];
type SetRow = Database["public"]["Tables"]["sets"]["Row"];
type SetInsert = Database["public"]["Tables"]["sets"]["Insert"];
type RepSummaryRow = Database["public"]["Tables"]["rep_summaries"]["Row"];
type RepSummaryInsert = Database["public"]["Tables"]["rep_summaries"]["Insert"];
type RepTelemetryRow = Database["public"]["Tables"]["rep_telemetry"]["Row"];
type RepTelemetryInsert = Database["public"]["Tables"]["rep_telemetry"]["Insert"];

// Workout mode enum values (must match mobile's ProgramMode.toSyncString())
export const WORKOUT_MODES = [
  "OLD_SCHOOL",
  "ECHO",
  "PUMP",
  "TUT",
  "TUT_BEAST",
  "ECCENTRIC_ONLY",
  "CLASSIC", // Legacy alias for OLD_SCHOOL
] as const;

export type WorkoutMode = (typeof WORKOUT_MODES)[number];

// Velocity zone thresholds (m/s)
export const VELOCITY_ZONES = {
  EXPLOSIVE: 1.0,   // >= 1.0 m/s
  FAST: 0.75,       // >= 0.75 m/s
  MODERATE: 0.5,    // >= 0.5 m/s
  SLOW: 0.25,       // >= 0.25 m/s
  GRIND: 0,         // < 0.25 m/s
} as const;

export type VelocityZone = keyof typeof VELOCITY_ZONES;

// Asymmetry threshold for BALANCED classification
export const ASYMMETRY_BALANCED_THRESHOLD = 2;

// Default test user and timestamp
const DEFAULT_USER_ID = "00000000-0000-0000-0000-000000000001";
const DEFAULT_TIMESTAMP = "2026-04-12T10:00:00.000Z";

/**
 * Generate a deterministic UUID for testing
 */
function generateTestUuid(seed: number): string {
  const hex = seed.toString(16).padStart(8, "0");
  return `${hex.slice(0, 8)}-0000-4000-8000-${hex.padStart(12, "0")}`;
}

let uuidCounter = 1000;
function nextTestUuid(): string {
  return generateTestUuid(uuidCounter++);
}

/**
 * Create a workout session fixture with sensible defaults and all enrichment fields.
 *
 * @param overrides - Partial session data to override defaults
 * @returns A valid WorkoutSessionRow shape
 */
export function createSessionFixture(
  overrides: Partial<WorkoutSessionRow> = {}
): WorkoutSessionRow {
  const id = overrides.id ?? nextTestUuid();
  const userId = overrides.user_id ?? DEFAULT_USER_ID;

  return {
    id,
    user_id: userId,
    name: "Test Workout",
    started_at: DEFAULT_TIMESTAMP,
    duration_seconds: 3600, // 1 hour
    total_volume: 5000, // 5000kg per-cable
    set_count: 15,
    exercise_count: 5,
    pr_count: 2,
    routine_name: "Push Day A",
    routine_session_id: null,
    workout_mode: "OLD_SCHOOL" as WorkoutMode,
    notes: null,
    updated_at: DEFAULT_TIMESTAMP,
    local_profile_id: null,

    // Session enrichment fields (GAPs 3-6)
    avg_velocity_mps: 0.65,
    avg_asymmetry_pct: 1.5, // Under 2% = BALANCED
    velocity_loss_pct: 12.5,
    dominant_side: "RIGHT",
    strength_profile: "EXPLOSIVE",
    form_score: 85,
    deload_warnings: 0,
    rom_violations: 1,
    spotter_activations: 0,
    peak_force_n: 1200,
    estimated_calories: 450,
    heaviest_lift_kg: 100, // Per-cable
    eccentric_load: 1,
    echo_level: null,
    warmup_reps: 15,
    working_reps: 60,
    ...overrides,
  } satisfies WorkoutSessionRow;
}

/**
 * Create a session fixture for each workout mode.
 */
export function createSessionFixturesForAllModes(
  baseOverrides: Partial<WorkoutSessionRow> = {}
): WorkoutSessionRow[] {
  return WORKOUT_MODES.filter((mode) => mode !== "CLASSIC").map((mode) =>
    createSessionFixture({
      ...baseOverrides,
      workout_mode: mode,
      name: `${mode} Workout`,
    })
  );
}

/**
 * Create an exercise fixture.
 *
 * @param overrides - Partial exercise data to override defaults
 * @returns A valid ExerciseRow shape
 */
export function createExerciseFixture(
  overrides: Partial<ExerciseRow> = {}
): ExerciseRow {
  const id = overrides.id ?? nextTestUuid();

  return {
    id,
    session_id: overrides.session_id ?? nextTestUuid(),
    user_id: overrides.user_id ?? DEFAULT_USER_ID,
    name: "Bench Press",
    muscle_group: "Chest",
    order_index: 0,
    ...overrides,
  } satisfies ExerciseRow;
}

/**
 * Create a set fixture.
 *
 * @param overrides - Partial set data to override defaults
 * @returns A valid SetRow shape
 */
export function createSetFixture(overrides: Partial<SetRow> = {}): SetRow {
  const id = overrides.id ?? nextTestUuid();

  return {
    id,
    exercise_id: overrides.exercise_id ?? nextTestUuid(),
    user_id: overrides.user_id ?? DEFAULT_USER_ID,
    set_number: 1,
    target_reps: 10,
    actual_reps: 10,
    weight_kg: 50, // Per-cable (displays as 100kg total)
    rpe: 8,
    is_pr: false,
    notes: null,
    workout_mode: "OLD_SCHOOL" as WorkoutMode,
    ...overrides,
  } satisfies SetRow;
}

/**
 * Create a rep summary fixture with biomechanics data.
 *
 * @param overrides - Partial rep summary data to override defaults
 * @returns A valid RepSummaryRow shape
 */
export function createRepSummaryFixture(
  overrides: Partial<RepSummaryRow> = {}
): RepSummaryRow {
  const id = overrides.id ?? nextTestUuid();

  return {
    id,
    set_id: overrides.set_id ?? nextTestUuid(),
    user_id: overrides.user_id ?? DEFAULT_USER_ID,
    rep_number: 1,
    mean_velocity_mps: 0.65,
    peak_velocity_mps: 0.85,
    mean_force_n: 450,
    peak_force_n: 600,
    power_watts: 350,
    rom_mm: 800,
    tut_ms: 2500, // Time under tension in milliseconds
    asymmetry_pct: 1.2, // Under 2% = BALANCED
    left_force_avg: 225,
    right_force_avg: 228,
    vbt_zone: "MODERATE" as VelocityZone,
    ...overrides,
  } satisfies RepSummaryRow;
}

/**
 * Create rep summaries for all velocity zones.
 */
export function createRepSummaryFixturesForAllZones(
  baseOverrides: Partial<RepSummaryRow> = {}
): RepSummaryRow[] {
  const zoneVelocities: Record<VelocityZone, number> = {
    EXPLOSIVE: 1.2,
    FAST: 0.85,
    MODERATE: 0.6,
    SLOW: 0.35,
    GRIND: 0.15,
  };

  return (Object.entries(zoneVelocities) as [VelocityZone, number][]).map(
    ([zone, velocity], index) =>
      createRepSummaryFixture({
        ...baseOverrides,
        rep_number: index + 1,
        mean_velocity_mps: velocity,
        peak_velocity_mps: velocity * 1.3,
        vbt_zone: zone,
      })
  );
}

/**
 * Create a rep telemetry fixture (high-frequency sensor data).
 *
 * @param overrides - Partial telemetry data to override defaults
 * @returns A valid RepTelemetryRow shape
 */
export function createRepTelemetryFixture(
  overrides: Partial<RepTelemetryRow> = {}
): RepTelemetryRow {
  const id = overrides.id ?? nextTestUuid();

  return {
    id,
    set_id: overrides.set_id ?? nextTestUuid(),
    user_id: overrides.user_id ?? DEFAULT_USER_ID,
    timestamp_ms: 0,
    cable: "A", // A or B for dual-cable system
    position_mm: 400,
    velocity_mps: 0.65,
    force_n: 450,
    ...overrides,
  } satisfies RepTelemetryRow;
}

/**
 * Create a series of telemetry points simulating a rep.
 */
export function createRepTelemetrySeriesFixture(
  setId: string,
  userId: string = DEFAULT_USER_ID,
  sampleCount: number = 50
): RepTelemetryRow[] {
  const points: RepTelemetryRow[] = [];
  const samplingIntervalMs = 20; // 50Hz sampling

  for (let i = 0; i < sampleCount; i++) {
    // Simulate concentric phase (0-25) then eccentric (25-50)
    const phase = i < sampleCount / 2 ? "concentric" : "eccentric";
    const phaseProgress =
      phase === "concentric"
        ? i / (sampleCount / 2)
        : (i - sampleCount / 2) / (sampleCount / 2);

    // Position: 0 -> 800mm (concentric) -> 0 (eccentric)
    const position =
      phase === "concentric"
        ? phaseProgress * 800
        : (1 - phaseProgress) * 800;

    // Velocity: peaks at mid-stroke
    const velocityMultiplier =
      phase === "concentric"
        ? Math.sin(phaseProgress * Math.PI)
        : -Math.sin(phaseProgress * Math.PI) * 0.6; // Slower eccentric

    points.push(
      createRepTelemetryFixture({
        set_id: setId,
        user_id: userId,
        timestamp_ms: i * samplingIntervalMs,
        cable: "A",
        position_mm: Math.round(position),
        velocity_mps: Number((velocityMultiplier * 0.8).toFixed(3)),
        force_n: Math.round(400 + Math.random() * 100),
      })
    );

    // Add cable B with slight asymmetry
    points.push(
      createRepTelemetryFixture({
        set_id: setId,
        user_id: userId,
        timestamp_ms: i * samplingIntervalMs,
        cable: "B",
        position_mm: Math.round(position * 0.98), // 2% asymmetry
        velocity_mps: Number((velocityMultiplier * 0.78).toFixed(3)),
        force_n: Math.round(390 + Math.random() * 100),
      })
    );
  }

  return points;
}

/**
 * Nested session fixture type for comprehensive testing.
 */
export interface NestedSessionFixture {
  session: WorkoutSessionRow;
  exercises: Array<{
    exercise: ExerciseRow;
    sets: Array<{
      set: SetRow;
      repSummaries: RepSummaryRow[];
      telemetry?: RepTelemetryRow[];
    }>;
  }>;
}

/**
 * Create a complete nested session fixture with exercises, sets, reps, and optionally telemetry.
 *
 * @param options - Configuration for the nested fixture
 * @returns A fully nested session structure
 */
export function createNestedSessionFixture(options: {
  exerciseCount?: number;
  setsPerExercise?: number;
  repsPerSet?: number;
  includeTelemetry?: boolean;
  sessionOverrides?: Partial<WorkoutSessionRow>;
  userId?: string;
} = {}): NestedSessionFixture {
  const {
    exerciseCount = 3,
    setsPerExercise = 3,
    repsPerSet = 10,
    includeTelemetry = false,
    sessionOverrides = {},
    userId = DEFAULT_USER_ID,
  } = options;

  const sessionId = nextTestUuid();

  const exerciseNames = [
    { name: "Bench Press", muscleGroup: "Chest" },
    { name: "Squat", muscleGroup: "Legs" },
    { name: "Deadlift", muscleGroup: "Back" },
    { name: "Shoulder Press", muscleGroup: "Shoulders" },
    { name: "Lat Pulldown", muscleGroup: "Back" },
    { name: "Leg Press", muscleGroup: "Legs" },
  ];

  const exercises: NestedSessionFixture["exercises"] = [];
  let totalSets = 0;
  let totalVolume = 0;

  for (let e = 0; e < exerciseCount; e++) {
    const exerciseId = nextTestUuid();
    const exerciseInfo = exerciseNames[e % exerciseNames.length];

    const sets: NestedSessionFixture["exercises"][number]["sets"] = [];

    for (let s = 0; s < setsPerExercise; s++) {
      const setId = nextTestUuid();
      const weight = 50 + e * 10 + s * 2.5; // Progressive weight
      const actualReps = repsPerSet - Math.floor(s / 2); // Fatigue simulation

      totalSets++;
      totalVolume += weight * actualReps;

      const repSummaries: RepSummaryRow[] = [];
      for (let r = 0; r < actualReps; r++) {
        repSummaries.push(
          createRepSummaryFixture({
            set_id: setId,
            user_id: userId,
            rep_number: r + 1,
            // Velocity decreases with fatigue
            mean_velocity_mps: Number((0.8 - r * 0.02).toFixed(3)),
          })
        );
      }

      const telemetry = includeTelemetry
        ? createRepTelemetrySeriesFixture(setId, userId, 50 * actualReps)
        : undefined;

      sets.push({
        set: createSetFixture({
          id: setId,
          exercise_id: exerciseId,
          user_id: userId,
          set_number: s + 1,
          target_reps: repsPerSet,
          actual_reps: actualReps,
          weight_kg: weight,
          is_pr: e === 0 && s === 0, // First set of first exercise is PR
        }),
        repSummaries,
        telemetry,
      });
    }

    exercises.push({
      exercise: createExerciseFixture({
        id: exerciseId,
        session_id: sessionId,
        user_id: userId,
        name: exerciseInfo.name,
        muscle_group: exerciseInfo.muscleGroup,
        order_index: e,
      }),
      sets,
    });
  }

  const session = createSessionFixture({
    id: sessionId,
    user_id: userId,
    exercise_count: exerciseCount,
    set_count: totalSets,
    total_volume: Math.round(totalVolume),
    pr_count: 1,
    ...sessionOverrides,
  });

  return { session, exercises };
}

/**
 * Create insert-ready versions of fixtures (omitting auto-generated fields).
 */
export function toSessionInsert(
  row: WorkoutSessionRow
): WorkoutSessionInsert {
  const { id, ...rest } = row;
  return rest;
}

export function toExerciseInsert(row: ExerciseRow): ExerciseInsert {
  const { id, ...rest } = row;
  return rest;
}

export function toSetInsert(row: SetRow): SetInsert {
  const { id, ...rest } = row;
  return rest;
}

export function toRepSummaryInsert(row: RepSummaryRow): RepSummaryInsert {
  const { id, ...rest } = row;
  return rest;
}

export function toRepTelemetryInsert(row: RepTelemetryRow): RepTelemetryInsert {
  const { id, ...rest } = row;
  return rest;
}
