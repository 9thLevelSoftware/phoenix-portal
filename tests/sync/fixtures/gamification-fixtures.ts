/**
 * Gamification Entity Fixtures for Beta Sync Validation
 *
 * These factories create valid DTO shapes for gamification-related entities
 * as they flow through the sync pipeline.
 *
 * Key features:
 * - Personal records with workout phases (COMBINED, CONCENTRIC, ECCENTRIC)
 * - RPG attributes (strength, power, stamina, consistency, mastery) 0-100 range
 * - Badge system with 20+ badge types and tiers
 * - Gamification stats for aggregate tracking
 *
 * Note: Mobile computes badge requirements and RPG values; portal receives via sync.
 */

import type { Database } from "@/lib/database.types";

// Type aliases
type PersonalRecordRow = Database["public"]["Tables"]["personal_records"]["Row"];
type PersonalRecordInsert = Database["public"]["Tables"]["personal_records"]["Insert"];
type RpgAttributesRow = Database["public"]["Tables"]["rpg_attributes"]["Row"];
type RpgAttributesInsert = Database["public"]["Tables"]["rpg_attributes"]["Insert"];
type EarnedBadgeRow = Database["public"]["Tables"]["earned_badges"]["Row"];
type EarnedBadgeInsert = Database["public"]["Tables"]["earned_badges"]["Insert"];
type GamificationStatsRow = Database["public"]["Tables"]["gamification_stats"]["Row"];
type GamificationStatsInsert = Database["public"]["Tables"]["gamification_stats"]["Insert"];

// Default test user and timestamp
const DEFAULT_USER_ID = "00000000-0000-0000-0000-000000000001";
const DEFAULT_TIMESTAMP = "2026-04-12T10:00:00.000Z";

// Workout phases for personal records
export const WORKOUT_PHASES = ["COMBINED", "CONCENTRIC", "ECCENTRIC"] as const;
export type WorkoutPhase = (typeof WORKOUT_PHASES)[number];

// Record types
export const RECORD_TYPES = [
  "max_weight",
  "max_reps",
  "max_volume",
  "max_velocity",
  "max_power",
] as const;
export type RecordType = (typeof RECORD_TYPES)[number];

// Badge tiers
export const BADGE_TIERS = ["bronze", "silver", "gold", "platinum", "legendary"] as const;
export type BadgeTier = (typeof BADGE_TIERS)[number];

// Character classes (computed by mobile based on dominant RPG attributes)
export const CHARACTER_CLASSES = [
  "Warrior",       // High strength
  "Berserker",     // High power
  "Juggernaut",    // High stamina
  "Sentinel",      // High consistency
  "Sage",          // High mastery
  "Titan",         // Balanced high stats
  "Novice",        // New user
] as const;
export type CharacterClass = (typeof CHARACTER_CLASSES)[number];

// RPG attribute names
export const RPG_ATTRIBUTES = [
  "strength",
  "power",
  "stamina",
  "consistency",
  "mastery",
] as const;
export type RpgAttribute = (typeof RPG_ATTRIBUTES)[number];

// Badge definitions (subset of 20+ badge types)
export const BADGE_DEFINITIONS = {
  // Volume badges
  FIRST_WORKOUT: { name: "First Workout", description: "Complete your first workout" },
  VOLUME_100K: { name: "Centurion", description: "Lift 100,000 kg total volume" },
  VOLUME_1M: { name: "Millionaire", description: "Lift 1,000,000 kg total volume" },

  // Streak badges
  STREAK_7: { name: "Week Warrior", description: "7-day workout streak" },
  STREAK_30: { name: "Month Master", description: "30-day workout streak" },
  STREAK_100: { name: "Century Streak", description: "100-day workout streak" },

  // PR badges
  FIRST_PR: { name: "Record Breaker", description: "Set your first personal record" },
  PR_10: { name: "PR Hunter", description: "Set 10 personal records" },
  PR_100: { name: "PR Legend", description: "Set 100 personal records" },

  // Consistency badges
  WORKOUTS_50: { name: "Half Century", description: "Complete 50 workouts" },
  WORKOUTS_100: { name: "Centurion Lifter", description: "Complete 100 workouts" },
  WORKOUTS_500: { name: "Iron Devotee", description: "Complete 500 workouts" },

  // Mode-specific badges
  TUT_MASTER: { name: "TUT Master", description: "Complete 50 TUT workouts" },
  ECHO_EXPERT: { name: "Echo Expert", description: "Complete 50 Echo workouts" },
  PUMP_CHAMPION: { name: "Pump Champion", description: "Complete 50 Pump workouts" },

  // Performance badges
  VELOCITY_KING: { name: "Velocity King", description: "Achieve 1.5 m/s peak velocity" },
  POWER_HOUSE: { name: "Power House", description: "Generate 1000W peak power" },
  FORM_PERFECT: { name: "Form Perfect", description: "Score 95+ form rating 10 times" },

  // Special badges
  COMEBACK: { name: "Comeback Kid", description: "Return after 30+ days off" },
  EARLY_BIRD: { name: "Early Bird", description: "Complete 20 workouts before 7am" },
  NIGHT_OWL: { name: "Night Owl", description: "Complete 20 workouts after 10pm" },
} as const;

