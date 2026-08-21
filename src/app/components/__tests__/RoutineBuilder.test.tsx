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
const mockToast = vi.hoisted(() => ({
	success: vi.fn(),
	error: vi.fn(),
}));
vi.mock("sonner", () => ({
	toast: mockToast,
}));

function tricepPushdownCatalogRow() {
	return {
		id: "Triceps_Pushdown",
		name: "Triceps Pushdown",
		display_name: "Triceps Pushdown",
		description: null,
		muscle_group: "ARMS",
		muscle_groups: ["ARMS"],
		muscles: ["triceps"],
		equipment: ["CABLE"],
		movement: "strength",
		sidedness: "bilateral",
		grip: null,
		grip_width: null,
		default_cable_config: "EITHER",
		min_rep_range: 5,
		popularity: 0,
		aliases: [],
		thumbnail_url:
			"https://ilzlswmatadlnsuxatcv.supabase.co/storage/v1/object/public/exercise-media/Triceps_Pushdown/0.jpg",
		archived: false,
		is_custom: false,
		source: "free-exercise-db",
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

	it("requests the active catalog for routine creation", async () => {
		const user = userEvent.setup();
		renderWithProviders(<RoutineBuilder />);

		await user.click(screen.getByRole("button", { name: /add exercise/i }));

		await waitFor(() => {
			expect(mockCatalog.useExerciseCatalog).toHaveBeenCalledWith();
		});
	});

	it("allows selecting catalog exercises and preserves the catalog ID in the saved routine", async () => {
		mockCatalog.state.exercises = [tricepPushdownCatalogRow()];
		const user = userEvent.setup();
		renderWithProviders(<RoutineBuilder />);

		await user.click(screen.getByRole("button", { name: /add exercise/i }));
		await user.type(
			await screen.findByPlaceholderText(/search exercises/i),
			"triceps pushdown",
		);
		await user.click(
			await screen.findByRole("button", { name: /triceps pushdown/i }),
		);
		await user.click(screen.getByRole("button", { name: /save routine/i }));

		expect(mockSaveMutate).toHaveBeenCalledWith(
			expect.objectContaining({
				exercises: [
					expect.objectContaining({
						name: "Triceps Pushdown",
						muscle_group: "ARMS",
						exercise_id: "Triceps_Pushdown",
						drop_set_enabled: false,
						drop_set_min_weight_kg: null,
					}),
				],
			}),
			expect.any(Object),
		);
	});

	it("shows drop-set settings for Old School exercises and keeps them off Echo", async () => {
		mockCatalog.state.exercises = [tricepPushdownCatalogRow()];
		const user = userEvent.setup();
		renderWithProviders(<RoutineBuilder />);

		await user.click(screen.getByRole("button", { name: /add exercise/i }));
		await user.click(
			await screen.findByRole("button", { name: /triceps pushdown/i }),
		);
		await user.click(screen.getByRole("button", { name: /edit exercise/i }));

		expect(
			screen.getByText(/offer drop set after failure/i),
		).toBeInTheDocument();

		await user.selectOptions(screen.getByDisplayValue("Old School"), "Echo");
		expect(
			screen.queryByText(/offer drop set after failure/i),
		).not.toBeInTheDocument();
	});

	it("blocks save when drop set is enabled without a minimum weight", async () => {
		mockCatalog.state.exercises = [tricepPushdownCatalogRow()];
		const user = userEvent.setup();
		renderWithProviders(<RoutineBuilder />);

		await user.click(screen.getByRole("button", { name: /add exercise/i }));
		await user.click(
			await screen.findByRole("button", { name: /triceps pushdown/i }),
		);
		await user.click(screen.getByRole("button", { name: /edit exercise/i }));
		await user.click(
			screen.getByRole("switch", { name: /offer drop set after failure/i }),
		);
		await user.click(screen.getByRole("button", { name: /save routine/i }));

		expect(mockToast.error).toHaveBeenCalled();
		expect(mockSaveMutate).not.toHaveBeenCalled();
	});

	it("blocks save when drop set is enabled without a floor after switching to Echo", async () => {
		mockCatalog.state.exercises = [tricepPushdownCatalogRow()];
		const user = userEvent.setup();
		renderWithProviders(<RoutineBuilder />);

		await user.click(screen.getByRole("button", { name: /add exercise/i }));
		await user.click(
			await screen.findByRole("button", { name: /triceps pushdown/i }),
		);
		await user.click(screen.getByRole("button", { name: /edit exercise/i }));
		await user.click(
			screen.getByRole("switch", { name: /offer drop set after failure/i }),
		);
		await user.selectOptions(screen.getByDisplayValue("Old School"), "Echo");
		expect(
			screen.queryByText(/offer drop set after failure/i),
		).not.toBeInTheDocument();

		await user.click(screen.getByRole("button", { name: /save routine/i }));

		expect(mockToast.error).toHaveBeenCalled();
		expect(mockSaveMutate).not.toHaveBeenCalled();
	});

	it("keeps stored drop-set values when switching to Echo with a valid floor", async () => {
		mockCatalog.state.exercises = [tricepPushdownCatalogRow()];
		const user = userEvent.setup();
		renderWithProviders(<RoutineBuilder />);

		await user.click(screen.getByRole("button", { name: /add exercise/i }));
		await user.click(
			await screen.findByRole("button", { name: /triceps pushdown/i }),
		);
		await user.click(screen.getByRole("button", { name: /edit exercise/i }));
		await user.click(
			screen.getByRole("switch", { name: /offer drop set after failure/i }),
		);
		const minWeightInput = screen.getAllByPlaceholderText("20").at(-1);
		expect(minWeightInput).toBeDefined();
		await user.type(minWeightInput as HTMLElement, "15");
		await user.selectOptions(screen.getByDisplayValue("Old School"), "Echo");
		await user.click(screen.getByRole("button", { name: /save routine/i }));

		expect(mockToast.error).not.toHaveBeenCalled();
		expect(mockSaveMutate).toHaveBeenCalledWith(
			expect.objectContaining({
				exercises: [
					expect.objectContaining({
						mode: "Echo",
						drop_set_enabled: true,
						drop_set_min_weight_kg: 15,
					}),
				],
			}),
			expect.any(Object),
		);
	});

	it("blocks save when drop set is enabled without a floor after switching to bodyweight", async () => {
		mockCatalog.state.exercises = [tricepPushdownCatalogRow()];
		const user = userEvent.setup();
		renderWithProviders(<RoutineBuilder />);

		await user.click(screen.getByRole("button", { name: /add exercise/i }));
		await user.click(
			await screen.findByRole("button", { name: /triceps pushdown/i }),
		);
		await user.click(screen.getByRole("button", { name: /edit exercise/i }));
		await user.click(
			screen.getByRole("switch", { name: /offer drop set after failure/i }),
		);
		await user.click(screen.getByRole("switch", { name: /bodyweight/i }));
		expect(
			screen.queryByText(/offer drop set after failure/i),
		).not.toBeInTheDocument();

		await user.click(screen.getByRole("button", { name: /save routine/i }));

		expect(mockToast.error).toHaveBeenCalled();
		expect(mockSaveMutate).not.toHaveBeenCalled();
	});

	it("renders a demo thumbnail affordance for catalog exercises with media", async () => {
		mockCatalog.state.exercises = [tricepPushdownCatalogRow()];
		const user = userEvent.setup();
		renderWithProviders(<RoutineBuilder />);

		await user.click(screen.getByRole("button", { name: /add exercise/i }));

		expect(
			await screen.findByRole("img", {
				name: /demo preview for triceps pushdown/i,
			}),
		).toHaveAttribute(
			"src",
			"https://ilzlswmatadlnsuxatcv.supabase.co/storage/v1/object/public/exercise-media/Triceps_Pushdown/0.jpg",
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
