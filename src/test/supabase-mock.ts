import { vi } from "vitest";

/**
 * Creates a realistic Supabase mock that validates method call order
 * and returns proper chainable objects, unlike the overly permissive
 * buildChain() helper that returns the same object for all methods.
 */
export function createSupabaseMock() {
	const mockData: Record<string, unknown> = {};
	const mockErrors: Record<string, Error | null> = {};

	function resolveResult(tableName: string) {
		return Promise.resolve({
			data: mockData[tableName] ?? null,
			error: mockErrors[tableName] ?? null,
		});
	}

	function createAwaitable<T extends object>(tableName: string, chain: T) {
		return Object.assign(resolveResult(tableName), chain);
	}

	/**
	 * Set the mock data/error for a specific table/query
	 */
	function setMockResult(
		table: string,
		data: unknown,
		error: Error | null = null,
	) {
		mockData[table] = data;
		mockErrors[table] = error;
	}

	/**
	 * Create a query builder for a specific table with proper chain validation
	 */
	function createQueryBuilder(table: string) {
		let _currentFilter: string | null = null;
		let _selectFields = "*";

		return {
			select: vi.fn((fields = "*") => {
				_selectFields = fields;
				return createChainable(table);
			}),
			insert: vi.fn((data: unknown) => ({
				select: vi.fn(() => Promise.resolve({ data, error: null })),
			})),
			upsert: vi.fn((data: unknown) => ({
				select: vi.fn(() => Promise.resolve({ data, error: null })),
			})),
			update: vi.fn((data: unknown) => createFilteredChainable(table, data)),
			delete: vi.fn(() => createFilteredChainable(table, null)),
		};

		function createChainable(tableName: string) {
			const chain = {
				eq: vi.fn((column: string, value: unknown) => {
					_currentFilter = `${column}=${value}`;
					return createChainable(tableName);
				}),
				neq: vi.fn((column: string, value: unknown) => {
					_currentFilter = `${column}!=${value}`;
					return createChainable(tableName);
				}),
				in: vi.fn((column: string, values: unknown[]) => {
					_currentFilter = `${column} IN (${values.join(",")})`;
					return createChainable(tableName);
				}),
				gt: vi.fn((column: string, value: unknown) => {
					_currentFilter = `${column}>${value}`;
					return createChainable(tableName);
				}),
				gte: vi.fn((column: string, value: unknown) => {
					_currentFilter = `${column}>=${value}`;
					return createChainable(tableName);
				}),
				lt: vi.fn((column: string, value: unknown) => {
					_currentFilter = `${column}<${value}`;
					return createChainable(tableName);
				}),
				lte: vi.fn((column: string, value: unknown) => {
					_currentFilter = `${column}<=${value}`;
					return createChainable(tableName);
				}),
				not: vi.fn((column: string, operator: string, value: unknown) => {
					_currentFilter = `${column} ${operator} ${value}`;
					return createChainable(tableName);
				}),
				order: vi.fn((_column: string, _options?: { ascending?: boolean }) => {
					return createChainable(tableName);
				}),
				limit: vi.fn((_count: number) => {
					return createChainable(tableName);
				}),
				range: vi.fn((_from: number, _to: number) => {
					return createChainable(tableName);
				}),
				single: vi.fn(() => resolveResult(tableName)),
				maybeSingle: vi.fn(() => resolveResult(tableName)),
				returns: vi.fn(() => resolveResult(tableName)),
			};

			return createAwaitable(tableName, chain);
		}

		function createFilteredChainable(tableName: string, updateData: unknown) {
			return {
				eq: vi.fn((column: string, value: unknown) => {
					_currentFilter = `${column}=${value}`;
					return createFilteredChainable(tableName, updateData);
				}),
				in: vi.fn((column: string, values: unknown[]) => {
					_currentFilter = `${column} IN (${values.join(",")})`;
					return createFilteredChainable(tableName, updateData);
				}),
				select: vi.fn(() => resolveResult(tableName)),
			};
		}
	}

	const mockSupabase = {
		from: vi.fn((table: string) => createQueryBuilder(table)),
		auth: {
			getSession: vi.fn(),
			onAuthStateChange: vi.fn(() => ({
				data: { subscription: { unsubscribe: vi.fn() } },
			})),
			signOut: vi.fn(),
		},
		rpc: vi.fn(),
		channel: vi.fn(() => ({
			on: vi.fn(() => ({ subscribe: vi.fn() })),
			subscribe: vi.fn(),
			unsubscribe: vi.fn(),
		})),
		removeChannel: vi.fn(),
	};

	return {
		supabase: mockSupabase,
		setMockResult,
		createQueryBuilder,
	};
}

/**
 * Mock data factory for consistent test data generation
 */
export function createMockWorkout(
	overrides?: Partial<WorkoutSession>,
): WorkoutSession {
	return {
		id: crypto.randomUUID(),
		user_id: "test-user-id",
		local_profile_id: null,
		name: "Test Workout",
		started_at: new Date().toISOString(),
		duration_seconds: 3600,
		total_volume: 10000,
		set_count: 10,
		exercise_count: 5,
		pr_count: 0,
		routine_name: null,
		workout_mode: null,
		routine_session_id: null,
		notes: null,
		avg_velocity_mps: null,
		avg_asymmetry_pct: null,
		velocity_loss_pct: null,
		dominant_side: null,
		strength_profile: null,
		form_score: null,
		deload_warnings: null,
		rom_violations: null,
		spotter_activations: null,
		peak_force_n: null,
		estimated_calories: null,
		heaviest_lift_kg: null,
		eccentric_load: null,
		echo_level: null,
		warmup_reps: null,
		working_reps: null,
		...overrides,
	};
}

/**
 * Type for mock workout session (subset of actual type)
 */
interface WorkoutSession {
	id: string;
	user_id: string;
	local_profile_id: string | null;
	name: string | null;
	started_at: string;
	duration_seconds: number;
	total_volume: number;
	set_count: number;
	exercise_count: number;
	pr_count: number;
	routine_name: string | null;
	workout_mode: string | null;
	routine_session_id: string | null;
	notes: string | null;
	avg_velocity_mps: number | null;
	avg_asymmetry_pct: number | null;
	velocity_loss_pct: number | null;
	dominant_side: string | null;
	strength_profile: string | null;
	form_score: number | null;
	deload_warnings: number | null;
	rom_violations: number | null;
	spotter_activations: number | null;
	peak_force_n: number | null;
	estimated_calories: number | null;
	heaviest_lift_kg: number | null;
	eccentric_load: string | null;
	echo_level: string | null;
	warmup_reps: number | null;
	working_reps: number | null;
}
