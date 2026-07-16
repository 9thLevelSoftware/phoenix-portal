export type JsonRecord = Record<string, unknown>;

export type ProfilePreferenceSection =
  | "CORE"
  | "RACK"
  | "WORKOUT"
  | "LED"
  | "VBT";

export interface PortalProfilePreferenceSectionMutation {
  localProfileId: string;
  section: ProfilePreferenceSection;
  documentVersion: number;
  baseRevision: number;
  clientModifiedAt: string;
  payload: JsonRecord;
}

export interface PortalProfilePreferenceSectionCanonical {
  localProfileId: string;
  section: ProfilePreferenceSection;
  documentVersion: number;
  serverRevision: number;
  serverUpdatedAt: string;
  payload: JsonRecord;
}

export interface ProfilePreferenceSectionRejection {
  localProfileId: string;
  section: string;
  serverRevision: number;
  reason:
    | "REVISION_CONFLICT"
    | "VALIDATION_FAILED"
    | "UNSUPPORTED_SECTION"
    | "UNSUPPORTED_DOCUMENT_VERSION"
    | "SECTION_TOO_LARGE"
    | "DUPLICATE_SECTION"
    | "UNKNOWN_PROFILE";
  canonicalSection?: PortalProfilePreferenceSectionCanonical;
}

export type ValidationReason =
  | "VALIDATION_FAILED"
  | "UNSUPPORTED_SECTION"
  | "UNSUPPORTED_DOCUMENT_VERSION";

export class PreferenceValidationError extends Error {
  constructor(
    readonly reason: ValidationReason,
    readonly field: string,
  ) {
    super("Invalid profile preference field: " + field);
    this.name = "PreferenceValidationError";
  }
}

export class PreferenceInfrastructureError extends Error {
  constructor(readonly operation: string) {
    super("Profile preference infrastructure failure");
    this.name = "PreferenceInfrastructureError";
  }
}

export const MAX_PROFILE_PREFERENCE_SECTION_BYTES = 262_144;
export const MAX_PROFILE_PREFERENCE_REQUEST_BYTES = 524_288;
export const MAX_MOBILE_SYNC_REQUEST_BYTES = 9_500_000;
export const INT32_MIN = -2_147_483_648;
export const INT32_MAX = 2_147_483_647;

const utf8Bytes = (rawJson: string): number =>
  new TextEncoder().encode(rawJson).byteLength;

export const PUSH_BODY_KEYS = new Set([
  "deviceId",
  "platform",
  "lastSync",
  "sessions",
  "telemetry",
  "routines",
  "deletedRoutineIds",
  "cycles",
  "deletedCycleIds",
  "rpgAttributes",
  "badges",
  "gamificationStats",
  "phaseStatistics",
  "exerciseSignatures",
  "assessments",
  "customExercises",
  "profileId",
  "profileName",
  "allProfiles",
  "externalActivities",
  "personalRecords",
  "profilePreferenceSections",
]);

const MUTATION_KEYS = [
  "localProfileId",
  "section",
  "documentVersion",
  "baseRevision",
  "clientModifiedAt",
  "payload",
] as const;

const LOCAL_ONLY_KEYS = new Set([
  "safeword",
  "safewordcalibrated",
  "adultsonlyconfirmed",
  "adultsonlyprompted",
  "localgeneration",
  "dirty",
  "legacymigrationversion",
]);

const normalizeKey = (key: string): string =>
  key.replace(/[^a-z0-9]/gi, "").toLowerCase();

export const failPreferenceValidation = (
  field: string,
  reason: ValidationReason = "VALIDATION_FAILED",
): never => {
  throw new PreferenceValidationError(reason, field);
};

function fail(
  field: string,
  reason: ValidationReason = "VALIDATION_FAILED",
): never {
  return failPreferenceValidation(field, reason);
}

export const requireRecord = (value: unknown, field: string): JsonRecord => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(field);
  }
  return value as JsonRecord;
};

export const requirePostgresString = (
  value: unknown,
  field: string,
): string => {
  if (typeof value !== "string") fail(field);
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit === 0) fail(field);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) fail(field);
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      fail(field);
    }
  }
  return value;
};

export function requirePostgresTextTree(
  value: unknown,
  field: string,
): void {
  if (typeof value === "string") {
    requirePostgresString(value, field);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((child, index) =>
      requirePostgresTextTree(child, field + "[" + index + "]")
    );
    return;
  }
  if (typeof value !== "object" || value === null) return;
  Object.entries(value as JsonRecord).forEach(([key, child]) => {
    requirePostgresString(key, field + ".<key>");
    requirePostgresTextTree(child, field + "." + key);
  });
}

