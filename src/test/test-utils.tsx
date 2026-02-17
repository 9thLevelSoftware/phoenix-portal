import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type RenderOptions, render } from "@testing-library/react";
import type { ReactNode } from "react";

function createTestQueryClient() {
	return new QueryClient({
		defaultOptions: {
			queries: {
				retry: false,
				gcTime: 0,
			},
		},
	});
}

function AllProviders({ children }: { children: ReactNode }) {
	const queryClient = createTestQueryClient();
	return (
		<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
	);
}

export function renderWithProviders(
	ui: React.ReactElement,
	options?: Omit<RenderOptions, "wrapper">,
) {
	return render(ui, { wrapper: AllProviders, ...options });
}

// Mock user for tests that need auth
export const mockUser = {
	id: "test-user-id",
	email: "test@example.com",
	aud: "authenticated",
	role: "authenticated",
	app_metadata: {},
	user_metadata: {},
	created_at: new Date().toISOString(),
} as any;

// Mock auth return value
export const mockAuthReturn = {
	user: mockUser,
	session: { user: mockUser, access_token: "test-token" },
	loading: false,
	signOut: () => Promise.resolve(),
};
