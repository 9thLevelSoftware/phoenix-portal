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

	it("does not overwrite the saved open preference when it mounts on a narrow screen", () => {
		localStorage.setItem("phoenix-sidebar-preferred-open", "true");
		const originalMatchMedia = window.matchMedia;
		window.matchMedia = ((query: string) => ({
			matches: query === "(max-width: 1279px)",
			media: query,
			onchange: null,
			addEventListener: () => {},
			removeEventListener: () => {},
			addListener: () => {},
			removeListener: () => {},
			dispatchEvent: () => false,
		})) as typeof window.matchMedia;
		try {
			render(
				<QueryClientProvider client={new QueryClient()}>
					<MemoryRouter initialEntries={["/dashboard"]}>
						<SidebarProvider>
							<AppSidebar />
						</SidebarProvider>
					</MemoryRouter>
				</QueryClientProvider>,
			);
			// Auto-collapsed for the narrow viewport...
			expect(
				document.querySelector('[data-slot="sidebar"][data-state]'),
			).toHaveAttribute("data-state", "collapsed");
			// ...but the user's own choice is still "open" for wide screens.
			expect(localStorage.getItem("phoenix-sidebar-preferred-open")).toBe(
				"true",
			);
		} finally {
			window.matchMedia = originalMatchMedia;
		}
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

	it("marks only Profile current on the bare profile route", () => {
		render(
			<QueryClientProvider client={new QueryClient()}>
				<MemoryRouter initialEntries={["/profile"]}>
					<SidebarProvider>
						<AppSidebar />
					</SidebarProvider>
				</MemoryRouter>
			</QueryClientProvider>,
		);

		const current = screen
			.getAllByRole("link")
			.filter((link) => link.getAttribute("aria-current") === "page");
		expect(current).toHaveLength(1);
		expect(current[0]).toHaveAccessibleName("Profile");
	});

	it("links every account destination, including integrations and billing", () => {
		render(
			<QueryClientProvider client={new QueryClient()}>
				<MemoryRouter initialEntries={["/dashboard"]}>
					<SidebarProvider>
						<AppSidebar />
					</SidebarProvider>
				</MemoryRouter>
			</QueryClientProvider>,
		);

		expect(screen.getByRole("link", { name: "Integrations" })).toHaveAttribute(
			"href",
			"/integrations",
		);
		expect(screen.getByRole("link", { name: "Subscription" })).toHaveAttribute(
			"href",
			"/pricing",
		);
		expect(screen.getByRole("button", { name: "Sign out" })).toBeVisible();
	});

	it("marks only Settings current when viewing profile settings", () => {
		render(
			<QueryClientProvider client={new QueryClient()}>
				<MemoryRouter initialEntries={["/profile?tab=settings"]}>
					<SidebarProvider>
						<AppSidebar />
					</SidebarProvider>
				</MemoryRouter>
			</QueryClientProvider>,
		);

		expect(screen.getByRole("link", { name: "Settings" })).toHaveAttribute(
			"aria-current",
			"page",
		);
		expect(screen.getByRole("link", { name: "Profile" })).not.toHaveAttribute(
			"aria-current",
		);
	});
});
