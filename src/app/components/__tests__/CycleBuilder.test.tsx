import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	buildCycleProgressionSettings,
	MOBILE_PROGRESSION_KEYS,
	mobileProgressionSettingsSchema,
	readCycleProgressionSettings,
} from "@/schemas/transforms";
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
// mockCycleRow.current, when set, is what the cycle detail query
// (training_cycles .eq().order().single()) returns, for edit-mode tests.
const mockCycleRow = vi.hoisted(() => ({
	current: null as Record<string, unknown> | null,
}));
vi.mock("@/lib/supabase", () => ({
	supabase: {
		from: (table: string) => ({
			select: () => ({
				eq: () => ({
					maybeSingle: () => Promise.resolve({ data: null, error: null }),
					order: () =>
						Object.assign(Promise.resolve({ data: [], error: null }), {
							single: () =>
								Promise.resolve(
									table === "training_cycles" && mockCycleRow.current
										? { data: mockCycleRow.current, error: null }
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

// --- Sonner mock ---
vi.mock("sonner", () => ({
	toast: { success: vi.fn(), error: vi.fn() },
}));

const EDIT_CYCLE_ID = "0b000000-0000-4000-8000-000000000001";

function cycleRow(progression: unknown) {
	return {
		id: EDIT_CYCLE_ID,
		user_id: "0a000000-0000-4000-8000-000000000001",
		name: "Stored cycle",
		description: "",
		duration_weeks: 4,
		current_week: 1,
		status: "draft",
		workout_days: 1,
		rest_days: 0,
		started_at: null,
		last_used_at: null,
		progression_settings: progression,
		deload_settings: null,
		cycle_days: [
			{
				id: "0c000000-0000-4000-8000-000000000001",
				cycle_id: EDIT_CYCLE_ID,
				day_number: 1,
				day_type: "workout",
				routine_id: null,
				weight_adjustment: 0,
				rep_modifier: 0,
				rest_override: null,
				notes: null,
				rest_type: null,
			},
		],
	};
}

/** Mirrors mobile: pull JSON.stringify's the jsonb, the phone decodes it as
 * Map<String, String>. */
function expectMobileDecodable(ps: unknown) {
	for (const value of Object.values(ps as Record<string, unknown>)) {
		expect(typeof value).toBe("string");
	}
	expect(
		mobileProgressionSettingsSchema.safeParse(JSON.parse(JSON.stringify(ps)))
			.success,
	).toBe(true);
}

describe("CycleBuilder", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockParams.current = {};
		mockCycleRow.current = null;
	});

	// ---------------------------------------------------------------
	// Smoke test
	// ---------------------------------------------------------------
	it("renders without crashing in create mode", () => {
		renderWithProviders(<CycleBuilder />);
		expect(screen.getByDisplayValue("Untitled Cycle")).toBeInTheDocument();
	});

	it("associates the cycle name label with its input", () => {
		renderWithProviders(<CycleBuilder />);
		expect(screen.getByLabelText("Cycle name")).toHaveAttribute(
			"id",
			"cycle-name",
		);
	});

	// ---------------------------------------------------------------
	// Default UI layout
	// ---------------------------------------------------------------
	it("renders Cycle Details section with duration input", () => {
		renderWithProviders(<CycleBuilder />);
		expect(screen.getByText(/cycle details/i)).toBeInTheDocument();
		// Cycle length now defaults to 4 WEEKS (was conflated with the 7-day template).
		expect(screen.getByText(/cycle length \(weeks\)/i)).toBeInTheDocument();
		expect(screen.getAllByDisplayValue("4").length).toBeGreaterThanOrEqual(1);
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
		expect(screen.getByRole("button", { name: /cancel/i })).toBeInTheDocument();
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
				duration_weeks: 4,
				days: expect.arrayContaining([
					expect.objectContaining({ day_number: 1, day_type: "workout" }),
				]),
				progression_settings: expect.objectContaining({
					type: "manual",
				}),
			}),
			expect.any(Object),
		);
	});

	// ---------------------------------------------------------------
	// Progression settings use mobile's Map<String, String> schema
	// ---------------------------------------------------------------
	it("untouched defaults save string values and inject no mobile key", async () => {
		const user = userEvent.setup();
		renderWithProviders(<CycleBuilder />);

		await user.click(screen.getByRole("button", { name: /save cycle/i }));

		const ps = mockSaveMutate.mock.calls[0][0].progression_settings;
		expect(ps).toEqual({
			type: "manual",
			amount: "2.5",
			frequency: "2",
			trigger: "target_rpe",
			upperIncrement: "2.5",
			lowerIncrement: "5",
		});
		expectMobileDecodable(ps);
	});

	it("labels frequency in cycles, writes it as an integer string, caps at 10", async () => {
		const user = userEvent.setup();
		renderWithProviders(<CycleBuilder />);

		const input = screen.getByLabelText(/progress every n cycles/i);
		expect(
			screen.getByText(/after every n completed runs through the cycle/i),
		).toBeInTheDocument();
		fireEvent.change(input, { target: { value: "3" } });
		await user.click(screen.getByRole("button", { name: /save cycle/i }));
		expect(mockSaveMutate.mock.calls[0][0].progression_settings).toMatchObject({
			frequencyCycles: "3",
		});

		fireEvent.change(input, { target: { value: "15" } });
		await user.click(screen.getByRole("button", { name: /save cycle/i }));
		const ps = mockSaveMutate.mock.calls[1][0].progression_settings;
		expect(ps.frequencyCycles).toBe("10");
		expect(ps).not.toHaveProperty("weightIncreasePercent");
		expectMobileDecodable(ps);
	});

	// ---------------------------------------------------------------
	// Edit path: load a stored cycle, save, check the mobile keys
	// ---------------------------------------------------------------
	describe("edit path", () => {
		const renderEditing = async (progression: unknown) => {
			mockParams.current = { cycleId: EDIT_CYCLE_ID };
			mockCycleRow.current = cycleRow(progression);
			const user = userEvent.setup();
			renderWithProviders(<CycleBuilder />);
			await screen.findByDisplayValue("Stored cycle");
			return user;
		};
		const saveAndGetProgression = async (
			user: ReturnType<typeof userEvent.setup>,
		) => {
			await user.click(screen.getByRole("button", { name: /save cycle/i }));
			expect(mockUpdateMutate).toHaveBeenCalledTimes(1);
			const ps = mockUpdateMutate.mock.calls[0][0].progression_settings;
			expectMobileDecodable(ps);
			return ps as Record<string, string>;
		};

		it("a rename keeps every phone key and injects nothing", async () => {
			const user = await renderEditing({
				type: "percentage",
				amount: "3",
				frequency: "1",
				frequencyCycles: "2",
				weightIncreasePercent: "1.5",
				echoLevelIncrease: "true",
				eccentricLoadIncreasePercent: "10",
			});
			// Phone values win on screen.
			expect(screen.getByLabelText(/progress every n cycles/i)).toHaveValue(2);
			expect(screen.getByLabelText(/increase \(%\)/i)).toHaveValue(1.5);

			await user.type(screen.getByDisplayValue("Stored cycle"), " renamed");
			const ps = await saveAndGetProgression(user);
			expect(ps).toMatchObject({
				frequencyCycles: "2",
				weightIncreasePercent: "1.5",
				echoLevelIncrease: "true",
				eccentricLoadIncreasePercent: "10",
			});
		});

		it("does not resurrect a weight increase the phone switched off", async () => {
			// Portal set 3%; the phone later turned weight off (push removed
			// weightIncreasePercent, kept the portal keys).
			const user = await renderEditing({
				type: "percentage",
				amount: "3",
				frequency: "1",
				frequencyCycles: "2",
			});
			expect(screen.queryByLabelText(/increase \(%\)/i)).toBeNull();

			const ps = await saveAndGetProgression(user);
			expect(ps).not.toHaveProperty("weightIncreasePercent");
			expect(ps.frequencyCycles).toBe("2");
		});

		it("injects no mobile key into a cycle with no progression", async () => {
			const user = await renderEditing(null);
			const ps = await saveAndGetProgression(user);
			for (const key of MOBILE_PROGRESSION_KEYS) {
				expect(ps).not.toHaveProperty(key);
			}
		});

		it("writes weightIncreasePercent when the user changes the increase", async () => {
			const user = await renderEditing({
				type: "percentage",
				amount: "2.5",
				frequency: "1",
				frequencyCycles: "3",
				weightIncreasePercent: "2.5",
			});
			fireEvent.change(screen.getByLabelText(/increase \(%\)/i), {
				target: { value: "4" },
			});
			const ps = await saveAndGetProgression(user);
			expect(ps).toMatchObject({
				type: "percentage",
				amount: "4",
				weightIncreasePercent: "4",
				frequencyCycles: "3",
			});
		});
	});

	// ---------------------------------------------------------------
	// Deload is a portal-only planning aid
	// ---------------------------------------------------------------
	it("leaves deload off by default and labels it portal-only", async () => {
		const user = userEvent.setup();
		renderWithProviders(<CycleBuilder />);

		expect(
			screen.getByText(/planning aid — not applied on the machine yet/i),
		).toBeInTheDocument();

		await user.click(screen.getByRole("button", { name: /save cycle/i }));
		expect(mockSaveMutate.mock.calls[0][0].deload_settings).toBeNull();
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
	it("renders quick-set cycle-length buttons (weeks)", () => {
		renderWithProviders(<CycleBuilder />);
		for (const num of [4, 6, 8, 12, 16]) {
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
			screen.getByPlaceholderText(/describe your training cycle/i),
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
		expect(
			screen.getByText(/leave blank to start anytime/i),
		).toBeInTheDocument();
	});
});

// -------------------------------------------------------------------
// Decoder contract with mobile (Project-Phoenix-MP
// SqlDelightSyncRepository.mergePortalCycles decodes progressionSettings as
// Map<String, String> with a non-lenient Json; PortalSyncAdapter encodes it
// sparsely with string values).
// -------------------------------------------------------------------
describe("cycle progression settings wire contract", () => {
	// What PortalSyncAdapter.toPortalTrainingCycle emits.
	const KOTLIN_FIXTURE =
		'{"frequencyCycles":"3","weightIncreasePercent":"2.5","echoLevelIncrease":"true","eccentricLoadIncreasePercent":"10"}';

	it("parses the Kotlin-encoded fixture as Record<string, string>", () => {
		const parsed = mobileProgressionSettingsSchema.parse(
			JSON.parse(KOTLIN_FIXTURE),
		);
		expect(Object.keys(parsed).sort()).toEqual(
			[...MOBILE_PROGRESSION_KEYS].sort(),
		);
	});

	it("rejects non-string values, which mobile's decoder also rejects", () => {
		expect(
			mobileProgressionSettingsSchema.safeParse({ amount: 2.5 }).success,
		).toBe(false);
		expect(
			mobileProgressionSettingsSchema.safeParse({ echoLevelIncrease: true })
				.success,
		).toBe(false);
		expect(
			mobileProgressionSettingsSchema.safeParse({ frequency: null }).success,
		).toBe(false);
	});

	const FORM = {
		type: "percentage" as const,
		amount: 2.5,
		frequency: 2,
		trigger: "all_sets" as const,
		upperIncrement: 2.5,
		lowerIncrement: 5,
	};
	const UNTOUCHED = { weight: false, frequency: false };

	it("untouched builder output passes every stored mobile key through", () => {
		const built = buildCycleProgressionSettings(
			{ ...FORM, type: "fixed", amount: 5, frequency: 7 },
			JSON.parse(KOTLIN_FIXTURE),
			UNTOUCHED,
		);
		expect(
			mobileProgressionSettingsSchema.parse(JSON.parse(JSON.stringify(built))),
		).toEqual({
			type: "fixed",
			amount: "5",
			frequency: "7",
			trigger: "all_sets",
			upperIncrement: "2.5",
			lowerIncrement: "5",
			frequencyCycles: "3",
			weightIncreasePercent: "2.5",
			echoLevelIncrease: "true",
			eccentricLoadIncreasePercent: "10",
		});
	});

	it("untouched builder output injects no mobile key", () => {
		const built = buildCycleProgressionSettings(FORM, null, UNTOUCHED);
		for (const key of MOBILE_PROGRESSION_KEYS) {
			expect(built).not.toHaveProperty(key);
		}
	});

	it("a touched frequency is an integer string clamped to 1-10", () => {
		const freq = (frequency: number) =>
			buildCycleProgressionSettings({ ...FORM, frequency }, null, {
				weight: false,
				frequency: true,
			}).frequencyCycles;
		expect(freq(2.6)).toBe("3");
		expect(freq(0)).toBe("1");
		expect(freq(-4)).toBe("1");
		expect(freq(12)).toBe("10");
		expect(freq(Number.NaN)).toBe("1");
	});

	it("a touched weight control writes or removes weightIncreasePercent", () => {
		const touched = { weight: true, frequency: false };
		expect(
			buildCycleProgressionSettings(
				{ ...FORM, amount: 4 },
				{ weightIncreasePercent: "2.5" },
				touched,
			).weightIncreasePercent,
		).toBe("4");
		for (const type of ["fixed", "manual"] as const) {
			expect(
				buildCycleProgressionSettings(
					{ ...FORM, type },
					{ weightIncreasePercent: "2.5", frequencyCycles: "2" },
					touched,
				),
			).not.toHaveProperty("weightIncreasePercent");
		}
	});

	it("a phone-cleared weight increase rebuilds without weightIncreasePercent", () => {
		const stored = {
			type: "percentage",
			amount: "3",
			frequency: "1",
			frequencyCycles: "2",
		};
		const read = readCycleProgressionSettings(stored);
		expect(read).toEqual({ type: "manual", amount: 3, frequency: 2 });
		const built = buildCycleProgressionSettings(
			{ ...FORM, ...read },
			stored,
			UNTOUCHED,
		);
		expect(built).not.toHaveProperty("weightIncreasePercent");
		expect(built.frequencyCycles).toBe("2");
	});

	it("reads mobile-only, string, and legacy numeric settings", () => {
		expect(readCycleProgressionSettings(JSON.parse(KOTLIN_FIXTURE))).toEqual({
			type: "percentage",
			amount: 2.5,
			frequency: 3,
		});
		expect(
			readCycleProgressionSettings({
				type: "fixed",
				amount: "5",
				frequency: "2",
				trigger: "all_sets",
				upperIncrement: "2.5",
				lowerIncrement: "5",
			}),
		).toEqual({
			type: "fixed",
			amount: 5,
			frequency: 2,
			trigger: "all_sets",
			upperIncrement: 2.5,
			lowerIncrement: 5,
		});
		expect(
			readCycleProgressionSettings({
				type: "percentage",
				amount: 3,
				frequency: 1,
			}),
		).toEqual({ type: "percentage", amount: 3, frequency: 1 });
	});

	it("prefers mobile keys a phone pushed over stale portal keys", () => {
		// Portal set 3% every cycle; the phone later changed it to 1.5% every
		// 2 cycles (the push rewrote only the mobile keys).
		expect(
			readCycleProgressionSettings({
				type: "percentage",
				amount: "3",
				frequency: "1",
				frequencyCycles: "2",
				weightIncreasePercent: "1.5",
			}),
		).toEqual({ type: "percentage", amount: 1.5, frequency: 2 });
	});
});
