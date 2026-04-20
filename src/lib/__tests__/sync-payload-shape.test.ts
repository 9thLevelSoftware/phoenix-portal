import { describe, expect, it } from "vitest";
import { normalizePushPayloadShape } from "../../../supabase/functions/_shared/syncPayloadShape.ts";

describe("normalizePushPayloadShape", () => {
	it("coerces missing top-level arrays to []", () => {
		const out = normalizePushPayloadShape({ deviceId: "d1" });
		expect(out.sessions).toEqual([]);
		expect(out.telemetry).toEqual([]);
		expect(out.routines).toEqual([]);
		expect(out.cycles).toEqual([]);
		expect(out.badges).toEqual([]);
		expect(out.phaseStatistics).toEqual([]);
		expect(out.exerciseSignatures).toEqual([]);
		expect(out.assessments).toEqual([]);
		expect(out.externalActivities).toEqual([]);
	});

	it("coerces null and non-array values in array positions to []", () => {
		const out = normalizePushPayloadShape({
			sessions: null,
			telemetry: "bogus",
			routines: 42,
			cycles: { not: "array" },
		});
		expect(out.sessions).toEqual([]);
		expect(out.telemetry).toEqual([]);
		expect(out.routines).toEqual([]);
		expect(out.cycles).toEqual([]);
	});

	it("fills missing nested exercises / sets / repSummaries on sessions", () => {
		const out = normalizePushPayloadShape({
			sessions: [
				{ id: "s1" }, // no exercises
				{ id: "s2", exercises: [{ id: "e1" }] }, // exercise with no sets
				{
					id: "s3",
					exercises: [
						{ id: "e2", sets: [{ id: "st1" }] }, // set with no repSummaries
					],
				},
			],
		});
		expect((out.sessions as any)[0].exercises).toEqual([]);
		expect((out.sessions as any)[1].exercises[0].sets).toEqual([]);
		expect((out.sessions as any)[2].exercises[0].sets[0].repSummaries).toEqual(
			[],
		);
	});

	it("fills missing nested exercises on routines and days on cycles", () => {
		const out = normalizePushPayloadShape({
			routines: [{ id: "r1" }],
			cycles: [{ id: "c1" }],
		});
		expect((out.routines as any)[0].exercises).toEqual([]);
		expect((out.cycles as any)[0].days).toEqual([]);
	});

	it("preserves populated payload content and adds missing list defaults", () => {
		const payload = {
			deviceId: "d1",
			sessions: [
				{
					id: "s1",
					exercises: [
						{ id: "e1", sets: [{ id: "st1", repSummaries: [{ id: "rs1" }] }] },
					],
				},
			],
			telemetry: [{ id: "t1" }],
			routines: [{ id: "r1", exercises: [{ id: "re1" }] }],
			cycles: [{ id: "c1", days: [{ id: "d1" }] }],
		};
		const out = normalizePushPayloadShape(payload);
		// Populated nested content preserved exactly
		expect(out.sessions).toEqual(payload.sessions);
		expect(out.telemetry).toEqual(payload.telemetry);
		expect(out.routines).toEqual(payload.routines);
		expect(out.cycles).toEqual(payload.cycles);
		// Missing list fields filled with []
		expect(out.badges).toEqual([]);
		expect(out.phaseStatistics).toEqual([]);
		expect(out.exerciseSignatures).toEqual([]);
		expect(out.assessments).toEqual([]);
		expect(out.externalActivities).toEqual([]);
		// Non-list scalar fields preserved
		expect((out as any).deviceId).toBe("d1");
	});

	it("leaves allProfiles nullable (fallback path depends on null vs array)", () => {
		const missing = normalizePushPayloadShape({});
		expect((missing as any).allProfiles).toBeUndefined();

		const nulled = normalizePushPayloadShape({ allProfiles: null });
		expect((nulled as any).allProfiles).toBeNull();

		const populated = normalizePushPayloadShape({
			allProfiles: [{ id: "default" }],
		});
		expect((populated as any).allProfiles).toEqual([{ id: "default" }]);
	});
});
