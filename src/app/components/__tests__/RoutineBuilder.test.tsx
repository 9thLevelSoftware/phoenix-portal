import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/test-utils";
import { RoutineBuilder } from "../RoutineBuilder";

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
const mockParams = vi.hoisted(() => ({
	current: {} as Record<string, string>,
}));
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
vi.mock("@/mutations/routines", () => ({
	useSaveRoutine: () => ({
		mutate: mockSaveMutate,
		isPending: false,
	}),
	useUpdateRoutine: () => ({
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

// --- DnD Kit mock (avoid DOM measurement issues in jsdom) ---
vi.mock("@dnd-kit/react", () => ({
	DragDropProvider: ({ children }: { children: React.ReactNode }) => (
		<div>{children}</div>
	),
}));
vi.mock("@dnd-kit/react/sortable", () => ({
	useSortable: () => ({
		ref: { current: null },
		handleRef: vi.fn(),
		isDragging: false,
	}),
}));
vi.mock("@dnd-kit/helpers", () => ({
	move: vi.fn((items: unknown[]) => items),
}));

// --- Sonner mock ---
vi.mock("sonner", () => ({
	toast: { success: vi.fn(), error: vi.fn() },
}));

describe("RoutineBuilder", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockParams.current = {};
	});

	// ---------------------------------------------------------------
	// Smoke test
	// ---------------------------------------------------------------
	it("renders without crashing in create mode", () => {
		renderWithProviders(<RoutineBuilder />);
		// Should show the default routine name
		expect(screen.getByDisplayValue("Untitled Routine")).toBeInTheDocument();
	});

	// ---------------------------------------------------------------
	// Default empty state
	// ---------------------------------------------------------------
	it("shows empty state with 0 exercises and Add Exercise button", () => {
		renderWithProviders(<RoutineBuilder />);
		expect(screen.getByText(/0 exercises/)).toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: /add exercise/i }),
		).toBeInTheDocument();
	});

	// ---------------------------------------------------------------
	// Header controls present
	// ---------------------------------------------------------------
	it("renders Cancel, Preview, and Save buttons", () => {
		renderWithProviders(<RoutineBuilder />);
		expect(screen.getByRole("button", { name: /cancel/i })).toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: /preview/i }),
		).toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: /save routine/i }),
		).toBeInTheDocument();
	});

	// ---------------------------------------------------------------
	// Routine name editing
	// ---------------------------------------------------------------
	it("allows editing the routine name", async () => {
		const user = userEvent.setup();
		renderWithProviders(<RoutineBuilder />);

		const nameInput = screen.getByDisplayValue("Untitled Routine");
		await user.clear(nameInput);
		await user.type(nameInput, "Push Day");

		expect(screen.getByDisplayValue("Push Day")).toBeInTheDocument();
	});

	// ---------------------------------------------------------------
	// Unsaved changes indicator
	// ---------------------------------------------------------------
	it("shows unsaved changes indicator after editing the name", async () => {
		const user = userEvent.setup();
		renderWithProviders(<RoutineBuilder />);

		const nameInput = screen.getByDisplayValue("Untitled Routine");
		await user.type(nameInput, " v2");

		await waitFor(() => {
			expect(screen.getByText(/unsaved changes/i)).toBeInTheDocument();
		});
	});

	// ---------------------------------------------------------------
	// Cancel without changes navigates immediately
	// ---------------------------------------------------------------
	it("navigates to /routines when Cancel is clicked without changes", async () => {
		const user = userEvent.setup();
		renderWithProviders(<RoutineBuilder />);

		const cancelBtn = screen.getByRole("button", { name: /cancel/i });
		await user.click(cancelBtn);

		expect(mockNavigate).toHaveBeenCalledWith("/routines");
	});

	// ---------------------------------------------------------------
	// Cancel with changes shows unsaved dialog
	// ---------------------------------------------------------------
	it("shows unsaved changes dialog when Cancel is clicked with changes", async () => {
		const user = userEvent.setup();
		renderWithProviders(<RoutineBuilder />);

		// Make a change
		const nameInput = screen.getByDisplayValue("Untitled Routine");
		await user.type(nameInput, "x");

		// Click cancel
		const cancelBtn = screen.getByRole("button", { name: /cancel|back/i });
		await user.click(cancelBtn);

		await waitFor(() => {
			expect(screen.getByText(/discard changes/i)).toBeInTheDocument();
		});
	});

	// ---------------------------------------------------------------
	// Save triggers mutation in create mode
	// ---------------------------------------------------------------
	it("calls save mutation when Save Routine is clicked", async () => {
		const user = userEvent.setup();
		renderWithProviders(<RoutineBuilder />);

		const saveBtn = screen.getByRole("button", { name: /save routine/i });
		await user.click(saveBtn);

		expect(mockSaveMutate).toHaveBeenCalledWith(
			expect.objectContaining({
				name: "Untitled Routine",
				exercises: [],
			}),
			expect.any(Object),
		);
	});

	// ---------------------------------------------------------------
	// Add Exercise opens picker modal
	// ---------------------------------------------------------------
	it("opens exercise picker when Add Exercise button is clicked", async () => {
		const user = userEvent.setup();
		renderWithProviders(<RoutineBuilder />);

		const addBtn = screen.getByRole("button", { name: /add exercise/i });
		await user.click(addBtn);

		// Exercise picker modal should show the search input or exercise library
		await waitFor(() => {
			expect(screen.getByPlaceholderText(/search/i)).toBeInTheDocument();
		});
	});

	// ---------------------------------------------------------------
	// Superset button visibility
	// ---------------------------------------------------------------
	it("does not show Create Superset button when fewer than 2 exercises", () => {
		renderWithProviders(<RoutineBuilder />);
		expect(
			screen.queryByRole("button", { name: /create superset/i }),
		).not.toBeInTheDocument();
	});

	// ---------------------------------------------------------------
	// Empty detail panel
	// ---------------------------------------------------------------
	it("shows empty detail panel when no exercise is selected", () => {
		renderWithProviders(<RoutineBuilder />);
		// The EmptyDetailPanel renders instructions
		expect(screen.getByText(/select an exercise/i)).toBeInTheDocument();
	});

	// ---------------------------------------------------------------
	// Preview dialog
	// ---------------------------------------------------------------
	it("opens preview dialog showing routine summary", async () => {
		const user = userEvent.setup();
		renderWithProviders(<RoutineBuilder />);

		const previewBtn = screen.getByRole("button", { name: /preview/i });
		await user.click(previewBtn);

		await waitFor(() => {
			expect(screen.getByText(/routine summary/i)).toBeInTheDocument();
		});
	});

	// ---------------------------------------------------------------
	// Loading state when editing
	// ---------------------------------------------------------------
	it("shows loading spinner in edit mode while routine loads", () => {
		mockParams.current = { routineId: "test-routine-id" };
		renderWithProviders(<RoutineBuilder />);

		expect(screen.getByText(/loading routine/i)).toBeInTheDocument();
	});
});
