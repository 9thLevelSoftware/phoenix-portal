import { describe, expect, it } from "vitest";
import { normalizeGarminActivity } from "./garmin";

// Shared base for a minimal valid Garmin activity payload.
const BASE_ACTIVITY = {
	activityId: 1234567890,
	activityName: "Morning Run",
	activityType: "RUNNING",
	durationInSeconds: 3600,
};

// A fixed epoch: 2024-03-15T10:00:00Z  →  1710496800 seconds
const EPOCH_UTC = 1710496800;
const EXPECTED_ISO = "2024-03-15T10:00:00.000Z";

describe("normalizeGarminActivity — UTC timestamp handling", () => {
	it("produces the correct UTC ISO string when offset is 0", () => {
		const result = normalizeGarminActivity({
			...BASE_ACTIVITY,
			startTimeInSeconds: EPOCH_UTC,
			startTimeOffsetInSeconds: 0,
		});
		expect(result.started_at).toBe(EXPECTED_ISO);
	});

	it("produces the same UTC ISO string for UTC+5 (offset=+18000)", () => {
		// If the bug were present, this would be 5 hours late (wrong).
		const result = normalizeGarminActivity({
			...BASE_ACTIVITY,
			startTimeInSeconds: EPOCH_UTC,
			startTimeOffsetInSeconds: 18000,
		});
		expect(result.started_at).toBe(EXPECTED_ISO);
	});

	it("produces the same UTC ISO string for UTC-5 (offset=-18000)", () => {
		// If the bug were present, this would be 5 hours early (wrong).
		const result = normalizeGarminActivity({
			...BASE_ACTIVITY,
			startTimeInSeconds: EPOCH_UTC,
			startTimeOffsetInSeconds: -18000,
		});
		expect(result.started_at).toBe(EXPECTED_ISO);
	});

	it("uses epoch-only when startTimeOffsetInSeconds is omitted (schema default 0)", () => {
		const result = normalizeGarminActivity({
			...BASE_ACTIVITY,
			startTimeInSeconds: EPOCH_UTC,
			// startTimeOffsetInSeconds intentionally absent
		});
		expect(result.started_at).toBe(EXPECTED_ISO);
	});
});
