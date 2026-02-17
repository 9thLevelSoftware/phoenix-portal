import { describe, expect, it } from "vitest";
import {
	computeReadinessScore,
	type RecoveryInput,
	STATUS_LABELS,
} from "../recovery";

// Helper: create N sessions spread over a date range
function makeSessions(
	count: number,
	daysBack: number,
	volumePerSession = 5000,
): RecoveryInput["sessions"] {
	const sessions: RecoveryInput["sessions"] = [];
	const now = new Date();
	for (let i = 0; i < count; i++) {
		const dayOffset = Math.round((daysBack / count) * i);
		const d = new Date(now);
		d.setDate(d.getDate() - dayOffset);
		sessions.push({ started_at: d, total_volume: volumePerSession });
	}
	return sessions;
}

// Helper: create sessions in the last N days with specific daily volumes
function makeSessionsInWindow(
	daysBack: number,
	sessionsPerWeek: number,
	volumePerSession = 5000,
): RecoveryInput["sessions"] {
	const sessions: RecoveryInput["sessions"] = [];
	const now = new Date();
	const totalSessions = Math.round((daysBack / 7) * sessionsPerWeek);
	for (let i = 0; i < totalSessions; i++) {
		const dayOffset = Math.round((daysBack / totalSessions) * i);
		const d = new Date(now);
		d.setDate(d.getDate() - dayOffset);
		sessions.push({ started_at: d, total_volume: volumePerSession });
	}
	return sessions;
}

