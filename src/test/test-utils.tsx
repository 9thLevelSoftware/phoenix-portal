import type { User } from "@supabase/supabase-js";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type RenderOptions, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";

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
		<MemoryRouter>
			<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
		</MemoryRouter>
	);
}

export function renderWithProviders(
	ui: React.ReactElement,
	options?: Omit<RenderOptions, "wrapper">,
) {
	return render(ui, { wrapper: AllProviders, ...options });
}

// Mock user for tests that need auth
export const mockUser: User = {
	id: "test-user-id",
	email: "test@example.com",
	aud: "authenticated",
	role: "authenticated",
	app_metadata: {},
	user_metadata: {},
	created_at: new Date().toISOString(),
	// Required fields with test values
	phone: "",
	confirmation_sent_at: undefined,
	confirmed_at: undefined,
	email_confirmed_at: new Date().toISOString(),
	phone_confirmed_at: undefined,
	last_sign_in_at: new Date().toISOString(),
	updated_at: new Date().toISOString(),
	identities: [],
	is_anonymous: false,
	factors: [],
};

// Mock auth return value
export const mockAuthReturn = {
	user: mockUser,
	session: { user: mockUser, access_token: "test-token" },
	loading: false,
	signOut: () => Promise.resolve(),
};
