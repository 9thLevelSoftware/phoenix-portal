import { PostgrestClient } from "@supabase/postgrest-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Uses the REAL postgrest-js query builder against a fetch stub, so the test
// asserts the actual request URL PostgREST receives — in particular that the
// embedded exercises/sets ordering is sent as `exercises.order` and
// `exercises.sets.order`. Removing or misnaming a `referencedTable` order in
// src/queries/workouts.ts fails this test (the chain-mock tests in
// workouts.test.ts only see call arguments).

const SESSION_ID = "11111111-1111-4111-8111-111111111111";

const requests: URL[] = [];
const fetchStub = vi.fn(async (input: RequestInfo | URL) => {
	requests.push(new URL(String(input)));
	return new Response(
		JSON.stringify({
			id: SESSION_ID,
			user_id: "22222222-2222-4222-8222-222222222222",
			name: "Leg Day",
			started_at: "2026-03-10T09:00:00Z",
			duration_seconds: 2400,
			total_volume: 800,
			set_count: 0,
			exercise_count: 0,
			pr_count: 0,
			routine_name: null,
			workout_mode: null,
			notes: null,
			exercises: [],
		}),
		{ status: 200, headers: { "Content-Type": "application/json" } },
	);
});

vi.mock("@/lib/supabase", () => ({
	supabase: new PostgrestClient("http://postgrest.test/rest/v1", {
		fetch: fetchStub as unknown as typeof fetch,
	}),
}));

describe("embedded session select request URL", () => {
	beforeEach(() => {
		requests.length = 0;
		fetchStub.mockClear();
	});

	it("sessionDetailOptions sends one request ordering exercises and nested sets", async () => {
		const { sessionDetailOptions } = await import("../workouts");
		await sessionDetailOptions(SESSION_ID).queryFn?.({} as never);

		expect(requests).toHaveLength(1);
		const [url] = requests;
		expect(url.pathname).toBe("/rest/v1/workout_sessions");
		expect(url.searchParams.get("select")).toBe("*,exercises(*,sets(*))");
		expect(url.searchParams.get("id")).toBe(`eq.${SESSION_ID}`);
		expect(url.searchParams.get("exercises.order")).toBe("order_index.asc");
		expect(url.searchParams.get("exercises.sets.order")).toBe("set_number.asc");
		// No top-level order: sorting must apply to the embedded resources.
		expect(url.searchParams.has("order")).toBe(false);
	});

	it("comparisonDetailOptions sends one request with rep summaries and nested ordering", async () => {
		const { comparisonDetailOptions } = await import("../workouts");
		await comparisonDetailOptions(SESSION_ID).queryFn?.({} as never);

		expect(requests).toHaveLength(1);
		const [url] = requests;
		expect(url.pathname).toBe("/rest/v1/workout_sessions");
		expect(url.searchParams.get("select")).toBe(
			"*,exercises(*,sets(*,rep_summaries(set_id,mean_velocity_mps)))",
		);
		expect(url.searchParams.get("exercises.order")).toBe("order_index.asc");
		expect(url.searchParams.get("exercises.sets.order")).toBe("set_number.asc");
		expect(url.searchParams.has("order")).toBe(false);
	});
});
