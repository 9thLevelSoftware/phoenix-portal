import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/test-utils";
import {
	ECCENTRIC_LOADS,
	ECHO_LEVELS,
	REP_COUNT_TIMINGS,
	WIRE_MODE_LABELS,
	WIRE_MODES,
} from "../../../../supabase/functions/_shared/workoutModes.ts";
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
const mockRoutineDetail = vi.hoisted(() => ({
	current: null as Record<string, unknown> | null,
}));
vi.mock("@/lib/supabase", () => ({
	supabase: {
		from: () => ({
			select: () => ({
				eq: () => ({
					maybeSingle: () => Promise.resolve({ data: null, error: null }),
					// routineDetailOptions chains .order(...).single()
					order: () =>
						Object.assign(Promise.resolve({ data: [], error: null }), {
							single: () =>
								Promise.resolve(
									mockRoutineDetail.current
										? { data: mockRoutineDetail.current, error: null }
										: { data: null, error: { message: "not found" } },
								),
						}),
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

function mockStoredRoutine(
	mode: string,
	exerciseOverrides: Record<string, unknown> = {},
) {
	mockParams.current = { routineId: "11111111-1111-4111-8111-111111111111" };
	mockRoutineDetail.current = {
		id: "11111111-1111-4111-8111-111111111111",
		user_id: "22222222-2222-4222-8222-222222222222",
		name: "Stored Routine",
		description: "",
		exercise_count: 1,
		estimated_duration: 600,
		times_completed: 0,
		last_used_at: null,
		tags: null,
		is_favorite: false,
		routine_exercises: [
			{
				id: "33333333-3333-4333-8333-333333333333",
				routine_id: "11111111-1111-4111-8111-111111111111",
				name: "Triceps Pushdown",
				muscle_group: "ARMS",
				exercise_id: null,
				sets: 3,
				reps: 10,
				weight: 10,
				rest_seconds: 90,
				mode,
				order_index: 0,
				created_at: "2026-09-01T00:00:00.000Z",
				...exerciseOverrides,
			},
		],
	};
}

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
		mockRoutineDetail.current = null;
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

	it("labels builder weights per cable, with the total hint and no numeric total", async () => {
		mockCatalog.state.exercises = [tricepPushdownCatalogRow()];
		const user = userEvent.setup();
		renderWithProviders(<RoutineBuilder />);

		await user.click(screen.getByRole("button", { name: /add exercise/i }));
		await user.click(
			await screen.findByRole("button", { name: /triceps pushdown/i }),
		);
		await user.click(screen.getByRole("button", { name: /edit exercise/i }));

		expect(screen.getAllByText("Weight per cable (kg)").length).toBeGreaterThan(
			0,
		);
		expect(screen.getByTestId("per-cable-weight-hint")).toHaveTextContent(
			"Weights are per cable, as on the phone. Total load = per-cable weight × cables in use.",
		);
		await user.click(
			screen.getByRole("switch", { name: /offer drop set after failure/i }),
		);
		expect(
			screen.getByText("Minimum weight per cable (kg)"),
		).toBeInTheDocument();
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
						mode: "ECHO",
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
	// ---------------------------------------------------------------
	// Training mode wire contract (mobile only accepts wire names)
	// ---------------------------------------------------------------
	it("offers every training mode with a wire-name value and display label", async () => {
		mockCatalog.state.exercises = [tricepPushdownCatalogRow()];
		const user = userEvent.setup();
		renderWithProviders(<RoutineBuilder />);

		await user.click(screen.getByRole("button", { name: /add exercise/i }));
		await user.click(
			await screen.findByRole("button", { name: /triceps pushdown/i }),
		);
		await user.click(screen.getByRole("button", { name: /edit exercise/i }));

		const select = screen.getByDisplayValue("Old School") as HTMLSelectElement;
		expect(
			Array.from(select.options).map((option) => [
				option.value,
				option.textContent,
			]),
		).toEqual(WIRE_MODES.map((wire) => [wire, WIRE_MODE_LABELS[wire]]));

		// New exercises default to the wire name. (select.value alone can't
		// prove this: an unmatched controlled value reports the first option.)
		await user.click(screen.getByRole("button", { name: /save routine/i }));
		expect(mockSaveMutate).toHaveBeenCalledWith(
			expect.objectContaining({
				exercises: [expect.objectContaining({ mode: "OLD_SCHOOL" })],
			}),
			expect.any(Object),
		);
	});

	it("renders a stored wire mode as its display option", async () => {
		mockStoredRoutine("ECHO");
		const user = userEvent.setup();
		renderWithProviders(<RoutineBuilder />);

		await user.click(
			await screen.findByRole("button", { name: /edit exercise/i }),
		);

		const select = screen.getByDisplayValue("Echo") as HTMLSelectElement;
		expect(select.value).toBe("ECHO");
		expect(
			screen.getByText("Alternating intensity echo sets"),
		).toBeInTheDocument();
	});

	it("keeps an unknown stored mode verbatim and warns instead of converting it", async () => {
		mockStoredRoutine("FUTURE_MODE");
		const user = userEvent.setup();
		renderWithProviders(<RoutineBuilder />);

		await user.click(
			await screen.findByRole("button", { name: /edit exercise/i }),
		);

		const select = screen.getByDisplayValue(
			"FUTURE_MODE (unsupported)",
		) as HTMLSelectElement;
		expect(select.value).toBe("FUTURE_MODE");
		expect(
			screen.getByText(/isn't supported by the portal/i),
		).toBeInTheDocument();

		await user.click(screen.getByRole("button", { name: /save routine/i }));

		expect(mockToast.error).not.toHaveBeenCalled();
		expect(mockUpdateMutate).toHaveBeenCalledWith(
			expect.objectContaining({
				exercises: [expect.objectContaining({ mode: "FUTURE_MODE" })],
				preservedModes: ["FUTURE_MODE"],
			}),
			expect.any(Object),
		);
	});

	// ---------------------------------------------------------------
	// Advanced settings use mobile's vocabulary (Models.kt enums)
	// ---------------------------------------------------------------
	const optionValues = (label: string) =>
		Array.from(
			(screen.getByRole("combobox", { name: label }) as HTMLSelectElement)
				.options,
		).map((option) => option.value);

	it("offers advanced settings as mobile's enum names and saves them", async () => {
		mockCatalog.state.exercises = [tricepPushdownCatalogRow()];
		const user = userEvent.setup();
		renderWithProviders(<RoutineBuilder />);

		await user.click(screen.getByRole("button", { name: /add exercise/i }));
		await user.click(
			await screen.findByRole("button", { name: /triceps pushdown/i }),
		);
		await user.click(screen.getByRole("button", { name: /edit exercise/i }));
		await user.click(screen.getByText("Advanced Settings"));

		// Eccentric load / echo level only apply in Echo mode on the phone.
		expect(
			screen.queryByRole("combobox", { name: "Eccentric Load" }),
		).not.toBeInTheDocument();
		expect(
			screen.queryByRole("combobox", { name: "Echo Level" }),
		).not.toBeInTheDocument();
		await user.selectOptions(screen.getByDisplayValue("Old School"), "Echo");

		// "" = unset, which mobile reads as its default.
		expect(optionValues("Eccentric Load")).toEqual(["", ...ECCENTRIC_LOADS]);
		expect(optionValues("Echo Level")).toEqual(["", ...ECHO_LEVELS]);
		expect(optionValues("Rep Count Timing")).toEqual([
			"",
			...REP_COUNT_TIMINGS,
		]);
		expect(optionValues("Stop at Position")).toEqual(["", "TOP"]);
		// No free-text inputs remain.
		expect(screen.queryByPlaceholderText("2-0-2")).not.toBeInTheDocument();
		expect(screen.queryByPlaceholderText("Lockout")).not.toBeInTheDocument();

		await user.selectOptions(
			screen.getByRole("combobox", { name: "Eccentric Load" }),
			"LOAD_120",
		);
		await user.selectOptions(
			screen.getByRole("combobox", { name: "Echo Level" }),
			"EPIC",
		);
		await user.selectOptions(
			screen.getByRole("combobox", { name: "Rep Count Timing" }),
			"BOTTOM",
		);
		await user.selectOptions(
			screen.getByRole("combobox", { name: "Stop at Position" }),
			"TOP",
		);
		await user.click(screen.getByRole("button", { name: /save routine/i }));

		expect(mockSaveMutate).toHaveBeenCalledWith(
			expect.objectContaining({
				exercises: [
					expect.objectContaining({
						eccentric_load: "LOAD_120",
						echo_level: "EPIC",
						rep_count_timing: "BOTTOM",
						stop_at_position: "TOP",
					}),
				],
			}),
			expect.any(Object),
		);
	});

	it("sends the stored exercise id back so the row survives the edit", async () => {
		// Mobile keys per-exercise rack and scaling defaults by
		// routine_exercises.id. If the builder drops the id, the update RPC
		// mints a new one and those defaults are silently reset.
		mockStoredRoutine("ECHO");
		const user = userEvent.setup();
		renderWithProviders(<RoutineBuilder />);

		await user.click(
			await screen.findByRole("button", { name: /save routine/i }),
		);

		expect(mockUpdateMutate).toHaveBeenCalledWith(
			expect.objectContaining({
				exercises: [
					expect.objectContaining({
						id: "33333333-3333-4333-8333-333333333333",
					}),
				],
			}),
			expect.any(Object),
		);
	});

	it("reads legacy portal settings as the machine default and hex colours as names", async () => {
		mockStoredRoutine("ECHO", {
			eccentric_load: "light",
			echo_level: "high",
			rep_count_timing: "2-0-2",
			stop_at_position: "Lockout",
			superset_id: "44444444-4444-4444-8444-444444444444",
			superset_color: "#F59E0B",
			superset_order: 0,
		});
		const user = userEvent.setup();
		renderWithProviders(<RoutineBuilder />);

		await user.click(
			await screen.findByRole("button", { name: /edit exercise/i }),
		);
		await user.click(screen.getByText("Advanced Settings"));

		for (const label of [
			"Eccentric Load",
			"Echo Level",
			"Rep Count Timing",
			"Stop at Position",
		]) {
			expect(
				(screen.getByRole("combobox", { name: label }) as HTMLSelectElement)
					.value,
			).toBe("");
		}

		await user.click(screen.getByRole("button", { name: /save routine/i }));
		expect(mockUpdateMutate).toHaveBeenCalledWith(
			expect.objectContaining({
				exercises: [
					expect.objectContaining({
						eccentric_load: null,
						echo_level: null,
						rep_count_timing: null,
						stop_at_position: null,
						superset_color: "amber",
					}),
				],
			}),
			expect.any(Object),
		);
	});

	it("loads mobile-authored enum settings into their options", async () => {
		mockStoredRoutine("ECHO", {
			eccentric_load: "LOAD_150",
			echo_level: "HARDEST",
			rep_count_timing: "BOTTOM",
			stop_at_position: "TOP",
		});
		const user = userEvent.setup();
		renderWithProviders(<RoutineBuilder />);

		await user.click(
			await screen.findByRole("button", { name: /edit exercise/i }),
		);
		await user.click(screen.getByText("Advanced Settings"));

		expect(
			screen.getByRole("combobox", { name: "Eccentric Load" }),
		).toHaveValue("LOAD_150");
		expect(screen.getByRole("combobox", { name: "Echo Level" })).toHaveValue(
			"HARDEST",
		);
		expect(
			screen.getByRole("combobox", { name: "Rep Count Timing" }),
		).toHaveValue("BOTTOM");
		expect(
			screen.getByRole("combobox", { name: "Stop at Position" }),
		).toHaveValue("TOP");
	});

	it("keeps an off-list eccentric load from the phone and shows what it trains as", async () => {
		mockStoredRoutine("ECHO", { eccentric_load: "LOAD_25" });
		const user = userEvent.setup();
		renderWithProviders(<RoutineBuilder />);

		await user.click(
			await screen.findByRole("button", { name: /edit exercise/i }),
		);
		await user.click(screen.getByText("Advanced Settings"));

		const select = screen.getByRole("combobox", { name: "Eccentric Load" });
		expect(select).toHaveValue("LOAD_25");
		expect(
			screen.getByRole("option", { name: "LOAD_25 (trains as 0%)" }),
		).toBeInTheDocument();

		await user.click(screen.getByRole("button", { name: /save routine/i }));
		expect(mockUpdateMutate).toHaveBeenCalledWith(
			expect.objectContaining({
				exercises: [expect.objectContaining({ eccentric_load: "LOAD_25" })],
			}),
			expect.any(Object),
		);
	});

	it("keeps hidden eccentric/echo values when the exercise is not Echo", async () => {
		mockStoredRoutine("OLD_SCHOOL", {
			eccentric_load: "LOAD_120",
			echo_level: "EPIC",
		});
		const user = userEvent.setup();
		renderWithProviders(<RoutineBuilder />);

		await user.click(
			await screen.findByRole("button", { name: /edit exercise/i }),
		);
		await user.click(screen.getByText("Advanced Settings"));
		expect(
			screen.queryByRole("combobox", { name: "Eccentric Load" }),
		).not.toBeInTheDocument();

		await user.click(screen.getByRole("button", { name: /save routine/i }));
		expect(mockUpdateMutate).toHaveBeenCalledWith(
			expect.objectContaining({
				exercises: [
					expect.objectContaining({
						eccentric_load: "LOAD_120",
						echo_level: "EPIC",
					}),
				],
			}),
			expect.any(Object),
		);
	});

	it("gives a new superset mobile's first colour name and renders its hex", async () => {
		mockCatalog.state.exercises = [tricepPushdownCatalogRow()];
		const user = userEvent.setup();
		renderWithProviders(<RoutineBuilder />);

		for (let i = 0; i < 2; i++) {
			await user.click(screen.getByRole("button", { name: /add exercise/i }));
			await user.click(
				await screen.findByRole("button", { name: /triceps pushdown/i }),
			);
		}
		await user.click(screen.getByRole("button", { name: "Create Superset" }));
		for (const name of screen.getAllByText("Triceps Pushdown")) {
			await user.click(name);
		}
		const createButtons = screen.getAllByRole("button", {
			name: "Create Superset",
		});
		await user.click(createButtons[createButtons.length - 1]);

		const group = document.querySelector<HTMLElement>(
			"[style*='border-left-width']",
		);
		expect(group?.style.borderLeftColor).toBe("rgb(99, 102, 241)"); // #6366F1

		await user.click(screen.getByRole("button", { name: /save routine/i }));
		const payload = mockSaveMutate.mock.calls[0][0] as {
			exercises: Array<{ superset_color: string | null }>;
		};
		expect(payload.exercises.map((ex) => ex.superset_color)).toEqual([
			"indigo",
			"indigo",
		]);
	});

	it("shows loading spinner in edit mode while routine loads", () => {
		mockParams.current = { routineId: "test-routine-id" };
		renderWithProviders(<RoutineBuilder />);

		expect(screen.getByText(/loading routine/i)).toBeInTheDocument();
	});
});
