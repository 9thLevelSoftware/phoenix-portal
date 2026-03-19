import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderWithProviders } from "@/test/test-utils";
import { CycleBuilder } from "../CycleBuilder";

// --- Auth mock ---
const mockAuth = vi.hoisted(() => ({
	useAuth: () => ({
		user: { id: "test-user-id", email: "test@example.com" },
		session: { user: { id: "test-user-id" }, access_token: "test-token" },
		loading: false,
		signOut: () => Promise.resolve(),
	}),
}));
vi.mock("@/app/hooks/useAuth", () => mockAuth);
vi.mock("@/providers/AuthProvider", () => mockAuth);

// --- Router mocks ---
const mockNavigate = vi.fn();
const mockParams = vi.hoisted(() => ({ current: {} as Record<string, string> }));
vi.mock("react-router", async () => {
	const actual = await vi.importActual("react-router");
	return {
		...actual,
		useNavigate: () => mockNavigate,
		useParams: () => mockParams.current,
	};
});

// --- Mutation mocks ---
const mockSaveMutate = vi.fn();
const mockUpdateMutate = vi.fn();
vi.mock("@/mutations/cycles", () => ({
	useSaveCycle: () => ({
		mutate: mockSaveMutate,
		isPending: false,
	}),
	useUpdateCycle: () => ({
		mutate: mockUpdateMutate,
		isPending: false,
	}),
}));

// --- Supabase mock ---
vi.mock("@/lib/supabase", () => ({
	supabase: {
		from: () => ({
			select: () => ({
				eq: () => ({
					maybeSingle: () => Promise.resolve({ data: null, error: null }),
					order: () => Promise.resolve({ data: [], error: null }),
					single: () =>
						Promise.resolve({ data: null, error: { message: "not found" } }),
				}),
			}),
		}),
		channel: () => ({
			on: () => ({ subscribe: () => ({}) }),
		}),
		removeChannel: vi.fn(),
	},
}));

// --- Sonner mock ---
vi.mock("sonner", () => ({
	toast: { success: vi.fn(), error: vi.fn() },
}));