export const requireExactRecord = (
  value: unknown,
  keys: readonly string[],
  field: string,
): JsonRecord => {
  const record = requireRecord(value, field);
  requirePostgresTextTree(record, field);
  const allowed = new Set(keys);
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) fail(field + "." + key);
  }
  for (const key of keys) {
    if (!Object.hasOwn(record, key)) fail(field + "." + key);
  }
  return record;
};

export const requireKnownKeys = (
  record: JsonRecord,
  allowed: ReadonlySet<string>,
  field: string,
): void => {
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) fail(field + "." + key);
  }
};

const requireArray = (value: unknown, field: string): unknown[] => {
  if (!Array.isArray(value)) fail(field);
  return value;
};

export interface RawJsonSpan {
  start: number;
  end: number;
}

export interface TopLevelJsonScan {
  valueSpans: Map<string, RawJsonSpan>;
  duplicateKeys: Set<string>;
}

const skipJsonWhitespace = (raw: string, from: number): number => {
  let index = from;
  while (
    index < raw.length && /[\u0009\u000a\u000d\u0020]/.test(raw[index])
  ) {
    index += 1;
  }
  return index;
};

function scanJsonString(raw: string, start: number): number {
  if (raw[start] !== '"') fail("rawJson.string");
  let index = start + 1;
  while (index < raw.length) {
    const character = raw[index];
    if (character === '"') return index + 1;
    if (character === "\\") index += 2;
    else index += 1;
  }
  fail("rawJson.unterminatedString");
}

function scanJsonValue(raw: string, from: number, depth = 0): number {
  if (depth > 256) fail("rawJson.depth");
  let index = skipJsonWhitespace(raw, from);
  if (raw[index] === '"') return scanJsonString(raw, index);
  if (raw[index] === "[") {
    index = skipJsonWhitespace(raw, index + 1);
    if (raw[index] === "]") return index + 1;
    while (index < raw.length) {
      index = skipJsonWhitespace(raw, scanJsonValue(raw, index, depth + 1));
      if (raw[index] === "]") return index + 1;
      if (raw[index] !== ",") fail("rawJson.arrayDelimiter");
      index = skipJsonWhitespace(raw, index + 1);
    }
    fail("rawJson.unterminatedArray");
  }
  if (raw[index] === "{") {
    index = skipJsonWhitespace(raw, index + 1);
    if (raw[index] === "}") return index + 1;
    while (index < raw.length) {
      const keyEnd = scanJsonString(raw, index);
      index = skipJsonWhitespace(raw, keyEnd);
      if (raw[index] !== ":") fail("rawJson.objectColon");
      index = skipJsonWhitespace(
        raw,
        scanJsonValue(raw, index + 1, depth + 1),
      );
      if (raw[index] === "}") return index + 1;
      if (raw[index] !== ",") fail("rawJson.objectDelimiter");
      index = skipJsonWhitespace(raw, index + 1);
    }
    fail("rawJson.unterminatedObject");
  }
  const tokenStart = index;
  while (
    index < raw.length &&
    !/[\u0009\u000a\u000d\u0020,\]}]/.test(raw[index])
  ) {
    index += 1;
  }
  if (index === tokenStart) fail("rawJson.value");
  return index;
}

export function scanTopLevelJsonObject(raw: string): TopLevelJsonScan {
  let index = skipJsonWhitespace(raw, 0);
  if (raw[index] !== "{") fail("body");
  index = skipJsonWhitespace(raw, index + 1);
  const valueSpans = new Map<string, RawJsonSpan>();
  const duplicateKeys = new Set<string>();
  if (raw[index] === "}") {
    index = skipJsonWhitespace(raw, index + 1);
    if (index !== raw.length) fail("rawJson.trailingData");
    return { valueSpans, duplicateKeys };
  }
  while (index < raw.length) {
    const keyStart = index;
    const keyEnd = scanJsonString(raw, keyStart);
    const key = JSON.parse(raw.slice(keyStart, keyEnd)) as string;
    index = skipJsonWhitespace(raw, keyEnd);
    if (raw[index] !== ":") fail("rawJson.objectColon");
    const valueStart = skipJsonWhitespace(raw, index + 1);
    const valueEnd = scanJsonValue(raw, valueStart);
    if (valueSpans.has(key)) duplicateKeys.add(key);
    else valueSpans.set(key, { start: valueStart, end: valueEnd });
    index = skipJsonWhitespace(raw, valueEnd);
    if (raw[index] === "}") {
      index = skipJsonWhitespace(raw, index + 1);
      if (index !== raw.length) fail("rawJson.trailingData");
      return { valueSpans, duplicateKeys };
    }
    if (raw[index] !== ",") fail("rawJson.objectDelimiter");
    index = skipJsonWhitespace(raw, index + 1);
  }
  fail("rawJson.unterminatedObject");
}

