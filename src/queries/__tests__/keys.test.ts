import { describe, expect, it } from "vitest";
import { queryKeys } from "../keys";

describe("private resource cache keys", () => {
	it.each([
		["workout", (user: string) => queryKeys.workouts.detail(user, "resource")],
		[
			"comparison",
			(user: string) => queryKeys.workouts.comparison(user, "a", "b"),
		],
		["routine", (user: string) => queryKeys.routines.detail(user, "resource")],
		["cycle", (user: string) => queryKeys.cycles.detail(user, "resource")],
		[
			"set weights",
			(user: string) => queryKeys.analytics.sessionSetWeights(user, "resource"),
		],
		[
			"telemetry",
			(user: string) => queryKeys.telemetry.bySet(user, "resource"),
		],
		[
			"summaries",
			(user: string) => queryKeys.telemetry.repSummaries(user, "resource"),
		],
		[
			"asymmetry",
			(user: string) => queryKeys.biomechanics.asymmetry(user, "resource"),
		],
		["rom", (user: string) => queryKeys.biomechanics.rom(user, "resource")],
		[
			"replay session",
			(user: string) => queryKeys.replay.session(user, "resource"),
		],
		[
			"replay telemetry",
			(user: string) => queryKeys.replay.telemetry(user, "resource"),
		],
	])("scopes %s to the authenticated principal", (_name, key) => {
		expect(key("account-a")).not.toEqual(key("account-b"));
	});
});