describe("computeReadinessScore", () => {
	// Test 1: User with 0 sessions
	it("returns isGated=true and score=0 for user with 0 sessions", () => {
		const result = computeReadinessScore({
			sessions: [],
			daysSinceFirstSession: 0,
		});
		expect(result.isGated).toBe(true);
		expect(result.score).toBe(0);
	});

	// Test 2: User with < 14 days of data
	it("returns isGated=true and score=0 for user with 10 days of data", () => {
		const sessions = makeSessions(5, 10);
		const result = computeReadinessScore({
			sessions,
			daysSinceFirstSession: 10,
		});
		expect(result.isGated).toBe(true);
		expect(result.score).toBe(0);
	});

	// Test 3: User with 15 days, balanced training -> clamped 25-75
	it("clamps score to 25-75 for user with 15 days of data", () => {
		const sessions = makeSessions(8, 15, 5000);
		const result = computeReadinessScore({
			sessions,
			daysSinceFirstSession: 15,
		});
		expect(result.isGated).toBe(false);
		expect(result.isClamped).toBe(true);
		expect(result.score).toBeGreaterThanOrEqual(25);
		expect(result.score).toBeLessThanOrEqual(75);
	});

	// Test 4: User with 35 days, balanced ACWR ~1.0 -> score ~70-90
	it("returns high score for 35 days of balanced training (ACWR ~1.0)", () => {
		// Consistent training: 4 sessions/week, same volume
		const sessions = makeSessionsInWindow(42, 4, 5000);
		const result = computeReadinessScore({
			sessions,
			daysSinceFirstSession: 35,
		});
		expect(result.isGated).toBe(false);
		expect(result.isClamped).toBe(false);
		expect(result.score).toBeGreaterThanOrEqual(60);
		expect(result.score).toBeLessThanOrEqual(100);
		expect(result.status).toBe("elevated");
	});

	// Test 5: User with 35 days, ACWR > 1.5 (spike) -> score < 40, status "low"
	it("returns low score for ACWR > 1.5 (training spike)", () => {
		// Create chronic baseline (weeks 2-6): low volume
		const now = new Date();
		const sessions: RecoveryInput["sessions"] = [];

		// Chronic period: 2 sessions/week at low volume for weeks 2-6
		for (let w = 1; w <= 5; w++) {
			for (let s = 0; s < 2; s++) {
				const d = new Date(now);
				d.setDate(d.getDate() - (w * 7 + s * 3));
				sessions.push({ started_at: d, total_volume: 2000 });
			}
		}

		// Acute spike: 6 sessions in last 7 days at very high volume
		for (let i = 0; i < 6; i++) {
			const d = new Date(now);
			d.setDate(d.getDate() - i);
			sessions.push({ started_at: d, total_volume: 15000 });
		}

		const result = computeReadinessScore({
			sessions,
			daysSinceFirstSession: 35,
		});
		expect(result.isGated).toBe(false);
		expect(result.score).toBeLessThan(50);
		expect(result.status).toBe("low");
	});

	// Test 6: User with 35 days, ACWR < 0.6 (detraining) -> low ACWR score
	it("returns low score for ACWR < 0.6 (detraining)", () => {
		const now = new Date();
		const sessions: RecoveryInput["sessions"] = [];

		// Heavy chronic: 6 sessions/week for weeks 2-6 at high volume
		for (let w = 1; w <= 5; w++) {
			for (let s = 0; s < 6; s++) {
				const d = new Date(now);
				d.setDate(d.getDate() - (w * 7 + s));
				sessions.push({ started_at: d, total_volume: 10000 });
			}
		}

		// Minimal acute: only 1 tiny session, plus train every day to kill rest score
		for (let i = 0; i < 7; i++) {
			const d = new Date(now);
			d.setDate(d.getDate() - i);
			sessions.push({ started_at: d, total_volume: 500 });
		}

		const result = computeReadinessScore({
			sessions,
			daysSinceFirstSession: 35,
		});
		expect(result.isGated).toBe(false);
		expect(result.factors.acwr).toBeLessThan(0.6);
		expect(result.score).toBeLessThan(50);
		expect(result.status).toBe("low");
	});

	// Test 7: 0 rest days in last 7 -> restScore penalty applied
	it("applies rest day penalty when 0 rest days in last 7", () => {
		const now = new Date();
		const sessions: RecoveryInput["sessions"] = [];

		// Chronic: balanced 4/week for weeks 2-6
		for (let w = 1; w <= 5; w++) {
			for (let s = 0; s < 4; s++) {
				const d = new Date(now);
				d.setDate(d.getDate() - (w * 7 + s * 2));
				sessions.push({ started_at: d, total_volume: 5000 });
			}
		}

		// Acute: train every single day last 7 days (0 rest days)
		for (let i = 0; i < 7; i++) {
			const d = new Date(now);
			d.setDate(d.getDate() - i);
			sessions.push({ started_at: d, total_volume: 5000 });
		}

		const resultNoRest = computeReadinessScore({
			sessions,
			daysSinceFirstSession: 35,
		});

		// Compare with a version that has rest days
		const sessionsWithRest: RecoveryInput["sessions"] = [];
		for (let w = 1; w <= 5; w++) {
			for (let s = 0; s < 4; s++) {
				const d = new Date(now);
				d.setDate(d.getDate() - (w * 7 + s * 2));
				sessionsWithRest.push({ started_at: d, total_volume: 5000 });
			}
		}
		// 4 sessions in last 7 days (3 rest days)
		for (let i = 0; i < 4; i++) {
			const d = new Date(now);
			d.setDate(d.getDate() - (i * 2));
			sessionsWithRest.push({ started_at: d, total_volume: 5000 });
		}

		const resultWithRest = computeReadinessScore({
			sessions: sessionsWithRest,
			daysSinceFirstSession: 35,
		});

		// Score with no rest should be lower than score with rest
		expect(resultNoRest.score).toBeLessThan(resultWithRest.score);
	});

	// Test 8: Score clamped to 25-75 when daysSinceFirstSession is 14-29
	it("clamps score to 25-75 range when daysSinceFirstSession is 14-29", () => {
		// Test at boundary: exactly 14 days
		const sessions14 = makeSessions(10, 14, 5000);
		const result14 = computeReadinessScore({
			sessions: sessions14,
			daysSinceFirstSession: 14,
		});
		expect(result14.isGated).toBe(false);
		expect(result14.isClamped).toBe(true);
		expect(result14.score).toBeGreaterThanOrEqual(25);
		expect(result14.score).toBeLessThanOrEqual(75);

		// Test at boundary: exactly 29 days
		const sessions29 = makeSessions(15, 29, 5000);
		const result29 = computeReadinessScore({
			sessions: sessions29,
			daysSinceFirstSession: 29,
		});
		expect(result29.isGated).toBe(false);
		expect(result29.isClamped).toBe(true);
		expect(result29.score).toBeGreaterThanOrEqual(25);
		expect(result29.score).toBeLessThanOrEqual(75);
	});

	// Test 9: Score NOT clamped when daysSinceFirstSession >= 30
	it("does not clamp score when daysSinceFirstSession >= 30", () => {
		const sessions = makeSessionsInWindow(42, 4, 5000);
		const result = computeReadinessScore({
			sessions,
			daysSinceFirstSession: 30,
		});
		expect(result.isClamped).toBe(false);

		// Score could be above 75 with balanced training
		const result35 = computeReadinessScore({
			sessions,
			daysSinceFirstSession: 35,
		});
		expect(result35.isClamped).toBe(false);
	});

	// Test 10: All labels are descriptive, no imperative words
	it("uses only descriptive labels — no imperative words", () => {
		const imperativeWords = [
			"should",
			"must",
			"rest",
			"stop",
			"do",
			"take",
			"need",
			"avoid",
		];

		// Check all STATUS_LABELS
		for (const [, label] of Object.entries(STATUS_LABELS)) {
			const lowerLabel = label.toLowerCase();
			for (const word of imperativeWords) {
				// Check for word boundaries to avoid false positives
				const regex = new RegExp(`\\b${word}\\b`, "i");
				expect(regex.test(lowerLabel)).toBe(false);
			}
		}

		// Check actual results across different scenarios
		const scenarios: RecoveryInput[] = [
			{ sessions: makeSessionsInWindow(42, 4, 5000), daysSinceFirstSession: 35 },
			{ sessions: makeSessionsInWindow(42, 2, 2000), daysSinceFirstSession: 35 },
			{ sessions: makeSessions(20, 42, 10000), daysSinceFirstSession: 35 },
		];

		for (const input of scenarios) {
			const result = computeReadinessScore(input);
			const lowerLabel = result.label.toLowerCase();
			for (const word of imperativeWords) {
				const regex = new RegExp(`\\b${word}\\b`, "i");
				expect(regex.test(lowerLabel)).toBe(false);
			}
		}
	});

	// Test 11: Factors object contains all required fields
	it("returns factors with acwr, weeklyVolume, chronicVolume, trainingFrequency, restDays, cyclePosition", () => {
		const sessions = makeSessionsInWindow(42, 4, 5000);
		const result = computeReadinessScore({
			sessions,
			daysSinceFirstSession: 35,
		});

		expect(result.factors).toHaveProperty("acwr");
		expect(result.factors).toHaveProperty("weeklyVolume");
		expect(result.factors).toHaveProperty("chronicVolume");
		expect(result.factors).toHaveProperty("trainingFrequency");
		expect(result.factors).toHaveProperty("restDays");
		expect(result.factors).toHaveProperty("cyclePosition");

		// Numeric values should be reasonable
		expect(typeof result.factors.acwr).toBe("number");
		expect(result.factors.acwr).toBeGreaterThan(0);
		expect(typeof result.factors.weeklyVolume).toBe("number");
		expect(typeof result.factors.chronicVolume).toBe("number");
		expect(typeof result.factors.trainingFrequency).toBe("number");
		expect(typeof result.factors.restDays).toBe("number");
	});

	// Test 12: Cycle position affects score
	it("cycle position 'deload' boosts score; 'peak' reduces score; null is neutral", () => {
		const sessions = makeSessionsInWindow(42, 4, 5000);
		const baseInput: RecoveryInput = {
			sessions,
			daysSinceFirstSession: 35,
			cyclePosition: null,
		};

		const neutralResult = computeReadinessScore(baseInput);

		// Deload week: currentWeek is a deload (e.g., week 4 of 4-week cycle, mod 4 === 0)
		const deloadResult = computeReadinessScore({
			...baseInput,
			cyclePosition: { currentWeek: 4, durationWeeks: 4, status: "active" },
		});

		// Peak week: currentWeek >= durationWeeks (final week, not deload)
		const peakResult = computeReadinessScore({
			...baseInput,
			cyclePosition: { currentWeek: 3, durationWeeks: 3, status: "active" },
		});

		// Deload should boost score relative to neutral
		expect(deloadResult.score).toBeGreaterThan(neutralResult.score);
		expect(deloadResult.factors.cyclePosition).toContain("deload");

		// Peak should reduce score relative to neutral
		expect(peakResult.score).toBeLessThan(neutralResult.score);
		expect(peakResult.factors.cyclePosition).toContain("peak");

		// Neutral should have null cycle position
		expect(neutralResult.factors.cyclePosition).toBeNull();
	});
});
