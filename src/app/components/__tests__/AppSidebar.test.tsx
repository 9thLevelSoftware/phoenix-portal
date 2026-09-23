import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppSidebar } from "../AppSidebar";
import { SidebarProvider } from "../ui/sidebar";

vi.mock("@/app/hooks/useAuth", () => ({
	useAuth: () => ({
		user: null,
		signOut: vi.fn(),
	}),
}));

vi.mock("../ThemeToggle", () => ({
	ThemeToggle: () => null,
}));

vi.mock("../TierBadge", () => ({
	TierBadge: () => null,
}));

describe("AppSidebar", () => {
	beforeEach(() => {
		const values = new Map<string, string>();
		const storage = {
			getItem: (key: string) => values.get(key) ?? null,
			setItem: (key: string, value: string) => values.set(key, value),
			removeItem: (key: string) => values.delete(key),
			clear: () => values.clear(),
		};
		Object.defineProperty(window, "localStorage", {
			configurable: true,
			value: storage,
		});
	});

	it("marks the current page and leaves other links without aria-current", () => {
		render(
			<QueryClientProvider client={new QueryClient()}>
				<MemoryRouter initialEntries={["/dashboard"]}>
					<SidebarProvider>
						<AppSidebar />
					</SidebarProvider>
				</MemoryRouter>
			</QueryClientProvider>,
		);

		expect(screen.getByRole("link", { name: "Dashboard" })).toHaveAttribute(
			"aria-current",
			"page",
		);
		expect(screen.getByRole("link", { name: "Profile" })).not.toHaveAttribute(
			"aria-current",
		);
	});
});
