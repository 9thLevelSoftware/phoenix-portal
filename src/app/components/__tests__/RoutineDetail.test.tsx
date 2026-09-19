import { queryOptions } from "@tanstack/react-query";
import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { routineDetailSchema } from "@/schemas/transforms";
import { renderWithProviders } from "@/test/test-utils";
import { RoutineDetail } from "../RoutineDetail";

vi.mock("@/app/hooks/useAuth", () => ({
	useAuth: () => ({ user: null, session: null, loading: false }),
}));
vi.mock("@/lib/supabase", () => ({ supabase: {} }));
vi.mock("react-router", async () => {
	const actual = await vi.importActual("react-router");
	return { ...actual, useParams: () => ({ routineId: "routine-1" }) };
});

const ROUTINE_ROW = vi.hoisted(() => ({
	id: "11111111-1111-4111-8111-111111111111",
	user_id: "22222222-2222-4222-8222-222222222222",
	name: "Echo Day",
	description: "",
	exercise_count: 2,
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
			sets: 3,
			reps: 10,
			weight: 10,
			rest_seconds: 90,
			mode: "ECHO",
			order_index: 0,
			created_at: "2026-09-01T00:00:00.000Z",
		},
		{
			id: "44444444-4444-4444-8444-444444444444",
			routine_id: "11111111-1111-4111-8111-111111111111",
			name: "Curl",
			muscle_group: "ARMS",
			sets: 3,
			reps: 10,
			weight: 10,
			rest_seconds: 90,
			mode: "ECCENTRIC_ONLY",
			order_index: 1,
			created_at: "2026-09-01T00:00:00.000Z",
		},
	],
}));

vi.mock("@/queries/routines", () => ({
	routineDetailOptions: (routineId: string) =>
		queryOptions({
			queryKey: ["routines", "detail", routineId],
			queryFn: async () => routineDetailSchema.parse(ROUTINE_ROW),
		}),
}));

describe("RoutineDetail", () => {
	it("shows stored wire modes with their display labels", async () => {
		renderWithProviders(<RoutineDetail />);

		expect(await screen.findByText(/10 reps .* Echo$/)).toBeInTheDocument();
		expect(screen.getByText(/10 reps .* Eccentric Only$/)).toBeInTheDocument();
		expect(screen.queryByText(/ECHO|ECCENTRIC_ONLY/)).not.toBeInTheDocument();
	});

	it("labels settings in mobile's terms and renders superset colour names as hex", async () => {
		const original = ROUTINE_ROW.routine_exercises.map((ex) => ({ ...ex }));
		const settings = {
			superset_id: "55555555-5555-4555-8555-555555555555",
			superset_color: "amber",
			eccentric_load: "LOAD_120",
			echo_level: "HARDEST",
			rep_count_timing: "BOTTOM",
			stop_at_position: "TOP",
		};
		ROUTINE_ROW.routine_exercises = ROUTINE_ROW.routine_exercises.map(
			(ex, index) => ({ ...ex, ...settings, superset_order: index }),
		);
		try {
			renderWithProviders(<RoutineDetail />);

			// Echo exercise: labels, not codes.
			expect(await screen.findByText("Eccentric: 120%")).toBeInTheDocument();
			expect(screen.getByText("Echo: Hardest")).toBeInTheDocument();
			// Eccentric/echo apply only in Echo mode, so the Eccentric Only
			// exercise doesn't claim them.
			expect(screen.getAllByText("Eccentric: 120%")).toHaveLength(1);
			expect(screen.getAllByText("Timing: Bottom")).toHaveLength(2);
			expect(screen.getAllByText("Stop at top")).toHaveLength(2);
			expect(screen.queryByText(/LOAD_120|HARDEST/)).not.toBeInTheDocument();

			const group = document.querySelector<HTMLElement>(
				"[style*='border-left-width']",
			);
			// "amber" is not a CSS colour; it must render as #F59E0B.
			expect(group?.style.borderLeftColor).toBe("rgb(245, 158, 11)");
		} finally {
			ROUTINE_ROW.routine_exercises = original;
		}
	});
});
