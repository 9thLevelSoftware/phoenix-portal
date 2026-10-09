import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps, ReactNode } from "react";
import {
	MemoryRouter,
	Route,
	Routes,
	useLocation,
	useNavigate,
} from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

function AnalyticsTabPage() {
	const location = useLocation();
	if (new URLSearchParams(location.search).get("tab") === "body") {
		throw new Error("body tab crashed");
	}
	return <div>Analytics ready</div>;
}

function AnalyticsTabControls() {
	const navigate = useNavigate();

	return (
		<div>
			<button type="button" onClick={() => navigate("/analytics?tab=records")}>
				Open records tab
			</button>
			<button type="button" onClick={() => navigate("/analytics?tab=body")}>
				Open body tab
			</button>
			<button type="button" onClick={() => navigate(-1)}>
				Go back
			</button>
		</div>
	);
}

function renderLayout() {
	return render(
		<MemoryRouter initialEntries={["/dashboard/overview"]}>
			<Routes>
				<Route element={<AppLayout />}>
					<Route path="/dashboard/:view" element={<NavigationHarness />} />
					<Route path="/analytics" element={<NavigationHarness />} />
				</Route>
			</Routes>
		</MemoryRouter>,
	);
}

describe("AppLayout route transitions", () => {
	it("mounts under a plain MemoryRouter without requiring a data router", () => {
		expect(() => renderLayout()).not.toThrow();
	});

	it("keeps the main node for search-only changes, but remounts pathname changes", async () => {
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
		expect(container.querySelector("main#main-content")).not.toBe(mainBefore);

		await user.click(screen.getByRole("button", { name: "Open analytics" }));
		await waitFor(() =>
			expect(screen.getByTestId("route-location")).toHaveTextContent(
				"/analytics",
			),
		);
		expect(container.querySelector("main#main-content")).not.toBe(mainBefore);
	});
});

describe("AppLayout page error boundary", () => {
	const originalConsoleError = console.error;

	beforeEach(() => {
		console.error = vi.fn();
	});

	afterEach(() => {
		console.error = originalConsoleError;
	});

	it("resets when the query string changes, including Back", async () => {
		const user = userEvent.setup();
		render(
			<MemoryRouter initialEntries={["/analytics?tab=body"]}>
				<AnalyticsTabControls />
				<Routes>
					<Route element={<AppLayout />}>
						<Route path="/analytics" element={<AnalyticsTabPage />} />
					</Route>
				</Routes>
			</MemoryRouter>,
		);

		expect(screen.getByText("Something went wrong")).toBeInTheDocument();

		await user.click(screen.getByRole("button", { name: "Open records tab" }));
		await waitFor(() => {
			expect(screen.getByText("Analytics ready")).toBeInTheDocument();
		});
		expect(screen.queryByText("Something went wrong")).not.toBeInTheDocument();

		await user.click(screen.getByRole("button", { name: "Open body tab" }));
		await waitFor(() => {
			expect(screen.getByText("Something went wrong")).toBeInTheDocument();
		});

		await user.click(screen.getByRole("button", { name: "Go back" }));
		await waitFor(() => {
			expect(screen.getByText("Analytics ready")).toBeInTheDocument();
		});
		expect(screen.queryByText("Something went wrong")).not.toBeInTheDocument();
	});
});
