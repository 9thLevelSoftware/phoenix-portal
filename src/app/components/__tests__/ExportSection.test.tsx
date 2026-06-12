import { useQuery } from "@tanstack/react-query";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ExportSection } from "@/app/components/profile/ExportSection";
import { renderWithProviders } from "@/test/test-utils";

const exportMocks = vi.hoisted(() => ({
	exportAllUserData: vi.fn(),
	exportAnalyticsTablesZip: vi.fn(),
}));

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
		exportMocks.exportAnalyticsTablesZip.mockResolvedValue(undefined);
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
});