export type BadgeId = keyof typeof BADGE_DEFINITIONS;

let uuidCounter = 4000;
function generateTestUuid(seed: number): string {
  const hex = seed.toString(16).padStart(8, "0");
  return `${hex.slice(0, 8)}-0000-4000-8000-${hex.padStart(12, "0")}`;
}

function nextTestUuid(): string {
  return generateTestUuid(uuidCounter++);
}

/**
 * Create a personal record fixture.
 *
 * @param overrides - Partial record data to override defaults
 * @returns A valid PersonalRecordRow shape
 */
export function createPersonalRecordFixture(
  overrides: Partial<PersonalRecordRow> = {}
): PersonalRecordRow {
  const id = overrides.id ?? nextTestUuid();

  return {
    id,
    user_id: overrides.user_id ?? DEFAULT_USER_ID,
    exercise_name: "Bench Press",
    muscle_group: "Chest",
    record_type: "max_weight" as RecordType,
    value: 100, // Per-cable (displays as 200kg total)
    unit: "kg",
    achieved_at: DEFAULT_TIMESTAMP,
    previous_value: 95, // Previous PR
    workout_phase: "COMBINED" as WorkoutPhase,
    local_profile_id: null,
    updated_at: DEFAULT_TIMESTAMP,
    ...overrides,
  } satisfies PersonalRecordRow;
}

/**
 * Create personal records for all workout phases.
 */
export function createPersonalRecordFixturesForAllPhases(
  exerciseName: string = "Bench Press",
  baseValue: number = 100,
  overrides: Partial<PersonalRecordRow> = {}
): PersonalRecordRow[] {
  return WORKOUT_PHASES.map((phase, index) =>
    createPersonalRecordFixture({
      exercise_name: exerciseName,
      workout_phase: phase,
      value: baseValue - index * 10, // COMBINED > CONCENTRIC > ECCENTRIC
      ...overrides,
    })
  );
}

/**
 * Create personal records for all record types.
 */
export function createPersonalRecordFixturesForAllTypes(
  exerciseName: string = "Bench Press",
  overrides: Partial<PersonalRecordRow> = {}
): PersonalRecordRow[] {
  const valuesByType: Record<RecordType, { value: number; unit: string }> = {
    max_weight: { value: 100, unit: "kg" },
    max_reps: { value: 15, unit: "reps" },
    max_volume: { value: 5000, unit: "kg" },
    max_velocity: { value: 1.2, unit: "m/s" },
    max_power: { value: 800, unit: "W" },
  };

  return RECORD_TYPES.map((recordType) =>
    createPersonalRecordFixture({
      exercise_name: exerciseName,
      record_type: recordType,
      value: valuesByType[recordType].value,
      unit: valuesByType[recordType].unit,
      ...overrides,
    })
  );
}

/**
 * Create an RPG attributes fixture with 5 attributes (0-100 range).
 *
 * @param overrides - Partial attributes data to override defaults
 * @returns A valid RpgAttributesRow shape
 */
export function createRpgAttributesFixture(
  overrides: Partial<RpgAttributesRow> = {}
): RpgAttributesRow {
  const id = overrides.id ?? nextTestUuid();

  return {
    id,
    user_id: overrides.user_id ?? DEFAULT_USER_ID,
    strength: 65,      // Heavy lifting focus
    power: 55,         // Explosive movement capability
    stamina: 70,       // Endurance and volume tolerance
    consistency: 80,   // Workout frequency
    mastery: 45,       // Exercise variety and technique
    character_class: "Juggernaut" as CharacterClass, // Computed from dominant attribute
    level: 15,
    experience_points: 4500,
    updated_at: DEFAULT_TIMESTAMP,
    ...overrides,
  } satisfies RpgAttributesRow;
}

/**
 * Create RPG attributes for each character class archetype.
 */
export function createRpgAttributesFixturesForAllClasses(
  userId: string = DEFAULT_USER_ID
): RpgAttributesRow[] {
  const classProfiles: Record<CharacterClass, Partial<RpgAttributesRow>> = {
    Warrior: { strength: 90, power: 60, stamina: 50, consistency: 60, mastery: 40 },
    Berserker: { strength: 60, power: 90, stamina: 50, consistency: 50, mastery: 50 },
    Juggernaut: { strength: 60, power: 50, stamina: 90, consistency: 60, mastery: 40 },
    Sentinel: { strength: 50, power: 50, stamina: 60, consistency: 90, mastery: 50 },
    Sage: { strength: 40, power: 50, stamina: 50, consistency: 60, mastery: 90 },
    Titan: { strength: 80, power: 75, stamina: 75, consistency: 80, mastery: 80 },
    Novice: { strength: 10, power: 10, stamina: 10, consistency: 5, mastery: 5 },
  };

  return CHARACTER_CLASSES.map((charClass) =>
    createRpgAttributesFixture({
      user_id: userId,
      character_class: charClass,
      ...classProfiles[charClass],
    })
  );
}

/**
 * Create a badge fixture.
 *
 * @param overrides - Partial badge data to override defaults
 * @returns A valid EarnedBadgeRow shape
 */
