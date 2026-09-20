import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ExportSection } from "@/app/components/profile/ExportSection";
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

vi.mock("@/queries/workouts", () => ({
	workoutListOptions: () => ({ queryKey: ["workouts"], queryFn: vi.fn() }),
}));

vi.mock("@/queries/records", () => ({
	personalRecordsOptions: () => ({ queryKey: ["records"], queryFn: vi.fn() }),
}));

vi.mock("@/queries/profile", () => ({
	profileOptions: () => ({ queryKey: ["profile"], queryFn: vi.fn() }),
}));

vi.mock("@/lib/export/data-export", () => exportMocks);

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
});
