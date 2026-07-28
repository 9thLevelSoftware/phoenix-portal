import { describe, expect, it, vi } from "vitest";
import {
	createHevyPageFetcher,
	fetchHevyBackfill,
	fetchHevyEvents,
	foldWorkoutEvents,
	HEVY_PAGE_SIZE,
	HevyAuthError,
	type HevyWorkout,
	type HevyWorkoutEvent,
	hevyExternalId,
	maxIsoTimestamp,
	toExternalActivityRow,
} from "../../../supabase/functions/_shared/hevySync.ts";

function makeWorkout(id: string, overrides: Partial<HevyWorkout> = {}) {
	return {
		id,
		title: `Workout ${id}`,
		start_time: "2026-07-01T10:00:00Z",
		end_time: "2026-07-01T11:00:00Z",
		...overrides,
	} satisfies HevyWorkout;
}

/** Build a fetcher that serves canned pages and records the params it saw. */
function pagedFetcher(pages: unknown[]) {
	const calls: Array<{ path: string; params: Record<string, string> }> = [];
	const fetchPage = vi.fn(async (path: string, params: URLSearchParams) => {
		calls.push({ path, params: Object.fromEntries(params) });
		return pages[calls.length - 1] ?? { page: 1, page_count: 1, workouts: [] };
	});
	return { fetchPage, calls };
}

// ─── foldWorkoutEvents ───────────────────────────────────────────────────────

describe("foldWorkoutEvents", () => {
	it("splits updated workouts from deleted ids", () => {
		const events: HevyWorkoutEvent[] = [
			{ type: "updated", workout: makeWorkout("a") },
			{ type: "deleted", id: "b", deleted_at: "2026-07-02T00:00:00Z" },
			{ type: "updated", workout: makeWorkout("c") },
		];

		const result = foldWorkoutEvents(events);

		expect(result.workouts.map((w) => w.id)).toEqual(["a", "c"]);
		expect(result.deletedIds).toEqual(["b"]);
	});

	it("ignores unrecognised event types rather than throwing", () => {
		const events = [
			{ type: "restored", id: "x" },
			{ type: "updated", workout: makeWorkout("a") },
		] as unknown as HevyWorkoutEvent[];

		expect(foldWorkoutEvents(events)).toEqual({
			workouts: [makeWorkout("a")],
			deletedIds: [],
		});
	});

	it("returns empty collections for an empty page", () => {
		expect(foldWorkoutEvents([])).toEqual({ workouts: [], deletedIds: [] });
	});
});

// ─── fetchHevyBackfill ───────────────────────────────────────────────────────

describe("fetchHevyBackfill", () => {
	it("always sends page and pageSize (regression: unpaginated call imported only page 1)", async () => {
		const { fetchPage, calls } = pagedFetcher([
			{ page: 1, page_count: 1, workouts: [makeWorkout("a")] },
		]);

		await fetchHevyBackfill(fetchPage);

		expect(calls[0].path).toBe("/workouts");
		expect(calls[0].params.page).toBe("1");
		expect(calls[0].params.pageSize).toBe(String(HEVY_PAGE_SIZE));
	});

	it("never requests a pageSize above Hevy's cap of 10", async () => {
		const { fetchPage, calls } = pagedFetcher([
			{ page: 1, page_count: 1, workouts: [] },
		]);

		await fetchHevyBackfill(fetchPage);

		expect(Number(calls[0].params.pageSize)).toBeLessThanOrEqual(10);
	});

	it("walks every page reported by page_count", async () => {
		const { fetchPage, calls } = pagedFetcher([
			{ page: 1, page_count: 3, workouts: [makeWorkout("a")] },
			{ page: 2, page_count: 3, workouts: [makeWorkout("b")] },
			{ page: 3, page_count: 3, workouts: [makeWorkout("c")] },
		]);

		const result = await fetchHevyBackfill(fetchPage);

		expect(calls.map((c) => c.params.page)).toEqual(["1", "2", "3"]);
		expect(result.workouts.map((w) => w.id)).toEqual(["a", "b", "c"]);
		expect(result.truncated).toBe(false);
	});

	it("does not stop early when a page lands exactly on the size boundary", async () => {
		const fullPage = Array.from({ length: HEVY_PAGE_SIZE }, (_, i) =>
			makeWorkout(`p1-${i}`),
		);
		const { fetchPage } = pagedFetcher([
			{ page: 1, page_count: 2, workouts: fullPage },
			{ page: 2, page_count: 2, workouts: [makeWorkout("p2-0")] },
		]);

		const result = await fetchHevyBackfill(fetchPage);

		expect(result.workouts).toHaveLength(HEVY_PAGE_SIZE + 1);
	});

	it("flags truncation when the page budget is exhausted", async () => {
		const { fetchPage } = pagedFetcher([
			{ page: 1, page_count: 50, workouts: [makeWorkout("a")] },
			{ page: 2, page_count: 50, workouts: [makeWorkout("b")] },
		]);

		const result = await fetchHevyBackfill(fetchPage, 2);

		expect(result.truncated).toBe(true);
		expect(result.workouts).toHaveLength(2);
	});

	it("tolerates a malformed page body without throwing", async () => {
		const { fetchPage } = pagedFetcher([{}]);

		const result = await fetchHevyBackfill(fetchPage);

		expect(result).toEqual({
			workouts: [],
			deletedIds: [],
			truncated: false,
			latestEventAt: null,
		});
	});

	it("reports no resume point — /v1/workouts has no date filter to resume from", () => {
		// Guards the asymmetry the sync handler depends on: a truncated backfill
		// must NOT be retried, because the retry would reissue an identical
		// request. Only the events feed can resume.
		return fetchHevyBackfill(
			pagedFetcher([{ page: 1, page_count: 9, workouts: [makeWorkout("a")] }])
				.fetchPage,
			1,
		).then((result) => {
			expect(result.truncated).toBe(true);
			expect(result.latestEventAt).toBeNull();
		});
	});
});

