import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ExportSection } from "@/app/components/profile/ExportSection";
import type { WorkoutSession } from "@/schemas/transforms";
import { renderWithProviders } from "@/test/test-utils";

const exportMocks = vi.hoisted(() => {
	class ExportCancelledError extends Error {}
	class ExportAlreadyRunningError extends Error {}
	return {
		exportAllUserData: vi.fn(),
		exportAnalyticsTablesZip: vi.fn(),
		cancelUserDataExport: vi.fn(),
		getRunningUserDataExport: vi.fn(),
		ExportCancelledError,
		ExportAlreadyRunningError,
	};
});

vi.mock("@/app/hooks/useAuth", () => ({
	useAuth: () => ({
		user: { id: "user-1", email: "test@example.com" },
	}),
}));

vi.mock("@tanstack/react-query", async () => {
	const actual = await vi.importActual<typeof import("@tanstack/react-query")>(
		"@tanstack/react-query",
	);
	return {
		...actual,
		useQuery: vi.fn(),
		useInfiniteQuery: vi.fn(),
	};
});

const workoutExportMocks = vi.hoisted(() => ({
	fetchWorkoutHistoryForExport: vi.fn(),
}));

vi.mock("@/queries/workouts", () => ({
	workoutListOptions: () => ({ queryKey: ["workouts"], queryFn: vi.fn() }),
	fetchWorkoutHistoryForExport: workoutExportMocks.fetchWorkoutHistoryForExport,
}));

vi.mock("@/queries/records", () => ({
	personalRecordsOptions: () => ({ queryKey: ["records"], queryFn: vi.fn() }),
}));

vi.mock("@/queries/profile", () => ({
	profileOptions: () => ({ queryKey: ["profile"], queryFn: vi.fn() }),
	profileStatsOptions: (userId: string) => ({
		queryKey: ["profile", "stats", userId, "all"],
		queryFn: vi.fn(),
	}),
}));

vi.mock("@/lib/export/data-export", () => exportMocks);

const csvMocks = vi.hoisted(() => ({
	downloadCSV: vi.fn(),
}));

vi.mock("@/lib/export/csv", async () => {
	const actual =
		await vi.importActual<typeof import("@/lib/export/csv")>(
			"@/lib/export/csv",
		);
	return {
		...actual,
		downloadCSV: csvMocks.downloadCSV,
	};
});

vi.mock("sonner", () => ({
	toast: {
		success: vi.fn(),
		error: vi.fn(),
		info: vi.fn(),
	},
}));