export function scanJsonArrayElementSpans(
  raw: string,
  arraySpan: RawJsonSpan,
): RawJsonSpan[] {
  let index = skipJsonWhitespace(raw, arraySpan.start);
  if (raw[index] !== "[") fail("body.profilePreferenceSections");
  index = skipJsonWhitespace(raw, index + 1);
  const spans: RawJsonSpan[] = [];
  if (raw[index] === "]") {
    if (index + 1 !== arraySpan.end) {
      fail("body.profilePreferenceSections.span");
    }
    return spans;
  }
  while (index < arraySpan.end) {
    const start = index;
    const end = scanJsonValue(raw, start);
    spans.push({ start, end });
    index = skipJsonWhitespace(raw, end);
    if (raw[index] === "]") {
      if (index + 1 !== arraySpan.end) {
        fail("body.profilePreferenceSections.span");
      }
      return spans;
    }
    if (raw[index] !== ",") {
      fail("body.profilePreferenceSections.delimiter");
    }
    index = skipJsonWhitespace(raw, index + 1);
  }
  fail("body.profilePreferenceSections.span");
}

const sameJsonValue = (left: unknown, right: unknown): boolean =>
  JSON.stringify(left) === JSON.stringify(right);

const requireBoolean = (value: unknown, field: string): boolean => {
  if (typeof value !== "boolean") fail(field);
  return value;
};

const requireFloat32 = (
  value: unknown,
  field: string,
  predicate: (number: number) => boolean = () => true,
): number => {
  if (
    typeof value !== "number" || !Number.isFinite(value) || !predicate(value)
  ) {
    fail(field);
  }
  const narrowed = Math.fround(value);
  if (
    !Number.isFinite(narrowed) || (value !== 0 && narrowed === 0) ||
    !predicate(narrowed)
  ) {
    fail(field);
  }
  return narrowed;
};

const requireInt32 = (
  value: unknown,
  field: string,
  predicate: (number: number) => boolean = () => true,
): number => {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < INT32_MIN ||
    value > INT32_MAX ||
    !predicate(value)
  ) {
    fail(field);
  }
  return value;
};

const requireSafeJsonLong = (
  value: unknown,
  field: string,
  predicate: (number: number) => boolean = () => true,
): number => {
  if (
    typeof value !== "number" || !Number.isSafeInteger(value) ||
    !predicate(value)
  ) {
    fail(field);
  }
  return value;
};

const requireNonBlank = (value: unknown, field: string): string => {
  const text = requirePostgresString(value, field);
  if (text.trim().length === 0) fail(field);
  return text;
};

const requireEnum = <T extends string>(
  value: unknown,
  allowed: readonly T[],
  field: string,
): T => {
  const text = requirePostgresString(value, field);
  if (!allowed.includes(text as T)) fail(field);
  return text as T;
};

const requireVersionOne = (value: unknown, field: string): 1 => {
  const version = requireInt32(value, field);
  if (version !== 1) fail(field, "UNSUPPORTED_DOCUMENT_VERSION");
  return 1;
};

const RFC3339_INSTANT =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|([+-])(\d{2}):(\d{2}))$/;

const isLeapYear = (year: number): boolean =>
  year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);

const daysInMonth = (year: number, month: number): number =>
  [
    31,
    isLeapYear(year) ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ][month - 1] ?? 0;

export const requireRfc3339Instant = (
  value: unknown,
  field: string,
): string => {
  const text = requirePostgresString(value, field);
  const match = RFC3339_INSTANT.exec(text);
  if (!match) fail(field);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const offsetHour = match[8] === "Z" ? 0 : Number(match[10]);
  const offsetMinute = match[8] === "Z" ? 0 : Number(match[11]);
  if (
    year < 1 ||
    month < 1 || month > 12 ||
    day < 1 || day > daysInMonth(year, month) ||
    hour > 23 || minute > 59 || second > 59 ||
    offsetHour > 23 || offsetMinute > 59
  ) {
    fail(field);
  }
  const epoch = Date.parse(text);
  if (!Number.isFinite(epoch)) fail(field);
  return new Date(epoch).toISOString();
};

const rejectLocalOnlyKeys = (
  value: unknown,
  field = "profilePreferenceSections",
): void => {
  if (Array.isArray(value)) {
    value.forEach((child, index) =>
      rejectLocalOnlyKeys(child, field + "[" + index + "]")
    );
    return;
  }
  if (typeof value !== "object" || value === null) return;
  for (const [key, child] of Object.entries(value as JsonRecord)) {
    if (LOCAL_ONLY_KEYS.has(normalizeKey(key))) fail(field + "." + key);
    rejectLocalOnlyKeys(child, field + "." + key);
  }
};