// ─── fetchHevyEvents ─────────────────────────────────────────────────────────

describe("fetchHevyEvents", () => {
	it("passes the since watermark through on every page", async () => {
		const since = "2026-07-01T00:00:00.000Z";
		const { fetchPage, calls } = pagedFetcher([
			{ page: 1, page_count: 2, events: [] },
			{ page: 2, page_count: 2, events: [] },
		]);

		await fetchHevyEvents(fetchPage, since);

		expect(calls).toHaveLength(2);
		for (const call of calls) {
			expect(call.path).toBe("/workouts/events");
			expect(call.params.since).toBe(since);
		}
	});

	it("accumulates updates and deletions across pages", async () => {
		const { fetchPage } = pagedFetcher([
			{
				page: 1,
				page_count: 2,
				events: [
					{ type: "updated", workout: makeWorkout("a") },
					{ type: "deleted", id: "gone-1" },
				],
			},
			{
				page: 2,
				page_count: 2,
				events: [{ type: "deleted", id: "gone-2" }],
			},
		]);

		const result = await fetchHevyEvents(fetchPage, "2026-07-01T00:00:00Z");

		expect(result.workouts.map((w) => w.id)).toEqual(["a"]);
		expect(result.deletedIds).toEqual(["gone-1", "gone-2"]);
		expect(result.truncated).toBe(false);
	});

	it("flags truncation so the caller withholds the watermark advance", async () => {
		const { fetchPage } = pagedFetcher([
			{ page: 1, page_count: 9, events: [] },
		]);

		const result = await fetchHevyEvents(fetchPage, "2026-07-01T00:00:00Z", 1);

		expect(result.truncated).toBe(true);
	});

	it("reports the newest event processed so a truncated run can resume", async () => {
		// Without this the retry replays the original `since`, truncates
		// identically, and burns the queue's retry cap without progressing.
		const { fetchPage } = pagedFetcher([
			{
				page: 1,
				page_count: 5,
				events: [
					{
						type: "updated",
						workout: makeWorkout("a", {
							updated_at: "2026-07-02T00:00:00Z",
						}),
					},
					{
						type: "updated",
						workout: makeWorkout("b", {
							updated_at: "2026-07-05T00:00:00Z",
						}),
					},
				],
			},
		]);

		const result = await fetchHevyEvents(fetchPage, "2026-07-01T00:00:00Z", 1);

		expect(result.truncated).toBe(true);
		expect(result.latestEventAt).toBe("2026-07-05T00:00:00Z");
	});

	it("advances the resume point past deletions too", async () => {
		const { fetchPage } = pagedFetcher([
			{
				page: 1,
				page_count: 1,
				events: [
					{ type: "deleted", id: "x", deleted_at: "2026-07-09T00:00:00Z" },
				],
			},
		]);

		const result = await fetchHevyEvents(fetchPage, "2026-07-01T00:00:00Z");

		expect(result.latestEventAt).toBe("2026-07-09T00:00:00Z");
	});

	it("leaves the resume point null when no event carries a timestamp", async () => {
		const { fetchPage } = pagedFetcher([
			{
				page: 1,
				page_count: 1,
				events: [{ type: "updated", workout: makeWorkout("a") }],
			},
		]);

		const result = await fetchHevyEvents(fetchPage, "2026-07-01T00:00:00Z");

		expect(result.latestEventAt).toBeNull();
	});

	it("takes the newest timestamp across pages regardless of arrival order", async () => {
		const { fetchPage } = pagedFetcher([
			{
				page: 1,
				page_count: 2,
				events: [
					{
						type: "updated",
						workout: makeWorkout("a", {
							updated_at: "2026-07-20T00:00:00Z",
						}),
					},
				],
			},
			{
				page: 2,
				page_count: 2,
				events: [
					{
						type: "updated",
						workout: makeWorkout("b", {
							updated_at: "2026-07-11T00:00:00Z",
						}),
					},
				],
			},
		]);

		const result = await fetchHevyEvents(fetchPage, "2026-07-01T00:00:00Z");

		expect(result.latestEventAt).toBe("2026-07-20T00:00:00Z");
	});
});

