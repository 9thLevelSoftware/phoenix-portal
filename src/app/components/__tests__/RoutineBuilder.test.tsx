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

const mockCatalog = vi.hoisted(() => {
	const state = {
		exercises: [] as Array<Record<string, unknown>>,
		filters: [] as unknown[],
	};
	return {
		state,
		useExerciseCatalog: vi.fn((filters?: { includeArchived?: boolean }) => {
			state.filters.push(filters);
			return {
				data: filters?.includeArchived
					? state.exercises
					: state.exercises.filter((exercise) => !exercise.archived),
				isLoading: false,
			};
		}),
	};
});

vi.mock("@/hooks/useExerciseCatalog", () => ({
	useExerciseCatalog: mockCatalog.useExerciseCatalog,
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

function tricepPushdownCatalogRow() {
	return {
		id: "BUxuV42l6oolZVde",
		name: "Tricep Pushdown",
		display_name: "Tricep Pushdown",
		description: null,
		muscle_group: "ARMS",
		muscle_groups: ["ARMS"],
		muscles: ["triceps"],
		equipment: ["SHORT_BAR"],
		movement: "tricep_extension",
		sidedness: "bilateral",
		grip: "pronated",
		grip_width: null,
		default_cable_config: "DOUBLE",
		min_rep_range: 5,
		popularity: 0,
		aliases: [],
		thumbnail_url:
			"https://example.invalid/XMK02bqNtt76JAbEvjknvG69J01KKPVYaDp6FWOPV9La8/thumbnail.jpg",
		archived: true,
		is_custom: false,
	};
}

describe("RoutineBuilder", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockParams.current = {};
		mockCatalog.state.exercises = [];
		mockCatalog.state.filters = [];
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

	it("requests archived catalog exercises for routine creation parity with mobile", async () => {
		const user = userEvent.setup();
		renderWithProviders(<RoutineBuilder />);

		await user.click(screen.getByRole("button", { name: /add exercise/i }));

		await waitFor(() => {
			expect(mockCatalog.useExerciseCatalog).toHaveBeenCalledWith({
				includeArchived: true,
			});
		});
	});

	it("allows selecting archived catalog exercises and preserves the catalog ID in the saved routine", async () => {
		mockCatalog.state.exercises = [tricepPushdownCatalogRow()];
		const user = userEvent.setup();
		renderWithProviders(<RoutineBuilder />);

		await user.click(screen.getByRole("button", { name: /add exercise/i }));
		await user.type(
			await screen.findByPlaceholderText(/search exercises/i),
			"tricep pushdown",
		);
		await user.click(
			await screen.findByRole("button", { name: /tricep pushdown/i }),
		);
		await user.click(screen.getByRole("button", { name: /save routine/i }));

		expect(mockSaveMutate).toHaveBeenCalledWith(
			expect.objectContaining({
				exercises: [
					expect.objectContaining({
						name: "Tricep Pushdown",
						muscle_group: "ARMS",
						exercise_id: "BUxuV42l6oolZVde",
					}),
				],
			}),
			expect.any(Object),
		);
	});

	it("renders a demo thumbnail affordance for catalog exercises with media", async () => {
		mockCatalog.state.exercises = [tricepPushdownCatalogRow()];
		const user = userEvent.setup();
		renderWithProviders(<RoutineBuilder />);

		await user.click(screen.getByRole("button", { name: /add exercise/i }));

		expect(
			await screen.findByRole("img", {
				name: /demo preview for tricep pushdown/i,
			}),
		).toHaveAttribute(
			"src",
			"https://example.invalid/XMK02bqNtt76JAbEvjknvG69J01KKPVYaDp6FWOPV9La8/thumbnail.jpg",
		);
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