const RACK_ITEM_KEYS = [
  "id",
  "name",
  "category",
  "weightKg",
  "behavior",
  "enabled",
  "sortOrder",
  "createdAt",
  "updatedAt",
] as const;
const RACK_CATEGORIES = [
  "WEIGHTED_VEST",
  "DIP_BELT",
  "CHAINS",
  "BAND",
  "ASSISTANCE",
  "ATTACHMENT",
  "OTHER",
] as const;
const RACK_BEHAVIORS = [
  "ADDED_RESISTANCE",
  "COUNTERWEIGHT",
  "DISPLAY_ONLY",
] as const;
const WORKOUT_MODES = [0, 2, 3, 4, 6, 10] as const;
const REP_COUNT_TIMINGS = ["TOP", "BOTTOM"] as const;

export function validateCorePayload(value: unknown): JsonRecord {
  const payload = requireExactRecord(
    value,
    ["bodyWeightKg", "weightUnit", "weightIncrement"],
    "payload",
  );
  requireFloat32(
    payload.bodyWeightKg,
    "payload.bodyWeightKg",
    (number) => number === 0 || (number >= 20 && number <= 300),
  );
  requireEnum(payload.weightUnit, ["KG", "LB"] as const, "payload.weightUnit");
  requireFloat32(
    payload.weightIncrement,
    "payload.weightIncrement",
    (number) => number === -1 || number > 0,
  );
  return payload;
}

export function validateRackPayload(value: unknown): JsonRecord {
  const payload = requireExactRecord(value, ["version", "items"], "payload");
  requireVersionOne(payload.version, "payload.version");
  const ids = new Set<string>();
  requireArray(payload.items, "payload.items").forEach((rawItem, index) => {
    const field = "payload.items[" + index + "]";
    const item = requireExactRecord(rawItem, RACK_ITEM_KEYS, field);
    const id = requireNonBlank(item.id, field + ".id");
    requireNonBlank(item.name, field + ".name");
    if (ids.has(id)) fail(field + ".id");
    ids.add(id);
    requireEnum(item.category, RACK_CATEGORIES, field + ".category");
    requireFloat32(item.weightKg, field + ".weightKg", (number) => number >= 0);
    requireEnum(item.behavior, RACK_BEHAVIORS, field + ".behavior");
    requireBoolean(item.enabled, field + ".enabled");
    requireInt32(item.sortOrder, field + ".sortOrder");
    requireSafeJsonLong(item.createdAt, field + ".createdAt");
    requireSafeJsonLong(item.updatedAt, field + ".updatedAt");
  });
  return payload;
}

const JUST_LIFT_KEYS = [
  "workoutModeId",
  "weightPerCableKg",
  "weightChangePerRep",
  "eccentricLoadPercentage",
  "echoLevelValue",
  "stallDetectionEnabled",
  "repCountTimingName",
  "restSeconds",
] as const;

const SINGLE_EXERCISE_KEYS = [
  "exerciseId",
  "setReps",
  "weightPerCableKg",
  "setWeightsPerCableKg",
  "progressionKg",
  "setRestSeconds",
  "workoutModeId",
  "eccentricLoadPercentage",
  "echoLevelValue",
  "duration",
  "isAMRAP",
  "perSetRestTime",
  "defaultRackItemIds",
] as const;

const WORKOUT_KEYS = [
  "version",
  "stopAtTop",
  "beepsEnabled",
  "stallDetectionEnabled",
  "audioRepCountEnabled",
  "repCountTiming",
  "summaryCountdownSeconds",
  "autoStartCountdownSeconds",
  "gamificationEnabled",
  "autoStartRoutine",
  "countdownBeepsEnabled",
  "repSoundEnabled",
  "motionStartEnabled",
  "weightSuggestionsEnabled",
  "defaultRoutineExerciseUsePercentOfPR",
  "defaultRoutineExerciseWeightPercentOfPR",
  "voiceStopEnabled",
  "justLiftDefaults",
  "singleExerciseDefaults",
] as const;

