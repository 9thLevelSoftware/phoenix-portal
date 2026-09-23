import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps, ReactNode } from "react";
import {
	createMemoryRouter,
	RouterProvider,
	useLocation,
	useNavigate,
} from "react-router";
import { describe, expect, it, vi } from "vitest";
import { AppLayout } from "../AppLayout";

type MotionMainProps = ComponentProps<"main"> & {
	initial?: unknown;
	animate?: unknown;
	exit?: unknown;
	transition?: unknown;
};

vi.mock("motion/react", async () => {
	const { forwardRef } = await vi.importActual<typeof import("react")>("react");
	const MockMotionMain = forwardRef<HTMLElement, MotionMainProps>(
		(
			{
				children,
				initial: _initial,
				animate: _animate,
				exit: _exit,
				transition: _transition,
				...props
			},
			ref,
		) => (
			<main ref={ref} {...props}>
				{children}
			</main>
		),
	);

	return {
		AnimatePresence: ({ children }: { children: ReactNode }) => children,
		MotionConfig: ({ children }: { children: ReactNode }) => children,
		motion: { main: MockMotionMain },
	};
});

vi.mock("@/hooks/useRealtimeSync", () => ({
	useRealtimeSync: vi.fn(),
}));

vi.mock("@/hooks/useNotificationSync", () => ({
	useNotificationSync: vi.fn(),
}));

vi.mock("@/hooks/useStreakSync", () => ({
	useStreakSync: vi.fn(),
}));

vi.mock("@/hooks/useOnboarding", () => ({
	useOnboarding: () => ({
		needsOnboarding: false,
		needsWhatsNew: false,
		completeOnboarding: { mutate: vi.fn() },
		dismissWhatsNew: { mutate: vi.fn() },
	}),
}));

vi.mock("@/app/components/AppSidebar", () => ({
	AppSidebar: () => null,
}));

vi.mock("@/app/components/MobileBottomNav", () => ({
	MobileBottomNav: () => null,
}));

vi.mock("@/app/components/OfflineBanner", () => ({
	OfflineBanner: () => null,
}));

vi.mock("@/app/components/OnboardingOverlay", () => ({
	OnboardingOverlay: () => null,
}));

vi.mock("@/app/components/SkipToContent", () => ({
	SkipToContent: () => null,
}));

vi.mock("@/app/components/WhatsNewBanner", () => ({
	WhatsNewBanner: () => null,
}));

vi.mock("@/app/components/PageLoading", () => ({
	PageLoading: () => <div>Loading</div>,
}));

vi.mock("@/app/components/ErrorFallback", () => ({
	PageErrorFallback: () => <div>Something went wrong</div>,
}));

vi.mock("@/app/components/ui/sidebar", () => ({
	SidebarProvider: ({ children }: { children: ReactNode }) => (
		<div data-testid="sidebar-provider">{children}</div>
	),
	SidebarInset: ({ children }: { children: ReactNode }) => (
		<div data-testid="sidebar-inset">{children}</div>
	),
}));

vi.mock("@/app/components/ui/sonner", () => ({
	Toaster: () => null,
}));

function NavigationHarness() {
	const navigate = useNavigate();
	const location = useLocation();

	return (
		<div>
			<button
				type="button"
				onClick={() => navigate("/dashboard/overview?foo=1")}
			>
				Change search param
			</button>
			<button type="button" onClick={() => navigate("/dashboard/stats")}>
				Change dashboard view
			</button>
			<button type="button" onClick={() => navigate("/analytics")}>
				Open analytics
			</button>
			<output data-testid="route-location">
				{location.pathname}
				{location.search}
			</output>
		</div>
	);
}

function renderLayout() {
	const router = createMemoryRouter(
		[
			{
				element: <AppLayout />,
				children: [
					{
						id: "dashboard",
						path: "/dashboard/:view",
						element: <NavigationHarness />,
					},
					{
						id: "analytics",
						path: "/analytics",
						element: <NavigationHarness />,
					},
				],
			},
		],
		{ initialEntries: ["/dashboard/overview"] },
	);

	return render(<RouterProvider router={router} />);
}

describe("AppLayout route transitions", () => {
	it("keeps the main node for search and same-route changes, but remounts different routes", async () => {
		const user = userEvent.setup();
		const { container } = renderLayout();
		const mainBefore = container.querySelector("main#main-content");

		expect(mainBefore).not.toBeNull();

		await user.click(
			screen.getByRole("button", { name: "Change search param" }),
		);
		await waitFor(() =>
			expect(screen.getByTestId("route-location")).toHaveTextContent(
				"/dashboard/overview?foo=1",
			),
		);
		expect(container.querySelector("main#main-content")).toBe(mainBefore);

		await user.click(
			screen.getByRole("button", { name: "Change dashboard view" }),
		);
		await waitFor(() =>
			expect(screen.getByTestId("route-location")).toHaveTextContent(
				"/dashboard/stats",
			),
		);
		expect(container.querySelector("main#main-content")).toBe(mainBefore);

		await user.click(screen.getByRole("button", { name: "Open analytics" }));
		await waitFor(() =>
			expect(screen.getByTestId("route-location")).toHaveTextContent(
				"/analytics",
			),
		);
		expect(container.querySelector("main#main-content")).not.toBe(mainBefore);
	});
});
