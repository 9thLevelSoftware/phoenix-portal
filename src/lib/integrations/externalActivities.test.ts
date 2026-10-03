import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NormalizedActivity } from "./types";

const upsert = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase", () => ({
	supabase: {
		from: (table: string) => {
			if (table !== "external_activities") {
				throw new Error(`unexpected table ${table}`);
			}
			return { upsert };
		},
	},
}));

function activity(
	index: number,
	provider: NormalizedActivity["provider"] = "hevy",
): NormalizedActivity {
	return {
		external_id: `${provider}-${index}`,
		provider,
		name: `Workout ${index}`,
		activity_type: "strength",
		started_at: "2026-01-01T00:00:00.000Z",
		duration_seconds: 60,
		distance_meters: null,
		calories: null,
		avg_heart_rate: null,
		max_heart_rate: null,
		elevation_gain_meters: null,
	};
}

describe("upsertExternalActivities", () => {
	beforeEach(() => {
		upsert.mockReset();
		upsert.mockResolvedValue({ error: null });
	});

	it("does not call Supabase for an empty import", async () => {
		const { upsertExternalActivities } = await import("./externalActivities");

		await expect(upsertExternalActivities("user-1", "hevy", [])).resolves.toBe(
			0,
		);
		expect(upsert).not.toHaveBeenCalled();
	});

	it("upserts in chunks of 100 and pins the path provider", async () => {
		const { importHevyActivities } = await import("./hevy");
		const activities = Array.from({ length: 101 }, (_, index) =>
			activity(index, "strong"),
		);

		await expect(importHevyActivities("user-1", activities)).resolves.toBe(101);

		expect(upsert).toHaveBeenCalledTimes(2);
		expect(upsert.mock.calls[0]?.[0]).toHaveLength(100);
		expect(upsert.mock.calls[1]?.[0]).toHaveLength(1);
		expect(upsert.mock.calls[0]?.[0][0]).toMatchObject({
			user_id: "user-1",
			provider: "hevy",
			external_id: "strong-0",
		});
		expect(upsert.mock.calls[0]?.[0][0]).not.toHaveProperty("weight_kg");
		expect(upsert).toHaveBeenNthCalledWith(1, expect.any(Array), {
			onConflict: "user_id,provider,external_id",
		});
	});

	it("pins Strong imports to the strong provider", async () => {
		const { importStrongActivities } = await import("./strong");

		await importStrongActivities("user-1", [activity(1, "hevy")]);

		expect(upsert).toHaveBeenCalledTimes(1);
		expect(upsert.mock.calls[0]?.[0][0]).toMatchObject({ provider: "strong" });
	});

	it("throws the first chunk error after earlier chunks have been sent", async () => {
		const { upsertExternalActivities } = await import("./externalActivities");
		const failure = { message: "chunk failed" };
		upsert
			.mockResolvedValueOnce({ error: null })
			.mockResolvedValueOnce({ error: failure });

		await expect(
			upsertExternalActivities(
				"user-1",
				"strong",
				Array.from({ length: 101 }, (_, index) => activity(index, "strong")),
			),
		).rejects.toBe(failure);
		expect(upsert).toHaveBeenCalledTimes(2);
	});
});