function validateJustLiftDefaults(value: unknown, field: string): void {
  const defaults = requireExactRecord(value, JUST_LIFT_KEYS, field);
  requireInt32(
    defaults.workoutModeId,
    field + ".workoutModeId",
    (number) => WORKOUT_MODES.includes(number as typeof WORKOUT_MODES[number]),
  );
  requireFloat32(
    defaults.weightPerCableKg,
    field + ".weightPerCableKg",
    (number) => number >= 0,
  );
  requireFloat32(defaults.weightChangePerRep, field + ".weightChangePerRep");
  requireInt32(
    defaults.eccentricLoadPercentage,
    field + ".eccentricLoadPercentage",
    (number) => number >= 0 && number <= 150,
  );
  requireInt32(
    defaults.echoLevelValue,
    field + ".echoLevelValue",
    (number) => number >= 0 && number <= 3,
  );
  requireBoolean(
    defaults.stallDetectionEnabled,
    field + ".stallDetectionEnabled",
  );
  requireEnum(
    defaults.repCountTimingName,
    REP_COUNT_TIMINGS,
    field + ".repCountTimingName",
  );
  requireInt32(
    defaults.restSeconds,
    field + ".restSeconds",
    (number) => number === 0 || (number >= 5 && number <= 300),
  );
}

function validateSingleExerciseDefaults(
  mapKey: string,
  value: unknown,
  field: string,
): void {
  const defaults = requireExactRecord(value, SINGLE_EXERCISE_KEYS, field);
  const exerciseId = requireNonBlank(
    defaults.exerciseId,
    field + ".exerciseId",
  );
  if (mapKey.trim().length === 0 || exerciseId !== mapKey) {
    fail(field + ".exerciseId");
  }
  requireArray(defaults.setReps, field + ".setReps").forEach(
    (rep, index) => {
      if (rep !== null) {
        requireInt32(
          rep,
          field + ".setReps[" + index + "]",
          (number) => number >= 0,
        );
      }
    },
  );
  requireFloat32(
    defaults.weightPerCableKg,
    field + ".weightPerCableKg",
    (number) => number >= 0,
  );
  requireArray(
    defaults.setWeightsPerCableKg,
    field + ".setWeightsPerCableKg",
  ).forEach((weight, index) =>
    requireFloat32(
      weight,
      field + ".setWeightsPerCableKg[" + index + "]",
      (number) => number >= 0,
    )
  );
  requireFloat32(defaults.progressionKg, field + ".progressionKg");
  requireArray(defaults.setRestSeconds, field + ".setRestSeconds").forEach(
    (rest, index) =>
      requireInt32(
        rest,
        field + ".setRestSeconds[" + index + "]",
        (number) => number === 0 || (number >= 5 && number <= 300),
      ),
  );
  requireInt32(
    defaults.workoutModeId,
    field + ".workoutModeId",
    (number) => WORKOUT_MODES.includes(number as typeof WORKOUT_MODES[number]),
  );
  requireInt32(
    defaults.eccentricLoadPercentage,
    field + ".eccentricLoadPercentage",
    (number) => number >= 0 && number <= 150,
  );
  requireInt32(
    defaults.echoLevelValue,
    field + ".echoLevelValue",
    (number) => number >= 0 && number <= 3,
  );
  requireInt32(
    defaults.duration,
    field + ".duration",
    (number) => number >= 0,
  );
  requireBoolean(defaults.isAMRAP, field + ".isAMRAP");
  requireBoolean(defaults.perSetRestTime, field + ".perSetRestTime");
  const rackIds = requireArray(
    defaults.defaultRackItemIds,
    field + ".defaultRackItemIds",
  ).map((rackId, index) =>
    requireNonBlank(
      rackId,
      field + ".defaultRackItemIds[" + index + "]",
    )
  );
  if (new Set(rackIds).size !== rackIds.length) {
    fail(field + ".defaultRackItemIds");
  }
}

export function validateWorkoutPayload(value: unknown): JsonRecord {
  const payload = requireExactRecord(value, WORKOUT_KEYS, "payload");
  requireVersionOne(payload.version, "payload.version");
  [
    "stopAtTop",
    "beepsEnabled",
    "stallDetectionEnabled",
    "audioRepCountEnabled",
    "gamificationEnabled",
    "autoStartRoutine",
    "countdownBeepsEnabled",
    "repSoundEnabled",
    "motionStartEnabled",
    "weightSuggestionsEnabled",
    "defaultRoutineExerciseUsePercentOfPR",
    "voiceStopEnabled",
  ].forEach((key) => requireBoolean(payload[key], "payload." + key));
  requireEnum(
    payload.repCountTiming,
    REP_COUNT_TIMINGS,
    "payload.repCountTiming",
  );
  requireInt32(
    payload.summaryCountdownSeconds,
    "payload.summaryCountdownSeconds",
    (number) => [-1, 0, 5, 10, 15, 20, 25, 30].includes(number),
  );
  requireInt32(
    payload.autoStartCountdownSeconds,
    "payload.autoStartCountdownSeconds",
    (number) => number >= 2 && number <= 10,
  );
  requireInt32(
    payload.defaultRoutineExerciseWeightPercentOfPR,
    "payload.defaultRoutineExerciseWeightPercentOfPR",
    (number) => number >= 50 && number <= 120,
  );
  validateJustLiftDefaults(
    payload.justLiftDefaults,
    "payload.justLiftDefaults",
  );
  const singleExerciseDefaults = requireRecord(
    payload.singleExerciseDefaults,
    "payload.singleExerciseDefaults",
  );
  Object.entries(singleExerciseDefaults).forEach(([key, defaults]) =>
    validateSingleExerciseDefaults(
      key,
      defaults,
      "payload.singleExerciseDefaults." + key,
    )
  );
  return payload;
}