describe("ExportSection", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(useQuery).mockImplementation((options) => {
			const key = Array.isArray(options.queryKey) ? options.queryKey[0] : null;
			if (key === "profile") {
				return {
					data: { weight_unit: "lbs" },
					isLoading: false,
				} as ReturnType<typeof useQuery>;
			}
			return { data: [], isLoading: false } as ReturnType<typeof useQuery>;
		});
		vi.mocked(useInfiniteQuery).mockImplementation(
			() =>
				({
					data: [],
					isLoading: false,
					hasNextPage: false,
					fetchNextPage: vi.fn(),
				}) as unknown as ReturnType<typeof useInfiniteQuery>,
		);
		exportMocks.exportAnalyticsTablesZip.mockResolvedValue(undefined);
		exportMocks.getRunningUserDataExport.mockReturnValue(null);
	});

	it("exposes the analytics tables ZIP action", async () => {
		const user = userEvent.setup();
		renderWithProviders(<ExportSection />);

		await user.click(
			screen.getByRole("button", { name: /export analytics tables/i }),
		);

		await waitFor(() => {
			expect(exportMocks.exportAnalyticsTablesZip).toHaveBeenCalledWith(
				"user-1",
				"lbs",
				expect.any(Function),
			);
		});
	});

	it("shows the failure reason and says nothing was downloaded", async () => {
		const { toast } = await import("sonner");
		vi.spyOn(console, "error").mockImplementation(() => {});
		const message =
			"Data export failed: Export failed for sets: Export query failed";
		exportMocks.exportAllUserData.mockRejectedValue(new Error(message));
		const user = userEvent.setup();
		renderWithProviders(<ExportSection />);

		await user.click(
			screen.getByRole("button", { name: /download all my data/i }),
		);

		await waitFor(() => {
			expect(toast.error).toHaveBeenCalledWith(
				"Failed to export data — nothing was downloaded",
				{ description: message },
			);
		});
		expect(toast.success).not.toHaveBeenCalled();
	});

	it("offers cancel while exporting and reports a cancellation", async () => {
		const { toast } = await import("sonner");
		let reject: (error: Error) => void = () => {};
		exportMocks.exportAllUserData.mockReturnValue(
			new Promise<void>((_, r) => {
				reject = r;
			}),
		);
		exportMocks.cancelUserDataExport.mockImplementation(() => {
			reject(new exportMocks.ExportCancelledError("cancelled"));
			return true;
		});
		const user = userEvent.setup();
		renderWithProviders(<ExportSection />);

		await user.click(
			screen.getByRole("button", { name: /download all my data/i }),
		);
		expect(screen.getByRole("button", { name: /exporting/i })).toBeDisabled();
		await user.click(screen.getByRole("button", { name: /cancel export/i }));

		await waitFor(() => {
			expect(toast.info).toHaveBeenCalledWith(
				"Data export cancelled — nothing was downloaded",
			);
		});
		expect(toast.error).not.toHaveBeenCalled();
		expect(
			screen.getByRole("button", { name: /download all my data/i }),
		).toBeEnabled();
	});

	it("shows an export already running after a remount instead of allowing another", async () => {
		let finish: () => void = () => {};
		const promise = new Promise<void>((resolve) => {
			finish = resolve;
		});
		exportMocks.getRunningUserDataExport.mockReturnValue({
			promise,
			cancel: vi.fn(),
			subscribe: (listener: (s: string, c: number, t: number) => void) => {
				listener("Exporting rep_telemetry (5000 rows)...", 10, 20);
				return () => {};
			},
		});
		renderWithProviders(<ExportSection />);

		expect(
			await screen.findByText("Exporting rep_telemetry (5000 rows)..."),
		).toBeInTheDocument();
		expect(screen.getByRole("button", { name: /exporting/i })).toBeDisabled();
		finish();
		await waitFor(() => {
			expect(
				screen.getByRole("button", { name: /download all my data/i }),
			).toBeEnabled();
		});
		expect(exportMocks.exportAllUserData).not.toHaveBeenCalled();
	});

	it("exports every paged session instead of the 50-session list", async () => {
		const { toast } = await import("sonner");
		const preview = workoutSession("Preview only");
		const older = workoutSession("Older than the dashboard cap");
		workoutExportMocks.fetchWorkoutHistoryForExport.mockResolvedValue([
			preview,
			older,
		]);
		vi.mocked(useQuery).mockImplementation((options) => {
			const key = Array.isArray(options.queryKey) ? options.queryKey[0] : null;
			if (key === "profile") {
				return {
					data: { weight_unit: "kg" },
					isLoading: false,
				} as ReturnType<typeof useQuery>;
			}
			if (key === "workouts") {
				return {
					data: [preview],
					isLoading: false,
				} as ReturnType<typeof useQuery>;
			}
			return { data: [], isLoading: false } as ReturnType<typeof useQuery>;
		});
		const user = userEvent.setup();
		renderWithProviders(<ExportSection />);

		await user.click(
			screen.getByRole("button", { name: /export workout history/i }),
		);

		await waitFor(() => {
			expect(
				workoutExportMocks.fetchWorkoutHistoryForExport,
			).toHaveBeenCalledWith("user-1");
		});
		expect(csvMocks.downloadCSV).toHaveBeenCalledTimes(1);
		const csv = csvMocks.downloadCSV.mock.calls[0]?.[0] as string;
		expect(csv).toContain("Preview only");
		expect(csv).toContain("Older than the dashboard cap");
		expect(toast.success).toHaveBeenCalledWith("Exported 2 workouts");
	});

	it("labels exports with the exact account head count, not the loaded page", () => {
		vi.mocked(useQuery).mockImplementation((options) => {
			const key = Array.isArray(options.queryKey) ? options.queryKey : [];
			if (key[0] === "profile" && key[1] === "stats") {
				return {
					data: {
						totalWorkouts: 1500,
						prCount: 1100,
						totalVolume: 0,
						bestStreak: 0,
					},
					isLoading: false,
				} as ReturnType<typeof useQuery>;
			}
			if (key[0] === "profile") {
				return {
					data: { weight_unit: "kg" },
					isLoading: false,
				} as ReturnType<typeof useQuery>;
			}
			if (key[0] === "workouts") {
				return {
					data: [workoutSession("First page only")],
					isLoading: false,
				} as ReturnType<typeof useQuery>;
			}
			return { data: [], isLoading: false } as ReturnType<typeof useQuery>;
		});
		vi.mocked(useInfiniteQuery).mockImplementation(
			() =>
				({
					data: [{ id: "record-1" }],
					isLoading: false,
					hasNextPage: true,
					fetchNextPage: vi.fn(),
				}) as unknown as ReturnType<typeof useInfiniteQuery>,
		);

		renderWithProviders(<ExportSection />);

		expect(
			screen.getByRole("button", { name: /export workout history \(1500\)/i }),
		).toBeInTheDocument();
		expect(
			screen.getByRole("button", {
				name: /export personal records \(1100\)/i,
			}),
		).toBeInTheDocument();
		expect(
			screen.queryByRole("button", { name: /export workout history \(1\)/i }),
		).not.toBeInTheDocument();
		expect(
			screen.queryByRole("button", { name: /export personal records \(1\)/i }),
		).not.toBeInTheDocument();
	});

	it("omits the export size when the exact head count is unavailable", () => {
		vi.mocked(useQuery).mockImplementation((options) => {
			const key = Array.isArray(options.queryKey) ? options.queryKey : [];
			if (key[0] === "profile" && key[1] === "stats") {
				return { data: undefined, isLoading: false } as ReturnType<
					typeof useQuery
				>;
			}
			if (key[0] === "profile") {
				return {
					data: { weight_unit: "kg" },
					isLoading: false,
				} as ReturnType<typeof useQuery>;
			}
			if (key[0] === "workouts") {
				return {
					data: [workoutSession("First page only")],
					isLoading: false,
				} as ReturnType<typeof useQuery>;
			}
			return { data: [], isLoading: false } as ReturnType<typeof useQuery>;
		});
		vi.mocked(useInfiniteQuery).mockImplementation(
			() =>
				({
					data: [{ id: "record-1" }],
					isLoading: false,
					hasNextPage: true,
					fetchNextPage: vi.fn(),
				}) as unknown as ReturnType<typeof useInfiniteQuery>,
		);

		renderWithProviders(<ExportSection />);

		expect(
			screen.getByRole("button", { name: /^export workout history$/i }),
		).toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: /^export personal records$/i }),
		).toBeInTheDocument();
	});
});

function workoutSession(name: string): WorkoutSession {
	return {
		id: "11111111-1111-4111-8111-111111111111",
		user_id: "22222222-2222-4222-8222-222222222222",
		name,
		started_at: new Date("2026-03-01T08:00:00Z"),
		duration_seconds: 3600,
		total_volume: 500,
		set_count: 12,
		exercise_count: 4,
		pr_count: 2,
		routine_name: null,
		workout_mode: null,
		notes: null,
		heaviest_lift_kg: null,
	};
}
