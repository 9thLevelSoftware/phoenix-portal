import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCommunityStore } from "@/stores/useCommunityStore";
import { normalizeBlockedUserIds, useBlockedUsers } from "../useBlockedUsers";

vi.mock("@/providers/AuthProvider", () => ({
	useAuth: () => ({ user: null }),
}));

vi.mock("@/queries/community", () => ({
	blockedUsersOptions: (userId: string) => ({
		queryKey: ["community", "blocks", userId],
		queryFn: vi.fn(),
	}),
}));

function createWrapper() {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	return ({ children }: { children: ReactNode }) => (
		<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
	);
}

function installLocalStorageStub() {
	const values = new Map<string, string>();
	const storage = {
		getItem: vi.fn((key: string) => values.get(key) ?? null),
		setItem: vi.fn((key: string, value: string) => {
			values.set(key, value);
		}),
		removeItem: vi.fn((key: string) => {
			values.delete(key);
		}),
		clear: vi.fn(() => {
			values.clear();
		}),
	};

	Object.defineProperty(globalThis, "localStorage", {
		configurable: true,
		value: storage,
	});
	Object.defineProperty(window, "localStorage", {
		configurable: true,
		value: storage,
	});
}

describe("normalizeBlockedUserIds", () => {
	it("keeps only non-empty string IDs and removes duplicates", () => {
		expect(
			normalizeBlockedUserIds(["user-1", 123, "", {}, "user-2", "user-1"]),
		).toEqual(["user-1", "user-2"]);
	});
});

describe("useBlockedUsers", () => {
	beforeEach(() => {
		installLocalStorageStub();
	});

	afterEach(() => {
		localStorage.clear();
		useCommunityStore.getState().resetAll();
	});

	it("hydrates only string blocked user IDs from localStorage", async () => {
		localStorage.setItem(
			"phoenix-blocked-users",
			JSON.stringify(["user-1", 123, { id: "user-2" }, "", "user-3"]),
		);

		const { result } = renderHook(() => useBlockedUsers(), {
			wrapper: createWrapper(),
		});

		await waitFor(() =>
			expect([...result.current.blockedUserIds]).toEqual(["user-1", "user-3"]),
		);
	});
});
