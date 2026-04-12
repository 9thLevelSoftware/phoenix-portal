/**
 * Training Cycle Entity Fixtures for Beta Sync Validation
 *
 * These factories create valid DTO shapes for training cycle entities
 * as they flow through the sync pipeline.
 *
 * Key features:
 * - Multi-week periodization support
 * - Day-level configuration (workout/rest days)
 * - Progression and deload settings
 * - Routine linking for scheduled workouts
 */

import type { Database, Json } from "@/lib/database.types";

// Type aliases
type TrainingCycleRow = Database["public"]["Tables"]["training_cycles"]["Row"];
type TrainingCycleInsert = Database["public"]["Tables"]["training_cycles"]["Insert"];
type CycleDayRow = Database["public"]["Tables"]["cycle_days"]["Row"];
type CycleDayInsert = Database["public"]["Tables"]["cycle_days"]["Insert"];

// Default test user and timestamp
const DEFAULT_USER_ID = "00000000-0000-0000-0000-000000000001";
const DEFAULT_TIMESTAMP = "2026-04-12T10:00:00.000Z";

// Cycle status values
export const CYCLE_STATUS = ["active", "completed", "draft"] as const;
export type CycleStatus = (typeof CYCLE_STATUS)[number];

// Day type values
export const DAY_TYPES = ["workout", "rest", "active_recovery"] as const;
export type DayType = (typeof DAY_TYPES)[number];

// Rest type values for rest days
export const REST_TYPES = ["passive", "active", "mobility"] as const;
export type RestType = (typeof REST_TYPES)[number];

let uuidCounter = 3000;
function generateTestUuid(seed: number): string {
  const hex = seed.toString(16).padStart(8, "0");
  return `${hex.slice(0, 8)}-0000-4000-8000-${hex.padStart(12, "0")}`;
}

function nextTestUuid(): string {
  return generateTestUuid(uuidCounter++);
}

/**
 * Progression settings structure for cycles.
 */
export interface ProgressionSettings {
  type: "linear" | "wave" | "step";
  weightIncrement: number; // kg per session
  repIncrement: number;
  deloadWeek?: number; // Which week is deload (e.g., 4)
}

/**
 * Deload settings structure for cycles.
 */
export interface DeloadSettings {
  volumeReduction: number; // percentage (e.g., 50 for 50%)
  intensityReduction: number; // percentage
  autoDeload: boolean;
  fatigueThreshold?: number;
}

/**
 * Create a training cycle fixture with sensible defaults.
 *
 * @param overrides - Partial cycle data to override defaults
 * @returns A valid TrainingCycleRow shape
 */
export function createCycleFixture(
  overrides: Partial<TrainingCycleRow> = {}
): TrainingCycleRow {
  const id = overrides.id ?? nextTestUuid();

  return {
    id,
    user_id: overrides.user_id ?? DEFAULT_USER_ID,
    name: "4-Week Strength Cycle",
    description: "Progressive overload with week 4 deload",
    duration_weeks: 4,
    current_week: 1,
    status: "active" as CycleStatus,
    workout_days: 4,
    rest_days: 3,
    started_at: DEFAULT_TIMESTAMP,
    last_used_at: DEFAULT_TIMESTAMP,
    local_profile_id: null,
    updated_at: DEFAULT_TIMESTAMP,

    // Progression settings (stored as JSON)
    progression_settings: {
      type: "linear",
      weightIncrement: 2.5,
      repIncrement: 0,
      deloadWeek: 4,
    } as unknown as Json,

    // Deload settings (stored as JSON)
    deload_settings: {
      volumeReduction: 50,
      intensityReduction: 20,
      autoDeload: true,
      fatigueThreshold: 8,
    } as unknown as Json,

    ...overrides,
  } satisfies TrainingCycleRow;
}

/**
 * Create a cycle day fixture.
 *
 * @param overrides - Partial day data to override defaults
 * @returns A valid CycleDayRow shape
 */
