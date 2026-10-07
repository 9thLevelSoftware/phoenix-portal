import { PostgrestClient } from "@supabase/postgrest-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Uses the REAL postgrest-js query builder against a fetch stub, so the test
// asserts the actual request URL PostgREST receives — the replay session embed
// must order exercises and nested sets the same way loadSessionEmbed does.

const SESSION_ID = "11111111-1111-4111-8111-111111111111";

const requests: URL[] = [];
const fetchStub = vi.fn(async (input: RequestInfo | URL) => {
	requests.push(new URL(String(input)));
	return new Response(
		JSON.stringify({
			id: SESSION_ID,
			started_at: "2026-03-10T09:00:00Z",
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

describe("replay session embed request URL", () => {
	beforeEach(() => {
		requests.length = 0;
		fetchStub.mockClear();
	});

	it("replaySessionOptions orders exercises by order_index and sets by set_number", async () => {
		const { replaySessionOptions } = await import("../replay");
		await replaySessionOptions(SESSION_ID).queryFn?.({} as never);

		expect(requests).toHaveLength(1);
		const [url] = requests;
		expect(url.pathname).toBe("/rest/v1/workout_sessions");
		expect(url.searchParams.get("id")).toBe(`eq.${SESSION_ID}`);
		expect(url.searchParams.get("exercises.order")).toBe("order_index.asc");
		expect(url.searchParams.get("exercises.sets.order")).toBe("set_number.asc");
		// No top-level order: sorting must apply to the embedded resources.
		expect(url.searchParams.has("order")).toBe(false);
	});
});