export function validateLedPayload(value: unknown): JsonRecord {
  const payload = requireExactRecord(
    value,
    ["ledColorSchemeId", "preferences"],
    "payload",
  );
  requireInt32(
    payload.ledColorSchemeId,
    "payload.ledColorSchemeId",
    (number) => number >= 0,
  );
  const preferences = requireExactRecord(
    payload.preferences,
    ["version", "discoModeUnlocked"],
    "payload.preferences",
  );
  requireVersionOne(preferences.version, "payload.preferences.version");
  requireBoolean(
    preferences.discoModeUnlocked,
    "payload.preferences.discoModeUnlocked",
  );
  return payload;
}

export function validateVbtPayload(value: unknown): JsonRecord {
  const payload = requireExactRecord(
    value,
    ["vbtEnabled", "preferences"],
    "payload",
  );
  requireBoolean(payload.vbtEnabled, "payload.vbtEnabled");
  const preferences = requireExactRecord(
    payload.preferences,
    [
      "version",
      "velocityLossThresholdPercent",
      "autoEndOnVelocityLoss",
      "defaultScalingBasis",
      "verbalEncouragementEnabled",
      "vulgarModeEnabled",
      "vulgarTier",
      "dominatrixModeUnlocked",
      "dominatrixModeActive",
    ],
    "payload.preferences",
  );
  requireVersionOne(preferences.version, "payload.preferences.version");
  requireInt32(
    preferences.velocityLossThresholdPercent,
    "payload.preferences.velocityLossThresholdPercent",
    (number) => number >= 10 && number <= 50,
  );
  requireBoolean(
    preferences.autoEndOnVelocityLoss,
    "payload.preferences.autoEndOnVelocityLoss",
  );
  requireEnum(
    preferences.defaultScalingBasis,
    ["MAX_WEIGHT_PR", "MAX_VOLUME_PR", "ESTIMATED_1RM"] as const,
    "payload.preferences.defaultScalingBasis",
  );
  requireBoolean(
    preferences.verbalEncouragementEnabled,
    "payload.preferences.verbalEncouragementEnabled",
  );
  requireBoolean(
    preferences.vulgarModeEnabled,
    "payload.preferences.vulgarModeEnabled",
  );
  requireEnum(
    preferences.vulgarTier,
    ["MILD", "STRONG", "MIX"] as const,
    "payload.preferences.vulgarTier",
  );
  requireBoolean(
    preferences.dominatrixModeUnlocked,
    "payload.preferences.dominatrixModeUnlocked",
  );
  requireBoolean(
    preferences.dominatrixModeActive,
    "payload.preferences.dominatrixModeActive",
  );
  return payload;
}

export function parsePreferenceMutation(
  value: unknown,
): PortalProfilePreferenceSectionMutation {
  requirePostgresTextTree(value, "mutation");
  rejectLocalOnlyKeys(value);
  const mutation = requireExactRecord(value, MUTATION_KEYS, "mutation");
  const localProfileId = requireNonBlank(
    mutation.localProfileId,
    "mutation.localProfileId",
  );
  const rawSection = mutation.section;
  if (typeof rawSection !== "string") {
    fail("mutation.section", "UNSUPPORTED_SECTION");
  }
  if (
    !(["CORE", "RACK", "WORKOUT", "LED", "VBT"] as string[]).includes(
      rawSection,
    )
  ) {
    fail("mutation.section", "UNSUPPORTED_SECTION");
  }
  const section = rawSection as ProfilePreferenceSection;
  const documentVersion = requireVersionOne(
    mutation.documentVersion,
    "mutation.documentVersion",
  );
  const baseRevision = requireSafeJsonLong(
    mutation.baseRevision,
    "mutation.baseRevision",
    (number) => number >= 0,
  );
  const clientModifiedAt = requireRfc3339Instant(
    mutation.clientModifiedAt,
    "mutation.clientModifiedAt",
  );
  const payload = ({
    CORE: validateCorePayload,
    RACK: validateRackPayload,
    WORKOUT: validateWorkoutPayload,
    LED: validateLedPayload,
    VBT: validateVbtPayload,
  } as const)[section](mutation.payload);
  return {
    localProfileId,
    section,
    documentVersion,
    baseRevision,
    clientModifiedAt,
    payload,
  };
}