describe("CycleBuilder", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockParams.current = {};
	});

	// ---------------------------------------------------------------
	// Smoke test
	// ---------------------------------------------------------------
	it("renders without crashing in create mode", () => {
		renderWithProviders(<CycleBuilder />);
		expect(screen.getByDisplayValue("Untitled Cycle")).toBeInTheDocument();
	});

	// ---------------------------------------------------------------
	// Default UI layout
	// ---------------------------------------------------------------
	it("renders Cycle Details section with duration input", () => {
		renderWithProviders(<CycleBuilder />);
		expect(screen.getByText(/cycle details/i)).toBeInTheDocument();
		expect(screen.getByDisplayValue("7")).toBeInTheDocument();
	});

	it("renders Workout Schedule section", () => {
		renderWithProviders(<CycleBuilder />);
		expect(screen.getByText(/workout schedule/i)).toBeInTheDocument();
	});

	it("renders Week at a Glance section", () => {
		renderWithProviders(<CycleBuilder />);
		expect(screen.getByText(/week at a glance/i)).toBeInTheDocument();
	});

	// ---------------------------------------------------------------
	// Default 7-day schedule
	// ---------------------------------------------------------------
	it("creates default 7-day schedule with 4 workout and 3 rest days", () => {
		renderWithProviders(<CycleBuilder />);
		expect(screen.getByText(/4 workout days/)).toBeInTheDocument();
		expect(screen.getByText(/3 rest days/)).toBeInTheDocument();
	});

	// ---------------------------------------------------------------
	// Header controls present
	// ---------------------------------------------------------------
	it("renders Cancel, Preview, and Save buttons", () => {
		renderWithProviders(<CycleBuilder />);
		expect(
			screen.getByRole("button", { name: /cancel/i }),
		).toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: /preview/i }),
		).toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: /save cycle/i }),
		).toBeInTheDocument();
	});

	// ---------------------------------------------------------------
	// Cycle name editing
	// ---------------------------------------------------------------
	it("allows editing the cycle name", async () => {
		const user = userEvent.setup();
		renderWithProviders(<CycleBuilder />);

		const nameInput = screen.getByDisplayValue("Untitled Cycle");
		await user.clear(nameInput);
		await user.type(nameInput, "Strength Block A");

		expect(screen.getByDisplayValue("Strength Block A")).toBeInTheDocument();
	});

	// ---------------------------------------------------------------
	// Unsaved changes indicator
	// ---------------------------------------------------------------
	it("shows unsaved indicator after editing the name", async () => {
		const user = userEvent.setup();
		renderWithProviders(<CycleBuilder />);

		const nameInput = screen.getByDisplayValue("Untitled Cycle");
		await user.type(nameInput, " v2");

		await waitFor(() => {
			expect(screen.getByText(/unsaved/i)).toBeInTheDocument();
		});
	});

	// ---------------------------------------------------------------
	// Cancel without changes navigates
	// ---------------------------------------------------------------
	it("navigates to /cycles when Cancel is clicked without changes", async () => {
		const user = userEvent.setup();
		renderWithProviders(<CycleBuilder />);

		const cancelBtn = screen.getByRole("button", { name: /cancel/i });
		await user.click(cancelBtn);

		expect(mockNavigate).toHaveBeenCalledWith("/cycles");
	});

	// ---------------------------------------------------------------
	// Cancel with changes shows dialog
	// ---------------------------------------------------------------
	it("shows unsaved changes dialog when Cancel is clicked with changes", async () => {
		const user = userEvent.setup();
		renderWithProviders(<CycleBuilder />);

		// Make a change
		const nameInput = screen.getByDisplayValue("Untitled Cycle");
		await user.type(nameInput, "x");

		const cancelBtn = screen.getByRole("button", { name: /cancel/i });
		await user.click(cancelBtn);

		await waitFor(() => {
			expect(screen.getByText(/discard changes/i)).toBeInTheDocument();
		});
	});

	// ---------------------------------------------------------------
	// Save triggers mutation
	// ---------------------------------------------------------------
	it("calls save mutation with correct payload when Save Cycle is clicked", async () => {
		const user = userEvent.setup();
		renderWithProviders(<CycleBuilder />);

		const saveBtn = screen.getByRole("button", { name: /save cycle/i });
		await user.click(saveBtn);

		expect(mockSaveMutate).toHaveBeenCalledWith(
			expect.objectContaining({
				name: "Untitled Cycle",
				duration_weeks: 7,
				days: expect.arrayContaining([
					expect.objectContaining({ day_number: 1, day_type: "workout" }),
				]),
				progression_settings: expect.objectContaining({
					type: "percentage",
				}),
			}),
			expect.any(Object),
		);
	});

	// ---------------------------------------------------------------
	// Add Day button
	// ---------------------------------------------------------------
	it("adds a new day when Add Day is clicked", async () => {
		const user = userEvent.setup();
		renderWithProviders(<CycleBuilder />);

		const addDayBtn = screen.getByRole("button", { name: /add day/i });
		await user.click(addDayBtn);

		// Day 8 appears in both the day card and the week overview
		await waitFor(() => {
			expect(screen.getAllByText("Day 8").length).toBeGreaterThanOrEqual(1);
		});
	});

	// ---------------------------------------------------------------
	// Duration quick-set buttons
	// ---------------------------------------------------------------
	it("renders quick-set duration buttons for 3-7 days", () => {
		renderWithProviders(<CycleBuilder />);
		for (const num of [3, 4, 5, 6, 7]) {
			expect(
				screen.getByRole("button", { name: String(num) }),
			).toBeInTheDocument();
		}
	});

	// ---------------------------------------------------------------
	// Description field
	// ---------------------------------------------------------------
	it("renders description textarea", () => {
		renderWithProviders(<CycleBuilder />);
		expect(
			screen.getByPlaceholderText(
				/describe your training cycle/i,
			),
		).toBeInTheDocument();
	});

	// ---------------------------------------------------------------
	// Loading state when editing
	// ---------------------------------------------------------------
	it("shows loading spinner in edit mode while cycle loads", () => {
		mockParams.current = { cycleId: "test-cycle-id" };
		renderWithProviders(<CycleBuilder />);
		expect(screen.getByText(/loading cycle/i)).toBeInTheDocument();
	});

	// ---------------------------------------------------------------
	// Preview dialog
	// ---------------------------------------------------------------
	it("opens preview dialog when Preview button is clicked", async () => {
		const user = userEvent.setup();
		renderWithProviders(<CycleBuilder />);

		const previewBtn = screen.getByRole("button", { name: /preview/i });
		await user.click(previewBtn);

		await waitFor(() => {
			// PreviewModal shows the cycle name as a heading
			expect(screen.getByText("Untitled Cycle")).toBeInTheDocument();
		});
	});

	// ---------------------------------------------------------------
	// Day card shows REST text for rest days
	// ---------------------------------------------------------------
	it("displays REST label on rest day cards", () => {
		renderWithProviders(<CycleBuilder />);
		// Default days include rest on days 3, 6, 7
		const restTexts = screen.getAllByText("REST");
		// At least 3 rest indicators (day cards + week overview)
		expect(restTexts.length).toBeGreaterThanOrEqual(3);
	});

	// ---------------------------------------------------------------
	// Start date field
	// ---------------------------------------------------------------
	it("renders optional start date field", () => {
		renderWithProviders(<CycleBuilder />);
		expect(screen.getByText(/start date/i)).toBeInTheDocument();
		expect(screen.getByText(/leave blank to start anytime/i)).toBeInTheDocument();
	});
});