export function createCycleDayFixture(
  overrides: Partial<CycleDayRow> = {}
): CycleDayRow {
  const id = overrides.id ?? nextTestUuid();

  return {
    id,
    cycle_id: overrides.cycle_id ?? nextTestUuid(),
    day_number: 1,
    day_type: "workout" as DayType,
    routine_id: null, // Link to specific routine if workout day
    weight_adjustment: 0, // Percentage adjustment from base (e.g., -10 for deload)
    rep_modifier: 0, // Add/subtract reps from base
    rest_override: null, // Override rest periods if needed
    notes: null,
    rest_type: null, // Only for rest days
    ...overrides,
  } satisfies CycleDayRow;
}

/**
 * Create a workout day in a cycle with routine link.
 */
export function createWorkoutDayFixture(
  cycleId: string,
  dayNumber: number,
  routineId: string,
  overrides: Partial<CycleDayRow> = {}
): CycleDayRow {
  return createCycleDayFixture({
    cycle_id: cycleId,
    day_number: dayNumber,
    day_type: "workout",
    routine_id: routineId,
    ...overrides,
  });
}

/**
 * Create a rest day in a cycle.
 */
export function createRestDayFixture(
  cycleId: string,
  dayNumber: number,
  restType: RestType = "passive",
  overrides: Partial<CycleDayRow> = {}
): CycleDayRow {
  return createCycleDayFixture({
    cycle_id: cycleId,
    day_number: dayNumber,
    day_type: "rest",
    routine_id: null,
    rest_type: restType,
    ...overrides,
  });
}

/**
 * Create a deload day with reduced intensity/volume.
 */
export function createDeloadDayFixture(
  cycleId: string,
  dayNumber: number,
  routineId: string,
  overrides: Partial<CycleDayRow> = {}
): CycleDayRow {
  return createCycleDayFixture({
    cycle_id: cycleId,
    day_number: dayNumber,
    day_type: "workout",
    routine_id: routineId,
    weight_adjustment: -20, // 20% lighter
    rep_modifier: -2, // 2 fewer reps
    notes: "Deload day - reduced volume",
    ...overrides,
  });
}

/**
 * Nested cycle fixture type for comprehensive testing.
 */
export interface NestedCycleFixture {
  cycle: TrainingCycleRow;
  days: CycleDayRow[];
}

/**
 * Create a complete cycle with all days configured.
 *
 * @param options - Configuration for the nested fixture
 * @returns A fully nested cycle structure
 */
export function createNestedCycleFixture(options: {
  durationWeeks?: number;
  workoutDaysPerWeek?: number;
  includeDeload?: boolean;
  routineIds?: string[];
  cycleOverrides?: Partial<TrainingCycleRow>;
  userId?: string;
} = {}): NestedCycleFixture {
  const {
    durationWeeks = 4,
    workoutDaysPerWeek = 4,
    includeDeload = true,
    routineIds = [],
    cycleOverrides = {},
    userId = DEFAULT_USER_ID,
  } = options;

  const cycleId = nextTestUuid();
  const restDaysPerWeek = 7 - workoutDaysPerWeek;
  const totalDays = durationWeeks * 7;

  const days: CycleDayRow[] = [];
  let dayNumber = 1;

  // Generate days for each week
  for (let week = 1; week <= durationWeeks; week++) {
    const isDeloadWeek = includeDeload && week === durationWeeks;

    // Alternate workout and rest days (e.g., Push, Pull, Rest, Legs, Rest, Arms, Rest)
    let workoutsThisWeek = 0;
    let restsThisWeek = 0;

    for (let dayOfWeek = 0; dayOfWeek < 7; dayOfWeek++) {
      // Simple pattern: workout days first, then rest days
      const isWorkoutDay = dayOfWeek < workoutDaysPerWeek;

      if (isWorkoutDay && workoutsThisWeek < workoutDaysPerWeek) {
        const routineIndex = workoutsThisWeek % Math.max(routineIds.length, 1);
        const routineId = routineIds[routineIndex] ?? nextTestUuid();

        if (isDeloadWeek) {
          days.push(createDeloadDayFixture(cycleId, dayNumber, routineId));
        } else {
          days.push(createWorkoutDayFixture(cycleId, dayNumber, routineId, {
            // Progressive overload: slight weight increase each week
            weight_adjustment: (week - 1) * 2.5,
          }));
        }
        workoutsThisWeek++;
      } else if (restsThisWeek < restDaysPerWeek) {
        const restTypes: RestType[] = ["passive", "active", "mobility"];
        const restType = restTypes[restsThisWeek % restTypes.length];
        days.push(createRestDayFixture(cycleId, dayNumber, restType));
        restsThisWeek++;
      }

      dayNumber++;
    }
  }

  const cycle = createCycleFixture({
    id: cycleId,
    user_id: userId,
    duration_weeks: durationWeeks,
    workout_days: workoutDaysPerWeek,
    rest_days: restDaysPerWeek,
    ...cycleOverrides,
  });

  return { cycle, days };
}