describe("maxIsoTimestamp", () => {
	it("returns the later of two timestamps", () => {
		expect(
			maxIsoTimestamp("2026-07-01T00:00:00Z", "2026-07-02T00:00:00Z"),
		).toBe("2026-07-02T00:00:00Z");
		expect(
			maxIsoTimestamp("2026-07-03T00:00:00Z", "2026-07-02T00:00:00Z"),
		).toBe("2026-07-03T00:00:00Z");
	});

	it("tolerates nulls on either side", () => {
		expect(maxIsoTimestamp(null, "2026-07-02T00:00:00Z")).toBe(
			"2026-07-02T00:00:00Z",
		);
		expect(maxIsoTimestamp("2026-07-02T00:00:00Z", null)).toBe(
			"2026-07-02T00:00:00Z",
		);
		expect(maxIsoTimestamp(null, null)).toBeNull();
	});

	it("ignores unparseable candidates rather than poisoning the watermark", () => {
		expect(maxIsoTimestamp("2026-07-02T00:00:00Z", "not-a-date")).toBe(
			"2026-07-02T00:00:00Z",
		);
	});
});

// ─── createHevyPageFetcher ───────────────────────────────────────────────────

describe("createHevyPageFetcher", () => {
	function jsonResponse(body: unknown, status = 200) {
		return new Response(JSON.stringify(body), { status });
	}

	it("sends the api-key header and builds the query string", async () => {
		const fetchImpl = vi.fn(async () => jsonResponse({ ok: true }));
		const fetchPage = createHevyPageFetcher(
			"secret-key",
			fetchImpl as unknown as typeof fetch,
		);

		await fetchPage("/workouts", new URLSearchParams({ page: "2" }));

		const [url, init] = fetchImpl.mock.calls[0] as unknown as [
			string,
			RequestInit,
		];
		expect(url).toBe("https://api.hevyapp.com/v1/workouts?page=2");
		expect((init.headers as Record<string, string>)["api-key"]).toBe(
			"secret-key",
		);
	});

	it.each([401, 403])("maps %i onto HevyAuthError", async (status) => {
		const fetchImpl = vi.fn(async () => jsonResponse({}, status));
		const fetchPage = createHevyPageFetcher(
			"bad-key",
			fetchImpl as unknown as typeof fetch,
		);

		await expect(fetchPage("/workouts", new URLSearchParams())).rejects.toThrow(
			HevyAuthError,
		);
	});

	it("maps other non-2xx responses onto a generic error", async () => {
		const fetchImpl = vi.fn(async () => jsonResponse({}, 500));
		const fetchPage = createHevyPageFetcher(
			"key",
			fetchImpl as unknown as typeof fetch,
		);

		const promise = fetchPage("/workouts", new URLSearchParams());
		await expect(promise).rejects.toThrow("Hevy API returned 500");
		await expect(promise).rejects.not.toThrow(HevyAuthError);
	});
});

// ─── row mapping ─────────────────────────────────────────────────────────────

describe("toExternalActivityRow", () => {
	it("derives an external_id that collides with the CSV import path", () => {
		expect(hevyExternalId("abc")).toBe("hevy-abc");
		expect(toExternalActivityRow("u1", makeWorkout("abc")).external_id).toBe(
			"hevy-abc",
		);
	});

	it("computes duration in seconds from the start/end pair", () => {
		const row = toExternalActivityRow("u1", makeWorkout("a"));
		expect(row.duration_seconds).toBe(3600);
	});

	it("stores null rather than a negative duration when end precedes start", () => {
		const row = toExternalActivityRow(
			"u1",
			makeWorkout("a", { end_time: "2026-07-01T09:00:00Z" }),
		);
		expect(row.duration_seconds).toBeNull();
	});

	it("stores null duration when end_time is unparseable", () => {
		const row = toExternalActivityRow(
			"u1",
			makeWorkout("a", { end_time: "not-a-date" }),
		);
		expect(row.duration_seconds).toBeNull();
	});

	it("preserves the raw payload for later re-normalization", () => {
		const workout = makeWorkout("a");
		expect(toExternalActivityRow("u1", workout).raw_data).toBe(workout);
	});
});