export function createBadgeFixture(
  overrides: Partial<EarnedBadgeRow> = {}
): EarnedBadgeRow {
  const id = overrides.id ?? nextTestUuid();
  const badgeId = (overrides.badge_id ?? "FIRST_WORKOUT") as BadgeId;
  const badgeDef = BADGE_DEFINITIONS[badgeId] ?? { name: "Unknown", description: "" };

  return {
    id,
    user_id: overrides.user_id ?? DEFAULT_USER_ID,
    badge_id: badgeId,
    badge_name: overrides.badge_name ?? badgeDef.name,
    badge_description: overrides.badge_description ?? badgeDef.description,
    badge_tier: "bronze" as BadgeTier,
    earned_at: DEFAULT_TIMESTAMP,
    ...overrides,
  } satisfies EarnedBadgeRow;
}

/**
 * Create badges for all tiers.
 */
export function createBadgeFixturesForAllTiers(
  badgeId: BadgeId = "VOLUME_100K",
  userId: string = DEFAULT_USER_ID
): EarnedBadgeRow[] {
  const badgeDef = BADGE_DEFINITIONS[badgeId];

  return BADGE_TIERS.map((tier) =>
    createBadgeFixture({
      user_id: userId,
      badge_id: badgeId,
      badge_name: `${badgeDef.name} (${tier})`,
      badge_tier: tier,
    })
  );
}

/**
 * Create a comprehensive badge collection for a user.
 */
export function createBadgeCollectionFixture(
  userId: string = DEFAULT_USER_ID,
  badgeIds: BadgeId[] = ["FIRST_WORKOUT", "STREAK_7", "FIRST_PR"]
): EarnedBadgeRow[] {
  return badgeIds.map((badgeId, index) => {
    // Later badges have higher tiers
    const tierIndex = Math.min(index, BADGE_TIERS.length - 1);
    return createBadgeFixture({
      user_id: userId,
      badge_id: badgeId,
      badge_tier: BADGE_TIERS[tierIndex],
    });
  });
}

/**
 * Create a gamification stats fixture.
 *
 * @param overrides - Partial stats data to override defaults
 * @returns A valid GamificationStatsRow shape
 */
export function createGamificationStatsFixture(
  overrides: Partial<GamificationStatsRow> = {}
): GamificationStatsRow {
  const id = overrides.id ?? nextTestUuid();

  return {
    id,
    user_id: overrides.user_id ?? DEFAULT_USER_ID,
    total_workouts: 150,
    total_reps: 15000,
    total_volume_kg: 750000, // 750 tonnes!
    longest_streak: 45,
    current_streak: 12,
    total_time_seconds: 540000, // 150 hours
    updated_at: DEFAULT_TIMESTAMP,
    ...overrides,
  } satisfies GamificationStatsRow;
}

/**
 * Aggregate gamification fixture combining all gamification data.
 */
export interface AggregateGamificationFixture {
  stats: GamificationStatsRow;
  rpgAttributes: RpgAttributesRow;
  badges: EarnedBadgeRow[];
  personalRecords: PersonalRecordRow[];
}

/**
 * Create a complete gamification profile for a user.
 */
export function createAggregateGamificationFixture(options: {
  userId?: string;
  badgeCount?: number;
  prCount?: number;
} = {}): AggregateGamificationFixture {
  const {
    userId = DEFAULT_USER_ID,
    badgeCount = 5,
    prCount = 10,
  } = options;

  const badgeIds = Object.keys(BADGE_DEFINITIONS) as BadgeId[];
  const selectedBadges = badgeIds.slice(0, badgeCount);

  const exerciseNames = [
    "Bench Press",
    "Squat",
    "Deadlift",
    "Shoulder Press",
    "Lat Pulldown",
  ];

  const personalRecords: PersonalRecordRow[] = [];
  for (let i = 0; i < prCount; i++) {
    personalRecords.push(
      createPersonalRecordFixture({
        user_id: userId,
        exercise_name: exerciseNames[i % exerciseNames.length],
        record_type: RECORD_TYPES[i % RECORD_TYPES.length],
        value: 50 + i * 10,
      })
    );
  }

  return {
    stats: createGamificationStatsFixture({ user_id: userId }),
    rpgAttributes: createRpgAttributesFixture({ user_id: userId }),
    badges: createBadgeCollectionFixture(userId, selectedBadges),
    personalRecords,
  };
}

/**
 * Create insert-ready versions of fixtures.
 */
export function toPersonalRecordInsert(row: PersonalRecordRow): PersonalRecordInsert {
  const { id, updated_at, ...rest } = row;
  return rest;
}

export function toRpgAttributesInsert(row: RpgAttributesRow): RpgAttributesInsert {
  const { id, updated_at, ...rest } = row;
  return rest;
}

export function toBadgeInsert(row: EarnedBadgeRow): EarnedBadgeInsert {
  const { id, ...rest } = row;
  return rest;
}

export function toGamificationStatsInsert(row: GamificationStatsRow): GamificationStatsInsert {
  const { id, updated_at, ...rest } = row;
  return rest;
}