/**
 * Create cycles for each status type.
 */
export function createCycleFixturesForAllStatuses(
  userId: string = DEFAULT_USER_ID
): NestedCycleFixture[] {
  return CYCLE_STATUS.map((status) => {
    const cycleId = nextTestUuid();

    const days = [
      createWorkoutDayFixture(cycleId, 1, nextTestUuid()),
      createRestDayFixture(cycleId, 2, "passive"),
    ];

    return {
      cycle: createCycleFixture({
        id: cycleId,
        user_id: userId,
        name: `${status.charAt(0).toUpperCase() + status.slice(1)} Cycle`,
        status: status as CycleStatus,
        current_week: status === "completed" ? 4 : 1,
      }),
      days,
    };
  });
}

/**
 * Create a Push/Pull/Legs cycle structure.
 */
export function createPPLCycleFixture(
  userId: string = DEFAULT_USER_ID,
  routineIds: { push: string; pull: string; legs: string }
): NestedCycleFixture {
  const cycleId = nextTestUuid();

  // PPL x 2 per week = 6 days, 1 rest
  const days: CycleDayRow[] = [];

  for (let week = 1; week <= 4; week++) {
    const weekOffset = (week - 1) * 7;
    const isDeloadWeek = week === 4;
    const weightAdj = isDeloadWeek ? -20 : (week - 1) * 2.5;
    const repMod = isDeloadWeek ? -2 : 0;

    // Day 1: Push
    days.push(createWorkoutDayFixture(cycleId, weekOffset + 1, routineIds.push, {
      weight_adjustment: weightAdj,
      rep_modifier: repMod,
    }));
    // Day 2: Pull
    days.push(createWorkoutDayFixture(cycleId, weekOffset + 2, routineIds.pull, {
      weight_adjustment: weightAdj,
      rep_modifier: repMod,
    }));
    // Day 3: Legs
    days.push(createWorkoutDayFixture(cycleId, weekOffset + 3, routineIds.legs, {
      weight_adjustment: weightAdj,
      rep_modifier: repMod,
    }));
    // Day 4: Push
    days.push(createWorkoutDayFixture(cycleId, weekOffset + 4, routineIds.push, {
      weight_adjustment: weightAdj,
      rep_modifier: repMod,
    }));
    // Day 5: Pull
    days.push(createWorkoutDayFixture(cycleId, weekOffset + 5, routineIds.pull, {
      weight_adjustment: weightAdj,
      rep_modifier: repMod,
    }));
    // Day 6: Legs
    days.push(createWorkoutDayFixture(cycleId, weekOffset + 6, routineIds.legs, {
      weight_adjustment: weightAdj,
      rep_modifier: repMod,
    }));
    // Day 7: Rest
    days.push(createRestDayFixture(cycleId, weekOffset + 7, "active"));
  }

  const cycle = createCycleFixture({
    id: cycleId,
    user_id: userId,
    name: "PPL 4-Week Cycle",
    description: "Push/Pull/Legs twice per week with week 4 deload",
    duration_weeks: 4,
    workout_days: 6,
    rest_days: 1,
  });

  return { cycle, days };
}

/**
 * Create insert-ready versions of fixtures.
 */
export function toCycleInsert(row: TrainingCycleRow): TrainingCycleInsert {
  const { id, updated_at, ...rest } = row;
  return rest;
}

export function toCycleDayInsert(row: CycleDayRow): CycleDayInsert {
  const { id, ...rest } = row;
  return rest;
}
