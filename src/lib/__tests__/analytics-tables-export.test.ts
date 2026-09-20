import JSZip from "jszip";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const loader = vi.hoisted(() => ({ loadBodyMuscleAnalytics: vi.fn() }));
vi.mock("@/lib/body-muscle-analytics-loader", () => loader);

// Every Supabase query in the export resolves to an empty page.
vi.mock("@/lib/supabase", () => {
	const emptyPage = { data: [], error: null };
	const query: Record<string, unknown> = {};
	for (const method of ["select", "eq", "in", "order", "range"]) {
		query[method] = () => query;
	}
	// biome-ignore lint/suspicious/noThenProperty: mimics the thenable PostgREST query builder
	query.then = (resolve: (value: typeof emptyPage) => unknown) =>
		Promise.resolve(emptyPage).then(resolve);
	return { supabase: { from: () => query } };
});

import { exportAnalyticsTablesZip } from "@/lib/export/analytics-tables";

const EMPTY_MODEL = {
	muscles: [],
	muscleById: {},
	totalSets: 0,
	totalReps: 0,
	totalVolumeKg: 0,
	totalLoad: 0,
	estimatedExerciseCount: 0,
	unmatchedExerciseCount: 0,
};

describe("exportAnalyticsTablesZip (lazy body-muscle map)", () => {
	beforeEach(() => {
		loader.loadBodyMuscleAnalytics.mockReset();
		vi.spyOn(console, "error").mockImplementation(() => undefined);
		vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
			() => undefined,
		);
		Object.assign(URL, {
			createObjectURL: vi.fn(() => "blob:test"),
			revokeObjectURL: vi.fn(),
		});
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("loads the body-muscle map on demand and writes the muscle CSV", async () => {
		const buildBodyMuscleFocusModel = vi.fn(() => EMPTY_MODEL);
		loader.loadBodyMuscleAnalytics.mockResolvedValue({
			buildBodyMuscleFocusModel,
		});
		const fileSpy = vi.spyOn(JSZip.prototype, "file");

		await exportAnalyticsTablesZip("user-1", "kg");

		expect(loader.loadBodyMuscleAnalytics).toHaveBeenCalledTimes(1);
		expect(buildBodyMuscleFocusModel).toHaveBeenCalledTimes(1);
		expect(fileSpy.mock.calls.map(([name]) => name)).toContain(
			"muscle-contribution-summary.csv",
		);
	});

	it("surfaces a failed map download as an export error", async () => {
		loader.loadBodyMuscleAnalytics.mockRejectedValue(
			new Error("Failed to fetch dynamically imported module"),
		);

		await expect(exportAnalyticsTablesZip("user-1", "kg")).rejects.toThrow(
			/Analytics table export failed: Failed to fetch dynamically imported module/,
		);
	});
});
