import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
vi.mock("@/lib/supabase", () => ({ supabase: { rpc } }));
vi.mock("@/providers/AuthProvider", () => ({
	useAuth: () => ({ user: { id: "user-1" } }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function wrapper({ children }: { children: ReactNode }) {
	return (
		<QueryClientProvider
			client={
				new QueryClient({ defaultOptions: { mutations: { retry: false } } })
			}
		>
			{children}
		</QueryClientProvider>
	);
}

describe("useDeleteWorkout", () => {
	beforeEach(() => vi.clearAllMocks());

	it("routes portal workout deletion through the tombstone RPC", async () => {
		const mutationId = "60000000-0000-4000-8000-000000000001";
		vi.spyOn(crypto, "randomUUID").mockReturnValue(mutationId);
		rpc.mockResolvedValue({ data: [{ mutation_id: mutationId }], error: null });
		const { useDeleteWorkout } = await import("../workouts");
		const { result } = renderHook(() => useDeleteWorkout(), { wrapper });

		result.current.mutate({
			portalSessionId: "60000000-0000-4000-8000-000000000002",
			profileId: "default",
			scope: "WORKOUT",
		});
		await waitFor(() => expect(result.current.isSuccess).toBe(true));

		expect(rpc).toHaveBeenCalledWith("delete_workout_with_tombstone", {
			p_mutation_id: mutationId,
			p_portal_session_id: "60000000-0000-4000-8000-000000000002",
			p_component_session_id: null,
			p_scope: "WORKOUT",
			p_profile_id: "default",
			p_deleted_at: expect.any(String),
		});
	});
});