export interface PreferenceEnvelope {
  present: boolean;
  validatedMutations: PortalProfilePreferenceSectionMutation[];
  rejections: ProfilePreferenceSectionRejection[];
}

export interface PreferenceRawContext {
  rawBody: string;
  preferenceElementSpans: RawJsonSpan[];
}

const rawPreferenceIdentity = (value: unknown): string | null => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const record = value as JsonRecord;
  if (
    typeof record.localProfileId !== "string" ||
    typeof record.section !== "string"
  ) {
    return null;
  }
  return JSON.stringify([record.localProfileId, record.section]);
};

const rawPreferenceLabel = (
  value: unknown,
): { localProfileId: string; section: string } => {
  const record = typeof value === "object" && value !== null &&
      !Array.isArray(value)
    ? value as JsonRecord
    : {};
  return {
    localProfileId: typeof record.localProfileId === "string"
      ? record.localProfileId
      : "",
    section: typeof record.section === "string" ? record.section : "UNKNOWN",
  };
};

export function parsePreferenceEnvelope(
  body: JsonRecord,
  rawContext: PreferenceRawContext,
): PreferenceEnvelope {
  requireKnownKeys(body, PUSH_BODY_KEYS, "body");
  if (!Object.hasOwn(body, "profilePreferenceSections")) {
    if (rawContext.preferenceElementSpans.length !== 0) {
      fail("body.profilePreferenceSections.span");
    }
    return { present: false, validatedMutations: [], rejections: [] };
  }
  const rawMutations = requireArray(
    body.profilePreferenceSections,
    "body.profilePreferenceSections",
  );
  if (rawMutations.length !== rawContext.preferenceElementSpans.length) {
    fail("body.profilePreferenceSections.span");
  }
  rawMutations.forEach((rawMutation, index) => {
    const span = rawContext.preferenceElementSpans[index];
    let reparsed: unknown;
    try {
      reparsed = JSON.parse(rawContext.rawBody.slice(span.start, span.end));
    } catch {
      fail("body.profilePreferenceSections.span");
    }
    if (!sameJsonValue(reparsed, rawMutation)) {
      fail("body.profilePreferenceSections.span");
    }
  });

  const identityCounts = new Map<string, number>();
  rawMutations.forEach((rawMutation) => {
    const identity = rawPreferenceIdentity(rawMutation);
    if (identity !== null) {
      identityCounts.set(identity, (identityCounts.get(identity) ?? 0) + 1);
    }
  });
  const duplicateIdentities = new Set(
    [...identityCounts.entries()]
      .filter(([, count]) => count > 1)
      .map(([identity]) => identity),
  );

  const validatedMutations: PortalProfilePreferenceSectionMutation[] = [];
  const rejections: ProfilePreferenceSectionRejection[] = [];
  const duplicateReported = new Set<string>();
  rawMutations.forEach((rawMutation, index) => {
    const label = rawPreferenceLabel(rawMutation);
    const identity = rawPreferenceIdentity(rawMutation);
    if (identity !== null && duplicateIdentities.has(identity)) {
      if (!duplicateReported.has(identity)) {
        duplicateReported.add(identity);
        rejections.push({
          ...label,
          serverRevision: 0,
          reason: "DUPLICATE_SECTION",
        });
      }
      return;
    }
    const span = rawContext.preferenceElementSpans[index];
    const rawPreferenceElementBytes = utf8Bytes(
      rawContext.rawBody.slice(span.start, span.end),
    );
    if (rawPreferenceElementBytes > MAX_PROFILE_PREFERENCE_SECTION_BYTES) {
      rejections.push({
        ...label,
        serverRevision: 0,
        reason: "SECTION_TOO_LARGE",
      });
      return;
    }
    try {
      validatedMutations.push(parsePreferenceMutation(rawMutation));
    } catch (error) {
      if (!(error instanceof PreferenceValidationError)) throw error;
      rejections.push({
        ...label,
        serverRevision: 0,
        reason: error.reason,
      });
    }
  });
  return { present: true, validatedMutations, rejections };
}

export interface RpcMutationRow {
  accepted: boolean;
  rejection_reason: string | null;
  server_revision: number | string;
  canonical_section: unknown | null;
}

export interface ParsedRpcMutationRow {
  accepted: boolean;
  rejectionReason: string | null;
  serverRevision: number;
  canonicalSection?: PortalProfilePreferenceSectionCanonical;
}

const RPC_DOMAIN_REASONS = new Set([
  "REVISION_CONFLICT",
  "VALIDATION_FAILED",
  "UNSUPPORTED_SECTION",
  "UNSUPPORTED_DOCUMENT_VERSION",
  "UNKNOWN_PROFILE",
]);

export const infrastructureRevision = (value: unknown): number => {
  const number = typeof value === "string" && /^[0-9]+$/.test(value)
    ? Number(value)
    : value;
  if (
    typeof number !== "number" ||
    !Number.isSafeInteger(number) ||
    number < 0
  ) {
    throw new PreferenceInfrastructureError("malformed revision");
  }
  return number;
};

export function parseInfrastructureCanonical(
  value: unknown,
  mutation: PortalProfilePreferenceSectionMutation,
): PortalProfilePreferenceSectionCanonical {
  try {
    requirePostgresTextTree(value, "canonical");
    const canonical = requireExactRecord(
      value,
      [
        "localProfileId",
        "section",
        "documentVersion",
        "serverRevision",
        "serverUpdatedAt",
        "payload",
      ],
      "canonical",
    );
    if (canonical.localProfileId !== mutation.localProfileId) {
      fail("canonical.localProfileId");
    }
    if (canonical.section !== mutation.section) fail("canonical.section");
    requireVersionOne(
      canonical.documentVersion,
      "canonical.documentVersion",
    );
    const serverRevision = infrastructureRevision(canonical.serverRevision);
    const serverUpdatedAt = requireRfc3339Instant(
      canonical.serverUpdatedAt,
      "canonical.serverUpdatedAt",
    );
    const payload = ({
      CORE: validateCorePayload,
      RACK: validateRackPayload,
      WORKOUT: validateWorkoutPayload,
      LED: validateLedPayload,
      VBT: validateVbtPayload,
    } as const)[mutation.section](canonical.payload);
    return {
      localProfileId: mutation.localProfileId,
      section: mutation.section,
      documentVersion: 1,
      serverRevision,
      serverUpdatedAt,
      payload,
    };
  } catch (error) {
    if (error instanceof PreferenceInfrastructureError) throw error;
    throw new PreferenceInfrastructureError("malformed canonical");
  }
}

export function parseRpcMutationRow(
  data: unknown,
  mutation: PortalProfilePreferenceSectionMutation,
): ParsedRpcMutationRow {
  if (!Array.isArray(data) || data.length !== 1) {
    throw new PreferenceInfrastructureError("RPC row cardinality");
  }
  try {
    const row = requireExactRecord(
      data[0],
      ["accepted", "rejection_reason", "server_revision", "canonical_section"],
      "rpcRow",
    ) as unknown as RpcMutationRow;
    if (typeof row.accepted !== "boolean") fail("rpcRow.accepted");
    const serverRevision = infrastructureRevision(row.server_revision);
    const canonicalSection = row.canonical_section === null
      ? undefined
      : parseInfrastructureCanonical(row.canonical_section, mutation);
    if (row.accepted) {
      if (row.rejection_reason !== null || !canonicalSection) fail("rpcRow");
    } else {
      if (
        typeof row.rejection_reason !== "string" ||
        !RPC_DOMAIN_REASONS.has(row.rejection_reason)
      ) {
        fail("rpcRow.rejection_reason");
      }
      if (row.rejection_reason === "REVISION_CONFLICT" && !canonicalSection) {
        fail("rpcRow.canonical_section");
      }
    }
    if (
      canonicalSection && canonicalSection.serverRevision !== serverRevision
    ) {
      fail("rpcRow");
    }
    return {
      accepted: row.accepted,
      rejectionReason: row.rejection_reason,
      serverRevision,
      canonicalSection,
    };
  } catch (error) {
    if (error instanceof PreferenceInfrastructureError) throw error;
    throw new PreferenceInfrastructureError("malformed RPC row");
  }
}

export const safeErrorName = (error: unknown, fallback: string): string => {
  let candidate = fallback;
  if (error instanceof Error) {
    candidate = error.name;
  } else if (
    typeof error === "object" && error !== null &&
    typeof (error as JsonRecord).name === "string"
  ) {
    candidate = (error as JsonRecord).name as string;
  }
  return /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(candidate)
    ? candidate
    : fallback;
};

export const returnedAuthStatus = (error: unknown): number | null => {
  if (typeof error !== "object" || error === null) return null;
  const record = error as JsonRecord;
  const status = record.status ?? record.statusCode;
  return typeof status === "number" && Number.isInteger(status) ? status : null;
};
